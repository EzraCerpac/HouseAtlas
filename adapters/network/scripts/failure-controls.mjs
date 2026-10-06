import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import assert from 'node:assert/strict';
const moduleUrl = new URL('../src/index.mjs', import.meta.url);
const testUrl = new URL('../test/network.test.mjs', import.meta.url);
const contractsUrl = new URL('../../../packages/contracts/src/index.mjs', moduleUrl);
const source = readFileSync(moduleUrl, 'utf8').replace("'../../../packages/contracts/src/index.mjs'", JSON.stringify(contractsUrl.href));
const tests = readFileSync(testUrl, 'utf8')
  .replace("'../../../packages/contracts/src/index.mjs'", JSON.stringify(contractsUrl.href))
  .replace('new URL(path, import.meta.url)', `new URL(path, ${JSON.stringify(testUrl.href)})`);
const controls = [
  { name: 'broadened route allowlist', from: "Object.freeze(['/api/inventory'])", to: "Object.freeze(['/api/inventory', '/api/snapshot'])", pattern: 'only the pinned passive' },
  { name: 'outage cache destruction', from: 'state = { ...state, cache: { ...state.cache, status:', to: 'state = { ...state, generation: null, cache: { ...state.cache, status:', pattern: 'independent outage control' },
  { name: 'upgraded evidence basis', from: 'evidenceBasis: evidence.evidenceBasis', to: "evidenceBasis: 'physical-survey'", pattern: 'IDs, source confidence' },
  { name: 'rejected blank source labels', from: 'const sourceText = value => text(value, 2000);', to: 'const sourceText = value => id(value);', pattern: 'R1 source-valid blank' },
  { name: 'disabled cached endpoint continuity', from: "guard(isDeepStrictEqual(relation, expected), 'Cached relation differs from its retained source link and reviewed projection');", to: 'void expected;', pattern: 'R2 cached endpoint rewiring' }
];
const directory = mkdtempSync(join(tmpdir(), 'at09-synthetic-controls-'));
try {
  for (const [index, control] of controls.entries()) {
    assert.ok(source.includes(control.from), `Control anchor absent: ${control.name}`);
    const mutatedUrl = new URL(`file://${join(directory, `mutant-${index}.mjs`)}`);
    const mutatedTests = tests.replace("'../src/index.mjs'", JSON.stringify(mutatedUrl.href));
    writeFileSync(mutatedUrl, source.replace(control.from, control.to));
    const testPath = join(directory, `control-${index}.test.mjs`); writeFileSync(testPath, mutatedTests);
    const result = spawnSync(process.execPath, ['--test', `--test-name-pattern=${control.pattern}`, testPath], { encoding: 'utf8' });
    assert.notEqual(result.status, 0, `Safety control escaped detection: ${control.name}`);
    assert.match(result.stdout + result.stderr, /AssertionError|ERR_ASSERTION/, `Control did not fail an assertion: ${control.name}`);
    console.log(`Expected failure detected: ${control.name}`);
  }
  console.log(`AT-09 negative controls: ${controls.length} safety mutations rejected; no live source calls`);
} finally { rmSync(directory, { recursive: true, force: true }); }
