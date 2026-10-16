import { useMemo, useState, type CSSProperties, type ReactNode, type RefObject } from 'react';
import { Icon } from '../components/Icon';
import { drawnBounds, floorPlanRings, makeProjection, occurrenceTops, pick, planPick, relativePath, visibleFloorIds } from './geometry';
import type { DrawRules, PreparedMesh } from './geometry';
import type { AdmittedPresentation } from './model';
import type { OverlayJoin } from './overlays';
import { contextOccurrences, type ViewerAction, type ViewerState } from './selection';
import { MeshLayer } from './MeshLayer';
import { TONE_COLOR, badgeFill } from './tones';
import { useStageCamera } from './useStageCamera';

export interface LabelPoint { readonly x: number; readonly z: number; readonly clearance: number }

interface Props {
  readonly model: AdmittedPresentation;
  readonly meshes: readonly PreparedMesh[];
  readonly labelPoints: ReadonlyMap<string, LabelPoint>;
  readonly state: ViewerState;
  readonly dispatch: (action: ViewerAction) => void;
  readonly overlay: OverlayJoin | null;
  /** Occurrence token -> overlay tint. */
  readonly tints: ReadonlyMap<string, string>;
  readonly reduced: boolean;
  readonly status: ReactNode;
  readonly viewport: RefObject<HTMLDivElement | null>;
}

/** Section plane height above the current floor's lowest drawn geometry. */
const SECTION_HEIGHT = 1.2;
const floorAvailability = (hasPlan: boolean, meshes: number) =>
  hasPlan && meshes ? 'Plan and 3D' : hasPlan ? 'Plan only' : meshes ? '3D only' : 'No geometry';

