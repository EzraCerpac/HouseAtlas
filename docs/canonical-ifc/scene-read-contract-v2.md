# Canonical IFC scene read contract (proposal v2)

This proposal extends the [v1 scene contract](scene-read-contract-v1.md) for a
logical room spanning multiple floor-qualified `IfcSpace` occurrences. Its
routes, selection events and `ready` state are **not implemented**. PR177's
native IFC/GLB reader does not serve this scene. The checked-in fixture is a
public synthetic transport example, not a qualified house model.

## Identity and publication

The immutable source revision and original IFC digest follow v1. A pinned
`houseatlas.ifc-semantic-map.v2` has one logical `rooms[]` row per stable app
`roomId`. That row has nullable reviewed `atlasPlaceId` and `packagePlace`
links, a display name, and `occurrences[]` with distinct bounded opaque
`spaceOccurrenceId`, IFC `ifcSpaceGlobalId` and stable `floorId`. The token is
the exact `HouseAtlas_Identity.OccurrenceKey` on that IfcSpace; its
`EntityId` is the shared logical room UUID. Each occurrence must have exactly
one reviewed IFC storey relation. Floor and circuit identities, transitions
and uncertain electrical memberships follow the separate v2 semantic map.

`houseatlas.ifc-publication.v2` pins the source revision's canonical JCS
digest, retained IFC SHA, semantic-map revision and byte SHA, converter
executable/config SHA, axes, validation result and every floor artifact's
SHA/bytes. Its `validation.status: syntactic-and-repeatable` records only
deterministic preparation. Selection and promotion are separate reviewed
events; `ready` requires the full PR177 GLB qualifier, exact retained-byte
readback, native source-ledger proof and independently qualified conversion.
An immutable publication never changes when the selected pointer changes.

## Proposed scoped reader

The proposed authenticated v2 route is
`GET /api/atlas/ifc/v2/workspaces/{workspaceId}/homes/{homeId}/buildings/{buildingId}/scene`.
An explicit `?publicationId={publicationId}` reads an authorized retained
preview/history publication without falling back to current selection.
Publication history and artifact routes mirror the v1 contract under the v2
prefix. Artifact hrefs are scoped service routes, never permanent public URLs.
No route in this document is live.

The atomic scene snapshot is `houseatlas.ifc-scene-read.v2`, with `availability`,
`scope`, `selection:{revision,mode,publicationId}`, immutable `publication`
pins, `axes`, `floors`, `rooms`, `electricalGroups`, `semantics`, and `overlays`.
The [byte-exact synthetic example](fixtures/two-floor-v2/scene-read.json)
gives full field names and valid IDs/digests. Each floor carries stable
`floorId`, IFC storey GlobalId, display label, `elevationMm:null`,
`floorToSource:null`, `spaceOccurrenceIds`, and digest/byte/href triples for
GLB, feature JSON and SVG. `rooms[].occurrences[]` supplies the logical-to-
geometric join. A logical room may appear in several floors; a selection
target is `(publicationId,spaceOccurrenceId)`, while an Atlas overlay joins
`(publicationId,roomId,atlasPlaceId)` only after the native link is reviewed.
Names are never keys. Circuit overlays similarly use the stable group ID and
reviewed nullable native circuit ID; historical labels do not place fixtures.

The retained `houseatlas.ifc-floorplan.v2` feature JSON is authoritative for
2D hit geometry. Its `spaces[]` carries `{roomId,spaceOccurrenceId,ifcGlobalId,
polygons}` in source XY millimetres. Its `meshBindings[]` carries
`{meshIndex,nodeIndex,entityType:"spaceOccurrence",roomId,spaceOccurrenceId,
ifcGlobalId}`; it may bind only an occurrence present in that floor's spaces.
Every occurrence appears in exactly one floor's spaces. The publication-wide
semantics artifact carries the same bindings with `floorId`, plus the exact
map and IFC projection. A bound GLB node and mesh are both named
`ha-space/<roomId>/<SHA256(spaceOccurrenceId UTF-8)>` within PR177's supported
GLB name fields. The raw opaque key does not enter a GLB name. Unbound meshes
may display but cannot claim a room identity. The SVG is a render derivative;
its path attributes carry both IDs, with the opaque token XML-escaped.

The pinned source frame is claimed mm/Z; the GLB frame is m/Y with
`sourceToGlb:{axisMap:["x","z","-y"],scale:0.001}`. For source point
`(xMm,yMm,0)`, the floorplan SVG uses `(xMm,-yMm)` and GLB uses
`(xMm/1000,0,-yMm/1000)`. These claims require real IFC unit and placement
review before use. Null elevation/`floorToSource` and null physical transform
prohibit inferred cross-model registration. The current synthetic publisher
intentionally emits null floor transforms.

The reader must fence responses and overlays by selection revision,
publication ID and request owner. A changed selection yields `stale`/409 and
requires a fresh whole snapshot; a missing or digest-invalid pinned artifact
yields `unavailable`/404 without substituting another revision; a revoked
selection yields `revoked`/409 and clears cached handles. Scoped 403/404 must
not disclose another principal's publication. Network loss may display clearly
labeled last-known data, but disables overlays and writes pending a fresh
same-publication snapshot. The v1 lifecycle rules otherwise apply.

## Public synthetic fixture and holds

After inspecting the script, the named fixture command is:

```sh
python3 tools/ifc_publication/make_synthetic_fixture_v2.py --output /tmp/houseatlas-ifc-synthetic-v2
```

The checked-in `fixtures/two-floor-v2/` tree contains `inputs/`,
`publication/publication.json`, `publication/semantics.json`, each floor's
`model.glb`, `floorplan.json` and `floorplan.svg`, `receipt.sha256`, and
`scene-read.json`. One logical synthetic room spans two IFC spaces on two
storeys. Its fictional `ready` status exercises a frontend mock only; it is
not a service promotion or real converter result. No household source,
physical partition, native Atlas link, elevation or floor transform is
established by this fixture.
