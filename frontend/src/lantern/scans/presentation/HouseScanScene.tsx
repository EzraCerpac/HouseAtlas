import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { makeScanProjector } from './scan-projection';
import { useEased } from '../../atlas/useCamera';
import { MESH_LIMITS, prepareMeshRender } from '../mesh-profile';
import { yieldTask } from './yield-task';
import { displayEdges } from './display-edges';
import { SceneControls } from './SceneControls';
import { SceneMeshCanvas } from './SceneMeshCanvas';
import { admittedRoomRegions, regionMatchesRoom } from './room-region-model';
import { RoomRegions, RoomInspector } from './RoomRegions';
import type { DisplayFloor } from './SceneMeshCanvas';
import type { HouseScanSceneProps, ProjectedRoomAnchor } from './types';
import './scene.css';

type FloorState = { readonly state: 'preparing' | 'ready' | 'unavailable'; readonly reason: string | null };
function initialFloorStates(floors: HouseScanSceneProps['floors']): FloorState[] {
  return floors.map(floor => floors.length > 3 ? { state: 'unavailable', reason: 'At most three provisional floors can be shown.' }
    : floor.unavailable !== undefined || !floor.profile ? { state: 'unavailable', reason: floor.unavailable ?? 'Source scan is unavailable.' }
    : { state: 'preparing', reason: null });
}

async function authoredBounds(profile: NonNullable<HouseScanSceneProps['floors'][number]['profile']>, signal: AbortSignal) {
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity]; let count = 0; const started = performance.now();
  for (const mesh of profile.meshes) {
    const matrix = mesh.composedLocalToStageMatrixTokens.map(Number);
    for (let i = 0; i < mesh.positionsLocalTokens.length; i += 3) {
      const x = Number(mesh.positionsLocalTokens[i]), y = Number(mesh.positionsLocalTokens[i + 1]), z = Number(mesh.positionsLocalTokens[i + 2]);
      for (let axis = 0; axis < 3; axis++) { const v = x * matrix[axis]! + y * matrix[4 + axis]! + z * matrix[8 + axis]! + matrix[12 + axis]!;
        if (!Number.isFinite(v)) throw new Error('Source display overflow'); min[axis] = Math.min(min[axis]!, v); max[axis] = Math.max(max[axis]!, v); }
      if (++count % 4096 === 0) { if (signal.aborted) throw signal.reason; await yieldTask(signal); if (performance.now() - started > MESH_LIMITS.workMs) throw new Error('Source display work bound'); }
    }
  }
  const spans = max.map((v, i) => v - min[i]!);
  const plane = profile.authoredCoordinates.upAxis === 'Y' ? [0, 2] : profile.authoredCoordinates.upAxis === 'Z' ? [0, 1] : [1, 2];
  const planExtent = Math.max(spans[plane[0]!]!, spans[plane[1]!]!);
  const radius = Math.hypot(...spans) / 2; if (!Number.isFinite(radius) || radius <= 0 || planExtent <= 0) throw new Error('Source display bound');
  return { radius, planExtent };
}


