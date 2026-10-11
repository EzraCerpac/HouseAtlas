/** Healthy synthetic source positions and explicit approximate display only.
 * No household source, server, native command, access or failure-injection case. */
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { build } from 'vite';

const base = new URL('../src/lantern/overlays/electricity/', import.meta.url);
async function bundle(name) {
  const result = await build({ configFile: false, root: new URL('..', import.meta.url).pathname,
    logLevel: 'error', build: { ssr: new URL(name, base).pathname, write: false, sourcemap: false,
      minify: false, rollupOptions: { external: ['react', 'react/jsx-runtime'] } } });
  let code = result.output.find(entry => entry.type === 'chunk').code;
  for (const name of ['react', 'react/jsx-runtime']) {
    const url = new URL(`../node_modules/${name === 'react' ? 'react/index.js' : 'react/jsx-runtime.js'}`, import.meta.url).href;
    code = code.replaceAll(`from "${name}"`, `from ${JSON.stringify(url)}`).replaceAll(`from '${name}'`, `from ${JSON.stringify(url)}`);
  }
  return import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`);
}
const photo = 'a'.repeat(64), render = 'b'.repeat(64);
const fixtures = [['socket-one', 'socket', [.3, .4]], ['socket-two', 'socket', [.32, .4]], ['light-one', 'light', [.5, .6]]]
  .map(([id, kind, point]) => ({ id, kind, sheetId: 'drawing-alpha', regionId: 'region-alpha',
    clusterId: kind === 'socket' ? 'socket-pair' : null, label: `${kind} ${id}`, glyph: kind === 'socket' ? 'X' : 'Light',
    source: { symbolKey: id, originalPhotoSha256: photo, renderedPhotoSha256: render,
      normalizedPoint: point, normalizedBox: [point[0] - .01, point[1] - .01, point[0] + .01, point[1] + .01],
      literalLabels: ['L7'], placementDescription: 'Source glyph beside label.' },
    group: { id: 'documentary-L7', label: 'L7', basis: 'label-adjacent', note: 'Historic drawing label.' },
    glyphCount: 1, fixtureCount: kind === 'socket' ? 1 : null, uncertainty: kind === 'light' ? 'Light quantity unknown.' : null,
    currentState: 'historic-unverified', physicalCoordinate: null, wireRoute: null }));
const roomReceipt = { id: 'synthetic-source-room-receipt', sha256: 'c'.repeat(64) };
const registration = { id: 'synthetic-diagram-registration', sha256: 'd'.repeat(64), status: 'source-reviewed-approximate',
  roomMappingReceipt: roomReceipt, sheetId: 'drawing-alpha', regionId: 'region-alpha', originalPhotoSha256: photo,
  packagePlaceKey: 'package:alpha', packagePlaceUuid: 'synthetic-alpha-uuid', sourceAnchorIds: ['source:alpha'],
  approvedFixtureIds: fixtures.map(fixture => fixture.id), basis: 'Synthetic matched drawing landmarks.',
  reviewQualification: 'Approximate display only, not measured or current wiring.', physicalTransform: null };
const data = { schema: 'houseatlas.documentary-electrical-fixtures.v1', viewKey: 'synthetic-fixture-view',
  interpretationDate: '2026-10-10', symbolLegend: { xMeansSocket: true, socketsPerX: 1, receiptId: 'synthetic-symbol-receipt' },
  roomMappingReceipt: roomReceipt, registrationReceipts: [registration], fixtures,
  sheets: [{ id: 'drawing-alpha', title: 'Synthetic source drawing', pdfPage: 2, originalPhoto: 'synthetic-original.heic',
    originalPhotoSha256: photo, renderedPhotoSha256: render, sourceDate: null, regionIds: ['region-alpha'] }],
  groups: [{ id: 'documentary-L7', label: 'L7', fixtureIds: fixtures.map(fixture => fixture.id),
    evidenceBasis: 'historic-drawing-label', currentCircuitId: null, verifiedWiring: false }],
  regions: [{ id: 'region-alpha', sheetId: 'drawing-alpha', label: 'Alpha', sourceOutline: [], outlineClosed: false,
    outlineBasis: 'untraced', sourceBounds: [.2, .3, .7, .8], orientation: 'unregistered', physicalTransform: null,
    places: [{ packagePlaceKey: 'package:alpha', packagePlaceUuid: 'synthetic-alpha-uuid', label: 'Alpha', basis: 'owner-reported' }] }] };
const placements = fixtures.map((fixture, index) => ({ fixtureId: fixture.id, regionId: fixture.regionId,
  viewKey: data.viewKey, packagePlaceKey: registration.packagePlaceKey, packagePlaceUuid: registration.packagePlaceUuid,
  sourceAnchorIds: registration.sourceAnchorIds, originalPhotoSha256: photo, sourcePoint: fixture.source.normalizedPoint,
  registrationReceiptId: registration.id, registrationReceiptSha256: registration.sha256,
  point: [100 + index * 20, 200], visible: true, basis: 'reviewed-approximate-diagram' }));
const layerProps = { active: true, viewKey: data.viewKey, data, placements, selectedFixtureId: 'socket-one',
  selectedGroup: 'L7', ui: 1, onFixtureChange() {} };
const { registeredFixturePlacements } = await bundle('fixture-model.ts');
assert.equal(registeredFixturePlacements(layerProps).length, 3);
assert(fixtures.every(fixture => fixture.physicalCoordinate === null && fixture.wireRoute === null));
const { ElectricityFixtureLayer } = await bundle('ElectricityFixtureLayer.tsx');
const svg = renderToStaticMarkup(createElement('svg', null, createElement(ElectricityFixtureLayer, layerProps)));
assert.equal((svg.match(/data-fixture-id=/g) ?? []).length, 3);
assert(svg.includes('socket-one') && svg.includes('light-one') && svg.includes('approximate position'));
const { ElectricityFixtureDiagram } = await bundle('ElectricityFixtureDiagram.tsx');
const diagramProps = { active: true, viewKey: data.viewKey, data,
  selectedRegionId: 'region-alpha', selectedFixtureId: 'light-one', selectedGroup: null,
  onRegionChange() {}, onFixtureChange() {}, onGroupChange() {}, onOpenSource() {} };
const diagram = renderToStaticMarkup(createElement(ElectricityFixtureDiagram, diagramProps));
assert.equal((diagram.match(/data-fixture-id=/g) ?? []).length, 3);
for (const text of ['X · socket', 'Lighting mark', 'Light quantity unknown.', 'Not traced', 'Unregistered', 'Open source page'])
  assert(diagram.includes(text), text);
const unselected = renderToStaticMarkup(createElement(ElectricityFixtureDiagram,
  { ...diagramProps, selectedRegionId: null, selectedFixtureId: null, selectedPackagePlaces: null }));
assert.equal((unselected.match(/data-fixture-id=/g) ?? []).length, 0);
assert(unselected.includes('Choose a drawing region.') && unselected.includes('value="region-alpha"'));
assert(!unselected.includes('Open source page'));
const acceptedRoom = renderToStaticMarkup(createElement(ElectricityFixtureDiagram, { ...diagramProps,
  selectedRegionId: null, selectedPackagePlaces: { viewKey: data.viewKey, status: 'accepted',
    receiptId: roomReceipt.id, receiptSha256: roomReceipt.sha256, sourceAnchorIds: ['source:alpha'],
    targets: [{ packagePlaceKey: 'package:alpha', packagePlaceUuid: 'synthetic-alpha-uuid' }], unresolvedLabels: [] } }));
assert.equal((acceptedRoom.match(/data-fixture-id=/g) ?? []).length, 3);
assert(acceptedRoom.includes('Open source page'));
const previewProps = { ...layerProps, data: { ...data, registrationReceipts: [{ ...registration, status: 'proposed' }] },
  registrationPreviewId: registration.id,
  placements: placements.map(placement => ({ ...placement, basis: 'proposed-diagram-alignment' })) };
const preview = renderToStaticMarkup(createElement('svg', null, createElement(ElectricityFixtureLayer, previewProps)));
assert.equal((preview.match(/data-fixture-id=/g) ?? []).length, 3);
assert(preview.includes('Proposed drawing alignment') && preview.includes('stroke-dasharray'));
console.log('PASS healthy synthetic individual fixtures, source glyph quantities, group evidence, real SVG/source diagram and explicit proposed-display styling; no browser/native acceptance');
