//! Embeddable MCP protocol adapter. The host owns framing, connection lifetime,
//! timeouts and trusted request context; peers own all domain/access decisions.
//!
//! No listener, credential/grant provisioner, provider client or domain command
//! implementation is included. See `README.md` for the integration contract.

mod adapter;
mod native_catalog;
mod native_context;
mod native_schemas;
mod native_service;
mod ports;
mod protocol;

pub use native_catalog::{NativeCatalog, NativeOperation, NativeOutput};
pub use native_context::{NativeContext, NativePrincipal, NativePrincipalPort, NativeRequirement};
pub use native_schemas::NativeSchemas;
pub use native_service::{NativeStockService, UnavailableCommands};

pub use adapter::{AdapterConfig, ConfigError, McpAdapter, Session, SessionState};
pub use ports::{
    CatalogPort, PortError, PortFuture, PreparedOperation, PrincipalPort, PublicToolFailure,
    ServicePort,
};
pub use protocol::{
    Implementation, JsonObject, PROTOCOL_VERSION, TextContent, ToolAnnotations, ToolDefinition,
    ToolPage, ToolResult,
};

#[cfg(test)]
mod healthy_examples;

#[cfg(test)]
mod healthy_native;

pub mod lifecycle;
