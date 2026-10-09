# Bounded stock HomeBox read composition

Source-only AT08 slice at published main
`87ad201140edb7b3afdb4396095a320c2926eafe`. Only the original reader namespace
changes. Landed decoder, calendar-date, navigation, authority, publication and
failure-publication behavior remains intact. This slice opens no provider,
listener, store, artifact file or credential/grant. It does not fork HomeBox or
add a dispatcher. Frozen stock.2 wire3 schemas are used without edits.

## Exact operation selection

`REQUIRED_READ_OPERATIONS` is the closed native Domain `OperationId` array for
these 28 catalog-required read IDs. `homebox.label.output` is additionally
accepted only when its already-validated route is non-print and delivery=render.

| Area | IDs |
| --- | --- |
| Entities/locations | `homebox.entity.get`, `homebox.entity.list`, `homebox.location.get`, `homebox.location.list`, `homebox.entity.mediated-history`, `homebox.location.mediated-history`, `homebox.location.tree`, `homebox.entity.path` |
| Tags/fields | `homebox.tag.list`, `homebox.tag.get`, `homebox.entity.tags.get`, `homebox.field.list`, `homebox.field.get`, `homebox.entity.field-names`, `homebox.entity.field-values` |
| Files/links | `homebox.file.list`, `homebox.file.get`, `homebox.file.download`, `homebox.document-link.list`, `homebox.document-link.get` |
| Maintenance | `homebox.maintenance.list`, `homebox.maintenance.get` |
| Types/templates | `homebox.entity-type.list`, `homebox.template.list`, `homebox.template.get` |
| Products | `homebox.export.create`, `homebox.query.read`, `homebox.qrcode.render`; non-print `homebox.label.output` |

The eight query views, both export formats, three render-label subjects and
bounded QR content retain the original payload in `PreparedRequest`. Label
selection exposes only the required native pair `print=false`; it has no print
command method. Actual provider GET construction stays with the source owner.
The existing Domain route/catalog retains whole-collection and external-egress
obligations; selecting a read does not grant them.

The 14 intentional global exclusions remain unchanged: nine unsupported stock
forms (`homebox.entity.history`, `homebox.location.history`, their two
`restore-deleted` forms, `homebox.file.replace-bytes`, `homebox.file.restore-deleted`,
`homebox.document-link.retarget`, and both maintenance attachment write forms),
two held Atlas forms (`atlas.binding.reassign-identity`, `atlas.asset.hard-purge`),
and three append-only replacements (`atlas.evidence.replace`,
`atlas.geometry.replace`, `atlas.reconciliation.replace`). Native upstream history
is distinct from the two required Atlas-mediated history reads. Catalog inspection
of these exclusions is static; no excluded operation or rejection probe runs.

## Typed owner interface

```rust
HomeBoxReadQuery::from_request(&domain::stock::ValidatedRequest)
    -> domain::stock::StockResult<HomeBoxReadQuery>;

trait HomeBoxReadOwner<P, W, G> {
    fn read(&mut self, principal: &P,
        prepared: &domain::stock::PreparedRequest<W, G>,
        query: &HomeBoxReadQuery)
        -> domain::stock::StockResult<HomeBoxReadResult>;
}

HomeBoxQueries::new(&contracts, &mut decoded_owner, &mut history_owner)
    // implements existing domain::stock::StockQueryPort<P, W, G>
```

`HomeBoxReadQuery` has private fields and no unchecked construction or mutable
access. It carries the exact full `SourceScope`, native contract `StockTarget`,
and resource/list/history/download/feature selection. Original cursor, empty q,
optional omissions, asset/barcode spelling and every other payload field remain
in the unchanged prepared request; schema-valid integral JSON numeric spellings
are accepted without coercing the original envelope.

