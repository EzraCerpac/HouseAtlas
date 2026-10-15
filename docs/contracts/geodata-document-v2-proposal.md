# Native geodata Document contract proposal, version 2

Status: review proposal, no runtime adoption. This change installs no Document
record, route, migration, importer, renderer or live source. Existing geodata
qualification is an unselected media seam. An uploaded native Asset alone is
not a native Document. The persistent blocker is the absent successor whole-record,
stock-command, storage and recovery contract closure described below.

This proposal is source-neutral. One individually retained source file becomes
one independently addressable Document. Its original bytes are never rewritten
or replaced with a screenshot, archive wrapper or concatenated download. Each
original and derivative must contain 1 through 10,485,759 bytes (strictly less
than 10 MiB); the HTTP boundary must enforce this exact exclusive limit even
though the existing unselected media pin accepts 10,485,760. A multi-file delivery
creates independent assets and Documents. A bounded official API batch envelope
is one original file with its declared format, not automatically many Documents;
extraction requires separate retained files and exact parent/extraction receipts.

## Version and identity

Proposed identities, reserved here only:

| Boundary | Successor identity |
| --- | --- |
| Public whole-record schema | `packages/contracts/schemas/atlas.v2.schema.json`, `$id` `https://houseatlas.invalid/contracts/2.0.0/atlas.schema.json` |
| Snapshot envelope | `contractVersion: "2.0.0"`; existing synthetic restriction preserved |
| New record | `schemaVersion: 2`, `recordType: "geodata-document"` |
| Payload profile | `houseatlas.geodata-document.v2` |
| Read projection | `houseatlas.geodata-document-read.v2` |
| Derivation receipt | `houseatlas.geodata-derivation-receipt.v1` |
| Custody receipt | `houseatlas.geodata-custody-receipt.v1` |
| Storage profile | `houseatlas-rust-storage/geodata/2`, independent fresh schema 1 |
| Recovery format | `houseatlas-native-geodata-recovery/1` |

Record identity is `(workspaceId, homeId, recordType, recordId)`. The successor
must also preserve the current workspace-wide record-ID uniqueness constraint;
a UUID cannot be reused across homes or record types. No provider URL, filename,
hash, title, building label or source object ID is a native record identity.
The new schema must carry forward every existing v1 record shape unchanged,
then add the v2 Document arm to Record, Snapshot, references, mutation inputs,
audits, results, batches, guards and read targets. Existing v1 record bodies and
historical audit/receipt bytes stay unchanged inside a v2 snapshot. Extending a
payload subschema alone cannot extend these closed unions.

Do not amend `atlas.schema.json`, its historical HTTP schema or frozen wire3
inputs. Use a distinct successor stock catalog/agent schema with exact new
schema URIs and operation arms. Its path/version must be selected jointly by
the stock owner before adoption; the existing partial `stock-wire4` directory
is not implicitly this successor. The generator must explicitly select v1/v2
inputs, retain old outputs for old consumers and produce separately named v2
Rust/TypeScript DTOs. Pin the full schema, history, resource-map, catalog and
policy closure by exact file SHA-256 in both generated headers and adoption
manifest. No digest is proposed for files that do not yet exist.

## Closed record shape and validation

Every object is closed (`additionalProperties: false`); all described fields are
required, with explicit nulls as stated. UUIDs are lowercase canonical UUID
strings; SHA-256 is 64 lowercase hex characters; revisions are exact integers
1 through 9,007,199,254,740,991. Timestamps are RFC3339 instants. Text fields
contain 1–4096 Unicode code points, no control characters. Duplicate JSON keys
and non-finite/inexact numeric values are rejected before typed decoding.

The record has exactly `schemaVersion`, `recordType`, `recordId`, `workspaceId`,
`homeId`, `revision`, `lifecycle`, `createdAt`, `updatedAt`, `lastAuditId`, `payload`.
Lifecycle is `active` or `tombstoned`; metadata is server-derived, matching the
existing native audit/CAS conventions. Payload has exactly:

| Field | Type / meaning |
| --- | --- |
| `profile` | Constant `houseatlas.geodata-document.v2` |
| `title` | Display text, never authority or physical placement |
| `original` | AssetPin |
| `provenance` | SourceProvenance |
| `preview` | null or PreviewLineage |

AssetPin has exactly `assetId`, `revision`, `sha256`, `bytes`. It resolves to the
same scoped, active native asset at that exact revision, hash and size. Original
asset purpose is `original`; owner is Atlas. The original asset's declared and
measured media/format must be accepted by the reviewed geodata admission profile;
filename suffixes do not establish format. New geodata asset MIME/purpose union
arms belong in the successor contract. Keep original download separate from
preview display and preserve native storage-key derivation privately.

SourceProvenance has exactly `agency`, `url`, `license`, `retrievedAt`,
`published`, `observed`, `frame`, `custodyReceiptSha256`. `agency` is source text.
URL is null or an HTTPS URL without credentials or fragment; private query
credentials must never be retained. It is provenance, never a fetch instruction.
License has exactly `status` (`unknown`, `permitted`, `restricted`) and `reference`
(null or text). Published/observed are null or `{value,precision}` where precision
is `year` (four digits), `day` (valid YYYY-MM-DD), or `instant` (RFC3339).
Retrieval is not observation/publication time. Corrections preserve original
claims and source dates in append-only history.

