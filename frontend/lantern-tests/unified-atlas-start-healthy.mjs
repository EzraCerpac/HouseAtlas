// Pure controls for the unified Atlas start ledger (`createStartLedger` in
// src/lantern/unified-atlas/types.ts): which explicit start a stage's
// initializer receives, by scene key and commit. The actual types.ts source is
// transformed in process. No React, DOM, browser, renderer, source or network.
// The component wiring (the stage initializer reads the ledger and its mount
// effect records the commit) is not exercised here; the example capture's
// mounted reopen check covers only the fresh-read route.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { transformWithOxc } from 'vite';

assert.deepEqual(process.argv.slice(2), [], 'This runner takes no arguments');
const file = new URL('../src/lantern/unified-atlas/types.ts', import.meta.url);
const { code } = await transformWithOxc(readFileSync(file, 'utf8'), file.pathname, { lang: 'ts', target: 'esnext', tsconfig: false, sourcemap: false });
for (const match of code.matchAll(/^\s*import\s+(?:[\w$\s{},*]+?\s+from\s+)?["']([^"']+)["']/gm)) assert.fail(`Unexpected runtime import ${match[1]} in types.ts`);
const { createStartLedger } = await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`);

// A fresh array each time, as a source may supply on every read.
const start = () => Object.freeze([{ type: 'view', view: 'plan' }]);

// (a) Stored copy first, then a fresh read of the same scene: the stored
// read's stage commits without a start, so the fresh read's start is dropped,
// then and on every later mount; another scene keeps its own.
{
  const ledger = createStartLedger();
  assert.equal(ledger.pending('scene-a', undefined), undefined);
  ledger.committed('scene-a');
  assert.equal(ledger.pending('scene-a', start()), undefined, 'A start arriving after the scene first committed is dropped');
  assert.equal(ledger.pending('scene-a', start()), undefined, 'and stays dropped on a later mount');
  const other = start();
  assert.equal(ledger.pending('scene-b', other), other, 'A scene with no committed view takes its start');
}

// (b) Close and reopen after a later choice: the first committed view took the
// start; the reopened stage gets none, whatever array its read carries, so it
// keeps the remembered view.
{
  const ledger = createStartLedger(), first = start();
  assert.equal(ledger.pending('scene', first), first);
  ledger.committed('scene');
  assert.equal(ledger.pending('scene', start()), undefined, 'Reopening never reapplies a start on a new array');
  assert.equal(ledger.pending('scene', first), undefined, 'nor on the same array');
}

// (c) Abandoned and replayed initialization: a render that never commits
// consumes nothing; a mount effect replayed after commit changes nothing.
{
  const ledger = createStartLedger(), first = start();
  assert.equal(ledger.pending('scene', first), first);
  assert.equal(ledger.pending('scene', first), first, 'An abandoned render consumed nothing');
  ledger.committed('scene');
  ledger.committed('scene');
  assert.equal(ledger.pending('scene', first), undefined);
  assert.equal(createStartLedger().pending('scene', first), first, 'Each ledger is its own');
}

console.log('PASS unified Atlas start ledger: stored-first, reopen and abandoned/replayed initialization (pure; no React mount)');
