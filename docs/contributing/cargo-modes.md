# Optional Cargo modes

These modes are conveniences for deliberate development and measurement. They
add no local prerequisite to publishing a PR. Existing CI owns compilation,
Clippy and tests. Compile speed and runtime speed need separate measurements.

Run from an owned checkout with mise, Node and the rustup-managed version in
`rust-toolchain.toml` already installed. These tasks read that single Rust pin
and use `rustup run`; they do not install tools. Inspect the task and wrapper
before trusting repository mise configuration. File tasks are executable and
live under `.mise/tasks/`; the root formatting configuration is separate.

| Command | Cargo operation | Purpose |
| --- | --- | --- |
| `mise run check -- --lib` | `cargo check --profile check` | Optional targeted type check without linking; debug info off |
| `mise run dev` | `cargo build --profile dev-incremental` | Explicit incremental development build in a persistent checkout |
| `mise run profiling` | `cargo build --profile profiling` | Release-derived optimized build with full debug symbols |
| `mise run bench` | `cargo build --profile benchmark` | Release-derived build with fixed optimization/check settings and incremental off |
| `mise run cargo-diagnostic` | Compiler/Cargo version queries | Report selected pin and host platform; no build |

All build/check commands include `--locked -p houseatlas-backend` and run at the
workspace root. Additional Cargo options pass through, for example
`mise run check -- --bin houseatlas` or
`mise run profiling -- --example healthy-contracts`. The tasks build rather
than launch the application. `bench` prepares a binary; it does not execute a
benchmark, measure latency or exercise production. Without mise, invoke
`node tools/cargo-modes/run.mjs profiling` (or another mode) directly.

Cargo's built-in `dev`, `release`, `test` and `bench` defaults are unchanged.
The opt-in `check` profile inherits `dev` and disables debug information.
`dev-incremental` inherits `dev` and explicitly enables incremental compilation;
Cargo already enables that for ordinary development. Reuse the same owned
checkout and target directory to benefit from it. A fresh disposable checkout
does not provide a warm incremental baseline.

## Runtime profiler interface

Use `cargo build --locked -p houseatlas-backend --profile profiling`, or the
`profiling` task above, adding the explicit target needed by the harness.
The `profiling` profile inherits `release`, sets `debug = 2`,
`strip = "none"` and `incremental = false`. The normal host binary is
`target/profiling/houseatlas`; examples are under
`target/profiling/examples/`. Custom target directories and cross-compilation
change these paths. Keep symbol companion files on platforms that use them.
No runtime instrumentation or profiler dependency is enabled by this profile.

## Comparable measurements

The `benchmark` profile inherits `release`, explicitly uses optimization level
3, disables debug info, debug assertions, overflow checks and incremental
compilation. LTO and codegen-unit tuning are intentionally left at the pinned
Cargo defaults; select changes only after a same-runner comparison. This is an
opt-in harness build profile, distinct from Cargo's built-in `bench` profile.

Record exact base/candidate SHAs, Rust version/host, profile, targets/features,
runner resources, flags, Cargo configuration and cache state. Use identical
settings for both sides. Cargo config, `RUSTFLAGS`, `CARGO_ENCODED_RUSTFLAGS`,
`CARGO_PROFILE_*`, target and compiler-wrapper environment variables can override
or change compiler behavior; the diagnostic prints versions only and is not a
complete environment receipt. The tasks reject direct profile/manifest/config
override flags; direct Cargo remains available when an intentional override
needs measurement.

Build timings (for example `mise run dev -- --timings`) measure compilation,
not request handling. Separate clean-target, warm rebuild and cached no-op
observations; no task cleans caches automatically. Runtime comparisons use
identical synthetic workloads and report their own latency/throughput/error
results. A profile definition alone establishes no performance improvement.
