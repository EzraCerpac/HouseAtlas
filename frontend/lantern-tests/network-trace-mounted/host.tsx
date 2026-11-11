// Generated saved-documentary data mounted through the actual UnifiedAtlas.
// This fixture supplies no live provider, private data, or native authority.
import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import UnifiedAtlas, { type AtlasLensState } from '../../src/lantern/unified-atlas/UnifiedAtlas';
import type { UnifiedAtlasPort } from '../../src/lantern/unified-atlas/types';
import type { DocumentaryRecord, PropertyRecords } from '../../src/lantern/unified-atlas/runtime-overlays';
import type { NetworkOverlayData } from '../../src/lantern/overlays/network/types';
import { readUnifiedAtlas } from '../../integration/unified-atlas-reader';
import { atlasScenePath, buildSyntheticAtlas, composeAtlasEnvelope, createAtlasTransport, SYNTHETIC_ATLAS } from '../unified-atlas/synthetic-atlas';

const scope = { workspaceId: '00000000-0000-4000-8000-000000000800', homeId: '00000000-0000-4000-8000-000000000801' };
const hash = 'd'.repeat(64);
const device = (id: string, sourceRoot = false) => ({ id, label: id, kind: 'switch', sourceRoot, mobility: 'fixed' as const, confidence: 'recorded' as const, notes: '', place: null });
const data: NetworkOverlayData = { viewKey: 'generated-host', source: { label: 'Generated', revision: null, recordedAt: null, retrievedAt: null, status: 'recorded', acceptedAt: null, coverage: 'partial', notes: '' },
  devices: [device('Host client'), device('Host root', true)], endpoints: [], links: [{ id: 'host-link', fromEndpointId: 'Host client', toEndpointId: 'Host root', kind: 'connection', medium: 'ethernet', confidence: 'accepted', sourceConfidence: null, temporalStatus: 'recorded', recordedAtPrecision: null, basis: '', recordedAt: null, notes: '', path: null }] };
const record = (id: string, roomId: string): DocumentaryRecord => ({ key: id, id, label: id, category: 'Recorded device', detail: '', qualification: 'Generated', sourceDate: null, retrievedAt: null, connections: [], sourceFacts: [{ label: 'Source original SHA256', value: hash }, { label: 'Room association in this observation', value: roomId }] });
const records: PropertyRecords = { rooms: new Map([['syn-room-hall', { network: [record('Host client', 'syn-room-hall')], electrical: [] }], ['syn-room-living', { network: [record('Host root', 'syn-room-living')], electrical: [] }]]),
  network: 'available', electrical: 'unavailable', sourceFacts: [], unplaced: { network: [], electrical: [] }, buildings: [],
  networkGraphs: [{ key: 'host-graph', data, qualification: 'Generated host graph', sourceOriginalSha256: hash, deviceRecordKeys: new Map(data.devices.map(d => [d.id, d.id])) }] };

async function port(): Promise<UnifiedAtlasPort> {
  // Fixture-only counts include in-memory owner and transport reads.
  const reads = { port: 0, transport: 0, documentary: 0 };
  Object.assign(window, { __hostTraceReads: reads });
  const input = await buildSyntheticAtlas(scope);
  const composed = await composeAtlasEnvelope(input.companionBytes, input.glb, SYNTHETIC_ATLAS.revision);
  const selection = { owner: {}, scope, expiresAt: '2099-01-01T00:00:00Z', publicationId: composed.publicationId, manifestSha256: composed.manifestSha256 };
  const transport = createAtlasTransport({ origin: SYNTHETIC_ATLAS.origin, scenePath: atlasScenePath(scope), envelopeBytes: composed.envelopeBytes,
    href: composed.href, glb: input.glb, sha256: composed.sha256, manifestSha256: composed.manifestSha256, revision: SYNTHETIC_ATLAS.revision,
    onRequest: () => { reads.transport += 1; } });
  return { current: () => selection, subscribe: () => () => {}, savedDocumentary: { observedAt: '2026-01-01T00:00:00Z', records: () => { reads.documentary += 1; return records; } },
    read: (requested, signal) => { reads.port += 1; return readUnifiedAtlas({ selection: requested, signal, origin: SYNTHETIC_ATLAS.origin, isCurrent: () => requested === selection, transport }); } };
}

function Host({ atlas }: { readonly atlas: UnifiedAtlasPort }) {
  const [portal, setPortal] = useState(false), [lens, setLens] = useState<AtlasLensState | null>(null), [target, setTarget] = useState<HTMLElement | null>(null);
  return <div className="lantern-host" style={{ height: '900px', width: '1400px' }}>
    <button onClick={() => { setPortal(value => !value); setLens(null); }}>Switch host mode</button>
    <button onClick={() => setLens(value => value ? null : { kind: 'network', reading: false })}>Toggle fixture lens</button>
    <div ref={setTarget} id="generated-lens" />
    <UnifiedAtlas port={atlas} environment={{ reducedMotion: true, ...(portal ? { lens: { value: lens, set: setLens, target, panelId: 'generated-lens' } } : {}) }} />
  </div>;
}
const root = createRoot(document.getElementById('root')!);
void port().then(atlas => root.render(<Host atlas={atlas} />), error => root.render(<p role="alert">{String(error)}</p>));
