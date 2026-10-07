# Atlas list query owner

`AtlasReads` maps the ten catalog list forms as well as their existing get/history
pairs. Each list uses the actual scoped `ReadPort::snapshot`, validates the frozen
snapshot, selects the exact record type, excludes tombstoned rows unless
`includeArchived` is true, and sorts ascending canonical record UUIDs. Optional
`q` applies literal case-insensitive whitespace-separated terms to public payload
string values and the record UUID. Every term must match. Property names, numeric
encodings and private asset storage keys are not search fields. Asset projection
omits only `storageKey`; availability, license and preview policy stay intact.

The existing `atlasRead` result schema and stock dispatch correlation/disclosure
checks are unchanged. `sourceStatus=current` means the local canonical Atlas
read; it makes no assertion of provider freshness or media bytes availability.

The host retains one `AtlasListPages::default()` for all requests/transports.
`AtlasListBinding::capture(access, original_principal, authenticated_cookie)`
revalidates the actual AT11 principal and retains only actor/scope/session hash.
Supply the actual checked cookie used to issue this principal, never a client
cursor identity or a request field. No cookie or authority handle is stored.
Construct each owner with:

```rust,ignore
let queries = AtlasReads::new(reads, contracts)
    .with_list_pages(shared_pages.clone(), binding, original_query_principal);
```

The borrowed query principal must be the same opaque allocation forwarded to
Storage and stock authority. The binding must come from its same AT11 issuance.
It correlates pages, never authorizes a read or substitutes for captured grants.
`AtlasReads::new` alone preserves prior get/history behavior and cannot execute
list queries without this explicitly supplied session/cursor peer.

Tokens contain 32 random bytes encoded base64url, not source data. State is local
to the process, holds at most 1000 cursors, expires after five minutes and evicts
the oldest cursor other than the predecessor consumed by the current request.
`with_capacity` permits a trusted host to choose 2–1000 slots; the default is
1000. Preserving the predecessor allows ordinary output authorization to
recompute a continuation when insertion needs eviction at capacity.
Continuations bind actor, authenticated session, scope, operation,
page size, exact includeArchived/q query and the full authorized snapshot. No
record/cursor persistence or recovery schema is added. Stock output authorization
can recompute the same request's exact result: the next token is reused only for
that request ID, predecessor cursor, query and snapshot. This reuse is projection
correlation, not a durable command replay or proof of result release. Current
Storage reads and captured-authority release remain mandatory on every call.

# Minimal root adapter proposal

Root owns this adoption; no root-owned file is changed by the Domain PR.

1. Keep `AtlasListPages` once in the existing host/composition and pass clones
   into the common stock read executor. Capture `AtlasListBinding` under the
   existing Access lock from `p.principal.principal()` and checked authenticated
   cookie, before source capture is sealed. Pass it with the exact borrowed `p`
   to both `NativeQueries` and `Authority::authorize_result`'s recomputation.
   They must share the same cache and binding. A stable session identity from
   the actual authenticated transport is required; never substitute a request
   ID, MCP connection ID or caller-supplied actor/session field.
2. In `http/stock_reads.rs::read_operation`, admit the ten explicit list IDs
   alongside existing get/history IDs, using Domain's
   `atlas_list_record_type(request.id()).is_some()`. Keep Atlas/read-only checks.
3. In that file's `Authority::disclose`, admit `ScopedPage` only for those IDs.
   Require exact Atlas authority and requested recordType, exact current scope,
   and the actual target/row in the already authorized prepared graph. Preserve
   original-principal and captured source/partition release checks. Existing
   get/history paths continue to require `ExactTarget` and exact request target.
4. Add the ten IDs to `http/agents/capabilities.rs::reads`. Existing catalog,
   `NativeStockService`, stock dispatch and MCP/WebMCP wire schemas already
   declare these forms. All transports must call this same owner; add no second
   filter, paginator or permissive authority in transport code.
5. A REST collection route may admit
   `/api/atlas/stock/v3/workspaces/{workspace_id}/homes/{home_id}/records/{kind}`.
   Map bounded `pageSize`, opaque `cursor`, `includeArchived` and optional `q`
   into the exact catalog envelope with target `{authority:atlas,recordType:kind}`
   and a server request ID. Use the existing checked-header and authorized-read
   boundary; it calls the same executor as MCP/WebMCP. Direct agent envelopes
   retain their original request IDs and payloads, without normalization.

No new dependency/version pins are needed: this uses the accepted pinned
`base64`, `getrandom`, `sha2`, `serde_json` and standard library only. No additive
Storage/Access API is required; authentication must pass its existing session
binding into composition. Fourteen unsupported/held/forbidden catalog forms,
all mutation routes and byte download handling retain their existing status.
The PR provides a service implementation and healthy synthetic evidence, not
mounted HTTP/MCP/WebMCP or production graph qualification. Root adoption and
transport parity checks remain separate.
