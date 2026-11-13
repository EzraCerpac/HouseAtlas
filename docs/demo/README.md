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
unified Atlas images above, plus the synthetic Documents and site fixtures.
Its Home records are derived in the page from that publication
(`frontend/example/household.ts`): one place per building with floors, per
floor and per room with a selectable part, with the Atlas names and nesting.
A room on several floors sits under the floor of its first selectable part.
Home and Atlas therefore show one household. Three fictional belongings have
source parents in those rooms; that hierarchy does not establish reviewed
physical placement. The read-only HomeBox copy is stale (retrieved 3 January
2026) and each record's source update time is unknown. Every label, identifier,
coordinate, date and file is invented.
The home name, shown on every screen, is *Synthetic example house*.

`npm --prefix frontend run build` ships it: after the app's own build, a
second pass, `vite build --config example/vite.config.ts`, writes only
`dist/example/`. The app's inputs, chunks and startup files stay as they were,
and nothing from the example enters the app's precache or service worker. The
signed-out screen links to it as **Example house**; signed in, **Settings**
has **Open example house**, and the offline (Saved) app's **Settings** has
**Example house**. The Rust host serves `dist/example/index.html` at exactly
`/example/index.html`, signed in or out; `/example/` alone is not mapped. The
Vite dev server serves the same page at the same path.

### Files in the example

Each file path the app has gets one small generated PDF, read through the
same production reader and viewer the real house uses, behind in-page fake
transports (`frontend/example/files.ts`):

| File | Where to open it | Reader and viewer |
| --- | --- | --- |
| *Synthetic parcel survey*, two pages (source Document) | **Library** › **Source documents** › **Synthetic parcel survey** › **Original** | Native source Documents reader, PDF viewer |
| Eighteen *Synthetic electrical page* drawings (electrical evidence) | **Library** › **Electrical drawings**, building *Synthetic house* | Electrical Library reader, drawing viewer |
| *Fictional reading lamp manual*, one page (HomeBox stored file) | **Library** › **File details for Fictional reading lamp manual** › **Read and keep verified copy**; also from the reading lamp's detail | Verified-copy owner (`live-copy-retention.ts`, `readHomeboxOriginal`), PDF viewer |

The manual has no issued download link, so **Download original** shows
*File access is unavailable*; the verified copy is the only way to open it.
That copy is kept in an in-memory store for the life of the page, so *on this
device* there means this open page; nothing is written to IndexedDB. As in
the real house, opening the manual again in the same page reuses that
observation instead of reading the original again.
The electrical drawings use the existing fictional fixture of the Electrical
Library checks, placed on the house building; their room associations
(*Fictional kitchen*, *Fictional study*) are fictional and unresolved.

### Opening it on a phone or Mac

Once a build is deployed, open `https://<your HouseAtlas host>/example/index.html`
in the installed app (Settings › **Open example house**, or **Example house**
on the sign-in screen) or in the browser. The page installs its own service
worker, scoped to `/example/`, that holds every built example file. After the
page has loaded once online and stayed open for a few seconds, it opens with
the network off, including all three PDFs, because its data and files are
generated in the page. Offline, the installed app starts in its Saved view;
open **Settings** › **Example house** there. On iPhone, the installed app and
Safari keep separate storage, so load the example once online in each.

The example worker caches only `/example/` files under its own
`houseatlas-example-` cache name and removes only its own earlier caches.
The entry and its built files always come from the held copy of the
worker's own build, so a server error or captive-portal answer never replaces
it. A new deploy installs as a worker update that takes over only after every
open example page has closed; until then those pages keep their own build,
including files they have not loaded yet. On iPhone, close the installed app
fully to pick up a new example build. The app's own service workers, precache
and Saved copies are unchanged and list nothing from the example.

### Documents in the example

Open **Library**, then find **Source documents**.
Open **Synthetic parcel survey** to inspect its recorded source information
and qualified PNG preview; choose **Original** for its generated two-page PDF.
The list also includes **Synthetic outline export**;
**Load more** shows the out-of-date **Synthetic elevation tile**.
These documents, their dates, licences and source details are fictional.
They do not establish a building, floor or room placement.
The media artifact includes the list and qualified-preview detail;
the example uses an in-page synthetic reader, not a live document source.

In Atlas, open the Network lens and show the Network layer. Open Devices and
select Fictional access point to trace its recorded connection to Fictional
network root. This fictional graph shows logical associations, not physical
locations or cable routes; its source coverage is partial.

### Starting state

Four optional URL parameters name the Atlas's starting view:

| Parameter | Values |
| --- | --- |
| `building` | `syn-building-house` or `syn-building-studio` |
| `floor` | `syn-level-ground`, `syn-level-split`, `syn-level-upper` or `syn-level-studio` |
| `room` | a room ID such as `syn-room-living` or `syn-room-stairs` |
| `view` | `3d` or `plan` |

For example,
`/example/index.html?building=syn-building-house&floor=syn-level-upper&room=syn-room-stairs&view=plan`
opens the upper-floor part of the Stairs in Plan.

