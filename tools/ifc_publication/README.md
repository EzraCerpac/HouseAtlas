# IFC publication preparation

`publish.py` prepares an immutable, unselected publication from a retained IFC
source revision, a separate semantic map revision, and one SHA-pinned converter.
It invokes the converter twice per floor and requires byte-identical GLB and
floorplan results. It validates exact source/map lineage, occurrence identity
Psets, direct storey-to-room IFC aggregation, complete room coverage and
explicit mm/Z to m/Y axes. Each floor gets a GLB, feature JSON and SVG; one
publication-wide semantic artifact binds them. `publication.json` records
all hashes and tool/config pins. Source revision SHA uses the source ledger's
canonical JCS form; the exact input file SHA is recorded separately. The
complete publication directory is installed atomically with private modes.
It never promotes a publication or writes to a service.

The converter executable receives `--ifc`, `--semantic-map`, `--config`, `--glb`,
and `--floorplan` paths. `--config` is an effective JSON receipt containing the
source and map revision IDs and IFC digest. The converter writes exactly the GLB
and floorplan JSON paths. The GLB must use the existing
`houseatlas.ifc-derived-glb.v1` profile. Floorplan JSON uses
`houseatlas.ifc-floorplan.v1`, a stable floor UUID/IfcBuildingStorey GlobalId,
room app UUID/IfcSpace GlobalId, and millimetre XY polygons. It also carries
strict mesh-index to room-ID bindings checked against the GLB node and mesh
names (`ha-room/<room UUID>`). The separate v2 profile supports one logical
room across multiple floor-qualified IFC space occurrences. Its map nests
`rooms[].occurrences[]` with stable `roomId`, opaque `spaceOccurrenceId`,
IfcSpace GlobalId and floor UUID. Its plan and mesh bindings carry both IDs;
the required mesh/node name is `ha-space/<room UUID>/<SHA256 of UTF-8
spaceOccurrenceId>`. The opaque source token is never put in a mesh name.
Unbound meshes are display-only. The SVG is a
review projection, not a survey or proof
of physical registration. The semantic artifact is the validated map, pinned
to the same source revision, plus IFC identity projection and mesh bindings.
It does not infer associations from names.

The shared semantic-map validator runs on the exact map and IFC projection.
For revisions after the initial map, supply `--previous-map` with the exact
predecessor so transitions, renames and split/merge identities are checked.
It rejects ambiguous or shared IFC identity property sets. Numeric elevation
and floor-to-source transforms remain null until project units and IFC placement
chains are separately verified.

The identity extractor accepts `EntityId` as typed `IFCIDENTIFIER` or `IFCTEXT`
and `SchemaVersion` as `IFCINTEGER(1)`. A HouseAtlas identity Pset may carry up
to 64 uniquely named, bounded additional typed single-value properties. These
extra values are ignored for identity and do not become semantic claims. V2
requires an `IFCTEXT` `OccurrenceKey` on each IfcSpace Pset. This conservative
STEP parser admits printable ASCII source strings only; the v2 map validator
permits a wider Unicode token set, so not every map-valid token can yet be
published.

Complete v2 space coverage means every `IfcSpace` in the pinned IFC is present
once as a distinct occurrence in the semantic map and exactly one floor plan.
Multiple occurrences may share one logical room ID. It does not assert that all
physical parts of the house have been surveyed or modeled. Every IFC storey and
electrical circuit occurrence is likewise mapped. Native source-ledger lookup,
retained-asset proof and preview selection remain separate service checks.

This lane does not include a qualified real IFC tessellator. Converter execution
and semantic coverage need independent evidence before a real model can be
selected; this publisher checks byte lineage and repeatability, not whether a
converter faithfully tessellated IFC. Existing Rust PR177 media admission
remains a separate, stronger check for GLB geometry and is required before any
candidate may be considered ready for preview or promotion.

The ordinary synthetic check is local and invokes only a generated fake
converter and disposable IFC fixture. Inspect `test_publish.py`,
`test_publish_v2.py` and
`publish.py` before running:

```sh
python3 -m unittest discover -s tools/ifc_publication -p test_publish.py
python3 -m unittest discover -s tools/ifc_publication -p test_publish_v2.py
python3 tools/ifc_publication/make_synthetic_fixture.py --output /tmp/houseatlas-ifc-synthetic
python3 tools/ifc_publication/make_synthetic_fixture_v2.py --output /tmp/houseatlas-ifc-synthetic-v2
```

Each fixture command emits its corresponding profile. It writes `inputs/` and `publication/`. The latter contains
`publication.json`, `semantics.json`, and `floors/<floorId>/{model.glb,
floorplan.json,floorplan.svg}` for two fully synthetic storeys. `receipt.sha256`
is the canonical publication JSON digest. Use a new empty output directory for
each run; no private model or service is read.
