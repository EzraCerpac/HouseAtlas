import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import test from 'node:test';
import { HARNESS_SHA, SCHEMA_SHA256 } from './measurement.mjs';
import { publishOrigin } from './origin.mjs';
import { readReportZip } from './archive.mjs';
import { context, fakeOriginApi, identity, zipFixture } from './test-fixtures.mjs';

test('measurement pair archives have a fixed layout and missing trusted contract emits no values', async () => {
  const { api, state } = fakeOriginApi();
  const incomplete = JSON.stringify({ format: 'houseatlas.perf.run/1', synthetic: true });
  state.zip = zipFixture([{ name: 'base.json', content: incomplete }, { name: 'head.json', content: incomplete }]);
  state.artifacts[0].size_in_bytes = state.zip.length;
  assert.equal(readReportZip(state.zip).kind, 'measurements');
  const result = await publishOrigin({ api, context, expectedPrNumber: 7, contractLoader: async () => null });
  assert.equal(result.status, 'created');
  assert(result.markdown.includes('not installed in the trusted default branch'));
  assert(!result.markdown.includes('Harness source:'));
  assert.throws(() => readReportZip(zipFixture([{ name: 'base.json', content: incomplete }])));
  assert.throws(() => readReportZip(zipFixture([{ name: 'base.json', content: incomplete }, { name: '../head.json', content: incomplete }])));
});

const ownerRoot = process.env.HOUSEATLAS_PERF_CONTRACT_ROOT;
if (!ownerRoot) {
  test('canonical owner integration', { skip: 'Supply the exact clean pinned owner checkout through HOUSEATLAS_PERF_CONTRACT_ROOT' }, () => {});
} else {
  const git = args => execFileSync('git', args, { cwd: ownerRoot, encoding: 'utf8', stdio: 'pipe' }).trim();
  assert.equal(git(['rev-parse', 'HEAD']), HARNESS_SHA);
  assert.equal(git(['status', '--porcelain']), '');
  const contract = await import(pathToFileURL(resolve(ownerRoot, 'tools/perf/contract/index.mjs')));
  const { exampleRun, measured } = await import(pathToFileURL(resolve(ownerRoot, 'tools/perf/contract/test-fixture.mjs')));
  const { harnessDigest } = await import(pathToFileURL(resolve(ownerRoot, 'tools/perf/harness/source.mjs')));
  assert.equal(contract.schemaSha256, SCHEMA_SHA256);
  const bundle = { contract, harnessFilesSha256: harnessDigest(ownerRoot) };
  const harnessTree = git(['rev-parse', 'HEAD^{tree}']);
  function fixture() {
    const { api, state } = fakeOriginApi();
    const sourceCommit = api.getCommit;
    api.getCommit = async sha => sha === HARNESS_SHA ? { sha, commit: { tree: { sha: harnessTree } } } : sourceCommit(sha);
    const baseRun = exampleRun(), headRun = exampleRun();
    for (const [side, value] of [['base', baseRun], ['head', headRun]]) {
      const source = { commit: identity[`${side}Sha`], tree: identity[`${side}Tree`], dirty: false };
      value.source = { ...source, after: { ...source }, files: [] };
      const harness = { commit: HARNESS_SHA, tree: harnessTree, dirty: false, filesSha256: bundle.harnessFilesSha256 };
      value.harness = { ...harness, schemaSha256: SCHEMA_SHA256, after: { ...harness } };
    }
    const publish = async () => {
      state.zip = zipFixture([{ name: 'base.json', content: JSON.stringify(baseRun) }, { name: 'head.json', content: JSON.stringify(headRun) }]);
      state.artifacts[0].size_in_bytes = state.zip.length;
      return publishOrigin({ api, context, expectedPrNumber: 7, contractLoader: async () => bundle });
    };
    return { baseRun, headRun, publish, state };
  }
  test('real canonical contract validates the pair and publisher updates one regenerated table', async () => {
    const item = fixture();
    assert.equal((await item.publish()).status, 'created');
    assert.equal((await item.publish()).status, 'updated');
    assert.equal(item.state.comments.length, 1);
    const markdown = item.state.comments[0].body;
    for (const text of [HARNESS_SHA, 'Scan parse', 'Browser/GPU: 5 metrics unsupported', 'archive SHA-256']) assert(markdown.includes(text));
  });
  test('real canonical unsupported bases and failed heads preserve both states and failure', async () => {
    const item = fixture(), id = 'frontend.standard_glb.load_ms';
    item.baseRun.metrics = item.baseRun.metrics.map(row => row.id === id ? { id, status: 'unsupported', reason: 'feature-not-present' } : row);
    item.headRun.metrics = item.headRun.metrics.map(row => row.id === id ? { id, status: 'failed', reason: 'execution-failed' } : row);
    const result = await item.publish();
    assert.equal(result.failed, true);
    assert(result.markdown.includes('base unsupported; head failed; ❌ failed'));
  });
  test('canonical fixture/environment differences skip comparison without invented speedups', async () => {
    for (const field of ['fixture', 'environment']) {
      const item = fixture();
      if (field === 'fixture') item.headRun.fixtures[0].sha256 = '0'.repeat(64);
      else item.headRun.environment.host.cpu = 'Different synthetic unit host';
      const result = await item.publish();
      assert.equal(result.failed, false);
      assert(result.markdown.includes(field === 'fixture' ? 'fixture mismatch' : 'method or environment mismatch'));
    }
  });
  test('canonical GPU claims, changed source/harness and inconsistent summaries never become posted values', async () => {
    for (const change of [
      item => { const id = 'browser.first_mesh_draw_ms'; item.headRun.metrics = item.headRun.metrics.map(row => row.id === id ? measured(id, Array(9).fill(999)) : row); },
      item => { item.headRun.source.dirty = true; },
      item => { item.headRun.harness.commit = '0'.repeat(40); },
      item => { item.headRun.harness.filesSha256 = '0'.repeat(64); },
      item => { item.headRun.metrics[0].summary.median = 999; },
    ]) {
      const item = fixture(); change(item);
      const result = await item.publish();
      assert.equal(result.failed, true);
      assert(result.markdown.includes('failed provenance'));
      assert(!result.markdown.includes('999 ms'));
    }
  });
  test('workflow pin matches the canonical reporting pin', () => {
    const workflow = readFileSync(new URL('../../../.github/workflows/performance.yml', import.meta.url), 'utf8');
    assert(workflow.includes(`HARNESS_SHA: ${HARNESS_SHA}`));
    assert(workflow.includes(`ref: ${HARNESS_SHA}`));
  });
}
