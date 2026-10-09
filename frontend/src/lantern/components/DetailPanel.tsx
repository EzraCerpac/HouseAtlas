import type { ReactNode } from 'react';
import type {
  CableRun,
  Circuit,
  Container,
  Device,
  Doc,
  HouseData,
  Item,
  Outlet,
  Panel,
  Space,
  Task,
  Valve,
} from '../data/types';
import {
  breadcrumb,
  docsFor,
  dueState,
  findSpace,
  getRecord,
  latestObservation,
  nameOf,
  roomContents,
  tasksFor,
  unplaced,
} from '../data/query';
import { fmtDate, fmtDateTime, rel } from '../data/time';
import { useCanWrite, useSelect, useStore } from '../state/store';
import { Icon } from './Icon';
import { ItemArt, MediaScene } from './Art';
import { ClaimBadge, EntityLink, Empty, KindTag, Note, Section, StorageTag, WritePill } from './ui';
import { DocList, HistoryList, IdentityBlock, ObservationList, PendingWrites, TaskList } from './rows';

export function DetailPanel() {
  const { state, house } = useStore();
  const sel = state.selection;
  if (!sel) return <Overview />;
  const rec = getRecord(house, sel.id);
  if (!rec) return <Overview />;
  switch (sel.kind) {
    case 'space':
      return <SpaceDetail space={rec as Space} />;
    case 'item':
    case 'unknown':
      return <ItemDetail item={rec as Item} />;
    case 'container':
      return <ContainerDetail c={rec as Container} />;
    case 'panel':
      return <PanelDetail p={rec as Panel} />;
    case 'circuit':
      return <CircuitDetail c={rec as Circuit} />;
    case 'outlet':
      return <OutletDetail o={rec as Outlet} />;
    case 'valve':
      return <ValveDetail v={rec as Valve} />;
    case 'device':
      return <DeviceDetail d={rec as Device} />;
    case 'cable':
      return <CableDetail c={rec as CableRun} />;
    case 'doc':
      return <DocDetail d={rec as Doc} />;
    case 'task':
      return <TaskDetail t={rec as Task} />;
    default:
      return <Overview />;
  }
}

function Shell({ id, kind, title, claim, actions, children, lead }: { id: string; kind: Parameters<typeof KindTag>[0]['kind']; title: string; claim?: ReactNode; actions?: ReactNode; children: ReactNode; lead?: ReactNode }) {
  const { house, projection } = useStore();
  const select = useSelect();
  const source = projection.entries.get(id);
  const crumbs = breadcrumb(house, id);
  return (
    <article className="detail" aria-labelledby="detail-title">
      <header className="detail-head">
        <div className="detail-kicker">
          {kind === 'space' && source ? <span className="kind-tag">{source.semanticKind === 'room' ? 'Room' : 'Place'}</span> : <KindTag kind={kind} />}
          {claim}
          <button type="button" className="icon-btn detail-close" aria-label="Close details" onClick={() => select(null)}>
            <Icon name="close" size={18} />
          </button>
        </div>
        <h2 id="detail-title" className="detail-title" tabIndex={-1}>
          {title}
        </h2>
        {crumbs.length > 0 && (
          <p className="crumbs">
            {crumbs.map((c, i) => (
              <span key={i}>{c}</span>
            ))}
          </p>
        )}
        {lead}
        {actions && <div className="detail-actions">{actions}</div>}
        <PendingWrites id={id} />
      </header>
      <div className="detail-body">{children}</div>
    </article>
  );
}

function WriteButton({ system, children, onClick, primary }: { system: 'HomeBox' | 'Atlas'; children: ReactNode; onClick: () => void; primary?: boolean }) {
  const can = useCanWrite(system);
  return (
    <button type="button" className={`btn${primary ? ' btn-primary' : ''}`} disabled={!can.ok} title={can.reason} onClick={onClick}>
      {children}
    </button>
  );
}

function OutageHint() {
  const can = useCanWrite('HomeBox');
  if (can.ok) return null;
  return <Note tone="warn">{can.reason}</Note>;
}

function Facts({ rows }: { rows: [string, ReactNode][] }) {
  const shown = rows.filter(([, v]) => v !== undefined && v !== null && v !== '');
  return (
    <dl className="facts">
      {shown.map(([k, v]) => (
        <div key={k}>
          <dt>{k}</dt>
          <dd>{v}</dd>
        </div>
      ))}
    </dl>
  );
}

