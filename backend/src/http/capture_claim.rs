//! Closed browser selection claims for multipart v2; no source or storage authority.
use serde::{Deserialize, Serialize};
use time::{OffsetDateTime, format_description::well_known::Rfc3339};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct BrowserSelectionClaim {
    pub schema_version: u8,
    pub selection_method: SelectionMethod,
    pub selected_at: String,
    pub filename: String,
    pub reported_content_type: String,
    pub byte_origin: ByteOrigin,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum SelectionMethod {
    CameraRequest,
    PhotoPicker,
    FilePicker,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum ByteOrigin {
    BrowserReturnedUnmodified,
}

impl BrowserSelectionClaim {
    pub fn validate(&self, filename: &str) -> bool {
        self.schema_version == 1
            && self.filename == filename
            && self.selected_at.len() <= 64
            && OffsetDateTime::parse(&self.selected_at, &Rfc3339).is_ok()
            && self.reported_content_type.chars().count() <= 255
            && !self.reported_content_type.chars().any(char::is_control)
    }
    /// Opaque browser-claimed provenance text, compatible with prior Atlas readers.
    pub fn vantage(&self) -> String {
        // This closed DTO contains no fallible serializers. Its validated fields
        // are bounded by multipart intake, not accepted as source/device facts.
        format!(
            "Browser selection claim v1: {}",
            serde_json::to_string(self).expect("closed claim serialization")
        )
    }
}
