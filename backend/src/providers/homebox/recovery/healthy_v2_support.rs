//! Fresh real-storage claim/journal fixture; no provider or recovered execution.
use super::{codec::*, *};
use crate::{
    domain::{
        native_semantics::NativeSemantics,
        stock::{NativeStockContract, ValidatedRequest},
    },
    jobs as j, storage as s,
};
use j::QueueStore;
use serde_json::Value;

struct FixtureStoreAuthority;
impl s::Authorization for FixtureStoreAuthority {
    type Principal = s::VerifiedActor;
    fn authorize(
        &self,
        principal: &s::VerifiedActor,
        request: s::AuthorizationRequest<'_>,
    ) -> s::Result<s::VerifiedActor> {
        assert_eq!(principal.workspace_id, request.scope.workspace_id);
        assert_eq!(principal.home_id, request.scope.home_id);
        Ok(principal.clone())
    }
}
struct FixtureRuntime;
impl s::Runtime for FixtureRuntime {
    fn now(&self) -> s::Result<String> {
        Ok("2026-10-07T09:00:00Z".into())
    }
    fn new_id(&self) -> s::Result<String> {
        Err(unavailable())
    }
    fn verify_available_asset(&self, _: &s::Record) -> s::Result<s::AssetProof> {
        Err(unavailable())
    }
}
struct FixtureLive<'a> {
    config: &'a j::QueueConfig,
    request: &'a j::EnqueueRequest,
    original: &'a ValidatedRequest,
    claimed: Option<&'a j::LeasedJob>,
    prepared: Option<&'a s::PreparedNativeIntent>,
}
impl s::QueueAuthorization for FixtureLive<'_> {
    type Principal = s::VerifiedActor;
    type Witness = String;
    fn authorize(
        &self,
        principal: &s::VerifiedActor,
        witness: &String,
        original: &ValidatedRequest,
        _: s::QueuePhase,
        action: s::QueueAction<'_>,
    ) -> s::Result<s::VerifiedActor> {
        assert_eq!(principal.workspace_id, self.request.receipt.workspace_id);
        assert_eq!(principal.home_id, self.request.receipt.home_id);
        assert_eq!(principal.actor_id, self.request.receipt.actor_id);
        assert_eq!(witness, original.intent_digest());
        assert_eq!(original.raw(), self.original.raw());
        match action {
            s::QueueAction::Register(config) => assert_eq!(config, self.config),
            s::QueueAction::Enqueue(request) => assert_eq!(request, self.request),
            s::QueueAction::Snapshot(receipt) => assert_eq!(receipt, &self.request.receipt),
            s::QueueAction::Claim(job) => {
                assert_eq!(job.request, *self.request);
                assert_eq!(
                    job.lease.physical_identity,
                    self.config.registration.identity
                );
            }
            s::QueueAction::Journal(job, prepared) => {
                assert_eq!(Some(job), self.claimed);
                assert_eq!(Some(prepared), self.prepared);
            }
            _ => return Err(unavailable()),
        }
        Ok(principal.clone())
    }
    fn validate_enqueue(
        &self,
        _: &s::VerifiedActor,
        witness: &String,
        original: &ValidatedRequest,
        request: &j::EnqueueRequest,
        scope: &j::CanonicalScope,
    ) -> s::Result<()> {
        assert_eq!(witness, original.intent_digest());
        assert_eq!(original.raw(), self.original.raw());
        assert_eq!(request, self.request);
        assert_eq!(
            self.config
                .registration
                .resolve(&request.partition, &request.write_scope)
                .unwrap(),
            *scope
        );
        Ok(())
    }
    fn parse_retained_original(&self, raw: Value) -> s::Result<ValidatedRequest> {
        ValidatedRequest::parse(&NativeStockContract::new().map_err(|_| unavailable())?, raw)
            .map_err(|_| incompatible())
    }
    fn remote_end_step(
        &self,
        _: &s::VerifiedActor,
        _: &String,
        _: &ValidatedRequest,
        _: &j::RemoteEndEvidence,
        _: &j::LeasedJob,
        _: &s::JournalEvidenceView,
    ) -> s::Result<s::QueueStepEvidence> {
        Err(unavailable())
    }
    fn reconciliation_steps(
        &self,
        _: &s::VerifiedActor,
        _: &String,
        _: &ValidatedRequest,
        _: &j::HeldJob,
        _: &j::ReconciliationEvidence,
        _: &j::FinishDisposition,
    ) -> s::Result<Vec<s::QueueStepEvidence>> {
        Err(unavailable())
    }
}
type FixtureStore =
    s::AtlasStore<s::NativeContract<NativeSemantics>, FixtureStoreAuthority, FixtureRuntime>;
