//! Embeddable MCP protocol adapter. The host owns framing, connection lifetime,
//! timeouts and trusted request context; peers own all domain/access decisions.
//!
//! No listener, credential/grant provisioner, provider client or domain command
//! implementation is included. See `README.md` for the integration contract.

mod adapter;
mod ports;
mod protocol;

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
