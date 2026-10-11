use super::super::{AtlasStore, *};
use crate::{
    access as a, app,
    contracts::stock as wire,
    domain::{self, stock},
};
use std::{cell::RefCell, sync::Arc};

/// Conservative source-only capture budgets; admission remains separately held.
pub(crate) const MAX_CLOSED_RAW_BYTES: usize = 64 * 1024 * 1024;
pub(crate) const MAX_ACCEPTED_FRAME_BYTES: usize = 32 * 1024 * 1024;
struct CountedWriter {
    count: usize,
    limit: usize,
}
impl std::io::Write for CountedWriter {
    fn write(&mut self, bytes: &[u8]) -> std::io::Result<usize> {
        self.count = self
            .count
            .checked_add(bytes.len())
            .ok_or_else(|| std::io::Error::other("presence frame exceeds budget"))?;
        if self.count > self.limit {
            return Err(std::io::Error::other("presence frame exceeds budget"));
        }
        Ok(bytes.len())
    }
    fn flush(&mut self) -> std::io::Result<()> {
        Ok(())
    }
}
pub(crate) fn bounded_size<T: serde::Serialize + ?Sized>(value: &T, limit: usize) -> Result<usize> {
    let mut writer = CountedWriter { count: 0, limit };
    serde_json::to_writer(&mut writer, value)
        .map_err(|_| Error::new("invalid-contract", "Presence capture exceeds bounded size"))?;
    Ok(writer.count)
}

