# Authorized home read pack v1

This opt-in GET export is a captured documentary copy for offline reading. It is
not a native session, permission grant, write queue, database export or import.
Existing native Read, Media and source scopes authorize every online request.
The normal password-free Open Home/session flow remains unchanged.

## Routes

- `GET /api/atlas/offline/v1/workspaces/{workspaceId}/homes/{homeId}/manifest`
  captures one bounded home cut and returns its manifest.
- `GET /api/atlas/offline/v1/workspaces/{workspaceId}/homes/{homeId}/snapshots/{snapshotId}/manifest`
  returns that exact retained manifest after fresh native authorization.
- `GET /api/atlas/offline/v1/workspaces/{workspaceId}/homes/{homeId}/snapshots/{snapshotId}/resources/{sha256}`
  returns exact immutable bytes, optionally one `Range: bytes=start-end`.

No POST, upstream fetch, native mutation, account, grant, auth URL or bearer token
is introduced. `snapshotId` and resource hashes correlate content, never access.
Responses are `private, no-store`, `nosniff`, same-origin; consumers deliberately
store verified bytes in their own opt-in private documentary cache.

## Manifest

The response is a strict JSON object:

```text
{
  profile: "houseatlas.home-read-pack.v1",
  scope: {workspaceId, homeId},
  snapshotId: lowercase SHA256,
  capturedAt: original UTC timestamp string,
  completeness: "complete" | "partial",
  limits: {metadataBytes:16777216, totalBytes:134217728,
           resources:512, rangeBytes:4194304},
  totals: {bytes, resources},
  sections: {
    home: Section, atlas: Section, inventory: Section,
    network: Section, documents: Section, model: Section
  },
  resources: [Resource],
  exclusions: [{section, code, label}]
}
Section = {
  state: "complete" | "partial" | "unavailable" | "not-configured",
  resourceSha256: lowercase SHA256 | null,
  requiredBytesComplete: boolean
}
Resource = {
  sha256: lowercase SHA256, bytes: exact integer, contentType: string,
  section: "home" | "atlas" | "inventory" | "network" | "documents" | "model",
  role: "section" | "original" | "preview" | "model",
  record: {recordType, recordId, revision} | null,
  href: same-origin resource route above
}
```

`snapshotId` hashes the exact compact retained-JSON manifest before insertion of
`snapshotId` and resource `href` fields. Retained JSON uses sorted object keys
and preserves original JSON number tokens; it does not round through binary64
or apply JCS numeric normalization. Capture and source timestamps are strings.
Consumers must use the existing lossless JSON reader for section resources.
All listed resources are the exact required local-save closure, including a partial
pack: a successful local save can preserve a partial pack but cannot turn its
coverage into complete. Every non-null section root resolves to one listed
`role:section` JSON resource; every document/model digest resolves to a listed
resource. Identical byte hashes deduplicate to one resource, keeping the first
descriptor in fixed section order home, atlas, inventory, network, documents,
model; other references share its hash without requiring matching role/record.
A section-root attribution collision retains the first descriptor and explicitly
withholds the conflicting root as partial; it never rewrites an original descriptor.
Canonical attribution is descriptive, not authority or exclusive identity; every
referencing record retains its own mapping. Equal hashes with conflicting MIME
are withheld at the conflicting reference with an explicit partial exclusion;
they are never silently relabeled.
Every section resource is UTF-8 `application/json`; every Resource hash covers
its exact original bytes. Native asset and model MIME values remain explicit.

## Section bodies

- `home`: `{profile:"houseatlas.home-read-pack.home.v1",scope,label,selection}`.
  Selection is `{workspaceId,homeId,buildingId:null,floorId:null,roomId:null}`;
  the backend never guesses a physical selection. The consumer may separately
  retain its explicit last building/floor/room choice against these records.
