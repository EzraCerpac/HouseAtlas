# Synthetic interface demo

The building, room and Network images show the actual Lantern React UI and
existing checked-in `frontend/lantern-tests/core-read-visual` fixture.
All records, scope IDs and session metadata are synthetic. Topology and Network clients consume fake
Responses; other application reads return unavailable. Only frontend assets
are loaded from the owned numeric-loopback Vite server. No native server,
provider, household file, account, credential or upstream write is involved.

| View | What it demonstrates |
| --- | --- |
| [Building](synthetic-building.png) | Alpha's reviewed membership, recorded level ordering, distinct elevation datums and explicit unknowns. |
| [Room](synthetic-room.png) | Lower room selection with source facts and unavailable shape/document information. |
| [Network](synthetic-network.png) | One explicitly loaded saved relation with original dates and exact revision token. |
| [Collage](synthetic-collage.png) | The three unmodified screen captures, labeled SYNTHETIC. |

The capture also produces seven unified Atlas review images. The README shows
`synthetic-unified-3d.png`; the others are workflow artifacts only:

| Image | State |
| --- | --- |
| `synthetic-unified-3d.png` | Synthetic house, exploded, Living room selected. |
| `synthetic-unified-collapsed.png` | The same selection collapsed before visiting Plan, with its Ground floor focused. |
| `synthetic-unified-plan.png` | Ground floor plan with electrical record counts. |
| `synthetic-unified-phone.png` | Living room in 3D at 390 × 844, fitted with both Hall and Living electrical counts clear. |
| `synthetic-unified-phone-crowded.png` | Normal modified-wheel zoom creates a count-target collision. Selected Living wins while the layer retains four records. |
| `synthetic-unified-phone-hall.png` | Hall selected through the room list at the same phone width, retaining its three records and original references. |
| `synthetic-unified-stacked.png` | Stacked whole-building Network view, tilted and zoomed out through normal keyboard controls. One Stairs count survives without duplicating its source record. |

They mount the actual `UnifiedAtlas` through `LanternHost` at
`/lantern-tests/source-host-visual/?atlas=generated`. The production scene
reader reads the generated fictional publication from an in-page fake HTTPS
transport. Its optional external file parameters are not used. Each 3D image
requires actual drawing (WebGPU, or its WebGL2 fallback) after **Fit view** and subsequent interaction; if 3D is unavailable, the capture
fails instead of recording the fallback. Every state also requires that no room
or enlarged count target overlaps a floating panel, and no mounted label action
overlaps another label action or enlarged count target. The current
building and floor are visible in their rows.
The desktop and phone checks also exercise keyboard focus leaving Other sources
and Escape returning focus to its summary, without switching source.
Zooming with Hall's count focused checks that culling returns focus to the
viewport without scrolling. Selecting Hall through the room list checks its
three source record references even when its badge was suppressed for Living.
With reduced motion, these images show settled states only. They do not show transitions, private reference views,
native documents, PDFs, iPhone, PWA or device behavior.

The stale HomeBox cache and absence of reviewed geometry are part of the
separate browsing fixture.
These screenshots establish presentation of the named synthetic views only;
they establish no live integration, native authority, floorplan, physical device,
security, pilot or deployment acceptance. The only video is the example house
tour below; it is a review aid, not timing or pixel evidence.

## Example house

`frontend/example/` is one fictional example house for showing features,
changes and fixes in PRs. It mounts the actual `LanternHost` and
`UnifiedAtlas` against the same generated two-building publication as the
unified Atlas images above, plus the synthetic Documents, site and core-read
fixtures. Every label, identifier, coordinate and date is invented. The home
name, shown on every screen, is *Synthetic example house*.

`npm --prefix frontend run build` ships it: after the app's own build, a
second pass, `vite build --config example/vite.config.ts`, writes only
`dist/example/`. The app's inputs, chunks and startup files stay as they were,
and nothing from the example enters the app's precache or service worker. The
signed-out screen links to it as **Example house**. The Rust host serves
`dist/example/index.html` at exactly `/example/index.html` to signed-out
browsers too; `/example/` alone is not mapped. The Vite dev server serves the
same page at the same path.

`?building=syn-building-house` or `?building=syn-building-studio` opens the
Atlas on that generated building; an unknown ID is ignored. View, floor and
room have no URL parameters; choose them in the page.

The page shares the app's origin and is not a browser sandbox. Its entry
module first runs `isolation.ts` and only then loads the app, so before any
app module runs it replaces, for script in the page's own realm, `fetch`
(every request is refused locally), `localStorage`, `sessionStorage`,
IndexedDB, Cache Storage, `BroadcastChannel`, `navigator.locks` and
`document.cookie`. Workers have their own realm and are not covered. No
session credentials are used for application-data reads, the app modules on
the page neither read nor change the real app's outbox, Atlas caches or
preferences, and changes made in the example are not persisted. The browser
still sends the origin's cookies with requests for the page's own scripts and
styles. It is not available offline. After Back/Forward it shows the house
again: a page restored from the back/forward cache mounts a fresh tree.

### Screenshots and video for a pull request

Any PR touching `frontend/**`, `docs/demo/**` or `tools/readme-media/**` runs
the **Synthetic README media** workflow. After the existing captures and their
receipt it writes:

