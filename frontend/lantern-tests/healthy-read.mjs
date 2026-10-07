/** Ordinary synthetic projection examples; no HTTP listener or write. */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { projectView } from '../src/lantern/adapters/read.ts';
import { demoSnapshot, demoOptions } from '../../web/demo/fixtures.mjs';
import { prepareAtlasView } from '../../web/src/prepare.mjs';

const snapshot = demoSnapshot('normal');
const options = demoOptions(snapshot, 'normal');
options.now = '2026-10-08T00:00:00Z';
const view = prepareAtlasView(snapshot, options);
assert.equal(view.status, 'ready');
const projected = projectView(view);
assert.equal(projected.house.name, view.homeLabel);
assert.equal(projected.view, view);
assert.equal(projected.house.geometry, 'none');
assert(projected.house.floors.every(f => !f.hasPlan));
assert(projected.house.spaces.every(s => s.geometry === 'none' && !s.shape));
assert(projected.house.items.every(i => !i.pos && !i.spaceId && !i.containerId && i.locationClaim === 'unknown'));
assert.equal(projected.house.history.length, 0);
assert.equal(projected.house.writes.length, 0);
assert.equal(new Set([...projected.house.spaces, ...projected.house.items].map(e => e.id)).size, view.entries.length);
for (const entry of view.entries) {
  const source = [...projected.entries.values()].find(e => e === entry);
  assert.equal(source, entry);
}
assert(projected.house.docs.every(d => d.addedAt === '' && d.preview === 'none' && d.version === 0));
const radio = view.entries.find(e => e.entity.name === 'Portable radio');
assert(radio);
assert(projected.house.tasks.some(t => t.status === 'done' && t.completedAt === radio.maintenance.find(m => m.completedDate).completedDate));
assert(projected.house.docs.some(d => projected.docAccess.get(d.id)?.previewHref === '/api/atlas/media/example-photo'));
for (const semanticKind of ['room', 'container', 'site', 'other', 'unclassified', 'building', 'floor']) {
  const entry = view.entries.find(e => e.kind === 'place');
  const variant = projectView({ ...view, entries: [{ ...entry, semanticKind }] });
  assert.equal(variant.house.spaces.length, 1);
  assert.equal(variant.house.spaces[0].semanticKind, semanticKind);
  assert.equal(variant.entries.values().next().value.semanticKind, semanticKind);
  assert(!variant.house.spaces[0].shape);
}
const original = view.entries[0];
const unknown = projectView({ ...view, entries: [{ ...original, kind: 'unknown', semanticKind: undefined }] });
assert.equal(unknown.house.spaces.length, 0);
assert.equal(unknown.house.items.length, 1);
assert(unknown.house.items[0].id.startsWith('uk-'));
assert.equal(unknown.entries.get(unknown.house.items[0].id).kind, 'unknown');
assert.equal(projected.house.displayNow, view.now);
const undated = projectView({ ...view, entries: [{ ...original, maintenance: [{ entryId: 'unscheduled', name: 'Undated upkeep', description: '', scheduledDate: null, completedDate: null, cost: null }] }] });
assert.equal(undated.house.tasks[0].status, 'unknown');
assert.equal(undated.house.tasks[0].due, undefined);
const alternate = { ...view, scope: { ...view.scope, homeId: '00000000-0000-4000-8000-000000000099' }, entries: [] };
assert.notEqual(projectView(alternate).house.id, projected.house.id);
assert.equal(projectView(alternate).house.items.length, 0);
const archive = new URL('../lantern-reference/HouseAtlas-Lantern-B-Source.zip', import.meta.url);
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
assert.equal(digest(readFileSync(archive)), '96a884bf935e6aedfa3e5b4f415cce8be295630fe052dc66c5497f8b87b1da63');
const hashes = JSON.parse(readFileSync(new URL('../lantern-reference/Claude-source-hashes.json', import.meta.url)));
assert.equal(Object.keys(hashes).length, 44);
for (const [path, expected] of Object.entries(hashes)) {
  const result = spawnSync('unzip', ['-p', archive.pathname, `HouseAtlas-Lantern-B/${path}`]);
  assert.equal(result.status, 0);
  assert.equal(digest(result.stdout), expected, path);
}
console.log('PASS synthetic scoped projection, arbitrary place kinds, unknown placement, retained source metadata, actual document handles, source dates, maintenance, and 44 unchanged authored reference hashes');
