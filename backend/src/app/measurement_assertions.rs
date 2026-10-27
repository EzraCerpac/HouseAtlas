//! Original-owner authority composition. No HTTP-decoded documentary carrier
//! can construct an admission. A concrete reviewed native mapping owner is
//! required; there is deliberately no default allow or historical-link adapter.
use super::{Access, RequestPrincipal, storage_access};
use crate::{
    access as a,
    contracts::{self as c, measurement_assertions as wire, semantics as sem},
    measurement_assertions::online_contract as online,
    media, storage as s,
};
use serde_json::{Value, json};
use std::sync::Arc;
pub mod configured_occurrence;
pub mod occurrence_authority;

#[derive(Clone)]
pub struct MeasurementOwners {
    access: Access,
    vault: Arc<media::AssetVault>,
    authority: Arc<dyn ReviewedOccurrenceAuthority>,
}
/// Detached real rows from the SAME native SQL snapshot. No connection, future,
/// callback, credentials or source transport escapes through these facts.
#[derive(Clone)]
pub struct MeasurementNativeFacts {
    pub scope: s::Scope,
    pub native: s::Snapshot,
    pub documents: Vec<Value>,
    pub native_receipts: Vec<Value>,
    pub document_history: Vec<Value>,
}
#[derive(Clone, Debug)]
pub struct MeasurementInventoryReport {
    pub scope: s::Scope,
    pub validated_cut_sha256: String,
    pub producer_contexts: Vec<ProducerInventoryContext>,
}
#[derive(Clone, Debug)]
pub enum ProducerInventoryContext {
    /// Schema-valid original pins ONLY. No producer content was dereferenced,
    /// no mapping/evidence/geometry/current authority was qualified by this state.
    RecordedContextUnverified {
        original_model: Value,
    },
    RequiredNativeCustodyQualified {
        original_model: Value,
    },
}
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum MeasurementPhase {
    Intake,
    Candidate,
    Precommit,
    Replay,
    Release,
}

/// Immutable borrowed reference from ONE authorized SQL read cut. Documentary
/// pins alone grant nothing: the authority must qualify THIS reference owner
/// before evaluating another retained assertion relative to it.
#[derive(Clone, Copy)]
pub struct MeasurementAssociationReference<'a> {
    target: &'a Value,
    admission: &'a Value,
}
impl<'a> MeasurementAssociationReference<'a> {
    pub(crate) fn new(target: &'a Value, admission: &'a Value) -> Self {
        Self { target, admission }
    }
}