| File | Content |
| --- | --- |
| `example-house.png` | The example page at 1280 × 800, opened with `?building=syn-building-house`, after its first 3D draw. |
| `example-house-tour.webm` | A short scripted tour: Living room selected, floors spread, Plan with the Electrical layer, back to 3D. |
| `example-link-startup-chunk.js` | The built app startup file that carries the signed-out link, for startup-size review; `capture.json` lists each startup file's bytes and default gzip size. |

Open the PR's **Checks** tab, choose the **Synthetic README media** run and
download the `synthetic-readme-media-<head SHA>` artifact (kept seven days).
Attach or drag the PNG or WebM into the PR description to show a change; do
not commit them. To show a different state, extend the tour in
`tools/readme-media/capture.mjs`.

Before the screenshot the same run:

- type-checks `frontend/example/` (including its Vite config) with
  `frontend/example/tsconfig.json` and the pinned compiler. The example
  sources and the app modules they import must type-check under this config;
  diagnostics in the imported `lantern-tests` fixtures are logged and recorded,
  not failed, so those fixtures are not established type-safe;
- runs `npm --prefix frontend run build` (the app and the example pass) and
  serves all of `frontend/dist` from an owned loopback server applying the
  Rust host's path, file-type, size and cache-header rules; the screenshot,
  tour and checks below use that built page;
- checks that the app's startup files load nothing from `dist/example/`, that
  the link ships in them, and that the offline shell lists nothing from the
  example;
- checks that no page script used a replaced global before isolation ran;
- seeds synthetic `localStorage`, `sessionStorage`, cookie and outbox-database
  sentinels on that origin, opens the example, checks that its script sees
  none of them, leaves for another owned page, goes Back, waits for a fresh
  3D draw, and checks the sentinels are unchanged.

`capture.json` records the example entry, file hashes, the `lantern-tests`
diagnostics, the storage results, the Back path Chromium took (back/forward-cache
restore or reload; both pages are served `no-store`, like the Rust host, so a
reload is likely) and informational durations. The example adds one phase after the existing
capture, with its own 60-second bound; the existing 90-second bound is
unchanged, so the script can take up to 150 seconds in all.

These checks do not establish: the Rust host itself serving the page (the
loopback server applies its rules); real cross-tab or service-worker isolation (the sentinels sample
storage and the replaced globals only); coexistence with an existing browser
profile or an active service worker (the context is clean and service workers
are blocked); worker realms; iPhone, PWA, offline or device behavior;
inventory editing, HomeBox or Network sources, native documents or sign-in.
Its Home records (the core-read fixture's *Alpha* building) and its Atlas
buildings are two separate generated fixtures, not one coherent household.
This first slice does not complete the feature coverage tracked in #591.

## Reproduce

Inspect `tools/readme-media/capture.mjs` and the fixture first. Use Node 26.10.0
and npm 11.19.1. From the repository root:

```sh
npm ci --prefix frontend --ignore-scripts --no-audit --no-fund
npm ci --prefix tools/readme-media --ignore-scripts --no-audit --no-fund
export PLAYWRIGHT_BROWSERS_PATH=/tmp/houseatlas-media-browsers
node tools/readme-media/node_modules/playwright/cli.js install chromium
node tools/readme-media/capture.mjs /tmp/houseatlas-readme-media
```

The lock selects Playwright 1.64.0 and its Chromium 156.0.8078.4 browser.
The capture uses a new nonpersistent profile, UTC, en-US, fixed desktop size,
reduced motion, completed font loads and explicit UI-ready assertions. It
rejects external browser requests and renderer errors, then removes its owned
browser and server. A 90-second budget bounds capture. Browser downloads use
normal verified TLS. Review pixels before copying regenerated files into Git.

`capture.json` records source HEAD, tracked-change status, runtime, browser,
WebGPU or WebGL2 draw evidence, viewport, checks and source/image
SHA256 digests without local paths or timestamps. Its `sourceTree` digest binds
every tracked source file, including stylesheets and transitive components,
and is checked unchanged across capture. The explicitly listed exclusions are
the four browsing images, their receipt and the self-referential publication
manifest, plus the seven unified Atlas image names. The `unifiedAtlas` receipt section
records its entry, observed controls and selection, canvas and draw metadata,
plan SVG digest, and the hashes of its own source files and images.
The checked-in receipt
records the base HEAD and a modified working candidate, with the fixture,
harness and relevant production source bytes pinned individually; workflow
artifacts record their checked-out candidate HEAD. Fixture data, source, viewport,
fonts, camera and selected state are fixed; the receipt also pins the plan's
SVG digest. Browser rasterization can vary at a small number of
antialiased or translucent edges, even on the same host. Repeated capture
checks compare the rendered state and inspect pixel differences, rather than
treating every PNG hash difference as a geometry change. The exact checked-in
PNG bytes retain their own hashes. Other operating systems can also produce
different font rasterization; reproduction does not require byte equality
across host platforms.

Playwright's default headless launch uses `--no-sandbox`. This is a separately
authorized public media harness and is not the existing sandbox-required native
browser qualification. It supplies no TLS exception or trust modification.

The **Synthetic README media** GitHub Actions workflow runs manually and on
scoped README/demo/frontend/contract changes. It uses read-only repository
permissions, exact action pins, ephemeral dependency/browser caches and no
secrets or retained checkout credentials. It uploads screenshots, the example
house tour video and the receipt for seven days; it never writes a commit,
recursively triggers itself, deploys or changes the ordinary check workflows. CI artifacts are for review; the
README uses the checked-in, pixel-reviewed captures.
