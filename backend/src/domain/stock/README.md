# Stock domain adapter

This framework-free component adopts `0.3.0-at34.stock.2`, agent wire3, frozen
Atlas contract1.0.0 and record/audit schema1. The application routing table is
derived from the stock catalogue and grouped feature routes. Source hashes are
in `catalog.rs`; no shared schema or generated contract copy is included here.

`OperationId` retains all 164 catalogue identifiers and ten family groupings.
Each row declares its authority, effect, input/output schema reference,
resource/result kind, permission, family and disposition. The 21 feature
variants select only their declared routes. Nine unsupported native forms,
two held Atlas policies and three append-only forbidden replacements fail
before preparation or owner dispatch. These are coded branches; their stopped
control categories have not been executed.

`ValidatedRequest::parse` validates the exact arm through `StockContractPort`
and keeps the original JSON, root ID/key, ordered child requests, target,
guards and payloads without defaults or normalization. A host parser must reject
duplicate JSON object keys before constructing `Value`. The schema adapter must
register `urn:houseatlas:agent:stock:3` and the frozen Atlas canonical `$id` in
the offline draft2020-12 closure. It must preserve Unicode code-point lengths,
safe-integer bounds, required/nullability/closed-property and union constraints.

`request_digest` implements the published ECMAScript/UTF16 canonical JSON and
SHA256 conventions. It excludes only the root `requestId`, root
`approvalReceiptId` and, for a HomeBox root target, renewable
`preconditions.providerObservation`. Every ordered child request ID and all
child values stay inside the parent digest. `operational_time` uses finite
owner-parsed millisecond timestamps in the published date-time domain. It
preserves original strings and the existing `InvalidClock` category; the
preparation/storage owner must use those same finite values for observation,
approval, admission and expiry comparisons.

`prepare` captures the server principal's immutable current authority, resolves
the owner's complete original/candidate/final/reference/impact graph, authorizes
that graph, and revalidates the captured witness. Whole-collection actions,
external barcode egress, qualified routes and printer operation remain explicit
requirements available from the validated request. The injected owner must
prove them from real entitlements and observations. Preparation issues no
approval, consumes no receipt and accepts no upload bytes.

`dispatch` revalidates before the query or command owner call and again before
release. HomeBox mutations, import, bulk and label printing use
`StockCommandPort`, whose adapter must join the single physical durable write
queue. Label rendering uses the read port with explicit `print=false`. Network
inventory has only passive `GET /api/inventory`; snapshot/history use the
owner's saved data and introduce no upstream history/collector route.
Immediately before HomeBox invocation, the queue write owner must re-resolve
and revalidate the complete current target/reference/impact graph and exact
preparation, provider-observation, precondition and approval-bound effect facts
against the original immutable intent and captured authority. Earlier checks
do not replace this obligation; no grant, generation, observation or impact
substitution/rebase is allowed. Provider HTTP stays outside SQLite transactions.

`validate_result` validates the exact output arm, root/child command and request
IDs, resolved context, declared kind and intent digest. It checks each
`data.target`, resource, record, targeted row and history target against its
request, expected primary kind and source/collection/entity partition. Known
effects use a separate release path: exact HomeBox authority/source/collection
and one of the seven concrete resource kinds, followed by mandatory actual
owner/identity/effect proof against the original captured approved impact graph.
This retains qualified cascade/reference effects involving other resource kinds
without weakening primary-result checks or accepting arbitrary partition members.
Generated provider identity and ancestor path exceptions have distinct narrow
purposes requiring actual owner proof. Remap records match the submitted old
binding, new binding and reconciliation journal IDs. Atlas mutations require
their exact committed record set and audit count. Batch public records/audits
are the exact ordered flattening of the internal per-child wire receipts.
Those durable child receipts preserve per-child IDs without adding fields to
the frozen public batch arm. Full output authority and media/source-reference
disclosure remain separate mandatory owner checks even for untargeted data.
Requested page sizes bound the declared top-level records, resources or history
entries. Query limits bound the five declared row variants and purchase-price
entries; aggregate statistics retain their aggregate meaning. Checked integral
decoding handles accepted decimal/exponent budgets. Public artifact bytes are
checked against `maxBytes`; staged import/export `maxRows` and printed bytes
still require the actual owner's measurements before effects or delivery.

Shared `stockError` results are classified and validated against
`#/$defs/stockError` before an operation's success-only schema. They retain
request-ID correlation, current output authority and an empty child-envelope
requirement, including for batch roots. Successful batches require committed
success children and retain their ordered record/audit flattening. The domain
ordering correction is source/compiler qualified only; no error-input probe
is run or implied by successful ordinary examples.

