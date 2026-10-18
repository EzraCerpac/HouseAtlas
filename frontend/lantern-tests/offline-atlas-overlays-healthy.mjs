// Named valid generated complete/partial packages; no browser/listener/native host.
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'vite';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
assert.equal(process.version, 'v26.10.0');
assert.deepEqual(process.argv.slice(2), []);
const scratch = mkdtempSync(join(tmpdir(), 'saved-atlas-overlay-positive-'));
const entry = join(scratch, 'entry.ts'), root = fileURLToPath(new URL('../../', import.meta.url));
writeFileSync(entry, [
  ['frontend/lantern-tests/offline-atlas-browser/generated-pack.ts', ['generateSavedPack']],
  ['frontend/src/offline/saved-pack-sections.ts', ['readSavedPackSections']],
  ['frontend/src/offline/saved-atlas-overlays.ts', ['projectSavedAtlasOverlays','readSavedHistoricalFacts']],
  ['frontend/src/offline/saved-atlas-port.ts', ['createSavedAtlasDataAdapter']],
  ['frontend/src/offline/manifest.ts', ['canonicalPack', 'readPackManifest']],
  ['frontend/src/offline/store.ts', ['savedDigest']],
  ['frontend/src/numeric/lossless-json.ts', ['parseLosslessJson']],
  ['frontend/src/lantern/unified-atlas/runtime-overlays.ts', ['mergeDocumentaryRecords', 'projectDocumentaryFacts']],
  ['frontend/src/lantern/canonical-ifc/standard-glb.ts', ['loadStandardGlb']],
  ['frontend/src/lantern/unified-atlas/scene.ts', ['bindAtlasModel', 'planFeaturesForLevel', 'sitePlanLevels']],
].map(([path, names]) => `export { ${names.join(',')} } from ${JSON.stringify(join(root, path))};`).join('\n'));
const built = await build({ root: join(root, 'frontend'), configFile: false, logLevel: 'silent', build: { write: false, target: 'node26', lib: { entry, formats: ['es'] }, rolldownOptions: { output: { codeSplitting: false } }, minify: false } });
const output = Array.isArray(built) ? built[0] : built;
const modulePath = join(scratch, 'positive.mjs'); writeFileSync(modulePath, output.output.find(row => row.type === 'chunk' && row.isEntry).code);
const { generateSavedPack, readSavedPackSections, projectSavedAtlasOverlays, readSavedHistoricalFacts, createSavedAtlasDataAdapter, mergeDocumentaryRecords, projectDocumentaryFacts, canonicalPack, readPackManifest, savedDigest, parseLosslessJson, loadStandardGlb, bindAtlasModel, planFeaturesForLevel, sitePlanLevels } = await import(pathToFileURL(modulePath).href);
rmSync(scratch, { recursive: true });
const atlasSchema = JSON.parse(readFileSync(join(root, 'packages/contracts/schemas/atlas.schema.json')));
// The exporter intentionally strips only asset custody routing storageKey.
atlasSchema.$defs.assetPayload.required = atlasSchema.$defs.assetPayload.required.filter(key => key !== 'storageKey');
const v2Schema = JSON.parse(readFileSync(join(root, 'packages/contracts/schemas/atlas.v2.schema.json')));
const ajv = new Ajv2020({ strict: false, allErrors: true }); addFormats(ajv); ajv.addSchema(atlasSchema); ajv.addSchema(v2Schema);
const shape = (schema, name, value) => {
  const validate = ajv.getSchema(`${schema.$id}#/$defs/${name}`) ?? ajv.compile({ $ref: `${schema.$id}#/$defs/${name}` });
  assert(validate(value), `${name}: ${JSON.stringify(validate.errors)}`);
};
function exporterShapes(checked) {
  const normal = value => JSON.parse(canonicalPack(value));
  const atlas = normal(checked.roots.atlas);
  assert.deepEqual(Object.keys(atlas).sort(), ['contractVersion','synthetic','records','revisions','nativeGeometry','sources','caches'].sort());
  for (const row of atlas.records) shape(atlasSchema, 'record', row);
  for (const row of normal(checked.roots.inventory).entities) shape(atlasSchema, 'homeboxProjection', row);
  for (const row of normal(checked.roots.network).relations) shape(atlasSchema, 'networkRelation', row);
  for (const row of atlas.sources) shape(atlasSchema, 'sourceRegistration', row);
  for (const row of atlas.caches) shape(atlasSchema, 'cacheStatus', row);
  for (const row of normal(checked.roots.documents).documents) shape(v2Schema, 'geodataDocumentRecord', row);
  assert.equal(atlas.records.length, atlas.revisions.length);
}
for (const mode of ['complete', 'partial']) {
  const pack = await generateSavedPack(mode, '1'.repeat(64)), house = { ...pack.house, localRevision: crypto.randomUUID() };
  let reads = 0;
  const local = { list: async () => [house], asset: async (selected, id) => {
    assert.equal(selected.localRevision, house.localRevision); reads++;
    const pin = house.resources.find(pin => pin.id === id); return new Blob([pack.resources.get(id)], { type: pin.contentType });
  } };
  const checked = await readSavedPackSections(local, house, new AbortController().signal);
  exporterShapes(checked);
  assert.equal(house.snapshotId, mode === 'complete' ? '79b0f1365c9926d3ee8151f65d7a4bf617bedacc9fb71dbb6293f3ccaa4b0efe' : '5af092cc7ec09f2b71f32828d4e5049923a37f711bc64223e6aaf130e5536776', 'original UI variants retain their exact snapshot pins');
  const savedRead = await createSavedAtlasDataAdapter(local).read(house, new AbortController().signal);
  const historical = await readSavedHistoricalFacts(checked, savedRead, new AbortController().signal);
  const result = projectSavedAtlasOverlays(checked, pack.scene, historical);
  assert.equal(result.kind, 'saved'); assert.equal(result.state, 'partial'); assert.equal(result.localRevision, house.localRevision);
  assert.equal(result.records.rooms.size, 0); assert.equal(result.records.unplaced.electrical.length, 4); assert.equal(result.records.unplaced.network.length, 1);
  assert(result.records.unplaced.electrical.some(row => row.id === '00000000-0000-4000-8000-000000000903' && row.detail.includes('No wiring survey')));
  assert(result.records.unplaced.electrical.some(row => row.id === '00000000-0000-4000-8000-000000000904'));
  const networkRecord = result.records.unplaced.network[0];
  assert.equal(networkRecord.sourceFacts.find(fact => fact.label === 'Source revision').value, mode === 'complete' ? '9007199254740991' : null);
  assert.equal(result.records.electrical, 'partial'); assert.equal(result.records.network, 'partial');
  assert.equal(result.records.buildings.length, 2);
  assert(result.records.buildings.every(row => row.network === 'unavailable' && row.electrical === 'unavailable' && row.reason === 'no-captured-building-source'));
  const evidence = result.records.unplaced.electrical.find(row => row.id === '00000000-0000-4000-8000-000000000902');
  assert.equal(evidence.sourceDate, '1998-04-05T00:00:00Z'); assert.equal(evidence.retrievedAt, '2024-03-04T00:00:00Z');
  assert(evidence.detail.includes('Historical circuit association unverified'));
  assert(result.records.unplaced.electrical[0].sourceFacts.some(fact => fact.value === '9007199254740991'));
  const graph = result.records.networkGraphs[0].data;
  assert.equal(graph.links.length, 1); assert.equal(graph.links[0].path, null); assert.equal(graph.links[0].sourceConfidence, 'tentative');
  assert.equal(graph.endpoints.filter(row => row.kind === 'unresolved').length, 1); assert.equal(graph.devices.length, 0);
  assert.equal(result.retained.inventory.length, 1); assert.equal(result.retained.documents.length, 1);
  assert.equal(result.records.unplaced.electrical.some(row => row.label.includes('filename')), false);
  assert(reads >= 4); assert(result.reasons.some(reason => reason.includes('record-to-room')));
  if (mode === 'partial') assert(result.reasons.some(reason => reason.includes('source-withheld')));
  console.log(`PASS ${mode}: four unplaced electrical records, one logical relation, exact dates/revisions/uncertainty, retained metadata; snapshot ${result.snapshotId}`);
}
for (const variant of ['historical', 'tuples']) {
  const pack = await generateSavedPack('complete', '1'.repeat(64), variant === 'historical', variant === 'tuples');
  const house = { ...pack.house, localRevision: crypto.randomUUID() };
  const local = { list: async () => [house], asset: async (_selected, id) => {
    const pin = house.resources.find(pin => pin.id === id); return new Blob([pack.resources.get(id)], { type: pin.contentType });
  } };
  const signal = new AbortController().signal, checked = await readSavedPackSections(local, house, signal);
  exporterShapes(checked);
  const savedRead = await createSavedAtlasDataAdapter(local).read(house, signal);
  const historical = await readSavedHistoricalFacts(checked, savedRead, signal);
  const result = projectSavedAtlasOverlays(checked, pack.scene, historical);
  if (variant === 'historical') {
    assert.equal(house.snapshotId, 'ffc87acaee8daf02a5814689cf77bb6be79fe6ac443704ca3881041a468ab8dc', 'original historical UI variant retains its exact snapshot pin');
    assert.equal(historical.facts.length, 1, JSON.stringify(historical.reasons));
    const pin = checked.manifest.resources.find(pin => pin.sha256 === historical.facts[0].pins.sceneOriginalSha256);
    assert.equal(pin.role, 'atlas/original'); assert.equal(pin.record.recordType, 'asset');
    assert.equal(checked.manifest.resources.filter(row => row.sha256 === pin.sha256).length, 1);
    const room = [...result.records.rooms.values()].find(room => room.network.length);
    assert(room); assert.deepEqual(room.network.map(row => row.id), ['device:generated']);
    assert.equal(room.electrical.length, 2);
    assert.equal(result.records.unplaced.electrical.length, 4);
    assert.equal(result.records.unplaced.network.length, 4);
    assert.equal(result.records.networkGraphs.length, 2);
    assert.equal(result.records.buildings.length, 2);
    const houseCoverage = result.records.buildings.find(row => row.label === 'Synthetic house');
    const studioCoverage = result.records.buildings.find(row => row.label === 'Synthetic studio');
    assert.equal(houseCoverage.network, 'partial'); assert.equal(houseCoverage.electrical, 'available');
    assert.equal(studioCoverage.network, 'unavailable'); assert.equal(studioCoverage.electrical, 'unavailable');
    assert.equal(studioCoverage.reason, 'no-captured-building-source');
    assert(!result.records.buildings.some(row => row.label === 'Synthetic boundary wall'));
    assert.equal(result.records.network, 'partial'); assert.equal(result.records.electrical, 'partial');
    assert.equal(result.records.unplaced.network.length + room.network.length, 5);
    assert.equal(result.records.unplaced.electrical.length + room.electrical.length, 6);
    assert(room.network[0].sourceFacts.some(fact => fact.label === 'Retained association' && fact.value === '00000000-0000-4000-8000-000000000012'));
    assert.equal(historical.facts[0].mode, 'saved-documentary-snapshot');
    assert(!('sessionIdentity' in historical.facts[0].pins));
    assert(!('expiresAt' in historical.facts[0].pins));
    console.log(`PASS genuine retained historical closure: one room has 1 network + 2 electrical facts; generic and other source records remain unplaced; snapshot ${house.snapshotId}`);
  } else {
    assert.equal(result.records.unplaced.network.length, 2);
    const graph = result.records.networkGraphs[0].data;
    assert.equal(graph.links.length, 2); assert.equal(new Set(graph.links.map(row => row.id)).size, 2);
    assert.equal(graph.endpoints.length, 4); assert.equal(new Set(graph.endpoints.map(row => row.id)).size, 4);
    console.log('PASS distinct permitted source collection/external/endpoint tuples retain separate records and graph nodes');
  }
}
{
  const pack = await generateSavedPack('partial', '1'.repeat(64), false, false, true);
  const house = { ...pack.house, localRevision: crypto.randomUUID() };
  const local = { list: async () => [house], asset: async (_selected, id) => new Blob([pack.resources.get(id)], { type: house.resources.find(pin => pin.id === id).contentType }) };
  const checked = await readSavedPackSections(local, house, new AbortController().signal); exporterShapes(checked);
  const result = projectSavedAtlasOverlays(checked, pack.scene);
  assert.equal(result.records.network, 'partial'); assert.equal(result.records.unplaced.network.length, 0);
  assert(result.reasons.some(reason => reason.includes('source-withheld')));
  console.log('PASS source-withheld partial coverage remains explicit with zero retained visible relations');
}
{
  const pack = await generateSavedPack('complete', '1'.repeat(64), true, false, false, true);
  const house = { ...pack.house, localRevision: crypto.randomUUID() };
  const local = { list: async () => [house], asset: async (_selected, id) => new Blob([pack.resources.get(id)], { type: house.resources.find(pin => pin.id === id).contentType }) };
  const signal = new AbortController().signal, checked = await readSavedPackSections(local, house, signal); exporterShapes(checked);
  const savedRead = await createSavedAtlasDataAdapter(local).read(house, signal);
  const historical = await readSavedHistoricalFacts(checked, savedRead, signal);
  assert.equal(historical.facts.length, 2, JSON.stringify(historical.reasons));
  for (const facts of [historical.facts, [...historical.facts].reverse()]) {
    const result = projectSavedAtlasOverlays(checked, pack.scene, { ...historical, facts });
    const room = [...result.records.rooms.values()].find(room => room.network.length);
    assert.equal(room.network.length, 1); assert.equal(room.electrical.length, 2);
    assert.equal(result.records.unplaced.network.length, 4); assert.equal(result.records.unplaced.electrical.length, 4);
    for (const record of [...room.network, ...room.electrical]) {
      const observations = [record, ...(record.observations ?? [])];
      const associations = new Set(observations.flatMap(row => row.sourceFacts.filter(fact => fact.label === 'Retained association').map(fact => fact.value)));
      assert.deepEqual([...associations].sort(), ['00000000-0000-4000-8000-000000000012', '00000000-0000-4000-8000-000000000013']);
      assert(observations.some(row => row.sourceFacts.some(fact => fact.label === 'Room association in this observation' && fact.value === null)));
    }
  }
  console.log('PASS shared primary evidence across two captured building associations preserves placed + unplaced provenance in either source order; unique record totals unchanged');
}
// Genuine retained source bytes with a reviewed shared-entity join to two rooms.
// Re-pin every changed resource/section before the actual retained readers run;
// original generator variants and their historical snapshot pins stay unchanged.
for (const reversed of [false, true]) {
  const original = await generateSavedPack('complete', '1'.repeat(64), true, false, false, true);
  const manifest = JSON.parse(new TextDecoder().decode(original.house.manifest)); delete manifest.snapshotId;
  const resources = new Map(original.resources);
  const decode = sha => JSON.parse(new TextDecoder().decode(resources.get(sha)));
  const encode = value => new TextEncoder().encode(canonicalPack(parseLosslessJson(JSON.stringify(value)))).buffer;
  const repin = async (oldSha, value) => {
    const bytes = encode(value), sha = await savedDigest(bytes), descriptor = manifest.resources.find(row => row.sha256 === oldSha);
    descriptor.sha256 = sha; descriptor.bytes = bytes.byteLength; resources.delete(oldSha); resources.set(sha, bytes);
    return { resourceSha256: sha, bytes: bytes.byteLength, contentType: descriptor.contentType };
  };
  const atlas = decode(manifest.sections.atlas.resourceSha256), modelSection = decode(manifest.sections.model.resourceSha256);
  const links = decode(modelSection.unifiedAtlas.roomLinks.resourceSha256), firstLink = links.links[0];
  const firstRoom = original.scene.rooms.find(room => room.roomId === firstLink.roomId);
  const secondRoom = original.scene.rooms.find(room => room.buildingId === firstRoom.buildingId && room.nativePlaceId !== null
    && room.nativePlaceId !== firstRoom.nativePlaceId && room.occurrenceIds.length > 0);
  assert(secondRoom);
  links.links.push({ ...firstLink, roomId: secondRoom.roomId, nativePlaceId: secondRoom.nativePlaceId });
  const ownBuilding = original.scene.buildings.find(row => row.buildingId === firstRoom.buildingId);
  const association = atlas.records.find(row => row.recordType === 'scene-association' && row.payload.buildingId === ownBuilding.nativePlaceId);
  association.payload.roomMappings[0].targets.push({ ...association.payload.roomMappings[0].targets[0], atlasPlaceId: secondRoom.nativePlaceId });
  // A source-owned raw ID can be reused by another category and by a generic
  // native source. Identity still consists of the complete opaque record key.
  const primarySha = association.payload.sourceDocuments.find(row => row.role === 'primary-scene').originalSha256;
  const primary = decode(primarySha), reusedId = '00000000-0000-4000-8000-000000000901';
  primary.electricity.documentarySource.records[0].document_id = reusedId;
  primary.electricalFixtures.documentaryFixtures.fixtures[0].id = reusedId;
  primary.electricalFixtures.documentaryFixtures.groups[0].fixtureIds = [reusedId];
  if (reversed) {
    links.links.reverse(); association.payload.roomMappings[0].targets.reverse();
    primary.network.devices.reverse(); primary.network.endpoints.reverse(); primary.network.links.reverse();
  }
  const primaryPin = await repin(primarySha, primary);
  for (const row of atlas.records) {
    if (row.recordType === 'asset' && row.payload.sha256 === primarySha) { row.payload.sha256 = primaryPin.resourceSha256; row.payload.byteSize = primaryPin.bytes; }
    if (row.recordType === 'scene-association') for (const pin of row.payload.sourceDocuments)
      if (pin.originalSha256 === primarySha) pin.originalSha256 = primaryPin.resourceSha256;
  }
  if (reversed) { atlas.records.reverse(); atlas.revisions.reverse(); }
  modelSection.unifiedAtlas.roomLinks = await repin(modelSection.unifiedAtlas.roomLinks.resourceSha256, links);
  manifest.sections.atlas.resourceSha256 = (await repin(manifest.sections.atlas.resourceSha256, atlas)).resourceSha256;
  manifest.sections.model.resourceSha256 = (await repin(manifest.sections.model.resourceSha256, modelSection)).resourceSha256;
  manifest.totals = { bytes: manifest.resources.reduce((sum, row) => sum + row.bytes, 0), resources: manifest.resources.length };
  const snapshotId = await savedDigest(encode(manifest));
  const admitted = await readPackManifest(encode({ ...manifest, snapshotId }), original.house.scope, true);
  const house = { ...original.house, localRevision: crypto.randomUUID(), snapshotId, manifest: admitted.localBytes, resources: admitted.resources };
  const local = { list: async () => [house], asset: async (selected, id) => {
    assert.equal(selected.localRevision, house.localRevision);
    return new Blob([resources.get(id)], { type: house.resources.find(pin => pin.id === id).contentType });
  } };
  const signal = new AbortController().signal, checked = await readSavedPackSections(local, house, signal); exporterShapes(checked);
  const read = await createSavedAtlasDataAdapter(local).read(house, signal);
  const scene = reversed ? { ...read.scene, rooms: [...read.scene.rooms].reverse() } : read.scene;
  const historical = await readSavedHistoricalFacts(checked, { ...read, scene }, signal);
  assert.equal(historical.facts.length, 2, JSON.stringify(historical.reasons));
  const joined = historical.facts.find(facts => facts.roomBindings.length === 2);
  assert(joined, 'the genuine retained association has both captured room bindings');
  const selectable = new Set(scene.coverage.selectable);
  const expected = projectDocumentaryFacts(scene, joined, selectable);
  const result = projectSavedAtlasOverlays(checked, scene, historical, selectable);
  assert.equal(result.records.rooms.size, 2);
  for (const [roomId, local] of expected.rooms) for (const kind of ['network', 'electrical']) {
    const actual = result.records.rooms.get(roomId)[kind];
    assert.equal(actual.length, local[kind].length);
    for (const own of local[kind]) {
      const record = actual.find(record => record.key === own.key), { observations, ...primary } = record;
      assert.deepEqual(primary, own, 'whole room-local dates, connections, source facts and association remain primary');
      assert.equal(record.sourceFacts.find(fact => fact.label === 'Room association in this observation').value, roomId);
      const all = [primary, ...observations];
      const associations = new Set(all.flatMap(row => row.sourceFacts.filter(fact => fact.label === 'Retained association').map(fact => fact.value)));
      assert.deepEqual([...associations].sort(), ['00000000-0000-4000-8000-000000000012', '00000000-0000-4000-8000-000000000013']);
      const rooms = new Set(all.flatMap(row => row.sourceFacts.filter(fact => fact.label === 'Room association in this observation').map(fact => fact.value)));
      assert.deepEqual(rooms, new Set([firstRoom.roomId, secondRoom.roomId, null]), 'unplaced observation stays retained beside both room observations');
    }
  }
  for (const [kind, total, unplaced] of [['electrical', 6, 4], ['network', 5, 4]]) {
    const keys = new Set([...result.records.rooms.values()].flatMap(room => room[kind].map(record => record.key))
      .concat(result.records.unplaced[kind].map(record => record.key)));
    assert.equal(keys.size, total); assert.equal(result.records.unplaced[kind].length, unplaced);
  }
  const sameRawId = [...result.records.rooms.values()].flatMap(room => room.electrical).concat(result.records.unplaced.electrical).filter(record => record.id === reusedId);
  assert.equal(new Set(sameRawId.map(record => record.key)).size, 3, 'generic source, historical sheet and symbol keep distinct identities despite raw ID reuse');
  assert.equal(result.records.networkGraphs.length, 2);
  console.log(`PASS shared retained entity in two rooms (${reversed ? 'reversed' : 'original'} room/map/association/source order): full local primary, all placed/unplaced observations, Electrical6/Network5 unique entities and unplaced4/4`);
}
{
  const pack = await generateSavedPack('complete', '1'.repeat(64), true, false, false, false, true);
  const house = { ...pack.house, localRevision: crypto.randomUUID() };
  const local = { list: async () => [house], asset: async (_selected, id) => new Blob([pack.resources.get(id)], { type: house.resources.find(pin => pin.id === id).contentType }) };
  const signal = new AbortController().signal, checked = await readSavedPackSections(local, house, signal); exporterShapes(checked);
  const savedRead = await createSavedAtlasDataAdapter(local).read(house, signal);
  const historical = await readSavedHistoricalFacts(checked, savedRead, signal);
  assert.equal(historical.facts.length, 1, JSON.stringify(historical.reasons));
  assert.equal(historical.facts[0].roomBindings.length, 0);
  const result = projectSavedAtlasOverlays(checked, pack.scene, historical);
  assert.equal(result.records.rooms.size, 0);
  assert.equal(result.records.unplaced.network.length, 5); assert.equal(result.records.unplaced.electrical.length, 6);
  assert.equal(result.records.networkGraphs.length, 2);
  assert.equal(result.records.buildings.length, pack.scene.buildings.filter(building => building.levelIds.length > 0).length);
  assert.equal(result.records.network, 'partial'); assert.equal(result.records.electrical, 'partial');
  assert(result.records.buildings.every(row => row.network === 'unavailable' && row.electrical === 'unavailable'));
  assert(result.reasons.some(reason => reason.includes('not mapped in this model')));
  console.log('PASS verified source closure for an unmapped native building retains every known fact unplaced without adding or borrowing a model building');
}
{
  const pack = await generateSavedPack('partial', '1'.repeat(64), true);
  const house = { ...pack.house, localRevision: crypto.randomUUID() };
  const local = { list: async () => [house], asset: async (_selected, id) => new Blob([pack.resources.get(id)], { type: house.resources.find(pin => pin.id === id).contentType }) };
  const signal = new AbortController().signal, checked = await readSavedPackSections(local, house, signal); exporterShapes(checked);
  const read = await createSavedAtlasDataAdapter(local).read(house, signal), historical = await readSavedHistoricalFacts(checked, read, signal);
  const result = projectSavedAtlasOverlays(checked, pack.scene, historical);
  const qualified = result.records.buildings.find(row => row.label === 'Synthetic house');
  const other = result.records.buildings.find(row => row.label === 'Synthetic studio');
  assert.deepEqual([qualified.electrical, qualified.network], ['available', 'partial']);
  assert.deepEqual([other.electrical, other.network], ['unavailable', 'unavailable']);
  assert.equal(result.records.buildings.length, 2); assert.equal(result.state, 'partial');
  const room = [...result.records.rooms.values()].find(row => row.network.length);
  assert.deepEqual([room.electrical.length + result.records.unplaced.electrical.length, room.network.length + result.records.unplaced.network.length], [6, 5]);
  assert.deepEqual([result.records.unplaced.electrical.length, result.records.unplaced.network.length], [4, 4]);
  assert(result.reasons.some(reason => reason.includes('source-withheld')));
  assert(room.electrical.every(record => record.sourceFacts.some(fact => fact.label === 'Retained association')));
  console.log('PASS partial global records + one qualified house preserve 6 Electrical/5 Network, unplaced 4/4 and provenance; unrelated studio unavailable, context-only boundary omitted');
}
const observation = { key: 'same-source-record', id: 'id', label: 'first', category: 'Recorded circuit', detail: '', qualification: '', sourceDate: null, retrievedAt: null, connections: [], sourceFacts: [] };
const merged = mergeDocumentaryRecords([observation, { ...observation, label: 'second' }, observation]);
assert.equal(merged.length, 1); assert.equal(merged[0].observations.length, 1);
console.log('PASS canonical source identity dedup retains differing observations; no native authority or placement fabricated');

