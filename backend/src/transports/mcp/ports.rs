use std::{future::Future, pin::Pin};

use super::{JsonObject, ToolPage, ToolResult};

pub type PortFuture<'a, T> = Pin<Box<dyn Future<Output = Result<T, PortError>> + Send + 'a>>;

/// An explicitly public, stable error from the canonical service/catalog.
/// Never convert raw provider, database or authentication error text into this.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct PublicToolFailure {
    pub code: &'static str,
    pub message: &'static str,
    /// Optional canonical public error DTO, already validated and sanitized by
    /// its owner. Preserves authorized revision/request metadata without the
    /// protocol adapter duplicating or fabricating the application error schema.
    pub data: Option<JsonObject>,
}

/// Protocol mapping categories, not a replacement for domain or access rules.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum PortError {
    Unauthenticated,
    Forbidden,
    UnknownTool,
    InvalidCursor,
    ToolFailure(PublicToolFailure),
    Unavailable,
}

/// Resolve a principal from a host-created context, never MCP arguments or
/// clientInfo. Revalidate before returning protected results after awaited work.
/// Action, home, source and mutation authority remain with the canonical peers.
pub trait PrincipalPort: Send + Sync {
    type Context: Send + Sync;
    type Principal: Send + Sync;
    /// Shared typed scope/action requirement supplied by the application catalog.
    type Requirement: Send + Sync;

    /// A catalog/read principal. This alone must never authorize a mutation.
    fn resolve<'a>(&'a self, context: &'a Self::Context) -> PortFuture<'a, Self::Principal>;

    /// Mint an action-bound principal from the host context and the canonical
    /// requirement. It must not promote or copy the earlier catalog principal.
    fn authorize<'a>(
        &'a self,
        context: &'a Self::Context,
        requirement: &'a Self::Requirement,
    ) -> PortFuture<'a, Self::Principal>;

    fn revalidate<'a>(
        &'a self,
        context: &'a Self::Context,
        principal: &'a Self::Principal,
    ) -> PortFuture<'a, ()>;
}

/// Canonical catalog output; the adapter neither constructs nor interprets
/// domain scope/action requirements. Its generic types can be AT51-owned DTOs.
pub struct PreparedOperation<Operation, Requirement> {
    pub operation: Operation,
    pub requirement: Requirement,
}

/// The shared application catalog owns tool names, schemas, scope selection,
/// canonical argument validation and typed operation construction. Listing must
/// contain only currently available tools for this principal. Cursors are opaque
/// and must be bound to the current principal/catalog scope by this peer.
///
/// `prepare` must resolve against that same authorized catalog even if the client
/// has never called tools/list. `render` owns the published output DTO/schema and
/// preserves audit order, unknowns, revisions, provenance and source partitions.
/// Descriptors must use MCP's object input/output schema form (root type object),
/// with locally resolved references and the declared/default JSON Schema dialect.
pub trait CatalogPort<Principal>: Send + Sync {
    type Operation: Send;
    type Output: Send;
    type Requirement: Send + Sync;

    fn list(&self, principal: &Principal, cursor: Option<&str>) -> Result<ToolPage, PortError>;

    fn prepare(
        &self,
        principal: &Principal,
        name: &str,
        arguments: JsonObject,
    ) -> Result<PreparedOperation<Self::Operation, Self::Requirement>, PortError>;

    fn render(&self, name: &str, output: Self::Output) -> Result<ToolResult, PortError>;
}

/// Executes a catalog-produced typed operation using the verified principal.
/// This is the existing application service boundary, not an HTTP/proxy client.
/// Peers enforce current action/scope/source authority and atomic persistence.
/// The host must not cancel an in-flight write without service-owned semantics.
pub trait ServicePort<Principal, Operation>: Send + Sync {
    type Output: Send;

    fn execute<'a>(
        &'a self,
        principal: &'a Principal,
        operation: Operation,
    ) -> PortFuture<'a, Self::Output>;
}
