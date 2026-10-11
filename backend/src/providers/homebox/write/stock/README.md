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
admission validation. `StockPreparationPort::prepare` continues to return the wrapped `StockPreflight`
for existing consumers. A retained original handoff is also available through
`prepare_retained`, described below; production admission must use that carrier
and its original qualifier rather than infer proof from a digest.

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

The DTO-based port contracts contain only preflight digests/flags and native
observation values. The retained handoff below also carries original bytes and
opaque evidence; its admission consumer and durable evidence persistence are
separate composition work. Genuine production capture/qualification remains a
required source implementation. Freshness/completeness cannot be recovered from
cached read APIs or the retained digest.

`fresh_healthy.rs` includes the following three original exact ordinary positive
source fixtures; the retained handoff case is documented separately below:

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

## Retained original preparation handoff

`DecodedStockPreparation::prepare_retained` uses the same capture, decoder,
mandatory `FreshPreparationSourcePort::qualify_preparation`, snapshot checks,
`map_stock`, full-PUT known-shape guard and canonical preflight envelope as
`StockPreparationPort::prepare`. It returns a privately constructed
`RetainedFreshPreparation<'owner,C,S>` only after all those steps succeed. The
carrier borrows the same adapter instance, preserving its contract and source
owner allocation for the entire handoff. It moves the original
`DecodedFreshPreparation<S::Evidence>` without cloning opaque evidence or raw
capture buffers, and retains the exact command and captured authority, untouched
owner preflight, wrapped preflight and actual native plan.

Immutable getters `command`, `authority`, `capture`, `owner_preflight`,
`preflight` and `plan` expose those original values. There is no public data
constructor, `Clone`, `Debug` or serde implementation for this carrier. The raw
capture getters preserve original bytes, scope, target, fixed path/query and
retrieval timestamp. This is an in-process handoff; persisted evidence data does
not reconstruct this owner, its evidence or authority.

`revalidate(&exact_command, &current_original_authority)` requires full equality
with the retained command and authority and then reruns the **same source
owner's existing qualifier** on the **same retained captures and opaque
evidence**, without recapturing, decoding replacement bytes or refreshing an
observation. It repeats command validation, snapshot correspondence, native
mapping, full-PUT checks and wrapper calculation, and requires the entire owner
preflight, wrapped preflight and native plan to remain identical. Qualifier
errors pass through; changed qualified values are preflight conflicts.

These getters are data, not an admission capability. A queue consumer must call
`revalidate` at its actual original entry/precommit/release fences and preserve
its original principal, graph, access handles, source ownership and atomic
persistence rules. Capture awaits must occur without Store or Access guards.
Equality of `StockAuthority` values does not establish original principal/grant
provenance or current authority. The bounded quantity installation source below now supplies original capture
and guarded qualifier mechanics for its reviewed one-field PATCH. Other write
families still require their genuine source qualifiers, complete reference/impact
graphs, approval and hidden-field contracts. Retention alone supplies none of
those facts, queue admission, dispatch or activation.

One exact ordinary positive fixture can be run independently:

```sh
cargo test --offline --locked -p houseatlas-backend --lib providers::homebox::write::stock::fresh_healthy::healthy_retained_original_preparation_revalidates_same_owner -- --exact --test-threads=1
```

It captures one synthetic entity response in process, preserves its exact raw
buffer and opaque fixture-owned evidence allocation, maps the existing entity
PUT without sending it, and performs three successful revalidations through the
same original owner. Instrumentation records one capture and four qualifier
calls including initial preparation. It checks original lexical cost/date and
fixed route/target data. Its explicitly synthetic qualifier is not a production
proof implementation. It performs no socket request, queue/SQL mutation,
provider invocation, new grant, mismatch/denial/expiry/revocation or held control.


## Guarded quantity capture mechanics

`QuantityProfile::production` retains expected installation data without
issuing admission. The configured installation owner described below supplies
the bounded original artifact/policy admission path. No public descriptor, hash,
`NativeQualification` value, Editor role or `X-Tenant` header proves an installed
route or approval policy. The earlier private test-only profile remains useful
for the mechanical fixture and cannot be constructed in a production build.

`OriginalQuantityPreview` borrows the actual mutation principal and already
captured source/partition grants. `QuantityObservationRegistry` issues a handle
only after the registered reader completes a bounded fixed entity GET between
short original Access mutation fences. The registry retains the original capture,
source revision, retrieval timestamp, actual persisted registration metadata and
monotonic elapsed-time bound. The caller then constructs its immutable command
using that issued handle. A read-action principal cannot stand in for this
mutation preparation action. No grant is issued, refreshed or resealed.

