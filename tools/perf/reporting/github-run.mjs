import { appendFileSync, readFileSync } from 'node:fs';
import { createGithubApi } from './github-api.mjs';
import { publishOrigin, resolveOrigin } from './origin.mjs';

try {
  if (process.version !== 'v26.10.0' || process.env.GITHUB_EVENT_NAME !== 'workflow_run' ||
      process.env.GITHUB_REPOSITORY !== 'EzraCerpac/HouseAtlas' || !process.env.GH_TOKEN) throw new Error();
  const event = JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH, 'utf8'));
  if (event.repository?.full_name !== process.env.GITHUB_REPOSITORY) throw new Error();
  const context = { repository: process.env.GITHUB_REPOSITORY, reporterSha: process.env.TRUSTED_SOURCE_SHA,
    runId: event.workflow_run?.id, runAttempt: event.workflow_run?.run_attempt };
  const api = createGithubApi({ token: process.env.GH_TOKEN, repository: context.repository, runAttempt: context.runAttempt });
  const mode = process.argv[2];
  if (process.argv.length !== 3 || !['resolve', 'publish'].includes(mode)) throw new Error();
  if (mode === 'resolve') {
    const origin = await resolveOrigin({ api, context });
    appendFileSync(process.env.GITHUB_OUTPUT, `pr_number=${origin ? origin.identity.prNumber : ''}\n`);
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, origin ? 'Validated one exact originating PR using GitHub metadata.\n' : 'Report skipped: stale or unassociated originating run.\n');
  } else {
    const result = await publishOrigin({ api, context, expectedPrNumber: Number(process.env.EXPECTED_PR_NUMBER) });
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, result.markdown ? result.markdown + '\n' : 'Report skipped: stale, unassociated or superseded run.\n');
    console.log(`Performance report: ${result.status}.`);
    process.exitCode = result.failed ? 1 : 0;
  }
} catch {
  console.error('Trusted performance reporting failed; no artifact content or token was logged.');
  process.exitCode = 1;
}
