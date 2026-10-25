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

Ordinary CI runs the existing workflows on pushes to `main` and pull requests
targeting `main`. In `.github/workflows/rust-react-ordinary.yml` that includes
the named Lantern healthy read; `frontend/lantern-tests/run-healthy.mjs` with
its explicit list, including the `offline-launch` and `hung-network` cases in
the runner's Chromium against the built public shell; and
`cargo test --locked -p houseatlas-backend --lib` with its default
(non-`#[ignore]`) set, skipping the three quantity tests that need
`HOUSEATLAS_QUANTITY_REFERENCE_DIR`; and the healthy `tools/rust-integration`
loopback flows named in the workflow and in the verification guide. A PR that
extends CI names the added scope here and in the verification guide.

The separately authorized Synthetic README media workflow captures only
checked-in generated fixtures through the actual React renderer and fake read
transports on an owned loopback server. Its scoped PR/main triggers and manual
dispatch upload ephemeral review artifacts with read-only repository permissions;
they add no ordinary check scope, persistent access, household intake, native
qualification or deployment. Generated media requires inspection before any
coordinated commit; the workflow never commits it automatically.

The separately authorized software release implementation permits
`.github/workflows/release-bundle.yml`: read-only validation of its scoped PR
paths with the inspected generated happy-path packaging checks, and explicit
`workflow_dispatch` build/promote operations on trusted `main`. Native build
profile, source/producer identity, storage compatibility and publication gates
remain enforced by that workflow. This exception adds no other ordinary CI
workflow, broad control suite, paid runner, credential/grant or settings change.
It authorizes no automatic NAS installation, service restart, household intake
or deployment; those remain with the existing runtime owner and target gates.

The owner-authorized standard-runner native qualification exception permits
`.github/workflows/current-source-intel-qualification.yml` on pull requests to
`main` touching that workflow or `tools/release/current-source-intel-qualification.py`.
Its scope is one standard `macos-15-intel` job per run, at most 60 minutes,
read-only repository permissions, exact Rust 1.99.0 and seven-day review artifacts.
The recipe pins product source `7cae5db05389cb5ca5cc97403975fa60d8f4cbcb`, its tree,
dependency lock and native-input digest. It may build that native binary, inspect
its ABI/provenance and run only these four generated healthy examples:
`healthy-native-full-geodata-profile`, `healthy-model-overview-read`,
`healthy-unified-atlas-read` and `healthy-unified-atlas-room-links-read`.
Standing permission for this bounded qualification class does not broaden the
checked-in trigger, runner, check set or immutable input pins. Changes to those
bounds need source-owner review before execution. No premium/paid runner,
new credential, access, security/network setting, household input, held control
suite, target operation or deployment is included. Actual artifact review,
release-profile adoption, storage compatibility and runtime/target acceptance
remain separate gates.

web/AGENTS.md governs interface text. Preserve accessible names, scope,
uncertainty, freshness, access and file availability. Use short functional
headings and guidance only when needed for the current action or state.

Scoped development PRs target main; there is no separate dev branch. Use one
integration writer and preserve donor ancestry. Resolve overlaps against the
current owner APIs, track review findings, and run only inspected authorized
checks. Composition does not accept donors or release product or deployment
gates; main still requires exact candidate review and CI.
