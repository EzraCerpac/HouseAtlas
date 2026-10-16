# Synthetic measurement contract

`run.schema.json` is the only wire schema for `houseatlas.perf.run/1`.
`index.mjs` exports the exact interface expected by reporting PR189 at
`ad3ff7f4a39458f11a668da5df9e2944b1fe18ee`: `schemaSha256`, `policies`,
`validateRun(value)` and `reportView(value)`. The SHA is computed from the actual
schema bytes. The module uses the locked Ajv dependency in the sibling harness;
prepare it with the named command in [the harness guide](../harness/README.md).

The closed schema retains actual before/after Git commit, tree and dirty state,
harness files digest and schema revision, individual generated fixture byte
hashes, runtime/toolchain and host limits, browser/GPU support, build/cache modes,
scenario, warmups/repetitions, raw samples and summaries. Measured timing rows
contain nine samples; deterministic rows contain one. Statistics are median,
nearest-rank p95, median absolute deviation, min, max and count. Validation
recomputes every summary, rejects duplicate/unknown metric ids and disallows
samples on unsupported/blocked/failed rows. Browser/GPU measurements cannot be
represented as measured by this method revision.

`reportView` derives both fingerprints from validated fields, rather than using
an opaque comparison claim from an artifact. Fixture fingerprints cover ordered
fixture ids, byte sizes and hashes. Comparison fingerprints cover the entire
method, profile, environment, schema and harness tree/files digest. They exclude
the intentionally different product source identity/files and observations.
Settings are fixed for v1; changing them requires a reviewed method/schema
revision. Dirty or changed harness source cannot enter reporting. Dirty or
changed product source remains explicit for the reporter's identity check.

Run documents remain untrusted observations. The reporter separately obtains
repository/PR/run identities from its trusted hosting context. A schema-valid
document is not proof that its observations occurred. There are no newly
configured deterministic budgets in this initial contract. Timings are
informational; missing support never becomes zero or an inferred speedup.

The focused data-only unit checks open no application listener or provider:

```sh
node --test --test-concurrency=1 tools/perf/contract/index.test.mjs
```
