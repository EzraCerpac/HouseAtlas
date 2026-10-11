//! Stock HomeBox v0.26.2 wire decoding. No transport, cache or authority owner.
mod bridge;
mod decode;
mod json;
mod navigation;
mod types;

// Reuse bounded duplicate-key-aware parsing for source-only observation adapters.
pub(crate) fn parse_observation(
    bytes: &[u8],
    limits: DecodeLimits,
) -> Result<serde_json::Value, WireError> {
    let source = json::parse(bytes, limits)?;
    fn bound(
        value: &serde_json::Value,
        limits: DecodeLimits,
        entries: &mut usize,
    ) -> Result<(), WireError> {
        match value {
            serde_json::Value::String(text) if text.chars().count() > limits.max_text_chars => {
                return Err(WireError::Limit);
            }
            serde_json::Value::Array(rows) => {
                *entries = entries.checked_add(rows.len()).ok_or(WireError::Limit)?;
                if *entries > limits.max_entries {
                    return Err(WireError::Limit);
                }
                for row in rows {
                    bound(row, limits, entries)?;
                }
            }
            serde_json::Value::Object(fields) => {
                for (key, value) in fields {
                    if key.chars().count() > limits.max_text_chars {
                        return Err(WireError::Limit);
                    }
                    bound(value, limits, entries)?;
                }
            }
            _ => (),
        }
        Ok(())
    }
    bound(&source, limits, &mut 0)?;
    Ok(source)
}

pub use decode::{decode_detail, decode_maintenance, decode_page};
pub use navigation::native_route_candidates;
pub use types::*;

pub const RELEASE: &str = "v0.26.2";
pub const SOURCE_COMMIT: &str = "e01dd737238a3fa7e1a6454b37de6c6fc88c86e4";
pub const SWAGGER_SHA256: &str = "5da7752182cb6172db0550cbd799ee340836d3dba8ceaff7c6ed12976f9e3493";
pub const DIALECT: &str = "homebox-stock-v0.26.2";

#[cfg(test)]
mod healthy;
