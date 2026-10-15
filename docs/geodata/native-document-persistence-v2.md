# Native Documents in the fresh v2 dataset

The Rust backend has an explicit fresh-only original Document dataset. It uses
`houseatlas-rust-storage/geodata/2`, schema 1, contract `2.0.0`, with a complete
compiled SQL catalog in `backend/migrations/0001_geodata_v2.sql`. Stock, presence,
provider ingestion and legacy command execution are disabled in this selection.
This implementation does not convert a predecessor database or deploy a service.

`GeodataStore::create_fresh` accepts an empty destination. `open_existing` opens
read-only and validates the exact catalog, metadata, checksum ledger, native v1
core graph/history, v2 record/history/reference/receipt closure and every retained
historical original before acquiring the matching writable handle. It never
migrates at open. Legacy ordinary storage constructors continue rejecting the
new lineage. Native v1 core bodies and historical bytes use their unchanged
validator and SQL columns; the successor snapshot adapter unions those records
with separately typed v2 Asset/Document records in the same database and checks
workspace-wide UUID uniqueness across both tables.

The trusted host must explicitly construct the selected store with the original
native Access owner, original vault, and a `GeodataSourcePolicy` implementation.
`Host::with_geodata_dataset` checks those same owner allocations. Selecting it
selects the v2 dataset route table exclusively: native authentication, configured
home summaries, static files and the Document routes below. It does not compose
the legacy native/Stock/provider/upload/AI command routes beside the new dataset.
The normal server configuration and startup still select their existing profile;
there is no automatic runtime upgrade or production source-policy default.

The source policy must qualify current access to each exact native Document and
its source pins. Agency, provenance URLs, a license label and home membership
cannot mint that source authority. Callbacks are bounded and nonblocking, receive the borrowed native transaction
guard, and must never reenter the held AccessBoundary or GeodataStore locks.
The policy is checked inside the actual native
session/access fence at read entry/release, replay, mutation and precommit. The
fixture policy independently configures exact generated asset ID/hash pins, its
synthetic scope and exact public fixture URL. Real source
admission remains an operator-owned follow-on after accepted backup evidence.

## Original-only capabilities

One retained source file creates one Asset and independently addressable Document.
Atomic creation installs the measured original Asset, Document, immutable canonical
custody receipt, reference index, audit bodies and idempotency receipt together.
Staged vault bytes exist before SQL commit and confer no record or authority.
An identical request returns the retained outcome after authorization and evidence
checks; reuse of its mutation ID for different content conflicts. The hash binds
scope, complete metadata and measured original bytes/size. Client-provided custody
hashes are not accepted by this intake.

The six declared original MIME families are `application/geo+json`,
`application/city+json`, `application/json`, `image/tiff`, `application/pdf` and
`image/png`. The existing bounded original validators measure/validate the bytes;
no filename establishes a format. Generic JSON/PDF/PNG carry no GIS qualification.
All originals use download-only delivery, preserve their original bytes, and stay
within the inclusive 1–10,485,760 byte limit.

This runtime accepts `preview: null` only. It installs no renderer or preview
qualification implementation. The separate v2 schema and retained qualification
port reserve that future lineage; a hash or uploaded PNG cannot manufacture it.
Get/list report preview `not-qualified`; no preview byte route is installed.

Native create/associate and CAS replacement/tombstone/restore validate the exact
original guard, retained custody and measured original again. Original pins are
immutable. A revised source file needs a new Asset/Document identity. Title and
other permitted provenance corrections retain before/after history; a change to
custody-bound retrieval/source URL cannot reuse incompatible custody. Tombstones
retain IDs, receipts, audits and blobs and stop active listing/ordinary byte reads.
Restore checks current access, source policy and bytes again.

## HTTP interface

All paths use this prefix, with lowercase canonical UUIDs:

```
/api/atlas/documents/v2/workspaces/{workspaceId}/homes/{homeId}
```

* `GET /documents?limit=50` returns the exact
  `houseatlas.geodata-document-list.v2` envelope: `profile`, `scope`, `documents`
  (authorized read projections), `nextCursor` (null or an opaque token).
* `GET /documents?limit=50&cursor={token}` continues that bounded page. Limit is
  1–100. Tokens disclose no record IDs; server-owned state binds the actual
  authenticated session, scope, limit and stable read epoch, read in O(1) from an atomically maintained per-scope scalar
  validated against complete audit counts during recovery. They expire after
  five minutes, have a bounded registry, and invalidate when records change.
  Denied rows have no public count or identity.
* `GET /documents/{documentId}` returns exactly `profile`, `scope`, `document`,
  `availability`. Profile is `houseatlas.geodata-document-read.v2`;
  `document` is the complete v2 record, including `recordId`, `revision`,
  `lifecycle`, and `payload.original` with `assetId`, `revision`, `sha256`, `bytes`.
  Availability is exactly `{original, preview}`. An original-only healthy row has
  `available` and `not-qualified` respectively.
