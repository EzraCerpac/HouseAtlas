# Provisional scan preview

This module is a separate, currently unmounted per-floor viewer. It renders
neutral source triangle meshes, raw export labels and full source object IDs.
It creates zero semantic room objects and supplies no measured dimensions,
physical calibration, floor stacking, house registration or room/circuit mapping.
“Incomplete scan — physical scale and floor alignment unverified” stays visible.

## Owner integration boundary

`ScanPreview` requires an immutable floor descriptor list, building display label,
an active flag, a fresh opaque `viewKey`, and `ScanMeshReadPort`. The owner replaces
the view key on session, workspace, home, building identity/revision, access or
availability changes, and calls the invalidation subscription synchronously when
access ceases. Invalidated keys cannot be reopened; refresh the owner building
view. Each read must freshly authorize the current original/derivative lineage.
The opaque floor key is only a selector. The module constructs no endpoint,
download token, native asset identifier, storage key or schema command.

The owner port must cap streamed bytes before it returns its `Uint8Array`, obey
the abort signal, and perform the actual private/no-store transport. Delivery
carries the exact requested view/floor keys. The module verifies derivative
SHA256 against the owner descriptor, then original SHA256 and raw floor label.
Producer hashes and format claims inside a payload do not grant access or prove
conversion/admission. No browser storage, asset bundling or private byte cache is
used. Opening/retry performs a read; browsing never converts, imports or writes.

Native IFC/USDZ original admission, immutable mesh derivative issuance/read,
building association and a closed guarded import transaction remain paired owner
prerequisites. Geometry is not PDF/text evidence or SafeRenderedPNG. Mounting this
module is withheld until those prerequisites and the read port are reviewed.

## Closed derivative profile

The module consumes `houseatlas.magicplan-authored-mesh.v1`, with closed root
fields `profile`, `source`, `converter`, `authoredCoordinates`, `qualification`,
`nodes`, `meshes`, and `counts`. Source/converter hashes qualify immutable lineage;
source numeric strings are tokens from usdcat USDA serialization. Binary USDC has
no original text lexemes. Negative zero, exponent spellings, raw operation order,
authored-versus-default orientation and absent double-sided metadata are retained.
No native asset ID is fabricated in this private preprocessing payload.

The shared node table retains every mesh and ancestor, including identity nodes.
Each mesh keeps both its complete mesh-to-root ancestor chain and the applied
chain ending at the first reset. The only admitted operation is affine matrix4d
`xformOp:transform`, explicitly ordered, optionally after a leading reset marker.
Local and composed matrices are checked with bounded exact decimal arithmetic.
Unknown fields, duplicate keys, unlisted operations, incomplete chains, incorrect
indices/counts or inconsistent orientation qualifiers are rejected. This decoder
does not implement USD composition, time samples, instancing, deformation or USDZ
parsing. The converter and native issuer must reject unsupported source features.

Raw matrices use row-major storage and row-vector multiplication. Only transient
render buffers convert to floating point. Bounds are derived from transformed
vertices; centering, fit and the proper X/Z-to-Y-up display rotation are camera
state. Authored units are shown separately from unknown physical scale. No factor
ten or IFC elevation enters the active transform chain.

## Resource and lifecycle limits

One floor is read at a time: at most 8 MiB UTF-8, depth 32, 750,000 JSON values,
2,048 shared nodes, 512 meshes, 150,000 vertices, 50,000 triangles and 64 ancestors.
Source numeric tokens are at most 64 characters, exponent magnitude 100 and value
magnitude 10^12; index tokens are at most 12 characters. Read deadline is 15
seconds; decoding/validation and render preparation each have a cooperative
10-second budget. Large loops yield for cancellation. Bounded token-string JSON
parsing precedes any render conversion; JSON.parse only decodes bounded strings
and raw operation-order literals, never the mesh object graph.

Render typed arrays are checked against 32 MiB CPU and 16 MiB GPU allocation
estimates before allocation. At the triangle ceiling those arrays use 7.2 MB.
The picking framebuffer adds six estimated bytes per pixel, capped at 1,048,576
pixels. These account for requested buffers; they do not prove a 32 MiB total JS
heap or a 16 MiB driver/browser footprint. Decoded objects, text, exact arithmetic,
default framebuffer and driver overhead require target measurement before native
acceptance. The port must release its transport; aborting an await cannot release
an owner transport that ignores cancellation. Dropping references is not secure
memory erasure or an immediate garbage-collection guarantee.

Drawing is scheduled only on changed state with one pending animation frame,
suspended for hidden/offscreen canvases. Close, scope/key change, invalidation,
inactive state and unmount abort reads/preparation and release GPU handles and
drawing buffers. Context loss drops the scene and requires an explicit fresh
read; restoration does not revive old bytes. Picking uses a separate framebuffer
and reports only source object IDs. The source mesh selector provides keyboard
inspection independently of pointer picking.

## Validation status

`scan-mesh-read.mjs` defines a healthy synthetic local read with exact digest,
lineage, shared transforms, preserved tokens and display-buffer checks.
`scan-mesh-view-visual.mjs` defines static accessible markup and synthetic camera
fit checks. Neither test has implicit execution authority: register the complete
bodies/imports in the existing README lane before running. Static markup is not
live WebGL, screenshot, picking or context-loss QA. Live lifecycle/failure cases,
private specimen validation, native import and target rollout require their
separately reviewed lanes. Strict TypeScript and Vite source compilation alone
do not certify native or GPU acceptance.
