# Stock HomeBox writes

This module implements the 48 required HomeBox write command forms in the
`0.3.0-at34.stock.2` catalog, plus the physical print variant of label output.
It produces fixed native request plans and typed top-level wire3 outcomes/errors.
Transport, shared wire validation, access, native preparation and durable admission
are injected peers in the same Rust application. No real HTTP or SQLite adapter
is included here. The original narrow synthetic mapper is a separate reference
API and supplies none of these native routes.

The operation/catalog/native definitions come from the sanitized portable
application contract supplement for published base
`9f7561d99e09a680ec5282ca0c8aed4e10c6cbc9`. Native behavior is pinned to public
`sysadminsmedia/homebox` source
`e01dd737238a3fa7e1a6454b37de6c6fc88c86e4` and its Swagger SHA-256
`5da7752182cb6172db0550cbd799ee340836d3dba8ceaff7c6ed12976f9e3493`.
An upstream source pin is not qualification of an installed provider.

| Required forms | Coded native mapping and readback |
| --- | --- |
| Entity/location create, update, archive/unarchive, reparent, delete, duplicate | POST/PUT/PATCH/DELETE entities; scoped entity GET or qualified absence; direct create ID plus exact readback |
| Entity/location children sync; entity quantity/type/tags set/add/remove | Preserved native sync PUT; narrow PATCH for quantities/type/final tag set; exact entity GET and complete affected-child impact when needed |
| Fields create/update/delete | Preserved owner-entity PUT; strict ID-bound field selection; exact response member delta followed by owner GET |
| Tags create/update/delete | POST/preserved PUT/DELETE tags; exact tag GET/absence |
| Files upload/update/delete; document links create/update/delete | Exact multipart file/name/type/primary; preserved attachment metadata; source-backed link JSON; strict owner/member response and GET correlation |
| Maintenance create/update/schedule/complete/reopen/delete | Entity-scoped POST, preserved maintenance PUT/DELETE; entity maintenance list with status=both and exact ID/itemID |
| Entity types create/update/delete | POST/preserved PUT/DELETE entity-types; exact ID in native full type list |
| Templates create/update/delete/create-item | Native flag/default/reference translation; preserved fields; exact template/entity GET, response member ID correlation |
| Bulk execute; CSV import | Six closed action routes; wipe options only; multipart csv only; complete authorized impact readback |
| Label print: asset/item/location | Exact GET labelmaker route with print=true; exclusive mutation admission and qualified printer evidence |

Names and counts never resolve generated identity. Create responses are candidates
until exact authorized readback. Malformed, nil or duplicate member IDs cannot be
silently filtered. Unknown responses remain unresolved even when current values
match. Native tag sets and ID-bearing field membership have route-specific set
comparison; ordered submitted arrays and immutable intent remain untouched.

Native full PUT requires a complete exact native observation. Entity PUT preserves
the observed sync flag and all untouched native scalars, source date spelling,
parent/type/tag links and custom fields. A null root parent uses PUT because native
PATCH null preserves the parent. Native sync can affect non-location children too;
an EntityOut children projection is not complete impact evidence.
Existing ID-bearing native fields are compared by exact identity without the
100-row wire-create limit; their bounds come from qualified native decoding.
Anonymous generated template rows retain bounded aggregate matching. Root tag
parents compare null and the native nil UUID only in that relation field.
Maintenance decimal costs compare exact numeric values without changing wire
strings or hashing intent. Comparison accepts fixed and exponent notation using
a normalized signed coefficient and checked exponent, with each native string
bounded to 4096 bytes. It uses no float, rounding or power-of-ten expansion.
An omitted entity-type default-template relation
remains absent in preservation input and readback.
Entity asset IDs compare the exact native integer value in that scalar field,
including native padding/hyphen formatting, without changing request spelling
or resolving resource identity through an asset ID. Explicit zero/out-of-range
asset IDs and explicit entity/maintenance dates `0001-01-01` are unsupported
native variants before dispatch. Existing native unset values and qualified
null-clear transformations remain preservable.

