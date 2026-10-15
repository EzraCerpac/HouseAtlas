# Canonical IFC scene read contract (proposal v1)

This is the frontend/backend integration contract for a future canonical IFC
publication reader. The routes and selection state below are **not implemented
by this PR**. PR177 only adds source-bound native IFC/GLB custody and reading.
Synthetic IDs in this document are illustrative; no household model or evidence
belongs in this repository.

## Ownership and immutable identity

An editable IFC original is retained as an immutable source revision with
`profile: houseatlas.ifc-source-revision.v1`, stable `sourceId`, immutable
`revisionId` (called `sourceRevisionId` in readers), `parentRevisionId`, exact
`ifcAsset` `{assetId,sha256,bytes}`, and scope `{workspaceId,homeId,buildingId}`.
The optional paired semantic-map ID/SHA pins the reviewed mapping. An immutable
`houseatlas.ifc-semantic-map.v1` map pins that `sourceRevisionId` and original
IFC SHA. It assigns stable app `roomId`, `groupId`, and `floorId` UUIDs. IFC
GlobalIds are revision-specific external bindings. Atlas `placeId` and
`circuitId` are nullable until reviewed; names and historical electrical labels
never act as keys. Splits, merges, rebinds and retirements require explicit
versioned transition records. A publication (`houseatlas.ifc-publication.v1`)
pins source revision and SHA, semantic-map revision and SHA, converter/config,
axes, validation, and every derivative's SHA/bytes. It is immutable.
`sourceRevisionSha256` is the ledger's canonical JCS digest; the publication
also records the distinct raw source-receipt file SHA. A single publication
contains all mapped floors of one source/map pair, sorted by stable floor ID.
Its repeatable converter receipt is only preparation: promotion to `ready`
requires the full PR177 native GLB qualifier on every pinned GLB, complete
per-floor 2D/3D room membership validation, and exact artifact readback.

Selection is a separate, review-authorized, revisioned pointer, with
`publishedPublicationId` and optional `previewPublicationId`. Source revision
states are `draft` and `retained`; publication states are `candidate`,
`validated`, `preview`, `published`, and `revoked`. Those states live in event
history, not in a mutable publication receipt. Promotion never rewrites a
publication or silently updates an open reader. A preview request is explicit;
ordinary reads select only the published pointer.

## Proposed authenticated read routes

All routes use the current scoped native session and authorization policy. They
must be implemented and reviewed before use:

- `GET /api/atlas/ifc/v1/workspaces/{workspaceId}/homes/{homeId}/buildings/{buildingId}/scene` reads the current published selection.
- The same route with `?publicationId={publicationId}` reads that exact retained publication for authorized preview/history, without falling back to current.
- `GET /api/atlas/ifc/v1/workspaces/{workspaceId}/homes/{homeId}/buildings/{buildingId}/publications` lists retained receipts and selection events, paginated.
- `GET /api/atlas/ifc/v1/workspaces/{workspaceId}/homes/{homeId}/buildings/{buildingId}/publications/{publicationId}/floors/{floorId}/artifacts/{glb|floorplanFeatures|floorplan2d}` serves one floor's SHA-pinned immutable artifact.
- `GET /api/atlas/ifc/v1/workspaces/{workspaceId}/homes/{homeId}/buildings/{buildingId}/publications/{publicationId}/artifacts/semantics` serves the publication-wide pinned semantic artifact. Artifact responses carry declared byte length and digest; the routes are scoped, not public or permanent URLs.

The scene response is a single atomic snapshot, with an `ETag` over selection
revision plus receipt digest. An example shape (types and field names are the
contract; IDs and hashes below are abbreviated for readability):

```json
{
  "schema": "houseatlas.ifc-scene-read.v1",
  "availability": "ready",
  "scope": {"workspaceId": "uuid", "homeId": "uuid", "buildingId": "uuid"},
  "selection": {"revision": "uuid", "mode": "published", "publicationId": "uuid"},
  "publication": {
    "publicationId": "uuid", "sourceRevisionId": "uuid", "sourceRevisionSha256": "sha256",
    "sourceIfcSha256": "sha256", "semanticMapRevisionId": "uuid", "semanticMapSha256": "sha256",
    "validation": "syntactic-and-repeatable"
  },
  "axes": {
    "source": {"units": "mm", "upAxis": "Z"},
    "glb": {"units": "m", "upAxis": "Y"},
    "sourceToGlb": {"axisMap": ["x", "z", "-y"], "scale": 0.001},
    "physicalRegistration": {"status": "unverified", "transform": null}
  },
  "floors": [{
    "floorId": "uuid", "ifcBuildingStoreyGlobalId": "IFC GlobalId", "label": "display only",
    "elevationMm": null, "floorToSource": null,
    "artifacts": {
      "glb": {"sha256": "sha256", "bytes": 123, "href": "scoped artifact route"},
      "floorplanFeatures": {"sha256": "sha256", "bytes": 123, "href": "scoped artifact route"},
      "floorplan2d": {"sha256": "sha256", "bytes": 123, "href": "scoped artifact route"}
    },
    "roomIds": ["uuid"]
  }],
  "rooms": [{"roomId": "uuid", "floorId": "uuid", "ifcSpaceGlobalId": "IFC GlobalId",
             "atlasPlaceId": null, "displayName": "display only"}],
  "electricalGroups": [{"groupId": "uuid", "ifcCircuitGlobalId": null,
                        "atlasCircuitId": null, "membershipStatus": "unknown"}],
  "semantics": {"sha256": "sha256", "bytes": 123, "href": "scoped artifact route"},
  "overlays": {"publicationId": "uuid", "semanticMapRevisionId": "uuid",
               "roomKey": "roomId", "electricalGroupKey": "groupId"}
}
```

