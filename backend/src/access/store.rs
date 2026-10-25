use std::{fs, path::Path, time::Duration};

use rusqlite::{Connection, OpenFlags, OptionalExtension, TransactionBehavior, params};

use super::{
    ACCESS_SCHEMA_VERSION, AccessError, AccessResult, CanonicalId, PasswordVerifier, Role, Scope,
    SourcePartition, SourceRegistration,
    credentials::{hex, random_bytes},
    types::{AuthorityVersion, LoopbackLocalIdentity, RestoreEpoch},
};

const LOOPBACK_LOCAL_VERIFIER: &str = "houseatlas:credential:loopback-local:v1:password-disabled";

pub(super) enum UserVerifier {
    Password(PasswordVerifier),
    LoopbackLocal,
}

/// Connection visibility stops inside the access module.
pub(super) struct Store {
    pub(super) db: Connection,
    // Process-local cleanup position; no persistent schema or reopen mutation.
    pub(super) session_cleanup_after: Option<String>,
}

pub(super) struct User {
    pub(super) user_id: CanonicalId,
    pub(super) actor_id: CanonicalId,
    pub(super) username: String,
    pub(super) verifier: UserVerifier,
    pub(super) enabled: bool,
    pub(super) version: AuthorityVersion,
}

pub(super) struct Membership {
    pub(super) role: Role,
    pub(super) enabled: bool,
    pub(super) version: AuthorityVersion,
}

pub(super) struct Session {
    pub(super) token_hash: String,
    pub(super) csrf_hash: String,
    pub(super) user_id: CanonicalId,
    pub(super) user_version: AuthorityVersion,
    pub(super) epoch: RestoreEpoch,
    pub(super) origin: String,
    pub(super) created_at: i64,
    pub(super) last_seen: i64,
    pub(super) expires_at: i64,
}

pub(super) struct Source {
    pub(super) registration: SourceRegistration,
    pub(super) enabled: bool,
    pub(super) version: AuthorityVersion,
}

impl Store {
    pub(super) fn memory() -> AccessResult<Self> {
        Self::initialize(Connection::open_in_memory()?)
    }

