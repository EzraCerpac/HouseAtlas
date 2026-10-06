import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, cpSync, symlinkSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
const root = fileURLToPath(new URL('../', import.meta.url));
const controls = [
  { name: 'omit-final-command-guard', file: 'final-guards.test.mjs', pattern: 'final guard control',
    before: 'for (const { target, command } of commands)\n        assertFinalMutation(candidate, original.records.find(r => recordKey(r) === recordKey(target)), command, target);',
    after: '// Negative control: final command guard omitted.' },
  { name: 'commit-failed-transaction', file: 'storage.test.mjs', pattern: 'rollback control',
    before: "this.#db.exec('ROLLBACK');", after: "this.#db.exec('COMMIT');" },
  { name: 'omit-durable-receipt', file: 'storage.test.mjs', pattern: 'receipt control',
    before: "this.#db.prepare('INSERT INTO receipts VALUES(?,?,?,?,?,?)').run(...keys[i], hashes[i], json(r));",
    after: '// Negative control: durable receipt omitted.' },
  { name: 'omit-home-read-filter', file: 'storage.test.mjs', pattern: 'scope control',
    before: "for (const field of ['sources','records','homeboxEntities','caches','networkRelations']) s[field] = s[field].filter(r => sameScope(r, scope));",
    after: '// Negative control: home read filter omitted.' },
  { name: 'freshen-outage-timestamp', file: 'storage.test.mjs', pattern: 'cache timestamp control',
    before: 'lastSuccessfulFetchAt: prior?.lastSuccessfulFetchAt ?? null, generationId:',
    after: 'lastSuccessfulFetchAt: at, generationId:' },
  { name: 'omit-precommit-authorization', file: 'storage.test.mjs', pattern: 'commit authorization control',
    before: "this.#fault('before-commit', { operation: 'mutation' });\n      revalidate();",
    after: "this.#fault('before-commit', { operation: 'mutation' });\n      // Negative control: precommit authorization omitted." },
  ...['cache', 'cache-failure', 'source-registration'].map(operation => ({
    name: `omit-${operation}-precommit-authority`, file: 'review-regressions.test.mjs', pattern: `R1 precommit authority control: ${operation} rolls`,
    before: `this.#fault('before-commit', { operation: '${operation}' });\n      revalidate();`,
    after: `this.#fault('before-commit', { operation: '${operation}' });\n      // Negative control: trusted write revalidation omitted.`,
  })),
  { name: 'allow-trusted-actor-change', file: 'review-regressions.test.mjs', pattern: 'R1 trusted write authority',
    before: "if (current.actorId !== actor.actorId) fail('unauthenticated', 'Verified principal changed during transaction');",
    after: '// Negative control: trusted actor continuity omitted.' },
  { name: 'omit-cache-epoch-guard', file: 'review-regressions.test.mjs', pattern: 'R2 epoch control',
    before: "if (this.#cacheEpoch(cache) !== input.expectedCacheEpoch)\n        fail('guard-conflict', 'Cache publication or source failure changed during fetch');",
    after: '// Negative control: cache epoch guard omitted.' },
  { name: 'omit-failure-epoch-advance', file: 'review-regressions.test.mjs', pattern: 'R2 epoch control',
    before: 'validateSnapshot(s); this.#writeCache(row); this.#advanceCacheEpoch(key);',
    after: 'validateSnapshot(s); this.#writeCache(row); // Negative control: failure epoch not advanced.' },
  { name: 'omit-success-epoch-advance', file: 'review-regressions.test.mjs', pattern: 'R2 epoch control',
    before: 'this.#advanceCacheEpoch(cache);',
    after: '// Negative control: success epoch not advanced.' },
  { name: 'omit-empty-partition-authority', file: 'review-regressions.test.mjs', pattern: 'R3 empty partition control',
    before: "for (const partition of s.sources) {\n        try { this.#auth(principal, scope, 'read-cache', undefined, undefined, partitionOf(partition)); }\n        catch (error) {\n          if (!['forbidden','not-found'].includes(error.code)) throw error;\n          denied.add(sourceKey(partition));\n        }\n      }",
    after: '// Negative control: partition availability authority omitted.' },
  { name: 'reject-valid-unicode-partition', file: 'review-regressions.test.mjs', pattern: 'R3 partition selector control',
    before: '[...partition.collectionId].length > 4096',
    after: 'partition.collectionId.length > 4096' },
  { name: 'omit-no-cache-denial-status', file: 'review-regressions.test.mjs', pattern: 'R3 no-cache denial control',
    before: "for (const source of s.sources) {\n        if (!denied.has(sourceKey(source)) || s.caches.some(c => sourceKey(c) === sourceKey(source))) continue;\n        s.caches.push(validateShape('cacheStatus', {\n          schemaVersion: 1, ...partitionOf(source), status: 'access-revoked',\n          lastSuccessfulFetchAt: null, lastAttemptAt: null, generationId: null,\n          consistency: 'non-transactional-offset-pages', error: null,\n        }));\n      }",
    after: '// Negative control: no-cache partition denial status omitted.' },
  { name: 'adopt-view-only-database', module: 'migrations.mjs', file: 'review-regressions.test.mjs', pattern: 'R4 schema ownership control: view-only',
    before: "SELECT name FROM sqlite_master WHERE name NOT GLOB 'sqlite_*'",
    after: "SELECT name FROM sqlite_master WHERE type='table' AND name NOT GLOB 'sqlite_*'" },
  { name: 'wildcard-sqlite-prefix', module: 'migrations.mjs', file: 'review-regressions.test.mjs', pattern: 'R4 schema ownership control: literal-prefix',
    before: "SELECT name FROM sqlite_master WHERE name NOT GLOB 'sqlite_*'",
    after: "SELECT name FROM sqlite_master WHERE name NOT LIKE 'sqlite_%'" },
];
const report = [];
for (const control of controls) {
  const moduleName = control.module ?? 'index.mjs';
  const original = readFileSync(join(root, 'src', moduleName), 'utf8');
  const args = ['--test', `--test-name-pattern=${control.pattern}`, join(root, 'test', control.file)];
  const positive = spawnSync(process.execPath, args, { encoding: 'utf8', timeout: 20000 });
  assert.equal(positive.status, 0, `${control.name} positive failed:\n${positive.stdout}${positive.stderr}`);
  assert(original.includes(control.before), `${control.name} source marker changed`);
  const temporary = mkdtempSync(join(tmpdir(), 'atlas-storage-control-'));
  try {
    const moduleRoot = join(temporary, 'packages/storage'); mkdirSync(moduleRoot, { recursive: true });
    cpSync(join(root, 'src'), join(moduleRoot, 'src'), { recursive: true });
    symlinkSync(fileURLToPath(new URL('../../contracts', import.meta.url)), join(temporary, 'packages/contracts'), 'dir');
    writeFileSync(join(moduleRoot, 'src', moduleName), original.replace(control.before, control.after));
    const negative = spawnSync(process.execPath, args, { encoding: 'utf8', timeout: 20000,
      env: { ...process.env, ATLAS_STORAGE_MODULE: pathToFileURL(join(moduleRoot, 'src/index.mjs')).href } });
    assert.equal(negative.error, undefined); assert.notEqual(negative.status, 0, `${control.name} mutant survived`);
    // An expected assertion failure, rather than an import/syntax failure, must kill each mutant.
    assert.match(negative.stdout + negative.stderr, /AssertionError/);
    report.push({ control: control.name, positive: 'pass', mutant: 'rejected-by-assertion' });
  } finally { rmSync(temporary, { recursive: true, force: true }); }
}
console.log(JSON.stringify({ controls: report, passed: report.length }, null, 2));
