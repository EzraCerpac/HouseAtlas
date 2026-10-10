import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type MouseEvent,
  type PointerEvent,
  type ReactNode,
} from 'react';
import { useReducedMotion, useSelect, useStore } from '../state/store';
import { CLAIM_LABEL, dueState, findSpace, locate, roomContents, unplaced } from '../data/query';
import type { Overlay } from '../data/types';
import { buildHouseGeom, centroid } from './geometry';
import { buildFurniture, buildPins } from './pins';
import { Model, computeViewBox, floorZ, focusIndex, plannedFloors, plateOf, type ModelCam } from './Model';
import { useEased } from './useCamera';
import { LAYER, ROOM_KIND_LABEL, ROOM_TINT } from './palette';
import { Icon } from '../components/Icon';
import { EntityLink } from '../components/ui';
import { RoomIndex } from '../views/RoomsView';

const DEFAULT_YAW = -32;
const DEFAULT_TILT = 36;
// Camera preferences survive switching to other views and back.
const camPrefs = { yaw: DEFAULT_YAW, tilt: DEFAULT_TILT, zoom: 1, introDone: false };

const OVERLAYS: Overlay[] = ['spaces', 'belongings', 'electrical', 'water', 'network', 'upkeep'];
const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));

export function AtlasView() {
  const { house } = useStore();
  if (house.geometry === 'none') return <NoGeometryAtlas />;
  return <Stage />;
}

function NoGeometryAtlas() {
  const { house } = useStore();
  return (
    <div className="atlas-noplan">
      <div className="noplan-banner">
        <div className="noplan-mark" aria-hidden="true">
          <Icon name="rooms" size={26} />
        </div>
        <div>
          <h1 style={{ fontSize: 'var(--fs-2xl)', marginBottom: 6 }}>{house.name}: no reviewed shape projection</h1>
          <p>Rooms and places remain available. Plan, 3D and measured positions require reviewed geometry.</p>
        </div>
      </div>
      <RoomIndex />
    </div>
  );
}

