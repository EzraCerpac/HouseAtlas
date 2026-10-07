//! Fixed SQL on the original command transaction; no standalone token API.
use super::{stock_repository as stock_repo, upload_types::*, *};
use crate::{
    domain::stock,
    media::{staged_upload::StagedAssetPlan, types as media, vault::PreparedOriginal},
};
use rusqlite::{Connection, OptionalExtension, Row, params};
use serde_json::{Value, json};

fn incompatible() -> Error {
    Error::new(
        "schema-incompatible",
        "Retained upload association is incompatible",
    )
}
fn require(condition: bool) -> Result<()> {
    if condition {
        Ok(())
    } else {
        Err(incompatible())
    }
}
fn uuid<C: Contract>(native: &C, id: &str) -> Result<()> {
    native.validate_shape("recordRef", &json!({"recordType":"asset", "recordId":id}))
}
fn hash(value: &str) -> Result<()> {
    require(
        value.len() == 64
            && value
                .bytes()
                .all(|c| c.is_ascii_digit() || (b'a'..=b'f').contains(&c)),
    )
}
fn binding_from_stage(staged: &StagedAssetPlan) -> UploadBinding {
    let principal = staged.original_principal().principal();
    UploadBinding {
        format: "houseatlas-owned-upload-plan-binding/1".into(),
        stage: UploadStageBinding {
            format: "houseatlas-owned-upload-stage/1".into(),
            scope: Scope {
                workspace_id: principal.scope().workspace_id.as_str().into(),
                home_id: principal.scope().home_id.as_str().into(),
            },
            actor_id: principal.actor_id().as_str().into(),
            request_id: staged.request().request_id().into(),
            asset_id: staged.asset_id().into(),
            staged: staged.staged().clone(),
            payload: staged.payload().clone(),
        },
        original_request: staged.request().raw().clone(),
        request_digest: staged.request().intent_digest().into(),
    }
}
fn validate_binding<C: Contract, S: stock::StockContractPort>(
    native: &C,
    schemas: &S,
    consumed: &ConsumedUpload,
) -> Result<()> {
    let binding = &consumed.binding;
    let stage = &binding.stage;
    require(
        binding.format == "houseatlas-owned-upload-plan-binding/1"
            && stage.format == "houseatlas-owned-upload-stage/1",
    )?;
    native.validate_shape("scope", &serde_json::to_value(&stage.scope)?)?;
    for id in [
        &stage.actor_id,
        &stage.request_id,
        &stage.asset_id,
        &stage.staged.upload_token,
        &consumed.root_operation_id,
        &consumed.group_operation_id,
        &consumed.asset_audit_id,
    ] {
        uuid(native, id)?;
    }
    for value in [
        &consumed.token_hash,
        &consumed.binding_digest,
        &binding.request_digest,
    ] {
        hash(value)?;
    }
    schemas
        .validate("#/$defs/stage", &serde_json::to_value(&stage.staged)?)
        .map_err(|_| incompatible())?;
    let request = stock::ValidatedRequest::parse(schemas, binding.original_request.clone())
        .map_err(|_| incompatible())?;
    crate::contracts::decode::<crate::contracts::AssetPayload>(&serde_json::to_vec(
        &stage.payload,
    )?)
    .map_err(|_| incompatible())?;
    let scope = media::Scope {
        workspace_id: stage.scope.workspace_id.clone(),
        home_id: stage.scope.home_id.clone(),
    };
    let content_type =
        media::ContentType::parse(&stage.staged.content_type).map_err(|_| incompatible())?;
    require(
        stage.payload.preview_policy == media::PreviewPolicy::DownloadOnly
            || (stage.payload.preview_policy == media::PreviewPolicy::SafeRendered
                && content_type == media::ContentType::Png),
    )?;
    let mut expected = PreparedOriginal {
        purpose: stage.payload.purpose,
        storage_key: scope
            .storage_key(&stage.staged.sha256)
            .map_err(|_| incompatible())?,
        identity: media::BlobIdentity {
            sha256: stage.staged.sha256.clone(),
            byte_size: stage.staged.byte_size,
        },
        content_type,
    }
    .with_provenance(
        stage.payload.source_license.clone(),
        stage.payload.evidence_ids.clone(),
    )
    .map_err(|_| incompatible())?;
    // Measurement proves identity/provenance, not renderer qualification. The
    // policy comes from the genuine immutable Media stage and remains bound by
    // the complete canonical binding, consumed receipt and asset association.
    expected.preview_policy = stage.payload.preview_policy;
    let canonical = |value: &Value| native.canonical_json(value);
    require(
        request.id() == stock::OperationId::AtlasAssetCreate
            && request.context().workspace_id == stage.scope.workspace_id
            && request.context().home_id == stage.scope.home_id
            && request.request_id() == stage.request_id
            && request.target()["recordId"] == stage.asset_id
            && request.intent_digest() == binding.request_digest
            && stage.payload.purpose.is_original()
            && stage.payload == expected
            && consumed.token_hash
                == super::migrations::sha256(stage.staged.upload_token.as_bytes())
            && stock::canonical_digest(&serde_json::to_value(binding)?)
                .map_err(|_| incompatible())?
                == consumed.binding_digest
            && canonical(&consumed.asset_payload)?
                == canonical(&serde_json::to_value(&stage.payload)?)?
            && canonical(&request.payload()["staged"])?
                == canonical(&serde_json::to_value(&stage.staged)?)?
            && canonical(&request.payload()["purpose"])?
                == canonical(&serde_json::to_value(stage.payload.purpose)?)?
            && canonical(&request.payload()["sourceLicense"])?
                == canonical(&serde_json::to_value(&stage.payload.source_license)?)?
            && canonical(&request.payload()["evidenceIds"])?
                == canonical(&serde_json::to_value(&stage.payload.evidence_ids)?)?,
    )
}
fn decode_row<C: Contract, S: stock::StockContractPort>(
    native: &C,
    schemas: &S,
    row: &Row<'_>,
) -> Result<ConsumedUpload> {
    let binding_json: String = row.get(8)?;
    let root_json: String = row.get(9)?;
    let binding: UploadBinding = serde_json::from_str(&binding_json)?;
    let root_request: Value = serde_json::from_str(&root_json)?;
    require(
        native.canonical_json(&serde_json::to_value(&binding)?)? == binding_json
            && native.canonical_json(&root_request)? == root_json
            && row.get::<_, i64>(14)? == 1,
    )?;
    let ordinal: i64 = row.get(11)?;
    let consumed = ConsumedUpload {
        token_hash: row.get(0)?,
        binding_digest: row.get(6)?,
        asset_payload: serde_json::to_value(&binding.stage.payload)?,
        binding,
        root_request,
        root_operation_id: row.get(10)?,
        group_ordinal: usize::try_from(ordinal).map_err(|_| incompatible())?,
        group_operation_id: row.get(12)?,
        asset_audit_id: row.get(13)?,
    };
    require(
        consumed.scope().workspace_id == row.get::<_, String>(1)?
            && consumed.scope().home_id == row.get::<_, String>(2)?
            && consumed.actor_id() == row.get::<_, String>(3)?
            && consumed.request_id() == row.get::<_, String>(4)?
            && consumed.asset_id() == row.get::<_, String>(5)?
            && consumed.binding.request_digest == row.get::<_, String>(7)?,
    )?;
    validate_binding(native, schemas, &consumed)?;
    Ok(consumed)
}
const COLUMNS: &str = "token_hash,workspace_id,home_id,actor_id,request_id,asset_id,binding_digest,intent_digest,binding_json,root_request_json,root_operation_id,group_ordinal,group_operation_id,asset_audit_id,codec_version";
fn lookup<C: Contract, S: stock::StockContractPort>(
    db: &Connection,
    native: &C,
    schemas: &S,
    column: &str,
    key: &str,
) -> Result<Option<ConsumedUpload>> {
    // Column is selected only by private literal call sites below.
    let mut query = db.prepare(&format!(
        "SELECT {COLUMNS} FROM upload_consumptions WHERE {column}=?1"
    ))?;
    let mut rows = query.query([key])?;
    rows.next()?
        .map(|row| decode_row(native, schemas, row))
        .transpose()
}
fn validate_links<C: Contract>(
    db: &Connection,
    native: &C,
    consumed: &ConsumedUpload,
    commit: &StockAtlasCommit,
) -> Result<()> {
    require(
        !commit.replayed
            && commit.operation_id == consumed.root_operation_id
            && commit.actor_id == consumed.actor_id()
            && native.canonical_json(&commit.original_request)?
                == native.canonical_json(&consumed.root_request)?,
    )?;
    let group = commit
        .groups
        .get(consumed.group_ordinal)
        .ok_or_else(incompatible)?;
    require(
        group.operation_id == consumed.group_operation_id
            && native.canonical_json(&group.original_request)?
                == native.canonical_json(&consumed.binding.original_request)?
            && group.request_digest == consumed.binding.request_digest
            && group.native_entries.len() == 1
            && group.native_results.len() == 1,
    )?;
    let entry = &group.native_entries[0];
    let result = &group.native_results[0];
    require(
        entry.target.record_type == RecordType::Asset
            && entry.target.record_id == consumed.asset_id()
            && entry.command.operation == Operation::Create
            && entry.command.expected_revision.is_none()
            && result.record.matches(consumed.scope(), &entry.target)
            && result.record.revision == 1
            && result.record.lifecycle == Lifecycle::Active
            && result.audit.audit_id == consumed.asset_audit_id
            && result.audit.actor_id == consumed.actor_id()
            && result.audit.operation == Operation::Create
            && result.audit.previous_revision.is_none()
            && native.canonical_json(&result.record.payload)?
                == native.canonical_json(consumed.asset_payload())?,
    )?;
    validate_current_asset(db, native, consumed)
}