* `GET /documents/{documentId}/original?expectedRevision=1` returns the exact
  retained original, with current session/source policy, Document revision,
  lifecycle and complete Asset pin checked before and after byte I/O. The MIME
  is the measured declared original type; delivery is an attachment.
* `POST /documents` is the native fresh original+Document intake below. Its
  response contains `document` and `asset`, each the complete v2 record.
* `POST /documents/{documentId}` accepts a successor
  `GeodataDocumentMutation` (`schemaVersion: 1`, `mutationId`, `operation`,
  `expectedRevision`, `reason`, `guards`, and `value` for create/replace), and
  returns a validated `GeodataDocumentMutationResult` with `record`, `audit`,
  `replayed` and `schemaVersion`. Create associates an already committed exact
  original and its independently retained custody receipt in this same dataset.
  The complete original Asset guard is required for every operation.

Every request uses the actual native session cookie and same-origin evidence;
POST additionally needs current Editor mutation authority and `x-atlas-csrf`.
Browsing does not fetch source URLs, demand collectors or issue upstream writes.
Successful byte responses include `Content-Length`, `Content-Digest`,
`Content-Disposition: attachment`, `Cache-Control: private, no-store`,
`X-Content-Type-Options: nosniff`, and a sandbox CSP. `x-atlas-document-frame`
is URL-safe base64 canonical UTF-8 JSON with profile
`houseatlas.geodata-document-bytes.v2`, `scope`, `documentId`,
`documentRevision`, `mode: "original"`, the complete selected `asset` pin, and
`measuredContentType`. No public metadata carries a storage key or filesystem path.

A small synthetic JSON intake body (base64 is the exact generated GeoJSON bytes):

```json
{
  "request": {
    "mutationId": "00000000-0000-4000-8000-000000000010",
    "documentId": "00000000-0000-4000-8000-000000000011",
    "assetId": "00000000-0000-4000-8000-000000000012",
    "title": "Synthetic source document",
    "contentType": "application/geo+json",
    "provenance": {
      "agency": "Synthetic fixture generator",
      "url": "https://example.invalid/generated.geojson",
      "license": {"status": "unknown", "reference": null},
      "retrievedAt": "2026-10-15T00:00:00Z",
      "published": null,
      "observed": null,
      "frame": {"crs": null, "axes": [], "linearUnit": null, "extent": null}
    },
    "reason": "Retain generated synthetic original"
  },
  "originalBase64": "eyJ0eXBlIjoiRmVhdHVyZUNvbGxlY3Rpb24iLCJmZWF0dXJlcyI6W119Cg=="
}
```

The intake envelope is bounded independently for base64 overhead; decoded bytes
still meet the 10 MiB limit. Duplicate JSON keys and unsupported numeric values
are rejected before typed decoding. Only the reviewed public query selector keys `bbox`, `bbox-crs`, `count`, `crs`,
`cursor`, `f`, `fq`, `limit`, `outputFormat`, `q`, `request`, `rows`, `service`,
`typeNames`, and `version` are retained, case-normalized for key validation while
preserving the original full URL bytes. Unknown query keys are refused. This
allowlist is not generic credential detection or source authority: trusted source
policy still qualifies the exact source URL, selector values and pins. URLs are
never fetched.

## Recovery and verification

`capture_recovery` creates a new private directory from one consistent SQLite
read transaction. The `houseatlas-native-geodata-recovery/1` manifest pins exact
lineage, contract, schema, compiled catalog digest, standalone SQL snapshot
hash/size and every retained historical original pin. The immutable custody
bodies remain in that SQL snapshot with their digests. The bundle contains an
independent immutable media vault and excludes credentials, sessions and grants.
Configured bounds are 4,096 historical original pins and 256 MiB aggregate media;
the SQL snapshot is separately bounded to 256 MiB.

`verify_recovery` uses a matching read-only database handle and independently
opened bundle vault. It checks every body and history transition, original-pin
immutability, request↔receipt↔audit semantics, reference-index equality in both
directions, canonical retained custody digests and all current/historical blobs,
including tombstones. It neither restores access nor selects a running service.
`restore_recovery` verifies the bundle, creates a new private destination,
retains exact SQL bytes and every original in a separate vault, then fully
validates and strictly reopens the restored dataset. Existing destinations are
refused. It restores no credentials/grants and performs no service selection.
No predecessor conversion, downgrade or reverse conversion is implemented.

The exact healthy example uses disposable generated files, the real native local
session and the actual in-process v2 router. It covers all six source families,
atomic original+Document creation, identical-input idempotency, bounded opaque
listing/get, exact attachment/frame bytes, CAS title correction, same-dataset
association, unchanged nonempty v1 native core identity+Asset/audit/receipt/manifest
validation, strict reopen, independently verified SQL+media recovery capture,
populated restore to a new private path and strict restored reopen.
It creates no listener, provider call, real source intake or household data.