    pub(super) fn open(path: &Path) -> AccessResult<Self> {
        match fs::symlink_metadata(path) {
            Ok(meta) if !meta.is_file() || meta.file_type().is_symlink() => {
                return Err(AccessError::InvalidInput);
            }
            Ok(_) => {}
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                let mut options = fs::OpenOptions::new();
                options.write(true).create_new(true);
                #[cfg(unix)]
                {
                    use std::os::unix::fs::OpenOptionsExt;
                    options.mode(0o600);
                }
                options.open(path).map_err(|_| AccessError::Unavailable)?;
            }
            Err(_) => return Err(AccessError::Unavailable),
        }
        let flags = OpenFlags::SQLITE_OPEN_READ_WRITE | OpenFlags::SQLITE_OPEN_NOFOLLOW;
        let db = Connection::open_with_flags(path, flags)?;
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            fs::set_permissions(path, fs::Permissions::from_mode(0o600))
                .map_err(|_| AccessError::Unavailable)?;
        }
        Self::initialize(db)
    }

    pub(super) fn open_existing(path: &Path) -> AccessResult<Self> {
        Ok(Self {
            db: super::existing::open(path)?,
            session_cleanup_after: Some(hex(&random_bytes::<32>()?)),
        })
    }

    fn initialize(mut db: Connection) -> AccessResult<Self> {
        db.pragma_update(None, "foreign_keys", true)?;
        db.busy_timeout(Duration::from_millis(5000))?;
        let tx = db.transaction_with_behavior(TransactionBehavior::Immediate)?;
        let existing: bool = tx.query_row(
            "SELECT EXISTS(SELECT 1 FROM sqlite_master WHERE type='table' AND name='access_meta')",
            [],
            |row| row.get(0),
        )?;
        if existing {
            let version: Option<i64> = tx
                .query_row("SELECT version FROM access_meta WHERE id=1", [], |row| {
                    row.get(0)
                })
                .optional()?;
            if version != Some(ACCESS_SCHEMA_VERSION) {
                return Err(AccessError::Unavailable);
            }
        }
        tx.execute_batch(include_str!("schema.sql"))?;
        tx.execute(
            "INSERT OR IGNORE INTO access_meta VALUES(1,1,?1)",
            [hex(&random_bytes::<32>()?)],
        )?;
        tx.commit()?;
        Ok(Self {
            db,
            session_cleanup_after: Some(hex(&random_bytes::<32>()?)),
        })
    }

    pub(super) fn provision_user(
        &mut self,
        user_id: &CanonicalId,
        actor_id: &CanonicalId,
        username: &str,
        verifier: &PasswordVerifier,
        enabled: Option<bool>,
    ) -> AccessResult<()> {
        let username = username_key(username)?;
        let tx = self
            .db
            .transaction_with_behavior(TransactionBehavior::Immediate)?;
        let old = user(&tx, user_id)?;
        if old.as_ref().is_some_and(|u| u.actor_id != *actor_id) {
            return Err(AccessError::InvalidInput);
        }
        let enabled = enabled.unwrap_or_else(|| old.is_none_or(|u| u.enabled));
        tx.execute(
            "INSERT INTO access_users VALUES(?1,?2,?3,?4,?5,1)
             ON CONFLICT(user_id) DO UPDATE SET username=excluded.username,
             verifier=excluded.verifier,enabled=excluded.enabled,version=access_users.version+1",
            params![
                user_id.as_str(),
                actor_id.as_str(),
                username,
                verifier.as_str(),
                enabled
            ],
        )?;
        tx.commit()?;
        Ok(())
    }

    pub(super) fn provision_loopback_local_user(
        &mut self,
        identity: &LoopbackLocalIdentity,
    ) -> AccessResult<()> {
        let tx = self
            .db
            .transaction_with_behavior(TransactionBehavior::Immediate)?;
        let users: i64 = tx.query_row("SELECT count(*) FROM access_users", [], |r| r.get(0))?;
        let members: i64 =
            tx.query_row("SELECT count(*) FROM access_memberships", [], |r| r.get(0))?;
        let sessions: i64 =
            tx.query_row("SELECT count(*) FROM access_sessions", [], |r| r.get(0))?;
        if users != 0 || members != 0 || sessions != 0 {
            return Err(AccessError::InvalidInput);
        }
        tx.execute(
            "INSERT INTO access_users(user_id,actor_id,username,verifier,enabled,version) VALUES(?1,?2,?3,?4,1,1)",
            params![identity.user_id.as_str(), identity.actor_id.as_str(), identity.username, LOOPBACK_LOCAL_VERIFIER],
        )?;
        tx.execute(
            "INSERT INTO access_memberships(user_id,workspace_id,home_id,role,enabled,version) VALUES(?1,?2,?3,'editor',1,1)",
            params![identity.user_id.as_str(), identity.scope.workspace_id.as_str(), identity.scope.home_id.as_str()],
        )?;
        tx.commit()?;
        Ok(())
    }

    pub(super) fn set_membership(
        &mut self,
        user_id: &CanonicalId,
        scope: &Scope,
        role: Role,
        enabled: bool,
    ) -> AccessResult<()> {
        self.db.execute(
            "INSERT INTO access_memberships VALUES(?1,?2,?3,?4,?5,1)
             ON CONFLICT(user_id,workspace_id,home_id) DO UPDATE SET role=excluded.role,
             enabled=excluded.enabled,version=access_memberships.version+1",
            params![
                user_id.as_str(),
                scope.workspace_id.as_str(),
                scope.home_id.as_str(),
                role.as_str(),
                enabled
            ],
        )?;
        Ok(())
    }

    pub(super) fn consume_rate(
        &mut self,
        bucket: &str,
        now: i64,
        window_ms: i64,
        limit: u32,
    ) -> AccessResult<()> {
        let tx = self
            .db
            .transaction_with_behavior(TransactionBehavior::Immediate)?;
        tx.execute("DELETE FROM access_rates WHERE expires_at<=?1", [now])?;
        let row: Option<(i64, i64)> = tx
            .query_row(
                "SELECT starts_at,count FROM access_rates WHERE bucket=?1",
                [bucket],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .optional()?;
        if let Some((start, count)) = row {
            if now < start || count >= i64::from(limit) {
                return Err(AccessError::RateLimited);
            }
        } else {
            let size: i64 =
                tx.query_row("SELECT count(*) FROM access_rates", [], |row| row.get(0))?;
            if size >= 4096 {
                return Err(AccessError::RateLimited);
            }
        }
        tx.execute(
            "INSERT INTO access_rates VALUES(?1,?2,?3,1)
             ON CONFLICT(bucket) DO UPDATE SET count=count+1",
            params![bucket, now, now + window_ms],
        )?;
        tx.commit()?;
        Ok(())
    }

    /// Same limit as consume_rate for a current bucket, without recording.
    pub(super) fn check_rate(&self, bucket: &str, now: i64, limit: u32) -> AccessResult<()> {
        let row: Option<(i64, i64)> = self
            .db
            .query_row(
                "SELECT starts_at,count FROM access_rates WHERE bucket=?1 AND expires_at>?2",
                params![bucket, now],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .optional()?;
        if row.is_some_and(|(start, count)| now < start || count >= i64::from(limit)) {
            return Err(AccessError::RateLimited);
        }
        Ok(())
    }
}

pub(super) fn username_key(value: &str) -> AccessResult<String> {
    if value.is_empty()
        || value.len() > 254
        || !value
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b"_.@+-".contains(&b))
    {
        return Err(AccessError::InvalidInput);
    }
    Ok(value.to_ascii_lowercase())
}

