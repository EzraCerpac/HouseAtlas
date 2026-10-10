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

An explicitly named offline receipt example uses two fresh synthetic initialized
states and an exact SHA256-selected binary built from original source
`3016c5362daa89983f02c4790fc329a94eb43420`. It checks strict legacy refusal,
metadata-only upgrade, immediate exact-byte rollback, and a separate new reopen.
It opens no listener and admits no source or account. Its rollback proof covers
only the unchanged physical database cut before serving; it provides no rollback
acceptance after reads, authentication, checkpoints or record writes. Inspect
the complete example and compatibility owners before these local commands:

```sh
cargo build --offline --locked -p houseatlas-backend --lib --bin houseatlas
cargo clippy --offline --locked -p houseatlas-backend --lib --bin houseatlas -- -D warnings
cargo fmt --all -- --check
cargo run --offline --locked -p houseatlas-backend --example healthy-receipt-compatibility -- --legacy-binary /absolute/pinned/houseatlas --expected-legacy-binary-sha256 <verified-sha256>
```

Build and preserve the original binary in its separate clean checkout before
building the amended candidate. Use Rust 1.99.0 and a private disposable build
target. These commands do not stop or update an installed service.

A successful in-process native MCP example includes history continuation using
the actual first page's nonnull cursor. It retains the original authenticated
identity, target, query and audit IDs. It opens no listener, calls no provider,
and runs only the exact named local case after inspecting its full body:

```sh
cargo test --offline --locked -p houseatlas-backend --lib transports::mcp::healthy_local_atlas::healthy_local_atlas_native_mutations_batch_and_reopened_history -- --exact --test-threads=1
```

A separate successful display fixture preserves schema-valid original leap-second
timestamps and their offsets. It executes only the actual formatter and installed
format validator; relative and due-time arithmetic remains unchanged:

```sh
node frontend/lantern-tests/source-time-display.mjs
```

Two bounded provisional mesh examples use one generic synthetic triangle and
the actual lossless profile reader, transform preparation and React components:

```sh
node frontend/lantern-tests/scan-mesh-read.mjs
node frontend/lantern-tests/scan-mesh-view-visual.mjs
```

Inspect both complete bodies and their source-loader imports first. These checks
cover preserved authored tokens, exact transform chains, display buffers and
static accessible markup. They open no browser or listener and exercise no
WebGL effects, picking, GPU disposal or actual private export. The viewer remains
unmounted; original and derivative admission, physical scale, floor alignment
and guarded native import remain unqualified.

A source-free native place example creates a building and room with explicit
reviewed membership, then renames and clears only an Atlas classification label.
The browser fixture uses injected synthetic responses and exact retained tokens.
The native example uses a fresh empty persistent state, its actual local Editor
session, canonical HTTP batches and strict reopen; it starts no listener and
keeps MCP read-only. Inspect both complete bodies and imports before running:

```sh
node frontend/lantern-tests/native-place-write.mjs
cargo run --offline --locked -p houseatlas-backend --features serde_json/arbitrary_precision,serde_json/raw_value,jsonschema/arbitrary-precision --example healthy-native-place-labels
```

These examples preserve original evidence, exact elevations and revision guards.
They establish no provider admission or actual-household acceptance.

A separately reviewed native naming rehearsal uses a fresh empty synthetic
local Editor state and an exact private artifact-selection packet. It creates
and names Atlas places through the real frontend, checks explicit membership,
then serves a label-compatible fallback with its own compiled frontend against
the same database and v2 receipt before reopening the candidate. The packet pins
both binaries, complete frontend file sets, build records, Chrome and OpenSSL.
The runner confines all application requests to its disposable TLS loopback,
captures desktop and narrow views, and removes its owned processes and state.
Inspect the entire runner and exact artifact packet before this named command:

```sh
node --check tools/rust-integration/healthy-native-place-ui-loopback.mjs
node tools/rust-integration/healthy-native-place-ui-loopback.mjs /absolute/private/artifact-selection.json
```

