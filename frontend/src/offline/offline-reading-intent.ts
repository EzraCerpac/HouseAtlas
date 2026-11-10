import type { ViewId } from '../lantern/state/store';
import type { SourcePdfReadingPosition } from '../lantern/source-documents/SourcePdfView';
import type { OfflineDocumentPinV1, OfflineElectricalPinV1, OfflineHomeboxPinV1, OfflineViewSnapshotV1 } from './live-copy-types';

/** Presentation intent only. These identities never replace a fresh owner read. */
export type HeldReadingDocument =
  | { readonly kind: 'native'; readonly pin: OfflineDocumentPinV1 }
  | { readonly kind: 'electrical'; readonly pin: OfflineElectricalPinV1 }
  | { readonly kind: 'homebox'; readonly pin: OfflineHomeboxPinV1 };
export interface OfflineReadingIntent {
  readonly ownerKey: string | null;
  readonly generation: number;
  readonly view: ViewId;
  readonly document: { readonly request: HeldReadingDocument; readonly position: SourcePdfReadingPosition } | null;
}
export const emptyReadingIntent = (generation = 0): OfflineReadingIntent => ({ ownerKey: null, generation, view: 'atlas', document: null });
export const readingOwnerKey = (snapshot: OfflineViewSnapshotV1): string =>
  JSON.stringify([snapshot.actorRevision, snapshot.data.scope.workspaceId, snapshot.data.scope.homeId]);
export const readingDocumentKey = (document: HeldReadingDocument): string => {
  const pin = document.pin as unknown as Record<string, unknown>;
  return JSON.stringify([document.kind, Object.keys(pin).sort().map(key => [key, pin[key]])]);
};
export function revalidateReadingIntent(state: OfflineReadingIntent, snapshot: OfflineViewSnapshotV1, generation: number): OfflineReadingIntent {
  const ownerKey = readingOwnerKey(snapshot);
  return state.ownerKey === ownerKey ? { ...state, generation } : { ...emptyReadingIntent(generation), ownerKey };
}
export function openReadingDocument(state: OfflineReadingIntent, request: HeldReadingDocument, page = 1): OfflineReadingIntent {
  if (!state.ownerKey || !Number.isSafeInteger(page) || page < 1) return state;
  const position = { page, zoom: 1, scrollTop: 0, scrollLeft: 0 };
  return { ...state, document: { request: { ...request, pin: Object.freeze({ ...request.pin }) } as HeldReadingDocument, position } };
}
export function rememberReadingPosition(state: OfflineReadingIntent, generation: number, key: string, position: SourcePdfReadingPosition): OfflineReadingIntent {
  if (state.generation !== generation || !state.document || readingDocumentKey(state.document.request) !== key
    || !Number.isSafeInteger(position.page) || position.page < 1 || !Number.isFinite(position.zoom) || position.zoom < 0.5 || position.zoom > 4
    || !Number.isFinite(position.scrollTop) || position.scrollTop < 0 || !Number.isFinite(position.scrollLeft) || position.scrollLeft < 0) return state;
  return { ...state, document: { ...state.document, position: { ...position } } };
}
export function closeReadingDocument(state: OfflineReadingIntent, generation: number, key: string): OfflineReadingIntent {
  return state.generation === generation && state.document && readingDocumentKey(state.document.request) === key
    ? { ...state, document: null } : state;
}
