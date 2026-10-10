import { useLayoutEffect, useRef, useState, useSyncExternalStore, type KeyboardEvent } from 'react';
import type { Entry, NetworkEndpoint, ReadyView } from '../../app/types';
import {
  extendSequence, sequenceLimit, startSequence,
  type NetworkRelationsBinding, type NetworkRelationsClient, type NetworkRelationsRead,
  type NetworkRelationsSequence, type NetworkRelationsStop,
} from '../../api/network-relations-client';
import { text } from '../../app/copy';
import { visibleEntries } from '../../app/model';
import type { Device } from '../data/types';
import { latestObservation, nameOf } from '../data/query';
import { fmtDateTime, rel } from '../data/time';
import { useSelect, useStore } from '../state/store';
import { LAYER } from '../atlas/palette';
import { ClaimBadge, EntityLink, Empty, Note } from '../components/ui';
import { DocList } from '../components/rows';

export function NetworkView() {
  const { house, projection, actions } = useStore();
  const [tab, setTab] = useState<'logical' | 'cabling'>('logical');
  // ReadyView may retain other homes and archived records; only current
  // records in the selected scope are shown, as in the Lantern projection.
  const { scope } = projection.view;
  const networkEntries = visibleEntries(projection.view, false).filter((entry) =>
    entry.workspaceId === scope.workspaceId && entry.homeId === scope.homeId
    && (entry.networkBound || entry.networkRelations.length > 0));
  return (
    <div className="view">
      <header className="view-head">
        <h1>Network</h1>
        <p>
          Saved Network relations are read-only. Observation dates and retrieval dates remain distinct.
        </p>
      </header>
      <div className="seg seg-wide" role="tablist" aria-label="Network views">
        <button id="net-tab-logical" type="button" role="tab" aria-selected={tab === 'logical'} aria-controls="net-panel" onClick={() => setTab('logical')}>
          Observed links
        </button>
        <button id="net-tab-cabling" type="button" role="tab" aria-selected={tab === 'cabling'} aria-controls="net-panel" onClick={() => setTab('cabling')}>
          Documented cabling
        </button>
      </div>
      <div id="net-panel" role="tabpanel" aria-labelledby={tab === 'logical' ? 'net-tab-logical' : 'net-tab-cabling'}>
        {tab === 'logical' ? <>
          {networkEntries.length ? <SavedRelations entries={networkEntries} /> : !actions.networkRelations && <Empty>No Network relation projection is supplied.</Empty>}
          {actions.networkRelations && <NetworkRelationsPanel client={actions.networkRelations} />}
        </> : <Cabling />}
        {house.devices.length > 0 && <Topology />}
      </div>
      {house.devices.length > 0 && <Observations />}
    </div>
  );
}

