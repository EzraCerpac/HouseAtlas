import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { TopologyBinding, TopologyClient, TopologyFailure, TopologyRead } from '../../api/topology-client';
import { projectView } from '../adapters/read';
import { useStore } from '../state/store';
import { buildTopologyIndex, buildBuildingModel, type BuildingModel, type TopologyData, type TopologyIndex } from './model';

interface TopologyContext {
  readonly activate: () => void;
  readonly index: TopologyIndex | null;
  readonly status: 'loading' | 'ready' | TopologyFailure;
  readonly buildingId: string | null;
  readonly chooseBuilding: (id: string | null) => void;
  readonly levelId: string;
  readonly chooseLevel: (id: string) => void;
  readonly model: BuildingModel | null;
  readonly memberStatus: 'loading' | 'ready' | 'changed' | TopologyFailure;
  readonly notice: string;
  readonly memberSourceStatus: string | null;
}
const Context = createContext<TopologyContext | null>(null);
export function TopologyProvider({ client, children }: { client?: TopologyClient | undefined; children: ReactNode }) {
  const { projection, actions } = useStore();
  const view = projection.view, session = actions.session?.expiresAt;
  const [active, setActive] = useState(false), [epoch, setEpoch] = useState(0);
  const binding = client?.getBinding() ?? null;
  const key = useMemo(() => ({ view, session, binding, epoch }), [view, session, binding, epoch]);
  const current = useRef(key); current.current = key;
  const [loaded, setLoaded] = useState<{ key: typeof key; data: TopologyData | null; status: TopologyContext['status'] } | null>(null);
  const [buildingId, setBuildingId] = useState<string | null>(null), [levelId, setLevelId] = useState('all');
  const [members, setMembers] = useState<{ key: typeof key; binding: TopologyBinding; buildingId: string; read: TopologyRead<'identity'> } | null>(null);
  const [notice, setNotice] = useState('');
  useEffect(() => client?.subscribe(() => setEpoch(e => e + 1)), [client]);
  const activate = useCallback(() => setActive(true), []);
  // Optional geometry/history presentation changes do not restart topology reads.
  const sourceProjection = useMemo(() => projectView(view), [view]);
  const selectable = useMemo(() => new Map(sourceProjection.house.spaces.flatMap(space => {
    const entry = sourceProjection.entries.get(space.id); return entry ? [[space.id, entry] as const] : [];
  })), [sourceProjection]);
  const index = useMemo(() => loaded?.key === key && loaded.data
    ? buildTopologyIndex(loaded.data, view, selectable) : null, [loaded, key, view, selectable]);
  const status = loaded?.key === key ? loaded.status : client && binding ? 'loading' : 'unavailable';
  useEffect(() => {
    if (!active || !client || !binding) return;
    if (binding.scope.workspaceId !== view.scope.workspaceId || binding.scope.homeId !== view.scope.homeId) return;
    const controller = new AbortController();
    const live = () => !controller.signal.aborted && current.current === key && client.getBinding() === binding;
    setLoaded({ key, status: 'loading', data: null });
    void Promise.all([client.listAll(binding, 'identity', controller.signal), client.listAll(binding, 'binding', controller.signal),
      client.listAll(binding, 'location-semantics', controller.signal), client.listAll(binding, 'relation', controller.signal)]).then(([identity, bindings, semantics, relations]) => {
      if (!live()) return;
      const failure = [identity, bindings, semantics, relations].find(read => read.status !== 'ready');
      if (failure) { setLoaded({ key, status: failure.status, data: null }); return; }
      if (identity.status !== 'ready' || bindings.status !== 'ready' || semantics.status !== 'ready' || relations.status !== 'ready') return;
      setLoaded({ key, status: 'ready', data: { identities: identity.records, bindings: bindings.records, semantics: semantics.records,
        relations: relations.records, sourceStatuses: [identity.sourceStatus, bindings.sourceStatus, semantics.sourceStatus, relations.sourceStatus] } });
    }).catch(() => { if (live()) setLoaded({ key, status: 'unavailable', data: null }); });
    return () => controller.abort();
  }, [active, client, key, binding, view]);
  useEffect(() => {
    if (index && buildingId !== null && !index.buildings.some(b => b.id === buildingId)) {
      setNotice('The selected building is not a reviewed building in the current read.');
      setBuildingId(null); setLevelId('all');
    }
  }, [index, buildingId]);
  useEffect(() => {
    if (!index || !client || !binding || buildingId === null || !index.buildings.some(b => b.id === buildingId)) return;
    const controller = new AbortController();
    const live = () => !controller.signal.aborted && current.current === key && client.getBinding() === binding;
    setMembers(null); setLevelId('all');
    void client.buildingMembers(binding, buildingId, controller.signal).then(read => {
      if (live()) setMembers({ key, binding, buildingId, read });
    }).catch(() => { if (live()) setMembers({ key, binding, buildingId, read: { status: 'unavailable' } }); });
    return () => controller.abort();
  }, [index, client, binding, buildingId, key]);
  const chooseBuilding = useCallback((id: string | null) => {
    setNotice(''); setBuildingId(id); setLevelId('all');
  }, []);
  const read = members?.key === key && members.binding === binding && members.buildingId === buildingId ? members.read : null;
  const model = useMemo(() => index && buildingId && read?.status === 'ready'
    ? buildBuildingModel(index, buildingId, read.records) : null, [index, buildingId, read]);
  const memberStatus = read?.status === 'ready' ? model ? 'ready' : 'changed' : read?.status ?? 'loading';
  const value: TopologyContext = { activate, index, status, buildingId, chooseBuilding, levelId, chooseLevel: setLevelId, model, memberStatus, notice, memberSourceStatus: read?.status === 'ready' ? read.sourceStatus : null };
  return <Context.Provider value={value}>{children}</Context.Provider>;
}
export function useTopology(): TopologyContext {
  const context = useContext(Context);
  if (!context) throw new Error('Topology consumer requires its provider');
  return context;
}
