# HouseAtlas

## CI layout

The `Rust React ordinary core` workflow splits its checks into parallel jobs:
`source` (publication allowlist, generated contracts, fmt, clippy and the named
healthy examples; on macOS also the binary and the React app), `backend unit
tests`, `frontend checks`, and three `loopback flows` shards that each build
the binary and the React app. The commands are the ones listed in this guide.
CI builds use `CARGO_PROFILE_DEV_DEBUG=0`. Only main pushes save caches; the
Cargo cache holds compiled dependencies keyed by `Cargo.lock` and the toolchain.
Locally, `node tools/rust-integration/check-source.mjs` still runs everything;
the Linux `source` job passes `--skip-binary --skip-frontend` because other
jobs build those.

## Healthy frontend suite

`frontend/lantern-tests/run-healthy.mjs` runs every named healthy frontend
check listed in it, one process each, and prints per-check timings. The
`Rust React ordinary core` workflow runs it on Linux after the production build:

```sh
npm --prefix frontend run build
HOUSEATLAS_CHROMIUM=/path/to/chrome node frontend/lantern-tests/run-healthy.mjs
node frontend/lantern-tests/run-healthy.mjs --only offline   # subset by substring
```

Without `HOUSEATLAS_CHROMIUM` the browser checks are skipped and reported as
such. The list excludes regression, control, expiry, intake and handoff-directory
commands, including the session-policy, capture-draft controller and
native-place-levels-intake (concurrency) selections; those keep their own lanes below. A check added to this directory is
not run by CI until it is added to the list.

The same `frontend checks` job then runs the model bake tests
(`tools/model-bake/test/bake.test.mjs`) on generated geometry. They bake
generated masters to budget and run the viewer's own preflight, scene admission
and selector binding on the results, including the generated unified Atlas
publication densified and baked:

```sh
npm ci --prefix tools/model-bake
node --test --test-concurrency=1 tools/model-bake/test/bake.test.mjs
```

## Real-browser offline launch

`frontend/lantern-tests/offline-launch-browser.mjs` serves the built `dist/` on
an owned loopback listener, opens `/saved/index.html` once online so the Saved
and root workers install, then reopens `/` without a network and times how long
the Saved shell takes to appear. It uses generated build output only.

```sh
node frontend/lantern-tests/offline-launch-browser.mjs --case offline-launch
node frontend/lantern-tests/offline-launch-browser.mjs --case hung-network
```

`offline-launch` closes the listener (connection refused) and must show the
shell within 2 s with no network bytes; it is in the healthy suite.
`hung-network` keeps the listener open but never answers `/`, as on a captive
portal or a weak signal. It must show the shell within 3 s; the root worker
hands a silent navigation to Saved after 2 s. The listener may answer a
worker-script update check (`/offline-entry-worker.js`,
`/saved/service-worker.js`) during the reopen; any other served path fails the
case. Both cases are in the healthy
suite. Neither case is iOS, installed-PWA or live-model evidence.

## Real-browser 3D drawing

`frontend/lantern-tests/mesh-layer-browser.mjs` builds two generated pages (a
house of boxes and the embedded-material samples), serves them on an owned
loopback listener and draws them through MeshLayer, which renders with
three.js. It checks the backend, that a frame costs a handful of GPU calls
however many primitives there are, the selection tone, the ghost veil and the
texture detail in the screenshots.

```sh
node frontend/lantern-tests/mesh-layer-browser.mjs --case webgl2   # in the healthy suite
node frontend/lantern-tests/mesh-layer-browser.mjs --case webgpu   # local: Chromium headless shell
node frontend/lantern-tests/mesh-layer-browser.mjs --case bench    # prints per-frame CPU time and calls
```

`webgl2` offers no WebGPU adapter, so three.js uses its WebGL2 backend; it is in
the healthy suite. `webgpu` enables WebGPU on SwiftShader Vulkan. Full Chrome's
`--headless=new` draws it but leaves it out of screenshots, so run it with
Playwright's `chrome-headless-shell`. `bench` throttles the CPU 4× and prints
CPU time and GPU API calls per frame while the camera turns; it asserts nothing.
None of these cases is device, Safari or live-model evidence.

## Backend unit tests

The `Rust React ordinary core` workflow runs the backend library unit tests on
Linux, with Node 26.10.0 on `PATH` for the media fixture peers:

```sh
cargo test --locked -p houseatlas-backend --lib -- \
  --skip http::quantity_http_healthy:: \
  --skip providers::homebox::write::stock::quantity_flow_healthy:: \
  --skip providers::homebox::write::stock::quantity_installation_healthy::
```

Tests marked `#[ignore]` stay in their held lanes. The three skipped quantity
tests need `HOUSEATLAS_QUANTITY_REFERENCE_DIR` pointing at the pinned public
HomeBox source and remain a manual check.

## Loopback integration tests in CI

On Linux the `Rust React ordinary core` workflow also runs these healthy
loopback flows against the compiled `houseatlas` binary, a disposable TLS
loopback host and the runner's Chrome:

```sh
node tools/rust-integration/healthy-atlas-lists-loopback.mjs
node tools/rust-integration/healthy-mcp-lifecycle-loopback.mjs
node tools/rust-integration/healthy-operation-events-loopback.mjs
node tools/rust-integration/healthy-standalone-asset-loopback.mjs
cargo build --locked -p houseatlas-backend --example healthy-network-root-router
python3 tools/rust-integration/healthy-network-loopback.py "$CARGO_TARGET_DIR/debug/examples/healthy-network-root-router"
```

They need `HOUSEATLAS_BINARY`, `HOUSEATLAS_CHROMIUM` (for atlas-lists and
operation-events) and a built `frontend/dist`. Five loopback flows stay manual
because they need inputs that this repository does not carry: the three
native-place flows (`healthy-native-place-ui`, `healthy-native-place-evidence`,
`healthy-native-place-evidence-ui`) take a private Root artifact packet, and
`healthy-building-ui` and `healthy-contextual-capture` pin source commits from
the private development history.

## Generated annual-session integration regressions

Inspect `frontend/lantern-tests/session-policy-integration.mjs`, the production
`integration/session-expiry.ts`, `src/app/session-rotation.ts`, session client
and four timer call sites before these separate, explicit local selections:

```sh
node frontend/lantern-tests/session-policy-integration.mjs --case annual-expiry
node frontend/lantern-tests/session-policy-integration.mjs --case expiry-cancel
node frontend/lantern-tests/session-policy-integration.mjs --case explicit-rotation
node frontend/lantern-tests/session-policy-integration.mjs --case rotation-interruption
```

Use Node 26.10.0. These dependency-free cases transform the actual TypeScript
timer, session decoder, rotation transition and session transport with Node's
built-in transformer. The unrelated Atlas view decoder is replaced with a
throwing unused stub. A fake clock observes the annual timeout cap, backward
clock adjustment, absolute expiry, cancellation and replacement. Fake in-process
Responses observe explicit GET/CSRF POST/canonical GET order, held canonical
publication, unchanged actor/expiry, changed canonical cookie marker, unknown
POST completion, missing or changed canonical identity, and cancellation before
POST or after canonical read.

No listener, browser, native/session state, real credentials, provider or capture
request is used. These selectors do not test actual React mounting, all resource
owner lifecycles, native rotation/reclamation, global capacity recovery, capture
replay, security, browser/device acceptance or deployment. Frontend typecheck and
existing healthy reader checks remain separate and require locked dependencies.

The selected provisional overview consumer has this healthy generated check:

```sh
node frontend/lantern-tests/model-overview-read-healthy.mjs
```

It runs the actual view decoder and bounded GET reader with generated responses,
checks the optional service facet and exact descriptor/original frame, SHA and
byte pins on two fresh reads. It creates no listener, credential, household
intake, browser or deployment. Actual standard-GLB admission and browser mesh
rendering remain separate from transport success.

The isolated canonical IFC viewer check uses generated presentations, the
checked-in two-floor v2 artifacts and a fake read port. Inspect the runner and
its imports before this focused local command with Node 26.10.0 and the locked
frontend dependencies:

```sh
node frontend/lantern-tests/canonical-ifc-viewer.test.mjs --healthy
```

It covers artifact pins, logical rooms with multiple floor-qualified
occurrences, selection memory, overlay joins and CPU plan/3D picking. It also
reads one public closed-profile GLB without assigning rooms or floors. The
visual fixture at `/lantern-tests/canonical-ifc-visual/` supports `?fixture=a`,
`b`, `coverage`, `scene` and `local`. Actual browser layout and GPU checks are
separate. This command adds no live scene service, household intake,
application mount, deployment or held lifecycle/control-test permission.
The `--healthy` selection excludes the script's malformed-record, duplicate
admission, cancellation and artifact/manifest refusal controls. The default
mixed runner is not the ordinary command; this selection grants no permission
to execute held controls and changes no CI workflow.

The canonical mesh preparation check compares `prepareMeshes` byte for byte
with the frozen pre-optimization implementation on generated geometry only:
all six windings, signed zero, empty, degenerate, tiny and far-coordinate
triangles, unused vertices and 128 deterministic irregular meshes. It runs in
the healthy frontend suite:

```sh
node --test frontend/lantern-tests/canonical-mesh-preparation.test.mjs
```

The same `--healthy` command loads valid generated opaque core glTF materials
on a multi-primitive mesh reused by two nodes. It checks exact primitive colour
selectors, immutable linear RGBA factors, unchanged geometry and vertex bytes,
and palette fallback without an explicit factor. It also calls the production
source-colour resolver with opt-out, selection and reference presentation states.
These CPU positives do not establish shader output, GPU colour accuracy, PBR,
textures, vertex colours or source transparency; they add no held control case.

The persistent scan-cache check uses the actual native geometry reader, mesh
parser and IndexedDB adapter with a synthetic IndexedDB model and an owned
numeric loopback HTTP listener. Fresh module, client and cache instances stand
in for each reopened process; only the synthetic disk carries bytes between
them. It counts actual descriptor and mesh GETs for unchanged and updated
derivatives, explicit refresh, actor/home partitions, sign-out clearing, and
entry/byte eviction. Inspect the runner, persistence harness, synthetic store
and source-loading helpers before this exact Node 26.10.0 command:

```sh
node frontend/lantern-tests/native-geometry-persistence.mjs
```

This healthy local check uses generated bytes and no credentials, user data,
provider, browser or native state. Its simulated reopen is not a real browser
restart or installed-PWA result. Its floor keys change with derivative revisions
and licences, matching the native owner's version-dependent key behavior.

Three separate, exact regression commands exercise only synthetic quota injection,
cross-page clear concurrency and bounded unavailable-storage fallback. Inspect the runners and their shared helpers
before running them in the isolated synthetic regression lane:

```sh
node frontend/lantern-tests/native-geometry-persistence-quota.mjs
node frontend/lantern-tests/native-geometry-persistence-clear.mjs
node frontend/lantern-tests/native-geometry-persistence-budget.mjs
```

The quota case uses the same owned loopback GETs and a synthetic origin quota;
it verifies fallback, recovery, oldest-entry eviction and preservation of a
separate synthetic draft store. The clear case uses independent cache handles
and a shared synthetic transaction queue, delays actual hashing, and checks
that a durable generation fences pending writes after another handle clears.
It also uses the production logout/cleanup helper to cover a new page joining
while logout is pending; the clear follows completion of the server transition.
It opens no listener. The budget case pauses the synthetic database's transactions
and requires an actual server read within three seconds, rather than waiting
for the mesh reader's fifteen-second deadline; it also checks that warm memory
hits bypass storage. These cases use no credentials, user data, native service
or browser and do not prove browser/iOS durability. Expiry, revocation, malformed
storage and broad controls remain outside these commands.

The page-memory scan-retention check exercises the actual native geometry
reader and parser with generated bytes and an in-process fake transport. It
counts fresh descriptor reads and mesh downloads across normal warm opens,
explicit refresh, derivative/license updates, home and session changes, and
the six-entry bound. It opens no listener and uses no browser or native data.
After inspecting its runner and source-loading helpers, use Node 26.10.0:

```sh
node frontend/lantern-tests/native-geometry-retention.mjs
```

This command does not exercise the byte bound, session expiry, revoked access,
viewport layout or installed-PWA behavior. Cold process restarts retain no
private scan bytes. The passive shell viewport fixture requires separate
supported-browser review; it adds no ordinary browser command or layout
acceptance.

The retained USDZ padding compatibility check builds two tiny stored archives
in memory, with identical local/central alignment padding or the earlier
central-directory profile. It uses the actual native framing validator and
creates no listener, storage, account, import or household record. Inspect
`backend/src/media/geometry_original.rs` before this named healthy check:

```sh
cargo test --offline --locked -p houseatlas-backend --lib media::geometry_original::tests::healthy_stored_usdz_with_mirrored_alignment_padding -- --exact --test-threads=1
```

The upload diagnostic repair has these exact additional checks in the isolated
synthetic regression lane. They use generated in-memory multipart bodies or
fake client exchanges only, with no listener, native data, browser or provider.
Inspect the selected module, harness and imports before running a case.
The output is diagnostic evidence, never server commit or retry authority.

```sh
cargo test --offline --locked -p houseatlas-backend --lib http::upload::diagnostics::tests::bounded_private_schema_counts_and_worker_observer_separation -- --exact --test-threads=1
cargo test --offline --locked -p houseatlas-backend --lib http::upload::diagnostics::tests::actual_multipart_progress_preserves_bytes_and_failure_status -- --exact --test-threads=1
node frontend/lantern-tests/native-evidence-upload-diagnostics.mjs waiting-headers-transport
node frontend/lantern-tests/native-evidence-upload-diagnostics.mjs waiting-headers-deadline
node frontend/lantern-tests/native-evidence-upload-diagnostics.mjs caller-canceled
node frontend/lantern-tests/native-evidence-upload-diagnostics.mjs context-changed
node frontend/lantern-tests/native-evidence-upload-diagnostics.mjs reading-response-transport
node frontend/lantern-tests/native-evidence-upload-diagnostics.mjs reading-response-idle
node frontend/lantern-tests/native-evidence-upload-diagnostics.mjs response-validation
node frontend/lantern-tests/native-evidence-upload-diagnostics.mjs correlated-intake-rejection
node frontend/lantern-tests/native-evidence-upload-diagnostics.mjs owner-session-expired
node frontend/lantern-tests/native-evidence-upload-diagnostics.mjs exchange-session-expired
node frontend/lantern-tests/native-evidence-upload-diagnostics.mjs throwing-observer-transport
node frontend/lantern-tests/native-evidence-upload-diagnostics.mjs throwing-observer-intake-rejection
node frontend/lantern-tests/native-evidence-upload-diagnostics.mjs throwing-observer-committed
node frontend/lantern-tests/native-evidence-upload-diagnostics.mjs host-context-change-ordered
```


The separately reviewed room-to-source action uses generated data, fake
native document/geometry ports and a fresh sandboxed browser on an owned
loopback listener. Inspect its runner and imports, select Node 26.10.0, an
inspected HOUSEATLAS_CHROMIUM executable and a private
HOUSEATLAS_FIXTURE_EVIDENCE directory. These exact named cases are released
only in the same isolated synthetic regression lane; no provider, household,
old-request replay, security bypass or deployment permission is added.

~~~sh
node frontend/lantern-tests/native-room-drawing-source.mjs pdf-download
node frontend/lantern-tests/native-room-drawing-source.mjs png-legacy
node frontend/lantern-tests/native-room-drawing-source.mjs missing-correlation
node frontend/lantern-tests/native-room-drawing-source.mjs stale-correlation
node frontend/lantern-tests/native-room-drawing-source.mjs wrong-correlation
node frontend/lantern-tests/native-room-drawing-source.mjs lifecycle
~~~

These six named cases exercise the production association constructor and retained
support owner before the reader/drawing seam. The PDF case also checks explicit
review confirmation and a single fake/local-only transport stop retaining UNKNOWN.
See docs/geometry/native-room-drawing-source.md for the separately reviewed
current sheet-to-PDF correlation and download-only qualification.

HouseAtlas is an offline core for scoped physical identities and reviewed
bindings, with read-only HomeBox inventory projections and a passive Network
facet. It works without a floorplan. Checked-in fixtures are synthetic.

This development snapshot includes reviewed HTTP, transaction-local source
authority and browser DTO corrections. New explicit source-presence admissions
are disabled before writes until a separately reviewed atomic witness extension
is integrated. Ordinary results do not establish full product, security,
publication or deployment readiness.

Use Node **26.10.0** and npm **11.19.1**. Install the exact dependency locks:

Assistant-managed incremental scan planning uses selected retained versions and
the actual authored mesh decoder. Both commands require the locked frontend
dependencies (Vite, Ajv and Ajv-formats). Use an existing prepared cache; in a
clean checkout prepare it first with the existing named command:

```sh
npm ci --prefix frontend --ignore-scripts --no-audit --no-fund
```

