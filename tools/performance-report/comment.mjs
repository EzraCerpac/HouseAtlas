// Prepared integration for a separately approved, trusted workflow_run reporter.
// No workflow currently grants or invokes a comment-write token.
import { COMMENT_MARKER, validateIdentity } from './report.mjs';

const WORKFLOW_PATH = '.github/workflows/performance.yml';
export function eligiblePullRequest({ run, pull, identity, workflowId }) {
  validateIdentity(identity);
  if (!Number.isSafeInteger(workflowId) || workflowId < 1 || !run || !pull ||
      run.repository?.full_name !== identity.repository || run.event !== 'pull_request' || run.status !== 'completed' ||
      run.path !== WORKFLOW_PATH || run.workflow_id !== workflowId || run.id !== identity.runId || run.run_attempt !== identity.runAttempt ||
      run.head_sha !== identity.headSha || !['success', 'failure'].includes(run.conclusion)) return false;
  // The PR number comes from the API's run association, never an artifact.
  if (!run.pull_requests?.some(pr => pr.number === identity.prNumber && pr.base?.sha === identity.baseSha && pr.head?.sha === identity.headSha)) return false;
  return pull.number === identity.prNumber && pull.state === 'open' && pull.base?.repo?.full_name === identity.repository &&
    pull.base.sha === identity.baseSha && pull.head?.sha === identity.headSha;
}

export async function updateComment({ api, identity, markdown, workflowId }) {
  validateIdentity(identity);
  if (typeof markdown !== 'string' || !markdown.startsWith(COMMENT_MARKER + '\n') || Buffer.byteLength(markdown) > 60000) throw new Error('Invalid rendered report');
  const run = await api.getRun(identity.runId);
  let pull = await api.getPull(identity.prNumber);
  if (!eligiblePullRequest({ run, pull, identity, workflowId })) return { status: 'skipped', reason: 'stale-or-unassociated-run' };
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
  return { status: owned.length ? 'updated' : 'created' };
}
