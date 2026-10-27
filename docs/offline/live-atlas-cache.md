# Live Atlas cache and returning starts

A returning page shows the house before the network answers, then confirms or
replaces it from the server.

## What is kept

`frontend/integration/unified-atlas-cache.ts` keeps, per signed-in actor and
home, in the `houseatlas-atlas-model-cache-v1` IndexedDB database:

- the last verified unified Atlas scene envelope for one publication and overview
  manifest, with its entry building hint and the time it was stored;
- the model bytes that scene pins, named by their SHA-256;
- the electricity and network overlay records last projected from current
  native frames for that scene (one slot, per building, with the time each was
  read; see below).

It reuses the scan cache's bounded, generation-fenced store
(`openVerifiedByteCache`): digest-named records, least-recently-used eviction,
a 96 MiB ceiling, 30-day expiry and halving on a quota failure. Sign-out clears
it together with the scan cache. No session, token, header, native document or
other API response is stored.

### Full detail model

The detail GLB (up to 256 MiB) is outside that ceiling, so a device on Full
keeps it in its own Cache Storage cache, `houseatlas-atlas-detail-v1`
(`frontend/src/lantern/unified-atlas/detail-store.ts`):

- One copy at most, named by the actor and home it was read for and the
  SHA-256 the scene pins. Keeping a new one first drops every other, so a new
  release replaces the old copy.
- It is written only after a download passed every check, and only when the
  origin's quota (`navigator.storage.estimate()`) leaves 128 MiB free after
  it, so it never crowds out this cache or the offline shell. The first copy
  asks `navigator.storage.persist()`.
- `readUnifiedAtlasDetail` uses it only when a fresh scene pins that digest,
  and hashes it again in the digest worker first; a copy that misses is
  dropped and the detail is downloaded.
- Light never reads or writes it. Settings → Model quality shows the stored size
  with **Remove**; sign-out clears it with the rest.

## How a start uses it

1. As soon as the overview selection exists, `stored()` reads the kept scene for
   that exact publication and manifest, admits it with the same
   `admitAtlasScene` checks as a fresh envelope and requires its model bytes to
   hash to the pinned digest. The Atlas renders it at once with a
   **Stored copy · time · updating** note.
2. The fresh read always runs. It reads the scene envelope from the server; if
   kept model bytes hash to the digest this fresh scene pins, they replace the
   model GET. Otherwise the model is downloaded and verified as before.
3. If the fresh scene and model equal the copy on screen, the stage stays as it
   is (no second parse, no camera reset) and the note disappears. Otherwise
   the fresh model replaces it.
4. A transport failure keeps the stored copy on screen as **not updated** with
   **Try again**. A stale, invalid, absent or too-large answer from the server
   replaces it with that state.

## Electricity and network overlays

`frontend/src/lantern/unified-atlas/overlay-feed.ts` owns the documentary
layers of one live selection and model:

- **Stored copy first.** When the Atlas opens it reads the stored overlay
  records for that exact publication, scene revision and semantics
  (`stored-overlays.ts` decodes them and keeps only the scene's floor buildings
  and selectable rooms). Turning a layer on shows them at once, with
  **Copy last loaded on this device, time; updating** in the layer key, while
  the current sources open.
- **Sources stay open.** The first time a layer is turned on, every building's
  current source opens, as before. Turning layers off and on again reads
  nothing; only a building without a current frame is read again.
- **Kept as read.** Each building's records are stored as soon as its current
  frame arrives. When a frame stops being current (its 10 s head check fails,
  for example offline), the building falls back to those records, marked
  **not updated**, and is read again after 15 s, on the browser's `online`
  event or on the next toggle.
- **Background read.** With nothing stored for the scene, the sources are read
  once 4 s after the Atlas opens and released again, so the layers work later
  without a network even if they were never turned on. It follows **Room map
  downloads**: with **When I ask**, mobile data or Data Saver it waits for a
  layer to be turned on.

A stored copy is display only: it holds no frame, lease or native grant and is
never offered as a current source. Source details show it as `stored-copy`.
The Saved viewer keeps its own documentary snapshot in the saved pack.

## Room map downloads (Settings)

Settings → **Room map downloads** is a per-device choice kept in
`localStorage` (`houseatlas.model-updates.v1`):

- **Automatic** (default): the fresh read runs on every open, except where the
  browser reports mobile data or Data Saver (`navigator.connection`; Chrome on
  Android). Safari and iOS report neither.
- **When I ask**: the stored copy opens with **Check for update** and no
  network read. With nothing stored, the Atlas shows **Download room map**.

An explicit download or retry covers only the selection it was pressed for.
Switching back to **Automatic** starts a held read in place. A 401 or 403
retires the stored copy for that selection until an authorized read succeeds.

## Back online from the Saved viewer

The Saved viewer checks whether the live entry `/` answers on open, every 30
seconds while visible, on the browser's `online` event and on **Check
connection**. Any HTTP answer counts as reachable and shows **Connected · Open
live**; a rejected or 5-second-silent read stays offline. Nothing is cached.
**Open live** goes to `/?live`: the root worker leaves query-qualified entries
to the network, so a host slower than its 2-second offline timeout still opens.

## Static assets

The backend marks `/assets/*` responses, which the build names by content
hash, `public, max-age=31536000, immutable`. Every other response keeps
`private, no-store`. A returning page reuses its application code from the
HTTP cache.

## Limits

The live cache needs a session and home view, so it does not open without a
network. Offline launch still goes through the root worker to the Saved Atlas
copies (`root-offline-entry.md`). Real browser storage, eviction under storage
pressure and installed-PWA behaviour are not proven by the generated check.

## Check

```sh
node frontend/lantern-tests/unified-atlas-cache-healthy.mjs
```

It runs the actual reader and cache on a synthetic IndexedDB disk across
simulated processes and counts GETs: first open, cold reopen with an unchanged
model (scene only), offline reopen (stored copy, no GET), a newly published
model, another actor, changed stored bytes and sign-out clearing.
`node frontend/lantern-tests/unified-atlas-overlay-feed-healthy.mjs` runs the
actual overlay feed, codec and cache against a counting fake source owner:
the background read with nothing stored, the stored copy shown before the
fresh read ends, no reads on repeat toggles, the offline fallback and re-read
when back online, exact scene pins and per-actor clearing.
`node frontend/lantern-tests/offline-connection-probe-healthy.mjs` checks the
live-host probe and the download preference.
