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

The exact five-key v1 form remains valid. Its independent `electricalFixtures`
frame subset is `unavailable/not-retained`. The additive v2 form keeps those
five fields unchanged, changes the schema literal to
`houseatlas.native-scene-source.v2`, and requires one sixth closed field:

```text
electricalFixtures: {status, reason, documentaryFixtures}
```

An unavailable fixture subset has `documentaryFixtures: null` and one existing
unavailability reason. An available fixture subset has `reason: null` and a
complete closed `houseatlas.documentary-electrical-fixtures.v1` value in
`documentaryFixtures`. A stored v1 source cannot acquire fixture availability
through a UI flag; the host must retain and select an actual v2 text original.

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

The v2 historical fixture subset is separate from that electricity adapter.
It validates the exact source fields defined by `fixture-types.ts`: symbol
legend, room receipt, sheets, documentary groups, source-photo regions, and
individual fixtures. The source's private `viewKey` is documentary; the output
uses the current host view key. The embedded room receipt ID and SHA-256 must
equal the independent accepted host pins, and accepted anchors must exist.
Only the host's full reviewed room selection can auto-select a matching package
key and UUID; other region names remain available solely for deliberate
documentary browsing.

The source reader admits at most 128 sheets, 512 regions, 512 documentary
groups and 2048 fixtures under the existing 8 MiB UTF-8, duplicate-key,
depth and node-count caps. It checks unique IDs, complete bidirectional
sheet/region and group/fixture membership, each fixture's sheet and region,
source-symbol uniqueness, exact original/rendered photo hashes, and consistent
package place key/UUID pairs in both directions. The source photo reference
admits only bounded relative components such as `originals/IMG_1578.HEIC`;
absolute paths, dot segments and URI schemes are rejected. Source-photo points and boxes are bounded
normalized fractions; PDF pages and optional glyph/fixture counts convert only
from exact safe integral JSON tokens. Every region has an unregistered
orientation and null physical transform; every fixture retains null physical
coordinate and wire route; every group has null current circuit ID and false
verified wiring. This v2 profile requires `registrationReceipts: []`. Neither
text nor a proposed registration becomes an accepted fixture placement.
Unregistered original symbols can still be shown in the source diagram.
Relative source names and photo digests remain provenance, never URLs or native asset IDs.
Opening an actual PDF or image remains a separate, current host media decision.

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

This source-only donor adds no private household data, original,
native mutation, browser execution, or admission result. A healthy synthetic
example can test its algebra later; real availability still requires retained
custody, independent admission and current owner readback.

## Network overlay live facts

Room placement remains the recorded scene's reviewed room association.
Live facts never locate a device or turn a documentary ID into a native ID.
The current-scene GET accepts the exact optional query `networkLiveFacts=2`.
It qualifies the original scene as before and optionally returns
`networkLiveFacts` alongside `association`.
The frontend requests enrichment only on its final current-scene read,
then carries it in the existing overlay frame.
The immutable evidence original is never rewritten.

### One-time review file

Mirror the existing Atlas room-link selection:
place an operator-owned JSON file outside Git in a canonical directory
with mode 0700, with a regular, single-link file of mode 0600.
Select it on `serve` with `--atlas-device-links-manifest <absolute-file>` and
`--atlas-device-links-manifest-sha256 <lowercase-SHA256-of-exact-file-bytes>`.
No flags means no reviewed links and no enrichment.
An explicitly selected file that is missing, replaced or changed is refused;
it never silently substitutes another file.
Restart with a new explicit pin after an owner review changes the file.
No HTTP/MCP write or in-app confirmation screen is provided.

The closed file is at most 1 MiB and 512 links:

```json
{
  "profile": "houseatlas.atlas-device-links.v1",
  "links": [
    {
      "sceneOriginalSha256": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      "documentaryDeviceId": "synthetic-device",
      "source": {
        "workspaceId": "00000000-0000-4000-8000-000000000001",
        "homeId": "00000000-0000-4000-8000-000000000002",
        "sourceInstanceId": "00000000-0000-4000-8000-000000000003",
        "collectionId": "synthetic-inventory",
        "sourceKind": "network-device",
        "externalId": "synthetic-source-device"
      },
      "reviewStatus": "unreviewed",
      "reviewer": null,
      "reviewedAt": null,
      "evidenceReference": "synthetic:review-evidence"
    }
  ]
}
```

Statuses are `unreviewed`, `accepted`, `rejected` and `retired`.
Unreviewed links require null reviewer/time;
all decided links require nonempty reviewer attribution,
a valid RFC 3339 review time and a nonempty evidence reference.
Only accepted links for the exact original digest and authorized home can join.
Duplicate accepted snapshot identities or source identities withhold all affected
pairs, including duplicates that happen to repeat the same pair.
There is no name, address, room, newest-date or graph-position fallback.
A new source device or changed scene digest needs a new reviewed pair.

