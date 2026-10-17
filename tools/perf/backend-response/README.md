# Browser response preparation measurement

This supplemental local CPU lane compares the accepted `968a17f78979b7827387af0984333fb64c55a9f6`
browser preparation bodies with this checkout's exact bodies. It does not change
the existing performance contract, reporting adapter, workflow or PR200 harness.
It imports the existing harness's Git identity helper and the actual PR200
`PROFILE` at `7174252a67c85f8417f3646cf82a49c058f3d8d6`: 100, 1,000 and 5,000
generated records, three warmups, nine timing samples and three allocation
observations. It runs three fresh timing processes, alternating before/after
order within each process, plus three allocation-counting processes. The timing
build uses the normal allocator; instrumentation is compiled only into the
allocation build. These are supplemental measurements, not reporting-contract
rows or hosted CI evidence.

Inspect `run.mjs`, `worker.rs`, the selected production browser functions,
`lifecycle::fixture` and the PR200 fixture module before running. PR200's exact
commit must already exist in the local object database. Use Node 26.10.0 and
Rust 1.99.0. Run from a clean isolated checkout without simultaneous CPU-heavy
work. The absolute compiler path avoids mixing versions through PATH shims.

```sh
RUSTC=/absolute/rust-1.99.0/bin/rustc CARGO_TARGET_DIR=/absolute/owned/observer-target node tools/perf/backend-response/run.mjs --output /absolute/new/response.json
```

`CARGO_TARGET_DIR` is optional; when absent, an owned temporary target is removed
at exit. Never select another task's active target directory. The observer crate
is always generated in a temporary directory. It resolves its package entry
offline using a copy of the source lock, checks registry versions against that
lock, then builds offline with `--locked`. No tracked Cargo file changes.
The child environment contains only compiler/cache paths, locale, timezone and
its owned temporary directory. On macOS, both sides target macOS 15.0.
Output is create-only, outside Git, and includes source/binary/compiler/fixture
identities, raw samples and before/after source-stability checks.

The worker compiles the exact `browser_view`, `browser_entry` and
`browser_entries` bodies from both sources. Only function visibility and the
error carrier are adapted for standalone successful calls. Domain types and
fixture/projection code come from the actual backend; the runner requires those
selected peers to match the baseline. Both paths use the same binary, libraries,
allocator and generated input. Complete view and entry-array JSON bytes must
match before timing. Inputs include opaque Unicode and escaped source strings,
null numeric values, exact large quantities/costs and both attachment variants.

Fixtures start with the public plan-free lifecycle projection and repeat its
browser entries with generated identities and metadata. These are DTO stress
fixtures, not expanded validated canonical storage graphs or household inputs.
The changed source-key conversion is reached for every record. The observer
does not exercise native request authorization, SQLite, network, collectors,
deployment, source publication validation or a live HTTP listener.

Two operations are observed: preparation with prepared-Value disposal, and
preparation plus JSON encoding. Input cloning and correctness assertions are
outside observation; disposal of the consumed input is included. Allocation
calls include alloc, alloc_zeroed and realloc. Requested bytes include the full
new size of realloc requests; they are neither net/live bytes, allocator overhead,
RSS nor a peak-memory estimate. No whole-application or transport speedup follows
from these warm-process CPU measurements.