- `atlas`: `{contractVersion,synthetic,records,revisions,sources,caches,nativeGeometry}`.
  Records carry current identity/building/floor/room, evidence, relationship,
  circuit/valve/electric, geometry/scene, asset and reconciliation facts from
  one authorized SQL snapshot. `revisions` contains
  `{recordType,recordId,revision,lastAuditId}` for each captured record.
  Asset `storageKey` is omitted from the documentary projection; exported
  resources are correlated by asset ID/revision/hash, never filesystem paths.
  `nativeGeometry` contains admitted descriptors:
  `{profile:"houseatlas.native-geometry.v2",scope,buildingId,state,floors,
  physicalScale:"unknown",floorAlignment:"unknown",stageToHouseTransform:null}`.
  State is `complete` or `unavailable`. Each floor is
  `{floor:<exact native FloorDescriptor>,originalResourceSha256,
  derivativeResourceSha256}`. The existing native geometry bundle owner admits
  the captured record/asset lineage and actual original/derivative bytes;
  both hashes resolve to permitted resources with their declared MIME. No live
  `readPath` or current-view authority is retained. Failed qualification or
  missing bytes is an explicit `scans-unavailable` partial exclusion, never a
  filename/purpose guess or a model-overview reclassification.
- `inventory`: `{entities,sources,caches}` with the authorized retained HomeBox
  projections and their original retrieval/source timestamps. This does not
  fetch HomeBox or claim freshness beyond the retained source generation.
- `network`: `{relations,sources,caches}` from that same local cut. Existing
  consistency, uncertainty, source generation and unresolved endpoints remain
  explicit. Individually withheld relations also make coverage partial, even if
  the partition cache has no `access-revoked` status. The read cut carries only a
  private omission flag; the pack exposes a generic `source-withheld` qualifier,
  never omitted relation IDs or counts. No collector demand, diagnostics or
  network provider fetch occurs.
- `documents`: eligible active Documents only, `{profile:"houseatlas.home-read-pack.documents.v1",documents,
  originals,previews,exclusions}`. Each original/preview reference carries
  `{documentId,documentRevision,assetId,resourceSha256,availability}`; digest is
  null when permitted retained bytes cannot be included. v2 source/license and
  qualification facts remain documentary; no preview is invented. A current
  source-policy restriction yields one generic `source-withheld` coverage
  qualifier and partial state, without disclosing withheld identities or counts.
- `model`: the versioned section below. Its small root is always a generic
  section JSON resource; the admitted raw companion is a separate opaque resource.

### Exact retained identity bodies amendment

An Atlas section may additionally contain `retainedIdentityBodies`. This
optional descriptor refers to exact retained `records.body` bytes at the
captured revision, not original mutation requests, a current base or native
authority. Older packs without it remain readable but supply no exact-record
evidence for creating local drafts.

```text
{
  profile: "houseatlas.home-read-pack.retained-identity-bodies.v1",
  resourceSha256: lowercase SHA256 | null,
  bytes: exact nonnegative integer,
  members: [{
    workspaceId, homeId, recordType: "identity", recordId,
    revision: exact original numeric token,
    offset: exact nonnegative byte offset, bytes: exact positive byte length,
    sha256: lowercase SHA256
  }],
  omissions: [{
    workspaceId, homeId, recordType: "identity", recordId,
    revision: exact original numeric token, bytes: exact positive byte length,
    sha256: lowercase SHA256, code: "member-byte-budget"
  }]
}
```

The one aggregate uses the existing manifest descriptor
`section:atlas, role:original, record:null`, MIME
`application/octet-stream`, and its exact length and SHA256. It is not a new
resource role or JSON resource. Deterministic record-ID order concatenates
unchanged bodies without separators or padding. Unique member slices are
contiguous, nonoverlapping and cover the complete aggregate; offsets and lengths
count UTF-8 bytes, never characters. Each member's digest is computed independently for its slice; it can equal
that of a single-member aggregate. A consumer must verify the actual aggregate
length/hash/MIME and then the checked member slice, per-body hash, strict
schema, scope, identity and revision. It must not substitute a resource hash
for a record hash or pass concatenated bodies through the generic section JSON
parser. Generic saved-house storage retains the aggregate opaquely.

Capture uses the existing authorized SQL transaction. Duplicate-rejecting,
number-preserving v2 JSON parsing and the closed native identity schema precede
SQL scope/type/ID/revision and complete captured-record comparison. Revisions
have exact integer values in 1..9007199254740991; their original numeric lexical
tokens are preserved without binary64 conversion, including valid integral
decimal/exponent encodings. Whitespace in retained bodies is also preserved.
The identity must equal its existing documentary projection: excluded or
transformed fields cannot escape through this resource. Missing or conflicting
rows refuse the capture. The continuation fingerprint commits ordered keys,
revision tokens, lengths, body hashes, omissions and aggregate hash, so
byte-only changes invalidate continuation.