// ---------------- Overview (nothing selected) ----------------

function Overview() {
  const { state, house, dispatch } = useStore();
  const overdue = house.tasks.filter((t) => dueState(t, house.displayNow) === 'overdue');
  const soon = house.tasks.filter((t) => dueState(t, house.displayNow) === 'soon');
  const review = house.writes.filter((w) => w.status === 'conflict' || w.status === 'uncertain');
  const inFlight = house.writes.filter((w) => w.status === 'queued' || w.status === 'running');
  const disputed = [
    ...house.items.filter((i) => i.locationClaim === 'disputed'),
    ...house.circuits.filter((c) => c.claim === 'disputed'),
    ...house.outlets.filter((o) => o.claim === 'disputed'),
  ];
  const un = unplaced(house);
  return (
    <article className="detail overview" aria-labelledby="overview-title">
      <header className="detail-head">
        <p className="overview-kicker">Household atlas</p>
        <h2 id="overview-title" className="detail-title overview-title">
          {house.name}
        </h2>

      </header>
      <div className="detail-body">
        <Section title="Needs attention" count={overdue.length + review.length + disputed.length}>
          <ul className="attention">
            {review.map((w) => (
              <li key={w.id}>
                <WritePill status={w.status} />
                <button
                  type="button"
                  className="row-title"
                  onClick={() =>
                    w.status === 'conflict' ? dispatch({ type: 'dialog', dialog: { type: 'conflict', writeId: w.id } }) : dispatch({ type: 'view', view: 'changes', focus: w.id })
                  }
                >
                  {w.title}
                </button>
              </li>
            ))}
            {overdue.map((t) => (
              <li key={t.id}>
                <span className="write-pill write-conflict">Overdue</span>
                <EntityLink id={t.id} sub={`Was due ${fmtDate(t.due)}`} />
              </li>
            ))}
            {disputed.map((r) => (
              <li key={r.id}>
                <ClaimBadge claim="disputed" />
                <EntityLink id={r.id} />
              </li>
            ))}
            {overdue.length + review.length + disputed.length === 0 && <li className="empty">No attention flags in the supplied view.</li>}
          </ul>
        </Section>
        {inFlight.length > 0 && (
          <Section title="Being saved" count={inFlight.length}>
            <ul className="attention">
              {inFlight.map((w) => (
                <li key={w.id}>
                  <WritePill status={w.status} />
                  <span>{w.title}</span>
                </li>
              ))}
            </ul>
          </Section>
        )}
        <Section title="Coming up" count={soon.length}>
          <TaskList tasks={soon} showTarget empty="Nothing due in the next two weeks." />
        </Section>
        <Section title="Not on the plan">
          <p className="body-text">
            {un.noRoomItems.length} records have no reviewed placement in this view.
          </p>
          <button type="button" className="text-btn" onClick={() => dispatch({ type: 'view', view: 'rooms' })}>
            Review them in Rooms
          </button>
        </Section>
        <Sources house={house} outage={state.settings.outage} />
      </div>
    </article>
  );
}

export function Sources({ house: _house, outage: _outage }: { house: HouseData; outage: boolean }) {
  const { projection } = useStore();
  return <Section title="Sources"><dl className="facts sources">
    {projection.view.caches.map((cache, index) => <div key={index}>
      <dt>{cache.owner === 'homebox' ? 'HomeBox' : 'Network'}</dt>
      <dd>{cache.displayStatus}. Last successful update: {cache.lastSuccessfulFetchAt ? fmtDateTime(cache.lastSuccessfulFetchAt) : 'Unknown'}.
        {cache.sourceInstanceId && <code>{cache.sourceInstanceId}</code>}
        {cache.collectionId && <code>{cache.collectionId}</code>}
      </dd>
    </div>)}
    {!projection.view.caches.length && <div><dt>Saved sources</dt><dd>No cache information supplied.</dd></div>}
    <div><dt>Geometry</dt><dd>No reviewed shape projection supplied.</dd></div>
  </dl></Section>;
}

// ---------------- Room ----------------

