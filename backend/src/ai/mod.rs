//! Embeddable AI orchestration and adapters behind injected trusted boundaries.
//! No live credentials, HTTP client, listener or domain implementation is installed.
pub mod connection;
pub mod oauth;
pub mod ports;
pub mod responses;
pub mod runner;
pub mod runtime;
pub mod stock;
pub mod transport;
pub mod types;

#[cfg(test)]
mod healthy_examples;

pub use connection::*;
pub use ports::*;
pub use responses::ResponsesRequest;
pub use runner::{AiRunner, RunLimits};
pub use stock::{DomainDispatch, DomainDispatchState, ReviewChallenge};
pub use types::*;
pub mod host;