`QuantitySource` retains the original activity principal, configured reader,
registry and profile allocations. Preparation resolves the existing observation
and captures the same fixed entity GET before qualifying; the native body,
revision, target, route/query and original registration must correlate. Capture
awaits hold neither Access nor Store guards. Guarded qualification checks the
same original principal and captured handles through the caller's existing
`TransactionAuthorization`; it never locks Access or Store inside that guard.
Exact nonnegative integer quantities up to 9007199254740991 are supported in
this slice, avoiding float rounding of an original JSON numeric value. Other
numeric representations require a separately reviewed native precision contract.

`DecodedStockPreparation::capture_pending` captures without yielding a preflight.
Its consuming `finish_in_guard` uses the new REQUIRED source qualifier through
`FreshQualification`, retaining the same owner, raw buffer and opaque evidence.
`RetainedFreshPreparation::revalidate_in_guard` repeats the qualifier and the
existing snapshot, mapper and entire-preflight comparisons. The Domain consumer
must still check its exact original graph/carrier pointer before and after this
call. Legacy DTO-only methods retain synthetic compatibility; the concrete
quantity source refuses their unguarded qualifier. The existing mapper produces
only `PATCH /api/v1/entities/{id}` with `{"quantity":2}` for the named positive.
Matching GET readback establishes an observed value, not causal attribution, CAS,
remote completion, dispatch permission or release of any physical hold.

Required installation inputs are concrete: installed release, immutable source
commit, binary/image digest with build provenance and custom-patch inventory;
exact catalog/schema and GET/PATCH/response route artifacts; selected HTTPS
origin and API prefix; real bearer account/group identifiers mapped to the
original workspace/home/source and opaque collection; complete current source
registration and Access epoch/version; deployment and physical provider database
identities, configuration digest, dispatcher owner/epoch and source epoch; and an
explicit policy identity/version, exact target/quantity limits and finite clocks.
These are expected inputs, not claims that they have been supplied or verified.
Non-root API-prefix deployments and unreviewed builds remain unsupported.

If policy requires human approval, the original receipt must bind issuer and
caller class, actor/home/session, exact target/intent/quantity/effect scope,
policy and authority epochs, expiry and single-use state. A receipt UUID alone
is insufficient. The human-required activity consumer described below borrows
the root's actual closed receipt, while receipt issuance belongs to the genuine
authenticated approval flow. An explicitly configured bounded no-human rule also
requires genuine original policy admission; Editor membership does not select it.

A sanitized installed detail sample must retain all key presence, nulls, arrays,
unknown fields and numeric/date lexemes, with consistently replaced relationship
identities. Existing legitimate PATCH-response/readback samples or exact installed
route artifacts can establish compatibility without performing a new write.
Neither a sample nor the repository's pinned upstream source proves which binary
is deployed. No installed inputs, account authentication or provider activation
are inferred by this implementation.


The guarded readback API uses the same `FreshQualification` constructor, which
requires the genuine original mutation allocation and mutation-issued handles.
A later ordinary Read-action principal cannot substitute. Both preparation and
readback have pending capture/decode methods outside the guard and consuming
`finish_in_guard` methods inside it. Concrete unguarded readback returns
unavailable; no Access mutex is hidden inside its qualifier.

One exact ordinary positive is approved for this slice:

```sh
cargo test --offline --locked -p houseatlas-backend --lib providers::homebox::write::stock::quantity_healthy::healthy_native_quantity_capture_guard_and_readback -- --exact --test-threads=1
```

It uses one private synthetic profile and actual in-memory Access login,
original mutation principal, source/partition handles and fresh mutation guards.
Three fixed in-process GETs supply original preview, unchanged preparation and
a separately supplied quantity2 readback. No socket or credential is involved.
The fixture preserves raw buffers, retrieval and source date spelling, original
numeric lexemes, owner/reader/Access allocation identity and unchanged retained
plan across three successful guarded revalidations. It maps the actual one-field
PATCH but sends no native mutation. Supplied historical operation data is neither
queued nor admitted; causality, CAS and remote completion remain unproven. No
queue/replay/denial/expiry/revocation or other held control is executed.


## Configured quantity installation custody

`NativeQuantityInstallationOwner::capture_configured` consumes the actual root
`Arc<OriginalQuantityConfigured>` allocation. It opens only the five explicit
absolute artifact paths: executable, build provenance, entity repository,
entity handler and Swagger. It retains original bytes, paths, retrieval times,
SHA256 and opened-file metadata before/after each bounded read. The executable
is never executed. Bounds are 64 MiB for executable, 64 KiB for provenance,
and exact pinned lengths 87660/19776/216647 for the three source artifacts.
Unix regular-file device/inode/size/mtime must remain equal across capture;
other platform metadata contracts are unavailable in this slice.