Every real response must contain full canonical UUIDs and 64-character SHA-256
digests; this abbreviated example is not a valid wire fixture. A `ready` scene
contains one revision's complete artifacts and map. A retained feature artifact
is canonical JSON with `profile: houseatlas.ifc-floorplan.v1`, source/map pins,
`units: mm`, `upAxis: Z`,
`floor:{floorId,ifcBuildingStoreyGlobalId,label,elevationMm,floorToSource}`,
bounded `spaces` entries
`{entityId:roomId,ifcGlobalId,polygons:[[[xMm,yMm],...]]}`, and the verified
`meshBindings` described below. Its SVG sibling has profile
`houseatlas.ifc-floorplan-svg.v1` and is a
render derivative with `data-entity-id=roomId`; the feature JSON is the
authoritative 2D hit/selection geometry. Neither uses a floor name as identity.
Each `roomId` belongs to exactly one stable `floorId` in the reviewed semantic
map and is linked to that IFC storey by an exact `IfcRelAggregates` edge.
Each floor's feature `spaces` must equal its mapped rooms; mesh bindings must
refer only to rooms in those same spaces. A missing room holds the publication.

The GLB is the closed `houseatlas.ifc-derived-glb.v1` profile from PR177. Its
asset-level receipt pins source SHA, declared source mm/Z, output m/Y, and
`sourceToGlb: {axisMap:[x,z,-y],scale:0.001}`. Because this profile only admits
node `{name,mesh}` and mesh `{name,primitives}`, the semantics artifact must
carry verified `meshBindings` entries
`{floorId,meshIndex,nodeIndex,entityType:"room",entityId:roomId,ifcGlobalId}`;
the matching floor feature JSON carries the same entries without `floorId`.
Each bound mesh and node name is `ha-room/{roomId}` and its IFC GlobalId agrees
with the map. Unbound meshes render but are not selectable as rooms. An overlay
joins by the snapshot's `publicationId` and stable `roomId`/`groupId`; reviewed
Atlas IDs are optional links. Circuit membership and physical fixture positions
require their own reviewed associations; labels alone create no placement.
The feature JSON retains source XY millimetres. Its SVG derivative inverts Y,
displaying each point `(xMm,-yMm)`; a source-floor ground point `(xMm,yMm,0)`
maps to GLB `(xMm/1000,0,-yMm/1000)`. The frontend must use those same pinned
axes for 2D hit targets, 3D highlighting and camera focus; an independently
normalized scan frame does not supply a cross-model transform.

The `axes` values are converter claims until a real IFC unit/axis and physical
registration review succeeds. A null `floorToSource` or physical transform
means the viewer may show that floor in its own frame but must not infer a
shared household transform from independently normalized scans. Once validated,
the server reports per-floor elevation and matrix in the same source frame;
both 2D and 3D use that one transform for the same publication.
The first publisher emits `floorToSource: null` while IFC placement-chain
validation is pending. It admits a non-null `elevationMm` only when equal to an
explicit elevation in the pinned IFC building storey.

## Reader lifecycle

`availability` is `ready`, `stale`, `unavailable`, or `revoked`. `stale` means
the selected pointer changed after the supplied `If-None-Match`/snapshot token;
the client discards the prior response and fetches a fresh whole scene.
`unavailable` means a required pinned artifact is missing or fails its digest;
the reader shows an unavailable state and does not substitute a different
revision. `revoked` means the selected publication was explicitly withdrawn;
the reader clears selection and any cached artifact handle. Scoped 403/404
responses do not reveal whether another principal's publication exists.
Network loss retains only clearly labeled last-known display data; overlays and
write actions are disabled until a fresh same-publication snapshot is read.
The frontend must fence late responses by publication ID, selection revision,
and request owner/abort token so navigation cannot mix revisions.

The endpoint names, selection events, feature artifact and lifecycle behavior
are proposed integration work, not an assertion that current PR177 serves them.
Backend/source/pipeline owners own those routes, immutable receipts and custody.
The separate Opus frontend owner owns new viewer files under
`frontend/src/lantern/canonical-ifc/`, including synchronized 2D/3D,
selection/navigation and visual design. Changes to existing scan/profile/native
client files are coordinated as a small later integration patch.

## Public synthetic fixture

`docs/canonical-ifc/fixtures/two-floor/scene-read.json` is an exact mock
response for a frontend transport test. It joins the same directory's
`publication/publication.json`, `publication/semantics.json`, per-floor
`model.glb`, `floorplan.json`, and `floorplan.svg` with complete UUIDs, SHA-256
digests, byte lengths and proposed scoped artifact hrefs. The `inputs/` files
are generated IFC, map, source receipt, config and a tiny synthetic converter;
`receipt.sha256` pins the canonical publication receipt. The complete fixture
contains no private house data. Its `ready` status is **fictional mock service
state**, not a claim that a native reader or promotion gate has passed.

Frontend tests may import this fixture and serve its artifact bytes through a
local owned transport keyed by `href`, while asserting the declared digest,
length, publication ID and floor/room linkage. The separate publisher's named
generator interface is `python3 tools/ifc_publication/make_synthetic_fixture.py
--output <new-empty-directory>`; that tool is still in an isolated cloud branch
and is not part of PR177. The checked-in fixture provides stable consumer input
until the publisher branch is independently reviewed and integrated.
