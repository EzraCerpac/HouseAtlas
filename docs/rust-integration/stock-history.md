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

## Retained operation events

GET `/api/atlas/operation-events?homeId={homeId}&pageSize=25` serves the separate
`atlas-operation-events/1` projection. `pageSize` is 1–100; an optional `cursor`
selects an opaque owner-issued continuation. The actual session and configured
home determine actor and workspace. The response declares
`coverage: retained-atlas-stock-only`, `completeness: partial` and
`order: audit-sequence-ascending`. Entries retain saved audit, root/group operation,
command, actor, timestamp, target and request-digest facts. Provider activity,
unlinked native audits and legacy activity are outside this coverage.

Initial preparation validates every scoped linked root through one fixed audit
watermark, including complete original root/child requests, native results and
target/guard closure. The host captures actual current and historical source
references before sealing its original request principal. Preparation,
disclosure and release use the same complete retained closure and freshly read
current records. Later pages compare the entire saved snapshot to the pinned
one; they cannot add a root, reference or authority capture. The original full
heap-allocated request principal, inner Access allocation, Store instance and
semantic owner allocation remain pinned in the bounded cursor registry.

Storage bounds the global audit preflight to 4096 events/16 MiB, scoped roots to
128, aggregate saved root SQL bytes to 32 MiB, targets to 256 and current JSON to
16 MiB. Detached fact representations are bounded to 48 MiB; these are serialized
representation limits, not a peak-memory guarantee. The HTTP registry holds at
most eight continuations and four per session. Each sequence has a fixed
five-minute monotonic process-local lifetime starting at its first successful
retention after disclosure and final authorization release. Following pages
preserve that deadline. Under the registry lock, the next operation-event read
reclaims elapsed entries before cursor lookup and capacity accounting. An elapsed
cursor is unavailable; cleanup drops its saved custody without adoption,
reissuance or changes to native session policy. Live continuations are never
evicted to admit another sequence. Missing qualification or exceeded bounds
returns unavailable, with no truncated complete-history claim.

Lantern displays this projection separately from authored per-record history.
It keeps server sequence, raw saved timestamps and native identities, exposes
explicit Load more and masks results immediately on session/view changes. The
stock wire3 schema and frozen per-record audit response remain unchanged.

The named `healthy-stock-retained-read` example uses genuine fresh direct and
derived commits, three pages with a complete initial closure, unchanged SQLite
and WAL across reads, and ordinary reopen. The separately inspected
`healthy-operation-events-loopback.mjs` covers actual HTTP paging over real saved
stock/audit linkage. Neither runner executes replay, recovery, expired cursors,
revocation or concurrency controls.

## Saved intent preparation

The authenticated `/api/atlas/retained-intent` reconciliation route now uses
`StockAtlasReplayPreparation`. Its first read transaction retains the validated
saved root and native plan alongside the original Store, request principal and
semantic owner bindings. The existing current and historical disclosure checks
run before preparation returns and again before the saved result is released.
The response preserves the original saved request IDs and canonical wire;
original Media release, HTTP delivery and retry safety remain not established.

Preparation getters are internal qualification facts. Hosts must not serialize
them before the matching Disclosure and Release checks. The carrier has no
execution method and supplies no mutation or replay authority. A separate stock
mutation owner must bind the saved plan to actual Replay and ReplayPrecommit
checks; the existing fresh-only transaction owner remains unchanged.

The inspected source positive creates one direct record through the actual fresh
stock adapter, then prepares and discloses its saved source under a fresh Access
read guard. It preserves the saved root, plan and receipt and leaves SQLite and
WAL bytes unchanged. Its independently checked source closure is empty; it does
not qualify source-bearing replay, replay execution or any held control.
