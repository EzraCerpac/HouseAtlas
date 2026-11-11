//! Authenticated, immutable selected-record inputs. No transport, refresh, extraction,
//! inference, durable decision or original-byte capability is installed here.
use crate::{
    access as a,
    ai::suggestions as ai,
    app::{Core, RequestPrincipal},
    contracts::stock::{
        AtlasRecordKind, AtlasTarget, HomeboxResourceKind, StockContext, StockTarget,
    },
    domain::{self as d, stock as st},
    storage as s,
};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use std::collections::BTreeSet;

const MAX_SELECTORS: usize = 32;
const MAX_REQUEST_BYTES: usize = 16_384;

type Result<T> = std::result::Result<T, InputError>;
type Projection = (Vec<ai::SourceInput>, Vec<InspectionBinding>, Vec<Value>);
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum InputError {
    InvalidSelection,
    Unavailable,
    Changed,
    LimitExceeded,
}
#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum Feature {
    Inventory,
    Document,
}
#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum Role {
    Subject,
    Candidate,
    Source,
}
impl Role {
    fn admitted(&self) -> ai::InputRole {
        match self {
            Self::Subject => ai::InputRole::Subject,
            Self::Candidate => ai::InputRole::Candidate,
            Self::Source => ai::InputRole::Source,
        }
    }
}
/// Data selectors only. Actor, scope, versions, excerpts and epochs are absent.
#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(
    tag = "kind",
    rename_all = "kebab-case",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
pub enum Selector {
    Entity {
        source_instance_id: String,
        collection_id: String,
        entity_id: String,
    },
    Location {
        source_instance_id: String,
        collection_id: String,
        entity_id: String,
    },
    Evidence {
        record_id: String,
    },
    Asset {
        record_id: String,
    },
}
#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Selection {
    pub selector: Selector,
    pub role: Role,
}
#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SelectionRequest {
    pub feature: Feature,
    pub selections: Vec<Selection>,
}
impl SelectionRequest {
    pub fn parse(bytes: &[u8]) -> Result<Self> {
        if bytes.len() > MAX_REQUEST_BYTES {
            return Err(InputError::LimitExceeded);
        }
        let request: Self =
            serde_json::from_slice(bytes).map_err(|_| InputError::InvalidSelection)?;
        request.validate()?;
        Ok(request)
    }
    fn validate(&self) -> Result<()> {
        if self.selections.is_empty() || self.selections.len() > MAX_SELECTORS {
            return Err(InputError::LimitExceeded);
        }
        let mut unique = BTreeSet::new();
        let mut subjects = 0;
        for selection in &self.selections {
            subjects += usize::from(matches!(selection.role, Role::Subject));
            let key = match &selection.selector {
                Selector::Entity {
                    source_instance_id,
                    collection_id,
                    entity_id,
                }
                | Selector::Location {
                    source_instance_id,
                    collection_id,
                    entity_id,
                } => {
                    for id in [source_instance_id, entity_id] {
                        canonical_id(id)?;
                    }
                    // Match the original HomeBox registration/access owners:
                    // collection identity is opaque bounded text, not a UUID.
                    // Preserve exact spelling, including whitespace and Unicode.
                    if !(1..=4096).contains(&collection_id.chars().count()) {
                        return Err(InputError::InvalidSelection);
                    }
                    // Entity and location aliases cannot select the same record twice.
                    format!("homebox:{source_instance_id}:{collection_id}:{entity_id}")
                }
                Selector::Evidence { record_id } => {
                    canonical_id(record_id)?;
                    format!("evidence:{record_id}")
                }
                Selector::Asset { record_id } => {
                    canonical_id(record_id)?;
                    format!("asset:{record_id}")
                }
            };
            if !unique.insert(key) {
                return Err(InputError::InvalidSelection);
            }
        }
        if subjects != 1 {
            return Err(InputError::InvalidSelection);
        }
        Ok(())
    }
}
fn canonical_id(id: &str) -> Result<()> {
    let parsed = uuid::Uuid::parse_str(id).map_err(|_| InputError::InvalidSelection)?;
    if parsed.to_string() != id {
        return Err(InputError::InvalidSelection);
    }
    Ok(())
}

