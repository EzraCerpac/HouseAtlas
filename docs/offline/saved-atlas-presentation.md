# Saved Atlas presentation facade

The composed saved mounting base is `8b452ac852f76fad1f3611469f5490ccc3536d2d`,
tree `d196b38d5c5a73f87118ee5b888c0db0bc3a92c0`. It preserves the frozen
consumer, facade and narrow presentation donor ancestry.

Canonical presentation ports/selections live in unified-atlas/types.ts; facade
exports remain compatible. The unchanged native UnifiedAtlasPort and
ModelOverviewSelection stay behind an explicit live wrapper. One wrapper per
native port caches a frozen tagged selection while the native object is
unchanged. Native current/read/subscription/overlay arguments, optional entry
building callback and read-owned entry preference are preserved. Absent native
overlay acquisition remains absent.

Saved selections contain allocation owner, scope, publication, actual overview
manifest pin, semantic pin, selection revision, snapshot, local revision and
capture time. These identities stay distinct from source and model digests.
There is no native expiry/session/grant/overlay acquisition method.

Opening clones the retained house and verifies through the unchanged consumer.
Every read repeats exact revision/snapshot, digest/MIME/size and scene/model
admission, plus verified generic overlay roots. The opening signal applies only
to opening; reads use their own caller signals. One store subscription retires
the allocation on notifications, releases itself and notifies local subscribers.
Dispose is idempotent. The host disposes allocations and aborts its reads when
switching/unmounting; a retired allocation cannot retain old pixels.

The saved documentary seam uses verified PropertyRecords with explicit supported
coverage and unplaced totals. It never fabricates preview manifests, historical
receipt pins or native frames. See [overlays](saved-atlas-overlays.md).
The common mounted renderer receives a small presentation environment; saved
mode explicitly opens property scope. See [mounting](saved-atlas-mounting.md)
for named commands, public shell and supported-browser limitations.

Inspect and run only the named generated positive:

```sh
node frontend/lantern-tests/offline-atlas-presentation-healthy.mjs
```

It covers stable live snapshot identity, unchanged forwarding, optional entry
callback, exact tagged saved reads, independent allocation identity, property
scope, opening-only abort lifetime and idempotent disposal using valid generated
complete/partial-map/overview-only packages. No held controls, real source,
provider, native host, listener or browser runs. Mounted real IndexedDB and cold
launch acceptance require the separate actual Chrome procedure.
