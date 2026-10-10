//! Wire3 handles over the existing managed Media HEAD/GET delivery path.
//! Handles are bounded correlations, never authority. Every redemption checks
//! the authenticated session and current record and calls real Media delivery.
use super::{
    OperationId, OwnerResult, PreparedRequest, StockContractPort, StockError, StockQueryPort,
    StockResult, canonical_digest,
};
use crate::media::{
    Cancellation, MediaError, WorkBudget,
    download_lifetime::{DownloadAvailability, project_issuer_lifetime},
    service::{
        DeliveryMode, MediaAccessPort, MediaResponse, MediaService, MediaStoragePort,
        OwnedDescriptor, ReadMethod, StoredAsset,
    },
    types::{AssetRecord, Availability, Lifecycle, Scope},
};
use serde_json::{Value, json};
use std::{
    collections::VecDeque,
    sync::{Arc, Mutex},
    time::{Duration, Instant},
};

// Engineering bound for each genuine Access-normalized session; the global
// registry ceiling remains 1000. This is not a runtime capacity guarantee.
const MAX_HANDLES_PER_SESSION: usize = 64;

/// Access-owned normalized session correlation. Implementations must revalidate
/// the original opaque principal, include the Access instance and expose no raw
/// credential. Caller cookie text, actor/scope DTOs and transport IDs cannot
/// implement this contract. It cannot authorize media or issue replacement P.
pub trait AuthenticatedSessionPort<P> {
    fn authenticated_session_binding(&self, original: &P) -> StockResult<[u8; 32]>;
}

impl AuthenticatedSessionPort<crate::access::Principal> for crate::access::AccessBoundary {
    fn authenticated_session_binding(
        &self,
        original: &crate::access::Principal,
    ) -> StockResult<[u8; 32]> {
        crate::access::AccessBoundary::authenticated_session_binding(self, original)
            .map_err(|_| StockError::AuthorityChanged)
    }
}
impl AuthenticatedSessionPort<crate::media::native::RetainedPrincipal>
    for Mutex<crate::access::AccessBoundary>
{
    fn authenticated_session_binding(
        &self,
        original: &crate::media::native::RetainedPrincipal,
    ) -> StockResult<[u8; 32]> {
        self.lock()
            .map_err(|_| StockError::OwnerUnavailable)?
            .authenticated_session_binding(original.principal())
            .map_err(|_| StockError::AuthorityChanged)
    }
}

#[derive(Clone)]
struct DownloadHandle {
    token: String,
    context: String,
    session: [u8; 32],
    scope: Scope,
    asset_id: String,
    record_digest: String,
    data: Value,
    expires: Instant,
}

/// Share once across the existing host's issuance and redemption adapters.
/// At most 1000 five-minute handles globally and 64 per authenticated session,
/// with no restart persistence. Unexpired handles remain; existing same-context
/// handles are reused before checking capacity for a new issuance.
#[derive(Clone, Default)]
pub struct AtlasDownloadHandles(Arc<Mutex<VecDeque<DownloadHandle>>>);

pub struct UnavailableAtlasDownloads;
impl<P, W, G> StockQueryPort<P, W, G> for UnavailableAtlasDownloads {
    fn query(&mut self, _: &P, _: &PreparedRequest<W, G>) -> StockResult<OwnerResult> {
        Err(StockError::OwnerUnavailable)
    }
}

