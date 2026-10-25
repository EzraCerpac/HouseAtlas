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
bake refuses, default 0.05) and `--structure-weight` (structure and roof error as
a share of the context error, default 0.25).

## What it keeps

- Every node, mesh and primitive slot, in order, with its material and extras.
  Companion `meshBindings` select by node, mesh and primitive index, so they
  stay valid without edits. Only `original.sha256` and `original.bytes` change.
- `room-pick` and `slab` primitives byte for byte. The backend compares their
  horizontal triangles with plan footprints, so they are never simplified.
- Every primitive that already fits, with its original accessors.

## What it changes

- Primitives over budget are simplified with meshoptimizer edge collapse. One
  absolute error in metres is searched for the whole house, so a dense lamp and
  a plain wall lose detail by the same visible amount rather than the same
  percentage. Structure and roof get a quarter of the context error; context
  may also drop disconnected parts smaller than that error.
- Edge collapse only keeps source vertices, so every baked position is a master
  position and every building, level and occurrence bound still holds.
- Simplified untextured primitives keep only `POSITION`. The viewer draws
  untextured geometry with flat normals it derives itself, so normals, UVs and
  colours on those primitives were never displayed. Textured primitives keep all
  attributes and are simplified without welding, so UV seams stay intact.
- Buffer views nothing references any more, including orphans the master
  already carried, are dropped.

After writing, the bake runs the frontend's own `preflightGltf` and embedded-PNG
material admission on the result. A refusal there fails the bake.

## Checks

```sh
node --test --test-concurrency=1 tools/model-bake/test/bake.test.mjs
```

Three cases on generated geometry: baking to a budget with locked footprints
and source-vertex positions, a master that already fits (only orphan bytes
drop), and refusals for a companion that pins other bytes or a budget the error
cap cannot meet. They do not render anything or touch a real model.

## Not covered here

Simplified geometry is a display tier, not a parity copy. The full-detail tier,
meshopt/quantized transfer, per-floor detail loading and the device-aware
quality setting are later steps in #304.