Frame has exactly `crs`, `axes`, `linearUnit`, `extent`. CRS/unit are null or
source-declared text; axes is an ordered array of zero to three text labels.
Extent is null or four/six finite numbers ordered `[min...,max...]` with each
minimum <= corresponding maximum. Unknown CRS/axes/unit stay explicit; viewing
never infers georeferencing, reprojection, local origin, alignment or placement.

The custody receipt is retained trusted server evidence, not just a supplied
hash. Its canonical JSON body has exactly `profile`, `scope`, `asset`,
`retrievedAt`, `sourceUrl`, `admissionProfile`, `measuredContentType`; scope is
`{workspaceId,homeId}` and asset is the exact original AssetPin. Fields must
agree with the Document and measured retained bytes. SHA-256 covers RFC8785
canonical UTF-8 bytes; the independently authorized custody writer retains the
receipt body. Client strings cannot mint verified custody.

PreviewLineage has exactly `asset`, `inputs`, `renderer`, `rendererVersion`,
`rendererConfigSha256`, `qualificationReceiptSha256`, `sourceCropExtent`,
`description`. Inputs is exactly `[original]`, preserving the complete pin. No
composite/multi-source preview is admitted in this profile. Preview asset has a
different asset ID, measured PNG bytes, successor preview purpose/content type
`application/vnd.houseatlas.geodata-preview+png` and no independently usable
bare-PNG grant. Renderer/config strings identify the qualified implementation;
crop is null or a valid extent in the declared original frame. Description
states display limitations. It never upgrades the source license or confidence.

The retained derivation receipt has exactly `profile`, `scope`, `inputs`,
`output`, `renderer`, `rendererVersion`, `rendererConfigSha256`,
`sourceCropExtent`, `description`. Every field matches PreviewLineage and scope;
output is its asset pin. Receipt SHA-256 uses the same canonicalization as custody.
A selected trusted renderer/qualification implementation must establish that
these output bytes were derived from these exact input bytes/configuration.
A hash-bearing receipt supplied by a caller or an arbitrary PNG is insufficient.
Original-only Documents are valid with `preview: null` and need no renderer.

## Atomic association, revisions and lifecycle

The create transaction requires current native mutate authority in the same
workspace/home, immutable trusted retained-byte proof, full custody evidence and,
when present, trusted derivation evidence. Staging original/preview bytes occurs
before the transaction; staged bytes confer no visible record or authority.
An atomic batch either creates the original/preview asset records and manifest
entries plus Document, audits and idempotency receipts together, or associates
already committed exact assets using revision guards. Validate all pins against
one original transaction snapshot and the final graph, recheck authorization
immediately before commit, and publish all SQL effects together. No partial
Document, asset association, preview receipt or association index may commit.
Filesystem staging is not a cross-filesystem SQL transaction: failure leaves
unreferenced staged blobs eligible only for the media owner's reviewed cleanup.
No referenced retained original may be removed by that cleanup.

Identity/provenance/asset links are record-owned references, not provider binding
reservations and not household/room associations. Scope alone does not assert a
building membership. A future reviewed geometry association must use its own
contract; no new room/building field is smuggled into this record.

Original pin is immutable for a Document's lifetime. A revised source file gets
a new Document/asset identity; title and provenance corrections use native CAS
and retain before/after audit bodies. Preview qualification may be added/replaced
by CAS only with complete original/preview guards and newly retained receipt;
remove preview with explicit null and audit. No source or preview links silently
follow a later asset revision. If an asset revision changes, the historical pin
remains retained and read availability becomes stale until an explicit reviewed
resolution; do not relabel old pixels as a new source revision.

Tombstone retains ID, pins, provenance, audits, receipts and blobs. It prevents
ordinary byte/preview reads and listing as active. Restore is explicit native CAS
with fresh authorization and retained-proof checks; it does not reacquire source
grants. Asset availability is independent from lifecycle. Missing, quarantined,
restricted or revoked content never becomes available merely because metadata
or a historical Document exists.

## Native read projection

Proposed operations are `atlas.geodataDocument.list`, `.get`, `.readOriginal`,
`.readPreview`, `.create`, `.replace`, `.tombstone`, `.restore`, registered only
by the reviewed successor catalog. Names here register no operation. Reads use
native session/scope/source authorization, and byte reads revalidate the exact
Document revision, lifecycle, original and preview pins before and after I/O.
Preview permission covers both the source and derivative; original source
revocation invalidates previews too. Browser and model browsing issue no fetch,
conversion, collector demand, or upstream writes.

Get returns exactly `{profile,scope,document,availability}`. Profile is
`houseatlas.geodata-document-read.v2`, document is the complete native record,
and availability is exactly `{original,preview}`. Each is one of `available`,
`unavailable`, `access-revoked`, `stale`, `quarantined`; preview alone may be
`not-qualified` when null. Denied metadata is omitted or the entire request is
denied according to native access policy, never exposed through availability.
List returns only authorized projections in a bounded cursor page; cursor binds
scope, filters and stable read epoch. Total counts cannot disclose denied rows.

