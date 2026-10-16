# Generated model and interaction CPU measurements

This independently owned lane calls the production standard GLB loader,
manifest reader/binder, navigation index, triangle picker, room plan picker
and production React static renderer. It owns only this directory, with the
mechanical publication-manifest entries for its files. It does not change
frontend code, the existing reporting contract, workflows or ordinary CI.

Use Node **26.10.0**, npm **11.19.1** and the existing harness dependency lock.
Inspect this directory, its imports in `../harness/`, and the six selected
frontend modules before execution. Install public dependencies with scripts,
audit and funding disabled; use a writable disposable npm cache if needed:

```sh
npm ci --prefix tools/perf/harness --ignore-scripts --no-audit --no-fund
node --test --test-concurrency=1 tools/perf/model-interaction/healthy.test.mjs
node tools/perf/model-interaction/run.mjs --source-root /absolute/clean-source --output /absolute/existing-output-directory/new-run.json
```

These are explicitly requested synthetic performance measurements and focused
checks for this lane. They do not expand ordinary application test scope. All
inputs are generated boxes, metadata and plan polygons; no listener, provider,
browser, credential or private input is used. The CLI starts a local inspector
session in its child process without opening an inspector network port. The
child receives the existing harness environment allowlist and fixed arguments.
Outputs are create-only, mode 0600, outside both source and harness checkouts.
Missing runtime/dependencies or execution failures never become measured zeroes.
Invalid arguments fail before output; worker failure retains a failed document.

Run the same clean harness checkout sequentially against separately pinned
source checkouts, without concurrent CPU work. The CLI records actual Git
commit/tree/dirty states before and after, hashes selected source modules,
the fixture generator and harness files, and records runtime, V8, dependency
versions, lock hash, CPU and cgroup limits. Changed observations are failed.
Dirty runs are for local investigation only. Preserve raw JSON externally;
local runs have no GitHub Actions identity and are not hosted evidence.

The fixed `model-interaction-cpu-v1` profile generates 100, 1,000 and 5,000
translated nodes sharing an embedded eight-vertex/twelve-triangle box, with
10, 100 and 500 additional geometry-free room nodes. A complete generated v1
manifest pins each GLB, supplies two storeys and explicit matching identities,
and preserves unknown physical registration. A separate plan-only workload
has one explicit square per product on one synthetic floor. It does not infer
plan geometry from room metadata. Fixture byte counts and hashes, including
the canonical ordered plan data, are recorded for every size.

Three warmups precede nine raw timings. Timers exclude compilation, fixture
generation, common preparation, assertion checks and inspector profiling.
Preflight includes container JSON decoding. Manifest reading includes UTF-8
decoding, JSON parsing, complete structure/identity checks and projection.
Binding receives precomputed digests and bounds; it does not include hashing.
GLB loading includes preflight, owned loader input, actual GLTFLoader execution,
world transforms, flat normals/buffers and loader-resource disposal.
Navigation receives the admitted manifest and loaded GLB. Picking uses fixed
projections and an asserted middle-node/room hit. SSR renders the complete
product and room lists to a string, with its index prepared beforehand.

Each operation's result is checked outside the timer. The healthy tests also
check transformed bounds, identity joins, storey membership, geometry-free
rooms and plan holes/nesting/floor separation. The failed-source CLI test uses
a fresh disposable generated Git repository; it tests this harness's outcome,
not application rejection, recovery or security controls.

Allocation runs follow all timing runs for each size. Three separate local
V8 HeapProfiler sampling sessions use interval 32,768 with minor/major-collected
objects included. `*_sampled_js_bytes` sums the profile tree's `selfSize`:
**a statistical V8 JS allocation estimate**, not exact cumulative allocations,
peak memory, retained model size or native ArrayBuffer backing-store bytes.
Raw sample counts accompany every estimate. Small operations may sample zero;
that means no sampled allocation and never proves zero actual allocation.
The sampling boundary includes promise/inspector bookkeeping. Each fixture
records an identical empty-operation `samplingBaseline` for context, without
subtracting that noisy observation from the operation's estimate.
Raw `process.memoryUsage()` snapshots before and after forced GC are included
for context; deltas can be negative and include profiler/harness overhead and
the returned result. They are not attributed allocation/retention metrics.
`prepared_bytes` separately sums actual prepared typed-array byte lengths;
it excludes JS objects, loader temporaries, spare buffers and GPU resources.

No CPU observation measures browser fetch/decode, DOM commits, layout, paint,
frame times, GPU upload/disposal, first mesh draw, iPhone performance or network
latency. Those are explicitly unsupported. These are warm Node process
observations; GC/JIT/host scheduling can create outliers. Median, nearest-rank
p95, MAD and all raw samples are retained; nine samples do not establish a
stable tail distribution. There are no pass/fail timing budgets or improvement
claims in this lane.

## Integration handoff

The output format is `houseatlas.perf.model-interaction/1`, method
`model-interaction-cpu` revision 1. It is deliberately separate from
`houseatlas.perf.run/1`: existing reporter policies/schema must be extended by
their owners before ingestion. Do not splice these rows into the old method,
compare different fixture sizes, or relabel sampled bytes as deterministic.
Each `results[]` contains `fixture`, `metrics` (nine raw timing samples and one
deterministic prepared-byte sample) and `allocationMetrics` (three statistical
samples plus raw process snapshots). Each measured row has `id`, `status`,
`unit`, `samples` and a recomputable `summary`.

| Metric | Meaning / unit |
| --- | --- |
| `frontend.standard_glb.load_ms` | Full standard GLB CPU load/preparation/disposal, ms |
| `frontend.standard_glb.preflight_ms` | Container decoding plus closed admission, ms |
| `frontend.manifest.read_ms` | Complete manifest decoding/admission/projection, ms |
| `frontend.manifest.bind_ms` | Exact-pin and semantic-node binding checks, ms |
| `frontend.navigation.index_ms` | Index over admitted products and room occurrences, ms |
| `frontend.mesh.pick_ms` | Production triangle hit and node association assertion, ms |
| `frontend.room.plan_pick_ms` | Production explicit plan-room pick, ms |
| `frontend.navigator.ssr_ms` | Complete production static React rendering, ms |
| `frontend.standard_glb.prepared_bytes` | Prepared typed-array payload bytes |
| Each timing ID with `_ms` replaced by `_sampled_js_bytes` | Statistical V8 JS allocation estimate, sampled-js-bytes |

Requested handoff recipients: harness owner
`01a14490-1807-70ed-9183-5dd765cb90fb`, reporter owner
`01a1448f-ca3f-7192-8e58-ff9946db60da`, source integration owner
`01a13158-c477-746d-8023-299d117550d6`. Their external thread IDs are not
addressable by this session's collaboration tool; the delegating source thread
must relay this scoped PR and its exact head. Frontend coordinator
`01a13a27-40b1-704c-ab0c-5224bb9750f3` keeps all UI ownership.

The measured navigation hotspot is `navigationIndex` in `ModelNavigator.tsx`:
grouping each product with `[...previous, product]` copies an increasingly large
array for each of two storeys. The proposed owner fix is to allocate each group
once and append while preserving input order. `meshesByNode` has the same
copy pattern for multiple primitives on one node, which this one-primitive
fixture does not stress. This PR leaves both changes to the frontend owner.
