/** Generated data only. The fake store has no external transport or persistence. */
import { ExactDecimal } from '../src/numeric/decimal';
import { stringifyLosslessJson, type JsonForSerialization } from '../src/numeric/lossless-json';
import { canonicalPack, PACK_LIMITS, readPackManifest } from '../src/offline/manifest';
import { parseLosslessJson } from '../src/numeric/lossless-json';
import { savedDigest, savedHouseKey, type SavedHouse } from '../src/offline/store';
export { createSavedCatalogAdapter } from '../src/offline/saved-catalog';
export { readSavedPackSections } from '../src/offline/saved-pack-sections';
export { canonicalPack, parseLosslessJson };
export const CATALOG_SCOPE = { workspaceId: '00000000-0000-4000-8000-000000000101', homeId: '00000000-0000-4000-8000-000000000102' };
export const CAPTURED_AT = '2026-10-20T09:10:11Z';
export const MAX_REVISION = '9007199254740991';
export const LARGE_QUANTITY = '9007199254740993';
const uuid = (suffix: string) => `00000000-0000-4000-8000-${suffix.padStart(12, '0')}`;
const encode = (value: JsonForSerialization) => new TextEncoder().encode(canonicalPack(parseLosslessJson(stringifyLosslessJson(value)))).buffer;
export async function generateCatalogFixture(mode: 'complete' | 'partial' = 'complete') {
  const resources = new Map<string, ArrayBuffer>();
  const descriptors: JsonForSerialization[] = [];
  const add = async (bytes: ArrayBuffer, contentType: string, section: string, role = 'section', record: JsonForSerialization = null) => {
    const sha256 = await savedDigest(bytes);
    if (!resources.has(sha256)) {
      resources.set(sha256, bytes);
      descriptors.push({ sha256, bytes: bytes.byteLength, contentType, section, role, record });
    }
    return sha256;
  };
  const docIds = [uuid('201'), uuid('202')];
  const assetIds = [uuid('211'), uuid('212')];
  const originalBytes = new TextEncoder().encode(' \r\n{"note":"é🙂","nul":"\\u0000","revision":9007199254740993}\r\n').buffer;
  const originalSha = await add(originalBytes, 'application/json', 'documents', 'original', { recordType: 'geodata-document', recordId: docIds[0]!, revision: ExactDecimal.parse(MAX_REVISION) });
  // Both documents deliberately share the canonical first descriptor from doc 1.
  const documents = docIds.map((recordId, index) => ({ schemaVersion: 2, recordType: 'geodata-document', recordId, ...CATALOG_SCOPE,
    revision: ExactDecimal.parse(index === 0 ? MAX_REVISION : '9007199254740990'), lifecycle: 'active',
    createdAt: '1998-04-05T00:00:00Z', updatedAt: '2024-03-04T05:06:07Z', lastAuditId: uuid('220'),
    payload: { profile: 'houseatlas.geodata-document.v2', title: index === 0 ? 'Original drawing — captured copy' : 'Shared original in another record',
      original: { assetId: assetIds[index]!, revision: ExactDecimal.parse(MAX_REVISION), sha256: originalSha, bytes: originalBytes.byteLength },
      provenance: { agency: 'Generated agency', url: null, license: { status: 'unknown', reference: null }, retrievedAt: '2024-03-04T05:06:07Z',
        custodyReceiptSha256: '2'.repeat(64), published: { value: '1998', precision: 'year' }, observed: null,
        frame: { crs: null, axes: [], linearUnit: null, extent: null } }, preview: null } }));
  const originals = documents.map((doc, index) => ({ documentId: doc.recordId, documentRevision: doc.revision, assetId: assetIds[index]!,
    resourceSha256: mode === 'partial' && index === 1 ? null : originalSha,
    availability: mode === 'partial' && index === 1 ? 'unavailable' : 'available' }));
  const documentExclusions = mode === 'partial' ? [{ section: 'documents', code: 'retained-bytes-unavailable', label: 'A permitted Document byte resource is unavailable' }] : [];
  const inventoryExclusions = mode === 'partial' ? [
    { section: 'inventory', code: 'source-withheld', label: 'Captured source partition withheld' },
    { section: 'inventory', code: 'external-attachments-unarchived', label: 'HomeBox attachment bytes are not included by the retained projection API' },
  ] : [];
  const source = { sourceInstanceId: uuid('301'), collectionId: 'catalog/generated', sourceKind: 'homebox-entity', externalId: uuid('302') };
  const caches = [{ schemaVersion: 1, ...CATALOG_SCOPE, sourceInstanceId: source.sourceInstanceId, collectionId: source.collectionId,
    status: mode === 'partial' ? 'stale' : 'fresh', lastSuccessfulFetchAt: '2024-03-04T05:06:07Z', lastAttemptAt: '2026-10-19T05:06:07Z',
    generationId: uuid('303'), consistency: 'non-transactional-offset-pages', error: null }];
  const sources = [{ ...CATALOG_SCOPE, sourceInstanceId: source.sourceInstanceId, collectionId: source.collectionId, owner: 'homebox', partitionMode: 'exclusive-home', allowedExternalIds: [] }];
  const entities = [false, true].map((archived, index) => ({ schemaVersion: 1, ...CATALOG_SCOPE,
    source: { ...source, collectionId: index === 0 ? source.collectionId : 'catalog/other' }, sourceUpdatedAt: index === 0 ? '2011-02-03T00:00:00Z' : null,
    retrievedAt: '2024-03-04T05:06:07Z', entity: { id: source.externalId, name: index === 0 ? 'Storage cage' : 'Archived unknown type', description: 'Original inventory description',
      entityType: index === 0 ? { id: uuid('304'), name: 'Movable cage', isLocation: false } : null, parent: null, archived,
      quantity: ExactDecimal.parse(LARGE_QUANTITY), manufacturer: null, modelNumber: null, serialNumber: null, notes: null },
    attachments: mode === 'partial' && index === 0 ? [{ attachmentId: uuid('305'), kind: 'external-link', title: 'Unarchived original reference', url: 'https://example.invalid/reference', archived: false }] : [],
    maintenance: [{ entryId: uuid('306'), name: 'Captured check', description: 'Status remains unknown', scheduledDate: '2020-02-03', completedDate: null, cost: ExactDecimal.parse('1.234567890123456789') }],
    nativeLinks: [{ kind: 'homebox-native', intent: 'view', entity: { ...CATALOG_SCOPE, key: { ...source, collectionId: index === 0 ? source.collectionId : 'catalog/other' } }, href: 'https://example.invalid/homebox/generated', verifiedRoute: true }] }));
  const pins = {
    home: await add(encode({ profile: 'houseatlas.home-read-pack.home.v1', scope: CATALOG_SCOPE, label: 'Generated catalog home', selection: { ...CATALOG_SCOPE, buildingId: null, floorId: null, roomId: null } }), 'application/json', 'home'),
    inventory: await add(encode({ entities, sources, caches }), 'application/json', 'inventory'),
    documents: await add(encode({ profile: 'houseatlas.home-read-pack.documents.v1', documents, originals, previews: [], exclusions: documentExclusions }), 'application/json', 'documents'),
  };
  const section = (resourceSha256: string, complete: boolean) => ({ state: complete ? 'complete' : 'partial', resourceSha256, requiredBytesComplete: complete });
  const notConfigured = { state: 'not-configured', resourceSha256: null, requiredBytesComplete: false };
  const manifest = { profile: 'houseatlas.home-read-pack.v1', scope: CATALOG_SCOPE, capturedAt: CAPTURED_AT, completeness: mode,
    limits: PACK_LIMITS, totals: { bytes: [...resources.values()].reduce((sum, bytes) => sum + bytes.byteLength, 0), resources: resources.size },
    sections: { home: section(pins.home, true), inventory: section(pins.inventory, mode === 'complete'), documents: section(pins.documents, mode === 'complete'), atlas: notConfigured, network: notConfigured, model: notConfigured },
    resources: descriptors, exclusions: [...inventoryExclusions, ...documentExclusions] };
  const snapshotId = await savedDigest(encode(manifest));
  const local = await readPackManifest(encode({ ...manifest, snapshotId }), CATALOG_SCOPE, true);
  const house: SavedHouse = { version: 1, key: savedHouseKey(CATALOG_SCOPE), localRevision: uuid('401'), snapshotId,
    scope: CATALOG_SCOPE, label: 'Generated catalog home', capturedAt: CAPTURED_AT, shellBuildId: '1'.repeat(64), resources: local.resources, manifest: local.localBytes };
  return { house, resources, originalBytes, originalSha, docIds, assetIds, documents, entities, pins };
}
export function createCatalogFakeStore(fixture: Awaited<ReturnType<typeof generateCatalogFixture>>) {
  let active: SavedHouse | null = fixture.house;
  let mode: 'normal' | 'missing' | 'corrupt' | 'mime' | 'size' = 'normal';
  let listPause: Promise<void> | null = null;
  let assetPause: null | { id: string; promise: Promise<void> } = null;
  const calls: string[] = [];
  return {
    calls,
    replace(house: SavedHouse | null) { active = house; },
    originalMode(value: typeof mode) { mode = value; },
    pauseList() {
      let release!: () => void;
      listPause = new Promise<void>(resolve => { release = resolve; });
      return () => { listPause = null; release(); };
    },
    pauseAsset(id: string) {
      let release!: () => void;
      const promise = new Promise<void>(resolve => { release = resolve; });
      assetPause = { id, promise };
      return () => { assetPause = null; release(); };
    },
    port: {
      async list() { calls.push('list'); if (listPause) await listPause; return active === null ? [] : [active]; },
      async asset(house: SavedHouse, id: string) {
        calls.push(`asset:${id}`);
        if (assetPause?.id === id) await assetPause.promise;
        const resource = house.resources.find(row => row.id === id);
        if (!resource) throw new Error('Generated unknown resource');
        const retained = fixture.resources.get(id);
        if (!retained) throw new Error('Generated unavailable resource');
        if (id === fixture.originalSha && mode === 'missing') throw new Error('Generated missing original');
        let bytes = retained.slice(0), contentType = resource.contentType;
        if (id === fixture.originalSha && mode === 'corrupt') new Uint8Array(bytes)[0] = new Uint8Array(bytes)[0]! ^ 1;
        if (id === fixture.originalSha && mode === 'mime') contentType = 'text/plain';
        if (id === fixture.originalSha && mode === 'size') bytes = bytes.slice(1);
        return new Blob([bytes], { type: contentType });
      },
    },
  };
}
