import { WORKFLOW_PATH, eligiblePullRequest, updateAvailabilityComment } from './comment.mjs';
import { makeAvailabilityReport, parseAvailabilityZip } from './availability.mjs';

const positive = value => Number.isSafeInteger(value) && value > 0;
const sha = value => typeof value === 'string' && /^[0-9a-f]{40}$/.test(value);
export async function resolveOrigin({ api, context }) {
  if (!context || !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(context.repository) || !sha(context.reporterSha) ||
      !positive(context.runId) || !positive(context.runAttempt)) throw new Error('Invalid trusted workflow context');
  const [workflow, rawRun] = await Promise.all([api.getWorkflow(), api.getRun(context.runId)]);
  if (!positive(workflow.id) || workflow.path !== WORKFLOW_PATH || rawRun.repository?.full_name !== context.repository ||
      rawRun.id !== context.runId || rawRun.run_attempt !== context.runAttempt || rawRun.workflow_id !== workflow.id ||
      rawRun.event !== 'pull_request' || rawRun.status !== 'completed' || typeof rawRun.path !== 'string' ||
      rawRun.path.split('@')[0] !== WORKFLOW_PATH || !sha(rawRun.head_sha) ||
      typeof rawRun.head_repository?.full_name !== 'string' || typeof rawRun.head_branch !== 'string') return null;
  const associated = (rawRun.pull_requests ?? []).filter(pr => positive(pr.number) && pr.head?.sha === rawRun.head_sha && sha(pr.base?.sha));
  let association, pull, fallback = false;
  if (associated.length === 1) {
    association = associated[0];
    pull = await api.getPull(association.number);
  } else if (associated.length === 0) {
    // Fork workflow_run payloads can omit pull_requests. Resolve only a unique,
    // exact API match; never take the PR number from artifact content.
    const candidates = (await api.listPullsForCommit(rawRun.head_sha)).filter(pr =>
      pr.state === 'open' && pr.head?.sha === rawRun.head_sha && pr.head?.repo?.full_name === rawRun.head_repository.full_name &&
      pr.head?.ref === rawRun.head_branch && pr.base?.repo?.full_name === context.repository);
    if (candidates.length !== 1 || !positive(candidates[0].number)) return null;
    pull = await api.getPull(candidates[0].number);
    association = { number: pull.number, base: { sha: pull.base?.sha }, head: { sha: pull.head?.sha } };
    fallback = true;
  } else return null;
  if (pull.state !== 'open' || pull.head?.sha !== rawRun.head_sha || pull.base?.sha !== association.base.sha ||
      !sha(pull.base?.sha) || pull.base?.repo?.full_name !== context.repository ||
      pull.head?.repo?.full_name !== rawRun.head_repository.full_name || pull.head?.ref !== rawRun.head_branch) return null;
  const [base, head] = await Promise.all([api.getCommit(pull.base.sha), api.getCommit(pull.head.sha)]);
  if (base.sha !== pull.base.sha || head.sha !== pull.head.sha || !sha(base.commit?.tree?.sha) || !sha(head.commit?.tree?.sha)) return null;
  const identity = { repository: context.repository, prNumber: pull.number, baseSha: pull.base.sha, headSha: pull.head.sha,
    baseTree: base.commit.tree.sha, headTree: head.commit.tree.sha, harnessSha: null,
    reporterSha: context.reporterSha, runId: context.runId, runAttempt: context.runAttempt };
  const run = { ...rawRun, pull_requests: [association] };
  if (!eligiblePullRequest({ run, pull, identity, workflowId: workflow.id })) return null;
  return { identity, run, workflowId: workflow.id, association, fallback };
}

export async function loadAvailability({ api, origin }) {
  if (origin.run.conclusion !== 'success') return { reason: 'origin-run-failed' };
  try {
    const name = `houseatlas-perf-${origin.identity.runId}-${origin.identity.runAttempt}`;
    const matches = (await api.listArtifacts(origin.identity.runId)).filter(artifact => artifact.name === name);
    if (matches.length === 0) return { reason: 'artifact-unavailable' };
    if (matches.length !== 1) throw new Error();
    const artifact = matches[0];
    if (!positive(artifact.id) || artifact.expired !== false || !Number.isSafeInteger(artifact.size_in_bytes) || artifact.size_in_bytes < 1 ||
        artifact.size_in_bytes > 65536 || artifact.workflow_run?.id !== origin.identity.runId || artifact.workflow_run?.head_sha !== origin.identity.headSha) throw new Error();
    const availability = parseAvailabilityZip(await api.downloadArtifact(artifact.id), origin.identity);
    return { ...availability, artifactId: artifact.id };
  } catch { return { reason: 'artifact-invalid' }; }
}

export async function publishOrigin({ api, context, expectedPrNumber }) {
  const origin = await resolveOrigin({ api, context });
  if (!origin || !positive(expectedPrNumber) || origin.identity.prNumber !== expectedPrNumber) return { status: 'skipped', reason: 'stale-or-unassociated-origin' };
  const availability = await loadAvailability({ api, origin });
  const boundApi = { ...api, getRun: async id => {
    const current = await api.getRun(id);
    return origin.fallback && (current.pull_requests ?? []).length === 0 ? { ...current, pull_requests: [origin.association] } : current;
  } };
  const result = await updateAvailabilityComment({ api: boundApi, identity: origin.identity, workflowId: origin.workflowId, availability });
  return { ...result, ...(result.status === 'created' || result.status === 'updated' ? { markdown: makeAvailabilityReport({ identity: origin.identity, availability }).markdown } : {}) };
}
