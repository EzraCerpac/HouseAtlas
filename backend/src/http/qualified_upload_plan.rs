//! Root planning retains the original selection and genuinely sealed upload.
use super::{HttpFailure, upload_intake::UploadMetadata};
use crate::{
    access,
    app::{Core, Reads, RequestPrincipal},
    contracts,
    domain::{
        self as d,
        stock::{self as st, OperationId as O},
    },
    http::contracts::NativeContracts,
    media::staged_upload::StagedAssetPlan,
    storage as s,
};
use s::Contract;
use serde_json::{Value, json};
use std::collections::{BTreeMap, BTreeSet};

/// Privately resolved current data, borrowing the exact original selection.
/// This is neither upload authorization nor a persisted consumption carrier.
pub struct ResolvedPlace<'p, 'm> {
    principal: &'p RequestPrincipal,
    metadata: &'m UploadMetadata,
    semantics: d::Record,
    identity: d::Record,
    proof: PlaceProof,
    guards: Vec<s::Guard>,
}

/// Explicit selection provenance; native admission never rescues a failed
/// binding/projection resolution. Both constructors retain real native records.
enum PlaceProof {
    SourceBacked {
        binding: Box<d::Record>,
        source: d::SourceRef,
    },
    Native,
}

fn unavailable() -> st::StockError {
    st::StockError::OwnerUnavailable
}
fn invalid() -> st::StockError {
    st::StockError::InvalidContract
}
fn held() -> st::StockError {
    st::StockError::CapabilityHeld
}
fn changed() -> st::StockError {
    st::StockError::AuthorityChanged
}
fn value<T: serde::Serialize>(input: &T) -> st::StockResult<Value> {
    serde_json::to_value(input).map_err(|_| unavailable())
}
fn validate<T: contracts::Contract>(input: &impl serde::Serialize) -> st::StockResult<()> {
    contracts::decode::<T>(&serde_json::to_vec(input).map_err(|_| unavailable())?)
        .map(|_| ())
        .map_err(|_| invalid())
}
fn http(error: HttpFailure) -> st::StockError {
    match error.status.as_u16() {
        401 | 403 => changed(),
        404 => st::StockError::Domain(d::DomainError::NotFound),
        _ => unavailable(),
    }
}
fn read_scope(
    core: &Core,
    principal: &RequestPrincipal,
    home: &d::HomeSummary,
) -> st::StockResult<()> {
    if !core.homes.iter().any(|configured| configured == home)
        || principal.principal.scope().workspace_id.as_str() != home.scope.workspace_id
        || principal.principal.scope().home_id.as_str() != home.scope.home_id
    {
        return Err(changed());
    }
    let scope = crate::app::access_scope(&home.scope).map_err(|_| invalid())?;
    let access = core.access.lock().map_err(|_| unavailable())?;
    principal.release(&access).map_err(|_| changed())?;
    access
        .authorize_storage(
            principal.principal.principal(),
            &scope,
            access::Capability::Read,
        )
        .map_err(|_| changed())?;
    Ok(())
}
fn one_record<'a>(
    snapshot: &'a d::Snapshot,
    scope: &d::Scope,
    kind: d::RecordType,
    id: &str,
) -> st::StockResult<&'a d::Record> {
    let mut matching = snapshot.records.iter().filter(|record| {
        record.scope == *scope
            && record.lifecycle == d::Lifecycle::Active
            && record.target.record_type == kind
            && record.target.record_id == id
    });
    let record = matching
        .next()
        .ok_or(st::StockError::Domain(d::DomainError::NotFound))?;
    if matching.next().is_some() {
        return Err(unavailable());
    }
    Ok(record)
}

