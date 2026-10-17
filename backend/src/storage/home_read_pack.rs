//! Private metadata from one bounded read transaction; no byte IO or writes.
use super::*;
use rusqlite::{Connection, params};
use serde_json::{Value, json};
#[derive(Clone, Default)]
pub(crate) struct Metadata {
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
) -> Result<Metadata> {
    let mut result = Metadata::default();
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
            json!({"manifests": self.manifests.iter().map(|(r,m)|json!({"record":r,"manifest":m})).collect::<Vec<_>>(),"documents":self.documents,"assets":self.document_assets,"documentManifests":self.document_manifests}),
        )
    }
}
