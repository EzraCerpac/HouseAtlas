import type { AdmittedPresentation, OverlayLayer, OverlayRecord } from './model';

export interface OverlayJoin {
  readonly layer: OverlayLayer;
  /** Records joined to a logical room of this publication through its reviewed Atlas link. */
  readonly byRoom: ReadonlyMap<string, readonly OverlayRecord[]>;
  /** Records with no link, or a link no reviewed room of this publication carries. */
  readonly unplaced: readonly OverlayRecord[];
}

/** Joins by (publicationId, roomId, reviewed atlasPlaceId) only. Labels,
 * external IDs, STEP numbers and array positions are never consulted, and no
 * device or fixture position is derived from a room link. */
export function joinOverlay(model: AdmittedPresentation, layer: OverlayLayer): OverlayJoin | null {
  if (layer.publicationId !== model.source.publication.publicationId) return null;
  const byPlace = new Map<string, string>();
  for (const room of model.source.rooms) if (room.atlasPlaceId !== null) byPlace.set(room.atlasPlaceId, room.roomId);
  const byRoom = new Map<string, OverlayRecord[]>(), unplaced: OverlayRecord[] = [];
  for (const record of layer.records) {
    const roomId = record.atlasPlaceId !== null ? byPlace.get(record.atlasPlaceId) : undefined;
    if (roomId !== undefined) byRoom.set(roomId, [...(byRoom.get(roomId) ?? []), record]);
    else unplaced.push(record);
  }
  return { layer, byRoom, unplaced };
}
