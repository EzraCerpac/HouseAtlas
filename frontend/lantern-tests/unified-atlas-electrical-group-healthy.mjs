// Generated documentary records and generated #557 electrical data; no browser,
// native authority, provider or installed wiring evidence.
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'vite';
assert.equal(process.version, 'v26.10.0');
assert.deepEqual(process.argv.slice(2), []);
const root = fileURLToPath(new URL('../../', import.meta.url));
const scratch = mkdtempSync(join(tmpdir(), 'electrical-group-'));
let electricalGroups, projectDocumentaryFacts, traceElectricalGroup, withholdText, ElectricalTraceDetail;
try {
  const entry = join(scratch, 'entry.ts');
  writeFileSync(entry, [
    `export { electricalGroups } from ${JSON.stringify(join(root, 'frontend/src/lantern/unified-atlas/electrical-group.ts'))};`,
    `export { projectDocumentaryFacts } from ${JSON.stringify(join(root, 'frontend/src/lantern/unified-atlas/runtime-overlays.ts'))};`,
    `export { traceElectricalGroup, withholdText } from ${JSON.stringify(join(root, 'frontend/src/lantern/unified-atlas/electrical-trace.ts'))};`,
    `export { ElectricalTraceDetail } from ${JSON.stringify(join(root, 'frontend/src/lantern/unified-atlas/ElectricalTraceDetail.tsx'))};`,
  ].join('\n'));
  // React stays the frontend's own installed module, shared with react-dom/server below.
  const react = { name: 'frontend-react', enforce: 'pre', resolveId(id) {
    if (id === 'react' || id.startsWith('react/')) return { id: pathToFileURL(createRequire(join(root, 'frontend/package.json')).resolve(id)).href, external: true };
  } };
  const built = await build({ root: join(root, 'frontend'), configFile: false, logLevel: 'silent', plugins: [react],
    build: { write: false, target: 'node26', lib: { entry, formats: ['es'] }, rolldownOptions: { output: { codeSplitting: false } }, minify: false } });
  const modulePath = join(scratch, 'electrical.mjs');
  writeFileSync(modulePath, (Array.isArray(built) ? built[0] : built).output.find(row => row.type === 'chunk' && row.isEntry).code);
  ({ electricalGroups, projectDocumentaryFacts, traceElectricalGroup, withholdText, ElectricalTraceDetail } = await import(pathToFileURL(modulePath).href));
} finally { rmSync(scratch, { recursive: true }); }
const { createElement } = await import('react');
const { renderToStaticMarkup } = await import('react-dom/server');

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
// Existing #553 groups also expose their exact parsed group/source identity.
assert.deepEqual([group.groupId, group.fixtureIds, group.source], ['group', ['a', 'b', 'c'],
  { workspaceId: 'workspace', homeId: 'home', sceneEvidenceId: 'scene', sceneOriginalSha256: 'generated-source' }]);

// #554 consumer: the actual #557 projector over its generated fixture, joined to
// actual #553 groups. GENERATED tested state; no electrical test was performed.
const { createElectricalDataProjector, electricalReviewSubject } = await import(new URL('../../packages/contracts/src/electrical-data.mjs', import.meta.url));
const json = path => JSON.parse(readFileSync(new URL(path, import.meta.url), 'utf8'));
const generated = json('../../contracts/electrical-data/generated.fixture.json');
const projectData = createElectricalDataProjector(json('../../contracts/electrical-data/v1.schema.json'), json('../../packages/contracts/schemas/atlas.v2.schema.json'));
const scope = generated.data.scope, ATLAS_ROOM = 'generated-atlas-room', NATIVE_ROOM = generated.expected.reviewedRoomId;
const scenePins = { workspaceId: scope.workspaceId, homeId: scope.homeId, sceneEvidenceId: 'generated-scene', sceneEvidenceRevision: 1,
  sceneOriginalSha256: 'c'.repeat(64), sceneAssetId: 'generated-asset', sceneAssetRevision: 1, acceptedRoomReceiptId: null,
  acceptedRoomReceiptSha256: null, acceptedRoomAnchors: [] };
const groupsFor = ledger => electricalGroups(projectDocumentaryFacts({ rooms: [] }, { mode: 'current-native', pins: scenePins, roomBindings: [],
  network: { status: 'unavailable', reason: 'not-retained' }, electricity: { status: 'unavailable', reason: 'not-retained' },
  electricalFixtures: { status: 'available', data: ledger }, observationFacts: [] }, new Set()));
