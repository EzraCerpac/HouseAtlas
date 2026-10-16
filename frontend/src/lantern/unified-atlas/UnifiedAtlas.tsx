import {
  useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore, type CSSProperties, type PointerEvent as ReactPointerEvent, type RefObject,
} from 'react';
import { Icon } from '../components/Icon';
import { useReducedMotion, useStore } from '../state/store';
import { useEased } from '../atlas/useCamera';
import { makeProjection, relativePath, type DrawRules } from '../canonical-ifc/geometry';
import { GlbFormatError } from '../canonical-ifc/glb-preflight';
import { MeshLayer, RENDER_LIMITS } from '../canonical-ifc/MeshLayer';
import { useStageCamera } from '../canonical-ifc/useStageCamera';
import { TONE_COLOR, badgeFill, toneTint } from '../canonical-ifc/tones';
import { PREPARED_BYTES_PER_TRIANGLE } from '../site-artifacts/site-budget';
import type { ModelOverviewSelection } from '../source-models/overview-types';
import {
  atlasReducer, bindAtlasModel, contextOccurrenceIds, focusBuildingId, frameBox, hasExplodableLevels, initialAtlasState, labelHeight, levelLift, occurrenceLiftLevel, partLifts,
  pickOccurrence, planPickOccurrence, planPoint, presentAtlas,
  type AtlasAction, type AtlasModel, type AtlasViewState, type OverlayLayerIndex, type UnplacedReason,
} from './scene';
import { AtlasReadError, type AtlasLevel, type AtlasOccurrence, type AtlasRoom, type AtlasOverlayBinding, type AtlasReadFailure, type OverlayKind, type UnifiedAtlasPort } from './types';
import { floorLabel } from './labels';
import { documentaryOverlayIndex, type RuntimeRecords, type DocumentaryRecord, type SourceFact } from './runtime-overlays';
import { useDocumentaryOverlays } from './useDocumentaryOverlays';
import '../canonical-ifc/canonical-ifc.css';
import './unified-atlas.css';

/** One Atlas for the selected Blender/Bonsai publication: buildings, floors,
 * rooms and the same publication's plans in one renderer, one selection and
 * one camera. Every transition re-targets eased values, so the latest action
 * always wins; reduced motion snaps. */

type Outcome = { readonly status: 'ready'; readonly model: AtlasModel } | { readonly status: 'failed'; readonly reason: AtlasReadFailure };
interface Loaded { readonly selection: ModelOverviewSelection; readonly attempt: number; readonly outcome: Outcome }

const FAILURE: Record<AtlasReadFailure, { readonly text: string; readonly retry: string | null }> = {
  absent: { text: 'No room map is published for this model yet.', retry: null },
  stale: { text: 'The selected model changed while loading.', retry: 'Load again' },
  unavailable: { text: 'The room map could not be loaded.', retry: 'Try again' },
  invalid: { text: 'The room map does not match this model, so it is not shown.', retry: 'Check again' },
  'too-large': { text: 'This model is larger than the viewer supports.', retry: null },
};

// View state per exact publication and selection revision, for this tab only.
const memory = new Map<string, AtlasViewState>();
const MEMORY_ENTRIES = 8;
const memoryKey = (model: AtlasModel) => {
  const { scope, publication, selection } = model.scene;
  return `${scope.workspaceId}/${scope.homeId}/${publication.publicationId}/${selection.revision}`;
};
function remember(key: string, state: AtlasViewState) {
  memory.delete(key); memory.set(key, state);
  while (memory.size > MEMORY_ENTRIES) memory.delete(memory.keys().next().value!);
}

export default function UnifiedAtlas({ port, onOpenModel }: { readonly port: UnifiedAtlasPort; readonly onOpenModel?: () => void }) {
  const subscribe = useCallback((changed: () => void) => port.subscribe(changed), [port]);
  const current = useCallback(() => port.current(), [port]);
  const selection = useSyncExternalStore(subscribe, current, current);
  const [attempt, setAttempt] = useState(0);
  const [loaded, setLoaded] = useState<Loaded | null>(null);

  useEffect(() => {
    if (!selection) return;
    const controller = new AbortController(), signal = controller.signal;
    void (async () => {
      let outcome: Outcome;
      try {
        const read = await port.read(selection, signal);
        const { loadStandardGlb } = await import('../canonical-ifc/standard-glb');
        signal.throwIfAborted();
        // Prepared geometry is reserved from the preflight counts before the loader allocates.
        const glb = await loadStandardGlb(read.model, 'atlas', signal, admission => {
          if (admission.work.triangles * PREPARED_BYTES_PER_TRIANGLE > RENDER_LIMITS.uploadBytes) throw new AtlasReadError('too-large');
        });
        signal.throwIfAborted();
        outcome = { status: 'ready', model: bindAtlasModel(read.scene, glb) };
      } catch (error) {
        if (signal.aborted) return;
        // A model file the standard loader refuses does not match its room map.
        outcome = { status: 'failed', reason: error instanceof AtlasReadError ? error.reason
          : error instanceof GlbFormatError ? 'invalid' : 'unavailable' };
      }
      if (!signal.aborted) setLoaded({ selection, attempt, outcome });
    })();
    return () => controller.abort();
  }, [port, selection, attempt]);

  if (!selection) return <section className="ua-shell" aria-label="Atlas"><p className="ua-state" role="status">No model is selected.</p></section>;
  const outcome = loaded && loaded.selection === selection && loaded.attempt === attempt ? loaded.outcome : null;
  if (!outcome) return <section className="ua-shell is-loading" aria-label="Atlas" aria-busy="true">
    <div className="ua-state" role="status"><span className="ua-spinner" aria-hidden="true" />Loading the room map…</div>
  </section>;
  if (outcome.status === 'failed') {
    const failure = FAILURE[outcome.reason];
    return <section className="ua-shell" aria-label="Atlas">
      <div className="ua-state" role="alert">
        <p>{failure.text}</p>
        <div className="ua-state-actions">
          {failure.retry && <button type="button" className="btn btn-small" onClick={() => setAttempt(value => value + 1)}>{failure.retry}</button>}
          {onOpenModel && <button type="button" className="btn btn-small btn-quiet" onClick={onOpenModel}>Open model overview</button>}
        </div>
      </div>
    </section>;
  }
  return <AtlasStage key={memoryKey(outcome.model)} model={outcome.model} port={port} selection={selection} />;
}

