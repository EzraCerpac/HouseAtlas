# Synthetic interface demo

The house and plan images restore the authentic original fictional Lantern
house through the application's `AtlasView` and `Model` components. The retained
reference ZIP is SHA256 `96a884bf935e6aedfa3e5b4f415cce8be295630fe052dc66c5497f8b87b1da63`;
all 44 authored reference file hashes were verified before rendering its pixels.
The strictly typed standalone `house.ts` preserves its invented Alder house data. It includes
three illustrated floors, room colors, openings, stairs, furniture and the birch
model base. Its dimensions, reviewed flags and claims are fictional illustration
data; they establish no native source authority or measured household geometry.
The prototype App, scripted assistant and simulated writes are not mounted.

The building, room and Network images show the actual Lantern React UI and
existing checked-in `frontend/lantern-tests/core-read-visual` fixture. The
**Source meshes** view uses seven generated cuboid meshes per floor and mounts
the actual lossless mesh reader and `HouseScanScene` WebGL renderer.
Its fixed hash fields are synthetic metadata, with no original USDZ, actual
Magicplan conversion, native admission or semantic room association.
All records, scope IDs and session metadata are synthetic. Topology and Network clients consume fake
Responses; other application reads return unavailable. Only frontend assets
are loaded from the owned numeric-loopback Vite server. No native server,
provider, household file, account, credential or upstream write is involved.

| View | What it demonstrates |
| --- | --- |
| [House model](synthetic-house.png) | The original fictional three-floor Lantern house through production components, including a selected kitchen. |
| [Plan](synthetic-plan.png) | The illustrated ground-floor plan, with invented dimensions and furniture; no measured household placement. |
| [Source meshes](synthetic-mesh.png) | Two generated floors through the production WebGL renderer, with display-only spacing and unknown physical scale/alignment. |
| [Building](synthetic-building.png) | Alpha's reviewed membership, recorded level ordering, distinct elevation datums and explicit unknowns. |
| [Room](synthetic-room.png) | Lower room selection with source facts and unavailable shape/document information. |
| [Network](synthetic-network.png) | One explicitly loaded saved relation with original dates and exact revision token. |
| [Collage](synthetic-collage.png) | The three unmodified screen captures, labeled SYNTHETIC. |

The capture also produces seven unified Atlas review images. They are workflow
artifacts only, not README images:

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
requires actual WebGL drawing after **Fit view** and subsequent interaction; if 3D is unavailable, the capture
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
security, pilot or deployment acceptance. The optional video is omitted: the
static views and reproducible capture provide the verified scope.

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
WebGL draw evidence, viewport, checks and source/image
SHA256 digests without local paths or timestamps. Its `sourceTree` digest binds
every tracked source file, including stylesheets and transitive components,
and is checked unchanged across capture. The explicitly listed exclusions are
the seven README images, their receipt and the self-referential publication
manifest, plus the seven unified Atlas image names. Both prepared floor tags must
be present before the geometry capture. The `unifiedAtlas` receipt section
records its entry, observed controls and selection, canvas and draw metadata,
plan SVG digest, and the hashes of its own source files and images.
The checked-in receipt
records the base HEAD and a modified working candidate, with the fixture,
harness and relevant production source bytes pinned individually; workflow
artifacts record their checked-out candidate HEAD. Fixture data, source, viewport,
fonts, camera and selected state are fixed; the receipt also pins the illustrated
model's actual SVG markup. Browser rasterization can vary at a small number of
antialiased or translucent SVG edges, even on the same host. Repeated capture
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
secrets or retained checkout credentials. It uploads screenshots and the receipt
for seven days; it never writes a commit, recursively triggers itself, deploys
or changes the ordinary check workflows. CI artifacts are for review; the
README uses the checked-in, pixel-reviewed captures.
