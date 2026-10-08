# Original Network disclosure lifetime

`AtlasStore::read_cache_partition_pinned_with_authorization` calls the accepted
registered-cache read using the original borrowed per-call authorization. It
issues `PinnedCacheRead` only from that actual Store result. A Network generation
pointer must have its actual permanent Store reservation. No caller-supplied
snapshot, raw generation ID, DTO owner or catalog-completeness assertion issues
a pin. An actual baseline without a generation has no pin.

`PinnedCacheRead::read` borrows the result; `into_parts` moves the validated
baseline and its optional original `CacheDisclosurePin`. The pin has no public
constructor, Clone or serialized form. Its private lease binds the exact Store
allocation, full registration, generation ID and SHA256 of the entire validated
registered baseline, including cache epoch/status and retained relation rows.
That baseline digest is not the Native raw-body digest or publication proof.
`AtlasStore::validate_cache_disclosure_pin` checks original issuer and full
baseline binding; original current-state and access checks remain separate.

The same Store's existing `CachePinRegistry` holds bounded weak original leases.
`guard_cache_residency` upgrades live leases and retains them strongly through
its IMMEDIATE transaction and original Native reference guard. Each is emitted
as `Disclosure` with `StorePin` origin. A last reader drop while an inventory
guard is held cannot remove its already retained protection. After both reader
and inventory owners drop, fresh enumeration no longer reports that lifetime
pin; permanent generation IDs, current pointers and other references remain.
Weak cleanup and token Drop perform no filesystem IO, deletion, authority-lock
acquisition or reference-owner reentry. No persistent schema change is needed.

`HostNetworkRuntime::read` captures this actual pin inside the original AT11
source-read fence before retained sidecar loading. Sidecar/archive IO still runs
outside the authority lock while the same Core/Store is borrowed. The private
`OriginalNetworkDisclosure::capture` consumes the original pinned read and binds
it to the exact configured registration and validated retained generation.
Original release/revalidate check its same-Store token, all existing genuine
AT11 member grants and the full current baseline. The disclosure owns its token.

Root HTTP glue uses the existing `stock_network_reads::Graph.original` and
`Witness.graph` Arc allocations. `Reader` already checks Arc identity and invokes
original release. Keep those original Arc handles alive through every prepared
reader/result check; copying only the facet/baseline cannot retain a pin. These
existing concrete reader paths need no root HTTP/router/module edit for this
source delta. No pin selector, release route or new issuer should be added.

Root config constructors remain unchanged. Network settings validate a canonical
private directory but do not establish coherent ownership across independent
same-path sidecar/archive opens. A future original canonical path owner or
cross-open coherent lock must cover sidecar, raw catalog and segment operations.
This pin-only lane does not implement or qualify that separate prerequisite.

Actual Network reference coverage remains `Unknown`. This source binds existing
Network disclosure/Reader lifetimes only; it supplies no future AI/continuation
bridge, complete recovery/export obligation registry or external Native archive
coverage producer. No policy window, deletion/maintenance executor, grant or
reclamation capability is added. Pins never establish completeness or authority.

The inspected isolated positive fixture uses actual disposable AT11/Core/Store
and one local original Native capture from unchanged inventory/review inputs.
Approved fresh synthetic bootstrap supplies Core setup, not a Native publication
proof. Actual reads test original token issuance, validation, Arc lifetime and
Native guard enumeration. The runtime closes before the same local catalog is
reopened; this is no concurrent-open or recovery qualification. It compares full
keyed cache/Core-source state and burned IDs, then removes its fresh TempDir.
Only root may declare the separate named compiler target:

```toml
[[example]]
name = "network-disclosure-pin"
path = "src/providers/network/host_runtime/examples/pin-lifetime.rs"
```
