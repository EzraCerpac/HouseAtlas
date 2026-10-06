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

Nine stock forms are explicitly unsupported by the catalog/native API: entity and
location history/restore-deleted, file replace-bytes/restore-deleted, document-link
retarget, and maintenance attachment upload/delete. No native method is invented.
Label rendering belongs to the read/artifact component and must use print=false.

Known native variant limits remain explicit before dispatch: changed entity time
fields, changed non-text template field values, template nullable default clears,
and template notes/defaultWarrantyDetails beyond the native 1000-code-point limit.
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
not release physical invocation holds. Every invoked outcome retains
causalityProven=false, atomicProviderCAS=false and nativeEditorRacePossible=true.
Only genuinely correlated ended-proven evidence releases the physical hold.
Logical fences, physical holds and byte/orphan liabilities persist independently.
The unqualified engineering profile numbers are not production settings.

## Scoped validation

The external harness imports the actual module with Rust 1.99.0/edition 2024 and
pins serde=1.0.228, serde_json=1.0.145 and uuid=1.18.1. AT51 owns final manifests.
Run only the two stock healthy groups by exact name: 63 positive mapping cases
across all 48 required IDs/native variants, and one fresh acknowledged synthetic
dispatch/readback. Shared contracts/access/preparation/ledger/transport remain
stand-ins in these groups. They open no socket and use no real credentials/data.
Their emitted 64 wire requests, one wire outcome and 63 native plans were
validated offline against the exact supplied request/outcome schemas and pinned
Swagger routes/body/form/query/response-status definitions. Swagger x-nullable
was interpreted for shape validation; it was not treated as native clear proof.
The external verification harness uses the existing jsonschema 4.26.0 package.

Held denial/revocation/replay/expiry/rejection/fault/crash/concurrency/adversarial/
mutation/omission controls remain unrun. Successful compilation and healthy
fixtures do not qualify real storage composition, provider security or deployment.
