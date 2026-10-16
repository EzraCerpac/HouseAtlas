# Unified Atlas scene export v1

Draft producer and consumer handoff. The routes below are proposed, not live.
This is a read model for one Blender/Bonsai publication, not a native import or
registration framework. The currently served overview GLB alone does not satisfy
this contract or establish room, floor, plan or overlay bindings.
Reuse the existing canonical v2 logical-room/occurrence identity semantics and
reviewed maps within this home/site container. Do not create a second identity
map or independently authored house. Actual IFC IDs can be retained where the
source provides them; a plain Blender object must not invent an IFC identity.

## One selection and one scene

The Atlas opens one selected publication. Building navigation, room selection,
2D plans, 3D geometry, roof/floor reveal, exploded presentation and overlays all
use that publication. An older scan plan or another model revision is not a
silent substitute. Retained legacy data and originals remain available through
their existing owners; they are not a competing default Atlas scene.

The practical producer input is one private `atlas-scene.json` companion beside
the existing selected overview publication/GLB. It is opt-in through paired
`--atlas-scene-manifest` and `--atlas-scene-manifest-sha256` serve options. No
fields are added to the existing closed overview-v1 response. The companion
must match that overview's exact scope, publication ID, GLB SHA256 and bytes.

```text
{
  profile:"houseatlas.unified-atlas-publication.v1", scope,
  publicationId, sourceRevisionId, sourceSha256,
  original:{sha256,bytes}, frame,
  buildings, levels, rooms, occurrences, meshBindings,
  plans, overlayBindings, coverage
}
```

The proposed current read is
`GET /api/atlas/models/v1/workspaces/{workspaceId}/homes/{homeId}/atlas`.
It returns one `houseatlas.unified-atlas-scene.v1` envelope:

```text
{
  profile, scope:{workspaceId,homeId},
  selection:{revision,publicationId},
  publication:{publicationId,sourceRevisionId,sourceSha256,semanticsSha256},
  frame:{units:"m",upAxis:"Y",horizontalAxes:["X","Z"],
         geometryPlacement:"gltf-world-after-node-transforms-once",
         physicalRegistration:null},
  artifacts:[{artifactId:"model",role:"model",contentType:"model/gltf-binary",
              bytes,sha256,href}],
  buildings:[Building], levels:[Level], rooms:[Room],
  occurrences:[Occurrence], meshBindings:[MeshBinding],
  plans:[Plan], overlayBindings:[OverlayBinding],
  coverage:{selectableOccurrences,unselectableOccurrences,exclusions}
}
```

`selection.revision` fences every response, resource and overlay. Publication
and source revision identify immutable bytes; a replaced selection is a new
revision. Scope and current native access come from the host, never the asset.
The existing overview pins complete GLB bytes. The external companion SHA pins
all semantic and inline plan bytes together; `publication.semanticsSha256` in the
HTTP envelope is that exact companion byte SHA. Retain original source dates,
generated/retrieved dates, estimated dimensions and provenance; unknowns remain
null. Producer `atlas-scene.json` contains neither its own digest/artifact entry
nor host selection revision, live hrefs, active overlay data or access assertions.
The host creates the read envelope above by adding selected scope/revision, pins
and read hrefs; there is no circular self-hash. Native link IDs, source overlay
anchors and receipt hashes in the companion are documentary references, not
current native authorization.

The proposed artifact read is
`GET /api/atlas/models/v1/workspaces/{workspaceId}/homes/{homeId}/atlas/{publicationId}/artifacts/{artifactId}?expectedSha256={sha256}&expectedSelectionRevision={revision}`.
The only artifact ID in this bounded reader is `model`; its bytes come through
the existing selected overview original reader. Plans are inline companion JSON,
so this adds no general artifact registry, download platform or second GLB.
Reuse the existing Read/Media, same-origin, retained-principal and final-current
checks. Return private no-store bytes with exact type, length and digest. This
adds no accounts, grants, tokens or native writes. A changed selection is stale;
missing or mismatched required bytes are unavailable, never another revision.
The host supplies both query pins in its href and returns
`x-atlas-selection-revision`. Check the exact revision before and after byte
work, including a reselection of the same publication. Overlay requests carry
the same expected revision and publication; invalidate their owned handles on
either change. The revision is a selection correlation, not a media grant.

## Producer identities and native joins

```text
Building = {buildingId,label,nativePlaceId:null|UUID,
            bounds:{min:[x,y,z],max:[x,y,z]},levelIds:[id]}
Level = {levelId,buildingId,label,nativePlaceId:null|UUID,
         sourceElevationM:null|number,elevationBasis:null|string,
         occurrenceIds:[id],bounds:{min:[x,y,z],max:[x,y,z]}}
Room = {roomId,buildingId,label,nativePlaceId:null|UUID,
        nativeBinding:{status:"reviewed"|"historical"|"unmapped",
                       receiptSha256:null|SHA},occurrenceIds:[id]}
Occurrence = {spaceOccurrenceId,roomId,buildingId,levelId,
              bounds:{min:[x,y,z],max:[x,y,z]},planFeatureIds:[id],
              geometryBasis:{kind:"source-model"|"owner-estimated-pick-proxy",
                             sourceRef:null|string,note:null|string}}
```

Source building, level and logical room IDs persist in producer custom
properties or its retained identity map. They are separate from nullable native
AtlasPlaceIds. Reuse explicit existing logical room and occurrence IDs only
through the producer's reviewed identity map; names and IFC GlobalIds are not
joins. New rooms can be selectable under a persistent source identity while
their native link is unknown. A logical room can have several occurrences on
different levels. Occurrence identity is immutable; its historical key text
does not establish current level membership.

