/** One healthy synthetic documentary projection and static real React view.
 * Pure/local only: no listener, account, household data, native write or import.
 * Browser interactions and scoped invalidation are separately qualified. */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { build, transformWithOxc } from 'vite';

const base = new URL('../src/lantern/overlays/electricity/', import.meta.url);
const dataUrl = code => `data:text/javascript;base64,${Buffer.from(code).toString('base64')}`;
export async function loadElectricityAdapter() {
  const file = new URL('documentary-adapter.ts', base);
  const { code } = await transformWithOxc(readFileSync(file, 'utf8'), file.pathname,
    { lang: 'ts', target: 'esnext', tsconfig: false, sourcemap: false });
  assert(!/^\s*import\s/m.test(code), 'Adapter must remain pure and dependency-free at runtime');
  return import(dataUrl(code));
}

export function syntheticElectricitySource() {
  const room = (id, uuid, label) => ({ id, stable_uuid: uuid, display_name: label, aliases: [], source_refs: ['synthetic-owner#description'] });
  const entities = [room('package:building', 'package-building-uuid', 'Synthetic building'),
    room('package:alpha', 'package-alpha-uuid', 'Alpha'), room('package:beta', 'package-beta-uuid', 'Beta'),
    room('package:stairs', 'package-stairs-uuid', 'Stairs')];
  entities[1].aliases = [{ label: 'Former Alpha', status: 'owner_confirmed_same_identity', source_refs: ['synthetic-owner#alias'] }];
  const association = (entity, owner = false) => ({ package_room_id: entity.id, stable_package_uuid: entity.stable_uuid,
    status: owner ? 'owner-confirmed' : 'inferred-name-or-context-match', evidenceBasis: owner ? 'owner-report' : 'inference',
    native_atlas_identity_id: null, current_circuit_binding: null });
  const statement = (basis, text) => ({ evidenceBasis: basis, statement: text,
    uncertainty: { status: basis === 'document' ? 'supported' : 'inferred', explanation: 'Synthetic drawing interpretation only.' } });
  const sheet = (id, title, labels) => ({ document_id: id, bundle_id: 'synthetic-bundle',
    source_photo: `originals/${id}.heic`, source_sha256: 'a'.repeat(64), rendered_photo: `rendered/${id}.jpg`, pdf_page: 2,
    title_as_read: title, documentary_group_labels: labels,
    direct_reading: statement('document', 'Lamp and outlet marks read from the drawing.'),
    drawing_association: statement('inference', 'Label L7 appears beside a lamp mark.'),
    open_uncertainty: 'Current circuit continuity unknown.', room_candidate_keys: ['a-default-export-placeholder'],
    native_atlas_identity_ids: [], binding_status: 'unreviewed', package_room_associations: [],
    owner_confirmed_room_mapping: null, owner_confirmed_layout_mapping: null, factAt: null, interpretation_date: '2026-10-10',
    provisional_diagram: { coordinate_space: 'normalized-upright-photo', region_xyxy: [0.1, 0.2, 0.8, 0.9],
      geometry_status: 'unmeasured', metric_units: null, scale: null, transform: null, source_date: null } });
  const first = sheet('drawing-a', 'Former Alpha', ['L7', 'Written power label']);
  first.package_room_associations = [association(entities[1], true)];
  first.owner_confirmed_room_mapping = { evidenceBasis: 'owner-report', package_room_id: 'package:alpha',
    statement: 'Owner identifies Former Alpha as Alpha.', source_message_id: 'synthetic-owner-alias', received_via_thread: 'synthetic-owner-thread' };
  const split = sheet('drawing-b', 'Former washroom + passage', ['L7']);
  split.package_room_associations = [entities[1], entities[2], entities[3]].map(entity => ({ ...association(entity),
    status: 'owner-confirmed-historical-to-current-space-mapping', evidenceBasis: 'owner-report' }));
  split.owner_confirmed_layout_mapping = { evidenceBasis: 'owner-report', source_message_id: 'synthetic-owner-alteration', received_via_thread: 'synthetic-owner-thread', mappings: [
    { historical_label: 'Former washroom', current_package_room_ids: ['package:alpha', 'package:beta'],
      relationship: 'historical-space-split-into-two-current-spaces', statement: 'Former washroom was divided into Alpha and Beta.' },
    { historical_label: 'Former passage', current_package_room_ids: ['package:stairs'],
      relationship: 'historical-space-current-use-changed', statement: 'Former passage is now stairs.' },
  ] };
  const unassigned = sheet('drawing-c', 'Unidentified outbuilding', []);
  const inferred = sheet('drawing-d', 'Candidate Alpha', ['L8']);
  inferred.package_room_associations = [association(entities[1])];
  return { input: { schema: 'private-documentary-records/v1', status: 'prepared-locally-not-imported', native_import_receipt: null, records: [first, split, unassigned, inferred] },
    registry: { schema: 'private-houseatlas-room-registry/v1', entities },
    nativeMap: { schema: 'private-native-identity-map/v1', mapping: [
      { package_id: 'package:building', stable_package_uuid: 'package-building-uuid', native_identity_id: 'native-building',
        receipt: 'synthetic-retained-receipt', native_request_id: 'synthetic-request', native_operation_id: 'synthetic-operation' },
    ] } };
}

