//! Closed retained scene text qualification. A parsed source is evidence data,
//! never an acceptance decision, native placement grant, or bearer capability.
use super::{MediaError, MediaResult, WorkBudget};
use serde::{
    Deserializer,
    de::{Error as _, MapAccess, Visitor},
};
use serde_json::{Value, value::RawValue};
use sha2::{Digest, Sha256};
use std::{collections::BTreeSet, fmt};

const MAX_TEXT_BYTES: usize = 8 * 1024 * 1024;
const MAX_RECEIPT_BYTES: usize = 131_072;
const MAX_MEMBERS: usize = 50_000;
const MAX_DEPTH: usize = 32;

fn invalid() -> MediaError {
    MediaError::InvalidInput
}
fn need(ok: bool) -> MediaResult<()> {
    if ok { Ok(()) } else { Err(invalid()) }
}

struct Entries;
impl<'de> Visitor<'de> for Entries {
    type Value = Vec<(String, &'de RawValue)>;
    fn expecting(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str("object with unique decoded keys")
    }
    fn visit_map<M: MapAccess<'de>>(self, mut map: M) -> Result<Self::Value, M::Error> {
        let mut out = Vec::new();
        let mut seen = BTreeSet::new();
        while let Some((key, raw)) = map.next_entry::<String, &'de RawValue>()? {
            if !seen.insert(key.clone()) {
                return Err(M::Error::custom("duplicate decoded key"));
            }
            out.push((key, raw));
        }
        Ok(out)
    }
}
fn parse_raw(raw: &RawValue, depth: usize, count: &mut usize) -> MediaResult<Value> {
    need(depth <= MAX_DEPTH && *count < MAX_MEMBERS)?;
    *count += 1;
    let source = raw.get().trim_start();
    match source.as_bytes().first().copied() {
        Some(b'{') => {
            let mut deserializer = serde_json::Deserializer::from_str(source);
            let members = deserializer
                .deserialize_map(Entries)
                .map_err(|_| invalid())?;
            need(members.len() <= 128)?;
            let mut object = serde_json::Map::new();
            for (key, value) in members {
                need(key.len() <= 128)?;
                object.insert(key, parse_raw(value, depth + 1, count)?);
            }
            Ok(Value::Object(object))
        }
        Some(b'[') => {
            let members: Vec<&RawValue> = serde_json::from_str(source).map_err(|_| invalid())?;
            need(members.len() <= 2048)?;
            members
                .into_iter()
                .map(|part| parse_raw(part, depth + 1, count))
                .collect::<MediaResult<Vec<_>>>()
                .map(Value::Array)
        }
        Some(b'"') => {
            let value: String = serde_json::from_str(source).map_err(|_| invalid())?;
            need(value.len() <= MAX_RECEIPT_BYTES)?;
            Ok(Value::String(value))
        }
        _ => serde_json::from_str(source).map_err(|_| invalid()),
    }
}
fn parse(bytes: &[u8]) -> MediaResult<Value> {
    let text = std::str::from_utf8(bytes).map_err(|_| invalid())?;
    need(!text.starts_with('\u{feff}'))?;
    let raw: &RawValue = serde_json::from_str(text).map_err(|_| invalid())?;
    let mut count = 0;
    parse_raw(raw, 0, &mut count)
}
fn keys(value: &Value, expected: &[&str]) -> MediaResult<()> {
    let object = value.as_object().ok_or_else(invalid)?;
    need(
        object.len() == expected.len() && object.keys().all(|key| expected.contains(&key.as_str())),
    )
}
fn sha(bytes: &[u8]) -> String {
    format!("{:x}", Sha256::digest(bytes))
}
fn same_anchors(actual: &Value, proposed: &Value) -> MediaResult<()> {
    let anchors = actual.as_array().ok_or_else(invalid)?;
    need(!anchors.is_empty() && anchors.len() <= 128 && actual == proposed)?;
    let mut ids = BTreeSet::new();
    for anchor in anchors {
        keys(
            anchor,
            &[
                "id",
                "sourceFloorKey",
                "sourceOriginalSha256",
                "targets",
                "unresolvedLabels",
            ],
        )?;
        let id = anchor["id"].as_str().ok_or_else(invalid)?;
        need(!id.is_empty() && id.len() <= 512 && ids.insert(id))?;
        let targets = anchor["targets"].as_array().ok_or_else(invalid)?;
        need(targets.len() <= 16)?;
        let mut pairs = BTreeSet::new();
        for target in targets {
            keys(target, &["packagePlaceKey", "packagePlaceUuid"])?;
            let key = target["packagePlaceKey"].as_str().ok_or_else(invalid)?;
            let uuid = target["packagePlaceUuid"].as_str().ok_or_else(invalid)?;
            need(!key.is_empty() && pairs.insert((key, uuid)))?;
        }
        let labels = anchor["unresolvedLabels"].as_array().ok_or_else(invalid)?;
        need(labels.len() <= 32)?;
        let mut unique = BTreeSet::new();
        for label in labels {
            need(unique.insert(label.as_str().ok_or_else(invalid)?))?;
        }
    }
    Ok(())
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct QualifiedDocumentFacts {
    pub source_sha256: String,
    pub receipt_sha256: String,
    pub historical_source_receipt_sha256: String,
    pub version: u8,
}

/// The caller must first obtain this exact original through the native Media
/// asset owner and verify scoped record/manifest agreement. No such ownership
/// can be inferred from the supplied bytes or JSON payload alone.
pub fn qualify_document(
    bytes: &[u8],
    proposed: &Value,
    budget: &WorkBudget,
) -> MediaResult<QualifiedDocumentFacts> {
    budget.check()?;
    need(!bytes.is_empty() && bytes.len() <= MAX_TEXT_BYTES)?;
    let original = parse(bytes)?;
    let version = match original["schema"].as_str() {
        Some("houseatlas.native-scene-source.v1") => {
            keys(
                &original,
                &[
                    "schema",
                    "receiptCanonicalJson",
                    "rooms",
                    "network",
                    "electricity",
                ],
            )?;
            1
        }
        Some("houseatlas.native-scene-source.v2") => {
            keys(
                &original,
                &[
                    "schema",
                    "receiptCanonicalJson",
                    "rooms",
                    "network",
                    "electricity",
                    "electricalFixtures",
                ],
            )?;
            2
        }
        _ => return Err(invalid()),
    };
    let literal = original["receiptCanonicalJson"]
        .as_str()
        .ok_or_else(invalid)?;
    need(
        !literal.is_empty()
            && literal.len() <= MAX_RECEIPT_BYTES
            && proposed["acceptedReceipt"]["canonicalJson"] == literal
            && proposed["acceptedReceipt"]["canonicalSha256"] == sha(literal.as_bytes()),
    )?;
    let receipt = parse(literal.as_bytes())?;
    need(crate::contracts::semantics::canonical_json(&receipt).map_err(|_| invalid())? == literal)?;
    keys(
        &receipt,
        &["profile", "receiptId", "sourceReceiptSha256", "anchors"],
    )?;
    need(
        receipt["profile"] == "houseatlas.native-scene-room-review.v1"
            && receipt["receiptId"] == proposed["acceptedReceipt"]["receiptId"],
    )?;
    let historical = receipt["sourceReceiptSha256"]
        .as_str()
        .ok_or_else(invalid)?;
    need(
        historical.len() == 64
            && historical
                .bytes()
                .all(|byte| byte.is_ascii_hexdigit() && !byte.is_ascii_uppercase()),
    )?;
    same_anchors(&receipt["anchors"], &proposed["acceptedReceipt"]["anchors"])?;
    let rooms = &original["rooms"];
    keys(
        rooms,
        &[
            "status",
            "reason",
            "receiptId",
            "receiptSha256",
            "entries",
            "regions",
        ],
    )?;
    need(
        rooms["status"] == "available"
            && rooms["reason"].is_null()
            && rooms["receiptId"] == receipt["receiptId"]
            && rooms["receiptSha256"] == proposed["acceptedReceipt"]["canonicalSha256"],
    )?;
    let entries = rooms["entries"].as_array().ok_or_else(invalid)?;
    let mappings = proposed["roomMappings"].as_array().ok_or_else(invalid)?;
    need(entries.len() <= 32 && entries.len() == mappings.len())?;
    let mut used = BTreeSet::new();
    for entry in entries {
        let id = entry["id"].as_str().ok_or_else(invalid)?;
        need(used.insert(id))?;
        let mapping = mappings
            .iter()
            .find(|mapping| mapping["sourceRoomId"] == id)
            .ok_or_else(invalid)?;
        need(
            entry["sourceFloorKey"] == mapping["sourceFloorKey"]
                && entry["sourceOriginalSha256"] == mapping["sourceOriginalSha256"]
                && entry["sourceAnchorIds"] == mapping["sourceAnchorIds"],
        )?;
        let targets = mapping["targets"].as_array().ok_or_else(invalid)?;
        need(targets.iter().any(|target| {
            target["packagePlaceKey"] == entry["packagePlaceKey"]
                && target["packagePlaceUuid"] == entry["packagePlaceUuid"]
        }))?;
        for anchor_id in entry["sourceAnchorIds"].as_array().ok_or_else(invalid)? {
            let anchor = receipt["anchors"]
                .as_array()
                .ok_or_else(invalid)?
                .iter()
                .find(|anchor| anchor["id"] == *anchor_id)
                .ok_or_else(invalid)?;
            let targets = anchor["targets"].as_array().ok_or_else(invalid)?;
            need(
                anchor["sourceFloorKey"] == entry["sourceFloorKey"]
                    && anchor["sourceOriginalSha256"] == entry["sourceOriginalSha256"]
                    && targets.len() == 1
                    && targets[0]["packagePlaceKey"] == entry["packagePlaceKey"]
                    && targets[0]["packagePlaceUuid"] == entry["packagePlaceUuid"],
            )?;
        }
    }
    budget.check()?;
    Ok(QualifiedDocumentFacts {
        source_sha256: sha(bytes),
        receipt_sha256: sha(literal.as_bytes()),
        historical_source_receipt_sha256: historical.to_owned(),
        version,
    })
}

/// Private owner allocation: retains the exact reviewed preflight graph and
/// original principal reference until the same Stock command finishes. It is
/// never serialized, accepted from JSON, or reconstructed from a receipt.
pub struct QualifiedScenePlan<'a, P> {
    principal: &'a P,
    original: crate::storage::Snapshot,
    request_digest: String,
    target_id: String,
    building_id: String,
    primary_asset_id: String,
    facts: QualifiedDocumentFacts,
}
impl<'a, P> QualifiedScenePlan<'a, P> {
    pub fn principal(&self) -> &'a P {
        self.principal
    }
    pub fn original(&self) -> &crate::storage::Snapshot {
        &self.original
    }
    pub fn request_digest(&self) -> &str {
        &self.request_digest
    }
    pub fn target_id(&self) -> &str {
        &self.target_id
    }
    pub fn building_id(&self) -> &str {
        &self.building_id
    }
    pub fn primary_asset_id(&self) -> &str {
        &self.primary_asset_id
    }
    pub fn facts(&self) -> &QualifiedDocumentFacts {
        &self.facts
    }
}

