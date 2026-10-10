# Root Atlas list handlers

This root integration starts from accepted main
`8f4065a3ee831df0b30d14f597c25a7bbcc7f212`, tree
`85cf0cc69d2d204d4967ea37923a38d4f6022961`. Access and Domain retain their
accepted original bytes. Root owns the six app/HTTP/lifecycle changes and this
note; dependencies, locks, feature modules and frontend sources are unchanged.

One `Core::atlas_list_pages` retains the actual Domain `AtlasListPages` for the
application lifetime. Bootstrap and strict reopen construct fresh process-local
state; no cursor persistence or recovery authority is added. RequestPrincipal
implements `AtlasListPrincipal` by borrowing its original retained Access
allocation. The common stock read executor captures `AtlasListBinding` under
that same Access lock, before source capture is sealed, and supplies the same
binding and shared cache to the actual owner query and result recomputation.

Every list reads through the existing Core/Store/Access ReadPort. The query's
actual snapshot must equal the complete prepared witness graph. Existing original
principal, current-snapshot and captured source/partition release checks remain
in force. Scoped-page disclosure is admitted only for the ten owner list IDs;
each target must have Atlas authority, the exact requested type and scope, and
an actual record in the prepared graph. Its public target/revision/lifecycle/
payload must match that row exactly, omitting only the asset's private storageKey.
The exact result is recomputed before release with the same original principal,
binding and cache. Existing get/history exact-target paths remain intact.

The collection endpoint is
`GET /api/atlas/stock/v3/workspaces/{workspaceId}/homes/{homeId}/records/{recordType}`.
It supports the ten exact catalog types: identity, binding, evidence,
location-semantics, circuit, valve, relation, geometry, asset and reconciliation.
Authentication and configured scope checks precede decoding the bounded query.
The transport accepts pageSize (default 50), opaque cursor (default null),
includeArchived (default false) and optional q without trimming or normalization.
Encoded query intake is bounded at 16384 bytes and strict UTF-8 is decoded once;
the unchanged stock validator checks the resulting full envelope and owner query.
Filtering, ordering and pagination stay with the actual Domain AtlasReads owner.

Admission now includes 30 reads: ten lists plus the existing ten get/history
pairs. Editor admission adds the same two existing writes, for 32 total.
Existing HTTP invoke, configured MCP catalogs and native WebMCP dynamically use
that same explicit admission and common executor. No frontend or transport
feature module is edited. Downloads, HomeBox and Network operations, specialized
writes and the remaining unavailable catalog forms stay unbound. The retained
frontend's separate 22-operation coverage checkpoint is not run or rewritten.

Actual locked Rust library/binary/all-example source, rustfmt, warnings-denied
Clippy, deterministic contracts/history, strict TypeScript and React Vite build
passed through the inspected source runner. It executes exactly
healthy-contracts, healthy-dependencies, healthy-native-semantics and
healthy-maintenance-calendar. Vite retains its existing large-chunk advisory.

One narrow actual loopback TLS flow used the service's generated disposable
synthetic fixture and Chromium 151.0.7922.173. It completed all ten REST lists,
ten exact unchanged caller-envelope invokes, a pageSize-one identity first page
with a fresh nonnull cursor, and its successful continuation through native
`document.modelContext.executeTool`. The two distinct saved identities match the
complete list in canonical order. React displayed the exact result before tool
return. One positive case-insensitive q=ITEM/includeArchived=true filter selected
the saved item identity. Read-only SQLite comparison verified every returned
row: six records, no audits, stock operations or history cursors. There were 32
successful loopback requests, no rejected responses or external provider calls.
MCP list runtime, populated asset projection, tombstoned inclusion, capacity,
expiry and strict-reopen behavior are source-only here. No login/logout/write,
negative/replay/revocation/fault/concurrency control, cargo test, owned cfg(test)
checkpoint, broad aggregate, new regression-lane case or deployment ran.

The publication verifier retains its exact regular-file/mode/digest/ownership
allowlist. Detailed runner source, logs, binary digest and exact preimage/postimage
receipts remain outside Git. This is a concrete root list integration for review;
ordinary success does not establish security, production or target acceptance.