Typed results are `ResourcePage`, `ResourceView`, `ReadObservation`, `FeatureRead`,
`FeatureData`, `ReadArtifact` and `FileDownload`. Resource-specific data and feature
query data remain exact JSON because their actual frozen schema arms own those
shapes. The actual `StockContractPort` validates the full declared operation output
without stripping, defaults or a weaker schema. The adapter checks full partition,
row scope/identity and duplicate identities, requested resource/page/feature-array
bounds, selected output kind, artifact byte limit/media type, original correlation
and absence of child mutation results. Path rows still require the original Domain
ancestor-disclosure proof. Producer cursor/provenance/status are retained.

The read owner borrows the original principal/witness/graph; it reads already
captured decoded observations synchronously. Async bounded provider intake belongs
to the existing source owner before resolving the original captured graph, without
holding Access or SQLite guards across IO. Provider observation handles come from
the real observation owner, never this adapter. Artifact/download tokens, measured
size/digest, expiry, resource mapping and download disclosure come from the actual
scoped artifact broker. This module cannot manufacture an authorized media grant.
Export `maxRows` remains an explicit producer obligation before creating its artifact;
the public artifact descriptor cannot independently certify a CSV row count.

Mediated history delegates the same original principal/request/contracts to the
existing `StockHistoryPort<P>`. Compose its actual `NativeStockReads` implementation
on the issuing store and reviewed original `StockAuthorization`; no second handle,
current-record reconstruction, provider audit completeness or new event is added.

## Genuine cached entity bridge

`cached_entity_page(&query, &PreviousGeneration, &now, stale_after_ms)` converts
actual decoded entity/location get/list facts only. It repeats projection/scope
validation, preserves original source/retrieval timestamps and known IDs/scalars,
and computes an observation-only canonical digest of the exact scoped projection.
It preserves unknown type/parent values. Tags and custom fields absent from the
current projection are omitted, never invented as empty facts. Aged/error retained
caches remain stale in the result; no success time/cache generation is updated.

The host first obtains the actual same-store partition under its original captured
authority and validates its durable registration/graph. This pure helper grants no
cached read permission. It does not implement upstream tree/path, field-name/value
semantics or a provider cursor/search. Existing cursor/q requests or results larger
than one bounded page need the real query owner; the helper refuses to invent a
cursor or silently truncate a complete result. Empty lists do not prove deletion.

## Minimal root/service mount

Keep the existing `domain::stock::{prepare, dispatch_prepared}` boundary:

```rust
let mut queries = HomeBoxQueries::new(
    &contracts, &mut captured_decoded_owner, &mut same_store_history_owner);
let result = domain::stock::dispatch_prepared(
    original_principal, &original_prepared, &contracts, &original_authority,
    &mut queries, &mut existing_commands)?;
```

Root selects this HomeBox arm in its existing stock read service while retaining
its current Atlas/Network arms. The exact owner-produced captured graph must prove
all targets/references, ancestor paths, whole-collection/egress scope and artifact
handles. Domain performs original-authority revalidation before query and after
validated output disclosure. This adapter's shape check never replaces those
checks. No root HTTP/MCP/WebMCP mount, module outside `read`, route grant, manifest,
lock, generated contract or integration merge is performed by this lane.

Concrete prerequisites remain: schema-complete native tag/field/type/template/
file/link/tree/path observations and provider cursors; product/collection query
observations; genuine scoped measured artifact/download brokerage and export row
bounds; original authority/preparer composition. Existing wire handles stock entity
page/detail/maintenance, not all those data families. In addition, frozen wire3
collection-maintenance feature dates are date-time/null while native `types.Date`
returns calendar dates. Its contract/decoder owners must reconcile that exact arm;
this adapter never manufactures midnight/timezones. No broad native/live or full
six-family completion is claimed from the typed selection/envelope coverage.

## Captured native observation owner

