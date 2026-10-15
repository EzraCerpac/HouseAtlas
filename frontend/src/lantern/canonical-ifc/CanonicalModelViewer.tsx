import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { admitPresentation, PresentationError } from './model';
import type { AdmittedPresentation, CanonicalPresentation } from './model';
import { LABEL_WORK, labelPoint, prepareMeshes } from './geometry';
import { joinOverlay } from './overlays';
import { decodeMemory, encodeMemory, memoryKey, reconcile, recordOf, viewerReducer } from './selection';
import type { RestoreNotice, ViewerAction, ViewerMemoryPort, ViewerState } from './selection';
import { ModelStage, type LabelPoint } from './ModelStage';
import { RoomPanel } from './RoomPanel';
import { toneTint } from './tones';
import { motionQuery, useReducedMotionPreference } from './useStageCamera';
import './canonical-ifc.css';

export interface CanonicalModelViewerProps {
  /** One publication's internal presentation; never fetched by this component. */
  readonly presentation: CanonicalPresentation;
  /** Optional ID-only view memory. Without it nothing persists. */
  readonly memory?: ViewerMemoryPort | null;
  readonly onSelectionChange?: (selection: { readonly publicationId: string; readonly occurrenceId: string | null }) => void;
}

type Admission = { readonly ok: true; readonly model: AdmittedPresentation } | { readonly ok: false; readonly reason: string };
interface Store { readonly model: AdmittedPresentation; readonly state: ViewerState; readonly notice: RestoreNotice | null }


/** Synchronized plan and 3D views of one canonical model publication. Both
 * views draw the same admitted data through one camera; switching views or
 * floors never changes the publication or the selected space occurrence. */
export function CanonicalModelViewer({ presentation, memory = null, onSelectionChange }: CanonicalModelViewerProps) {
  const admission = useMemo<Admission>(() => {
    try { return { ok: true, model: admitPresentation(presentation) }; }
    catch (error) { if (error instanceof PresentationError) return { ok: false, reason: error.message }; throw error; }
  }, [presentation]);
  if (!admission.ok) return <div className="cifc cifc-unavailable" role="status">
    <h2>Model unavailable</h2><p>This model presentation failed its identity checks ({admission.reason}). Nothing from it is shown.</p>
  </div>;
  return <AdmittedViewer model={admission.model} memory={memory} onSelectionChange={onSelectionChange} />;
}

function AdmittedViewer({ model, memory, onSelectionChange }: { readonly model: AdmittedPresentation; readonly memory: ViewerMemoryPort | null;
  readonly onSelectionChange: CanonicalModelViewerProps['onSelectionChange'] }) {
  const key = memoryKey(model);
  const viewport = useRef<HTMLDivElement>(null);
  const [store, setStore] = useState<Store>(() => ({ model, ...reconcile(model, decodeMemory(memory?.read(key) ?? null)) }));
  // A new publication of the same building re-reconciles the current view by
  // identical IDs only; another building starts from its own scoped memory.
  let current = store;
  if (store.model !== model) {
    const sameBuilding = memoryKey(store.model) === key;
    current = { model, ...reconcile(model, sameBuilding ? recordOf(store.model, store.state) : decodeMemory(memory?.read(key) ?? null)) };
    setStore(current);
  }
  const { state, notice } = current;

  useEffect(() => { memory?.write(key, encodeMemory(model, state)); }, [memory, key, model, state]);
  useEffect(() => { onSelectionChange?.({ publicationId: state.publicationId, occurrenceId: state.occurrenceId }); },
    [onSelectionChange, state.publicationId, state.occurrenceId]);

  const dispatch = useCallback((action: ViewerAction) => setStore(value => value.model !== model ? value : {
    ...value, state: viewerReducer(model, value.state, action), notice: action.type === 'selectOccurrence' ? null : value.notice }), [model]);
  const dismissNotice = useCallback(() => setStore(value => ({ ...value, notice: null })), []);
  const returnToModel = useCallback(() => {
    const node = viewport.current; if (!node) return;
    node.scrollIntoView({ block: 'start', behavior: matchMedia(motionQuery).matches ? 'auto' : 'smooth' });
    node.focus({ preventScroll: true });
  }, []);

  const reduced = useReducedMotionPreference();
  const meshes = useMemo(() => prepareMeshes(model.source.meshes, mesh => model.meshOccurrence.get(mesh.meshKey) ?? null), [model]);
  // Bounded label search: one shared edge-visit budget for the whole model.
  const labelPoints = useMemo(() => {
    const points = new Map<string, LabelPoint>(), budget = { remaining: LABEL_WORK };
    for (const [occurrenceId, shape] of model.planShapes) { const point = labelPoint(shape, budget); if (point) points.set(occurrenceId, point); }
    return points;
  }, [model]);
  const layer = state.overlayId !== null ? model.overlays.find(row => row.id === state.overlayId) ?? null : null;
  const overlay = useMemo(() => layer ? joinOverlay(model, layer) : null, [model, layer]);
  const tints = useMemo(() => {
    const result = new Map<string, string>();
    if (overlay) for (const roomId of overlay.byRoom.keys())
      for (const row of model.roomsById.get(roomId)?.occurrences ?? []) result.set(row.spaceOccurrenceId, toneTint(overlay.layer.tone));
    return result;
  }, [model, overlay]);

  const origin = model.source.origin, pin = model.source.publication;
  const synthetic = origin.kind === 'synthetic-fixture' || origin.transport === 'synthetic-fixture';
  const status = <>
    {synthetic && <span className="cifc-chip is-synthetic">Synthetic fixture</span>}
    {origin.kind === 'synthetic-fixture' && origin.coverage === 'generated-presentation-coverage' && <span className="cifc-chip is-synthetic">Generated coverage</span>}
    {origin.kind === 'adapted-publication' && origin.transport === 'synthetic-fixture' && <span className="cifc-chip is-synthetic">Mock ready</span>}
    <span className={`cifc-chip ${pin.selection.mode === 'preview' ? 'is-preview' : 'is-published'}`}>{pin.selection.mode === 'preview' ? 'Preview' : 'Published'}</span>
  </>;

  return <div className="cifc" data-publication-id={pin.publicationId}><div className="cifc-layout">
    <ModelStage model={model} meshes={meshes} labelPoints={labelPoints} state={state} dispatch={dispatch}
      overlay={overlay} tints={tints} reduced={reduced} status={status} viewport={viewport} />
    <RoomPanel model={model} state={state} dispatch={dispatch} overlay={overlay} notice={notice} onDismissNotice={dismissNotice} onReturnToModel={returnToModel} />
  </div></div>;
}