At most 10,000 identities and 16 MiB of identity bodies are captured; exceeding
that capture bound refuses export. Each included member is at most 1 MiB.
Larger members are omitted with exact documentary metadata and explicit partial
coverage. No empty aggregate is listed: an omissions-only descriptor has a
null resource hash, zero aggregate bytes and no members. With no identities,
the optional descriptor is absent. Aggregate/mapping publication consumes the
unchanged resource, section, metadata and total budgets. If the extension
cannot fit or has conflicting resource attribution, it is withheld with explicit
partial coverage; the same frozen cut may be recomposed without the extension
when later metadata cannot fit. An added aggregate can consume a resource slot
otherwise available to another section; resulting coverage remains explicit.

Existing authorization, source restrictions, byte ownership and final/resumed
revalidation remain authoritative. This producer adds no frontend admission,
draft creation UI, local-store schema, native mutation, submission or replay.
The shared frontend lossless JSON parser's last-wins object handling alone is
insufficient for exact-original admission; the saved identity consumer below
adds an admission-only duplicate-decoded-key preflight.

### Saved identity draft consumer

The saved Local drafts panel can explicitly read this optional identity
descriptor through a read-only local resource port. It does not derive originals
from catalog trees, aggregate hashes or the generic section reader's parsed
projection. Before using either existing last-wins parser, an admission-only
scanner rejects duplicate decoded keys throughout the raw manifest, raw Atlas
section and individual body, including escaped-equivalent keys. Shared parser,
schema, saved-house storage and local-edit store/controller contracts are
unchanged.

Admission binds the complete selected saved copy, exact manifest bytes, resource
descriptors and current local revision across asynchronous reads. It checks the
complete identity set against members plus omissions, strict native identity
shape/scope/ID, exact safe-integer revision values and original lexical tokens,
ordered contiguous offsets, captured-byte bounds, the complete aggregate
length/hash/MIME and each included member's hash and full documentary equality.
The binary aggregate never enters the generic JSON section parser. Each
included member supplies a detached exact original and its individual digest;
the selected resource remains the actual aggregate descriptor. A single-member
aggregate can legitimately have equal resource and original digests.

Construction and rendering perform no resource reads or retention. After an
explicit memory-only local draft-space choice, the user selects Read saved
identity originals, then an admitted candidate. Selection first reads the
matching local draft: an existing row opens without replacement. Only a verified
absent read enables the separate Retain local draft action. The unchanged
controller/store preserves transaction-completion verification, immutable
originals and exact manifest bytes, separate reversible proposals, and targeted
discard. An uncertain completion establishes no safe retry. Discard never
automatically re-enables retention. All changes remain local and unsubmitted;
the partition supplies isolation, not actor/session/grant authority.

Older packs without the optional descriptor, unavailable resource ports or
failed candidate admission expose a separate candidate-unavailable state.
Already-retained local drafts remain independently readable/editable. No
automatic online request, new source capture, saved-pack upgrade, native
mutation, submission or replay is introduced. Consumers must acquire a separately
qualified new saved pack to obtain newly exported identity originals.

The generated serial positives and panel SSR described in the verification
guide do not establish DOM events/focus/effects, actual mounted-host lifetime,
pending retirement/stale completion/reentrant observer behavior, uncertain
writes, corruption/denial/fault/concurrency/replay/crash controls, browser/device
durability, live-base reconciliation or installed acceptance.

### Model section v2 amendment

The closed v1 manifest, six sections, resource roles, limits and digest/dedup
rules above remain unchanged. The model section body is now exactly:

```text
{profile:"houseatlas.home-read-pack.model.v2", overview: Overview,
 unifiedAtlas: UnifiedAtlas | null}
Overview = <existing houseatlas.model-overview-read.v1 descriptor,
            removing original.href and adding original.resourceSha256>
UnifiedAtlas = {
 profile:"houseatlas.home-read-pack.unified-atlas.v1", scope,
 publicationId, semanticsSha256, selectionRevision,
 companion:{resourceSha256,bytes,contentType:"application/json"},
 originalResourceSha256,
 roomLinks:{resourceSha256,bytes,contentType:"application/json"} | null
}
```

