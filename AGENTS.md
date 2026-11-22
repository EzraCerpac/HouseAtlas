# HouseAtlas

HouseAtlas owns physical identities, reviewed cross-system bindings, optional
geometry, circuits, valves and provenance. HomeBox owns inventory, locations,
attachments and maintenance; its fields are read-only projections here and
edits use verified native links. Network passively reads stored source results
(HTTPS, or explicitly selected exact-loopback HTTP with an explicit port).
Browsing never sends collector demand, diagnostics, imports or upstream writes;
the backend requests collector diagnostics only for explicit authenticated Editor actions.
Named-Editor refresh may publish one inventory generation;
browsing and observation polling never publish inventory.

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

## Tests and CI

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

The existing `live-launch` browser case reads generated building records
and fills the native and electrical libraries through the live entry.
It measures both held PDF originals on the full-document profile
and the electrical original on the standard profile before offline reopen.
Both profiles use generated responses over disposable loopback TLS.

The pinned browser list also runs `mounted-capture-controls`,
`mounted-draft-lifecycle` and `unknown-attempt-locked-after-reopen`.
The mounted cases exercise picker events, current admission and retirement,
and local draft review and invalidation across two tabs.
The reopen case withholds strict IndexedDB completion from the store,
then reads the committed marker from an independent connection
before the one-use local handoff.
The existing `synthetic-save-reopen-remove` checks the persisted row fields,
owner and lifetime alongside exact original bytes and provenance.
These cases use generated files, fresh browser profiles and loopback fixtures.
The existing controlled IndexedDB error case also checks that a quota cause
arriving at transaction abort survives the earlier request error.