`DecodedReadObservation::{from_detail,from_maintenance,from_native}` now provides
concrete, pure projections from already captured native bytes. The constructors
borrow the exact validated original request and require an independently captured
`SourceScope`, original retrieval time and source status. Detail and maintenance
inputs are the existing `wire::Decoded<Detail>` and `Decoded<MaintenanceLog>`;
the original bytes are re-decoded, so mutable DTO fields cannot replace source
facts. Native resource/query input reuses the existing bounded duplicate-key-aware
parser with aggregate entry/text limits. The full frozen operation output is
validated using the existing `HomeBoxQueries` envelope before capture is retained.

Supported baseline resource forms are entity tags, field list/get,
maintenance list/get, tag list/get, entity-type list, template get, entity path and
location tree (11 direct forms). A separately captured complete template list
can also be joined with its captured native per-ID details (12 forms total).
Metadata query views are currency, statistics, location
and tag statistics, purchase-price statistics, barcode product, and an asset lookup
whose original asset spelling exactly matches a captured decoded entity detail
(seven views). Native aliases need qualified source-owner correlation; no local
asset-number coercion is supplied. Barcode image tokens remain explicitly
unavailable (`null`) until a real broker supplies managed delivery; native URLs
and base64 are never promoted into tokens.

Native dates, retrieval offsets/precision, decimal cost strings and numeric query
tokens remain unchanged. Entity field time values retain the contract's explicit
`baseline-time-value-unexposed` state; native template time values are actually
exposed and preserved. Required rows and owner/member IDs are checked without
truncation. Unknown entity type data in sparse path/tree observations stays omitted.
Native tree child nesting supplies direct source parent relations, never placement.
Tag root null/nil normalization follows the existing native tag relation convention.

`references()`, `parent_relations()` and `ordered_path()` expose source selectors,
direct relations and native path order to the original graph resolver. A path
must include its requested entity exactly once as its final row; native order
alone supplies no ancestor authorization or qualified ordering guarantee. The graph owner must
independently prove every original relation and output obligation, including
whole-collection/egress permissions and `AncestorPath` disclosure. References
are evidence selectors, never source grants or a substitute for the complete
resolved graph. The source owner still retains the actual endpoint/request/response
correlation and route evidence; bytes or source scope DTOs cannot establish it.

After the actual owner resolves/authorizes that graph through `domain::stock::prepare`,
bind `DecodedReadOwner::bind(original_principal, &original_prepared, observation)`
and pass it into `HomeBoxQueries` and `dispatch_prepared`. The owner retains exact
principal and prepared-value identity, including the original witness/graph, plus
the complete unchanged request. It issues no authority or provider observation
handle, and opens no provider, broker, history store or credential. Async source
intake belongs to the original source owner before graph resolution, outside
Access/SQLite guards. This slice adds no application admission or HTTP/MCP mount.

Native list conversions preserve complete bounded response order, return no
invented cursor and refuse cursor/q selections that their source captures cannot
represent. They return unavailable rather than truncate data exceeding the selected
page/limit. A real cursor producer remains necessary for larger or searched views.

`from_template_list` accepts actual captured `/v1/templates` summaries plus
`TemplateDetailCapture` values for the corresponding `/v1/templates/{id}`
responses. The pinned `repo.EntityTemplateSummary` and `repo.EntityTemplateOut`
schemas share `id`, `name`, `description`, `createdAt` and `updatedAt`. All five
facts must be present and match exactly, with every summary ID represented once
and no extra/duplicate details. Full resource data comes only from each detail's
original bytes through the existing template-get decoder/projection. Summary
order, original list and detail requests/bytes, per-detail retrieval timestamps
and the distinct list retrieval timestamp are retained. The requested row bound
and a total capture byte budget apply without truncation. Source scopes and
statuses must match; mixed statuses remain unavailable. Only the unfiltered
`includeArchived: true` selection without cursor/q is supported because the
native template endpoint supplies no archive filter or archive fact. An observed
empty array with no details is a supported empty list; a summary is never made
into an empty-fields detail. Matching native timestamps does not establish an
atomic snapshot, freshness or source/endpoint qualification. These captures
still require the actual original owner graph and disclosure authorization.

