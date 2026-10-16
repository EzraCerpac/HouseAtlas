# Synthetic PR performance reports

This lane compares the exact PR base tip and head, rather than a moving branch
name or GitHub's synthetic merge commit. It uses only generated or checked-in
public fixtures. It adds no service, credential, provider, household input or
deployment qualification. Existing ordinary workflows and their scope remain
unchanged.

The measurement owner defines the benchmark CLI, JSON contract and public
fixture identities. `tools/performance-report/` consumes normalized metric rows;
it does not define a second measurement schema. A comparison must record the
full base, head and harness source commits and the GitHub run/attempt. Use the
same harness and fixture profile for both sources. Differences in harness,
fixture, environment or runtime must be explicit skips, never inferred speedups.

The Markdown table includes absolute medians, raw percent changes, whether lower
or higher is better, base/head sample counts and robust relative dispersion.
Dispersion is `1.4826 × MAD / median`, not a confidence interval. Timing changes
within `max(5%, 2 × (base dispersion + head dispersion))` are labeled
`within-noise`; fewer than five samples are labeled `insufficient-samples`.
Hosted-runner timing is informational. It is not a reliable PR failure budget.

Deterministic metrics can have an explicitly reviewed absolute maximum/minimum
or regression percentage. Their samples must agree exactly. No configured budget
is displayed as `no budget`; missing data is displayed as a skip. A zero baseline
has no percentage change unless both values are zero. This avoids reporting an
infinite or invented speedup.

## Permission boundary

Current workflows grant only `contents: read`. A job summary and review artifact
can carry a table with these existing permissions. Automatically creating or
updating a PR conversation comment requires an additional GitHub token permission.
That expansion has not been approved or implemented.

`comment.mjs` is a prepared, dependency-injected updater with synthetic API tests.
It is not wired to a privileged workflow or a credential. A future approved
reporting workflow must use the default branch's trusted reporter, never check
out or execute PR code, never execute artifacts, and never restore caches
produced by PR code. The measurement workflow must remain unprivileged with no
secrets, persistent checkout credentials or shared cache writes. GitHub describes
these risks in its [workflow event reference](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#workflow_run)
and [secure use reference](https://docs.github.com/en/actions/reference/security/secure-use#mitigating-the-risks-of-untrusted-code-checkout).

Before any future comment write, resolve the workflow by its trusted path/id and
fetch the completed run and associated PR from GitHub. Validate repository,
workflow, event, run id, attempt, full base/head commits and current open PR state.
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
node --test --test-concurrency=1 tools/performance-report/compare.test.mjs tools/performance-report/report.test.mjs tools/performance-report/read-json.test.mjs
```

These tests exercise report arithmetic, rendering and fake GitHub API metadata.
They open no listener, call no remote API and execute no application or provider
controls. They do not establish end-to-end hosted comment permission or security
qualification.
