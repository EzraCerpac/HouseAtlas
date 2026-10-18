# Saved Atlas mounting

The explicit production entry is `/saved/index.html`. It mounts the same Atlas
loader, scene binder, camera, stage, Plan, 3D, E/N/M controls, counts, details and
logical graph as live mode. A small presentation environment supplies reduced
motion and optional navigation/archive capabilities. The native default wrapper
continues to use its StoreProvider. Saved mode opens property scope explicitly;
model-v2 contains no entry-building metadata. No source bytes change.

Saved allocations are tagged, revision-scoped and idempotently disposed. Their
one store subscription retires the selection and removes old stage pixels.
Opening abort signals apply only to opening. Host-owned reads abort on unmount.
Saved state has no session, expiry, native grant or fabricated receipt. Memory is
scoped to allocation, local revision, snapshot, publication and semantics.

The manager lists, opens and removes actual retained copies using production
store APIs. Empty storage says no saved copy. There is no acquisition/download
flow. Captured time, pack completeness, exclusions, supported overlay coverage,
source facts and unsupported historical joins remain visible. General inventory,
Documents/PDF navigation, editing, installed PWA/iOS and native authorization are
outside this Atlas-only entry.

`discardStage({ key, token, epoch })` discards only the matching pending Save
allocation, after checking its durable token/epoch and current control epoch in
one readwrite transaction. It removes that allocation's uncommitted full and
range bytes, preserving full bytes referenced by the currently committed house.
Pending ranges are removed even when their full asset is retained. A completed,
removed or normally superseded allocation is a harmless no-op. Cleanup leaves
the committed house/revision, other allocations/scopes, control epoch and public
shell/caches unchanged, and resolves only on transaction completion. Pending-only
cleanup sends no committed-house notification.

The worker scope is exactly `/saved/`. The build plugin seals emitted public
frontend assets (including lazy chunks, fonts and PDF support) plus the exact
saved HTML with SHA256, byte count and MIME. It commits readiness only after all
assets verify. No API/auth/session/media/user-resource route or arbitrary query
is cached or intercepted. Only `/saved/index.html` is an offline navigation.
Public shell identity remains separate from overview/source/semantic/model and
saved snapshot digests. Root live HTML and PWA manifest stay unchanged.

## Named generated ordinary positives

Inspect each runner and imported production modules first. Use Node 26.10.0 and
the exact public lock. Run only these named commands from the repository root:

```sh
node frontend/lantern-tests/offline-atlas-presentation-healthy.mjs
node frontend/lantern-tests/offline-atlas-overlays-healthy.mjs
node frontend/lantern-tests/offline-atlas-mounting-healthy.mjs
node frontend/lantern-tests/offline-stage-discard-healthy.mjs
```

The three Atlas positives use generated valid complete/partial packages, fake local resource owners,
and no browser/listener/provider/credentials. They observe stable live snapshot
identity/forwarding, tagged saved identities, exact reads/disposal, unplaced
circuit/electrical-relation/evidence/network records, dates, uncertainty, metadata and partial
source coverage. No broad aliases, malformed/denial/replay/expiry/crash,
adversarial/private-intake or failure-injection cases run.

The stage-discard positive executes the production store with generated valid
house/resource types and a minimal asynchronous memory simulation of the IDB API.
It checks canceled new/replacement Saves, late cleanup after activation, normal
second-begin supersession and shared-digest retention, including exact bytes and
transaction-completion boundaries. Parser/exporter qualification is outside this
positive. This is simulated IDB/source qualification;
genuine browser-IDB persistence, actual Save/persisted reopen, genuine offline and
native acceptance remain separate gates.

From `frontend`, the ordinary compatibility commands are:

```sh
npm run typecheck
npm run build -- --emptyOutDir --outDir /absolute/task/evidence/saved-atlas-writer/dist
node lantern-tests/check-backend-frontend-compat.mjs /absolute/task/evidence/saved-atlas-writer/dist
```

The fixture's separate build command and supported real-browser procedure are
in `frontend/lantern-tests/offline-atlas-browser/README.md`. Fixture generation
runs only on explicit Save; Open never seeds IndexedDB. Fixture code is excluded
from the production shell. CPU/build success is not browser/offline acceptance.
After the coordinator seals the publication source manifest, the exact ordinary
read-only closure check is `node tools/publication/verify-source.mjs`.

`Saved scope` exposes the public shell build and an explicit **Remove saved
public shell** control. It unregisters only the exact `/saved/` scope and deletes
only the displayed verified build's public cache. It does not remove saved
copies; the manager's normal Remove action owns each copy.

The named overlay positive includes the genuine retained source/support closure,
nullable Network revision and distinct permitted source-tuple examples documented
in the overlay guide. Fixture **Save historical closure generated copy** exposes
the same retained closure for actual Chrome verification.

Readiness is bound to the intended build marked in the production saved HTML.
A replacement installing/waiting worker is awaited before the retained active
worker; its verified build must match that mark. A retained older public cache
cannot stamp a new Save as ready. The build identity hashes the emitted assets,
unmarked saved HTML and worker source; the final marked HTML has its own exact
SHA/size/MIME pin in the closure. Changed worker code has a distinct cache name;
installation preserves an already verified matching cache and only removes old
build caches after replacement activation. The named mounting positive checks
this wiring; update failure paths receive static review only.

Production entries and public shell sealing apply only when Vite's resolved root
is the frontend directory. Existing fixture-root builds retain their own default
`index.html` and do not seal a saved shell. The named mounting positive checks
this root-scoped configuration. The supported source-host compatibility build,
from `frontend`, is:

```sh
npm exec vite build -- lantern-tests/source-host-visual --config vite.config.ts --outDir /absolute/task/evidence/source-host-compat-dist --emptyOutDir
```

It compiles generated fixture UI only and opens no listener/browser/provider.
