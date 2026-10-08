//! Embeddable MCP protocol adapter. The host owns framing, connection lifetime,
//! timeouts and trusted request context; peers own all domain/access decisions.
//!
//! No listener, credential/grant provisioner, provider client or domain command
//! implementation is included. See `README.md` for the integration contract.

mod adapter;
mod asset_download;
mod local_atlas;
mod native_catalog;
mod native_context;
mod native_schemas;
mod native_service;
mod operation_mapping;
mod ports;
mod protocol;

pub use asset_download::{
    AssetDownloadCodec, AssetDownloadMetadata, AssetDownloadPort, AssetDownloadRequest,
    AssetDownloadResult, UnavailableAssetDownloads,
};
pub use local_atlas::{LocalAtlasBindError, LocalAtlasSession, bind_local_atlas};
pub use native_catalog::{NativeCatalog, NativeOperation, NativeOutput};
pub use native_context::{NativeContext, NativePrincipal, NativePrincipalPort, NativeRequirement};
pub use native_schemas::NativeSchemas;
pub use native_service::NativeQueries;
pub use native_service::{NativeStockService, UnavailableCommands};
pub use operation_mapping::{OperationMapping, ToolName};

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

#[cfg(test)]
mod healthy_mappings;

#[cfg(test)]
mod healthy_download;

#[cfg(test)]
mod healthy_local_atlas;

pub mod lifecycle;