/// Reuse actual qualified admission through the same original read principal.
/// Call before entering a mutation fence; these read adapters acquire Access.
pub fn read_admission(
    core: &mut Core,
    principal: &RequestPrincipal,
    home: &d::HomeSummary,
    source: &d::SourceRef,
) -> st::StockResult<Value> {
    read_scope(core, principal, home)?;
    validate::<contracts::SourceRef>(source)?;
    if source.scope != home.scope {
        return Err(changed());
    }
    let admission = super::editing::admission(core, principal, home, source).map_err(http)?;
    read_scope(core, principal, home)?;
    Ok(admission)
}

/// Resolve the selected canonical PLACE using real Store/view/admission data.
/// Caller supplies already parsed metadata. No lock or grant spans async intake.
pub fn resolve<'p, 'm>(
    core: &mut Core,
    principal: &'p RequestPrincipal,
    home: &d::HomeSummary,
    metadata: &'m UploadMetadata,
) -> st::StockResult<ResolvedPlace<'p, 'm>> {
    read_scope(core, principal, home)?;
    validate::<contracts::Scope>(&metadata.context)?;
    if metadata.context.workspace_id != home.scope.workspace_id
        || metadata.context.home_id != home.scope.home_id
        || metadata.guards.len() > 100
    {
        return Err(invalid());
    }
    let snapshot = d::ReadPort::snapshot(
        &mut Reads(&mut *core.store.lock().map_err(|_| unavailable())?),
        principal,
        &home.scope,
    )
    .map_err(st::StockError::Domain)?;
    let semantics = one_record(
        &snapshot,
        &home.scope,
        d::RecordType::LocationSemantics,
        &metadata.record_id,
    )?;
    validate::<contracts::LocationSemanticsRecord>(semantics)?;
    if semantics.revision != metadata.expected_revision {
        return Err(st::StockError::Domain(d::DomainError::RevisionConflict {
            current_revision: Some(semantics.revision),
        }));
    }
    if semantics.payload["reviewStatus"] != "accepted" {
        return Err(held());
    }
    let identity_id = semantics.payload["atlasId"]
        .as_str()
        .ok_or_else(unavailable)?;
    let identity = one_record(&snapshot, &home.scope, d::RecordType::Identity, identity_id)?;
    validate::<contracts::IdentityRecord>(identity)?;
    if identity.payload["kind"] != "location" {
        return Err(held());
    }
    let mut targets = BTreeSet::new();
    let mut identity_guard = false;
    let mut selected_binding = None;
    for guard in &metadata.guards {
        validate::<contracts::Guard>(guard)?;
        if !targets.insert((
            guard.record.record_type.as_str(),
            guard.record.record_id.as_str(),
        )) {
            return Err(invalid());
        }
        let kind: d::RecordType =
            serde_json::from_value(value(&guard.record.record_type)?).map_err(|_| invalid())?;
        let record = one_record(&snapshot, &home.scope, kind, &guard.record.record_id)?;
        if record.revision != guard.expected_revision {
            return Err(st::StockError::Domain(d::DomainError::GuardConflict {
                current_revision: Some(record.revision),
            }));
        }
        if kind == d::RecordType::Identity && record.target.record_id == identity_id {
            identity_guard = true;
        }
        if kind == d::RecordType::Binding {
            validate::<contracts::BindingRecord>(record)?;
            let payload: d::BindingPayload =
                serde_json::from_value(record.payload.clone()).map_err(|_| unavailable())?;
            if payload.atlas_id == identity_id
                && payload.review_status == d::ReviewStatus::Accepted
                && payload.source_state != d::BindingSourceState::AccessRevoked
            {
                if selected_binding.is_some() {
                    return Err(held());
                }
                selected_binding = Some((record, payload));
            }
        }
    }
    if !identity_guard {
        return Err(held());
    }
    let (binding, payload) = selected_binding.ok_or_else(held)?;
    let source = d::SourceRef {
        scope: home.scope.clone(),
        key: payload.source,
    };
    validate::<contracts::SourceRef>(&source)?;
    let view = super::query_view(core, principal, home).map_err(http)?;
    if view.scope != home.scope
        || view
            .entries
            .iter()
            .filter(|entry| {
                entry.scope == home.scope
                    && entry.kind == d::EntryKind::Place
                    && entry.key == source
                    && entry.binding_id.as_deref() == Some(binding.target.record_id.as_str())
                    && entry.atlas_id.as_deref() == Some(identity_id)
            })
            .count()
            != 1
    {
        return Err(held());
    }
    let admission = read_admission(core, principal, home, &source)?;
    if admission["record"] != value(semantics)? || admission["guards"] != value(&metadata.guards)? {
        return Err(changed());
    }
    let selected_guard = s::Guard {
        record: s::RecordRef {
            record_type: s::RecordType::LocationSemantics,
            record_id: metadata.record_id.clone(),
        },
        expected_revision: metadata.expected_revision,
    };
    let mut guards = metadata.guards.clone();
    if let Some(original) = guards
        .iter()
        .find(|guard| guard.record == selected_guard.record)
    {
        if original != &selected_guard {
            return Err(changed());
        }
    } else {
        guards.push(selected_guard);
    }
    if guards.len() > 100 {
        return Err(invalid());
    }
    read_scope(core, principal, home)?;
    Ok(ResolvedPlace {
        principal,
        metadata,
        semantics: semantics.clone(),
        identity: identity.clone(),
        proof: PlaceProof::SourceBacked {
            binding: Box::new(binding.clone()),
            source,
        },
        guards,
    })
}

