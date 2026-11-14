# HouseAtlas

Opening a HomeBox stored file in the file dialog now keeps it on the device
(#560): **Open file** is the primary action and reads one verified copy through
the existing reader, which the existing retention owner stores under the same
account witness, sign-out wipe, budget and LRU. The issued-URL download stays as
a secondary action that keeps nothing. Two new top-level cases in the existing
required `offline-electrical-copy.test.mjs` open and keep a generated file, then
relaunch with a second owner that has no live session over the same in-memory
storage: the file opens with no further request; sign-out clear and account
replacement remove it; a quota refusal is reported and leaves it not held. The
existing `pinned-capture-read.mjs` action harness checks the new wording,
including the reported storage refusal. No browser, native service or provider
runs. No new selection or command: 83 SOURCE / 1 BUILD / 11 BROWSER (95 total).

Offline storage cleanup of HomeBox registration marks (clear, sign-out and account
replacement) is no longer bounded by the metadata row allowance or per-row size
checks. Marks are never evicted and are read by key, so an account could reach
more of them than the old scan accepted, which rolled back every deletion and
left stored data behind. Cleanup now removes marks by key only. Admission and read
limits are unchanged. One new top-level case in the existing required
`offline-electrical-copy.test.mjs` seeds 2,057 synthetic marks plus the witness
and requires clear and account replacement to remove all stored data. It uses the
file's in-memory backend, with no browser or native service. The case is authored
and UNRUN in hosted CI until exact-head qualification. No new selection or
command: 83 SOURCE / 1 BUILD / 11 BROWSER (95 total), deadlines and pins remain.

HomeBox same-observation reopening joins or reborrows the exact earlier capture
within one retention owner and actual page/sign-in allocation. Sent claims stay
spent; missing local bytes do not trigger another provider acquisition. Reader
handles share private immutable bytes and one storage attempt, while existing
bulk cancellation and explicit storage continuation after UI close stay distinct.
Exact-held reads recheck the full pin, epoch, scope and association; automatic
status cannot follow another association's valid pin. Uncertain work remains
quarantined without replay. Finite claims/readers/interests, one pipeline and
two resident observations bound admitted application payload; source allocation
accounting is not a measured peak, browser/native allocation or RSS guarantee.
Existing owner and synthetic-hook controls are authored and UNRUN until hosted
qualification. All 95 selections, commands, limits, deadlines and trust pins
remain unchanged. Primary issued-URL downloads, ordinary-open integration,
whole-library and device acceptance remain separate and unfinished.

HomeBox verified-copy foundation adds an optional type-only original-frame port
through Host/state and a lazy live-host adapter. The separate preview action and
automatic fill share private session/exact-association claims; sent success,
refusal and unknown outcomes are not replayed. One memoized storage attempt uses
the same immutable verified bytes and can outlive ordinary UI close, while actual
binding retirement, expiry and explicit storage clear withdraw owned interests.
Transaction currentness, exact-pin read-only uncertainty reconciliation, bounded
UI URLs and inert saving preserve existing storage authority and limits.
Both ordinary issued-URL anchors remain unchanged: their opened-file retention
and compound whole-library/device acceptance are unfinished. Existing required
`offline-electrical-copy.test.mjs` and `pinned-capture-read.mjs` carry generated
owner and synthetic-hook action controls; these are authored and unrun locally,
not a mounted UI/device result. All 83 SOURCE / 1 BUILD / 11 BROWSER selections
(95 total), commands, deadlines, startup budgets, workflow and trust pins remain.

Offline Settings displays exact HomeBox captured size hints separately from
measured retained bytes and storage budget. Exact association identity, numeric
deduplication, conflicting/unknown duplicates, overflow and unavailable/empty
coverage stay explicit; hints never grant download authority or catalog completeness.
Existing `offline-electrical-copy.test.mjs` adds four pure controls and one
synthetic-hook Settings lifecycle control; the existing live-launch case adds
one generated display assertion. All prior assertions and deadlines remain.
No new selection is needed: 83 SOURCE / 1 BUILD / 11 BROWSER (95 total).
Controls are authored and unrun until exact-head hosted qualification. Mounting,
fill limits, storage policy, provider authority and device deferral are unchanged.

Immutable Core read preparation narrows only existing HTTP read/admission
parameters, closure bounds and necessary caller borrows from `&mut Core` to
`&Core`. The same Core mutex guards, original authorization/release checks
and inner Store/Access mutations remain. No root slot, generation, lease,
capture, journal/status or release-gate behavior is added; this does not enforce
replacement history or Send/native-owner lifetime. Existing commands,
83 SOURCE / 1 BUILD / 11 BROWSER selections (95 total), pins and limits remain.
No local compiler/formatter/tests ran; exact-head hosted qualification is required.


Selected native suggestion inputs expose a source-owned `disclose_completed`
method: it borrows the original terminal outcome, projects against the private
admitted snapshot with an empty inspectable set, and rechecks the original
native source/access owners both before and after projection. A failed second
check withholds the entire projected DTO. Retained text/metadata never creates
original-byte inspection authority. These are boundary checks, not an atomic
transaction or continuing disclosure authority; original outcome/usage remain
with their owner. The race hook is test-only. All eleven existing controls are
preserved and six additional default-library controls are authored, unrun until
exact-head hosted qualification. No route/root mount, inference/provider call,
corpus/pin/runtime activation or persistence is added. Existing 83 SOURCE /
1 BUILD / 11 BROWSER selections, workflows and all limits remain unchanged.


GPU admission and renderer reservation additionally account for one appearance
state texture per rendered mesh set: nine RGBA32F texels per drawn instance,
128 entries per row, or 18,432 bytes times the rounded-up row count. Repeated
node instances count separately; a combined SiteArtifact set rounds its summed
instance count once. Skipped empty rendering costs zero; direct scene creation
retains its existing minimum row. The two CPU state arrays are not two GPU
textures, and material admission must not charge the state texture twice.
Geometry remains 72 bytes per triangle with separate prepared-geometry reporting.
The existing 64/384 MiB limits, all 95 selections and their deadlines remain.
State-accounting exports live in the already mapped `glb-preflight.ts`;
there is no separate runtime state-table import. All 20 trusted harness/contract
files retain the pinned `8f41c7d7` bytes. No workflow, pin, metric or trust-policy
change is part of this source-only compatibility repair. Its final head still
requires hosted qualification; earlier queued runs are not execution evidence.
Authored existing controls cover row boundaries, repeated nodes, material/plain
admission, combined-set release and generated artifacts straddling configured
caps. They are unrun until exact-head hosted qualification. No private/installed
artifact is requalified. Allocation layout and shader behavior stay unchanged;
admission tightens at the existing caps. Transition peaks, fixed render targets
and global memory policy remain separate. Earlier
notes below describe their respective source checkpoints.

The existing required `unified-atlas-daylight-healthy.mjs` SOURCE check adds
generated CPU controls for lamp descriptor ranking/capping, hiding, whole and
partial clipping, clip-boundary overrides, display lift and reappearance.
Each of eight states poisons the receiver cells before the actual
`writeAppearance` call and immediately requires room/shelter flags `[1, 1]`.
The controls also retain self-emission marks and fixed global lighting inputs.
No new runner selection is added: 83 SOURCE / 1 BUILD / 11 BROWSER (95 total),
with all existing assertions and 180000 ms entry limits unchanged. Source and
metadata inspection are not execution; exact-head hosted qualification remains
required. This CPU-only slice does not qualify GPU slots, rendered fallback,
readiness or occurrence completeness and does not complete #339. Production
renderer/schema/allocation code, workflows and sandbox setup remain unchanged.

The required SOURCE list adds `example-files-healthy.mjs`: 84 SOURCE / 1 BUILD /
11 BROWSER (96 total), limits unchanged. It reads the example house's
generated HomeBox manual through the production verified-copy owner over an
in-memory store and its fictional electrical drawing through the production
Electrical Library reader, validates its topology records and renders the
actual Places rows to static markup, and runs the generated `/example/` offline
worker in a fake worker scope over temporary files. No browser, IndexedDB, network,
native host, real household file or device behavior is exercised.
Earlier counts below describe their respective source checkpoints.

The required SOURCE list adds `example-combined-overlays-healthy.mjs`:
83 SOURCE / 1 BUILD / 11 BROWSER (95 total). All previous entries and
180000 ms per-entry limits remain, including the explicit stored-dialog case.
The generated control uses the production reader/projector and actual graph
builder (exposed only in its test bundle), checking three Hall and one Living
room electrical records, one Stairs network record and logical root tracing.
It checks owner retirement through
both signals, release and disposal. This is example-only fictional DATA,
not native/physical/provider authority, a mounted demonstration or #591
completion. New controls are authored and unrun locally; exact-head hosted
checks, startup/performance and existing capture remain required. No workflow,
timeout, sandbox, persistence, production-consumer or capture change is added.
Earlier counts below describe their respective source checkpoints.

The required browser list additionally selects only
`unified-atlas-regression/browser.mjs --stored-dialog-currentness`:
82 SOURCE / 1 BUILD / 11 BROWSER (94 total). All previous selections,
including `--electrical`, keep their commands and 180000 ms per-entry limits;
the broad default regression suite is not registered. The generated case mounts
the actual stored Atlas and native compact layer dialog, checking an identical
fresh-read settlement without modal/focus/stage replacement and retirement on
denial. It is authored and unrun locally, not execution or #292 acceptance.
No production code, workflow, sandbox setting or other budget changes.
Earlier counts below describe their respective source checkpoints.

The #552 shared registration adds required SOURCE
`unified-atlas-network-source-root-healthy.mjs` and required BROWSER
`network-trace-mounted/browser.mjs`: 82 SOURCE / 1 BUILD / 10 BROWSER
(93 total). All prior 81 source entries, the build and nine browser entries
remain. Registration changes no assertion, command deadline, sandbox setup or
workflow; every required entry retains its existing 180000 ms limit.
The source entry separates pure, static-markup and static-source controls.
The mounted generated fixture builds both index.html and host.html, exercising
standalone graph and actual UnifiedAtlas host/lens wiring, trace publication
and retirement, chain/hop, Plan/3D and reduced-motion controls after settlement.
These authored controls are unrun; they are not live-owner acceptance
or paint evidence. The host case requires the trace at the first animation
callback after a trusted click, with unchanged read counters and no browser
request; the input-to-DOM-observation time is logged as informational and
asserted only to be finite and ordered, never as a 60 Hz or one-frame bound.
No local test/build/compiler, typecheck/syntax/formatter/browser ran; final composed-head hosted CI remains
required. Earlier 81/1/9 counts describe the prior candidate. Existing #552
source/writer and ownership boundaries remain; no new workflow or authority.

The existing healthy SOURCE list additionally requires
`unified-atlas-start-healthy.mjs`: 81 SOURCE / 1 BUILD / 9 BROWSER (91 total).
All prior 80 source selections, the build selection and nine browser selections
remain, with unchanged commands, assertions, sandbox setup and 180000 ms
per-entry limit. The new entry transforms the actual types.ts ledger source for
pure generated controls of stored-first commitment, same-owner refresh, new
owner, reopening and abandoned/replayed initialization. It does not mount React
or qualify cached-first mounted behavior. Fresh-read capture and its outstanding
exact-head execution are separate. Registration and metadata audits are not
execution evidence; no local tests/build/compiler/typecheck/syntax/formatter or
browser ran. Existing hosted CI must execute the composed head before eligibility.
Earlier 80-source counts describe prior candidates; no workflow is added.

The generated `lamp-glass` case is a ninth required browser entry in the
existing healthy runner: 80 SOURCE / 1 BUILD / 9 BROWSER (90 total). It uses
GLB-loaded translucent/opaque emissive controls and the existing renderer to
check daytime rear-marker visibility, nighttime fill/glow and front/rear beam
response. Existing webgl2, full webgl2-probe, webgpu/bench, sample counts,
assertions, deadlines, sandbox setup and workflows remain unchanged; every
required entry retains its 180000 ms limit. Test-build-only per-canvas witnesses require the requested appearance after
scene.render returns at shading=1; they do not prove exhausted temporal
refinement. Thresholds are authored starting assumptions and runtime is
unmeasured, not evidence or a sub-minute guarantee.
No local test/build/compiler/typecheck/syntax/formatter/browser ran. Hosted
exact-head execution is required. This prepares #548; its existing live-owner
review remains deferred and the issue stays open. Earlier eight-browser counts
below describe the prior candidate, not the new inventory.

The full WebGL2 render probe is now a separate required `webgl2-probe`
selection alongside `webgl2`: 80 SOURCE / 1 BUILD / 8 BROWSER (89 total).
Each entry retains the existing 180000 ms limit. The probe keeps all five
workloads and their four warm-up plus forty measured frames (220 renders),
report/backend/dimension/output and resumed-drawing assertions, followed by
all existing ordinary-material assertions in a fresh tab in the same browser.
The ordinary WebGL2 entry retains every other swap, relighting, material,
glass, scalar and lamp sample/assertion. Opt-in webgpu/bench remain unchanged.
This changes accumulated process/GPU/cache history; the successor-material
control witnesses teardown/reuse but does not establish identical history or a
timing guarantee. No workflow/infrastructure, sampling override, assertion or
budget reduction is introduced. Earlier seven-browser counts below describe
prior candidates. Both required cases and all existing gates need hosted
exact-head qualification; no local tests/build/compiler/syntax/formatter or
browser ran. Held sampling-override donor6c75809b is excluded.

WebGL phase-marker donor20b4eed4 is composed unchanged: bounded elapsed-time
markers identify existing build/draw/swap/worker/lighting/material/scalar/lamp
phases. No sample, shader, assertion, wait, scene count, threshold or budget is
changed. Markers are diagnostics, not benchmark or pixel results. Actual hosted
execution must qualify the full candidate with helper custody and settlement
oracle; no local test, compiler, syntax check, formatter, helper or browser ran.

Settlement oracle donor df277670 is composed after independent source review.
Its first viewer gate joins page and network rows bijectively by original
application requestId, requires page EOF/bytes and terminal authorized200 network
accounting plus current ready UI, and refuses wrong document/phase, missing or
duplicate records, overflow, aborted/partial/non-EOF or replaced current reads.
Only correlated positive consumption can account for browser ERR_ABORTED; byte
equality alone never does. Existing auth/write/count and budget assertions stay.
The second settlement after Changes unmount is traffic quiescence, not fresh
validation of every later response. Promise instrumentation adds microtasks and
changes rejection observation; it is not behavior-neutral or a production port.
Each of the existing five flows authors42 synthetic verdict controls in process.
They do not exercise observer installation or real browser aborts. These controls
and the actual browser sequence remain NOT RUN locally; exact hosted execution
must qualify the combined helper, fixture and oracle. No new workflow/lane or
removed browser case, sandbox flag, timeout or shader/material change.

Existing ephemeral Ubuntu24 CI Chrome jobs now prepare a temporary pinned SUID
sandbox helper without repairing pre-existing helpers or OS policy. The installer
uses no-follow held directory FDs, refuses mutable/non-root ancestors or an
existing destination, verifies a root-private copy of the pinned156.0.8078.47 ZIP,
extracts one bounded regular helper, verifies installed bytes/inodes, durably
records job custody before activation, and publishes only after write FDs close.
The browser stays user-owned; normal-user --get-api must return1 before exporting
the fixed CHROME_DEVEL_SANDBOX path. Capture storage forwards only that exact
path; browser flags/assertions and seven required browser cases stay unchanged.

Frontend and loopback always-cleanup runs after setup/API/test failure too. It
validates the job/inode marker, revokes SUID before refusing changed contents,
removes only known owned files/empty created directories and never exports an
empty helper variable. SIGKILL before the durable marker can leave only private,
non-SUID residue which cleanup refuses; ephemeral VM disposal is the fallback.
No existing permissions, AppArmor/sysctl, package, Mac/NAS/deployment or credential
state is modified. Helper creation is confined to existing hosted Ubuntu jobs.

The existing tools/ci stdlib selection gains ten generated data-only archive and
metadata controls (33 methods total). They never install/clean a helper, invoke
sudo/browser/API or set SUID. New controls and actual installer/API/sandbox/cleanup
execution are NOT RUN locally and require exact-head hosted CI. Inventory and
publication-byte regeneration are source maintenance, not runtime qualification.
No new workflow/lane; frontend selections remain80 SOURCE /1 BUILD /7 BROWSER.

Scalar visibility fixture donor38ca67b5 is composed after independent source
review. Only the generated glass sample's shared tint changes0.18 to0.02 and
opacity0.12 to0.5; all scalar variants use those same settings and retain the
prior light vector. Production shader/materials, thresholds, visibility/endpoint/
midpoint assertions, scene/sample counts and budgets are unchanged. The source
rationale addresses the hosted8c glass surface/background ambiguity; new hosted
pixels must still pass. It is not private-material, device or product acceptance.
No local test, syntax check, compiler, formatter or browser ran. Page-side donor
d98ea7fc, mainc67637c, original corpus and seven browser cases remain preserved.

Page-side diagnostic donor d98ea7fc is composed after independent source review.
It wraps fetch/body/default-reader observation in the generated browser fixture,
returns original results and changes no assertion/wait/timeout/acceptance rule.
This is not behavior-neutral: Promise observers add microtasks and affect
otherwise-unhandled rejection observation; installation failures are swallowed.
The best-effort log covers the current one-chunk viewer reads, not all Request
signals, URL inputs, convenience/clone/BYOB consumers or transport behavior.
Fourteen events per entry and forty-eight entries can omit terminal/later events;
command-only repeated-read correlation is approximate. A failure report may add
one bounded fifteen-second Runtime.evaluate after the unchanged settlement limit.
No absence/equal-byte observation proves no cancellation or successful consumption.
No body, URL or cookie is logged. Source/byte review is not execution: all new
page-side observations await exact-head hosted CI, with no local syntax/tests,
compiler, formatter or browser run. The seven browser selections remain unchanged.

The read-only sandbox metadata follow-up adds two fixed Microsoft Edge helper
candidate spellings and its installed package version. The official Ubuntu24.04
runner image lists Edge in addition to Chrome/Chromium; the original five-candidate
report found no setuid helper, so the Edge candidates remain unqualified until
hosted metadata is read. Pinned Chromium156 source requests helper API1 and exposes
--get-api, but no helper/API query is executed or selected by this report. Seven
metadata candidates are not seven browser cases: browser selections remain the
unchanged80 SOURCE /1 BUILD /7 BROWSER. No permission, policy, package, security
flag, workflow, runtime or authority is changed. No local functional checks ran.

The existing Chrome setup command additionally reports bounded read-only metadata
for five fixed sandbox-helper candidates: ownership/modes, resolved-parent
permissions, two namespace kernel settings and installed Chrome package version.
No helper is executed or selected; no permission, package, AppArmor/sysctl, sandbox
flag, credential or runner configuration is changed. Metadata and package version
alone do not prove helper API compatibility or an actual sandboxed launch.
Existing seven browser cases remain required; no new step, lane or workflow.

Scalar fixture donor 886d5b44 changes only the glass sample's light vector to
[0.08, 0, 0.99679486] to discriminate the existing midpoint below the documented
gain/clamp saturation. Non-glass light, shaders, scalar values, thresholds,
assertions and budgets remain unchanged. The off-axis source rationale is not a
pixel result. New fixture/metadata execution awaits exact-head hosted CI; no local
test, syntax check, compiler, formatter, browser or helper was run by integration.

Diagnostic donor a5f0c90 composes on 54dc0c44 after independent source review;
main c67637c1 (#555) is retained by ancestry. Only the five existing loopback
scripts add bounded generated-request transfer metadata and event order to failure
diagnostics. Observers catch errors and do not change predicates, waits, timeouts,
state ordering or cancellation acceptance. Missing data events/counts establish
neither incomplete bodies nor successful reads; equal bytes grant no authority.
No bodies or URLs are captured. Header/error strings and event history are bounded.

The donor writer reported five node --check syntax checks; no functional tests.
This integration ran only source/byte audits, no local test/compiler/formatter or
browser. New exact-head hosted diagnostics remain necessary. Existing 80 SOURCE /
1 BUILD /7 BROWSER selections, workflows, budgets and security settings remain
unchanged. Sandbox launch and glass pixel qualification remain separate gates.

Scoped repair donor #590 903ad712 is composed with electrical closure ac03072e.
The source diff contains two formatting-only Rust edits, an exact fixture boundary
correction and five wait-predicate changes. Retained Linux diagnostics named cargo
fmt and suggestion_inputs_healthy.rs; the MCP formatting edit was found by the
repair writer's earlier formatter, not a separate hosted diagnostic. The numeric
fixture now ends at its closing brace before generated electrical statements.

The loopback poll now waits for the already-required successful completion of
every topology command. Existing later assertions, timeouts and diagnostics stay
intact. A possible replacement-read gap is an interpretation of canceled reads,
not proof: recorded rows span viewer-login rather than the latest binding epoch.
No browser cases are removed; 80 SOURCE / 1 BUILD / 7 BROWSER, workflows, budgets
and security settings are unchanged. All source changes require new exact-head
hosted qualification; no local compiler, formatter, test or browser ran.

Bounded Stock dependency closure composes exact ac03072e (three commits atop
c6d71046). Only selected identity/semantics/circuit payload.evidenceIds and explicit
root pins are followed, preserving exact numbers, revisions and unknowns. Missing,
conflicting, duplicate or withheld records refuse and retire the partial owner.
Pin length is checked before cloning/visiting; pool, root and reference work are
bounded. Repeated references deduplicate without selecting a competing revision.

The existing topology selection extends its generated controls for dependency and
root-only withheld evidence, exact numeric provenance, bounds and retirement.
All new controls are authored, NOT RUN locally; 80 SOURCE / 1 BUILD / 7 BROWSER
selections and workflows are unchanged. This remains partial Stock DATA, without
canonical record admission, projector compatibility, evidence-asset/supersession/
external-source closure, independent review authority, ongoing observation or live
mount. No runtime, provider, native effect or release is added.

Current bounded electrical continuation composes exact d707481f after independent
source review. Its exact browser subset adds only circuit/evidence list result
roots; existing definitions and original source pins, including opaque HomeBox
collection identity, are unchanged. Numeric evidence provenance remains an
ExactDecimal; the supplied control sends 9007199254740993 as a raw JSON integer
through the real parser/closed validator/client/owner. No selected review or
native association is inferred. The existing topology selection is extended,
not a new runner/lane/workflow: 80 SOURCE / 1 BUILD / 7 BROWSER. All new controls
remain unrun locally and require exact-head hosted execution. No host/root
mount, private input, provider/model operation, authority or deployment is added.


The follow-up composition preserves selected-input donor #586 `4cf41d52`,
inspection donor #587 `8584ee97`, manual native-handoff donor #585 `0d18454b`
and partial electrical reader #584 `9a8e32fc`. The backend module is now
registered, discovering ten authored selected-input controls. The frontend
runner adds the existing 22 inspection and 11 handoff controls: 80 SOURCE,
1 BUILD and 7 BROWSER selections. Ten new controller controls bring its
suite to 59, preserving displayed inspection cancellation after opening and
terminal/replacement abort reentrancy fences. These new controls are NOT RUN.

Automatic HomeBox-original reads now require the existing authenticated
pinned-source discovery's exact scope/source/collection/entity selection and
still-current binding. Cached attachment metadata alone cannot trigger an
unconfigured original GET. Native catalog or incomplete native-pass failures
stop source composition before HomeBox; all original assertions remain.
Four discovery controls and a native/root stop group are authored, NOT RUN.

These are reusable source functions, not an application/root suggestion mount.
Authenticated selected inputs retain only assertions/metadata, not Content;
positive document-content classification/linking remains unavailable. Opaque
collection selectors retain their spelling, while downstream UUID-only wire
and canonical target admission can still refuse them. Inspection original maps
must come from a genuine owner; manual handoff navigates only via independently
verified nativeLink, never applies or approves. Partial electrical inputs supply
identity/location only, not circuit/evidence/electrical-review authority.

The preceding b19e7d91 candidate passed hosted backend, both source platforms,
ordinary-core, capture and performance jobs but failed frontend and all three
loopbacks. Raw artifact/job downloads returned Forbidden and remain stopped;
no log cause is inferred from exit-code annotations. This new source requires
its own automatic hosted execution; no local build/test/compiler/formatter,
security change, new lane, live inference/provider, activation or deployment.


The next composed source candidate preserves exact donors #555 `0a657eef`,
#580 `2b28c406`, #582 `054c07c1`, #578 `3905725b`, #581 `70abbeed`
and #583 `30081ada`. Startup remains lazy with unchanged budgets. HomeBox
original retention is mounted only after complete, current, enabled native and
electrical passes; unknown outcomes stop the sequence. The electrical trace
consumer remains unmounted pending genuine data/review ownership.

Confirmed `no-current-association` now retires only the selected building's
local catalog eligibility; transient failure preserves it. Document retention
borrows the already-open original reader/frame/blob, without a second original
download or taking lease ownership. Foreground refresh still hides, aborts and
revalidates data; only neutral section/exact-pin/page/zoom/scroll intent survives
for the same actor revision and scope, with fresh allocation and byte checks.
Effect preparation restores temporary renderer state before four safe yields;
the scene permits direct-only redraw there, retaining the compilation guard and
zero history until shading is ready. No renderer deadline or assertion changes.

New authored controls remain NOT RUN: ten preparation controls (19 declarations
total), six retention/retirement controls, three policy/root groups, four source
presentation assertion groups, and a focus/PDF extension in the existing
live-launch browser case. The default frontend runner now has 78 SOURCE,
1 BUILD and 7 BROWSER selections. No new lane/workflow or removed case.
Independent static review is not execution qualification. Producer donor
`3905725b` separately passed its mounted admission/disclosure/error/replay case
in hosted job130146474925 (354 passed, zero failed); that does not qualify this
new composed head, in-flight withdrawal, device acceptance or runtime authority.
Existing Chromium sandbox launch failures remain unresolved; no sandbox/security
setting, credential, provider, activation or deployment change is made here.


The existing default backend-library selection discovers the generated mounted
HomeBox offline-original case in `http::homebox_pinned_files::mounted_offline_original_tests`.
It exercises the actual router and original owner with disposable Access and a
generated loopback TLS peer: measured source bytes/association, anonymous and
withdrawn access refusal, provider 503 and spent-request replay. Its dedicated
test-only trust root admits only the generated loopback peer. Authored pending
hosted execution; no live provider, real credentials or device are used. It does not
establish remote freshness, in-flight revocation or consumer-store acceptance.
No workflow or runner command is added.

Composition follow-up: main8a20f596 is merged with preserved continuation
fence (#577), source inventory (#579) and accepted reporting policy (#575).
Exact electrical projector donor0138f373 is composed as its three-path delta;
its generated case passed in hosted job130052523185, while the sandbox cases
remained failed separately. The new combined head is not qualified by either
source's prior checks. No test/browser case or security requirement is removed.

Four changed MCP inventory pins were reinspected: the full native close/reopen
test addition, test-child registration, v4 introduction clarification, and all
five source/two browser runner additions. The read-only inventory audit matches
168 rows/67 pins after only those four hashes and provenance were updated.
Every operation/profile/admission value, historical evidence identity and
NOT RUN/OPEN/DEFERRED state remains unchanged. This audit executes no test,
service or application. No local build/compiler/formatter/browser ran.

Startup imports, HomeBox retained-original producer/consumer, model-cache/dialog,
electrical trace details and suggestion-review source remain with their existing
writers. This composition binds no account, runtime, host port, source write or
approval and leaves operational/device acceptance and current-head CI open.

At exact3f8dd36c, core auth, owned media and stock-write flows passed with
the reviewed settlement barrier. Shard-one then reached stock-history, whose
original diagnostics captured four viewer-started401 responses after editor
replacement (job130037255180). Shard-two reached stock-read, which failed its
original all-response check without response details (job130037255170).

Those two matching fixture setups now wait for the actual current topology
and use the same per-request settlement barrier before/after viewer navigation.
Stock-history retains its existing detailed diagnostics and phase boundaries,
including viewer-login-dialog; stock-read adds bounded failure diagnostics.
All original native read/write/audit, exact measured-count and response checks
remain intact. No production owner, runner/workflow, security configuration or
acceptance gate changes. These source-reviewed fixture changes require new
exact-head hosted execution; no local test/build/browser/compiler ran.

Main cc8ea458 (the already-contained551 donor's exact source tree) is
reconciled through an ancestry merge with zero source delta. The existing
1933-row manifest was retained after verifying every incoming path remained
present and all composed source bytes/hashes matched; no donor was reverted.

The16816c4d shard-one auth fixture passed, then the later stock-write fixture
failed its original all-response assertion at line521. Its identical raw
viewer-to-editor setup now uses the same request-ID settlement barrier, plus
bounded failure-only status/command/phase diagnostics. Its actual failure cause
remains unclassified until hosted evidence supplies the statuses; no assertion
or access check is removed. Observation is limited to viewer GET invokes, so
later native POST commands are not misparsed as query-envelope reads. No
production source, workflow, runner, security setting or qualification gate
changes. Source review is not execution evidence; the new head must run in CI.

The16816c4d core auth flow passed, while media stopped at the new combined
status/cancellation barrier. That assertion alone does not classify its failure.
The refined barrier keeps a bounded command/status/terminal-state diagnostic.
Only explicit body cancellation recorded after actual200 headers may count as
settled traffic; it never counts as successful content. Missing/non200 headers,
other network failures and nonterminal requests still refuse. Every topology
command also requires a fully completed nonfailed200 read and the provider's
current ready state. Existing exact measured counts and all-response checks
stay intact. This is fixture synchronization, not an access or lifecycle change;
new exact-head hosted execution must still establish the result. No local
compiler, test, formatter, browser, security override or manual rerun occurred.

Exact b1e18e0e hosted source job130028019360 passed after the four Clippy
repairs, and default-library job130028019422 passed. Its diagnostic media job
130028019572 observed two successful responses for each topology command in
the viewer-login phase; core job130028019526 tied all four401 responses to
viewer-started topology requests arriving after editor session rotation.

Both existing fixtures now correlate every native request by CDP request ID,
including response status and loading-finished/failed events. After actual current provider readiness, barriers before unmount and again
before session rotation require a complete balanced set of the four topology commands,
and successful completion without cancellation for every observed request.
This replaces the newly introduced one-cohort assumption, not the existing
four-read measured Atlas/Places assertions or all-observed-response checks.
Equal aggregate command totals do not establish individual request cohorts,
and the barrier does not prove that no future viewer request can start. No
production authentication, lifecycle, runner or workflow is changed. These
fixture changes require new exact-head hosted execution; no local checks ran.
The browser launch sandbox blocker is separate and no security override is
introduced. Runtime, native authority and operational acceptance remain held.

The same b97433ec loopback execution reached the retained all-response check
in core, which found four401 responses after viewer login. Media observed8
viewer /invoke responses against the newly added4-response assumption. That
assumption is not relaxed or reported fixed: bounded failure diagnostics now
record only generated command IDs/status/phase metadata to distinguish request
owners/lifetimes in hosted execution. All response/count/snapshot assertions
remain unchanged. These unresolved fixture/currentness findings still block
qualification; source cleanup and prior-head unit success do not settle them.

Hosted source follow-up on b97433ec: formatting passed on both source
platforms; Ubuntu job130023404862 then denied four Clippy warnings. The
scoped repair collapses three nested conditionals into equivalent let-chains
and initializes the suggestion count from its existing exhaustive match.
Validation branches, refusal values, continuity holds and warning policy are
unchanged. No new tests or runner selections are added; the next exact head
still requires hosted qualification. No local compiler, formatter or test ran.

Exact donor d270e238755d8a60ba375f5d7afe2aa9e1b16e54 is composed with
its c0208153 ancestry intact. Its only source change uses a live isClosed()
accessor after awaited review-owner handoff, resolving hosted TS2367 without
removing the dismissal/currentness/one-use fences. Donor job130020166745
passed Strict TypeScript and production React build; this does not qualify
the newly composed candidate or subsequent checks. All six frontend-owned
review files match that exact donor. Existing49/25 frontend case counts and
77 source /1 build /7 browser selections remain unchanged. No local execution,
tracker metadata write, readiness transition or merge-to-main is performed.

Hosted CI repair follow-up (10 November 2026): the exact14ff0744 default
backend-library job130017469493 executed346 passed /0 failed /12 ignored /
3 filtered, including42 suggestion synthetic-contract,10 supplied-scorer,
28 retained-corpus and two unit controls, plus continuity DATA and native-list
continuation cases. Ordinary-core42809630330 attempt2, performance42809630294
attempt2 and README-media42809630326 attempt2 passed. These hosted outcomes
supersede historical NOT RUN notes only for their exact selections and pin;
they do not qualify runtime, source custody, device or operational acceptance.

The source repair applies the identical hosted Linux/macOS rustfmt diff across
12 Rust files without local formatter execution. The core loopback recorder now
retains all actual native responses instead of silently stopping at12; exact
four-read-per-lifetime and matched-snapshot assertions remain. The media fixture
awaits the viewer's actual topology readiness and four observed successful reads
before session replacement; unexpected401 responses remain failures. These
fixture repairs require new exact-head hosted execution. No local check, new
runner/workflow, production access/lifecycle relaxation or runtime activation
is introduced. All13 previously composed donor heads are ancestors of14ff0744; ancestry
alone does not establish their remaining acceptance or missing coverage.

Exact donor c020815382919e82244951c047ce8bf101b6934f (parent f7188684)
changes only the component, README and review/source controls. Proposed-field
and maintenance-title controls use controlled soft-wrap textareas with existing
raw handlers, labels, states and limits intact, including4145 only for Inventory
tags. All six owned frontend files match this donor. Four donor cases plus one
canonical category and one session control are authored/NOT RUN; existing
maintenance LF/TAB adapter coverage is unchanged. Admitted LF/TAB preservation
does not promise arbitrary CR/CRLF draft bytes or executed React/DOM behavior.
Current counts are42 synthetic-contract /10 scorer /28 retained /one counter
plus one date-unit Rust case, and49 controller/source /25 session cases. The
77/1/7 selection inventory, corpus/ledger, date/tag/authority fences and runtime
gates are unchanged. No local execution or tracker metadata write occurs.

Projected review source-card retrievedAt and non-null sourceDate now have the
consumer's existing4096 UTF-16-unit fence. Exact original strings, null and
date-only values remain unchanged; over-bound projected dates return typed
LimitExceeded, without normalizing/truncating input or changing admission.
The check covers cited evidence and subject-metadata fallback for all record
features; uncited date text and source-free empty views remain unaffected.
Three authored/NOT RUN controls cover4096/4097/4117 units, ordinary dates/null,
uncited long inputs, all five features, a whole-DTO size counterfactual and
UTF-16 versus UTF-8/scalar units. Counts are42 synthetic-contract /10 scorer /
28 retained /one counter plus one date-unit Rust case; frontend49/25 and77/1/7
selections remain unchanged. No frontend/tag repair, corpus/ledger, runtime,
authority/currentness semantics or withheld-state redesign is changed.

Inventory tag JSON has a tight 4,145 UTF-16-unit compact-display bound:
16 tags *128 UTF-8 bytes *2 escaping units +32 string quotes +15 commas +2
brackets. Only LF/tab control characters are admitted; six-character control
escapes are unreachable. Unique 128-byte quote/backslash tags attain the bound.
Two backend canonical/disclosure and one strict-session controls are authored,
NOT RUN. Shared preparation counts are 42 synthetic-contract /10 scorer /
28 retained /one counter Rust cases and 24 session cases. The session control
requires the matching reviewed frontend tag-specific capacity donor before
publication; other field limits, whole-DTO bounds and all native/runtime gates
remain unchanged. No truncation, normalization or new source/approval is added.
For the earlier tag-capacity increment, the donor was `f7188684d1083a611d93ea86f6a5b63fd3d73725`,
parent474fb67c. All six owned review paths then matched it, including unchanged
view-types/CSS. Its four authored controls bring the existing presentation
selection to45 cases; shared session total is24. All seven new shared/donor
controls are NOT RUN. Canonical disclosure keeps current:null and the donor
preserves the generic current-value4096 limit and every other limit. Existing
77 source /1 build /7 browser selections and workflows are unchanged.

Inventory no-change/no-duplicate disclosure now retains evidence explicitly
cited by validated extracted claims, so unknown/held results can show exact
source excerpts/versions/dates for inspection instead of metadata alone.
Uncited evidence stays omitted; claim-free fallback and all other result paths
are unchanged. No field/candidate/selection or authority is created. Existing
currentness/withdrawal, original-owner inspection labels and display bounds
remain enforced. Two Rust and one existing adapter control are authored/NOT RUN.
Current counts are 42 synthetic-contract / 10 scorer / 28 retained / one counter
Rust cases and 49 presentation/controller / 25 session cases. That no-suggestion
increment added no new kind, frontend-owner source edit, runner/workflow or
original corpus mapping.
inv-model-only stays unbridged: #564's selected inventory-photo/description
outcome does not require a new document-subject comparison mode just to bridge
that fixture. Its manual is not relabelled; ordinary InventoryItem admission,
existing duplicate/edit intents and the 5/21/6 ledger remain unchanged.

Original qa-missing has one source-free structural bridge and two authored,
NOT RUN controls in `ai::suggestions::evaluation::retained_corpus`:
`retained_qa_missing_keeps_original_empty_retrieval_and_explicit_clarify_gap` and
`retained_qa_missing_refuses_fabrication_and_supplied_question_replacement`.
It preserves exact prompt, empty input/candidate/claim sets, clarify/no-answer,
original missing-coverage explanation and no-effects annotations, with explicit
null subject and empty display/inspection/selection lists. Scope/actor IDs,
request/registration/authority/cancellation identifiers are generated DATA;
hashing the retained prompt is not accepted-query digest custody or real request
capture. Neither synthetic current pins nor epoch replacements establish actual
cancellation/currentness, host publication, session binding or model abstention.
There are 28 authored/unrun retained tests; all 26 earlier adapters/tests and
four original corpus files are unchanged. Ledger is 5 scorer subsets / 21
structural / 6 unbridged. No scorer quality or new runner/workflow is added.

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
counts are 42 synthetic-contract / 10 scorer / 28 retained / one counter Rust
cases, plus 49 presentation/controller and 25 session cases. The 5/21/6 corpus
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
are authored/unrun. Shared Rust counts are 42 synthetic-contract and 10 scorer
tests; retained tests/ledger are 28 and 5 scorer subsets/21 structural/6 unbridged.
Original inv-model-only stays unbridged: its Document subject cannot be silently
relabelled as an InventoryItem. No inference, physical verification, approval,
native resolution, runtime activation or new runner/workflow is introduced.
For the earlier identity-unknown increment, the presentation donor was exactly
`474fb67c6a963b9c0971a4cb564ab5004c47d98e`, descended from e5281bd9; its five
changed owned paths were retained verbatim and CSS was unchanged. At that donor
increment, two authored presentation cases plus the shared session case brought
frontend selections to 41 controller/source and 20 session cases, all NOT RUN. The
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

The existing default backend-library set discovers exactly three private
`ai::host::continuation::continuation_healthy` cases: stop during original
review/authority checks, exact expiry during those checks using a private clock,
and unchanged one-time checkpoint claim. Disposable SQLite journal readback and
opaque fake prepared handles establish only local continuation fences and
unknown usage preservation. No actual approval, native domain, provider,
credential, mounted route or runtime activation is exercised. No workflow or
runner command is added; hosted case logs establish execution.

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
The existing topology-read case exercises a partial electrical record reader
with generated identity, location-semantics, circuit and evidence lists. It checks
all-four snapshot equality, selected revisions, repeated reads, retirement,
exact numeric provenance and refusal of withdrawn/disputed/superseded evidence.
Full record/reference closure and independent electrical-review authority remain
unavailable; the owner stays unmounted. These supplied controls are not native
Access revocation, ongoing freshness, a verified trace or device acceptance.
The frontend healthy list also runs `unified-atlas-network-trace-healthy.mjs`
(#552): the pure network route search over generated topologies, with no DOM,
browser, native host or source reads. The same list runs
`unified-atlas-electrical-group-healthy.mjs`: generated documentary membership,
room and unplaced projections, source separation and incomplete membership; no
browser, provider, native authority or wiring assertion. That file also runs the
#554 breaker/panel trace over the actual #557 projector and generated fixture:
reviewed group or fixture association, then current breaker, then panel, then
supplied room binding. It covers refusals, withheld/unknown states and static
detail markup. No live or saved host supplies electrical data yet; the optional
`AtlasPresentationEnvironment.electricalData` input stays unset.

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

Three additional #288 borrowed evidence-read controls are authored and **UNRUN**
in `healthy_local_atlas::evidence_read_controls`, discovered by the existing
default backend-library lane. Generated Viewer login/GET admission checks native
and MCP evidence get/list/history parity, null/Unicode payloads and the Editor
writer's original audit attribution. List controls distinguish connection reuse
from actual Access-session replacement and fence actor, query/options and the
complete authorized snapshot; a foreign-scope refusal is authorization evidence.
Saved history chains retain their watermark across strict SQLite-owner reopen
with the original Access owner, while fresh chains include later commits and a
new session for the same actor remains eligible. Full factual/audit/commit
contents are compared, excluding expected history-cursor bookkeeping.
This is not mounted Viewer admission, process/session restart, recovery or full
#288/#289 acceptance. No workflow, command, selection, deadline or trust pin changes;
all 83 SOURCE / 1 BUILD / 11 BROWSER selections (95 total) remain unchanged.

Two additional #288 controls in `http::agents::mounted_evidence_controls` are
registered only with `#[cfg(test)]` for the unchanged
default backend-library command. Genuine generated Editor setup mutations use
stock HTTP; the ordinary ReadOnly Host then serves mounted Editor evidence
get/list/history reads and refuses an unadmitted mutation. A genuine Viewer
performs one stock HTTP evidence GET, then mounted MCP initialization is refused.
Selected factual records/audits/commits are compared by content; legitimate
history-cursor and Access session/rate bookkeeping is outside that comparison.
No whole-database immutability, mounted Viewer admission, browser/device or full
#288/#289 acceptance is established. All existing selections, commands, limits,
deadlines and trust pins remain unchanged; exact-head hosted execution is pending.

At `b1d3f089`, backend job `131860016688` explicitly passed both mounted cases:
389 passed, zero failed, 12 ignored and three filtered, in 340.17 seconds.
Ubuntu source job `131860016629` failed `cargo fmt --all --check`; macOS source
job `131860016711` also failed, but its cause remains independently unknown.
Reviewed donor `840be37b` applies only the emitted test-file layout changes and
optional trailing commas. This repaired source is **UNRUN** until its own hosted
qualification; historical backend execution belongs only to `b1d3f089`.


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
runner's SOURCE list selects exactly `ai-suggestion-review.test.mjs` (forty-nine
controller cases) and `ai-suggestion-adapter.test.mjs` (twenty-five adapter cases).
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


Logical HomeBox collection identity amendment: exactly 126 UUID-only
`collectionId` schema leaves now use the original registration/access owner's
1..4096 Unicode-scalar text bound, preserving exact spelling. Every other schema
node, source/entity/resource/physical UUID, command, wire version and authority
check is unchanged. Current stock3/stock4, browser and native MCP pins follow the
amended source. Geodata's active predecessor closure records the amendment and
retains both original hashes; historical inspected-boundary evidence is unchanged.

Two new default-library controls cover actual StockValidation/AdmittedSnapshot
opaque bounds and native HomeBox descriptor materialization. The existing browser
schema-subset control adds full/derived parity and true-UUID refusals. These new
controls remain NOT RUN. Pure checked-in browser source generation used existing
pinned Node 26; no compiler, test, formatter or provider ran locally. Existing runner
counts remain 80 SOURCE / 1 BUILD / 7 BROWSER. The existing #586 writer separately
owns the original-fixture opaque cached-capture regression; selector/schema
acceptance alone does not establish that path, runtime admission or source access.

At preceding 0183afd6, hosted Ubuntu source, ordinary-core, capture, performance
and all three loopbacks passed. Backend/frontend/macOS were still pending at
this source handoff. Those checks do not qualify the amended source head.
The denied log/artifact-download route and PR metadata writes remain stopped.


The original-fixture cached-capture follow-up composes exact #588 `d6e2ce52`:
only suggestion_inputs_healthy.rs changes, preserving the ten UUID-fixture
controls and adding an eleventh test with unchanged `synthetic-collection-a`.
It uses real Core/Access/SQLite, cached dispatcher and admitted snapshot, exact
retained inspection evidence, then exact-partition withdrawal and refused
recheck/inspection. Independent static review is clean; this new case is NOT RUN.
No provider, model, original bytes, native write or runtime admission is qualified.
At parent ce7d838b the hosted backend library set, all three loopbacks, ordinary
core, capture and performance passed; frontend and both combined source gates
failed. Their accessible annotations expose only exit codes. Log/artifact
downloads remain stopped after Forbidden; no failure cause is invented and no
assertion, sandbox, budget, workflow or permission is weakened.


Prepared scalar specular source composition preserves exact #589 `9acac8c6`
on the b19e7d91 donor base without dropping later integration. The optional,
material-local finite scalar in [0,1] survives bake/compression, backend/frontend
admission, copied materials and opaque/glass shaders; unsupported texture/color
properties, required declarations and misplaced extensions remain refused.
Scalar-bearing primitives retain geometry/normals during bake. Existing bounded
compression snapping/reordering is unchanged, not byte-identical export.

Independent backend/bake and frontend/shader source reviews found no actionable
defect. This does not qualify pixels or private source fidelity. The existing
writer retains the two pixel fixture/assertion files; its first metal comparison
needs a visible-surface witness before equality can count as meaningful evidence.
Pixel controls are not included in this exact source composition. Existing 80
SOURCE / 1 BUILD / 7 BROWSER selections and 22 top-level bake tests remain unchanged;
source controls extend their existing selections. No new lane, security setting,
assertion removal, budget/deadline increase, private bake, release or deployment.
Restored renderer yields and all later suggestion/collection changes are kept.
The source/frontend/loopback1 failures at c1710cea remain unclassified because
accessible annotations contain only exit codes and denied downloads stay stopped.


The scalar pixel follow-up composes exact #589 `b7e0a7b2` after independent
static review. It extends the existing WebGL2 case with five generated scenes:
dielectric, mixed-metal, metal, glass and glass-metal at zero/half/one strength
and the internal shader fallback. Every canvas first needs visible surface versus
its own clear-background contrast; blank metal samples cannot qualify equality.
The half-strength controls must remain strictly inside meaningful endpoints.
This is actual shader-path source, not a private GLB/export or device result;
admission/copy/bake are separately authored controls, not inferred pixel evidence.
All new pixel controls are NOT RUN by this integration thread. Their added cost
must pass the unchanged 180-second outer case and existing renderer assertions.
No test selection, security flag, timeout, budget, release or activation changed.

The default backend-library set also discovers the seven
`lifecycle::persistent::receipt_identity_tests::` cases and one
`lifecycle::ai_account::tests::` case. Fresh synthetic loopback-local state with
a receipt reissued under other device numbers still reopens, backs up offline
and rebinds origin. Same-device replacement of either database or swapped
databases are refused by inode alone, and rollback refuses a legacy receipt
upgraded after a renumber. One pure case checks the binding predicate; the
AI-account case checks the same device tolerance and inode refusal for a selected
generated SQLite file. Disposable private folders only; no listener, provider,
real data or volume remount, so no actual reboot is observed. No workflow command
or runner is added.

The default backend-library set also discovers one
`http::response_layer::directory_index_tests::` case: through the actual router
of a disposable loopback-local Host with generated built files and no session, a
built folder with its own `index.html` (`/example/`, `/example`, `/saved/`)
answers 307 to exactly that entry, keeping a query; exact files and the root are
unchanged, and folders without an entry or paths starting with `//` stay 404. No
listener, gateway, browser or worker runs; no workflow command or runner is added.