// Generated review authority: every row of `data` is independently current.
const reviewsFor = data => [...data.panels.map(row => ['panel', row]), ...data.breakers.map(row => ['breaker', row]), ...data.mappings.map(row => ['mapping', row])]
  .map(([kind, row]) => ({ receipt: row.review.receipt, subject: electricalReviewSubject(data, kind, row) }));
const bind = (roomId, nativePlaceId = NATIVE_ROOM, qualification = 'current-native-room-join') => ({ roomId, nativePlaceId, qualification });
const sourceFor = ({ data = generated.data, context = generated.context, roomBindings = [bind(ATLAS_ROOM)], ledger = {} } = {}) => ({
  ledger: { workspaceId: scope.workspaceId, homeId: scope.homeId, sceneEvidenceId: scenePins.sceneEvidenceId,
    sceneOriginalSha256: scenePins.sceneOriginalSha256, viewKey: data.viewKey, sha256: data.fixtureLedgerSha256, ...ledger },
  projection: projectData(data, context), roomBindings });
const fixtureGroups = groupsFor(generated.context.documentary.data);
const byId = id => fixtureGroups.find(row => row.groupId === id);
assert.deepEqual(fixtureGroups.map(row => row.groupId).sort(), ['generated-group-1', 'generated-group-2', 'generated-group-3']);
const happy = sourceFor();
const traces = ['generated-group-1', 'generated-group-2', 'generated-group-3'].map(id => traceElectricalGroup(byId(id), happy));
assert.deepEqual(traces.map(trace => trace.rows.map(row => row.circuit.circuitId)), generated.expected.currentCircuitIds.map(id => [id]));
assert.deepEqual(traces.map(trace => trace.rows.map(row => row.test !== null)), generated.expected.verifiedWiring.map(value => [value]));
assert.ok(traces.every(trace => trace.status === 'traced' && trace.uncovered.length === 0));
const [owner, label, tested] = traces.map(trace => trace.rows[0]);
assert.deepEqual(owner.coverage, { kind: 'group' });
assert.deepEqual([owner.basis, owner.confidence, owner.circuit.label], ['owner-report', 'low', 'Generated circuit A']);
assert.deepEqual(owner.circuit.details, { position: { label: 'A1', ways: ['A1'] }, ratingAmperes: 16, protection: null }, 'Explicit null stays unknown');
assert.deepEqual(owner.circuit.panel, { label: 'Generated panel Δ', room: { kind: 'room', roomId: ATLAS_ROOM, nativePlaceId: NATIVE_ROOM } });
assert.deepEqual([label.basis, label.circuit.label, label.circuit.details], ['label-match', null, { position: null }], 'Absent rating/protection stay absent');
assert.deepEqual(tested.coverage, { kind: 'fixture', fixtureId: 'generated-symbol-3', label: 'Generated symbol 3' });
assert.deepEqual(tested.test, { observedAt: '2026-10-01T12:00:00Z', method: 'Generated test-result assertion; no real test performed' });
assert.equal(owner.test, null, 'A reviewed owner report is never a tested association');

// Panel room: only the supplied qualified bindings place it; unique roomId or nothing.
const roomOf = roomBindings => traceElectricalGroup(byId('generated-group-1'), sourceFor({ roomBindings })).rows[0].circuit.panel.room;
assert.deepEqual(roomOf([]), { kind: 'not-placed' });
assert.deepEqual(roomOf([bind('r1'), bind('r2')]), { kind: 'ambiguous' }, 'Never the first of several rooms');
assert.deepEqual(roomOf([bind('r1'), bind('r1')]), { kind: 'room', roomId: 'r1', nativePlaceId: NATIVE_ROOM });
assert.deepEqual(roomOf([bind(ATLAS_ROOM, 'other-native-room')]), { kind: 'not-placed' });
assert.deepEqual(roomOf([bind(ATLAS_ROOM, NATIVE_ROOM, 'captured-room-identity-join')]), { kind: 'not-placed' }, 'Saved identity joins are not current bindings');

// Refusal: the projection must describe exactly this group's ledger and source.
const refused = (source, groupRow = byId('generated-group-1')) => traceElectricalGroup(groupRow, source);
for (const ledger of [{ sha256: 'f'.repeat(64) }, { viewKey: 'generated:other-view' }, { sceneEvidenceId: 'other-scene' },
  { sceneOriginalSha256: 'd'.repeat(64) }, { homeId: '00000000-0000-4000-8000-000000000099' }])
  assert.deepEqual(refused(sourceFor({ ledger })), { status: 'refused', reason: 'source-mismatch' }, JSON.stringify(ledger));