/// Implemented by the independently reviewed native publication/mapping owner.
/// Calls are bounded/synchronous and MUST use the supplied original guard,
/// never reacquire Access/Store or mint a grant from names, hashes, nativePlaceId,
/// a documentary Resolved enum or old room-link receipt. The owner must inspect
/// exact current source/artifact selection, semantic object mapping, support and
/// acquisition evidence. Nothing in this module supplies that missing owner.
pub trait ReviewedOccurrenceAuthority: Send + Sync {
    /// Detached reference planning, not authority. All resulting closures must
    /// subsequently pass the actual original Access capture/release fences.
    fn disclosure_target_pins(&self, selector: &Value) -> s::Result<Vec<Value>>;
    /// Optional configured choices are planned individually, never merged into
    /// the required current-value disclosure closure.
    fn disclosure_choices(&self, selector: &Value) -> s::Result<Vec<Value>>;
    fn occurrence_context(
        &self,
        guard: &a::TransactionAuthorization<'_>,
        principal: &RequestPrincipal,
        selector: &Value,
        facts: &MeasurementNativeFacts,
        retained: &[Value],
        choices: &[RequestPrincipal],
    ) -> s::Result<Value>;
    fn materialize(
        &self,
        guard: &a::TransactionAuthorization<'_>,
        principal: &RequestPrincipal,
        proposal: &online::OnlineProposal,
        facts: &MeasurementNativeFacts,
        retained: &[Value],
    ) -> s::Result<MeasurementMaterial>;
    fn qualify(
        &self,
        guard: &a::TransactionAuthorization<'_>,
        principal: &RequestPrincipal,
        phase: MeasurementPhase,
        proposal: &online::OnlineProposal,
        facts: &MeasurementNativeFacts,
        material: &MeasurementMaterial,
    ) -> s::Result<()>;
    fn authorize_retained(
        &self,
        guard: &a::TransactionAuthorization<'_>,
        principal: &RequestPrincipal,
        phase: MeasurementPhase,
        facts: &MeasurementNativeFacts,
        complete_receipts: &[Value],
    ) -> s::Result<()>;
    fn authorize_disclosure(
        &self,
        guard: &a::TransactionAuthorization<'_>,
        principal: &RequestPrincipal,
        facts: &MeasurementNativeFacts,
        receipts: &[Value],
    ) -> s::Result<()>;
    fn historical_association(
        &self,
        guard: &a::TransactionAuthorization<'_>,
        principal: &RequestPrincipal,
        facts: &MeasurementNativeFacts,
        reference: MeasurementAssociationReference<'_>,
        receipt: &Value,
    ) -> s::Result<Value>;
}
/// Server-only plan. An actor/time stamp cannot be provided by decoded input or
/// guessed by a mapping authority before the actual recording transaction.
pub enum MeasurementAcquisitionPlan {
    Qualified(Value),
    UserReportedPersonalMeasurement {
        attestation: online::PersonalMeasurementAttestation,
    },
}
/// Native owner output, NOT deserializable and NOT itself authority. All fields
/// are subsequently schema/semantic checked and the owner requalifies under the
/// original fence. No client endpoint accepts these materialization fields.
pub struct MeasurementMaterial {
    pub target: Value,
    pub model: Value,
    pub target_admission: Value,
    pub acquisition: MeasurementAcquisitionPlan,
    pub support: Value,
    pub inputs: Value,
    pub evidence: Value,
    pub review: Value,
}
fn invalid() -> s::Error {
    s::Error::new(
        "upstream-unavailable",
        "Reviewed measurement authority unavailable",
    )
}
fn contract(_: c::ContractError) -> s::Error {
    invalid()
}
impl MeasurementOwners {
    pub fn new(
        access: Access,
        vault: Arc<media::AssetVault>,
        authority: Arc<dyn ReviewedOccurrenceAuthority>,
    ) -> Self {
        Self {
            access,
            vault,
            authority,
        }
    }
    pub fn belongs_to(&self, access: &Access, vault: &Arc<media::AssetVault>) -> bool {
        Arc::ptr_eq(&self.access, access) && Arc::ptr_eq(&self.vault, vault)
    }
    pub(crate) fn access(&self) -> &Access {
        &self.access
    }
    pub(crate) fn vault_for_composition(&self) -> Arc<media::AssetVault> {
        self.vault.clone()
    }
    pub(crate) fn authorize(
        &self,
        guard: &a::TransactionAuthorization<'_>,
        p: &RequestPrincipal,
        facts: &MeasurementNativeFacts,
        closure: &sem::ReferenceClosure,
        write: bool,
    ) -> s::Result<()> {
        if !std::ptr::eq(guard.principal(), p.principal.principal()) {
            return Err(invalid());
        }
        let scope = super::access_scope(&crate::domain::Scope {
            workspace_id: facts.scope.workspace_id.clone(),
            home_id: facts.scope.home_id.clone(),
        })
        .map_err(storage_access)?;
        guard
            .authorize(
                &scope,
                if write {
                    a::Capability::Mutate
                } else {
                    a::Capability::ReadHistory
                },
            )
            .map_err(storage_access)?;
        p.release_guard(guard, closure).map_err(storage_access)?;
        if write {
            guard.assert_mutation().map_err(storage_access)?;
        }
        Ok(())
    }
    pub(crate) fn materialize(
        &self,
        guard: &a::TransactionAuthorization<'_>,
        p: &RequestPrincipal,
        proposal: &online::OnlineProposal,
        facts: &MeasurementNativeFacts,
        retained: &[Value],
    ) -> s::Result<MeasurementMaterial> {
        let result = self
            .authority
            .materialize(guard, p, proposal, facts, retained)?;
        self.verify_material_rows(facts, &result)?;
        self.authority
            .qualify(guard, p, MeasurementPhase::Intake, proposal, facts, &result)?;
        Ok(result)
    }
    pub(crate) fn requalify(
        &self,
        guard: &a::TransactionAuthorization<'_>,
        p: &RequestPrincipal,
        phase: MeasurementPhase,
        proposal: &online::OnlineProposal,
        facts: &MeasurementNativeFacts,
        material: &MeasurementMaterial,
    ) -> s::Result<()> {
        self.verify_material_rows(facts, material)?;
        self.authority
            .qualify(guard, p, phase, proposal, facts, material)
    }
    pub(crate) fn retained(
        &self,
        guard: &a::TransactionAuthorization<'_>,
        p: &RequestPrincipal,
        phase: MeasurementPhase,
        facts: &MeasurementNativeFacts,
        receipts: &[Value],
    ) -> s::Result<()> {
        self.authority
            .authorize_retained(guard, p, phase, facts, receipts)
    }
    pub(crate) fn disclose(
        &self,
        guard: &a::TransactionAuthorization<'_>,
        p: &RequestPrincipal,
        facts: &MeasurementNativeFacts,
        receipts: &[Value],
    ) -> s::Result<()> {
        p.release_guard(guard, &disclosure_closure(facts, receipts, &[])?)
            .map_err(storage_access)?;
        self.authority
            .authorize_disclosure(guard, p, facts, receipts)
    }
    pub(crate) fn target_pins(&self, selector: &Value) -> s::Result<Vec<Value>> {
        self.authority.disclosure_target_pins(selector)
    }
    pub(crate) fn optional_choice_closures(
        &self,
        selector: &Value,
        facts: &MeasurementNativeFacts,
        receipts: &[Value],
    ) -> s::Result<Vec<sem::ReferenceClosure>> {
        let mut closures = Vec::new();
        for choice in self.authority.disclosure_choices(selector)? {
            let assertion_inputs = choice["inputs"].as_array().is_some_and(|inputs| {
                inputs
                    .iter()
                    .any(|input| input["expectation"]["kind"] == "assertion")
            });
            let dependencies = if assertion_inputs { receipts } else { &[] };
            // Invalid optional dependencies cannot become required disclosure.
            if let Ok(closure) = disclosure_closure(facts, dependencies, &[choice])
                && !closures.contains(&closure)
            {
                closures.push(closure);
            }
        }
        Ok(closures)
    }
    pub(crate) fn association(
        &self,
        guard: &a::TransactionAuthorization<'_>,
        p: &RequestPrincipal,
        f: &MeasurementNativeFacts,
        reference: MeasurementAssociationReference<'_>,
        r: &Value,
    ) -> s::Result<Value> {
        self.authority
            .historical_association(guard, p, f, reference, r)
    }
    pub(crate) fn context(
        &self,
        guard: &a::TransactionAuthorization<'_>,
        p: &RequestPrincipal,
        selector: &Value,
        facts: &MeasurementNativeFacts,
        receipts: &[Value],
        choices: &[RequestPrincipal],
    ) -> s::Result<Value> {
        self.authority
            .occurrence_context(guard, p, selector, facts, receipts, choices)
    }
    fn verify_material_rows(
        &self,
        facts: &MeasurementNativeFacts,
        material: &MeasurementMaterial,
    ) -> s::Result<()> {
        wire::validate_value("targetAdmission", &material.target_admission).map_err(contract)?;
        wire::validate_value("semanticTarget", &material.target).map_err(contract)?;
        wire::validate_value("modelPin", &material.model).map_err(contract)?;
        let actual = |pin: &Value, kind: s::RecordType| -> s::Result<&s::Record> {
            let id = pin["record"]["recordId"].as_str().ok_or_else(invalid)?;
            let row = facts
                .native
                .records
                .iter()
                .find(|r| {
                    r.workspace_id == facts.scope.workspace_id
                        && r.home_id == facts.scope.home_id
                        && r.record_type == kind
                        && r.record_id == id
                })
                .ok_or_else(invalid)?;
            if row.lifecycle != s::Lifecycle::Active
                || row.revision != wire::integer(&pin["revision"]).map_err(contract)?
                || wire::digest(&row.payload).map_err(contract)? != pin["payloadSha256"]
            {
                return Err(invalid());
            }
            Ok(row)
        };
        let identity = actual(
            &material.target_admission["roomIdentity"],
            s::RecordType::Identity,
        )?;
        let semantics = actual(
            &material.target_admission["roomSemantics"],
            s::RecordType::LocationSemantics,
        )?;
        actual(
            &material.target_admission["mappingReview"],
            s::RecordType::Evidence,
        )?;
        if identity.payload["kind"] != "location"
            || semantics.payload["atlasId"] != identity.record_id
            || semantics.payload["semanticKind"] != "room"
            || semantics.payload["reviewStatus"] != "accepted"
            || material.target["scope"]
                != json!({"workspaceId":facts.scope.workspace_id,"homeId":facts.scope.home_id})
        {
            return Err(invalid());
        }
        // The actual payload checks above establish native room facts only.
        // The independent owner MUST additionally qualify the exact occurrence
        // mapping and current publication custody; UUID/hash equality is no fit.
        Ok(())
    }
}