/// Borrow the same genuine Media storage/access/vault composition. No byte
/// reader, renderer, vault, grant issuer or provider framework is duplicated.
pub struct NativeAtlasAssetDownloads<'a, S, A, E, C> {
    media: &'a MediaService<'a, S, A>,
    storage: &'a S,
    sessions: &'a E,
    contracts: &'a C,
    handles: AtlasDownloadHandles,
}
impl<'a, S, A, E, C> NativeAtlasAssetDownloads<'a, S, A, E, C> {
    /// Authenticated presentation resolution using the real managed Media HEAD
    /// path, without HTTP/link fetches. Projects this issuer's existing deadline
    /// only after current record/bytes/session checks. The host additionally
    /// validates its original stock result/prepared witness/disclosure graph.
    /// No frozen wire3 field is added and no deadline is renewed. Availability
    /// may change sooner; no source-change subscription is manufactured here.
    pub fn resolve_availability<P>(
        &self,
        principal: &P,
        token: &str,
        budget: &WorkBudget,
    ) -> StockResult<DownloadAvailability>
    where
        S: MediaStoragePort<P>,
        A: MediaAccessPort<P>,
        E: AuthenticatedSessionPort<P>,
    {
        budget.check().map_err(media_error)?;
        // Access validation precedes selector lookup. Missing/retired handles
        // carry no link; permission failures remain owner errors.
        let session = self.sessions.authenticated_session_binding(principal)?;
        let present = self
            .handles
            .0
            .lock()
            .map_err(|_| StockError::OwnerUnavailable)?
            .iter()
            .any(|h| h.token == token && h.session == session && h.expires > Instant::now());
        if !present {
            return Ok(DownloadAvailability::Unavailable);
        }
        match self.redeem(principal, token, ReadMethod::Head, budget) {
            Ok(_) => (),
            Err(StockError::Domain(crate::domain::DomainError::NotFound)) => {
                return Ok(DownloadAvailability::Unavailable);
            }
            Err(error) => return Err(error),
        }
        budget.check().map_err(media_error)?;
        if self.sessions.authenticated_session_binding(principal)? != session {
            return Err(StockError::AuthorityChanged);
        }
        let handles = self
            .handles
            .0
            .lock()
            .map_err(|_| StockError::OwnerUnavailable)?;
        let lifetime = handles
            .iter()
            .find(|h| h.token == token && h.session == session)
            .and_then(|h| project_issuer_lifetime(h.expires));
        Ok(
            lifetime.map_or(DownloadAvailability::Unavailable, |lifetime| {
                DownloadAvailability::Available { lifetime }
            }),
        )
    }

    pub fn new(
        media: &'a MediaService<'a, S, A>,
        storage: &'a S,
        sessions: &'a E,
        contracts: &'a C,
        handles: AtlasDownloadHandles,
    ) -> Self {
        Self {
            media,
            storage,
            sessions,
            contracts,
            handles,
        }
    }

    fn current<P>(&self, p: &P, scope: &Scope, asset_id: &str) -> StockResult<AssetRecord>
    where
        S: MediaStoragePort<P>,
    {
        let stored = self
            .storage
            .read_owned_asset(p, scope, asset_id)
            .map_err(media_error)?;
        validate_current_asset(stored, scope, asset_id)
    }

    /// The root output authorizer checks the actual registered handle through
    /// this method using the original P/prepared request and the shared cache.
    /// It must additionally discharge its captured witness/graph obligations.
    pub fn validate_issued<P, W, G>(
        &self,
        principal: &P,
        prepared: &PreparedRequest<W, G>,
        data: &Value,
    ) -> StockResult<()>
    where
        S: MediaStoragePort<P>,
        E: AuthenticatedSessionPort<P>,
    {
        let request = prepared.request();
        if request.id() != OperationId::AtlasAssetDownload {
            return Err(StockError::CorrelationMismatch);
        }
        let session = self.sessions.authenticated_session_binding(principal)?;
        let scope = Scope {
            workspace_id: request.context().workspace_id.clone(),
            home_id: request.context().home_id.clone(),
        };
        let asset_id = request.target()["recordId"]
            .as_str()
            .ok_or(StockError::InvalidContract)?;
        let current = self.current(principal, &scope, asset_id)?;
        let record_digest = canonical_digest(&json!(current))?;
        let context = canonical_digest(&json!({"session":session,
            "request":request.raw(),"recordDigest":record_digest}))?;
        let handles = self
            .handles
            .0
            .lock()
            .map_err(|_| StockError::OwnerUnavailable)?;
        if !handles.iter().any(|h| {
            h.context == context
                && h.session == session
                && h.scope == scope
                && h.asset_id == asset_id
                && h.record_digest == record_digest
                && h.data == *data
                && h.expires > Instant::now()
        }) {
            return Err(StockError::AuthorityChanged);
        }
        Ok(())
    }

