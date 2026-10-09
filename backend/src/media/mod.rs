//! Owned media primitives for the HouseAtlas modular monolith.
//!
//! Storage and access remain authoritative through the ports below. This module
//! opens no listener, calls no provider, and contains no database migrations.

#![forbid(unsafe_code)]

#[cfg(not(any(target_os = "linux", target_os = "macos")))]
compile_error!("The private media filesystem currently supports Linux and macOS");

mod budget;
pub mod content;
pub mod download_lifetime;
pub mod homebox_artifacts;
pub mod homebox_pinned_artifacts;
pub mod native;
pub mod native_policy_archive;
pub mod native_policy_intake;
pub mod native_policy_reference;
pub mod native_queued_quantity;
pub mod native_queued_upload;
pub mod native_queued_upload_archived;
pub mod native_queued_upload_archived_body;
pub mod native_queued_upload_recovery;
pub mod native_recovery;
mod platform_fs;
mod private_fs;
pub mod recovery;
pub mod recovery_policy;
pub mod recovery_policy_archive;
mod recovery_policy_archive_codec;
pub mod review;
pub mod service;
pub mod staged_upload;
pub mod types;
pub mod vault;

#[cfg(test)]
mod healthy_examples;
#[cfg(test)]
mod healthy_native_examples;
#[cfg(test)]
mod healthy_review_examples;
#[cfg(test)]
mod healthy_upload_examples;

pub use budget::{Cancellation, WorkBudget};
pub use download_lifetime::{DownloadAvailability, DownloadLifetime};
pub(crate) use private_fs::PrivateDir;
pub use types::{MediaError, MediaResult};
pub use vault::AssetVault;

pub const MEDIA_VERSION: &str = "0.1.1";
pub const MAX_BYTES: usize = 10 * 1024 * 1024;
