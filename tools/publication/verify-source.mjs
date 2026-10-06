// Read-only exact-file integrity inspection; never mutates source or runs controls.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { lstatSync, readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, relative } from 'node:path';
const root = fileURLToPath(new URL('../../', import.meta.url));
const manifestPath = 'docs/publication/source-manifest.json';
const manifest = JSON.parse(readFileSync(join(root, manifestPath)));
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
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
assert.equal(manifest.format, 'houseatlas-publication-source/1');
assert.deepEqual(manifest.self, {path: manifestPath, mode: '100644', digest: 'anchored-by-reviewed-tree'});
const expected = manifest.files.map(row => row.path);
assert.deepEqual(expected, [...new Set(expected)].sort());
walk(root);
assert.deepEqual(actual.sort(), [...expected, manifestPath].sort(), 'Exact source allowlist mismatch');
for (const row of manifest.files) {
  assert(/^[a-zA-Z0-9._/-]+$/.test(row.path) && !row.path.split('/').some(p => p === '..' || p === '.' || !p));
  assert(manifest.owners.includes(row.owner));
  const path = join(root, row.path), stat = lstatSync(path), bytes = readFileSync(path);
  assert.equal(row.mode, (stat.mode & 0o111) ? '100755' : '100644');
  assert.equal(bytes.length, row.bytes, row.path);
  assert.equal(hash(bytes), row.sha256, row.path);
}
assert.equal(hash(Buffer.from(manifest.files.map(r => `${r.path}\t${r.mode}\t${r.bytes}\t${r.sha256}\n`).join(''))), manifest.sourceDigestSha256);
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
console.log(`Publication file set, modes, ${manifest.files.length} digests, logical ownership and unfilled template consistent; manifest itself requires exact-tree review`);
