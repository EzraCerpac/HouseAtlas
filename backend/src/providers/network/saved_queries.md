# Saved Network stock queries

`SavedNetworkQueries<R, C>` implements the existing
`domain::stock::StockQueryPort<P, W, G>`. Its required
`SavedNetworkReadPort<P, W, G>::disclose_retained_facet` receives the exact
original principal and borrowed `PreparedRequest<W, G>`. A matching `FnMut`
callback also implements that port. The checker must be the complete native
stock validator, such as `domain::stock::NativeStockContract`.

The host peer binds the original stock principal/witness/graph to the owning
canonical Core and original Network disclosure handles. It re-discloses through
the actual `host_runtime::HostNetworkRuntime::disclose` with the same Core,
original `OriginalNetworkDisclosure`, native registered-cache baseline and
current partition/entity/link/observation grants. This includes empty output;
there is no unchecked cache or raw-generation fallback. Runtime construction,
original capture, same-issuer matching and genuine grant handling remain with
the runtime/root owners. This formatter constructs no authority or storage.

`SAVED_NETWORK_QUERY_SUPPORT` contains the three domain operation IDs, their
typed agent-schema IDs and existing `NetworkView` variants. The descriptor is
support metadata, not admission or authorization. Root can select the matching
query owner with `saved_network_query_support(request.id())`; MCP/WebMCP can
consume `SAVED_NETWORK_QUERY_SUPPORT.iter().map(|row| row.agent_operation)` once
that real owner and its authority/preparation/release path are installed.

Inventory and snapshot both expose the current view of the saved complete
generation. History exposes only its retained non-current relations; this is
retained source evidence, not a complete source audit or a history of every
generation. The frozen `networkRead` result's `devices` dictionary permits
qualified group/device/interface/segment source keys. All four typed node kinds
are preserved, with their source names and independently reported confidence;
absent/null names or confidence remain null. Relation dates, evidence, temporal
status, confidence, text, endpoints and unresolved descriptions are unchanged.
The public schema has no raw inventory, generation ID/digest, observation array
or history-completeness field; none is invented. Full original data remains
retained in the runtime's validated generation and disclosure baseline.

Optional `resourceId` is an exact external-ID filter over returned typed node
and relation namespaces. Every matching qualified identity is retained; equal
opaque spellings do not merge identities or replace grants. It does not expand
to incident neighbors, infer a resource kind or silently ignore the selector.
The peer still checks the complete original generation/authority before this
pure filter. The stock layer must authorize the exact final result and
revalidate its original witness before transport release.

The frozen result allows at most 100 nodes and 100 relations. Selected output
is bounded before JSON construction; a larger view returns owner-unavailable
without truncation or invented paging. Names/confidence that cannot be encoded
by the frozen schema fail validation rather than being trimmed or replaced.
`sourceStatus` reports retained-capture freshness (`current`, `stale`, or
`unavailable`), never live device state or a source-presence admission. This
component exports no presence witness and changes no binding, generation or
cache metadata. All reads are saved-only; no HTTP/refresh/demand/diagnostic/write
capability is accepted. Upstream access remains the separate passive
`GET /api/inventory` provider operation.

Root composition proposal: add the two parent exports for `saved_queries`,
retain the existing separately published `host_runtime` declaration, compose
this query owner with Atlas/other stock query owners, and extend root
Network-specific preparation/output authorization plus admitted agent IDs only
after installing the original-authority peer. Root owns central HTTP/config,
MCP/WebMCP admission and shared manifests; this patch edits none of them and
does not alter `host_runtime/**` or Domain.

Ordinary evidence uses a disposable compiler copy of root PR73 source
`70e5f066546b9944163b58142e571b3b1b990cf2`, containing the actual runtime
`8192d0d1e99e6293c23557084431e53398244307` and its genuine peers. The new
source is overlaid without changing any peer. The named fixture filter is:

```sh
cargo test --locked --offline --lib providers::network::saved_queries::healthy::
```

Those three positive fixtures execute actual Network projection, full native
stock schemas/correlations and stock dispatch with explicit synthetic
principal/witness/disclosure peers. They cover all three views, exact typed
resource filtering, final result authorization, unchanged dates/evidence and
stale saved data. They create no issuer, login, grants, Store or provider call.
Full-source compilation is separate from genuine composed query qualification.
The external test manifest adds the inherited Network test module's pins:
`rcgen = =0.14.5` (defaults off; ring/crypto/pem) and
`tokio-rustls = =0.26.6` (defaults off; ring/tls12). Production dependencies are
unchanged. Held failure/rejection/expiry/revocation/adversarial/fault/crash/
concurrency/negative-consumer controls remain unrun.