The complete original GLB (at most 32 MiB) and exact admitted raw unified
companion (at most 12 MiB) are separately pinned `role:model` resources. The
companion resource digest equals `semanticsSha256`; it retains the original
publication scope, source revision/digest, matching inline plans, occurrences,
mesh bindings, documentary overlays, coverage, source dates and uncertainty.
Its original digest/size must match the saved GLB and overview publication.
No parse-and-reserialize substitute or ordinary-GLB reclassification is used.
The companion counts against the total payload budget, separately from generic
section metadata. It must never pass through the generic 8 MiB section parser.
The small v2 root still uses that existing parser and carries only references.
Every generic section and the manifest are bounded to 8 MiB, and the manifest
has at most 20,000 exclusions, matching the unchanged consumer. Unrepresentable
metadata returns 413 instead of offering a pack that the consumer cannot parse.

Independently selected raw room-links bytes (at most 1 MiB) are a separate
`role:model` JSON resource. The existing owner admits their scope, publication,
semantics and selection revision. Missing/unconfigured mapping stays null with
`room-map-unavailable` and partial coverage. Producer labels, native IDs and
historical binding status cannot create a map or current native review lease.
An overview without a unified selection retains its original but reports
`unified-atlas-not-configured` and partial model coverage. Unavailable selected
bytes, budget limits and missing qualified closure remain explicit exclusions.
No missing bytes are represented by a listed zero-length resource.

All non-null resource references resolve to listed required bytes, including in
partial packs. These immutable references and the observed selection revision
are documentary correlations only. Source files and final original bytes are
revalidated through existing selection owners after byte work and on resume.
Generic v1 stores can retain the opaque resources. A renderer must explicitly
support this v2 section and the saved unified presentation adapter; the old
standalone overview viewer is not a unified Atlas fallback. This source contract
adds no frontend implementation, native session/frame or device acceptance.

Original provenance/license URLs remain inert documentary strings. Executable
transport URLs, native storage paths, session/cookie/CSRF/authorization material
and private owner configuration do not belong in a pack. External HomeBox
attachment bytes have no existing retained native original path: they are
explicit exclusions, never successful empty files.

## Coherence, bounds and resumability

Snapshot records, source projections/cache facts and owned asset manifests must
come from one authorized database read transaction, not independently paged
GETs. v2 Documents participate only through the same actual native dataset and
its source policy; a separately selected dataset cannot silently form one cut.
Selected model bytes are a separate immutable startup selection bound to this
same home. Byte work happens outside Core, then native owners, scope/source
facts and original principals are rechecked before release.

Required unavailable/missing/unsupported/over-budget bytes make the pack
`partial` and appear as exclusions. `complete` means complete for the explicitly
reported retained coverage, never that external/live providers were fetched.
Absent optional unconfigured services remain `not-configured`. At most 10,000
native records and 10,000 retained projections/relations are captured. Native
asset limits remain authoritative; selected model GLB is at most 32 MiB. No
resource or aggregate bound is silently truncated. A metadata cut above 16 MiB
cannot be represented and returns 413 without a pack.

`totals.bytes` is the sum of unique resource payload bytes. Metadata is included
as section resource bytes; exact manifest bytes additionally count against the
256 MiB host retention cap.

Retained captures are bounded to two packs and 256 MiB per host, with no disk
write or new database state. Evicted/unknown IDs return 404. Fresh authorization
or required source/cut/publication drift prevents continuation (409 or the
native authorization failure), rather than substituting newer content. Already
saved documentary bytes are not an offline native authorization capability.

Single range reads are capped at 4 MiB; full GET is bounded by the resource's
published size. Responses carry Content-Length, Accept-Ranges, ETag bound to
resource SHA256, and for 206 Content-Range. Content-Digest hashes the response
body; `x-atlas-offline-resource-sha256` identifies the whole resource. The client
assembles only one snapshot ID, verifies each full hash/size/MIME and all required
resources before calling its saved copy complete. HTTP success or metadata alone
does not establish a complete local save.
