# Assistant-managed scan replacement planning

The local assistant tool produces a durable proposal for replacing selected
floors. It preserves the selected original/version references, stable place
identities, reviewed correspondence history and overlay associations. It has no
web import flow, custody upload, Stock intent or native mutation method.

## Current capabilities and missing native step

Originals and authored derivatives have independent retained custody. Generic
geometry records already contain `geometryVersion` and `previousGeometryId`;
scene associations have append-only versions and a current-head read. Room
mappings and floor bindings retain exact source, receipt, native geometry and
revision pins. Package place keys/UUIDs remain separate from native place IDs.

The current native mesh bundle still admits only geometry version 1 with a null
predecessor and empty mappings. Its reader enumerates eligible roots by geometry
ID; the mounted scan view uses the first three descriptors. Those operations do
not select replacement heads. Physical scale and alignment remain unknown, with
no accepted stage-to-house transform. Normalized display room regions are not
measured placement.

This PR adds the planning boundary only. Completed native replacement needs a
separately reviewed extension to the existing association qualifier and reader:

1. Qualify a new geometry against an explicit, guarded predecessor already
   associated with the same scoped building; require an increasing version and
   retain the original evidence/assets and existing identity payload.
2. Resolve one explicitly qualified head per predecessor lineage; do not select
   by label, date, lexical ID or list position. Refuse ambiguous forks rather
   than hiding a historical version or guessing a floor.
3. Create a fresh guarded scene-association version with the new exact native
   floor pins and reviewed room/frame applicability. Retain prior mappings,
   native identities and overlay facts. Confirm the head through the existing
   authenticated read owner before mounting.

The relevant native owners are `backend/src/media/geometry_bundle.rs`
(`geometry_profile`, `qualify_association`, `floors`) and
`frontend/integration/native-geometry-association-client.ts` (`prepare`). The
existing scene-association owner already versions its accepted history; it must
receive refreshed bindings rather than a fabricated replacement receipt.

No backend, client, schema, shared UI or admission guard is changed here.

## Explicit input

`buildReplacementPlan` accepts a closed local selection:

- `association`: the existing closed `sceneAssociationRecord`, including its
  scoped native ID/revision, literal canonical accepted receipt and complete
  anchor/target membership.
- `floors`: up to three selected retained snapshots. Each has `key`,
  `exportLabel`, `originalSha256`, `derivativeSha256`, a complete existing
  `geometryRecord`, and immutable `meshBytes` (`Uint8Array`).
- `successors`: only the floors being replaced, in the same snapshot shape.
  Their geometry record has a new ID, creation revision 1, exact predecessor
  ID and next version. Omitted floors retain their selected prior snapshot;
  omission never means deletion. New/removed floor identities require separate
  review and are not inferred from these inputs.
- `roomSupport`: independently selected documentary dependencies, each with
  `sourceRoomId`, `sourceFloorKey`, `sourceOriginalSha256`,
  `derivativeSha256`, `receiptSha256`, and `meshIds`. These pin the old receipt
  and old derivative; they do not turn source meshes into semantic rooms.
- `retainedState`: `identities`, `overlayAssociations`, `floorPlacementFacts`.
  These bounded, opaque historical facts are copied unchanged. The tool neither
  authenticates them nor promotes package UUIDs into native IDs. A placement
  fact with exact `geometryId`, `originalSha256`, `derivativeSha256` gets an
  explicit frame-applicability result; an unpinned fact stays unqualified.

The CLI uses `meshFile` instead of `meshBytes`, relative to the selected manifest
or absolute. It opens only the selected manifest and these explicitly named
regular, nonsymlink mesh files. It does not scan Downloads, call a provider,
follow a URL, inspect a live database or infer inputs from names.

The existing Atlas schemas validate geometry and scene-association records.
The actual lossless `readScanMesh` implementation validates each selected
derivative's digest, lineage, raw tokens and complete authored transforms. All
prior source-floor/native-geometry pins and accepted anchor memberships must
match. An input selection is historical evidence supplied by the caller;
native current-head freshness is explicitly unverified.

## Changes and reusable facts

Object fingerprints include raw positions and indices, orientation, every
ancestor and reset/op order, operation matrices and the composed transform.
Coordinate metadata and converter provenance also fence reuse. A repeated prim
path or room name alone establishes nothing. Rooms are scoped by source floor
and source room ID, so repeated local labels do not join different floors.