Nine stock forms are explicitly unsupported by the catalog/native API: entity and
location history/restore-deleted, file replace-bytes/restore-deleted, document-link
retarget, and maintenance attachment upload/delete. No native method is invented.
Label rendering belongs to the read/artifact component and must use print=false.

Known native variant limits remain explicit before dispatch: changed entity time
fields, changed non-text template field values, template nullable default clears,
and template notes/defaultWarrantyDetails beyond the native 1000-code-point limit.
Attachment upload/update accepts the six native types (photo, manual, warranty,
attachment, receipt, thumbnail); external-link create accepts the five public
types without thumbnail. Other strings return an explicit limitation. Non-photo
primary=true cannot be preserved. A first-photo upload with primary=false also
returns a limitation because native creation promotes it; a complete owner
attachment observation establishes whether an earlier photo exists. No primary
value or external-link type is silently normalized. Preserved primary=true
metadata updates require complete affected-primary impact evidence.
Upload filenames that native sanitization would change (`..` or path separators)
and link-create titles that native trimming/fallback would change also return
explicit limitations. Existing link/file metadata title updates preserve the
exact string; no unestablished native byte-length bound is invented.
No truncation or fabricated zero/empty value is used. Unrelated template updates
may preserve existing non-text fields only with genuine preservation evidence.
Nullable entity price/date and maintenance date/reopen forms, nullable type defaults
and template-item root forms need exact registered-build clear qualification.
`NativeClear` binds command/field and carries distinct input/readback values;
absence of that evidence returns an explicit before-dispatch limitation.

## Peer API and exact prerequisites

AT51 owns the generated request/result DTOs, schema registry and canonicalization.
`StockContractPort::validate_request` must validate the exact closed wire3 request
arm and convert it to `StockCommand`. It must compute immutable intent SHA-256
using the shared canonical convention: exclude only root requestId,
approvalReceiptId and the renewable HomeBox providerObservation; retain guards,
operation keys, ordered arrays and child transport IDs. `digest_native`,
`validate_outcome` and `validate_observed_at` use shared bounded native decoding,
exact output schema and finite operational-time parsing. No second schema copy
or root manifest is introduced here. `StockTarget` uses canonical UUID collection
IDs, distinct from the legacy projection's opaque collection key.

AT11/source authority supplies `StockAccessPort::authorize`: server-derived actor,
source epoch, original-grant authority digest, trusted physical binding, current
target/reference/whole-collection permissions, route qualification and output
disclosure checks. Authorization is refreshed after every relevant asynchronous
boundary, including retained results and post-dispatch readback. A renewed grant
must not substitute for captured execution authority. Real drivers independently
refuse `SyntheticFixture` qualification.
After asynchronous admission, the writer refreshes that same captured authority
before dispatch. Refusal persists never-invoked evidence and returns without
native I/O; access-denial sanitization is independent of persistence success.
Readback authorization receives a transient plan containing the validated
generated response target and resolved GET path. The same exact readback is
passed to the driver; stored intent/plan/digest remain unchanged. Unresolved
direct or member identities prevent GET, including list-based native routes.

The native preparation owner supplies `StockPreparationPort::prepare`: exact
fresh providerObservation linkage, complete scoped native snapshots, trustworthy
hidden-field preservation, complete approved impact/ref graph, staged metadata,
CSV row bounds and any exact clear transformation. Route/build qualification is
server evidence, not a flag accepted from wire input. Stage bytes are not accepted
by preparation or a waiting intent.

AT07 supplies `StockActivityPort` with these exact operations:

- `reserve`: durable actor/workspace/home/idempotency-key + immutable intent;
  replay existing operations without dispatch and keep waiting bodyAccepted=false.
- `admit`: one atomic original-authority/guard/observation/route/impact check,
  trusted human approval binding/consumption, byte liability reservation, and
  fenced owner/epoch claim for one physical DB invocation; persist intent first.
