# Stock HomeBox wire decoder

Implemented source code for official HomeBox `v0.26.2`, reference commit
`e01dd737238a3fa7e1a6454b37de6c6fc88c86e4`. The official tag resolves to that
commit. The fetched Swagger SHA256 is
`5da7752182cb6172db0550cbd799ee340836d3dba8ceaff7c6ed12976f9e3493`, matching
`contracts/stock-wire3/native/source-reference.json` and its checked-in artifact.
`source-pins.json` records the official Go/Nuxt source bytes used for semantics.
No installed target version, target build or source revision is inferred from
these reference pins.

Development starts at accepted integration
`7e742505fd360901a3976a993774a4bbdf7e2eaf`, tree
`027efbbe00688bea65560f20231ed17ac28fab2f`. The read namespace at this baseline
is byte-identical to accepted reader `6109e260bc19ba0d0a857fd15327a49b557c2650`.
GitHub main `501ccf6507d5924b7acf36675140294596e990a4` has the same tree.
All added files are in `backend/src/providers/homebox/wire/**`. Shared module
declarations, reader, router, contracts and publication manifest are untouched.

## Exported API

`decode_page(bytes, &PageRequest, DecodeLimits)` decodes actual
`repo.EntityListResult` summaries. `PageRequest::query()` supplies explicit
`isLocation`, `includeArchived=true`, bounded page/pageSize and repeated
`parentIds`. It preserves the two partitions: a source type-less row belongs
to the item partition; it never invents a type. Archive values and arbitrary
type IDs/names survive. A page must match its requested pagination and direct
parent filter. Cross-page totals, duplicates, deadlines and complete-generation
staging remain the reader's responsibility.

`decode_detail(bytes, &requested_id, limits)` decodes actual `repo.EntityOut`.
It exposes `Detail.summary`, the existing reader `Entity`, and existing reader
`Attachment` values. Omitted/nullable source parent/type stay unknown.
Go nil attachments are an empty projection list with original null retained.
`ItemAttachment.id` maps to `attachmentId`; `mimeType == "link/url"` marks an
external URL stored in `path`. Other paths remain source metadata. Stored-file
size and media proxy capability are unknown because upstream provides neither.
The canonical external-link `archived=false` is the Atlas link variant marker;
it does not assert an upstream attachment archive field (none exists).
Unknown MIME is represented as null. External reference URL spelling survives
URI validation. No path is read, downloaded or served.

`decode_maintenance(bytes, &requested_id, limits)` decodes actual
`repo.MaintenanceEntryWithDetails[]` into `MaintenanceLog`. It verifies `itemID`
against the requested entity, maps `id` to `entryId`, and decodes `cost,string`
to a JSON Number without an intermediate float cast. Native decimal/exponent
spelling survives; the original cost string remains in source/original.
`types.Date` emits `""` for unknown and YYYY-MM-DD for a known date. This module
maps unknown to null and retains the calendar date, without assigning a time or
timezone. Request `status=both` for complete entity maintenance.

Each result is `Decoded<T> { value, original, source }`; original input bytes
and the parsed upstream object are retained separately from normalization.
They may contain private source data and are not publication/cache evidence by
default. `Decoded<Page/Detail/MaintenanceLog>::reader_value()` provides the
normalized value consumed by the accepted reader validation pipeline. Unknown
list/detail fields remain available; UUID fields normalize, while collection
spelling is never normalized.

`Detail::projection_candidate(&scope, retrieved_at, &log)` supplies a scoped
serializable candidate using the reader's full `SourceScope`, original source
update time and caller-supplied retrieval time. It verifies the log's entity ID.
It is not a validated `Projection`, `CompleteGeneration`, current source
authority or publication fence. It has no native links before qualification.

`native_route_candidates(&summary)` supplies unverified source routes:
locations have `/location/{entityId}` and `/location/{entityId}/edit`; items
have `/item/{entityId}`, `/item/{entityId}/edit` and
`/item/{entityId}/maintenance`. Unknown types have no candidates. Official Nuxt
page files establish these candidates; they do not establish installed target
base paths, independent user rights or verified routes. Use the existing reader
navigation validation after actual route qualification.

`WireProvenance::source_derived_synthetic()` explicitly labels local fixtures.
`CapturedTarget` is a separate evidence classification, never inferred by the
decoder. Host-observed target version/build/revision fields remain optional.
This metadata is not an authority or qualification capability.

Limits are positive and capped at existing reader ceilings: 10 MiB per response,
100,000 entries and 16,384 characters per projected text. Page/pageSize cap at
1,000/100. JSON parsing checks UTF-8, duplicate keys including extensions,
finite numbers, depth 64 and the arbitrary-precision raw-container distinction.
These guards are implemented; stopped rejection/adversarial/mutation controls
have not been executed. Reader aggregate bytes, page count, deadlines, full
registration/allowlist, quarantine and consuming publication fences remain intact.

## Exact integrator bridge

