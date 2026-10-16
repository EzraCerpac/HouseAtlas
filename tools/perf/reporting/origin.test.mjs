import assert from 'node:assert/strict';
import test from 'node:test';
import { publishOrigin, resolveOrigin } from './origin.mjs';
import { availabilityRecord, context, fakeOriginApi, zipFixture } from './test-fixtures.mjs';

test('end-to-end fake run validates an artifact then creates once and updates the same bot comment', async () => {
  const { api, state } = fakeOriginApi();
  const input = { api, context, expectedPrNumber: 7 };
  assert.equal((await publishOrigin(input)).status, 'created');
  assert.equal((await publishOrigin(input)).status, 'updated');
  assert.deepEqual(state.writes.map(row => row[0]), ['create', 'update']);
  assert.equal(state.comments.length, 1);
  assert(state.comments[0].body.includes('blocked: The measurement harness'));
});
test('wrong repository/workflow/head/attempt and stale current PRs never write', async () => {
  for (const change of [state => { state.run.repository.full_name = 'other/repo'; }, state => { state.run.workflow_id = 6; },
    state => { state.run.head_sha = '0'.repeat(40); }, state => { state.run.run_attempt = 2; },
    state => { state.pull.state = 'closed'; }, state => { state.pull.base.sha = '0'.repeat(40); }]) {
    const { api, state } = fakeOriginApi();
    change(state);
    assert.equal((await publishOrigin({ api, context, expectedPrNumber: 7 })).status, 'skipped');
    assert.equal(state.writes.length, 0);
  }
});
test('fork fallback uses only a unique exact API head/repository/branch association', async () => {
  const { api, state } = fakeOriginApi();
  state.run.pull_requests = [];
  state.run.head_repository.full_name = 'synthetic-fork/HouseAtlas';
  state.pull.head.repo.full_name = 'synthetic-fork/HouseAtlas';
  assert.equal((await publishOrigin({ api, context, expectedPrNumber: 7 })).status, 'created');
  assert.equal(state.comments.length, 1);
  state.pulls = [state.pull, { ...state.pull, number: 8 }];
  assert.equal(await resolveOrigin({ api, context }), null);
});
test('invalid or missing artifacts produce explicit unavailable rows, never artifact-selected PRs or values', async () => {
  for (const mode of ['missing', 'metadata', 'payload', 'duplicate']) {
    const { api, state } = fakeOriginApi();
    if (mode === 'missing') state.artifacts = [];
    if (mode === 'metadata') state.artifacts[0].workflow_run.id = 99;
    if (mode === 'payload') state.zip = zipFixture([{ name: 'availability.json', content: JSON.stringify({ ...availabilityRecord(), prNumber: 999 }) }]);
    if (mode === 'duplicate') state.artifacts.push({ ...state.artifacts[0], id: 11 });
    const result = await publishOrigin({ api, context, expectedPrNumber: 7 });
    assert.equal(result.status, 'created');
    assert.equal(state.writes[0][1], 7);
    assert(!state.writes[0][2].includes('999'));
    assert(state.writes[0][2].includes(mode === 'missing' ? 'did not supply' : 'failed provenance'));
  }
});
test('publisher refuses changed resolution and superseded reports before writing', async () => {
  const { api, state } = fakeOriginApi();
  assert.equal((await publishOrigin({ api, context, expectedPrNumber: 8 })).status, 'skipped');
  assert.equal(state.writes.length, 0);
  state.comments.push({ id: 10, user: { login: 'github-actions[bot]', type: 'Bot' }, body: '<!-- houseatlas-performance-v1 -->\nMeasurement run 3, attempt 1' });
  assert.equal((await publishOrigin({ api, context, expectedPrNumber: 7 })).reason, 'newer-report-exists');
  assert.equal(state.writes.length, 0);
});
test('a committed create with a lost fake reply is observed and updated on the next run without duplication', async () => {
  const { api, state } = fakeOriginApi();
  const create = api.createComment;
  api.createComment = async (...args) => { await create(...args); throw new Error('Synthetic reply loss'); };
  const input = { api, context, expectedPrNumber: 7 };
  await assert.rejects(publishOrigin(input));
  assert.equal(state.comments.length, 1);
  assert.equal((await publishOrigin(input)).status, 'updated');
  assert.equal(state.comments.length, 1);
  assert.deepEqual(state.writes.map(row => row[0]), ['create', 'update']);
});
test('head movement before writing and failed originating runs remain explicit', async () => {
  const { api, state } = fakeOriginApi();
  api.listComments = async () => { state.pull.head.sha = '0'.repeat(40); return []; };
  assert.equal((await publishOrigin({ api, context, expectedPrNumber: 7 })).status, 'skipped');
  assert.equal(state.writes.length, 0);
  const other = fakeOriginApi();
  other.state.run.conclusion = 'cancelled';
  other.api.downloadArtifact = async () => { throw new Error('Must not read a failed run artifact'); };
  const result = await publishOrigin({ api: other.api, context, expectedPrNumber: 7 });
  assert.equal(result.status, 'created');
  assert.equal(result.failed, true);
  assert(result.markdown.includes('originating run did not complete successfully'));
});
