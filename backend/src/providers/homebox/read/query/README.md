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