The owner must add `pub mod wire;` beside `pub mod read;` in
`backend/src/lib.rs::providers::homebox`. No new shared dependencies are needed.
The namespace-local harness is separate from root workspace declarations and
already compiles this actual source against the actual accepted backend.

The existing frozen maintenance schema admits only timestamps/null. Its owner
must add this alternative to both
`$defs.maintenance.properties.scheduledDate.anyOf` and
`$defs.maintenance.properties.completedDate.anyOf` in
`packages/contracts/schemas/atlas.schema.json`, keeping existing alternatives:

```json
{"type":"string","format":"date","pattern":"^[0-9]{4}-[0-9]{2}-[0-9]{2}$"}
```

Regenerate the owned Rust/TypeScript contract artifacts through the existing
generator. The reader owner must change only maintenance date fields in
`read/types.rs` from `Option<Timestamp>` to
`Option<crate::providers::homebox::wire::MaintenanceDate>`. That exported type
deserializes either a preserved timestamp or a validated calendar date; it
does not change sourceUpdatedAt/retrievedAt/cache timestamps. Retained
maintenance reconstruction then uses the same native contract validation after
the additive schema is adopted. Existing canonical maintenance cost stays
number/null; source string cost is normalized before that validation.

Add an explicit trusted server-selected stock dialect to the reader constructor
(keep its existing synthetic default for retained healthy examples). For stock
reads, keep bounded GET/body receipt, stats and every current authority/fence
check. Retain bounded raw bytes from `request` until decoding; replace its
single synthetic parse with the endpoint-specific wire decode below. Preserve
its post-decode monotonic deadline checks. Build DecodeLimits from the existing
max_response_bytes, capped max_pages * max_page_size, and 16,384 text characters.

```rust
// list: construct from the reader's frozen page, size, partition and parents
let data = wire::decode_page(&bytes, &page_request, wire_limits)?.reader_value()?;
let data = decode::page(data)?;
// detail: use the already-authorized requested ID
let data = wire::decode_detail(&bytes, &id, wire_limits)?.reader_value()?;
let (detail, raw) = decode::wire(data)?;
// maintenance: fixed entity route with status=both
let data = wire::decode_maintenance(&bytes, &id, wire_limits)?.reader_value()?;
// feed data into the existing decode::projection(raw, detail, data, ...)
```

Map `WireError::Invalid` to reader InvalidSchema, Limit to SizeLimit,
WrongEntity to WrongScope, and Pagination to Pagination. Update its sanitized
InvalidSchema message to `HomeBox metadata failed the pinned wire contract.`
Keep all existing detail/list comparisons, parent graph checks, UUID dedup,
registration matching and source authorization. Do not replace the reader or
construct publication rows in this module.

For navigation, select separately qualified existing NativeNavigation per
source entityType.isLocation. Only mint links whose templates occur in this
module's candidates for that type and whose full scope matches. Locations
have no maintenance route. Do not assign verified=true merely from these
source candidates. Unknown types emit no native links. This selection belongs
inside the existing reader navigation/projection boundary.

The publication integrator must add all new namespace files with logical owner
`homebox`, Git mode `100644`, actual byte counts and SHA256 digests, then
reconcile its aggregate source digest. The old publication manifest cannot
certify the expanded tree until that owner performs the update. No manifest
reseal, root-module registration or reader/schema adoption is claimed here.

## Scoped healthy verification

Inspect these sources and harness manifest, activate the saved Rust 1.99.0
environment and use the following exact commands. Only the six named healthy
tests in this namespace execute; dependency tests and legacy controls do not.

```sh
export CARGO_TARGET_DIR=/tmp/houseatlas-wire-target
rustfmt --edition 2024 --check backend/src/providers/homebox/wire/mod.rs
cargo check --manifest-path backend/src/providers/homebox/wire/harness/Cargo.toml --locked
cargo clippy --manifest-path backend/src/providers/homebox/wire/harness/Cargo.toml --locked --lib --tests -- -D warnings
cargo test --manifest-path backend/src/providers/homebox/wire/harness/Cargo.toml --locked wire::healthy -- --test-threads=1
```

Nine fixture documents cover location/item pages, two-page completion, an empty
page, native archived detail, absent/null parent/type, nil detail arrays,
stored/external/unknown-MIME attachments, scheduled/completed maintenance and
decimal/exponent cost. `fixtures/manifest.json` pins exact synthetic bytes and
derivation. Their schema view interprets Swagger x-nullable annotations and
the inspected Go nil detail-slice behavior for attachments/fields. This
adaptation is explicit; it does not alter the original Swagger artifact.

No captured target, NAS/provider requests, current credentials/grants, source
activation, inference spending or deployment occurs. TLS, provider group/tenant
enforcement, installed API/build, complete native navigation and target capture
remain unqualified. Replay, rejection, fault, corruption, concurrency,
expiry/revocation and adversarial/mutation controls remain held. Source-compiled
decoding and successful synthetic examples establish none of those qualifications.
