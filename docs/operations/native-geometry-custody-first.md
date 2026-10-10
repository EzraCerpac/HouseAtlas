# Native geometry custody and building reads

This owner profile preserves the frozen Atlas and Stock bodies and existing SQL.
It provides native file custody and a reviewed building association. It does not
convert USD/IFC, infer rooms or placement, or align floors to a physical house.

The private native HTTP profile is `/api/atlas/geometry/v1/workspaces/{workspaceId}/homes/{homeId}`.
Every route refuses query parameters and uses the existing transport admission,
configured scope, authenticated native session and original AT11 capability.

- `POST /originals`: a USDZ or IFC original with its own license data. The two
  multipart fields, in order, are `metadata` and `file`. Closed metadata has
  schemaVersion 1, requestId, idempotencyKey, context, reason, filename,
  contentType and sourceLicense. UUIDs/context/reason/provenance are validated.
- `POST /originals/{originalAssetId}/derivative`: the same closed metadata and
  file envelope for the distinct immutable mesh MIME below. The real original
  must already be an active, available scoped USDZ geometry-original. Its
  current revision is guarded on the derivative's single-asset Stock root.
- `POST /buildings/{buildingId}/associations`: the unchanged complete Stock
  wire3 `atlas.batch.execute` body, at most 16384 UTF-8 bytes. Exactly ordered
  `evidence.create`, `geometry.create`, `identity.replace` children are supported
  by this profile. The caller retains the complete input; the existing retained
  POST can inspect the real root/children without resubmitting mutations.
- `GET /buildings/{buildingId}`: closed native descriptor data, including an
  opaque exact-snapshot viewKey and per-floor key/readPath. The export label is
  verbatim converter metadata, not a semantic floor identity or elevation.
- `GET /buildings/{buildingId}/frames/{viewKey}/meshes/{key}`: immutable profile
  bytes only after selecting the current association again. A changed snapshot
  is withheld. The server never converts on GET or treats the keys as authority.

The two custody POSTs each commit one actual sealed single-asset Stock root.
Only the subsequent three-child association is atomic. Failure or an unknown
response can leave real unassociated custody. No failure means non-admission,
no retry safety is established, and neither route resubmits uploads. Successful
custody responses contain originalRequest plus the canonical correlated result;
losing that response can leave its server-issued full root unavailable to a
consumer. Such an outcome stays held rather than becoming an invented retry.

Association preserves the identity's kind and every prior evidence ID, appends
one new owner-report evidence ID, and guards the current identity, accepted
building classification, classification/identity evidence, and both actual
assets. Evidence references exactly the original and derivative. Geometry has
producer magicplan, exportFormat usdz, unknown coordinateUnits, null scale and
transform, empty mappings, geometryVersion 1 and previousGeometryId null. Its
importedAt is derived by the original Stock owner from the real server clock.
This version of the profile accepts separate initial export geometries, not a
replacement/version-chain workflow. Both file licenses remain separate data.

`model/vnd.usdz+zip` and `application/x-step` are geometry-original only. USDZ
validation checks a bounded stored ZIP, its local/central records, sizes, CRCs,
aligned members, one root USDC signature and safe PNG texture member framing.
No layer/texture is extracted or executed. IFC validation checks bounded UTF-8
STEP/IFC framing for download only; it is not an IFC semantic parser.

`application/vnd.houseatlas.magicplan-authored-mesh+json` is derived-preview
only and always download-only. It never becomes a Text original or PNG
safe-rendered qualification. The embedded closed revision-six schema is SHA256
7d069a1e37a0584aa6c1883d8500753e0f4105d60e5d0c8de3650f5955aa5863.
The validator also checks duplicate fields, counts, indices, declared node
parents, raw operation order, reset behavior, complete/applied ancestor chains,
orientation tokens and exact decimal matrix products. Original/layer digest and
size are compared with actual retained USDZ bytes. Converter/protocol identifiers
are pinned data, not an attestation that this server ran the converter or that
submitted geometry agrees semantically with a decoded USDC scene. Physical
scale, floor alignment and stage-to-house transform stay explicitly unknown.

Mesh reads are capped at 8 MiB with a 15-second async return deadline and a
10-second cooperative native work budget. Immutable read bytes are offered only
with current native record/manifest agreement and fresh Action::Media grants.
The full snapshot is compared again, every Media grant is revalidated, and the
original principal is released immediately before response. Responses are
private/no-store, nosniff and sandboxed; they disclose neither storageKey nor a
provider/source URL. Work limits bound processing, not a claimed fixed JSON heap;
a timed-out blocking operation may finish its lock wait before seeing cancel.

The old PNG/JPEG/PDF/Text parser, preview policies and existing original intake
allowlists remain unchanged. New kinds are selected only by parse_owned in the
native custody/read/recovery owner. Existing provider/queued intake still uses
its four-format parser. Existing quota names count all retained blob paths,
including abandoned originals and derivatives; retiring metadata never frees
custody. The stage/binding/consumption codec retains its existing shape and all
immutable fields, IDs, digests, audit/order and root checks.

Recovery still uses the existing native database/manifest protocol. It validates
new blob formats and a mesh's actual original member/layer in the same validated
image; missing source bytes cannot fabricate exact lineage. Current old readers
will refuse the new MIME in retained consumed uploads. A future install requires
an independently qualified fallback compiled with the same media codecs and
actual populated capture/verify/reopen checks. No older fallback compatibility,
restore acceptance, private intake, service change or deployment is released by
this source proposal.

The dedicated synthetic positive source exercises one empty native building,
two real custody POSTs and one real association, retained child correlation,
original server time, exact bytes, read descriptors, history and persistent
reopen. Its generated USDZ is a ZIP/USDC-signature framing fixture, explicitly
not a converter or USD semantic validation case. It contains no private scan,
HTTP listener, provider call, control/failure injection or archive import. Cargo
and README registration/execution remain with the integration owner.
