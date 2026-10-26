# Overview bake

Turns a detailed house GLB and its `atlas-scene.json` companion into an
overview GLB that the installed viewer admits, plus a matching companion and a
bake report. It is the first tier of the detailed-model pipeline in #304. The
master and its checkpoints are inputs only; the bake never writes next to them.

```sh
npm ci --prefix tools/model-bake
npm ci --prefix frontend   # the admission check loads the viewer's own preflight
node tools/model-bake/bake.mjs --model master.glb --companion atlas-scene.json --out OUT_DIR
```

`OUT_DIR` receives `model.glb`, `atlas-scene.json` and `bake-report.json`. The
bake only creates files: if any of them already exists there (the master
itself, a link to it, an earlier bake), it refuses before writing anything.
Options: `--geographic LAT,LON,NORTH` (with `--companion`: writes the
house's location and true north, in degrees, into the companion's
`frame.geographic` for the viewer's sun; see docs/models/unified-atlas-scene-v1.md),
`--triangles` (drawn-triangle budget, default 520,000, under the
viewer's 600,000), `--max-error` (largest context error in metres before the
bake refuses, default 0.05), `--structure-weight` (structure and roof error as
a share of the context error, default 0.25), `--site-weight` (site context
error as a multiple of it, default 4) and `--weld` (weld distance in
metres, default 0.0005).

## What it keeps

- Every node, in order, and every drawn mesh and primitive slot with its
  material and extras. Companion `meshBindings` select by node, mesh and
  primitive index, so they stay valid. The bake rewrites `original.sha256` and
  `original.bytes`, and shifts `meshIndex` down past any mesh no node draws.
- `room-pick` and `slab` primitives byte for byte. The backend compares their
  horizontal triangles with plan footprints, so they are never simplified.
- Every primitive of a master that already fits, as authored, apart from
  the vertex attributes below.
- Roles and level membership come from the companion. Without one, they come
  from each node's `semanticRole` and `levelIds` extras, and anything else
  counts as context.

## What it changes

- Primitives over budget are simplified with meshoptimizer. One absolute
  error in metres is searched for the whole house, so a dense lamp and a plain
  wall lose detail by the same visible amount rather than the same percentage.
  Structure and roof get a quarter of the context error. Site context (bound to
  no level: garden, terrain, surroundings) gets four times it (`--site-weight`),
  so the budget goes to the house. Site context may also drop disconnected
  parts smaller than its error, and falls back to vertex clustering where edge
  collapse stalls (foliage cards, clipped soup). House context is only edge
  collapsed; parts smaller than the error (a 5 mm chain link at 10 mm) can
  still fold away, as they would be under a pixel in the overview anyway.
- Every simplified primitive keeps at least a hundredth of its triangles and
  never fewer than four, so no bound part disappears and no empty accessor is
  written (the viewer refuses zero-length buffer views).
- Before simplifying, untextured vertices within 0.5 mm (`--weld`) are welded,
  and the simplifier sees only referenced vertices. Exporters often split every
  triangle into its own three vertices; without this, edge collapse cannot
  shrink such meshes at all. A part thinner than the weld distance would weld
  away entirely, so it stays unwelded. Errors convert to each mesh's local
  units by the largest stretch of its world transform (its largest singular
  value), so nested nonuniform scales never loosen the error in metres.
  Welding can move a vertex by up to one cell diagonal (0.87 mm at the
  default), so every reported error includes that displacement and
  `--max-error` caps the context error with it; a weld that leaves no room
  under the cap is refused.
- Both methods only keep source vertices, so every baked position is a master
  position and every building, level and occurrence bound still holds.
- Simplified primitives keep only `POSITION`. The viewer draws untextured
  geometry with flat normals it derives itself, so normals, UVs and colours on
  those primitives were never displayed.
- Every primitive, simplified or not, keeps only the vertex attributes the
  server admits: `POSITION` and `NORMAL`, plus `TEXCOORD_0` and `TANGENT` when
  its material has a base colour, normal or metallic-roughness texture. Vertex
  colours and further UV sets are dropped (the viewer never draws them) and
  listed per primitive under `droppedAttributes` in the report. Without this,
  a detail tier keeps them and the server refuses the publication.
- Textured primitives are kept as authored. A flat surface can lose the
  vertices that carry a non-affine UV mapping at zero position error, and the
  texture drift that causes is not bounded by an error in metres.
- Every buffer is rewritten tightly: meshes no node draws, accessors nothing
  reads and the bytes behind them are dropped, because the viewer and backend
  refuse unused declarations. Untouched accessors keep their exact values.

Before writing, the bake runs the frontend's own `preflightGltf` and embedded-PNG
material admission on the result. With a companion it also composes the read
envelope the server sends, runs the app's scene admission (`admitAtlasScene`),
loads the overview through the app's standard loader and binds every selector
to exactly one drawn primitive (`bindAtlasModel`), the join that room selection,
Plan↔3D, floors and exploded views rely on. A refusal there fails the bake;
`bake-report.json` records the bound primitives, room picks, selectable rooms,
levels and buildings under `viewerBinding`. An `--out` that already holds an
output is refused before any work.

## The detail tier

`--detail` also writes `detail.glb`: the master with the same compaction (meshes
no node draws and unread accessors dropped, the same `meshIndex` shift) and
nothing simplified. It keeps the overview's node, mesh and primitive slots, so
the overview's `atlas-scene.json` binds both; the bake refuses if the two
companions differ in anything but `original`. The detail is admitted under the
viewer's Full limits (`DETAIL_GLB_LIMITS`: 256 MiB, 4,000,000 triangles) and
bound by the same selectors. `bake-report.json` holds the `detail` pin to copy
into `publication.json` (`file`, `contentType`, `sha256`, `bytes`) with the
detail's own admission and binding. The server validates `detail.glb` against
the same companion under the same budget; see
`docs/models/unified-atlas-scene-v1.md`.

## Checks

```sh
node --test --test-concurrency=1 tools/model-bake/test/bake.test.mjs
```

Thirteen cases on generated geometry: baking to budget (locked footprints,
source-vertex positions, a flat wall and welded terrain soup collapsing, viewer
admission), a master that already fits (kept as authored while an unused mesh,
a dead accessor and their bytes drop, with bindings remapped), roles read from
node extras without a companion, refusals for a foreign companion pin and an
unreachable budget or a weld larger than the cap, a bake whose error exceeds whole 5 mm parts (house
chain, garden gravel, a strip thinner than the weld) that still leaves every
primitive non-empty, the world stretch of a rotation under a nonuniform scale,
the command line refusing an `--out` that holds its inputs, and a textured
panel with non-affine UVs kept as authored, and the frontend's generated unified
Atlas publication, densified and baked, binding in the viewer with the same
primitive slots, roles, buildings, levels, room picks and selectable rooms as
before the bake (and refusing a companion that leaves a primitive unclaimed),
the detail keeping every master triangle and binding with the overview's
companion, the Full limits admitting 700,000 triangles the overview refuses, and
the command line writing `detail.glb` with its pin in the report, and vertex
colours and spare UV sets dropped from primitives the bake keeps whole.
They do not render anything or touch a real model.

## Not covered here

Simplified geometry is a display tier, not a parity copy. Loading the detail
in the app (the device-aware Auto/Light/Full quality setting), meshopt/quantized
transfer and per-floor detail loading are later steps in #304.
