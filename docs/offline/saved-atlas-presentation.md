# Saved Atlas presentation facade

This bounded facade builds over consumer PR216 frozen head
`571a93600c13c30f75e0f303b5906c44258ee385`, tree
`8ee58e3ecb945a227f8a911e0682b83fba203086`. Its frontend-owner handoff is
Library `libfile_9dc8bd94f39881919f445cc38bd289fe`,
`HouseAtlas-offline-saved-selection-facade-handoff-20261017.json`.
Only the facade, its named generated positive runner and this document are
released to this writer. Consumer sources and publication registration stay
unchanged.

## Selection and reads

`AtlasPresentationSelection` is tagged. The live variant is
`{ kind: 'live', overview: ModelOverviewSelection }`.
`createLiveAtlasPresentationPort(native)` preserves the original native
selection object and forwards native reads and subscriptions. Its explicit
live-only `createOverlays` forwards the optional native acquisition method,
returning null when that method is absent. It does not redefine native expiry,
scope, manifest or authority checks.

`openSavedAtlasPresentation(store, house, signal)` clones the selected house
before awaiting the existing saved data adapter. It returns null when that
capture has no unified presentation. It never substitutes an overview or
requests a live source. On success, `current()` exposes a frozen saved selection:
`kind`, `owner`, `scope`, `publicationId`, `overviewManifestSha256`,
`semanticsSha256`, `selectionRevision`, `snapshotId`, `localRevision`,
and `capturedAt`. Owner is a fresh local object per allocation, with no native
meaning. The overview pin is the actual supplied descriptor pin; the source,
model, semantic companion and pack digests remain distinct.

Call `read(selection, signal)` with that allocation's exact selection object.
Each read invokes the unchanged consumer again, preserving its active local
revision/snapshot checks around byte loading and hashing, scope/publication/
semantics admission, abort checks, exact digest/MIME/size checks, and bounded
resource limits. No resource bytes are served from an allocation cache.
Results retain exact companion/model/optional room-link bytes and decoded
scene data, capture date, completeness, model state and exclusions. Room links
are historical correlations. Producer binding statuses are retained source
facts. Saved overlay projections are explicitly unavailable; the saved port
has no `createOverlays` method, session, native grant, expiry or transport.

The allocation observes store notifications from before its initial read.
Any notification retires it conservatively, including unrelated saved-house
changes. `current()` then returns null and pending reads cannot publish.
The host must open the desired allocation again. Subscribers receive the
retirement notification; `dispose()` releases the underlying subscription and
local listeners. Hosts must dispose allocations when switching or unmounting.
The opening signal covers opening; each read uses its own caller signal.
Notifications are invalidation hints, not a substitute for the consumer's
revision-checked resource reads.

## Verification

After inspecting the runner and its imports, use Node 26.10.0 and the locked
frontend dependencies:

```sh
node frontend/lantern-tests/offline-atlas-presentation-healthy.mjs
npm run typecheck --prefix frontend
npm run build --prefix frontend
```

The named runner generates its own coherent complete, partial-map and
overview-only captures from the checked-in synthetic Atlas generator. It uses
the actual saved consumer and an in-memory revision-checking resource owner.
It checks repeated reads, all saved selection fields, distinct supplied pins,
exact resource bytes, preserved coverage/exclusions, historical room links,
independent local owners, normal disposal and native live forwarding.
Source plan feature-reference ordering is normalized by the existing decoder;
raw companion bytes remain exact. These are positive CPU/data checks only.
No malformed, denial, replay, expiry, revocation, crash or guard-reversal
controls, provider, credentials, listener, native host or browser are exercised.

Local generated positives, TypeScript and the production build passed with
Node 26.10.0/npm 11.19.1. The build reports its chunk-size warning. Independent
read-only source review found no P1/P2 findings; retirement races, abort and
failure cases received static review only. All 1,648 existing registered
source rows remain byte-exact; the allowlist mismatch contains only the three
released additions. Detailed logs and exact candidate identity are retained
outside Git and referenced in the draft PR.

## Integration boundary

The integration owner must separately register these three paths in
`docs/publication/source-manifest.json`. Until then `npm run verify:publication`
is expected to fail with `Exact source allowlist mismatch` for exactly these
additions. That gate is distinct from facade tests, typechecking and build
results. This release adds no workflow or CI step. Existing hosted CI must be
followed to terminal results on the exact PR head.

Shared Atlas UI/types, loader/binder mounting, App/Host, legacy saved view,
service worker, downloader and other storage remain outside this release.
The facade alone establishes neither mounted offline viewing, saved overlay
projections, IndexedDB/PWA/browser/device acceptance nor complete offline
viewing. No merge, deploy, NAS/production request or access change is included.