/// Conservatively captures every native source reference in this complete home
/// cut, so later reverse-conflict history cannot evade current source grants.
/// An inaccessible source refuses completeness; it is not silently filtered.
pub(crate) fn source_closure(facts: &MeasurementNativeFacts) -> s::Result<sem::ReferenceClosure> {
    let mut refs = Vec::new();
    let mut partitions = Vec::new();
    let mut records = Vec::new();
    let mut historical = Vec::new();
    for receipt in &facts.native_receipts {
        historical.push(serde_json::from_value::<s::Record>(
            receipt["record"].clone(),
        )?);
    }
    for record in facts.native.records.iter().chain(&historical) {
        records.push(serde_json::from_value(serde_json::to_value(
            record.reference(),
        )?)?);
        let mut sources = Vec::new();
        if record.record_type == s::RecordType::Binding {
            sources.push(json!({"workspaceId":record.workspace_id,"homeId":record.home_id,"key":record.payload["source"]}));
        }
        if record.record_type == s::RecordType::Evidence
            && !record.payload["provenance"]["source"].is_null()
        {
            sources.push(record.payload["provenance"]["source"].clone());
        }
        if let Some(attachments) = record.payload["references"].as_array() {
            for item in attachments {
                if item["kind"] == "homebox-attachment" {
                    sources.push(item["entity"].clone());
                }
            }
        }
        if let Some(mappings) = record.payload["mappings"].as_array() {
            for mapping in mappings {
                if !mapping["homeboxEntity"].is_null() {
                    sources.push(mapping["homeboxEntity"].clone());
                }
            }
        }
        for source in sources {
            let source: c::SourceRef =
                c::decode(&serde_json::to_vec(&source)?).map_err(contract)?;
            let value = serde_json::to_value(&source)?;
            let partition = sem::SourcePartition {
                workspace_id: facts.scope.workspace_id.clone(),
                home_id: facts.scope.home_id.clone(),
                source_instance_id: value["key"]["sourceInstanceId"]
                    .as_str()
                    .ok_or_else(invalid)?
                    .into(),
                collection_id: value["key"]["collectionId"]
                    .as_str()
                    .ok_or_else(invalid)?
                    .into(),
            };
            if !refs.contains(&source) {
                refs.push(source);
            }
            if !partitions.contains(&partition) {
                partitions.push(partition);
            }
        }
    }
    Ok(sem::ReferenceClosure {
        record_refs: records,
        missing_record_refs: vec![],
        source_refs: refs,
        source_partitions: partitions,
    })
}

