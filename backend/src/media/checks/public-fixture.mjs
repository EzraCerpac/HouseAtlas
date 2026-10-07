// Healthy synthetic compatibility peer ONLY. No test aggregate/control imports.
// This does not implement the Rust storage/access lanes or production lineage.
import assert from 'node:assert/strict';
import { readFileSync, chmodSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync, backup } from 'node:sqlite';
import { AtlasStore } from '../../../../packages/storage/src/index.mjs';
import { DATABASE_VERSION, MIGRATIONS } from '../../../../packages/storage/src/migrations.mjs';
import { AssetVault } from '../../../../packages/media/src/vault.mjs';
import { canonicalJson, validateSnapshot, CONTRACT_VERSION } from '../../../../packages/contracts/src/index.mjs';

assert.equal(process.versions.node, '26.10.0');
const [mode, path, input] = process.argv.slice(2);
const read = file => JSON.parse(readFileSync(file, 'utf8'));
const U = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const scope = {workspaceId: U(1), homeId: U(2)};
const tombstoneCommand = {
  schemaVersion: 1, mutationId: U(8312), operation: 'tombstone',
  expectedRevision: 1, reason: 'Healthy synthetic retained original',
  guards: [{record: {recordType: 'evidence', recordId: U(100)}, expectedRevision: 1}],
};
// Explicit synthetic actor; no login/session or source grant is represented.
const authorize = (_principal, request) => ({...request.scope, actorId: U(50)});
const options = (database, vault) => ({
  path: database, authorize, verifyAvailableAsset: vault.verifyAvailableAsset,
  clock: () => '2026-02-01T12:00:00Z',
});

if (mode === 'bootstrap') {
  const {records, vaultRoot} = read(input);
  const snapshot = read(new URL('../../../../packages/contracts/fixtures/optional-geometry.snapshot.json', import.meta.url));
  snapshot.records.push(...records);
  validateSnapshot(snapshot);
  const vault = new AssetVault({root: vaultRoot});
  const store = new AtlasStore({...options(path, vault), allowSyntheticBootstrap: true});
  try {
    store.initializeSynthetic(snapshot);
    const committed = store.execute(null, scope, {recordType: 'asset', recordId: U(611)}, tombstoneCommand);
    assert.equal(committed.record.lifecycle, 'tombstoned');
  } finally { store.close(); }
  chmodSync(path, 0o600);
  console.log(JSON.stringify({synthetic: true, publicSchema: true, healthyTombstone: true, rustOriginalInteroperability: true}));
} else if (mode === 'backup') {
  const source = new DatabaseSync(path, {readOnly: true});
  try { await backup(source, input); } finally { source.close(); }
  const copied = new DatabaseSync(input);
  try { copied.exec('PRAGMA journal_mode=DELETE; PRAGMA synchronous=FULL;'); } finally { copied.close(); }
  chmodSync(input, 0o600);
  console.log(JSON.stringify({sqliteBackup: true}));
} else if (mode === 'validate') {
  const db = new DatabaseSync(path, {readOnly: true});
  try {
    assert.equal(db.prepare('PRAGMA user_version').get().user_version, DATABASE_VERSION);
    assert.equal(db.prepare('PRAGMA integrity_check').get().integrity_check, 'ok');
    assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), []);
    const applied = db.prepare('SELECT version, sha256 FROM atlas_migrations ORDER BY version').all();
    assert.equal(applied.length, MIGRATIONS.length);
    for (const [i, migration] of applied.entries()) {
      assert.equal(migration.version, MIGRATIONS[i].version);
      assert.equal(migration.sha256, MIGRATIONS[i].sha256);
    }
    const contractVersion = db.prepare("SELECT value FROM atlas_metadata WHERE key='contractVersion'").get().value;
    assert.equal(contractVersion, CONTRACT_VERSION);
    const snapshot = {contractVersion, synthetic: true};
    for (const [field, table] of [['sources', 'sources'], ['records', 'records'], ['homeboxEntities', 'projections'], ['caches', 'caches'], ['networkRelations', 'network_relations']]) {
      snapshot[field] = db.prepare(`SELECT body FROM ${table} ORDER BY rowid`).all().map(row => JSON.parse(row.body));
    }
    validateSnapshot(snapshot);
    const assets = snapshot.records.filter(record => record.recordType === 'asset');
    const manifests = db.prepare('SELECT workspace_id, home_id, record_id, storage_key, body FROM asset_manifests').all();
    assert.equal(manifests.length, assets.length);
    for (const asset of assets) {
      const manifest = manifests.find(row => row.workspace_id === asset.workspaceId && row.home_id === asset.homeId && row.record_id === asset.recordId);
      assert(manifest);
      assert.equal(manifest.storage_key, asset.payload.storageKey);
      assert.equal(canonicalJson(JSON.parse(manifest.body)), canonicalJson(asset.payload));
    }
    console.log(JSON.stringify({contractVersion, databaseSchema: DATABASE_VERSION, assets}));
  } finally { db.close(); }
} else if (mode === 'restored-history') {
  const before = new DatabaseSync(path, {readOnly: true});
  const after = new DatabaseSync(input, {readOnly: true});
  try {
    // History remains the public bare ordered audit array; receipt bytes survive.
    for (const table of ['records', 'audits', 'receipts', 'batch_receipts']) {
      const query = `SELECT body FROM ${table} ORDER BY rowid`;
      assert.deepEqual(after.prepare(query).all(), before.prepare(query).all());
    }
  } finally { before.close(); after.close(); }
  const vault = new AssetVault({root: join(input, '..', 'media')});
  const restored = new AtlasStore(options(input, vault));
  try {
    const target = {recordType: 'asset', recordId: U(611)};
    const history = restored.history(null, scope, target);
    assert(Array.isArray(history));
    assert.equal(history.length, 1);
    assert.equal(history[0].operation, 'tombstone');
    assert.equal(restored.readRecord(null, scope, target).lifecycle, 'tombstoned');
  } finally { restored.close(); }
  console.log(JSON.stringify({synthetic: true, orderedHistoryPreserved: true, receiptBytesPreserved: true, rustRestoreInteroperability: true}));
} else {
  throw new Error('Explicit healthy example mode required');
}