pub enum PresenceCommandMapping<'a> {
    Direct,
    Derived(&'a stock::AtlasDerivation),
    DerivedBatch(&'a [Option<stock::AtlasDerivation>]),
}

/// Identity is retained only by pointer comparison; no pointer is dereferenced.
#[derive(Clone, Copy)]
pub(crate) struct PreparedIdentity {
    prepared: *const (),
    request: *const stock::ValidatedRequest,
    witness: *const (),
    graph: *const (),
}
impl PreparedIdentity {
    pub(crate) fn capture<W, G>(prepared: &stock::PreparedRequest<W, G>) -> Self {
        Self {
            prepared: std::ptr::from_ref(prepared).cast(),
            request: std::ptr::from_ref(prepared.request()),
            witness: std::ptr::from_ref(prepared.witness()).cast(),
            graph: std::ptr::from_ref(prepared.graph()).cast(),
        }
    }
    pub(crate) fn matches<W, G>(&self, prepared: &stock::PreparedRequest<W, G>) -> bool {
        self.prepared == std::ptr::from_ref(prepared).cast()
            && self.request == std::ptr::from_ref(prepared.request())
            && self.witness == std::ptr::from_ref(prepared.witness()).cast()
            && self.graph == std::ptr::from_ref(prepared.graph()).cast()
    }
}

pub struct StockPresenceCommandPeers<'phase, 'call, 'tx, 'origin, 'reader> {
    pub(crate) instance: Arc<()>,
    pub(crate) invocation: Arc<()>,
    pub(crate) principal: &'call app::RequestPrincipal,
    pub(crate) guard: &'phase a::TransactionAuthorization<'tx>,
    pub(crate) access: &'phase domain::qualified::OriginalPresenceAccess<'phase>,
    pub(crate) publications:
        &'call [&'call app::homebox_presence::ConfiguredPresenceReleased<'origin, 'reader>],
    pub(crate) age: &'phase domain::qualified::ConfiguredCacheAge,
    pub(crate) prepared: PreparedIdentity,
    pub(crate) request: &'call stock::ValidatedRequest,
}
/// Kept by the caller across the complete outer Access transaction.
pub struct StockPresenceCommandInvocation {
    instance: Arc<()>,
    invocation: Arc<()>,
    principal: *const app::RequestPrincipal,
    prepared: PreparedIdentity,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum StockPresenceAuthorizationPhase {
    Candidate,
    Precommit,
    Release,
}

/// A borrowed result of the original Store's completed native qualification.
/// Its private pointer identities are compared only; none is dereferenced.
pub struct StockPresenceQualifiedPhase<'phase> {
    phase: StockPresenceAuthorizationPhase,
    context: &'phase MutationAuthorizationContext,
    qualifications: &'phase [wire::PresenceQualification],
    principal: &'phase app::RequestPrincipal,
    guard: &'phase a::TransactionAuthorization<'phase>,
    prepared: PreparedIdentity,
    instance: &'phase Arc<()>,
    invocation: &'phase Arc<()>,
    transaction: &'phase rusqlite::Connection,
}
/// Only sibling Store machinery can assemble these live, borrowed issuer inputs.
pub(in crate::storage::store) struct PresencePhaseProofInputs<'phase> {
    pub(in crate::storage::store) phase: StockPresenceAuthorizationPhase,
    pub(in crate::storage::store) context: &'phase MutationAuthorizationContext,
    pub(in crate::storage::store) qualifications: &'phase [wire::PresenceQualification],
    pub(in crate::storage::store) principal: &'phase app::RequestPrincipal,
    pub(in crate::storage::store) guard: &'phase a::TransactionAuthorization<'phase>,
    pub(in crate::storage::store) prepared: PreparedIdentity,
    pub(in crate::storage::store) instance: &'phase Arc<()>,
    pub(in crate::storage::store) invocation: &'phase Arc<()>,
    pub(in crate::storage::store) transaction: &'phase rusqlite::Connection,
}
impl<'phase> StockPresenceQualifiedPhase<'phase> {
    pub(in crate::storage::store) fn issued(inputs: PresencePhaseProofInputs<'phase>) -> Self {
        let PresencePhaseProofInputs {
            phase,
            context,
            qualifications,
            principal,
            guard,
            prepared,
            instance,
            invocation,
            transaction,
        } = inputs;
        Self {
            phase,
            context,
            qualifications,
            principal,
            guard,
            prepared,
            instance,
            invocation,
            transaction,
        }
    }
    pub fn phase(&self) -> StockPresenceAuthorizationPhase {
        self.phase
    }
    pub fn context(&self) -> &MutationAuthorizationContext {
        self.context
    }
    pub fn qualifications(&self) -> &[wire::PresenceQualification] {
        self.qualifications
    }
    pub fn matches_principal_and_guard(
        &self,
        guard: &a::TransactionAuthorization<'_>,
        principal: &app::RequestPrincipal,
        context: &MutationAuthorizationContext,
    ) -> bool {
        std::ptr::eq(self.guard, guard)
            && std::ptr::eq(self.principal, principal)
            && std::ptr::eq(self.context, context)
            && !self.transaction.is_autocommit()
            && match self.phase {
                StockPresenceAuthorizationPhase::Candidate => {
                    context.phase == MutationPhase::Candidate
                }
                StockPresenceAuthorizationPhase::Precommit
                | StockPresenceAuthorizationPhase::Release => {
                    context.phase == MutationPhase::Precommit
                }
            }
            && std::ptr::eq(principal.principal.principal(), guard.principal())
            && guard.assert_mutation().is_ok()
            && guard.revalidate().is_ok()
    }
    pub fn matches_original_preparation<W, G>(
        &self,
        principal: &app::RequestPrincipal,
        prepared: &stock::PreparedRequest<W, G>,
    ) -> bool {
        std::ptr::eq(self.principal, principal) && self.prepared.matches(prepared)
    }
    pub fn matches_invocation(&self, invocation: &StockPresenceCommandInvocation) -> bool {
        Arc::ptr_eq(self.instance, &invocation.instance)
            && Arc::ptr_eq(self.invocation, &invocation.invocation)
            && invocation.principal == std::ptr::from_ref(self.principal)
            && self.prepared.prepared == invocation.prepared.prepared
            && self.prepared.request == invocation.prepared.request
            && self.prepared.witness == invocation.prepared.witness
            && self.prepared.graph == invocation.prepared.graph
    }
}

pub struct StockPresenceAcceptedFrame {
    pub(crate) commit: StockAtlasCommit,
    pub(crate) candidate: MutationAuthorizationContext,
    pub(crate) precommit: MutationAuthorizationContext,
    pub(crate) command_hashes: Vec<String>,
    pub(crate) batch_hash: Option<String>,
    pub(crate) witnesses: Vec<wire::PresenceWitness>,
}
impl StockPresenceAcceptedFrame {
    pub fn commit(&self) -> &StockAtlasCommit {
        &self.commit
    }
    pub fn candidate(&self) -> &MutationAuthorizationContext {
        &self.candidate
    }
    pub fn precommit(&self) -> &MutationAuthorizationContext {
        &self.precommit
    }
    pub fn command_hashes(&self) -> &[String] {
        &self.command_hashes
    }
    pub fn batch_hash(&self) -> Option<&str> {
        self.batch_hash.as_deref()
    }
    pub fn witnesses(&self) -> &[wire::PresenceWitness] {
        &self.witnesses
    }
}

