# Synthetic backend runtime profiling

Inspect `run.py`, the selected backend example and its support fixtures before
execution. Python 3.11+ uses only the standard library. The separate file task
adds `mise run perf:runtime-profile`; it does not edit the root mise config or
install tools. The direct Python command works without mise.

```sh
mise run perf:runtime-profile check
python3 tools/perf/runtime-profile/run.py check
mise run perf:runtime-profile prepare --output /tmp/new-runtime-plan
```

`check` prints a read-only plan, source identity and missing prerequisites.
`prepare` writes only that plan into a new private directory outside the
checkout. Neither mode builds Cargo targets, invokes a profiler, runs the
workload, starts a listener or installs anything. A plan is not measurement
evidence; the source may still be dirty and prerequisites may be unavailable.

The Cargo-mode writer owns `[profile.profiling]` in root `Cargo.toml`. This
entrypoint consumes it once present: `inherits = "release"`, `debug = 2`,
`strip = "none"` (or false), and `opt-level = 3` (explicit or release default).
Until that interface lands, deliberate collection stops with a blocked receipt.
It also checks Cargo's effective executable profile for optimization and full
debug information. No tracked Cargo manifest is rewritten or copied into a
different observer crate.

Use a clean isolated checkout and an already installed repository-pinned Rust
toolchain resolved through `rustup which`. Dependencies must already be cached:
builds use `--offline --locked`, a fresh owned target directory, no caller
Rustflags or profile overrides, and no install commands. On macOS the build
records `MACOSX_DEPLOYMENT_TARGET=15.0`. Offline build failure is a blocker,
not a reason to fetch dependencies or change permissions automatically.

```sh
mise run perf:runtime-profile cpu --output /tmp/new-runtime-cpu
mise run perf:runtime-profile allocations --output /tmp/new-runtime-allocations
mise run perf:runtime-profile rss --output /tmp/new-runtime-rss
```

Each directory must be new, absolute, outside Git, with an existing parent.
Each collection command builds the same selected workload independently and
retains its binary/symbols. No full local build is a source-publication gate.
This tooling does not change or extend ordinary CI or perform deployment.

The fixed workload is the existing `healthy-home-read-pack` example with no
arguments. It generates its own disposable native database, access and media,
then exercises actual backend owners, storage and in-process router/body work.
The source includes read-pack closure checks, generated geometry, synthetic
Documents and original/preview byte validation. It uses no socket listener,
live provider, NAS, household configuration or production originals.
The full example includes startup, fixture creation, assertions and cleanup.
These costs can dominate: this is useful for locating work in that concrete
backend scenario, not for steady-state request latency or end-to-end HTTP.
The workload ID, source file hash and Git tree pin the generated fixture
recipe; the example's temporary database is deliberately not a replay artifact.

| Mode | Output and scope | Limit |
| --- | --- | --- |
| `cpu` | Existing Samply, 1000 Hz, three fresh example processes, save-only JSON and sample count | Sampled stacks include setup/assertions; profiler overhead and scheduler bias apply. Zero samples are inconclusive. |
| `allocations` | Existing Linux Heaptrack, one fresh example process, native allocation trace | Whole-process allocator instrumentation; inspect the trace for allocation sites/counts/lifetimes. This entrypoint does not invent scalar allocation totals or treat instrumented wall time as CPU performance. |
| `rss` | Three uninstrumented fresh processes with raw wall/user/system CPU seconds, exit codes and OS process peak RSS | RSS is the resident-set high-water mark, not requested/live heap bytes. Linux KiB and macOS bytes are normalized to bytes; no aggregation hides the raw runs. |

CPU and allocation modes first run one separate uninstrumented workload check
and retain its direct exit code. The profiler's own exit code and artifacts
are recorded separately; inspect child diagnostics before concluding the
instrumented scenario completed. RSS checks each workload process directly.
Build/compiler work is outside every runtime observation. OS caches are
unmanaged; fresh processes do not mean cold caches. No cold/warm or throughput
claim follows, and these separate modes cannot be combined into one timing.

Samply is preferred for CPU sampling on Linux and macOS. If it is absent,
collection stops before building. A Linux `perf_event_paranoid` value above 2
causes a conservative stop even if special capabilities might permit sampling;
the tool never tests or requests those capabilities. At lower/unknown values,
Samply itself may still report denied perf access, and that step stops with its
local diagnostics. It never changes kernel settings, signs binaries, obtains
grants, runs sudo, opens a browser or installs a profiler. Heaptrack is an
optional already-installed Linux tool; missing/unsupported allocation tracing
does not prevent a separate available RSS or CPU mode.

Every real attempt writes `receipt.json`, including blocked attempts. Receipts
record the exact commit/tree and before/after dirty status; hashes for the
workload, entrypoint, lockfiles and Cargo/toolchain manifests; Python/OS/CPU
count; exact build and observation commands; Cargo/rustc versions and executable
hashes; effective artifact profile and workload binary hash; profiler version
and executable hash; raw results and artifact hashes. The Git tree identifies
the complete tracked backend/support-source closure. A changed source identity
invalidates collection. `collected` means artifacts were obtained, not that a
performance target or production acceptance passed. Retained local logs and
profiles can contain local paths: review them before sharing; never commit
generated output or private evidence.

The existing [response-preparation observer](../backend-response/README.md)
remains unchanged. It reuses exact production preparation bodies and separately
counts allocation calls/requested bytes for synthetic DTOs. Those counts are a
different scope from native-workload Heaptrack and process RSS, and are not
end-to-end HTTP or interchangeable optimized runtime timing evidence. The
existing performance contract/reporting and held candidates remain separate.

The scoped guard tests exercise profile prerequisites, restricted perf policy,
environment isolation, output custody, sample counting and prepare-only
behavior without Cargo, a profiler or any backend execution:

```sh
PYTHONDONTWRITEBYTECODE=1 python3 -m unittest discover -s tools/perf/runtime-profile -p test_runtime_profile.py -v
```

They are manually selectable and are not registered in ordinary CI by this PR.
See the official [Samply CLI](https://github.com/mstange/samply),
[Heaptrack](https://github.com/KDE/heaptrack) and
[mise file tasks](https://mise.jdx.dev/tasks/file-tasks.html) for tool behavior.
