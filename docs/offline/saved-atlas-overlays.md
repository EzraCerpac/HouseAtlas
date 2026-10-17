# Saved documentary overlays

`SavedOverlayResult` is `{ kind: 'saved', state: 'complete' | 'partial' |
'unavailable', records: PropertyRecords, capturedAt, snapshotId, localRevision,
reasons, retained }`. Complete means supported retained overlay coverage only.
It does not mean full native/offline application readiness or room placement.

The section reader uses the lossless JSON parser under the generic 8 MiB bound.
Every read checks the exact retained revision, manifest, resource digest, size
and MIME; raw companion admission stays on the separate 12 MiB path. SHA reuse
preserves canonical first descriptors. Inventory/document metadata remain intact
as lossless trees; genuine document-byte availability requires verified bytes.
No title or filename classifies a document as electrical.

Supported generic projections are typed native `circuit` records, explicit `circuit-supplies` and electricity
`documented-connection` relations, and their referenced `evidence` records, and source-qualified `network.relations` logical
endpoints/connections. Original revisions, lifecycle, source/retrieval dates,
uncertainty, provenance, caches and source-withheld partial state survive.
Inventory entities remain unclassified. Unsupported facets are explicit.
Generic circuit/network rows alone have no historical record-placement join:
known generic records remain visible unplaced. Captured room-link identities
alone do not place records. Historical closure requires the additional retained
association/originals described below. Physical wiring, coordinates and
alignment remain unknown.

The seam is `PropertyRecords -> savedDocumentary.records ->
useDocumentaryOverlays -> documentaryOverlayIndex ->` existing counts, details,
coverage and NetworkGraph. Saved mode exits before native overlay acquisition.
No preview manifest, primary/support receipt or native source frame is invented.

Inspect and run only the generated ordinary positive:

```sh
node frontend/lantern-tests/offline-atlas-overlays-healthy.mjs
```

It checks valid complete/partial source packages, known unplaced records, exact
numeric revisions, original dates/uncertainty, metadata retention and logical
routes remaining null. It has no listener, provider, native host, household data
or held controls. See [mounting](saved-atlas-mounting.md) for the other named
checks and separate real-browser proof.

A complete retained scene-association closure is admitted from its unique complete
captured previousAssociationId/version chain, retained evidence/asset identities,
revisions, MIME/size/SHA originals and canonical receipt. Actual source/support
bytes pass the existing pure documentary byte readers. Historical room placement
requires exact saved room-links plus captured package key/UUID, source anchors,
receipt and mapping evidence membership. Ambiguous/unresolved joins stay unplaced.
No current native head, session, source frame or preview manifest is manufactured.
Optional PDF correlations require matching retained evidence/asset/bytes and
building membership; otherwise they remain unavailable metadata.

The same named positive also generates a genuine source/support association cut
and checks known historical room records/graph beside generic unplaced facts.
It preserves permitted null Network revisions and distinct tuple identities
whose collection/external IDs contain slashes. These are valid supported inputs.

Generated positives validate actual native record, source/cache, inventory
projection, Network relation and v2 Document shapes against checked-in schemas.
Only asset storageKey is omitted, matching the exporter. Atlas roots retain the
exporter's contractVersion/synthetic/revisions/nativeGeometry fields. The genuine
closure also exercises canonical first-descriptor SHA reuse across sections.

The valid partial positive also covers zero visible retained Network relations:
source-withheld coverage remains partial and is never converted into a successful
empty current source.
