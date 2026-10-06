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

Ordinary CI uses the same scoped commands, pinned actions/runtime and lockfiles.
Guard reversal, mutation/omission controls, adversarial, denial, failure injection,
concurrency and private-intake checks remain stopped and excluded. Healthy
mutations are ordinary examples, not execution of those control categories.
Retained control files and other module test aliases are outside this lane;
checking a control file's syntax does not test its behavior. Full security,
provider/native-route, recovery-fault, target, HTTPS, retention, actual-user/pilot
and production qualifications remain open. The URL credential-key predicate is
a heuristic and does not prove arbitrary source URL content credential-free.

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