function Topology() {
  const { house, state } = useStore();
  const select = useSelect();
  const devices = house.devices;
  const root = devices.find((d) => d.kind === 'Router') ?? devices[0];
  if (!root) return <Empty>No network devices observed.</Empty>;

  // Breadth-first layering from the router, using observed links only.
  const depth = new Map<string, number>([[root.id, 0]]);
  const queue = [root.id];
  while (queue.length) {
    const id = queue.shift()!;
    for (const l of house.links) {
      const other = l.from === id ? l.to : l.to === id ? l.from : null;
      if (other && !depth.has(other)) {
        depth.set(other, depth.get(id)! + 1);
        queue.push(other);
      }
    }
  }
  const unlinked = devices.filter((d) => !depth.has(d.id));
  const cols = new Map<number, Device[]>();
  for (const d of devices) {
    const k = depth.get(d.id);
    if (k === undefined) continue;
    cols.set(k, [...(cols.get(k) ?? []), d]);
  }
  const W = 760;
  const colCount = Math.max(...cols.keys()) + 1;
  const maxRows = Math.max(...[...cols.values()].map((c) => c.length));
  const H = Math.max(220, maxRows * 78 + 40);
  const pos = new Map<string, [number, number]>();
  for (const [k, list] of cols) {
    list.forEach((d, i) => {
      const x = 90 + (k * (W - 200)) / Math.max(1, colCount - 1);
      const y = (H / (list.length + 1)) * (i + 1);
      pos.set(d.id, [x, y]);
    });
  }
  const color = LAYER.network.color;
  const key = (e: KeyboardEvent, id: string) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      select(id, { keepOverlay: false });
    }
  };

  return (
    <div className="topology">
      <svg viewBox={`0 0 ${W} ${H}`} className="topo-svg" role="group" aria-label="Observed logical links between devices">
        {house.links.map((l) => {
          const a = pos.get(l.from);
          const b = pos.get(l.to);
          if (!a || !b) return null;
          const mx = (a[0] + b[0]) / 2;
          return (
            <g key={l.id} className={`topo-link conf-${l.confidence}`}>
              <path d={`M${a[0]} ${a[1]} C${mx} ${a[1]} ${mx} ${b[1]} ${b[0]} ${b[1]}`} fill="none" stroke={color} strokeWidth={l.kind === 'wired' ? 2.4 : 1.6} strokeDasharray={l.kind === 'wireless' ? '6 5' : undefined} />
              <text x={mx} y={(a[1] + b[1]) / 2 - 6} textAnchor="middle" className="topo-link-label">
                {l.kind === 'wired' ? 'wired' : 'wireless'}, {l.confidence}
              </text>
            </g>
          );
        })}
        {devices.map((d) => {
          const p = pos.get(d.id);
          if (!p) return null;
          const ob = latestObservation(house, d.id);
          const stale = !ob || ob.observedAt < house.sources.networkObservedAt;
          const sel = state.selection?.id === d.id;
          return (
            <g
              key={d.id}
              className={`topo-node${sel ? ' is-selected' : ''}`}
              transform={`translate(${p[0]} ${p[1]})`}
              role="button"
              tabIndex={0}
              aria-label={`${d.name}, ${stale ? 'not in latest export' : 'in latest export'}`}
              onClick={() => select(d.id, { keepOverlay: false })}
              onKeyDown={(e) => key(e, d.id)}
            >
              <circle r={sel ? 17 : 14} fill={stale ? '#FFFFFF' : color} stroke={color} strokeWidth={2} />
              <text y={32} textAnchor="middle" className="topo-name">
                {d.name}
              </text>
              <text y={47} textAnchor="middle" className="topo-sub">
                {ob ? `seen ${rel(ob.observedAt, house.displayNow)}` : 'never seen'}
              </text>
            </g>
          );
        })}
      </svg>
      <ul className="topo-key">
        <li>
          <svg width="34" height="10" aria-hidden="true">
            <path d="M2 5h30" stroke={color} strokeWidth="2.4" />
          </svg>
          Wired, as reported by the router
        </li>
        <li>
          <svg width="34" height="10" aria-hidden="true">
            <path d="M2 5h30" stroke={color} strokeWidth="1.6" strokeDasharray="6 5" />
          </svg>
          Wireless association
        </li>
        <li>
          <svg width="16" height="16" aria-hidden="true">
            <circle cx="8" cy="8" r="6" fill="#fff" stroke={color} strokeWidth="2" />
          </svg>
          Not in the latest export
        </li>
      </ul>
      <Note>These links describe how devices talk to each other, as observed. They are not cable routes. See documented cabling for physical runs.</Note>
      {unlinked.length > 0 && (
        <p className="body-text">
          Not linked to anything observed:{' '}
          {unlinked.map((d) => (
            <EntityLink key={d.id} id={d.id} />
          ))}
        </p>
      )}
    </div>
  );
}

