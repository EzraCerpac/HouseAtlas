//! Passive Network inventory component. The host owns authorization, transport
//! configuration, single-flight scheduling and atomic durable publication.
mod adapter;
mod facet;
mod json;
mod model;
mod projection;
mod sidecar;

pub use adapter::*;
pub use facet::*;
pub use model::*;
pub use projection::{NetworkCapture, project_capture, validate_state};
pub use sidecar::*;

#[cfg(test)]
mod healthy;
