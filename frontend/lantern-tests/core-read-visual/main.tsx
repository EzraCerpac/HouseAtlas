/** Generic source-only demo; all transports are synthetic and local to this page. */
import { createRoot } from 'react-dom/client';
import { LanternHost } from '../../src/lantern/Host';
import type { AtlasSessionInfo } from '../../src/app/session';
import type { ReadyView } from '../../src/app/types';
import { createTopologyClient, type TopologyKind } from '../../src/api/topology-client';
import { createNetworkRelationsClient } from '../../src/api/network-relations-client';
import { createStockSchemas } from '../../integration/stock-schemas';
import fixture from './fixture.json';

// Geometry, history, evidence and any other application fetch stay unavailable.
// No real session, account, native transport, cookies or provider is consulted.
globalThis.fetch = async () => new Response(null, { status: 404 });
const session: AtlasSessionInfo = {
  schemaVersion: 1,
  actorId: '00000000-0000-4000-8000-000000000802',
  csrfToken: 'synthetic-unused',
  expiresAt: '2099-01-01T00:00:00Z',
};
const scope = fixture.scope;
const getSessionBinding = () => ({ session, scope });
const subscribeSessionBinding = () => () => {};
const schemas = createStockSchemas();
const invokePath = `/api/atlas/stock/v3/workspaces/${scope.workspaceId}/homes/${scope.homeId}/invoke`;
// Equality metadata for this one frozen synthetic frame; no authority/freshness claim.
const snapshotSha256 = 'a'.repeat(64);

interface SyntheticRequest {
  readonly commandId: string;
  readonly requestId: string;
  readonly context: { readonly workspaceId: string; readonly homeId: string };
  readonly target: { readonly recordType: TopologyKind };
  readonly payload: { readonly cursor: null; readonly buildingId?: string };
}
const topology = createTopologyClient({
  schemas, getSessionBinding, subscribeSessionBinding,
  transport: async (url, init) => {
    init?.signal?.throwIfAborted();
    const target = new URL(String(url), 'https://atlas.invalid');
    const raw = target.searchParams.get('request');
    if (target.origin !== 'https://atlas.invalid' || target.pathname !== invokePath
      || [...target.searchParams.keys()].join(',') !== 'request' || raw === null
      || init?.method !== 'GET') throw new TypeError('Unexpected synthetic topology request');
    const request = JSON.parse(raw) as SyntheticRequest;
    if (request.context.workspaceId !== scope.workspaceId || request.context.homeId !== scope.homeId
      || request.commandId !== `atlas.${request.target.recordType}.list` || request.payload.cursor !== null)
      throw new TypeError('Unexpected synthetic topology scope or continuation');
    const kind = request.target.recordType;
    const rows = fixture.records[kind];
    if (!rows) throw new TypeError('Unexpected synthetic record family');
    let records: readonly unknown[] = rows;
    if (request.payload.buildingId !== undefined) {
      if (kind !== 'identity') throw new TypeError('Unexpected synthetic member request');
      const buildingId = request.payload.buildingId;
      // This is exactly the existing fixture's Alpha membership, not source parentage.
      // Its other buildings have no additional reviewed members in this fixture.
      records = rows.filter(row => row.target.recordId === buildingId
        || buildingId === fixture.members[0] && fixture.members.includes(row.target.recordId));
    }
    return new Response(JSON.stringify({
      schemaVersion: 3, commandId: request.commandId, requestId: request.requestId,
      resolvedScope: scope, status: 'read', replayed: false,
      data: { records, nextCursor: null, sourceStatus: 'current' },
    }), { status: 200, headers: { 'Content-Type': 'application/json', 'x-atlas-snapshot-sha256': snapshotSha256 } });
  },
});

// The existing successful numeric fixture's relation and original supplied dates.
// Its wire number is replaced as text before Response parsing; never a JS Number.
const networkPage = {
  contractVersion: '1.0.0',
  items: [{
    schemaVersion: 1, ...scope,
    sourceInstanceId: '00000000-0000-4000-8000-000000000803',
    collectionId: 'synthetic-network', externalId: 'synthetic-link', kind: 'network-connection',
    from: { kind: 'device', id: 'synthetic-a', description: null },
    to: { kind: 'device', id: 'synthetic-b', description: null },
    medium: 'ethernet', sourceRevision: 0,
    sourceSnapshotAt: null, retrievedAt: '2026-10-08T12:00:00Z', vantage: null,
    sourceConfidence: 'reported', evidenceBasis: 'source-report', temporalStatus: 'current-claim',
    factAt: null, notes: '',
  }],
  nextCursor: null,
  sourceStatuses: [],
};
const networkBody = JSON.stringify(networkPage).replace('"sourceRevision":0', '"sourceRevision":9007199254740993');
const networkPath = `/api/atlas/v1/workspaces/${scope.workspaceId}/homes/${scope.homeId}/network/relations`;
const networkRelations = createNetworkRelationsClient({
  getSessionBinding, subscribeSessionBinding,
  fetch: async (url, init) => {
    init?.signal?.throwIfAborted();
    const target = new URL(String(url), 'https://atlas.invalid');
    if (target.origin !== 'https://atlas.invalid' || target.pathname !== networkPath
      || target.search !== '?limit=25' || init?.method !== 'GET')
      throw new TypeError('Unexpected synthetic Network request');
    return new Response(networkBody, { status: 200, headers: { 'Content-Type': 'application/json' } });
  },
});
// This demonstrates an exact canonical retained token. The native provider's
// existing safe_revision admission cap is separate and has not been widened.

const root = createRoot(document.getElementById('root')!);
root.render(<LanternHost view={fixture.view as ReadyView}
  actions={{ reload: async () => true, switchHome: () => {}, busy: false, notice: '',
    session: { ...session, signOut: async () => {} } }}
  nativeContent={null} topology={topology} networkRelations={networkRelations} />);
// Network is loaded only through its existing visible user action. Default view,
// navigation, building selection and room selection are the unchanged Lantern UI.
window.addEventListener('pagehide', () => root.unmount(), { once: true });
