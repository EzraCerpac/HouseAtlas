# Synthetic PR performance reports

This separate requested lane identifies the exact PR base tip and head for every
PR target. It runs one pinned synthetic harness sequentially against both
sources and regenerates one speedup/degradation table from validated raw runs.
The existing ordinary workflows and their main/dev scope remain unchanged;
this separate reporting lane adds no service, stored credential, provider,
household input or deployment qualification.

The measurement owner defines the benchmark CLI, JSON contract and public
fixture identities. `tools/perf/reporting/` consumes normalized metric rows;
it does not define a second measurement schema. A comparison must record the
full base, head and harness source commits and the GitHub run/attempt. Use the
same harness and fixture profile for both sources. Differences in harness,
fixture, environment or runtime must be explicit skips, never inferred speedups.
The immutable harness source is `d03223b0669761cf92846492fe56fb9e8f9f7db9`.
The sole schema, owned by PR190, is `tools/perf/contract/run.schema.json`, SHA-256
`642af28eacc14e6fdd7b9f7071979f07abc8dcb9a427773f5d74dab672b7056a`.

The Markdown table includes absolute medians, absolute and percent changes, whether lower
or higher is better, nearest-rank p95, base/head sample counts and robust relative dispersion.
Dispersion is `1.4826 × MAD / median`, not a confidence interval. Timing changes
within `max(5%, 2 × (base dispersion + head dispersion))` are labeled
`within-noise`; fewer than five samples are labeled `insufficient-samples`.
Hosted-runner timing is informational. It is not a reliable PR failure budget.

Deterministic metrics can have an explicitly reviewed absolute maximum/minimum
or regression percentage. Their samples must agree exactly. No configured budget
is displayed as `no budget`; missing data is displayed as a skip. A zero baseline
has a null percentage with `deltaPercentStatus: zero-baseline`. A derived
percentage overflow has a null value with the distinct `overflow` status and
an explicit table label. Neither becomes zero or an invented infinite speedup.
The initial owned policy configures no new deterministic budget.
Inconsistent deterministic samples skip an unbudgeted metric; with a configured
budget they fail because the proposed budget cannot be evaluated reliably.
Relative deterministic budgets compare the numeric inputs' shortest round-trip
decimal forms exactly, avoiding binary rounding at limits while preserving
strict integer/byte limits. Both sides' unavailable statuses remain visible.

## Permission boundary

The three existing workflows retain `contents: read`. The separately scoped
reporter uses an ephemeral `GITHUB_TOKEN` with these publish-job permissions:

```yaml
permissions:
  contents: read       # exact trusted default-branch reporter/contract source
  actions: read        # originating run metadata and cross-workflow artifacts
  pull-requests: write # create/update the PR conversation comment
```

The metadata-resolution job has only read access to contents, Actions and PRs.
The PR measurement workflow grants only `contents: read`. Unspecified scopes
are `none`. The comment endpoint accepts `pull-requests: write`; a separate
`issues: write` grant is unnecessary. No persistent credential, PAT, app
installation, new secret or repository-default permission change is needed. See
[workflow permission rules](https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax#permissions)
and [comment API permissions](https://docs.github.com/en/rest/issues/comments#create-an-issue-comment).

`performance.yml` triggers for every PR without path/target-branch exclusions.
Its measurement job checks out the pinned harness and exact base/head into three
separate roots without persistent credentials. It installs their public locks
without scripts/audit/funding, then runs both measurements sequentially on the
same host. Only `base.json` and `head.json` are uploaded; if collection cannot
complete, a closed blocked availability record is emitted instead. Records
expire after seven days. CPU timing has three warmups and nine samples; source
build sizes have one deterministic sample. Browser/GPU rows stay unsupported.

Only `healthy-reporting.test.mjs` is automatic. It uses valid samples/archives
and fake exact metadata, including the real canonical contract when available.
Held adversarial and mutation/omission files are not executed. A missing healthy
test is a legacy skip only when it was absent at the trusted API merge base;
deleting a previously required check fails rather than silently skipping.

Compatible candidates can also produce a separate unprivileged preview using
actual event/run metadata. That Markdown is never accepted by the publisher.
Older candidates still produce raw measurement pairs for the trusted reporter.

`performance-report.yml` triggers through `workflow_run` after that workflow.
Both reporter jobs check out only the platform's exact default-branch SHA, with
credentials not persisted. They run trusted Node/Python code and install only
the trusted default-branch harness lock (scripts/audit/funding disabled, optional
native packages omitted). The canonical module is imported from that default
checkout only; producer PR code is never checked out or executed in these jobs.
They execute no artifacts and restore no caches. The PR
number is resolved from GitHub API metadata before the per-PR publish-job
concurrency group is selected. The workflow must exist on the default branch
before GitHub can trigger it; a candidate-only PR cannot prove hosted writes.
GitHub describes the trust boundary in its
[workflow event reference](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#workflow_run)
and [secure use reference](https://docs.github.com/en/actions/reference/security/secure-use#mitigating-the-risks-of-untrusted-code-checkout).

Before each comment write, the reporter resolves the canonical workflow id/path
and fetches the exact originating run attempt and associated PR from GitHub.
It validates repository, workflow, event, run id/attempt, exact head/base and
current open PR state, then resolves actual commit-tree hashes. Fork events with
an empty run association can use only a unique exact API match for head commit,
head repository, head branch and target repository. Ambiguity or a stale run is
an explicit job-summary skip; artifact content never chooses the destination PR.

The artifact must have the exact run/attempt name, originate in that run/head,
be unexpired and be at most 256 KiB. An isolated Python standard-library reader
admits exactly the two regular `base.json`/`head.json` members, each at most 1 MiB,
or one regular `availability.json` member of at most 4 KiB (archive at most 64 KiB), with
stored/deflate compression and valid framing/CRC. Extra members, symlinks,
paths, encryption and oversized payloads are rejected without extracting files.
Measurement JSON must pass the sole canonical schema, recomputed statistics,
actual source commit/tree/dirty checks, the pinned harness commit/tree and
the trusted default source's harness-file digest. Unknown formats and policy
overrides are rejected. Invalid/missing
artifacts produce explicit unavailable rows. A failed originating run is also
explicit. API/archive errors never print raw artifact content or signed URLs.
The job token is sent only to the fixed GitHub API origin; storage redirects
must be HTTPS on known artifact hosts and receive no Authorization header.

The comment is regenerated from fixed labels and validated data. The measurement
owner's schema is validated before normalization;
unknown metric names and raw text cannot set report policy. The formatter never
accepts artifact Markdown.

Serialize updates by PR and recheck base/head immediately before writing. Update
only a `github-actions[bot]` comment beginning with
`<!-- houseatlas-performance-v1 -->`. Ignore user-authored lookalikes, reject
historical duplicate bot markers, and never overwrite a newer run/attempt with
an older one. Outdated runs and closed PRs are explicit skips.

## Focused formatter verification

Inspect these complete sources before executing the named local checks:

```sh
node --test --test-concurrency=1 tools/perf/reporting/healthy-reporting.test.mjs
```

These healthy cases exercise arithmetic, rendering, valid generated archives
and exact fake GitHub metadata. Held test files remain excluded.
They open no listener, call no remote API and execute no application or provider
controls. They do not establish end-to-end hosted comment permission or security
qualification.

The exact contract adapter exports and report CLI are in
[the measurement handoff](../tools/perf/reporting/README.md).
Merge PR190's canonical files before PR189 to activate numerical publication
immediately. The reverse order remains safe: the reporter emits an explicit
contract-unavailable row until that exact trusted contract is installed.