    /// Redeem through the managed Media GET/HEAD path. Token supplies no scope
    /// override and no grant; the current authenticated caller supplies P.
    pub fn redeem<P>(
        &self,
        principal: &P,
        token: &str,
        method: ReadMethod,
        budget: &WorkBudget,
    ) -> StockResult<MediaResponse>
    where
        S: MediaStoragePort<P>,
        A: MediaAccessPort<P>,
        E: AuthenticatedSessionPort<P>,
    {
        let session = self.sessions.authenticated_session_binding(principal)?;
        let handle = {
            let mut handles = self
                .handles
                .0
                .lock()
                .map_err(|_| StockError::OwnerUnavailable)?;
            handles.retain(|h| h.expires > Instant::now());
            handles
                .iter()
                .find(|h| h.token == token && h.session == session)
                .cloned()
                .ok_or(StockError::AuthorityChanged)?
        };
        let record = self.current(principal, &handle.scope, &handle.asset_id)?;
        if canonical_digest(&json!(record))? != handle.record_digest {
            return Err(StockError::AuthorityChanged);
        }
        let descriptor = OwnedDescriptor::AtlasAsset {
            asset_id: handle.asset_id.clone(),
        };
        let response = self
            .media
            .deliver(
                principal,
                &handle.scope,
                &descriptor,
                method,
                DeliveryMode::Download,
                budget,
            )
            .map_err(media_error)?;
        let current = self.current(principal, &handle.scope, &handle.asset_id)?;
        if canonical_digest(&json!(current))? != handle.record_digest
            || self.sessions.authenticated_session_binding(principal)? != session
            || handle.expires <= Instant::now()
        {
            return Err(StockError::AuthorityChanged);
        }
        Ok(response)
    }
}