fn stored_id(value: String) -> AccessResult<CanonicalId> {
    CanonicalId::parse(value).map_err(|_| AccessError::Unavailable)
}

pub(super) fn epoch(db: &Connection) -> AccessResult<RestoreEpoch> {
    let value: String = db.query_row("SELECT epoch FROM access_meta WHERE id=1", [], |row| {
        row.get(0)
    })?;
    if value.len() != 64
        || !value
            .bytes()
            .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
    {
        return Err(AccessError::Unavailable);
    }
    Ok(RestoreEpoch(value))
}

pub(super) fn user(db: &Connection, id: &CanonicalId) -> AccessResult<Option<User>> {
    user_with_loopback(db, id, None)
}

pub(super) fn user_with_loopback(
    db: &Connection,
    id: &CanonicalId,
    selected: Option<&LoopbackLocalIdentity>,
) -> AccessResult<Option<User>> {
    let row = db
        .query_row(
            "SELECT user_id,actor_id,username,verifier,enabled,version FROM access_users WHERE user_id=?1",
            [id.as_str()],
            |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                    row.get::<_, String>(3)?,
                    row.get::<_, bool>(4)?,
                    row.get::<_, i64>(5)?,
                ))
            },
        )
        .optional()?;
    row.map(
        |(user_id, actor_id, username, verifier, enabled, version)| {
            let user_id = stored_id(user_id)?;
            let actor_id = stored_id(actor_id)?;
            let verifier = if verifier == LOOPBACK_LOCAL_VERIFIER {
                if !selected.is_some_and(|identity| {
                    identity.user_id == user_id
                        && identity.actor_id == actor_id
                        && identity.username == username
                }) {
                    return Err(AccessError::Unauthenticated);
                }
                UserVerifier::LoopbackLocal
            } else {
                UserVerifier::Password(
                    PasswordVerifier::parse(verifier).map_err(|_| AccessError::Unavailable)?,
                )
            };
            Ok(User {
                user_id,
                actor_id,
                username,
                verifier,
                enabled,
                version: AuthorityVersion(version),
            })
        },
    )
    .transpose()
}