Invoked native outcomes retain only `active`, `end-unproven` or `ended-proven`
activity. A `not-dispatched` outcome must be a never-invoked state with empty
effects and no success. Artifact outputs keep bounded download handles,
explicit input byte limits and finite operational clocks. Native outcomes do
not create provider CAS, upstream idempotency or causality proof.

The mandatory injected interfaces are `StockContractPort`,
`StockAuthorityPort<P>` with associated `Witness`/`Graph`,
`StockPreparerPort<P,W>`, `StockQueryPort<P,W,G>` and
`StockCommandPort<P,W,G>`. `NativeStockContract` supplies the genuine AT51
offline schema port. AT07 transaction storage and AT11 current authority are published owner inputs
with concrete bindings below. Provider/media queue adapters and complete stock
graph authority remain integration inputs. Routing, preparation, result and
digest behavior is coded here; peer implementation and scoped examples do not
qualify production execution. Atlas-local
atomic CAS/final graph/witness/receipt persistence is the transaction owner's
obligation. New source-presence admission remains held pending that reviewed
composition; frozen record/audit schemas remain unchanged.

`AtlasReads<R,C>` now implements the query owner for all ten Atlas record-get
forms over the existing real `ReadPort<P>`/`NativeStorage`. It retains the original
principal and canonical payload, validates frozen and exact stock shapes, checks
scope/target correlation and omits private asset `storageKey`. Output remains
subject to stock authority disclosure/revalidation. Its required
`StockHistoryPort<P>` now delegates all ten history forms to the real stock
history owner, preserving original command/digest/audit linkage and opaque
paging/search results. `NativeStockReads` implements that port through AT07
`stock_history_json_with_authorization`. Frozen bare audits are never converted
into stock events.
Lists and byte downloads remain owner work. No concrete current stock authority
composition or production endpoint is enabled by this mapper.

`plan_atlas_commands` builds immutable, lossless native plans for 31 direct Atlas
write forms and ordered batches. Root and child envelopes/digests, child order,
separate root guards and distinct root idempotency key/batch target ID remain
coupled. Actual native contract validation checks every mapped shape. Reasons
over the frozen command's 1024-code-point limit, non-Atlas guard arms and semantic
binding/remap/media/geometry transformations remain held. Planning executes no
native mutation. AT07 must atomically retain the full stock envelopes, key
reservations, stable operation IDs and audit linkage with native records and
receipts; a frozen receipt or post-commit sidecar does not supply that guarantee.

`map_atlas_commit` projects genuine native mutation results and retained stock
metadata through borrowed `AtlasCommitView`/`AtlasCommitGroupView` carriers. It
checks original intent, verified durable actor, ordered groups, native command
and candidate correlation, exact output schemas and ordered public flattening.
It creates no IDs, timestamps, receipt persistence or authority. Original
preimages and complete final graph proof remain native transaction obligations;
the mapper does not reconstruct them from newer reads. AT07 now supplies the
actual `StockAtlasCommit` carrier and atomic stock executor at `d5161c6` below.
`NativeAtlasCommands` returns that call's `owner_result()` unchanged. Current
stock dispatch must authorize the output and
revalidate its captured principal before release. Frozen scoped JSON execution
is available through `NativeScopedCommands`; it does not retain stock receipts.

The current composed compiler harness includes real published storage/access/
contract source snapshots and the current AT36 modules. Root manifests/locks
and shared stock schema implementation remain peer-owned. Compiler/static
review evidence for these new owner modules is separate from the earlier
synthetic examples and does not establish production execution qualification.
Exact AT07 `45e1e38e97a8e41536b4b6195449076d602589c0` now supplies typed
snapshot/record/audit/guard/mutationResult mappings. A separate five-shape
accepted consumer passed the actual native generated decoder; it supplies no
semantic graph, storage, authority, receipt or provider execution. Exact
peer/manifest/lock and pure-shape proof are recorded in `../README.md`.
`native_semantics::NativeSemantics::native()` now binds the genuine PR17
raw-current transition and timestamp exports directly. The prior six-method
proof is historical; complete native/stock execution remains unqualified.
See `../README.md` for exact peer pins, proof scope and ordering.

`NativeStockContract` wraps PR18's actual `contracts::stock::StockValidation`.
Its fallible constructor initializes the embedded offline resources; every
`StockContractPort::validate` call delegates the exact schema reference/value.
The domain retains its existing `ValidatedRequest::parse` decision order on
the host-admitted `Value`; no additional bytes/envelope intake is introduced.
Lexical/body limits and duplicate-key rejection remain the HTTP parser owner's
obligation. PR18's native bytes parser replaces duplicate object keys and its
envelope helper has separate correlation decisions; neither is substituted
for this domain boundary.
Setup errors become `OwnerUnavailable`; contract/unknown-schema errors
become `InvalidContract`, and correlation errors become `CorrelationMismatch`.
Owner diagnostic strings do not cross this port. Authority witnesses, approval,
presence admission, storage and dispatch remain separate owner responsibilities.