- Explicit parameters win. They are applied in the order building, floor,
  room, view, over the view the scene would otherwise open with; absent
  parameters keep its values. A building drops the floor and room; a floor
  drops the room.
- Each unknown or mismatched value is ignored on its own and the others still
  apply: a floor outside the named building, a room with no selectable part
  on the named floor (or, without a floor, in the named building), or any
  other `view`. A room on several floors opens on the named floor's part,
  else its first selectable part.
- They apply only to the first view of the page's publication that the tab
  shows. Later choices, closing and reopening the Atlas, and reads after
  that view do not reapply them. A back/forward restore mounts the page
  afresh, as a new scene with no remembered view, and applies them again, as
  a reload does.

The tab remembers a scene's view only once that scene's first view has
committed, and remembers it only within one loaded page. A start applies only
before that, so it never meets a remembered view of its own scene: a link
always opens as named, and from then on the remembered view wins.

Production sources supply no starting state, so the app opens as before. The
example passes these values to the Atlas as ordinary Atlas actions on each
read (`UnifiedAtlasRead.start`), refused one by one where the scene does not
allow them. The Atlas applies a start only to the first committed view of the host-supplied
source owner (`createStartLedger`). The stage's first render reads it, and only
a mounted stage records the owner as begun. A stored copy shown first is that
view, so later reads, refreshed publications and reopening do not reapply the
start. A new source owner begins a new lifetime; the array identity does not matter.

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
styles. Its own `/example/` worker (above) holds only the example's built
files; it can open the origin's Cache Storage like any same-origin worker but
touches only its own caches. After Back/Forward it shows the house
again: a page restored from the back/forward cache mounts a fresh tree.

### Screenshots and video for a pull request

Any PR touching `frontend/**`, `docs/demo/**` or `tools/readme-media/**` runs
the **Synthetic README media** workflow. After the existing captures and their
receipt it writes:

| File | Content |
| --- | --- |
| `example-house.png` | The example page at 1280 × 800, opened with `?building=syn-building-house`, after its first 3D draw. |
| `example-house-state.png` | The direct link above: Stairs on the upper floor, in Plan. |
| `example-inventory-list.png` | Fictional belongings in the unplaced list. |
| `example-inventory-detail.png` | The reading lamp's read-only detail and source hierarchy. |
| `example-documents-list.png` | The fictional source Documents list in Library. |
| `example-documents-detail.png` | The survey's qualified preview and source details. |
| `example-network-trace.png` | A recorded logical route from the fictional access point to the fictional network root; it is not a cable route. |
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
  sentinels on that origin, opens the example with a mismatched floor and room
  and an unknown view, checks that its script sees none of them, leaves for
  another owned page, goes Back, waits for a fresh 3D draw, and checks the
  sentinels are unchanged;
- checks that only the building applied in that state, then checks that Rooms
  & places lists the publication's buildings, floors and rooms with a stale
  HomeBox cache;
- checks the fictional belongings list and opens the reading lamp detail,
  including its stale source hierarchy, unreviewed placement and disabled edit;
- opens the direct link above and checks its building, floor, room, room part
  and Plan; chooses 3D, opens Upkeep, returns to the Atlas and checks that 3D
  and the room remain (the reopened read carries a new start array);
- opens the synthetic Documents list and survey detail, checking the loaded
  qualified preview, fictional source and licence.

`capture.json` records the example entry, file hashes, the `lantern-tests`
diagnostics, the storage results, the isolation and Back entry URL, the Back
path Chromium took (back/forward-cache restore or reload; both pages are
served `no-store`, like the Rust host, so a
reload is likely) and informational durations. The example adds two phases after
the existing capture: build and tour, then production-state checks, each with a
60-second bound. The existing 90-second bound is unchanged, so the phase
allowances total 210 seconds; the workflow's job limit also applies.

These checks do not establish: the Rust host itself serving the page (the
loopback server applies its rules); real cross-tab or service-worker isolation (the sentinels sample
storage and the replaced globals only); coexistence with an existing browser
profile or an active service worker (the context is clean and service workers
are blocked); worker realms; iPhone, PWA, offline or device behavior;
inventory editing, live HomeBox or Network sources, native documents or sign-in.
The example's files and its offline worker are checked without a browser by
`frontend/lantern-tests/example-files-healthy.mjs` (production readers, an
in-memory copy store and a fake worker scope); the capture does not open them.
That test checks reader results and the worker in a fake realm, not mounted PDF
rendering or real browser offline behavior.
The example supplies no geometry metadata source, and its topology client
lists only the house building (for the Electrical Library) with no members;
the corresponding geometry-metadata warning remains visible.
The starting-state checks use fresh reads only: the example has no stored
copy, so a stored copy shown first is covered only by the pure ledger
controls in `frontend/lantern-tests/unified-atlas-start-healthy.mjs`, which
mount no React tree and are on the healthy runner list. The example's
coverage of #591 is not complete.

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
