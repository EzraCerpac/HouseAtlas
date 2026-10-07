//! Concrete passive Network binding. Mount this leaf after its exact peers.
//! Authority callbacks use a private, genuine AT11 in-memory boundary; durable
//! Atlas/sidecar work occurs only in explicit outer phases.
mod accepted;
mod authority;
mod disclosure;
mod publication;
mod reads;
mod runtime;

pub use accepted::AcceptedNetworkAuthority;
pub use authority::{NetworkAuthority, OriginalNetworkLease, OwnedNetworkAccess, SessionMaterial};
pub use disclosure::generation_references;
pub use publication::PreparedPublication;
pub use reads::OriginalNetworkDisclosure;
pub use runtime::{HostNetworkRuntime, RefreshResult};

pub const TLS_PROFILE: &str = "reqwest-0.13.5-rustls-platform-verification";
