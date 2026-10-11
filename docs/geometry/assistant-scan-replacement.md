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
  Native descriptor keys are lowercase SHA-256 digests. Retained geometry must
  match the current native Magicplan/USDZ root profile: version 1, null
  predecessor, unknown units, null scale/transform, no mappings and one evidence
  reference distinct from the scene document evidence IDs. Retained derivatives
  require the exact schema/code/profile converter digest triple pinned by the
  current native mesh qualifier; the artifact retains that triple. These are
  metadata checks, not proof of converter execution or native custody.
  A proposed successor is never treated as an already retained floor.
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
Non-null geometry HomeBox references must share the geometry record's workspace
and home and use the HomeBox entity source kind. Source existence and accepted
binding checks remain with the native owner.

The actual lossless `readScanMesh` implementation validates each selected
derivative's digest, lineage, raw tokens and complete authored transforms. All
native integer-valued mesh fields retain unsigned integer JSON tokens, matching
the native qualifier; decimal or exponent spellings are not native-qualified.
Selected JSON keys and strings require paired Unicode, including receipt data.
Canonical-receipt mismatch errors report a generic message without literal diffs.
All
prior source-floor/native-geometry pins and accepted anchor memberships must
match. Every selected retained geometry must occur in the association; a shared
workspace/home alone does not establish building membership. Each native floor
descriptor key has one source-floor binding, and source-floor keys are unique,
in the current native owner/reader profile;
corrected source versions retain distinct bindings or require a new reviewed
association. Native room entry IDs are globally distinct, with at most 32 entries
and at most 32 accepted source anchors per entry,
and each entry's reviewed anchors join one consistent package place. Repeated raw
producer labels retain their separate source/provenance namespace; the planner
never renames them or invents native IDs. Multi-place source spans require review
outside this current native room-entry profile. An input selection is historical evidence supplied by the caller;
native current-head freshness is explicitly unverified.

## Changes and reusable facts

Object fingerprints include raw positions and indices, orientation, every
ancestor and reset/op order, operation matrices and the composed transform.
Coordinate metadata and converter provenance also fence reuse. A repeated prim
path or room name alone establishes nothing. Source floors are scoped by their
key plus original hash, and rooms additionally by source room ID. Repeated labels
on different floors or corrected source versions do not join their support.
Geometry record `coordinateUnits`, `scale` and its six-coefficient `transform`
also fence the frame comparison; changed placement metadata requires review
and unknown units require null scale and transform. Selected original asset IDs
retain one digest and compatible asset purpose across scene documents, prior
floors and successors; evidence and geometry originals cannot share an ID. New
derivatives of the same original digest also preserve its original byte count
and primary-layer name, digest and byte count. Exact integer comparison preserves
the raw lineage count tokens in old/new/reversal pins; source originals themselves
remain external to this proposal and their custody bytes are not authenticated.
New
geometry IDs also remain distinct from the association and directly referenced
asset, evidence and native identity IDs. Package place UUIDs retain their separate
namespace. Geometry records use the published backward-time predicate, preserving
schema-valid leap-second date literals, and distinct producer-room mapping IDs.
Future successor geometry records and opaque prior proposal history remain
proposal evidence until the separate native version/read profile is extended.
Mapping references are preserved proposals; these local checks do not authenticate
their identity/evidence records or qualify a complete native graph. New successor
descriptor keys must differ from every prior descriptor key,
even when the authored derivative is identical. Multi-anchor correspondence
retains the complete set union of its accepted targets and unresolved labels,
matching the existing contract semantics. Input byte ownership is copied before
the first await, including Node Buffer inputs, so normal caller buffer reuse
cannot change the selected snapshot.

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
Explicit null and other opaque scalar/array facts also survive readback;
they remain unqualified and cannot acquire a geometry frame.
Direct API selections must be JSON-round-trip-stable: unsupported values such
as undefined, sparse slots, non-finite numbers and negative zero are refused
before a plan is produced. Ordinary and null-prototype JSON data objects are
supported; their data fields survive while containers normalize to ordinary
JSON objects. Accepted receipt literals obey the existing 131,072 UTF-8 byte limit,
and every receipt anchor must belong to a selected source-floor key/hash pair.
The current native scene profile requires exactly one primary and one documentary
text original with distinct asset IDs. The documentary digest must equal the
receipt's `sourceReceiptSha256`; its actual custody bytes remain unverified here.
Receipts require at least one anchor. Association roots use version one and no
predecessor; a later association cannot name itself as predecessor. Full retained
predecessor records and current native lineage heads remain outside this input.

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
Producer provenance includes the SHA256 and size of the exact compiled decoder
module passed to `import`, including its embedded decimal and yield-task imports,
as well as the raw mesh-reader entry hash. A change to embedded dependency or
compiler output changes verifier provenance even when the entry file is unchanged.

`writeReplacementArtifact` requires a new absolute child under a canonical,
owned, mode-private parent. It exclusively creates a mode-0700 directory and
two create-only files: `replacement-plan.<SHA256>.json` and `SHA256SUMS`. The
canonical plan bytes are deterministic for the same ordered selection and tool
source. Both files become mode 0400; file contents/modes and child/parent
directory entries are fsynced before success. This is local proposal retention,
not native custody or a guarantee against concurrent hostile path replacement
or every storage failure. Partial emission cleanup is best effort and restricted
to the child this call created. Existing output directories are never adopted.

The manifest and output are each bounded to 2 MiB. The selected scene payload
also retains the existing contract's separate 524,288-byte limit. At most three old and three
new derivatives are each bounded to 8 MiB, using the existing mesh/work bounds.
Support is capped at 256 room entries; opaque state arrays at 1024 entries each.
Selected derivatives are decoded sequentially on the local event loop, retaining
each actual reader's time/work budget without charging other floor parsers to it.
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
