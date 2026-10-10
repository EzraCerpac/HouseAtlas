# Authored scan plan orientation

The mesh reader uses a proper rotation into Y-up render coordinates. The scan
presentation then exposes its plan as `(renderX, -renderZ, height)`, matching
authored DXF +X right and +Y up. The original Lantern projector consumes a
schematic plane whose +Y points down. Passing authored +Y directly to it showed
the reflected plan at every yaw; a yaw change cannot repair that parity error.

`makeScanProjector` adapts the scan's authored plan basis to that camera basis.
`SCAN_PLAN_Y_TO_CAMERA` is shared with the WebGL vertex shader. SVG room hit
regions, selected-room outlines, floor labels and room/device anchors all use
the same scan projector. Depth bounds use its corresponding depth function.
No per-floor reflection, source token rewrite, place reassignment or physical
house transform is introduced. Original schematic Atlas rendering is unchanged.

Future reviewed fixture display points must use this same projector after the
source-photo-to-floor-fraction registration. Do not flip source fractions,
change the durable room receipt or independently mirror an overlay.

The bounded healthy synthetic example is:

```sh
node frontend/lantern-tests/scan-plan-orientation.mjs
```

It exercises one asymmetric source triangle under all three declared up axes,
four yaws and four positive pitches. It checks source preservation, screen plan
parity, top/right landmarks and SVG/WebGL/depth/plane-matrix agreement. Source
landmark comparisons and actual available-floor previews belong in the private
handoff; this example establishes no survey alignment or native admission.