impl<P, W, G, S, A, E, C> StockQueryPort<P, W, G> for NativeAtlasAssetDownloads<'_, S, A, E, C>
where
    S: MediaStoragePort<P>,
    A: MediaAccessPort<P>,
    E: AuthenticatedSessionPort<P>,
    C: StockContractPort,
{
    fn query(
        &mut self,
        principal: &P,
        prepared: &PreparedRequest<W, G>,
    ) -> StockResult<OwnerResult> {
        let request = prepared.request();
        if request.id() != OperationId::AtlasAssetDownload {
            return Err(StockError::OwnerUnavailable);
        }
        self.contracts
            .validate(request.operation().input_schema, request.raw())?;
        let scope = Scope {
            workspace_id: request.context().workspace_id.clone(),
            home_id: request.context().home_id.clone(),
        };
        let asset_id = request.target()["recordId"]
            .as_str()
            .ok_or(StockError::InvalidContract)?;
        let session = self.sessions.authenticated_session_binding(principal)?;
        let record = self.current(principal, &scope, asset_id)?;
        let record_digest = canonical_digest(&json!(record))?;
        let context = canonical_digest(&json!({"session":session,
            "request":request.raw(),"recordDigest":record_digest}))?;
        let saved = {
            let mut handles = self
                .handles
                .0
                .lock()
                .map_err(|_| StockError::OwnerUnavailable)?;
            handles.retain(|h| h.expires > Instant::now());
            handles
                .iter()
                .find(|h| h.session == session && h.context == context)
                .cloned()
        };
        let data = if let Some(saved) = saved {
            saved.data
        } else {
            let budget = WorkBudget::new(Duration::from_secs(10), Cancellation::default())
                .map_err(media_error)?;
            let descriptor = OwnedDescriptor::AtlasAsset {
                asset_id: asset_id.into(),
            };
            self.media
                .deliver(
                    principal,
                    &scope,
                    &descriptor,
                    ReadMethod::Head,
                    DeliveryMode::Download,
                    &budget,
                )
                .map_err(media_error)?;
            let current = self.current(principal, &scope, asset_id)?;
            if current != record
                || self.sessions.authenticated_session_binding(principal)? != session
            {
                return Err(StockError::AuthorityChanged);
            }
            let token = token()?;
            let data = json!({"target":request.target(),"downloadToken":token,
                "sha256":record.payload.sha256,"byteSize":record.payload.byte_size,
                "contentType":record.payload.content_type,"disposition":"attachment"});
            let mut handles = self
                .handles
                .0
                .lock()
                .map_err(|_| StockError::OwnerUnavailable)?;
            // The same exact prepared read can be recomputed for disclosure.
            // Concurrent qualification is held; a matching immutable handle is
            // simply reused rather than minting a different result carrier.
            if let Some(saved) = handles.iter().find(|h| {
                h.session == session && h.context == context && h.expires > Instant::now()
            }) {
                saved.data.clone()
            } else {
                if handles.iter().any(|h| h.token == token) {
                    return Err(StockError::OwnerUnavailable);
                }
                handles.retain(|h| h.expires > Instant::now());
                if handles.len() >= 1000
                    || handles.iter().filter(|h| h.session == session).count()
                        >= MAX_HANDLES_PER_SESSION
                {
                    return Err(StockError::OwnerUnavailable);
                }
                handles.push_back(DownloadHandle {
                    token,
                    context,
                    session,
                    scope,
                    asset_id: asset_id.into(),
                    record_digest,
                    data: data.clone(),
                    expires: Instant::now() + Duration::from_secs(300),
                });
                data
            }
        };
        let wire = json!({"schemaVersion":3,"commandId":request.id().as_str(),
            "requestId":request.request_id(),"resolvedScope":request.context(),
            "status":"read","replayed":false,"data":data});
        self.contracts
            .validate(request.operation().output_schema, &wire)?;
        Ok(OwnerResult {
            wire,
            children: Vec::new(),
        })
    }
}

// Classify only after the existing authorized storage read. Owner-data
// inconsistencies are distinct from ordinary download eligibility failures.
fn validate_current_asset(
    stored: StoredAsset,
    scope: &Scope,
    asset_id: &str,
) -> StockResult<AssetRecord> {
    let record = stored.record;
    record.validate().map_err(media_error)?;
    if record.scope() != *scope
        || record.record_id != asset_id
        || stored.manifest != record.payload
        || record.payload.byte_size > crate::media::MAX_BYTES as u64
    {
        return Err(StockError::CorrelationMismatch);
    }
    if record.lifecycle != Lifecycle::Active
        || record.payload.availability != Availability::Available
        || !record.payload.purpose.is_original()
    {
        return Err(StockError::Domain(crate::domain::DomainError::NotFound));
    }
    Ok(record)
}

