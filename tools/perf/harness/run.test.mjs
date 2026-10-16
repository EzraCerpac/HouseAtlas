import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { validateRun } from '../contract/index.mjs';
import { parseArgs } from './run.mjs';

const cli = fileURLToPath(new URL('./run.mjs',import.meta.url));
function repository(t) {
  const root = mkdtempSync(join(tmpdir(),'houseatlas-perf-cli-unit-')); t.after(() => rmSync(root,{recursive:true,force:true}));
  const git = args => execFileSync('git',args,{cwd:root,stdio:'pipe',encoding:'utf8'}).trim();
  git(['init','--initial-branch=main']); writeFileSync(join(root,'README.md'),'Disposable synthetic unit repository.\n'); git(['add','README.md']);
  git(['-c','user.name=Synthetic fixture','-c','user.email=fixture@example.invalid','-c','commit.gpgsign=false','commit','-m','Synthetic unit source']);
  return { root,git };
}

test('CLI observes actual Git identities and emits explicit unsupported features without invented zeroes', t => {
  assert.equal(process.version,'v26.10.0');
  const {root,git} = repository(t), directory = mkdtempSync(join(tmpdir(),'houseatlas-perf-output-unit-')), output = join(directory,'run.json');
  t.after(() => rmSync(directory,{recursive:true,force:true}));
  const result = spawnSync(process.execPath,[cli,'--source-root',root,'--output',output],{encoding:'utf8',timeout:20_000});
  assert.equal(result.status,0,result.stderr); const run = JSON.parse(readFileSync(output)); assert(validateRun(run));
  assert.equal(run.source.commit,git(['rev-parse','HEAD'])); assert.equal(run.source.tree,git(['rev-parse','HEAD^{tree}']));
  assert.equal(run.source.dirty,false); assert.equal(run.source.after.dirty,false);
  assert.equal(run.metrics.length,17); assert(run.metrics.every(row => row.status === 'unsupported' && row.samples === undefined));
  const original = readFileSync(output); const again = spawnSync(process.execPath,[cli,'--source-root',root,'--output',output],{encoding:'utf8',timeout:5000});
  assert.equal(again.status,1); assert.deepEqual(readFileSync(output),original);
  writeFileSync(join(root,'untracked.txt'),'Generated untracked unit source.\n');
  const dirtyOutput = join(directory,'dirty.json');
  const dirty = spawnSync(process.execPath,[cli,'--source-root',root,'--output',dirtyOutput],{encoding:'utf8',timeout:20_000});
  assert.equal(dirty.status,0,dirty.stderr);
  assert.equal(JSON.parse(readFileSync(dirtyOutput)).source.dirty,true);
});

test('CLI rejects caller-supplied source identity and outputs inside a source checkout', t => {
  const {root} = repository(t);
  assert.throws(() => parseArgs(['--source-root',root,'--output',join(root,'measurement.json')]));
  assert.throws(() => parseArgs(['--source-root',root,'--output','relative.json']));
  assert.throws(() => parseArgs(['--source-root',root,'--source-commit','1'.repeat(40)]));
  const bad = spawnSync(process.execPath,[cli,'--source-commit','PRIVATE-SENTINEL'],{encoding:'utf8',timeout:5000});
  assert.equal(bad.status,1); assert(!bad.stderr.includes('PRIVATE-SENTINEL'));
});

test('an implemented feature that cannot execute retains a valid failed run and exits one', t => {
  const {root} = repository(t), directory = mkdtempSync(join(tmpdir(),'houseatlas-perf-failed-unit-'));
  t.after(() => rmSync(directory,{recursive:true,force:true}));
  const folder = join(root,'frontend/src/lantern/scans'); mkdirSync(folder,{recursive:true});
  // The selected module exists, but its required source modules do not. This
  // tests this harness's own execution outcome, not an application control.
  writeFileSync(join(folder,'mesh-profile.ts'),'export const synthetic = true;\n');
  const output = join(directory,'run.json');
  const result = spawnSync(process.execPath,[cli,'--source-root',root,'--output',output],{encoding:'utf8',timeout:20_000});
  assert.equal(result.status,1); const run = JSON.parse(readFileSync(output)); assert(validateRun(run));
  assert(run.metrics.filter(row => row.id.startsWith('frontend.scan.')).every(row => row.status === 'failed' && row.reason === 'execution-failed' && row.samples === undefined));
});
