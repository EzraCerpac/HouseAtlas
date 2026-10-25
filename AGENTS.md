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

Inspect script bodies before running them. Use only the commands in README.md
and its linked [complete verification guide](docs/contributing/verification.md)
for ordinary verification. Healthy mutations are scoped synthetic examples.
Concurrency, denial and failure-injection tests are allowed only in the separate
regression lane bounded in README.md and its linked complete verification guide:
isolated disposable synthetic environments,
fake/local-only transports, no real credentials, live providers, user data,
populated production restore or deployment. This permission releases no G1–G5
and grants no new secrets or network permissions. The approved ordinary CI
scope is the existing workflows on pushes to `main` and pull requests
targeting `main`, including the existing `Verify the named Lantern healthy
read` step. This documentation correction adds no workflow, step or command.
Guard reversal, mutation/omission controls, adversarial and private-intake checks
remain held; replay, expiry, revocation and crash cases are not blanket released.
A case overlapping a held class must genuinely fit the exact approved three-class
scope and lane safeguards; otherwise it remains held. Broad suites and runtime
aliases are not released. Do not add wrappers or replacements to execute held
checks. Report exact source and scope of checks; ordinary success does not
certify security or deployment.

The owner-authorized healthy frontend aggregate (25 October 2026) permits one
Linux step in `.github/workflows/rust-react-ordinary.yml` that runs
`frontend/lantern-tests/run-healthy.mjs`. Its scope is the explicit list in
that file: named healthy generated checks with fake in-process or owned
loopback transports, plus the `offline-launch` and `hung-network` cases of
`offline-launch-browser.mjs` in the runner's Chromium against the built public
shell. It adds no globbing, concurrency, denial, failure-injection, expiry,
replay, control or intake case; those stay in their lanes. Adding a check to
the list changes this scope and needs the same owner review. No credential,
provider, household data, network permission or deployment is included.

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