export function ModelStage({ model, meshes, labelPoints, state, dispatch, overlay, tints, reduced, status, viewport }: Props) {
  const [section, setSection] = useState(true);
  const [failure, setFailure] = useState<{ readonly meshes: readonly PreparedMesh[]; readonly message: string } | null>(null);
  const [hint, setHint] = useState<{ readonly key: string; readonly text: string } | null>(null);
  const unavailable = failure?.meshes === meshes ? failure.message : null;
  const plan = state.view === 'plan';
  const floorId = state.floorId;
  const isolated = model.source.registration.kind !== 'shared-frame';
  const facts = floorId !== null ? model.floorFacts.get(floorId) : undefined;
  const floor = floorId !== null ? model.floorsById.get(floorId) : undefined;
  const planFeatures = floor?.plan?.features ?? [];
  const hasMeshes = meshes.some(mesh => isolated ? mesh.floorId === floorId : mesh.floorId !== null);
  const hintKey = `${state.view}|${floorId}|${state.occurrenceId}`;
  const select = (occurrenceId: string | null) => dispatch({ type: 'selectOccurrence', occurrenceId });

  // Isolated floors fit their own frame; a shared frame fits the whole model once.
  const bounds = useMemo(() => drawnBounds(meshes, floorPlanRings(model, isolated ? floorId : null), isolated ? floorId : null),
    [meshes, model, isolated, floorId]);
  const tops = useMemo(() => occurrenceTops(meshes), [meshes]);
  const rules = useMemo<DrawRules>(() => ({ visibleFloors: visibleFloorIds(model, floorId),
    clipY: section && facts?.yRange ? facts.yRange[0] + SECTION_HEIGHT : null }), [model, floorId, section, facts]);
  const floorY = facts?.yRange?.[0] ?? (bounds ? (bounds.min[1] + bounds.max[1]) / 2 : 0);

  const camera = useStageCamera({ element: viewport, top: plan, reduced, onEscape: () => select(null),
    onTap: (px, py) => {
      if (!projection || floorId === null) return;
      if (camera.planBlend >= 1) { select(planPick(model, floorId, floorY, projection, px, py)); return; }
      if (!showCanvas) return;
      const hit = pick(meshes, projection, rules, px, py);
      if (hit.kind === 'occurrence') select(hit.occurrenceId);
      else if (hit.kind === 'display-only') setHint({ key: hintKey, text: 'Not linked to a room' });
      else select(null);
    } });
  const { planBlend, size } = camera;
  const showCanvas = hasMeshes && planBlend < 1 && unavailable === null;
  const projection = useMemo(() => bounds ? makeProjection(camera.eased, bounds, size, planBlend) : null, [bounds, camera.eased, size, planBlend]);
  const center = projection?.center;
  const paths = useMemo(() => center ? planFeatures.map(feature => relativePath(feature.rings, center)) : [],
    // Paths depend on the centre only, not on every camera frame.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [planFeatures, center?.[0], center?.[1], center?.[2]]);
  const context = useMemo(() => contextOccurrences(model, state, floorId), [model, state, floorId]);
  const selectedFloor = state.occurrenceId !== null ? model.occurrences.get(state.occurrenceId)?.occurrence.floorId ?? null : null;
  const contextFloors = useMemo(() => {
    const room = state.occurrenceId !== null ? model.occurrences.get(state.occurrenceId)?.room : undefined;
    return new Set(room?.occurrences.flatMap(row => row.floorId !== null && row.spaceOccurrenceId !== state.occurrenceId ? [row.floorId] : []) ?? []);
  }, [model, state.occurrenceId]);

  const labels = useMemo(() => {
    if (!projection || floorId === null) return [];
    const rows: { id: string; text: string; x: number; y: number; tier: 'selected' | 'context' | 'plain'; count: number; clearance: number; leader: boolean }[] = [];
    for (const occurrenceId of facts?.occurrenceIds ?? []) {
      const target = model.occurrences.get(occurrenceId), point = labelPoints.get(occurrenceId); if (!target || !point) continue;
      const tier = occurrenceId === state.occurrenceId ? 'selected' : context.includes(occurrenceId) ? 'context' : 'plain';
      let y: number | null = floorY;
      if (planBlend < 1) { y = tops.get(occurrenceId) ?? null; if (y === null || !showCanvas) continue; }
      if (tier === 'plain' && point.clearance * projection.k < 16) continue;
      const [x, sy] = projection.project(point.x, y, point.z);
      rows.push({ id: occurrenceId, text: target.room.label, x, y: sy, tier, clearance: point.clearance,
        count: overlay?.byRoom.get(target.room.roomId)?.length ?? 0, leader: tier === 'selected' && planBlend < .5 });
    }
    const rank = { selected: 0, context: 1, plain: 2 } as const;
    rows.sort((a, b) => rank[a.tier] - rank[b.tier] || b.clearance - a.clearance);
    const placed: { l: number; r: number; t: number; b: number }[] = [];
    return rows.filter(row => {
      const w = Math.min(220, row.text.length * 7.2 + (row.count ? 28 : 0) + (row.tier === 'plain' ? 14 : 26)), h = row.tier === 'plain' ? 22 : 30;
      const top = row.leader ? row.y - 34 - h : row.y - h / 2;
      const box = { l: row.x - w / 2, r: row.x + w / 2, t: top, b: top + h };
      if (row.tier !== 'selected' && (box.l < 4 || box.r > size.width - 4 || placed.some(o => box.l < o.r && box.r > o.l && box.t < o.b && box.b > o.t))) return false;
      placed.push(box); return true;
    });
  }, [projection, floorId, facts, model, labelPoints, state.occurrenceId, context, floorY, planBlend, tops, showCanvas, overlay, size.width]);

  const countFill = overlay ? badgeFill(overlay.layer.tone) : undefined;
  return <div className={`cifc-stage${plan ? ' is-plan' : ''}`}>
    <div className="cifc-stage-head">
      <nav className="cifc-floors" aria-label="Floors">
        {model.source.floors.map(row => {
          const rowFacts = model.floorFacts.get(row.floorId);
          const availability = floorAvailability(rowFacts?.hasPlan ?? false, rowFacts?.meshCount ?? 0);
          const holdsSelection = selectedFloor === row.floorId && row.floorId !== floorId;
          const holdsContext = !holdsSelection && contextFloors.has(row.floorId) && row.floorId !== floorId;
          return <button key={row.floorId} type="button" className={`floor-btn${row.floorId === floorId ? ' is-current' : ''}`}
            aria-pressed={row.floorId === floorId}
            aria-label={`${row.label}: ${availability}${holdsSelection ? ', has the selected room' : holdsContext ? ', has another part of the selected room' : ''}`}
            onClick={() => dispatch({ type: 'showFloor', floorId: row.floorId })}>
            <span className="floor-short">{row.short}</span>
            <span className="floor-meta"><span className="floor-name">{row.label}</span><span className="floor-sub">{availability}</span></span>
            {(holdsSelection || holdsContext) && <span className={`cifc-floor-mark${holdsContext ? ' is-context' : ''}`} aria-hidden="true" />}
          </button>;
        })}
      </nav>
      <div className="cifc-view-ctrl">
        <div className="seg" role="group" aria-label="Model view">
          <button type="button" aria-pressed={!plan} onClick={() => dispatch({ type: 'view', view: '3d' })}>3D</button>
          <button type="button" aria-pressed={plan} onClick={() => dispatch({ type: 'view', view: 'plan' })}>Plan</button>
        </div>
        <div className="ctrl-group" role="group" aria-label="Camera">
          {!plan && <>
            <button type="button" className="ctrl-btn" aria-label="Turn model left" onClick={() => camera.turn(-45)}><Icon name="rotl" size={17} /></button>
            <button type="button" className="ctrl-btn" aria-label="Turn model right" onClick={() => camera.turn(45)}><Icon name="rotr" size={17} /></button>
          </>}
          <button type="button" className="ctrl-btn" aria-label="Zoom in" disabled={camera.zoom >= camera.zoomLimits.max} onClick={() => camera.zoomBy(1.3)}><Icon name="plus" size={17} /></button>
          <button type="button" className="ctrl-btn" aria-label="Zoom out" disabled={camera.zoom <= camera.zoomLimits.min} onClick={() => camera.zoomBy(1 / 1.3)}><Icon name="minus" size={17} /></button>
          <button type="button" className="ctrl-btn" aria-label={isolated ? 'Fit floor' : 'Fit whole model'} title={isolated ? 'Fit floor' : 'Fit whole model'} onClick={camera.fit}><Icon name="fit" size={17} /></button>
        </div>
        {!plan && hasMeshes && <button type="button" className="ctrl-btn ctrl-wide" aria-pressed={section}
          title={`Cut walls ${SECTION_HEIGHT} m above the floor's lowest geometry`} onClick={() => setSection(value => !value)}>
          <Icon name="layers" size={17} /><span>Section</span></button>}
      </div>
    </div>

    <div ref={viewport} className={`cifc-viewport${camera.dragging ? ' is-dragging' : ''}`} tabIndex={0} role="group"
      aria-label={`${plan ? 'Plan' : '3D'} of ${floor?.label ?? 'model'}. Arrow keys ${plan ? 'pan' : 'turn'}, plus and minus zoom, Escape clears the room.`}
      {...camera.bind}>
      {hasMeshes && projection && <div className="cifc-canvas-wrap" style={{ opacity: 1 - planBlend }}>
        <MeshLayer meshes={meshes} projection={projection} rules={rules} currentFloorId={floorId} selectedOccurrenceId={state.occurrenceId}
          contextOccurrenceIds={context} tints={tints} hidden={!showCanvas} onUnavailable={message => setFailure({ meshes, message })} />
      </div>}
      {projection && <svg className="cifc-svg" width={size.width} height={size.height} viewBox={`0 0 ${size.width} ${size.height}`} aria-hidden="true">
        {planBlend > 0 && planFeatures.length > 0 && <g className="cifc-plan" style={{ opacity: planBlend }} transform={projection.planMatrix(floorY)}>
          {planFeatures.map((feature, index) => {
            if (feature.role !== 'space') return null;
            const occurrenceId = feature.occurrenceId !== null && model.planShapes.has(feature.occurrenceId)
              && model.occurrences.get(feature.occurrenceId)?.occurrence.floorId === floorId ? feature.occurrenceId : null;
            const tier = occurrenceId === null ? ' is-display-only' : occurrenceId === state.occurrenceId ? ' is-selected' : context.includes(occurrenceId) ? ' is-context' : '';
            const tint = occurrenceId !== null && tier === '' ? tints.get(occurrenceId) : undefined;
            return <path key={`space-${index}`} d={paths[index]} fillRule="evenodd" vectorEffect="non-scaling-stroke"
              data-space-occurrence-id={occurrenceId ?? undefined} className={`cifc-plan-space${tier}`}
              style={tint ? { fill: tint } as CSSProperties : undefined} />;
          })}
          {planFeatures.map((feature, index) => feature.role === 'space' ? null
            : <path key={`${feature.role}-${index}`} d={paths[index]} fillRule="evenodd" vectorEffect="non-scaling-stroke" className={`cifc-plan-${feature.role}`} />)}
        </g>}
        <g className="cifc-labels">
          {labels.map(label => <g key={label.id} className={`cifc-label is-${label.tier}`} transform={`translate(${label.x.toFixed(1)} ${label.y.toFixed(1)})`}>
            {label.leader && <><line x1={0} y1={0} x2={0} y2={-34} /><circle r={3.5} /></>}
            <g transform={label.leader ? 'translate(0 -49)' : undefined}>
              <text className="cifc-label-halo" textAnchor="middle" dy="0.35em">{label.text}</text>
              <text textAnchor="middle" dy="0.35em">{label.text}</text>
              {label.count > 0 && overlay && <g className="cifc-label-badge" transform={`translate(${Math.min(110, label.text.length * 3.6) + 15} 0)`}>
                <circle r={10} style={{ fill: countFill }} /><text className="cifc-label-count" textAnchor="middle" dy="0.35em">{label.count}</text>
              </g>}
            </g>
          </g>)}
        </g>
      </svg>}
      {!bounds ? <p className="cifc-stage-note" role="status">No displayable geometry for {floor?.label ?? 'this publication'}.</p>
        : plan && planBlend >= 1 && floor && planFeatures.length === 0 ? <p className="cifc-stage-note" role="status">No 2D plan for {floor.label} in this publication.</p>
        : !plan && !hasMeshes ? <p className="cifc-stage-note" role="status">No 3D geometry for {floor?.label ?? 'this floor'}.</p>
        : !plan && unavailable ? <p className="cifc-stage-note" role="status">{unavailable} Plan remains available.</p> : null}
      <p className="cifc-hint" role="status" aria-live="polite">{hint?.key === hintKey ? hint.text : null}</p>
    </div>

    <div className="cifc-stage-foot">
      <div className="cifc-status">{status}</div>
      {model.overlays.length > 0 && <div className="layer-bar" role="group" aria-label="Overlay">
        <button type="button" className="layer-chip" aria-pressed={state.overlayId === null}
          style={{ '--layer': '#8C6A3C' } as CSSProperties} onClick={() => dispatch({ type: 'overlay', overlayId: null })}>
          <span className="layer-swatch" aria-hidden="true" />Rooms</button>
        {model.overlays.map(layer => <button key={layer.id} type="button" className="layer-chip" aria-pressed={state.overlayId === layer.id}
          style={{ '--layer': TONE_COLOR[layer.tone] } as CSSProperties} onClick={() => dispatch({ type: 'overlay', overlayId: layer.id })}>
          <span className="layer-swatch" aria-hidden="true" />{layer.label}</button>)}
      </div>}
    </div>
  </div>;
}