fn validate_current_asset<C: Contract>(
    db: &Connection,
    native: &C,
    consumed: &ConsumedUpload,
) -> Result<()> {
    let (revision, record_json, storage_key, manifest_json): (i64, String, String, String) = db
        .query_row(
            "SELECT r.revision,r.body,m.storage_key,m.body FROM records r JOIN asset_manifests m ON m.workspace_id=r.workspace_id AND m.record_id=r.record_id WHERE r.workspace_id=?1 AND r.home_id=?2 AND r.record_id=?3 AND r.record_type='asset' AND m.home_id=?2",
            params![consumed.scope().workspace_id, consumed.scope().home_id, consumed.asset_id()],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)),
        )
        .optional()?
        .ok_or_else(incompatible)?;
    let current_value: Value = serde_json::from_str(&record_json)?;
    native.validate_shape("record", &current_value)?;
    let current: Record = serde_json::from_value(current_value.clone())?;
    let manifest: Value = serde_json::from_str(&manifest_json)?;
    native.validate_shape("assetPayload", &manifest)?;
    require(
        current.matches(
            consumed.scope(),
            &RecordRef {
                record_type: RecordType::Asset,
                record_id: consumed.asset_id().into(),
            },
        ) && i64::try_from(current.revision).ok() == Some(revision)
            && native.canonical_json(&current_value)? == record_json
            && native.canonical_json(&manifest)? == manifest_json
            && native.canonical_json(&current.payload)? == manifest_json
            && current.payload["storageKey"] == storage_key,
    )?;
    // The published native transition contract freezes these six fields.
    // Later lifecycle, availability and provenance updates remain permitted.
    for field in [
        "owner",
        "purpose",
        "storageKey",
        "sha256",
        "byteSize",
        "contentType",
    ] {
        require(
            native.canonical_json(&current.payload[field])?
                == native.canonical_json(&consumed.asset_payload()[field])?,
        )?;
    }
    Ok(())
}
pub(crate) fn load_for_commit<C: Contract, S: stock::StockContractPort>(
    db: &Connection,
    native: &C,
    schemas: &S,
    commit: &StockAtlasCommit,
) -> Result<Option<ConsumedUpload>> {
    let consumed = lookup(
        db,
        native,
        schemas,
        "root_operation_id",
        &commit.operation_id,
    )?;
    if let Some(value) = &consumed {
        validate_links(db, native, value, commit)?;
    }
    Ok(consumed)
}
pub(crate) fn admit<C: Contract, S: stock::StockContractPort>(
    db: &Connection,
    native: &C,
    schemas: &S,
    actor: &VerifiedActor,
    root: &stock::ValidatedRequest,
    staged: &StagedAssetPlan,
) -> Result<bool> {
    let expected = binding_from_stage(staged);
    require(
        expected.stage.scope.workspace_id == actor.workspace_id
            && expected.stage.scope.home_id == actor.home_id
            && expected.stage.actor_id == actor.actor_id,
    )?;
    let token_hash = super::migrations::sha256(staged.staged().upload_token.as_bytes());
    let Some(consumed) = lookup(db, native, schemas, "token_hash", &token_hash)? else {
        return Ok(false);
    };
    if native.canonical_json(&serde_json::to_value(&consumed.binding)?)?
        != native.canonical_json(&serde_json::to_value(expected)?)?
        || consumed.binding_digest != staged.binding_digest()
        || native.canonical_json(&consumed.root_request)? != native.canonical_json(root.raw())?
    {
        return Err(stock_repo::conflict());
    }
    let commit = stock_repo::load(
        db,
        native,
        consumed.scope(),
        consumed.actor_id(),
        &consumed.root_operation_id,
    )?;
    validate_links(db, native, &consumed, &commit)?;
    Ok(true)
}
pub(crate) fn consume<C: Contract, S: stock::StockContractPort>(
    db: &Connection,
    native: &C,
    schemas: &S,
    root: &stock::ValidatedRequest,
    staged: &StagedAssetPlan,
    commit: &StockAtlasCommit,
) -> Result<()> {
    let binding = binding_from_stage(staged);
    // The accepted mapper compares the complete canonical envelope, including
    // transport/approval IDs and guards. Preserve that numeric equivalence
    // rather than comparing arbitrary-precision JSON number spellings.
    let original = native.canonical_json(staged.request().raw())?;
    let mut matched = None;
    for (index, group) in commit.groups.iter().enumerate() {
        if native.canonical_json(&group.original_request)? == original {
            require(matched.is_none())?;
            matched = Some(index);
        }
    }
    let index = matched.ok_or_else(incompatible)?;
    let group = &commit.groups[index];
    let result = group.native_results.first().ok_or_else(incompatible)?;
    let consumed = ConsumedUpload {
        token_hash: super::migrations::sha256(staged.staged().upload_token.as_bytes()),
        binding_digest: staged.binding_digest().into(),
        asset_payload: serde_json::to_value(staged.payload())?,
        binding,
        root_request: root.raw().clone(),
        root_operation_id: commit.operation_id.clone(),
        group_ordinal: index,
        group_operation_id: group.operation_id.clone(),
        asset_audit_id: result.audit.audit_id.clone(),
    };
    validate_binding(native, schemas, &consumed)?;
    validate_links(db, native, &consumed, commit)?;
    db.execute(
        "INSERT INTO upload_consumptions VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,1)",
        params![
            consumed.token_hash,
            consumed.scope().workspace_id,
            consumed.scope().home_id,
            consumed.actor_id(),
            consumed.request_id(),
            consumed.asset_id(),
            consumed.binding_digest,
            consumed.binding.request_digest,
            native.canonical_json(&serde_json::to_value(&consumed.binding)?)?,
            native.canonical_json(&consumed.root_request)?,
            consumed.root_operation_id,
            i64::try_from(index).map_err(|_| incompatible())?,
            consumed.group_operation_id,
            consumed.asset_audit_id
        ],
    )?;
    Ok(())
}
pub(crate) fn validate_all<C: Contract, S: stock::StockContractPort>(
    db: &Connection,
    native: &C,
    schemas: &S,
    check: &mut dyn FnMut() -> Result<()>,
) -> Result<()> {
    let mut query =
        db.prepare("SELECT root_operation_id FROM upload_consumptions ORDER BY rowid")?;
    let mut rows = query.query([])?;
    while let Some(row) = rows.next()? {
        check()?;
        let id: String = row.get(0)?;
        let value =
            lookup(db, native, schemas, "root_operation_id", &id)?.ok_or_else(incompatible)?;
        let commit = stock_repo::load(db, native, value.scope(), value.actor_id(), &id)?;
        validate_links(db, native, &value, &commit)?;
        super::stock_projection::validate_retained(db, &commit, schemas, native)?;
        check()?;
    }
    Ok(())
}