The closed provenance schema requires schemaVersion=1, release=v0.26.2,
sourceCommit=e01dd737238a3fa7e1a6454b37de6c6fc88c86e4, executableSha256,
sourceArtifacts with exactly the three reviewed path/SHA256/byte-length pins,
an empty customPatches array and reviewedQuantityPolicy. These actual bytes
must match the configured descriptor and root-reviewed policy. The catalog
uses the canonical digest of the complete stock-wire3 operation catalog; the
route digest is the canonical digest of the captured, pinned Swagger JSON;
the build digest is SHA256 of the captured executable bytes. The exact schema
and reference pins are defined in quantity_installation.rs. These comparisons
validate supplied artifact consistency; they do not attest which remote binary
is running or authenticate a HomeBox account.

The reviewed policy explicitly names policyId/version/epoch, actorId, exact
context and target, accountId/groupId, deploymentId/physicalDatabaseId/
configurationDigest, dispatcherOwnerId/epoch, sourceEpoch, approvalRequirement,
maximum and freshnessMillis. The source supports explicit bounded no-human
quantity rules only. The descriptor source epoch must equal the actual persisted
source registration version in this slice; no physical row or elapsed time
invents that mapping. Human-required remains unavailable until original receipt
issuance and single-use spend composition exists.

The owner issues a private admission only under
`FreshQualification::with_quantity_installation`. This borrows the root's
`OriginalQuantityPhysical`, which retains the actual mutable Store borrow and
fresh original observation through the synchronous qualifier. Admission checks
pointer equality of the configured allocation and original activity wrapper,
actual Store identity, persisted queue/physical registration, original mutation
principal and grants, current source metadata, command and reviewed policy.
No Access or Store lock is reentered by the source. Callers acquire Store before
Access for this phase, then drop both before native GET awaits. Admission is
bound to the retained raw capture; the Domain consumer must preserve its
unchanged same-G/carrier linkage and checks before and after each phase.

Configured artifact custody has the same finite descriptor freshness window,
at most 60 seconds, measured from original capture. After that window the
caller must recapture from the same original configured artifact paths. A DATA
value, hash or renewed timestamp cannot refresh that owner. The GET observation
and preparation/readback captures independently retain their original finite
freshness and exact route/scope/byte correlation.

`owner.create_reader(preview, clock)` builds the real configured HttpTransport
with `NativeReadCredentialConfig::bind_original` and the same original Access,
principal and source/partition grants. The sealed QuantityInstalledReader has
no public data constructor or mutable reader getter. The installed observation
issuer and `QuantitySource::from_installed` preserve this owner allocation.
Production capture/guarded qualification/readback therefore have concrete
implementations when original configured custody is supplied. Unguarded DTO
qualification and unbound descriptor-only profiles remain unavailable. This
slice does not mount a route, enqueue an operation or send a native PATCH.

The named ordinary positive is:

```sh
HOUSEATLAS_QUANTITY_REFERENCE_DIR=/absolute/path/to/pinned-public-files cargo test --offline --locked -p houseatlas-backend --lib providers::homebox::write::stock::quantity_installation_healthy::healthy_native_quantity_installation_capture_guard_and_readback -- --exact --test-threads=1
```

The directory must contain the exact reviewed repo_entities.go,
v1_ctrl_entities.go and swagger.json; the fixture downloads nothing. It uses a
synthetic never-executed executable and explicit synthetic reviewed policy,
real disposable Core/Store/Access producers and startup registration rows, and
only a private test transport substitution for three fixed in-process GETs.
It checks guarded preparation, three fresh physical revalidations, preserved
raw numeric/date bytes, quantity2 PATCH mapping, guarded readback and zero
queue/activity entries. It proves configured artifact/policy and phase mechanics,
not remote deployment qualification, causality, CAS or write execution.

Ordinary operator setup supplies the HomeBox HTTPS URL and root API layout,
installed release/build and exported original source/provenance bundle,
account/group-to-workspace/home/source/opaque collection mapping, deployment
and physical database configuration, and the explicit reviewed quantity policy
with exact limits and epochs. Credential custody and original Atlas access
membership/grants are separate actions. A human-required policy also needs its
original receipt issuer/spend integration. URL/build/mapping alone creates no
account, grants, storage mount, approval or provider activation.

## Original quantity flow bindings

