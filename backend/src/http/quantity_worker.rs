//! Stack-owned original quantity previews. Guards never cross provider awaits.
//! The mailbox selects a still-live original owner; UUIDs are not authority.
use super::quantity::{Command, PreviewInput, Reply};
use crate::{
    access as a,
    app::{
        Core, RequestPrincipal,
        homebox_quantity_graph::{OriginalQuantityPreparation, QuantityGraphAuthority},
        quantity_approval::{
            AuthenticatedQuantityConsent, HumanQuantityApproval, QuantityApprovalRequest,
        },
        stock_activity_principal::OriginalStockActivityPrincipal,
    },
    config::providers::quantity_installation::OriginalQuantityConfigured,
    domain::stock::{CapturedAccess, NativeStockContract},
    providers::homebox::{
        read, recovery::NativeWriterContracts, wire, write::stock as n, write_transport,
    },
    storage::{self as s, StockActivityPrincipal},
};
use n::{StockActivityPort, StockContractPort};
use serde_json::{Value, json};
use std::{
    sync::{Arc, Mutex, mpsc::Receiver},
    time::{Duration, Instant},
};
use uuid::Uuid;
#[derive(Debug)]
pub(super) struct FlowError;
impl From<a::AccessError> for FlowError {
    fn from(_: a::AccessError) -> Self {
        Self
    }
}
type Result<T> = std::result::Result<T, FlowError>;
fn failed<E>(_: E) -> FlowError {
    FlowError
}
struct Clock;
impl read::Clock for Clock {
    fn now(&self) -> read::Timestamp {
        read::Timestamp::parse(&crate::app::now().expect("native RFC3339 clock"))
            .expect("native timestamp")
    }
}
fn new_id() -> Result<Uuid> {
    Uuid::parse_str(&crate::app::new_id().map_err(failed)?).map_err(failed)
}
fn digest(plan: &n::NativePlan) -> Result<n::Digest> {
    n::Digest::parse(
        crate::contracts::semantics::canonical_digest(&serde_json::to_value(plan).map_err(failed)?)
            .map_err(failed)?,
    )
    .map_err(failed)
}
fn current(
    guard: &a::TransactionAuthorization<'_>,
    original: &OriginalStockActivityPrincipal,
) -> Result<()> {
    guard.assert_mutation()?;
    guard.revalidate_source(original.original_activity_source())?;
    guard.revalidate_source_partition(original.original_activity_partition())?;
    Ok(())
}