Its synthetic local check is:

```sh
node --test --test-concurrency=1 tools/geometry/scan-replacement-plan.test.mjs
```

The separate assistant-native-import regression lane uses disposable synthetic
files and fake responses with the actual native geometry clients/decoder. It
checks bounded file selection, escaped wire-body durable journals, complete
pre-custody geometry capacity reservations, two-floor native intent
correlation, identical no-POST reuse and unavailable-response holds/passive
reconciliation. It makes no network, account, provider or household calls.
Capacity cases use current synthetic evidence and UTF-8 reason sizes; one case
makes at most forty small GET-only fake observations to locate a first-floor-fit,
later-floor-full capacity threshold, then checks zero custody POSTs.
Host coverage cases seed two synthetic current floors and check that incomplete
or oversized projected scenes stop before any further geometry custody.
The transport selector case uses an already aborted signal to check the exact
scoped scene-head list query; it stops before any curl process or network call.
Scope and callable selection contract are in [assistant native scan intake](../../docs/geometry/assistant-native-scan-import.md).
Inspect the complete tool/runtime/transport/test bodies before this exact check:

```sh
node --test --test-concurrency=1 tools/geometry/native-scan-import.test.mjs
```

That named fake-transport suite includes the adapter regression
`known scene non-dispatch durably exposes exact retained-document continuation
without claiming completion`: it reopens the retained continuation from the
journal and verifies passive inspection does not submit it.

The native admission metadata check provisions only two disposable synthetic
role/session fixtures before observing two in-process GETs. It checks separate
Editor/Viewer native lists, unchanged generic Stock/MCP lists and unchanged
database row counts. It creates no listener and calls no provider or live target.
Inspect the inline test body in `backend/src/http/agents/mod.rs` first:

```sh
cargo test --offline --locked -p houseatlas-backend --lib http::agents::tests::native_http_admission_keeps_stock_and_mcp_separate -- --exact --test-threads=1
```

The separate scene adapter checks use generated text, fake HTTPS responses and
the actual Stock/document/scene readers. Each invocation runs one named case;
none creates a socket, browser, database, credential or household record. Inspect
the complete adapter and runner bodies first. Scope and input contract are in
[the assistant scene adapter](../../docs/geometry/assistant-native-scan-scene.md) and
[native room target checks](../../docs/geometry/native-scan-room-targets.md).

```sh
node frontend/lantern-tests/native-scan-import-scene.mjs committed
node frontend/lantern-tests/native-scan-import-scene.mjs asset-unknown
node frontend/lantern-tests/native-scan-import-scene.mjs evidence-unknown
node frontend/lantern-tests/native-scan-import-scene.mjs association-unknown
node frontend/lantern-tests/native-scan-import-scene.mjs floor-selection
node frontend/lantern-tests/native-scan-import-scene.mjs literal-labels
node frontend/lantern-tests/native-scan-import-scene.mjs scene-reuse
node frontend/lantern-tests/native-scan-import-scene.mjs scene-replacement
node frontend/lantern-tests/native-scan-import-scene.mjs stale-current-scene
node frontend/lantern-tests/native-scan-import-scene.mjs changed-frame-current-scene
node frontend/lantern-tests/native-scan-import-scene.mjs supplementary-unicode
node frontend/lantern-tests/native-scan-import-scene.mjs compact-scene-head
node frontend/lantern-tests/native-scan-import-scene.mjs viewer-inspect
node frontend/lantern-tests/native-scan-import-scene.mjs native-room-target
node frontend/lantern-tests/native-scan-import-scene.mjs native-room-target-explicit-null
node frontend/lantern-tests/native-scan-import-scene.mjs native-room-target-other
node frontend/lantern-tests/native-scan-import-scene.mjs native-room-target-floor-direct
node frontend/lantern-tests/native-scan-import-scene.mjs native-room-target-many-to-one
node frontend/lantern-tests/native-scan-import-scene.mjs native-room-target-invalid
node frontend/lantern-tests/native-scan-import-scene.mjs native-room-target-wrong-classification
node frontend/lantern-tests/native-scan-import-scene.mjs native-room-target-duplicate-classification
node frontend/lantern-tests/native-scan-import-scene.mjs native-room-target-wrong-scope
node frontend/lantern-tests/native-scan-import-scene.mjs native-room-target-owner-withdrawal
node frontend/lantern-tests/native-scan-import-scene.mjs retained-documents
node frontend/lantern-tests/native-scan-import-scene.mjs retained-documents-unknown
node frontend/lantern-tests/native-scan-import-scene.mjs retained-documents-before-dispatch
node frontend/lantern-tests/native-scan-import-scene.mjs scene-import-before-dispatch
node frontend/lantern-tests/native-scan-import-scene.mjs scene-import-prepare-refresh
node frontend/lantern-tests/native-scan-import-scene.mjs scene-import-hook-refusal
```

After inspecting the tool, test and source-loader imports, the assistant can
retain a private, create-only proposal from explicitly selected local files:

```sh
node tools/geometry/scan-replacement-plan.mjs /absolute/private/selection.json /absolute/private/NEW-artifact-directory
```

The artifact preserves version/receipt/identity/overlay evidence, object diffs
and reversal references. It does not submit custody or native replacement;
current-head freshness and new-frame acceptance remain separate. See
[assistant scan replacement](../../docs/geometry/assistant-scan-replacement.md) for
input bounds, retained native successor compatibility, frame applicability and
the required fresh native descriptor/scene reads after any replacement.

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
cargo clippy --offline --locked -p houseatlas-backend --lib --bins --examples -- -D warnings
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

Bounded provisional mesh examples use one generic synthetic triangle and
the actual lossless profile reader, transform preparation and React components:

```sh
node frontend/lantern-tests/scan-mesh-read.mjs
node frontend/lantern-tests/scan-mesh-view-visual.mjs
node frontend/lantern-tests/scan-plan-orientation.mjs
```

Inspect the complete bodies and their source-loader imports first. These checks
cover preserved authored tokens, exact transform chains, display buffers and
static accessible markup. They open no browser or listener and exercise no
WebGL effects, picking, GPU disposal or actual private export. These examples
establish no native availability, physical scale, floor alignment or actual
guarded native import.

The orientation example uses 48 asymmetric synthetic camera configurations to
compare the shared SVG and WebGL scan projection. It preserves source tokens
and checks only the display basis; it performs no native import or private read.

A separate native geometry read example uses only two synthetic streamed
Responses and the actual closed native descriptor client and profile reader.
It preserves u64 revision tokens, native hash field names, owner-offered paths,
current frame/floor identity and the existing unknown physical qualification:

```sh
node frontend/lantern-tests/native-geometry-read.mjs
```

Inspect its complete body and source-loader imports before this exact command.
It opens no listener or browser, constructs no native authority, imports no
private export and runs no timeout, denial or failure-control scenario. The
host mount and actual native Media availability require separate qualification.

The native-produced reader bridge is one paired healthy synthetic case. Inspect
the Rust emitter, complete frontend reader and source-loader imports first.
Choose a new evidence directory under an existing canonical private owned parent:

```sh
HOUSEATLAS_GEOMETRY_SEAM_EVIDENCE=/absolute/private/NEW-synthetic-geometry-seam cargo run --offline --locked -p houseatlas-backend --features serde_json/arbitrary_precision,serde_json/raw_value,jsonschema/arbitrary-precision --example healthy-native-geometry-custody-first
HOUSEATLAS_GEOMETRY_SEAM_EVIDENCE=/absolute/private/NEW-synthetic-geometry-seam node frontend/lantern-tests/native-geometry-produced-read.mjs
```

The producer retains exact authenticated in-process GET bytes and allowlisted
response headers only after its existing strict reopen and scratch cleanup.
The reader uses those same bytes through the actual native client and mesh
decoder, with two fake GETs and no network. Failed emission attempts to remove its newly created private directory; the
operator verifies cleanup if removal fails. An existing output directory is
never adopted. This case establishes no converter authenticity, browser, household
intake, physical alignment or mounted availability.

Historical native evidence request inspection has two individually selected
healthy read cases. Inspect the complete body and its finite production imports:

```sh
node frontend/lantern-tests/native-evidence-request-read.mjs healthy-committed-observation
node frontend/lantern-tests/native-evidence-request-read.mjs healthy-unknown-observation
```

Each uses an admission GET and an exact UUID lookup GET with synthetic Responses,
the production lossless parser and closed result validator. Neither sends a POST
or changes upload state. A committed observation is separate from another tab's
attempt and original-byte proof; an unknown observation establishes no rollback
or retry safety. Browser/session-change acceptance remains separate.

Two documentary overlay examples use generic local data and the actual model or
static React panel. Network connections remain schematic; the examples derive
no floor positions or physical routes. Electrical labels preserve source
statements and owner-reported or inferred room associations separately:

```sh
node frontend/lantern-tests/network-overlay-read.mjs
node frontend/lantern-tests/electricity-overlay-read.mjs
node frontend/lantern-tests/electricity-fixture-read.mjs
```

Inspect all three complete bodies and their installed Vite/source imports first. They
open no listener, call no provider and perform no native import. The modules
require a separately qualified host/data seam before native availability.
The fixture example uses synthetic source symbols and static React markup;
an unmatched room has no implicitly selected drawing or source action.

A separate successful in-process geometry example uses an empty disposable native
state and its actual local Editor session. It saves a synthetic USDZ framing
original and its immutable closed-profile derivative as two distinct asset
roots, then commits the three-child building association through canonical
HTTP. It validates retained correlation, exact delivered bytes, server-owned
import time, history and strict reopen. Inspect the complete example and native
geometry/Media owners before this exact command:

```sh
cargo run --offline --locked -p houseatlas-backend --features serde_json/arbitrary_precision,serde_json/raw_value,jsonschema/arbitrary-precision --example healthy-native-geometry-custody-first
```

The separate successful scene-association example starts with empty disposable
local state and an actual native Editor session. It retains synthetic text and
floor originals, records an explicit reviewed association, then strictly reopens
the store before reading the current head. A second version preserves its
predecessor and both versions' original and canonical-receipt pins through
authenticated get, list and history reads. Inspect the complete example before
this exact command; it opens no listener or provider and uses no household data:

```sh
cargo run --offline --locked -p houseatlas-backend --features serde_json/arbitrary_precision,serde_json/raw_value,jsonschema/arbitrary-precision --example healthy-native-scene-association
```

This positive establishes only synthetic native persistence. It supplies no
live installation, household intake, older-binary compatibility or failure,
replay, revocation, interruption or concurrent-write qualification.

A separate successful scan-succession example retains two synthetic floors,
then appends version 2 of only one floor against its current same-building
predecessor. It refreshes both descriptor keys and records two freshly guarded
scene bindings, retaining original custody, geometry/scene history, stable room,
elevation, device and circuit identities. Strict authenticated reopen uses the
actual in-process Axum/SQLite/vault/Stock owners. The TypeScript positive uses the
production association/read clients and closed schemas with local fake responses.
Inspect both complete bodies and their imports before these exact commands:

```sh
cargo run --offline --locked -p houseatlas-backend --features serde_json/arbitrary_precision,serde_json/raw_value,jsonschema/arbitrary-precision --example healthy-native-scan-succession
node frontend/lantern-tests/native-scan-succession.mjs
cargo test --offline --locked -p houseatlas-backend --lib media::geometry_bundle::tests::bounded_history_and_retired_pair_preflight -- --exact --test-threads=1
```

These successful synthetic checks open no listener, use no household files or
provider, and perform no live import, physical registration or deployment.
The named in-memory metadata correction case checks a 64-version history,
the 65th-row bound, retired custody-pair reservation and ordering before missing
local vault bytes. It writes no native records and releases no broader controls.
Guard reversal, omission, replay, interruption and private intake remain held.
See [native scan succession](../../docs/geometry/native-scan-succession.md).

The separate issue #149 acceptance lane checks only synthetic room-anchor
rejections and successful retained association/readback. Inspect both complete
entrypoints and their imports before these exact commands; the native example
uses an in-process router with no listener, and the browser uses owned Chromium
with synthetic ports. See [case scope and limits](../../docs/geometry/issue-149-room-anchor-acceptance.md).
These commands remain outside ordinary CI and do not release other held checks.

```sh
CARGO_TARGET_DIR=/tmp/houseatlas-issue149-target cargo run --offline --locked -p houseatlas-backend --example issue-149-room-anchor-acceptance
HOUSEATLAS_CHROMIUM="/absolute/path/to/inspected/chromium" node frontend/lantern-tests/issue-149-room-anchor-acceptance.mjs
```

The fixture has synthetic USDC-signature framing and does not execute usdcat or
establish USD scene semantics, original/derivative conversion authenticity,
physical placement, actual household intake or recovery/fallback compatibility.
It opens no listener, contacts no provider and runs no failure or denial case.

The separate issue #148 regression lane uses an injected synthetic association
client and owned Chromium to check read-only current-head visibility, unavailable
read context, initial head-synchronization locking, subscription-time binding
invalidation, create admission withdrawal, unknown-outcome recovery,
draft-discard confirmation and scene refresh after successful resolution. Inspect the test and
[issue-specific limits](../../docs/geometry/native-scene-readonly-association.md) before this
exact command. It serves only generated UI assets from an owned loopback listener;
it uses synthetic IDs and responses, no account, provider, household data or
application service, and remains outside ordinary CI:

```sh
HOUSEATLAS_CHROMIUM="/absolute/path/to/inspected/chromium" node frontend/lantern-tests/native-scene-readonly-ui.mjs
```

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

The assistant-managed place-intake seam also supports accepted floor, room and
other classifications, with optional reviewed membership under an existing
building or floor. The client allocates every native record ID in its existing
batch and keeps floor elevation absent unless a separate reviewed workflow
provides it. See [assistant-managed native place intake](../../docs/geometry/assistant-native-place-intake.md).
Its focused synthetic check uses only an in-memory fake transport:

```sh
node frontend/lantern-tests/native-place-levels-intake.mjs
```

This checks native batch composition, parent revision guards, client-issued
preparation use and a non-replayed commit with the genuine JCS request digest.
It also pauses digest computation and verifies that a second independently
prepared form submission is rejected before fake transport dispatch, then can
be deliberately committed after the first finishes. It opens no listener,
reads no household/provider data and performs no native write.

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

The native offline backup example creates a source-free synthetic building through
canonical HTTP and an owned DownloadOnly PDF through the actual native mutation
owner under its original Access transaction fence. It captures a closed,
queue-free image, validates the full native manifest and retained original, then
restores and reopens only a separate disposable state. It compares source Atlas,
Access and receipt bytes unchanged. The direct PDF commit is not an HTTP upload
claim. Inspect the complete body and recovery owners before this exact command:

```sh
cargo test --offline --locked -p houseatlas-backend --lib media::budget::tests::offline_backup_has_finite_budget_without_widening_general_work -- --exact --test-threads=1
cargo run --offline --locked -p houseatlas-backend --features serde_json/arbitrary_precision,serde_json/raw_value,jsonschema/arbitrary-precision --example healthy-native-offline-backup
```