An internal model frame is sufficient for coherent plans, picking and exploded
presentation. It does not require claiming physical registration to old scans.
Use actual source per-space/slab elevations, including split levels and stairs;
do not assume evenly spaced whole-floor slabs. Exploded offsets are transient
display translations, never source elevations or native memberships.
All building, level and occurrence bounds, plan X/Z coordinates and qualified
overlay source positions use the same glTF world frame after node transforms
have been applied once. A source-to-geographic origin is provenance, not an
additional renderer translation.

## Exact mesh membership and matching plans

```text
MeshBinding = {artifactId:"model",nodeIndex,meshIndex,primitiveIndices:[integer],
               buildingId,levelIds:[id],spaceOccurrenceId:null|id,
               role:"structure"|"roof"|"slab"|"room-pick"|"context"}
Plan = {planId,buildingId,levelId,
        coordinates:"scene-XZ-metres",featureIds:[id],features:[PlanFeature]}
PlanFeature = {featureId,roomId:null|id,spaceOccurrenceId:null|id,
               role:"room"|"wall"|"opening"|"stair"|"context",
               polygons:[{outer:[[x,z]],holes:[[[x,z]]]}]}
```

The producer supplies exact node/mesh/primitive indices for the pinned GLB.
Validate each selector against those bytes. Do not infer identity from object
names, proximity, material, filename or node order across revisions. Explicit
building/level and roof/slab groups support entry, reveal and explosion. Shared
structure can have several declared level memberships; it is not automatically
a room pick target. Every advertised selectable occurrence needs both explicit
room-pick GLB primitive membership and its matching source plan polygons; an
unbound decorative mesh is not a room. The producer includes estimated pick
proxies in the same GLB, not just a metadata label or unrelated building mesh.
An explicitly owner-authored preliminary room pick volume is allowed with
`geometryBasis.kind:"owner-estimated-pick-proxy"` and its source/note. Its
matching plan polygon is derived from that same proxy and keeps that basis;
neither representation claims measured room dimensions or area. A label alone
cannot generate a pick volume or infer its physical boundary.
When a primitive belongs to several levels, leave it at its source position
during explosion. Move only single-level groups by that level's temporary
display offset; never duplicate shared geometry or choose a level arbitrarily.

Inline plan JSON is authoritative hit geometry; SVG/PNG are optional derivatives of that same
source revision and frame. A polygon in scene X/Z and its 3D occurrence refer to
the same place after the standard loader applies node transforms exactly once.
Do not independently normalize, rotate or fit each floor. Apply no second
building transform to already placed geometry. Polygons and mesh memberships
must cover every occurrence advertised as selectable. Record genuine gaps in
coverage instead of pretending the old plans match the new model.

## Overlay handoff

```text
OverlayBinding = {publicationId,kind:"electrical"|"network",
                  sourceRevision:string,sourceUpdatedAt:null|string,
                  retrievedAt:null|string,roomId,spaceOccurrenceId:null|id,
                  nativePlaceId,recordIds:[id],
                  anchor:{kind:"room-summary"}|{
                    kind:"source-position",position:[x,y,z],basis:string}}
```

The host resolves current native electrical/network data through reviewed
native IDs and binds it to this publication and logical room. Source/native
IDs are not inferred from display labels. Existing source owners retain
authority; the model exporter does not manufacture device/circuit membership.
Only the host's current native read, identity/source qualification and Media
owners activate these links. Historical IDs or exporter receipt declarations
alone cannot activate an overlay. Reuse existing electrical documentary and
network adapters through this explicit publication/selection binding; do not
cast standard Blender data as an IFC publication or change closed native
fixture payloads.
A room-summary marker or room highlight is a presentation anchor, not the
physical position of a socket/device. Existing documentary fixture glyphs and
historical group labels remain distinct from verified installed counts, cable
routes and metric placement. A source-position anchor requires actual supplied
qualification; otherwise use a room summary and preserve unknown placement.

Unmapped rooms still render and select. An unavailable overlay states its own
reason without switching to old geometry or hiding the rest of the Atlas.
Replacement/logout/access invalidation immediately withdraws owned overlays
and pending reads. The same selected room/occurrence survives 2D/3D navigation
within the publication. Offline retained copies will use these same identities
and geometry with explicit saved-at documentary semantics.

## Bounded handoff and acceptance

Reuse the existing standard GLTFLoader and its admitted no-external-resource
profile and aggregate budgets. Target the existing 32 MiB GLB and 64 MiB prepared
asset limits; validate the actual mounted chunk budget against the server's
4,000,000-byte per-file ceiling. Do not broaden formats or work limits silently.
The companion is at most 12 MiB: non-plan semantic JSON at most 4 MiB and all
inline plan JSON at most 8 MiB combined. The complete retained publication is
at most 64 MiB. Bound the complete scene to 128
buildings, 64 levels, 2,048 rooms, 4,096 occurrences, 8,192 mesh memberships,
200,000 polygon points and 8,192 overlay records. Geometry, transforms, bounds
and polygon values must be finite and within 1,000,000 metres of the declared
scene origin. Validate aggregate limits before loader/plan allocations; a
required over-budget or unresolved member makes the publication unavailable.

Producer: exact source revision, identity map, GLB, plans, mesh groups, bounds
and per-space elevations. Source owner: immutable artifact custody, semantic
validation, reviewed native joins and authenticated read delivery. Existing
frontend owner: one Atlas mount, navigation, picking, transitions and overlay
presentation. NAS owner: reviewed target release only. No alternate UI author.

Before product readiness, inspect the actual supplied publication in the actual
app browser: default Atlas, individual room picks, all-level explosion, building
entry/return, same-room 2D/3D navigation and electrical/network overlays. Record
desktop/mobile pixels and a real interaction playthrough. CPU parsing, static
Blender renders, synthetic fixtures and obsolete-head CI do not replace this.
