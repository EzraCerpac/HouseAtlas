//! Stock read composition only. The existing Domain dispatcher owns authority
//! capture/revalidation/result disclosure; provider and artifact owners own IO.
mod adapter;
mod cache;
mod selection;
mod types;

pub use adapter::{HomeBoxQueries, HomeBoxReadOwner};
pub use cache::cached_entity_page;
pub use selection::{HomeBoxReadQuery, REQUIRED_READ_OPERATIONS};
pub use types::*;

#[cfg(test)]
mod healthy;
