//! Private metadata and identity body bytes from one bounded read transaction.
//! No vault IO, additional authority or writes.
use super::*;
use rusqlite::{Connection, params};
use serde_json::value::RawValue;
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use std::{collections::BTreeMap, sync::Arc};
const CAPTURE_BYTES: usize = 16 * 1024 * 1024;
const IDENTITY_MEMBER_BYTES: usize = 1024 * 1024;

#[derive(Clone, Default)]
pub(crate) struct IdentityBodies {
    pub members: Vec<IdentityBodyMember>,
    pub omissions: Vec<IdentityBodyMember>,
    pub bytes: Arc<Vec<u8>>,
    pub sha256: String,
    pub membership_sha256: String,
}

#[derive(Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct IdentityBodyMember {
    workspace_id: String,
    home_id: String,
    record_type: &'static str,
    record_id: String,
    revision: Box<RawValue>,
    bytes: usize,
    sha256: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    offset: Option<usize>,
    #[serde(skip_serializing_if = "Option::is_none")]
    code: Option<&'static str>,
}

fn membership_digest(
    members: &[IdentityBodyMember],
    omissions: &[IdentityBodyMember],
) -> Result<String> {
    struct HashWriter(Sha256);
    impl std::io::Write for HashWriter {
        fn write(&mut self, bytes: &[u8]) -> std::io::Result<usize> {
            self.0.update(bytes);
            Ok(bytes.len())
        }
        fn flush(&mut self) -> std::io::Result<()> {
            Ok(())
        }
    }
    let mut writer = HashWriter(Sha256::new());
    // Stream every deterministic scope/type/key, original revision token,
    // offset/length, digest and omission into the continuation commitment.
    // Do not duplicate an entire member table in the bounded fingerprint.
    serde_json::to_writer(&mut writer, &(members, omissions))?;
    Ok(format!("{:x}", writer.0.finalize()))
}

fn identity_conflict() -> Error {
    Error::new(
        "identity-conflict",
        "Retained identity does not match captured record",
    )
}

// v2_json has already checked the numeric grammar and lexical work bounds.
// Compare the decimal coefficient/shift directly with the SQL integer: neither
// integral exponent/decimal tokens nor fractional near-integers pass via f64.
fn revision_matches(token: &str, expected: u64) -> bool {
    if token.starts_with('-') || !(1..=MAX_REVISION).contains(&expected) {
        return false;
    }
    let (coefficient, exponent) = token.split_once(['e', 'E']).unwrap_or((token, "0"));
    let Ok(exponent) = exponent.parse::<i64>() else {
        return false;
    };
    let (integer, fraction) = coefficient.split_once('.').unwrap_or((coefficient, ""));
    let digits = integer
        .bytes()
        .chain(fraction.bytes())
        .skip_while(|b| *b == b'0');
    let shift = exponent - fraction.len() as i64;
    let expected = expected.to_string();
    if digits.clone().count() as i64 + shift != expected.len() as i64 {
        return false;
    }
    if shift < 0
        && integer
            .bytes()
            .chain(fraction.bytes())
            .rev()
            .take((-shift) as usize)
            .any(|b| b != b'0')
    {
        return false;
    }
    digits
        .chain(std::iter::repeat(b'0'))
        .take(expected.len())
        .eq(expected.bytes())
}

