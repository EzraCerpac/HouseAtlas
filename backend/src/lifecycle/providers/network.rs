//! Closed native provider authority across phased Network work. No issuing-store
//! fence, live authorizer or access transaction escapes into the host leaf.
use crate::{
    access as a,
    app::Store,
    lifecycle::providers::authority::{
        NativeLifecycleAuthority, PreparedProviderPublication, ProviderLease,
    },
    providers::network as n,
    storage as s,
};
use std::sync::Arc;

/// Actual owner lease retaining the original opaque principal, lifecycle grant,
/// partition and entity handles. Root uses retain_original for existing request
/// captures; no RequestPrincipal or replacement authority is constructed here.
pub type NetworkAuthorityLease = ProviderLease<a::LifecycleGrant>;
pub type PreparedNetworkPublication = PreparedProviderPublication<a::LifecycleGrant>;

/// Concrete closed delegates borrow the SAME open app::Store. The authority
/// owner alone loans its scoped authorizer inside the held access transaction.
/// ReadAuthority stays unchanged; no raw fence or caller authorizer escapes.
pub struct NativeNetworkPublication;
impl NativeNetworkPublication {
    pub fn prepare(
        store: &mut Store,
        lease: &Arc<NetworkAuthorityLease>,
    ) -> s::Result<PreparedNetworkPublication> {
        lease.prepare_publication(&NativeLifecycleAuthority, store)
    }
    pub fn publish(
        store: &mut Store,
        prepared: PreparedNetworkPublication,
        staged: n::StagedNetworkPublication<n::DurableNetworkReceipt>,
    ) -> s::Result<s::CacheStatus> {
        prepared.publish_network(&NativeLifecycleAuthority, store, staged)
    }
    pub fn publish_failure(
        store: &mut Store,
        prepared: PreparedNetworkPublication,
        code: n::ErrorCode,
    ) -> s::Result<s::CacheStatus> {
        // Actual consuming generation/epoch CAS; no baseline reread/rebase or
        // call to the legacy unfenced record_cache_failure method.
        let failure = s::CacheFailure {
            code: serde_json::from_value(serde_json::to_value(code)?)?,
            status: None,
        };
        prepared.record_failure(&NativeLifecycleAuthority, store, &failure)
    }
}

/// Root uses the original host runtime for refresh and retained disclosure.
/// This alias introduces no second orchestration or publication path.
pub use crate::providers::network::host_runtime::{
    HostNetworkRuntime as NetworkRuntime, RefreshResult as NetworkRefreshResult,
};
