# HouseAtlas

Explicit source-free Answer admission is structural only. Its serialize-only
QuestionBinding pins the admitted request ID, accepted-query SHA-256,
registration and cancellation epoch with existing actor/scope/authority epoch.
It has no trusted host/session binding: a supplied digest or current clone is
not authentication, active-request proof or cancellation qualification.
Generated schema v2 requires subjectRef:null (not missing), empty sources/
claims/ranks/statements, clarify|unknown, no-answer and bounded explicit gaps.
Record v1 string subjects, source admission and pin bytes remain unchanged.
Display DTO v1 emits empty sources/inspections/selections/rankings, retaining
the shared final byte fence; no subject metadata/capability is invented.
Six new Rust and two session controls are authored/NOT RUN: shape/versions,
escaped final-DTO bounds, admission/content refusal, question/epoch replacement,
record compatibility, terminal usage/refusals and consumer retirement. Current
counts are 35 synthetic-contract / 10 scorer / 26 retained / one counter Rust
cases, plus 41 presentation/controller and 22 session cases. The 5/20/7 corpus
ledger, originals, runner selections and host/root/runtime/authority owners stay
unchanged. No inference, source write, effect, persistence or activation occurs.

Inventory review additionally supports `SameProductIdentityUnknown`, serialized
and locally disclosed as `same-product-identity-unknown`: positive product
correspondence with physical same/distinct identity unknown. Existing three
relationship meanings, cited-source validation, selection binding and
once-consumed authority:none review intents remain unchanged. Source preparation
must compose the exact reviewed #569 presentation donor before publication;
the frontend writer retains its six review/controller files. Three new shared
controls (canonical/disclosure, independent supplied scorer and session binding)
are authored/unrun. Shared Rust counts are 35 synthetic-contract and 10 scorer
tests; retained tests/ledger stay 26 and 5 scorer subsets/20 structural/7 unbridged.
Original inv-model-only stays unbridged: its Document subject cannot be silently
relabelled as an InventoryItem. No inference, physical verification, approval,
native resolution, runtime activation or new runner/workflow is introduced.
The composed presentation donor is exactly
`474fb67c6a963b9c0971a4cb564ab5004c47d98e`, descended from e5281bd9; its five
changed owned paths are retained verbatim and CSS is unchanged. Two authored
presentation cases plus the shared session case bring existing frontend
selections to 41 controller/source and 20 session cases, all NOT RUN. The
77 source / 1 build / 7 browser selection inventory and workflows are unchanged.

Original maint-duplicate has one additional supplied existing-task review
control in `ai::suggestions::evaluation::retained_corpus`:
`retained_maintenance_existing_task_review_keeps_task_binding_and_unknown_completion`.
It preserves task-a/item-a/manual v1 input evidence/dates, manual subject,
MaintenanceTask candidate and supporting item source; exact task/index selection
stays bound to task-a. Completion, interval and baseline remain unknown. Its
generated native targets are DATA only; no task is created or deduplicated,
service completion inferred, authority issued or quality score calculated.
One new test brings the retained bridge to 26 authored/unrun cases; all 25 prior
tests/adapters, original corpus files and production/frontend code are unchanged.
The complete ledger is five scorer subsets, twenty structural controls and
seven unbridged originals. No runner/workflow or local execution is added.

The review-only AI module also exports `disclose_completed`, a pure adapter from
the original `InferenceOutcome` to existing canonical validation/disclosure.
It accepts one completed assistant JSON text payload (with bounded reasoning
metadata), rejects refusal/tool/ambiguous/noncompleted output, retains observed
usage including unknowns, and preserves current-context and inspection fences.
Original outcomes, diagnostics and journals remain with their owner. It does
not bind a runtime, credential, route, dispatcher, approval or persistence.
Five generated `ai::suggestions::synthetic_contracts::completed_proposal_*`
cases are authored in the existing default-library selection and NOT RUN.
They cover inventory/document projection, refusal/tools, all noncompleted
states, usage, context/original inspection and malformed/bounded envelopes.
Existing 25 retained-corpus tests, originals and coverage ledger are unchanged.
No local compilation, tests, formatting or Clippy qualification was performed.

Completion-envelope sizing uses `serde_json::to_writer` with a private counting
Write sink: exact compact JSON bytes are limited to 1 MiB without allocating a
complete serialized copy. An oversized write is refused before accounting it.
The admitted Value and fixture data still exist; this is bounded intermediate
serialization, not a claim of constant total memory or a security incident.
Three additional authored/unrun controls cover exact/over envelope size,
UTF-8/escaping and original completed_event-to-review composition with known/
unknown usage and refusal/tool withholding. Two join synthetic_contracts; one
is `ai::suggestions::completion::tests::bounded_json_counter_counts_utf8_and_escaping_without_retaining_bytes`.
There are now 28 synthetic_contracts tests and this one private counter test;
all eight completion-related tests remain NOT RUN. Existing retained corpus,
frontend, runner/workflows and runtime/authority boundaries are unchanged.

HouseAtlas owns physical identities, reviewed cross-system bindings, optional
geometry, circuits, valves and provenance. HomeBox owns inventory, locations,
attachments and maintenance; its fields are read-only projections here and
edits use verified native links. Network is a separate passive GET source.
Browsing never sends collector demand, diagnostics, imports or upstream writes.

Preserve arbitrary container types, explicit unknowns, original source dates,
retrieval dates, uncertainty and corrections. Names, graph positions and tree
depth do not establish physical placement. Floorplans are optional; Magicplan
is the optional geometry input after sample review. No smart-home dependency
or actual household configuration is included.

Use one writer per checkout and coordinate shared contracts/router/migrations
with their maintainers. This standalone snapshot has its own future history.
Private development repositories, active worktrees, approval records and the
origin mapping belong outside this repository. Never fetch or merge that private
ancestry into publication history. Follow docs/coordination/worker-handoff.md.