const altered = patch => ({ ...happy, projection: { ...happy.projection, ...patch } });
assert.equal(refused(altered({ nativeQualified: true })).reason, 'source-mismatch');
assert.equal(refused(altered({ wireRoutes: [] })).reason, 'source-mismatch');
assert.equal(refused(altered({ mappings: happy.projection.mappings.map(row => ({ ...row, fixtureIds: [...row.fixtureIds, 'generated-symbol-2'] })) })).reason, 'source-mismatch');
assert.equal(refused(altered({ breakers: [] })).reason, 'source-mismatch', 'A reviewed association without its current breaker is inconsistent');
assert.equal(refused(altered({ mappings: Array.from({ length: 10001 }, () => happy.projection.mappings[0]) })).reason, 'source-too-large', 'Rows are never truncated');
assert.equal(refused({ ...happy, roomBindings: Array.from({ length: 10001 }, () => happy.roomBindings[0]) }).reason, 'source-too-large');

// Currentness: a replaced source with a missing review, stale circuit or
// unknown basis withholds rows; withheld rows never expose a candidate circuit.
const withoutReview = sourceFor({ context: { ...generated.context, currentReviews: generated.context.currentReviews.filter(row => row.receipt.id !== 'generated-review-mapping-1') } });
const stale = traceElectricalGroup(byId('generated-group-1'), withoutReview);
assert.deepEqual([stale.rows[0].circuit, stale.rows[0].test, stale.rows[0].reasons], [null, null, ['No current review of this exact assertion']]);
assert.deepEqual(stale.uncovered, [{ fixtureId: 'generated-symbol-1', label: 'Generated symbol 1' }]);
const revised = structuredClone(generated.context);
revised.records.find(row => row.recordId === generated.expected.currentCircuitIds[0]).revision = 2;
assert.deepEqual(traceElectricalGroup(byId('generated-group-1'), sourceFor({ context: revised })).rows[0].reasons, ['Breaker record is not current']);
const unknownData = structuredClone(generated.data);
Object.assign(unknownData.mappings[0], { basis: 'unknown' }); unknownData.mappings[0].review.confidence = 'unknown';
const unknownRow = traceElectricalGroup(byId('generated-group-1'), sourceFor({ data: unknownData, context: { ...generated.context, currentReviews: reviewsFor(unknownData) } })).rows[0];
assert.deepEqual([unknownRow.circuit, unknownRow.basis, unknownRow.confidence, unknownRow.reasons], [null, 'unknown', 'unknown', ['Basis unknown', 'Confidence unknown']]);
assert.equal(withholdText('a-future-code'), 'Unavailable', 'Unrecognized codes never become raw interface text');
assert.equal(withholdText('toString'), 'Unavailable');
const futureRow = traceElectricalGroup(byId('generated-group-1'), altered({ mappings: happy.projection.mappings.map(row => row.id === 'generated-mapping-1'
  ? { ...row, status: 'withheld', currentCircuitId: null, reasons: ['a-future-code', 'contradictory-fixture-circuit-tests'] } : row) })).rows[0];
assert.deepEqual(futureRow.reasons, ['Unavailable', 'A current test contradicts this association']);

// Unknown and unrecorded panel facts stay distinct and are never guessed.
const panelData = structuredClone(generated.data);
Object.assign(panelData.panels[0], { label: null, roomAssociation: null });
const panelSource = data => sourceFor({ data, context: { ...generated.context, currentReviews: reviewsFor(data) } });
assert.deepEqual(traceElectricalGroup(byId('generated-group-1'), panelSource(panelData)).rows[0].circuit.panel, { label: null, room: { kind: 'unknown' } });
delete panelData.panels[0].roomAssociation;
assert.deepEqual(traceElectricalGroup(byId('generated-group-1'), panelSource(panelData)).rows[0].circuit.panel.room, { kind: 'not-recorded' });

// A group of two members: per-member circuits are not a conflict, partial
// coverage stays explicit and disagreeing group/fixture candidates withhold.
const ledger = structuredClone(generated.context.documentary.data);
ledger.groups[0].fixtureIds = ['generated-symbol-1', 'generated-symbol-2']; ledger.groups[1].fixtureIds = [];
ledger.fixtures.find(row => row.id === 'generated-symbol-2').group = { ...ledger.fixtures[0].group };
const pair = groupsFor(ledger).find(row => row.groupId === 'generated-group-1');
assert.deepEqual([pair.fixtureIds, pair.missing], [['generated-symbol-1', 'generated-symbol-2'], 0]);
const pairData = (mappings) => {
  const data = { ...structuredClone(generated.data), fixtureLedgerSha256: '1'.repeat(64), mappings };
  return sourceFor({ data, context: { ...generated.context, documentary: { sha256: data.fixtureLedgerSha256, data: ledger }, currentReviews: reviewsFor(data) } });
};
const [m1, m2] = generated.data.mappings;
const perFixture = [{ ...m1, target: { kind: 'fixture', id: 'generated-symbol-1' } }, { ...m2, target: { kind: 'fixture', id: 'generated-symbol-2' } }];
const split = traceElectricalGroup(pair, pairData(perFixture));
assert.deepEqual(split.rows.map(row => [row.coverage.fixtureId, row.circuit.circuitId]),
  [['generated-symbol-1', generated.expected.currentCircuitIds[0]], ['generated-symbol-2', generated.expected.currentCircuitIds[1]]]);
