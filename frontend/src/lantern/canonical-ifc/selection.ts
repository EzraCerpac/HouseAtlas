import { isOpaqueToken, type AdmittedPresentation } from './model';

/** Viewer state over exactly one admitted publication. The selection target
 * is (publicationId, spaceOccurrenceId); its logical room is context. The
 * visible floor is separate; plan/3D switching never changes data. */
export type ViewMode = 'plan' | '3d';
export interface ViewerState {
  readonly publicationId: string;
  readonly occurrenceId: string | null;
  readonly floorId: string | null;
  readonly view: ViewMode;
  /** Overlay layer ID; null shows rooms only. */
  readonly overlayId: string | null;
}

export type RestoreNotice =
  | { readonly kind: 'carried'; readonly fromPublicationId: string }
  | { readonly kind: 'room-absent'; readonly fromPublicationId: string };

export type ViewerAction =
  | { readonly type: 'selectOccurrence'; readonly occurrenceId: string | null }
  | { readonly type: 'showFloor'; readonly floorId: string }
  | { readonly type: 'view'; readonly view: ViewMode }
  | { readonly type: 'overlay'; readonly overlayId: string | null };

/** Persisted memory: publication pin and IDs only. No labels, bytes, grants,
 * availability or authority are stored or revived. */
export interface ViewerMemoryRecord {
  readonly v: 2;
  readonly publicationId: string;
  readonly roomId: string | null;
  readonly occurrenceId: string | null;
  readonly floorId: string | null;
  readonly view: ViewMode;
  readonly overlayId: string | null;
}

export interface ViewerMemoryPort {
  read(key: string): string | null;
  write(key: string, value: string): void;
  remove?(key: string): void;
}

const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const KEYS = ['v', 'publicationId', 'roomId', 'occurrenceId', 'floorId', 'view', 'overlayId'] as const;
const nullableId = (value: unknown): value is string | null => value === null || typeof value === 'string' && ID.test(value);

/** Memory is scoped by workspace, home and building identity. */
export function scopedMemoryKey(scope: { readonly workspaceId: string; readonly homeId: string } | null, buildingId: string): string {
  return `houseatlas.canonical-model-view.v2:${JSON.stringify([scope?.workspaceId ?? null, scope?.homeId ?? null, buildingId])}`;
}
export const memoryKey = (model: AdmittedPresentation) => scopedMemoryKey(model.source.building.scope, model.source.building.buildingId);

export function encodeMemory(model: AdmittedPresentation, state: ViewerState): string {
  const record: ViewerMemoryRecord = { v: 2, publicationId: state.publicationId,
    roomId: state.occurrenceId !== null ? model.occurrences.get(state.occurrenceId)?.room.roomId ?? null : null,
    occurrenceId: state.occurrenceId, floorId: state.floorId, view: state.view, overlayId: state.overlayId };
  return JSON.stringify(record);
}

/** Strict decode; anything unexpected is ignored rather than partially trusted. */
export function decodeMemory(text: string | null): ViewerMemoryRecord | null {
  if (text === null || text.length > 2048) return null;
  let value: unknown;
  try { value = JSON.parse(text); } catch { return null; }
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  if (Object.keys(row).length !== KEYS.length || !KEYS.every(key => Object.hasOwn(row, key))) return null;
  if (row.v !== 2 || typeof row.publicationId !== 'string' || !ID.test(row.publicationId)
    || !nullableId(row.roomId) || !(row.occurrenceId === null || isOpaqueToken(row.occurrenceId))
    || !nullableId(row.floorId) || !nullableId(row.overlayId) || (row.view !== 'plan' && row.view !== '3d')) return null;
  return { v: 2, publicationId: row.publicationId, roomId: row.roomId, occurrenceId: row.occurrenceId, floorId: row.floorId, view: row.view, overlayId: row.overlayId };
}

/** First floor with any admitted geometry, else the first supplied floor. */
export function defaultFloor(model: AdmittedPresentation): string | null {
  const floors = model.source.floors;
  return floors.find(floor => { const facts = model.floorFacts.get(floor.floorId); return facts && (facts.hasPlan || facts.meshCount > 0); })?.floorId
    ?? floors[0]?.floorId ?? null;
}

