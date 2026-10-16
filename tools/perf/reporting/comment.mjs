// Only trusted default-branch code calls these publishers. Artifacts are data.
import { appendReportEvidence, COMMENT_MARKER, validateIdentity } from './report.mjs';
import { compareRuns } from './adapter.mjs';
import { makeAvailabilityReport } from './availability.mjs';

export const WORKFLOW_PATH = '.github/workflows/performance.yml';
export function eligiblePullRequest({ run, pull, identity, workflowId }) {
  validateIdentity(identity);
  if (!Number.isSafeInteger(workflowId) || workflowId < 1 || !run || !pull ||
      run.repository?.full_name !== identity.repository || run.event !== 'pull_request' || run.status !== 'completed' ||
      typeof run.path !== 'string' || run.path.split('@')[0] !== WORKFLOW_PATH || run.workflow_id !== workflowId || run.id !== identity.runId || run.run_attempt !== identity.runAttempt ||
      run.head_sha !== identity.headSha || !['success', 'failure', 'cancelled', 'timed_out', 'skipped', 'neutral', 'action_required', 'stale', 'startup_failure'].includes(run.conclusion)) return false;
  // The PR number comes from the API's run association, never an artifact.
  if (!run.pull_requests?.some(pr => pr.number === identity.prNumber && pr.base?.sha === identity.baseSha && pr.head?.sha === identity.headSha)) return false;
  return pull.number === identity.prNumber && pull.state === 'open' && pull.base?.repo?.full_name === identity.repository &&
    pull.base.sha === identity.baseSha && pull.head?.sha === identity.headSha;
}

async function writeReport({ api, identity, workflowId, render, evidence }) {
  validateIdentity(identity);
  const run = await api.getRun(identity.runId);
  let pull = await api.getPull(identity.prNumber);
  if (!eligiblePullRequest({ run, pull, identity, workflowId })) return { status: 'skipped', reason: 'stale-or-unassociated-run' };
  const [baseCommit, headCommit] = await Promise.all([api.getCommit(identity.baseSha), api.getCommit(identity.headSha)]);
  if (baseCommit.sha !== identity.baseSha || baseCommit.commit?.tree?.sha !== identity.baseTree ||
      headCommit.sha !== identity.headSha || headCommit.commit?.tree?.sha !== identity.headTree) return { status: 'skipped', reason: 'source-tree-mismatch' };
  // Rebuild from the trusted contract and validated data. Uploaded Markdown is
  // never accepted as comment content, even if it contains the correct marker.
  let { markdown, failed } = render();
  if (evidence) {
    if (!Number.isSafeInteger(evidence.artifactId) || evidence.artifactId < 1 || !/^[0-9a-f]{64}$/.test(evidence.artifactSha256 ?? '')) throw new Error('Invalid artifact evidence');
    markdown = appendReportEvidence(markdown, [
      `[Raw measurements / p95 / noise](https://github.com/${identity.repository}/actions/runs/${identity.runId}/artifacts/${evidence.artifactId}) · archive SHA-256 \`${evidence.artifactSha256}\``,
    ]);
  }
  if (run.conclusion !== 'success') {
    markdown += '\n\n**❌ Originating workflow failed; these observations do not override its checks.**';
    failed = true;
  }
  if (Buffer.byteLength(markdown) > 60000) throw new Error('Invalid rendered report');
  const comments = await api.listComments(identity.prNumber);
  const owned = comments.filter(comment => comment.user?.login === 'github-actions[bot]' && comment.user?.type === 'Bot' &&
    comment.body?.startsWith(COMMENT_MARKER + '\n'));
  // Concurrent writers must be serialized by PR in the hosting workflow. Refuse
  // historical duplicates instead of silently creating another comment.
  if (owned.length > 1) throw new Error('Multiple owned performance comments require review');
  const newer = owned[0]?.body.match(/Measurement run (\d+), attempt (\d+)/);
  if (newer && (Number(newer[1]) > identity.runId || (Number(newer[1]) === identity.runId && Number(newer[2]) > identity.runAttempt))) {
    return { status: 'skipped', reason: 'newer-report-exists' };
  }
  // Recheck after pagination, immediately before writing, to reject stale heads
  // and a base branch which advanced during artifact/report processing.
  pull = await api.getPull(identity.prNumber);
  if (!eligiblePullRequest({ run, pull, identity, workflowId })) return { status: 'skipped', reason: 'stale-or-unassociated-run' };
  if (owned.length) await api.updateComment(owned[0].id, markdown);
  else await api.createComment(identity.prNumber, markdown);
  return { status: owned.length ? 'updated' : 'created', failed, markdown };
}

export function updateComment({ api, identity, baseRun, headRun, contract, workflowId, evidence }) {
  return writeReport({ api, identity, workflowId, evidence, render: () => compareRuns({ identity, baseRun, headRun, contract }) });
}

export function updateAvailabilityComment({ api, identity, availability, workflowId }) {
  return writeReport({ api, identity, workflowId, render: () => makeAvailabilityReport({ identity, availability }) });
}
