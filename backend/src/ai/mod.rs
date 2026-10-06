//! Embeddable AI orchestration. No credentials, provider transport, listener or
//! domain implementation lives here. The host supplies verified server context.
pub mod connection;
pub mod ports;
pub mod responses;
pub mod runner;
pub mod types;

#[cfg(test)]
mod healthy_examples;

pub use connection::*;
pub use ports::*;
pub use responses::ResponsesRequest;
pub use runner::{AiRunner, RunLimits};
pub use types::*;
