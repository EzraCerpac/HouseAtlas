# Synthetic host/client measurements

This opt-in tool reuses the actual Rust `--disposable-dir` SQLite/TLS fixture,
Node HTTPS, the existing locked Vite bundler and production
`frontend/src/api/client.ts` Atlas/session adapters. It adds no browser stack,
provider, grant, workflow, network shaping or deployment. References #461 and
#277. It does not reopen the held #293 viewer campaigns.

Inspect these sources before execution. Use the existing pinned Node 26.10.0,
locked frontend dependencies, Python 3, OpenSSL, and an explicitly supplied
compiled Rust binary. No command builds, installs dependencies, discovers a
server or falls back to an external origin. Rust accepts only a new /tmp data
directory here. The fixture generates a minimal root page and a 256 KiB asset,
not the application frontend or household material.

From the repository root:

```sh
node --test tools/perf/host-client/options.test.mjs tools/perf/host-client/compare.test.mjs
mise run perf-host-client contract --binary /absolute/path/to/houseatlas
mise run perf-host-client faults --binary /absolute/path/to/houseatlas
```

The equivalent direct entrypoint is
`node tools/perf/host-client/run.mjs <mode> --binary <path>`.
The executable file-based mise task owns no root mise configuration. Unknown
modes/options, missing values, repeated options and empty selections fail.

## Separate commands and outcomes

`contract` checks real TLS API replies through the production Atlas and session
decoders, scoped view parity, the generated asset digest and immutable policy,
and JSON MCP initialize/notification/tools-list. MCP does not support SSE here;
the protocol's accepted media-types header is not a streaming test. Read-only
SQLite counts confirm six fixture records and no native audit writes.

`faults` delays delivery of an actual read by 150 ms, exposes a partial read
followed by an error, cancels a delayed read, and withholds one native circuit
create acknowledgement. Faults are confined to this Node adapter's delivery
after verified HTTPS. The host network is unchanged. Only the native create uses
a raw bounded HTTP port; read and cancellation cases use the production Atlas
adapter. The native create contract is the retained healthy-core loopback shape.
The create is submitted exactly once. The client outcome is unknown when the
acknowledgement is withheld; separate passive record/history GETs then establish
revision 1 with one history entry. The tool never retries the unknown write.
This does not qualify durable outbox reconciliation, arbitrary crash windows,
TCP packet loss, server cancellation, or provider effects.

`measure` accepts an operator-provided release-build provenance file:

```json
{
  "profile": "release",
  "sourceSha": "<40 lowercase hex characters>",
  "binarySha256": "<64 lowercase hex characters>",
  "runnerId": "synthetic-run-01"
}
```

Build each base/candidate server in release mode with the same locked toolchain,
flags, features and dependencies in isolated owned checkouts, using the normal
Cargo/mise build commands. Record the exact source SHA and SHA-256 of each
binary, and use a public neutral runner-allocation label. Provenance is checked
against the binary bytes but is an operator assertion about build flags. This
tool does not silently accept a debug build as a measured release baseline.

Run base and candidate sequentially on the same otherwise idle runner allocation
and the same driver checkout, using separate binary and provenance paths:

```sh
mise run perf-host-client measure --binary /absolute/base/release/houseatlas --provenance /tmp/base-provenance.json > /tmp/base-host-client.json
mise run perf-host-client measure --binary /absolute/candidate/release/houseatlas --provenance /tmp/candidate-provenance.json > /tmp/candidate-host-client.json
node tools/perf/host-client/compare.mjs /tmp/base-host-client.json /tmp/candidate-host-client.json
```

This is a per-command disposable host restart, not a shared production service.
The reports contain only allowlisted generated metadata, hashes and timings;
no cookie, credential, endpoint origin, server log or response content is emitted.
Keep reports outside the repository. No benchmark outcome is checked in.

## Bounds and interpretation

Every request cohort defaults to a 45 s deadline and accepts
`--deadline-ms` only up to 60000. Per-request wall time is at most 5 s, including
body delivery. All network starts are paced at `--rate` (default/max 10 per
second), including setup reads, and at most `--concurrency` (default 1/max 4)
requests are active. Samples default to 30 and are capped at 200 per measured
cohort. The fixture's aggregate generated assets are below 8 MiB; each received
body is bounded by 8 MiB. Setup is separate: certificate generation has a 5 s
timeout, Rust readiness a 30 s timeout, and shutdown a 6 s grace period followed
by termination of only the owned child. The existing Vite bundling step is
setup work outside request cohorts. Every invocation removes its generated files
and stops its owned Rust child after ordinary completion/failure/signals.

Speed cohorts are first API read on a fresh host/SQLite fixture with a new TLS
connection (one sample), repeated API reads with new TLS connections, repeated
API reads with keep-alive, and generated static-asset transfers with keep-alive.
API data is explicitly no-store. Asset replies advertise immutable caching, but
this driver always transfers them and reports that fact; it does not label a
driver-memory hit as a production cache hit. Browser cache/offline cache/device
measurements remain outside this first non-browser suite. OS/filesystem cache is
never flushed, so "first read" is not machine-cold disk. TLS session reuse is
disabled; actual socket reuse is retained per sample.

Raw samples retain planned/actual start, queue wait, scheduling lag, full client
latency (including adapter decode), network duration, bytes, status, socket reuse
and errors. Summary throughput includes successful completions per cohort wall
time and both transferred and successful bytes/sec. These low offered rates are
observations, not maximum sustainable throughput. Generator CPU, observed RSS,
event-loop delay, missed work and late starts disclose saturation. Linux /proc
also supplies observed child RSS and aggregate CPU ticks when available; other
platforms report null, not zero. RSS sampling is not exact peak memory and same
machine generator/server contention remains a limitation.

p50 needs at least 2 successful samples, p95 at least 20 and p99 at least 100.
Below those counts the value is null. Even above them the nearest-rank values
are descriptive empirical quantiles, not confident population-tail estimates.
Incomplete or errored measurements retain a report and exit nonzero.
Errors, timeouts and cancellations stay separate; failed latency is never
silently inserted into successful quantiles. Comparison rejects different
runner/runtime, client bundle, offered load, fixture size or cohort contexts.
Saturated or errored comparisons are marked unqualified. No automatic performance
gate or speedup claim follows from one pair; repeat pairs with alternating order
before drawing a conclusion.

## Qualification status and next seam

The new test files are explicit, source-only stdlib Node tests. They are not added
to ordinary CI in this change. The host/client contract, faults and measurements
also remain opt-in; existing named ordinary CI is unchanged. A possible future
CI scope is exactly the two pure Node test files in ordinary-core, followed by
a separately reviewed non-browser `contract` invocation using the existing
Rust build artifact. Faults and release measurement should remain separately
selected. That is a proposal for coordination, not an enabled lane.

The existing frontend healthy runner can still report zero-match success for an
unknown `--only` substring. That shared seam is deliberately left for its owner;
these new commands fail closed independently. Source review, ordinary CI,
execution of this new tool, merge, installation and device acceptance must be
reported separately.
