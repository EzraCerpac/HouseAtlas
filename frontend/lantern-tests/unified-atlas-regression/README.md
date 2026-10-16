# PR201 interaction acceptance

Audited head: `abd77841e80d100b4f548068f8d129562da6b8d3`.
This is a new, test-only suite. All inputs are generated fixtures. No shared
implementation, styles, source data, dependency locks, CI or publication
manifests change. The frontend owner remains responsible for fixes.

| Promised experience | Observed synthetic result | Browser / native acceptance |
| --- | --- | --- |
| One Atlas | Production reader reads one envelope and exactly its pinned GLB; interactions cause no further reads | Actual host fixture **builds**. Single-Atlas DOM assertion is authored, **not executed** |
| Individually selectable rooms | **PASS**: all 10 selectable occurrences; separate Bedrooms; stairs retain one logical room across two floors | Pointer, projected-label keyboard selection and inspector focus require browser execution |
| Exploded floors | **PASS**: mesh and CPU picking lifts agree at 0/25/50/75/100%; original vertices unchanged; studio and two single-floor buildings stay whole | GPU clipping, animation, label overlap and visual framing **unverified** |
| Connected 2D views | **PASS**: every floor, source X/Z inverse projection with yaw/zoom/pan, same room/overlay through 3D–Plan–3D; polygon holes select correctly | Actual SVG layout and pointer hit targets **unverified** |
| Building transitions | **PASS**: foreign selection clears, overlays persist, correct plan follows, return to all buildings restores 3D | Actual eased rapid transitions **unverified** |
| Electrical overlay | **PASS**: 4 generated publication records, occurrence-qualified source position; existing source adapter healthy check reads generated drawing + symbol | **BLOCKED** in production composition: current reviewed map is not supplied |
| Network overlay | **PASS**: 1 generated publication record marks both stairs occurrences without counting it twice; summaries invent no physical positions | **BLOCKED** by the same missing map; generated topology is not device/cable survey evidence |
| Tap / drag / pinch | **PASS**, simulated event objects through production pointer handlers and actual CPU picker; drag/pinch do not select | Real DOM event ordering, touch hardware and pointer capture **unverified** |

## Actual environment and runs

The isolated cloud checkout initially opened at `9a9e3e8`. Only the exact public
PR head was fetched and checked out detached, without merging. The workspace
works for synthetic Node tests and fixture compilation.

- Initial runtime: Node `24.19.0`, npm `11.9.0`. Node `26.10.0` and npm
  `11.19.1` were obtained in `/tmp`; no project dependency version was changed.
- The first install could not create the default npm cache. A writable
  `/tmp/houseatlas-npm-cache` resolves setup; install scripts, audit and funding
  calls remain disabled.
- New `interactions.test.mjs`: **11 passed, 0 failed, 0 skipped** on Node
  `26.10.0`. Actual production reader, standard Three GLTFLoader, admission,
  reducer, projection, presentation, pointer handler and overlay index execute.
  Transport and event targets are synthetic. This is **CPU/unit verification**.
- Existing `unified-atlas-healthy.mjs`: **PASS**. Existing
  `unified-atlas-overlay-source-healthy.mjs`: **PASS**; generated source read
  reports 3 fake GETs, 2 document opens/releases, zero native writes and zero
  real source requests. These do not exercise the mounted integration host.
- New `browser.mjs --build-only`: **PASS**, using the real frontend Vite config
  and existing generated `source-host-visual/main.tsx` entry. Scratch removed.
  No browser assertions run in build-only mode.
- Installed executable: `/usr/bin/chromium`, version
  `Chromium 151.0.7922.173 built on Debian GNU/Linux 13 (trixie)`.
  A fresh-profile `--headless=new --dump-dom about:blank` probe aborted with
  `SIGABRT`: “The SUID sandbox helper binary was found, but is not configured
  correctly.” Crashpad also reported its database directory unavailable.
  No security/network settings were changed and launch was not retried with a
  bypass. **No real browser interaction, WebGL context, draw, screenshot or
  hardware-GPU result is available.**

## Composition dependencies and actionable findings

1. **PR201 alone has no native unified-scene service.** Its reader expects
   `GET /api/atlas/models/v1/workspaces/{workspace}/homes/{home}/atlas`, then
   `/atlas/{publication}/artifacts/model?expectedSha256=…&expectedSelectionRevision=…`.
   This head's backend registers only the model overview routes
   ([router](../../../backend/src/http/mod.rs), lines 1188–1190).
   The scene profile, companion publication, model pins, response headers,
   revision fences and authenticated media serving require backend composition.
   PR198 is unmerged and has blockers per the task; it was **not merged, run or
   qualified here**. The generated envelope helper substitutes for that service
   in these tests, so passing tests do not resolve PR198's blockers.
2. **Even with the scene service, current documentary overlays are unwired.**
   [integration/main.tsx](../../integration/main.tsx), line 419 supplies
   `reviewedRoomLinks: null`. The
   [overlay source](../../integration/unified-atlas-overlay-source.ts), lines
   145–147 returns `room-link-not-qualified` for that context before fetching
   any documentary source. This is a source inspection finding, not a live
   endpoint probe. A current, independently reviewed
   `houseatlas.unified-atlas-room-links.v1` map must be supplied by its owner,
   pinned to workspace/home/publication/semantics, with native building/room
   IDs and package identity pairs. Producer room status cannot substitute.
   The existing healthy source test explicitly supplies this map; the browser
   fixture has no `createOverlays` and exercises publication references only.
3. The current native scene-association endpoint and original-document owner
   must independently provide current reviewed receipt/source pins and the
   retained source documents. Electrical symbols remain historic/unverified;
   network connections remain topology, without invented physical routes.
   No backend or current household evidence was consulted to establish these.

## Reproduce

Inspect the new files and their imported production modules first. Use the
repository-pinned Node `26.10.0` / npm `11.19.1` on PATH, then from the repo root:

```sh
npm_config_cache=/tmp/houseatlas-npm-cache npm ci --prefix frontend --ignore-scripts --no-audit --no-fund
node --test --test-concurrency=1 frontend/lantern-tests/unified-atlas-regression/interactions.test.mjs
node frontend/lantern-tests/unified-atlas-healthy.mjs
node frontend/lantern-tests/unified-atlas-overlay-source-healthy.mjs
node frontend/lantern-tests/unified-atlas-regression/browser.mjs --build-only
```

On a host whose browser already works with its normal sandbox intact:

```sh
HOUSEATLAS_CHROMIUM=/absolute/path/to/inspected/chromium \
  node frontend/lantern-tests/unified-atlas-regression/browser.mjs
```

The browser runner builds into disposable scratch, creates a fresh profile and
loopback server, navigates only the new synthetic page, then closes its owned
process/listener and removes scratch. It uses CDP pointer/key input against the
actual mounted React host. It reports browser version, launch flags, application
requests, errors, context/renderer information and observed draw-call count.
Exit `0` means the selected checks passed, `1` means an interaction/cleanup
failed, `2` means setup was blocked. A DOM pass with unavailable WebGL is named
separately; even a WebGL pass is not hardware-GPU or visual pixel acceptance.
Software renderers must be reported as such. No insecure launch fallback exists.

These exact generated checks are the requested interaction regression lane;
they do not add ordinary CI, run held lifecycle/security controls or qualify
native integration, private data, device behavior or deployment.