export function initialState(model: AdmittedPresentation): ViewerState {
  return { publicationId: model.source.publication.publicationId, occurrenceId: null, floorId: defaultFloor(model),
    view: [...model.floorFacts.values()].some(facts => facts.hasPlan) ? 'plan' : '3d', overlayId: null };
}

export function recordOf(model: AdmittedPresentation, state: ViewerState): ViewerMemoryRecord {
  return JSON.parse(encodeMemory(model, state)) as ViewerMemoryRecord;
}

/** Restores remembered IDs against current membership. Same publication:
 * members are kept. Another publication: the selection is carried only when
 * the identical (roomId, spaceOccurrenceId) pair is present; labels, external
 * IDs, indices and positions are never consulted. Overlay layer IDs belong to
 * one publication and are not carried. */
export function reconcile(model: AdmittedPresentation, record: ViewerMemoryRecord | null): { state: ViewerState; notice: RestoreNotice | null } {
  const base = initialState(model);
  if (!record) return { state: base, notice: null };
  const samePublication = record.publicationId === base.publicationId;
  const target = record.occurrenceId !== null ? model.occurrences.get(record.occurrenceId) ?? null : null;
  const kept = target !== null && target.room.roomId === record.roomId ? target : null;
  const floorId = record.floorId !== null && model.floorsById.has(record.floorId) ? record.floorId : kept?.occurrence.floorId ?? base.floorId;
  const overlayId = samePublication && record.overlayId !== null && model.overlays.some(layer => layer.id === record.overlayId) ? record.overlayId : null;
  const state: ViewerState = { ...base, occurrenceId: kept?.occurrence.spaceOccurrenceId ?? null, floorId, view: record.view, overlayId };
  const notice: RestoreNotice | null = record.occurrenceId === null ? null
    : kept === null ? { kind: 'room-absent', fromPublicationId: record.publicationId }
    : samePublication ? null : { kind: 'carried', fromPublicationId: record.publicationId };
  return { state, notice };
}

export function viewerReducer(model: AdmittedPresentation, state: ViewerState, action: ViewerAction): ViewerState {
  switch (action.type) {
    case 'selectOccurrence': {
      if (action.occurrenceId === null) return state.occurrenceId === null ? state : { ...state, occurrenceId: null };
      const target = model.occurrences.get(action.occurrenceId);
      if (!target) return state;
      // Reveal only through the explicit floor link; an unknown floor keeps the current one.
      return { ...state, occurrenceId: target.occurrence.spaceOccurrenceId, floorId: target.occurrence.floorId ?? state.floorId };
    }
    case 'showFloor': return model.floorsById.has(action.floorId) ? { ...state, floorId: action.floorId } : state;
    case 'view': return state.view === action.view ? state : { ...state, view: action.view };
    case 'overlay': return action.overlayId === null || model.overlays.some(layer => layer.id === action.overlayId)
      ? { ...state, overlayId: action.overlayId } : state;
  }
}

/** Occurrences of the selected logical room on a floor, through explicit links only. */
export function contextOccurrences(model: AdmittedPresentation, state: ViewerState, floorId: string | null): readonly string[] {
  if (state.occurrenceId === null || floorId === null) return [];
  const room = model.occurrences.get(state.occurrenceId)?.room;
  return room ? room.occurrences.filter(row => row.floorId === floorId && row.spaceOccurrenceId !== state.occurrenceId).map(row => row.spaceOccurrenceId) : [];
}

/** Session-scoped browser memory; failures (private mode, quota) are ignored. */
export function sessionMemory(): ViewerMemoryPort | null {
  try {
    const storage = globalThis.sessionStorage;
    if (!storage) return null;
    return {
      read: key => { try { return storage.getItem(key); } catch { return null; } },
      write: (key, value) => { try { storage.setItem(key, value); } catch { /* memory is optional */ } },
      remove: key => { try { storage.removeItem(key); } catch { /* memory is optional */ } },
    };
  } catch { return null; }
}
