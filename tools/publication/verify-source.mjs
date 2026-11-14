// Read-only inspection of the explicit file set, modes and logical owners; never mutates source or runs controls.
// Content identity is Git's: no per-file digest is stored or checked.
import assert from 'node:assert/strict';
import { lstatSync, readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, relative } from 'node:path';
const root = fileURLToPath(new URL('../../', import.meta.url));
const manifestPath = 'docs/publication/source-manifest.json';
const manifest = JSON.parse(readFileSync(join(root, manifestPath)));
const ignored = new Set(['.git', 'node_modules', 'dist']);
const actual = [];
function walk(directory) {
  for (const name of readdirSync(directory).sort()) {
    if (ignored.has(name)) continue;
    const path = join(directory, name), stat = lstatSync(path);
    assert(!stat.isSymbolicLink(), 'Source entries must not be symlinks');
    if (stat.isDirectory()) walk(path);
    else { assert(stat.isFile(), 'Source entries must be regular files'); actual.push(relative(root, path)); }
  }
}
assert.equal(manifest.format, 'houseatlas-publication-source/2');
assert.deepEqual(Object.keys(manifest), ['format', 'status', 'self', 'owners', 'files'], 'Unexpected manifest fields');
assert.deepEqual(manifest.self, {path: manifestPath, mode: '100644', digest: 'anchored-by-reviewed-tree'});
const expected = manifest.files.map(row => row.path);
assert.deepEqual(expected, [...new Set(expected)].sort());
walk(root);
assert.deepEqual(actual.sort(), [...expected, manifestPath].sort(), 'Exact source allowlist mismatch');
for (const row of manifest.files) {
  assert.deepEqual(Object.keys(row), ['path', 'mode', 'owner'], `${row.path}: rows hold only path, mode and owner`);
  assert(/^[a-zA-Z0-9._/-]+$/.test(row.path) && !row.path.split('/').some(p => p === '..' || p === '.' || !p));
  assert(manifest.owners.includes(row.owner), `${row.path}: unknown owner`);
  assert.equal(row.mode, (lstatSync(join(root, row.path)).mode & 0o111) ? '100755' : '100644', `${row.path}: mode`);
}
assert.equal(lstatSync(join(root, manifestPath)).mode & 0o111, 0);
assert.equal(process.version, 'v26.10.0');
const policy = JSON.parse(readFileSync(join(root, 'packages/operations-policy/policy.json')));
const config = JSON.parse(readFileSync(join(root, 'config/deployment.example.json')));
assert.equal(policy.target.intendedHost, null);
assert.equal(policy.target.readiness, 'unknown-unqualified');
assert.equal(policy.access.proposedViewerAudience, null);
assert.equal(policy.access.proposedEditorOperator, null);
assert.equal(policy.recovery.proposedOwner, null);
assert.deepEqual(policy.gates.releasedByThisPackage, []);
assert.equal(config.status, 'unconfigured-template'); assert.equal(config.liveReady, false);
assert.equal(config.host, null); assert.equal(config.runtimeIdentity, null);
assert.deepEqual(config.origins, []); assert.deepEqual(config.releasedGates, []);
assert(Object.values(config.paths).every(v => v === null));
assert(Object.values(config.ports).every(v => v === null));
assert.deepEqual(config.membership.viewerAccountIds, []); assert.deepEqual(config.membership.editorAccountIds, []);
assert.equal(config.membership.operatorAccountId, null); assert(Object.values(config.recovery).every(v => v === null));
assert.equal(config.credentialsConfigured, false); assert.equal(config.persistentGrantsConfigured, false);
console.log(`Publication file set (${manifest.files.length} files), modes, logical ownership and unfilled template consistent; content is Git's to review; manifest itself requires exact-tree review`);
