// Optional integration with the separately owned, exact PR189 reporter source.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { isAbsolute, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import test from 'node:test';
import * as contract from '../contract/index.mjs';
import { exampleRun, measured } from '../contract/test-fixture.mjs';

const root = process.env.HOUSEATLAS_PERF_REPORTING_ROOT;
test('owned contract works with the exact PR189 adapter and report CLI', { skip: !root }, async t => {
  assert(isAbsolute(root));
  assert.equal(execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim(),'ad3ff7f4a39458f11a668da5df9e2944b1fe18ee');
  const { compareRuns } = await import(pathToFileURL(join(root,'tools/perf/reporting/adapter.mjs')));
  const { runCli } = await import(pathToFileURL(join(root,'tools/perf/reporting/cli.mjs')));
  const base = exampleRun(), head = exampleRun();
  head.source.commit = head.source.after.commit = '7'.repeat(40);
  head.source.tree = head.source.after.tree = '8'.repeat(40);
  // Synthetic unit identity only. It is never published or represented as a hosted benchmark.
  const identity = { repository:'EzraCerpac/HouseAtlas',prNumber:189,runId:1,runAttempt:1,
    baseSha:base.source.commit,baseTree:base.source.tree,headSha:head.source.commit,headTree:head.source.tree,harnessSha:head.harness.commit };
  const glb = base.metrics.findIndex(row => row.id === 'frontend.standard_glb.load_ms');
  base.metrics[glb] = { id:base.metrics[glb].id,status:'unsupported',reason:'feature-not-present' };
  head.metrics[glb] = measured(head.metrics[glb].id,Array(9).fill(2));
  const result = compareRuns({identity,baseRun:base,headRun:head,contract});
  const row = result.comparisons.find(item => item.id === head.metrics[glb].id);
  assert.equal(row.reason,'base-unsupported'); assert.equal(row.deltaPercent,null); assert.equal(result.failed,false);
  assert(result.comparisons.filter(item => item.id.startsWith('browser.')).every(item => item.status === 'skipped' && item.deltaAbsolute === null));
  const changed = structuredClone(head); changed.environment.host.logicalCpus++;
  assert(compareRuns({identity,baseRun:base,headRun:changed,contract}).comparisons.some(item => item.reason === 'method-or-environment-mismatch'));
  const failed = structuredClone(head); failed.metrics[0] = {id:failed.metrics[0].id,status:'failed',reason:'execution-failed'};
  assert.equal(compareRuns({identity,baseRun:base,headRun:failed,contract}).failed,true);

  const directory = mkdtempSync(join(tmpdir(),'houseatlas-perf-report-unit-')); t.after(() => rmSync(directory,{recursive:true,force:true}));
  for (const [name,value] of [['base',base],['head',head],['identity',identity]]) writeFileSync(join(directory,name+'.json'),JSON.stringify(value));
  const args = ['--base',join(directory,'base.json'),'--head',join(directory,'head.json'),'--identity',join(directory,'identity.json'),
    '--markdown',join(directory,'report.md'),'--comparison',join(directory,'comparison.json')];
  assert.equal(runCli(args,contract),0);
  assert.match(readFileSync(join(directory,'report.md'),'utf8'),/base-unsupported/);
  const comparison = JSON.parse(readFileSync(join(directory,'comparison.json')));
  assert.equal(comparison.format,'houseatlas.perf.comparison/1'); assert.deepEqual(comparison.identity,identity);
  assert.equal(comparison.profiles.schemaSha256,contract.schemaSha256);
});