This proves only the reported synthetic naming and compatible-code transition.
It does not update an installed service or establish household, provider or
official remote-client acceptance. The original legacy binary is unsuitable
after label-bearing writes; immediate legacy receipt rollback is limited to an
unchanged physical cut before any serving.

These named local examples remain outside automatic ordinary CI and establish
only their reported synthetic behavior.

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

A separately named topology read example uses generic Alpha/Beta records and
injected transports only. It checks the existing native invoke envelope,
pagination, exact binding joins, recorded elevation datums and unknown access.
Inspect its body and imports before running this local command:

```sh
node frontend/lantern-tests/topology-read.mjs
```

Two separately named successful read fixtures check exact retained number tokens
and versioned pinned-file requests. The numeric example uses the actual parser,
closed canonical result validator and geometry, topology, Network and AI clients.
The capture example uses the actual client with UUID v3 and opaque-collection v4
responses. Both use injected synthetic Response bodies, open no listener, and
call no provider. Inspect their full bodies and the explicit source-loader map
before running:

```sh
node frontend/lantern-tests/exact-numeric-read.mjs
node frontend/lantern-tests/pinned-capture-read.mjs
```

The loader compiles listed TypeScript source with the installed Vite compiler
and rewrites only imports for Node. It imports exact schema text for numeric
validation. These results preserve retained tokens; they cannot recover earlier
provider rounding or spelling changes and establish no capture, human-review,
security or deployment acceptance. Existing UUID v3 capture remains supported.

A native successful example validates v3/v4 pinned-file envelopes and exact
canonical retained numbers, then inspects only a fresh empty archive owner.
Inspect its body before this named command. The empty census establishes no
populated archive release, deletion or recovery authority:

```sh
cargo run --offline --locked -p houseatlas-backend --features serde_json/arbitrary_precision,serde_json/raw_value,jsonschema/arbitrary-precision --example healthy-exact-read-contracts
```

A separate core visual harness uses the unchanged Home, Rooms & places and
Network UI with the original generic topology fixture. It uses production read
clients with synthetic responses; Network loads only through its visible action.
After inspecting the three harness files and their imports, its scoped typecheck
uses a private config extending frontend/tsconfig.json with main.tsx included,
and its build uses the installed Vite compiler. For a manual preview, choose an
unused loopback port, capture the requested states and stop within 20 minutes:

```sh
cd frontend
./node_modules/.bin/tsc --noEmit --project /tmp/houseatlas-core-read-visual-tsconfig.json
./node_modules/.bin/vite build lantern-tests/core-read-visual --config vite.config.ts --outDir /tmp/houseatlas-core-read-visual-dist
./node_modules/.bin/vite lantern-tests/core-read-visual --config vite.config.ts --host 127.0.0.1 --port 4179 --strictPort
```

All other application fetches return unavailable in this dedicated page. Its
retained Network revision does not widen native provider admission or certify
authentication, source freshness, runtime security or actual-user acceptance.

The topology visual harness uses the same synthetic records, an injected topology client
and a stub for all other application fetches. After inspecting the harness,
use an unused loopback port and stop the server after the desktop and narrow
screenshots (at most 20 minutes):

```sh
cd frontend
./node_modules/.bin/vite lantern-tests/topology-visual --config vite.config.ts --host 127.0.0.1 --port 4178 --strictPort
```

These named examples are outside automatic ordinary CI. They establish only
the reported synthetic read and visual behavior, without provider, recovery,
private-house import or actual-user acceptance.

Ordinary CI uses its explicit workflow allowlist, pinned actions/runtime and
lockfiles. Separately named local checks are not automatic CI entrypoints.
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

A separately named native topology positive uses the actual disposable Store,
Editor HTTP login and mounted MCP stock commands. It creates generic Alpha/Beta
locations and reviewed memberships, preserves known zero and unknown elevation,
records typed access facts, and checks canonical get/history/audit lineage and
exact building-list pagination. It opens no listener or provider and contains no
household import, recovery or control scenario. After inspecting its full body
and invoked helpers, run only this named local example:

```sh
cargo run --offline --locked -p houseatlas-backend --example healthy-place-topology
```

This example is outside automatic ordinary CI entrypoints. Its result does not
establish visual, security, operator, pilot or deployment acceptance.
Observed local run on 2026-10-09: PASS, 95 MCP POSTs and 28 native commits,
with exact Alpha/Beta pagination and private fixture cleanup.

A separate local building-selector browser qualification uses the actual Rust
server, issued synthetic Editor session and native StockService. Six fresh
Atlas creates add one generic building, one floor with unknown elevation and
reviewed memberships to the original bound synthetic room. The real React
consumer reads one coherent topology frame, selects the building, opens that
room, and explicitly reads the native empty saved Network page. It uses a
fresh loopback TLS/browser profile and removes disposable state. Inspect its
complete source and helpers before this named positive-only local command:

```sh
TMPDIR=/tmp \
SOURCE_SHA=7e450a12037a4be19b2fa0553a6cde3e08b3cdcf \
HOUSEATLAS_CHROMIUM="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
HOUSEATLAS_BINARY="$CARGO_TARGET_DIR/debug/houseatlas" \
node tools/rust-integration/healthy-building-ui-loopback.mjs
```

Use the inspected Chrome 154.0.8037.98 and Node 26.10.0, with OpenSSL 3 on PATH.
The binary and frontend/dist must have verified build provenance for the stated
unchanged production pin. Optional HOUSEATLAS_EVIDENCE and
HOUSEATLAS_SCREENSHOT_PREFIX select private output paths whose parents exist.
This check is outside ordinary CI. It provides no populated Network/provider,
actual-household, recovery, security, operator, pilot or deployment acceptance.

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

The inspected Network pin fixture uses fresh synthetic state and exactly one
verified numeric-loopback TLS inventory GET. Its native publication, disclosure
pin counts `1→2→1→0`, unchanged post-publication Core state and cleanup passed on
Mac with OpenSSL 3.6.5 and a temporary directory under `/tmp`. The earlier default
tool environment failed certificate setup before any listener or native GET;
that failure's cause remains unproven. This case establishes no live-provider or
deployment acceptance and performs no reclamation or held controls. It is a
separate named check, outside ordinary CI:

```sh
cargo build --offline --locked -p houseatlas-backend --example network-disclosure-pin
python3 backend/src/providers/network/host_runtime/examples/pin-lifetime-loopback.py <compiled-network-disclosure-pin>
```


One inspected ordinary synthetic local-session example (fresh private state,
strict reopen and in-process router only; no listener or held controls):

```sh
cargo run --offline --locked -p houseatlas-backend --example healthy-local-session
```


One inspected ordinary synthetic quantity HTTP example uses fresh private state,
a fixed local HTTPS provider, genuine approval and native journal/readback. It
retains the end-unproven physical hold and does not retry or release it. The
reference directory contains the explicitly pinned public HomeBox source bytes.

```sh
HOUSEATLAS_QUANTITY_REFERENCE_DIR=/tmp/houseatlas-quantity-reference-e01dd737 TMPDIR=/tmp cargo test --offline --locked -p houseatlas-backend --lib http::quantity_http_healthy::healthy_quantity_human_http_preview_approval_native_journal_and_readback -- --exact --nocapture
```

The native place evidence positive uses one fresh disposable numeric-loopback TLS
service and generated one-page PDF. It creates a source-free native building,
loads actual Editor admission, commits one guarded evidence/asset/identity batch,
and checks original receipt, native reads/history and byte-identical download.
It creates no source Binding. It uses no household file, provider, real account,
retry/replay, failure/denial/control, frontend DOM or deployment. Inspect the whole
body, imports, owner APIs and the private artifact packet before this exact command:

```sh
node tools/rust-integration/healthy-native-place-evidence-loopback.mjs /absolute/private/native-evidence-artifact-selection.json
```

The packet pins one actually compiled native binary and build receipt, canonical
OpenSSL executable, and an empty owned private evidence directory. Port 48743
must be free; the positive stops if occupied. It never touches another service.
A source pass or this synthetic success does not authorize actual household intake
or establish PDF safety, frontend, device, rollback or installation acceptance.

## Fresh synthetic trusted gateway positive

The named ordinary example creates only private disposable state. It performs
one fresh local-to-proxy origin rebind and native session checks over its actual
Unix socket, using a simulated selected gateway identity. Inspect the full
`backend/src/http/trusted_gateway_healthy.rs` body before execution. It includes
no native Tailscale enrollment, real accounts, providers, denial, replay, expiry,
failure injection or populated restore case:

```sh
cargo run --offline --locked -p houseatlas-backend --example healthy-trusted-gateway
```


Opt-in local capture drafts are connected to the shared contextual Add evidence UI.
The following exact healthy examples use generated files and fake memory/session/
editing ports only, prohibit network, and remain outside automatic CI:

```sh
node frontend/capture-drafts-tests/combined-host.mjs --case healthy-save-review-commit
node frontend/capture-drafts-tests/combined-host.mjs --case healthy-canonical-published-binding
node frontend/capture-drafts-tests/combined-host.mjs --case explicit-clear-before-signout
```

These separately named cases are released only in the existing disposable,
synthetic concurrency/denial/failure-injection regression lane. They use fake
ports and storage, not actual accounts, sessions, provider calls or native outcomes:

```sh
node frontend/capture-drafts-tests/combined-host.mjs --case pending-canonical-late-context
node frontend/capture-drafts-tests/combined-host.mjs --case home-change-denies-reviewed-submit
node frontend/capture-drafts-tests/combined-host.mjs --case target-change-denies-submit
node frontend/capture-drafts-tests/combined-host.mjs --case cross-tab-invalidation-signal
node frontend/capture-drafts-tests/combined-host.mjs --case unavailable-probe-explicit-recheck
node frontend/capture-drafts-tests/combined-host.mjs --case cleanup-failure-known-commit
```

The one native positive uses the actual composed React bundle and locked Rust
binary with generated JPEG bytes, a new numeric-loopback TLS service and an owned
Chromium profile. Review and pin the complete frontend file set, source HEAD/tree,
binary, Node/npm, Chrome, OpenSSL and script/imports in a private exact-artifact
packet before execution. Use a fresh one-use private inspected Chromium snapshot,
an owned OpenSSL configuration if the installed tool requires one, and `/tmp`
for the native disposable directory. The body has an 83-second deadline and
bounded owned-child cleanup; synchronous filesystem stalls are separately
qualified. No real camera/device/account or provider is used:

```sh
TMPDIR=/tmp HOUSEATLAS_SOURCE_ROOT=/absolute/clean/source \
HOUSEATLAS_SOURCE_SHA=<verified-head> HOUSEATLAS_BINARY=/absolute/pinned/houseatlas \
HOUSEATLAS_CHROMIUM=/absolute/owned/pinned/chromium \
HOUSEATLAS_EVIDENCE=/absolute/private/result.json \
node frontend/capture-drafts-tests/combined-native-ui.mjs --case healthy-save-reopen-confirm
```

This checks normal opt-in save, close/reload/reopen, fresh review and explicit
one-shot confirmation, correlated acknowledgement, original download and consented
logout cleanup. It establishes synthetic composition only. The four proposal
cases `lost-fake-reply-inspect-only`, `malformed-receipt-keeps-original`,
`noncommitted-receipt-keeps-original` and `wrong-correlation-keeps-original` remain
held. No suite/alias, reply-loss, mutation-control, replay, expiry, revocation,
crash, actual cross-tab or real iPhone/Safari acceptance is released here.
