//! Catalog-gated HomeBox writes through injected ports. No HTTP client or router.
//! Provider activity is separate from frozen schema-1 Atlas record audit history.

mod mapping;
mod ports;
mod workflow;

pub use mapping::*;
pub use ports::*;
pub use workflow::*;

#[cfg(test)]
mod healthy_examples;