pub(super) struct ClaimedStorage {
    directory: tempfile::TempDir,
    store: FixtureStore,
    original: ValidatedRequest,
    config: j::QueueConfig,
    actor: s::VerifiedActor,
    pub job: j::LeasedJob,
}
impl ClaimedStorage {
    pub fn fresh(config: &j::QueueConfig, request: &j::EnqueueRequest, wire: &Value) -> Self {
        let directory = tempfile::tempdir().unwrap();
        let original =
            ValidatedRequest::parse(&NativeStockContract::new().unwrap(), wire.clone()).unwrap();
        let mut store = s::AtlasStore::open(
            directory.path().join("source.sqlite"),
            s::NativeContract::new(NativeSemantics::native()),
            FixtureStoreAuthority,
            FixtureRuntime,
            s::StoreOptions {
                allow_synthetic_bootstrap: true,
                ..s::StoreOptions::default()
            },
        )
        .unwrap();
        let snapshot: s::Snapshot = serde_json::from_str(include_str!(
            "../../../../../packages/contracts/fixtures/plan-free.snapshot.json"
        ))
        .unwrap();
        store.initialize_synthetic(&snapshot).unwrap();
        let actor = s::VerifiedActor {
            workspace_id: request.receipt.workspace_id.clone(),
            home_id: request.receipt.home_id.clone(),
            actor_id: request.receipt.actor_id.clone(),
        };
        let live = FixtureLive {
            config,
            request,
            original: &original,
            claimed: None,
            prepared: None,
        };
        let witness = original.intent_digest().to_owned();
        let job = {
            let mut session = store
                .queue_session(
                    config.clone(),
                    s::QueueSessionBinding {
                        receipt: &request.receipt,
                        original: &original,
                        principal: &actor,
                        witness: &witness,
                    },
                    &live,
                    s::QueueEvidenceInbox::default(),
                )
                .unwrap();
            let scope = config
                .registration
                .resolve(&request.partition, &request.write_scope)
                .unwrap();
            assert!(matches!(
                session
                    .enqueue(request, &scope, config, 1_800_000_000_000)
                    .unwrap(),
                j::EnqueueOutcome::Enqueued(_)
            ));
            let j::ClaimOutcome::Claimed(job) =
                session.claim_next(1_800_000_000_001, config).unwrap()
            else {
                panic!("fresh healthy claim expected")
            };
            job
        };
        assert_eq!(job.lease.job_id.0.len(), 65);
        assert!(job.lease.job_id.0.starts_with('q'));
        Self {
            directory,
            store,
            original,
            config: config.clone(),
            actor,
            job,
        }
    }
    pub fn journal(&mut self, prepared: &s::PreparedNativeIntent) {
        let job = &self.job;
        let live = FixtureLive {
            config: &self.config,
            request: &job.request,
            original: &self.original,
            claimed: Some(job),
            prepared: Some(prepared),
        };
        let witness = self.original.intent_digest().to_owned();
        let mut session = self
            .store
            .queue_session(
                self.config.clone(),
                s::QueueSessionBinding {
                    receipt: &job.request.receipt,
                    original: &self.original,
                    principal: &self.actor,
                    witness: &witness,
                },
                &live,
                s::QueueEvidenceInbox::default(),
            )
            .unwrap();
        let receipt = session.commit_native(job, prepared).unwrap();
        assert_eq!(
            receipt.native_payload_digest.as_hex(),
            raw_digest(&prepared.native_payload)
        );
    }
    pub fn validate_prepared_image<D: s::QueueDiscovery, E: s::QueueRecoveryEvidence>(
        &mut self,
        peers: &s::RecoveryValidationPeers<'_, NativeStockContract, D, E>,
    ) {
        let image = self.directory.path().join("prepared-image.sqlite");
        let captured = self
            .store
            .backup_recovery_to_with_peers(&image, peers, &mut || Ok(()))
            .unwrap();
        let validated = self
            .store
            .validate_recovery_image_with_peers(&image, peers, &mut || Ok(()))
            .unwrap();
        assert_eq!(captured, validated);
    }
}
