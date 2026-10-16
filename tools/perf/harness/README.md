# Synthetic CPU and bundle measurements

This is an explicit synthetic performance lane. It does not change ordinary CI,
request a token permission, run an application test alias or install a browser.
Ownership is `tools/perf/harness/` and `tools/perf/contract/`; the reporting owner
retains `tools/perf/reporting/` and workflows. Product frontend code is unchanged.

Use Node **26.10.0** and npm **11.19.1**. Inspect the selected harness, source
functions and source Vite configuration before executing them. Source builds
execute source-owned configuration and are suitable only for an isolated,
unprivileged measurement job with no secrets, grants or provider credentials.
This harness is not an execution sandbox. Its child processes receive a small
environment allowlist, not the caller's tokens, browser paths or Node options.

Prepare the exact harness lock once. Prepare each source checkout's existing
frontend lock separately; the harness never installs dependencies itself.

```sh
npm ci --prefix tools/perf/harness --ignore-scripts --no-audit --no-fund
npm ci --prefix /absolute/base-checkout/frontend --ignore-scripts --no-audit --no-fund
npm ci --prefix /absolute/head-checkout/frontend --ignore-scripts --no-audit --no-fund
node tools/perf/harness/run.mjs --source-root /absolute/base-checkout --output /absolute/new/base.json
node tools/perf/harness/run.mjs --source-root /absolute/head-checkout --output /absolute/new/head.json
```

Run the exact same clean harness checkout against separately pinned source
checkouts, sequentially without concurrent CPU-heavy work. Output parents must
exist. Outputs are create-only regular JSON files outside both checkouts. The
CLI reads actual Git identities and dirty state; there are no source identity,
executable, fixture, browser or arbitrary command override flags. It records
identities and selected source byte hashes again after execution. Work happens
in an owned temporary directory, removed at exit. Changes during observation
produce failed metrics. Dirty development runs can be inspected locally but the
reporting contract refuses a dirty/changed harness.

Successful, unsupported and blocked runs exit 0. Any failed metric exits 1,
retaining the owned run document. Invalid arguments, unavailable Git identity,
missing harness dependencies or an unavailable output fail before producing a
run. Measurement errors after dependency bootstrap use fixed diagnostics rather
than printing source text or paths; a missing harness installation is a Node
module-bootstrap error.
Missing product features are `unsupported`; unavailable source build dependencies
are `blocked`; an implemented feature that fails is `failed`. None becomes zero.

The fixed `synthetic-cpu-bundle-v1` profile uses three untimed warmups and nine
raw samples for each CPU timing; deterministic byte counts have one sample.
Source compilation/import, fixture generation and common preparation happen
outside each timed operation. Source transforms and React/Three execution use
the same harness lock on both sides. Source production builds use their own
installed Vite/React versions, recorded in the comparison environment. Builds
run in a fresh process and temporary output; this does not claim an empty OS
page cache or newly downloaded dependencies.

| Metric | Timed or counted operation |
| --- | --- |
| `frontend.scan.parse_ms` | Actual lossless parser over the owned 18,610-byte public synthetic mesh fixture |
| `frontend.scan.prepare_ms` | Actual display preparation from an already parsed profile |
| `frontend.scan.edges_ms` | Actual cosmetic edge extraction on its first prepared mesh |
| `frontend.scan.prepared_bytes` | Sum of prepared vertex-array byte lengths; not JS heap or GPU bytes |
| `frontend.standard_glb.load_ms` | Container/preflight, loader input copy, GLTFLoader, transforms, flat-buffer extraction and CPU resource disposal |
| `frontend.standard_glb.prepared_bytes` | Sum of prepared GLB vertex-array byte lengths |
| `frontend.navigation.index_ms` | Complete index construction over generated minimal navigation records, not manifest admission |
| `frontend.mesh.pick_ms` | Current production triangle picker; meshes/projection are prepared beforehand |
| `frontend.navigator.ssr_ms` | Complete production-mode `renderToStaticMarkup`, with index prepared beforehand; not DOM commits/layout/paint |
| `frontend.startup_js.bytes` | Deduplicated entry and HTML modulepreload JS bytes from an actual temporary production build |
| `frontend.startup_js.gzip_bytes` | Offline Node zlib default gzip of those files, not observed transport compression |
| `frontend.bundle.largest_asset_bytes` | Largest regular emitted file, including non-JS assets |
| `browser.*` | Always unsupported in this method; no browser/GPU execution or frame evidence exists |

`mesh-profile.fixture.json` is the public generated seven-mesh/84-triangle
README fixture retained from `e8fe7494068c83b3623d03b41bef29549ef9f703`, with
unknown physical scale/alignment unchanged. `fixtures.mjs` generates a standard
GLB with one eight-vertex/twelve-triangle box referenced by 1,000 translated
nodes (12,000 triangles). Every run records both individual byte hashes.
Navigation has one product per node, one declared storey, two class labels and
no inferred rooms. Picking uses a fixed 960×640 projection at yaw −32°, pitch
36°, no clipping and a point projected from the middle node's top. No household
data, native host, URL, texture, upload, converter or provider is used.

The [contract guide](../contract/README.md) describes the sole schema and exact
PR189 reporting adapter. A local execution has no GitHub Actions run identity;
do not invent one or attach its observations to an unrelated hosted run. Keep
raw runs for a local comparison. The actual reporting CLI requires identity
from the trusted event/API. Browser rows remain explicit skips until a new
reviewed method can execute a supported browser that actually draws.

After inspecting these focused unit/CLI sources, use:

```sh
node --test --test-concurrency=1 tools/perf/contract/index.test.mjs tools/perf/harness/bundle.test.mjs tools/perf/harness/run.test.mjs
```

They use data-only inputs, generated bundle text and a fresh disposable local
Git repository with no frontend feature. They open no listener or provider and
exercise no application denial/recovery controls. To verify the independently
owned exact reporter, select its read-only PR189 checkout explicitly:

```sh
HOUSEATLAS_PERF_REPORTING_ROOT=/absolute/pr189-checkout node --test --test-concurrency=1 tools/perf/harness/reporting-integration.test.mjs
```

That integration test asserts reporter commit
`ad3ff7f4a39458f11a668da5df9e2944b1fe18ee` before loading its adapter. Its run/PR
identity is explicitly synthetic unit data, never a hosted measurement or PR
comment. It verifies the real contract/CLI, missing-feature skips, failed metrics
and environment mismatch. It does not alter reporting or workflow files.
