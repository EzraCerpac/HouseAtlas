import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'node:test';
import {exampleRun} from '../contract/test-fixture.mjs';
import {coverageReport,renderCoverage,runCoverage} from './coverage.mjs';

test('measured CPU/static rows never imply complete browser, cache, backend or memory coverage',()=>{
  const report=coverageReport(exampleRun());
  assert.equal(report.areas.find(area=>area.id==='startup').status,'partial');
  assert.equal(report.areas.find(area=>area.id==='room-plan').status,'partial');
  assert.equal(report.areas.find(area=>area.id==='render').status,'unsupported');
  for(const id of ['backend-read','cache-reopen','device-interaction'])assert.equal(report.areas.find(area=>area.id===id).status,'not-measured');
  assert.equal(report.areas.find(area=>area.id==='size-memory').status,'partial');
  assert(!renderCoverage(report).includes('| 0 '));
});
test('unavailable and missing rows retain their status and cannot become zero observations',()=>{
  const run=exampleRun();run.metrics[0]={id:run.metrics[0].id,status:'failed',reason:'execution-failed'};run.metrics.splice(1,1);
  const report=coverageReport(run);
  assert.equal(report.metrics[0].status,'failed');assert.equal(report.metrics[0].summary,undefined);
  assert.equal(report.metrics[1].status,'missing');assert.equal(report.metrics[1].summary,undefined);
});
test('identity, schema and summary validation cannot be bypassed by coverage output',()=>{
  const run=exampleRun();run.source.after.dirty=true;assert.throws(()=>coverageReport(run));
  run.source.after.dirty=false;run.metrics[0].summary.median++;assert.throws(()=>coverageReport(run));
});
test('CLI writes create-only evidence and rejects unsupported command arguments',t=>{
  const root=mkdtempSync(join(tmpdir(),'houseatlas-coverage-unit-'));t.after(()=>rmSync(root,{recursive:true,force:true}));
  const input=join(root,'run.json'),json=join(root,'coverage.json'),markdown=join(root,'coverage.md');
  writeFileSync(input,JSON.stringify(exampleRun()));
  const args=['--run',input,'--json',json,'--markdown',markdown];runCoverage(args);
  assert.equal(JSON.parse(readFileSync(json)).format,'houseatlas.perf.coverage/1');
  const original=readFileSync(json);assert.throws(()=>runCoverage(args));assert.deepEqual(readFileSync(json),original);
  assert.throws(()=>runCoverage(['--run',input,'--contract','arbitrary-code','--markdown',markdown]));
});