- `record_dispatch`: monotonic evidence merge against current durable state,
  retaining response member IDs and actual targets independently of readback versions.
- `save_observation`: atomic expected private activity version; retain dispatch
  evidence and complete-impact evidence digest; use the module's pure reducers.
- `reject`, `record_never_invoked`, `load`: exact lifecycle/proof distinctions and
  permanent operation retention. Atlas record revisions/history remain untouched.

`StockDispatchPort` invokes once outside SQLite transactions. It validates permit,
registered source/build/route, current source/dispatcher epochs and exact physical
binding, bounds I/O, refuses redirects and never retries. A successful HTTP reply
does not establish remote termination. `StockReadbackPort` returns bounded native
objects, exact scoped absence or qualified complete impact/printer evidence; no
generic 404, page omission, aggregate count or label image is sufficient.

`StockOutcome::with_dispatch/with_observation` encode lifecycle facts for the
durable transaction. Completed/resolved receipts remain historical; reconciliation
updates only unfinished dispatched operations. Explicit trusted resolution does
not overwrite a terminal receipt. Resolution also does
not release physical invocation holds. Every invoked outcome retains
causalityProven=false, atomicProviderCAS=false and nativeEditorRacePossible=true.
Only genuinely correlated ended-proven evidence releases the physical hold.
Logical fences, physical holds and byte/orphan liabilities persist independently.
The unqualified engineering profile numbers are not production settings.

## Scoped validation

The external harness imports the actual module with Rust 1.99.0/edition 2024 and
pins serde=1.0.228, serde_json=1.0.145 and uuid=1.18.1. AT51 owns final manifests.
Run only the two stock healthy groups by exact name: 76 positive mapping cases
across all 48 required IDs/native variants, and two fresh acknowledged synthetic
dispatch/readbacks. Eleven positive exact readback examples cover optional type
relations, root tags, 101 preserved fields, decimal cost spelling, native asset
formatting, supported non-sentinel date boundaries, and fixed/native exponent
cost forms including a preserved unchanged exponent spelling. The fresh workflows
verify same-authority refresh after admission and before dispatch, plus concrete
generated-target authorization before GET.
Shared contracts/access/preparation/ledger/transport remain
stand-ins in these groups. They open no socket and use no real credentials/data.
Their emitted 78 wire requests, thirteen wire outcomes and 76 native plans were
validated offline against the exact supplied request/outcome schemas and pinned
Swagger routes/body/form/query/response-status definitions. Swagger x-nullable
was interpreted for shape validation; it was not treated as native clear proof.
The external verification harness uses the existing jsonschema 4.26.0 package.

Held denial/revocation/replay/expiry/rejection/fault/crash/concurrency/adversarial/
mutation/omission controls remain unrun. Successful compilation and healthy
fixtures do not qualify real storage composition, provider security or deployment.

## Decoded fresh source adapters

`DecodedStockPreparation<C,S>` implements the existing `StockPreparationPort`;
`DecodedStockReadback<C,S>` implements `StockReadbackPort`. Both use the existing
native writer contract `C`, a server-owned original source port `S`, and bounded
`wire::DecodeLimits`. They perform no credential release, provider dispatch,
storage/history write, artifact brokerage or application admission.

The required `FreshPreparationSourcePort` and `FreshReadbackSourcePort` expose
capture methods followed by qualification methods. Their associated `Evidence`
is opaque, owner-provided and never interpreted as a grant by this adapter.
Capture inputs contain exact original bytes, independently captured `SourceScope`,
concrete target, fixed GET path/query and original retrieval timestamp.
Controller/request data must never instantiate these source ports or substitute
cached projections for captures. No production source-port implementation,
provider registration, fresh clock policy or source authority is supplied here.

