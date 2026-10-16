# Recorded measurement coverage

The existing `houseatlas.perf.run/1` contract stays unchanged. Its current
synthetic CPU/build profile measures twelve CPU/static metrics and declares
five browser/GPU metrics unsupported. Those rows do not cover every requested
performance scenario.

After producing a clean run with the existing harness, summarize its evidence:

```sh
node tools/perf/harness/coverage.mjs --run /absolute/recorded-run.json --json /absolute/new/coverage.json --markdown /absolute/new/coverage.md
node --test --test-concurrency=1 tools/perf/harness/coverage.test.mjs
```

The input is bounded data, validated with the existing contract. Outputs are
create-only coverage artifacts, not new measurement documents, reporter inputs
or hosted run identities. Summaries are recomputed from samples. Missing,
failed, blocked and unsupported rows retain their state; no zero values or
overall coverage percentage are invented. Source/harness/fixture fingerprints,
the exact input hash and coverage tool source hash are retained.

Coverage is deliberately specific:

- Startup asset bytes and offline gzip do not establish network transfer,
  browser parsing, navigation time or first visible content.
- Warm Node parsing/preparation/picking and React static markup do not establish
  actual room/plan input latency or DOM commits.
- CPU vertex bytes do not establish JavaScript heap, process RSS, retained
  memory after reopen or GPU allocations.
- Warm CPU repetitions do not establish application cache hits, durable-cache
  reopen, offline availability or iOS background/foreground behavior.
- A null WebGL context supplies no 3D frame, draw-call or GPU-memory evidence.
  Actual 2D browser/device observations may still be collected independently.

Independent backend and model lanes must retain their own method, environment,
fixture hashes, exact source identities, scenario/cache state, warmup/repetition
counts and raw samples. Do not append new ids or free-form fields to the closed
v1 run, or flatten unlike observations into one comparison. New producer metrics
need an agreed contract/method revision and corresponding reporter policies.
Keep model/backend benchmark implementations outside this coverage module and
leave reporting/workflow files with their owner.

These four focused tests use synthetic data only. They execute no application,
listener, browser, cache, backend, provider, model import or product control.