/// Retained facts survive a failure during postcommit release. This is data.
pub struct StockPresenceCommittedData {
    commit: StockAtlasCommit,
    command_hashes: Vec<String>,
    batch_hash: Option<String>,
    witnesses: Vec<wire::PresenceWitness>,
}
impl StockPresenceCommittedData {
    pub fn commit(&self) -> &StockAtlasCommit {
        &self.commit
    }
    pub fn command_hashes(&self) -> &[String] {
        &self.command_hashes
    }
    pub fn batch_hash(&self) -> Option<&str> {
        self.batch_hash.as_deref()
    }
    pub fn witnesses(&self) -> &[wire::PresenceWitness] {
        &self.witnesses
    }
}
#[derive(Default)]
pub struct StockPresenceCommittedObservation(RefCell<Option<StockPresenceCommittedData>>);
impl StockPresenceCommittedObservation {
    pub fn new() -> Self {
        Self::default()
    }
    pub fn take(&self) -> Option<StockPresenceCommittedData> {
        self.0.borrow_mut().take()
    }
    pub(crate) fn is_empty(&self) -> bool {
        self.0.borrow().is_none()
    }
    pub(crate) fn committed(&self, data: StockPresenceCommittedData) {
        self.0.replace(Some(data));
    }
}
impl StockPresenceAcceptedFrame {
    pub(crate) fn data(&self) -> StockPresenceCommittedData {
        StockPresenceCommittedData {
            commit: self.commit.clone(),
            command_hashes: self.command_hashes.clone(),
            batch_hash: self.batch_hash.clone(),
            witnesses: self.witnesses.clone(),
        }
    }
}

pub struct StockPresenceStorageReleasedCut<'call, 'origin, 'reader> {
    pub(crate) frame: StockPresenceAcceptedFrame,
    pub(crate) instance: Arc<()>,
    pub(crate) invocation: Arc<()>,
    pub(crate) principal: &'call app::RequestPrincipal,
    pub(crate) request: &'call stock::ValidatedRequest,
    pub(crate) publications:
        &'call [&'call app::homebox_presence::ConfiguredPresenceReleased<'origin, 'reader>],
    pub(crate) prepared: PreparedIdentity,
}
pub struct StockPresenceAcceptedCut<'call, 'origin, 'reader> {
    frame: StockPresenceAcceptedFrame,
    instance: Arc<()>,
    principal: &'call app::RequestPrincipal,
    request: &'call stock::ValidatedRequest,
    publications:
        &'call [&'call app::homebox_presence::ConfiguredPresenceReleased<'origin, 'reader>],
    prepared: PreparedIdentity,
}
impl<'call, 'origin, 'reader> StockPresenceAcceptedCut<'call, 'origin, 'reader> {
    pub fn frame(&self) -> &StockPresenceAcceptedFrame {
        &self.frame
    }
    pub fn original_command_principal(&self) -> &app::RequestPrincipal {
        self.principal
    }
    /// Exact validated request borrowed by this original accepted invocation.
    pub fn original_request(&self) -> &stock::ValidatedRequest {
        self.request
    }
    pub fn publications(
        &self,
    ) -> &'call [&'call app::homebox_presence::ConfiguredPresenceReleased<'origin, 'reader>] {
        self.publications
    }
    pub fn matches_original_preparation<W, G>(
        &self,
        principal: &app::RequestPrincipal,
        prepared: &stock::PreparedRequest<W, G>,
    ) -> bool {
        std::ptr::eq(self.principal, principal)
            && self.prepared.matches(prepared)
            && std::ptr::eq(self.request, prepared.request())
    }
    pub fn matches_store<C: Contract, A: Authorization, R: Runtime>(
        &self,
        store: &AtlasStore<C, A, R>,
    ) -> bool {
        Arc::ptr_eq(&self.instance, &store.instance)
    }
    /// Move the accepted immutable DATA after a producer has captured its
    /// original native publications. This does not reissue authority.
    pub fn into_history_frame(self) -> StockPresenceAcceptedFrame {
        self.frame
    }
}
pub(crate) fn promote_presence_access_released<'call, 'origin, 'reader, W, G>(
    pending: StockPresenceStorageReleasedCut<'call, 'origin, 'reader>,
    invocation: &StockPresenceCommandInvocation,
    principal: &app::RequestPrincipal,
    prepared: &stock::PreparedRequest<W, G>,
) -> Result<StockPresenceAcceptedCut<'call, 'origin, 'reader>> {
    if !Arc::ptr_eq(&pending.instance, &invocation.instance)
        || !Arc::ptr_eq(&pending.invocation, &invocation.invocation)
        || invocation.principal != std::ptr::from_ref(principal)
        || !invocation.prepared.matches(prepared)
        || !std::ptr::eq(pending.principal, principal)
        || !pending.prepared.matches(prepared)
    {
        return Err(Error::new(
            "forbidden",
            "Original stock command preparation changed",
        ));
    }
    Ok(StockPresenceAcceptedCut {
        frame: pending.frame,
        instance: pending.instance,
        principal: pending.principal,
        request: pending.request,
        publications: pending.publications,
        prepared: pending.prepared,
    })
}