fn token() -> StockResult<String> {
    let mut bytes = [0_u8; 16];
    getrandom::fill(&mut bytes).map_err(|_| StockError::OwnerUnavailable)?;
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    let hex: String = bytes.iter().map(|byte| format!("{byte:02x}")).collect();
    Ok(format!(
        "{}-{}-{}-{}-{}",
        &hex[..8],
        &hex[8..12],
        &hex[12..16],
        &hex[16..20],
        &hex[20..]
    ))
}
fn media_error(error: MediaError) -> StockError {
    match error {
        MediaError::Unauthenticated | MediaError::Forbidden => StockError::CapabilityDenied,
        MediaError::Conflict => StockError::AuthorityChanged,
        MediaError::NotFound => StockError::Domain(crate::domain::DomainError::NotFound),
        _ => StockError::OwnerUnavailable,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    // Pure owner-error conversion: no storage, authority or media work runs.
    #[test]
    fn media_absence_preserves_not_found() {
        assert_eq!(MediaError::NotFound.status(), 404);
        assert_eq!(
            media_error(MediaError::NotFound),
            StockError::Domain(crate::domain::DomainError::NotFound)
        );
        assert_eq!(MediaError::Unavailable.status(), 503);
        assert_eq!(
            media_error(MediaError::Unavailable),
            StockError::OwnerUnavailable
        );
    }

    fn stored_asset() -> StoredAsset {
        let record: AssetRecord = serde_json::from_value(json!({
            "schemaVersion":1,"recordType":"asset",
            "recordId":"00000000-0000-4000-8000-000000000600",
            "workspaceId":"00000000-0000-4000-8000-000000000001",
            "homeId":"00000000-0000-4000-8000-000000000002",
            "revision":1,"lifecycle":"active",
            "createdAt":"2026-02-01T12:00:00Z","updatedAt":"2026-02-01T12:00:00Z",
            "lastAuditId":"00000000-0000-4000-8000-000000010600",
            "payload":{"owner":"atlas","purpose":"evidence-original",
                "storageKey":"synthetic/original-600","sha256":"a".repeat(64),
                "byteSize":42,"contentType":"text/plain",
                "sourceLicense":{"status":"unknown","reference":null},
                "availability":"available","previewPolicy":"download-only",
                "evidenceIds":["00000000-0000-4000-8000-000000000100"]}
        }))
        .expect("valid synthetic Media record");
        StoredAsset {
            manifest: record.payload.clone(),
            record,
        }
    }

    // Pure record classification, not a storage/authorization failure control.
    #[test]
    fn download_eligibility_preserves_not_found() {
        use crate::media::types::AssetPurpose;
        let original = stored_asset();
        let scope = original.record.scope();
        let id = original.record.record_id.clone();
        assert_eq!(
            validate_current_asset(stored_asset(), &scope, &id),
            Ok(original.record)
        );
        for (lifecycle, availability, purpose) in [
            (
                Lifecycle::Tombstoned,
                Availability::Available,
                AssetPurpose::EvidenceOriginal,
            ),
            (
                Lifecycle::Active,
                Availability::Missing,
                AssetPurpose::EvidenceOriginal,
            ),
            (
                Lifecycle::Active,
                Availability::Available,
                AssetPurpose::DerivedPreview,
            ),
        ] {
            let mut stored = stored_asset();
            stored.record.lifecycle = lifecycle;
            stored.record.payload.availability = availability;
            stored.record.payload.purpose = purpose;
            stored.manifest = stored.record.payload.clone();
            assert_eq!(
                validate_current_asset(stored, &scope, &id),
                Err(StockError::Domain(crate::domain::DomainError::NotFound))
            );
        }
    }

    #[test]
    fn inconsistent_owner_data_keeps_correlation_error() {
        let original = stored_asset();
        let scope = original.record.scope();
        let id = original.record.record_id;
        for mismatch in 0..4 {
            let mut stored = stored_asset();
            match mismatch {
                0 => stored.record.home_id = "00000000-0000-4000-8000-000000000003".into(),
                1 => stored.record.record_id = "00000000-0000-4000-8000-000000000601".into(),
                2 => stored.manifest.byte_size += 1,
                _ => {
                    stored.record.payload.byte_size = crate::media::MAX_BYTES as u64 + 1;
                    stored.manifest = stored.record.payload.clone();
                }
            }
            // Ineligibility must not erase a genuine owner inconsistency.
            stored.record.lifecycle = Lifecycle::Tombstoned;
            assert_eq!(
                validate_current_asset(stored, &scope, &id),
                Err(StockError::CorrelationMismatch)
            );
        }
    }
}