/// Snapshot-derived native-only admission data, never mutation authority.
struct NativePlace {
    semantics: d::Record,
    identity: d::Record,
    guards: Vec<s::Guard>,
}

fn native_place(
    core: &mut Core,
    principal: &RequestPrincipal,
    home: &d::HomeSummary,
    record_id: &str,
) -> st::StockResult<NativePlace> {
    read_scope(core, principal, home)?;
    let snapshot = d::ReadPort::snapshot(
        &mut Reads(&mut *core.store.lock().map_err(|_| unavailable())?),
        principal,
        &home.scope,
    )
    .map_err(st::StockError::Domain)?;
    let semantics = one_record(
        &snapshot,
        &home.scope,
        d::RecordType::LocationSemantics,
        record_id,
    )?;
    validate::<contracts::LocationSemanticsRecord>(semantics)?;
    if semantics.payload["reviewStatus"] != "accepted" {
        return Err(held());
    }
    let identity_id = semantics.payload["atlasId"]
        .as_str()
        .ok_or_else(unavailable)?;
    let identity = one_record(&snapshot, &home.scope, d::RecordType::Identity, identity_id)?;
    validate::<contracts::IdentityRecord>(identity)?;
    if identity.payload["kind"] != "location"
        || snapshot
            .records
            .iter()
            .filter(|record| {
                record.scope == home.scope
                    && record.lifecycle == d::Lifecycle::Active
                    && record.target.record_type == d::RecordType::LocationSemantics
                    && record.payload["atlasId"].as_str() == Some(identity_id)
                    && record.payload["reviewStatus"] == "accepted"
            })
            .count()
            != 1
        || snapshot.records.iter().any(|record| {
            record.scope == home.scope
                && record.lifecycle == d::Lifecycle::Active
                && record.target.record_type == d::RecordType::Binding
                && record.payload["atlasId"].as_str() == Some(identity_id)
        })
    {
        return Err(held());
    }
    // Complete original identity/evidence guards in the same deterministic
    // record-type/record-id order as source admission. The selected semantics
    // revision is supplied separately and is added to the executed root below.
    let mut guards = BTreeMap::new();
    guards.insert(
        ("identity", identity_id.to_owned()),
        s::Guard {
            record: s::RecordRef {
                record_type: s::RecordType::Identity,
                record_id: identity_id.to_owned(),
            },
            expected_revision: identity.revision,
        },
    );
    for owner in [semantics, identity] {
        for id in owner.payload["evidenceIds"]
            .as_array()
            .ok_or_else(unavailable)?
        {
            let id = id.as_str().ok_or_else(unavailable)?;
            let evidence = one_record(&snapshot, &home.scope, d::RecordType::Evidence, id)?;
            validate::<contracts::EvidenceRecord>(evidence)?;
            guards.insert(
                ("evidence", id.to_owned()),
                s::Guard {
                    record: s::RecordRef {
                        record_type: s::RecordType::Evidence,
                        record_id: id.to_owned(),
                    },
                    expected_revision: evidence.revision,
                },
            );
        }
    }
    let guards: Vec<_> = guards.into_values().collect();
    // Reserve one root guard slot for the original selected semantics record.
    if guards.len() >= 100 {
        return Err(held());
    }
    for guard in &guards {
        validate::<contracts::Guard>(guard)?;
    }
    read_scope(core, principal, home)?;
    Ok(NativePlace {
        semantics: semantics.clone(),
        identity: identity.clone(),
        guards,
    })
}