function SpaceDetail({ space }: { space: Space }) {
  const { house } = useStore();
  const c = roomContents(house, space.id);
  const looseItems = c.items.filter((i) => !i.containerId);
  const byCircuit = new Map<string, Outlet[]>();
  for (const o of c.outlets) {
    const key = o.circuitId ?? 'none';
    byCircuit.set(key, [...(byCircuit.get(key) ?? []), o]);
  }
  const scheduled = c.tasks.filter((t) => t.status === 'scheduled');
  return (
    <Shell
      id={space.id}
      kind="space"
      title={space.name}
      lead={
        <>
          {space.note && <p className="lead">{space.note}</p>}
          <ul className="tally" aria-label="Related records">
            <li>
              <strong>{c.items.length}</strong> belongings
            </li>
            <li>
              <strong>{c.docs.length}</strong> documents
            </li>
            <li>
              <strong>{scheduled.length}</strong> upkeep due
            </li>
            <li>
              <strong>{c.outlets.length + c.valves.length + c.panels.length}</strong> fixtures
            </li>
          </ul>
        </>
      }
    >
      {space.geometry === 'none' && <Note>No reviewed shape projection is available.</Note>}
      <Section title="Belongings" count={c.items.length}>
        {c.items.length === 0 && <Empty>No reviewed item placements are supplied for this place.</Empty>}
        <ul className="rows">
          {looseItems.map((i) => (
            <li key={i.id} className="link-row">
              <EntityLink id={i.id} sub={i.pos ? i.category : `${i.category}, spot not recorded`} />
              {i.locationClaim !== 'confirmed' && <ClaimBadge claim={i.locationClaim} />}
            </li>
          ))}
        </ul>
        {c.containers.map((ct) => {
          const inside = house.items.filter((i) => i.containerId === ct.id);
          return (
            <div key={ct.id} className="storage-group">
              <EntityLink id={ct.id} sub={`${ct.kind}, storage inside this room`} />
              <ul className="rows nested">
                {inside.map((i) => (
                  <li key={i.id} className="link-row">
                    <EntityLink id={i.id} sub={i.category} />
                  </li>
                ))}
                {!inside.length && <li className="empty">Empty, as far as recorded.</li>}
              </ul>
            </div>
          );
        })}
      </Section>
      {(c.outlets.length > 0 || c.panels.length > 0) && (
        <Section title="Electrical" count={c.outlets.length + c.panels.length}>
          {c.panels.map((p) => (
            <EntityLink key={p.id} id={p.id} sub="Electrical panel" />
          ))}
          {[...byCircuit.entries()].map(([cid, outs]) => {
            const circ = house.circuits.find((x) => x.id === cid);
            return (
              <div key={cid} className="circuit-group">
                <p className="group-label">
                  <span className="swatch round" style={{ background: circ?.color ?? '#8A8F9C' }} aria-hidden="true" />
                  {circ ? `${circ.ref} ${circ.label}` : 'No documented circuit'}
                </p>
                <ul className="chips">
                  {outs.map((o) => (
                    <li key={o.id}>
                      <EntityLink id={o.id} label={o.label} />
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}
        </Section>
      )}
      {c.valves.length > 0 && (
        <Section title="Water and valves" count={c.valves.length}>
          <ul className="rows">
            {c.valves.map((v) => (
              <li key={v.id} className="link-row">
                <EntityLink id={v.id} sub={`Documented: ${v.documentedState.toLowerCase()}`} />
                {!v.pos && <span className="mini-claim claim-unknown">No position</span>}
              </li>
            ))}
          </ul>
        </Section>
      )}
      {c.devices.length > 0 && (
        <Section title="Network devices" count={c.devices.length}>
          <ul className="rows">
            {c.devices.map((d) => {
              const ob = latestObservation(house, d.id);
              return (
                <li key={d.id} className="link-row">
                  <EntityLink id={d.id} sub={ob ? `Last observed ${rel(ob.observedAt, house.displayNow)}` : 'No observations'} />
                </li>
              );
            })}
          </ul>
        </Section>
      )}
      <Section title="Documents and photos" count={c.docs.length}>
        <DocList docs={c.docs} showLinked />
      </Section>
      <Section title="Upkeep" count={c.tasks.length}>
        <TaskList tasks={c.tasks} showTarget />
      </Section>
      <Section title="Identity and sources">
        <IdentityBlock
          id={space.id}
          rows={[
            ['HomeBox location', space.homeboxRef ? space.homeboxRef : 'Not bound'],
            ['Shape', space.geometry === 'reviewed' ? `Reviewed, from ${nameOf(house, space.geometrySourceId ?? '')}` : 'No reviewed shape'],
            ...((space.formerNames ?? []).map((f) => ['Former name', `${f.name}, until ${fmtDate(f.until)}`]) as [string, string][]),
          ]}
        />
      </Section>
      <Section title="History">
        <HistoryList id={space.id} />
      </Section>
    </Shell>
  );
}

// ---------------- Belonging and unclassified source record ----------------

function ItemDetail({ item }: { item: Item }) {
  const { house, dispatch, projection } = useStore();
  const isUnknown = item.id.startsWith('uk-');
  const source = projection.entries.get(item.id);
  const docs = docsFor(house, item.id);
  const tasks = tasksFor(house, item.id);
  const load = house.loads.find((l) => l.itemId === item.id);
  const outlet = load ? house.outlets.find((o) => o.id === load.outletId) : undefined;
  const circuit = outlet?.circuitId ? house.circuits.find((c) => c.id === outlet.circuitId) : undefined;
  const device = house.devices.find((d) => d.itemId === item.id);
  const ob = device ? latestObservation(house, device.id) : undefined;
  const sp = findSpace(house, item.spaceId);
  const ct = house.containers.find((c) => c.id === item.containerId);
  return (
    <Shell
      id={item.id}
      kind={isUnknown ? 'unknown' : 'item'}
      title={item.name}
      claim={<ClaimBadge claim={item.locationClaim} prefix="Location" />}
      lead={
        <div className="item-lead">
          {!isUnknown && <ItemArt kind={item.illustration} label="Generic item illustration" />}
          <Facts
            rows={[
              [isUnknown ? 'Source type' : 'Category', item.category],
              ['Model', item.model],
              ['Serial', item.serial],
              ['Acquired', item.acquired ? fmtDate(item.acquired) : undefined],
              ['Note', item.note],
            ]}
          />
        </div>
      }
      actions={
        isUnknown ? undefined : <>
          <WriteButton system="HomeBox" primary onClick={() => dispatch({ type: 'dialog', dialog: { type: 'editItem', itemId: item.id } })}>
            <Icon name="edit" size={16} /> Edit
          </WriteButton>
          <WriteButton system="Atlas" onClick={() => dispatch({ type: 'dialog', dialog: { type: 'link', targetId: item.id } })}>
            <Icon name="link" size={16} /> Link document
          </WriteButton>
          <WriteButton system="HomeBox" onClick={() => dispatch({ type: 'dialog', dialog: { type: 'media', targetId: item.id } })}>
            <Icon name="photo" size={16} /> Add photo
          </WriteButton>
        </>
      }
    >
      <OutageHint />
      <Section title="Location">
        {sp ? (
          <p className="body-text">
            {ct ? (
              <>
                Inside <EntityLink id={ct.id} /> in <EntityLink id={sp.id} />
              </>
            ) : (
              <>
                In <EntityLink id={sp.id} />
                {!item.pos && sp.geometry === 'reviewed' ? ', exact spot not recorded' : ''}
              </>
            )}
          </p>
        ) : (
          <Note tone="warn">No reviewed placement is supplied in this view.</Note>
        )}
        {item.locationNote && <p className="body-text muted">{item.locationNote}</p>}
      </Section>
      {!isUnknown && <Section title="Power">
        {load && outlet ? (
          <>
            <ol className="chain" aria-label="Documented power connection">
              <li>
                <span className="chain-label">Plugged into</span>
                <EntityLink id={outlet.id} sub={outlet.kind} />
                <ClaimBadge claim={load.claim} />
              </li>
              <li>
                <span className="chain-label">On circuit</span>
                {circuit ? <EntityLink id={circuit.id} sub={`${circuit.rating}, ${circuit.protection}`} /> : <span className="body-text">Not documented</span>}
                {circuit ? <ClaimBadge claim={circuit.claim} /> : <ClaimBadge claim="unknown" />}
              </li>
            </ol>
            {load.note && <p className="body-text muted">{load.note}</p>}
            <p className="fine">Documented connection, not a traced cable route.</p>
          </>
        ) : (
          <Empty>No outlet projection is supplied in this view.</Empty>
        )}
      </Section>}
      {device && (
        <Section title="On the network">
          <EntityLink id={device.id} sub={ob ? `Last observed ${fmtDateTime(ob.observedAt)}` : 'No observations'} />
          <p className="fine">Matched to this belonging in Atlas. Observations are read-only.</p>
        </Section>
      )}
      <Section title="Manuals, receipts and photos" count={docs.length}>
        <DocList docs={docs} />
      </Section>
      <Section
        title="Upkeep"
        count={tasks.length}
        action={!isUnknown ? (
          <WriteButton system="HomeBox" onClick={() => dispatch({ type: 'dialog', dialog: { type: 'schedule', targetId: item.id } })}>
            <Icon name="calendar" size={15} /> Schedule
          </WriteButton>
        ) : undefined}
      >
        <TaskList tasks={tasks} />
      </Section>
      <Section title="Identity and sources">
        <IdentityBlock
          id={item.id}
          rows={[
            [isUnknown ? 'Source record' : 'HomeBox item', item.homeboxRef],
            ...(source ? [['Source state', source.sourceState], ['Cache status', source.cacheStatus]] as [string, string][] : []),
            ...(!isUnknown ? [['Owned by', 'HomeBox keeps the record, files and upkeep. Atlas keeps placement and links.']] as [string, string][] : []),
          ]}
        />
      </Section>
      <Section title="History">
        <HistoryList id={item.id} />
      </Section>
    </Shell>
  );
}

// ---------------- Storage ----------------

function ContainerDetail({ c }: { c: Container }) {
  const { house } = useStore();
  const inside = house.items.filter((i) => i.containerId === c.id);
  return (
    <Shell id={c.id} kind="container" title={c.name}>
      <Note>Storage inside a room, not a room itself. Belongings here are counted in {nameOf(house, c.spaceId)} too.</Note>
      <Section title="Inside" count={inside.length}>
        {inside.length ? (
          <ul className="rows">
            {inside.map((i) => (
              <li key={i.id} className="link-row">
                <EntityLink id={i.id} sub={i.category} />
              </li>
            ))}
          </ul>
        ) : (
          <Empty>Nothing recorded inside.</Empty>
        )}
      </Section>
      <Section title="Details">
        <Facts rows={[['Kind', c.kind], ['Room', <EntityLink key="r" id={c.spaceId} />], ['Note', c.note]]} />
      </Section>
      <Section title="Identity and sources">
        <IdentityBlock id={c.id} rows={[['HomeBox location', `${c.homeboxRef} (demo), revision ${c.rev}`]]} />
      </Section>
      <Section title="History">
        <HistoryList id={c.id} />
      </Section>
    </Shell>
  );
}

// ---------------- Electrical ----------------

function PanelDetail({ p }: { p: Panel }) {
  const { house } = useStore();
  const circuits = house.circuits.filter((c) => c.panelId === p.id);
  return (
    <Shell id={p.id} kind="panel" title={p.name} claim={<ClaimBadge claim={p.claim} />}>
      {p.note && <p className="lead">{p.note}</p>}
      <Section title="Documented circuits" count={circuits.length}>
        <ul className="rows">
          {circuits.map((c) => (
            <li key={c.id} className="link-row">
              <span className="swatch round" style={{ background: c.color }} aria-hidden="true" />
              <EntityLink id={c.id} sub={`${c.rating}, ${c.protection}`} />
              <ClaimBadge claim={c.claim} />
            </li>
          ))}
        </ul>
        <p className="fine">Labels and report entries only. Atlas never shows live power or guesses wiring.</p>
      </Section>
      <Section title="Evidence" count={p.evidenceIds.length}>
        <DocList docs={house.docs.filter((d) => p.evidenceIds.includes(d.id))} />
      </Section>
      <Section title="Upkeep">
        <TaskList tasks={tasksFor(house, p.id)} />
      </Section>
      <Section title="Identity and sources">
        <IdentityBlock id={p.id} rows={[['Kept by', 'Atlas']]} />
      </Section>
    </Shell>
  );
}

function CircuitDetail({ c }: { c: Circuit }) {
  const { house } = useStore();
  const outlets = house.outlets.filter((o) => o.circuitId === c.id);
  const loads = house.loads.filter((l) => outlets.some((o) => o.id === l.outletId));
  return (
    <Shell id={c.id} kind="circuit" title={`${c.ref} ${c.label}`} claim={<ClaimBadge claim={c.claim} />}>
      <p className="lead">{c.claimNote}</p>
      <Section title="Details">
        <Facts rows={[['Panel', <EntityLink key="p" id={c.panelId} />], ['Rating', c.rating], ['Protection', c.protection]]} />
      </Section>
      <Section title="Outlets documented on this circuit" count={outlets.length}>
        {outlets.length ? (
          <ul className="rows">
            {outlets.map((o) => (
              <li key={o.id} className="link-row">
                <EntityLink id={o.id} sub={`${o.kind}, ${nameOf(house, o.spaceId)}`} />
                {o.claim !== 'confirmed' && <ClaimBadge claim={o.claim} />}
              </li>
            ))}
          </ul>
        ) : (
          <Empty>No outlets are documented on this circuit.</Empty>
        )}
        <p className="fine">Membership comes from labels and reports. The model colours outlets but never draws a cable route.</p>
      </Section>
      {loads.length > 0 && (
        <Section title="Documented loads" count={loads.length}>
          <ul className="rows">
            {loads.map((l) => (
              <li key={l.id} className="link-row">
                <EntityLink id={l.itemId} sub={`via ${nameOf(house, l.outletId)}`} />
                <ClaimBadge claim={l.claim} />
              </li>
            ))}
          </ul>
        </Section>
      )}
      <Section title="Evidence" count={c.evidenceIds.length}>
        <DocList docs={house.docs.filter((d) => c.evidenceIds.includes(d.id))} />
      </Section>
      <Section title="History">
        <HistoryList id={c.id} />
      </Section>
    </Shell>
  );
}

function OutletDetail({ o }: { o: Outlet }) {
  const { house } = useStore();
  const c = house.circuits.find((x) => x.id === o.circuitId);
  const loads = house.loads.filter((l) => l.outletId === o.id);
  return (
    <Shell id={o.id} kind="outlet" title={`Outlet ${o.label}`} claim={<ClaimBadge claim={o.claim} />}>
      {o.note && <p className="lead">{o.note}</p>}
      <Section title="Details">
        <Facts
          rows={[
            ['Kind', o.kind],
            ['Circuit', c ? <EntityLink key="c" id={c.id} /> : 'Not documented'],
            ['Position', o.pos ? 'Placed on the plan' : 'Room only'],
          ]}
        />
      </Section>
      <Section title="Plugged in here" count={loads.length}>
        {loads.length ? (
          <ul className="rows">
            {loads.map((l) => (
              <li key={l.id} className="link-row">
                <EntityLink id={l.itemId} />
                <ClaimBadge claim={l.claim} />
              </li>
            ))}
          </ul>
        ) : (
          <Empty>Nothing documented as plugged in.</Empty>
        )}
      </Section>
      <Section title="Evidence" count={o.evidenceIds.length}>
        <DocList docs={house.docs.filter((d) => o.evidenceIds.includes(d.id))} empty="No evidence attached. The claim rests on what was reported." />
      </Section>
    </Shell>
  );
}

// ---------------- Water ----------------

function ValveDetail({ v }: { v: Valve }) {
  const { house } = useStore();
  const docs = house.docs.filter((d) => v.evidenceIds.includes(d.id) || d.linkedTo.includes(v.id));
  return (
    <Shell id={v.id} kind="valve" title={v.name} claim={<ClaimBadge claim={v.locationClaim} prefix="Location" />}>
      {v.note && <p className="lead">{v.note}</p>}
      {!v.pos && <Note tone="warn">Not placed on the plan. {v.spaceId ? `Recorded in ${nameOf(house, v.spaceId)} only.` : 'No room recorded.'}</Note>}
      <Section title="What it does">
        <Facts
          rows={[
            ['Kind', v.kind],
            ['Serves', v.serves],
            [
              'Documented state',
              <span key="s" className="state-line">
                {v.documentedState} <ClaimBadge claim={v.stateClaim} />
              </span>,
            ],
            ['State recorded', v.stateObservedAt ? `${fmtDateTime(v.stateObservedAt)} (${rel(v.stateObservedAt, house.displayNow)})` : 'Never'],
          ]}
        />
        <p className="fine">This is the last recorded state, not a live reading. Atlas does not trace where water flows.</p>
      </Section>
      <Section title="Evidence and guides" count={docs.length}>
        <DocList docs={docs} />
      </Section>
      <Section title="Upkeep">
        <TaskList tasks={tasksFor(house, v.id)} />
      </Section>
      <Section title="Identity and sources">
        <IdentityBlock id={v.id} rows={[['Kept by', 'Atlas']]} />
      </Section>
      <Section title="History">
        <HistoryList id={v.id} />
      </Section>
    </Shell>
  );
}

// ---------------- Network ----------------

function DeviceDetail({ d }: { d: Device }) {
  const { house, dispatch } = useStore();
  const links = house.links.filter((l) => l.from === d.id || l.to === d.id);
  const cables = house.cables.filter((c) => c.fromId === d.id || c.toId === d.id);
  const ob = latestObservation(house, d.id);
  const stale = !ob || ob.observedAt < house.sources.networkObservedAt;
  return (
    <Shell
      id={d.id}
      kind="device"
      title={d.name}
      claim={<ClaimBadge claim={d.locationClaim} prefix="Location" />}
      actions={
        <button type="button" className="btn" onClick={() => dispatch({ type: 'view', view: 'network' })}>
          <Icon name="network" size={16} /> Show in topology
        </button>
      }
    >
      <Note>Read-only observations from the network import. {stale ? 'Not in the latest export. That does not mean it was removed or switched off.' : 'Present in the latest export.'}</Note>
      <Section title="Details">
        <Facts
          rows={[
            ['Kind', d.kind],
            ['Hardware', d.hardware],
            ['Belonging', d.itemId ? <EntityLink key="i" id={d.itemId} /> : 'Not matched'],
            ['Note', d.note],
          ]}
        />
      </Section>
      <Section title="Observations" count={d.observations.length}>
        <ObservationList obs={d.observations} />
      </Section>
      <Section title="Logical links" count={links.length}>
        {links.length ? (
          <ul className="rows">
            {links.map((l) => {
              const other = l.from === d.id ? l.to : l.from;
              return (
                <li key={l.id} className="link-row">
                  <EntityLink id={other} sub={`${l.kind === 'wired' ? 'Wired' : 'Wireless'}, observed ${rel(l.observedAt, house.displayNow)}, ${l.confidence} confidence`} />
                </li>
              );
            })}
          </ul>
        ) : (
          <Empty>No logical links observed.</Empty>
        )}
      </Section>
      <Section title="Documented cabling" count={cables.length}>
        {cables.length ? (
          <ul className="rows">
            {cables.map((c) => (
              <li key={c.id} className="link-row">
                <EntityLink id={c.id} sub={c.medium} />
                <ClaimBadge claim={c.claim} />
              </li>
            ))}
          </ul>
        ) : (
          <Empty>No physical cabling documented. Logical links above are not cable runs.</Empty>
        )}
      </Section>
      <Section title="Identity and sources">
        <IdentityBlock id={d.id} rows={[['Matched by', 'Hardware ID in the router export (demo)']]} />
      </Section>
      <Section title="History">
        <HistoryList id={d.id} />
      </Section>
    </Shell>
  );
}

function CableDetail({ c }: { c: CableRun }) {
  const { house } = useStore();
  return (
    <Shell id={c.id} kind="cable" title={c.name} claim={<ClaimBadge claim={c.claim} />}>
      <p className="lead">{c.note}</p>
      <Section title="Ends">
        <Facts rows={[['From', <EntityLink key="f" id={c.fromId} />], ['To', <EntityLink key="t" id={c.toId} />], ['Medium', c.medium]]} />
        <p className="fine">Owner-documented physical cabling. Kept separate from the observed logical topology.</p>
      </Section>
      <Section title="Evidence" count={c.evidenceIds.length}>
        <DocList docs={house.docs.filter((d) => c.evidenceIds.includes(d.id))} />
      </Section>
    </Shell>
  );
}

// ---------------- Document ----------------

function DocDetail({ d }: { d: Doc }) {
  const { house, dispatch, projection } = useStore();
  const access = projection.docAccess.get(d.id);
  return (
    <Shell
      id={d.id}
      kind="doc"
      title={d.title}
      claim={<StorageTag doc={d} />}
      actions={
        <button type="button" className="btn btn-primary" onClick={() => dispatch({ type: 'dialog', dialog: { type: 'preview', docId: d.id } })}>
          {d.storage === 'link' ? (
            <>
              <Icon name="link" size={16} /> Link details
            </>
          ) : (
            <>
              <Icon name="file" size={16} /> File details
            </>
          )}
        </button>
      }
    >
      {d.preview === 'media' && d.mediaVariant && (
        <div className="media-frame">
          <MediaScene scene={d.mediaVariant} />
        </div>
      )}
      {d.storage === 'link' ? (
        <Note>An external address only. No stored copy is supplied.</Note>
      ) : (
        <Note>HomeBox file. {access?.available ? 'An access link is supplied.' : 'No access link is supplied.'}</Note>
      )}
      {d.summary && <p className="body-text">{d.summary}</p>}
      <Section title="Provenance">
        <Facts
          rows={[
            ['Source', d.source],
            ['Added', d.addedAt ? `${fmtDateTime(d.addedAt)} by ${d.addedBy}` : 'Unknown'],
            ['Captured', d.capturedAt ? fmtDateTime(d.capturedAt) : undefined],
            ['Retrieved', d.retrievedAt ? fmtDateTime(d.retrievedAt) : undefined],
            ['File', d.fileName ? `${d.fileName}${d.pages ? `, ${d.pages} pages` : ''}` : undefined],
            ['Address', d.url ? <span className="url" key="u">{d.url}</span> : undefined],
            ['Link checked', d.linkCheckedAt ? `${fmtDate(d.linkCheckedAt)} (${rel(d.linkCheckedAt, house.displayNow)})` : undefined],
            ['Kept by', d.owner],
          ]}
        />
      </Section>
      {d.versions && (
        <Section title="Versions" count={d.versions.length}>
          <ol className="history">
            {[...d.versions].reverse().map((v) => (
              <li key={v.v}>
                <span className="history-when">
                  Version {v.v}, {fmtDateTime(v.at)}
                </span>
                <span className="history-what">{v.note}</span>
                {v.v === d.version && <span className="history-who">Current</span>}
              </li>
            ))}
          </ol>
        </Section>
      )}
      <Section title="Linked to" count={d.linkedTo.length}>
        {d.linkedTo.length ? (
          <ul className="rows">
            {d.linkedTo.map((l) => (
              <li key={l} className="link-row">
                <EntityLink id={l} />
              </li>
            ))}
          </ul>
        ) : (
          <Empty>Not linked to a record. It is used as the source for reviewed room shapes.</Empty>
        )}
      </Section>
    </Shell>
  );
}

// ---------------- Upkeep task ----------------

function TaskDetail({ t }: { t: Task }) {
  const { house, dispatch } = useStore();
  const can = useCanWrite('HomeBox');
  const st = dueState(t, house.displayNow);
  const docs = house.docs.filter((d) => (t.docIds ?? []).includes(d.id) || d.linkedTo.includes(t.id));
  const evidence = house.docs.filter((d) => t.evidenceIds.includes(d.id));
  return (
    <Shell
      id={t.id}
      kind="task"
      title={t.title}
      claim={<span className={`write-pill ${st === 'overdue' ? 'write-conflict' : st === 'done' ? 'write-completed' : 'write-queued'}`}>{st === 'overdue' ? 'Overdue' : st === 'soon' ? 'Due soon' : st === 'done' ? 'Done' : t.status === 'unknown' ? 'No schedule supplied' : 'Scheduled'}</span>}
      actions={
        st !== 'done' ? (
          <button type="button" className="btn btn-primary" disabled={!can.ok} title={can.reason} onClick={() => dispatch({ type: 'dialog', dialog: { type: 'complete', taskId: t.id } })}>
            <Icon name="check" size={16} /> Mark done
          </button>
        ) : (
          <button type="button" className="btn" disabled={!can.ok} title={can.reason} onClick={() => dispatch({ type: 'dialog', dialog: { type: 'schedule', targetId: t.targetId, afterTaskId: t.id } })}>
            <Icon name="calendar" size={16} /> Schedule next
          </button>
        )
      }
    >
      <OutageHint />
      <Section title="Details">
        <Facts
          rows={[
            ['For', <EntityLink key="t" id={t.targetId} />],
            ['Due', t.due ? `${fmtDate(t.due)} (${rel(t.due, house.displayNow)})` : undefined],
            ['Completed', t.completedAt ? `${fmtDate(t.completedAt)}${t.completedBy ? ` by ${t.completedBy}` : ''}` : undefined],
            ['Repeats', t.cadence ?? 'Not supplied'],
            ['Recorded cost', t.cost !== undefined ? `${t.cost}, currency not recorded` : undefined],
            ['Note', t.note],
          ]}
        />
      </Section>
      <Section title="Instructions" count={docs.length}>
        <DocList docs={docs} empty="No manual linked to this task." />
      </Section>
      {t.status === 'done' && (
        <Section title="Evidence" count={evidence.length}>
          <DocList docs={evidence} empty="Completion evidence is not supplied in this view." />
        </Section>
      )}
      <Section title="Earlier for the same record">
        <TaskList tasks={tasksFor(house, t.targetId).filter((x) => x.id !== t.id)} empty="No other upkeep for this record." />
      </Section>
      <Section title="History">
        <HistoryList id={t.id} />
      </Section>
    </Shell>
  );
}