{
  const baseline = await generateSavedPack('complete', '1'.repeat(64), true);
  const pack = await generateSavedPack('complete', '1'.repeat(64), true, false, false, false, false, true);
  const house = { ...pack.house, localRevision: crypto.randomUUID() };
  const local = { list: async () => [house], asset: async (_selected, id) => new Blob([pack.resources.get(id)], { type: house.resources.find(pin => pin.id === id).contentType }) };
  const signal = new AbortController().signal, checked = await readSavedPackSections(local, house, signal); exporterShapes(checked);
  const savedRead = await createSavedAtlasDataAdapter(local).read(house, signal);
  const historical = await readSavedHistoricalFacts(checked, savedRead, signal);
  assert.equal(historical.facts.length, 1, JSON.stringify(historical.reasons));
  const model = bindAtlasModel(savedRead.scene, await loadStandardGlb(savedRead.model, 'saved-final-interaction', signal));
  const levels = model.levelsByBuilding.get('syn-building-house');
  assert.equal(levels[0].levelId, 'syn-level-featureless');
  assert.equal(levels[0].nativePlaceId, null); assert.equal(levels[0].sourceElevationM, null);
  assert.deepEqual(levels[0].occurrenceIds, []); assert(model.plansByLevel.has(levels[0].levelId));
  assert.deepEqual(planFeaturesForLevel(model, levels[0].levelId), []);
  assert(levels.slice(1).some(level => planFeaturesForLevel(model, level.levelId).length > 0));
  assert.equal(sitePlanLevels(model)[0], 'syn-level-ground', 'composed property Plan skips the valid featureless first candidate');
  assert.equal(savedRead.scene.publication.publicationId, '00000000-0000-4000-8000-0000000a7152');
  assert.equal(savedRead.scene.selection.revision, 'generated-final-interaction-1');
  assert.notEqual(savedRead.scene.publication.semanticsSha256, baseline.scene.publication.semanticsSha256);
  assert.equal(savedRead.saved.descriptor.original.sha256, baseline.scene.artifacts[0].sha256);
  assert.equal(savedRead.model.byteLength, baseline.scene.artifacts[0].bytes);
  assert.deepEqual(savedRead.scene.occurrences, baseline.scene.occurrences);
  assert.deepEqual(savedRead.scene.meshBindings, baseline.scene.meshBindings);
  assert.deepEqual(pack.scene.coverage, baseline.scene.coverage);
  assert(savedRead.scene.overlayBindings.every(row => row.publicationId === savedRead.scene.publication.publicationId));
  assert.equal(savedRead.roomLinks.data.publicationId, savedRead.scene.publication.publicationId);
  assert.equal(savedRead.roomLinks.data.semanticsSha256, savedRead.scene.publication.semanticsSha256);
  const stairs = savedRead.scene.rooms.find(row => row.label === 'Stairs');
  assert.deepEqual(stairs.occurrenceIds, ['syn-occ-stairs-ground', 'syn-occ-stairs-upper']);
  const result = projectSavedAtlasOverlays(checked, savedRead.scene, historical);
  const room = [...result.records.rooms.values()].find(row => row.network.length);
  assert.equal(room.network.length, 1); assert.equal(room.electrical.length, 2);
  assert.equal(result.records.unplaced.network.length, 6); assert.equal(result.records.unplaced.electrical.length, 4);
  assert.equal(result.records.networkGraphs.length, 2);
  const graph = result.records.networkGraphs.find(row => row.data.source.label === 'Saved network relations').data;
  assert.equal(graph.links.length, 3); assert.equal(graph.endpoints.length, 2);
  const loops = graph.links.filter(row => row.fromEndpointId === row.toEndpointId);
  assert.equal(loops.length, 2); assert.equal(new Set(loops.map(row => row.id)).size, 2);
  assert.equal(new Set(loops.map(row => row.fromEndpointId)).size, 1);
  assert.equal(graph.endpoints.filter(row => row.id === loops[0].fromEndpointId).length, 1);
  for (const name of ['Amber', 'Indigo']) {
    const record = result.records.unplaced.network.find(row => row.id === `generated-self-loop-${name.toLowerCase()}`);
    assert(record.detail.includes(`Generated ${name} self-loop`));
    assert(loops.some(row => row.notes.includes(`Generated ${name} self-loop`) && row.path === null));
  }
  console.log(`PASS final interaction variant: valid first featureless floor, unchanged GLB/room memberships, genuine historical closure, 2 distinct shared-endpoint self-loops; Electrical 6 (4 unplaced), Network 7 (6 unplaced); snapshot ${house.snapshotId}; semantics ${savedRead.scene.publication.semanticsSha256}`);
}
