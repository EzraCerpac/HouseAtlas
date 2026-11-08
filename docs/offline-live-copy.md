# Read-only live-copy data contract v1

This implements retained app reading for #372/#560 through the verified public
bootstrap. It mounts the shared section navigation with Atlas, Upkeep, Library
and Changes, without SessionApp or reconstructed live authority. Device/storage
acceptance remains separate.

## Consumer surface

`frontend/src/offline/live-copy-types.ts` defines the versioned DTOs and read/storage
ports. `integration/live-copy-retention.ts` constructs one stable host owner.
The live integration exports lazy `getLiveCopyRetention()` and captures only
completed current online views; its `read` and `storage` fields are the consumer
surface. An offline bootstrap can construct the same owner with null live state;
it must not call `observe` with a cached actor or create a session from a snapshot.

- `readLast(signal)` returns an opaque copy handle and a stale display snapshot.
  Home label, captured-at, original source-now, entries/maintenance and cache
  provenance are display data. Use captured-at as the fixed relative-date anchor.
  Snapshot data is not ReadyView: canEdit, service selectors, native links and
  issued attachment/preview URLs are stripped. No session, CSRF, expiry receipt,
  admission, cookie, port or outbox context is retained.
- `readCatalog(handle, signal)` returns captured native source-document metadata,
  with explicit captured-pages/complete-enumeration state and capture time.
  Missing/failed catalog reads mean unavailable, never an empty complete library.
  Snapshot coverage says native catalog is a separate read. History, geometry,
  topology and electrical discovery are explicitly unavailable in the snapshot.
- `documentStatus(handle, reference, signal)` checks the exact document/revision/
  asset/revision/digest/length association and verifies held bytes. It returns
  held with measured-type pin, not-held, or failed-integrity plus exact length;
  other storage/retirement failures stay failures. Use the returned pin for
  `readDocument`, which rechecks the catalog, digest and witness. No title join,
  blob URL, cached native frame or guessed MIME type admits a file. A HomeBox
  attachment is not a native source Document; do not join them by title or UUID.
- `atlasReference(handle, signal)` joins the copy's actor/home to the existing
  last-Atlas pointer through its separately revalidated witness. Null means no
  matching Atlas; unavailable means pointer storage/resolution failed. The default
  resolver opens and closes the existing verified cache reader; a host can supply
  an equivalent resolver.
  Pass the returned reference as the fourth argument of `openLastAtlasCopy`.
  That existing reader refuses a different actor revision, scope, publication or
  manifest before reading, then retains its original admission, hash and final
  pointer checks. Holding a reference grants no live/model authority.
- Subscribe to changes, withdraw borrowed content and reacquire handles after
  invalidation. Cross-tab notices and foreground rechecks retire historical
  handles. Each storage read also revalidates the durable witness; notifications
  alone are never proof of currentness. Consumers own any Blob URL cleanup.
- `storage.status` reports retained bytes/count, configured bound, quota estimate
  and persistence state. Estimates are not capacity guarantees.
  `requestPersistence` is explicit only; construction/status/capture never calls
  it. No persistence permission or device probe was invoked to prepare this code.

## Live capture and document retention

Only actual completed canonical observations call `observe`. Failed/unavailable
session reads preserve historical display ownership; null observations and
explicit denied/expired/revoked views retire and clear it. A different account
rotates the persistent epoch and deletes prior-account data, including A-B-A.
Home-bound writes additionally capture exact current session/view allocations
and expiry; asynchronous work cannot acquire a newer allocation.

`capture(view, signal)` serializes an explicit allowlist. `retainCatalog` performs
bounded authorized native-v2 pagination (duplicate IDs/cursors refuse).
`retainDocument(id, revision, signal)` obtains the actual current native reader,
record and byte frame, checks all exact pins/type/length and hashes a copied
buffer before an acknowledged transaction. Frames/readers are released on every
exit. These calls are explicit ports, not an automatic background whole-library
fill. The UI/policy owner can enumerate and schedule them; one successful read
does not establish completeness of HomeBox, electrical or other document sources.

The replaceable IndexedDB backend acknowledges transaction completion, propagates
quota/abort/blocked errors and bounds opening/transactions to ten seconds.
A timed-out write reports uncertain completion, including when abort cannot stop
commit; a late completion cannot convert the rejected promise to success. Callers
must reconcile retained state, not assume rollback or automatically replay.
An explicit 250 MiB data-layer bound is a preliminary policy cap, not measured
available space; per-file 128 MiB, view 8 MiB, catalog 2 MiB, 2048 catalog documents
and 2056 total rows are additional bounds. Tests can only lower these limits.
LRU gives up held document bytes before view/catalog metadata. A put reports its
eviction count; not-held does not distinguish never-held from previously evicted.
The existing native reader may have stricter per-file limits, which stay unchanged.