function Stage() {
  const { state, dispatch, house } = useStore();
  const select = useSelect();
  const reduced = useReducedMotion();
  const geoms = useMemo(() => buildHouseGeom(house), [house.spaces, house.openings, house.floors]);
  const furniture = useMemo(() => buildFurniture(house), [house.items, house.spaces]);
  const pins = useMemo(
    () => buildPins(house, state.overlay, state.focusCircuit, state.selection, furniture),
    [house, state.overlay, state.focusCircuit, state.selection, furniture],
  );

  const [yaw, setYaw] = useState(camPrefs.yaw);
  const [tilt, setTilt] = useState(camPrefs.tilt);
  const [zoom, setZoom] = useState(camPrefs.zoom);
  const [dragging, setDragging] = useState(false);
  const [hover, setHover] = useState<string | null>(null);
  const dragMoved = useRef(false);
  const drag = useRef<{ x: number; y: number; yaw: number; tilt: number } | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 900, h: 640 });

  useEffect(() => {
    camPrefs.yaw = yaw;
    camPrefs.tilt = tilt;
    camPrefs.zoom = zoom;
  }, [yaw, tilt, zoom]);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => { if (entry) setSize({ w: Math.max(1, entry.contentRect.width), h: Math.max(1, entry.contentRect.height) }); });
    ro.observe(el);
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      setZoom((z) => clamp(z * (e.deltaY < 0 ? 1.12 : 1 / 1.12), 1, 3.2));
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => {
      ro.disconnect();
      el.removeEventListener('wheel', onWheel);
    };
  }, []);

  const planned = plannedFloors(house);
  const { idx, noPlan } = focusIndex(house, state.floorId);
  const is2d = state.mode === '2d';
  const explodeT = !is2d && state.exploded ? 1 : 0;
  const top = is2d ? idx : state.exploded ? planned.length - 1 : idx;
  const plate = plateOf(geoms);

  // Zoom centres on whatever is selected, or on the current floor.
  let fx = plate.center[0];
  let fy = plate.center[1];
  let fz = floorZ(idx, explodeT) + 0.5;
  if (state.selection) {
    const loc = locate(house, state.selection.id);
    const fi = planned.findIndex((f) => f.id === loc.floorId);
    const sp = findSpace(house, loc.spaceId);
    const pt = loc.pos ?? (sp?.shape ? centroid(sp.shape) : undefined);
    if (fi >= 0 && pt) {
      fx = pt[0];
      fy = pt[1];
      fz = floorZ(fi, explodeT) + 0.8;
    }
  }

  const target: ModelCam = {
    yaw: is2d ? Math.round(yaw / 90) * 90 : yaw,
    pitch: is2d ? 90 : tilt,
    explode: explodeT,
    top,
    zoom,
    fx,
    fy,
    fz,
  };
  const intro = camPrefs.introDone ? undefined : { yaw: yaw - 30, pitch: 60, explode: 0 };
  const cam = useEased(target, { reduced, snap: dragging ? ['yaw', 'pitch'] : [], intro, tau: 140 });
  useEffect(() => {
    camPrefs.introDone = true;
  }, []);

  const vb = computeViewBox(cam, geoms, !is2d && state.exploded);
  const ui = Math.max(vb.w / size.w, vb.h / size.h);
  const north = vb.P.dir(0, -1);
  const northDeg = (Math.atan2(north[0], -north[1]) * 180) / Math.PI;

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0 || is2d) return;
    if ((e.target as Element).closest('.stage-ui')) return;
    drag.current = { x: e.clientX, y: e.clientY, yaw, tilt };
    dragMoved.current = false;
  };
  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d) return;
    const dx = e.clientX - d.x;
    const dy = e.clientY - d.y;
    if (!dragMoved.current && Math.abs(dx) + Math.abs(dy) < 5) return;
    if (!dragMoved.current) {
      dragMoved.current = true;
      setDragging(true);
      setHover(null);
    }
    setYaw(d.yaw + dx * 0.4);
    if (e.pointerType === 'mouse') setTilt(clamp(d.tilt - dy * 0.2, 18, 64));
  };
  const endDrag = () => {
    drag.current = null;
    if (dragging) setDragging(false);
    // Let the click that ends a drag see dragMoved, then reset.
    window.setTimeout(() => (dragMoved.current = false), 0);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.target !== e.currentTarget) return;
    const map: Record<string, () => void> = {
      ArrowLeft: () => !is2d && setYaw((y) => y - 15),
      ArrowRight: () => !is2d && setYaw((y) => y + 15),
      ArrowUp: () => !is2d && setTilt((t) => clamp(t + 6, 18, 64)),
      ArrowDown: () => !is2d && setTilt((t) => clamp(t - 6, 18, 64)),
      '+': () => setZoom((z) => clamp(z * 1.25, 1, 3.2)),
      '=': () => setZoom((z) => clamp(z * 1.25, 1, 3.2)),
      '-': () => setZoom((z) => clamp(z / 1.25, 1, 3.2)),
    };
    const fn = map[e.key];
    if (fn) {
      e.preventDefault();
      fn();
    }
  };

  const resetView = () => {
    setYaw(DEFAULT_YAW);
    setTilt(DEFAULT_TILT);
    setZoom(1);
  };

  const onBackgroundClick = (e: MouseEvent) => {
    if (dragMoved.current) return;
    const t = e.target as Element;
    if (t.closest('.room, .pin, .furniture, .floor-tag, .stage-ui')) return;
    if (state.selection) select(null);
  };

  const floorsDesc = [...house.floors].sort((a, b) => b.order - a.order);
  const selFloor = house.floors.find((f) => f.id === state.floorId);

  return (
    <div className="stage-shell">
      <div
        ref={wrapRef}
        className={`stage${dragging ? ' is-dragging' : ''}${is2d ? ' is-plan' : ''}`}
        tabIndex={0}
        aria-label="House model. Arrow keys turn and tilt, plus and minus zoom. Tab to reach rooms and markers."
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerLeave={endDrag}
        onPointerCancel={endDrag}
        onKeyDown={onKeyDown}
        onClick={onBackgroundClick}
      >
        <Model
          house={house}
          geoms={geoms}
          cam={cam}
          mode={state.mode}
          exploded={state.exploded}
          floorId={state.floorId}
          overlay={state.overlay}
          selection={state.selection}
          pins={pins}
          furniture={furniture}
          hover={hover}
          setHover={setHover}
          onPick={(id) => select(id, { keepOverlay: true })}
          onFloor={(id) => dispatch({ type: 'floor', id })}
          dragMoved={dragMoved}
          ui={ui}
          reduced={reduced}
        />
      </div>

      <nav className="stage-ui floor-rail" aria-label="Floors">
        {floorsDesc.map((f) => {
          const n = house.spaces.filter((s) => s.floorId === f.id && s.kind !== 'stair').length;
          return (
            <button
              key={f.id}
              type="button"
              className={`floor-btn${f.id === state.floorId ? ' is-current' : ''}${f.hasPlan ? '' : ' is-noplan'}`}
              aria-pressed={f.id === state.floorId}
              onClick={() => dispatch({ type: 'floor', id: f.id })}
            >
              <span className="floor-short">{f.short}</span>
              <span className="floor-meta">
                <span className="floor-name">{f.name}</span>
                <span className="floor-sub">{f.hasPlan ? `${n} ${n === 1 ? 'room' : 'rooms'}` : `No plan, ${n} listed`}</span>
              </span>
            </button>
          );
        })}
      </nav>

      <div className="stage-ui view-ctrl">
        <div className="seg" role="group" aria-label="Model view">
          <button type="button" aria-pressed={!is2d} onClick={() => dispatch({ type: 'mode', mode: '3d' })}>
            3D
          </button>
          <button type="button" aria-pressed={is2d} onClick={() => dispatch({ type: 'mode', mode: '2d' })}>
            Plan
          </button>
        </div>
        {!is2d && (
          <button type="button" className="ctrl-btn ctrl-wide" aria-pressed={state.exploded} onClick={() => dispatch({ type: 'explode', on: !state.exploded })}>
            <Icon name="explode" size={17} />
            <span>{state.exploded ? 'Exploded' : 'Stacked'}</span>
          </button>
        )}
        <div className="ctrl-group" role="group" aria-label="Camera">
          {!is2d && (
            <>
              <button type="button" className="ctrl-btn" aria-label="Turn model left" onClick={() => setYaw((y) => y - 45)}>
                <Icon name="rotl" size={17} />
              </button>
              <button type="button" className="ctrl-btn" aria-label="Turn model right" onClick={() => setYaw((y) => y + 45)}>
                <Icon name="rotr" size={17} />
              </button>
            </>
          )}
          <button type="button" className="ctrl-btn" aria-label="Zoom in" onClick={() => setZoom((z) => clamp(z * 1.3, 1, 3.2))} disabled={zoom >= 3.2}>
            <Icon name="plus" size={17} />
          </button>
          <button type="button" className="ctrl-btn" aria-label="Zoom out" onClick={() => setZoom((z) => clamp(z / 1.3, 1, 3.2))} disabled={zoom <= 1}>
            <Icon name="minus" size={17} />
          </button>
          <button type="button" className="compass" aria-label="Reset turn, tilt and zoom" title="Reset view" onClick={resetView}>
            <svg viewBox="0 0 32 32" aria-hidden="true" style={{ transform: `rotate(${northDeg}deg)` }}>
              <path d="M16 4 20 16H12Z" className="compass-n" />
              <path d="M16 28 12 16h8Z" className="compass-s" />
            </svg>
            <span aria-hidden="true">N</span>
          </button>
        </div>
        {!is2d && (
          <label className="tilt">
            <span>Tilt</span>
            <input type="range" min={18} max={64} step={1} value={Math.round(tilt)} onChange={(e) => setTilt(Number(e.target.value))} />
          </label>
        )}
      </div>

      {noPlan && selFloor && <NoPlanFloor floorId={selFloor.id} />}

      <div className="stage-ui stage-bottom">
        <Legend />
        <div className="layer-bar" role="radiogroup" aria-label="Overlay">
          {OVERLAYS.map((o) => (
            <button
              key={o}
              type="button"
              role="radio"
              aria-checked={state.overlay === o}
              className="layer-chip"
              style={{ '--layer': LAYER[o].color } as CSSProperties}
              onClick={() => dispatch({ type: 'overlay', overlay: o })}
            >
              <span className="layer-swatch" aria-hidden="true" />
              {LAYER[o].short}
            </button>
          ))}
        </div>
      </div>
      <p className="stage-ui demo-note">
        {is2d ? 'Plan view.' : 'Drag to turn.'}
      </p>
    </div>
  );
}