Concrete representation blockers remain:

* Document-link list/get requires an observed native `archived: false`. Native
  `ItemAttachment` has no such property; the legacy decoder's presentation false
  is not source evidence. These forms remain unavailable for nonempty baseline
  link observations pending source/contract reconciliation. No false property is
  added to the baseline positive fixture. Any actual `archived` extension still
  requires the source owner to qualify its source version and field meaning;
  this adapter establishes neither from JSON presence.
* Stored-file list/get requires `archived: boolean`, which the native stored-file
  source and decoded type do not establish. No fabricated `false` is emitted.
* Summary-only native template lists still lack required fields. The source owner
  must capture each actual full detail before using `from_template_list`; no
  provider calls or source producer are implemented here.
* Native field-name/value responses are anonymous string arrays; the frozen result
  expects identity-bearing entity resource rows. Their ownership/correlation
  mapping is not present, and no entity ID is invented.
* Collection maintenance query requires date-time/null while known native dates
  are calendar dates. Resource maintenance reads already accept calendar dates;
  their exact fixed-decimal cost strings are preserved. An exponent cost that the
  resource schema cannot represent remains unavailable, never reformatted.
* Entity-type default-template facts must actually be supplied; absent or nil-only
  unqualified relations cannot be rewritten into a known null relation.
* Frozen UUID-only collection IDs still require an actual UUID registration;
  opaque legacy keys are not transformed or hashed into IDs.

History, downloads/export/label/QR artifacts, writes and provider setup remain
with their respective original owners. Existing cached four-form application
mounts remain unchanged. Source adapter coverage does not qualify application
producer intake, Access graph policies, provider deployment or live capability.

Four separate ordinary positive source tests in `observations_healthy.rs` run
through actual `NativeStockContract`, `prepare`, `HomeBoxQueries` and
`dispatch_prepared`. They cover 24 positive dispatches across the 12 resource
forms and seven query views, including all four custom-field representations,
actual nested source tree edges, a synthetic independently captured ancestor
chain, template references, original calendar/cost spelling and exact numeric
tokens. The principal/authority/graph are explicitly synthetic fixture owners;
they prove no production grant, HTTP/MCP lifecycle or upstream source intake.
Run only these exact cases with the existing source harness and `--exact
--test-threads=1`:

* `providers::homebox::read::query::observations_healthy::healthy_decoded_detail_and_maintenance_resources`
* `providers::homebox::read::query::observations_healthy::healthy_decoded_native_resource_graphs`
* `providers::homebox::read::query::observations_healthy::healthy_decoded_native_query_metadata`
* `providers::homebox::read::query::observations_healthy::healthy_captured_native_template_list_details`

The template-list positive case joins two source-shaped summaries/details in
different capture order, verifies original byte retention, exact numeric/time
spelling, qualified references, per-detail retrieval times and observed empty
fields, and separately dispatches an observed empty native list. It supplies no
archived property to the native attachment fixture and claims no positive
document-link archival evidence.

## Ordinary positive verification

The whole actual backend library compiles at the exact base plus this scoped slice.
Its existing Network unit-test modules need unlisted `rcgen`/`tokio_rustls` dev
libraries, so ordinary backend `--lib` test compilation currently has that unrelated
prerequisite. Root manifests remain unchanged. The task-owned external harness
imports this actual backend library and the exact unchanged `query/healthy.rs`
source, compiling only the three selected query tests; it replaces no production
peer source, validator or dispatcher. Its manifest/lock and source evidence are
provided to the integrator.

```sh
cargo check --locked --offline -p houseatlas-backend --lib
cargo build --locked --offline -p houseatlas-backend --lib
cargo clippy --locked --offline -p houseatlas-backend --lib -- -D warnings
rustfmt --edition 2024 --check backend/src/providers/homebox/read/mod.rs
cargo test --manifest-path "$AT08_QUERY_HARNESS/Cargo.toml" --locked --offline --lib providers::homebox::read::query::healthy:: -- --test-threads=1
cargo clippy --manifest-path "$AT08_QUERY_HARNESS/Cargo.toml" --locked --offline --all-targets -- -D warnings
```