Read requests carry `{scope,documentId,expectedRevision,mode}` where mode is
`original` or `preview`; selection uses no arbitrary filesystem path or URL.
Successful framing carries the selected asset's complete pin and measured
content type plus Document ID/revision/scope and mode. Response digest, byte
length and framing must match retained bytes exactly. Return originals as safe
attachments; only the qualified preview path displays its PNG. Never inline
source scripts, HTML or arbitrary geodata as trusted content. No byte routes or
storage keys are persisted in public metadata. A frame is invalidated on scope,
session, grant, lifecycle or revision change. UNKNOWN or missing preview produces
an explicit unavailable state, not fabricated qualification.

## Storage, backup and upgrade plan

Current Rust storage is lineage `houseatlas-rust-storage/1`, schema 5 or optional
stock-activity schema 6; fresh presence is its own lineage/schema 7. Current
Node storage is schema 3 with frozen on-disk contract 1.0.0. The canonical IFC
ledger is separate. None can be adopted by merely allowing another SQL record
type. Rust recovery validates exact schema catalogs and migration checksums,
plus complete native/stock histories; Node recovery fixes contract and schema
versions. Altering either silently would invalidate safe reopen and recovery.

The successor uses the distinct fresh geodata profile above with compiled SQL
schema 1 and metadata `contractVersion: "2.0.0"`. Its complete SQL/catalog digest
and table definitions must be reviewed before implementation; schema number 1
is relative to this new lineage, not legacy Rust/Node schema 1. It includes all
selected native core tables and immutable custody/derivation receipt tables
alongside document-reference indexes. It must declare its chosen stock/presence
capabilities explicitly; no union of optional predecessor profiles is inferred.

| Input | Permitted transition |
| --- | --- |
| Empty path | Explicit fresh geodata profile creation after compiled schema review |
| Existing matching geodata profile | Strict read/validate/reopen; no migration at open |
| Rust schema 5/6, presence 7, Node schema 3, IFC ledger | Refuse ordinary open; separate reviewed offline copy-converter only |
| Unknown/future/altered catalog or history | Refuse; retain original unchanged |
| Geodata DB opened by legacy binary | Refuse incompatible lineage; never downgrade |

Offline upgrade phases: (1) capture a coherent, independently verified predecessor
SQL+immutable-media backup using its own exact reader; record original schema,
lineage, contract, SQL checksum closure, schema catalog and all file digests;
(2) read the source read-only and create a separate empty destination with the
explicit successor profile; (3) preserve every native ID/revision/body, audit,
receipt, batch/order, reservation, source/cache epoch, tombstone and chosen stock
history byte-for-byte, using versioned adapters rather than replaying writes;
(4) migrate no new Documents from asset filenames or MIME guesses; new associations
require later explicit qualified mutations; (5) validate destination SQL catalog,
foreign keys, full graph, history/receipt digests and byte manifests and verify
a successor recovery bundle before any service selection; (6) publish an exact
conversion report and independently review target selection/rollback. No step
runs automatically at server startup. This PR executes none of these phases.
A profile-specific conversion design remains required for each predecessor;
unsupported extension tables stop conversion instead of being dropped.

Successor backup format includes exact profile/contract/schema and catalog digest,
SQLite snapshot hash/size, every scoped asset pin and immutable blob, retained
custody/derivation receipt bodies with digests, and conversion ancestry/report
hash when applicable. Capture one consistent DB snapshot, then all referenced
immutable originals/derivatives/receipts, including tombstoned historical pins.
Verify closure and aggregate configured limits before publishing. Verify recovery
with matching successor read-only validators before restoring to a new empty
path; validate every body, history, reference and exact byte hash, then atomically
select the new destination only under separately authorized service rollout.
Old recovery readers must reject the new format. Credentials, sessions and grants
remain excluded; restore does not create them. Rollback selects the preserved
predecessor backup/binary, retaining the new destination separately; conversion
of subsequent v2 writes back into v1 is unsupported.

## Review evidence and remaining work

The companion synthetic JSON uses invented `.invalid` provenance and inline tiny
generated UTF-8 GeoJSON to make pin/custody calculations reviewable. It has no
preview; it does not claim conversion, renderer qualification, persisted records
or a successful import. The evidence manifest pins inspected boundaries and the
proposal/fixture bytes. README-authorized publication verification checks exact
source allowlist/modes/digests only. No application or migration tests are claimed
for this documentation-only change.

Persistent implementation blocker: reviewed whole-record v2 schema and successor
stock catalog, separate generated DTOs/adapters, native transaction/reference
validation, retained receipt repository, exact fresh profile SQL and full recovery
closure do not yet exist. HTTP Asset intake and frontend viewing cannot remove
this blocker. Follow-on acceptance must include healthy synthetic create/read,
original-only and qualified-preview lineage, persistent reopen and independent
recovery verification through the selected successor contract. Denial, replay,
concurrency, crash and actual-media checks require their separately authorized
lanes. No live Documents or household acceptance are delivered by this proposal.