function NoPlanFloor({ floorId }: { floorId: string }) {
  const { house } = useStore();
  const floor = house.floors.find((f) => f.id === floorId)!;
  const rooms = house.spaces.filter((s) => s.floorId === floorId);
  return (
    <aside className="stage-ui noplan-card" aria-label={`${floor.name} rooms`}>
      <h2>{floor.name} has no reviewed plan</h2>
      <p>{floor.note ?? 'Nothing here has been measured yet.'} The model above shows the drawn floors only.</p>
      <ul className="noplan-rooms">
        {rooms.map((r) => {
          const c = roomContents(house, r.id);
          return (
            <li key={r.id}>
              <EntityLink id={r.id} sub={`${c.items.length} belongings, ${c.tasks.filter((t) => t.status !== 'done').length} upkeep, no shape`} />
            </li>
          );
        })}
        {rooms.length === 0 && <li className="empty">No rooms recorded on this floor.</li>}
      </ul>
    </aside>
  );
}

function Legend() {
  const { state, dispatch, house } = useStore();
  const select = useSelect();
  const [open, setOpen] = useState(true);
  const un = unplaced(house);
  const o = state.overlay;
  let body: ReactNode = null;

  if (o === 'spaces') {
    const kinds = Array.from(new Set(house.spaces.filter((s) => s.floorId === state.floorId && s.shape).map((s) => s.kind)));
    body = (
      <>
        <ul className="legend-swatches">
          {kinds.map((k) => (
            <li key={k}>
              <span className="swatch" style={{ background: ROOM_TINT[k] }} aria-hidden="true" />
              {ROOM_KIND_LABEL[k]}
            </li>
          ))}
        </ul>
        <p className="legend-foot">Select a room to light it up. Storage furniture is shown as white blocks and is never treated as a room.</p>
      </>
    );
  } else if (o === 'belongings') {
    const placed = house.items.filter((i) => i.pos && !i.containerId).length;
    const inStorage = house.items.filter((i) => i.containerId).length;
    body = (
      <>
        <ul className="legend-stats">
          <li>
            <strong>{placed}</strong> placed on the plan
          </li>
          <li>
            <strong>{inStorage}</strong> inside storage, counted on the cupboard
          </li>
          <li>
            <strong>{un.roomOnlyItems.length}</strong> known by room only
          </li>
          <li>
            <strong>{un.noRoomItems.length}</strong> with no known location
          </li>
        </ul>
        <RingKey />
        <button type="button" className="text-btn" onClick={() => dispatch({ type: 'view', view: 'rooms' })}>
          See unplaced records
        </button>
      </>
    );
  } else if (o === 'electrical') {
    const circuits = house.circuits;
    body = (
      <>
        <ul className="legend-circuits">
          {circuits.map((c) => (
            <li key={c.id}>
              <button
                type="button"
                aria-pressed={state.focusCircuit === c.id}
                className="circuit-row"
                onClick={() => {
                  if (state.focusCircuit === c.id) dispatch({ type: 'focusCircuit', id: undefined });
                  else select(c.id, { keepOverlay: true });
                }}
              >
                <span className="swatch round" style={{ background: c.color }} aria-hidden="true" />
                <span className="circuit-ref">{c.ref}</span>
                <span className="circuit-label">{c.label}</span>
                <span className={`mini-claim claim-${c.claim}`}>{CLAIM_LABEL[c.claim]}</span>
              </button>
            </li>
          ))}
        </ul>
        <p className="legend-foot">Colours show circuit membership as documented. Cable routes are never drawn or guessed. Grey outlets have no documented circuit.</p>
      </>
    );
  } else if (o === 'water') {
    body = (
      <>
        <p className="legend-foot">Diamonds mark valves at their documented positions. Nothing here traces where water flows.</p>
        {un.valves.length > 0 && (
          <div className="legend-unplaced">
            <span>Not placed:</span>
            {un.valves.map((v) => (
              <EntityLink key={v.id} id={v.id} />
            ))}
          </div>
        )}
        <RingKey />
      </>
    );
  } else if (o === 'network') {
    body = (
      <>
        <p className="legend-foot">Where observed devices physically sit. Hollow markers were not in the latest export, which does not mean removed or switched off.</p>
        {un.devices.length > 0 && (
          <div className="legend-unplaced">
            <span>No location:</span>
            {un.devices.map((d) => (
              <EntityLink key={d.id} id={d.id} />
            ))}
          </div>
        )}
        <button type="button" className="text-btn" onClick={() => dispatch({ type: 'view', view: 'network' })}>
          Open logical topology
        </button>
      </>
    );
  } else if (o === 'upkeep') {
    const sched = house.tasks.filter((t) => t.status === 'scheduled');
    const counts = { overdue: 0, soon: 0, later: 0 };
    sched.forEach((t) => {
      const s = dueState(t, house.displayNow);
      if (s !== 'done') counts[s]++;
    });
    body = (
      <>
        <ul className="legend-stats">
          <li>
            <strong className="tone-alert">{counts.overdue}</strong> overdue
          </li>
          <li>
            <strong>{counts.soon}</strong> due in the next 14 days
          </li>
          <li>
            <strong>{counts.later}</strong> later
          </li>
        </ul>
        <button type="button" className="text-btn" onClick={() => dispatch({ type: 'view', view: 'upkeep' })}>
          Open upkeep list
        </button>
      </>
    );
  }

  return (
    <section className={`legend${open ? '' : ' is-closed'}`} style={{ '--layer': LAYER[o].color } as CSSProperties} aria-label={`${LAYER[o].label} key`}>
      <button type="button" className="legend-head" aria-expanded={open} onClick={() => setOpen(!open)}>
        <span className="layer-swatch" aria-hidden="true" />
        <span>{LAYER[o].label}</span>
        <Icon name="chevronDown" size={16} className="legend-chevron" />
      </button>
      {open && <div className="legend-body">{body}</div>}
    </section>
  );
}

function RingKey() {
  return (
    <ul className="ring-key" aria-label="Marker rings">
      <li>
        <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
          <circle cx="9" cy="9" r="5" fill="currentColor" />
        </svg>
        Confirmed
      </li>
      <li>
        <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
          <circle cx="9" cy="9" r="5" fill="currentColor" />
          <circle cx="9" cy="9" r="7.6" fill="none" stroke="currentColor" strokeWidth="1.2" />
        </svg>
        Reported
      </li>
      <li>
        <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
          <circle cx="9" cy="9" r="5" fill="currentColor" />
          <circle cx="9" cy="9" r="7.6" fill="none" stroke="currentColor" strokeWidth="1.2" strokeDasharray="2.4 2" />
        </svg>
        Disputed or unknown
      </li>
    </ul>
  );
}