The per-lane case ledger (named cases, counts, fixtures and evidence limits)
lives in the [verification guide](docs/contributing/verification.md#ordinary-lane-case-ledger),
with scope changes also named here when a PR extends CI.

The explicit healthy frontend list selects the generated `desktop-library`
and `desktop-saved-pack` cases in pinned Chrome for Testing.
Desktop Library checks ordinary HomeBox open, exact retained PDF bytes and
pages, dedicated worker delivery from Cache Storage, measured storage totals,
controlled persistence outcomes, application eviction and signed-out reconnect.
The Saved pack case checks a generated partial pack, accessible keyboard
navigation and real worker identities through a resealed public build update.
It checks the old tab's exact worker bytes offline after the worker URL changes
and compares the retained pack against its original pins.
Both use disposable profiles and loopback.
Installed data, actual persistence grants and authorized edit dispatch
remain outside these cases.
The synthetic deploy suite has 64 methods.
Its union, rollback and prune fixtures check hashed Saved PDF worker retention.
The union and standalone rollback reject symlinks in generated frontend trees.
The rollback fixtures also check interrupted copies and same-name conflicts.
The existing Saved worker source case checks retained hashed URLs with and
without a pin table, refuses changed pinned bytes and verifies that a
reactivated shell survives the next update.

The default backend-library lane includes four generated mounted MCP cases
under `http::agents::mounted_evidence_controls::`:
`mounted_editor_batch_stale_child_refuses_without_partial_commit`,
`mounted_evidence_cursors_distinguish_query_and_access_issuance`,
`mounted_evidence_refuses_wrong_scope_and_invalid_input`, and
`mounted_cached_homebox_list_requires_current_partition_grant`.
The existing WebMCP bootstrap also runs three stock-mount cases for admission
and input refusal, replacement and unknown completion, and download presentation.
They use only disposable in-process owners or fake frontend ports.
The [case ledger](docs/contributing/verification.md#agent-access-synthetic-qualification)
records their exact evidence and limits.

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
(Python standard library only; reads repository files, runs none of the listed
commands) to compare that manifest with those files. Every new or changed run
step, step env or step option needs a matching manifest row; the check fails
otherwise. What it does and does not compare is in the verification guide.

PR lane selection is documented in [the CI dependency matrix](docs/contributing/ci-path-selection.md).
Main pushes retain the full ordinary suite. PRs always retain ordinary-core and
publication checks; recognized presentation/backend paths select explicit lanes,
with full coverage for shared or unknown changes. The ordinary-core job also runs
stdlib selector regressions using disposable synthetic Git histories and the
`tools/ci/check_lanes.py` cases over temporary folders.

The publication manifest `docs/publication/source-manifest.json` (format 2) lists
each source file's path, mode and owner. Adding, removing, moving or changing the
mode of a file needs `node tools/publication/refresh-manifest.mjs`; editing a
listed file does not ([details](docs/contributing/formatting.md#publication-manifest)).

The separately authorized Synthetic README media workflow captures only
checked-in generated fixtures through the actual React renderer and fake read
transports on an owned loopback server. Its scoped PR/main triggers and manual
dispatch upload ephemeral review artifacts with read-only repository permissions;
they add no ordinary check scope, persistent access, household intake, native
qualification or deployment. Generated media requires inspection before any
coordinated commit; the workflow never commits it automatically.

## Interface and pull requests

web/AGENTS.md governs interface text. Preserve accessible names, scope,
uncertainty, freshness, access and file availability. Use short functional
headings and guidance only when needed for the current action or state.

Scoped development PRs target main; there is no separate dev branch. Use one
integration writer and preserve donor ancestry. Resolve overlaps against the
current owner APIs, track review findings, and run only inspected authorized
checks. Composition does not accept donors or release product or deployment
gates; main still requires exact candidate review and CI.

When a pull request is authorized to merge, enable auto-merge
so GitHub merges it after the required checks pass.
Investigate failed or missing checks instead of bypassing the ruleset.

## Electrical room-join coverage

Related to #299. No case, runner, workflow command or case count is added.
The existing `unified-atlas-electrical-group-healthy.mjs` source entry runs one
generated room-placement ledger through the actual documentary projector,
drawing-group join and room-marker index. Receipt-bound members join their
rooms; an unresolved source component and an unmapped region stay unplaced.
Ten stale or withdrawn joins keep the same four-record inventory, and unplaced
records keep the unverified qualification. In seven (receipt, saved-versus-current
join and no-binding variants) every record is unplaced and the grouped members'
room lists are empty. In three (replaced native place, retargeted region,
unselectable occurrence) only the affected hall member is unplaced and the
living-room member is the only placed room. The check reads those member-room
lists; it selects no group, and the mounted selection and highlight path is not
exercised. The existing registration fixture file also checks that a retained
withdrawal is scoped to its feature, workspace and home. The offline
registration helper is not consumed by the Atlas, so no registered placement
reaches this view. Generated data only; no browser, native service or private
input, and no physical coordinate or circuit claim.

## Network overlay live facts

The default backend-library selection additionally discovers the three
`http::network_overlay::tests::healthy_network_overlay_` cases.
They use generated Network captures, private disposable review files and an
in-process authenticated joined-route fixture to check both native authorities,
source revocation, cache quarantine and final cache-baseline retirement, plus
identity joins, stale/absent facts,
ambiguity withholding, bounds and file/schema/digest fences.
No provider, socket, real data or operational installation is exercised.
The frontend healthy list adds `network-live-facts-healthy.mjs`
(closed decoder, legacy/unjoined preservation, stale/absent and refusal bounds),
and the existing overlay-source case checks the opt-in current-read extension
through its generated transport and fake original owners.
The inventory is 99 SOURCE / 1 BUILD / 16 BROWSER (116 total).
Ordinary-core's existing tools/ci discovery also selects one synthetic offline
candidate-helper method (34 methods total); no workflow command is added.

## Independent Network collector

`tools/network-collector/` owns fixed-schedule collection and its separate store.
Backend observation reads are passive; browsing never requests collection.
Backend diagnostics require explicit authenticated Editor actions.
Ordinary-core selects exactly the forty-two synthetic collector cases in
`tools/network-collector/core.test.ts` with pinned Node 26.10.0.
They use fake command runners/children, disposable SQLite, direct handlers and controlled clocks;
header authority refusals, command bounds/cleanup and cross-hour sample indexing are included;
stage 1 adds strict POST actions, busy ownership, local-time nightly scheduling,
speed parsing, explicit unavailable Wi-Fi, forward migration and bounded histories;
shared speed/ping exclusion, controlled-timezone DST transitions, detached-upload
response cleanup, persisted speed metric renaming and bounded missing-close
teardown with ping/action recovery are also included;
no real command, listener, private inventory or G1–G5 acceptance is exercised.
The measurements contract and explicit limits live in the tool README.

The default backend-library selection additionally discovers the six
`providers::network::collector::tests::healthy_collector_*` cases.
They use generated documents, a loopback-free injected GET peer and pure
origin/frame projections for collector joins, source-time freshness,
no-reply/unknown, decode bounds and disabled/generation-retirement behavior.
The existing Network mount selection and frontend `network-live-facts-healthy.mjs`
cases additionally check the optional setting and measurement frame fields.
No listener, real collector, provider, credential, household data or installed
acceptance is exercised; no command, runner or workflow is added.

The default backend-library selection additionally discovers five generated
`providers::network::observations::tests::healthy_*` cases
and four cases under `http::providers::network::tests::`:
`healthy_collector_routes_auth_revision_and_outcomes`,
`healthy_collector_routes_refuse_without_current_access`,
`healthy_collector_routes_refuse_changed_collector_inventory`,
and `healthy_collector_results_keep_only_revision_qualified_device_actions`.
They use controlled Tokio time, an injected GET/POST peer, generated originals,
disposable native Access/Store/sidecar custody and the in-process router.
They check observation-only scheduling, no overlap, bounded polls, backoff,
shutdown, absent task sets, result decoding, revision/freshness fences,
Editor/CSRF, authentication, workspace/home membership and source/partition/member
refusals with no collector calls, plus explicit collector action outcomes.
Device diagnostics require an expected inventory revision checked atomically
with collector target selection;
new device action history rows retain that selected revision,
and unqualified or mismatched rows are withheld from backend results.
The collector's two added cases cover the required revision field,
pre-selection inventory replacement and retained targets across guard awaits.
The existing persistent mount case checks interval/port configuration bounds;
the existing frontend `network-live-facts-healthy.mjs` selection additionally
checks typed property-results/action decoders and fake client exchanges.
Persistent observation polling selects only explicitly enabled exact-loopback collectors;
it reads stored observations into memory without enrollment, publication,
archive writes, principals or collector demand.
Explicit Editor diagnostics use the existing mutation-authentication owner;
there is no new durable journal or publication authority.
No real socket, collector, credential, household data, installation or G1–G5
acceptance is exercised by these cases; no CI run step is added.

## Independent now-playing helper

`tools/now-playing/` is separate from the Network collector.
It reads shairport-sync's metadata pipe and atomically replaces one bounded
`houseatlas.now-playing.v1` JSON file; it has no listener, database, network access
or playback control and knows no frequency or placement.
State comes only from observed classic-AirPlay or AirPlay 2 events and is `unknown` at startup;
a running helper, a dead receiver or a start event never implies playing.
`playing` means recent compressed audio input (`abrt`, needs `bitrate_stats_interval = 1.0`)
and falls to `unknown` five seconds after the last such report.
Readers treat a `checkedAt` older than 15 seconds as unknown.
Ordinary-core selects exactly the twenty-nine synthetic cases in
`tools/now-playing/core.test.ts` with pinned Node 26.10.0.
They use fake pipe streams, a controlled clock and disposable temp files, plus one
disposable temporary FIFO (the helper holds it open read-write):
split, malformed, truncated and oversize items, state and current-session track rules,
covers tied to their own track (classic RTP time, AirPlay 2 bundle) with type and size caps,
written once per change as content-addressed sibling files that the small snapshot names, expiry, reattach, heartbeat,
fixed one-second pipe retry, two path flags and exclusive temp-file replacement.
No shairport-sync, installation, backend route, interface, private data
or G1–G5 acceptance is exercised; no new runner or workflow command beyond that one step.
The snapshot contract is in the tool README.

## Atlas radio station

An optional pinned owner-reviewed profile (`--radio-station-profile` and its SHA-256,
`serve` only, absent by default) names one home, `stationPath`, the helper's snapshot path
and a nullable placement: one `spaceOccurrenceId` of one scene publication, never inferred.
`stationPath` is the operator's private file `{"frequencyKhz": N}` (integer kHz, 520–1710),
the one source of the transmitter frequency; it is written outside this repository, may be absent,
and is only read here, on each station GET, with the snapshot's private-file checks and a 256-byte bound.
Absent or invalid, the response carries `frequencyKhz: null` and the now-playing state is unaffected.
The scoped GET `/api/atlas/radio/v1/workspaces/{w}/homes/{h}/station` reads that file
(private, bounded, closed `houseatlas.now-playing.v1`) and returns it only when checked
within 15 s; a separate scoped GET serves the cover only when a fresh snapshot names its
SHA-256 and the sibling file matches it. No listener, poller, write or helper demand.
HouseAtlas knows only that AirPlay audio is arriving and the frequency the operator stated,
not that anything is broadcast. The Atlas polls about every four seconds only while visible
and shows a card only while the reading is fresh and playing: "Now playing · 1440 AM",
or just "Now playing" with no frequency (no dial). Freshness counts from the request's send;
expiry removes the card and rings on time, and a 401/403 from either route drops the reading
and its cover and stops polling until the Atlas remounts or the signed-in viewer changes.
The cover is fetched only while it would show (aborted once it would not; a tucked card still
counts as shown), with a deadline and three tries per digest.
Otherwise there is no card, tab or rings. The card floats over the stage without moving the rail
and is not announced; a chevron or a left swipe tucks it to a tab, kept on this device per viewer
and home. Decorative rings pulse from the placed room while the card would show, still under
reduced motion. No playback controls.
The default backend-library lane discovers five generated `config::radio_station::tests::healthy_radio_*`
and `http::radio_station::tests::healthy_radio_*` cases (disposable files and the in-process router);
the frontend healthy list adds `radio-station-healthy.mjs` (100 SOURCE / 1 BUILD / 16 BROWSER, 117 total)
with fake transport, timers, storage and visibility. No browser, helper, transmitter, household data
or G1–G5 acceptance is exercised; no workflow command is added.
The profile, snapshot, cover and station files must sit under directories only the backend's
account (or root) can write: the backend checks each file but does not anchor its opens to
directory descriptors, so it trusts those ancestors.

## Named-Editor Network inventory refresh

The default backend-library lane additionally discovers fourteen cases under
`http::providers::network::tests::refresh::`:
`refresh_auth_absence_and_named_editor`,
`first_refresh_registers_publishes_and_unchanged_renews_capture`,
`review_required_then_reviewed_profile_refresh_attaches_observations`,
`preflight_failure_recovers_on_same_store`,
`concurrent_refresh_returns_running_without_second_get`,
`failure_after_archive_reservation_keeps_previous_generation_readable`,
`post_reservation_contention_retains_custody_and_auth_failure_metadata`,
`interrupted_pre_stage_future_recovers_on_same_store`,
`two_partitions_refresh_independently_with_retained_disclosure`,
`deferred_auth_expiry_and_revocation_keep_reads_closed_until_authorized_recovery`,
`stale_deferred_failure_retires_without_replaying_metadata`,
`durable_quarantine_recovery_preserves_reviewed_inventory_baseline`,
`failed_revalidation_reports_durable_quarantine_after_reopen`,
and `uncaptured_quarantine_after_reopen_is_unavailable_without_a_definite_hold`.
The existing persistent profile selection also discovers
`network_refresh_profile_opens_writable_custody_only_for_named_editors`.
They use a test-only fake inventory HTTP leaf, generated Viewer/Editors,
disposable SQLite Access/Store/sidecar/archive and the in-process router.
They check opt-in writable custody without startup registration,
read-only absence, authentication/role/named approval/CSRF refusals,
first native registration/publication, unchanged capture renewal,
single-flight refusal, collector-down failure after archive reservation,
previous-generation reads without quarantine, same-Store failed-attempt recovery,
Core/sidecar contention and auth quarantine independent of deferred cleanup.
Revision mismatch returns `needs-review` without relaxing the pinned review;
normal mismatch exits during Editor preflight before durable archive admission.
Owner setup with the current review and Store/Host reopen permits publication
and observation attachment without another reopen.
The same lane discovers six `storage::store::cache_custody::pre_stage_tests::`
cases for consuming original-handle disposition, foreign-Store/native refusal,
bound/SQL/native reference protection, exact pin-only retirement,
Store read holds across candidate disposal and explicit RAM-only reopen limits.
The deferred-auth cases cover original grant expiry/revocation and stale failure CAS,
separately authorized fresh publication, unchanged reviewed inventory,
withheld Snapshot/pack/retained disclosure and unaffected partitions.
The default lane also discovers the generated archive-token cancellation case
`providers::network::archive::pre_stage_tests::pre_stage_archive_cancellation_requires_original_token_and_keeps_burned_id`.
It checks original issuer/registration/generation, checked cancellation retry
and permanent ID reuse refusal in disposable native archives.
Store hold controls cover all three Snapshot/pack readers, ReadCache and
retained pins, previous internal publication baselines, same-Store disposal,
RAM-only reopen and durable quarantine reopen, stale hold-version release,
and a hold activated during read authorization before release.
The default library selection also discovers
`providers::network::http::refusal_tests::inventory_refusal_preserves_observation_before_caller_recheck`
and `providers::network::failure_contract::verified_body_wrong_scope_is_a_source_refusal`.
They use constructed HTTP responses and generated inventory without a listener.
The transport refusal module also adds
`observed_inventory_refusal_survives_outer_cancellation_into_adapter`
and `inventory_completion_preserves_observed_denial_only_after_deadline`.
They deterministically cancel inside a fake GET and supply an expired completion
deadline, preserving only observed 401/403 denials with no response bytes or
origin witness; pre-cancelled, positive and status-less outcomes remain timed out.
The adapter receives Auth/source-refusal/AccessRevoked without a positive proposal.

The deferred-auth case also reads the mounted relation list and offline pack
with A held and B readable, checking every qualified B relation,
withheld A data and the existing authentication/release path.
The durable-reopen case checks Network and Storage failure responses against
both a quarantined and a fresh baseline, with no new RAM hold,
then verifies the successful fresh publication receipt.
The uncaptured-baseline case then refuses initial Store preparation under Core
contention, before any GET, both with a definite RAM hold and after durable reopen.
The shared HTTP response path preserves the definite hold but reports HTTP 503
when the baseline is unknown; a mounted registration failure also returns 503.
Cache facts, archive custody and collector call counts remain unchanged.
The existing root-router TLS fixture keeps its one-GET contract and deadlines.
The existing `network-live-facts-healthy.mjs` selection checks `mayRefresh`,
typed refresh outcomes, exact revisions and the one-POST client with fake fetch.
No run step, real service, credential, private profile, household data,
installation or G1–G5 acceptance is added.

The separate opt-in `tools/rust-integration/network-binary-loopback.py` runner
qualifies an explicitly selected production backend executable with generated
temporary accounts, profile, native cache and loopback collector JSON.
It uses production initialize/serve and public HTTPS routes;
the [verification guide](docs/contributing/verification.md#opt-in-network-refresh-through-the-production-binary)
records its invocation and HTTP-only boundary.
The companion opt-in `test_network_binary_loopback.py` checks elapsed bounds,
shutdown auditing and cleanup ordering with generated peers and fake processes.
It adds no default selection, workflow, installed configuration or live-device
acceptance.

The existing default-library and frontend lanes also gain three small generated
cases for #304 and #298, with no new runner, workflow, browser or native access.
`canonical-geometry.test.mjs --healthy` preflights the Full tier from accessor
counts over zeroed buffers, admitting exactly 4,000,000 triangles and 12,000,000
vertices and refusing one more of each. The default backend-library set discovers
`config::model_overview::detail_limit_tests::detail_file_one_byte_over_limit_is_refused_unread`,
a sparse temporary file one byte over the 256 MiB Full limit refused from its
metadata without reading it; the exact at-limit file is not exercised. The
existing `unified-atlas-healthy.mjs` case checks that publication B, sharing no
ids with A, ignores A's selection, level, building and layers, shows only its own
floor stack, and places none of A's overlay bindings. These are in-process
reducer, markup and binding checks, not a mounted replacement or acceptance.
