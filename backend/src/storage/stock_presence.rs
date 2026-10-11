//! Original stock command presence custody. Durable facts alone grant no authority.
#[path = "stock_presence/types.rs"]
mod types;
pub use types::*;
pub(super) use types::{MAX_ACCEPTED_FRAME_BYTES, bounded_size};
