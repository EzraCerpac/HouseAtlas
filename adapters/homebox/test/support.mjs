import { readFileSync } from 'node:fs';
const load = path => JSON.parse(readFileSync(new URL(path, import.meta.url)));
export const baseline = load('../../../packages/contracts/fixtures/plan-free.snapshot.json');
export const pinnedPage = load('../../../packages/contracts/fixtures/homebox-page.wire.json');
export const metadataFixture = load('../fixtures/metadata.normalized-synthetic-v1.json');
export const reg = baseline.sources[0];
export const ids = { location: '00000000-0000-4000-8000-000000000500', item: '00000000-0000-4000-8000-000000000501', unknown: '00000000-0000-4000-8000-000000000503', attachment: '00000000-0000-4000-8000-000000000801', link: '00000000-0000-4000-8000-000000000802', maintenance: '00000000-0000-4000-8000-000000000901', generation: '00000000-0000-4000-8000-000000000999' };
export const NOW = '2026-10-06T10:00:00.000Z';
export const scopeOf = r => ({ workspaceId: r.workspaceId, homeId: r.homeId, sourceInstanceId: r.sourceInstanceId, collectionId: r.collectionId });
export const detail = (id, isLocation = false, extra = {}) => ({ id, name: isLocation ? 'Synthetic arbitrary cupboard' : 'Synthetic unplaced item', archived: false, updatedAt: '2026-01-01T00:00:00Z', entityType: { id: isLocation ? '00000000-0000-4000-8000-000000000700' : '00000000-0000-4000-8000-000000000701', name: isLocation ? 'Custom cupboard' : 'Custom object', isLocation }, parent: null, attachments: [], ...extra });
export const maintenance = metadataFixture.maintenance;
export const listEntity = e => Object.fromEntries(['id', 'name', 'archived', 'updatedAt', 'entityType', 'parent'].map(k => [k, e[k]]));
export const response = (value, r = reg, status = 200) => ({ status, scope: scopeOf(r), body: JSON.stringify(value) });
export const metadata = () => structuredClone(metadataFixture.entities);
export function fakeTransport({ entities = metadata(), registration = reg, pageMutator, interceptor, calls = [] } = {}) {
  const transport = async req => {
    calls.push(req);
    if (interceptor) { const intercepted = await interceptor(req, calls); if (intercepted !== undefined) return intercepted; }
    if (req.path === '/api/v1/entities') {
      const q = new URLSearchParams(req.query);
      const isLocation = q.get('isLocation') === 'true';
      const parents = q.getAll('parentIds');
      const rows = entities.filter(e => (e.entityType?.isLocation ?? false) === isLocation && (!parents.length || parents.includes(e.parent?.id)));
      const page = Number(q.get('page')), pageSize = Number(q.get('pageSize'));
      let value = { items: rows.slice((page - 1) * pageSize, page * pageSize).map(listEntity), page, pageSize, total: rows.length };
      if (pageMutator) value = pageMutator(value, req) ?? value;
      return response(value, registration);
    }
    const id = req.path.split('/')[4];
    if (req.path.endsWith('/maintenance')) return response(maintenance, registration);
    const entity = entities.find(e => e.id.toLowerCase() === id);
    return response(entity ?? null, registration, entity ? 200 : 404);
  };
  return { transport, calls };
}
export const options = transport => ({ registration: reg, transport, clock: () => NOW, idFactory: () => ids.generation });
export function assertPriorUnchanged(assert, before, result, previous) {
  assert.deepEqual(previous, before);
  assert.equal(result.ok, false);
  assert.equal(result.homeboxEntities, null);
  assert.equal(result.retainPrevious, true);
  assert.equal(result.cache.generationId, before.cache.generationId);
  assert.equal(result.cache.lastSuccessfulFetchAt, before.cache.lastSuccessfulFetchAt);
  assert.deepEqual(result.missingExternalIds, []);
  assert.equal(result.deletionConfirmed, false);
}