assert.deepEqual(split.uncovered, []);
assert.deepEqual(traceElectricalGroup(pair, pairData(perFixture.slice(0, 1))).uncovered, [{ fixtureId: 'generated-symbol-2', label: 'Generated symbol 2' }]);
const disputed = traceElectricalGroup(pair, pairData([m1, perFixture[1]]));
assert.ok(disputed.rows.every(row => row.circuit === null && row.reasons.includes('Another mapping names a different circuit for these symbols')));
assert.equal(disputed.uncovered.length, 2);
assert.equal(traceElectricalGroup(pair, pairData([m1])).rows[0].circuit.circuitId, generated.expected.currentCircuitIds[0]);
assert.deepEqual(traceElectricalGroup(pair, pairData([])), { status: 'traced', rows: [], uncovered: pair.fixtureIds.map(fixtureId => ({ fixtureId, label: `Generated symbol ${fixtureId.at(-1)}` })) });
assert.equal(traceElectricalGroup(pair, happy).reason, 'source-mismatch', 'The original single-member ledger projection does not describe this pair');

// Actual detail markup: readable facts, room navigation and no wiring claims.
const model = { roomsById: new Map([[ATLAS_ROOM, { roomId: ATLAS_ROOM, nativePlaceId: NATIVE_ROOM, label: 'Generated room', occurrenceIds: ['generated-occurrence'] }],
  ['other-atlas-room', { roomId: 'other-atlas-room', nativePlaceId: 'other-native-room', label: 'Other room', occurrenceIds: ['other-occurrence'] }]]),
  selectable: new Set(['generated-occurrence', 'other-occurrence']) };
const markup = (groupRow, source) => renderToStaticMarkup(createElement(ElectricalTraceDetail, { group: groupRow, source, model, onRoom: () => {} }));
const ownerHTML = markup(byId('generated-group-1'), happy);
for (const text of ['Circuit and panel', 'Whole group', 'Generated circuit A', 'A1', '16 A', 'Generated panel Δ', 'Generated room</button>', 'Owner report', 'Low', 'Not confirmed by test'])
  assert.ok(ownerHTML.includes(text), text);
assert.match(ownerHTML, /<dt>Protection<\/dt><dd>Unknown<\/dd>/);
assert.doesNotMatch(markup(byId('generated-group-2'), happy), /Rating|Protection/, 'Absent details are not shown');
assert.match(markup(byId('generated-group-3'), happy), /Circuit association confirmed by test, observed 2026-10-01T12:00:00Z/);
for (const html of [ownerHTML, markup(byId('generated-group-3'), happy)]) assert.doesNotMatch(html, /wiring verified|verified wiring|wire route|cable/i);
assert.doesNotMatch(markup(byId('generated-group-1'), sourceFor({ roomBindings: [] })), /<button/);
assert.match(markup(byId('generated-group-1'), sourceFor({ roomBindings: [] })), /Not placed in this Atlas/);
const crossed = markup(byId('generated-group-1'), sourceFor({ roomBindings: [bind('other-atlas-room')] }));
assert.doesNotMatch(crossed, /<button|Other room/, 'A binding whose Atlas room names another native place is not followed');
assert.match(markup(byId('generated-group-1'), sourceFor({ roomBindings: [bind('r1'), bind('r2')] })), /Several Atlas rooms match; not placed/);
const staleHTML = markup(byId('generated-group-1'), withoutReview);
assert.match(staleHTML, /Withheld: No current review of this exact assertion/);
assert.doesNotMatch(staleHTML, /Generated circuit A|Generated panel/);
assert.match(markup(byId('generated-group-1'), sourceFor({ ledger: { sha256: 'f'.repeat(64) } })), /does not match this drawing group/);
assert.match(markup(pair, pairData([])), /No reviewed circuit mapping/);
console.log('Generated electrical drawing group and breaker trace projections passed');