The explicit `houseatlas backup` command requires a separately quiesced,
sidecar-free original state and an absent private destination. Its
`native-stock-queue-free` profile includes Atlas records and owned originals;
Access, sessions, credentials, configuration and provider originals are excluded.
Unexpected queues or unsupported Media policy owners refuse capture. Failure
can leave destination bytes and establishes no safe retry. This example does
not stop an installed service, schedule backups or qualify populated production
restoration.

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
npm run check:backend-frontend-compat --prefix frontend
node frontend/lantern-tests/healthy-read.mjs
```

The scene overlay keyboard check uses synthetic inputs to verify pressed-state
semantics, keyboard activation and pointer selection:

```sh
node frontend/lantern-tests/scene-controls-keyboard.test.mjs
```

Its browser check builds the same component with production styles, then uses
an inspected local Chrome executable, a fresh owned profile and an ephemeral
`127.0.0.1` fixture server. It uses only synthetic inputs and makes no provider
or external network requests. This isolated harness does not qualify the normal
browser path. Inspect its full body first and use Node 26.10.0:

```sh
HOUSEATLAS_CHROMIUM="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
node frontend/lantern-tests/scene-controls-keyboard-browser.mjs
```

If the sandbox denies the loopback bind, rerun only this inspected fixture
through the approved local-test route.

Issue #150 has nine separately selected drawing pagination browser checks.
Inspect the complete runner, its production component and its synthetic PNG
fixture before these exact commands. Use Node 26.10.0, an inspected browser and
an owned private output directory outside the checkout:

```sh
export HOUSEATLAS_CHROMIUM=/absolute/inspected/chromium
export HOUSEATLAS_FIXTURE_EVIDENCE=/absolute/private/drawing-150-result
node frontend/lantern-tests/native-scene-drawing-150.mjs --case first-match
node frontend/lantern-tests/native-scene-drawing-150.mjs --case middle-match
node frontend/lantern-tests/native-scene-drawing-150.mjs --case last-match
node frontend/lantern-tests/native-scene-drawing-150.mjs --case missing-match
node frontend/lantern-tests/native-scene-drawing-150.mjs --case page-bound
node frontend/lantern-tests/native-scene-drawing-150.mjs --case close-cleanup
node frontend/lantern-tests/native-scene-drawing-150.mjs --case selection-during-open
node frontend/lantern-tests/native-scene-drawing-150.mjs --case selection-after-show
node frontend/lantern-tests/native-scene-drawing-150.mjs --case blob-read-failure
```

The runner mounts the actual drawing component with fake document ports, uses
numeric loopback static content and a fresh owned browser profile, and removes
its scratch state within a 120-second budget. No provider, account, household
file or external transport fallback exists. Selection races and the Blob failure
belong only to the separate synthetic concurrency/failure-injection regression lane;
these cases are outside ordinary
CI and do not qualify native grant revocation, original verification or deployment.
See [the issue-specific scope](../../docs/geometry/drawing-evidence-lookup-150.md).

The generated-only pdf-navigation case exercises the in-app PDF.js canvas with
an in-memory 18-page A0 PDF whose pages have distinct synthetic labels, page
colors and a four-color JPEG2000 image. It checks local decoder, CMap and font
resources, viewport fit, nonblank canvas pixels and three stable page captures for
page 12 through 18, then verifies a pixel-changing zoom, page/zoom reversal,
and close/reopen at 390×844. It uses an owned loopback browser fixture and is
outside ordinary CI. Inspect the complete runner, generated PDF builder, and
NativeSceneDrawing before running. The PDF exists only in memory and the
fixture's private output contains the bounded browser report, not PDF bytes.
PDF.js, its worker, OpenJPEG/JBIG2 WASM and JavaScript decoders, CMaps and standard
fonts are bundled locally in the lazy drawing reader; no PDF
bytes or URLs are sent to a viewer service. The PDF.js worker is emitted as a
`.js` asset for the current backend MIME allowlist; the backend compatibility
check also verifies every output file is an allowed type and at most 4,000,000
bytes. PDF.js's Apache 2.0 license and notice remain in the public source at
`frontend/licenses/` and are not copied into the compiled server asset tree.

HOUSEATLAS_CHROMIUM=/Applications/Google\ Chrome.app/Contents/MacOS/Google\ Chrome HOUSEATLAS_FIXTURE_EVIDENCE=/absolute/private/pdf-navigation-result node frontend/lantern-tests/native-room-drawing-source.mjs pdf-navigation

The retained fixture reader has named positive cases for the generated source
and native room projection using fake current document/geometry/topology ports.
Inspect its full body and listed production imports before this narrower local
command. It opens no browser or listener; it establishes no native retention or
household source availability. Use the pinned Node 26.10.0 runtime and an owned
evidence directory outside this checkout:

```sh
HOUSEATLAS_FIXTURE_EVIDENCE=/absolute/private/fixture-reader-only node frontend/lantern-tests/native-scene-fixture-reader-healthy.mjs --reader-only
```

The broader browser flow in `docs/geometry/native-scene-fixture-reader-healthy.md`
requires its own inspected browser artifact and execution selection; it is not
released by this reader-only command.

Two separately named build/resource checks compile the actual drawing and native
host fixtures with the PDF resource plugin and GET the worker and decoder files
from their owned loopback servers. Inspect both runners and
`frontend/lantern-tests/pdf-fixture-resources.mjs` first. Use the pinned runtime
and locked frontend dependencies. These checks launch no browser, use generated
inputs only, remove disposable state and remain outside ordinary CI:

```sh
node frontend/lantern-tests/native-scene-drawing-150.mjs --case first-match --build-only
node frontend/lantern-tests/native-scene-fixture-reader-healthy.mjs --host-only --build-only
```

They verify exact upstream worker/decoder bytes and JavaScript MIME responses;
they establish no rendered PDF pixels, interactive behavior or device coverage.

The named `--host-only` synthetic browser case mounts the production native
scene source action with a generated, current PDF reference and fake document
owner. It checks that the current sheet renders the referenced page with a
download action, and that a stale source reports its refusal without opening a
document. It uses an owned loopback listener and disposable browser profile,
and reads no household data:

```sh
HOUSEATLAS_CHROMIUM=/absolute/inspected/chromium node frontend/lantern-tests/native-scene-fixture-reader-healthy.mjs --host-only
```

The native room projection keeps stored `native-scene-source.v2` targets
package-only. It accepts a nullable native ID only from the current room
mapping, pinned to the exact current and historical scene documents and joined
by source room, full ordered anchors, package key and UUID. A visible room
action appears only while current topology membership confirms that ID in the
selected building.

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

A separate core visual harness uses Home and the Atlas Rooms & places and
Network lenses with the original generic topology fixture. It uses production
read clients with synthetic responses; saved Network relations load only through
their visible action. Existing Rooms and Network route aliases resolve to Atlas
lenses. Opening a lens mounts its existing source content; closing it ends those
reads. A building-section document without a map unmounts while a lens replaces
it, rather than continuing a second hidden topology read.
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

The Atlas workspace keeps a spatial map mounted beside either lens. Expand
reads the lens wide with an inert map inset; Show map returns to Beside. Opening
a record from a lens can temporarily enter Reading; closing it or leaving Atlas
releases only that exact presentation claim. A later explicit Map, source, lens
or Expand choice wins. Native model rooms and HomeBox places retain their own
identities and source qualifications; composition creates no inferred join.
The native logical graph remains tied to the Network layer, while saved relation
reads retain their separate visible action. The standalone saved viewer keeps
its own graph presentation and does not acquire the live workspace lenses.

The existing named healthy-read loader exercises the actual store reducer and
Search route helper through temporary compiled-module exports, including route
aliases, selection retention and conditional Reading release. These exports do
not enter product modules. Generated browser review is separate: check both the
fictional room fixture and generated source-host fixture at short landscape and
narrow portrait sizes, lens title/action separation and body reachability,
kind-change scroll reset, same-kind scroll retention, focus/inert behavior and
record/source transitions. CPU results alone do not establish those behaviors.

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

## Login rate keys and multi-home issuance

`backend/src/access/login_regression.rs` holds four ignored exact cases with an
in-memory Access store, a fixed clock and synthetic identities. They open no
listener and use no provider or real credential. Inspect the module and its
`access` imports before each separate command with Rust 1.99.0 and an owned
disposable Cargo target.

These two healthy cases check client-key normalization (IPv4 host, mapped IPv4,
IPv6 /64, loopback and link-local) and one authentication and request-rate token
for a three-home capture with a non-member home:

```sh
cargo test --offline --locked -p houseatlas-backend --lib access::login_regression::client_keys_normalize_ipv4_hosts_and_ipv6_prefixes -- --ignored --exact --test-threads=1
cargo test --offline --locked -p houseatlas-backend --lib access::login_regression::multi_home_capture_authenticates_once -- --ignored --exact --test-threads=1
```

These two denial cases belong only to the separate regression lane above. They
check that one client's failed passwords do not refuse a correct password from
another client, and that a client's own failures for a username still refuse it:

```sh
cargo test --offline --locked -p houseatlas-backend --lib access::login_regression::another_clients_failures_do_not_lock_out_a_correct_password -- --ignored --exact --test-threads=1
cargo test --offline --locked -p houseatlas-backend --lib access::login_regression::a_clients_own_failures_rate_limit_that_username -- --ignored --exact --test-threads=1
```

They do not test listener admission, a gateway or loopback-local login, expiry,
revocation, replay, concurrency or deployment, and add no CI entrypoint.

The separately authorized native annual-session policy lane has six exact
generated commands in [Native session policy](../operations/native-session-policy.md#bounded-generated-verification).
They cover the approved device-count, idle retention, annual expiry/renewal,
logout/revocation and scoped Origin/CSRF behavior, bounded indexed expiry
cleanup across generated strict reopens, retired-session capture capacity, and a
local gateway admission benchmark. Inspect their full source and imports first.
They use only generated Access state, a disposable schema-1 database and a private Unix peer; external WhoIs, real
credentials, installed services and production are excluded. This narrow lane
does not release other expiry/revocation cases, the separately held capture
replay controls, or add ordinary CI entrypoints.

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
UI. Read [docs/rust-integration/README.md](../../docs/rust-integration/README.md) for its
explicit disposable settings, exact ordinary commands and remaining product
areas. Its positive browser smoke is separate from all stopped controls.

Development PRs target `main`; there is no separate dev branch. The integration
writer resolves overlaps, records donor heads and tracks review corrections.
Cache publication remains restricted to verified main pushes. Main acceptance
still requires review of the exact candidate and passing CI.

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

The native evidence UI positive exercises the actual React building form and
native-only evidence admission with one generated PDF in fresh disposable state.
It verifies the complete correlated commit, linked evidence, history and original
download, and captures desktop and narrow views. It creates no source Binding:

```sh
node --check tools/rust-integration/healthy-native-place-evidence-ui-loopback.mjs
node tools/rust-integration/healthy-native-place-evidence-ui-loopback.mjs /absolute/private/native-evidence-ui-artifact-selection.json
```

This command remains outside automatic CI. Inspect the full runner and exact
private packet before each one-use release. The packet pins a compiled binary,
build provenance, complete frontend output, a fresh private Chrome snapshot,
OpenSSL and an empty private output directory. Port 48743 must be free. The
runner observes network events without Fetch interception and confirms owned
process exit before recording success. This synthetic flow establishes no
household intake, real-device, PDF safety, rollback or deployment acceptance.

Three separate synthetic mobile positives use a frozen private CUA preparation
packet and the actual contextual editor: `mobile-direct-capture-select-submit-readback`,
`mobile-local-draft-save-reopen-review-confirm-ack`, and
`mobile-manifest-standalone-layout`.

```sh
node /absolute/private/mobile-positive-ui/serve.mjs --three-named-positives
node /absolute/private/mobile-positive-ui/readback.mjs --ready /tmp/houseatlas-mobile-positive-ACTUAL/ready.json --case mobile-direct-capture-select-submit-readback
node /absolute/private/mobile-positive-ui/readback.mjs --ready /tmp/houseatlas-mobile-positive-ACTUAL/ready.json --case mobile-local-draft-save-reopen-review-confirm-ack
```

Use only the inspected source, artifact and build-receipt packet under an exact
one-use owner release. CUA owns visible actions; observation uses passive network
events without Fetch interception. The supervisor owns fresh synthetic TLS state
and children for at most 12 minutes including cleanup. First establish ordinary
TLS trust and an independently isolated browser surface; stop on any certificate
warning or unavailable isolation. Do not bypass security, install trust, alter
cookies or clear existing browser storage. Close only the owned tab and send
`finish` to confirm process/group exit and scratch removal. These commands are
outside CI. Source ordering establishes the awaited local marker transaction;
passive events do not prove pre-dispatch durability. Viewport and manifest checks
establish no physical iPhone, Safari, installed launch or camera acceptance.

A separately named geometry custody-client positive uses the actual exact source
client and two synthetic successful Response exchanges: USDZ original custody
and its mesh derivative custody. It checks immutable bytes/metadata, the memory
unknown marker before each single POST, closed request/result correlation and
separate committed receipts. Getter DTOs are fresh clones under one explicit
synthetic canonical session identity. There is no native server, listener, real
scan, building association, retry, control or unknown-response injection. Inspect
the full body and imported loader before running only:

```sh
node frontend/lantern-tests/native-geometry-write.mjs
```

The positive is separate from ordinary CI and does not qualify native format
validation, private intake, recovery, visual or deployment acceptance.

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


### Bounded native upload outcome checks

A separately inspected private artifact packet qualifies exactly five transport
cases: a generated 9,453,714-byte PDF transferred over ten seconds and downloaded
unchanged; midbody disconnect; the 15-second idle intake deadline; the 60-second
intake deadline while bytes continue arriving; and a genuine committed response
body withheld then recovered by a request-correlated read without a resend.
The separate UI packet qualifies actual React upload, loss of its genuine native
200 response before Chrome receives it, read-only receipt recovery and original
download, plus a genuine throttled 408 with unchanged native records/history.
The browser-download descendant activates the visible Download original link,
requires Chrome's completed GUID event and one private regular file matching
the exact generated bytes/hash, and checks the authenticated HEAD status and
media headers against committed asset facts. A browser-owned download's page
Network status/terminal is recorded only when observed. Earlier
JavaScript-fetch checks remain failed; their canceled-terminal cause is unresolved.
The separately pinned af1 baseline compares the same generated PDF and pacing against its legacy ten-second deadline; it asserts no new outcome carrier or reconciliation route. The UI descendant opens the visible unknown-attempt disclosure before Inspect, waits for the actual refreshed identity evidence, and preserves the same case assertions. A successful empty HEAD stream is consumed to EOF without cancellation before an original-download offer is issued; status and metadata checks remain closed. The private artifact packet pins the actual backend and frontend compilation receipts separately when the frontend-only fix reuses unchanged backend inputs. All helpers have built-in Node imports only. Inspect their complete bodies and
artifact selections before these exact commands with Node 26.10.0:

```sh
node /absolute/private/native-upload-outcome-transport.mjs /absolute/private/transport-artifacts.json
node /absolute/private/native-evidence-upload-outcome-ui-loopback-final.mjs /absolute/private/ui-artifacts.json
node /absolute/private/native-evidence-upload-outcome-ui-loopback-browser-download.mjs /absolute/private/ui-browser-download-artifacts.json
TMPDIR=/private/tmp node /absolute/private/native-upload-legacy-10s-baseline.mjs /absolute/private/baseline-artifacts.json
```

These commands belong to the isolated synthetic regression lane: one owned TLS
loopback, generated local session/media, bounded fresh scratch/process groups,
private output, no provider, household data, installed-service change or retry.
The browser exception is limited to its generated certificate SPKI and owned
profile; it establishes no normal browser trust or device qualification. A
receipt miss stays unknown. Generic failures after intake also remain unknown;
only an authenticated correlated intake rejection proves that invocation did
not commit. These checks do not resolve historical upload requests, prove crash
recovery, release a resend, change ordinary CI or accept deployment.

## Source Documents frontend reader and mounted host

The optional local model review and source-site consumer have one focused
healthy synthetic check. Inspect `frontend/lantern-tests/model-review-logic.test.mjs`
and its finite renderer-owner, local-reader, publication and synthetic-fixture
imports, then use Node 26.10.0 and the locked frontend dependencies:

```sh
node frontend/lantern-tests/model-review-logic.test.mjs
```

It checks original File-object ownership, normal renderer replacement, an
acknowledged local JSON representation, exact synthetic site pins/2D source
coordinates, finite shared-budget arithmetic and generated read/load ordering.
It uses no browser, listener, native service, private input or
external provider. A fake acknowledgement does not establish actual browser
display. The generated `/lantern-tests/model-review-visual/`,
`/lantern-tests/source-host-visual/`, `/lantern-tests/scene-drawing-timing/` and
`/lantern-tests/scan-network-visual/`
fixtures support separately owned loopback browser review of the real React
components, source documents/site views and anonymous stage observations.
Their synthetic observations do not qualify household data, native authority,
private source display or deployment. This command adds no held failure,
revocation, replay or private-intake checks.

After inspecting `frontend/lantern-tests/source-documents-reader.test.mjs`, its
synthetic in-page transport and imported reader/numeric/PDF-budget modules,
production view decoder/model and source-service binding helper, use
Node 26.10.0 and the locked frontend dependencies for this focused healthy check:

```sh
node frontend/lantern-tests/source-documents-reader.test.mjs
```

It reads generated v2 Document lists/originals/qualified PNG bytes, preserves a
schema-valid recorded leap second, checks normal single-reader lease replacement
and exercises canvas-budget arithmetic without allocating a large PDF canvas.
The same check decodes current-view service selection and exercises the actual
production Documents binding with generated GET responses: selected-service
listing, unchanged-binding stability, and normal view/session navigation and
lazy-module completion. These lifecycle cases use no held replay, expiry,
revocation or injected transport failures.
It opens no listener/browser and uses no native host, provider, household input,
intake or deployment. It adds no held control/regression-suite permission.

The manual fixture `/lantern-tests/source-host-visual/` mounts the actual
LanternHost with a browser-only model chooser and native v2 source Documents in
Library. Its Documents transport is generated in-page; other application fetches
are unavailable. Inspect its main, synthetic-document generator and imports before
serving it through an owned loopback Vite preview. Desktop/mobile layout, PDF page
rendering, qualified PNG display and actual private host/source acceptance require
separate supported-browser observations. Keep private inputs and captures outside
Git, and stop the owned preview after the bounded review.

The generated Host fixture's HTML gives both the Host and separate StageTimings
mount nodes one shared `.lantern-integration` ancestor matching production.
This supports presentation review of scoped styles, including Atlas tools
placement, while keeping the bounded anonymous timing harness visible. The timing
harness is fixture UI; it is not a product table or native acquisition surface.
The Host's `nativeContent={null}` supplies no native acquisition authority or
controls; generated presentation coverage does not establish native acquisition
or household acceptance.

The scan/network fixture mounts the actual LanternHost, NativeScanAtlas and
NetworkSceneLayer through generated read-only ports. Its shared topology data
is the existing generated topology fixture. Inspect each fixture entrypoint,
the shared StageTimings component/CSS and their imports before serving these
paths. With Node 26.10.0 and locked dependencies, choose an unused loopback port:

```sh
cd frontend
./node_modules/.bin/vite --config vite.config.ts --host 127.0.0.1 --port 4310 --strictPort
```

Use the supported browser for ordinary desktop/mobile selection, source opening,
visibility controls, pointer/keyboard interaction and visible timing observations.
The timing tables show bounded anonymous local stages from the real components;
fake read delays describe only the generated fixture. Stop the owned preview
within 20 minutes. This manual review adds no workflow or ordinary CI command.

## Unified Atlas native documentary source healthy check

Inspect `frontend/lantern-tests/unified-atlas-overlay-source-healthy.mjs`,
`frontend/integration/unified-atlas-overlay-source.ts` and its closed native
association/source parser imports. With Node 26.10.0 and locked frontend
packages, run:

```sh
node frontend/lantern-tests/unified-atlas-overlay-source-healthy.mjs
```

This one generated positive read bundles the actual adapter with Vite into an
owned disposable temporary directory. It uses an in-process synthetic GET
transport and two dedicated fake original-document owners. It checks exact
source/receipt and arbitrary-precision revision retention, independently reviewed
room links, recorded Network data, electrical drawings and historical symbols,
a normal mobile documentary record retained without room placement, and
the consumer’s exact room-summary projection with source IDs and historical
producer status preserved, one normal sequential same-head refresh after ten seconds, and ordinary
release/disposal. No listener, browser, actual native/household data, external
provider, writes, malformed/omission, denial, replay, expiry or failure controls.
The host still needs an independent reviewed room map and actual current native
original/document owners; generated success does not qualify their availability.
The same named generated check also reads these fictional factual subsets
through the saved-documentary byte-admission path, without a native selection,
session or lease, and retains exact captured identity joins, original dates and
typed record totals. It checks that repeated building views of one pinned source
are one inventory. Saved-preview coverage follows the captured native building
identity, independent of publication building order; unrelated and unlinked
buildings stay unavailable and the property uses the existing partial-coverage
aggregation. A valid selectable foreign room with an accepted source mapping
receives no captured binding; reversing building/map order preserves the result.
Without a matching native building, known records and the complete graph remain
unplaced. Source totals, unplaced records and complete graph facts remain
unchanged. This qualifies `integration/saved-documentary-preview.ts` only;
the separate production saved-overlay owner needs its own checks and composed
browser review. The native owner, original guards and positive refresh/release
checks still execute; saved success does not replace them.

## Unified Atlas reviewed room-links healthy read

Inspect `frontend/integration/unified-atlas-room-links-reader.ts`,
`unified-atlas-room-links-owner.ts`, their type-only
overlay/selection imports, the runtime Atlas error type and the complete named
runner before this ordinary generated positive on Node 26.10.0:

```sh
node frontend/lantern-tests/unified-atlas-room-links-healthy.mjs
```

It uses three successful in-process responses: a publication-wide map covering
two buildings, a valid empty map and valid 128-character source IDs. It checks
the exact query, cookie-authenticated GET options, revision and byte digest,
scene-room consistency, immutable output and retained unmapped rooms. Scene
projections are generated expectations, not admitted GLB publications; no
authentication or native authority is qualified. No real request, listener,
browser, private input, malformed/denial/withdrawal/replay/expiry control or
workflow runs. Mounted-host lifetime and final backend compatibility require
separate integration evidence.

The same positive also uses a fake base lease and monotonic timers for two
successful same-map refreshes during a normal 25-second simulated native open,
followed by ordinary release/disposal. It preserves the exact frame identity
and cleans its timers/subscriptions. No timeout, expiry, replacement or owner
withdrawal control is exercised; these fake handlers do not qualify native
document leases or mounted browser behavior.

The existing named `node frontend/lantern-tests/unified-atlas-overlay-source-healthy.mjs`
also exercises `unified-atlas-room-links-host.ts` through the real map reader,
map lifetime owner and native adapter. Inspect those imports and the full runner
first. A generated publication-wide map spans two buildings; only the selected
building's rooms enter native qualification. The successful map/head refreshes
retain historical producer status, documentary dates and unplaced records, then
normal release cleans dedicated fake original-document owners. Its transport is
entirely in process; it proves no backend authentication or browser behavior and
adds no held control case.

## Unified Atlas healthy generated check

The unified Atlas reads one `houseatlas.unified-atlas-scene.v1` envelope and its
pinned GLB. Inspect `frontend/lantern-tests/unified-atlas-healthy.mjs`, its
generator `frontend/lantern-tests/unified-atlas/synthetic-atlas.ts` and the
imported reader, scene, geometry, GLB preflight and standard GLB modules. Then use
Node 26.10.0 and the locked frontend dependencies:

```sh
node frontend/lantern-tests/unified-atlas-healthy.mjs
```

It takes no arguments. It runs the production scene reader against a generated
in-process HTTPS transport, loads the generated GLB through the pinned
GLTFLoader once, and checks the selected overview manifest query/response pin
using a separate generated overview manifest digest. Model, source and semantic
digests remain distinct. The raised and single-floor publications use their own
manifest pins. This is generated protocol evidence, not backend admission. It checks
nested-transform baking, per-primitive building and
level membership, shared multi-level geometry, out-of-order and split-level
elevations, selectable and excluded rooms, duplicate labels, qualified overlay
joins. It also checks the shared presentation used
for drawing, hidden room picks, explosion offsets, section clips, labels, and
3D, stacked, focused, mid-transition and plan picking. It uses no browser,
GPU, listener, native host, credentials, household input or provider. It adds
no malformed, denial, replay, expiry, crash or private-intake case. Its
generated geometry does not establish real publication coverage, layout,
rendering or device behavior.

The same named command reads a separately pinned valid generated source-colour
publication through the existing fake transport, standard loader and binder.
Distinct opaque core `baseColorFactor` values survive multi-primitive selectors
and reused nodes as immutable linear metadata, with identical vertices, bounds,
draw order and semantic memberships. It exercises the production `sourceMeshColor`
resolver used by `MeshLayer`: source colours precede normal room, roof and site
fallback tones; opt-out, explicit mesh selection, reference, selected room,
related-room context and overlay highlights retain precedence. Other rooms'
highlights preserve the source colour. This checks CPU data and routing only;
shader encoding, rendered pixels, PBR and transparency remain separate evidence.
It introduces no malformed, refusal, lifecycle or held omission case.

The named `node frontend/lantern-tests/unified-atlas-healthy.mjs` also checks
normal generated pointer tap/drag, viewport capture handoff, descendant-to-viewport
capture transfer, pinch with either-finger release, and plan pan through the
production pointer-handler factory. Its source fixtures cover context-first Plan
navigation, reordered plan references, same-winding polygon holes and focused
exploded-floor framing. Only qualified positive overlay joins are supplied;
foreign-publication, unqualified-join and unselectable-action controls are not
part of this ordinary runner. This adds no device cancellation, hardware failure,
malformed/omission, denial, replay, expiry, private-intake or browser test.

The same named healthy runner also checks generated section targets, current
clip visibility during a sweep, retargeting, and exact settled/reduced-motion
values. A coherently translated publication passes the production reader,
standard loader and binder 100,000 m above its original source Y; it retains
the expected room pick at a shared triangle seam. These are positive CPU
observations, not React animation, rendered layout or browser focus evidence.

It also retains generated non-BMP/combining/ZWJ source text at the backend's
human-field scalar bounds, including 64-scalar source date text and the full
1,024-scalar position basis. These are source text, not parsed date claims.
A separate admission-only projection covers 4,096 occurrences and 16,381
room/non-room/context features with reordered references and an empty
occurrence. That projection proves frontend semantic admission only: it is not
bound to model geometry or admitted by the backend. No invalid-text, missing
reference, denial or other held control is added.

The same named positive also statically renders the actual
`PublishedOverlayDetails.tsx` with the locked React/ReactDOM server renderer.
Inspect that component and its type-only scene/binding imports before execution.
A generated two-floor room retains shared and floor-specific records, dates and
source-position bases; structurally distinct delimiter/null date tuples remain
visible and exact duplicate tuples are grouped. A separate 128-entry CPU
binding projection checks append order, ring/hole grouping and frozen indexes
using repeated prepared primitives/features. It establishes no new GLB/backend
geometry admission, benchmark or mounted browser/device behavior. These valid
generated projections add no malformed, denial or other held control case.
Unspecified-occurrence position provenance remains visible without acquiring a
floor marker. Another generated publication splits a level's original features
across two source plans; the production reader, standard loader and binder
retain both IDs/order, all rendered features, matching framing and plan picks.
The backend owner separately confirmed this supported multiple-plan contract;
the frontend check does not qualify backend admission of its fictional fixture.

The same healthy runner statically renders the actual `NetworkGraph.tsx` and
shared `plan-presentation.tsx` with the same locked React/ReactDOM instance.
Generated device self-links, two owned endpoints of one device and an
ownerless endpoint self-link retain their SVG loops and source totals; a
record with no incident link remains in the isolated list. The CSS-only graph
import has no server execution. Two, three and five parallel self-links retain
distinct drawn/hit paths and a finite frame enclosing their cubic controls and
hit-stroke margin. These static checks do not establish exposed-arc clicking.
Additive empty-floor publications above and below the original floors go
through fresh pins, the production reader, standard loader and binder while
retaining all existing occurrences, features, bindings and coverage. Each empty
PlanTile renders nothing and is excluded from thumbnail counts, while the floor
remains navigable and ordinary tiles retain their paths and overlay summaries.
The property Plan skips a featureless lowest floor for the next usable plan.
Actual thumbnails retain the canonical selected room's sibling context before
ordinary layer tint, in both directions across a generated two-floor room.
The shared AreaValue renders ordinary nullable source/estimated area values and
numeric/partial values without changing the geometry basis. These are static
React and CPU observations, not mounted focus, pointer, CSS, browser or device
acceptance. They add no held control, source deletion or new verification command.
The same named healthy runner also renders mixed-direction parallel device,
owned-port and ownerless-endpoint links. Emitted quadratic geometry is compared
modulo traversal reversal, reversing every source link preserves each source
lane, and source notes, counts, isolated nodes and the control-envelope margin
remain intact. Floor tile summaries union exact record IDs independently per
layer, including shared and partly overlapping records, repeated room parts and
cross-floor occurrences; per-occurrence markers and shared record arrays remain
unchanged. These are static React and binding-only generated projections, not
mounted hit-path interaction or additional GLB/backend admission.

The graph's responsive focus handoff requires composed browser review: focus a
camera or layer control with the side graph open, resize to a covering graph,
then check its heading, preserved inside/outside focus, uncovering and Escape
return without changing room ancestry or enabled layers. CPU or static React
checks do not qualify inert-focus behavior.

The separate generated interaction positives use the production reader, standard
GLB loader, reducer, projection, pointer factory and documentary index. Inspect
`frontend/lantern-tests/unified-atlas-regression/interactions.test.mjs`, its
`api.mjs` bundler and imported generated fixtures before this named local check:

```sh
node --test --test-concurrency=1 frontend/lantern-tests/unified-atlas-regression/interactions.test.mjs
```

Its forty CPU cases cover repeated navigation, every declared selectable
occurrence, shared room identity, source-coordinate plans, normal overlay
toggles, collapse-before-Plan selection, deterministic count touch-target
suppression, complete label-action targets, source-qualified duplicate floor
names, indexed tessellated-room picks and tap/drag/pinch sequences. A generated
Plan projection also checks complete-frame zoom-out after an off-centre scale
boost, including the shared pointer and cumulative native-gesture zoom floor.
Five wheel-adapter positives use the actual production adapter: default page
mode and explicit Unified Atlas pan mode, fractional two-axis pan, line/page
normalization and viewport caps, raw modifier zoom, Safari gesture absorption,
and canceled/noncancelable event ownership. Only ordinary pan is normalized;
modifier zoom retains its original raw delta. The shared hook defaults to page
scrolling and only Unified Atlas opts into ordinary wheel pan. Wheel events do
not identify mouse versus trackpad hardware. Hook listener routing and cleanup,
nested controls and scrolling, inert boundaries and real-device gestures need
separate mounted browser/device evidence. Pointer, touch, camera fitting and
easing algorithms are unchanged. These cases include no held controls, listener,
provider, credentials or private inputs. They do not qualify DOM focus, CSS,
animations, GPU rendering, native overlays or devices. The adjacent acceptance
matrix retains its exact historical source attribution; browser automation is
a separate check and gains no execution permission from this CPU command.
This adds no workflow or ordinary CI step.

Before claiming all forty ran, retain their individual names and a
forty-test summary. A file-only successful result establishes neither.
For an environment whose test subprocess reports only the file, the same
inspected healthy module may be run directly on pinned Node 26.10.0:

```sh
node frontend/lantern-tests/unified-atlas-regression/interactions.test.mjs
```

This changes no assertion, fixture, loader or scope. Record which invocation
actually emitted the forty names; do not attribute it to the file-only run.

The separate property-network association positive is documented in
[the architecture contract](../architecture/property-network-connections.md).
After inspecting its pure projector, stage join and generated test body, run:

```sh
node frontend/lantern-tests/unified-atlas-network-connections-healthy.mjs
```

It retains original, reversed and parallel links, explicit endpoint ownership,
within-room loops, complete property occurrences and separately counted shared
media. The existing overlay-source healthy check also passes its actual generated
decoder/projector output through the source-qualified stage join. Neither check
establishes device coordinates, cable routes, native authority or browser pixels.

The same named interaction runner also checks the complete outward hierarchy
with a single-building publication, all eight independent layer combinations,
Plan/3D continuity, explicit explosion, an opaque upper slab during a normal
section transition, authored roof membership and visible foreign-building
surface targets. Measurement positives retain irregular outlines and holes,
excluded sibling-part qualification and actual curved boundary segments.
Native-gesture positives check cumulative rotation/scale and scoped listener
release; these are simulated CPU events, not physical Mac gesture acceptance.
Property projection positives retain distinct source identities, differing
same-date observations and per-building coverage. These generated ordinary
cases add no held lifecycle, malformed, denial or other control case.

The same interaction positives also project fictional narrow room labels along
their authored polygon axes and onto clear paper with bounded callouts. They
check complete rotated action rectangles, panel and count-target clearance,
source-anchored leaders and measurement reservations, deterministic priority,
the four-callout cap, narrow-stage room-list fallback, selected standing tags,
full Unicode names and unchanged source buffers and floor-qualified selection.
Ordinary horizontal names and selected tags also clear their own complete count
targets; an occupied rotated target keeps the selected tag standing.
These are CPU presentation observations; actual fonts, mounted pointer/focus
behavior, animation and rendered publication layout still require browser review.

Wide-stage layer keys share the floor rail's margin, while **Other floors**
opens the optional preview strip. These layout changes use the existing
presentation and interaction checks above; those CPU checks do not mount CSS
or certify panel clearance. Browser review must separately check desktop and
intermediate stages with the graph closed and open, floor-strip selection and
Escape/focus return, key scrolling on short stages, and focus recovery across
the 720px stage breakpoint. Compare the unchanged 390px and 320px controls,
drawers and graph using matching selection, layers and Fit states. Preserve
source coverage, unplaced facts and measurement qualifiers throughout.

The interaction positives also retain an opaque foreground wall's floor target
beside an exposed room interior. A generated CPU binding projection preserves
the near-horizontal own-floor skin exception beyond ordinary depth tolerance
and the floor target for an elevated opaque structure face; original source
buffers remain unchanged. Null and unrecognized presentation entries retain
the sole-building fallback, while a known context-only entry retains property
scope. Existing opaque slab, underside and authored-roof cases remain in place.

The named interaction positives additionally retain each room's complete local
primary documentary observation while keeping other observations and distinct
source entities. Additive valid generated plan publications check reverse group
paint order, a later display-only room band with a hole revealing the earlier
group, non-context floor fallback, explicit unselectable room fill, and selectable
occurrences without feature/native room IDs. They preserve original geometry,
coverage and the existing smallest-containing-room policy; generated floor/lift
projections check each group's own source plane. No malformed or denial control
is introduced.

The `/lantern-tests/source-host-visual/` fixture keeps its default. With
`?atlas=generated` it also mounts the unified Atlas through the production
reader against an in-page synthetic HTTPS transport. With
`?atlas-scene=<path>&atlas-model=<path>` it reads an externally supplied
publication companion and GLB once from the same loopback origin instead. Both
paths are required, and they are fetched without credentials or redirects.
An optional `atlas-entry-building` supplies an explicit presentation entry,
validated against the admitted scene; names/order/size do not choose it.
The named generated Atlas healthy check also exercises an absent entry header
and a valid owner-selected `x-atlas-entry-building-id` on the same descriptor,
retaining identical scene/model bytes. The admitted read carries this optional
preference; it neither changes source JSON nor establishes a native room join.
With `atlas-documentary=/review-input/<manifest>.json`, the same private fixture
can additionally read a saved-documentary manifest and its three pinned source,
support and captured-map files. Inspect `integration/saved-documentary-preview.ts`,
the source client's pure documentary byte-admission core and the factual runtime
projector first. Its bounded same-origin reads omit credentials and redirects;
all other application fetches stay unavailable. It preserves original source
IDs/dates, unplaced records and source qualifiers. The visible saved-snapshot
state is separate from native sessions, frames, read leases, currentness or
physical registration. Drawing references are metadata only. Other fixture app
screens and actions remain generated. Use only owned private inputs and the
same supported-browser/manual preview bounds above; this adds no native grant,
private-intake controls, authenticated candidate acceptance or deployment.
Keep supplied files and any captures outside Git. Follow the loopback preview
bounds above. A fixture review does not qualify native authority, household
data or deployment, and it adds no workflow or ordinary CI command.

## Native geodata document first slice

Inspect `backend/src/media/geodata_original.rs`,
`backend/src/media/geodata_document.rs`,
`backend/src/media/geodata_document_healthy.rs` and the narrow dispatch changes
in `types.rs`, `content.rs` and `service.rs` before these named synthetic checks:

```sh
cargo test --offline --locked -p houseatlas-backend --lib media::geodata_document::tests::healthy_geodata_original_framing_and_provider_families -- --exact --test-threads=1
cargo test --offline --locked -p houseatlas-backend --lib media::geodata_document::tests::healthy_document_original_and_qualified_png_read -- --exact --test-threads=1
cargo test --offline --locked -p houseatlas-backend --lib media::geodata_document::tests::healthy_original_download_independent_of_optional_preview -- --exact --test-threads=1
cargo test --offline --locked -p houseatlas-backend --lib media::geodata_document::tests::healthy_official_cityjson_batch_envelope -- --exact --test-threads=1
```

Only generated memory fixtures and explicit fake scoped storage/access/renderer
qualification ports run. The first case's provider-family assertion is a local
type-contract check, with no provider transport or live authorization. No native
write, HTTP route, migration, converter, household intake or release follows.
See [the contract and remaining integration](../geodata/native-documents.md).
Cargo target/cache output must stay outside the source checkout.


## Native document original custody HTTP slice

Inspect `backend/src/http/geodata_original.rs`, its narrow intake and healthy
fixture, `backend/src/media/staged_upload.rs`, and the single route registration
before this exact healthy synthetic check. Cargo output stays outside source:

```sh
cargo test --offline --locked -p houseatlas-backend --lib http::geodata_original::tests::healthy_native_geodata_original_intake_read_reopen -- --exact --test-threads=1
```

It initializes one disposable generated native host with password-disabled local
Editor session, authenticates the real POST/CSRF, retains generated JSON metadata,
TIFF, GeoJSON, CityJSON, catalogue PNG and PDF originals, checks immutable SHA/size/revision/
license/download-only policy (including exact permitted CC-BY-4.0, CC0-1.0
and PDM-1.0 references), then downloads the exact originals with private
attachment headers before and after strict persistent reopen. The in-process
router opens no listener/provider and uses no household input, real credentials,
NAS, archive, source URL fetch, GIS renderer, geodata preview or document graph.
No denial, failure injection, replay, revocation, expiry or crash case runs.
Asset custody does not install the typed geodata document association/projection.

The explicit fresh native Document v2 healthy check uses disposable generated
originals, the actual native session and in-process router, then strict reopen
and a separately opened SQL+media recovery bundle. It selects no service and
runs no provider, household intake, renderer or converter. Inspect
`backend/examples/healthy-native-geodata-documents.rs`,
`backend/src/storage/geodata.rs`, `backend/src/http/geodata_documents.rs` and the
compiled fresh SQL before this one named positive check:

```sh
cargo run --offline --locked -p houseatlas-backend --example healthy-native-geodata-documents
```

The separately authorized full-profile synthetic compatibility check is
`cargo run --offline --locked -p houseatlas-backend --example healthy-native-full-geodata-profile`.
Its exact generated scope and limitations are in
[the full native profile guide](../geodata/native-full-profile.md).

## Selected provisional model overview positive

Inspect `backend/src/config/model_overview.rs`,
`backend/src/http/model_overview.rs`, the narrow CLI/router composition, and
`backend/examples/healthy-model-overview-read.rs` before this exact command.
It uses only one generated triangle publication and fresh disposable native
state/session through the in-process router. It observes absent/selected ready
views, descriptor and exact Media-authorized bytes, pins/headers and unchanged
configuration/receipt/input bytes. It opens no listener, provider or household
file and runs no denial, malformed, replay, expiry, revocation or crash probes.
Use Rust 1.99.0 and an owned Cargo target outside the checkout:

```sh
cargo run --offline --locked -p houseatlas-backend --example healthy-model-overview-read
```

This positive establishes synthetic read composition only; actual private
publication install, device rendering and release remain separate.

## Named generated unified Atlas read

Inspect `backend/src/config/atlas_scene.rs`, its bounded standard-glTF helper,
`backend/src/http/atlas_scene.rs`, the CLI/Host composition and
`backend/examples/healthy-unified-atlas-read.rs` plus its generated fixture
helper before this exact ordinary positive. It creates only disposable native
state and a fresh actual password-free session; no listener or provider runs.
The source has one building, two levels, a logical room occurring on both,
three actual cube pick meshes and matching inline plans, including an explicitly
estimated proxy. It checks authenticated current/scoped availability, exact
publication/selection and semantic facts, the expected overview-manifest query
and checked digest echo, identical legacy no-query descriptor bytes, repeated Media-authorized pinned GLB
GETs/digests/headers, and unchanged overview/config/receipt/source bytes. Positive
source cases include reflected pick geometry, a nonnegative alpha cutoff above
one and an unused indexed vertex below the drawn support plane.
It runs
no malformed, omission, denial, replay, revocation, expiry or crash controls.
Use Rust 1.99.0 and an owned external target:

```sh
cargo run --offline --locked -p houseatlas-backend --example healthy-unified-atlas-read -- --fixture-output /tmp/houseatlas-unified-atlas-fixture-20261016
```

The output directory must be absent. Its four anonymous files (`overview.glb`,
`publication.json`, `atlas-scene.json`, `scene-response.json`) are generated
source/consumer fixtures only; no session, configuration, native database or
credential is copied. The frontend owner can consume that exact envelope and
model in its compiled preview. Native activation, actual publication/device
rendering and product readiness remain separate.

Focused static checks for this source lane (no test execution):

```sh
cargo clippy --offline --locked -p houseatlas-backend --lib --bin houseatlas --example healthy-unified-atlas-read --example validate-unified-atlas-publication -- -D warnings
```

`validate-unified-atlas-publication` is a source-only, read-only owner entrypoint
for separately supplied private artifacts, not an ordinary household intake
check. Its four required options are `--overview-manifest`,
`--overview-manifest-sha256`, `--atlas-scene-manifest`, and
`--atlas-scene-manifest-sha256`. It uses the identical private selection and
semantic/GLB validators without reading native state or starting a service.
Do not interpret source validation as current native joins, browser acceptance
or release. No actual private source is included or exercised by this lane.

### Unified Atlas native documentary overlay source healthy read

Inspect `frontend/lantern-tests/unified-atlas-overlay-source-healthy.mjs` before
running this one generated positive. It exercises the actual source-only
current-association HTTP qualifier and closed network/electricity/fixture
parsers with an in-process GET transport and two dedicated fake native document
owners. It checks independently host-reviewed publication/native/package room
links against the current association, retained
primary and historical originals, final current-head read, arbitrary-precision
asset revision, a valid multi-anchor target union with target-specific anchor
provenance, documentary-only detail DTOs, one positive bounded passive
head refresh and explicit owner release. Initial and final qualification use
`/current`; the sequential monitor uses the existing compact `/head` response
(at most 4,096 bytes), comparing record ID, exact revision and canonical payload
SHA-256. It polls every 10 seconds with an 8-second deadline, withdraws on change/error, accepts a head
proof for at most 20 seconds while the original native session and source
owners remain active. Release, context/document invalidation or native session
end stop the monitor. This is bounded read-point freshness, not immediate
external-write notification. The compact head rechecks the accepted native
chain, identities and source-record pins; it does not repeat old scan-descriptor
or retained-byte validation. The dedicated original owners continue to guard
the retained documentary sources. Initial and subsequent timers count from the
actual head-read timestamp, not from completion of optional PDF checks. It
uses no old rendered geometry, real source, provider, listener, native mutation,
expiry/revocation/replay/denial or other held controls. Use pinned Node 26.10.0:

```sh
node frontend/lantern-tests/unified-atlas-overlay-source-healthy.mjs
```

When a frame advertises optional PDF correlations, the same sequential monitor
also rechecks the exact PDF evidence membership in the native building identity
under its shared eight-second deadline. The identity proof has its own measured
read timestamp and twenty-second freshness bound; association reads do not
renew it. Before publication, an unavailable or stale optional correlation is
omitted. Once advertised, its loss retires that immutable composite frame;
a new open can qualify base documentary sources without the optional PDF link.

### Independent unified Atlas room-link healthy read

Inspect `backend/examples/healthy-unified-atlas-room-links-read.rs` and its
existing generated fixture helper before this named ordinary positive. It uses
only disposable synthetic persistent state, a fresh actual password-free native
session and the in-process router. It reads the optional independently supplied
room-link JSON twice under native Read, checks exact query/selection/digest and
private response headers, and preserves the strict scene descriptor, producer
historical status, configuration, Atlas state, receipt and source bytes. The
ordinary absent configuration returns authenticated 404. No native identity
registration, current source qualification, real provider/listener/household
input or malformed/denial/replay/revocation/expiry/crash controls run. Use Rust
1.99.0 and the explicitly coordinated external target:

```sh
cargo run --offline --locked -p houseatlas-backend --example healthy-unified-atlas-room-links-read
```

Focused static checks for this source lane:

```sh
cargo clippy --offline --locked -p houseatlas-backend --lib --bin houseatlas --example healthy-unified-atlas-room-links-read -- -D warnings
```

## Synthetic PR performance reporting

For the separately scoped valid-value absolute-head-budget comparison, inspect
`tools/perf/reporting/head-budget-healthy.test.mjs` and its pure reporting imports,
then run on Node 26.10.0:

```sh
node tools/perf/reporting/head-budget-healthy.test.mjs
```

Four generated numeric cases retain a valid unsupported baseline while checking
the measured head's configured absolute maximum/minimum, exact boundaries,
unavailable relative comparisons and truthful report failure. All metric states
are valid; no measurement collection, process, API, malformed input, omission,
mutation, denial, security or application failure injection is involved. This
manual local check adds no workflow step or permission for held reporting files.

The separate performance lane uses only this automatic healthy reporting check,
from the exact accepted default-branch checkout in the read-only `workflow_run`
resolution job. The test body and all imports come from that trusted revision;
candidate test files never select automatic cases. The measurement job runs no
candidate reporting test, formatter or Markdown preview after collection. Before
the reporter workflow is installed on main, hosted PR checks collect raw records
only. Inspect the complete local test source and imported helpers before this
focused local command with Node 26.10.0 and Python 3's standard library:

```sh
node --test --test-concurrency=1 tools/perf/reporting/healthy-reporting.test.mjs
```

The identical inspected healthy file may be invoked directly for individual-case
diagnostics when a test subprocess reports only a file-level result:

```sh
node tools/perf/reporting/healthy-reporting.test.mjs
```

This changes no test body, fixture or scope; retain each invocation separately.

It uses valid numeric samples, valid generated archives and exact fake GitHub
metadata for healthy comment create/update. The same named suite covers
compact percentage/unit rendering, direction/noise status symbols, browser
coverage grouping, concise provenance and exact numeric budget boundaries.
These are generated valid-value rendering cases, without application failure
injection or held controls. It checks accepted unavailable and
numeric representation states without executing adversarial, mutation/omission,
reversal, denial or failure-injection cases. Other reporting test files retain
held cases and are excluded from this automatic lane; listing or reading their
source is not authorization to execute them.

With the clean pinned harness checkout and its exact public lock installed,
the same healthy test also checks the actual canonical contract:

```sh
HOUSEATLAS_PERF_CONTRACT_ROOT=/absolute/pinned/harness-checkout node --test --test-concurrency=1 tools/perf/reporting/healthy-reporting.test.mjs
```

The pin is `4bb08dfd255c32c385d496ae64705719d5d56e80`, and the sole schema is
`tools/perf/contract/run.schema.json`, SHA-256
`642af28eacc14e6fdd7b9f7071979f07abc8dcb9a427773f5d74dab672b7056a`.
The test opens no listener and calls no remote API, application service, provider
or real account. It supplies no actual browser/GPU or full security qualification.
The automatic job prepares that pinned fixture in its own root and supplies no
job token to the test step. It has no measurement artifact or collector workspace.
Deleting the test from accepted default source fails instead of becoming a legacy
skip. Proposed reporter/test changes require inspection and this named local
healthy verification before acceptance; the automatic suite exercises accepted
default source and does not execute those proposals before review.

The unprivileged measurement job separately installs only exact public locks
with scripts/audit/funding disabled, then invokes this same clean harness
sequentially against separately pinned base/head checkouts. Inspect the harness,
selected production functions and Vite configuration first. Its fixed generated
fixtures, resource/process bounds and exact CLI are in the harness owner's
`tools/perf/harness/README.md`. No broad test alias or held case is run to collect
metrics. Source Vite builds execute source code only in the isolated read-only
PR context without user secrets, provider credentials or shared cache writes.

The two reporting workflows also have this read-only YAML/expression check with
the official actionlint 1.7.12 executable in a temporary tooling directory. Its
Linux amd64 release archive SHA-256 is
`8aca8db96f1b94770f1b0d72b6dddcb1ebb8123cb3712530b08cc387b349a3d8`:

```sh
/tmp/houseatlas-actionlint-1.7.12/actionlint -shellcheck= -pyflakes= .github/workflows/performance.yml .github/workflows/performance-report.yml
```

This reporting lane is separate from ordinary CI and changes none of its
existing checks or permissions. Only the trusted default-branch publisher job
has the scoped ephemeral PR-comment permission. See
[the report lane](../ci-performance.md) and
[measurement handoff](../../tools/perf/reporting/README.md). It releases no
application-control, provider, household, recovery, pilot or deployment gate.

## Named generated home read-pack check

Inspect `backend/examples/healthy-home-read-pack.rs`, its generated
`support/home_read_pack_geometry.rs` helper, the reused unified Atlas fixture,
and the touched read-pack storage/HTTP and admitted companion accessor before
these exact commands. This ordinary positive uses only fresh disposable native
state and in-process HTTP. It creates an actual local password-free session,
building/evidence records, native evidence original, and a qualified generated
USDZ/mesh custody plus building association. No USD converter is executed.

The positive checks source-policy-approved lossless JSON and PNG Documents on
the same native dataset, a qualified PNG preview, full GLB, matching inline
plans/documentary overlays and independently admitted historical room links.
The valid raw companion is padded with generated JSON whitespace above 8 MiB
and below 12 MiB, verifying exact bytes stay outside the generic section parser.
It checks six-section manifests, complete and honest overview-only partial
coverage, native scan original/derivative mappings, all digest/size/MIME pins,
full-resource and 4 MiB range assembly, retained reads and source-file invariance.
The full-profile copy prepares only this fixture; export writes no native state.
No listener, provider, household data, denial, malformed, revocation, omission or
crash probe runs. Use Rust 1.99.0 and an owned target outside the checkout:

```sh
cargo run --offline --locked -p houseatlas-backend --example healthy-home-read-pack
cargo run --offline --locked -p houseatlas-backend --example healthy-home-read-pack -- --fixture-output /tmp/houseatlas-home-read-pack-generated
```

The optional output directory must be absent and its parent canonical. It holds
only generated `records`, `partial`, `unified` and `documents` manifests and
hash-named resource bytes, with no cookies/session headers. These finite examples
are documentary fixtures for the separate frontend consumer owner. They do not
establish offline renderer, browser, device, source placement or deployment
acceptance. The closed v1 envelope remains; explicit model-section v2 renderer
support is still required.

## Named generated retained identity body positive

Inspect the exact `--retained-identity-bodies` branch and
`retained_identity_bodies_positive()` in
`backend/examples/healthy-home-read-pack.rs`, and the touched read-pack
storage/HTTP code, before this separate command. The producer-only positive
uses fresh private canonical temporary state, an in-process local session and
the existing native mutation owner to create generated identities. Synthetic
SQL setup then supplies valid whitespace-preserving encodings, exact integral
decimal/exponent revision tokens, a maximum safe revision and one exactly
1 MiB body. Setup finishes before read-only observation; it is not an audit
history, recovery or malformed-input control.

Using Rust 1.99.0 and an owned target outside the checkout, the separately
coordinated command is:

```sh
cargo run --offline --locked -p houseatlas-backend --example healthy-home-read-pack -- --retained-identity-bodies
```

The body checks actual manifest/Atlas/aggregate GETs, unchanged body slices,
independent hashes, deterministic contiguous closure, exact revision tokens,
repeat-capture descriptor consistency and exact retained-manifest continuation.
It compares complete record rows, database files and observer-connection
change/version values before and after the read phase. Those observations do
not establish general live WAL/SHM inactivity or crash durability. The existing
baseline and fixture-output paths remain separate invocations; this command
does not run them.

Only generated records and existing in-process transports are used. No listener,
live data, provider, browser/device session, local draft retention, UI, native
authority, submission, replay, fault, denial, concurrency or deployment is
qualified. This registration records the inspected command and scope, not an
execution result; invocation requires the coordinated exact-head release.

## Bounded generated offline intent reconciliation qualification

Inspect `backend/examples/healthy-offline-intent-reconciliation.rs` before this
separately released synthetic qualification. It uses the existing in-process
Axum router, Access owner and SQLite Store in a fresh disposable directory.
One generated Stock command commits; subsequent POSTs only inspect its retained
outcome. It starts no listener and does not resend the command or use the Node
ledger. Use Rust 1.99.0 and an owned target outside the checkout:

```sh
cargo run --offline --locked -p houseatlas-backend --example healthy-offline-intent-reconciliation
```

The bounded cases cover seven-table successful commit coherence, repeated
lookup and original receipt preservation, an alternate lookup request ID,
changed-payload conflict, viewer-actor absence, unconfigured workspace/home
absence, unchanged Atlas DB/WAL bytes and an actual Store close/reopen. They
also check the existing 16,384-byte lookup input boundary and the consumer's
exact/one-byte-short response reader bound. This is a separate generated
qualification, not a new ordinary workflow step or a blanket regression release.

An absent outcome retains `retrySafety: not-established`. These checks do not
establish replay safety, injected rollback, crash or process recovery, concurrent
writers, two authorized-home collision isolation, a server response-size ceiling,
offline editing/sync, production access or deployment readiness.

## Named generated offline-06 regression cases

Inspect `backend/examples/healthy-offline-intent-reconciliation.rs`,
`backend/examples/offline06/atomic_recovery.rs` and its `CASES.md` before
any separately released invocation. The no-argument healthy body is unchanged;
there is no aggregate selector or automatic case execution. Use Rust 1.99.0,
the unchanged lock and an owned external Cargo target. The compile-only gate is:

```sh
cargo check --offline --locked -p houseatlas-backend --example healthy-offline-intent-reconciliation
```

After the exact registered source and compile result are accepted, select each
separately released case in its own invocation; stop and report the first
failure without retrying or changing the fixture:

```sh
cargo run --offline --locked -p houseatlas-backend --example healthy-offline-intent-reconciliation -- --case late-precommit-rollback
cargo run --offline --locked -p houseatlas-backend --example healthy-offline-intent-reconciliation -- --case duplicate-shared-store
cargo run --offline --locked -p houseatlas-backend --example healthy-offline-intent-reconciliation -- --case duplicate-independent-connections
cargo run --offline --locked -p houseatlas-backend --example healthy-offline-intent-reconciliation -- --case child-process-outcome
```

These are separate generated regression-lane cases, not additions to ordinary
CI or the default healthy run. The late failure uses an existing test-only
authorization callback after native/Stock persistence but before COMMIT; it
compares complete typed rows in all seven tables and uses a different intent
as the positive control. The shared-Store case explicitly submits one duplicate
and reaches the existing retained-hit branch. That exact duplicate is a bounded
mutex-serialization qualification, not independent-connection concurrency or
general replay permission.

The two-connection case holds one writer at precommit, establishes SQLite
BUSY/LOCKED contention and a second request rejected before intake, and checks
the full preimage from an independent reader. It never retries the busy
request. The process case closes parent application handles and launches the
same executable in a distinct child process to read the original outcome and
a missing-key result. It does not simulate a crashed process, power loss or
native-service restart. Missing outcomes retain retry safety as not established.

Every case creates a fresh private temporary fixture using existing lifecycle
setup. Storage probes accept only their generated principal/scope/intent;
transaction results do not qualify real Access authorization. Actual Access
and the in-process Axum outcome handler are used where documented. Writer gates
have ten-second waits; the owned child has bounded ticket/output and a
thirty-second protective timeout. Timeout is a failed run, not crash recovery.

No listener, provider, household input, production database, NAS/native service,
browser/device, automatic submission/replay, populated restore, Scope A or new
dependency is included. These commands require an exact source-owner case
release; registration alone is not execution or offline-sync acceptance.

## Named generated saved Atlas mounting positives

Read [saved Atlas mounting](../offline/saved-atlas-mounting.md),
[saved overlay projections](../offline/saved-atlas-overlays.md) and the fixture
README before the exact named generated positives:

```sh
node frontend/lantern-tests/offline-atlas-presentation-healthy.mjs
node frontend/lantern-tests/offline-atlas-overlays-healthy.mjs
node frontend/lantern-tests/offline-atlas-mounting-healthy.mjs
node frontend/lantern-tests/offline-stage-discard-healthy.mjs
```

Use pinned Node 26.10.0, exact locked dependencies and evidence output outside
source. Only valid generated complete/partial retained copies and fake local
resource owners run. Ordinary frontend typecheck/build, backend static asset
compatibility and exact publication source verification are also included.
This adds no broad alias, workflow or held malformed/denial/replay/expiry/crash,
adversarial/private-intake or failure-injection case. Supported browser QA uses
only the explicit Save/production-store path and owned loopback/static shell
procedure in `frontend/lantern-tests/offline-atlas-browser/README.md`; it proves
owned-origin unavailability only, not WAN/device/PWA/iOS acceptance.

The stage-discard command separately exercises the actual production store with
five ordinary generated lifecycle cases through a finite asynchronous IDB API
simulation: canceled new and replacement Saves, cleanup after commit, normal
stage supersession and shared-digest retention. It verifies transaction completion
and preservation of the committed copy. This is source/simulated-storage evidence;
it does not establish genuine browser persistence, native acquisition or offline
device availability.

## Named generated native house acquisition check

Read [native house acquisition](../offline/native-house-acquisition.md) and the
complete runner/imports before this exact Node 26.10.0 command with locked
frontend dependencies. The argument is the retained generated handoff containing
`QUALIFICATION.json` and its four `fixtures` directories; no fixture data is
copied into the repository.

```sh
node frontend/lantern-tests/offline-house-acquisition-healthy.mjs /absolute/retained-generated-handoff
```

Only four valid generated exports and focused ordinary explicit Save/Replace,
Cancel, unchanged-owner/view-replacement and late-commit lifecycle cases run,
using injected finite GET responses, a valid public shell result and an in-memory
staging owner. Seven valid static React presentation states additionally check
passive rendering, Prepare/Save and capture labels, coverage/exclusions before
confirmation, Cancel wording and exact receipt pins. These are not layout,
keyboard or browser checks. No global fetch replacement, socket, browser, native state,
real IndexedDB/provider, held denial/foreign-token/expiry/revocation/crash/fault,
guard-reversal or broad alias is included. This check establishes no genuine
offline/device/PWA or deployment acceptance and adds no workflow.

## Generated software release bundle check

Read [software release bundles](../operations/release-bundles.md), then inspect
`tools/release/bundle.py`, `fixtures.py`, `workflow.py` and `test_bundle.py`
before this exact focused command:

```sh
PYTHONDONTWRITEBYTECODE=1 python3 -m unittest discover -s tools/release -p test_bundle.py -v
```

Seven generated happy-path cases check deterministic software-only packaging,
exact file closure, the retained-component/storage declarations, producer
identity and a fake local draft/upload/download/publish sequence. They open no
listener, execute no native binary and use no actual GitHub write, credential,
household data or runtime. Held crash, replay, expiry, adversarial and rollback
controls remain separate. The release workflow validates scoped PRs; actual
main build and promotion are explicit manual operations with separate reviewed
native-profile, storage-compatibility, producer and publication gates. Source
checks do not qualify a NAS binary, updater transaction, deployment or device.

The two reviewed packaging repairs additionally have this explicitly selected,
separate generated regression command:

```sh
PYTHONDONTWRITEBYTECODE=1 python3 tools/release/test_bundle.py --repair-regressions
```

Exactly three cases use fake subprocesses with simulated transfer durations and
disposable generated USTAR paths. They check the three transfer ceilings versus
the short inspection timeout, valid filename/prefix boundaries, and pre-output
rejection of unencodable paths in producer and manifest admission. They run no
network, wall-clock timeout, native binary, credential, provider or household
operation. These cases remain excluded from ordinary seven-test discovery and
add no CI step or broader control permission.

## Named generated updater source checks

Read [the updater source contract](../operations/houseatlas-updater.md), then
inspect its modules, `tests/synthetic.py` and the selected test bodies. From
`tools/houseatlas-updater`, the exact generated happy-path commands are:

```sh
PYTHONDONTWRITEBYTECODE=1 python3 -m unittest tests.test_happy.GeneratedHappyPaths.test_check_generated_full_bundle tests.test_happy.GeneratedHappyPaths.test_apply_generated_full_bundle_preserves_native_state tests.test_happy.GeneratedHappyPaths.test_apply_frontend_only_retains_exact_backend tests.test_happy.GeneratedHappyPaths.test_cli_json_check_and_durable_status
PYTHONDONTWRITEBYTECODE=1 python3 -m unittest tests.test_packaging.PackagingHappyPaths.test_pinned_packaging_fixture_schema tests.test_packaging.PackagingHappyPaths.test_packaging_generated_bundle_apply
```

These six cases use fresh disposable directories, generated archives and
non-executable Mach-O header specimens, tiny synthetic SQLite files and fake
in-process acquisition/publication/launcher/health ports. The two contract
cases consume the pinned packaging schema and helpers from the composed tree.
No socket, subprocess, credential, actual GitHub/native request, service action
or user data is used. This adds no workflow execution or broad test discovery;
failure, denial, concurrency, replay, expiry, crash and rollback controls stay
outside this release. The results establish source/generated behavior only,
not native acquisition, launchd, storage compatibility, recovery or deployment.

The separately authorized updater JSON-input regression lane has three exact
memory-only cases. Inspect `tests/test_json_input.py`, `validation.py` and
`cli.py`, then run from `tools/houseatlas-updater`:

```sh
PYTHONDONTWRITEBYTECODE=1 python3 -m unittest tests.test_json_input.JsonInputRegression.test_nonfinite_constants_are_rejected_at_all_depths tests.test_json_input.JsonInputRegression.test_cli_nonfinite_status_selector_never_reads_latest tests.test_json_input.JsonInputRegression.test_valid_json_and_null_status_selector_are_preserved
```

Only generated JSON bytes and a recording status fake are used. These cases
cover the exact non-finite-to-null defect and ordinary null/UUID selectors;
they add no transport, filesystem, service action, broad control alias or
failure/rollback/crash qualification.

The separately scoped storage-mapping protocol source cases use only generated
in-memory tuples, a checked-in packaging schema/manifest and typed recording
values. Inspect `tests/test_storage_protocol.py`, `model.py`, `validation.py` and
`release_bundle.py`, then run from `tools/houseatlas-updater`:

```sh
PYTHONDONTWRITEBYTECODE=1 python3 -m unittest tests.test_storage_protocol.StorageProtocolSourceCases.test_two_explicit_profiles_preserve_field_meanings tests.test_storage_protocol.StorageProtocolSourceCases.test_missing_ambiguous_and_unsupported_protocols_rejected tests.test_storage_protocol.StorageProtocolSourceCases.test_mixed_profiles_and_loosely_typed_schemas_rejected tests.test_storage_protocol.StorageProtocolSourceCases.test_packaging_owner_map_requires_typed_supported_storage tests.test_storage_protocol.StorageProtocolSourceCases.test_selected_map_is_revalidated_before_bundle_normalization tests.test_storage_protocol.StorageProtocolSourceCases.test_equal_legacy_tuples_cannot_pass_admission_or_compatibility -v
```

The cases cover exact supported interpretations, unsupported/ambiguous values,
mixed profiles and Python bool/int equality aliases, including legacy owner
tuples at admission. They do not read native state, execute SQL, create a
controller transaction, start processes, use transports or register release
contract hashes. Passing proves bounded source behavior only; actual profile,
contract preimages, target preservation, native qualification and rollback remain
separate owner evidence. No workflow, build or broad regression suite is added.

The inert trusted-contract registration has three named static/memory positives.
Inspect `storage_contracts.py`, the two exact JSON preimages under `contracts/`
and `tests/test_storage_contracts.py`, then run from `tools/houseatlas-updater`:

```sh
PYTHONDONTWRITEBYTECODE=1 python3 -m unittest tests.test_storage_contracts.TrustedStorageContractSourceCases.test_registered_preimages_are_exact_canonical_source_contracts tests.test_storage_contracts.TrustedStorageContractSourceCases.test_persistent_schema_pins_match_current_public_source tests.test_storage_contracts.TrustedStorageContractSourceCases.test_fresh_registry_is_inert_and_adapter_requires_explicit_input -v
```

These cases hash only fixed public software declarations and seven SQL source
files, without executing SQL. They check canonical preimage identity, independently
normalized tuples, fresh values and explicit in-memory adapter construction with
a synthetic native marker. No manifest, target selection, compatibility promotion,
native state, process, controller transaction or network is used. The checked-in
release compatibility stays unqualified/null/null/false. Document revision two
does not change contract format revision one. This adds no workflow or broader
test discovery; actual target admission, preservation and rollback remain open.

## Named generated GitHub acquisition adapter checks

Read [the acquisition source contract](../operations/houseatlas-updater-acquisition.md)
and inspect the adapter, selected test bodies and pinned packaging helpers.
From `tools/houseatlas-updater-adapters`, run only the two named positives:

```sh
HOUSEATLAS_PACKAGING_SOURCE=../release PYTHONPATH=../houseatlas-updater PYTHONDONTWRITEBYTECODE=1 python3 -m unittest tests.test_github_release_happy.GitHubReleaseHappyPaths.test_published_release_exact_build_and_bytes tests.test_github_release_happy.GitHubReleaseHappyPaths.test_annotated_prerelease_bounded_asset_redirects -v
```

Both cases use finite in-process HTTP replies and generated software payloads,
checking exact producer/asset bytes, tag resolution, partial reads, shared
deadline/header bounds and ordinary asset redirects. They perform no actual
GitHub request, socket, credential, native process, controller transaction or
runtime installation. Real HTTPS-port, acquisition and target qualification
remain separate; no broad control discovery or new held case is released.


## Named generated root and saved offline-entry lifecycle positive

Read [root offline entry](../offline/root-offline-entry.md), then inspect
`frontend/build/root-offline-worker-source.js`, the existing saved worker,
`offline-shell-plugin.mjs`, `frontend/src/offline/shell.ts` and this generated
lifecycle script. With pinned Node26.10.0, from the repository root:

```sh
node frontend/lantern-tests/offline-root-entry-healthy.mjs
```

The exact generated positive exercises the actual worker sources and shell
registration lifecycle with bounded in-process public resources and fake browser
owners. It covers normal online root response, network-unavailable root handoff
to the verified saved entry, root navigation-only ownership with unchanged live
asset requests, public resource closure, ordinary worker update and exact
owned-build cleanup. It uses no native session, authenticated data,
real service worker/profile, network, listener, browser or runtime state. No
private application/API/auth response is cached. A generated offline response
is not genuine device/PWA/WAN acceptance; exact current bytes still need bounded
supported-browser observations after source review and independent deployment
authority. No broader control suite or production action is released.


## Named generated electrical registration positive

Read `tools/electrical_registration/README.md`, its pure registration module and
the generated healthy fixture before this exact command on pinned Node 26.10.0:

```sh
node --test --test-concurrency=1 tools/electrical_registration/healthy.test.mjs
```

Five ordinary generated cases cover source-to-page arithmetic, independently
reviewed metric controls, exact current publication/model/frame/occurrence pins,
uncertainty propagation, complete inventory with selection-only highlighting,
and a valid reviewed nomination-withdrawal lifecycle preserving unrelated records.
They create no native receipt or placement authority. Unsupported rows remain
explicit; source pixels alone do not establish metric points, surveyed positions
or current circuits. No browser, actual source, provider, failure/denial/replay/
expiry/crash control, broad suite or deployment is involved.

The same inspected five healthy examples may also be invoked directly on pinned
Node 26.10.0 to retain their individual names when a test subprocess reports
only a file-level result:

```sh
node tools/electrical_registration/healthy.test.mjs
```

This changes no test body, fixture or scope; record each invocation separately.


## Named generated updater transport/runtime/MCP positives

Read the [HTTPS transport](../operations/houseatlas-updater-transport.md),
[runtime adapters](../operations/houseatlas-updater-runtime.md) and
[optional MCP composition](../operations/houseatlas-updater-mcp.md), then inspect
the exact selected source and generated fixture bodies. From
`tools/houseatlas-updater-adapters`, run:

```sh
PYTHONPATH=../houseatlas-updater PYTHONDONTWRITEBYTECODE=1 python3 -m unittest tests.test_transport_dispatch_happy.TransportDispatchHappyPaths.test_https_partial_reads_shared_deadline_and_closure tests.test_transport_dispatch_happy.TransportDispatchHappyPaths.test_explicit_asset_redirect_then_chunked_body tests.test_transport_dispatch_happy.TransportDispatchHappyPaths.test_fixed_dispatch_uses_existing_cli_once_per_request tests.test_transport_dispatch_happy.TransportDispatchHappyPaths.test_authorized_maintenance_catalog_and_exact_requests -v
```

From `tools/houseatlas-updater-runtime`, run:

```sh
PYTHONDONTWRITEBYTECODE=1 PYTHONPATH=../houseatlas-updater:. python3 -m unittest tests.test_runtime_happy.RuntimeHappyPaths.test_generated_full_and_frontend_apply_with_journal_coherence -v
```

From `tools/houseatlas-mcp-bridge`, run:

```sh
PYTHONDONTWRITEBYTECODE=1 PYTHONPATH=../houseatlas-updater:../houseatlas-updater-adapters:../houseatlas-updater-runtime python3 -m unittest test_maintenance_happy.MaintenanceHappyPath.test_mcp_generated_check_apply_and_retained_status -v
```

The four transport/dispatch cases use only finite generated HTTP/TLS/readiness
fixtures and a recording controller. The runtime case uses disposable software
closures, a generated multichunk model and actual local journal with synthetic
platform/native owners. The MCP case composes the actual controller/CLI and concrete runtime adapters
with that existing generated platform/native owner, including the preserving
verifier and typed application-readiness contract. No external socket, DNS, native binary or NAS
request/service action, credentials, real maintenance grant or deployment occurs.
The installed bridge default remains without maintenance tools. No failure,
denial, replay, crash or rollback case is added or run, and no broad alias or CI
step is introduced. Real native/launch/CAS/readiness bindings and safe onboarding
remain separate owner qualifications.


## Named generated frontend asset-retention producer positive

Read [the frontend asset-retention producer contract](../operations/frontend-asset-retention.md),
then inspect `tools/release/frontend_retention.py`, the selected generated case,
its existing packaging fixture helpers and `bundle.py`. From the repository root:

```sh
PYTHONDONTWRITEBYTECODE=1 PYTHONPATH=tools/release python3 tools/release/tests/test_frontend_retention_happy.py FrontendRetentionHappyPaths.test_generated_prior_assets_union_pack_and_verify -v
```

This one positive prepares a new disposable frontend from generated current
assets and a separately pinned, generated prior release, then packages and
verifies the exact declared union through the existing producer. It retains
current entrypoints and prior immutable assets with distinct public provenance.
No actual release, network, native binary, service, private input, denial,
rollback or failure-injection case is used. Runtime publication never adds
undeclared files; genuine producer approval and native update qualification
remain separate. This adds no workflow or deployment authority.

## Named generated native Access read-only validation positive

Read [the native Access validation contract](../operations/updater-native-validation.md),
then inspect the two additive methods, shared compiled validator and the existing
`healthy_persistent_session_checkpoint` body before this exact command in the
pinned Rust 1.99.0 environment with an owned disposable Cargo target:

```sh
cargo test --offline --locked -p houseatlas-backend --lib access::healthy::healthy_persistent_session_checkpoint -- --exact --test-threads=1
```

The generated persistent-session positive checks original-connection and closed
Access catalogue/meta/epoch validation without an authorization/session refresh,
preserves database bytes and stored session fields, then uses the original
session normally. It does not establish whole-Core/profile inspection, live
WAL/SHM filesystem immutability, an updater deadline, service fencing, maintenance
authority or native application readiness. No runtime route, real credentials,
service, network, failure/denial/replay/crash case or broader suite is released.

### Generated property Network associations

The existing saved-Atlas browser fixture now has a sixth, separately labelled
`Save network associations generated copy` case. Its existing actual-reader
positive, fixture typecheck/build commands, exact pins and finite visual checks
are documented in `frontend/lantern-tests/offline-atlas-browser/README.md`.
It exercises two captured building joins, three room summaries, five anchored
original connections, five incomplete connections and one separately derived
shared-medium association. The five earlier snapshot pins stay unchanged.
Room-summary lines are logical associations, not surveyed device positions or
physical cable routes. Generated source/build checks do not accept pixels,
native authority, installation or offline/device behavior.

### Established-session bounded native HTTP transport

Read `docs/operations/updater-established-native-transport.md`, the concrete
`established_native_http.py` source and complete named test body first. The
separately released ordinary generated positive, from the repository root, is:

```sh
PYTHONDONTWRITEBYTECODE=1 PYTHONPATH=tools/houseatlas-updater:tools/houseatlas-updater-runtime python3 tools/houseatlas-updater-runtime/tests/test_established_native_http_happy.py EstablishedNativeHttpHappyPaths.test_existing_session_fixed_get_partial_io_and_deadline -v
```

One finite existing-owner fixture exercises all nine fixed GET routes through
actual transport parsing and shared-deadline logic with generated socket/TLS/clock
ports. It checks normal partial I/O, chunk framing, original session fields and
closure; it opens no socket, loads no trust material and calls no native/session
owner. No malformed, denial, failure, expiry, concurrency, replay, crash or broader
suite is released. This is source behavior, not application readiness, native
coherence, qualified peer/TLS/grants, maintenance authority or deployment.


## Established application readiness generated positive

After inspecting the concrete reader, its fixed-route transport, existing
`HealthProbe` contract and actual backend DTO/model/map schemas, the integration
owner releases this single ordinary generated successful case:

```sh
PYTHONDONTWRITEBYTECODE=1 PYTHONPATH=tools/houseatlas-updater:tools/houseatlas-updater-runtime python3 tools/houseatlas-updater-runtime/tests/test_application_readiness_happy.py ApplicationReadinessHappyPaths.test_established_scope_model_scene_and_room_links -v
```

The case runs the actual `EstablishedApplicationReadiness` over the concrete
transport with finite in-process socket/TLS-wrap/clock fixtures. It checks ten
fixed requests under one absolute budget, exact pinned descriptor projections,
model/map digests, a documentary room join, stale-view qualifiers, unchanged
established-owner fields and original request/process/nonce retention. The
existing `HealthProbe` typed-evidence contract is exercised without native or
platform verification. All documents, model bytes and session facts are generated;
no real socket, TLS trust query, native/provider read or credential is used.

This releases no malformed, omission, denial, expiry, mutation, concurrency,
failure-injection, retry, replay, crash, rollback, network, server, MCP, session,
maintenance, target or broad-suite execution. Runtime binding, actual peer/TLS
and process custody, compiled configuration admission, coherent full-profile
validation and deployment remain separate owner gates. See the
[reader contract](../operations/updater-application-readiness.md).


## Contextual retained-record search presentation

The existing `node frontend/lantern-tests/healthy-read.mjs` positive also renders
actual SearchPalette/StoreProvider markup with generated retained views. It checks
archive opt-in only when scoped retained records exist, original archived-record
identity through the real search/projector, entity and retained source archive
qualifiers, and an ordinary home without archived records. Import paths alone
are adapted for static React rendering; no browser effect, transport or provider
is invoked. Existing typecheck and production build commands apply unchanged.

The shell Overview control is neutral; the existing overview Sources and selected
record details retain actual cache states and dates. The former global HomeBox
archive strip is removed, with generic archive access retained inside Search.
This is presentation only: Host archive defaults/lifetimes, read adapters, source
records, inventory/files/upkeep, query semantics and verified native links are
unchanged. Removing the HomeBox integration itself is outside this change.
Browser focus, scrolling and affected responsive presentation need fresh generated
or installed observations; static success does not qualify provider availability.

## Generated room-sheet presentation

The [room UX visual fixture](../../frontend/lantern-tests/room-ux-visual/README.md)
mounts the actual App and DetailPanel with the original fictional Alder house.
It provides populated room, empty-container and empty-section examples without
a native reader, session, acquisition port or admitted write. Geometry and
operation-history availability are explicitly unavailable. The fixture-specific
TypeScript configuration inherits the complete production configuration:

```sh
cd frontend
./node_modules/.bin/tsc --project lantern-tests/room-ux-visual/tsconfig.json
```

Use the existing generated source-host fixture separately for retained-record
Search and archive disclosure, and the existing saved Atlas fixture for
native-shaped historical room records. Supplied room-record counts and source
availability remain distinct; with both documentary layers off, the existing
reader omits the contents overview. Empty sections preserve their original
explanations and empty-container links. Record qualifiers, dates, unknowns and
retained observations stay inspectable.

The existing frontend typecheck, healthy read, Unified Atlas healthy and named
interaction checks, production build and backend asset compatibility check
remain the relevant ordinary checks. Manual desktop and phone review must
distinguish opening motion from settled pixels and verify focus through actual
invoking controls. Generated presentation does not establish native admission,
current source authorization, physical accuracy, deployment or device behavior.

Search first-glance text uses linked document names and recorded upkeep status
and dates. Homogeneous groups omit repeated kind labels; mixed groups retain
them. Document kind remains in its provenance details. Room rows show supplied
contents and exceptional archive/source/cache/no-shape states; normal source
state and every geometry mapping remain in contextual details. Storage type
does not establish file access, and an unknown upkeep status does not establish
an overdue task. A stored document without links may have a title-only result.

For this presentation, inspect both opening and settled Search and room sheets.
The Search scrim animates background color; foreground and record-sheet entry
animate transforms without opacity fading. Review the ancestor as well as the
foreground, ordinary keyboard selection and Close focus return, and the actual
contextual metadata destinations. Use the original supplied examples; source
review covers combinations absent from a generated fixture. These observations
do not qualify every source-state combination or frame timing.


## Initial configured-home bootstrap: generated React mount

Inspect `frontend/lantern-tests/session-bootstrap.mjs`, its JSX fixture and the
three changed production modules before these exact commands. Use Node 26.10.0,
the unchanged locked frontend dependencies, and the separately reviewed external
jsdom 26.1.0 installation at the path below. The test dependency stays outside
the app dependency and lock files. Run from the repository root in a disposable
synthetic checkout, with no real credentials, native providers or user data.

The ordinary positive group mounts the actual SessionApp and App through
ReactDOM with generated views and fake session/client ports:

```sh
HOUSEATLAS_TEST_JSDOM=/tmp/houseatlas-direct-entry-dom-20261020/node_modules/jsdom/lib/api.js node frontend/lantern-tests/session-bootstrap.mjs --healthy
```

Its five positives cover local and proxy initial opening, an existing session,
a host without the opt-in fence, and password-mode form presentation. It checks
that home content waits for fake verified-port completion, then reaches the
actual App. The fake completion represents the existing canonical wrapped port;
it does not execute that port's HTTP verification or prove server admission.

The following five commands belong only to the isolated synthetic regression
lane. Execute each as one separate process; there is no default broad suite:

```sh
HOUSEATLAS_TEST_JSDOM=/tmp/houseatlas-direct-entry-dom-20261020/node_modules/jsdom/lib/api.js node frontend/lantern-tests/session-bootstrap.mjs --regression strict-effect-setup
HOUSEATLAS_TEST_JSDOM=/tmp/houseatlas-direct-entry-dom-20261020/node_modules/jsdom/lib/api.js node frontend/lantern-tests/session-bootstrap.mjs --regression pending-remount
HOUSEATLAS_TEST_JSDOM=/tmp/houseatlas-direct-entry-dom-20261020/node_modules/jsdom/lib/api.js node frontend/lantern-tests/session-bootstrap.mjs --regression uncertain-open
HOUSEATLAS_TEST_JSDOM=/tmp/houseatlas-direct-entry-dom-20261020/node_modules/jsdom/lib/api.js node frontend/lantern-tests/session-bootstrap.mjs --regression port-replacement
HOUSEATLAS_TEST_JSDOM=/tmp/houseatlas-direct-entry-dom-20261020/node_modules/jsdom/lib/api.js node frontend/lantern-tests/session-bootstrap.mjs --regression subscription-during-open
```

The StrictMode setup and pending-root replacement cases exercise concurrent
observer lifetimes around one synthetic attempt. The unconfirmed-completion
case injects a rejected fake port and uses only the displayed canonical-session
check afterward. Port replacement and subscription cases overlap fake work with
an observer change. These are bounded concurrency/failure-injection cases, not
real session replay, crash, expiry, revocation or logout tests.

All commands forbid global fetch, use no listener or browser, and remove their
owned temporary bundle and React containers. They add no app dependencies,
workflow, CI step, runtime alias, security/control suite or deployment gate.
They do not qualify browser focus, CSS, installed sessions, session eviction,
native/provider behavior, canonical HTTP binding or live service recovery.

## Named generated local edit-retention positive

Inspect `frontend/src/local-edit-retention/types.ts`,
`frontend/src/local-edit-retention/store.ts`, the unchanged
`frontend/lantern-tests/synthetic-indexeddb.mjs` and the named runner before
this separately released manual positive. Use Node 26.10.0 and the existing
locked dependencies:

```sh
node frontend/lantern-tests/local-edit-retention-healthy.mjs
```

This imports the actual production store into disposable synthetic IndexedDB.
Its five positive groups cover close/reopen round trips, explicit local
partition/home/snapshot isolation, exact large revision strings, detached
buffers/results, immutable documentary originals, reversible proposals/reset,
unavailable original evidence and targeted discard with unrelated rows retained.
Successful mutations wait for transaction completion. Retain verifies its
owned input before writing; proposal set/reset verify the detached committed
draft afterward, outside the active transaction. Discard returns only whether
the selected local row existed. A rejected mutation alone does not prove
rollback; its local outcome remains unresolved until separately inspected.

The fixed local database is separate from saved-house and capture storage.
The caller-supplied partition is only a data partition: native authority stays
`not-established` and the current base stays `not-checked`. This unmounted
module adds no actor/session/grant authority, native envelope, submission,
acknowledgement, reconciliation or automatic retry. Browser-managed retention
is not a backup or a device-durability guarantee.

This command opens no browser, listener, network transport, provider or native
service and uses no user data. It adds no workflow, CI step, broad suite or
runtime alias. Fault/crash/replay, corruption, refusal/quota and concurrent
writer controls are not exercised or released by this positive. Browser/device
persistence, future mounting, live authorization and deployment remain separate.

## Named generated local edit-retention controller positive

Inspect `frontend/src/local-edit-retention/controller.ts`, the unchanged
retention store/types and synthetic IndexedDB helper, and
`frontend/lantern-tests/local-edit-retention-controller-healthy.mjs` before
this separately released manual positive. Use Node 26.10.0 and the existing
locked dependencies:

```sh
node frontend/lantern-tests/local-edit-retention-controller-healthy.mjs
```

The runner imports the actual controller and store into disposable synthetic
IndexedDB. Its serial healthy paths cover explicit select/read/retain without
implicit storage on selection, exact manifest/original bytes and large revision
strings, detached input/results/snapshots, separate proposals, partition/home/
snapshot isolation, completed-allocation retirement and clean store reopen,
nullable original evidence, reset and targeted discard. It observes transaction
completion before successful publication. Supplied record-original bytes retain
their own digest; an aggregate resource pin never supplies missing provenance.

The controller is unmounted and receives explicit documentary input and an
already partition-bound store. Partition and selection-generation values are
local attribution, not actor/session/grant, operation or idempotency authority.
Native authority stays `not-established`; the current base stays `not-checked`.
Retirement clears memory publication without cancelling or rolling back pending
storage. A rejected dispatched mutation is completion-unconfirmed until an
explicit read; no automatic retry or cleanup occurs.

Pending retirement, stale completions, reentrant observers, mutation failures,
concurrent writers and crash/replay controls are not exercised or released by
this serial positive. The case starts no browser, listener, transport, native
service or household intake. It changes no saved-house/capture store, worker,
host mounting, editor or submission path. Browser/device durability, live-base
reconciliation, native authorization and installed acceptance remain separate.

## Named generated retained-draft Saved UI positive

Inspect `frontend/src/local-edit-retention/saved-adapter.ts`,
`LocalEditPanel.tsx`, the bounded `offline/SavedAtlasHost.tsx` lifetime seam,
the unchanged controller/store/types and synthetic IndexedDB helper, and
`frontend/lantern-tests/offline-local-edit-mounting-healthy.mjs` before this
separately released manual positive. Use Node 26.10.0 and the existing locked
dependencies:

```sh
node frontend/lantern-tests/offline-local-edit-mounting-healthy.mjs
```

The runner bundles actual production imports into an owned temporary module
and uses actual React server rendering of the panel. Test setup alone seeds
matching pre-existing documentary drafts in disposable synthetic IndexedDB.
Serial adapter/controller/store operations cover exact selected-copy/resource/
manifest binding, separate resource/original hashes, large revision strings,
stable detached snapshots, proposal save/reset, partition/home/snapshot
isolation, empty read-only lists, clean store reopen, nullable evidence,
read-only inventory and targeted discard preserving unrelated rows.

This retained-row positive does not invoke candidate admission or retention.
It checks that the extended adapter starts with retention disabled and no
candidates; construction/rendering still perform no implicit storage reads.
The separate saved-identity positive below covers explicit new retention.
The production panel requires a memory-only local draft-space choice. That
partition is local data isolation, not an account or grant. Supplied original
bytes/revisions remain documentary evidence; proposal editing checks
byte-faithful UTF-8 JSON syntax, not native field semantics. Native authority
stays unestablished and the current base unchecked. Empty partitions stay empty
until explicit retention of independently admitted evidence.

SSR verifies markup, not DOM events, focus, effects or the actual Saved host
lifetime. Pending retirement, stale completions, reentrant observers, uncertain
writes, corruption/denial/fault/concurrency/replay/crash controls and cross-tab
behavior are not exercised or released by this serial positive. Source review
of those guards is not runtime qualification. Browser-managed persistence,
device durability, interactive browser/device acceptance, native submission/
reconciliation and deployment remain separate. No new workflow or runtime
alias, production data, provider, listener or native service is included.

## Named generated saved identity retention positive

Inspect `frontend/src/local-edit-retention/retained-identity.ts`, the extended
`saved-adapter.ts`/`LocalEditPanel.tsx`, the read-only resource-port seam in
`offline/SavedAtlasHost.tsx`, the unchanged store/controller/types and synthetic
IndexedDB helper, and the complete
`frontend/lantern-tests/offline-retained-identity-healthy.mjs` body before
execution. Use Node 26.10.0 and the existing locked frontend dependencies.
The exact commands run separately, serially in this order:

```sh
node frontend/lantern-tests/offline-retained-identity-healthy.mjs
node frontend/lantern-tests/offline-local-edit-mounting-healthy.mjs
```

This separate manual positive bundles actual production imports in an owned
temporary module and uses actual panel React SSR with generated local resource
ports and disposable synthetic IndexedDB. It has no arguments and a 60-second
process deadline. Generated multi-member, single-member and omissions-only packs
exercise original lexical integral decimal/exponent revisions through the
maximum safe value, exact noncanonical manifest/original bytes, independent
resource/member digests, complete membership and contiguous slices, a 1 MiB
included member and a valid oversized omission. Observation assertions run
outside adapter notification callbacks, whose exceptions are intentionally
caught by production code.

Serial explicit Read originals, Choose, verified absent Read, Retain, proposal,
clean store reopen, reset and targeted discard operations preserve detached
originals, immutable saved resources, unrelated rows and the other partition.
Choosing an existing row opens it without overwriting it; discard does not
automatically re-enable retention. The complete legacy retained-row positive
above is a separate invocation with only its obsolete no-retain-method assertion
updated. Run the two named commands once each in the order above, stopping on the first
failure. Do not substitute an aggregate suite or automatically retry a failed
invocation.

These generated positives establish only their inspected successful serial
paths and SSR markup. No negative/control, pending retirement, stale completion,
reentrancy, uncertain-write, corruption/denial/fault/concurrency/replay/crash,
actual mounted-host, DOM event/focus/effect, browser/device durability, native
authority, current-base, submission or deployment qualification is supplied.
This registration records commands and scope, not an execution outcome.
Invocation requires the coordinated exact-head release.

## Named generated Atlas current-connection read-validation positive

Inspect `backend/src/storage/updater_read_validation.rs`, its generated healthy
body and the delegated recovery/full-geodata validators before this separately
released manual positive. Use Rust 1.99.0, the locked dependencies and an owned
`CARGO_TARGET_DIR` outside the checkout:

```sh
cargo test --offline --locked -p houseatlas-backend --lib storage::store::updater_read_validation::healthy::healthy_current_profile_read_validation -- --exact --test-threads=1
```

The generated case prepares valid Atlas v5 and full-geodata v1 stores before
the observation window, then validates through their original owned connections.
It compares compiled recovery metadata, complete logical catalogue/table rows,
connection policy/change counters, Store and owner identities, database device/
inode and main-file bytes. The Connection-field address assertion does not
identify the underlying SQLite handle; absence of replacement also requires
source inspection.

Document and stock/queue facets are empty, and the original asset is blocked/
missing. This positive does not establish populated document, retained-byte or
stock/queue history coverage. Main-file equality is not general live WAL/SHM
filesystem no-write evidence.

This component reuses the existing compiled profile validators. Access methods,
maintenance composition, whole-Core coherence, running/stopped custody, real
host binding, application readiness and deployment remain separate. The case
uses no listener, browser, provider, session, household input or target service.
It adds no workflow, CI step, default suite, runtime exposure, access grant or
fault/concurrency/replay/crash/denial-control release.

## Named generated native retained-byte validation positive

Inspect `backend/src/storage/checks/updater-retained-bytes-healthy.rs`,
the two administrative methods in `storage/updater_read_validation.rs`, and
their existing Access, native media, recovery and historical-asset helpers.
Use Rust 1.99.0, the unchanged dependency lock and an owned external Cargo target:

```sh
cargo test --offline --locked -p houseatlas-backend --lib storage::store::updater_read_validation::retained_bytes_healthy::healthy_current_native_retained_bytes -- --exact --test-threads=1
```

This single ordinary positive creates a fresh synthetic Editor/session through
the actual Access owner. Setup commits two small owned text originals and
tombstones one asset through the existing guarded mutation path. Administrative
validation then uses the Store's original native vault and one Atlas transaction
for SQL closure plus the existing historical retained-byte traversal. The
generic PR258 API is unchanged; the native-specific method additionally checks
the original vault binding when delegating to full-geodata.

The case selects ordinary v5. It compares the SQL verdict, current and
single-receipt historical originals, callback observations, logical rows,
connection observations, main/WAL file bytes and identities, and vault-file
bytes/modes/identities around the validation call. Setup mutations and normal
Store close are outside that observation. The Rust connection-field address
is not an independent SQLite-handle proof. Populated batch, document and queue
histories and the native-specific full-geodata branch are not exercised here.

No listener, browser, provider, real account, household input, native target,
repair, migration, replay, fault or concurrency case is included. These bounded
observations establish neither general filesystem/SHM inactivity nor whole-Core
custody. The existing local media budgets and caller checkpoints are not a hard
absolute deadline or permission to inspect a running target.

## Named generated embedded-PNG material positives

Inspect `frontend/lantern-tests/embedded-png-material-healthy.mjs`, its generated
fixture and React hook seam, and the production loader, preflight, decoder,
geometry and MeshLayer imports before execution. Use Node 26.10.0 and the
unchanged locked frontend dependencies. Select one ordinary generated positive
per invocation:

```sh
node frontend/lantern-tests/embedded-png-material-healthy.mjs --case slots
node frontend/lantern-tests/embedded-png-material-healthy.mjs --case image-sharing
node frontend/lantern-tests/embedded-png-material-healthy.mjs --case png-filters
node frontend/lantern-tests/embedded-png-material-healthy.mjs --case png-adam7
node frontend/lantern-tests/embedded-png-material-healthy.mjs --case accounting-1024
node frontend/lantern-tests/embedded-png-material-healthy.mjs --case legacy-geometry
node frontend/lantern-tests/embedded-png-material-healthy.mjs --case gpu-owner
node frontend/lantern-tests/embedded-png-material-healthy.mjs --case precedence
```

These cases generate RGB PNGs and GLBs locally; global fetch is forbidden.
They cover supported slots and color roles, image sharing, filters and Adam7,
bounded accounting and mip chains, legacy geometry/picking and material opt-out,
owned resource cleanup and appearance precedence. The runner compiles actual
production imports into an owned temporary module and removes it afterward.
Its React hook seam and GL recorder exercise MeshLayer effects without a DOM,
real React mount, browser, native provider or household input.

The GL recorder reports successful shader compilation/linking and records
resource calls; it does not execute shaders or measure real GPU output.
Generated CPU/accounting assertions are not private-candidate, installed,
rendering or device acceptance, nor total browser/driver peak-memory evidence.
The separate lifecycle cancellation/reselection runner remains in the
separately reviewed regression lane; these commands do not release it or any
fault, denial, replay, expiry, concurrency or target controls.

## Named generated saved identity lifecycle regressions

Inspect the complete
`frontend/lantern-tests/offline-retained-identity-lifecycle-regression.mjs`
body, actual saved adapter, controller, retention store, retained-identity reader,
manifest/parser imports and unchanged synthetic IndexedDB helper before execution.
This separate manual regression lane uses only generated local data and owned
temporary modules with Node 26.10.0 and unchanged locked frontend dependencies.
After coordinated exact-head release, run these five separate processes once
each, serially in this order, stopping on the first failure:

```sh
node frontend/lantern-tests/offline-retained-identity-lifecycle-regression.mjs --case candidate-rejection-isolation
node frontend/lantern-tests/offline-retained-identity-lifecycle-regression.mjs --case candidate-read-retired
node frontend/lantern-tests/offline-retained-identity-lifecycle-regression.mjs --case reentrant-publication-retirement
node frontend/lantern-tests/offline-retained-identity-lifecycle-regression.mjs --case postcommit-verification-unconfirmed
node frontend/lantern-tests/offline-retained-identity-lifecycle-regression.mjs --case committed-write-retired-completion
```

There is no default or aggregate selector and no automatic retry. These commands
add no ordinary CI step, runtime alias or broader control-suite release.

The first case changes only the second member's declared hash in an otherwise
independently hashed generated pack and preserves an existing retained first
member. The second defers one valid aggregate resource return before aborting
the selected lifetime. The third uses four fixed serial subcases: reading and
selected publication, each with closeDetail and dispose. Reentrant reactions
are observed before checking that no stale resource/storage dispatch occurred.
Observation and resource-port assertion failures are checked outside production
callbacks that intentionally catch observer exceptions.

The fourth delegates to the actual store until write transaction completion,
then rejects exactly the following controller verification read. It preserves
the committed row, requires completion-unconfirmed publication and blocks another
write until an explicit successful read. The fifth holds the already committed
retain return, retires its allocation and creates a replacement before release;
the old attributed result must remain unpublished and the committed row retained.
Neither case establishes rollback or safe mutation retry.

Promise handshakes select these boundaries without runner sleeps, polling or
random timing. The 60-second in-runner deadline starts after module imports; it
is not an OS-enforced absolute containment/deadline claim. Evidence is captured
before cleanup releases pending barriers and closes the owned synthetic store.
Cleanup errors fail the case rather than turn it into PASS.

This registration records source and command scope, not execution outcomes.
Coverage is generated adapter/controller/storage behavior only. No actual React
host mount, DOM/focus/effects, browser/device durability, real parallel IndexedDB,
process crash, native/session/current-base authority, submission/replay, private
data, provider, listener, NAS operation or deployment is included. Other corrupt,
omission, denial, expiry, revocation, fault and concurrency cases remain held
unless separately reviewed and released; these five selectors do not release
a broad class of controls.

## Named generated native-place search positive

Inspect `frontend/lantern-tests/native-place-search-healthy.mjs`, its generated
topology and saved-house fixtures, and the production SearchPalette, topology
search helpers and provider imports before execution. With Node 26.10.0 and
unchanged locked frontend dependencies, the named command is:

```sh
node frontend/lantern-tests/native-place-search-healthy.mjs
```

The positive preserves distinct active native place identities with matching
labels, existing saved-house search and qualified saved-space navigation.
An unbound native result opens whole-home Places rather than treating a native
identity as a saved-space ID. Loading, unavailable and replaced-index inputs
remain explicit; no native read or mutation authority is inferred.

The runner uses generated data, actual production search helpers and an explicit
synchronous React hook seam for SearchPalette with React server rendering.
It observes an activation lease and serial retirement/reopen through that seam;
it does not mount the real provider, run its asynchronous read/fence lifecycle,
or establish actual DOM, focus, keyboard, browser or installed-site behavior.
The existing healthy-read SSR fixture supplies the production topology context
while preserving its original assertions. No listener, live provider, household
input, native submission, replay, fault/concurrency control or deployment is
included. This registration defines the command and source scope, not an
execution outcome or exhaustive whole-home search completeness.

## Named generated local-draft panel presentation check

Inspect `frontend/lantern-tests/local-edit-panel-presentation.mjs` and the unchanged
production `LocalEditPanel.tsx` before execution. With Node 26.10.0 and unchanged
locked frontend dependencies, the named command is:

```sh
node frontend/lantern-tests/local-edit-panel-presentation.mjs
```

The runner compiles the actual panel with Vite into an owned temporary module
and uses React server rendering with immutable generated snapshots and an
injected adapter whose operations fail if called. It checks read/write pending
controls, completion-unconfirmed presentation with explicit retained-draft reads,
retired and invalid selections, missing-evidence presentation, exact lexical
revision text, escaped documentary/proposal text and no render-time adapter
dispatch. Candidate and existing-draft controls are asserted in their separate
labelled lists. Compilation scratch is removed in a finally block.

These states are supplied presentation inputs; the runner induces no write
failure, retirement race or storage transition. Missing-evidence inputs explicitly
set canEdit false; this check does not qualify evidence validation. It does not
mount React effects, dispatch DOM events, operate an adapter/store, open a listener,
use household data or establish browser/device, native/current-base, recovery,
retry, crash, replay or deployment acceptance. PR268 lifecycle regressions remain
separate. This registration defines the command and bounded source scope, not an
execution outcome. Other held cases and broad suites are not released.

## Named generated compact layer-details focus check

Inspect `frontend/lantern-tests/unified-atlas-compact-layer-details.mjs`,
`LayerDetailsDock.tsx`, the coordinated focus and Escape handlers in
`UnifiedAtlas.tsx`, and the layer-details CSS before execution. Use Node
26.10.0, npm 11.19.1 and unchanged locked frontend dependencies. It runs in
CI through `frontend/lantern-tests/run-healthy.mjs`; the single command is:

```sh
node frontend/lantern-tests/unified-atlas-compact-layer-details.mjs
```

This generated check compiles the actual dock/helper and shell Escape handlers
with Vite and uses React server rendering plus an explicit synchronous hook
seam. Synthetic elements model desktop and short compact transitions, including
drawer=null and drawer=floors, queued key restoration after initial Close focus,
nearest scroll reveal, modal close/reopen, composing Escape containment and
ordinary Escape dismissal. It checks unchanged key children, generated long
text, markup and named CSS constraints. Run once; stop on failure without an
automatic retry or substitute suite.

The hook seam models child-first layout-effect order; it does not mount React
or prove actual browser event ordering, native modal top-layer/inert behavior,
Tab containment, focus restoration, layout, hit targets, camera or selection
preservation. The scroll observation is a synthetic method-call assertion,
not measured visibility. No listener, browser, provider, household input,
native target, failure injection, deployment or security-setting change is
included. This registration defines source and command scope only; actual
ordinary-check results and separately released sole-GUI acceptance remain open.

A one-off real-browser pass (Chromium through Playwright, generated saved
Atlas fixture, 740x360, 1280x800 and 390x844 at 125% text) on the PR that
landed this check observed: native `:modal` dialog named by its heading,
initial focus on Close, 50 Tab/Shift-Tab steps never reaching the
background, background hits landing on the dialog, the unfolded body
scrolling to its last row, composing Escape ignored, Escape and Close
returning focus to the Layer details fold, the selected room and camera
controls unchanged across five open/close cycles and a short-desktop-short
resize while open. That pass is evidence for that PR, not a standing check.

## Named generated Atlas control names check

`frontend/lantern-tests/unified-atlas-control-names-healthy.mjs` compiles
`labels.ts` alone and checks generated names: buildings sharing a label add
their source position, rooms sharing a label on one floor add their source
room position, parts of one room on a floor count off in source order, final
collisions get a source-order suffix, and exclusion notes show only the
source ID and reason (no invented name). It also checks that the shell uses
those names for the building chooser, room list and map label targets and
shows the whole model SHA-256 as selectable text. It runs in CI through
`run-healthy.mjs`:

```sh
node frontend/lantern-tests/unified-atlas-control-names-healthy.mjs
```

It does not mount React or a browser; identity stays the source ID.
