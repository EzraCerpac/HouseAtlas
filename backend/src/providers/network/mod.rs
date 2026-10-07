//! Passive Network inventory component. The host owns authorization, transport
//! configuration, single-flight scheduling and atomic durable publication.
mod adapter;
mod durable;
mod facet;
mod http;
mod json;
mod link_binding;
mod model;
mod native;
mod projection;
mod publication;
mod saved_queries;
mod sidecar;

pub use adapter::*;
pub use durable::*;
pub use facet::*;
pub use http::*;
pub use link_binding::*;
pub use model::*;
pub use native::*;
pub use projection::{NetworkCapture, project_capture, validate_generation, validate_state};
pub use publication::*;
pub use saved_queries::*;
pub use sidecar::*;

#[cfg(test)]
mod healthy;

#[cfg(test)]
mod transport_healthy;
