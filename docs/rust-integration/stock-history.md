# Native stock audit history

GET `/api/atlas/stock/v3/workspaces/{workspaceId}/homes/{homeId}/records/{recordType}/{recordId}/history`
uses the actual stock history owner over the same SQLite store. The query accepts
`pageSize` (default 50), an optional native opaque `cursor`, and optional `q`.
The HTTP binding fixes `includeArchived=false`; actual wire3 schemas validate
the resulting complete request. The ten frozen record types are supported.

The actual AT11 read principal remains coupled to the original scope, exact
target, captured complete graph and sealed source/partition handles. Native
authorization callbacks require exactly ReadHistory, the original principal,
one selected target and no source, partition or mutation substitutions. Both
stock callbacks also check the exact original raw request, scope and target.
They use actual access revalidation and never call nested SQLite reads.

Storage uses its own history transaction, verifies retained native audits and
genuine stock commit/audit linkage before search or paging, and owns cursor
watermarks and actor/scope/query bindings. The root pins the real final callback
output once, compares the actual successful return exactly, and marks completion
only after the owner commits. It does not rerun history to compute an expected
result or manufacture cursor IDs. Domain disclosure then rechecks the original
principal/grants and unchanged actual graph. Historical authors can differ from
the current reader; scope and selected target establish the disclosure boundary.

The separate inspected `healthy-stock-history-loopback.mjs` runner adds three
first-page/search GETs over the new stock-created circuit and identities. Each
has one real stock-owned event. It verifies event/audit linkage, exact command,
actual actor and native digests; it does not demonstrate a nonnull cursor.
Native-only prehistory without original stock linkage is unavailable through
this owner, rather than promoted to stock history. The existing frozen history
route still serves actual native audits separately.

No provider, recovery, replay, rejected query, expiry, revocation, fault, crash
or concurrency control is executed by this slice. Whole-home capture remains
conservative; no access lock spans the owner's SQLite cursor transaction.
Operational security, cross-database atomicity and target qualification remain
outside this ordinary development proof.
