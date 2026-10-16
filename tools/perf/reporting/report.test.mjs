import assert from 'node:assert/strict';
import test from 'node:test';
import { COMMENT_MARKER, makeReport } from './report.mjs';
import { eligiblePullRequest, updateComment } from './comment.mjs';

const identity = { repository: 'example/HouseAtlas', baseSha: 'a'.repeat(40), headSha: 'b'.repeat(40), baseTree: 'd'.repeat(40), headTree: 'e'.repeat(40), harnessSha: 'c'.repeat(40), prNumber: 7, runId: 123, runAttempt: 1 };
const policies = [{ id: 'latency', label: 'Synthetic latency', unit: 'ms', direction: 'lower', kind: 'timing' }];
const report = () => makeReport({ identity, policies, base: new Map([['latency', { samples: [100, 100, 100, 100, 100] }]]), head: new Map([['latency', { samples: [75, 75, 75, 75, 75] }]]) });
const run = () => ({ repository: { full_name: identity.repository }, event: 'pull_request', status: 'completed', conclusion: 'success', path: '.github/workflows/performance.yml', workflow_id: 9, id: 123, run_attempt: 1, head_sha: identity.headSha, pull_requests: [{ number: 7, base: { sha: identity.baseSha }, head: { sha: identity.headSha } }] });
const pull = () => ({ number: 7, state: 'open', base: { sha: identity.baseSha, repo: { full_name: identity.repository } }, head: { sha: identity.headSha } });
const bot = body => ({ id: 44, user: { type: 'Bot', login: 'github-actions[bot]' }, body });
function fakeApi(comments = []) {
  const writes = [];
  return { writes, getRun: async () => run(), getPull: async () => pull(), listComments: async () => comments,
    updateComment: async (...args) => writes.push(['update', ...args]), createComment: async (...args) => writes.push(['create', ...args]) };
}
test('report records exact commits, absolute medians, delta, noise and scope', () => {
  const { markdown, failed } = report();
  for (const text of [identity.baseSha, identity.headSha, identity.harnessSha, '100 ms', '75 ms', '-25%', '5 / 0%', 'improved; informational', 'No household data']) assert(markdown.includes(text));
  assert.equal(failed, false);
  assert.throws(() => makeReport({ identity: { ...identity, repository: 'bad\nrepo' }, policies }));
  assert.throws(() => makeReport({ identity: { ...identity, unexpected: 'raw artifact text' }, policies }));
});
test('association requires exact repository, workflow, attempt, current base/head and open PR', () => {
  const input = { run: run(), pull: pull(), identity, workflowId: 9 };
  assert(eligiblePullRequest(input));
  assert(!eligiblePullRequest({ ...input, workflowId: undefined }));
  for (const patch of [{ event: 'push' }, { path: 'fake.yml' }, { workflow_id: 5 }, { run_attempt: 2 }, { head_sha: 'd'.repeat(40) }, { pull_requests: [] }]) {
    assert(!eligiblePullRequest({ ...input, run: { ...run(), ...patch } }));
  }
  assert(!eligiblePullRequest({ ...input, pull: { ...pull(), state: 'closed' } }));
  assert(!eligiblePullRequest({ ...input, pull: { ...pull(), base: { ...pull().base, sha: 'd'.repeat(40) } } }));
});
test('updater creates once and updates the owned marker; user lookalikes are ignored', async () => {
  for (const comments of [[], [{ ...bot(report().markdown), user: { type: 'User', login: 'someone' } }], [bot(report().markdown)]]) {
    const api = fakeApi(comments);
    const result = await updateComment({ api, identity, markdown: report().markdown, workflowId: 9 });
    assert.equal(api.writes.length, 1);
    assert.equal(result.status, comments[0]?.user.type === 'Bot' ? 'updated' : 'created');
  }
});
test('stale, out-of-order and duplicated reports cannot overwrite the current comment', async () => {
  const stale = fakeApi();
  stale.getPull = async () => ({ ...pull(), head: { sha: 'd'.repeat(40) } });
  assert.equal((await updateComment({ api: stale, identity, markdown: report().markdown, workflowId: 9 })).status, 'skipped');
  assert.equal(stale.writes.length, 0);
  const newer = fakeApi([bot(`${COMMENT_MARKER}\nMeasurement run 124, attempt 1`)]);
  assert.equal((await updateComment({ api: newer, identity, markdown: report().markdown, workflowId: 9 })).reason, 'newer-report-exists');
  assert.equal(newer.writes.length, 0);
  const duplicates = fakeApi([bot(report().markdown), bot(report().markdown)]);
  await assert.rejects(updateComment({ api: duplicates, identity, markdown: report().markdown, workflowId: 9 }));
  assert.equal(duplicates.writes.length, 0);
});
test('head movement immediately before writing is rechecked', async () => {
  const api = fakeApi();
  let reads = 0;
  api.getPull = async () => ++reads === 1 ? pull() : { ...pull(), state: 'closed' };
  await updateComment({ api, identity, markdown: report().markdown, workflowId: 9 });
  assert.equal(api.writes.length, 0);
});
