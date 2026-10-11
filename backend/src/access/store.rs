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
        Ok(Self { db })
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

pub(super) fn insert_session(
    db: &Connection,
    session: &Session,
    max_sessions: u32,
    now: i64,
) -> AccessResult<()> {
    db.execute("DELETE FROM access_sessions WHERE expires_at<=?1", [now])?;
    db.execute(
        "DELETE FROM access_sessions WHERE token_hash IN (
         SELECT token_hash FROM access_sessions WHERE user_id=?1
         ORDER BY created_at DESC,token_hash DESC LIMIT -1 OFFSET ?2)",
        params![session.user_id.as_str(), max_sessions - 1],
    )?;
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
    Ok(())
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