/// Qualifies one deliberate Editor scene-create request against actual current
/// native asset custody and descriptor data. Authenticated Editor admission is
/// performed by the HTTP/Stock owner and must retain this same `principal`.
#[allow(clippy::too_many_arguments)]
pub fn qualify_scene<'a, P>(
    principal: &'a P,
    original: &crate::storage::Snapshot,
    scope: &crate::storage::Scope,
    building_id: &str,
    request: &crate::domain::stock::ValidatedRequest,
    owned: &super::service::StoredAsset,
    historical_owned: &super::service::StoredAsset,
    vault: &super::AssetVault,
    budget: &WorkBudget,
) -> MediaResult<QualifiedScenePlan<'a, P>> {
    use super::{
        geometry_bundle,
        types::{AssetPurpose, ContentType},
    };
    use crate::{
        domain::stock::{self as stock, OperationId},
        storage as s,
    };
    budget.check()?;
    need(
        request.id() == OperationId::AtlasSceneAssociationCreate
            && request.children().is_empty()
            && request.context().workspace_id == scope.workspace_id
            && request.context().home_id == scope.home_id
            && request.target()["recordType"] == "scene-association"
            && request.payload()["buildingId"] == building_id
            && request.raw()["preconditions"]["target"].is_null(),
    )?;
    let target_id = request.target()["recordId"].as_str().ok_or_else(invalid)?;
    let current = stock::current_scene_head(original, scope, building_id)
        .map_err(|_| MediaError::Conflict)?;
    let expected_previous = current.map(|row| row.record_id.as_str());
    need(
        request.payload()["previousAssociationId"].as_str() == expected_previous
            && request.payload()["associationVersion"].as_u64()
                == Some(current.map_or(1, |row| {
                    row.payload["associationVersion"].as_u64().unwrap_or(0) + 1
                })),
    )?;
    let selected_building = geometry_bundle::building(original, scope, building_id)?;
    let documents = request.payload()["sourceDocuments"]
        .as_array()
        .ok_or_else(invalid)?;
    need(
        documents.len() == 2
            && documents
                .iter()
                .filter(|doc| doc["role"] == "primary-scene")
                .count()
                == 1
            && documents
                .iter()
                .filter(|doc| doc["role"] == "documentary-sheet")
                .count()
                == 1,
    )?;
    let doc = documents
        .iter()
        .find(|doc| doc["role"] == "primary-scene")
        .ok_or_else(invalid)?;
    let historical_doc = documents
        .iter()
        .find(|doc| doc["role"] == "documentary-sheet")
        .ok_or_else(invalid)?;
    let evidence_id = doc["evidenceId"].as_str().ok_or_else(invalid)?;
    need(
        [
            &selected_building.identity.payload["evidenceIds"],
            &selected_building.semantics.payload["evidenceIds"],
        ]
        .into_iter()
        .any(|ids| {
            ids.as_array().is_some_and(|members| {
                members
                    .iter()
                    .any(|member| member.as_str() == Some(evidence_id))
            })
        }),
    )?;
    let asset_id = doc["originalAssetId"].as_str().ok_or_else(invalid)?;
    let evidence = original
        .records
        .iter()
        .find(|row| {
            row.workspace_id == scope.workspace_id
                && row.home_id == scope.home_id
                && row.lifecycle == s::Lifecycle::Active
                && row.record_type == s::RecordType::Evidence
                && row.record_id == evidence_id
        })
        .ok_or(MediaError::NotFound)?;
    let asset = original
        .records
        .iter()
        .find(|row| {
            row.workspace_id == scope.workspace_id
                && row.home_id == scope.home_id
                && row.lifecycle == s::Lifecycle::Active
                && row.record_type == s::RecordType::Asset
                && row.record_id == asset_id
        })
        .ok_or(MediaError::NotFound)?;
    let refs = evidence.payload["references"]
        .as_array()
        .ok_or_else(invalid)?;
    need(
        evidence.revision == doc["evidenceRevision"].as_u64().ok_or_else(invalid)?
            && refs.len() == 1
            && refs[0]["kind"] == "atlas-asset"
            && refs[0]["assetId"] == asset_id
            && owned.record.record_id == asset_id
            && owned.record.payload == owned.manifest
            && owned.record.revision
                == doc["originalAssetRevision"].as_u64().ok_or_else(invalid)?
            && serde_json::to_value(&owned.record).map_err(|_| invalid())?
                == serde_json::to_value(asset).map_err(|_| invalid())?
            && owned.record.payload.purpose == AssetPurpose::EvidenceOriginal
            && owned.record.payload.content_type == ContentType::Text.as_str()
            && owned.record.payload.availability == super::types::Availability::Available
            && owned.record.payload.sha256 == doc["originalSha256"],
    )?;
    let bytes = vault.read_retained(&owned.record, budget)?;
    let facts = qualify_document(&bytes, request.payload(), budget)?;
    need(facts.source_sha256 == owned.record.payload.sha256)?;
    let historical_id = historical_doc["originalAssetId"]
        .as_str()
        .ok_or_else(invalid)?;
    let historical_evidence_id = historical_doc["evidenceId"].as_str().ok_or_else(invalid)?;
    need(historical_id != asset_id && historical_evidence_id != evidence_id)?;
    let historical_evidence = original
        .records
        .iter()
        .find(|row| {
            row.workspace_id == scope.workspace_id
                && row.home_id == scope.home_id
                && row.lifecycle == s::Lifecycle::Active
                && row.record_type == s::RecordType::Evidence
                && row.record_id == historical_evidence_id
        })
        .ok_or(MediaError::NotFound)?;
    let historical_asset = original
        .records
        .iter()
        .find(|row| {
            row.workspace_id == scope.workspace_id
                && row.home_id == scope.home_id
                && row.lifecycle == s::Lifecycle::Active
                && row.record_type == s::RecordType::Asset
                && row.record_id == historical_id
        })
        .ok_or(MediaError::NotFound)?;
    let historical_refs = historical_evidence.payload["references"]
        .as_array()
        .ok_or_else(invalid)?;
    need(
        historical_evidence.revision
            == historical_doc["evidenceRevision"]
                .as_u64()
                .ok_or_else(invalid)?
            && historical_refs.len() == 1
            && historical_refs[0]["kind"] == "atlas-asset"
            && historical_refs[0]["assetId"] == historical_id
            && historical_owned.record.record_id == historical_id
            && historical_owned.record.revision
                == historical_doc["originalAssetRevision"]
                    .as_u64()
                    .ok_or_else(invalid)?
            && historical_owned.record.payload == historical_owned.manifest
            && serde_json::to_value(&historical_owned.record).map_err(|_| invalid())?
                == serde_json::to_value(historical_asset).map_err(|_| invalid())?
            && historical_owned.record.payload.purpose == AssetPurpose::EvidenceOriginal
            && historical_owned.record.payload.content_type == ContentType::Text.as_str()
            && historical_owned.record.payload.availability
                == super::types::Availability::Available
            && historical_owned.record.payload.sha256 == historical_doc["originalSha256"],
    )?;
    let historical_bytes = vault.read_retained(&historical_owned.record, budget)?;
    need(sha(&historical_bytes) == facts.historical_source_receipt_sha256)?;
    let native = geometry_bundle::floors(original, scope, building_id, vault, budget)?;
    let proposed = request.payload()["sourceFloors"]
        .as_array()
        .ok_or_else(invalid)?;
    need(proposed.len() <= 3)?;
    let mut used = BTreeSet::new();
    for floor in proposed {
        let key = floor["nativeFloorKey"].as_str().ok_or_else(invalid)?;
        need(used.insert(key))?;
        let descriptor = native
            .iter()
            .find(|item| item.descriptor.key == key)
            .ok_or(MediaError::Conflict)?;
        need(
            descriptor.descriptor.original_asset_id == floor["nativeOriginalAssetId"]
                && descriptor.descriptor.original_sha256 == floor["nativeOriginalSha256"]
                && descriptor.descriptor.geometry_id == floor["nativeGeometryId"]
                && Some(descriptor.descriptor.geometry_revision)
                    == floor["nativeGeometryRevision"].as_u64(),
        )?;
    }
    for room in request.payload()["roomMappings"]
        .as_array()
        .ok_or_else(invalid)?
    {
        for target in room["targets"].as_array().ok_or_else(invalid)? {
            if let Some(id) = target["atlasPlaceId"].as_str() {
                stock::reviewed_scene_place(original, scope, building_id, id)
                    .map_err(|_| MediaError::Conflict)?;
            }
        }
    }
    budget.check()?;
    Ok(QualifiedScenePlan {
        principal,
        original: original.scoped(scope),
        request_digest: request.intent_digest().to_owned(),
        target_id: target_id.to_owned(),
        building_id: building_id.to_owned(),
        primary_asset_id: asset_id.to_owned(),
        facts,
    })
}
