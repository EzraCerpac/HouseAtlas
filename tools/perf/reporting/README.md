# Measurement owner handoff

Ownership is `tools/perf/harness/` and `tools/perf/contract/` for measurement;
`tools/perf/reporting/` for reporting. This directory defines no competing JSON
schema for `houseatlas.perf.run/1`.

The canonical schema is `tools/perf/contract/run.schema.json`; its module is
`tools/perf/contract/index.mjs`, owned by PR190 at
`8f41c7d71984beb382eb2105e4b0f035262a0d72`. Its verified schema SHA-256 is
`642af28eacc14e6fdd7b9f7071979f07abc8dcb9a427773f5d74dab672b7056a`.

The trusted contract module must export:

```js
export const schemaSha256 = /* SHA-256 of the exact run.schema.json bytes */;
export const policies = [
  // Static, reviewed policy; never loaded from an untrusted run document.
  { id: 'example.latency', label: 'Example latency', unit: 'ms',
    kind: 'timing', direction: 'lower' },
  // kind: 'deterministic' may additionally set maximum, minimum,
  // or maxRegressionPercent only after the budget is reviewed.
];
export function validateRun(value) { /* validate the owned wire schema */ }
export function reportView(value) { /* return the normalized view below */ }
```

`validateRun` returns a boolean or throws; diagnostics are not printed. Its
closed wire schema must retain commit/tree/dirty, harness/schema revisions,
individual fixture byte hashes, environment/browser/GPU, build/cache/scenario,
warmups/repetitions, raw samples and summary statistics. The reporter recomputes
median, nearest-rank p95, MAD, min and max from bounded nonnegative raw samples;
wire summaries are never used for arithmetic.

`reportView` is an adapter interface, not a second wire format:

```js
{
  sourceCommit: '40 lowercase hex', sourceTree: '40 lowercase hex', dirty: false,
  harnessCommit: '40 lowercase hex', schemaSha256: '64 lowercase hex',
  fixtureFingerprint: '64 lowercase hex',
  comparisonFingerprint: '64 lowercase hex',
  metrics: [
    { id: 'example.latency', status: 'measured', samples: [1, 2, 3, 4, 5] },
    // Or { id, status: 'unsupported' | 'blocked' | 'failed' }, with no samples.
  ]
}
```

Compute fingerprints in the trusted contract module from validated fields;
do not accept an opaque artifact-provided claim of comparability. The fixture
fingerprint covers ordered fixture ids and exact byte hashes. The comparison
fingerprint covers measurement method/revision, runtime/toolchain,
environment/browser/GPU, build/cache modes, scenario/settings, warmups and
repetitions. It excludes the intentionally differing production source commit,
tree, samples and summaries. Both sides must use the same harness source and
schema bytes, and match all comparison fields. Unknown metric ids fail closed;
missing known metrics and all non-measured statuses stay explicit. `failed`
status fails the report check. Missing feature support in the base never becomes
a zero, percent improvement or speedup. Stage markers do not establish actual
GPU completion; browser/GPU measurements need their own explicit method.

Owned measurement CLI:

```sh
node tools/perf/harness/run.mjs --source-root /absolute/base-checkout --output /absolute/new/base.json
node tools/perf/harness/run.mjs --source-root /absolute/head-checkout --output /absolute/new/head.json
```

Run the exact same harness checkout against both separately pinned source
checkouts and retain the same fixture/settings/profile. It must emit an owned
run document even for `unsupported`, `blocked` or `failed` metrics. It must
inspect the source's actual Git identity and dirty state, rather than accepting
caller-supplied source identity as proof. Use only public/generated fixtures;
do not run broad application test aliases to manufacture a benchmark.

The reporter CLI is implemented:

```sh
node tools/perf/reporting/cli.mjs --base /absolute/base.json --head /absolute/head.json --identity /absolute/trusted-identity.json --markdown /absolute/new/report.md --comparison /absolute/new/comparison.json
```

The identity file comes from the trusted event/GitHub API and must contain
`repository`, `prNumber`, `runId`, `runAttempt`, `baseSha`, `baseTree`, `headSha`,
`headTree` and `harnessSha`. Include optional `reporterSha` for a revision-pinned
reporting-method link; otherwise the report states its noise rule inline and
labels the harness link as collection-only. Its source identities are checked against both
validated measurement views. It is not supplied by a PR artifact. The CLI writes
new files only; exit code 1 denotes a configured deterministic budget failure,
a failed metric, invalid contract/data/identity or an unavailable output. Timing
movement alone never fails. The comparison JSON records
`houseatlas.perf.comparison/1`, trusted identity, profile fingerprints,
recomputed summaries, delta and the failed flag. These are report outputs, not
an alternate input schema. The production CLI requires the measurement owner's
locked dependencies and canonical module. Healthy integration checks use the
real pinned module.

The metric comment updater accepts the same trusted identity, contract and
validated base/head records and regenerates its content internally. It has no
raw-Markdown input. The hosting workflow must import the contract from trusted
default-branch source and obtain identity from GitHub rather than an artifact.

The unprivileged workflow collects actual base/head records sequentially with
the immutable harness pin and uploads only that pair. It executes no candidate
reporting test, formatter or preview entrypoint. After collection, only the fixed
availability writer and pinned upload action run; the raw collector emits no
Markdown preview. Incomplete collection uses the separate closed
`houseatlas.perf.availability/1` record and an explicit blocked row.
Availability identities have `harnessSha: null` and the actual trusted
`reporterSha`; measured identities still require a full harness commit. The
publisher validates the completed originating run, actual GitHub
commit trees, exact artifact metadata/contents and current PR before updating
the same bot marker. The read-only resolver selects the per-PR concurrency key
from API data. No PR number or Markdown is accepted from an artifact.

The privileged publisher imports the validator and policy only from its trusted
default-branch checkout, with the trusted harness lock installed without scripts.
It also checks the pinned harness commit/tree and the exact trusted owned-file
digest. Merge PR190's canonical files before PR189 for immediate metric posting;
the reverse order safely produces contract-unavailable rows until installation.

Only `healthy-reporting.test.mjs` is automatic, in the read-only `workflow_run`
resolution job. Its complete body and imports come from the platform's exact
default-branch checkout. Its canonical fixture source is the immutable harness
pin, with that public lock installed without scripts. The step receives no job
token and has no collector filesystem or measurement artifacts. Candidate test
presence, contents and imports never select automatic cases; a missing accepted
default-source test fails. Retained adversarial and mutation/omission files
remain held and are source-reviewed rather than invoked by this lane. Proposed
reporter changes require source inspection and the named local healthy check
before acceptance; this automatic suite exercises accepted default code.

The comment presents five columns with one-decimal percentage deltas, concise
status symbols and a single unsupported-browser/GPU note. The short Evidence
section links source revisions, methodology and raw p95/noise data; it does not
repeat the full run documents. Full precision, statistics, profiles and gate
results remain in the machine comparison and raw records. Display rounding
never participates in comparison or budget arithmetic.
