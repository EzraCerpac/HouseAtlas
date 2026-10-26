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
The shared `publicationId` is a canonical lowercase UUID, as required by the
existing overview-v1 reader. Source revision and semantic entity IDs keep their
separate source-owned identity rules; changing this host publication ID does
not require changing geometry or those source identities.

```text
{
  profile:"houseatlas.unified-atlas-publication.v1", scope,
  publicationId, sourceRevisionId, sourceSha256,
  original:{sha256,bytes}, frame,
  buildings, levels, rooms, occurrences, meshBindings,
  plans, overlayBindings, coverage
}
```

The selected current read is
`GET /api/atlas/models/v1/workspaces/{workspaceId}/homes/{homeId}/atlas?expectedManifestSha256={overviewManifestSha256}`.
The expected value is the captured overview selection's manifest digest, never
the GLB, semantic companion or source digest. A mismatch returns 409. The
`x-atlas-overview-manifest-sha256` response header echoes the selected digest;
the consumer compares it before admitting the scene. Legacy no-query reads
remain supported with the same closed response body and the new header.
The model artifact's existing digest and immutable selection-revision query
pins then preserve that descriptor binding; its URL shape is unchanged.
It returns one `houseatlas.unified-atlas-scene.v1` envelope:

The source owner may optionally set `--atlas-entry-building-id <buildingId>`
beside the paired scene options. The bounded source ID must occur in the exact
selected companion. This is an explicit presentation preference; it establishes
no native join, physical placement or access capability. It is not inferred from
labels, dimensions, array order or the documentary room map. Keep populated
household values in private release inputs, never generic product code.
The authenticated descriptor returns it as `x-atlas-entry-building-id` only when
configured, after the same final selection/original-byte revalidation. Without
the option, the header is absent and there is no implicit primary building.
The JSON envelope and original source bytes are unchanged.
Consumers validate an offered entry ID against the admitted building IDs and
retain it with that exact overview owner, manifest/semantics pins and selection
revision. A replaced/expired session or selection clears it. The host can then
supply its generic entry callback from that owned observation; it must not use
a global last-seen value, override deliberate navigation on every render, or
carry an entry designation across publications. This optional header adds no
endpoint, fetch, ReadyView facet or source-schema field.

