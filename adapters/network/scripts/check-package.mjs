import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { projectNetworkCapture, NETWORK_READ_ROUTES } from '../src/index.mjs';
const root = new URL('../', import.meta.url);
for (const file of ['src/index.mjs', 'test/network.test.mjs', 'scripts/check-package.mjs', 'scripts/failure-controls.mjs']) {
  const result = spawnSync(process.execPath, ['--check', new URL(file, root).pathname], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
}
const load = path => JSON.parse(readFileSync(new URL(path, root)));
const source = { workspaceId: '00000000-0000-4000-8000-000000000001', homeId: '00000000-0000-4000-8000-000000000002',
  sourceInstanceId: '00000000-0000-4000-8000-000000000012', collectionId: 'inventory', owner: 'network', partitionMode: 'exclusive-home', allowedExternalIds: [] };
const generation = projectNetworkCapture({ registration: source, capture: { source, retrievedAt: '2026-01-02T12:00:00Z', sourceSnapshotAt: null,
  document: load('fixtures/inventory.wire.json') }, review: load('fixtures/link-review.json') });
assert.equal(generation.networkRelations.length, 4); assert.deepEqual(NETWORK_READ_ROUTES, ['/api/inventory']);
console.log('AT-09 build: ES modules, synthetic projection and pinned route pass');
