//! Trusted, exact original-source policy. No HTTP input or source grant issuer.
//!
//! The host supplies reviewed private approvals, including allocated native IDs.
//! A manifest digest records custody; it does not authenticate a manifest, prove
//! a licence, register physical placement, or replace current native authority.
use super::{Error, Result, Scope, geodata::GeodataSourcePolicy};
use crate::{access, contracts::v2, media::types as mt};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use std::collections::BTreeMap;

const PROFILE: &str = "houseatlas.reviewed-document-source-policy.v1";
const MAX_APPROVALS: usize = 512;
const MAX_PROVENANCE_BYTES: usize = 32 * 1024;
const MAX_MANIFEST_BYTES: usize = 4 * 1024 * 1024;

fn invalid() -> Error {
    Error::new("forbidden", "Reviewed original source policy unavailable")
}
fn need(value: bool) -> Result<()> {
    if value { Ok(()) } else { Err(invalid()) }
}
fn canonical(value: &Value) -> Result<String> {
    serde_jcs::to_string(value).map_err(|_| invalid())
}

/// One trusted approval. `provenance` has the intake shape, without a custody
/// digest; the policy independently derives the expected server custody pin.
/// Do not expose this constructor or its configuration as a caller-controlled
/// intake field. Existing native authentication and mutation authority apply.
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ReviewedDocumentSource {
    pub document_id: String,
    pub original: crate::media::geodata_document::AssetPin,
    pub content_type: String,
    pub provenance: Value,
}

/// Private operator-owned source configuration. This is not a grant or a
/// signed approval format; trust in its origin belongs to the selecting host.
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ReviewedSourceManifest {
    pub profile: String,
    pub scope: Scope,
    pub source_manifest_sha256: String,
    pub documents: Vec<ReviewedDocumentSource>,
}

struct Approved {
    original: Value,
    provenance: Value,
}

/// An immutable bounded policy for one selected native home. Replacing a policy
/// requires a newly reviewed host selection; no route mutates this allowlist.
pub struct PinnedGeodataSourcePolicy {
    scope: access::Scope,
    source_manifest_sha256: String,
    documents: BTreeMap<String, Approved>,
}
impl PinnedGeodataSourcePolicy {
    pub fn from_reviewed(manifest: ReviewedSourceManifest) -> Result<Self> {
        need(manifest.profile == PROFILE)?;
        need(mt::is_digest(&manifest.source_manifest_sha256))?;
        need(!manifest.documents.is_empty() && manifest.documents.len() <= MAX_APPROVALS)?;
        need(serde_json::to_vec(&manifest).map_err(|_| invalid())?.len() <= MAX_MANIFEST_BYTES)?;
        let scope = access::Scope {
            workspace_id: access::CanonicalId::parse(manifest.scope.workspace_id.clone())?,
            home_id: access::CanonicalId::parse(manifest.scope.home_id.clone())?,
        };
        let mut documents = BTreeMap::new();
        for approved in manifest.documents {
            need(mt::is_uuid(&approved.document_id))?;
            let original = serde_json::to_value(&approved.original).map_err(|_| invalid())?;
            v2::validate_value("geodataAssetPin", &original).map_err(|_| invalid())?;
            need(approved.document_id != approved.original.asset_id)?;
            let admission = match approved.content_type.as_str() {
                "application/json" => "houseatlas.native-original.json.v1",
                "application/geo+json" => "houseatlas.geodata-original.geojson.v1",
                "application/city+json" => "houseatlas.geodata-original.cityjson.v1",
                "image/tiff" => "houseatlas.geodata-original.geotiff.v1",
                "application/pdf" => "houseatlas.native-original.pdf.v1",
                "image/png" => "houseatlas.native-original.png.v1",
                _ => return Err(invalid()),
            };
            let mut provenance = approved.provenance;
            need(
                provenance
                    .as_object()
                    .is_some_and(|p| !p.contains_key("custodyReceiptSha256")),
            )?;
            need(canonical(&provenance)?.len() <= MAX_PROVENANCE_BYTES)?;
            let custody = json!({
                "profile":"houseatlas.geodata-custody-receipt.v1",
                "scope":manifest.scope,
                "asset":original,
                "retrievedAt":provenance["retrievedAt"],
                "sourceUrl":provenance["url"],
                "admissionProfile":admission,
                "measuredContentType":approved.content_type
            });
            provenance["custodyReceiptSha256"] = json!(mt::sha256(canonical(&custody)?.as_bytes()));
            v2::validate_value("geodataSourceProvenance", &provenance).map_err(|_| invalid())?;
            // Preserve exact declared values. In particular, never apply a
            // dataset licence to authored metadata or derivatives by analogy.
            need(
                documents
                    .insert(
                        approved.document_id,
                        Approved {
                            original,
                            provenance,
                        },
                    )
                    .is_none(),
            )?;
        }
        // A Document ID cannot double as any approved Asset identity.
        need(documents.values().all(|d| {
            d.original["assetId"]
                .as_str()
                .is_some_and(|id| !documents.contains_key(id))
        }))?;
        Ok(Self {
            scope,
            source_manifest_sha256: manifest.source_manifest_sha256,
            documents,
        })
    }

    /// Strict, bounded config decoding for the trusted host, never an API body.
    pub fn decode_reviewed(bytes: &[u8]) -> Result<Self> {
        need(bytes.len() <= MAX_MANIFEST_BYTES)?;
        let value = v2::parse_value(bytes).map_err(|_| invalid())?;
        let manifest = serde_json::from_value(value).map_err(|_| invalid())?;
        Self::from_reviewed(manifest)
    }

    pub fn source_manifest_sha256(&self) -> &str {
        &self.source_manifest_sha256
    }
}
impl GeodataSourcePolicy for PinnedGeodataSourcePolicy {
    fn authorize(
        &self,
        guard: &access::TransactionAuthorization<'_>,
        document: &Value,
        mutation: bool,
    ) -> Result<()> {
        guard.authorize(
            &self.scope,
            if mutation {
                access::Capability::Mutate
            } else {
                access::Capability::Read
            },
        )?;
        need(
            document["schemaVersion"] == 2
                && document["recordType"] == "geodata-document"
                && document["workspaceId"] == self.scope.workspace_id.as_str()
                && document["homeId"] == self.scope.home_id.as_str()
                && document["payload"]["preview"].is_null(),
        )?;
        let approved = document["recordId"]
            .as_str()
            .and_then(|id| self.documents.get(id))
            .ok_or_else(invalid)?;
        need(
            document["payload"]["original"] == approved.original
                && document["payload"]["provenance"] == approved.provenance,
        )
    }
}