/// A new explicit native-only read namespace. It discloses real owner records
/// and current role-derived affordance data; the POST still obtains real AT11
/// mutation authority and Media's original principal allocation.
pub(super) fn native_admission(
    core: &mut Core,
    principal: &RequestPrincipal,
    home: &d::HomeSummary,
    record_id: &str,
) -> st::StockResult<Value> {
    let place = native_place(core, principal, home, record_id)?;
    let editor = principal.principal.role() == access::Role::Editor;
    let mut result = json!({
        "schemaVersion":1,"admissionKind":"native-location","scope":home.scope,
        "record":place.semantics,"identity":place.identity,"guards":place.guards,
        "canAttachEvidence":editor,"maximumReasonCodePoints":1024
    });
    if editor {
        result["attachmentPolicy"] = super::upload::policy();
    }
    read_scope(core, principal, home)?;
    Ok(result)
}

/// Only the explicit native POST calls this constructor. It neither accepts a
/// caller source/binding nor falls back from the source-backed resolver above.
pub(super) fn resolve_native<'p, 'm>(
    core: &mut Core,
    principal: &'p RequestPrincipal,
    home: &d::HomeSummary,
    metadata: &'m UploadMetadata,
) -> st::StockResult<ResolvedPlace<'p, 'm>> {
    read_scope(core, principal, home)?;
    validate::<contracts::Scope>(&metadata.context)?;
    if metadata.context.workspace_id != home.scope.workspace_id
        || metadata.context.home_id != home.scope.home_id
        || metadata.guards.len() > 100
    {
        return Err(invalid());
    }
    let place = native_place(core, principal, home, &metadata.record_id)?;
    if place.semantics.revision != metadata.expected_revision {
        return Err(st::StockError::Domain(d::DomainError::RevisionConflict {
            current_revision: Some(place.semantics.revision),
        }));
    }
    if value(&metadata.guards)? != value(&place.guards)? {
        return Err(changed());
    }
    let mut guards = place.guards;
    guards.push(s::Guard {
        record: s::RecordRef {
            record_type: s::RecordType::LocationSemantics,
            record_id: metadata.record_id.clone(),
        },
        expected_revision: metadata.expected_revision,
    });
    read_scope(core, principal, home)?;
    Ok(ResolvedPlace {
        principal,
        metadata,
        semantics: place.semantics,
        identity: place.identity,
        proof: PlaceProof::Native,
        guards,
    })
}