fn capture_identities(
    db: &Connection,
    snapshot: &Snapshot,
    scope: &Scope,
) -> Result<IdentityBodies> {
    let mut expected = BTreeMap::new();
    for record in snapshot
        .records
        .iter()
        .filter(|r| r.record_type == RecordType::Identity)
    {
        if record.scope() != *scope || expected.insert(record.record_id.as_str(), record).is_some()
        {
            return Err(identity_conflict());
        }
    }
    if expected.len() > 10_000 {
        return Err(Error::new(
            "export-too-large",
            "Too many retained identities",
        ));
    }
    // Count UTF-8 bytes in SQL before allocating/copying any body. Include
    // oversized omitted members in the existing metadata capture bound.
    let mut stmt = db.prepare("SELECT record_id,length(CAST(body AS BLOB)) FROM records WHERE workspace_id=?1 AND home_id=?2 AND record_type='identity' ORDER BY record_id")?;
    let mut rows = stmt.query(params![scope.workspace_id, scope.home_id])?;
    let mut lengths = BTreeMap::new();
    let mut captured = 0usize;
    let mut retained = 0usize;
    while let Some(row) = rows.next()? {
        let key = row.get_ref(0)?.as_str().map_err(|_| identity_conflict())?;
        if !expected.contains_key(key) || lengths.contains_key(key) {
            return Err(identity_conflict());
        }
        let length = usize::try_from(row.get::<_, i64>(1)?).map_err(|_| identity_conflict())?;
        captured = captured
            .checked_add(length)
            .filter(|n| *n <= CAPTURE_BYTES)
            .ok_or(Error::new(
                "export-too-large",
                "Identity bodies exceed capture bound",
            ))?;
        if length <= IDENTITY_MEMBER_BYTES {
            retained += length;
        }
        lengths.insert(key.to_owned(), length);
    }
    if lengths.len() != expected.len() {
        return Err(identity_conflict());
    }
    let mut bytes = Vec::new();
    bytes
        .try_reserve_exact(retained)
        .map_err(|_| Error::new("export-too-large", "Identity body allocation unavailable"))?;
    let mut result = IdentityBodies::default();
    let mut stmt = db.prepare("SELECT workspace_id,home_id,record_type,record_id,revision,body FROM records WHERE workspace_id=?1 AND home_id=?2 AND record_type='identity' ORDER BY record_id")?;
    let mut rows = stmt.query(params![scope.workspace_id, scope.home_id])?;
    while let Some(row) = rows.next()? {
        let text = |index| -> Result<&str> {
            row.get_ref(index)?
                .as_str()
                .map_err(|_| identity_conflict())
        };
        let id = text(3)?;
        let record = expected.get(id).ok_or_else(identity_conflict)?;
        let body = text(5)?;
        if text(0)? != scope.workspace_id
            || text(1)? != scope.home_id
            || text(2)? != "identity"
            || text(3)? != record.record_id
            || row.get::<_, i64>(4)? != record.revision as i64
            || lengths.get(id) != Some(&body.len())
        {
            return Err(identity_conflict());
        }
        let mut value =
            crate::contracts::v2::parse_value(body.as_bytes()).map_err(|_| identity_conflict())?;
        crate::contracts::v2::validate_value("identityRecord", &value)
            .map_err(|_| identity_conflict())?;
        #[derive(serde::Deserialize)]
        struct OriginalRevision<'a> {
            #[serde(borrow)]
            revision: &'a RawValue,
        }
        // The strict v2 parse above rejects duplicate keys and validates the
        // complete record first. RawValue additionally preserves exponent case
        // and sign spelling which serde_json::Number normalizes on parsing.
        let original: OriginalRevision<'_> = serde_json::from_str(body)?;
        if !revision_matches(original.revision.get(), record.revision) {
            return Err(identity_conflict());
        }
        // Only the detached comparison carrier is normalized. The source body
        // and descriptor revision retain the original numeric lexical token.
        value["revision"] = json!(record.revision);
        value["schemaVersion"] = json!(1);
        let actual: Record = serde_json::from_value(value)?;
        if actual != **record {
            return Err(identity_conflict());
        }
        let mut member = IdentityBodyMember {
            workspace_id: scope.workspace_id.clone(),
            home_id: scope.home_id.clone(),
            record_type: "identity",
            record_id: id.to_owned(),
            revision: original.revision.to_owned(),
            bytes: body.len(),
            sha256: format!("{:x}", Sha256::digest(body.as_bytes())),
            offset: None,
            code: None,
        };
        if body.len() > IDENTITY_MEMBER_BYTES {
            member.code = Some("member-byte-budget");
            result.omissions.push(member);
        } else {
            member.offset = Some(bytes.len());
            bytes.extend_from_slice(body.as_bytes());
            result.members.push(member);
        }
    }
    if bytes.len() != retained || result.members.len() + result.omissions.len() != expected.len() {
        return Err(identity_conflict());
    }
    result.sha256 = format!("{:x}", Sha256::digest(&bytes));
    result.membership_sha256 = membership_digest(&result.members, &result.omissions)?;
    result.bytes = Arc::new(bytes);
    Ok(result)
}
#[derive(Clone, Default)]
pub(crate) struct Metadata {
    pub identity_bodies: IdentityBodies,
    pub network_omitted: bool,
    pub manifests: Vec<(RecordRef, Value)>,
    pub documents: Vec<Value>,
    pub document_assets: Vec<Value>,
    pub document_manifests: Vec<Value>,
}
pub(crate) fn capture(
    db: &Connection,
    snapshot: &Snapshot,
    scope: &Scope,
    full: bool,
    network_omitted: bool,
) -> Result<Metadata> {
    let mut result = Metadata {
        identity_bodies: capture_identities(db, snapshot, scope)?,
        network_omitted,
        ..Metadata::default()
    };
    for record in &snapshot.records {
        if record.record_type == RecordType::Asset {
            let target = RecordRef {
                record_type: RecordType::Asset,
                record_id: record.record_id.clone(),
            };
            let manifest = super::repository::asset_manifest(db, scope, &target)?;
            if manifest != record.payload {
                return Err(Error::new(
                    "identity-conflict",
                    "Asset manifest does not match captured record",
                ));
            }
            result.manifests.push((target, manifest));
        }
    }
    if full {
        let mut size = 0usize;
        let mut stmt = db.prepare("SELECT body FROM geodata_records WHERE workspace_id=?1 AND home_id=?2 ORDER BY record_id")?;
        for (index, row) in stmt
            .query_map(params![scope.workspace_id, scope.home_id], |r| {
                r.get::<_, String>(0)
            })?
            .enumerate()
        {
            let body = row?;
            size = size.saturating_add(body.len());
            if index >= 10_000 || size > 16 * 1024 * 1024 {
                return Err(Error::new(
                    "export-too-large",
                    "Document metadata exceeds capture bound",
                ));
            }
            let value: Value = crate::contracts::v2::parse_value(body.as_bytes())
                .map_err(|_| Error::new("invalid-contract", "Invalid retained Document"))?;
            if value["recordType"] == "geodata-document" {
                result.documents.push(value);
            } else if value["recordType"] == "asset" {
                result.document_assets.push(value);
            }
        }
        let mut stmt=db.prepare("SELECT record_id,body FROM geodata_asset_manifests WHERE workspace_id=?1 AND home_id=?2 ORDER BY record_id")?;
        for (index, row) in stmt
            .query_map(params![scope.workspace_id, scope.home_id], |r| {
                Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?))
            })?
            .enumerate()
        {
            let (id, body) = row?;
            size = size.saturating_add(body.len());
            if index >= 10_000 || size > 16 * 1024 * 1024 {
                return Err(Error::new(
                    "export-too-large",
                    "Document manifests exceed capture bound",
                ));
            }
            let payload: Value =
                crate::contracts::v2::parse_value(body.as_bytes()).map_err(|_| {
                    Error::new("invalid-contract", "Invalid retained Document manifest")
                })?;
            result
                .document_manifests
                .push(json!({"assetId":id,"payload":payload}));
        }
    }
    Ok(result)
}
impl Metadata {
    pub fn fingerprint(&self) -> Result<Value> {
        Ok(
            json!({"identityBodies":{"membershipSha256":self.identity_bodies.membership_sha256,
                "members":self.identity_bodies.members.len(),"omissions":self.identity_bodies.omissions.len(),
                "bytes":self.identity_bodies.bytes.len(),"sha256":self.identity_bodies.sha256},
                "networkOmitted":self.network_omitted,"manifests": self.manifests.iter().map(|(r,m)|json!({"record":r,"manifest":m})).collect::<Vec<_>>(),"documents":self.documents,"assets":self.document_assets,"documentManifests":self.document_manifests}),
        )
    }
}