G0 concerns isolated code work. G1 specifies target/service/route and rollback;
G2 specifies credential/account/grant/source; G3 specifies the reconciled private
write set after recovery; G4 specifies a limited pilot; G5 specifies promotion
after actual user acceptance and operational handoff. This repository releases
none of these gates. Secrets, real media, inventories, accounts, host settings
and recovery/evidence packets remain outside Git.

Inspect script bodies before running them. README.md and its linked
[complete verification guide](docs/contributing/verification.md) list the
ordinary verification commands. Healthy mutations are scoped synthetic examples.

Rules for every test, locally or in CI: isolated disposable synthetic
environments, fake or local-only transports, and no real credentials, live
providers, user data, populated production restore or deployment. Running a
test releases no G1–G5 and grants no new secrets or network permissions.
Report the exact source and scope of the checks you ran; ordinary success does
not certify security or deployment.

Suggestion, not a rule (owner, 25 October 2026): concurrency, denial,
failure-injection, guard-reversal, mutation/omission-control, adversarial,
private-intake, replay, expiry, revocation and crash cases may stay in the
separate regression lane described in the verification guide when they are
slow, noisy or need special setup. Keep a test out of default runs with
`#[ignore]` or by leaving it off an explicit runner list. Ordinary in-process
unit tests with such names can run with everything else. Prefer explicit lists
to globbing so CI scope stays readable.

Ordinary CI (`ordinary-core.yml` and `rust-react-ordinary.yml`) runs on pushes
to `main` and on every pull request, including stacked PRs whose base is another
branch.
`.github/workflows/ordinary-core.yml` also runs the 14
synthetic `tools/homebox-quantity-seed-report` unit tests and the synthetic
`tools/deploy-nas` and `tools/backup` tests (temp folders, a fake service and
a fake iCloud helper; no launchd, network or real data) with the runner's
`python3` (stdlib only). The same job runs the eight existing generated
`tools/electrical_registration/healthy.test.mjs` cases with pinned Node 26.10.0:
known/approximate affine fits, property-wide inventory, documentary-only intake,
reviewed withdrawal, revision reconciliation, stale current identities and
source-uncertainty hull coverage (including malformed explicit row tolerances).
The existing documentary-only top-level case also contains exactly four
generated electrical-data subtests for #554: canonical panel/circuit/evidence
joins and report/label/test distinction; unknown/stale/ambiguous/conflicting
withholding; same-circuit contradictory tests across group/fixture overlap in
both row orders; and exact scope/review/test coverage. They use the read schema,
pure projector and generated fixture in `contracts/electrical-data/README.md`,
with already pinned contracts Ajv. Original registration assertions and the
eight-case command remain; no workflow, provider, native write or UI is added.
The tested-state fixture is invented, never installed wiring evidence.
These pure in-memory cases create no receipt, native authority or physical
placement.
The ordinary-core job also runs the sixteen explicit cases in
`tools/perf/runtime-profile/test_runtime_profile.py` with the runner's Python
>=3.11 (stdlib only). They use generated profiles, disposable folders and owned
synthetic child processes to check configuration refusal, sample decoding,
receipts, deadlines and process-group cleanup. Fake build/profiler commands
exercise cleanup only; no Cargo build, real profiler, network workload or
runtime performance collection runs. These checks establish no profiling
availability or benchmark result.

Owner-approved finite bridge-read CI exception (28 October 2026): the existing
ordinary-core job invokes exactly `healthy_large_read_page`,
`denial_read_profile_bounds` and `denial_read_correlation` in
`tools/houseatlas-mcp-bridge/test_bridge.py`. They use fake GET/session/admission
owners and disposable synthetic journal state, with no socket, browser, native
service, provider, credentials or write invocation. This exception adds no other
bridge case, regression discovery, runner/workflow, live operation or access.
Other held controls remain excluded. Exact commands and limits are in the
verification guide; hosted logs, not registration, establish execution.