`QuantityPreparationBinding` implements the existing `StockPreparationPort`
using the same retained native preparation, original principal, captured grants
and configured installation allocation. It revalidates under a current Store
then Access mutation phase and returns the correlated preflight. It acquires no
native capture during that phase. `QuantityReadbackBinding` implements the
existing `StockReadbackPort`: it captures the fixed entity GET outside both
locks, then finishes against fresh original mutation and physical Store guards.
The bindings check the actual retained source owner before any readback GET.
Neither a matching descriptor nor public authority data substitutes for that
owner or the root's same-graph authorization.

`QuantityDispatchResources` accepts only the opaque invocation returned by the
original Storage session's fresh atomic admission. That admission checks the
initial `bodyAccepted=false` preimage, commits the accepted successor and its
permit, and retains the same original root preparation. `bodyAccepted` records
Storage admission; it does not record an HTTP body, native effect or completion.
The resource consumes that invocation on its first authorization attempt and
asks the same session to revalidate the actual current transaction, original
graph, grants, physical registration, permit and plan. Inside that phase the
selected credential configuration delivers a transient sensitive header for
the exact configured endpoint and quantity-only PATCH. There is no invocation
constructor from rows, serialized data or a permit, and no reissue or retry.

`into_http` binds these resources to the existing HTTPS `HttpDispatcher` and its
fixed quantity request builder. Constructing or preparing this dispatcher sends
no request; actual dispatch remains the existing consuming transport operation.
Staged uploads are unavailable for this quantity-only JSON plan. The concrete
root activity authorizer remains mandatory for admission and invocation; the
provider supplies no permissive authorizer or approval callback. A human-required
policy requires the root's genuine explicit-consent receipt and the same
Storage session's atomic spend composition. These source
bindings do not create operator configuration, grants, credentials or activation.

`QuantityActivityAuthorization::new` is a closed consumer of the same original
root preparation. This constructor admits only the explicit reviewed `NoHuman`
quantity policy and maximum; the separate `new_with_approval` path below borrows
a genuine human receipt. Both correlate the original request, native plan and preflight,
registered physical/source epochs, current source metadata and original grants.
The private activity capture check retains the original observation registry,
raw capture/evidence and monotonic artifact/capture windows; it neither renews
them nor supplies physical qualification. Storage's quantity admission and
invocation still revalidate the original root preparation against their actual
current transaction before and after the policy checks. When the existing
reserve API calls outside a transaction, the authorizer acquires only the
configured Access owner for a fresh original mutation guard. With a supplied
guard it acquires neither Store nor Access.

Without a genuine root receipt this policy peer refuses human-required
admission and invocation. It always refuses rejection and handoff evidence.
Its dispatch, never-invoked and observation journal actions accept only the
private consuming native evidence owner described below. Public transport facts
or a synthetic changed GET cannot establish a completed effect or release the
physical hold.

The directly scoped original-flow positive uses the real closed policy peer and
actual disposable Store admission. It is a separate exact named case:

```sh
HOUSEATLAS_QUANTITY_REFERENCE_DIR=/absolute/path/to/pinned-public-files cargo test --offline --locked -p houseatlas-backend --lib providers::homebox::write::stock::quantity_flow_healthy::healthy_native_quantity_original_flow_admission_authorization_and_readback -- --exact --test-threads=1
```

It uses the same reviewed public reference bytes, synthetic never-executed
executable/configuration/policy, original Core/Store/Access allocations and only
three in-process GET responses. It checks actual reservation and atomic
admission, one original invocation consumed for transient header delivery, an
unsent HTTP request and guarded readback. The activity row and its physical hold
remain retained, with no queue job or dispatch/observation event. It sends no
PATCH and does not attest a remote installation or establish causality, CAS,
completed native execution, hold release or a human approval receipt.

### Consuming quantity evidence owner

`QuantityNativeAttempt::from_original` consumes the actual invocation from the
same Storage session and original root preparation. It verifies the actual
session brand before creating its own existing HTTPS dispatcher. It accepts no
injected dispatcher, public report or facts constructor. `execute` consumes the
attempt and stores the actual full `DispatchReport` in that session's original
activity authorizer before any journal or disclosure await. Dropping a future
or losing a journal result never restores an invocation or provides a retry.

`CapturedQuantityDispatch::record` consumes that capture and journals only its
exact permit, prior operation and one-step activity version. Never-invoked facts
require the actual driver's `NotStarted`; invoked facts retain `EndUnproven`.
Entry and Precommit must match the same private expectation exactly once.
Successful recording returns a closed `CapturedQuantityRecorded`; public row
or receipt data cannot construct it.