function Cabling() {
  const { house } = useStore();
  if (!house.cables.length) return <Empty>A reviewed physical-cabling projection is unavailable.</Empty>;
  return (
    <div className="cabling">
      <Note>Physical runs documented by the household, with photos where available. Routes inside walls are not drawn.</Note>
      <ul className="cable-list">
        {house.cables.map((c) => (
          <li key={c.id} className="cable">
            <div className="cable-ends">
              <EntityLink id={c.fromId} sub={nameOf(house, house.devices.find((d) => d.id === c.fromId)?.spaceId ?? '')} />
              <span className="cable-line" aria-hidden="true">
                <span>{c.medium}</span>
              </span>
              <EntityLink id={c.toId} sub={nameOf(house, house.devices.find((d) => d.id === c.toId)?.spaceId ?? '')} />
            </div>
            <div className="cable-meta">
              <EntityLink id={c.id} label={c.name} />
              <ClaimBadge claim={c.claim} />
            </div>
            <p className="body-text muted">{c.note}</p>
            <DocList docs={house.docs.filter((d) => c.evidenceIds.includes(d.id))} />
          </li>
        ))}
      </ul>
    </div>
  );
}

function Observations() {
  const { house } = useStore();
  return (
    <section className="section">
      <header className="section-head">
        <h3>Latest observation per device</h3>
      </header>
      <div className="table-wrap">
        <table className="data-table">
          <thead>
            <tr>
              <th scope="col">Device</th>
              <th scope="col">Location</th>
              <th scope="col">Observed</th>
              <th scope="col">Retrieved</th>
              <th scope="col">Confidence</th>
            </tr>
          </thead>
          <tbody>
            {house.devices.map((d) => {
              const ob = latestObservation(house, d.id);
              return (
                <tr key={d.id}>
                  <th scope="row">
                    <EntityLink id={d.id} />
                  </th>
                  <td>{d.spaceId ? nameOf(house, d.spaceId) : <span className="muted">Unknown</span>}</td>
                  <td>{ob ? fmtDateTime(ob.observedAt) : 'Never'}</td>
                  <td>{ob ? fmtDateTime(ob.retrievedAt) : ''}</td>
                  <td>{ob ? <span className={`conf conf-${ob.confidence}`}>{ob.confidence}</span> : ''}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function endpointText(endpoint: NetworkEndpoint): string {
  const kind = endpoint.kind[0]!.toUpperCase() + endpoint.kind.slice(1);
  return [kind, endpoint.id ?? 'ID unknown', endpoint.description?.trim()].filter(Boolean).join(' · ');
}

/** Same freshness reading as the record Network section, per bound record. */
function networkNotice(entry: Entry): string {
  const states = entry.networkStates;
  const freshness = !states.length || states.some((state) => state === 'empty' || state === 'error')
    ? text('networkUnavailable')
    : states.includes('stale') ? text('networkSaved') : '';
  // A revoked source must not conceal the state of other bound sources.
  return [states.includes('access-revoked') ? text('networkDenied') : '', freshness].filter(Boolean).join(' ');
}

type RelationsStop = Exclude<NetworkRelationsRead['status'], 'ready'> | NetworkRelationsStop;
interface RelationsState {
  readonly binding: NetworkRelationsBinding;
  readonly view: ReadyView;
  readonly sequence: NetworkRelationsSequence | null;
  /** The sequence belongs to an earlier read that a reload has not replaced. */
  readonly earlier: boolean;
  readonly loading: 'first' | 'more' | null;
  readonly stop: RelationsStop | null;
}
const stopText: Record<RelationsStop, string> = {
  expired: 'Session expired.',
  denied: 'Access denied.',
  unavailable: 'Network relations are unavailable.',
  timedOut: 'Loading Network relations took too long and was stopped.',
  tooLarge: 'A page larger than this browser\'s 1 MiB limit was not loaded.',
  continuationUnavailable: 'Further pages could not be loaded.',
  invalid: 'Network relations could not be read in the expected format.',
  inconsistent: 'Source statuses changed between pages, so further pages were not loaded.',
  nonAdvancing: 'The server repeated an earlier continuation, so further pages were not loaded.',
  pageLimit: 'Browser limit of 40 pages reached. More relations exist but were not loaded.',
  itemLimit: 'Browser limit of 1,000 relations reached. More relations exist but were not loaded.',
  byteLimit: 'Browser limit of 8 MiB of loaded relations reached. More relations exist but were not loaded.',
};
// Access failures withhold every accepted page; other failures keep them.
const endsAccess = (stop: RelationsStop) => stop === 'expired' || stop === 'denied';
// The same continuation is offered again only after a transient failure.
const canContinue = (stop: RelationsStop | null) => stop === null || stop === 'unavailable' || stop === 'timedOut';
// Same exact pair as the prepared-view cacheKey.
const pairKey = (row: { readonly sourceInstanceId: string; readonly collectionId: string }) =>
  JSON.stringify([row.sourceInstanceId, row.collectionId]);
const plural = (n: number, one: string, many: string) => `${n.toLocaleString('en')} ${n === 1 ? one : many}`;

/** Original source and retrieval strings, shown verbatim. */
function Stamp({ value, absent = 'Unknown' }: { value: string | null; absent?: string }) {
  return value === null ? <span className="muted">{absent}</span> : <time dateTime={value}>{value}</time>;
}

/** Explicit paged read of saved Network relations; never on mount, tab or view change. */
function NetworkRelationsPanel({ client }: { readonly client: NetworkRelationsClient }) {
  const { projection } = useStore();
  const view = projection.view;
  const binding = useSyncExternalStore(client.subscribe, client.getBinding);
  const [stored, setStored] = useState<RelationsState | null>(null);
  const current = useRef<{ readonly binding: NetworkRelationsBinding | null; readonly view: ReadyView } | null>(null);
  const controller = useRef<AbortController | null>(null);
  useLayoutEffect(() => {
    current.current = { binding, view };
    return () => {
      current.current = null;
      controller.current?.abort();
      controller.current = null;
      setStored(null);
    };
  }, [binding, view]);
  // The completed scope must equal the rendered home in full. A read from a
  // prior session allocation, scope or ReadyView never renders.
  const qualified = binding !== null && binding.scope.workspaceId === view.scope.workspaceId
    && binding.scope.homeId === view.scope.homeId;
  const shown = qualified && stored !== null && stored.binding === binding && stored.view === view ? stored : null;
  const begin = (bound: NetworkRelationsBinding) => {
    const abort = new AbortController();
    controller.current = abort;
    const settle = (next: RelationsState) => {
      if (!abort.signal.aborted && current.current?.binding === bound && current.current.view === view
        && client.getBinding() === bound) setStored(next);
    };
    const done = () => { if (controller.current === abort) controller.current = null; };
    return { signal: abort.signal, settle, done };
  };
  // First page or reload. Earlier pages stay labelled until the new first page
  // is accepted, then are replaced, never concatenated.
  const load = () => {
    if (binding === null || !qualified || controller.current) return;
    const bound = binding, earlier = shown?.sequence ?? null;
    const { signal, settle, done } = begin(bound);
    const after = (stop: RelationsStop): RelationsState => endsAccess(stop)
      ? { binding: bound, view, sequence: null, earlier: false, loading: null, stop }
      : { binding: bound, view, sequence: earlier, earlier: earlier !== null, loading: null, stop };
    setStored({ binding: bound, view, sequence: earlier, earlier: earlier !== null, loading: 'first', stop: null });
    void client.read(bound, null, signal).then(
      result => settle(result.status === 'ready'
        ? { binding: bound, view, sequence: startSequence(result.page, result.bytes), earlier: false, loading: null, stop: null }
        : after(result.status)),
      () => settle(after('unavailable')),
    ).finally(done);
  };
  const loadMore = () => {
    if (binding === null || !qualified || controller.current || shown === null || shown.loading !== null || shown.earlier) return;
    const sequence = shown.sequence, cursor = sequence?.nextCursor ?? null;
    if (sequence === null || cursor === null || sequenceLimit(sequence) !== null || !canContinue(shown.stop)) return;
    const bound = binding;
    const { signal, settle, done } = begin(bound);
    const after = (stop: RelationsStop): RelationsState =>
      ({ binding: bound, view, sequence: endsAccess(stop) ? null : sequence, earlier: false, loading: null, stop });
    setStored({ ...shown, loading: 'more', stop: null });
    void client.read(bound, cursor, signal).then(result => {
      if (result.status !== 'ready') { settle(after(result.status)); return; }
      const next = extendSequence(sequence, result.page, result.bytes);
      settle(typeof next === 'string' ? after(next)
        : { binding: bound, view, sequence: next, earlier: false, loading: null, stop: null });
    }, () => settle(after('unavailable'))).finally(done);
  };
  const sequence = shown?.sequence ?? null;
  const loading = shown?.loading ?? null;
  const statuses = sequence?.sourceStatuses ?? [];
  // Only returned, scope-checked access-revoked pairs withhold relations.
  const revoked = new Set(statuses.filter(status => status.status === 'access-revoked').map(pairKey));
  const rows = (sequence?.pages ?? []).flatMap((page, pageIndex) =>
    page.items.map((item, itemIndex) => ({ key: `${pageIndex}:${itemIndex}`, item })));
  const visible = rows.filter(row => !revoked.has(pairKey(row.item)));
  const withheld = rows.length - visible.length;
  const empty = sequence !== null && rows.length === 0 && sequence.nextCursor === null;
  const continuing = sequence !== null && shown !== null && !shown.earlier && sequence.nextCursor !== null;
  const limit = continuing ? sequenceLimit(sequence) : null;
  const more = continuing && limit === null && canContinue(shown.stop);
  let message = '';
  if (!qualified) message = 'Network relations can be loaded once this home has finished loading.';
  else if (loading === 'first') message = 'Loading Network relations…';
  else if (loading === 'more') message = 'Loading more relations…';
  else if (shown?.stop) message = stopText[shown.stop];
  else if (empty) message = 'No Network relations saved for this home.';
  return <section className="section" aria-labelledby="network-relations-heading">
    <header className="section-head"><h2 id="network-relations-heading">Network relations</h2></header>
    <p className="muted">Loading reads saved relations only; nothing is collected or refreshed.</p>
    <p role="status">{message}</p>
    <p>
      <button className="btn btn-primary" type="button" aria-disabled={!qualified || loading !== null} onClick={load}>
        {loading === 'first' ? 'Loading Network relations' : sequence ? 'Reload from first page' : 'Load Network relations'}
      </button>
      {(more || loading === 'more') && <>{' '}<button className="btn" type="button" aria-disabled={loading !== null} onClick={loadMore}>
        {loading === 'more' ? 'Loading more relations' : 'Load more'}
      </button></>}
    </p>
    {sequence && <>
      {shown?.earlier && <p className="muted">Earlier read</p>}
      {!empty && <p>Showing {plural(visible.length, 'relation', 'relations')} from {plural(sequence.pages.length, 'page', 'pages')}.{sequence.nextCursor !== null && ' More relations exist.'}</p>}
      {limit && <Note tone="warn">{stopText[limit]}</Note>}
      {withheld > 0 && <Note tone="warn">{plural(withheld, 'relation', 'relations')} withheld because source access is revoked.</Note>}
      {visible.length > 0 && <div className="table-wrap"><table className="data-table"><thead><tr><th scope="col">Relation</th><th scope="col">From</th><th scope="col">To</th><th scope="col">Medium</th><th scope="col">Status</th><th scope="col">Observed</th><th scope="col">Retrieved</th><th scope="col">Source snapshot</th><th scope="col">Source revision</th><th scope="col">Source record</th><th scope="col">Vantage</th><th scope="col">Confidence</th><th scope="col">Basis</th><th scope="col">Notes</th></tr></thead><tbody>
        {visible.map(({ key, item }) => <tr key={key}>
          <th scope="row">{item.kind}</th><td>{endpointText(item.from)}</td><td>{endpointText(item.to)}</td><td>{item.medium === 'unknown' ? 'Unknown' : item.medium}</td><td>{item.temporalStatus}</td><td><Stamp value={item.factAt} /></td><td><Stamp value={item.retrievedAt} /></td><td><Stamp value={item.sourceSnapshotAt} /></td><td>{item.sourceRevision ?? 'Unknown'}</td><td>{item.externalId}</td><td>{item.vantage ?? 'Unknown'}</td><td>{item.sourceConfidence}</td><td>{item.evidenceBasis}</td><td>{item.notes}</td>
        </tr>)}
      </tbody></table></div>}
      <h3>Source statuses returned with this read</h3>
      {statuses.length ? <div className="table-wrap"><table className="data-table"><thead><tr><th scope="col">Source instance</th><th scope="col">Collection</th><th scope="col">Status</th><th scope="col">Last successful fetch</th><th scope="col">Last attempt</th><th scope="col">Error</th></tr></thead><tbody>
        {statuses.map((status, index) => status.status === 'access-revoked'
          ? <tr key={index}><td colSpan={6}>Access revoked</td></tr>
          : <tr key={index}><td>{status.sourceInstanceId}</td><td>{status.collectionId}</td><td>{status.status}</td><td><Stamp value={status.lastSuccessfulFetchAt} absent="Never" /></td><td><Stamp value={status.lastAttemptAt} absent="Never" /></td><td>{status.error ? <>{status.error.code} · <Stamp value={status.error.at} /></> : 'None'}</td></tr>)}
      </tbody></table></div> : <p className="muted">No source statuses were returned with this read.</p>}
    </>}
  </section>;
}

function SavedRelations({ entries }: { entries: Entry[] }) {
  return <section aria-labelledby="saved-relations-heading">
    <header className="section-head"><h2 id="saved-relations-heading">Relations in the saved view</h2></header>
    {entries.map((entry) => {
    const notice = networkNotice(entry);
    return <section key={entry.key} className="section">
      <header className="section-head"><h3>{entry.entity.name}</h3></header>
      {notice && <Note tone="warn">{notice}</Note>}
      {entry.networkRelations.length ? <div className="table-wrap"><table className="data-table"><thead><tr><th scope="col">Relation</th><th scope="col">From</th><th scope="col">To</th><th scope="col">Medium</th><th scope="col">Status</th><th scope="col">Observed</th><th scope="col">Retrieved</th><th scope="col">Source snapshot</th><th scope="col">Source revision</th><th scope="col">Vantage</th><th scope="col">Confidence / basis</th></tr></thead><tbody>
        {entry.networkRelations.map((relation, index) => <tr key={`${entry.key}:${index}`}>
          <th scope="row">{relation.kind}</th><td>{endpointText(relation.from)}</td><td>{endpointText(relation.to)}</td><td>{relation.medium === 'unknown' ? 'Unknown' : relation.medium}</td><td>{relation.temporalStatus}</td><td>{relation.factAt ? fmtDateTime(relation.factAt) : 'Unknown'}</td><td>{fmtDateTime(relation.retrievedAt)}</td><td>{relation.sourceSnapshotAt ? fmtDateTime(relation.sourceSnapshotAt) : 'Unknown'}</td><td>{relation.sourceRevision ?? 'Unknown'}</td><td>{relation.vantage ?? 'Unknown'}</td><td>{relation.sourceConfidence ?? 'Unknown'} / {relation.evidenceBasis ?? 'Unknown'}{relation.notes && <p>{relation.notes}</p>}</td>
        </tr>)}
      </tbody></table></div> : <Empty>No saved relations for this record.</Empty>}
    </section>;
  })}
  </section>;
}
