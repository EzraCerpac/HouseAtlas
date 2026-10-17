// Named positive consumer/data-adapter check. Supplied generated exporter
// fixtures and an in-memory local-resource owner only: no network, listener,
// credentials, IndexedDB, renderer, browser, native authority or deployment.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { transformWithOxc } from 'vite';

assert.equal(process.version, 'v26.10.0');
assert.equal(process.argv.length, 3, 'Pass the extracted positive handoff directory');
const fixtureRoot = resolve(process.argv[2]);
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const buffer = bytes => Uint8Array.from(bytes).buffer;
async function source(relative, replacements = {}) {
  const file = new URL(relative, import.meta.url);
  let { code } = await transformWithOxc(readFileSync(file, 'utf8'), file.pathname,
    { lang: 'ts', target: 'esnext', tsconfig: false, sourcemap: false });
  for (const [specifier, url] of Object.entries(replacements)) {
    assert(code.includes(JSON.stringify(specifier)), `Missing import ${specifier}`);
    code = code.replaceAll(JSON.stringify(specifier), JSON.stringify(url));
  }
  for (const match of code.matchAll(/^\s*import\s+(?:[\w$\s{},*]+?\s+from\s+)?["']([^"']+)["']/gm))
    assert(match[1].startsWith('data:'), `Unexpected import ${match[1]}`);
  return `data:text/javascript;base64,${Buffer.from(code).toString('base64')}`;
}
const decimal = await source('../src/numeric/decimal.ts');
const lossless = await source('../src/numeric/lossless-json.ts', { './decimal': decimal });
const storage = await source('../src/offline/store.ts');
const manifestURL = await source('../src/offline/manifest.ts', { '../numeric/decimal': decimal,
  '../numeric/lossless-json': lossless, './store': storage });
const geometry = await source('../src/lantern/canonical-ifc/geometry.ts');
const types = await source('../src/lantern/unified-atlas/types.ts');
const sceneURL = await source('../src/lantern/unified-atlas/scene.ts', { '../canonical-ifc/geometry': geometry, './types': types });
const modelURL = await source('../src/offline/model-v2.ts', { '../numeric/decimal': decimal,
  '../numeric/lossless-json': lossless, '../lantern/unified-atlas/scene': sceneURL, './manifest': manifestURL });