The recorded owner can consume one guarded readback through
`QuantityReadbackBinding`. Separate preparation/readback adapter values must
share the original principal and registry pointers, reader/Access Arcs, sealed
installation owner and configured allocation. This custody check supplies no
current qualification. The actual GET completes before Store or Access locks;
finishing rechecks the genuine original mutation guard and borrowed physical
Store owner. `RetainedFreshReadback` moves the exact native bytes, decoded
capture and original opaque evidence alongside operation, plan, authority and
qualified observation. The existing `finish_in_guard` still returns only its
observation. The consuming evidence path retains the full receipt privately in
the original authorizer before deriving or journaling observation facts.

Readback agreement, a returned success status and journal commit do not establish
provider termination, causality or CAS. Unproven activity keeps its physical
slot held. Fresh disclosure still requires current original grants, metadata
and capture windows. These source mechanics have compile and static-review
validation only in this successor; no new transport, PATCH, journal or control
runtime case has run. The earlier named positive above remains an unsent case.

### Human-required preparation and admission

A `HumanRequired` preview retains a non-nil reserved approval UUID in the original
immutable request before native preparation. That identifier is data; it issues
no approval. `NoHuman` retains a null identifier and its explicit quantity
maximum. Both branches preserve exact safe-u64 quantity, original source and
target, captured native bytes, installed build/routes, policy, account/group,
current metadata, physical Store owner, source/dispatcher epochs and finite
capture windows. A human policy's optional maximum remains literal reviewed
policy data, with no inferred maximum or no-human grant.

The installation preparation receipt can qualify this human preview under the
same original mutation guard and physical context. It establishes original
native/physical preparation custody and creates neither human consent nor an
invocation permit. The ordinary `QuantityActivityAuthorization::new` remains
NoHuman-only. `new_with_approval` borrows the actual root `HumanQuantityApproval`
for the same original prepared bundle, configured allocation and reserved ID;
matching serialized IDs or digests cannot construct that receipt.

The root issues that closed receipt only after an authenticated explicit approval
POST and requalification of the original mutation/physical phase. Provider
admission performs all existing current checks, then asks that same receipt to
claim the actual operation and supply `StockActivityApproval` data to Storage.
Storage's existing receipt-ID equality, journal identity and unique atomic
approval spend remain unchanged. Invoke revalidates the already-claimed exact
operation under the fresh original guard without claiming, renewing or reissuing
approval. No provider callback reenters Store or Access.

Completed native evidence recording remains independent of later approval
freshness so retained actual I/O facts are not discarded. Current disclosure
checks remain separate. This successor has source compilation and review only;
no human approval, admission, invocation, transport or control runtime case ran.
Actual authenticated route/server ownership and configuration remain root peers,
and live installation credentials and grants remain external inputs.

### Detached original quantity queue capture

`NativeQueuedQuantityOriginal::capture_original` runs synchronously under the
same captured Access allocation, original principal and genuine configured
physical phase as `OriginalQuantityPreparation`. It revalidates that original
Root B phase and native preparation without acquiring another lock. The cut
admits only the literal reviewed `NoHuman` maximum, null approval receipt and
one complete existing-entity quantity PATCH with its fixed GET readback. It
refuses staged uploads, clears, children, whole-collection scope, generated
identities and complete-impact plans.

The detached cut owns immutable command, plan, authority, wrapped preflight,
exact raw snapshot and retrieval metadata, source registration/metadata,
reviewed policy, physical registration and queue configuration. It retains a
private bind-issued original identity marker and its own private issuer token;
it retains no live root bundle, configured owner, Access boundary, reader,
credential, grant, opaque native evidence or SQL handle. Neither the cut nor its
snapshot or known-zero token has a public DATA constructor, Clone or serde.

The derived enqueue metadata uses the production
`contracts::stock::CONTRACT_VERSION`, original UUID/idempotency spelling and
opaque registered partition. Queue registration resolves the single ordered
entity scope; incompatible literal scope spellings are refused rather than
normalized. `known_zero_admission` matches only its own cut by private allocation
identity and supplies `PendingByteLiability { required: false,
reserved_bytes: Some(0) }` for this verified no-stage form. Those accounting and
enqueue values remain DATA; they do not authorize Storage admission.

`revalidate_original_guard` first checks the unchanged Root B identity marker,
then exact original command, plan, bytes, policy, metadata and configuration.
It checks the same current mutation principal and original grants, and asks the
original source to revalidate its actual capture and artifact windows. This leaf
acquires neither Store nor Access and supplies no physical qualification. The
root consumer must separately revalidate its current same-transaction physical
phase before queue enqueue or claim. This slice adds no queue execution,
invocation, retry or activation path, and no runtime case has run.
