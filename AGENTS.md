# HouseAtlas

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
the named Lantern healthy read; the generated Electrical Library `healthy`
case (existing production reader/projection and fictional original bytes,
local fake owners only; no mounted PDF UI or native access); `frontend/lantern-tests/run-healthy.mjs` with
its explicit list, including the `offline-launch`, `hung-network` and
`live-launch` cases in the runner's Chromium against the built public shell
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
unified Atlas Plan with trusted wheel input in the runner's Chromium, and the generated Unified Atlas compact layer-details
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
(non-`#[ignore]`) set, skipping the three quantity tests that need
`HOUSEATLAS_QUANTITY_REFERENCE_DIR`; and the healthy `tools/rust-integration`
loopback flows named in the workflow and in the verification guide. A PR that
extends CI names the added scope here and in the verification guide.

`tools/ci/lanes.json` and the generated command inventory in the verification
guide are the authoritative list of `run:` steps in `ordinary-core.yml`,
`rust-react-ordinary.yml` and their composite actions under `.github/actions/`.
The ordinary-core job runs `python3 -B -I tools/ci/check_lanes.py --check`
(Python standard library only; reads repository files, no subprocess or network)
to compare that manifest with those files: triggers, workflow and job env, job
runner, condition, matrix and needs, and each run step's command, condition, env
and options such as `continue-on-error`, plus recorded case counts, prose claims,
toolchain pins and the generated table. It refuses workflow, job and run-step
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
