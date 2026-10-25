# Live Atlas cache and returning starts

A returning page shows the house before the network answers, then confirms or
replaces it from the server.

## What is kept

`frontend/integration/unified-atlas-cache.ts` keeps, per signed-in actor and
home, in the `houseatlas-atlas-model-cache-v1` IndexedDB database:

- the last verified unified Atlas scene envelope for one publication and overview
  manifest, with its entry building hint and the time it was stored;
- the model bytes that scene pins, named by their SHA-256.

It reuses the scan cache's bounded, generation-fenced store
(`openVerifiedByteCache`): digest-named records, least-recently-used eviction,
a 96 MiB ceiling, 30-day expiry and halving on a quota failure. Sign-out clears
it together with the scan cache. No session, token, header or other API
response is stored.

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

## Room map downloads (Settings)

Settings → **Room map downloads** is a per-device choice kept in
`localStorage` (`houseatlas.model-updates.v1`):

- **Automatic** (default): the fresh read runs on every open, except where the
  browser reports mobile data or Data Saver (`navigator.connection`; Chrome on
  Android). Safari and iOS report neither.
- **When I ask**: the stored copy opens with **Check for update** and no
  network read. With nothing stored, the Atlas shows **Download room map**.

## Back online from the Saved viewer

The Saved viewer checks whether the live entry `/` answers on open, every 30
seconds while visible, on the browser's `online` event and on **Check
connection**. Any HTTP answer counts as reachable and shows **Connected · Open
live**; a rejected or 5-second-silent read stays offline. Nothing is cached.

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
`node frontend/lantern-tests/offline-connection-probe-healthy.mjs` checks the
live-host probe and the download preference.
