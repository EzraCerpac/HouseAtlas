//! Held fresh-only definition. It does not enter the runtime migration catalog.

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub enum QueueOriginalPreparationProfileSelection {
    /// Preserve the existing schema-5/schema-6 selector and behavior.
    #[default]
    Disabled,
    /// Schema 1..6 plus the immutable initial preparation cut; currently held.
    FreshV8,
}

/// Source metadata only; neither an admission permit nor historical evidence.
#[derive(Debug, Clone)]
pub struct QueueOriginalPreparationProfileDefinition {
    pub version: u32,
    pub lineage: &'static str,
    pub migration_versions: &'static [u32],
    pub migration_filename: &'static str,
    pub migration_sha256: String,
    pub availability: &'static str,
}

pub fn queue_original_preparation_profile_definition() -> QueueOriginalPreparationProfileDefinition
{
    QueueOriginalPreparationProfileDefinition {
        version: 8,
        lineage: "houseatlas-rust-storage/queue-original-preparation/1",
        migration_versions: &[1, 2, 3, 4, 5, 6, 8],
        migration_filename: "0008_queue_original_preparation.sql",
        migration_sha256: super::migrations::sha256(include_str!(
            "../../migrations/0008_queue_original_preparation.sql"
        )),
        availability: "unavailable-original-qualification-and-profile-admission-required",
    }
}
