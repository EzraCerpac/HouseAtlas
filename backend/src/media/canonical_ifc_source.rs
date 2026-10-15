//! Source-only, append-only IFC authoring history. This is deliberately a
//! separate SQLite lineage: the existing Atlas schema and geometry selection
//! remain unchanged until a reviewed publication/selection adapter exists.
use rusqlite::{Connection, OptionalExtension, params};
use serde::{Deserialize, Serialize};

use super::geometry_original;
use super::types::{
    AssetPurpose, AssetRecord, ContentType, MediaError, MediaResult, is_digest, is_uuid, sha256,
};
use super::{AssetVault, WorkBudget};

pub const PROFILE: &str = "houseatlas.ifc-source-revision.v1";
const SCHEMA: &str = "\
CREATE TABLE source_lineage(singleton INTEGER PRIMARY KEY CHECK(singleton=1), profile TEXT NOT NULL CHECK(profile='houseatlas.ifc-source-revision.v1')) STRICT;\
INSERT INTO source_lineage VALUES(1,'houseatlas.ifc-source-revision.v1');\
CREATE TABLE source_revisions(\
 workspace_id TEXT NOT NULL, home_id TEXT NOT NULL, building_id TEXT NOT NULL,\
 source_id TEXT NOT NULL, revision_id TEXT NOT NULL PRIMARY KEY, parent_revision_id TEXT,\
 asset_id TEXT NOT NULL, asset_sha256 TEXT NOT NULL, receipt_sha256 TEXT NOT NULL,\
 receipt_json TEXT NOT NULL CHECK(json_valid(receipt_json)),\
 UNIQUE(workspace_id,home_id,building_id,source_id,asset_id),\
 FOREIGN KEY(parent_revision_id) REFERENCES source_revisions(revision_id)) STRICT;\
CREATE INDEX source_revisions_by_source ON source_revisions(workspace_id,home_id,building_id,source_id);\
CREATE UNIQUE INDEX source_revisions_one_root ON source_revisions(workspace_id,home_id,building_id,source_id) WHERE parent_revision_id IS NULL;\
CREATE TRIGGER source_revisions_no_update BEFORE UPDATE ON source_revisions BEGIN SELECT RAISE(ABORT,'immutable IFC source revision'); END;\
CREATE TRIGGER source_revisions_no_delete BEFORE DELETE ON source_revisions BEGIN SELECT RAISE(ABORT,'immutable IFC source revision'); END;\
CREATE TRIGGER source_lineage_no_update BEFORE UPDATE ON source_lineage BEGIN SELECT RAISE(ABORT,'immutable IFC source lineage'); END;\
CREATE TRIGGER source_lineage_no_delete BEFORE DELETE ON source_lineage BEGIN SELECT RAISE(ABORT,'immutable IFC source lineage'); END;";

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SourceScope {
    pub workspace_id: String,
    pub home_id: String,
    pub building_id: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct IfcAsset {
    pub asset_id: String,
    pub sha256: String,
    pub bytes: u64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AuthoringTool {
    pub name: String,
    pub version: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SourceRevision {
    pub profile: String,
    pub scope: SourceScope,
    pub source_id: String,
    pub revision_id: String,
    pub parent_revision_id: Option<String>,
    pub ifc_asset: IfcAsset,
    pub authoring_tool: AuthoringTool,
    /// Author claims only. Conversion must independently verify these values.
    pub declared_units: String,
    pub declared_up_axis: String,
    #[serde(deserialize_with = "super::types::required_nullable")]
    pub semantic_map_revision_id: Option<String>,
    #[serde(deserialize_with = "super::types::required_nullable")]
    pub semantic_map_sha256: Option<String>,
}

impl SourceRevision {
    pub fn validate(&self) -> MediaResult<()> {
        let ids = [
            &self.scope.workspace_id,
            &self.scope.home_id,
            &self.scope.building_id,
            &self.source_id,
            &self.revision_id,
            &self.ifc_asset.asset_id,
        ];
        if self.profile != PROFILE
            || !ids.iter().all(|id| is_uuid(id))
            || self
                .parent_revision_id
                .as_ref()
                .is_some_and(|id| !is_uuid(id) || id == &self.revision_id)
            || self
                .semantic_map_revision_id
                .as_ref()
                .is_some_and(|id| !is_uuid(id))
            || self
                .semantic_map_sha256
                .as_ref()
                .is_some_and(|sha| !is_digest(sha))
            || self.semantic_map_revision_id.is_some() != self.semantic_map_sha256.is_some()
            || !is_digest(&self.ifc_asset.sha256)
            || !(1..=super::MAX_BYTES as u64).contains(&self.ifc_asset.bytes)
            || self.authoring_tool.name.is_empty()
            || self.authoring_tool.name.len() > 128
            || self.authoring_tool.name.chars().any(char::is_control)
            || self
                .authoring_tool
                .version
                .as_ref()
                .is_some_and(|v| v.is_empty() || v.len() > 128 || v.chars().any(char::is_control))
            || !matches!(self.declared_units.as_str(), "mm" | "cm" | "m" | "unknown")
            || !matches!(self.declared_up_axis.as_str(), "X" | "Y" | "Z" | "unknown")
        {
            return Err(MediaError::InvalidInput);
        }
        Ok(())
    }
    pub fn digest(&self) -> MediaResult<String> {
        self.validate()?;
        let body = serde_jcs::to_vec(self).map_err(|_| MediaError::InvalidInput)?;
        Ok(sha256(&body))
    }
}

/// This proof can only be minted by reading the actual retained asset from a
/// vault. A client-supplied digest cannot satisfy append on its own.
pub struct VerifiedIfcAsset {
    record: AssetRecord,
}
impl VerifiedIfcAsset {
    pub fn from_vault(
        vault: &AssetVault,
        record: &AssetRecord,
        budget: &WorkBudget,
    ) -> MediaResult<Self> {
        record.validate()?;
        if record.payload.purpose != AssetPurpose::GeometryOriginal
            || record.payload.content_type != ContentType::Ifc.as_str()
        {
            return Err(MediaError::InvalidInput);
        }
        let bytes = vault.read_retained(record, budget)?;
        geometry_original::validate(&bytes, ContentType::Ifc, budget)?;
        Ok(Self {
            record: record.clone(),
        })
    }
    fn matches(&self, revision: &SourceRevision) -> bool {
        self.record.workspace_id == revision.scope.workspace_id
            && self.record.home_id == revision.scope.home_id
            && self.record.record_id == revision.ifc_asset.asset_id
            && self.record.payload.sha256 == revision.ifc_asset.sha256
            && self.record.payload.byte_size == revision.ifc_asset.bytes
    }
}

/// A standalone source ledger connection. Do not pass the Atlas database here:
/// fresh() refuses nonempty schemas, and reopen() requires this exact lineage.
pub struct SourceLedger<'a> {
    db: &'a mut Connection,
}
impl<'a> SourceLedger<'a> {
    pub fn fresh(db: &'a mut Connection) -> MediaResult<Self> {
        let count: i64 = db
            .query_row(
                "SELECT count(*) FROM sqlite_schema WHERE name NOT LIKE 'sqlite_%'",
                [],
                |r| r.get(0),
            )
            .map_err(|_| MediaError::Unavailable)?;
        if count != 0 {
            return Err(MediaError::Conflict);
        }
        db.execute_batch(SCHEMA)
            .map_err(|_| MediaError::Unavailable)?;
        Ok(Self { db })
    }
    pub fn reopen(db: &'a mut Connection) -> MediaResult<Self> {
        let expected = Connection::open_in_memory().map_err(|_| MediaError::Unavailable)?;
        expected
            .execute_batch(SCHEMA)
            .map_err(|_| MediaError::Unavailable)?;
        fn catalog(db: &Connection) -> rusqlite::Result<Vec<(String, String, String, String)>> {
            db.prepare("SELECT type,name,tbl_name,sql FROM sqlite_schema WHERE name NOT LIKE 'sqlite_%' ORDER BY type,name")?
              .query_map([],|r|Ok((r.get(0)?,r.get(1)?,r.get(2)?,r.get(3)?)))?.collect()
        }
        if catalog(db).map_err(|_| MediaError::Unavailable)?
            != catalog(&expected).map_err(|_| MediaError::Unavailable)?
        {
            return Err(MediaError::Conflict);
        }
        let profile: String = db
            .query_row(
                "SELECT profile FROM source_lineage WHERE singleton=1",
                [],
                |r| r.get(0),
            )
            .map_err(|_| MediaError::Conflict)?;
        if profile != PROFILE {
            return Err(MediaError::Conflict);
        }
        Ok(Self { db })
    }
    pub fn append(
        &mut self,
        receipt: &SourceRevision,
        verified: &VerifiedIfcAsset,
    ) -> MediaResult<String> {
        receipt.validate()?;
        if !verified.matches(receipt) {
            return Err(MediaError::InvalidInput);
        }
        let digest = receipt.digest()?;
        let body = serde_jcs::to_string(receipt).map_err(|_| MediaError::InvalidInput)?;
        let tx = self.db.transaction().map_err(|_| MediaError::Unavailable)?;
        let exists: Option<String> = tx
            .query_row(
                "SELECT receipt_sha256 FROM source_revisions WHERE revision_id=?1",
                [&receipt.revision_id],
                |r| r.get(0),
            )
            .optional()
            .map_err(|_| MediaError::Unavailable)?;
        if let Some(existing) = exists {
            return if existing == digest {
                Ok(digest)
            } else {
                Err(MediaError::Conflict)
            };
        }
        if let Some(parent) = &receipt.parent_revision_id {
            let match_parent:Option<i64>=tx.query_row("SELECT 1 FROM source_revisions WHERE revision_id=?1 AND workspace_id=?2 AND home_id=?3 AND building_id=?4 AND source_id=?5",params![parent,receipt.scope.workspace_id,receipt.scope.home_id,receipt.scope.building_id,receipt.source_id],|r|r.get(0)).optional().map_err(|_|MediaError::Unavailable)?;
            if match_parent.is_none() {
                return Err(MediaError::Conflict);
            }
        } else {
            let root:Option<i64>=tx.query_row("SELECT 1 FROM source_revisions WHERE workspace_id=?1 AND home_id=?2 AND building_id=?3 AND source_id=?4 LIMIT 1",params![receipt.scope.workspace_id,receipt.scope.home_id,receipt.scope.building_id,receipt.source_id],|r|r.get(0)).optional().map_err(|_|MediaError::Unavailable)?;
            if root.is_some() {
                return Err(MediaError::Conflict);
            }
        }
        tx.execute(
            "INSERT INTO source_revisions VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10)",
            params![
                receipt.scope.workspace_id,
                receipt.scope.home_id,
                receipt.scope.building_id,
                receipt.source_id,
                receipt.revision_id,
                receipt.parent_revision_id,
                receipt.ifc_asset.asset_id,
                receipt.ifc_asset.sha256,
                digest,
                body
            ],
        )
        .map_err(|_| MediaError::Conflict)?;
        tx.commit().map_err(|_| MediaError::Unavailable)?;
        Ok(digest)
    }
    pub fn read(&self, revision_id: &str) -> MediaResult<SourceRevision> {
        if !is_uuid(revision_id) {
            return Err(MediaError::InvalidInput);
        }
        let row: Option<(String, String)> = self
            .db
            .query_row(
                "SELECT receipt_json,receipt_sha256 FROM source_revisions WHERE revision_id=?1",
                [revision_id],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .optional()
            .map_err(|_| MediaError::Unavailable)?;
        let (body, digest) = row.ok_or(MediaError::NotFound)?;
        let receipt: SourceRevision =
            serde_json::from_str(&body).map_err(|_| MediaError::Unavailable)?;
        if receipt.revision_id != revision_id || receipt.digest()? != digest {
            return Err(MediaError::Unavailable);
        }
        Ok(receipt)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::media::types::{
        AssetOwner, AssetPayload, AssetRecordType, Availability, LicenseStatus, Lifecycle,
        PreviewPolicy, SourceLicense,
    };
    const W: &str = "00000000-0000-4000-8000-000000000001";
    const H: &str = "00000000-0000-4000-8000-000000000002";
    const B: &str = "00000000-0000-4000-8000-000000000003";
    const S: &str = "00000000-0000-4000-8000-000000000004";
    const A: &str = "00000000-0000-4000-8000-000000000005";
    const A2: &str = "00000000-0000-4000-8000-000000000008";
    const R1: &str = "00000000-0000-4000-8000-000000000006";
    const R2: &str = "00000000-0000-4000-8000-000000000007";
    fn source(revision: &str, parent: Option<&str>) -> SourceRevision {
        SourceRevision {
            profile: PROFILE.into(),
            scope: SourceScope {
                workspace_id: W.into(),
                home_id: H.into(),
                building_id: B.into(),
            },
            source_id: S.into(),
            revision_id: revision.into(),
            parent_revision_id: parent.map(str::to_owned),
            ifc_asset: IfcAsset {
                asset_id: A.into(),
                sha256: "a".repeat(64),
                bytes: 128,
            },
            authoring_tool: AuthoringTool {
                name: "Bonsai".into(),
                version: None,
            },
            declared_units: "unknown".into(),
            declared_up_axis: "unknown".into(),
            semantic_map_revision_id: None,
            semantic_map_sha256: None,
        }
    }
    fn proof() -> VerifiedIfcAsset {
        VerifiedIfcAsset {
            record: AssetRecord {
                schema_version: 1,
                record_type: AssetRecordType::Asset,
                record_id: A.into(),
                workspace_id: W.into(),
                home_id: H.into(),
                revision: 1,
                lifecycle: Lifecycle::Active,
                created_at: "2026-01-01T00:00:00Z".into(),
                updated_at: "2026-01-01T00:00:00Z".into(),
                last_audit_id: R1.into(),
                payload: AssetPayload {
                    owner: AssetOwner::Atlas,
                    purpose: AssetPurpose::GeometryOriginal,
                    storage_key: "synthetic".into(),
                    sha256: "a".repeat(64),
                    byte_size: 128,
                    content_type: ContentType::Ifc.as_str().into(),
                    source_license: SourceLicense {
                        status: LicenseStatus::Unknown,
                        reference: None,
                    },
                    availability: Availability::Available,
                    preview_policy: PreviewPolicy::DownloadOnly,
                    evidence_ids: vec![],
                },
            },
        }
    }
    #[test]
    fn synthetic_source_revision_validation() {
        let mut v = source(R1, None);
        assert!(v.digest().is_ok());
        let schema: serde_json::Value = serde_json::from_str(include_str!(
            "../../../packages/contracts/schemas/canonical-ifc-source-revision.schema.json"
        ))
        .unwrap();
        let validator = jsonschema::options()
            .with_draft(jsonschema::Draft::Draft202012)
            .build(&schema)
            .unwrap();
        assert!(validator.is_valid(&serde_json::to_value(&v).unwrap()));
        v.semantic_map_revision_id = Some(R2.into());
        assert_eq!(v.validate(), Err(MediaError::InvalidInput));
        v.semantic_map_sha256 = Some("b".repeat(64));
        assert!(v.validate().is_ok());
        v.declared_up_axis = "fabricated".into();
        assert_eq!(v.validate(), Err(MediaError::InvalidInput));
    }
    #[test]
    fn synthetic_source_ledger_parent_and_immutability() {
        let mut db = Connection::open_in_memory().unwrap();
        let mut ledger = SourceLedger::fresh(&mut db).unwrap();
        let p = proof();
        let root = source(R1, None);
        let digest = ledger.append(&root, &p).unwrap();
        assert_eq!(ledger.append(&root, &p).unwrap(), digest);
        assert_eq!(ledger.read(R1).unwrap(), root);
        assert_eq!(
            ledger.append(&source(R2, None), &p),
            Err(MediaError::Conflict)
        );
        // A new revision must have a new retained IFC original asset.
        assert_eq!(
            ledger.append(&source(R2, Some(R1)), &p),
            Err(MediaError::Conflict)
        );
        let mut child = source(R2, Some(R1));
        child.ifc_asset.asset_id = A2.into();
        child.ifc_asset.sha256 = "b".repeat(64);
        let mut child_proof = proof();
        child_proof.record.record_id = A2.into();
        child_proof.record.payload.sha256 = "b".repeat(64);
        assert!(ledger.append(&child, &child_proof).is_ok());
        assert_eq!(ledger.read(R2).unwrap(), child);
        let mut unrelated_parent = source("00000000-0000-4000-8000-000000000009", Some(A));
        unrelated_parent.ifc_asset.asset_id = "00000000-0000-4000-8000-000000000010".into();
        let mut unrelated_proof = proof();
        unrelated_proof.record.record_id = unrelated_parent.ifc_asset.asset_id.clone();
        assert_eq!(
            ledger.append(&unrelated_parent, &unrelated_proof),
            Err(MediaError::Conflict)
        );
        drop(ledger);
        let reopened = SourceLedger::reopen(&mut db).unwrap();
        assert_eq!(reopened.read(R1).unwrap().digest().unwrap(), digest);
        assert!(
            db.execute(
                "UPDATE source_revisions SET asset_sha256='b' WHERE revision_id=?1",
                [R1]
            )
            .is_err()
        );
    }
    #[test]
    fn synthetic_source_ledger_rejects_atlas_schema() {
        let mut db = Connection::open_in_memory().unwrap();
        db.execute_batch("CREATE TABLE records(id TEXT)").unwrap();
        assert!(matches!(
            SourceLedger::fresh(&mut db),
            Err(MediaError::Conflict)
        ));
    }

    #[test]
    fn synthetic_source_requires_retained_ifc_bytes() {
        use crate::media::types::Scope;
        use crate::media::{Cancellation, WorkBudget};
        use std::time::Duration;
        let root = tempfile::tempdir().unwrap();
        let vault = AssetVault::open(root.path()).unwrap();
        let budget = WorkBudget::new(Duration::from_secs(5), Cancellation::default()).unwrap();
        let scope = Scope {
            workspace_id: W.into(),
            home_id: H.into(),
        };
        let bytes =
            b"ISO-10303-21;\nHEADER;FILE_SCHEMA(('IFC4'));ENDSEC;\nDATA;ENDSEC;\nEND-ISO-10303-21;";
        let prepared = vault
            .prepare_original(
                &scope,
                AssetPurpose::GeometryOriginal,
                ContentType::Ifc,
                &mut bytes.as_slice(),
                &budget,
            )
            .unwrap();
        let mut record = proof().record;
        record.payload.storage_key = prepared.storage_key.clone();
        record.payload.sha256 = prepared.identity.sha256.clone();
        record.payload.byte_size = prepared.identity.byte_size;
        let verified = VerifiedIfcAsset::from_vault(&vault, &record, &budget).unwrap();
        let mut revision = source(R1, None);
        revision.ifc_asset.sha256 = prepared.identity.sha256.clone();
        revision.ifc_asset.bytes = prepared.identity.byte_size;
        let mut db = Connection::open_in_memory().unwrap();
        assert!(
            SourceLedger::fresh(&mut db)
                .unwrap()
                .append(&revision, &verified)
                .is_ok()
        );
        revision.ifc_asset.sha256 = "c".repeat(64);
        assert_eq!(
            SourceLedger::reopen(&mut db)
                .unwrap()
                .append(&revision, &verified),
            Err(MediaError::InvalidInput)
        );
    }
}