Current published combined PR18 source is
`49d4a0a84baf05b3e16b5bd31833ebd0786c6d4c`, tree
`eb886fd1ddc4adfe5065f4308f56933796b70142`. Its corrected stock base
`ece8f43fc726dc90857b316e7379e809b774853b` and predecessor
`d3bdb7ccacb94a83d7409b70dbc30a4a3204395f` remain historical pins.
The response-error classification correction passed independent ordinary
review at `ece8f43`. The combined owner commit adds only the exact accepted
PR17 public function block while retaining stock's private semantic imports.
The previous external candidate remains historical evidence. This lane edits
no contracts files; the root dependency and allowlist updates remain
integrator-owned. Native schema/catalogue review does not qualify executed
operations, current authority, freshness or durable atomic presence-witness
admission.

The combined owner above is independently accepted within ordinary scope.
The current compiler harness imports that exact published tree directly and
passes check, warning-strict Clippy and build without peer edits. All 76
captured contract/resource/package files match the previously tested union,
and current owned Rust matches the actual stock/clock healthy proof; those
runtime positives are retained without repetition. See `../README.md` for
exact current manifest, comparison and compiler proof pins. The historical
reconciliation dependency is closed; runtime duties remain as described above.

`examples/healthy.rs` is an isolated synthetic consumer using this native
offline draft2020-12 validator against the exact stock/Atlas schemas. Its earlier
Python-validator proof remains historical evidence for the captured old source.
Graph/authority/query/command peers are explicitly synthetic. Its actual
healthy scope is one Atlas create, one Atlas read, a two-child ordered Atlas
batch, one HomeBox zero-quantity preparation, one collection maintenance query
with a targeted row, and one print-disabled label render with a bounded artifact.
No provider call or durable storage is exercised; no held replay, denial,
guard, mutation-control, adversarial, expiry, revocation, crash, failure or
concurrency qualification is claimed.

Historical synthetic compiler harness pins: serde1.0.228, serde_json1.0.145,
time0.3.44 (`parsing`), serde_jcs0.1.0 (scalar ECMAScript float formatting only),
sha2 0.10.9. These describe the earlier synthetic checkpoint. See
`../README.md` for the exact scoped-command compiler peer/manifest pins.
Root dependencies, locks and generated contracts remain AT51-owned.

## Delivered native owner bindings

`NativeAtlasCommands::from_store(store, authorization, stock_contracts)` binds
AT07 `d5161c6f86217cddb57113f952576d7f33fa1381`'s actual atomic stock
executor. It preserves the prepared raw request and original principal and returns
the durable stock commit's owner result. `NativeStockReads::from_store(store,
native_contracts, authorization)` supplies `StockHistoryPort` through AT07's
actual authorized paging/search API; `AtlasReads` preserves that owner envelope.
No current record or frozen bare audit is used to infer original stock intent.

`NativeStockAuthority` uses actual AT11 original principal/grant revalidation
and a required `GraphAuthorization` for full original-witness/graph/output
checks. Its sealed `CapturedAccess` is initial-only, and its mutation context
borrows the actual transaction guard. `dispatch_prepared` retains this same
immutable prepared request across native callbacks and outer stock release.
Full `StockAuthorityPort` capture/disclosure and complete graph facts remain
host inputs; there is no default authority or production endpoint here.

Retained native entries and complete batch child envelopes use the native
owner's canonical JSON policy. Numeric spellings such as `1` and `1.0` retain
their original carriers and intent digests while comparing equivalently; every
field and array position still participates. Current prepared-request/plan
identity and stored root/child provenance checks remain exact.
`examples/canonical_numbers_healthy.rs` supplies ordinary valid single/batch
evidence-create inputs with those numeric spellings. This follow-up compiles
the example only; it runs no storage, authority, replay or control probe.

Frozen record reads still invoke the native store's A, while stock history and
commands invoke borrowed B. A mutex-backed A cannot be reentered from B's held
access fence. AT07's later supplied checkpoint
`a0e23b5bbb477e45ab4651f2bf73cf3842f7fbc6` provides durable queue storage and
native database schema 3. Atomic presence admission, actual authority/provider
bindings and complete recovery remain host integration duties; provider
dispatch remains held. See `../README.md` for the earlier pins and fresh
storage example; older compiler/runtime intervals above retain their original
scope and are not proof of these new bindings.

The service successor adds all ten Atlas list query forms, a shared closed
direct-write mapping helper, specialized pure derivation mapping and a wire3
download owner over existing managed Media delivery. See `atlas_lists.md` and
`service_integration.md` for exact interfaces, owner dependencies and root
adoption. Specialized derivation remains data until Storage's same-transaction
qualification and immutable retention are implemented.
