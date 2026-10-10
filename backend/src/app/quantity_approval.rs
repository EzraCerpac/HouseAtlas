//! Explicit human consent and same-original quantity approval custody.
//! Reserved identifiers and serialized receipts never construct this authority.
use super::{
    homebox_quantity_graph::OriginalQuantityPreparation,
    homebox_quantity_startup::OriginalQuantityPhysical,
};
use crate::{
    access,
    providers::homebox::{read, write::stock as native},
    storage::{self, StockActivityPrincipal},
};
use serde::Deserialize;
use std::{
    sync::{Arc, Mutex},
    time::Instant,
};
use uuid::Uuid;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct QuantityApprovalRequest {
    preview_id: Uuid,
    request_digest: native::Digest,
    plan_digest: native::Digest,
    policy_id: String,
    policy_version: String,
    policy_epoch: u64,
    acknowledgement: bool,
}
fn plan_digest(plan: &native::NativePlan) -> storage::Result<native::Digest> {
    let value = serde_json::to_value(plan).map_err(|_| unavailable())?;
    let digest =
        crate::contracts::semantics::canonical_digest(&value).map_err(|_| unavailable())?;
    native::Digest::parse(digest).map_err(|_| unavailable())
}
fn denied() -> storage::Error {
    storage::Error::new("forbidden", "Exact original human consent required")
}
fn unavailable() -> storage::Error {
    storage::Error::new(
        "owner-unavailable",
        "Original quantity approval unavailable",
    )
}

/// Issued only inside the authenticated approval POST's actual mutation fence.
/// This is consent custody; the subsequent original phase still qualifies the
/// real native preparation and physical Store before issuing approval.
pub(crate) struct AuthenticatedQuantityConsent<'b, 'n, 'p, 'o, T, K>
where
    T: read::Transport,
    K: read::Clock + Send + Sync,
{
    preparation: &'b OriginalQuantityPreparation<'n, 'p, 'o, T, K>,
    preview_id: Uuid,
    receipt_id: Uuid,
    plan_digest: native::Digest,
    evidence_digest: native::Digest,
    created_at: Instant,
}
impl<'b, 'n, 'p, 'o, T: read::Transport, K: read::Clock + Send + Sync>
    AuthenticatedQuantityConsent<'b, 'n, 'p, 'o, T, K>
{
    pub(crate) fn from_authenticated_post(
        preparation: &'b OriginalQuantityPreparation<'n, 'p, 'o, T, K>,
        selected_preview: Uuid,
        request: QuantityApprovalRequest,
        current_guard: &access::TransactionAuthorization<'_>,
    ) -> storage::Result<Self> {
        let configured = preparation.configured();
        let command = preparation.native().command();
        let original = preparation.original();
        let policy = configured.reviewed_policy();
        let plan_digest = plan_digest(preparation.native().plan()).map_err(|_| unavailable())?;
        let receipt_id = command.approval_receipt_id.ok_or_else(denied)?;
        let expected_version = policy
            .get("policyVersion")
            .and_then(serde_json::Value::as_u64)
            .ok_or_else(denied)?
            .to_string();
        if !request.acknowledgement
            || selected_preview.is_nil()
            || request.preview_id != selected_preview
            || receipt_id.is_nil()
            || request.request_digest != command.request_digest
            || request.plan_digest != plan_digest
            || !matches!(
                configured.descriptor().policy,
                native::QuantityPolicy::HumanRequired
            )
            || policy
                .get("approvalRequirement")
                .and_then(serde_json::Value::as_str)
                != Some("human-required")
            || policy.get("policyId").and_then(serde_json::Value::as_str)
                != Some(request.policy_id.as_str())
            || request.policy_version != expected_version
            || policy
                .get("policyEpoch")
                .and_then(serde_json::Value::as_u64)
                != Some(request.policy_epoch)
        {
            return Err(denied());
        }
        current_guard.assert_mutation().map_err(|_| denied())?;
        // Existing grant checks compare private instance/session token/origin,
        // membership and issuance action. Actor/scope DTO equality is insufficient.
        current_guard
            .revalidate_source(original.original_activity_source())
            .map_err(|_| denied())?;
        current_guard
            .revalidate_source_partition(original.original_activity_partition())
            .map_err(|_| denied())?;
        if current_guard
            .persisted_source_metadata(original.original_activity_partition())
            .map_err(|_| denied())?
            != *configured.metadata()
        {
            return Err(denied());
        }
        let digest = crate::contracts::semantics::canonical_digest(&serde_json::json!({
            "kind":"atlas-original-quantity-human-consent/1", "previewId":selected_preview,
            "receiptId":receipt_id,"request":command.original_wire,"requestDigest":command.request_digest,
            "plan":preparation.native().plan(),"planDigest":plan_digest,"policy":policy,
            "policyDigest":configured.descriptor().policy_digest,"actorId":current_guard.principal().actor_id().as_str(),
            "sourceRegistration":configured.metadata().registration(),"sourceRegistrationVersion":configured.metadata().source_registration_version(),
            "sourceRegistrationDigest":configured.metadata().source_registration_sha256(),"accessEpoch":configured.metadata().access_epoch(),
            "physicalBinding":{"deploymentId":configured.physical().physical_binding.deployment_id,
                "physicalDatabaseId":configured.physical().physical_binding.physical_database_id,
                "configurationDigest":configured.physical().physical_binding.configuration_digest},"dispatcherOwnerId":configured.physical().owner_id,
            "dispatcherEpoch":configured.physical().dispatcher_epoch,"acknowledgement":true
        })).map_err(|_| unavailable())?;
        Ok(Self {
            preparation,
            preview_id: selected_preview,
            receipt_id,
            plan_digest,
            evidence_digest: native::Digest::parse(digest).map_err(|_| unavailable())?,
            created_at: Instant::now(),
        })
    }
}

