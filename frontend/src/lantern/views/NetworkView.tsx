import { useState, type KeyboardEvent } from 'react';
import type { Device } from '../data/types';
import { latestObservation, nameOf } from '../data/query';
import { fmtDateTime, rel } from '../data/time';
import { useSelect, useStore } from '../state/store';
import { LAYER } from '../atlas/palette';
import { ClaimBadge, EntityLink, Empty, Note } from '../components/ui';
import { DocList } from '../components/rows';

export function NetworkView() {
  const { house, projection } = useStore();
  const [tab, setTab] = useState<'logical' | 'cabling'>('logical');
  return (
    <div className="view">
      <header className="view-head">
        <h1>Network</h1>
        <p>
          Saved Network relations are read-only. Observation dates and retrieval dates remain distinct.
        </p>
      </header>
      <div className="seg seg-wide" role="tablist" aria-label="Network views">
        <button type="button" role="tab" aria-selected={tab === 'logical'} aria-controls="net-panel" onClick={() => setTab('logical')}>
          Observed links
        </button>
        <button type="button" role="tab" aria-selected={tab === 'cabling'} aria-controls="net-panel" onClick={() => setTab('cabling')}>
          Documented cabling
        </button>
      </div>
      <div id="net-panel" role="tabpanel">
        {tab === 'logical' ? projection.view.entries.some(entry => entry.networkRelations.length) ? <SavedRelations /> : <Empty>No Network relation projection is supplied.</Empty> : <Cabling />}
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

function SavedRelations() {
  const { projection } = useStore();
  return <div className="table-wrap"><table className="data-table"><thead><tr><th scope="col">Record</th><th scope="col">Relation</th><th scope="col">Status</th><th scope="col">Observed</th><th scope="col">Retrieved</th><th scope="col">Confidence / basis</th></tr></thead><tbody>
    {projection.view.entries.flatMap(entry => entry.networkRelations.map((relation, index) => <tr key={`${entry.key}:${index}`}>
      <th scope="row">{entry.entity.name}</th><td>{relation.kind}</td><td>{relation.temporalStatus}</td><td>{relation.factAt ? fmtDateTime(relation.factAt) : 'Unknown'}</td><td>{fmtDateTime(relation.retrievedAt)}</td><td>{relation.sourceConfidence ?? 'Unknown'} / {relation.evidenceBasis ?? 'Unknown'}<p>{relation.notes}</p></td>
    </tr>))}
  </tbody></table></div>;
}