```text
{
  profile, scope:{workspaceId,homeId},
  selection:{revision,publicationId},
  publication:{publicationId,sourceRevisionId,sourceSha256,semanticsSha256},
  frame:{units:"m",upAxis:"Y",horizontalAxes:["X","Z"],
         geometryPlacement:"gltf-world-after-node-transforms-once",
         physicalRegistration:null,
         // only when the release says where the house stands:
         geographic:{latitude,longitude,northDeg}},
  artifacts:[{artifactId:"model",role:"model",contentType:"model/gltf-binary",
              bytes,sha256,href},
             // only when the publication has a detail GLB:
             {artifactId:"detail",role:"detail",contentType:"model/gltf-binary",
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
The artifact IDs are `model` and, optionally, `detail` (route segment
`model-detail`); their bytes come through the selected overview reader. Plans
are inline companion JSON, so this adds no general artifact registry or
download platform.

### Optional detail tier (#304)

`publication.json` may name a second GLB beside `overview.glb`:
`detail:{file:"detail.glb",contentType:"model/gltf-binary",sha256,bytes}`. It is
the same publication unsimplified, produced by `tools/model-bake --detail` from
the master the overview was baked from, so it keeps the overview's node, mesh
and primitive slots. The companion still pins the overview in `original`; the
server validates the detail against that same companion (every binding, bound
and footprint check) under the Full budget instead of the overview's:

| Budget | Overview | Detail |
| --- | --- | --- |
| File bytes | 32 MiB | 256 MiB |
| Drawn triangles | 600,000 | 4,000,000 |
| Vertices | 1,800,000 | 12,000,000 |
| Prepared bytes | 96 MiB | 640 MiB |
| GPU bytes | 64 MiB | 384 MiB |

The frontend uses the same numbers (`STANDARD_GLB_LIMITS` and
`DETAIL_GLB_LIMITS` in `glb-preflight.ts`). The detail is fetched separately,
after the scene and the overview, so it stays outside the first load's 64 MiB
aggregate, and the reader never fetches it with the scene. A changed
`detail.glb` changes the whole selection, exactly like a changed overview.

Settings → Model quality chooses the tier per device (`model-quality.ts`):
Light never reads the detail; Full reads it on every device; Auto reads it only
with WebGPU, a mouse or trackpad and no touch screen, at least 8 GB where the
browser reports memory, and neither mobile data nor Data Saver. The overview
always loads and shows first. Only then does `readUnifiedAtlasDetail` fetch the
detail (same checks as the model, 300 s deadline), which is admitted under the
Full budget, bound to the same scene and swapped into the same stage, so the
view, floors and selection carry over. MeshLayer builds the new mesh set on a
hidden canvas behind the one on screen and shows it only after its first
frame, so the swap never blanks the view. Picking, labels and every other read
of the stage follow the model whose meshes are on screen (`model-tier.ts`), so
drawing and picking never use different tiers, and Light is drawn before Full
is built, however fast Full arrives. A
failed read, admission or GPU build keeps the overview. The detail is never
stored offline: a stored copy and saved houses show the overview only.
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

`frame.geographic` is optional and only lights the 3D view for the real sun.
When present it has exactly `latitude` and `longitude` in WGS84 degrees
(|latitude| ≤ 90, |longitude| ≤ 180) and `northDeg`, the angle clockwise from
the model's −Z (Blender's +Y) to true north, seen from above (|northDeg| ≤ 360).
It is absent, never `null`, when unknown. It moves no geometry and claims no
physical registration. The server and the viewer refuse it when incomplete or
out of range. Without it the viewer uses a neutral reference place with north
along −Z, and a device may always set its own location over the release's.
The values live in the private release only; public fixtures use neutral
reference places. A companion without the field can be given one at bake time
with `--geographic LAT,LON,NORTH` (tools/model-bake).

## Exact mesh membership and matching plans

Multiple distinct plans may reference one level. Retain each plan's source ID
and order; rendering, framing and picking consume every plan's features for
that level. Do not invent a merged plan ID or union the source polygons.

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
It must lie within its room's building bounds and, when occurrence-scoped,
within that occurrence and its declared level bounds. No level is inferred
for a room-summary or building-scoped position.

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
The companion requires exactly one scene with all declared nodes reachable
once, at most 20,000 nodes and hierarchy depth at most 64, matching the standard
renderer admission limits.
Its GLB JSON chunk is at most 8 MiB and glTF minimum version, if declared, is
2.0. All nodes are objects without skinning, morph weights or requests to apply
poses again. Cameras and node camera references are unsupported in this static
profile; the Atlas viewport owns its camera.
Drawn primitive instances, including repeated nodes sharing a mesh, are bounded
to 20,000 instances, 1,800,000 vertices, 600,000 triangles and 96 MiB of copied
positions, indices and prepared triangles. Every declared mesh and accessor
must be used by the bound scene; all buffer views are checked and their copied
bytes total at most 32 MiB.
The companion reader uses a bounded static triangle profile: selected primitives
have regular Float32 VEC3 positions and optional normals, with checked attribute
and unsigned scalar index layouts. Morph targets, mesh/node weights and node
skin references are unsupported. Every drawable primitive reachable from the
selected scene requires exactly one explicit binding, including decorative
context; this does not make context a room or pick target.
Every bound world vertex must lie within its building bounds;
single-level bindings also lie within that level, while shared multilevel
bindings lie within the enclosing union of their declared levels. Producer
bounds include the physical geometry, occurrence/pick extents and matching plan
extents; validation does not enlarge them or move geometry.
World positions are quantized to Float32 before bounds and footprint checks,
matching the standard loader's prepared positions.
Reflected world transforms reverse triangle winding as in the standard loader.
General node rotation and scale use explicit glTF TRS. Matrix nodes in this
static companion profile may only translate an identity linear transform;
general affine matrices are unsupported because the standard loader decomposes
and recomposes them.
Selected materials must resolve to the admitted core color/factor profile or the
Unified consumer's bounded embedded-PNG profile below. Other material resource
graphs and extensions remain unsupported. Each room-pick
primitive needs a nondegenerate transformed triangle. Plan rings are simple,
with strictly contained, disjoint holes and disjoint polygon components.
Concave rings and holes are supported without a convex-hull approximation.

For a selectable occurrence, the reader compares its plan with nonoverlapping
horizontal pick-support triangles within 0.00001 m of the lowest drawn,
index-referenced world Y. Topology uses distinct, nonzero edges and exact shared vertices; the
correspondence tolerance never welds vertices or discards a boundary or hole.
Closed support cycles match plan rings one-to-one, preserving filled-side
orientation and each hole's containing outer component. Every edge requires
nonempty actual coverage. Their directed boundaries agree in both directions within
0.00001 m, allowing collinear boundary subdivisions. Interior triangulation
joins use complete shared edges; unresolved partial joins are unsupported.
This is a bounded horizontal-support profile, not a general solid projection
or inferred sloped-floor footprint. It stores at most 4,096 support triangles
per occurrence and 65,536 in total, and charges at most 2,000,000 aggregate
geometry comparisons before pair work or boundary expansion.
The companion is at most 12 MiB: non-plan semantic JSON at most 4 MiB and all
inline plan JSON at most 8 MiB combined. The complete retained publication is
at most 64 MiB. Bound the complete scene to 128
buildings, 64 levels, 2,048 rooms, 4,096 occurrences, 8,192 mesh bindings of
at most 8,192 primitive selectors each, 200,000 polygon points and 8,192 overlay
bindings of at most 1,024 unique record IDs each. Selectors together stay within
the 20,000 drawn primitive instances; record IDs together stay within the
semantic byte budget. A room may list no occurrences and a binding may list no
record IDs: the room keeps its unknown placement and is not selectable, and the
binding keeps its provenance without a record count. Geometry, transforms, bounds
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

## Night marks for time-of-day lighting

After dusk the 3D view lights lamps and building glass from core glTF material
properties the server already admits; no extension, extra or name is needed.
A primitive is a lamp's glowing glass or bulb when its material has a nonzero
`emissiveFactor` (the producer keeps emission strength at or below 1, since
`KHR_materials_emissive_strength` is refused). It glows and lights the faces
near it, up to 16 lamps at a time. Its glowing faces also set its direction,
with no separate mark: when their area-weighted outward normals (front faces,
counter-clockwise) keep at least half of their total area, as a flat or
one-sided lens does, the lamp throws a beam about 40° wide that way, as
headlights or a downlight do. A closed or all-round glowing surface, such as a
bulb or a glass box, lights all around. Building glass, bound as `structure` or
`roof`, is a material with `alphaMode: "BLEND"` and a `baseColorFactor` alpha
below 1, not `KHR_materials_transmission`, which is refused. At every hour the
3D view draws it as glass, after the solid house: the alpha is how much of what
lies behind the pane it covers (a light default when the material states none
below 1, and never more than 0.85), and a stated `roughnessFactor` above 0.5
frosts it, fully by 0.9. It reflects the hour's sky, faintly head-on and
strongly at a grazing angle, lets the sun through onto the floors inside, and
after dusk shows the lamp-lit room behind it. Until a model carries these marks, a material whose
own name (never its mesh's or node's) holds a generic glass word counts as
glass, or as a lamp when the name also holds a lamp word and the material
states no `emissiveFactor`. A stated zero factor stops a name from making a
lamp, but a glass word still makes the material building glass. Every lamp
glows one fixed warm colour; the hue of `emissiveFactor` is not used yet, only
whether it is nonzero. Day lighting ignores the lamp marks.

Glass is depth-tested over the solid scene and never writes depth. Each source
glass primitive remains an independently sortable draw, ordered from far to
near by its bounds centre in the current camera, including its display lift.
This supports overlapping panes authored as separate primitives. It does not
sort triangles within a primitive or solve intersecting geometry: multiple
disconnected panes packed into one primitive can still composite incorrectly.
An author who needs independent pane ordering should supply separate primitives;
no order-independent transparency or producer-side subdivision is implied.
Selected or highlighted panes retain the solid selection/overlay appearance and
occlude room picking. Other building glass lets CPU room picks pass through,
using the same current presentation, clips and lifts as the drawing.

## Existing bounded embedded-PNG material consumer

The Unified live and Saved consumers opt into
`houseatlas.embedded-png-material.v1`. This is an existing production path:
`standard-glb.ts` combines geometry preflight with
`embedded-png-material.ts` admission before loader copying and image decoding;
`geometry.ts` retains the copied material and UV/normal/tangent streams;
`unified-atlas/scene.ts` preserves them when binding semantic selectors; and
`MeshLayer.tsx` owns their WebGL2 buffers, textures and cleanup.
Other callers remain opted out unless they explicitly enable this profile.
The Three loader still declines its own texture requests and disposes its
resources; the bounded decoder and copied streams supply the Unified renderer.

The profile accepts only embedded RGB8 PNG bufferViews in the GLB BIN chunk.
Image URIs remain forbidden. Each image is at most 1,024 by 1,024 pixels,
1,048,576 pixels and 2,097,152 encoded bytes, and application decoder scratch
is at most 8,388,608 bytes. There is no fixed image count or aggregate image
cap: how many textures fit is the quality tier's prepared and GPU budget below,
which charges every image. A sanity cap of 64 images only bounds the identity
scan. A refusal states the textures' and geometry's MiB against the tier.
PNG framing and CRC, supported filters and noninterlaced/Adam7 decoding are
checked by the application decoder; browser image decoding is not used.

Supported slots are base color (sRGB), normal (data, scale 1) and metallic/
roughness (data), using texCoord 0. Sampling is REPEAT with linear magnification
and linear mipmapped minification. Textured materials require OPAQUE mode and
base alpha 1. Their matching Float32 UVs and shading normals are retained;
normal mapping additionally requires Float32 tangents. Building glass selected
by the marks above samples its admitted base-colour, normal and roughness maps
when source materials are enabled. Only an explicitly stated roughness factor
controls frosting; an omitted factor keeps the clear-glass fallback even when
material admission supplies the standard PBR default. Other BLEND materials
retain their legacy opaque appearance; material admission does not add general
transparency support.

Material admission includes encoded images, decoded RGBA, decoder scratch,
indexed attributes and expanded corner attributes in the prepared-byte ledger.
The renderer keeps the legacy position/flat-normal stream for picking and a
separate UV/shading-normal/tangent stream for material drawing. GPU accounting
includes both streams and complete mip chains, deduplicated by image, sampler
and color role. The tier's prepared and GPU limits (Light 96/64 MiB, Full
640/384 MiB) are in force; the renderer checks its resource ledger before allocating GL resources.
These are bounded application ledgers, not measurements of total browser,
driver or process peak memory.

The named generated material positives in the verification guide exercise this
source path using synthetic assets and a GL call recorder. They do not establish
actual shader execution, GPU pixels, private-candidate admission, installed
identity or browser/device acceptance. The product-readiness observations above
remain separate.