pub(super) fn validate_loopback_local_user(
    db: &Connection,
    identity: &LoopbackLocalIdentity,
) -> AccessResult<User> {
    let users: i64 = db.query_row("SELECT count(*) FROM access_users", [], |r| r.get(0))?;
    let members: i64 = db.query_row("SELECT count(*) FROM access_memberships", [], |r| r.get(0))?;
    if users != 1 || members != 1 {
        return Err(AccessError::Unauthenticated);
    }
    // Local-only admission requires the native enabled spelling, not SQLite's
    // general nonzero-to-bool conversion used by the ordinary password path.
    let enabled_exact: bool = db.query_row(
        "SELECT EXISTS(SELECT 1 FROM access_users WHERE user_id=?1 AND enabled=1)
         AND EXISTS(SELECT 1 FROM access_memberships WHERE user_id=?1
         AND workspace_id=?2 AND home_id=?3 AND enabled=1)",
        params![
            identity.user_id.as_str(),
            identity.scope.workspace_id.as_str(),
            identity.scope.home_id.as_str()
        ],
        |row| row.get(0),
    )?;
    if !enabled_exact {
        return Err(AccessError::Unauthenticated);
    }
    let user = user_with_loopback(db, &identity.user_id, Some(identity))?
        .filter(|u| {
            u.enabled
                && u.version.0 > 0
                && u.username == identity.username
                && matches!(u.verifier, UserVerifier::LoopbackLocal)
        })
        .ok_or(AccessError::Unauthenticated)?;
    membership(db, &identity.user_id, &identity.scope)?
        .filter(|m| m.enabled && m.role == Role::Editor && m.version.0 > 0)
        .ok_or(AccessError::Unauthenticated)?;
    Ok(user)
}

pub(super) fn user_by_name(db: &Connection, name: &str) -> AccessResult<Option<User>> {
    let id: Option<String> = db
        .query_row(
            "SELECT user_id FROM access_users WHERE username=?1",
            [name],
            |row| row.get(0),
        )
        .optional()?;
    match id {
        Some(id) => user(db, &stored_id(id)?),
        None => Ok(None),
    }
}

pub(super) fn membership(
    db: &Connection,
    user_id: &CanonicalId,
    scope: &Scope,
) -> AccessResult<Option<Membership>> {
    let row = db.query_row(
        "SELECT role,enabled,version FROM access_memberships WHERE user_id=?1 AND workspace_id=?2 AND home_id=?3",
        params![user_id.as_str(), scope.workspace_id.as_str(), scope.home_id.as_str()],
        |row| Ok((row.get::<_, String>(0)?, row.get::<_, bool>(1)?, row.get::<_, i64>(2)?)),
    ).optional()?;
    row.map(|(role, enabled, version)| {
        Ok(Membership {
            role: match role.as_str() {
                "viewer" => Role::Viewer,
                "editor" => Role::Editor,
                _ => return Err(AccessError::Unavailable),
            },
            enabled,
            version: AuthorityVersion(version),
        })
    })
    .transpose()
}

pub(super) fn session(db: &Connection, token_hash: &str) -> AccessResult<Option<Session>> {
    let row = db.query_row(
        "SELECT csrf_hash,user_id,user_version,epoch,origin,created_at,last_seen,expires_at FROM access_sessions WHERE token_hash=?1",
        [token_hash],
        |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?, row.get::<_, i64>(2)?, row.get::<_, String>(3)?, row.get::<_, String>(4)?, row.get::<_, i64>(5)?, row.get::<_, i64>(6)?, row.get::<_, i64>(7)?)),
    ).optional()?;
    row.map(
        |(csrf_hash, user_id, user_version, epoch, origin, created_at, last_seen, expires_at)| {
            Ok(Session {
                token_hash: token_hash.to_owned(),
                csrf_hash,
                user_id: stored_id(user_id)?,
                user_version: AuthorityVersion(user_version),
                epoch: RestoreEpoch(epoch),
                origin,
                created_at,
                last_seen,
                expires_at,
            })
        },
    )
    .transpose()
}