/// Genuine server-held approval. No Clone, serde, public data constructor or
/// adoption of a receipt ID. One original operation can claim it; failed output
/// or admission does not create rollback/retry authority.
pub struct HumanQuantityApproval<'b, 'n, 'p, 'o, T, K>
where
    T: read::Transport,
    K: read::Clock + Send + Sync,
{
    consent: AuthenticatedQuantityConsent<'b, 'n, 'p, 'o, T, K>,
    claimed_operation: Mutex<Option<Uuid>>,
}
impl<'b, 'n, 'p, 'o, T: read::Transport, K: read::Clock + Send + Sync>
    HumanQuantityApproval<'b, 'n, 'p, 'o, T, K>
{
    pub(crate) fn issue_in_original_phase<'phase>(
        consent: AuthenticatedQuantityConsent<'b, 'n, 'p, 'o, T, K>,
        original_guard: &'phase access::TransactionAuthorization<'_>,
        physical: &'phase OriginalQuantityPhysical<'phase, 'p>,
    ) -> storage::Result<Self>
    where
        'n: 'phase,
    {
        consent
            .preparation
            .revalidate_original_phase(original_guard, physical)
            .map_err(|_| unavailable())?;
        if consent.created_at.elapsed() > consent.preparation.configured().descriptor().freshness {
            return Err(unavailable());
        }
        Ok(Self {
            consent,
            claimed_operation: Mutex::new(None),
        })
    }
    pub fn receipt_id(&self) -> Uuid {
        self.consent.receipt_id
    }
    pub fn evidence_digest(&self) -> &native::Digest {
        &self.consent.evidence_digest
    }
    pub fn preview_id(&self) -> Uuid {
        self.consent.preview_id
    }
    pub(crate) fn matches_original(
        &self,
        preparation: &OriginalQuantityPreparation<'n, 'p, 'o, T, K>,
    ) -> bool {
        std::ptr::eq(preparation, self.consent.preparation)
            && Arc::ptr_eq(
                preparation.configured(),
                self.consent.preparation.configured(),
            )
            && preparation.native().command().approval_receipt_id == Some(self.receipt_id())
    }
    pub(crate) fn revalidate_admitted(
        &self,
        preparation: &OriginalQuantityPreparation<'n, 'p, 'o, T, K>,
        operation: &native::StoredOperation,
        guard: &access::TransactionAuthorization<'_>,
    ) -> storage::Result<()> {
        self.check_original(preparation, operation, guard)?;
        let claimed = self
            .claimed_operation
            .try_lock()
            .map_err(|_| unavailable())?;
        if *claimed != Some(operation.operation_id) {
            return Err(denied());
        }
        Ok(())
    }
    fn check_original(
        &self,
        preparation: &OriginalQuantityPreparation<'n, 'p, 'o, T, K>,
        operation: &native::StoredOperation,
        guard: &access::TransactionAuthorization<'_>,
    ) -> storage::Result<()> {
        if !self.matches_original(preparation)
            || !std::ptr::eq(
                guard.principal(),
                preparation.original().original_activity_principal(),
            )
            || operation.command != *preparation.native().command()
            || operation.captured_authority != *preparation.native().authority()
            || plan_digest(preparation.native().plan()).map_err(|_| unavailable())?
                != self.consent.plan_digest
            || self.consent.created_at.elapsed() > preparation.configured().descriptor().freshness
        {
            return Err(denied());
        }
        guard.assert_mutation().map_err(|_| denied())?;
        guard
            .revalidate_source(preparation.original().original_activity_source())
            .map_err(|_| denied())?;
        guard
            .revalidate_source_partition(preparation.original().original_activity_partition())
            .map_err(|_| denied())?;
        if guard
            .persisted_source_metadata(preparation.original().original_activity_partition())
            .map_err(|_| denied())?
            != *preparation.configured().metadata()
        {
            return Err(denied());
        }
        Ok(())
    }
    /// Called by the concrete native activity owner after same-transaction
    /// original graph/Store revalidation, never by a serialized receipt adapter.
    pub(crate) fn admission(
        &self,
        preparation: &OriginalQuantityPreparation<'n, 'p, 'o, T, K>,
        operation: &native::StoredOperation,
        guard: &access::TransactionAuthorization<'_>,
    ) -> storage::Result<storage::StockActivityApproval> {
        self.check_original(preparation, operation, guard)?;
        let mut claimed = self
            .claimed_operation
            .try_lock()
            .map_err(|_| unavailable())?;
        if claimed.is_some_and(|id| id != operation.operation_id) {
            return Err(denied());
        }
        *claimed = Some(operation.operation_id);
        Ok(storage::StockActivityApproval {
            receipt_id: self.receipt_id(),
            evidence_digest: self.evidence_digest().clone(),
        })
    }
}
