/** Successful local-only pinned file discovery, capture and availability reads. */
import assert from 'node:assert/strict';
import { loadNumericSource } from './load-numeric-source.mjs';

const { createPinnedFileClient } = await import(await loadNumericSource('integration/pinned-file-client.ts'));
const uuid = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const scope = { workspaceId: uuid(800), homeId: uuid(801) };
const session = { actorId: uuid(802), csrfToken: 'synthetic-unused', expiresAt: '2099-01-01T00:00:00Z' };
const attachmentId = uuid(804);
const sources = [uuid(803), 'synthetic/étage+α'].map((collectionId, index) => ({ ...scope,
  key: { sourceInstanceId: uuid(810 + index), collectionId, sourceKind: 'homebox-entity', externalId: uuid(820 + index) } }));
const discovery = { schemaVersion: 1, scope, revision: 'synthetic-catalog-revision', installedSources: sources };
const tokenFor = index => uuid(830 + index);
const root = version => `/api/atlas/stock/v${version}/workspaces/${scope.workspaceId}/homes/${scope.homeId}`;
const events = [];
const makeArtifact = (request, index) => ({
  scope: { ...scope, sourceInstanceId: request.target.sourceInstanceId, collectionId: request.target.collectionId },
  target: request.target, downloadToken: tokenFor(index), sha256: 'a'.repeat(64), byteSize: 4096,
  contentType: 'application/pdf', localCapture: { semantics: 'process-local-pinned-snapshot',
    beforeRetrievedAt: '2026-10-08T12:00:00Z', bodyRetrievedAt: '2026-10-08T12:00:01Z',
    afterRetrievedAt: '2026-10-08T12:00:02Z', statuses: [200, 200, 200] },
});
const response = body => new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });
const client = createPinnedFileClient({ getSessionBinding: () => ({ session, scope }),
  subscribeSessionBinding: () => () => {},
  transport: async (url, init) => {
    assert.equal(init.method, 'GET');
    assert.equal(init.credentials, 'same-origin');
    assert.equal(init.cache, 'no-store');
    assert.equal(init.redirect, 'error');
    assert.equal(init.headers.Accept, 'application/json');
    assert(init.signal instanceof AbortSignal);
    const target = new URL(url, 'https://atlas.invalid');
    events.push(target.pathname);
    if (target.pathname === `${root(3)}/homebox-pinned-file-admission`) {
      assert.equal(target.search, '');
      return response(discovery);
    }
    for (const [index, source] of sources.entries()) {
      const version = index === 0 ? 3 : 4;
      if (target.pathname === `${root(version)}/homebox-pinned-file`) {
        assert.deepEqual([...target.searchParams.keys()], ['request']);
        const request = JSON.parse(target.searchParams.get('request'));
        assert.equal(request.schemaVersion, version);
        assert.equal(request.commandId, 'homebox.file.download');
        assert.match(request.requestId, /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
        assert.deepEqual(request.context, scope);
        assert.deepEqual(request.target, { authority: 'homebox', sourceInstanceId: source.key.sourceInstanceId,
          collectionId: source.key.collectionId, resourceKind: 'attachment', entityId: source.key.externalId,
          resourceId: attachmentId });
        assert.deepEqual(request.payload, {});
        const artifact = makeArtifact(request, index);
        return response(version === 4 ? { schemaVersion: 4, commandId: request.commandId,
          requestId: request.requestId, artifact } : artifact);
      }
      const media = `/api/atlas/media/pinned-homebox/${scope.workspaceId}/${scope.homeId}/${tokenFor(index)}/availability`;
      if (target.pathname === media) {
        assert.equal(target.search, '');
        return response({ state: 'available', lifetime: { remainingMs: 60000 } });
      }
    }
    throw new Error(`Unexpected synthetic read path ${target.pathname}`);
  } });
const signal = new AbortController().signal;
const binding = client.getBindingIdentity();
assert(binding);
assert.deepEqual(client.getBindingScope(binding), scope);
const admitted = await client.discover(binding, signal);
assert.deepEqual(admitted.installedSources, sources);
assert.equal(admitted.revision, discovery.revision);
for (const [index, source] of admitted.installedSources.entries()) {
  const captured = await client.capture(admitted, source, attachmentId, signal);
  assert.equal(captured.request.schemaVersion, index === 0 ? 3 : 4);
  assert.deepEqual(captured.source, source);
  assert.equal(captured.attachmentId, attachmentId);
  assert.deepEqual(captured.artifact.scope, { ...scope, sourceInstanceId: source.key.sourceInstanceId,
    collectionId: source.key.collectionId });
  assert.equal(captured.artifact.byteSize, 4096);
  assert.deepEqual(captured.artifact.localCapture.statuses, [200, 200, 200]);
  assert.equal(Object.hasOwn(captured.artifact, 'downloadToken'), false);
  assert.equal(JSON.stringify(captured).includes(tokenFor(index)), false);
  const available = await client.resolve(captured, signal);
  assert.equal(available.state, 'offer');
  assert.equal(available.offer.remainingMs, 60000);
  assert.equal(available.offer.href,
    `/api/atlas/media/pinned-homebox/${scope.workspaceId}/${scope.homeId}/${tokenFor(index)}`);
  assert.equal(client.isOfferCurrent(available.offer), true);
  assert.equal(client.getUnknown(binding, source, attachmentId), null);
}
assert.deepEqual(events, [
  `${root(3)}/homebox-pinned-file-admission`, `${root(3)}/homebox-pinned-file`,
  `/api/atlas/media/pinned-homebox/${scope.workspaceId}/${scope.homeId}/${tokenFor(0)}/availability`,
  `${root(4)}/homebox-pinned-file`,
  `/api/atlas/media/pinned-homebox/${scope.workspaceId}/${scope.homeId}/${tokenFor(1)}/availability`,
]);
console.log('PASS synthetic pinned discovery, exact six-field v3/v4 capture and one availability observation each');
