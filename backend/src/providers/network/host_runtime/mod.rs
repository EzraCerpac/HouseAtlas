//! Concrete passive Network binding. Mount this leaf after its exact peers.
//! Authority callbacks use the existing canonical AT11 SharedAccess handle.
//! Sidecar work occurs outside authority locks; held native Store callbacks
//! borrow the supplied original transaction authorizer without reacquiring it.
mod accepted;
mod authority;
mod disclosure;
mod grant_index;
mod publication;
mod reads;
mod refresh_flight;
mod runtime;

pub use accepted::AcceptedNetworkAuthority;
pub use authority::{NetworkAccess, NetworkAuthority, OriginalNetworkLease, SessionMaterial};
pub use disclosure::generation_references;
pub use publication::PreparedPublication;
pub use reads::OriginalNetworkDisclosure;
pub use runtime::{HostNetworkRuntime, RefreshResult};

pub const TLS_PROFILE: &str = "reqwest-0.13.5-rustls-platform-verification";
