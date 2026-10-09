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

Successful native Atlas list HTTP invoke and REST collection responses include
`x-atlas-snapshot-sha256`, exactly 64 lowercase hexadecimal characters. After
the shared dispatch completes disclosure, result recomputation and final
current-Storage/authority revalidation, the host streams the original prepared
scope and complete validated snapshot through SHA-256. The pinned serde_json
serializer preserves retained arbitrary-precision number spellings, uses
deterministic declaration field order for derived structs and sorted serde_json
Value-map keys, and retains snapshot array ordering. No later Store capture,
result-subset digest or full serialization buffer supplies this header. The
existing floating-point canonical witness digest and graph equality checks
remain unchanged; this separate comparison digest avoids their numeric rounding.

Within the pinned serializer, matching digests correlate equal serialized scoped
snapshot content, subject to SHA-256 collision resistance. Unchanged content has
the same digest across record types and pages; changed content, including retained
source/cache/provenance data or number spellings, changes the comparison input.
Different spellings or array order can produce different digests even when an
application treats their values as equivalent. The digest is not a monotonic
generation, revision, original source-byte archive, principal, credential or
authorization grant. Every read still requires its own original authority checks.

Before assembling a topology frame, callers must require a present, well-formed,
equal header on every page of every independent R1–R4 list read, and on R5 if
that list participates in the frame. A missing or differing header leaves the
combined frame unqualified; a caller must obtain a complete matching read set
before joining it. HTTP responses for non-list, provider, history, mutation and
byte operations carry no invented stamp. MCP results and all stock wire3 JSON
schemas and common OwnerResult APIs are unchanged.

The host retains one `AtlasListPages::default()` for all requests/transports.
`AtlasListBinding::capture(access, original_principal)` calls AT11's
`authenticated_session_binding` on the original principal and retains
actor/scope, its opaque equality key and a borrow of that exact original. No cookie text is accepted or retained.
The required Access peer is PR99 `fe7e1f13c99bec2085f1f6a9dbad53efcea983c0`:
it revalidates the original and derives the key from its true normalized session
and Access instance. Unrelated cookie entries and ordering cannot change it.
Construct each owner with:

```rust,ignore
let queries = AtlasReads::new(reads, contracts)
    .with_list_pages(shared_pages.clone(), binding, original_query_principal);
```

The borrowed query principal must be the same opaque allocation forwarded to
Storage and stock authority. The binding must come from its same AT11 issuance. `AtlasListPrincipal` extracts
the retained Access allocation, and every page checks it against the captured
original; independently pairing another principal cannot reuse the binding.
It correlates pages, never authorizes a read or substitutes for captured grants.
`AtlasReads::new` alone preserves prior get/history behavior and cannot execute
list queries without this explicitly supplied session/cursor peer.

Tokens contain 32 random bytes encoded base64url, not source data. State is local
to the process, holds at most 1000 cursors and expires after five minutes.
The default cache also limits each authenticated session to 100 retained
continuation offsets across all its actors, scopes, queries and snapshots.
Each cursor stores the existing opaque `binding.session` as its internal quota
key; this key supplies no authority and is not caller input.
An admitted session/query/snapshot reserves its entire bounded continuation
chain atomically against both the global and session budgets before insertion.
Reusing a reserved token needs no new slot. Traversal does not consume tokens or
release slots, and reuse does not extend the fixed five-minute expiry. Unexpired
cursors are never evicted. Capacity exhaustion fails
before issuing a new chain, so another first-page request cannot invalidate a
token embedded in an unreleased result. A query needing more continuation slots
than either available budget must use a larger page size or await free capacity.
`with_capacity` permits a trusted host to choose 2–1000 slots; the default is
1000, with a session ceiling of `min(100, capacity)`. A custom capacity of 100
or fewer can therefore be consumed by one session. The default prevents one
session from filling the global cache, but multiple sessions can collectively
exhaust it; availability for every session is not guaranteed. At full capacity,
an already reserved chain can continue without insertion.
Continuations bind actor, authenticated session, scope, operation,
page size, exact includeArchived/q query and the full authorized snapshot. No
record/cursor persistence or recovery schema is added. Stock output authorization
can recompute the same request's exact result: the next token is reused only for
that session, query, snapshot and offset. This reuse is projection
correlation, not a durable command replay or proof of result release. Current
Storage reads and captured-authority release remain mandatory on every call.

# Minimal root adapter proposal

Root owns this adoption; no root-owned file is changed by the Domain PR.

1. Keep `AtlasListPages` once in the existing host/composition and pass clones
   into the common stock read executor. Capture `AtlasListBinding` under the
   existing Access lock from `p.principal.principal()`, before source capture is
   sealed. Pass it with the exact borrowed `p`
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
