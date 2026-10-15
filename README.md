# HouseAtlas

HouseAtlas connects rooms, belongings, documents and physical infrastructure in a home atlas. Browse a home without a floorplan, select a building and its reviewed rooms, and keep source dates, unknowns and evidence visible.

HomeBox owns inventory, attachments and maintenance; HouseAtlas owns physical identities, reviewed bindings and optional geometry, circuits and valves. Network observations are a separate passive, read-only source. Browsing does not collect data or write upstream.

![Synthetic HouseAtlas Lantern house: three illustrated floors, selected kitchen, room colors, windows and furniture](docs/demo/synthetic-house.png)

![Synthetic HouseAtlas demo: reviewed building levels, room details and saved Network relations](docs/demo/synthetic-collage.png)

**SYNTHETIC demo.** The illustrated house restores the original fictional Lantern design through the application's actual renderer. Its rooms, furniture and dimensions are invented. The separate generated mesh example has no native admission or room associations; the browsing fixture has no reviewed floorplan. No household files, real accounts or live providers are used. [Full screenshots and reproduction](docs/demo/README.md).

## Try the synthetic interface

Use Node **26.10.0** and npm **11.19.1**, then run from the repository root:

```sh
npm ci --prefix frontend --ignore-scripts --no-audit --no-fund
(cd frontend && node node_modules/vite/bin/vite.js --host 127.0.0.1 --port 4179 --strictPort)
```

Open <http://127.0.0.1:4179/lantern-tests/readme-house-visual/> for the fictional Lantern house. Select a room, switch between **3D** and **Plan**, or use **Source meshes** to inspect the separate generated two-floor scan renderer. Open <http://127.0.0.1:4179/lantern-tests/core-read-visual/> and select **Alpha** for building membership and source facts; in **Network**, choose **Load Network relations** for the fixture's saved relation. Stop the server with Ctrl-C.

The house demo uses production Lantern components and an explicitly fictional illustration fixture. The browsing demo uses read clients with synthetic Responses; the source-mesh demo uses generated meshes and the production WebGL renderer with display-only floor spacing. They supply no authentication, native server, evidence upload or provider integration. Keep it on loopback; do not use it as a deployment.

## What you can explore

- **Rooms and places:** reviewed building and floor membership, room records and explicit unplaced or unknown information. Names and tree depth do not establish physical placement.
- **Belongings and documents:** HomeBox projections, source-owned attachments, availability and maintenance. HomeBox edits use verified native links.
- **Geometry and infrastructure:** optional reviewed geometry and separately owned circuit, valve and evidence records. Geometry is not required for browsing.
- **Source history:** distinct fact and retrieval dates, uncertainty, stale caches and corrections. Passive Network reads never send collector demand.

Some capabilities require a configured native host and reviewed source bindings; these demos show fictional illustrated geometry, building/room browsing, a saved Network relation and separately generated provisional mesh presentation.

## Run the offline core checks

After inspecting the named script bodies, install the exact dependency locks and run the ordinary synthetic core:

```sh
npm ci --ignore-scripts --no-audit --no-fund
npm ci --prefix packages/contracts --ignore-scripts --no-audit --no-fund
npm run verify:publication
npm run build:ordinary
node --check packages/contracts/history/check-history.mjs
npm run check:http:ordinary
npm run test:ordinary
```

These checks cover publication integrity, module syntax/builds, valid HTTP history examples and one healthy synthetic Request group. They call no provider and certify no security, live integration or deployment readiness. New explicit source-presence admissions remain blocked pending their separately reviewed extension.

The separate IFC/GLB checks use a tiny generated triangle and fake local
transports. Inspect `backend/src/media/ifc_glb.rs` and
`frontend/lantern-tests/ifc-glb-read.mjs` before running them:

```sh
cargo test --offline --locked -p houseatlas-backend --lib media::ifc_glb::tests::healthy_ifc_glb_lineage_and_axes -- --exact --test-threads=1
node frontend/lantern-tests/ifc-glb-read.mjs
```

They verify source-byte binding and bounded display parsing, without proving
converter execution, IFC project units, physical alignment or native acceptance
of a household model.

## Development and verification

The current development snapshot includes a Rust backend, SQLite persistence and a React interface with strict TypeScript.

[The complete verification guide](docs/contributing/verification.md) retains every previously documented named command and its scope, prerequisites and limitations. Read it before running any other check; broad suites and held controls are not authorized by this README.

- [Rust/React development slice](docs/rust-integration/README.md): actual native source, disposable local settings and exact ordinary commands.
- [UI integration](web/README.md): source ownership, access, freshness and host seams.
- [Repository coordination](docs/coordination/worker-handoff.md) and [publication provenance](docs/publication/provenance.md).
- [Operations and rollout](docs/operations/qualification-and-rollout.md): target and acceptance requirements.

This is a development snapshot. No household configuration, credentials or real media belong in Git. Ordinary CI uses no secrets and performs no deployment. Product, recovery, pilot and production acceptance remain separate. Open-source licensing is a future release decision; no license has been selected.
