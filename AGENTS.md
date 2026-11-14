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

The per-lane case ledger (named cases, counts, fixtures and evidence limits)
lives in the [verification guide](docs/contributing/verification.md#ordinary-lane-case-ledger),
not here. A PR that extends CI names the added scope in the verification guide.

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