Clear retires local handles immediately, commits a null-actor epoch tombstone,
then notifies subscribers/other tabs immediately, even if cleanup fails, and
deletes data only if that tombstone still owns the store. An intervening
new actor is not erased by the old cleanup. Failure is returned and recorded:
if deletion fails after the fence, reload cannot select old bytes; if even the
fence cannot commit, complete removal is not established. The live sign-out
path reports incomplete cleanup rather than success. No browser storage API can
promise deletion/durability when it fails or the browser independently evicts data.
No snapshot or local actor witness authenticates a live operation. Existing
outbox authentication, drafts, reconnect and explicit Saved packs are unchanged.

## Electrical originals and policy

Electrical evidence is a separate source namespace, never a Document v2 ID.
Its independently captured building lists retain evidence/asset identities,
lexical asset revision and byte-size tokens, PDF page correlations, source dates
and allowlisted provenance. The existing electrical reader owns every current
association and evidence-original join. Retention checks its frame, exact original
pins, measured PDF type, purpose, bytes and digest before completion. Reader and
original leases are released; no native link, authority or lease is persisted.
Read handles use the same account/home/epoch fence, tombstone and aggregate LRU
budget as native Documents. Catalog replacement removes open eligibility for
withdrawn correlations even when older bytes remain within the LRU budget.

The live host enumerates reviewed buildings through the existing bounded topology
reader/projection, with an additional 128-building scheduling cap, then uses one
owned electrical reader per building. Whole-library filling defaults on for
native Documents and electrical PDFs while their measured catalogs fit below
80% of the configured 250 MiB soft budget. This leaves room for metadata and
avoids cycling an oversized set through LRU. Unavailable files remain marked;
uncertain writes stop that pass without automatic retry. Switching off automatic
keeping stops additional original downloads. Explicitly opened files can still
be retained within the hard budget. Settings reports measured source sizes and
held storage separately; browser persistence is an explicit button action.

HomeBox attachments remain a separate source. Their one-use capture/offer client
is not a reusable byte-read port and its 10 MiB capture cap does not cover arbitrary
Library PDFs. They remain listed as needing a connection. No claim of every
possible Library source being retained follows from this increment.

## Public bootstrap and presentation

Root navigation retains the established network-first handoff to the sealed
public `/saved/index.html` bootstrap on network rejection or timeout only.
HTTP authentication/error responses still pass through. This bootstrap now opens
the retained app shell when a display snapshot exists; explicit Saved entry keeps
its existing full viewer. No authenticated root HTML or API response is cached,
and no root-scope fixed-name asset interception is introduced. The public build
closure includes every lazy section/PDF asset as before.

The shared navigation remains available across retained sections. Atlas uses its
independently verified reference; Upkeep preserves source dates; Changes reports
the existing waiting count without configuring outbox authority; uncaptured
operation history is stated in place. Library distinguishes held, missing and
failed-integrity files and draws held native and electrical PDFs through the
existing sandboxed canvas viewer. Owned signals withdraw rendered bytes on copy
invalidation. Native and electrical lists have independent capture times.

Only pristine missing copy storage permits the legacy last-Atlas fallback. A
known tombstone, malformed witness, missing view under an existing witness or
retirement does not reopen the legacy Atlas. An already displayed app selection
also cannot fall back after it is withdrawn.

## Qualification

The existing offline-root-entry healthy selection invokes generated contracts
in `offline-live-copy-fixture.mjs`: allowlist/decimal preservation; stale roundtrip
and opaque no-authority handles; catalog/byte integrity and availability; home/
account A-B-A fences; cancelled/withdrawn writes; wipe failure/tombstone and second-owner withdrawal notification; quota
and atomic refusal; explicit persistence outcomes; bounded LRU; actual backend
completion/abort/late-open interface and fake-timer timeout/late completion; and actual adapter native-pin/withdrawal
handling. Actual production modules are type-stripped for Node, with generated
transaction, IDB-interface and native-reader ports. No validation implementation
is copied, no new selection/workflow is added, and Node stripping is not semantic
TypeScript checking. This does not exercise real IndexedDB flush, storage pressure,
native documents, PDF rendering, root live-shell boot, mounted navigation or devices.
The sprint ran the generated root/data/policy contracts, the eight electrical
owner/adapter contracts and semantic TypeScript checking locally with pinned Node
26.10.0. The browser live-launch case seeds generated snapshot/catalog/originals
through production storage and checks all four phone-width tabs, native PDF and
referenced electrical PDF page rendering, storage Settings, queue preservation
and peer tombstone withdrawal. These checks use a disposable Chrome profile and
loopback static build only, with no backend/provider/account/credential access.
Hosted execution, exact integration review, installation and owner/device
acceptance remain separate.
