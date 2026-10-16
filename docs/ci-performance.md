# Synthetic PR performance reports

This lane compares the exact PR base tip and head, rather than a moving branch
name or GitHub's synthetic merge commit. It uses only generated or checked-in
public fixtures. It adds no service, credential, provider, household input or
deployment qualification. Existing ordinary workflows and their scope remain
unchanged.

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

## Permission boundary

Current workflows grant only `contents: read`. A job summary and review artifact
can carry a table with these existing permissions. Automatically creating or
updating a PR conversation comment requires an additional GitHub token permission.
That expansion has not been approved or implemented.

All three checked-in workflows explicitly declare `permissions: { contents:
read }`. Unspecified permissions are therefore `none`, regardless of broader
repository defaults. The existing local GitHub connector's ability to create
this PR does not grant an Actions job comment access. Reading the repository's
default workflow-permission setting returned HTTP 403; no setting was changed.

The minimal proposed reporter job permissions are:

```yaml
permissions:
  contents: read       # exact trusted default-branch reporter/contract source
  actions: read        # originating run metadata and cross-workflow artifacts
  pull-requests: write # create/update the PR conversation comment
```

The comment endpoint accepts `pull-requests: write`; a separate `issues: write`
grant is unnecessary. This is a new versioned workflow permission declaration.
The resulting `GITHUB_TOKEN` is ephemeral per job; no persistent credential,
PAT, app installation, new secret or repository-default permission change is
needed. It still requires the task's scoped approval before installation. See
[workflow permission rules](https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax#permissions)
and [comment API permissions](https://docs.github.com/en/rest/issues/comments#create-an-issue-comment).

`comment.mjs` is a prepared, dependency-injected updater with synthetic API tests.
It is not wired to a privileged workflow or a credential. A future approved
reporting workflow must be triggered by `workflow_run` after the unprivileged
`pull_request` measurement workflow. It must use the default branch's trusted reporter, never check
out or execute PR code, never execute artifacts, and never restore caches
produced by PR code. The measurement workflow must remain unprivileged with no
secrets, persistent checkout credentials or shared cache writes. GitHub describes
these risks in its [workflow event reference](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#workflow_run)
and [secure use reference](https://docs.github.com/en/actions/reference/security/secure-use#mitigating-the-risks-of-untrusted-code-checkout).

Before any future comment write, resolve the workflow by its trusted path/id and
fetch the completed run and associated PR from GitHub. Validate repository,
workflow, event, run id, attempt, full base/head commits and current open PR state.
Resolve both source commit objects and verify their actual tree hashes as well.
Derive the PR number from GitHub's run association, never from uploaded JSON.
Bound artifact size and parse data only. The measurement owner's schema must be
validated before normalization; unknown metric names and raw text are not report
policy. Recompute the Markdown table with trusted labels/direction/budgets rather
than accepting artifact Markdown. Do not print raw artifact content on errors.

Serialize updates by PR and recheck base/head immediately before writing. Update
only a `github-actions[bot]` comment beginning with
`<!-- houseatlas-performance-v1 -->`. Ignore user-authored lookalikes, reject
historical duplicate bot markers, and never overwrite a newer run/attempt with
an older one. Outdated runs and closed PRs are explicit skips.

## Focused formatter verification

Inspect these complete sources before executing the named local checks:

```sh
node --test --test-concurrency=1 tools/perf/reporting/compare.test.mjs tools/perf/reporting/report.test.mjs tools/perf/reporting/read-json.test.mjs tools/perf/reporting/adapter.test.mjs
```

These tests exercise report arithmetic, rendering and fake GitHub API metadata.
They open no listener, call no remote API and execute no application or provider
controls. They do not establish end-to-end hosted comment permission or security
qualification.

The exact contract adapter exports, proposed canonical schema path and implemented
report CLI are in [the measurement handoff](../tools/perf/reporting/README.md).
