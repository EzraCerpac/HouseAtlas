//! Explicit source-only fresh selection, never routed to the existing installer.
use super::{Error, Result, StoreOptions};

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub enum PresenceProfileSelection {
    /// Preserve the existing schema-5/schema-6 selector and behavior.
    #[default]
    Disabled,
    /// Distinct fresh-only schema. Selecting it is currently unavailable.
    FreshV7,
}

/// Definition metadata is DATA, not a profile permit or historical evidence.
#[derive(Debug, Clone, Copy)]
pub struct PresenceProfileDefinition {
    pub version: u32,
    pub lineage: &'static str,
    pub migration_filename: &'static str,
    pub migration_sha256: &'static str,
    pub availability: &'static str,
}

pub fn presence_profile_definition() -> PresenceProfileDefinition {
    PresenceProfileDefinition {
        version: 7,
        lineage: "houseatlas-rust-storage/presence/1",
        migration_filename: "0007_presence_witnesses.sql",
        migration_sha256: "ec068be08a509d8ff2ce554e3d0e20d54a979c07d0ff3d506a5d7e89dcfd94a0",
        availability: "unavailable-independent-historical-custody-required",
    }
}

// The schema is included for compilation/source identity; no installer executes it.
#[expect(
    dead_code,
    reason = "Fresh definition is held; existing migration catalogs are unchanged"
)]
pub(crate) const FRESH_PRESENCE_SCHEMA: &str =
    include_str!("../../migrations/0007_presence_witnesses.sql");

impl StoreOptions {
    /// Reject before opening any database handle, PRAGMA, migration or WAL work.
    /// The same gate is required by every existing-database reopen path.
    pub(crate) fn require_available_profile(&self) -> Result<()> {
        if self.presence_profile == PresenceProfileSelection::FreshV7 {
            return Err(Error::new(
                "upstream-unavailable",
                "Fresh presence profile requires independent original historical custody and exhaustive profile admission",
            ));
        }
        Ok(())
    }
}