const { adaptDocumentaryElectricity, electricityLabels, electricitySheets } = await loadElectricityAdapter();
const source = syntheticElectricitySource();
const data = adaptDocumentaryElectricity(source.input, source.registry, source.nativeMap,
  { viewKey: 'synthetic-view', buildingPackageKey: 'package:building', retrievedAt: null });
assert.equal(data.sheets.length, 4);
assert.equal(data.buildingPlaceId, 'native-building');
assert.equal(data.sheets[0].roomAssociations[0].status, 'owner-reported');
assert.equal(data.sheets[0].roomAssociations[0].aliases[0].label, 'Former Alpha');
assert.equal(data.sheets[3].roomAssociations[0].status, 'inferred');
assert.deepEqual(data.sheets[1].roomAssociations.map(room => [room.historicalLabel, room.label]),
  [['Former washroom', 'Alpha'], ['Former washroom', 'Beta'], ['Former passage', 'Stairs']]);
assert.equal(data.sheets[2].roomAssociations.length, 0);
assert(data.sheets.every(sheet => sheet.spatial.mappingStatus === 'unmatched' && sheet.spatial.coordinate === null));
assert(data.sheets.every(sheet => sheet.source.factAt === null && sheet.source.sourceDate === null && sheet.source.retrievedAt === null));
assert.equal(data.sheets[0].roomAssociations[0].associationSource.ownerStatementId, 'synthetic-owner-alias');
assert.equal(data.sheets[3].roomAssociations[0].associationSource.ownerStatementId, null);
assert.equal(data.preparationSnapshot.status, 'prepared-locally-not-imported');
assert(data.sheets.flatMap(sheet => sheet.roomAssociations).every(room => room.nativePlaceId === null));
assert(Object.isFrozen(data) && Object.isFrozen(data.sheets[1].roomAssociations));
assert.deepEqual(electricityLabels(data), [{ label: 'L7', sheetCount: 2 }, { label: 'Written power label', sheetCount: 1 }, { label: 'L8', sheetCount: 1 }]);
assert.deepEqual(electricitySheets(data, null, 'L7').map(sheet => sheet.id), ['drawing-a', 'drawing-b']);
assert.equal(electricitySheets(data, 'native-building', null).length, 4);

// Bundle the actual panel and adopted original UI components without a server.
const outputs = await build({ configFile: false, root: new URL('..', import.meta.url).pathname,
  logLevel: 'error', ssr: { noExternal: ['ajv-formats'] }, build: { ssr: new URL('ElectricityOverlayPanel.tsx', base).pathname, write: false,
    sourcemap: false, minify: false, rollupOptions: { external: ['react', 'react/jsx-runtime'] } } });
const chunk = outputs.output.find(entry => entry.type === 'chunk');
assert(chunk);
let panelCode = chunk.code;
for (const name of ['react/jsx-runtime', 'react']) {
  const path = new URL(`../node_modules/${name === 'react' ? 'react/index.js' : 'react/jsx-runtime.js'}`, import.meta.url).href;
  panelCode = panelCode.replaceAll(`from "${name}"`, `from ${JSON.stringify(path)}`).replaceAll(`from '${name}'`, `from ${JSON.stringify(path)}`);
}
const { ElectricityOverlayPanel } = await import(dataUrl(panelCode));
const props = { active: true, viewKey: 'synthetic-view', data, selectedFloor: { id: 'export-only', label: 'Placeholder export' } };
const markup = renderToStaticMarkup(createElement(ElectricityOverlayPanel, props));
for (const text of ['Electrical drawings', 'Documentary label filters', 'Former washroom', 'Former passage', 'Unidentified outbuilding',
  'Owner reported', 'Inferred association', 'Room association unknown', 'coordinates unknown', 'Source date', 'Unknown', 'Placeholder export']) assert(markup.includes(text), text);
assert(markup.includes('aria-pressed="false"') && markup.includes('<details>'));
assert.equal(renderToStaticMarkup(createElement(ElectricityOverlayPanel, { ...props, active: false })), '');
console.log('PASS healthy synthetic electricity adapter, owner aliases/layout changes, unmatched placement, literal filters and original Lantern static panel');