const adapterURL = await source('../src/offline/saved-atlas-port.ts', { './manifest': manifestURL, './model-v2': modelURL, './store': storage });
const { readPackManifest, canonicalPack } = await import(manifestURL);
const { parseLosslessJson, JSON_LIMITS } = await import(lossless);
const { savedHouseKey, savedDigest, validateSavedHouse } = await import(storage);
const { readSavedAtlasModel, SAVED_ATLAS_LIMITS } = await import(modelURL);
const { createSavedAtlasDataAdapter } = await import(adapterURL);
assert.equal(JSON_LIMITS.textBytes, 8 * 1024 * 1024);
assert.deepEqual(SAVED_ATLAS_LIMITS, { companion: 12 * 1024 * 1024, model: 32 * 1024 * 1024, roomLinks: 1024 * 1024, links: 2048 });
const qualification = JSON.parse(readFileSync(`${fixtureRoot}/QUALIFICATION.json`));
assert.equal(qualification.head, '052a9ef8537354e789f4e69255a0d84ef6b1c0a7');
const expectedManifestPins = {
  records: 'de82fe13d91ba79cc195deb2e9b8c871bd200455d9e0062633c4b41ddf1f6f03',
  partial: 'b78f542a2070f91f34b8e273907e9d411b1eb6e932946bf56bbd2d553be7ff2b',
  unified: '53de1b25f27284acc343f450c8ff649317d105973a32b113d11f1631ce2c38ba',
  documents: '3c5d89cadeb51ff21c87134ca5164b2824aa954d2dde3af985f77e4bc53db297',
};
function memoryOwner(house, resources) {
  const reads = []; let checks = 0;
  return { reads, checks: () => checks, list: async () => { checks++; return [structuredClone(house)]; },
    asset: async (selected, id) => {
      assert.equal(selected.key, house.key); assert.equal(selected.localRevision, house.localRevision);
      assert.equal(selected.snapshotId, house.snapshotId);
      const resource = house.resources.find(item => item.id === id); assert(resource);
      reads.push(id); return new Blob([resources.get(resource.sha256)], { type: resource.contentType });
    } };
}
function houseFor(manifest) {
  return { version: 1, localRevision: randomUUID(), key: savedHouseKey(manifest.scope), scope: manifest.scope,
    snapshotId: manifest.snapshotId, capturedAt: manifest.capturedAt, label: 'Generated saved house', shellBuildId: '0'.repeat(64),
    manifest: manifest.localBytes, resources: manifest.resources };
}
let resourceCount = 0, reads = 0;
for (const name of ['records', 'partial', 'unified', 'documents']) {
  const directory = `${fixtureRoot}/fixtures/${name}`, raw = readFileSync(`${directory}/manifest.json`);
  assert.equal(hash(raw), expectedManifestPins[name]);
  const offered = JSON.parse(raw), manifest = await readPackManifest(buffer(raw), offered.scope);
  const local = await readPackManifest(manifest.localBytes, offered.scope, true);
  assert.equal(local.snapshotId, offered.snapshotId); assert.equal(local.completeness, offered.completeness);
  assert.equal(local.resources.length, offered.resources.length); assert.equal(local.totalBytes, offered.totals.bytes);
  const resources = new Map();
  for (const resource of local.resources) {
    const bytes = readFileSync(`${directory}/${resource.sha256}`);
    assert.equal(bytes.length, resource.bytes); assert.equal(hash(bytes), resource.sha256);
    resources.set(resource.sha256, buffer(bytes)); resourceCount++;
    const record = offered.resources.find(item => item.sha256 === resource.sha256).record;
    assert.equal(resource.record?.recordId ?? null, record?.recordId ?? null);
  }
  const house = houseFor(local); validateSavedHouse(house);
  const owner = memoryOwner(house, resources), adapter = createSavedAtlasDataAdapter(owner);
  // Fresh adapter opens, rechecking the same active local revision each time.
  for (let repeat = 0; repeat < 2; repeat++) {
    const result = await adapter.read(house, new AbortController().signal);
    if (name === 'records' || name === 'partial') { assert.equal(result, null); continue; }
    assert(result); const selected = result.saved.descriptor.unified;
    assert.equal(result.saved.snapshotId, offered.snapshotId); assert.equal(result.saved.completeness, offered.completeness);
    assert.equal(result.saved.modelState, offered.sections.model.state);
    assert.equal(result.scene.scope.workspaceId, house.scope.workspaceId); assert.equal(result.scene.scope.homeId, house.scope.homeId);
    assert.equal(result.scene.selection.revision, selected.selectionRevision);
    assert.equal(result.scene.publication.publicationId, result.saved.descriptor.publicationId);
    assert.equal(result.scene.publication.semanticsSha256, selected.semanticsSha256);
    assert.equal(result.saved.descriptor.overviewManifestSha256, '5b88fd2484aefcc0efcf1270080d65e9fd8351523ed8fd67a448bae9156caecb');
    assert.equal(result.companion.byteLength, 8388625); assert(result.companion.byteLength > JSON_LIMITS.textBytes);
    assert.deepEqual(Buffer.from(result.companion), Buffer.from(resources.get(selected.companion.sha256)));
    assert.equal(await savedDigest(result.companion), selected.semanticsSha256);
    assert.equal(hash(result.model), result.scene.model.sha256);
    assert.deepEqual(Buffer.from(result.model), Buffer.from(resources.get(result.scene.model.sha256)));
    const original = JSON.parse(Buffer.from(result.companion));
    assert.deepEqual(result.scene.plans, original.plans); assert.deepEqual(result.scene.overlayBindings, original.overlayBindings);
    assert.deepEqual(result.scene.occurrences, original.occurrences); assert.deepEqual(result.scene.rooms, original.rooms);
    assert.equal(result.scene.publication.sourceSha256, original.sourceSha256);
    assert.equal(result.scene.publication.sourceRevisionId, original.sourceRevisionId);
    assert.deepEqual(Buffer.from(result.roomLinks.bytes), Buffer.from(resources.get(selected.roomLinks.sha256)));
    assert.deepEqual(result.roomLinks.data, JSON.parse(Buffer.from(result.roomLinks.bytes)));
    assert(!('expiresAt' in result.saved)); assert(!('checkedAt' in result.roomLinks));
    assert.equal(result.scene.model.href, `saved-resource:${result.scene.model.sha256}`);
  }
  // Exact supplied roots also decode independently of the adapter.
  if (local.sections.model.resourceSha256) {
    const root = resources.get(local.sections.model.resourceSha256), descriptor = readSavedAtlasModel(root, local);
    if (name === 'partial') assert.equal(descriptor.unified, null);
    if (name === 'unified') {
      // Valid documentary metadata can use an earlier canonical descriptor for
      // identical bytes, without claiming its role/record as exclusive identity.
      const shared = { ...local, resources: local.resources.map(resource => resource.sha256 === descriptor.unified.companion.sha256
        ? { ...resource, role: 'documents/original', record: { recordType: 'document', recordId: 'generated-shared', revision: '9007199254740993' } } : resource) };
      assert.equal(readSavedAtlasModel(root, shared).unified.companion.record.revision, '9007199254740993');
      // An explicitly unconfigured optional map is a valid nullable field.
      const noMap = parseLosslessJson(Buffer.from(root).toString('utf8')); noMap.unifiedAtlas.roomLinks = null;
      const partialMap = { ...local, completeness: 'partial', sections: { ...local.sections,
        model: { ...local.sections.model, state: 'partial', requiredBytesComplete: false } },
        exclusions: [{ section: 'model', code: 'room-map-unavailable', label: 'No independently qualified room map is included' }] };
      assert.equal(readSavedAtlasModel(buffer(Buffer.from(canonicalPack(noMap))), partialMap).unified.roomLinks, null);
      // Build a coherent generated partial capture for the absent-map adapter
      // positive: every listed byte remains present and every digest is valid.
      const rootBytes = buffer(Buffer.from(canonicalPack(noMap))), rootPin = hash(Buffer.from(rootBytes));
      const partialValue = parseLosslessJson(Buffer.from(local.localBytes).toString('utf8'));
      const integer = value => parseLosslessJson(String(value));
      partialValue.completeness = 'partial'; partialValue.sections.model.state = 'partial';
      partialValue.sections.model.requiredBytesComplete = false; partialValue.sections.model.resourceSha256 = rootPin;
      partialValue.exclusions = partialMap.exclusions;
      partialValue.resources = partialValue.resources.filter(item => item.sha256 !== descriptor.unified.roomLinks.sha256)
        .map(item => item.sha256 === local.sections.model.resourceSha256
          ? { ...item, sha256: rootPin, bytes: integer(rootBytes.byteLength) } : item);
      partialValue.totals.resources = integer(partialValue.resources.length);
      partialValue.totals.bytes = integer(partialValue.resources.reduce((sum, item) => sum + item.bytes.toSafeInteger(), 0));
      const { snapshotId: _oldId, ...withoutId } = partialValue;
      partialValue.snapshotId = hash(Buffer.from(canonicalPack(withoutId)));
      const partialLocal = await readPackManifest(buffer(Buffer.from(canonicalPack(partialValue))), local.scope, true);
      const partialResources = new Map(resources); partialResources.set(rootPin, rootBytes);
      const partialHouse = houseFor(partialLocal), partialOwner = memoryOwner(partialHouse, partialResources);
      const partialRead = await createSavedAtlasDataAdapter(partialOwner).read(partialHouse, new AbortController().signal);
      assert(partialRead); assert.equal(partialRead.roomLinks, null); assert.equal(partialRead.saved.completeness, 'partial');
      assert.equal(partialRead.saved.modelState, 'partial'); assert.deepEqual(partialRead.saved.exclusions, partialMap.exclusions);
      reads += partialOwner.reads.length;
      // A valid unavailable-original capture is documentary metadata only.
      const unavailable = parseLosslessJson(Buffer.from(root).toString('utf8'));
      unavailable.overview.original.resourceSha256 = null; unavailable.unifiedAtlas = null;
      const unavailableModel = readSavedAtlasModel(buffer(Buffer.from(canonicalPack(unavailable))), {
        ...partialMap, exclusions: [{ section: 'model', code: 'selected-model-unavailable', label: 'The selected complete GLB cannot be included' }] });
      assert.equal(unavailableModel.original, null); assert.equal(unavailableModel.unified, null);
      // Existing native overview labels count Unicode code points, including
      // supplementary characters at the accepted 128-character bound.
      const unicode = parseLosslessJson(Buffer.from(root).toString('utf8'));
      unicode.overview.label = '🧭'.repeat(128); unicode.overview.components[0].label = '🧭'.repeat(128);
      assert.equal(readSavedAtlasModel(buffer(Buffer.from(canonicalPack(unicode))), local).publicationId, descriptor.publicationId);
    }
  }
  assert(owner.checks() > owner.reads.length * 2); reads += owner.reads.length;
  console.log(`PASS ${name}: ${local.resources.length} exact resources; ${local.completeness}; ${owner.reads.length} local reads across two opens`);
}
console.log(`PASS consumer model v2: ${resourceCount} supplied resources; ${reads} revision-checked local reads; data adapter only`);
