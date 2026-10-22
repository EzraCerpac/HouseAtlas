# Saved Atlas consumer v2

The consumer targets exporter PR215 head
`052a9ef8537354e789f4e69255a0d84ef6b1c0a7`. It retains the closed
`houseatlas.home-read-pack.v1` envelope and its six sections. The model root
explicitly supports `houseatlas.home-read-pack.model.v2`; an overview alone
does not substitute for a unified Atlas publication.

Only `store.ts` and `manifest.ts` were recovered from retained consumer
`3c151ccf896ab4e9634bffcdbeb14ff42192116a`. Their preimages were verified
against all six source pins in the supplied capsule. The capsule is Library
`libfile_8adbba6bc15c8191abd093e87b914627`, version 0, 87,601 bytes, SHA-256
`e7f296983bd6077b2cf3c40dbf14e179a3bf4cd0a6ce181f6ed1d021f2d53ebc`.
The other four capsule sources are evidence only and were not recovered.

## Data adapter

`createSavedAtlasDataAdapter(store).read(house, signal)` returns
`SavedAtlasRead | null`. The result includes the existing `UnifiedAtlasRead`
scene/model shape, exact companion bytes, optional exact room-link bytes and
decoded historical correlations, plus saved snapshot/revision/capture/coverage
metadata. The supplied overview manifest digest remains distinct from model,
source, companion and pack digests. `null` means the captured model section has
no unified presentation, including the supplied partial fixture; it never
requests a replacement or falls back to a standalone overview.

The adapter clones the selection before asynchronous work, rereads the active
local revision around resource reads and hashing, validates the local manifest
and its snapshot ID, and compares its resource descriptors with saved metadata.
It verifies every consumed resource's exact digest, size and MIME independently
of the store. The retained store also checks the active revision before and
after loading/hash verification. No data is published if that local selection
has changed during the read. Abort signals are checked at these boundaries.

Generic manifest/section parsing remains bounded to 8 MiB by the unchanged
lossless JSON reader. Companion parsing has its separate 12 MiB allowance;
the original GLB has a 32 MiB limit and independently selected room links a
1 MiB limit. The companion is decoded directly from its original UTF-8 bytes,
then projected through the existing `admitAtlasScene` validator with its plans,
mesh selectors, occurrences, overlays, coverage, source dates and uncertainty.
The raw companion is never replaced by that projection or reserialized into a
new semantics digest. The shared renderer retains responsibility for standard
GLB admission and actual mesh binding.

References resolve by digest, MIME and size. The first deduplicated resource's
canonical role/record remains descriptive; other referencing records can share
those bytes. Record revisions are kept as decimal strings, including values
above JavaScript's safe integer range. Section roots retain their exact section
attribution. Missing original/unified data requires partial model coverage and
retained model exclusions; a null room map additionally requires the supplied
`room-map-unavailable` qualifier. Complete/partial coverage and exclusions are
returned unchanged.

The scene model href is the inert `saved-resource:<sha256>` correlation. It is
never fetched. This adapter supplies no native session, expiry, access grant,
current overlay owner, reviewed lease or invented manifest hash. Historical
producer binding statuses remain producer facts.

## Verification

Inspect the runner and imported source before running this named positive with
Node 26.10.0 and the locked frontend dependencies:

```sh
node frontend/lantern-tests/offline-model-v2-healthy.mjs /absolute/extracted-positive-handoff
npm run typecheck --prefix frontend
npm run build --prefix frontend
```

The runner pins the supplied complete records/unified/documents and partial
manifests, verifies all 42 unique-per-pack resources, roundtrips each local
manifest, and opens each captured selection twice through an in-memory
revision-checking owner. It checks the exact 8,388,625-byte companion, model and
room-map bytes, publication/source pins, plans/occurrences/overlays, nullable
model/map states, deduplicated dependency attribution and lossless record
revision representation. It creates no listener and uses no network,
credentials, native host, IndexedDB, renderer or browser. It runs no malformed,
denial, replay, expiry, revocation, crash or guard-reversal controls.

The supplied-fixture run passed all 42 resources and 21 revision-checked local
reads, including the additional coherent generated partial-map capture.
TypeScript and the frontend build passed. Independent source review found and
closed Unicode label-counting and partial-coverage coherence issues; the final
rereview reported no remaining concrete P1/P2 findings in this scope.

## Integration history and acceptance boundary

The original PR216 data-adapter scope did not implement `UnifiedAtlasPort`.
The then-current native selection required expiry/owner/manifest authority, so
that initial scope required a separate local-selection facade before mounting.
This describes the pre-facade boundary, not a current missing-source task.

[PR221](https://github.com/EzraCerpac/HouseAtlas/pull/221), merged on
2026-10-18, composed the exporter, consumer adapter and presentation facade.
Its [saved mounting composition](https://github.com/EzraCerpac/HouseAtlas/commit/0592d98fcda65cad09a5e36cfb3500111c57cd01)
evolved the facade with the shared saved Atlas host.
[PR227](https://github.com/EzraCerpac/HouseAtlas/pull/227) subsequently added
owned-stage cleanup to the saved store. The old donor PRs' draft labels do not
mean these source changes are absent from main.

All six consumer paths are registered under `web` in the
[source manifest](../publication/source-manifest.json). The initial draft's
missing-registration allowlist mismatch was resolved by integration; it is
not a current registration requirement.

Source inclusion and registration do not establish full offline,
IndexedDB/browser/PWA/device, native-authority, product or deployment acceptance.
Consumer checks retain their documented scope and limitations.