Healthy source exercises 42 positive dispatches through actual NativeStockContract
and Domain preparation/dispatch/result disclosure: every required read ID, all query
views, both export formats, all render-label subjects, owner history/cursor and
file/artifact descriptor handoffs, exact empty/opaque/integral request representation,
and an actual stock reader generation converted into wire3 from its unchanged
cache. The latter uses pinned source-derived native detail/maintenance fixtures,
7-byte owned intake chunks, calendar dates, attachments, source offsets/precision
and stale age. Authority/history/artifact/provider peers for the other forms are
explicitly synthetic fixture owners, not production implementations. No native
artifact bytes, real grants, printer, live provider, app/listener or security,
replay, failure, fault, crash, concurrency, omission or adversarial controls run.


## Original owned-file source producer

`OwnedHomeboxFileSource<O>::new(owner, wire::DecodeLimits)` implements the exact
Media `homebox_artifacts::HomeboxFileSource` contract from source
`982f3565df6e1a61295731473dd42da85d64d0aa`. Root must compose that actual module;
this slice changes only the HomeBox query source namespace. It supplies bounded
local decoding and byte measurement, with no provider/file URL retrieval,
credential use, HTTP mount, source registration or durable custody replacement.

`NativeStoredFileOwner` is a mandatory trusted original owner port. `capture_file`
returns already captured local input before the Access transaction.
`with_current_file` holds its authoritative source/Store critical section through
the supplied inspection callback under the ORIGINAL Access guard/principal/grant.
It must check current source registration/generation, exact stored-file membership
and authoritative version. Lock order is Access -> broker -> source/Store, without
reentry into Access, broker or the same source lock. The synchronous callback
rereads at most Media's 10 MiB local bytes and checks work budget while reading.
Access is not a cross-database/provider transaction and implies no provider CAS.

`NativeStoredFileCapture<E,R>` contains independently captured scope/target,
exact owner and file GET path/query, original complete owner bytes and retrieval
time, opaque original evidence and already captured local reader. The immutable
`DecodedStoredFile<E>` retains these originals, the exact source/member objects
(including unknown facts) and independently measured SHA-256/size. Required
`qualify_file` authenticates the actual source owner's original response/body,
membership, source revision/build/freshness and authoritative version linkage
against that exact capture. It must preserve original evidence privately and may
not reacquire a source lock; it runs inside the current-file critical section too.
No serde proof/default qualification or native version factory is provided.

The adapter checks the actual native validated download target, independently
captured scope, original entity SourceGrant partition/entity, fixed owner entity
GET and scoped attachment GET (empty queries), exactly one selected attachment in
the original decoded owner object, and present nonempty non-link MIME/path facts.
MIME/path are only descriptive checks; they cannot authenticate stored-file
presence or body provenance. Original native keys are never opened as URLs or
filesystem paths. Missing MIME, external-link MIME or missing selected member
returns unavailable. An owner's unavailable original proof also remains unavailable.

Only the trusted qualifier supplies `HomeboxFileVersion`; native entity or
attachment timestamps, capture/byte hashes and retrieval clocks do not become
versions. The content type must match the observed member and any original
optional declared size/hash must agree with independently measured local bytes.
`open_file` returns a stable measured local body to the actual broker, which
independently reads/measures it again. `revalidate_file` checks pointer identity of
the ORIGINAL Access principal, revalidates its original source grant under the
held guard, verifies the sealed binding's original request/source correlation,
and independently decodes/rereads current local bytes inside the source-owner
critical section. Exact native version/content type/declarations and actual size/
digest must match that sealed binding. It creates no grant, receipt, token, hold
release or native retrieval. Media retains original allocation/grant/body custody
and owns authenticated GET/HEAD issuance/redemption. Domain stock output/witness/
disclosure authorization and root mounting remain required separately.

