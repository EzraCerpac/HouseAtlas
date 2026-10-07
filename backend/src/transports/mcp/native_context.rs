use std::{
    future::ready,
    sync::{Arc, Mutex},
};

use crate::access::{self, AccessBoundary, AccessError, Capability, Scope};

use super::{PortError, PortFuture, PrincipalPort, PublicToolFailure};

/// A host-created context carrying an already issued access principal.
/// Cloning the context preserves its identity and the original authority.
#[derive(Clone)]
pub struct NativeContext {
    original: Arc<access::Principal>,
}

impl NativeContext {
    pub fn from_principal(principal: access::Principal) -> Self {
        Self {
            original: Arc::new(principal),
        }
    }
}

/// An opaque handle to the exact principal supplied by the host context.
/// No MCP argument or catalog requirement can change its issuance authority.
#[derive(Clone)]
pub struct NativePrincipal {
    original: Arc<access::Principal>,
}

impl NativePrincipal {
    pub fn original(&self) -> &access::Principal {
        self.original.as_ref()
    }

    pub(crate) fn same_context(&self, other: &Self) -> bool {
        Arc::ptr_eq(&self.original, &other.original)
    }
}

#[derive(Clone, Copy)]
enum RequiredAction {
    Read,
    History,
    Mutation,
}

/// The catalog supplies the canonical operation scope and access capability.
/// Construction stays inside the application crate, outside MCP input decoding.
#[derive(Clone)]
pub struct NativeRequirement {
    scope: Scope,
    action: RequiredAction,
}

impl NativeRequirement {
    pub(crate) fn read(scope: Scope) -> Self {
        Self {
            scope,
            action: RequiredAction::Read,
        }
    }

    pub(crate) fn history(scope: Scope) -> Self {
        Self {
            scope,
            action: RequiredAction::History,
        }
    }

    pub(crate) fn mutation(scope: Scope) -> Self {
        Self {
            scope,
            action: RequiredAction::Mutation,
        }
    }

    fn capability(&self) -> Capability<'static> {
        match self.action {
            RequiredAction::Read => Capability::Read,
            RequiredAction::History => Capability::ReadHistory,
            RequiredAction::Mutation => Capability::Mutate,
        }
    }
}

/// Delegates current provenance, scope and capability checks to AT11 access.
/// The host shares the same boundary used to issue the original principal.
#[derive(Clone)]
pub struct NativePrincipalPort {
    access: Arc<Mutex<AccessBoundary>>,
}

impl NativePrincipalPort {
    pub fn new(access: Arc<Mutex<AccessBoundary>>) -> Self {
        Self { access }
    }

    fn with_boundary<T>(
        &self,
        operation: impl FnOnce(&AccessBoundary) -> Result<T, AccessError>,
    ) -> Result<T, PortError> {
        let boundary = self.access.lock().map_err(|_| PortError::Unavailable)?;
        operation(&boundary).map_err(public_access_error)
    }
}

impl PrincipalPort for NativePrincipalPort {
    type Context = NativeContext;
    type Principal = NativePrincipal;
    type Requirement = NativeRequirement;

    fn resolve<'a>(&'a self, context: &'a NativeContext) -> PortFuture<'a, NativePrincipal> {
        let result = self.with_boundary(|boundary| {
            let original = context.original.as_ref();
            boundary.revalidate(original)?;
            boundary.authorize_storage(original, original.scope(), Capability::Read)?;
            Ok(NativePrincipal {
                original: Arc::clone(&context.original),
            })
        });
        Box::pin(ready(result))
    }

    fn authorize<'a>(
        &'a self,
        context: &'a NativeContext,
        requirement: &'a NativeRequirement,
    ) -> PortFuture<'a, NativePrincipal> {
        let result = self.with_boundary(|boundary| {
            let original = context.original.as_ref();
            boundary.revalidate(original)?;
            boundary.authorize_storage(original, &requirement.scope, requirement.capability())?;
            if matches!(requirement.action, RequiredAction::Mutation) {
                boundary.assert_mutation(original)?;
            }
            Ok(NativePrincipal {
                original: Arc::clone(&context.original),
            })
        });
        Box::pin(ready(result))
    }

    fn revalidate<'a>(
        &'a self,
        context: &'a NativeContext,
        principal: &'a NativePrincipal,
    ) -> PortFuture<'a, ()> {
        let result = if Arc::ptr_eq(&context.original, &principal.original) {
            self.with_boundary(|boundary| boundary.revalidate(principal.original()).map(|_| ()))
        } else {
            Err(PortError::Unauthenticated)
        };
        Box::pin(ready(result))
    }
}

fn public_access_error(error: AccessError) -> PortError {
    match error {
        AccessError::Unauthenticated => PortError::Unauthenticated,
        AccessError::Forbidden | AccessError::RateLimited => PortError::Forbidden,
        AccessError::NotFound => PortError::ToolFailure(PublicToolFailure {
            code: "not-found",
            message: "Resource unavailable",
            data: None,
        }),
        AccessError::InvalidInput | AccessError::MethodNotAllowed | AccessError::BodyTooLarge => {
            PortError::ToolFailure(PublicToolFailure {
                code: "invalid-contract",
                message: "Invalid request",
                data: None,
            })
        }
        AccessError::Unavailable => PortError::Unavailable,
    }
}
