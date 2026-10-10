# Native scene source

This read-only interpretation uses one actually retained `text/plain` evidence
original selected by the host for the current native building. The document is
not a native record type, authorization grant, or placement receipt. It cannot
select itself by label, filename, hash, package UUID, or assertion in its own
contents. The host must supply a current session, scope, building, evidence and
asset pin, independently accepted room-receipt pin, and exact source-floor to
native-floor bindings. Missing proof leaves the affected scene subset unavailable.

The original is strict UTF-8 JSON, at most 8 MiB, with no duplicate decoded
object keys. Its closed top level is:

```text
schema: "houseatlas.native-scene-source.v1"
receiptCanonicalJson: canonical JSON string or null
rooms: {status, reason, receiptId, receiptSha256, entries, regions}
network: {status, reason, source, devices, endpoints, links}
electricity: {status, reason, documentarySource, roomRegistry,
              buildingPackageKey, retrievedAt}
```

Every subset has `status: "available"` with `reason: null`, or
`status: "unavailable"` with one of `not-retained`, `not-qualified`, and
`source-unavailable` as its reason. On an unavailable subset, its payload fields
are all `null`. The rooms receipt ID and digest equal the independent host pin,
or are both `null` when no room receipt exists. The network
source and electricity source remain documentary. A network source status can
be `recorded` or `stale`, with `acceptedAt: null`; it cannot claim native
acceptance. Network coordinates and paths remain `null`. The electricity
adapter receives an empty native identity map, so package room UUIDs cannot
become native place IDs. Source and retrieval dates are retained separately.

`receiptCanonicalJson` carries the exact accepted receipt's canonical JSON text,
or `null` when no room receipt exists. Its SHA-256 must equal the independent host pin. The reader validates its JSON
syntax and duplicate keys but does not invent a new schema for the existing
receipt. The host separately supplies the complete independently reviewed
anchor membership: each anchor has an ID, source floor key/original digest,
target package key/UUID pairs and unresolved labels. Without a receipt, the
host supplies no accepted anchors and the rooms subset stays unavailable. The reader checks those
exact anchors, targets, floors and digests before producing any room. The
document's own text does not prove its receipt was independently accepted.

An available rooms subset has up to 32 `entries` and 32 `regions`. An entry is
`{id,label,sourceFloorKey,sourceOriginalSha256,sourceAnchorIds,packagePlaceKey,
packagePlaceUuid,xFraction,yFraction}`. A region is `{roomId,sourceFloorKey,
sourceOriginalSha256,sourceAnchorIds,packagePlaceKey,packagePlaceUuid,polygons,
geometryQualification,sourceGeometryHandles,displayKind}`. Fractions and
polygon vertices are finite normalized `[0,1]` values. Each rendered room's
anchors must all resolve to exactly one identical receipt target. Each region
must match its room and also pass the existing geometric region-admission check.
For a displayable room, the reader exposes a selected-package context from
the complete verified anchor targets and unresolved labels with the current
view key. The host must clear that context on independent native selection or
any source/owner withdrawal. It never supplies a native place ID.
Source-floor bindings are host pins joined against the *current* native geometry
frame by floor key, original asset ID/hash and geometry ID/revision. The reader
does not create a physical scale, floor alignment, or stage-to-house transform.
No source-floor binding is required to show otherwise qualified unplaced
documentary network or electricity records. It is required before displaying a
room region on a native mesh floor.

An available network subset uses the presentation fields in
`NetworkOverlayData`, except it has no `viewKey`: the reader supplies the
current view key. Its `source` has exactly label, revision, recordedAt,
retrievedAt, status, acceptedAt, coverage and notes. Devices, endpoints and
links use the closed fields enforced by the reader. A device place has no native
place ID or coordinate; an `accepted` documentary association must match the
independently pinned receipt's exact package key/UUID and anchor IDs. Link
endpoints must exist; link paths remain null. A network graph cannot establish a
measured device position, live connectivity, or cable route.

An available electricity subset contains the already reviewed
`private-documentary-records/v1` source and `private-houseatlas-room-registry/v1`
registry plus a building package key and retrieval date. The pure documentary
adapter checks the internal source/registry relationship. Only bounded PDF
page integers and normalized crop coordinates are converted to JS numbers;
unrelated numeric tokens remain exact. A documentary sheet/photo/page is not a
native evidence original and cannot be opened from its name or source hash.
The host must resolve any drawing action through its separately reviewed
current native evidence-document mapping.

The caller owns an independent, current selection and a dedicated evidence
document client. It must hide scene data synchronously on binding, geometry,
document or source-generation withdrawal, release the original lease, and clear
selection and document actions. The reader subscribes to geometry withdrawal
before the evidence read and document withdrawal as soon as it claims the
original lease. Caller abort and a finite deadline remain active through
parsing and publication. The evidence-document owner exposes its
internally checked `evidenceRevision` as a read-only frame field; the scene
reader compares it with the independent host pin. The donor base predates that
read-only field, so it must be composed with the exact reviewed owner seam.

This source-only donor adds no private household data, original, fixture,
native mutation, browser execution, or admission result. A healthy synthetic
example can test its algebra later; real availability still requires retained
custody, independent admission and current owner readback.
