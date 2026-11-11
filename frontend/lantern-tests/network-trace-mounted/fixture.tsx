// Generated mounted component fixture; it is not the UnifiedAtlas host.
import { useCallback, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { NetworkGraph, type StageTrace } from '../../src/lantern/unified-atlas/NetworkGraph';
import { NetworkStageConnections } from '../../src/lantern/unified-atlas/NetworkStageConnections';
import { projectNetworkConnections } from '../../src/lantern/unified-atlas/network-connections';
import { currentStageTrace, publishStageTrace } from '../../src/lantern/unified-atlas/network-trace';
import type { NetworkOverlayData } from '../../src/lantern/overlays/network/types';
import '../../src/lantern/unified-atlas/unified-atlas.css';

const device = (id: string, sourceRoot = false) => ({ id, label: id, kind: 'switch', sourceRoot, mobility: 'fixed' as const, confidence: 'recorded' as const, notes: '', place: null });
const link = (id: string, fromEndpointId: string, toEndpointId: string, medium: string) => ({ id, fromEndpointId, toEndpointId, medium, kind: 'connection' as const, confidence: 'accepted' as const, sourceConfidence: null, temporalStatus: 'recorded', recordedAtPrecision: null, basis: '', recordedAt: null, notes: '', path: null });
const data = (): NetworkOverlayData => ({ viewKey: 'generated', source: { label: 'Generated', revision: null, recordedAt: null, retrievedAt: null, status: 'recorded', acceptedAt: null, coverage: 'partial', notes: '' }, devices: [device('Root', true), device('Middle'), device('Client')], endpoints: [], links: [link('a', 'Client', 'Middle', 'wifi'), link('b', 'Middle', 'Root', 'ethernet')] });
const a = data(), b = data();
const graph = (data: NetworkOverlayData) => ({ key: 'same', data, qualification: 'Generated network' });
const anchor = (nodeId: string, x: number) => ({ graphKey: 'same', nodeKind: 'device' as const, nodeId, roomId: nodeId, occurrenceId: nodeId, point: [x, 0] as const, basis: 'room-summary' as const, qualification: 'Generated' });
const connections = projectNetworkConnections([graph(a)], [anchor('Client', 0), anchor('Middle', 50), anchor('Root', 100)]);

function Fixture() {
  const [selectedData, setData] = useState(a), [shown, setShown] = useState(true), [layer, setLayer] = useState(true), [plan, setPlan] = useState(false);
  const [trace, setTrace] = useState<StageTrace | null>(null);
  const onTrace = useCallback((key: string, next: StageTrace | null, owner: NetworkOverlayData) => setTrace(current => publishStageTrace(current, key, owner, next)), []);
  const graphs = layer ? [graph(selectedData)] : [];
  const current = currentStageTrace(trace, graphs, shown && layer);
  return <div className="lantern-host">
    <button onClick={() => setData(b)}>Replace data</button><button onClick={() => setShown(v => !v)}>Close or reopen</button>
    <button onClick={() => setLayer(v => !v)}>Toggle layer</button><button onClick={() => setPlan(v => !v)}>Toggle plan</button>
    <svg><NetworkStageConnections connections={connections} selected={null} trace={current} fade={plan ? 0 : 1} /></svg>
    {shown && layer && <NetworkGraph graph={graphs[0]!} onTrace={onTrace} />}
  </div>;
}
createRoot(document.getElementById('root')!).render(<Fixture />);