/// Fixed scoped token lookup, including complete original native/stock links.
/// Neither a token nor a decoded binding confers any authorization.
pub(crate) fn load_for_token<C: Contract, S: stock::StockContractPort>(
    db: &Connection,
    native: &C,
    schemas: &S,
    scope: &Scope,
    token: &str,
) -> Result<Option<ConsumedUpload>> {
    uuid(native, token)?;
    let token_hash = super::migrations::sha256(token.as_bytes());
    let mut query=db.prepare(&format!("SELECT {COLUMNS} FROM upload_consumptions WHERE token_hash=?1 AND workspace_id=?2 AND home_id=?3"))?;
    let mut rows = query.query(params![token_hash, scope.workspace_id, scope.home_id])?;
    let Some(row) = rows.next()? else {
        return Ok(None);
    };
    let consumed = decode_row(native, schemas, row)?;
    let commit = stock_repo::load(
        db,
        native,
        scope,
        consumed.actor_id(),
        consumed.root_operation_id(),
    )?;
    validate_links(db, native, &consumed, &commit)?;
    super::stock_projection::validate_retained(db, &commit, schemas, native)?;
    Ok(Some(consumed))
}

pub(crate) fn existing_original<C: Contract>(
    db: &Connection,
    native: &C,
    scope: &Scope,
    prepared: &PreparedOriginal,
) -> Result<Option<ExistingOriginalAsset>> {
    if !prepared.purpose.is_original() {
        return Err(Error::new(
            "invalid-contract",
            "Original asset purpose is required",
        ));
    }
    let media_scope = media::Scope {
        workspace_id: scope.workspace_id.clone(),
        home_id: scope.home_id.clone(),
    };
    let key = media_scope
        .storage_key(&prepared.identity.sha256)
        .map_err(|_| incompatible())?;
    require(prepared.storage_key == key)?;
    let Some((id,manifest_json,revision,record_json))=db.query_row(
        "SELECT m.record_id,m.body,r.revision,r.body FROM asset_manifests m JOIN records r ON r.workspace_id=m.workspace_id AND r.record_id=m.record_id AND r.home_id=m.home_id WHERE m.workspace_id=?1 AND m.home_id=?2 AND m.storage_key=?3 AND r.record_type='asset'",
        params![scope.workspace_id,scope.home_id,key],|r|Ok((r.get::<_,String>(0)?,r.get::<_,String>(1)?,r.get::<_,i64>(2)?,r.get::<_,String>(3)?)),
    ).optional()? else {return Ok(None);};
    let record: Record = serde_json::from_str(&record_json)?;
    let manifest: Value = serde_json::from_str(&manifest_json)?;
    native.validate_shape("record", &serde_json::to_value(&record)?)?;
    native.validate_shape("assetPayload", &manifest)?;
    require(
        record.matches(
            scope,
            &RecordRef {
                record_type: RecordType::Asset,
                record_id: id,
            },
        ) && i64::try_from(record.revision).ok() == Some(revision)
            && native.canonical_json(&serde_json::to_value(&record)?)? == record_json
            && native.canonical_json(&manifest)? == manifest_json
            && native.canonical_json(&record.payload)? == manifest_json,
    )?;
    // Existing provenance is returned intact. Submitted provenance cannot
    // replace it, and another purpose/type cannot silently reuse this key.
    if record.lifecycle != Lifecycle::Active
        || manifest["availability"] != "available"
        || manifest["owner"] != "atlas"
        || manifest["purpose"] != serde_json::to_value(prepared.purpose)?
        || manifest["contentType"] != prepared.content_type.as_str()
        || manifest["storageKey"] != prepared.storage_key
        || manifest["sha256"] != prepared.identity.sha256
        || super::numeric::safe_integer(&manifest["byteSize"]) != Some(prepared.identity.byte_size)
    {
        return Err(Error::new(
            "identity-conflict",
            "Existing original asset is incompatible",
        ));
    }
    Ok(Some(ExistingOriginalAsset { record }))
}