impl<C: Contract, A: Authorization, R: Runtime> AtlasStore<C, A, R> {
    pub fn prepare_presence_command<'phase, 'call, 'tx, 'origin, 'reader, W, G>(
        &self,
        principal: &'call app::RequestPrincipal,
        prepared: &'call stock::PreparedRequest<W, G>,
        guard: &'phase a::TransactionAuthorization<'tx>,
        access: &'phase domain::qualified::OriginalPresenceAccess<'phase>,
        publications: &'call [&'call app::homebox_presence::ConfiguredPresenceReleased<
            'origin,
            'reader,
        >],
        age: &'phase domain::qualified::ConfiguredCacheAge,
    ) -> Result<(
        StockPresenceCommandPeers<'phase, 'call, 'tx, 'origin, 'reader>,
        StockPresenceCommandInvocation,
    )> {
        if self.options.presence_profile != PresenceProfileSelection::FreshV7
            || !std::ptr::eq(principal.principal.principal(), guard.principal())
            || !std::ptr::eq(access.principal, guard.principal())
            || publications.is_empty()
            || publications.len() > 100
            || publications.iter().any(|publication| {
                !publication.matches_store(self)
                    || publication.native_access_package_version()
                        != a::NATIVE_ACCESS_PACKAGE_VERSION
                    || publication.origin().partition()
                        != &publication.committed().cache().partition()
                    || publication.origin().registration() != publication.committed().registration()
            })
        {
            return Err(Error::new(
                "forbidden",
                "Original presence command peers unavailable",
            ));
        }
        let mut raw_bytes = 0_usize;
        let mut normalized_bytes = 0_usize;
        for publication in publications {
            for response in publication.native_generation().responses() {
                raw_bytes = raw_bytes
                    .checked_add(response.body().len())
                    .ok_or_else(|| {
                        Error::new("invalid-contract", "Closed native capture is too large")
                    })?;
                if raw_bytes > MAX_CLOSED_RAW_BYTES {
                    return Err(Error::new(
                        "invalid-contract",
                        "Closed native capture is too large",
                    ));
                }
            }
            let remaining = MAX_ACCEPTED_FRAME_BYTES
                .checked_sub(normalized_bytes)
                .ok_or_else(|| {
                    Error::new(
                        "invalid-contract",
                        "Normalized presence capture is too large",
                    )
                })?;
            normalized_bytes = normalized_bytes
                .checked_add(bounded_size(
                    publication.committed().generation(),
                    remaining,
                )?)
                .ok_or_else(|| {
                    Error::new(
                        "invalid-contract",
                        "Normalized presence capture is too large",
                    )
                })?;
        }
        guard
            .assert_mutation()
            .map_err(|_| Error::new("forbidden", "Original mutation authority unavailable"))?;
        guard
            .revalidate()
            .map_err(|_| Error::new("forbidden", "Original mutation authority unavailable"))?;
        for grant in access.sources {
            guard
                .revalidate_source(grant)
                .map_err(|_| Error::new("forbidden", "Original source authority unavailable"))?;
        }
        for grant in access.partitions {
            guard
                .revalidate_source_partition(grant)
                .map_err(|_| Error::new("forbidden", "Original partition authority unavailable"))?;
        }
        let invocation = Arc::new(());
        let identity = PreparedIdentity::capture(prepared);
        Ok((
            StockPresenceCommandPeers {
                instance: Arc::clone(&self.instance),
                principal,
                guard,
                access,
                publications,
                age,
                prepared: identity,
                request: prepared.request(),
                invocation: Arc::clone(&invocation),
            },
            StockPresenceCommandInvocation {
                instance: Arc::clone(&self.instance),
                invocation,
                principal: std::ptr::from_ref(principal),
                prepared: identity,
            },
        ))
    }
}
