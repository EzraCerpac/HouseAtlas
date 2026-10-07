//! Stock HomeBox v0.26.2 wire decoding. No transport, cache or authority owner.
mod bridge;
mod decode;
mod json;
mod navigation;
mod types;

pub use decode::{decode_detail, decode_maintenance, decode_page};
pub use navigation::native_route_candidates;
pub use types::*;

pub const RELEASE: &str = "v0.26.2";
pub const SOURCE_COMMIT: &str = "e01dd737238a3fa7e1a6454b37de6c6fc88c86e4";
pub const SWAGGER_SHA256: &str = "5da7752182cb6172db0550cbd799ee340836d3dba8ceaff7c6ed12976f9e3493";
pub const DIALECT: &str = "homebox-stock-v0.26.2";

#[cfg(test)]
mod healthy;
