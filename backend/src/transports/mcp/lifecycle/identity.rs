use std::sync::{Arc, Mutex};

use sha2::{Digest, Sha256};
use subtle::ConstantTimeEq;

use crate::access::{self as a, AccessBoundary, AccessError, RequestEvidence};

use super::super::PortError;

/// Opaque issuance from actual POST evidence. It is neither a grant nor a DTO.
/// The host can replace its existing AT11 authorize call with this call, keeping
/// the observed method, cookie, Origin and CSRF unchanged.
#[derive(Clone)]
pub struct AuthenticatedIdentity {
    pub(super) access: Arc<Mutex<AccessBoundary>>,
    original: a::Principal,
    binding: CredentialBinding,
}

impl AuthenticatedIdentity {
    pub fn authenticate_post(
        access: Arc<Mutex<AccessBoundary>>,
        observed: &RequestEvidence<'_>,
        scope: &a::Scope,
    ) -> Result<Self, AccessError> {
        if observed.method != a::Method::Post {
            return Err(AccessError::MethodNotAllowed);
        }
        let mut boundary = access.lock().map_err(|_| AccessError::Unavailable)?;
        let original = boundary.authorize(observed, scope, a::Action::Mutate)?;
        // Parse only after actual Access authorization. This digest identifies
        // the credential already checked by Access; it never authenticates it.
        let binding = CredentialBinding::from_observed(observed)?;
        drop(boundary);
        Ok(Self {
            access,
            original,
            binding,
        })
    }

    pub fn original(&self) -> &a::Principal {
        &self.original
    }

    pub(super) fn release_with(&self, current: &Self) -> Result<(), PortError> {
        if !Arc::ptr_eq(&self.access, &current.access)
            || !self.binding.matches(&current.binding)
            || self.original.scope() != current.original.scope()
        {
            return Err(PortError::Forbidden);
        }
        let boundary = self.access.lock().map_err(|_| PortError::Unavailable)?;
        boundary
            .revalidate(&current.original)
            .and_then(|_| boundary.revalidate(&self.original))
            .map(|_| ())
            .map_err(public_access_error)
    }

    pub(super) fn matches_rotation(&self, event: &ConfirmedRotation) -> bool {
        Arc::ptr_eq(&self.access, &event.access) && self.binding.matches(&event.previous)
    }
}

/// Host-local notice produced only after the real Access rotation commits.
/// It carries no cookie, CSRF, replacement principal, grant or public DTO.
/// Apply to the host's MCP controls and then its existing session-change hook.
pub struct ConfirmedRotation {
    access: Arc<Mutex<AccessBoundary>>,
    previous: CredentialBinding,
}

/// Substitute for the host's rotate_session call; keep its actual receipt and
/// response formatting. Deliver the notice after releasing Core/Access locks.
pub fn rotate_confirmed(
    access: Arc<Mutex<AccessBoundary>>,
    observed: &RequestEvidence<'_>,
) -> Result<(a::SessionReceipt, ConfirmedRotation), AccessError> {
    let mut boundary = access.lock().map_err(|_| AccessError::Unavailable)?;
    // Calculate the binding before rotation but publish no event until success.
    let previous = CredentialBinding::from_observed(observed)?;
    let receipt = boundary.rotate_session(observed)?;
    drop(boundary);
    Ok((receipt, ConfirmedRotation { access, previous }))
}

struct CredentialBinding([u8; 32]);

impl Clone for CredentialBinding {
    fn clone(&self) -> Self {
        Self(self.0)
    }
}

impl CredentialBinding {
    fn from_observed(observed: &RequestEvidence<'_>) -> Result<Self, AccessError> {
        let mut tokens = observed
            .cookie
            .ok_or(AccessError::Unauthenticated)?
            .split(';')
            .map(str::trim)
            .filter_map(|part| {
                let (key, value) = part.split_once('=').unwrap_or((part, ""));
                (key == a::SESSION_COOKIE).then_some(value)
            });
        let token = tokens.next().ok_or(AccessError::Unauthenticated)?;
        if tokens.next().is_some() {
            return Err(AccessError::Unauthenticated);
        }
        let origin = url::Url::parse(observed.url)
            .map_err(|_| AccessError::InvalidInput)?
            .origin()
            .ascii_serialization();
        let mut digest = Sha256::new();
        digest.update(origin.as_bytes());
        digest.update([0]);
        digest.update(token.as_bytes());
        Ok(Self(digest.finalize().into()))
    }

    fn matches(&self, other: &Self) -> bool {
        bool::from(self.0.ct_eq(&other.0))
    }
}

pub(super) fn public_access_error(error: AccessError) -> PortError {
    match error {
        AccessError::Unauthenticated => PortError::Unauthenticated,
        AccessError::Forbidden | AccessError::RateLimited | AccessError::NotFound => {
            PortError::Forbidden
        }
        _ => PortError::Unavailable,
    }
}