impl ResolvedPlace<'_, '_> {
    pub fn metadata(&self) -> &UploadMetadata {
        self.metadata
    }
    pub fn semantics(&self) -> &d::Record {
        &self.semantics
    }
    pub fn identity(&self) -> &d::Record {
        &self.identity
    }
    /// Native selection has no source binding; no synthetic value is supplied.
    pub fn binding(&self) -> Option<&d::Record> {
        match &self.proof {
            PlaceProof::SourceBacked { binding, .. } => Some(binding),
            PlaceProof::Native => None,
        }
    }
    pub fn source(&self) -> Option<&d::SourceRef> {
        match &self.proof {
            PlaceProof::SourceBacked { source, .. } => Some(source),
            PlaceProof::Native => None,
        }
    }
    pub fn guards(&self) -> &[s::Guard] {
        &self.guards
    }
    /// Preserve the complete original payload and existing evidence order.
    pub fn identity_payload_with_evidence(&self, evidence_id: &str) -> st::StockResult<Value> {
        NativeContracts
            .validate_shape(
                "recordRef",
                &json!({"recordType":"evidence","recordId":evidence_id}),
            )
            .map_err(|_| invalid())?;
        let mut payload = self.identity.payload.clone();
        let ids = payload["evidenceIds"]
            .as_array_mut()
            .ok_or_else(unavailable)?;
        if ids.iter().any(|id| id.as_str() == Some(evidence_id)) {
            return Err(invalid());
        }
        ids.push(json!(evidence_id));
        validate::<contracts::RecordValue>(&json!({"recordType":"identity","payload":payload}))?;
        Ok(payload)
    }
    pub fn stock_guards(&self) -> Value {
        json!(self.guards.iter().map(|guard| json!({
            "target":{"authority":"atlas","recordType":guard.record.record_type,"recordId":guard.record.record_id},
            "revision":{"kind":"atlas","value":guard.expected_revision}
        })).collect::<Vec<_>>())
    }
    /// A schema-checked replacement intent, never an executed mutation.
    pub fn identity_request(
        &self,
        request_id: &str,
        key: &str,
        evidence_id: &str,
    ) -> st::StockResult<st::ValidatedRequest> {
        st::ValidatedRequest::parse(
            &st::NativeStockContract::new()?,
            json!({
                "schemaVersion":3,"commandId":"atlas.identity.replace","requestId":request_id,
                "context":self.metadata.context,"target":{"authority":"atlas","recordType":"identity","recordId":self.identity.target.record_id},
                "payload":self.identity_payload_with_evidence(evidence_id)?,"idempotencyKey":key,"reason":self.metadata.reason,
                "preconditions":{"target":{"kind":"atlas","value":self.identity.revision},"guards":self.stock_guards()},
                "approvalReceiptId":null
            }),
        )
    }
}

/// Retain the owner's borrowed seal and the original AT11 allocation.
/// This produces plan data, never authorization or a consumed-upload proof.
/// Requires the privately resolved original selection and its complete guards.
pub fn qualify<'u>(
    principal: &RequestPrincipal,
    selection: &ResolvedPlace<'_, '_>,
    root: &st::ValidatedRequest,
    staged: &'u StagedAssetPlan,
) -> st::StockResult<st::StagedAtlasCommandPlan<'u>> {
    if !std::ptr::eq(principal, selection.principal)
        || !std::ptr::eq(
            principal.principal.principal(),
            staged.original_principal().principal(),
        )
        || principal.principal.scope().workspace_id.as_str() != root.context().workspace_id
        || principal.principal.scope().home_id.as_str() != root.context().home_id
    {
        return Err(st::StockError::AuthorityChanged);
    }
    let children = root.children();
    if root.id() != O::AtlasBatchExecute
        || children.len() != 3
        || children[0].id() != O::AtlasAssetCreate
        || children[1].id() != O::AtlasEvidenceCreate
        || children[2].id() != O::AtlasIdentityReplace
    {
        return Err(st::StockError::CapabilityHeld);
    }
    let evidence_id = children[1].target()["recordId"]
        .as_str()
        .ok_or_else(invalid)?;
    if root.raw()["requestId"] != selection.metadata.request_id
        || root.raw()["idempotencyKey"] != selection.metadata.idempotency_key
        || root.raw()["reason"] != selection.metadata.reason
        || children
            .iter()
            .any(|child| child.raw()["reason"] != selection.metadata.reason)
        || root.raw()["preconditions"]["guards"] != selection.stock_guards()
        || children[2].raw()["preconditions"]["guards"] != selection.stock_guards()
        || staged.payload().purpose != crate::media::types::AssetPurpose::EvidenceOriginal
        || staged.payload().source_license != selection.metadata.source_license
        || staged.staged().filename != selection.metadata.filename
        || staged.staged().content_type != selection.metadata.content_type
        || children[1].payload()["statement"] != selection.metadata.statement
        || children[1].payload()["provenance"]["vantage"]
            != json!(
                selection
                    .metadata
                    .capture
                    .as_ref()
                    .map(|capture| capture.vantage())
            )
        || children[2].target()["recordId"] != selection.identity.target.record_id
        || children[2].payload() != &selection.identity_payload_with_evidence(evidence_id)?
        || children[2].raw()["preconditions"]["target"]
            != json!({"kind":"atlas","value":selection.identity.revision})
    {
        return Err(changed());
    }
    st::plan_staged_atlas_commands(root, staged, &NativeContracts)
}