pub(super) struct Worker {
    pub core: Arc<Mutex<Core>>,
    pub configured: Arc<OriginalQuantityConfigured>,
    #[cfg(test)]
    pub tls_fixture: Option<Arc<super::quantity_fixture::PrivateLoopbackQuantityTls>>,
}
impl Worker {
    pub(super) fn run(
        self,
        input: PreviewInput,
        request: RequestPrincipal,
        preview_id: Uuid,
        inbox: Receiver<Command>,
        handle: tokio::runtime::Handle,
        initial: &mut Option<Reply>,
    ) -> Result<()> {
        let core = self.core;
        let configured = self.configured;
        #[cfg(test)]
        let tls_fixture = self.tls_fixture;
        let started = Instant::now();
        let expires = started + configured.descriptor().freshness;
        let policy = configured.reviewed_policy();
        if policy
            .get("policyEpoch")
            .and_then(Value::as_u64)
            .is_none_or(|epoch| epoch > 9_007_199_254_740_991)
            || policy.get("maximum").is_some_and(|bound| {
                bound
                    .as_u64()
                    .is_none_or(|maximum| maximum > 9_007_199_254_740_991)
            })
        {
            return Err(FlowError);
        }
        let (access, store) = {
            let core = core.lock().map_err(failed)?;
            (core.access.clone(), core.store.clone())
        };
        if !Arc::ptr_eq(&access, configured.access()) {
            return Err(FlowError);
        }
        let source = input.source.clone();
        let (source_grant, partition_grant) = {
            let boundary = access.lock().map_err(failed)?;
            request.capture_source(&boundary, &source)?;
            request.capture_partition(&boundary, &source.partition())?;
            (
                request.captured_source(&source)?,
                request.captured_partition(&source.partition())?,
            )
        };
        let principal = request.principal.principal();
        let installation =
            n::NativeQuantityInstallationOwner::capture_configured(&configured).map_err(failed)?;
        let profile = installation.profile().map_err(failed)?;
        let mut original_preview = None;
        access
            .lock()
            .map_err(failed)?
            .with_mutation_authorization(principal, |guard| {
                original_preview = Some(
                    n::OriginalQuantityPreview::new(
                        principal,
                        &source_grant,
                        &partition_grant,
                        &profile,
                        guard,
                    )
                    .map_err(failed)?,
                );
                Ok::<(), FlowError>(())
            })?;
        let original_preview = original_preview.ok_or(FlowError)?;
        #[cfg(not(test))]
        let reader = installation
            .create_reader(&original_preview, Clock)
            .map_err(failed)?;
        #[cfg(test)]
        let reader = match tls_fixture.as_ref() {
            Some(tls) => installation.create_reader_with_loopback_certificate(
                &original_preview,
                Clock,
                tls.certificate_for(&configured).ok_or(FlowError)?,
            ),
            None => installation.create_reader(&original_preview, Clock),
        }
        .map_err(failed)?;
        let registry = n::QuantityObservationRegistry::new(&original_preview);
        let observation = handle
            .block_on(registry.issue_installed_observation(&reader))
            .map_err(failed)?;
        let expected = configured.descriptor();
        let reserved = match expected.policy {
            n::QuantityPolicy::HumanRequired => Some(new_id()?),
            n::QuantityPolicy::NoHuman { .. } => None,
        };
        let raw = json!({"schemaVersion":3,"commandId":"homebox.entity.quantity.set", "requestId":new_id()?,
        "context":expected.scope, "target":{"authority":"homebox","sourceInstanceId":expected.target.source_instance_id,
        "collectionId":expected.target.collection_id,"resourceKind":"entity","resourceId":expected.target.resource_id},
        "payload":{"quantity":input.quantity},"idempotencyKey":new_id()?,"reason":input.reason,
        "preconditions":{"providerObservation":{"kind":"provider-observation","handle":observation},"atlasGuards":[]},
        "approvalReceiptId":reserved});
        let contracts = NativeWriterContracts::new().map_err(failed)?;
        let command = contracts.validate_request(&raw).map_err(failed)?;
        let authority = expected.authority.clone();
        let original = Arc::new(OriginalStockActivityPrincipal::from_captured_request(
            &request,
            &mut *access.lock().map_err(failed)?,
            &contracts,
            command.clone(),
            authority.clone(),
            &source,
        )?);
        let captured = CapturedAccess::retain_original(
            &mut *access.lock().map_err(failed)?,
            principal,
            std::slice::from_ref(&source_grant),
            std::slice::from_ref(&partition_grant),
        )?;
        let adapter = n::DecodedStockPreparation::new(
            NativeWriterContracts::new().map_err(failed)?,
            n::QuantitySource::from_installed(&original, &registry, &reader).map_err(failed)?,
            wire::DecodeLimits::default(),
        );
        let pending = handle
            .block_on(adapter.capture_pending(&command, &authority))
            .map_err(failed)?;
        let mut retained = None;
        {
            let mut store = store.lock().map_err(failed)?;
            access
                .lock()
                .map_err(failed)?
                .with_mutation_authorization(principal, |guard| {
                    let physical = configured
                        .observe_original(&mut store, &original, guard)
                        .map_err(failed)?;
                    let context = n::FreshQualification::with_quantity_installation(
                        guard, &captured, &physical,
                    )
                    .map_err(failed)?;
                    retained = Some(pending.finish_in_guard(&context).map_err(failed)?);
                    Ok::<(), FlowError>(())
                })?;
        }
        let retained = retained.ok_or(FlowError)?;
        let domain = NativeStockContract::new().map_err(failed)?;
        let mut prepared = None;
        {
            let mut store = store.lock().map_err(failed)?;
            access
                .lock()
                .map_err(failed)?
                .with_mutation_authorization(principal, |guard| {
                    let physical = configured
                        .observe_original(&mut store, &original, guard)
                        .map_err(failed)?;
                    prepared = Some(
                        QuantityGraphAuthority::new(guard, &captured, &retained, &physical)
                            .map_err(failed)?
                            .prepare(&domain)
                            .map_err(failed)?,
                    );
                    Ok::<(), FlowError>(())
                })?;
        }
        let prepared = prepared.ok_or(FlowError)?;
        let mut bundle = None;
        {
            let mut store = store.lock().map_err(failed)?;
            access
                .lock()
                .map_err(failed)?
                .with_mutation_authorization(principal, |guard| {
                    let physical = configured
                        .observe_original(&mut store, &original, guard)
                        .map_err(failed)?;
                    let graph = QuantityGraphAuthority::new(guard, &captured, &retained, &physical)
                        .map_err(failed)?;
                    bundle =
                        Some(OriginalQuantityPreparation::bind(&prepared, &graph).map_err(failed)?);
                    Ok::<(), FlowError>(())
                })?;
        }
        let bundle = bundle.ok_or(FlowError)?;
        let readback = n::DecodedStockReadback::new(
            NativeWriterContracts::new().map_err(failed)?,
            n::QuantitySource::from_installed(&original, &registry, &reader).map_err(failed)?,
            wire::DecodeLimits::default(),
        );
        let readback_binding = {
            let core = core.lock().map_err(failed)?;
            n::QuantityReadbackBinding::new(
                &core,
                configured.clone(),
                &original,
                &captured,
                &readback,
            )
            .map_err(failed)?
        };
        let plan_digest = digest(retained.plan())?;
        let policy = configured.reviewed_policy();
        let snapshot = retained.capture().snapshots().first().ok_or(FlowError)?;
        let quantity = snapshot
            .source()
            .get("quantity")
            .filter(|v| v.is_number())
            .ok_or(FlowError)?
            .to_string();
        let remaining = expires
            .checked_duration_since(Instant::now())
            .ok_or(FlowError)?
            .as_millis() as u64;
        if !(1..=60_000).contains(&remaining) {
            return Err(FlowError);
        }
        let preview = json!({"format":"atlas-homebox-quantity-preview/1","resolvedScope":command.context,"source":source,
        "previewId":preview_id,"request":raw,"requestDigest":command.request_digest,"planDigest":plan_digest,
        "observed":{"quantity":quantity,"updatedAt":snapshot.source().get("updatedAt").unwrap_or(&Value::Null),"retrievedAt":snapshot.original().observed_at},
        "effect":{"quantity":input.quantity,"method":"PATCH","path":retained.plan().request.path,"body":{"quantity":input.quantity}},
        "policy":{"id":policy["policyId"],"version":policy["policyVersion"].as_u64().ok_or(FlowError)?.to_string(),
        "epoch":policy["policyEpoch"],"approval":policy["approvalRequirement"],"maximumQuantity":policy.get("maximum").unwrap_or(&Value::Null)},
        "assurance":{"installedBuild":"configured-not-runtime-attested","causality":false,"atomicCompareAndSet":false},"lifetime":{"remainingMs":remaining}});
        // Disclosure is a separate current original phase, after all captures.
        {
            let mut store = store.lock().map_err(failed)?;
            access
                .lock()
                .map_err(failed)?
                .with_mutation_authorization(principal, |guard| {
                    let physical = configured
                        .observe_original(&mut store, &original, guard)
                        .map_err(failed)?;
                    bundle
                        .revalidate_original_phase(guard, &physical)
                        .map_err(failed)?;
                    Ok::<(), FlowError>(())
                })?;
        }
        initial
            .take()
            .ok_or(FlowError)?
            .send(Ok(preview))
            .map_err(failed)?;
        let mut approval = None;
        let mut approval_attempted = false;
        let mut dispatched = false;
        loop {
            let remaining = expires
                .checked_duration_since(Instant::now())
                .ok_or(FlowError)?;
            let message = inbox.recv_timeout(remaining).map_err(failed)?;
            match message {
                Command::Approve {
                    principal: post,
                    body,
                    reply,
                } => {
                    let result = (|| {
                        if approval_attempted || dispatched || reserved.is_none() {
                            return Err(FlowError);
                        }
                        approval_attempted = true;
                        let request: QuantityApprovalRequest =
                            serde_json::from_value(body).map_err(failed)?;
                        let mut consent = None;
                        access.lock().map_err(failed)?.with_mutation_authorization(
                            post.principal.principal(),
                            |guard| {
                                consent = Some(
                                    AuthenticatedQuantityConsent::from_authenticated_post(
                                        &bundle, preview_id, request, guard,
                                    )
                                    .map_err(failed)?,
                                );
                                Ok::<(), FlowError>(())
                            },
                        )?;
                        let mut store = store.lock().map_err(failed)?;
                        access.lock().map_err(failed)?.with_mutation_authorization(
                            principal,
                            |guard| {
                                let physical = configured
                                    .observe_original(&mut store, &original, guard)
                                    .map_err(failed)?;
                                approval = Some(
                                    HumanQuantityApproval::issue_in_original_phase(
                                        consent.take().ok_or(FlowError)?,
                                        guard,
                                        &physical,
                                    )
                                    .map_err(failed)?,
                                );
                                Ok::<(), FlowError>(())
                            },
                        )?;
                        let receipt = approval.as_ref().ok_or(FlowError)?;
                        Ok(
                            json!({"format":"atlas-homebox-quantity-approval/1","resolvedScope":command.context,"source":source,"previewId":preview_id,
                        "requestDigest":command.request_digest,"planDigest":plan_digest,"approvalReceiptId":receipt.receipt_id(),"evidenceDigest":receipt.evidence_digest()}),
                        )
                    })();
                    let _ = reply.send(result);
                }
                Command::Dispatch {
                    principal: post,
                    body,
                    reply,
                } => {
                    let result = (|| {
                        if dispatched
                            || Instant::now() >= expires
                            || body.preview_id != preview_id
                            || body.request_digest != command.request_digest
                            || body.plan_digest != plan_digest
                            || body.approval_receipt_id != reserved
                            || reserved.is_some() && approval.is_none()
                        {
                            return Err(FlowError);
                        }
                        // No native effect may be issued from a replacement session.
                        access
                            .lock()
                            .map_err(failed)?
                            .with_mutation_authorization(post.principal.principal(), |guard| {
                                current(guard, &original)
                            })?;
                        dispatched = true;
                        let authorization = Arc::new(match approval.as_ref() {
                            Some(receipt) => n::QuantityActivityAuthorization::new_with_approval(
                                &bundle, receipt,
                            )
                            .map_err(failed)?,
                            None => {
                                n::QuantityActivityAuthorization::new(&bundle).map_err(failed)?
                            }
                        });
                        let physical = configured.physical();
                        let session = s::StockActivitySession::new(
                            store.clone(),
                            access.clone(),
                            original.clone(),
                            authorization,
                            Arc::new(NativeWriterContracts::new().map_err(failed)?),
                            s::StockActivityRegistration {
                                physical_binding: physical.physical_binding.clone(),
                                owner_id: physical.owner_id,
                                dispatcher_epoch: physical.dispatcher_epoch,
                                source_epoch: authority.source_epoch,
                                qualification: authority.qualification.clone(),
                            },
                            command.clone(),
                            authority.clone(),
                        )
                        .map_err(failed)?;
                        let n::StockReservation::Reserved(reserved_operation) = handle
                            .block_on(session.reserve(&command, &authority))
                            .map_err(failed)?
                        else {
                            return Err(FlowError);
                        };
                        let committed = s::QuantityAdmissionCommittedObservation::new();
                        let s::OriginalQuantityAdmission::Admitted(invocation) = session
                            .admit_original_quantity(&reserved_operation, &bundle, &committed)
                            .map_err(failed)?
                        else {
                            return Err(FlowError);
                        };
                        let cancellation = tokio_util::sync::CancellationToken::new();
                        let deadline = tokio::time::Instant::now()
                            + expires.saturating_duration_since(Instant::now());
                        let limits = write_transport::Limits {
                            max_request_bytes: 4096,
                            max_response_bytes: 16384,
                            timeout: Duration::from_secs(10),
                        };
                        #[cfg(not(test))]
                        let attempt = n::QuantityNativeAttempt::from_original(
                            &session,
                            &bundle,
                            invocation,
                            limits,
                            deadline,
                            cancellation,
                        )
                        .map_err(failed)?;
                        #[cfg(test)]
                        let attempt = match tls_fixture.as_ref() {
                            Some(tls) => {
                                n::QuantityNativeAttempt::from_original_with_loopback_certificate(
                                    &session,
                                    &bundle,
                                    invocation,
                                    limits,
                                    deadline,
                                    cancellation,
                                    tls.certificate_for(&configured).ok_or(FlowError)?,
                                )
                            }
                            None => n::QuantityNativeAttempt::from_original(
                                &session,
                                &bundle,
                                invocation,
                                limits,
                                deadline,
                                cancellation,
                            ),
                        }
                        .map_err(failed)?;
                        let dispatched_report =
                            handle.block_on(attempt.execute()).map_err(failed)?;
                        let recorded = handle
                            .block_on(dispatched_report.record())
                            .map_err(failed)?;
                        let operation = if recorded.operation().outcome.remote_activity.invoked() {
                            handle
                                .block_on(
                                    handle
                                        .block_on(recorded.capture_readback(&readback_binding))
                                        .map_err(failed)?
                                        .record(),
                                )
                                .map_err(failed)?
                        } else {
                            recorded.operation().clone()
                        };
                        {
                            let mut store = store.lock().map_err(failed)?;
                            access.lock().map_err(failed)?.with_mutation_authorization(
                                principal,
                                |guard| {
                                    let physical = configured
                                        .observe_original(&mut store, &original, guard)
                                        .map_err(failed)?;
                                    bundle
                                        .revalidate_original_phase(guard, &physical)
                                        .map_err(failed)?;
                                    Ok::<(), FlowError>(())
                                },
                            )?;
                        }
                        // Current output authority is independent of the retained I/O
                        // evidence. Failed disclosure implies no rollback or retry.
                        access
                            .lock()
                            .map_err(failed)?
                            .with_mutation_authorization(post.principal.principal(), |guard| {
                                current(guard, &original)
                            })?;
                        Ok(
                            json!({"format":"atlas-homebox-quantity-result/1","resolvedScope":command.context,"source":source,"previewId":preview_id,
                        "requestDigest":command.request_digest,"planDigest":plan_digest,"result":operation.outcome}),
                        )
                    })();
                    let _ = reply.send(result);
                    return Ok(());
                }
            }
        }
    }
}