// ---------------------------------------------------------------------------

const RULES: DrawRules = { visibleFloors: 'all', clipY: null };
const OVERLAY_LABEL: Record<OverlayKind, string> = { electrical: 'Electrical', network: 'Network' };
const OVERLAY_ICON: Record<OverlayKind, 'plug' | 'wifi'> = { electrical: 'plug', network: 'wifi' };
const UNPLACED_LABEL: Record<UnplacedReason, string> = {
  'not-linked': 'room not linked to a home place',
  'room-absent': 'room not in this model',
  'other-publication': 'from another model version',
  'occurrence-mismatch': 'floor part does not belong to the room',
};
const LINK_LABEL = { reviewed: 'Linked to a home place', historical: 'Linked in an earlier review only', unmapped: 'Not linked to a home place yet' } as const;
const plural = (count: number, one: string, many = `${one}s`) => `${count.toLocaleString()} ${count === 1 ? one : many}`;
const elevation = (value: number) => `${value > 0 ? '+' : value < 0 ? '−' : '±'}${Math.abs(value).toFixed(2)} m`;

function AtlasStage({ model, port, selection }: { readonly model: AtlasModel; readonly port: UnifiedAtlasPort; readonly selection: ModelOverviewSelection }) {
  const { dispatch: appDispatch } = useStore();
  const reduced = useReducedMotion();
  const key = memoryKey(model);
  const [state, setState] = useState<AtlasViewState>(() => memory.get(key) ?? initialAtlasState(model));
  const dispatch = useCallback((action: AtlasAction) => setState(value => atlasReducer(model, value, action)), [model]);
  useEffect(() => { remember(key, state); }, [key, state]);
  const [failure, setFailure] = useState<string | null>(null);
  const viewport = useRef<HTMLDivElement>(null);
  const plan = state.view === 'plan';

  const selected = state.occurrenceId;
  const context = useMemo(() => contextOccurrenceIds(model, selected), [model, selected]);
  const runtimeBuildingId = focusBuildingId(model, state) ?? model.defaultBuildingId;
  const runtime = useDocumentaryOverlays(port, selection, model, runtimeBuildingId, state.overlay !== null);
  const overlays = useMemo<ReadonlyMap<OverlayKind, OverlayLayerIndex>>(() => runtime.records ? new Map((['electrical', 'network'] as const).map(kind =>
    [kind, documentaryOverlayIndex(model, runtime.records!, kind)])) : port.createOverlays
      ? new Map((['electrical', 'network'] as const).map(kind => [kind, { kind, placed: new Map(), unplaced: [], records: 0, unplacedRecords: 0 } satisfies OverlayLayerIndex]))
      : model.overlays, [runtime.records, port, model]);
  const layer = state.overlay === null ? null : overlays.get(state.overlay)!;
  // Overlay rooms light in the layer tint; hidden room picks become visible for them only.
  const tints = useMemo(() => {
    const map = new Map<string, string>();
    if (layer) for (const placement of layer.placed.values()) for (const key of placement.occurrenceIds) map.set(key, toneTint(layer.kind));
    return map;
  }, [layer]);
  // Keyed by content, so an unchanged highlight set keeps the presentation stable.
  const highlightKey = [...new Set([...(selected ? [selected] : []), ...context, ...tints.keys()])].sort().join('\n');
  const highlighted = useMemo(() => new Set(highlightKey ? highlightKey.split('\n') : []), [highlightKey]);
  const presentation = useMemo(() => presentAtlas(model, state, highlighted), [model, state, highlighted]);

  // One eased frame for buildings, floors and plans, relative to a fixed model origin.
  const origin = useMemo(() => {
    const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
    for (const building of model.scene.buildings) for (let axis = 0; axis < 3; axis++) {
      min[axis] = Math.min(min[axis]!, building.bounds.min[axis]!); max[axis] = Math.max(max[axis]!, building.bounds.max[axis]!);
    }
    return [0, 1, 2].map(axis => (min[axis]! + max[axis]!) / 2) as unknown as readonly [number, number, number];
  }, [model]);
  const frame = useMemo(() => frameBox(model, state, presentation), [model, state, presentation]);
  const eased = useEased({
    cx: (frame.min[0] + frame.max[0]) / 2 - origin[0], cy: (frame.min[1] + frame.max[1]) / 2 - origin[1], cz: (frame.min[2] + frame.max[2]) / 2 - origin[2],
    sx: frame.max[0] - frame.min[0], sy: frame.max[1] - frame.min[1], sz: frame.max[2] - frame.min[2], explode: presentation.explodeTarget,
  }, { reduced, tau: 170 });
  const t = Math.min(1, Math.max(0, eased.explode));
  const bounds = useMemo(() => {
    const c = [eased.cx + origin[0], eased.cy + origin[1], eased.cz + origin[2]], s = [eased.sx, eased.sy, eased.sz];
    return { min: [0, 1, 2].map(axis => c[axis]! - s[axis]! / 2), max: [0, 1, 2].map(axis => c[axis]! + s[axis]! / 2) } as unknown as { min: readonly [number, number, number]; max: readonly [number, number, number] };
  }, [eased, origin]);

  const select = (occurrenceId: string | null) => dispatch({ type: 'select', occurrenceId });
  const camera = useStageCamera({ element: viewport, top: plan, reduced, onEscape: () => select(null),
    onTap: (px, py, target) => {
      const label = target instanceof Element ? target.closest<HTMLButtonElement>('button[data-atlas-occurrence]') : null;
      if (label?.dataset.atlasOccurrence && model.selectable.has(label.dataset.atlasOccurrence)) {
        select(label.dataset.atlasOccurrence); return;
      }
      if (!projection) return;
      if (camera.planBlend >= .5) {
        const levelId = presentation.focusLevelId; if (levelId === null) return;
        const [x, z] = planPoint(projection, model.floorY.get(levelId)! + levelLift(presentation, levelId, t), px, py);
        select(planPickOccurrence(model, presentation, levelId, x, z));
      } else select(pickOccurrence(model, presentation, t, projection, px, py));
    } });
  const { planBlend, size } = camera;
  const projection = useMemo(() => makeProjection(camera.eased, bounds, size, planBlend), [camera.eased, bounds, size, planBlend]);
  const lifts = useMemo(() => partLifts(model, presentation, t), [model, presentation, t]);
  const showCanvas = planBlend < 1 && failure === null;

  // Plan geometry relative to the fixed origin; one translate follows the eased centre.
  const planLevelId = presentation.focusLevelId;
  const planFeatures = useMemo(() => planLevelId === null ? [] : model.planByLevel.get(planLevelId)?.features ?? [], [model, planLevelId]);
  const planPaths = useMemo(() => planFeatures.map(feature => relativePath(model.featureRings.get(feature.featureId)!, origin)), [planFeatures, model, origin]);
  const planY = planLevelId === null ? 0 : model.floorY.get(planLevelId)! + levelLift(presentation, planLevelId, t);
  const planTransform = `${projection.planMatrix(planY)} translate(${origin[0] - projection.center[0]} ${origin[2] - projection.center[2]})`;
  const planShown = planBlend > 0 && planFeatures.length > 0;

  const lift = (occurrenceId: string) => levelLift(presentation, occurrenceLiftLevel(model, occurrenceId), t);
  const anchorOf = (occurrenceId: string) => {
    const point = model.labels.get(occurrenceId); if (!point) return null;
    const y = planBlend >= .5 ? model.floorY.get(model.occurrencesById.get(occurrenceId)!.levelId)! : labelHeight(model, presentation, occurrenceId, false);
    const [x, sy] = projection.project(point.x, y + lift(occurrenceId), point.z);
    return { x, y: sy, clearance: point.clearance };
  };

  const markers = useMemo(() => {
    if (!layer) return [];
    const rows: { key: string; occurrenceId: string; roomLabel: string; count: number; x: number; y: number }[] = [];
    for (const placement of layer.placed.values()) for (const occurrenceId of placement.occurrenceIds) {
      if (!presentation.pickable.has(occurrenceId)) continue;
      const at = anchorOf(occurrenceId); if (!at) continue;
      rows.push({ key: `${layer.kind}:${occurrenceId}`, occurrenceId, roomLabel: model.roomsById.get(placement.roomId)!.label,
        count: placement.recordIds.length, x: at.x, y: at.y });
    }
    return rows;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [layer, presentation, projection, t, planBlend, model]);
  const markerAt = useMemo(() => new Set(markers.map(row => row.occurrenceId)), [markers]);
  const positions = useMemo(() => {
    if (!layer) return [];
    return [...layer.placed.values()].flatMap(placement => placement.positions.flatMap(row => {
      if (!presentation.pickable.has(row.occurrenceId)) return [];
      const [x, y] = projection.project(row.position[0], row.position[1] + lift(row.occurrenceId), row.position[2]);
      return [{ key: `${row.occurrenceId}:${row.position.join(',')}`, x, y }];
    }));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [layer, presentation, projection, t]);

  const labels = useMemo(() => {
    const rows: { id: string; text: string; x: number; y: number; tier: 'selected' | 'context' | 'plain'; clearance: number; leader: boolean }[] = [];
    for (const occurrenceId of presentation.pickable) {
      const at = anchorOf(occurrenceId); if (!at) continue;
      const tier = occurrenceId === selected ? 'selected' : context.includes(occurrenceId) ? 'context' : 'plain';
      // Plain labels stay on the floor in focus; lower floors seen through the section stay quiet.
      if (tier === 'plain' && (at.clearance * projection.k < 18
        || (presentation.focusLevelId !== null && model.occurrencesById.get(occurrenceId)!.levelId !== presentation.focusLevelId))) continue;
      const lifted = markerAt.has(occurrenceId) ? 22 : 0;
      rows.push({ id: occurrenceId, text: model.roomsById.get(model.occurrencesById.get(occurrenceId)!.roomId)!.label, x: at.x, y: at.y - lifted,
        tier, clearance: at.clearance, leader: tier === 'selected' && planBlend < .5 });
    }
    const rank = { selected: 0, context: 1, plain: 2 } as const;
    rows.sort((a, b) => rank[a.tier] - rank[b.tier] || b.clearance - a.clearance);
    const placed: { l: number; r: number; t: number; b: number }[] = [];
    return rows.filter(row => {
      const w = Math.min(220, row.text.length * 7.2 + (row.tier === 'plain' ? 14 : 26)), h = row.tier === 'plain' ? 22 : 30;
      const top = row.leader ? row.y - 34 - h : row.y - h / 2;
      const box = { l: row.x - w / 2, r: row.x + w / 2, t: top, b: top + h };
      if (row.tier !== 'selected' && (box.l < 4 || box.r > size.width - 4 || box.t < 4 || box.b > size.height - 4
        || placed.some(o => box.l < o.r && box.r > o.l && box.t < o.b && box.b > o.t))) return false;
      placed.push(box); return true;
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [presentation, projection, t, planBlend, selected, context, markerAt, model, size]);

  // Only buildings with floors are navigable; context-only groups stay drawn around them.
  const buildings = model.floorBuildings;
  const ladderBuildingId = focusBuildingId(model, state);
  const ladderLevels = ladderBuildingId === null ? [] : model.levelsByBuilding.get(ladderBuildingId) ?? [];
  const building = ladderBuildingId === null ? null : model.buildingsById.get(ladderBuildingId)!;
  const focusLevel = presentation.focusLevelId === null ? null : model.levelsById.get(presentation.focusLevelId)!;
  const scopeLabel = focusLevel ? `${floorLabel(focusLevel.label)}${buildings.length > 1 ? `, ${model.buildingsById.get(focusLevel.buildingId)!.label}` : ''}`
    : state.buildingId === null && model.scene.buildings.length > 1 ? 'all buildings' : building?.label ?? 'this model';
  const canExplode = !plan && hasExplodableLevels(model, state.buildingId);
  const selectionLevel = selected ? model.occurrencesById.get(selected)!.levelId : null;
  const contextLevels = new Set(context.map(key => model.occurrencesById.get(key)!.levelId));

  return <section className={`ua-shell${plan ? ' is-plan' : ''}`} aria-label="Atlas">
    <header className="ua-head">
      {model.scene.buildings.length > 1 && buildings.length > 0 && <nav className="ua-buildings" aria-label="Buildings">
        <button type="button" className="chip-btn" aria-pressed={state.buildingId === null} disabled={plan}
          onClick={() => dispatch({ type: 'building', buildingId: null })}><Icon name="atlas" size={15} />All buildings</button>
        {buildings.map(row => <button key={row.buildingId} type="button" className="chip-btn" aria-pressed={state.buildingId === row.buildingId}
          onClick={() => dispatch({ type: 'building', buildingId: row.buildingId })}><Icon name="building" size={15} />{row.label}</button>)}
      </nav>}
      <div className="ua-tools">
        <div className="seg" role="group" aria-label="Atlas view">
          <button type="button" aria-pressed={!plan} onClick={() => dispatch({ type: 'view', view: '3d' })}>3D</button>
          <button type="button" aria-pressed={plan} onClick={() => dispatch({ type: 'view', view: 'plan' })}>Plan</button>
        </div>
        {canExplode && <button type="button" className="ctrl-btn ctrl-wide" aria-pressed={state.exploded}
          onClick={() => dispatch({ type: 'explode', exploded: !state.exploded })}>
          <Icon name="explode" size={17} /><span>{state.exploded ? 'Exploded' : 'Stacked'}</span></button>}
        <div className="ctrl-group" role="group" aria-label="Camera">
          {!plan && <>
            <button type="button" className="ctrl-btn" aria-label="Turn left" onClick={() => camera.turn(-45)}><Icon name="rotl" size={17} /></button>
            <button type="button" className="ctrl-btn" aria-label="Turn right" onClick={() => camera.turn(45)}><Icon name="rotr" size={17} /></button>
          </>}
          <button type="button" className="ctrl-btn" aria-label="Zoom in" disabled={camera.zoom >= camera.zoomLimits.max} onClick={() => camera.zoomBy(1.3)}><Icon name="plus" size={17} /></button>
          <button type="button" className="ctrl-btn" aria-label="Zoom out" disabled={camera.zoom <= camera.zoomLimits.min} onClick={() => camera.zoomBy(1 / 1.3)}><Icon name="minus" size={17} /></button>
          <button type="button" className="ctrl-btn" aria-label="Fit view" title="Fit view" onClick={camera.fit}><Icon name="fit" size={17} /></button>
        </div>
      </div>
    </header>

    <div className="ua-body">
      <DatumLadder model={model} levels={ladderLevels} building={building} state={state} plan={plan} dispatch={dispatch}
        selectionLevel={selectionLevel} contextLevels={contextLevels} />

      <div ref={viewport} className={`cifc-viewport ua-viewport${camera.dragging ? ' is-dragging' : ''}`} tabIndex={0} role="group"
        aria-label={`${plan ? 'Plan' : '3D'} of ${scopeLabel}. Arrow keys ${plan ? 'pan' : 'turn'}, plus and minus zoom, Escape clears the room.`}
        {...camera.bind}>
        <div className="cifc-canvas-wrap" style={{ opacity: 1 - planBlend }}>
          <MeshLayer meshes={model.meshes} projection={projection} rules={RULES} currentFloorId={presentation.focusLevelId}
            selectedOccurrenceId={selected} contextOccurrenceIds={context} tints={tints} hidden={!showCanvas}
            hiddenKeys={presentation.hidden} lifts={lifts} clips={presentation.clips} dims={presentation.dims}
            onUnavailable={message => setFailure(message)} />
        </div>
        <svg className="cifc-svg" width={size.width} height={size.height} viewBox={`0 0 ${size.width} ${size.height}`} aria-hidden="true">
          {planShown && <g className="ua-plan" style={{ opacity: planBlend }} transform={planTransform}>
            {planFeatures.map((feature, at) => {
              if (feature.role !== 'room') return null;
              const key = feature.spaceOccurrenceId;
              const live = key !== null && presentation.pickable.has(key);
              const tier = !live ? ' is-display-only' : key === selected ? ' is-selected' : context.includes(key) ? ' is-context' : '';
              const tint = live && tier === '' ? tints.get(key) : undefined;
              return <path key={feature.featureId} d={planPaths[at]} fillRule="evenodd" vectorEffect="non-scaling-stroke"
                className={`cifc-plan-space${tier}`} style={tint ? { fill: tint } as CSSProperties : undefined} />;
            })}
            {planFeatures.map((feature, at) => feature.role === 'room' ? null
              : <path key={feature.featureId} d={planPaths[at]} fillRule="evenodd" vectorEffect="non-scaling-stroke" className={`ua-plan-${feature.role}`} />)}
          </g>}
          {layer && <g className="ua-positions" style={{ '--layer': TONE_COLOR[layer.kind] } as CSSProperties}>
            {positions.map(row => <rect key={row.key} x={row.x - 4} y={row.y - 4} width={8} height={8} transform={`rotate(45 ${row.x} ${row.y})`} />)}
          </g>}
          <g className="cifc-labels">
            {labels.map(label => <g key={label.id} className={`cifc-label is-${label.tier}`} transform={`translate(${label.x.toFixed(1)} ${label.y.toFixed(1)})`}>
              {label.leader && <><line x1={0} y1={0} x2={0} y2={-34} /><circle r={3.5} /></>}
              <g transform={label.leader ? 'translate(0 -49)' : undefined}>
                <text className="cifc-label-halo" textAnchor="middle" dy="0.35em">{label.text}</text>
                <text textAnchor="middle" dy="0.35em">{label.text}</text>
              </g>
            </g>)}
          </g>
        </svg>
        {labels.filter(label => {
          const half = Math.max(44, Math.min(320, label.text.length * 7 + 12)) / 2, y = label.y - (label.leader ? 49 : 0);
          return label.x >= half && label.x + half <= size.width && y >= 16 && y + 16 <= size.height;
        }).map(label => <button key={label.id} type="button" className="ua-label-hit" data-atlas-occurrence={label.id}
          style={{ left: label.x, top: label.y - (label.leader ? 49 : 0), width: Math.max(44, Math.min(320, label.text.length * 7 + 12)) }}
          aria-label={`Select room: ${label.text}`} onClick={event => { if (event.detail === 0) select(label.id); }} />)}
        {layer && markers.map(row => <button key={row.key} type="button" className="ua-marker"
          style={{ left: row.x, top: row.y, '--layer': badgeFill(layer.kind) } as CSSProperties}
          aria-label={`${row.roomLabel}: ${plural(row.count, `${OVERLAY_LABEL[layer.kind].toLowerCase()} record`)}`}
          onPointerDown={stop} onPointerUp={stop} onClick={() => select(row.occurrenceId)}>{row.count}</button>)}
        {failure && !plan && <p className="cifc-stage-note" role="status">3D view is unavailable. Use Plan or check Source details.</p>}
        {plan && planBlend >= 1 && planFeatures.length === 0 && <p className="cifc-stage-note" role="status">
          {focusLevel ? `No plan for ${floorLabel(focusLevel.label)} in this model.` : 'This model has no floors to show as a plan.'}</p>}
      </div>

      <Inspector model={model} state={state} dispatch={dispatch} context={context} renderFailure={failure}
        runtime={runtime.records} runtimeReason={runtime.reason} runtimeConfigured={Boolean(port.createOverlays)}
        openDocuments={() => appDispatch({ type: 'view', view: 'library' })}
        openNetwork={() => appDispatch({ type: 'view', view: 'network' })} />
    </div>

    <footer className="ua-foot">
      <div className="layer-bar" role="group" aria-label="Overlay">
        <button type="button" className="layer-chip" aria-pressed={state.overlay === null} style={{ '--layer': '#8C6A3C' } as CSSProperties}
          onClick={() => dispatch({ type: 'overlay', overlay: null })}><span className="layer-swatch" aria-hidden="true" />Rooms</button>
        {(['electrical', 'network'] as const).map(kind => {
          const index = overlays.get(kind)!;
          return <button key={kind} type="button" className="layer-chip" aria-pressed={state.overlay === kind}
            style={{ '--layer': TONE_COLOR[kind] } as CSSProperties} onClick={() => dispatch({ type: 'overlay', overlay: kind })}>
            <span className="layer-swatch" aria-hidden="true" />{OVERLAY_LABEL[kind]}
            {state.overlay === kind && index.records === 0 && <span className="ua-chip-note">{!port.createOverlays || runtime.records?.[kind] === 'available' ? '0' : runtime.reason === 'loading' ? 'loading' : runtime.records?.[kind] === 'partial' ? 'partial' : 'unavailable'}</span>}</button>;
        })}
      </div>
      {layer && <OverlayKey layer={layer} sourceScope={port.createOverlays && runtimeBuildingId ? model.buildingsById.get(runtimeBuildingId)!.label : null}
        publishedOnly={!port.createOverlays} unplaced={runtime.records?.unplaced[layer.kind] ?? []} openDocuments={() => appDispatch({ type: 'view', view: 'library' })} availability={runtime.records?.[layer.kind] ?? (!port.createOverlays ? 'available' : runtime.reason === 'loading' ? 'loading' : 'unavailable')}
        openNetwork={() => appDispatch({ type: 'view', view: 'network' })} />}
    </footer>
  </section>;
}

const stop = (event: ReactPointerEvent) => event.stopPropagation();

// ---------------------------------------------------------------------------

/** Floors at their actual scene heights: spacing follows the lowest room
 * floor of each level, with a minimum touch gap; numerals are shown only when
 * the source records an elevation. */
function DatumLadder({ model, levels, building, state, plan, dispatch, selectionLevel, contextLevels }: {
  readonly model: AtlasModel; readonly levels: readonly AtlasLevel[]; readonly building: { readonly label: string } | null;
  readonly state: AtlasViewState; readonly plan: boolean; readonly dispatch: (action: AtlasAction) => void;
  readonly selectionLevel: string | null; readonly contextLevels: ReadonlySet<string>;
}) {
  const top = [...levels].reverse();
  const gaps = top.map((level, at) => {
    const below = top[at + 1]; if (!below) return 0;
    return Math.max(44, (model.floorY.get(level.levelId)! - model.floorY.get(below.levelId)!) * 18);
  });
  const whole = state.levelId === null && !plan;
  return <nav className="ua-ladder" aria-label={building ? `Floors of ${building.label}` : 'Floors'}>
    <button type="button" className={`ua-rung ua-rung-all${whole ? ' is-current' : ''}`} aria-pressed={whole} disabled={plan || levels.length === 0}
      onClick={() => dispatch({ type: 'level', levelId: null })}>
      <span className="ua-rung-name">All floors</span>
    </button>
    <ol className="ua-rungs">
      {top.map((level, at) => {
        const current = state.levelId === level.levelId;
        const holds = selectionLevel === level.levelId, also = !holds && contextLevels.has(level.levelId);
        const rooms = level.occurrenceIds.filter(key => model.selectable.has(key)).length;
        const hasPlan = model.planByLevel.has(level.levelId);
        // Spacing above this floor: its height difference to the floor listed before it.
        return <li key={level.levelId} style={at > 0 ? { '--rung-gap': `${gaps[at - 1]}px` } as CSSProperties : undefined}>
          <button type="button" className={`ua-rung${current ? ' is-current' : ''}`} aria-pressed={current}
            title={level.elevationBasis ?? undefined}
            aria-label={`${floorLabel(level.label)}: ${plural(rooms, 'room')}${hasPlan ? '' : ', no plan'}${holds ? ', has the selected room' : also ? ', has another part of the selected room' : ''}`}
            onClick={() => dispatch({ type: 'level', levelId: level.levelId })}>
            <span className="ua-rung-tick" aria-hidden="true" />
            <span className="ua-rung-name">{floorLabel(level.label)}</span>
            {(holds || also) && <span className={`ua-rung-mark${also ? ' is-context' : ''}`} aria-hidden="true" />}
          </button>
        </li>;
      })}
    </ol>
  </nav>;
}

// ---------------------------------------------------------------------------

function Inspector({ model, state, dispatch, context, openNetwork, openDocuments, renderFailure, runtime, runtimeReason, runtimeConfigured }: {
  readonly model: AtlasModel; readonly state: AtlasViewState; readonly dispatch: (action: AtlasAction) => void;
  readonly context: readonly string[]; readonly openNetwork: () => void;
  readonly renderFailure: string | null;
  readonly runtime: RuntimeRecords | null; readonly runtimeReason: string; readonly runtimeConfigured: boolean;
  readonly openDocuments: () => void;
}) {
  const occurrence = state.occurrenceId === null ? null : model.occurrencesById.get(state.occurrenceId)!;
  // A choice made inside the panel replaces its content, so focus follows to the new heading.
  const heading = useRef<HTMLHeadingElement>(null);
  const refocus = useRef(false);
  const choose = (occurrenceId: string | null) => { refocus.current = true; dispatch({ type: 'select', occurrenceId }); };
  useEffect(() => {
    if (!refocus.current) return;
    refocus.current = false; heading.current?.focus();
  }, [state.occurrenceId]);
  const levelName = (levelId: string) => {
    const level = model.levelsById.get(levelId)!;
    return model.floorBuildings.length > 1 ? `${floorLabel(level.label)}, ${model.buildingsById.get(level.buildingId)!.label}` : floorLabel(level.label);
  };

  if (!occurrence) return <aside className="ua-inspector" aria-label="Rooms">
    <RoomList model={model} state={state} choose={choose} levelName={levelName} heading={heading} />
    <SourceDetails model={model} renderFailure={renderFailure} overlayReason={runtimeReason} runtimeSource={runtime?.sourceFacts ?? []} />
  </aside>;

  const room = model.roomsById.get(occurrence.roomId)!;
  const basis = occurrence.geometryBasis;
  const overlays = (['electrical', 'network'] as const).map(kind => {
    const index = model.overlays.get(kind)!;
    return { kind, placement: index.placed.get(room.roomId) ?? null, unplaced: index.unplaced.filter(row => row.binding.roomId === room.roomId) };
  }).filter(row => !runtimeConfigured && (row.placement || row.unplaced.length > 0));
  return <aside className="ua-inspector is-room" aria-label="Selected room">
    <div className="ua-room-head">
      <h2 ref={heading} tabIndex={-1}>{room.label}</h2>
      <button type="button" className="ctrl-btn" aria-label="Clear room" onClick={() => choose(null)}><Icon name="close" size={17} /></button>
    </div>
    <p className="ua-room-floor">{levelName(occurrence.levelId)}</p>
    {context.length > 0 && <div className="ua-also" role="group" aria-label="Also on">
      <span>Also on</span>
      {context.map(key => <button key={key} type="button" className="chip-btn" onClick={() => choose(key)}>
        {levelName(model.occurrencesById.get(key)!.levelId)}</button>)}
    </div>}

    <dl className="ua-facts">
      <div><dt>Layout</dt><dd>{basis.kind === 'owner-estimated-pick-proxy' ? 'Estimated layout' : 'From the model'}</dd></div>
      <div><dt>Home place</dt><dd className={`ua-link is-${room.nativeBinding.status}`}>{runtime?.rooms.has(room.roomId) ? 'Linked for these sources' : room.nativeBinding.status === 'historical' ? 'Link needs review' : LINK_LABEL[room.nativeBinding.status]}</dd></div>
    </dl>

    {state.overlay && runtime && <section className="ua-records" aria-label={`${OVERLAY_LABEL[state.overlay]} in this room`}>
      <h3>{OVERLAY_LABEL[state.overlay]}</h3>
      {!runtime.rooms.has(room.roomId) ? <p>Room source link unavailable.</p>
        : runtime[state.overlay] === 'unavailable' ? <p>Source unavailable.</p>
        : <DocumentaryRecords records={runtime.rooms.get(room.roomId)![state.overlay]} openDocuments={openDocuments} />}
      {runtime[state.overlay] === 'partial' && <p>Some electrical sources are unavailable.</p>}
    </section>}

    {overlays.length > 0 && <section className="ua-records" aria-label="Records in this room">
      {overlays.map(({ kind, placement, unplaced }) => <div key={kind} className="ua-record" style={{ '--layer': TONE_COLOR[kind] } as CSSProperties}>
        <h3><Icon name={OVERLAY_ICON[kind]} size={16} />{OVERLAY_LABEL[kind]}</h3>
        {placement && <>
          <p>{plural(placement.recordIds.length, 'record')}{placement.positions.length > 0 ? `, ${placement.positions.length} with a source position` : ''}</p>
          <SourceDates bindings={placement.bindings} />
          <details className="ua-refs"><summary>Record references</summary>
            <ul>{placement.recordIds.map(record => <li key={record}>{record}</li>)}</ul></details>
        </>}
        {unplaced.length > 0 && <p className="ua-unplaced">
          {plural(new Set(unplaced.flatMap(row => row.binding.recordIds)).size, 'record')} not placed: {[...new Set(unplaced.map(row => UNPLACED_LABEL[row.reason]))].join('; ')}.</p>}
        {kind === 'network' && <button type="button" className="text-btn" onClick={openNetwork}>Open Network</button>}
      </div>)}
    </section>}
    <SourceDetails model={model} occurrence={occurrence} room={room} renderFailure={renderFailure} overlayReason={runtimeReason} runtimeSource={runtime?.sourceFacts ?? []} />
  </aside>;
}

function DocumentaryRecords({ records, openDocuments }: { readonly records: readonly DocumentaryRecord[]; readonly openDocuments: () => void }) {
  if (!records.length) return <p>No linked records in the available source.</p>;
  return <div>{records.map(record => <details className="ua-refs" key={record.key}>
    <summary>{record.label}</summary>
    <p>{record.category}: {record.detail}</p><p>{record.qualification}</p>
    <p>Source date: {record.sourceDate ?? 'unknown'}. Retrieved: {record.retrievedAt ?? 'unknown'}.</p>
    {record.connections.length > 0 && <ul>{record.connections.map((connection, at) => <li key={at}>{connection}</li>)}</ul>}
    {(record.category === 'Electrical drawing' || record.category === 'Historical symbol') && <button type="button" className="text-btn" onClick={openDocuments}>Open Documents</button>}
    <details className="ua-source"><summary>Source</summary><dl><div><dt>Source record</dt><dd>{record.id}</dd></div>
      {record.sourceFacts.map(fact => <div key={fact.label}><dt>{fact.label}</dt><dd>{fact.value ?? 'unknown'}</dd></div>)}
    </dl></details>
  </details>)}</div>;
}

function SourceDates({ bindings }: { readonly bindings: readonly AtlasOverlayBinding[] }) {
  const rows = [...new Map(bindings.map(row => [`${row.sourceRevision}|${row.sourceUpdatedAt}|${row.retrievedAt}`, row])).values()];
  return <ul className="ua-dates">
    {rows.map(row => <li key={`${row.sourceRevision}|${row.sourceUpdatedAt}|${row.retrievedAt}`}>
      Source {row.sourceRevision}
      {row.sourceUpdatedAt ? <>, updated <time dateTime={row.sourceUpdatedAt}>{row.sourceUpdatedAt}</time></> : ', update date unknown'}
      {row.retrievedAt ? <>, retrieved <time dateTime={row.retrievedAt}>{row.retrievedAt}</time></> : ', retrieval date unknown'}
    </li>)}
  </ul>;
}

function RoomList({ model, state, choose, levelName, heading }: {
  readonly model: AtlasModel; readonly state: AtlasViewState; readonly choose: (occurrenceId: string) => void;
  readonly levelName: (levelId: string) => string; readonly heading: RefObject<HTMLHeadingElement | null>;
}) {
  const levels = state.levelId !== null ? [model.levelsById.get(state.levelId)!]
    : model.scene.buildings.filter(row => state.buildingId === null || row.buildingId === state.buildingId)
      .flatMap(row => [...model.levelsByBuilding.get(row.buildingId)!].reverse());
  const coverage = model.scene.coverage;
  return <div className="ua-rooms">
    <h2 ref={heading} tabIndex={-1}>Rooms</h2>
    {levels.map(level => {
      const keys = level.occurrenceIds.filter(key => model.selectable.has(key));
      return <section key={level.levelId} aria-label={levelName(level.levelId)}>
        <h3>{levelName(level.levelId)}</h3>
        {keys.length === 0 ? <p className="ua-empty">No selectable rooms.</p>
          : <ul>{keys.map(key => {
            const occurrence = model.occurrencesById.get(key)!, room = model.roomsById.get(occurrence.roomId)!;
            return <li key={key}><button type="button" className="ua-room-btn" onClick={() => choose(key)}>
              <span>{room.label}</span>
              {occurrence.geometryBasis.kind === 'owner-estimated-pick-proxy' && <span className="ua-tag">Preliminary</span>}
            </button></li>;
          })}</ul>}
      </section>;
    })}
    {coverage.unselectableCount > 0 && <p className="ua-coverage">{plural(coverage.unselectableCount, 'room part')} in this model cannot be selected yet.</p>}
  </div>;
}

function SourceDetails({ model, occurrence, room, renderFailure, overlayReason, runtimeSource }: {
  readonly model: AtlasModel; readonly occurrence?: AtlasOccurrence; readonly room?: AtlasRoom; readonly renderFailure: string | null;
  readonly overlayReason: string;
  readonly runtimeSource?: readonly SourceFact[];
}) {
  const { publication, coverage } = model.scene;
  const elevations = model.scene.levels.filter(level => level.elevationBasis !== null || level.sourceElevationM !== null);
  return <details className="ua-source">
    <summary>Source</summary>
    <dl>
      <div><dt>Model revision</dt><dd>{publication.sourceRevisionId}</dd></div>
      <div><dt>Model file</dt><dd><code title={model.scene.model.sha256}>{model.scene.model.sha256.slice(0, 12)}</code>, {(model.scene.model.bytes / 1_048_576).toFixed(1)} MiB</dd></div>
      {renderFailure && <div><dt>3D diagnostic</dt><dd>{renderFailure}</dd></div>}
      {overlayReason !== 'not-loaded' && <div><dt>Overlay source</dt><dd>{overlayReason}</dd></div>}
      {runtimeSource?.map(fact => <div key={fact.label}><dt>{fact.label}</dt><dd>{fact.value ?? 'unknown'}</dd></div>)}
      {occurrence && <div><dt>Room layout</dt><dd>{occurrence.geometryBasis.kind === 'owner-estimated-pick-proxy' ? 'Estimated pick area; not measured or reviewed.' : 'Source model geometry.'}
        {occurrence.geometryBasis.note && <span className="ua-note">{occurrence.geometryBasis.note}</span>}</dd></div>}
      {occurrence?.geometryBasis.sourceRef && <div><dt>Room source</dt><dd>{occurrence.geometryBasis.sourceRef}</dd></div>}
      {room && <div><dt>Place link</dt><dd>{LINK_LABEL[room.nativeBinding.status]}</dd></div>}
      <div><dt>Position</dt><dd>Model frame only. Not aligned to the physical site.</dd></div>
      {elevations.length > 0 && <div><dt>Source elevations</dt><dd><ul>{elevations.map(level => <li key={level.levelId}>{floorLabel(level.label)}: {level.sourceElevationM !== null ? `${elevation(level.sourceElevationM)}; ` : ''}{level.elevationBasis ?? 'Datum not specified.'}</li>)}</ul></dd></div>}
      {coverage.exclusions.length > 0 && <div><dt>Not selectable</dt><dd><ul>
        {coverage.exclusions.map((row, at) => <li key={at}>{row.id && model.occurrencesById.has(row.id)
          ? model.roomsById.get(model.occurrencesById.get(row.id)!.roomId)!.label : row.id ?? 'Unnamed'}{row.reason ? `: ${row.reason}` : ''}</li>)}
      </ul></dd></div>}
    </dl>
  </details>;
}

function OverlayKey({ layer, openNetwork, availability, unplaced, openDocuments, publishedOnly, sourceScope }: {
  readonly layer: OverlayLayerIndex; readonly openNetwork: () => void; readonly openDocuments: () => void; readonly unplaced: readonly DocumentaryRecord[]; readonly availability: 'available' | 'partial' | 'unavailable' | 'loading';
  readonly publishedOnly: boolean;
  readonly sourceScope: string | null;
}) {
  const reasons = new Map<UnplacedReason, number>();
  for (const row of layer.unplaced) reasons.set(row.reason, (reasons.get(row.reason) ?? 0) + row.binding.recordIds.length);
  return <div className="ua-key" style={{ '--layer': TONE_COLOR[layer.kind] } as CSSProperties}>
    {sourceScope && <span>{sourceScope} source records only</span>}
    <p>{availability === 'loading' ? 'Loading room sources…' : availability === 'unavailable' ? 'Current room sources are unavailable.'
      : availability === 'partial' ? 'Some electrical sources are unavailable.'
      : publishedOnly && layer.records === 0 ? 'No source references in this publication.'
      : layer.records === 0 ? 'No linked records in the available source.' : 'Counts show source records per room, not device positions.'}</p>
    {layer.unplacedRecords > 0 && <details>
      <summary>{plural(layer.unplacedRecords, 'record')} not placed</summary>
      {unplaced.length > 0 ? <DocumentaryRecords records={unplaced} openDocuments={openDocuments} />
        : <ul>{[...reasons].map(([reason, count]) => <li key={reason}>{plural(count, 'record')}: {UNPLACED_LABEL[reason]}</li>)}</ul>}
    </details>}
    {layer.kind === 'network' && <button type="button" className="text-btn" onClick={openNetwork}>Open Network</button>}
  </div>;
}