/// Bind the actual resolved original revision without changing original guards.
pub fn existing_stock_guards(
    selection: &ResolvedPlace<'_, '_>,
    asset: &s::ExistingOriginalAsset,
) -> st::StockResult<Value> {
    let mut guards = selection.stock_guards();
    let rows = guards.as_array_mut().ok_or_else(unavailable)?;
    let target = json!({"authority":"atlas","recordType":"asset","recordId":asset.asset_id()});
    if rows.iter().any(|guard| guard["target"] == target) || rows.len() >= 100 {
        return Err(changed());
    }
    rows.push(json!({"target":target,"revision":{"kind":"atlas","value":asset.record().revision}}));
    Ok(guards)
}

/// The same original selection/principal qualifies a newly measured attachment.
pub fn qualify_existing<'u>(
    principal: &RequestPrincipal,
    selection: &ResolvedPlace<'_, '_>,
    root: &st::ValidatedRequest,
    asset: &'u s::ExistingOriginalAsset,
    measured: &'u crate::domain::stock::MeasuredAttachmentOriginal,
) -> st::StockResult<st::ExistingAssetAttachmentPlan<'u>> {
    let children = root.children();
    if !std::ptr::eq(principal, selection.principal)
        || principal.principal.scope().workspace_id.as_str() != root.context().workspace_id
        || principal.principal.scope().home_id.as_str() != root.context().home_id
        || root.id() != O::AtlasBatchExecute
        || children.len() != 2
        || children[0].id() != O::AtlasEvidenceCreate
        || children[1].id() != O::AtlasIdentityReplace
    {
        return Err(changed());
    }
    let guards = existing_stock_guards(selection, asset)?;
    let evidence_id = children[0].target()["recordId"]
        .as_str()
        .ok_or_else(invalid)?;
    if root.raw()["requestId"] != selection.metadata.request_id
        || root.raw()["idempotencyKey"] != selection.metadata.idempotency_key
        || root.raw()["reason"] != selection.metadata.reason
        || root.raw()["preconditions"]["guards"] != guards
        || children.iter().any(|child| {
            child.raw()["reason"] != selection.metadata.reason
                || child.raw()["context"] != root.raw()["context"]
                || child.raw()["preconditions"]["guards"] != guards
        })
        || children[0].payload()["statement"] != selection.metadata.statement
        || children[0].payload()["provenance"]["vantage"]
            != json!(
                selection
                    .metadata
                    .capture
                    .as_ref()
                    .map(|capture| capture.vantage())
            )
        || children[1].target()["recordId"] != selection.identity.target.record_id
        || children[1].payload() != &selection.identity_payload_with_evidence(evidence_id)?
        || children[1].raw()["preconditions"]["target"]
            != json!({"kind":"atlas","value":selection.identity.revision})
        || measured.prepared().purpose != crate::media::types::AssetPurpose::EvidenceOriginal
        || measured.prepared().content_type.as_str() != selection.metadata.content_type
    {
        return Err(changed());
    }
    st::plan_existing_asset_attachment(
        principal.principal.principal(),
        root,
        asset,
        measured,
        &NativeContracts,
    )
}
