//! Owned media primitives for the HouseAtlas modular monolith.
//!
//! Storage and access remain authoritative through the ports below. This module
//! opens no listener, calls no provider, and contains no database migrations.

#![forbid(unsafe_code)]

#[cfg(not(target_os = "linux"))]
compile_error!("The private media filesystem currently requires Linux");

mod budget;
pub mod content;
mod private_fs;
pub mod recovery;
pub mod service;
pub mod types;
pub mod vault;

#[cfg(test)]
mod healthy_examples;

pub use budget::{Cancellation, WorkBudget};
pub use types::{MediaError, MediaResult};
pub use vault::AssetVault;

pub const MEDIA_VERSION: &str = "0.1.1";
pub const MAX_BYTES: usize = 10 * 1024 * 1024;
