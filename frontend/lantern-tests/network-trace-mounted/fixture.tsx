// Generated mounted component fixture; it is not the UnifiedAtlas host.
import { useCallback, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { NetworkGraph, type StageTrace } from '../../src/lantern/unified-atlas/NetworkGraph';
import { NetworkStageConnections } from '../../src/lantern/unified-atlas/NetworkStageConnections';
import { projectNetworkConnections } from '../../src/lantern/unified-atlas/network-connections';
import { currentStageTrace, publishStageTrace } from '../../src/lantern/unified-atlas/network-trace';
import type { NetworkOverlayData } from '../../src/lantern/overlays/network/types';
import '../../src/lantern/unified-atlas/unified-atlas.css';

const device = (id: string, sourceRoot = false) => ({ id, label: id, kind: 'switch', sourceRoot, mobility: 'fixed' as const, confidence: 'recorded' as const, notes: '', place: null });
const link = (id: string, fromEndpointId: string, toEndpointId: string, medium: string) => ({ id, fromEndpointId, toEndpointId, medium, kind: 'connection' as const, confidence: 'accepted' as const, sourceConfidence: null, temporalStatus: 'recorded', recordedAtPrecision: null, basis: '', recordedAt: null, notes: '', path: null });
const data = (): NetworkOverlayData => ({ viewKey: 'generated', source: { label: 'Generated', revision: null, recordedAt: null, retrievedAt: null, status: 'recorded', acceptedAt: null, coverage: 'partial', notes: '' }, devices: [device('Root', true), device('Middle'), device('Client'), device('Side')], endpoints: [], links: [link('a', 'Client', 'Middle', 'wifi'), link('b', 'Middle', 'Root', 'ethernet'), link('side', 'Root', 'Side', 'ethernet')] });
const a = data(), b = data(), c = data();
const rootless: NetworkOverlayData = { ...data(), devices: data().devices.map(d => ({ ...d, sourceRoot: false })) };
const uncertain: NetworkOverlayData = { ...data(), links: data().links.map(l => l.id === 'a' ? { ...l, confidence: 'tentative' } : l) };
const shared: NetworkOverlayData = { ...data(), devices: [device('Root', true), device('Client')],
  endpoints: [{ id: 'segment', label: 'Shared segment', kind: 'segment', ownerDeviceId: null, notes: '' }],
  links: [ { ...link('membership-client', 'Client', 'segment', 'wifi'), kind: 'segment-membership' },
    { ...link('membership-root', 'Root', 'segment', 'wifi'), kind: 'segment-membership' } ] };
const graph = (key: string, data: NetworkOverlayData) => ({ key, data, qualification: 'Generated network' });
const anchor = (graphKey: string, nodeId: string, x: number) => ({ graphKey, nodeKind: 'device' as const, nodeId, roomId: nodeId, occurrenceId: nodeId, point: [x, 0] as const, basis: 'room-summary' as const, qualification: 'Generated' });
const entries = { a: graph('same', a), b: graph('same', b), c: graph('other', c), rootless: graph('rootless', rootless), uncertain: graph('uncertain', uncertain), shared: graph('shared', shared) };
type Entry = keyof typeof entries;

function Fixture() {
  const [selected, setSelected] = useState<Entry | null>('a'), [shown, setShown] = useState(true), [layer, setLayer] = useState(true), [plan, setPlan] = useState(false);
  const [mount, setMount] = useState(0), [hideRoot, setHideRoot] = useState(false);
  const [trace, setTrace] = useState<StageTrace | null>(null);
  const delayedOwner = useRef<NetworkOverlayData | null>(null);
  const delayed = useRef<Array<{ key: string; owner: NetworkOverlayData }>>([]);
  const [queued, setQueued] = useState(0);
  const onTrace = useCallback((key: string, next: StageTrace | null, owner: NetworkOverlayData) => {
    if (next === null && delayedOwner.current === owner) {
      delayed.current.push({ key, owner }); delayedOwner.current = null; setQueued(delayed.current.length); return;
    }
    setTrace(current => publishStageTrace(current, key, owner, next));
  }, []);
  const flush = () => {
    const withdrawals = delayed.current.splice(0); setQueued(0);
    setTrace(current => withdrawals.reduce((value, item) => publishStageTrace(value, item.key, item.owner, null), current));
  };
  const graphs = layer && selected ? [entries[selected]] : [];
  const connections = projectNetworkConnections(graphs, graphs.flatMap(({ key }) => [anchor(key, 'Client', 0), anchor(key, 'Middle', 50), anchor(key, 'Root', 100), anchor(key, 'Side', 150)]));
  const current = currentStageTrace(trace, graphs, shown && layer);
  const traceOwner = trace?.data === a ? 'a' : trace?.data === b ? 'b' : trace?.data === c ? 'c' : 'none';
  return <div className="lantern-host">
    <button onClick={() => setSelected('a')}>Select A</button><button onClick={() => setSelected('b')}>Replace data</button>
    <button onClick={() => setSelected('c')}>Replace key</button><button onClick={() => setSelected(null)}>Remove source</button>
    <button onClick={() => setSelected('rootless')}>Rootless source</button><button onClick={() => setSelected('uncertain')}>Uncertain source</button><button onClick={() => setSelected('shared')}>Shared medium source</button>
    <button onClick={() => setMount(value => value + 1)}>Remount same data</button>
    <button onClick={() => { delayedOwner.current = selected ? entries[selected].data : null; }}>Delay withdrawal</button>
    <button onClick={flush}>Deliver withdrawal</button><output data-trace-owner={traceOwner} data-queued={queued} />
    <button onClick={() => setShown(v => !v)}>Close or reopen</button>
    <button onClick={() => setLayer(v => !v)}>Toggle layer</button><button onClick={() => setPlan(v => !v)}>Toggle plan</button><button onClick={() => setHideRoot(v => !v)}>Toggle root floor</button>
    <svg><NetworkStageConnections connections={connections} selected={null} trace={current} fade={plan ? 0 : 1} shown={plan && hideRoot ? occurrence => occurrence !== 'Root' : undefined} /></svg>
    {shown && graphs.map(item => <NetworkGraph key={`${item.key}:${mount}`} graph={item} onTrace={onTrace} />)}
  </div>;
}
createRoot(document.getElementById('root')!).render(<Fixture />);
