# Synthetic PR performance reports

This lane identifies the exact PR base tip and head. Until the measurement owner
supplies the harness and canonical contract, every PR emits a bounded blocked
availability record and the trusted reporter updates one explicit skip table.
No metrics are fabricated. The existing ordinary workflows remain unchanged;
this separate reporting lane adds no service, stored credential, provider,
household input or deployment qualification.

The measurement owner defines the benchmark CLI, JSON contract and public
fixture identities. `tools/perf/reporting/` consumes normalized metric rows;
it does not define a second measurement schema. A comparison must record the
full base, head and harness source commits and the GitHub run/attempt. Use the
same harness and fixture profile for both sources. Differences in harness,
fixture, environment or runtime must be explicit skips, never inferred speedups.

The Markdown table includes absolute medians, absolute and percent changes, whether lower
or higher is better, nearest-rank p95, base/head sample counts and robust relative dispersion.
Dispersion is `1.4826 × MAD / median`, not a confidence interval. Timing changes
within `max(5%, 2 × (base dispersion + head dispersion))` are labeled
`within-noise`; fewer than five samples are labeled `insufficient-samples`.
Hosted-runner timing is informational. It is not a reliable PR failure budget.

Deterministic metrics can have an explicitly reviewed absolute maximum/minimum
or regression percentage. Their samples must agree exactly. No configured budget
is displayed as `no budget`; missing data is displayed as a skip. A zero baseline
has no percentage change unless both values are zero. This avoids reporting an
infinite or invented speedup.
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
The PR availability workflow grants only `contents: read`. Unspecified scopes
are `none`. The comment endpoint accepts `pull-requests: write`; a separate
`issues: write` grant is unnecessary. No persistent credential, PAT, app
installation, new secret or repository-default permission change is needed. See
[workflow permission rules](https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax#permissions)
and [comment API permissions](https://docs.github.com/en/rest/issues/comments#create-an-issue-comment).

`performance.yml` triggers for every PR without path/target-branch exclusions.
Its availability job checks out no source and runs no PR code. Its small JSON record contains only
repository, PR number, exact base/head commits, run/attempt and a fixed blocked
reason; the artifact expires after seven days. Its job summary also records the
skip. Actual measurement integration remains the measurement owner's task.
Its separate formatter-test job runs the exact named synthetic reporting checks
against the pinned candidate in the unprivileged read-only PR context, with
credentials not persisted and no secrets, dependencies or caches.
Candidates predating the reporting source get an explicit reporting-test skip;
their availability record and comment are still supported.

`performance-report.yml` triggers through `workflow_run` after that workflow.
Both reporter jobs check out only the platform's exact default-branch SHA, with
credentials not persisted. They run trusted built-in Node/Python code, install
no dependencies, execute no PR code/artifacts and restore no caches. The PR
number is resolved from GitHub API metadata before the per-PR publish-job
concurrency group is selected. The workflow must exist on the default branch
before GitHub can trigger it; a candidate-only PR cannot prove hosted writes.
GitHub describes the trust boundary in its
these risks in its [workflow event reference](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#workflow_run)
and [secure use reference](https://docs.github.com/en/actions/reference/security/secure-use#mitigating-the-risks-of-untrusted-code-checkout).

Before each comment write, the reporter resolves the canonical workflow id/path
and fetches the exact originating run attempt and associated PR from GitHub.
It validates repository, workflow, event, run id/attempt, exact head/base and
current open PR state, then resolves actual commit-tree hashes. Fork events with
an empty run association can use only a unique exact API match for head commit,
head repository, head branch and target repository. Ambiguity or a stale run is
an explicit job-summary skip; artifact content never chooses the destination PR.

The artifact must have the exact run/attempt name, originate in that run/head,
be unexpired and be at most 64 KiB. An isolated Python standard-library reader
admits exactly one regular `availability.json` member, at most 4 KiB, with
stored/deflate compression and valid framing/CRC. Extra members, symlinks,
paths, encryption and oversized payloads are rejected without extracting files.
The JSON is a closed availability record whose identities must match the API.
Unknown formats, arbitrary text and metric values are rejected. Invalid/missing
artifacts produce explicit unavailable rows. A failed originating run is also
explicit. API/archive errors never print raw artifact content or signed URLs.
The job token is sent only to the fixed GitHub API origin; storage redirects
must be HTTPS on known artifact hosts and receive no Authorization header.

The comment is regenerated from fixed labels and validated data. For future
metrics, the measurement owner's schema must be validated before normalization;
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
node --test --test-concurrency=1 tools/perf/reporting/compare.test.mjs tools/perf/reporting/report.test.mjs tools/perf/reporting/read-json.test.mjs tools/perf/reporting/adapter.test.mjs tools/perf/reporting/availability.test.mjs tools/perf/reporting/origin.test.mjs tools/perf/reporting/github-api.test.mjs
```

These tests exercise report arithmetic, rendering, generated in-memory ZIPs and fake GitHub API metadata/transports.
They open no listener, call no remote API and execute no application or provider
controls. They do not establish end-to-end hosted comment permission or security
qualification.

The exact contract adapter exports, proposed canonical schema path and implemented
report CLI are in [the measurement handoff](../tools/perf/reporting/README.md).
