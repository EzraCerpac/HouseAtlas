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

The production build ships one fictional example house at
`/example/index.html` (source: `frontend/example/`). The signed-out screen
links to it as **Synthetic example house**; signed-in views do not.
It mounts the actual `LanternHost` and `UnifiedAtlas` against the same
generated two-building publication as the unified Atlas images above, plus
the synthetic Documents, site and core-read fixtures. Every label, identifier,
coordinate and date is invented. The home name, shown on every screen, is
*Synthetic example house*.

The page uses no session, cookie, native transport, provider or account, and
never falls back to or mixes with a real Home. Before the app loads it refuses
every `fetch` locally and replaces `localStorage`, `sessionStorage`,
IndexedDB and Cache Storage, so the real app's outbox, saved Atlas copies,
caches and preferences on the same origin are neither read nor changed.
Nothing is kept after the tab closes, and it is not available offline.

`?building=syn-building-house` or `?building=syn-building-studio` opens the
Atlas on that generated building; an unknown ID is ignored. View, floor and
room selection have no URL parameters yet; choose them in the page.

### Screenshots and video for a pull request

Any PR touching `frontend/**`, `docs/demo/**` or `tools/readme-media/**` runs
the **Synthetic README media** workflow. Besides the images above it writes:

| File | Content |
| --- | --- |
| `example-house.png` | The example page at 1280 × 800, opened with `?building=syn-building-house`, after its first 3D draw. |
| `example-house-tour.webm` | A short scripted tour: Living room selected, floors spread, Plan with the Electrical layer, back to 3D. |

Open the PR's **Checks** tab, choose the **Synthetic README media** run and
download the `synthetic-readme-media-<head SHA>` artifact (kept seven days).
`capture.json` records the example entry and the SHA-256 of both files. Attach
or drag the PNG or WebM into the PR description to show a change; do not
commit them. To show a different state, extend the tour in
`tools/readme-media/capture.mjs`.

The example runs after the existing capture and its receipt checks, under its
own 40-second bound; the existing 90-second bound is unchanged. It does not
show inventory editing, HomeBox or Network sources, native documents, saved or
offline copies, sign-in, iPhone, PWA or device behavior. Its Home records
(the core-read fixture's *Alpha* building) and its Atlas buildings are two
separate generated fixtures, not one coherent household.

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