// Seek the existing token primary-key index, inspecting at most 64 rows per
// issuance. Expiration remains an authentication check independent of cleanup.
const SESSION_CLEANUP_SELECT: &str = "SELECT token_hash,expires_at FROM access_sessions
    WHERE token_hash>?1 ORDER BY token_hash LIMIT ?2";
const SESSION_CLEANUP_WRAP_SELECT: &str = "SELECT token_hash,expires_at FROM access_sessions
    WHERE token_hash<=?1 ORDER BY token_hash LIMIT ?2";
const SESSION_CLEANUP_DELETE: &str =
    "DELETE FROM access_sessions WHERE token_hash=?1 AND expires_at<=?2";

pub(super) fn insert_session(
    db: &Connection,
    session: &Session,
    now: i64,
    cleanup_after: Option<&str>,
) -> AccessResult<Option<String>> {
    let after = cleanup_after.unwrap_or("");
    let mut candidates = db
        .prepare(SESSION_CLEANUP_SELECT)?
        .query_map(params![after, 64], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, i64>(1)?))
        })?
        .collect::<Result<Vec<_>, _>>()?;
    if candidates.len() < 64 && !after.is_empty() {
        // Circular seek: both disjoint indexed ranges share ONE 64-row budget.
        let remaining = (64 - candidates.len()) as i64;
        candidates.extend(
            db.prepare(SESSION_CLEANUP_WRAP_SELECT)?
                .query_map(params![after, remaining], |row| {
                    Ok((row.get::<_, String>(0)?, row.get::<_, i64>(1)?))
                })?
                .collect::<Result<Vec<_>, _>>()?,
        );
    }
    let next = candidates.last().map(|row| row.0.clone());
    for (token, expires_at) in candidates {
        if expires_at <= now {
            db.execute(SESSION_CLEANUP_DELETE, params![token, now])?;
        }
    }
    db.execute(
        "INSERT INTO access_sessions VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9)",
        params![
            session.token_hash,
            session.csrf_hash,
            session.user_id.as_str(),
            session.user_version.0,
            session.epoch.0,
            session.origin,
            session.created_at,
            session.last_seen,
            session.expires_at
        ],
    )?;
    Ok(next)
}

/// Catalog-only byte gate runs inside the held native Access transaction.
/// CASE withholds oversized registration text before rusqlite copies it.
pub(super) fn catalog_source(
    db: &Connection,
    partition: &SourcePartition,
    budget: &crate::catalog_budget::Budget,
) -> AccessResult<Option<Source>> {
    super::partition_catalog::check(budget)?;
    let mut statement = db.prepare(
        "SELECT CASE WHEN length(CAST(registration AS BLOB)) BETWEEN 1 AND 65536
                 THEN registration ELSE NULL END,enabled,version FROM access_sources
         WHERE workspace_id=?1 AND home_id=?2 AND instance_id=?3 AND collection_id=?4"
    )?;
    super::partition_catalog::check(budget)?;
    let row = statement.query_row(
        params![partition.workspace_id.as_str(), partition.home_id.as_str(),
            partition.source_instance_id.as_str(), partition.collection_id],
        |row| Ok((row.get::<_, Option<String>>(0)?, row.get::<_, bool>(1)?, row.get::<_, i64>(2)?)),
    ).optional()?;
    super::partition_catalog::check(budget)?;
    row.map(|(body, enabled, version)| {
        let body = body.ok_or(AccessError::Unavailable)?;
        if body.len() > crate::catalog_budget::MAX_REGISTRATION_BYTES {
            return Err(AccessError::Unavailable);
        }
        super::partition_catalog::check(budget)?;
        let registration: SourceRegistration = serde_json::from_str(&body)
            .map_err(|_| AccessError::Unavailable)?;
        super::partition_catalog::check(budget)?;
        registration.validate().map_err(|_| AccessError::Unavailable)?;
        super::partition_catalog::check(budget)?;
        if registration.partition() != *partition || version < 1 {
            return Err(AccessError::Unavailable);
        }
        Ok(Source { registration, enabled, version: AuthorityVersion(version) })
    }).transpose()
}

