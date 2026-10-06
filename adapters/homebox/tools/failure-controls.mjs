import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync, copyFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

// Isolated sabotage copies verify that behavioral tests detect removed controls.
// The authoritative source/contract package remains byte-identical during controls.
const root = fileURLToPath(new URL('..', import.meta.url));
const contracts = fileURLToPath(new URL('../../../packages/contracts/', import.meta.url));
const source = readFileSync(join(root, 'src/index.mjs'), 'utf8');
const controlRoot = join(root, 'var/controls'); mkdirSync(controlRoot, { recursive: true });
const variants = [
  { name: 'request-elapsed-deadline-disabled', from: "if (controller.signal.aborted || monotonicClock() >= requestDeadline) fail('timeout');", to: "if (controller.signal.aborted) fail('timeout');", witnesses: ['request deadline rejects timer-starving valid stream completion', 'request deadline covers UTF-8 decoding'] },
  { name: 'stream-chunks-retained-by-reference', from: 'chunks.push(new Uint8Array(chunk));', to: 'chunks.push(chunk);', witnesses: ['reused Uint8Array chunks preserve successful generation bytes', 'reused Buffer chunks preserve successful generation bytes'] },
  { name: 'scope-receipt-disabled', from: "if (!response.scope || !sameScope(registration, response.scope)) fail('wrong-scope');", to: "if (false) fail('wrong-scope');", witnesses: ['wrong collectionId fails closed', 'wrong sourceInstanceId fails closed'] },
  { name: 'page-identity-disabled', from: 'value.page !== page', to: 'false', witnesses: ['wrong page rejects generation'] },
  { name: 'byte-ceilings-disabled', from: 'if (size > config.maxResponseBytes || bytes > config.maxGenerationBytes)', to: 'if (false)', witnesses: ['response and cumulative generation bytes are independently bounded'] },
  { name: 'get-changed-to-put', from: "method: 'GET'", to: "method: 'PUT'", witnesses: ['full bounded generation uses explicit partitions'] },
  { name: 'failed-cache-time-freshened', from: '...clone(prior.cache), status:', to: '...clone(prior.cache), lastSuccessfulFetchAt: attemptAt, status:', witnesses: ['transport errors and unsuccessful status never expose', 'no saved cache outage remains distinct'] },
  { name: 'duplicate-keys-accepted', from: "if (keys.has(key)) fail('invalid-schema');", to: "if (false) fail('invalid-schema');", witnesses: ['duplicate escaped JSON keys, nonfinite numbers'] }
];
const results = [];
for (const v of variants) {
  assert.equal(source.split(v.from).length - 1, 1, `Control anchor occurs once: ${v.name}`);
  const dir = mkdtempSync(join(controlRoot, v.name + '-'));
  mkdirSync(join(dir, 'src')); mkdirSync(join(dir, 'test')); mkdirSync(join(dir, 'fixtures'));
  for (const name of readdirSync(join(root, 'fixtures'))) copyFileSync(join(root, 'fixtures', name), join(dir, 'fixtures', name));
  copyFileSync(join(root, 'package.json'), join(dir, 'package.json'));
  writeFileSync(join(dir, 'src/index.mjs'), source.replace(v.from, v.to).replace('../../../packages/contracts/src/index.mjs', pathToFileURL(join(contracts, 'src/index.mjs')).href));
  for (const name of readdirSync(join(root, 'test'))) {
    const text = readFileSync(join(root, 'test', name), 'utf8').replaceAll('../../../packages/contracts/', pathToFileURL(contracts + '/').href);
    writeFileSync(join(dir, 'test', name), text);
  }
  const run = spawnSync(process.execPath, ['--test', '--test-reporter=spec', ...readdirSync(join(dir, 'test')).filter(p => p.endsWith('.test.mjs')).map(p => join(dir, 'test', p))], { encoding: 'utf8', timeout: 10000 });
  const output = run.stdout + run.stderr;
  writeFileSync(join(dir, 'result.txt'), output);
  assert.notEqual(run.status, 0, `Mutant survived: ${v.name}`);
  assert.equal(run.signal, null, `Control must fail assertions, not time out: ${v.name}`);
  for (const witness of v.witnesses) assert.ok(output.split('\n').some(line => line.includes('✖') && line.includes(witness)), `Missing expected assertion failure ${witness}: ${v.name}`);
  results.push({ control: v.name, exitCode: run.status, witnesses: v.witnesses, result: 'expected assertion failures' });
}
assert.equal(readFileSync(join(root, 'src/index.mjs'), 'utf8'), source);
writeFileSync(join(controlRoot, 'results.json'), JSON.stringify({ synthetic: true, authoritativeSourceUnchanged: true, controls: results }, null, 2) + '\n');
console.log(JSON.stringify({ controls: results.length, survived: 0, sourceUnchanged: true }));