/// Source-grant planning for the exact retained disclosures, not the whole home.
/// Actual native source handles MUST still be captured and revalidated. Include
/// all retained versions of each referenced native record, conservatively; no
/// historical payload or SourceRef is reconstructed from labels or digests.
pub(crate) fn disclosure_closure(
    f: &MeasurementNativeFacts,
    receipts: &[Value],
    extra_pins: &[Value],
) -> s::Result<sem::ReferenceClosure> {
    fn refs(v: &Value, out: &mut Vec<Value>) {
        match v {
            Value::Array(a) => {
                for v in a {
                    refs(v, out)
                }
            }
            Value::Object(o) => {
                if let Some(r) = o.get("record")
                    && r.get("recordType").is_some()
                    && r.get("recordId").is_some()
                    && !out.contains(r)
                {
                    out.push(r.clone());
                }
                for v in o.values() {
                    refs(v, out);
                }
            }
            _ => {}
        }
    }
    let mut wanted = Vec::new();
    for r in receipts.iter().chain(extra_pins) {
        refs(r, &mut wanted);
    }
    let mut selected = f.clone();
    let mut records = Vec::new();
    for r in &selected.native.records {
        if wanted.contains(&serde_json::to_value(r.reference())?) {
            records.push(r.clone());
        }
    }
    selected.native.records = records;
    selected.native_receipts.retain(|r| {
        wanted.contains(
            &json!({"recordType":r["record"]["recordType"],"recordId":r["record"]["recordId"]}),
        )
    });
    source_closure(&selected)
}