pub(super) fn source(db: &Connection, partition: &SourcePartition) -> AccessResult<Option<Source>> {
    let row = db
        .query_row(
            "SELECT registration,enabled,version FROM access_sources
         WHERE workspace_id=?1 AND home_id=?2 AND instance_id=?3 AND collection_id=?4",
            params![
                partition.workspace_id.as_str(),
                partition.home_id.as_str(),
                partition.source_instance_id.as_str(),
                partition.collection_id
            ],
            |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, bool>(1)?,
                    row.get::<_, i64>(2)?,
                ))
            },
        )
        .optional()?;
    row.map(|(registration, enabled, version)| {
        let registration: SourceRegistration =
            serde_json::from_str(&registration).map_err(|_| AccessError::Unavailable)?;
        registration
            .validate()
            .map_err(|_| AccessError::Unavailable)?;
        if registration.partition() != *partition {
            return Err(AccessError::Unavailable);
        }
        Ok(Source {
            registration,
            enabled,
            version: AuthorityVersion(version),
        })
    })
    .transpose()
}

#[cfg(test)]
mod bounded_session_cleanup_tests {
    use super::*;
    use crate::access::{AccessBoundary, AccessConfig, AccessLimits, Method, RequestEvidence};

    const NOW: i64 = 1_800_000_000_000;
    const ORIGIN: &str = "https://127.0.0.1:48743";
    fn id(n: u32) -> CanonicalId {
        CanonicalId::parse(format!("10000000-0000-4000-8000-{n:012}")).unwrap()
    }
    fn request(cookie: Option<&str>, method: Method) -> RequestEvidence<'_> {
        RequestEvidence {
            method,
            url: "https://127.0.0.1:48743/api/atlas/auth/session",
            origin: Some(ORIGIN),
            sec_fetch_site: Some("same-origin"),
            referer: None,
            cookie,
            csrf: None,
            authorization: None,
        }
    }
    fn count(db: &Connection, expired: bool) -> i64 {
        db.query_row(
            "SELECT count(*) FROM access_sessions WHERE (expires_at<=?1)=?2",
            params![NOW, expired],
            |row| row.get(0),
        )
        .unwrap()
    }
    fn indexed(db: &Connection, sql: &str, parameters: &[&dyn rusqlite::ToSql]) {
        let plans = db
            .prepare(&format!("EXPLAIN QUERY PLAN {sql}"))
            .unwrap()
            .query_map(parameters, |row| row.get::<_, String>(3))
            .unwrap()
            .collect::<Result<Vec<_>, _>>()
            .unwrap();
        assert!(
            plans.iter().any(|line| line
                .contains("SEARCH access_sessions USING INDEX sqlite_autoindex_access_sessions_1")),
            "{plans:?}"
        );
        assert!(
            !plans
                .iter()
                .any(|line| line.contains("SCAN access_sessions")),
            "{plans:?}"
        );
    }

    #[test]
    #[ignore = "Explicit isolated generated session-policy cleanup lane; run only the exact documented command"]
    fn indexed_cleanup_bounds_each_issuance_and_preserves_current_authority() {
        let identity = LoopbackLocalIdentity {
            user_id: id(4),
            actor_id: id(5),
            username: "generated-cleanup".into(),
            scope: Scope {
                workspace_id: id(1),
                home_id: id(2),
            },
        };
        let config = AccessConfig::new(vec![ORIGIN.into()])
            .unwrap()
            .with_loopback_local(identity)
            .unwrap()
            .with_limits(AccessLimits {
                login_limit: 1000,
                global_login_limit: 10_000,
                request_limit: 10_000,
                ..Default::default()
            })
            .unwrap()
            .with_clock(|| NOW);
        let mut access = AccessBoundary::in_memory(config).unwrap();
        access.provision_loopback_local_user().unwrap();
        let peer = "127.0.0.1".parse().unwrap();
        let expired = access
            .login_loopback_local(&request(None, Method::Post), peer)
            .unwrap();
        let active = access
            .login_loopback_local(&request(None, Method::Post), peer)
            .unwrap();
        let expired_cookie = expired.set_cookie().split(';').next().unwrap();
        let active_cookie = active.set_cookie().split(';').next().unwrap();
        let expired_hash =
            super::super::credentials::digest(expired_cookie.split_once('=').unwrap().1);
        access
            .store
            .db
            .execute(
                "UPDATE access_sessions SET expires_at=?1 WHERE token_hash=?2",
                params![NOW, expired_hash],
            )
            .unwrap();
        let retained = session(&access.store.db, &expired_hash).unwrap().unwrap();
        assert!(
            access
                .session_info(&request(Some(expired_cookie), Method::Get))
                .is_err()
        );
        assert!(session(&access.store.db, &expired_hash).unwrap().is_some());
        // Generated native rows interleave 2,048 expired and 2,048 active keys.
        // All fixed keys precede the genuine nonce session digests.
        for n in 0..4096 {
            access
                .store
                .db
                .execute(
                    "INSERT INTO access_sessions VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9)",
                    params![
                        format!("{n:064x}"),
                        retained.csrf_hash,
                        retained.user_id.as_str(),
                        retained.user_version.0,
                        retained.epoch.0,
                        retained.origin,
                        NOW,
                        NOW,
                        if n % 2 == 0 { NOW } else { NOW + 1_000_000 }
                    ],
                )
                .unwrap();
        }
        access.store.session_cleanup_after = None;
        indexed(&access.store.db, SESSION_CLEANUP_SELECT, &[&"", &64]);
        indexed(&access.store.db, SESSION_CLEANUP_WRAP_SELECT, &[&"f", &64]);
        indexed(&access.store.db, SESSION_CLEANUP_DELETE, &[&"", &NOW]);
        for page in 0..64 {
            access
                .login_loopback_local(&request(None, Method::Post), peer)
                .unwrap();
            assert_eq!(
                access.store.session_cleanup_after.as_deref(),
                Some(format!("{:064x}", (page + 1) * 64 - 1).as_str())
            );
            assert_eq!(count(&access.store.db, true), 2049 - (page + 1) * 32);
            assert_eq!(count(&access.store.db, false), 2049 + page + 1);
            assert!(
                access
                    .session_info(&request(Some(active_cookie), Method::Get))
                    .is_ok()
            );
            assert!(
                access
                    .session_info(&request(Some(expired_cookie), Method::Get))
                    .is_err()
            );
        }
        // Finish the nonce-key tail and observe circular wrap within the same
        // 64-row budget. Expired rejection held while its row remained.
        let mut wrapped = false;
        for _ in 0..8 {
            let before = count(&access.store.db, false);
            let previous = access.store.session_cleanup_after.clone();
            access
                .login_loopback_local(&request(None, Method::Post), peer)
                .unwrap();
            assert_eq!(count(&access.store.db, false), before + 1);
            if access
                .store
                .session_cleanup_after
                .as_ref()
                .zip(previous.as_ref())
                .is_some_and(|(next, previous)| next < previous)
            {
                wrapped = true;
                break;
            }
        }
        assert!(wrapped);
        assert_eq!(count(&access.store.db, true), 0);
        assert!(
            access
                .session_info(&request(Some(active_cookie), Method::Get))
                .is_ok()
        );
        assert!(
            access
                .session_info(&request(Some(expired_cookie), Method::Get))
                .is_err()
        );
    }

    #[test]
    #[ignore = "Explicit isolated generated annual-session cleanup/reopen lane; exact documented command only"]
    fn fresh_cleanup_seeds_and_circular_budget_reach_later_ranges_after_reopen() {
        let root = tempfile::tempdir().unwrap();
        // Resolve only the fresh fixture directory; retain SQLite NOFOLLOW.
        let path = fs::canonicalize(root.path())
            .unwrap()
            .join("generated-access.sqlite");
        let mut store = Store::open(&path).unwrap();
        let identity = LoopbackLocalIdentity {
            user_id: id(4),
            actor_id: id(5),
            username: "generated-reopen".into(),
            scope: Scope {
                workspace_id: id(1),
                home_id: id(2),
            },
        };
        store.provision_loopback_local_user(&identity).unwrap();
        let epoch = epoch(&store.db).unwrap();
        for n in 0..256 {
            for (prefix, expires) in [("1", NOW + 1_000_000), ("e", NOW)] {
                store
                    .db
                    .execute(
                        "INSERT INTO access_sessions VALUES(?1,?2,?3,1,?4,?5,?6,?6,?7)",
                        params![
                            format!("{prefix}{n:063x}"),
                            "generated-csrf",
                            identity.user_id.as_str(),
                            epoch.0,
                            ORIGIN,
                            NOW,
                            expires
                        ],
                    )
                    .unwrap();
            }
        }
        let mut previous_seed = store.session_cleanup_after.clone();
        assert!(previous_seed.is_some());
        drop(store);
        // Controlled starts demonstrate later-range progress after separate
        // strict reopens. Production startup seeds are random, so fairness
        // across repeated short processes is probabilistic, not durable.
        for pass in 0..4 {
            let mut reopened = Store::open_existing(&path).unwrap();
            assert!(reopened.session_cleanup_after.is_some());
            assert_ne!(reopened.session_cleanup_after, previous_seed);
            previous_seed = reopened.session_cleanup_after.clone();
            let start = if pass == 0 {
                "8".repeat(64)
            } else {
                format!("e{:063x}", pass * 64 - 1)
            };
            let active_before = count(&reopened.db, false);
            let tx = reopened
                .db
                .transaction_with_behavior(TransactionBehavior::Immediate)
                .unwrap();
            let session = Session {
                token_hash: format!("f{pass:063x}"),
                csrf_hash: "generated-csrf".into(),
                user_id: identity.user_id.clone(),
                user_version: AuthorityVersion(1),
                epoch: epoch.clone(),
                origin: ORIGIN.into(),
                created_at: NOW,
                last_seen: NOW,
                expires_at: NOW + 1_000_000,
            };
            let next = insert_session(&tx, &session, NOW, Some(&start)).unwrap();
            tx.commit().unwrap();
            reopened.session_cleanup_after = next;
            assert_eq!(count(&reopened.db, true), 256 - (pass + 1) * 64);
            assert_eq!(count(&reopened.db, false), active_before + 1);
        }
        // A start beyond every key must wrap now, not require a second login.
        let mut reopened = Store::open_existing(&path).unwrap();
        indexed(
            &reopened.db,
            SESSION_CLEANUP_WRAP_SELECT,
            &[&"f".repeat(64), &64],
        );
        let tx = reopened
            .db
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .unwrap();
        let session = Session {
            token_hash: "f".repeat(64),
            csrf_hash: "generated-csrf".into(),
            user_id: identity.user_id,
            user_version: AuthorityVersion(1),
            epoch,
            origin: ORIGIN.into(),
            created_at: NOW,
            last_seen: NOW,
            expires_at: NOW + 1_000_000,
        };
        let next = insert_session(&tx, &session, NOW, Some(&"f".repeat(64)))
            .unwrap()
            .unwrap();
        tx.commit().unwrap();
        assert_eq!(next, format!("1{:063x}", 63));
        assert_eq!(count(&reopened.db, true), 0);
        assert_eq!(count(&reopened.db, false), 261);
    }
}
