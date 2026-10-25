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

`OUT_DIR` receives `model.glb`, `atlas-scene.json` and `bake-report.json`.
Options: `--triangles` (drawn-triangle budget, default 520,000, under the
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
- Every primitive of a master that already fits, as authored.
- Roles and level membership come from the companion. Without one, they come
  from each node's `semanticRole` and `levelIds` extras, and anything else
  counts as context.

## What it changes

- Primitives over budget are simplified with meshoptimizer. One absolute
  error in metres is searched for the whole house, so a dense lamp and a plain
  wall lose detail by the same visible amount rather than the same percentage.
  Structure and roof get a quarter of the context error. Site context (bound to
  no level: garden, terrain, surroundings) gets four times it (`--site-weight`),
  so the budget goes to the house. Context may also drop
  disconnected parts smaller than that error, and falls back to vertex
  clustering where edge collapse stalls (foliage cards, clipped soup).
- Before simplifying, untextured vertices within 0.5 mm (`--weld`) are welded,
  and the simplifier sees only referenced vertices. Exporters often split every
  triangle into its own three vertices; without this, edge collapse cannot
  shrink such meshes at all.
- Both methods only keep source vertices, so every baked position is a master
  position and every building, level and occurrence bound still holds.
- Simplified untextured primitives keep only `POSITION`. The viewer draws
  untextured geometry with flat normals it derives itself, so normals, UVs and
  colours on those primitives were never displayed. Textured primitives keep all
  attributes and are simplified without welding, so UV seams stay intact.
- Every buffer is rewritten tightly: meshes no node draws, accessors nothing
  reads and the bytes behind them are dropped, because the viewer and backend
  refuse unused declarations. Untouched accessors keep their exact values.

After writing, the bake runs the frontend's own `preflightGltf` and embedded-PNG
material admission on the result. A refusal there fails the bake.

## Checks

```sh
node --test --test-concurrency=1 tools/model-bake/test/bake.test.mjs
```

Four cases on generated geometry: baking to budget (locked footprints,
source-vertex positions, a flat wall and welded terrain soup collapsing, viewer
admission), a master that already fits (kept as authored while an unused mesh,
a dead accessor and their bytes drop, with bindings remapped), roles read from
node extras without a companion, and refusals for a foreign companion pin and an
unreachable budget. They do not render anything or touch a real model.

## Not covered here

Simplified geometry is a display tier, not a parity copy. The full-detail tier,
meshopt/quantized transfer, per-floor detail loading and the device-aware
quality setting are later steps in #304.
