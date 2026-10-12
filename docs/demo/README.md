# Synthetic interface demo

These images show the actual Lantern React UI and existing checked-in
`frontend/lantern-tests/core-read-visual` fixture. The separate `readme-house-visual` fixture uses seven generated cuboid
meshes per floor
and mounts the actual lossless mesh reader and `HouseScanScene` WebGL renderer.
Its fixed hash fields are synthetic metadata, with no original USDZ, actual
Magicplan conversion, native admission or semantic room association.
All records, scope IDs and session metadata are synthetic. Topology and Network clients consume fake
Responses; other application reads return unavailable. Only frontend assets
are loaded from the owned numeric-loopback Vite server. No native server,
provider, household file, account, credential or upstream write is involved.

| View | What it demonstrates |
| --- | --- |
| [House geometry](synthetic-house.png) | Two generated floors through the production WebGL renderer, with display-only spacing and unknown physical scale/alignment. |
| [Plan](synthetic-plan.png) | The same generated floor in the renderer's plan mode; no measured room placement. |
| [Building](synthetic-building.png) | Alpha's reviewed membership, recorded level ordering, distinct elevation datums and explicit unknowns. |
| [Room](synthetic-room.png) | Lower room selection with source facts and unavailable shape/document information. |
| [Network](synthetic-network.png) | One explicitly loaded saved relation with original dates and exact revision token. |
| [Collage](synthetic-collage.png) | The three unmodified screen captures, labeled SYNTHETIC. |

The stale HomeBox cache and absence of reviewed geometry are part of the fixture.
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
the six generated images, their receipt and the self-referential publication
manifest. Both prepared floor tags must be present before the geometry capture.
The checked-in receipt
records the base HEAD and a modified working candidate, with the fixture,
harness and relevant production source bytes pinned individually; workflow
artifacts record their checked-out candidate HEAD. With identical fonts, browser
and OS rendering, the images are deterministic; other operating systems can
produce different font rasterization. The local repeated capture was checked
for identical image hashes. Reproduction does not require byte equality across
host platforms.

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