Concrete production facts still missing: pinned native `repo.ItemAttachment`
provides observed entity membership, metadata/timestamps and a native path but no
trusted byte version, digest, size or immutable capture primitive. The attachment
GET response is bytes only. No contract proves entity `updatedAt` changes with
attachment bytes. Production must provide genuine scoped response/body association,
current stored-file membership and owner-stable version/pinned snapshot plus its
source/Store critical section. This slice supplies no production implementation
of that owner port; those operations stay unavailable until these actual originals
exist. File list/get archive facts remain separately unavailable and unchanged.

The one exact ordinary positive fixture
`owned_file_source_healthy::healthy_original_owned_file_membership_and_measured_get_head`
uses actual native contract, Access boundary/session/entity grant, this producer
and Media broker. Its private disposable local store creates and owns a fresh
synthetic file/member and allocates its own generation (not a hash/timestamp
version). It retains the original principal, raw metadata and measured original
bytes; it holds a real source Mutex through all eight current revalidations.
Two fresh issuances and separate native authenticated GET and HEAD use two source
captures plus eight current measurements; the broker independently measures the
two capture bodies. Raw unknown facts and native date spelling remain retained.
No live capture/download, listener, provider, real files/accounts/credentials,
replay/expiry/revocation/failure/mutation/omission or other held controls run.
Compile and run only this exact case through the task-owned actual-library harness
with `--exact --test-threads=1`; no repository runner/manifest is added here.

## Concrete finite pinned-local attachment owner

`HomeBoxReader::capture_native_file_snapshot(owner, attachment)` performs three
fixed scoped GETs: entity detail, that entity's attachment body, and entity
detail again. All three share the existing generation deadline, capped at 60 seconds, and byte
statistics, retain status 200 and exact bounded response bytes/retrieval clock
spelling, and use the pinned detail decoder and parent authorization checks.
The selected member must be exactly one decoded stored attachment, with the
same original selected member value before and after retrieval. Its native
path is descriptive data; it never selects the body URL. The transport accepts
only canonical entity/attachment UUID paths, refuses attachment queries and
requests the body as `application/octet-stream`. The body is bounded by the
smaller configured reader and Media limits. No redirect, credential or TLS
policy is changed.

`NativePinnedFileOwner::capture_configured` accepts the actual trusted HomeBox
configuration, original credential peer, shared Access owner, retained original
principal, original source/partition grants and validated download request.
It constructs the real configured reader; no injected transport, public body
or qualification callback is accepted. Short original read fences bracket the
GETs and compare full configured registration and persisted Access metadata,
including opaque collection, owner, partition mode, allowed-ID order, access
epoch, registration version and digest. The post-fence completes its Access
commit before the owner is issued. No Access or Store lock spans a GET.
Original UUID spelling must agree with the reader; it is never silently changed
into a different request or partition.

The owner retains one sealed bounded local capture, original principal/grants,
configuration and Access allocation, and a private local snapshot identity.
Its fixed 60-second monotonic window starts before the first GET and is never
renewed. Credential headers and the temporary reader are not retained. There
is no body accessor outside `current_snapshot`: that method returns a
`CurrentPinnedFileSnapshot` holding both the source Mutex guard and a borrow
of the caller's actual current Access guard. It verifies the same original
principal, both retained and supplied grants, immutable request, full current
metadata and capture window. `revalidate(budget)` repeats current read
qualification without reacquiring Access. Bytes, original detail/member/path
metadata, lexical retrieval clocks and descriptive optional MIME borrow this
carrier. Missing MIME, byte size, archived facts and other unknowns remain
unknown.