/** Original Lantern orthographic presentation over actual source triangles. No semantic room geometry is created. */
export function HouseScanScene(props: HouseScanSceneProps) {
  const owner = useMemo(() => ({ viewKey: props.viewKey, inputs: props.floors, active: props.active }), [props.viewKey, props.floors, props.active]);
  const roomOwner = useMemo(() => ({ owner, rooms: props.rooms, regions: props.roomRegions }), [owner, props.rooms, props.roomRegions]);
  const [selection, setSelection] = useState<{ owner: typeof roomOwner; localId: string | null; blockedId: string | null }>(() => ({ owner: roomOwner, localId: null, blockedId: null }));
  const [yaw, setYaw] = useState(-32), [pitch, setPitch] = useState(36), [zoom, setZoom] = useState(1);
  const [mode, setMode] = useState<'3d' | 'plan'>('3d'), [exploded, setExploded] = useState(true), [cutaway, setCutaway] = useState(true);
  const [selectedFloorKey, setFloor] = useState(props.floors[1]?.key ?? props.floors[0]?.key ?? '');
  const [prepared, setPrepared] = useState<{ owner: typeof owner; floors: readonly DisplayFloor[]; states: readonly FloorState[] } | null>(null);
  const [renderFailure, setRenderFailure] = useState<{ owner: typeof owner; message: string } | null>(null), [detailsOpen, setDetailsOpen] = useState(false);
  const element = useRef<HTMLDivElement>(null), drag = useRef<{ id: number; x: number; y: number } | null>(null);
  const latestOwner = useRef(owner); latestOwner.current = owner;
  const latestRoomOwner = useRef(roomOwner); latestRoomOwner.current = roomOwner;
  const latestProps = useRef(props); latestProps.current = props;
  const previousSelection = useRef<string | null>(null);
  const selectionDispatch = useRef(0);
  const [size, setSize] = useState({ width: 1000, height: 760 }), [reduced, setReduced] = useState(false);
  const cam = useEased({ yaw, pitch: mode === 'plan' ? 90 : pitch, explode: exploded ? 1 : 0, zoom }, { reduced, tau: 130 });
  const currentPreparation = prepared?.owner === owner && props.active ? prepared : null;
  const floors = currentPreparation?.floors ?? [];
  const floorStates = currentPreparation?.states ?? initialFloorStates(props.floors);
  useEffect(() => {
    const query = matchMedia('(prefers-reduced-motion: reduce)'); setReduced(query.matches);
    const change = () => setReduced(query.matches); query.addEventListener('change', change);
    return () => query.removeEventListener('change', change);
  }, []);
  useEffect(() => {
    const node = element.current; if (!node || !props.active) return;
    const resize = new ResizeObserver(entries => { const rect = entries[0]?.contentRect; if (rect) setSize({ width: Math.max(1, rect.width), height: Math.max(1, rect.height) }); });
    resize.observe(node); return () => resize.disconnect();
  }, [props.active]);
  useEffect(() => {
    const abort = new AbortController(); let disposed = false;
    const current = () => !disposed && !abort.signal.aborted && owner.active && latestOwner.current === owner;
    setPrepared(null); setRenderFailure(null); drag.current = null;
    if (!props.active) return () => { disposed = true; abort.abort(); };
    const states = initialFloorStates(props.floors), result: DisplayFloor[] = [];
    const publish = () => { if (current()) setPrepared({ owner, floors: [...result], states: [...states] }); };
    publish();
    if (props.floors.length > 3) return () => { disposed = true; abort.abort(); };
    void (async () => {
      let bytes = 0;
      const sourceBounds = new Map<string, { radius: number; planExtent: number }>();
      for (let index = 0; index < props.floors.length; index++) {
        const input = props.floors[index]!; if (states[index]!.state !== 'preparing' || !input.profile) continue;
        try { sourceBounds.set(input.key, await authoredBounds(input.profile, abort.signal)); if (!current()) return; }
        catch { if (!current()) return; states[index] = { state: 'unavailable', reason: 'Source floor could not be prepared.' }; publish(); }
      }
      const metadata = new Set(props.floors.flatMap(f => f.profile ? [f.profile.authoredCoordinates.upAxis + ':' + f.profile.authoredCoordinates.metersPerUnitToken] : []));
      const commonExtent = Math.max(...[...sourceBounds.values()].map(b => b.planExtent));
      for (let index = 0; index < props.floors.length; index++) {
        const input = props.floors[index]!; if (states[index]!.state !== 'preparing' || !input.profile || !sourceBounds.has(input.key)) continue;
        try {
        const scene = await prepareMeshRender(input.profile, abort.signal); if (!current()) return;
        bytes += scene.bytes; if (bytes > MESH_LIMITS.renderCpuBytes) throw new Error('Scene allocation bound');
        const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
        for (const mesh of scene.meshes) for (let i = 0; i < mesh.vertices.length; i += 6) for (let axis = 0; axis < 3; axis++) {
          min[axis] = Math.min(min[axis]!, mesh.vertices[i + axis]!); max[axis] = Math.max(max[axis]!, mesh.vertices[i + axis]!);
        }
        const extent = Math.max(max[0]! - min[0]!, max[2]! - min[2]!); if (!Number.isFinite(extent) || extent <= 0) throw new Error('Display bounds');
        // A common authored-unit display fit preserves relative export proportions.
        // It establishes no metres, inter-floor registration or native transform.
        const outlineBuffers: Float32Array[] = []; const edgeStarted = performance.now(); let edgeBytes = 0;
        for (const mesh of scene.meshes) {
          let edges: Float32Array = new Float32Array(0);
          if (/InnerSide|ExternalWalls|WholeFloor|[blrt]_frame/.test(mesh.sourceName) && performance.now() - edgeStarted < MESH_LIMITS.workMs) {
            try { edges = await displayEdges(mesh.vertices, abort.signal); } catch { if (!current()) return; }
          }
          edgeBytes += edges.byteLength; if (edgeBytes > 4 * 1024 * 1024 || bytes + edgeBytes > MESH_LIMITS.renderCpuBytes) throw new Error('Outline allocation bound');
          outlineBuffers.push(edges);
        }
        bytes += edgeBytes;
        const scale = metadata.size === 1 ? sourceBounds.get(input.key)!.radius * 12 / commonExtent : 12 / extent;
        let surfaceY = min[1]!;
        for (const mesh of scene.meshes) if (/WholeFloor/.test(mesh.sourceName)) for (let i = 1; i < mesh.vertices.length; i += 6) surfaceY = Math.max(surfaceY, mesh.vertices[i]!);
        result.push({ key: input.key, scene, outlineBuffers, index, scale, surfaceY, minY: min[1]!, height: (max[1]! - min[1]!) * scale,
          width: (max[0]! - min[0]!) * scale, depth: (max[2]! - min[2]!) * scale, centerX: (max[0]! + min[0]!) / 2, centerZ: (max[2]! + min[2]!) / 2 });
        // Independent availability: publish every completed floor without waiting for all exports.
        states[index] = { state: 'ready', reason: null }; publish();
        } catch { if (!current()) return; states[index] = { state: 'unavailable', reason: 'Source floor could not be prepared.' }; publish(); }
      }
      publish();
    })().catch(() => { if (!current()) return;
      for (let index = 0; index < states.length; index++) if (states[index]!.state === 'preparing') states[index] = { state: 'unavailable', reason: 'Source floor could not be prepared.' };
      publish(); });
    return () => { disposed = true; abort.abort(); drag.current = null; };
  }, [owner]);
  const projector = useMemo(() => makeScanProjector(cam, [0, 0]), [cam]);
  const plan = mode === 'plan';
  useEffect(() => { if (plan && floors.length && !floors.some(f => f.key === selectedFloorKey)) setFloor(floors[0]!.key); }, [plan, floors, selectedFloorKey]);
  const viewBox = useMemo<readonly [number, number, number, number]>(() => {
    const points: readonly [number, number][] = floors.flatMap(f => {
      if (plan && f.key !== selectedFloorKey) return [];
      const z = plan ? 0 : f.index * (3.2 + cam.explode * 3.4);
      return [-f.width / 2, f.width / 2].flatMap(x => [-f.depth / 2, f.depth / 2].flatMap(y => [z, z + f.height].map(h => projector.p(x, y, h))));
    });
    const minX = points.length ? Math.min(...points.map(p => p[0])) : -300, maxX = points.length ? Math.max(...points.map(p => p[0])) : 300;
    const minY = points.length ? Math.min(...points.map(p => p[1])) : -450, maxY = points.length ? Math.max(...points.map(p => p[1])) : 200;
    const aspect = size.width / size.height, marginX = size.width < 760 ? 65 : 170;
    const w = Math.max((maxX - minX + marginX * 2) / cam.zoom, (maxY - minY + 220) / cam.zoom * aspect);
    const h = w / aspect;
    return [(minX + maxX) / 2 - w / 2, (minY + maxY) / 2 - h / 2 + 12, w, h];
  }, [floors, plan, selectedFloorKey, cam.explode, cam.zoom, projector, size]);
  const ui = viewBox[2] / size.width;
  const anchors = useMemo<readonly ProjectedRoomAnchor[]>(() => props.rooms.flatMap(room => {
    const f = floors.find(f => f.key === room.floorKey); if (!f || room.basis !== 'schematic-room' || !Number.isFinite(room.xFraction) || !Number.isFinite(room.yFraction)
      || room.xFraction < 0 || room.xFraction > 1 || room.yFraction < 0 || room.yFraction > 1) return [];
    const x = (room.xFraction - .5) * f.width, y = (room.yFraction - .5) * f.depth;
    const z = plan ? 0 : f.index * (3.2 + cam.explode * 3.4);
    return [{ id: room.id, viewKey: props.viewKey, floorKey: room.floorKey, packagePlaceKey: room.packagePlaceKey, packagePlaceUuid: room.packagePlaceUuid,
      sourceAnchorIds: room.sourceAnchorIds, receiptId: room.receiptId, receiptSha256: room.receiptSha256,
      base: projector.p(x, y, z + .15), top: projector.p(x, y, z + .15 + (plan ? 0 : 1.8)),
      visible: !plan || f.key === selectedFloorKey, basis: 'schematic-room' }];
  }), [props.rooms, props.viewKey, floors, projector, plan, selectedFloorKey, cam.explode]);
  const admittedRegions = useMemo(() => admittedRoomRegions(props.roomRegions ?? [], props.rooms), [props.roomRegions, props.rooms]);
  const selectedId = !props.active || selection.owner !== roomOwner ? null : props.selectedRoomId === undefined ? selection.localId
    : props.selectedRoomId === selection.blockedId ? null : props.selectedRoomId;
  const candidateRoom = props.rooms.find(room => room.id === selectedId) ?? null;
  const selectedRegion = candidateRoom ? admittedRegions.find(region => regionMatchesRoom(region, candidateRoom)
    && floors.some(floor => floor.key === region.floorKey && (!plan || floor.key === selectedFloorKey))) : undefined;
  const selectedRoom = selectedRegion ? candidateRoom : null;
  const roomCurrent = () => props.active && latestOwner.current === owner && latestRoomOwner.current === roomOwner && latestProps.current === props;
  useLayoutEffect(() => {
    if (selection.owner !== roomOwner || !props.active && (selection.localId !== null || previousSelection.current !== null)) {
      selectionDispatch.current++;
      setSelection({ owner: roomOwner, localId: null, blockedId: props.selectedRoomId ?? null });
      const notify = previousSelection.current !== null || props.selectedRoomId != null;
      previousSelection.current = null;
      if (notify && latestProps.current === props && latestRoomOwner.current === roomOwner) props.onRoomSelectionChange?.(null);
      return;
    }
    if (selection.blockedId !== null && props.selectedRoomId !== selection.blockedId) setSelection(value => value.owner === roomOwner ? { ...value, blockedId: null } : value);
    if (selectedId !== null && !selectedRoom) {
      selectionDispatch.current++;
      setSelection({ owner: roomOwner, localId: null, blockedId: props.selectedRoomId ?? null });
      previousSelection.current = null;
      if (roomCurrent()) props.onRoomSelectionChange?.(null);
      return;
    }
    previousSelection.current = selectedRoom?.id ?? null;
  }, [roomOwner, selection.owner, selection.blockedId, props.active, props.selectedRoomId, selectedId, selectedRoom, props]);
  const selectRoom = (room: typeof props.rooms[number]) => {
    if (!roomCurrent() || !props.rooms.includes(room) || !admittedRegions.some(region => regionMatchesRoom(region, room))
      || !floors.some(floor => floor.key === room.floorKey && (!plan || floor.key === selectedFloorKey))) return;
    const dispatch = ++selectionDispatch.current;
    setSelection({ owner: roomOwner, localId: room.id, blockedId: null }); setFloor(room.floorKey);
    props.onRoomSelect?.(room); if (roomCurrent() && selectionDispatch.current === dispatch) props.onRoomSelectionChange?.(room);
  };
  const closeRoom = () => {
    if (!roomCurrent() || !selectedRoom || previousSelection.current !== selectedRoom.id) return;
    selectionDispatch.current++;
    setSelection({ owner: roomOwner, localId: null, blockedId: props.selectedRoomId ?? null });
    previousSelection.current = null; props.onRoomSelectionChange?.(null);
  };
  const context = { viewKey: props.viewKey, anchors, ui, selectedRoom, unplacedDock: [viewBox[0] + viewBox[2] - 65 * ui, viewBox[1] + viewBox[3] * .5] as const };
  const failure = renderFailure?.owner === owner ? renderFailure.message : null;
  const status = failure ?? (!props.floors.length ? 'No source floors are available.'
    : !floors.length ? floorStates.some(f => f.state === 'preparing') ? 'Preparing source floors…' : 'Source floors are unavailable. See source details.'
    : floorStates.some(f => f.state === 'unavailable') ? 'Some source floors are unavailable. Available floors remain visible.' : null);
  if (!props.active) return null;
  return <div className="stage-shell scan-presentation" ref={element}>
    <div className={`stage${plan ? ' is-plan' : ''}`} tabIndex={0} aria-label="Scanned house. Drag to turn; arrow keys rotate; plus and minus zoom."
      onPointerDown={event => { if (plan || event.button !== 0 || (event.target as Element).closest('button,[role=button],.stage-ui')) return;
        drag.current = { id: event.pointerId, x: event.clientX, y: event.clientY }; event.currentTarget.setPointerCapture(event.pointerId); }}
      onPointerMove={event => { const d = drag.current; if (!d || d.id !== event.pointerId) return; setYaw(v => v + (event.clientX - d.x) * .4);
        setPitch(v => Math.max(18, Math.min(64, v - (event.clientY - d.y) * .2))); drag.current = { ...d, x: event.clientX, y: event.clientY }; }}
      onPointerUp={event => { drag.current = null; if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId); }}
      onPointerCancel={() => { drag.current = null; }} onLostPointerCapture={() => { drag.current = null; }}
      onKeyDown={event => { if (event.target !== event.currentTarget || !['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', '+', '=', '-'].includes(event.key)) return;
        event.preventDefault(); if (event.key === 'ArrowLeft') setYaw(v => v - 15); if (event.key === 'ArrowRight') setYaw(v => v + 15);
        if (event.key === 'ArrowUp') setPitch(v => Math.min(64, v + 6)); if (event.key === 'ArrowDown') setPitch(v => Math.max(18, v - 6));
        if (event.key === '+' || event.key === '=') setZoom(v => Math.min(3.2, v * 1.15)); if (event.key === '-') setZoom(v => Math.max(.6, v / 1.15)); }}>
      {floors.length > 0 && <SceneMeshCanvas owner={owner} roomRegions={admittedRegions} selectedRoomId={selectedRoom?.id ?? null} overlay={props.overlay} floors={floors} projector={projector} viewBox={viewBox} exploded={cam.explode} selectedFloorKey={selectedFloorKey} plan={plan} cutaway={cutaway}
        onUnavailable={message => { if (latestOwner.current === owner) setRenderFailure({ owner, message }); }} />}
      <svg className="model scene-svg" viewBox={viewBox.join(' ')} preserveAspectRatio="none" aria-label="Schematic room anchors and overlay connections">
        <defs><linearGradient id="room-lantern-face" x1="0" y1="1" x2="0" y2="0"><stop offset="0" stopColor="#FFE39A" stopOpacity={.7}/><stop offset="1" stopColor="#FFE39A" stopOpacity={.04}/></linearGradient></defs>
        <RoomRegions regions={admittedRegions} rooms={props.rooms} floors={floors} projector={projector} ui={ui} plan={plan} exploded={cam.explode}
          selectedFloorKey={selectedFloorKey} selectedRoomId={selectedRoom?.id ?? null} overlay={props.overlay} onSelect={selectRoom} />
        {floors.filter(f => !plan || f.key === selectedFloorKey).map(f => {
          const p = projector.p(f.width / 2 + .6, f.depth / 2, plan ? 0 : f.index * (3.2 + cam.explode * 3.4));
          return <g key={f.key} className={`floor-tag${f.key === selectedFloorKey ? ' is-current' : ''}`} transform={`translate(${p[0]} ${p[1]}) scale(${ui})`}
            role="button" tabIndex={0} aria-label={`Show ${props.floors.find(v => v.key === f.key)?.label}`} onClick={() => setFloor(f.key)}
            onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); setFloor(f.key); } }}>
            <line x1={0} x2={25} y1={0} y2={0} /><circle cx={0} cy={0} r={2} /><text x={32} y={5} className="floor-tag-short">{props.floors.find(v => v.key === f.key)?.short}</text>
            <text x={32} y={24} className="floor-tag-name">{props.floors.find(v => v.key === f.key)?.label}</text></g>;
        })}
        {props.renderLayer?.(context)}
      </svg>
    </div>
    <SceneControls floors={props.floors.map((f, index) => ({ key: f.key, label: f.label, short: f.short, available: floors.some(v => v.key === f.key), pending: floorStates[index]!.state === 'preparing' }))}
      selectedFloorKey={selectedFloorKey} onFloorChange={setFloor} mode={mode} onModeChange={setMode} exploded={exploded} onExplodedChange={setExploded}
      yaw={yaw} onYawChange={setYaw} pitch={pitch} onPitchChange={setPitch} zoom={zoom} onZoomChange={setZoom} overlay={props.overlay} onOverlayChange={props.onOverlayChange}
      onReset={() => { setYaw(-32); setPitch(36); setZoom(1); setMode('3d'); setExploded(true); }} />
    <div className="stage-ui scan-source-status"><span>Incomplete scans</span><button type="button" aria-expanded={detailsOpen} onClick={() => setDetailsOpen(v => !v)}>Source details</button></div>
    {detailsOpen && <aside className="stage-ui source-disclosure"><h2>Source details</h2><p>Physical scale and floor alignment are unknown. Sizes follow authored export proportions where units agree; floor spacing and room anchors are schematic. Height cutaway clips all displayed mesh parts without changing source geometry.</p>
      <label><input type="checkbox" checked={cutaway} onChange={event => setCutaway(event.target.checked)} /> Height cutaway</label>
      {props.floors.map((f, index) => <details key={f.key}><summary>{f.label} · {f.profile ? `${String(f.profile.counts.meshes)} meshes · ` : ''}{floorStates[index]!.state === 'ready' ? 'Provisional scan' : floorStates[index]!.state === 'preparing' ? 'Preparing scan' : 'Scan unavailable'}</summary>
        {floorStates[index]!.reason && <p>{floorStates[index]!.reason}</p>}<p>Original export: {f.profile?.source.floorLabel ?? 'Unavailable'}</p><code>{f.profile?.source.originalSHA256}</code></details>)}
    </aside>}
    {status && <p className="stage-ui scene-failure" role="status">{status}</p>}
    {props.renderDetails?.(context)}
    {selectedRoom && selectedRegion && <RoomInspector actions={props.renderRoomActions?.(selectedRoom)} room={selectedRoom} region={selectedRegion} onClose={closeRoom} />}
  </div>;
}