The owner qualification methods must validate actual endpoint/response linkage,
original `providerObservation`, current source/build/route and finite freshness
policy, source revision, full native schema, original authorized reference/impact
graph and hidden-field preservation. They must retain those original proofs and
bytes privately. Parsing alone cannot establish any of these facts. Preparation
rejects a changed original command, wrong partition/target, duplicate snapshots,
changed native value/digest or missing complete qualification. It never creates
`complete` or `hidden_fields_preserved` assertions. The actual `map_stock` enforces
the existing replacement PUT and native-clear limitations.

`DecodedFreshPreparation::capture_digest` binds the full original request,
captured actor/source epoch/authority/physical binding/qualification and every
scope/target/GET/time/raw-byte SHA-256/native digest. After qualification, the
returned `preflight_digest` is the native contract's canonical digest of the
`homebox-decoded-fresh-preflight-v1` envelope containing that capture digest,
the unchanged owner preflight proof digest, exact snapshot qualification flags,
staged metadata and qualified clear forms. This binding does not qualify the
owner proof or accept upload bytes. The admission/retention owner must preserve
and revalidate that actual proof linkage; no replacement evidence store is added.
`qualify_preparation` is the trusted original-owner boundary, not independent
admission validation. `StockPreflight` returns only the wrapped digest and the
existing port surface has no typed retained-proof handoff or admission-time
source revalidation callback. Those consumer hooks remain unavailable here;
production admission must not infer that they exist from this adapter.

The supported native captures are entity details and entity-owner maintenance
lists with `status=both`. Entity field/attachment member readback uses the exact
owner entity GET. Original source JSON and byte documents survive decoding;
the narrower read DTO is never a writable snapshot. Preparation uses the actual
complete entity object or exact original maintenance row. Whole readback returns
the full captured object/list, including unknown facts and source revision/date
spelling. A replacement PUT containing unknown properties anywhere in these
objects is refused against the pinned native schema because the fixed mapper
cannot promise to preserve new writable extensions. Known hidden fields still
require actual owner proof; this guard does not infer preservation from absence.

Readback compares the supplied plan with the stored immutable plan plus the
existing qualified generated target resolution. It requires exact scope, target,
GET path/query, native value and retrieval timestamp in the owner's qualified
`Present` observation. Source uncertainty and any genuine owner-provided embedded
impact evidence pass unchanged to the original reducers. Matching values never
prove causality, provider CAS or remote termination and never release a hold.
Qualified absence, `CompleteImpact`/printer selectors, tag/type/template capture
families and owner source registration remain unsupported by this bounded adapter;
it returns unavailable rather than derive absence from a 404 or list omission.

The existing port contracts contain only preflight digests/flags and native
observation values, not original source bytes, source revisions or fresh-proof
provenance. These mandatory original-owner capture/qualification/retention seams
are therefore concrete remaining consumer contracts, not authority produced by
this adapter. Freshness/completeness cannot be recovered from cached read APIs.

`fresh_healthy.rs` contains only three exact ordinary positive source fixtures:

* `fresh_healthy::healthy_fresh_complete_entity_preparation`
* `fresh_healthy::healthy_fresh_exact_entity_and_generated_member_readback`
* `fresh_healthy::healthy_fresh_complete_maintenance_preparation_and_readback`

The task-owned external harness imports these exact fixture bytes and the actual
backend library. It uses `NativeWriterContracts`, both adapter implementations and
`map_stock`, with explicitly synthetic opaque qualification owners. Seven port
calls (four preparations and three readbacks) exercise retained complete native
values, original observation handle/digests, known PUT field/date/number
preservation, exact resolved member GET, full raw readback extensions and unchanged
operation/uncertainty. No dispatcher, socket, real account/token/data, database,
held control or native write is invoked. Run only each exact case with
`cargo test --offline --locked --manifest-path <task-harness>/Cargo.toml --lib
<exact-case> -- --exact --test-threads=1`; the harness is not a repository runner
or root-manifest change. Source success does not qualify production intake.