/// These are metadata/retained-text identities only. No URL, storage path, page,
/// attachment-to-native link or byte-open grant can be inferred from this map.
#[derive(Clone, Debug, Serialize)]
#[serde(
    tag = "kind",
    rename_all = "kebab-case",
    rename_all_fields = "camelCase"
)]
pub enum InspectionTarget {
    CachedEntity {
        source_instance_id: String,
        collection_id: String,
        entity_id: String,
    },
    AtlasRecord {
        record_type: d::RecordType,
        record_id: String,
        revision: u64,
    },
}
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InspectionBinding {
    pub input_ref: String,
    pub version: String,
    pub evidence_ref: Option<String>,
    pub location: Option<ai::EvidenceLocation>,
    pub scope: StockContext,
    pub target: InspectionTarget,
    /// Exact retained field, or null for the record metadata card.
    pub field: Option<String>,
    /// Original admitted retained text only; absent for the metadata-card fallback.
    pub text: Option<String>,
}

/// Request-scoped only: borrowing the original owners prevents rebinding this
/// capture to a reconstructed principal, replacement Core or caller-supplied map.
pub struct SelectedInputs<'a> {
    core: &'a Core,
    principal: &'a RequestPrincipal,
    request: SelectionRequest,
    graph_request: st::ValidatedRequest,
    graph: s::Snapshot,
    admitted: ai::AdmittedSnapshot,
    bindings: Vec<InspectionBinding>,
    observations: Vec<Value>,
}
impl<'a> SelectedInputs<'a> {
    pub fn capture(
        core: &'a Core,
        p: &'a RequestPrincipal,
        request: SelectionRequest,
    ) -> Result<Self> {
        request.validate()?;
        original(core, p)?;
        let contracts = st::NativeStockContract::new().map_err(|_| InputError::Unavailable)?;
        let scope = scope(p);
        // Existing snapshot reader accepts only the original validated context.
        let raw = json!({"schemaVersion":3,"commandId":"atlas.evidence.list",
            "requestId":crate::app::new_id().map_err(|_| InputError::Unavailable)?,
            "context":scope,"target":{"authority":"atlas","recordType":"evidence"},
            "payload":{"pageSize":1,"cursor":null,"includeArchived":false}});
        let graph_request =
            st::ValidatedRequest::parse(&contracts, raw).map_err(|_| InputError::Unavailable)?;
        let graph = super::stock_reads::snapshot(&core.store, p, &graph_request)
            .map_err(|_| InputError::Unavailable)?;
        // Capture all original source references before cached dispatch seals it.
        super::stock_reads::capture_graph(&core.access, p, &graph)
            .map_err(|_| InputError::Changed)?;
        let retrieved = crate::app::now().map_err(|_| InputError::Unavailable)?;
        let epoch = crate::app::new_id().map_err(|_| InputError::Unavailable)?;
        let (sources, bindings, observations) = project(core, p, &request, &graph, &retrieved)?;
        p.seal_source_capture();
        let admitted = ai::AdmittedSnapshot::new(ai::SnapshotInput {
            feature: match request.feature {
                Feature::Inventory => ai::SuggestionFeature::Inventory,
                Feature::Document => ai::SuggestionFeature::Document,
            },
            scope,
            actor_id: p.principal.actor_id().as_str().into(),
            // Host-generated capture identity, not an assertion of upstream revision.
            authority_epoch: epoch,
            sources,
        })
        .map_err(|error| match error {
            ai::SuggestionError::LimitExceeded => InputError::LimitExceeded,
            _ => InputError::Unavailable,
        })?;
        let selected = Self {
            core,
            principal: p,
            request,
            graph_request,
            graph,
            admitted,
            bindings,
            observations,
        };
        selected.recheck(core, p)?;
        Ok(selected)
    }
    pub fn recheck(&self, core: &Core, p: &RequestPrincipal) -> Result<()> {
        if !std::ptr::eq(core, self.core)
            || !std::ptr::eq(p, self.principal)
            || !self
                .principal
                .principal
                .same_authenticated_session(&p.principal)
        {
            return Err(InputError::Changed);
        }
        original(core, p)?;
        let graph = super::stock_reads::snapshot(&core.store, p, &self.graph_request)
            .map_err(|_| InputError::Changed)?;
        if graph != self.graph {
            return Err(InputError::Changed);
        }
        // Re-read each cached resource through its original access/disclosure owner.
        // Compare original facts and disclosed freshness; crossing the age boundary
        // conservatively retires the capture rather than silently keeping it current.
        let observations = read_observations(core, p, &self.request)?;
        if observations != self.observations {
            return Err(InputError::Changed);
        }
        original(core, p)
    }
    /// The caller must use this current view at every disclosure boundary. The
    /// returned structural snapshot is not continuing authentication or authority.
    pub fn current(&self, core: &Core, p: &RequestPrincipal) -> Result<&ai::AdmittedSnapshot> {
        self.recheck(core, p)?;
        Ok(&self.admitted)
    }
    /// Project a borrowed terminal outcome only at fresh native boundaries.
    /// Retained text/metadata bindings do not establish original-byte availability.
    /// On source failure the caller retains the unchanged outcome and its usage.
    /// These checks are not an atomic transaction or continuing disclosure authority.
    pub fn disclose_completed(
        &self,
        core: &Core,
        p: &RequestPrincipal,
        outcome: &crate::ai::InferenceOutcome,
    ) -> Result<ai::SuggestionCompletion> {
        self.recheck(core, p)?;
        let projected =
            ai::disclose_completed(outcome, &self.admitted, &self.admitted, &BTreeSet::new());
        #[cfg(test)]
        healthy::after_projection(&projected);
        // Keep the entire DTO local until the original native owners recheck.
        self.recheck(core, p)?;
        Ok(projected)
    }
    pub fn inspection(
        &self,
        core: &Core,
        p: &RequestPrincipal,
        input_ref: &str,
        version: &str,
        evidence_ref: Option<&str>,
        location: Option<&ai::EvidenceLocation>,
    ) -> Result<&InspectionBinding> {
        self.recheck(core, p)?;
        self.bindings
            .iter()
            .find(|binding| {
                binding.input_ref == input_ref
                    && binding.version == version
                    && binding.evidence_ref.as_deref() == evidence_ref
                    && same_location(binding.location.as_ref(), location)
            })
            .ok_or(InputError::InvalidSelection)
    }
}
fn same_location(a: Option<&ai::EvidenceLocation>, b: Option<&ai::EvidenceLocation>) -> bool {
    matches!(
        (a, b),
        (None, None)
            | (
                Some(ai::EvidenceLocation::Record),
                Some(ai::EvidenceLocation::Record)
            )
    )
}
fn scope(p: &RequestPrincipal) -> StockContext {
    StockContext {
        workspace_id: p.principal.scope().workspace_id.as_str().into(),
        home_id: p.principal.scope().home_id.as_str().into(),
    }
}
fn original(core: &Core, p: &RequestPrincipal) -> Result<()> {
    let scope = scope(p);
    if !core.homes.iter().any(|home| {
        home.scope.workspace_id == scope.workspace_id && home.scope.home_id == scope.home_id
    }) {
        return Err(InputError::Changed);
    }
    let access = core.access.lock().map_err(|_| InputError::Unavailable)?;
    p.release(&access).map_err(|_| InputError::Changed)?;
    access
        .authorize_storage(&p.principal, p.principal.scope(), a::Capability::Read)
        .map_err(|_| InputError::Changed)?;
    Ok(())
}
fn cached(core: &Core, p: &RequestPrincipal, selector: &Selector) -> Result<Option<Value>> {
    let (source_instance_id, collection_id, entity_id, command) = match selector {
        Selector::Entity {
            source_instance_id,
            collection_id,
            entity_id,
        } => (
            source_instance_id,
            collection_id,
            entity_id,
            "homebox.entity.get",
        ),
        Selector::Location {
            source_instance_id,
            collection_id,
            entity_id,
        } => (
            source_instance_id,
            collection_id,
            entity_id,
            "homebox.location.get",
        ),
        _ => return Ok(None),
    };
    let raw = json!({"schemaVersion":3,"commandId":command,
        "requestId":crate::app::new_id().map_err(|_| InputError::Unavailable)?,"context":scope(p),
        "target":{"authority":"homebox","sourceInstanceId":source_instance_id,"collectionId":collection_id,"resourceKind":"entity","resourceId":entity_id},"payload":{}});
    let result = super::providers::homebox_stock::execute(core, p, raw)
        .map_err(|_| InputError::Unavailable)?;
    let rows = result.wire["data"]["resources"]
        .as_array()
        .ok_or(InputError::Unavailable)?;
    if rows.len() != 1 || rows[0]["target"]["resourceId"].as_str() != Some(entity_id.as_str()) {
        return Err(InputError::Unavailable);
    }
    let mut observation = rows[0].clone();
    observation["ownerSourceStatus"] = result.wire["data"]["sourceStatus"].clone();
    // Retain explicit unknown if this owner has no completeness observation.
    observation["ownerHistoryCompleteness"] = result.wire["data"]["historyCompleteness"].clone();
    Ok(Some(observation))
}
fn read_observations(
    core: &Core,
    p: &RequestPrincipal,
    request: &SelectionRequest,
) -> Result<Vec<Value>> {
    request
        .selections
        .iter()
        .filter_map(|selection| cached(core, p, &selection.selector).transpose())
        .collect()
}
fn project(
    core: &Core,
    p: &RequestPrincipal,
    request: &SelectionRequest,
    graph: &s::Snapshot,
    retrieved: &str,
) -> Result<Projection> {
    let mut sources = Vec::new();
    let mut bindings = Vec::new();
    let mut observations = Vec::new();
    for (index, selection) in request.selections.iter().enumerate() {
        let input_ref = format!("input-{index}");
        let (mut source, target, fields) = match &selection.selector {
            Selector::Entity {
                source_instance_id,
                collection_id,
                entity_id,
            }
            | Selector::Location {
                source_instance_id,
                collection_id,
                entity_id,
            } => {
                let observation =
                    cached(core, p, &selection.selector)?.ok_or(InputError::Unavailable)?;
                let data = &observation["data"];
                if data["archived"] != false {
                    return Err(InputError::Unavailable);
                }
                let digest = observation["observation"]["digest"]
                    .as_str()
                    .ok_or(InputError::Unavailable)?;
                let mut fields: Vec<(String, String, ai::EvidenceBasis)> = vec![(
                    "observationMetadata".into(),
                    serde_json::to_string(&json!({"sourceStatus":observation["ownerSourceStatus"],
                        "historyCompleteness":observation["ownerHistoryCompleteness"],
                        "upstreamRevision":null}))
                    .map_err(|_| InputError::Unavailable)?,
                    ai::EvidenceBasis::MetadataOnly,
                )];
                for field in ["name", "description"] {
                    if let Some(text) = data[field].as_str().filter(|text| !text.is_empty()) {
                        fields.push((
                            field.into(),
                            text.into(),
                            ai::EvidenceBasis::RecordAssertion,
                        ));
                    }
                }
                if let Some(scalars) = data["scalars"].as_object() {
                    for field in ["manufacturer", "modelNumber", "serialNumber", "notes"] {
                        if let Some(text) = scalars
                            .get(field)
                            .and_then(Value::as_str)
                            .filter(|text| !text.is_empty())
                        {
                            fields.push((
                                format!("scalars.{field}"),
                                text.into(),
                                ai::EvidenceBasis::RecordAssertion,
                            ));
                        }
                    }
                }
                let source = ai::SourceInput {
                    input_ref: input_ref.clone(),
                    // Shared suggestion contract uses entityId; stock wire uses resourceId.
                    target: StockTarget::Homebox {
                        source_instance_id: source_instance_id.clone(),
                        collection_id: collection_id.clone(),
                        resource_kind: HomeboxResourceKind::Entity,
                        entity_id: Some(entity_id.clone()),
                        resource_id: None,
                    },
                    version: format!("cache-observation:{digest}"),
                    source_date: data["updatedAt"].as_str().map(str::to_owned),
                    retrieved_at: observation["retrievedAt"]
                        .as_str()
                        .ok_or(InputError::Unavailable)?
                        .into(),
                    availability: if observation["ownerSourceStatus"] == "unavailable" {
                        ai::Availability::Unavailable
                    } else {
                        ai::Availability::Available
                    },
                    role: selection.role.admitted(),
                    kind: if matches!(selection.selector, Selector::Location { .. }) {
                        ai::CandidateKind::Container
                    } else {
                        ai::CandidateKind::InventoryItem
                    },
                    evidence: Vec::new(),
                };
                observations.push(observation);
                (
                    source,
                    InspectionTarget::CachedEntity {
                        source_instance_id: source_instance_id.clone(),
                        collection_id: collection_id.clone(),
                        entity_id: entity_id.clone(),
                    },
                    fields,
                )
            }
            Selector::Evidence { record_id } | Selector::Asset { record_id } => {
                let evidence = matches!(selection.selector, Selector::Evidence { .. });
                let record_type = if evidence {
                    s::RecordType::Evidence
                } else {
                    s::RecordType::Asset
                };
                let record = graph
                    .records
                    .iter()
                    .find(|record| {
                        record.record_type == record_type && record.record_id == *record_id
                    })
                    .ok_or(InputError::Unavailable)?;
                if record.lifecycle != s::Lifecycle::Active {
                    return Err(InputError::Unavailable);
                }
                let mut fields: Vec<(String, String, ai::EvidenceBasis)> = Vec::new();
                let (source_date, retrieved_at, availability) = if evidence {
                    let provenance = &record.payload["provenance"];
                    let statement = record.payload["statement"]
                        .as_str()
                        .ok_or(InputError::Unavailable)?;
                    fields.push((
                        "statement".into(),
                        statement.into(),
                        ai::EvidenceBasis::RecordAssertion,
                    ));
                    fields.push((
                        "provenance".into(),
                        serde_json::to_string(provenance).map_err(|_| InputError::Unavailable)?,
                        ai::EvidenceBasis::MetadataOnly,
                    ));
                    let availability = match provenance["uncertainty"]["status"].as_str() {
                        Some("withdrawn") => ai::Availability::Withdrawn,
                        Some("superseded") => ai::Availability::Unavailable,
                        _ => ai::Availability::Available,
                    };
                    (
                        provenance["factAt"].as_str().map(str::to_owned),
                        provenance["retrievedAt"]
                            .as_str()
                            .ok_or(InputError::Unavailable)?
                            .to_owned(),
                        availability,
                    )
                } else {
                    // Only actual metadata; never include private storageKey or original bytes.
                    let metadata = json!({"contentType":record.payload["contentType"],"byteSize":record.payload["byteSize"],"sha256":record.payload["sha256"],"availability":record.payload["availability"],"purpose":record.payload["purpose"]});
                    fields.push((
                        "metadata".into(),
                        serde_json::to_string(&metadata).map_err(|_| InputError::Unavailable)?,
                        ai::EvidenceBasis::MetadataOnly,
                    ));
                    (
                        None,
                        retrieved.into(),
                        if record.payload["availability"] == "available" {
                            ai::Availability::Available
                        } else {
                            ai::Availability::Unavailable
                        },
                    )
                };
                let source = ai::SourceInput {
                    input_ref: input_ref.clone(),
                    target: StockTarget::Atlas {
                        target: AtlasTarget::Record {
                            record_type: if evidence {
                                AtlasRecordKind::Evidence
                            } else {
                                AtlasRecordKind::Asset
                            },
                            record_id: Some(record_id.clone()),
                        },
                    },
                    version: format!("atlas-record:{}", record.revision),
                    source_date,
                    retrieved_at,
                    availability,
                    role: selection.role.admitted(),
                    kind: if !evidence
                        || record.payload["provenance"]["evidenceBasis"] == "document"
                    {
                        ai::CandidateKind::Document
                    } else {
                        ai::CandidateKind::Other
                    },
                    evidence: Vec::new(),
                };
                (
                    source,
                    InspectionTarget::AtlasRecord {
                        record_type: if evidence {
                            d::RecordType::Evidence
                        } else {
                            d::RecordType::Asset
                        },
                        record_id: record_id.clone(),
                        revision: record.revision,
                    },
                    fields,
                )
            }
        };
        bindings.push(InspectionBinding {
            input_ref: input_ref.clone(),
            version: source.version.clone(),
            evidence_ref: None,
            location: None,
            scope: scope(p),
            target: target.clone(),
            field: None,
            text: None,
        });
        for (number, (field, excerpt, basis)) in fields.into_iter().enumerate() {
            if excerpt.len() > 4096 {
                return Err(InputError::LimitExceeded);
            }
            let evidence_ref = format!("evidence-{index}-{number}");
            let record = match &target {
                InspectionTarget::AtlasRecord {
                    record_type: d::RecordType::Evidence,
                    record_id,
                    ..
                } => Some(d::RecordRef {
                    record_type: d::RecordType::Evidence,
                    record_id: record_id.clone(),
                }),
                _ => None,
            };
            source.evidence.push(ai::AdmittedEvidence {
                evidence_ref: evidence_ref.clone(),
                record,
                location: ai::EvidenceLocation::Record,
                basis,
                excerpt: excerpt.clone(),
            });
            bindings.push(InspectionBinding {
                input_ref: input_ref.clone(),
                version: source.version.clone(),
                evidence_ref: Some(evidence_ref),
                location: Some(ai::EvidenceLocation::Record),
                scope: scope(p),
                target: target.clone(),
                field: Some(field),
                text: Some(excerpt),
            });
        }
        sources.push(source);
    }
    Ok((sources, bindings, observations))
}

#[cfg(test)]
#[path = "suggestion_inputs_healthy.rs"]
mod healthy;
