// Generated documentary records; no browser, native authority or provider.
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'vite';
assert.equal(process.version, 'v26.10.0');
assert.deepEqual(process.argv.slice(2), []);
const root = fileURLToPath(new URL('../../', import.meta.url));
const scratch = mkdtempSync(join(tmpdir(), 'electrical-group-'));
const entry = join(scratch, 'entry.ts');
writeFileSync(entry, [
  `export { electricalGroups } from ${JSON.stringify(join(root, 'frontend/src/lantern/unified-atlas/electrical-group.ts'))};`,
  `export { projectDocumentaryFacts } from ${JSON.stringify(join(root, 'frontend/src/lantern/unified-atlas/runtime-overlays.ts'))};`,
].join('\n'));
const built = await build({ root: join(root, 'frontend'), configFile: false, logLevel: 'silent',
  build: { write: false, target: 'node26', lib: { entry, formats: ['es'] }, rolldownOptions: { output: { codeSplitting: false } }, minify: false } });
rmSync(scratch, { recursive: true });
const { code } = (Array.isArray(built) ? built[0] : built).output.find(row => row.type === 'chunk' && row.isEntry);
const { electricalGroups, projectDocumentaryFacts } = await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`);

const membership = JSON.stringify({ id: 'group', label: 'A', fixtureIds: ['a', 'b', 'c'] });
const record = (id, source = 'generated-source', membershipValue = membership) => ({
  key: JSON.stringify(['houseatlas-documentary-record.v1', 'workspace', 'home', 'primary-scene', 'scene', 'symbol', id]),
  id, label: id, category: 'Historical symbol', detail: '', qualification: 'unverified', sourceDate: null, retrievedAt: null, connections: [],
  sourceFacts: [{ label: 'Drawing group membership', value: membershipValue }, { label: 'Source original SHA256', value: source }],
});
const a = record('a'), b = record('b'), c = record('c');
const data = { rooms: new Map([['room-1', { electrical: [a], network: [] }], ['room-2', { electrical: [b], network: [] }]]),
  unplaced: { electrical: [c], network: [] } };
const [group] = electricalGroups(data);
assert.equal(group.label, 'A');
assert.equal(group.missing, 0);
assert.deepEqual(group.members.map(row => row.rooms), [['room-1'], ['room-2'], []]);
assert.equal(electricalGroups({ ...data, unplaced: { electrical: [], network: [] } })[0].missing, 1);
assert.equal(electricalGroups({ ...data, rooms: new Map([['room-1', { electrical: [record('a', 'other')], network: [] }]]) }).length, 2);
assert.equal(electricalGroups({ ...data, rooms: new Map([['room-1', { electrical: [record('a', 'generated-source', 'invalid')], network: [] }]]), unplaced: { electrical: [], network: [] } }).length, 0);
assert.equal(electricalGroups({ ...data, rooms: new Map([['room-1', { electrical: [{ ...a, observations: [record('a', 'other')] }], network: [] }]]), unplaced: { electrical: [], network: [] } }).length, 0);
assert.deepEqual(electricalGroups(null), []);

// The actual documentary projector admits only historic drawing groups with no
// current circuit and unverified wiring. Generated data; not installed evidence.
const projected = (groupPatch = {}, fixturePatch = () => ({})) => {
  const ids = ['s0', 's1', 's2'];
  const fixtureData = {
    schema: 'houseatlas.documentary-electrical-fixtures.v1', viewKey: 'generated-view', interpretationDate: '2026-01-02',
    symbolLegend: { xMeansSocket: null, socketsPerX: null, receiptId: null }, roomMappingReceipt: null, registrationReceipts: [],
    sheets: [{ id: 'sheet', title: 'Generated drawing', pdfPage: 1, originalPhoto: 'generated.jpg', originalPhotoSha256: 'd'.repeat(64),
      renderedPhotoSha256: 'e'.repeat(64), sourceDate: null, regionIds: [] }],
    groups: [{ id: 'g', label: 'Generated historic group', fixtureIds: ids, evidenceBasis: 'historic-drawing-label',
      currentCircuitId: null, verifiedWiring: false, ...groupPatch }],
    regions: [],
    fixtures: ids.map((id, i) => ({ id, sheetId: 'sheet', regionId: 'none', clusterId: null, kind: 'socket', label: `Generated symbol ${i}`,
      glyph: 'X', source: { symbolKey: id, originalPhotoSha256: 'd'.repeat(64), renderedPhotoSha256: 'e'.repeat(64), normalizedBox: [0, 0, 1, 1],
        normalizedPoint: [.5, .5], literalLabels: [], placementDescription: 'Generated drawing symbol' },
      group: { id: 'g', label: 'G', basis: 'label-adjacent', note: null }, glyphCount: 1, fixtureCount: null,
      uncertainty: 'Current wiring is unknown', currentState: 'historic-unverified', physicalCoordinate: null, wireRoute: null, ...fixturePatch(id) })),
  };
  const pins = { workspaceId: 'workspace', homeId: 'home', sceneEvidenceId: 'scene', sceneEvidenceRevision: 1, sceneOriginalSha256: 'f'.repeat(64),
    sceneAssetId: 'asset', sceneAssetRevision: 1, acceptedRoomReceiptId: null, acceptedRoomReceiptSha256: null, acceptedRoomAnchors: [] };
  const records = projectDocumentaryFacts({ rooms: [] }, { mode: 'current-native', pins, roomBindings: [],
    network: { status: 'unavailable', reason: 'not-retained' }, electricity: { status: 'unavailable', reason: 'not-retained' },
    electricalFixtures: { status: 'available', data: fixtureData }, observationFacts: [] }, new Set());
  return { records, groups: electricalGroups(records) };
};
const admitted = projected();
assert.equal(admitted.groups.length, 1);
assert.equal(admitted.groups[0].label, 'Generated historic group');
assert.equal(admitted.groups[0].missing, 0);
assert.deepEqual(admitted.groups[0].members.map(row => row.rooms), [[], [], []], 'Membership supplies no room or physical placement');
for (const row of admitted.records.unplaced.electrical) {
  assert.match(row.qualification, /historic and unverified/);
  assert.doesNotMatch(`${row.label} ${row.qualification}`, /verified wiring|current circuit|breaker/i);
}
assert.equal(projected({ currentCircuitId: 'generated-circuit' }).groups.length, 0, 'A claimed circuit is not a historic drawing group');
assert.equal(projected({ verifiedWiring: true }).groups.length, 0, 'Verified wiring is not a historic drawing group');
assert.equal(projected({ verifiedWiring: null }).groups.length, 0, 'Unknown verification is not silently treated as unverified');
assert.equal(projected({ fixtureIds: ['s0', 's1', 's1'] }).groups.length, 0, 'Duplicate membership is refused');
assert.equal(projected({ fixtureIds: ['s0', 's1', 's2', 'absent'] }).groups.length, 0, 'Membership naming an absent fixture is refused');
assert.equal(projected({}, id => id === 's2' ? { group: { id: 'other', label: 'O', basis: 'label-adjacent', note: null } } : {}).groups.length, 0,
  'Non-reciprocal membership is refused');
console.log('Generated electrical drawing group projection passed');
