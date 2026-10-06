//! Framework-free orchestration of the single physical HomeBox write queue.
//!
//! Persistence, current authorization, prepared wire decoding and actual source
//! access are injected. This component creates no service or network transport.

mod model;
pub mod native_homebox;
mod orchestrator;
mod ports;
mod stock;

pub use model::*;
pub use orchestrator::*;
pub use ports::*;
pub use stock::*;