In `.github/workflows/rust-react-ordinary.yml` that includes
the named Lantern healthy read;
the existing unified Atlas healthy case also checks explicit publication-pinned
display groups, admitted-read metadata precedence/null/no-fallback behavior,
same-source policy key changes through the actual easing initializer/step and
finite section conversion/settlement (no mounted hook or RAF/browser test),
plus bounded protected display-policy responses with exact context/digest/revision,
refusal and selection retirement; the existing cache healthy case checks policy-only
replacement/removal, cold retention and actor separation without a browser,
unchanged geometry/containment, both members' CPU room picks,
union framing, retained per-part cuts through transition starts/ends and reversals,
connecting-structure association,
single-plan switching and actual Floor Stack server markup. Its small generated
policy checks also refuse overlapping groups and cross-building display joins;
no new runner, browser lane or native authority is added; the four generated
Electrical Library selections `healthy`, `reentrant-retirement`,
`pdf-unavailable-metadata` and `dialog-focus-restoration` (existing production
reader/projection, fictional original bytes and fake owners; the focus helper
uses fictional focus objects, with no React/DOM mount, PDF UI or native access).
They cover newer-read retirement, unavailable-PDF metadata without open authority,
and guarded opener restoration without changing the existing healthy case;
`frontend/lantern-tests/run-healthy.mjs` with
its explicit list, including the `offline-launch`, `hung-network` and
`live-launch` cases in the pinned Chrome for Testing build against the built public shell
(generated build output on a loopback listener, no backend; live-launch also
seeds a generated Atlas and waiting outbox entry through production storage APIs,
closes and reopens the tab, and checks cached content, exact queue retention and
no write dispatch), and fake-child/temporary-directory shutdown and bounded
profile-cleanup and combined-failure diagnostic checks inside the existing offline-root-entry healthy case
(no browser or real child launch), the generated CPU
mesh-preparation equivalence check, the `webgl2` case of
`mesh-layer-browser.mjs`, which draws generated meshes through MeshLayer in the
runner's software GPU and swaps in a second mesh set without a blank frame,
including generated mapped-glass samples and differently tinted/frosted panes
under reversed primitive submission order and opposite camera views,
plus a closed omni bulb with nearby nonemissive metal and receivers at 6 m
and at/beyond its finite 10 m envelope, and the `?render-probe` speed check
(all five cases reported, drawing resumes; software-GPU timings are not device evidence),
`unified-atlas-plan-wheel-browser.mjs`, which pans and pinch-zooms the generated
unified Atlas Plan with trusted wheel input in the pinned Chrome for Testing build, and the generated Unified Atlas compact layer-details
and control-names checks (compiled source and markup only, no browser), the
generated time-of-day lighting check (sun positions for a neutral reference
place and appearance tables only, including glass-pass opacity/frost and
selected-pane precedence, no browser or GPU), the generated Unified Atlas
CPU room-picking cases through transparent glass and behind opaque or
highlighted solid panes (no browser or GPU), the generated
embedded-PNG `four-maps-1024` case (four 1024 px maps admitted and accounted
under the tier budget, and refused with stated MiB under a reduced GPU budget;
no browser or GPU), the
generated WebMCP batch-discovery descriptor check (schema bytes only), the
synthetic WebMCP adapter bootstrap (current `index.ts` bundled with Vite, no
browser or service, including five in-process disposal, session-replacement and
partial-registration lifecycle cases with controlled synthetic promises, plus
three quantity-custody cases through a companion bundle of the actual quantity
mount with fake preview/handoff ports and no approval or submission, and three
completed-custody cases through the actual QuantityHandoffs class with synthetic
client promises, controlled deadlines, closure/reuse and retained pending-owner
uncertainty, plus two actual-owner cancellation-window cases covering completed
invocation/session abort cleanup and repeated busy-result listener retirement,
without a React/browser mount or native/provider effect), and
the generated offline outbox check (synthetic IndexedDB and a generated
server, no browser or network), the generated Unified Atlas overlay feed check
(compiled feed, stored-overlay codec and Atlas cache against a counting fake
source owner and synthetic IndexedDB, no browser or real source), and the
generated backup settings check (decoding and the CSRF save exchange against
a generated transport, no browser or network); the `tools/model-bake` tests on generated
geometry, including overview texture halving, viewer admission and selector binding of a baked generated
unified Atlas publication and its detail tier, and their meshopt compression
expanded by the viewer's decoder; and
`cargo test --locked -p houseatlas-backend --lib` with its default
(non-`#[ignore]`) set, including the three pure synthetic display-policy
contract/options tests (no native service or private files), skipping the three quantity tests that need
`HOUSEATLAS_QUANTITY_REFERENCE_DIR`; and the healthy `tools/rust-integration`
loopback flows (including pure fake-child/clock CDP startup/framing/error cases
inside the already admitted media flow; one 60 s startup request, unchanged
15 s subsequent calls and close-aware owned-child cleanup) named in the workflow and in the verification guide. A PR that
extends CI names the added scope here and in the verification guide.
The frontend healthy list also runs `unified-atlas-network-trace-healthy.mjs`
(#552): the pure network route search over generated topologies, with no DOM,
browser, native host or source reads. The same list runs
`unified-atlas-electrical-group-healthy.mjs`: generated documentary membership,
room and unplaced projections, source separation and incomplete membership; no
browser, provider, native authority or wiring assertion.

The default backend-library set also executes exactly
`http::providers::homebox_stock_healthy::healthy_cached_homebox_stock_and_mcp_reads`,
calling the existing cached HomeBox example body. Actual synthetic Access/source
registrations and reopened SQLite feed native StockService and borrowed in-process
MCP entity/location get/list reads, with full wire parity and unchanged snapshots.
Each list is one resource with pageSize 100 and null cursors; fixture collection
IDs are rebound to UUIDs. This adds no listener, provider call, refresh, continuation,
search/archive, mediated history, opaque-ID compatibility or installed acceptance.
Private disposable files and the standalone example entry point are preserved;
no workflow command or held selection is added.

The default-library lane additionally selects exactly
`transports::mcp::healthy_local_atlas::remap_hold::native_remap_hold_preserves_store_and_permitted_batch`.
Real synthetic Editor Access and StockService refuse remap singles and mixed
batches (both child orders) with null or supplied-but-unproven receipt UUIDs.
Actual MCP discovery/refusal and complete read-only equality of ten owned
record/reservation/audit/receipt tables are checked after each attempt, followed
by strict store reopen with retained Access and a permitted direct/derived batch.
This is a native remap hold regression, not an approval issuer or remap success.
The existing Linux `healthy-agent-stock` helper now expects the root remap hold
and creates an ordinary binding for its independent lower-level seven-child
Store fixture; that fixture's injected authorization is not human approval or
root admission. No new command, listener, provider, browser, grant or installed
acceptance is added; other held selections remain separate.

The default-library lane additionally selects exactly
`http::agents::asset_download_healthy::healthy_mounted_mcp_asset_download_redeems_original`.
A disposable actual Host authenticates its generated Editor and current CSRF,
stages one short UTF-8 text original through the real multipart upload owner,
then initializes mounted MCP on that same Host. Native StockService/Media/Store
issue the opaque `atlas.asset.download` handle; authenticated router redemption
must return the measured original hash, size, type, attachment headers and exact
bytes. Canonical request/result correlation, structured/text parity, actual
admitted input schema and equal public asset get records before/after redemption
are checked. Private disposable files, default read-only MCP admission and the
existing test selection are retained. This is one positive same-Host lifetime,
without sockets, TLS, provider calls, browser, expiry/revocation, second-process
restart, renderer or installed acceptance; no workflow command is added.

The default-library lane additionally selects exactly
`http::providers::homebox_stock_history_healthy::healthy_native_prepared_homebox_history_cuts_and_reopen`.
A fresh profile-6 Core/Store bootstraps only a synthetic source/cache epoch.
Genuine Editor/source/partition Access grants reserve three entity-quantity and
three location-update intents under explicit SyntheticFixture activity
registration. Admission remains unavailable and its call count must stay zero;
no approval, provider observation, dispatch or completion is fabricated.
Actual Viewer `bind_read`/StockService/HistoryPeer reads equal the shared native
dispatch result, with canonical wire/schema/text parity. Owner-issued pageSize-1
cursors preserve the two-reservation cut after a third reservation is added;
fresh complete chains retain reservation order, exact event/command/actor/intent
digest/timestamp, prepared state and atlas-mediated-only coverage/completeness.
Strict `Store::open_existing` in profile 6 retains Access, saved cuts and fresh
chains; fixed activity/record/source table content stays equal while cursor DATA
may persist. includeArchived is query data, not resource-archive qualification.
No profile-5 upgrade, Access/process/session restart, recovered producer/admission
authority, provider/quantity execution, recovery, installed or browser acceptance
is proved. This adds one in-process case to the existing selection, with no new
workflow command, runner or held execution selection.

The existing default-library case
`http::providers::homebox_native_healthy::healthy_native_homebox_root_reads_preserve_original_authority`
additionally checks five unmounted MCP calls for entity tags, field get/list and
maintenance get/list. A test-only ServicePort only delegates to the existing
`homebox_native::execute_with_reader` owner through its blocking handoff.
Actual NativePrincipalPort/NativeCatalog and genuine Viewer/source/partition
Access checks remain in use; the GET peer and clock are explicitly injected
public fixtures, with original native bytes and no socket. Five original native
GET assertions stay intact, then five MCP GETs check complete native/structured/
text wire parity, the maximum safe integer field, exact cost strings, empty-date
to null preservation, unresolved/observation-only status and unchanged authorized
Store snapshots. Lists are one terminal pageSize-100 fixture page (one field,
two maintenance rows); no search/archive or continuation claim follows.
This is an explicit synthetic admission profile, not the mounted McpStockContext,
configured NativeHomeBoxReadBinding HTTPS/credential-custody path or its
NativeListPages successor. The existing pre-read Store close/open remains;
post-read reopen, Access/process/session restart, provider/installed/browser
acceptance and new production grants/hooks are not proved. No test name,
workflow command, runner or held execution selection is added.

The same default-library set includes the eleven merged #288 M20–M30 cases,
with exact names and execution pins in the
[operation ledger](docs/rust-integration/mcp-operation-qualification-v4.md#evidence-identity-and-method).
Their source is [healthy_local_atlas.rs](backend/src/transports/mcp/healthy_local_atlas.rs)
and its test-only children `healthy_identity.rs`, `healthy_evidence_lifecycle.rs`,
`healthy_infrastructure.rs`, `healthy_places_relations.rs`,
`healthy_bindings_reconciliation.rs` and `healthy_media_metadata.rs` in that directory.
They use actual synthetic Access/StockService/disposable SQLite for bounded
evidence, identity, valve/circuit, proposed location-semantics, documented-relation,
unresolved binding/correction-journal and geometry/missing-asset metadata variants.
Applicable unknown/null/Unicode fields, guarded lifecycle results, filtered native
cursor lists, ordered audit/intent/digest history and strict store reopen are
checked with retained Access. Asset lists are singleton/empty, and seeded asset
history has no create prehistory; only actual later events anchor to its real seed.
These are not arbitrary payload/guard/profile qualification, process/session
restart or crash durability, source adoption/remap, available bytes/transfer,
renderer/accepted placement, installed provider or WebMCP/device acceptance.
This documents existing execution and changes no command or held selection.


The same default-library selection includes
`http::agents::asset_download_healthy::healthy_contextual_five_format_native_post_receipt_original_readback`.
One disposable same-Host fixture creates a native place through an actual stock
HTTP batch, then obtains fresh native place admission and submits exactly five
contextual multipart intents: the existing generated JPEG, progressive JPEG,
PNG, PDF and UTF-8 text files. Real Access/Store/Media owners commit the linked
asset, evidence and selected identity. Actual retained root/child journal
envelopes, current record GETs, opaque picker provenance, unknown fact time,
server intake time, authenticated original GET byte/hash equality and empty
HEAD bodies are checked. The same case then closes Store, releases every first
Core/Store/Access/vault owner with weak-reference witnesses, and reopens the
same canonical files through strict existing-owner APIs with default options.
A fresh Core/Host has empty process-local caches and ordinary generated-Editor
login. Fresh admission/current records, final identity linkage, historical
receipts and all five original GET/HEAD results must remain equal, with no
additional durable operation. Expected observations confer no authority.
No provider, socket, TLS, browser, private input or production hook is added.
This is clean owner close/reopen within one process, not process restart,
crash durability, installed startup/recovery, old-session invalidation,
renderer-authority restoration, opaque-handle continuity, target resource or
physical-device acceptance; exact named hosted logs establish execution.

The default-library lane also retains #533's three existing cases in
`backend/src/transports/mcp/lifecycle/synthetic_contracts.rs`, under
`transports::mcp::lifecycle::synthetic_contracts::`:
`absolute_expiry_at_dispatch_rejects_original_credentials_without_owner_work`,
`absolute_expiry_withholds_completed_read_and_fresh_login_cannot_rebind` and
`http_rotation_rejects_old_cookie_and_session_before_fresh_initialization`.
The expiry cases use controlled generated Access/MCP clock and owner-Gate seams
for dispatch/disclosure and old-session non-rebinding. The rotation case uses
actual in-process middleware/router/rotation and registry to refuse old
cookie/session before fresh initialization. These already executed cases use no
listener, TLS, browser, provider or private installed state and establish no
installed-authority acceptance. No #289 source or execution selection changes.

The frontend and loopback jobs of `rust-react-ordinary.yml` run their browser
checks in one exact Chrome for Testing build, not the runner image's Chrome: the
shared setup action downloads it, verifies its recorded SHA-256 and reported
version, and exports `HOUSEATLAS_CHROMIUM`. The browser flows' native-input
allowlists accept only inspected versions, so bump the pinned version and
checksum only after inspecting the new build and adding it to those allowlists.

`tools/ci/lanes.json` and the generated command inventory in the verification
guide are the authoritative list of `run:` steps in `ordinary-core.yml`,
`rust-react-ordinary.yml` and their composite actions under `.github/actions/`.
The ordinary-core job runs `python3 -B -I tools/ci/check_lanes.py --check`
(Python standard library only; reads repository files, no subprocess or network)
to compare that manifest with those files: triggers, workflow and job env, job
runner, condition, matrix and needs, each run step's command, condition, id,
env and options such as `continue-on-error`, and the run steps' order within each
job, plus recorded case counts, prose claims, toolchain pins and the generated
table. A run step that reads `steps.<id>` before an earlier step has that id is
refused. It refuses workflow, job and run-step
keys it does not read. `uses:` steps and their inputs, permissions, concurrency,
job outputs, job timeouts and `fail-fast` are not compared. Its synthetic cases
run in the existing `tools/ci` discover step. Every new or changed run step, step
env or step option needs a matching manifest row; the check fails otherwise. It
runs none of the listed commands.

The existing Lantern `healthy-read.mjs` check also compares the generated client
schema resources with their pinned full authority, checks scope/file v3/v4
validation and rejection parity, and exercises synthetic recursive references,
anchors, nested IDs and missing-resource refusal in process. It adds no runner,
browser, service, network or credential use. Vite refuses stale generated bytes;
the artifact-generation command is implementation, not runtime qualification.

The same frontend runner selects the capture selection case
`selection-cancel-reselect`, the foreground case `stale-target-preparation`,
five generated capture-original cases: `one-shot-originals`,
`original-offer-reused`, `original-offer-digest-mismatch`,
`original-offer-record-change` and `original-offer-unavailable`; and five
fake-port draft cases: `healthy-save-review-commit`,
`existing-original-receipt-commit`, `receipt-record-closure-keeps-original`,
`cleanup-failure-known-commit` and `reused-receipt-object-keeps-unknown`.
The finite failure cases cover original-offer identity and per-attempt receipt
cleanup only, with generated originals, in-memory stores/exchanges and a fetch
trap in the draft harness. They add no listener, native service or browser.
Other capture/draft cases and the full controller regression suite remain
separately selected; exact commands and limits are in the verification guide.

The existing ordinary-core job separately invokes exactly the six existing
assertions in `frontend/capture-drafts-tests/indexeddb-durability.regression.test.mjs`
with pinned Node 26.10.0 and `--test-concurrency=1`. They call the production
draft store through a controlled IDB interface with generated in-memory rows,
checking strict write options/reporting, completion ordering, unsupported
capability refusal without fallback, read-only access, abort/setup failure and
late-event handling. They use no browser, real IndexedDB, native service,
network, credential or user draft. Passing these interface checks establishes
no actual flush, crash/power-loss survival, retention or device compatibility.
Other draft files and cases are not selected by this addition.

The existing ordinary-core lightweight job also runs exactly
`tools/perf/host-client/options.test.mjs` and
`tools/perf/host-client/compare.test.mjs` with pinned Node 26.10.0 and
`--test-concurrency=1`. These nine stdlib-only cases check explicit selection and
resource limits, sample-qualified summaries, complete measurement-driver source
fingerprints over generated temporary files, mismatched runner/adapter/driver/
load rejection, unqualified errored/saturated comparisons, pacing alignment with
a synthetic clock, MCP editor/CSRF exchanges through fake ports, and a bounded
Node comparison subprocess from generated paths containing spaces. They launch no
Rust host, Vite build, TLS listener, browser, request generator, fault cohort,
profiler or performance measurement. The opt-in host-client contract, faults and
release-measurement commands remain outside ordinary CI.

The existing ordinary-core job also runs the explicit
`tools/cargo-modes/run.test.mjs` file with pinned Node and
`--test-concurrency=1`. It copies the actual wrapper and toolchain pin into
disposable synthetic checkouts and uses a recording rustup stub to check mode
mapping, argument forwarding, workspace selection and override rejection before
child invocation. These process-routing checks run no Cargo compiler, actual
Rust tool, profiler, network workload or installation. Real mise discovery and
pinned Cargo parser observations remain separate evidence.

The existing ordinary-core job also runs exactly
`tools/publication/refresh-manifest.test.mjs` with pinned Node 26.10.0 and
`--test-concurrency=1`. Its twelve cases build tiny generated trees and
manifests in disposable temporary folders and run the actual
`tools/publication/refresh-manifest.mjs` against them with `--root`; one case
checks the output with a temporary copy of the publication verifier. They open
no network connection, write only those temporary folders and neither read nor
write the repository manifest, which `verify:publication` alone checks.

The separately authorized Synthetic README media workflow captures only
checked-in generated fixtures through the actual React renderer and fake read
transports on an owned loopback server. Its scoped PR/main triggers and manual
dispatch upload ephemeral review artifacts with read-only repository permissions;
they add no ordinary check scope, persistent access, household intake, native
qualification or deployment. Generated media requires inspection before any
coordinated commit; the workflow never commits it automatically.

The existing generated `canonical-mesh-preparation.test.mjs` selection also
checks the actual opt-in scene-build observation helper with a fake clock and
renderer: phase/wait attribution, original promise/result/error preservation,
unknown unsupported/pre-hook counters and exact owned-hook restoration. A
fictional-element source contract calls the actual report builder to check
viewport bounds, scrollable text and a separate Copy/Close row; it establishes
no computed layout or device result. These contracts compile no shader, draw
no frame and add no test selection or workflow. The same CPU file exercises the
production frame-yield helper with controlled RAF/message-task/visibility owners
for normal, hidden and aborted cleanup, without a browser or shader. The existing
`?render-probe` report may include observational build/first-render-call phases;
these are not GPU completion, witnessed paint or a phone performance result.
The build observation ends at shell readiness; later staged preparation has
separate timing and does not retroactively populate unobserved build phases.

web/AGENTS.md governs interface text. Preserve accessible names, scope,
uncertainty, freshness, access and file availability. Use short functional
headings and guidance only when needed for the current action or state.

Scoped development PRs target main; there is no separate dev branch. Use one
integration writer and preserve donor ancestry. Resolve overlaps against the
current owner APIs, track review findings, and run only inspected authorized
checks. Composition does not accept donors or release product or deployment
gates; main still requires exact candidate review and CI.

PR lane selection is documented in [the CI dependency matrix](docs/contributing/ci-path-selection.md).
Main pushes retain the full ordinary suite. PRs always retain ordinary-core and
publication checks; recognized presentation/backend paths select explicit lanes,
with full coverage for shared or unknown changes. The ordinary-core job also runs
stdlib selector regressions using disposable synthetic Git histories and the
`tools/ci/check_lanes.py` cases over temporary folders.

When a pull request is authorized to merge, enable auto-merge
so GitHub merges it after the required checks pass.
Investigate failed or missing checks instead of bypassing the ruleset.

The existing default backend-library job also discovers the generated
`ai::host::startup::stock::stock_read_contract` case. It uses actual local
Core/Access/enrollment/stock execution and the request journal with test-only
connection/inference peers, one native fixture-setup circuit commit and one AI
tool read. No listener, provider, credential lease, key, review approval or live
runtime is used. No workflow or runner is added; the verification guide records
the exact case and evidence limits.

The existing ordinary-core job also runs the explicit stdlib-only
`tools/model-input-disposition/test_disposition.py` suite. Generated in-memory
claims exercise bounded strict parsing, exact original/release identities,
replay/conflict reconciliation, incomplete persistence and independent evidence
summaries. No filesystem payload operation, network, consumer, receipt emission,
service, credential or operational adoption occurs. Hosted logs establish test
outcomes; validated claims establish no authority or custody.

The existing default backend-library selection also discovers the ten generated
`ai::suggestions::synthetic_contracts` cases listed in the verification guide.
They check closed review-only proposal decoding, canonical target/input pins,
bounded evidence/candidate references, current-context refusal and deterministic
finding keys. Inputs and claims are fictional; no native owner, Access issuer,
provider, model, credential, browser, device, socket or write port runs. These
are structural validation cases, not classification/groundedness accuracy or
live authorization qualification. No workflow or runner command is added.

The same default backend-library module additionally contains eleven generated
disclosure projection tests. They join validated review data to the inventory/
document/maintenance/cited-answer/comparison display DTO and check exact evidence/contrary claims, source revision
rechecks, owner-supplied inspection labels and non-authoritative selection keys.
No route, original-open capability, approval or native dispatch is issued.
The review-only browser adapter consumes this DTO with the retained #569
controller and an explicit owner-supplied React mount. The existing healthy
runner's SOURCE list selects exactly `ai-suggestion-review.test.mjs` (forty-one
controller cases) and `ai-suggestion-adapter.test.mjs` (twenty-two adapter cases).
They use generated data and the actual controller, without browser, provider,
credentials or native writes. Registration is not execution evidence. No
app-root, workflow, browser selection or other held selection changes.

The default backend-library set additionally discovers nine generated
`ai::suggestions::evaluation::healthy` scorer controls. They call the existing
proposal validator over deliberately supplied fictional outputs, with source-pin
and cited annotation checks. Classification, duplicate relationships, document
association, abstention/unknown and validator acceptance/refusal remain separate
integer counts; refused output is unscored, not a correct abstention. These are
scorer controls, not a model benchmark or the separate unpublished corpus. No
model, calibrated probability, fitted threshold, runtime/host port, provider,
credential, browser or native write is involved. Execution is not inferred from
test registration; see the verification guide for exact scope and limitations.

The same ordinary-core job also runs the 75 generated methods in
`tools/model-input-disposition/test_storage_adapter.py` against injected fake
clock, registry, resolver, ledger, readback and conditional-dispatch ports.
The separately versioned prospective protocol preserves pure v1 unchanged.
These in-memory checks perform no actual custody operation, installation,
transport, credential access or operational adoption; the existing storage owner
must separately qualify the concrete route, clock continuity and fence semantics.

The same ordinary-core job also runs the 57 disposable methods in
`tools/model-input-disposition/test_storage_owner_ports.py`. Generated temporary
directories and owned isolated Python children check supplied descriptors,
streaming pins, explicit present-only permits, prospective journal completeness,
bounded reader/fsync/close behavior and v3 process-local admission. All filesystem
writes and permission fixtures are confined to those disposable roots. No private
input, NAS contact, transport, installer, credential, mutation dispatch or settled
effect is exercised. Same-host subprocess readback is not another storage failure
domain; source/CI success does not establish operational adoption.


The default backend-library selection also discovers thirteen generated
`lifecycle::continuity_plan::healthy` cases. These validate observation DATA and
an in-memory offline journal model only: historical/current cuts, every SQLite
sidecar/absence, original receipt type, lock/staged-file identities, ordered
preservation/publication records, permanent uncertainty and conservative metadata
rollback candidates. They open no file, database, socket, lock or service and
perform no restore, fsync, rename, receipt publication or startup reconciliation.
The existing guard is unchanged. Plan success grants no authority and cannot
authenticate a baseline or prove native exclusion/durability. Source registration
does not establish execution; the verification guide records remaining bindings.


The retained generated AI corpus is now published unchanged in
`tools/ai-feature-evaluation/`: 32 fictional cases and 20 exact source versions.
Its standalone README and HISTORICAL-CHECKS.txt describe the November 8 artifact;
the historical 18-test Python integrity success is not current-head execution.
The Python mutation suite is not added to a default runner. See INTEGRATION.md
for original hashes, exact mappings and exclusions.
The existing default backend-library selection discovers twenty-five
`ai::suggestions::evaluation::retained_corpus` cases: frozen corpus/mapping
limits; separate supplied inventory classification/identity counters;
alternative document links with changed/withdrawn context refusal; and exact
original inv-stale, inv-revoked and doc-revoked structural context-refusal cases.
The latter split observed/current versions or project disclosure_revoked into
current Withdrawn DATA; this is not real Access revocation. All semantic-quality,
unknown and semantic-abstention scores must be null for these refused outputs.
The bridge is cfg(test)-only and reuses evaluate_supplied/the existing canonical validator.
Four cases have mapped allowed dimensions (inv-identity, doc-ambiguous,
doc-electrical and doc-invoice); inv-sparse maps aggregate no-proposal only;
three more cases map structural refusal only. The other 24 cases, positive recall,
unique-winner selection, field-specific abstentions,
unknown prose, unmapped negative annotations and native effects stay unscored.
These twenty-five authored Rust cases and current-head formatting/compilation/Clippy
are NOT RUN. No model/API, production corpus import, real authority or write,
new workflow, runtime readiness or issue acceptance follows.


The maintenance disclosure/session composition retains donor #569 at 1aa24a45.
Task keys bind the exact canonical proposal index and admitted candidate inputRef;
separate tasks may refer to the same candidate. Interval/conditions/urgency and
exact evidence are preserved. The canonical proposal has no service-history
baseline input, so baselineDate is always null and no due date is inferred.
The session checks the target/index and canonical UTF-8/interval bounds again
for structured user edits, including complete editedFields value-change correspondence. Delivery
remains authority:none intent DATA after the existing currentness/once-only
fences; the original owner must independently validate current authority and
edited semantics. No task scheduling, source write, real host port or app-root
activation is bound. Two new backend projection/currentness cases and four new
session cases are authored, NOT RUN. Existing frontend selections remain 77/1/7;
no new command/workflow/browser lane or live inference is added. Donor README
UNAPPLIED statements describe its six-file standalone increment; this composition
adds the canonical disclosure/session bridge but leaves genuine host ports unbound.

Raw interval spelling/property-order edits may retain an interval editedFields
marker even when normalized canonical values coincide; all actual value changes
must still be declared, and other spurious markers refuse. Canonical UTF-8 limits
and Rust-equivalent control-character refusal apply before owner delivery.


The maintenance edit repair shares validateMaintenanceValues between controller
pre-consumption draft checks and session defensive validation. It retains the
Rust canonical limits: title 256 UTF-8 bytes, up to 16 conditions of 512 bytes,
conditional text 1024 bytes, periodic count 1..100000 and bounded unit/urgency.
Controls including CR refuse; LF/TAB remain valid in nonempty text. Lone UTF-16
surrogates refuse. Invalid local edits stay reviewing/editable with valid:false,
without source checks, owner delivery or consumption. A corrected draft can be
sent once. Actual/uncertain owner callback failure remains consumed and cannot
replay. Inventory/document behavior and genuine current-owner gates are unchanged.
Two new controller and two new adapter cases plus the corrected invalid-edit
regression are authored, NOT RUN. Existing source selections remain 77/1/7;
counts are now 25 controller / 11 adapter cases. No local tests, compilation,
formatting, Clippy, browser/device qualification or workflow rerun was performed.


Three more original retained corpus cases have bounded mappings in the same
cfg(test)-only bridge: inv-sparse aggregate no-proposal with only capture-blur v1
admitted; doc-electrical class only; doc-invoice invoice/warranty alternatives
and the original serial-backed item-a association. Mixed-purpose completeness,
electrical truth, sparse field-specific unknowns/location, unadmitted negative
candidates and native effects stay unscored. No annotation candidate list is an
access grant, and no negative citation is fabricated. There are now eight
partially mapped cases (four allowed-label, one aggregate, three refusal) and
24 cases outside inventory/document scoring (three maintenance controls below),
with eight having no bridge after the later controls below. The earlier three tests brought the bridge to nine authored
cases, NOT RUN; supplied outputs are not model evaluations. Exact interpretation,
original hashes and case names are in tools/ai-feature-evaluation/INTEGRATION.md.
The production scorer/validator, repaired frontend, original corpus files and
77/1/7 frontend selection inventory are unchanged. No runner/workflow is added.


Cited-answer composition preserves donor #569 eb217ae3 and its exact six paths,
including the maintenance repair. The existing canonical disclosure/session now
projects Answer route, ordered ranked_refs, partial/no-answer coverage, supported
statement text/rationale/uncertainty and exact evidence. Answer-only rankings
metadata binds each local rank key to inputRef, version and original rank index;
rank order is not access, factual certainty or an original-open capability.
Selections are empty and the session defensively refuses answer intent delivery;
the donor controller refuses every edit/select/accept/reject path. Only existing
owner-bound source inspection and local dismissal remain. Real host ports,
question/inference/runtime binding, native effects and app activation are unbound.
Three backend and four session cases are authored, NOT RUN. Existing SOURCE
selections now hold 32 controller / 15 adapter cases; inventory remains 77/1/7.
Finite DTO bounds may refuse projection rather than invent or truncate evidence.
No model ranking, answer quality, device or end-to-end host qualification follows.


Comparison composition preserves exact donor #569 e5281bd9, including prior
answer and maintenance repairs. Canonical Contradictions findings retain the
existing ReviewProposal finding_keys, original finding/claim order, exact claim
text/input/evidence and qualitative uncertainty. A closed comparison-only binding
map joins finding key/index and assertion claim/input/version/evidence IDs.
The session checks every assertion citation against inspection input AND version;
matching labels or arbitrary distinct strings cannot substitute another input.
Fact dates are always null here: canonical claims have no fact-date field and
there is no qualified independent fact-time input. Source/retrieval dates remain
separate. No winner, correction, decision persistence or deduplication is issued.
Controller and session refuse every comparison review-intent path; inspection
through the original owner and local dismissal remain the only actions.
Three backend and four session cases are authored, NOT RUN; existing selections
now hold 39 controller/source / 19 session cases, with unchanged 77/1/7 inventory.
Real runtime, host/root mounting, native writes, approvals and activation remain
unbound. Reusing a finding key is correlation DATA, not a durable decision.


Three retained maintenance cases now have interval-only representational controls
in the same cfg(test) bridge: maint-periodic (90 days), maint-no-baseline (120 days)
and maint-condition-match (the full original conditional P9 notice). Only selected
sources are admitted, preserving original versions/dates/target/citation joins.
The due_2030_04_01 label remains explicitly unmapped: the canonical contract has
no due date. Raw service text is retained but not converted to a service baseline;
disclosure baselineDate stays null. Ordinary-use qualifiers remain, and unknown
cleaning/indicator state never becomes a schedule or safety/condition decision.
These controls call only the existing validator/disclosure, NOT evaluate_supplied;
no maintenance Labels/CaseReport, quality counts or model metrics are constructed.
Shared derivative negative controls refuse dueDate/schedule fields and stale/
withdrawn DATA; they are not new original scenarios or real revocation evidence.
Three new authored cases bring the bridge to twelve tests, all NOT RUN; the nine
prior tests/eight inventory/document mappings remain unchanged. At that maintenance checkpoint eleven cases
had some bounded representation; the answer controls below
and comparison controls bring the eventual total to twenty-four with eight none. All maintenance quality is unscored.
Exact names/limits are in tools/ai-feature-evaluation/INTEGRATION.md. Production
contracts, frontend, corpus originals and 77/1/7 selections are unchanged.


Three retained answer cases add validator/disclosure-only supplied controls:
qa-location quotes spare v1/location with inventory route; qa-electrical quotes
drawing v1/sheet1 with electrical route and separate 2020 source/2030 retrieval;
qa-injection cites only injection v1/p2 while all malicious p1 text remains inert
admitted source data. Original unknowns/abstentions remain explicit. Selected
input identity/order supplies a bounded rank control, not measured relevance.
Coverage is partial; exact statements/support/evidence and empty selections remain.
Derivative controls refuse unadmitted refs, unknown/clarify with factual statements,
action/tool fields, exhaustive coverage and stale/withdrawn DATA. They neither
invent new original scenarios nor establish real source-access revocation.
No evaluate_supplied/Labels/CaseReport or quality counts are used. A well-shaped
supplied answer is not evidence of semantic truth or live-model injection safety.
Three new cases bring the bridge to fifteen authored tests, all NOT RUN; twelve
prior tests remain unchanged. At that checkpoint fourteen original cases had some bounded bridge;
the comparison controls below bring the eventual total to twenty-four with eight none. qa-missing/qa-stale/qa-revoked remain outside this increment. Exact names,
limits and original hashes are in tools/ai-feature-evaluation/INTEGRATION.md.
Corpus, production contracts/scorer/validator/disclosure, frontend and runner
inventory remain unchanged; no new lane, host/root binding or activation occurs.


Three retained comparison cases add validator/disclosure-only controls:
review-conflict preserves both original location citations without a winner;
review-unknown-date retains tentative supplied interpretation, unknown dates/
review status and null typed fact dates; review-revoked uses original withdrawal
DATA to refuse any disclosure object, with the non-withdrawn side unchanged.
There is no safe withdrawn-side summary or claimed real Access revocation.
Canonical finding-key/index and exact claim/input/version/evidence joins are
checked. Derivative one-sided/missing/duplicate/cross-input, winner/correction/
action and changed/withdrawn controls remain separate from original scenarios.
Reordered presentation retains the canonical correlation key; a fresh synthetic
source-version mutation changes it. This establishes no persisted dismissal,
audit, deduplication, non-resurrection, truth or semantic-certainty detection.
review-corrected/simultaneous-version history remains outside this increment.
Three new cases bring the bridge to eighteen authored tests, all NOT RUN;
fifteen prior tests/code and original corpus bytes remain unchanged. Seventeen
original cases had some bounded bridge at that checkpoint; the availability
controls below and empty controls bring the eventual total to twenty-four with eight none. No contradiction
scorer, Labels/CaseReport, quality count, model judgment or full-case success.
Exact limits/names are in tools/ai-feature-evaluation/INTEGRATION.md. Production,
frontend, runner/workflow, native authority and host/root bindings are unchanged.


Three original availability cases add validator/disclosure-only controls:
doc-unreadable admits only scan metadata with no content/page/candidate;
doc-unavailable retains readable extraction but exposes no original inspection,
without converting byte unavailability into record revocation; qa-revoked refuses
even an empty clarify disclosure at the original Withdrawn DATA boundary.
Original fixture IDs remain metadata, not capabilities; no URL or extra claim is
invented. The no-proposal document DTO shows fallback metadata, while extraction
stays retained in its input. Real original identity/opening and Access revocation
are not qualified. Three new cases bring the bridge to twenty-one authored tests,
all NOT RUN; eighteen prior tests and all original corpus bytes are unchanged.
The complete 32-row INTEGRATION.md ledger records five scorer subsets, nineteen
structural controls and eight cases without bridges, with explicit reasons and
limits for identity, condition truth, simultaneous versions and durable history.
This ledger is not semantic quality, full-case acceptance or a new report system.
Production/frontend code, runner/workflow and native/root authority are unchanged.


Four supplied-empty retained controls add maint-condition, review-history,
review-retrieval and review-distinct. Exact selected inputs/evidence/versions/dates,
original unknowns and no-effects boundaries remain; no pump/candidate is injected
and no finding is fabricated. Empty tasks/findings are authored inputs, not model
mismatch, semantic abstention, compatible history, temporal reasoning, native
physical identity or durable decision results. Existing metadata-only disclosure
of otherwise unused evidence remains a presentation limit, not a production gap
filled by invented content. No evaluate_supplied/Labels/CaseReport or quality
counts are used. Four new cases bring the bridge to twenty-five authored tests,
all NOT RUN; 21 prior tests/code and corpus originals are unchanged. The complete
32-case ledger now has five scorer subsets, nineteen structural controls and
eight cases without bridges. Production/frontend code and runner/workflows stay
unchanged. Exact scopes/names/remaining gaps are in INTEGRATION.md.
