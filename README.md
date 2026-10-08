# HouseAtlas

HouseAtlas is an offline core for scoped physical identities and reviewed
bindings, with read-only HomeBox inventory projections and a passive Network
facet. It works without a floorplan. Checked-in fixtures are synthetic.

This development snapshot includes reviewed HTTP, transaction-local source
authority and browser DTO corrections. New explicit source-presence admissions
are disabled before writes until a separately reviewed atomic witness extension
is integrated. Ordinary results do not establish full product, security,
publication or deployment readiness.

Use Node **26.10.0** and npm **11.19.1**. Install the exact dependency locks:

```sh
npm ci --ignore-scripts --no-audit --no-fund
npm ci --prefix packages/contracts --ignore-scripts --no-audit --no-fund
npm run verify:publication
npm run build:ordinary
node --check packages/contracts/history/check-history.mjs
npm run check:http:ordinary
npm run test:ordinary
```

`verify:publication` checks the explicit current regular-file set, modes,
digests, logical ownership and unconfigured deployment template. Its manifest
is specific to this snapshot. `build:ordinary` checks syntax and six named
module builds; declaration checks are syntax only. `check:http:ordinary` runs
14 static compatibility, local schema and fixed valid history-example checks.
`test:ordinary` names exactly one healthy synthetic WHATWG Request group:
canonical single/batch mutations, qualified source claims, record/history/list
reads, three-field home DTOs and native links. It uses fake GET transports and
disposable local stores, opens no socket and calls no provider. The source-backed
binding example is `unresolved`; it exercises no new source-presence admission.

The adopted Lantern frontend uses the existing session, authorized view,
editing and command-result boundaries. Its original 44 authored reference files
remain unchanged in `frontend/lantern-reference/HouseAtlas-Lantern-B-Source.zip`.
See `frontend/lantern-reference/README.md` for source boundaries and capability gaps.
These inspected frontend commands check types, build source and project healthy
synthetic records only; they make no provider calls or real data mutations:

```sh
npm ci --prefix frontend --ignore-scripts --no-audit --no-fund
npm run typecheck --prefix frontend
npm run build --prefix frontend
node frontend/lantern-tests/healthy-read.mjs
```

Ordinary CI uses the same scoped commands, pinned actions/runtime and lockfiles.
Concurrency, denial and failure-injection tests are permitted only in the
separate regression lane below; they remain excluded from ordinary CI.
Guard reversal, mutation/omission controls, adversarial and private-intake checks
remain held. Healthy mutations are ordinary examples, not execution of those
control categories.
Retained control files and other module test aliases are outside this lane;
checking a control file's syntax does not test its behavior. Full security,
provider/native-route, recovery-fault, target, HTTPS, retention, actual-user/pilot
and production qualifications remain open. The URL credential-key predicate is
a heuristic and does not prove arbitrary source URL content credential-free.

A separate regression lane may run only exact reviewed concurrency, denial and
failure-injection cases in isolated, disposable environments containing synthetic
data. Use fresh temporary roots and disposable stores, with deterministic fake
transports or explicit loopback-only peers; disable external transport fallback.
Use synthetic identities, tokens and grants only. Real credentials, live providers,
user data, populated production restore and deployment are outside this permission.
G1–G5 and all other held classes remain unchanged; replay, expiry, revocation and
crash cases are not blanket released. An overlapping case must genuinely fit the
exact approved three-class scope and these safeguards; otherwise it remains held.

Before running, implementation owners must review the pinned source, exact named
cases and entrypoints (including imported helpers), synthetic inputs, temporary
roots, local endpoints, bounded runtime/resources and cleanup. Use an explicit
allowlist of those cases, never broad test discovery, aggregate module/runtime
aliases or wrappers that execute held controls. Keep this lane separate from
ordinary CI and its commands; adding a CI entrypoint requires its own exact scope
review. This policy adds no runner, alias, workflow, secrets or network permission.
Record the exact source pin, command, cases and outcomes; remove disposable state.
Lane success establishes only the reported synthetic regressions, not full security,
provider, recovery, target, pilot or production qualification. No newly permitted
suite is run as part of this policy update; owners add and run cases separately.
Existing stopped/unrun descriptions for these three classes record ordinary or
historical coverage; they do not prohibit an exact case satisfying this separate
lane. Descriptions of other held classes retain their existing force.

The core exports embeddable request/service modules; it provisions no service.
`config/deployment.example.json` is a typed unfilled template, not runtime
configuration or authority. Supply real settings privately only after the
corresponding gates. CI requires no secrets and performs no deployment.

See docs/core-integration/correction-3.md for the corrected behavior and held
capability, docs/publication/provenance.md for maintenance, and docs/operations
for generic target/recovery requirements. Open-source licensing remains a
decision for a future public release; no license has been selected.

The isolated Rust/React development slice adds an actual loopback TLS service,
SQLite sessions and persistence, authorized room/item reads and a compiled React
UI. Read [docs/rust-integration/README.md](docs/rust-integration/README.md) for its
explicit disposable settings, exact ordinary commands and remaining product
areas. Its positive browser smoke is separate from all stopped controls.

The `dev` branch combines development PRs before review and CI. Its assembled
source is provisional. The integration writer resolves overlaps, records donor
heads and tracks review corrections. The same ordinary workflows run on dev
pushes; cache publication remains restricted to verified main pushes. Main
acceptance still requires review of the exact candidate and passing CI.


One inspected ordinary synthetic local-session example (fresh private state,
strict reopen and in-process router only; no listener or held controls):

```sh
cargo run --offline --locked -p houseatlas-backend --example healthy-local-session
```