The file and its parent identity, ownership, permissions and exact digest
are checked at selection and again before disclosure,
using the existing room-link file machinery.
The reviewed link is matching data, never permission.
The native overlay Viewer read and the unchanged cached source read each retain
and release their original authority.
Each distinct joined source partition is read once through the existing cached
owner, up to eight partitions; there is no provider GET, collector demand,
diagnostics, refresh, enrollment or upstream write.
Saved inventory/snapshot/history HTTP and MCP operations are unchanged.

### Frame contract

The response extension has schema `houseatlas.network-overlay-live-facts.v2`,
`sceneOriginalSha256` and `devices: [{id, liveFacts}]`.
Only the server joins identities.
The frontend verifies the exact scene digest and scope,
then attaches each entry to its existing documentary device.
An unjoined device is unchanged and has no `liveFacts` member.
The new available overlay frame identifies
`houseatlas.unified-atlas-overlay.v2`.
Enriched `NetworkOverlayData` has schema `houseatlas.network-overlay.v2`;
legacy data has no schema member and remains readable.
The strict documentary-original decoder still refuses embedded live claims.
No offline code or saved-copy format is changed;
the overlay graph already carries its data for later capture.

`liveFacts` fields:

| Field | Meaning |
| --- | --- |
| `status` | `available`, `absent`, `unknown` or `stale` |
| `source` | Exact reviewed source identity, including workspace/home, instance, collection, kind and external ID |
| `addresses` | Source interface addresses, or null when the joined source device is absent; an empty array is a known empty list |
| `observedState` | Original source observations, or null when absent/unknown |
| `lastSeenAt` | Only an explicit valid source `value.lastSeenAt`; null when missing, invalidated or conflicting |
| `sourceSnapshotAt` | Original source snapshot date, nullable |
| `retrievedAt` | Original retrieval date, nullable for an absent uncaptured source |
| `freshness` | `unknown`, `recent`, `stale` or `invalidated` |

Each observation retains `id`, `kind`, original `value`, `factAt`,
`sourceSnapshotAt`, `retrievedAt`, `vantage`, `invalidatedAt` and `freshness`.
Observation numbers retain the passive provider's finite binary64 semantics
in the frontend, so existing graph JSON writers can capture them.
Observation time is never substituted for last-seen time.
A stale cache cannot upgrade an observation to recent;
invalidated observations remain visibly invalidated.
A present device without observations is unknown, or stale if its cache is stale.
An authorized joined identity absent from the cache is explicitly absent.
Access refusal discloses no enrichment.
An unavailable or revoked cache withholds enrichment rather than claiming
the device is absent.

Bounds: 512 documentary devices, 32 distinct addresses and 64 observations
per joined device, 16,384 addresses per frame,
64 KiB per device facts and 512 KiB per extension.
Excess is refused, never silently truncated.
Generation reconstruction, relation validation and sidecar reopening remain
unchanged.

### Offline candidate helper

Run with files supplied explicitly:

```sh
python3 tools/network-device-review/candidates.py snapshot.json cached-export.json candidates.json
```

The snapshot is the exact retained native scene-source JSON original;
the export is the existing passive cached route's JSON facet.
The helper reads no other data and uses no network.
It suggests exact identifier matches, never names or prose.
Hardware suggestions require a separate explicit file passed with
`--hardware-evidence hardware-evidence.json`;
the strict scene original has no hardware-address fields and stays unchanged.
That evidence file has the closed shape
`{profile, sceneOriginalSha256, devices}`,
where `profile` is `houseatlas.network-device-hardware-evidence.v1`,
`sceneOriginalSha256` must match the exact original bytes,
and each device has `documentaryDeviceId`, `hardwareAddresses` and
`evidenceReference`.
Device IDs must exist in the snapshot and be unique in the evidence file;
up to 512 device entries each carry at most 32 explicit hardware addresses.
The helper compares those addresses with explicit source device/interface
hardware addresses and retains the evidence reference in each suggestion.
This file is suggestion evidence only, never a reviewed identity or placement.
Every snapshot device is listed, including those without suggestions.
Inputs are bounded to 10 MiB each, 512 snapshot devices,
10,000 source devices/interfaces and 4,096 candidate pairs.
The separate candidate document contains evidence and an
`unreviewedLinkTemplate` whose links all remain unreviewed with null reviewer/time.
It creates a new file exclusively with mode 0600 and cannot overwrite inputs
or an existing review file.
The candidate document is not a service manifest and cannot be installed as one.
After the owner confirms or rejects each pair in one sitting,
an operator prepares a separate reviewed manifest with decisions,
attribution, time and evidence, and pins that file as described above.
The helper never writes that reviewed manifest or marks a pair reviewed.