For a replacement, a resolved room with exact unchanged reviewed support is
`reuse-proposed`. A changed/removed dependency is `changed`; missing dependency
evidence is `requires-support-review`; unresolved correspondence is `unmatched`.
Only changed support is flagged for its room. A frame change invalidates all
dependent reuse. Untouched selected floors and mappings are `retained`, meaning
no successor was selected for those historical inputs, not freshly available
native records.

Each prior mapping is preserved exactly, including native-null targets and its
original receipt/source hash. A changed original may still have identical mesh
support, but reuse remains a proposal requiring a fresh native binding and
normal reviewed acceptance. The tool issues no accepted replacement receipt.

Prior units, scale, affine transform and elevation/alignment facts survive as
historical evidence. Exact supported geometry can make them reviewable for the
candidate; changed geometry leaves them prior-frame-only. No values are inferred,
rescaled, clamped or made physically accurate. Qualification remains unknown.

This is structured retention, not a text summary. A selected placement fact can
carry its full numeric `stageToHouseTransform` (16 coefficients), explicit
`matrixConvention`, `fromFrame`, `toFrame`, `coordinateUnits`, numeric
`elevation` with units/reference frame/axis, and its original `evidenceReceipt`
ID/hash/review status, alongside the exact prior geometry/original/derivative
pins above. Every field survives artifact readback unchanged. The planner does
not interpret an opaque fact or authenticate its review; `accepted` in caller
history does not accept its application to a successor. Exact geometry makes
that application reviewable, while a changed frame requires new review.

Room correspondence is retained as the complete accepted source-anchor/target
mapping plus `roomSupportEvidence`: exact source floor/room/original, derivative
and receipt hashes, and the reviewed mesh IDs. The artifact also retains both
versions' object fingerprints and complete geometry/receipt records. It can
therefore identify the old room-to-geometry support, rather than retaining only
an alias or descriptive label. It does not create missing support or a room
outline. A synthetic reopen case verifies these numeric values and correspondence
bytes for both an unchanged and a changed-frame successor.

Native placement application is still separate: the current geometry payload
has a six-coefficient affine `transform`, and the native mesh profile requires
it to be null. The scene association carries room correspondence and floor
bindings, not a full 4x4 placement or elevation payload. Floor elevation has its
existing location-semantics owner. A successor implementation must retain and
qualify these existing owners' reviewed evidence and frame applicability; it
must not place a 4x4 matrix into the six-coefficient field or infer a new floor
elevation from the planner artifact.

## Durable output and reversal

The artifact includes both full selected geometry records and hash/asset/version
pins, old/new frame metadata and per-object fingerprints, the complete previous
scene payload/receipt, support evidence, copied identity/overlay/placement facts,
producer source hashes, changed-object lists and reversal references.

`writeReplacementArtifact` requires a new absolute child under a canonical,
owned, mode-private parent. It exclusively creates a mode-0700 directory and
two create-only files: `replacement-plan.<SHA256>.json` and `SHA256SUMS`. The
canonical plan bytes are deterministic for the same ordered selection and tool
source. Both files become mode 0400; file contents/modes and child/parent
directory entries are fsynced before success. This is local proposal retention,
not native custody or a guarantee against concurrent hostile path replacement
or every storage failure. Partial emission cleanup is best effort and restricted
to the child this call created. Existing output directories are never adopted.

The manifest and output are each bounded to 2 MiB. At most three old and three
new derivatives are each bounded to 8 MiB, using the existing mesh/work bounds.
Support is capped at 256 room entries; opaque state arrays at 1024 entries each.
No textures or extra coordinate copies are emitted. Originals and prior evidence
are referenced, never rewritten or deleted.

Reversal means a new reviewed scene association selecting the prior retained
geometry and receipt pins. It does not decrement versions, rewrite history,
delete identities or restore physical placement by inference.

## Exact local commands

Inspect the complete tool, synthetic test and existing source-loader imports.
Use pinned Node 26.10.0 and the existing locked frontend dependency cache, with
no install. The healthy tests use only generated scan data and two owned private
temporary artifact directories, then remove only their own temporary parent:

```sh
node --test --test-concurrency=1 tools/geometry/scan-replacement-plan.test.mjs
```

Assistant operation, after explicit selection of retained local files:

```sh
node tools/geometry/scan-replacement-plan.mjs /absolute/private/selection.json /absolute/private/NEW-artifact-directory
```

The command prints only the artifact digest, size and filename after retention.
Keep its input and output private. This PR's verification uses synthetic inputs;
it does not authorize household intake, publication, POST, mounted adoption or
deployment. Native replacement remains the explicit next gap above.
