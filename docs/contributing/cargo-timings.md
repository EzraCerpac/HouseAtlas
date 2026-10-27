# Cargo timing diagnostics

References #462 and #277.

The existing Rust React workflow records its existing Cargo compilations:
source-checker Clippy/examples and macOS binary, Linux stock example, Network
example build, backend library test command and the three loopback binary builds. No build is repeated for measurement, and no
target, feature, test selection or browser lane is added. Existing check names,
PR cancellation, permissions, cache keys and main-only cache-save conditions
remain in place. The setup action adds only observed restore outputs; changing
that action/workflow naturally changes the existing exact build-cache key and
can use its existing fallback.

Each selected Rust job initializes public build context under
`$RUNNER_TEMP/houseatlas-cargo-timings`. The wrapper adds stable `--timings`
before any Cargo `--` separator, measures monotonic command wall time, copies
the HTML report immediately to a unique name and writes the matching JSON.
It removes only Cargo's diagnostic scratch directory after copying, keeping
timing reports out of the compiled-dependency cache. A failed command cannot
borrow the preceding command's report; unavailable HTML stays explicit.
Diagnostic recording errors do not replace Cargo's exit status or signal.

Summaries and uploads run after failed commands where the runner can still
execute steps. Cancellation or runner loss may prevent collection. The existing
pinned upload-artifact action retains each job's JSON, HTML and Markdown for
14 days, with a name containing the job/OS/shard, run id and attempt. Collection
steps are diagnostic and may fail without changing the existing build result.
No raw logs, environment dump, credentials, databases or application data are
uploaded. HTML includes public build metadata and generated runner source paths.

## Reading the results

- Registry and compiled-dependency caches are separate observations. The latter
  distinguishes `exact-hit`, `fallback-hit`, `miss` and `unknown` from the
  cache action outputs; blank outputs are never reported as a confirmed hit.
- A dependency-cache hit still rebuilds workspace crates, which the existing
  main-save action prunes. It is not a no-op or incremental rebuild measurement.
- A cache miss is not a fully cold machine: toolchains, registry content and
  runner filesystem state may already be warm. Compare registry state too.
- HTML reports describe compilation units and concurrency. Wrapper wall time
  includes Cargo overhead and may also include selected test/example execution.
  A failed compilation does not prove that execution began.
- Compare the same command, source, toolchain, OS/architecture/image, CPU count,
  memory, profile settings and cache state. The context JSON retains these.
  Existing job duration also includes setup, restore, npm and artifact costs;
  use GitHub step durations for those costs rather than attributing them to rustc.
- These observations supply no controlled same-runner cold/warm/rebuild pair
  or speedup. Do not average unlike cohorts or infer a caching benefit from
  unrelated jobs. No sccache or additional cache is installed.

## Warning policy and source integration

The source checker routes its existing Cargo calls through the exported
`runCargo(args, options)`. Formatting does not receive `--timings`; non-Cargo
generator and frontend commands keep their original process path. The merged
#458 measurement-generator check is preserved on the refreshed main base.

The wrapper sets `CARGO_BUILD_WARNINGS=deny` only for Clippy. The repository's
1.99.0 pin satisfies Cargo's documented 1.97 minimum. The checker removes its
trailing `-- -D warnings` while retaining exactly `--lib --bins --examples`
and the existing feature selection. No `--all-targets` or `--all-features`
is added. This preserves warning denial while avoiding that lint flag's build
fingerprint change; it is not a measured speedup.

Without `HOUSEATLAS_CARGO_TIMINGS_DIR`, the checker still invokes the same
Cargo target set with no timing flag or report files; Clippy retains the same
Cargo warning policy. The existing toolchain pin remains the only version pin.

Sources: [Cargo timings](https://doc.rust-lang.org/cargo/reference/timings.html),
[Cargo build.warnings](https://doc.rust-lang.org/cargo/reference/config.html#buildwarnings),
and [official Clippy CI guidance](https://github.com/rust-lang/rust-clippy#travis-ci).