This is qualification of a finite **local pinned snapshot**. The private
allocation identity is neither a content hash nor a provider revision, and it
has no public constructor, Clone, serde or version text. The before/after
member observations do not prove unchanged upstream bytes, a coherent remote
transaction, current provider membership, provider CAS, remote freshness after
capture or attachment archive state. No `HomeboxFileVersion.source_version` is
fabricated and the provider-version `NativeStoredFileOwner` path remains
unsupported by this owner. Media and root require a separate explicit pinned
snapshot consumer; these files add no broker issuance/redemption, stage,
reservation, mutation, quantity, Atlas or execution authority. No new runtime
case has run.


## Configured retained field/maintenance pagination

`read::NativeListPages` provides a separate configured native list producer for
`homebox.field.list` and `homebox.maintenance.list`. It constructs only the actual
configured HTTPS reader and original credential owner. The initial fixed entity
GET (no query) or owner maintenance GET (`status=both`) retains the entire bounded
successful response and original retrieval time. All members project and validate
before the first page; native array order and unknown original bytes survive.
The configured producer applies the adopted local member-name selector in
`contracts/stock-wire3/homebox-member-search.md`: omitted or empty `q` selects
all members; nonempty `q` uses literal substring matching after Rust Unicode
`str::to_lowercase` on the query and each independent public matching string.
Fields match `data.name` or actual text value, signed base-10 integer value, or
exact `true`/`false` boolean value. The native time-unavailable arm contributes
no value string. Maintenance matches `data.name` or its actual description.
No name/value concatenation, kind/reason tags, JSON serialization, trimming,
normalization, operators, identifiers, costs, dates or hidden properties
participate. No missing/unavailable value becomes a placeholder or zero/false.
Lowercasing is temporary comparison work; original public values, names and the
exact omitted/empty/nonempty query remain unchanged. Native/schema validation
still rejects an invalid null description; search never normalizes it to empty.
Other operations and older generic/DTO readers retain their explicit `q`
exclusion and existing behavior.

Host must share one registry across HTTP/MCP bindings using SAME configured Source
Arc. `NativeListReadRequest::select` borrows the current immutable validated request,
its exact original CapturedAccess and current registered Store baseline DATA. The
Root owner still obtains and freshly qualifies that baseline through the real
Store; the DTO cannot authorize a read. First pages call `capture_configured`,
continuations call `continue_original`, and each result uses its NEW request/P,
original handles and own Prepared/W/G through the existing bind/dispatch/disclosure
boundary. Snapshot Arc identity and full native references/parents must belong to
that graph, even though output is one selected page.

Opaque random cursors bind SAME retained capture/configured Arc, actual authenticated
session/actor, full scope/source metadata and complete query except requestId/cursor.
Only those two fields may differ; opaque collection spelling, optional omissions and
all other values are compared without normalization. Source checks the current
original principal/grants and persisted full registration/epoch before/after GET
and again at request-local bind/read. Registry lookup alone supplies no permission.
No old principal/grants/credentials/prepared witness/guard/Access or Store handle is
retained in the registry, and no second GET is made for a continuation.

The local registry bounds are 32 captures, 1000 cursor slots and 64 MiB aggregate
retained logical bytes, counted before original/context/baseline clones. It reserves
all continuation slots atomically before returning the first nextCursor and never
evicts unexpired chains. Insufficient capacity fails unavailable without truncation.
The five-minute monotonic window starts before native retrieval and never renews.
It is local retention, not current provider freshness; sourceStatus stays unresolved
and original retrievedAt survives every page. Native includeArchived projection
semantics remain unchanged; no missing archive fact is inferred. Restart discards
tokens. No persistence, recovery permission, live credentials, runtime case or
provider activation is supplied by this source implementation.

Search validates and retains the complete raw capture, every projected member
and the full reference/parent graph before selecting ascending native positions.
Pagination walks only those positions; the full decode/work/retention caps remain,
while the cursor-slot cap applies to the selected continuation chain. Selected
positions are counted before snapshot retention. Zero matches still require full
native validation and current original authority/release fences, and disclose no
absence proof outside that captured observation. No extra GET, filtered cache,
window renewal, query rewriting or provider-side search claim is introduced.
