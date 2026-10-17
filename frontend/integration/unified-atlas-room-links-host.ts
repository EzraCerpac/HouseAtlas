import type { ModelOverviewSelection } from '../src/lantern/source-models/overview-types';
import type { AtlasBuilding, AtlasScene, UnifiedAtlasPort } from '../src/lantern/unified-atlas/types';
import type { SceneAssociationContext } from './native-scene-association-client';
import { createUnifiedAtlasOverlaySource, type UnifiedAtlasOverlaySourceOptions } from './unified-atlas-overlay-source';
import { readUnifiedAtlasRoomLinks } from './unified-atlas-room-links-reader';
import { createReviewedRoomLinksOverlayOwner } from './unified-atlas-room-links-owner';

/** One canonical host observation owns the authenticated map and native leases.
 * The map spans the publication; native qualification remains building-scoped. */
export async function createUnifiedAtlasReviewedOverlays(options: {
  readonly selection: ModelOverviewSelection; readonly scene: AtlasScene; readonly building: AtlasBuilding;
  readonly native: SceneAssociationContext; readonly origin: string; readonly signal: AbortSignal;
  readonly isCurrent: () => boolean; readonly subscribe: (changed: () => void) => () => void;
  readonly createDocuments: UnifiedAtlasOverlaySourceOptions['createDocuments'];
  readonly transport?: typeof fetch;
}): ReturnType<NonNullable<UnifiedAtlasPort['createOverlays']>> {
  const { selection, scene, building, signal } = options;
  const current = () => !signal.aborted && options.isCurrent() && Date.parse(selection.expiresAt) > Date.now();
  if (!current() || building.nativePlaceId === null || !scene.buildings.includes(building)) return null;
  const controller = new AbortController();
  const offInitial = options.subscribe(() => { if (!current()) controller.abort(); });
  let source: ReturnType<typeof createUnifiedAtlasOverlaySource> | null = null;
  try {
    const sceneSelection = Object.freeze({ ...scene.scope, revision: scene.selection.revision,
      publicationId: scene.publication.publicationId, semanticsSha256: scene.publication.semanticsSha256 });
    const publicationRooms = Object.freeze(scene.rooms.filter(room => room.buildingId === building.buildingId));
    const request = Object.freeze({ sceneSelection, publicationRooms, nativeBuildingId: building.nativePlaceId });
    const readReview = (readSignal: AbortSignal) => readUnifiedAtlasRoomLinks({ selection, sceneSelection,
      publicationRooms: scene.rooms, origin: options.origin, signal: readSignal, isCurrent: current,
      ...(options.transport ? { transport: options.transport } : {}) });
    const initialReview = await readReview(AbortSignal.any([signal, controller.signal]));
    if (!current() || controller.signal.aborted) return null;
    const context = Object.freeze({ native: options.native, ...request, reviewedRoomLinks: initialReview?.reviewedRoomLinks ?? null });
    const createSource = (reviewIsCurrent: () => boolean) => createUnifiedAtlasOverlaySource({
      getContext: () => current() && reviewIsCurrent() ? context : null,
      subscribeContext: options.subscribe, createDocuments: options.createDocuments,
      ...(options.transport ? { fetch: options.transport } : {}),
    });
    // An authenticated absent map stays an explicit unqualified source. It
    // cannot fall back to names, geometry or producer nativeBinding status.
    source = initialReview ? createReviewedRoomLinksOverlayOwner({ initialReview, createSource, readReview,
      isContextCurrent: current, subscribeContext: options.subscribe, signal }) : createSource(() => true);
    if (!current() || controller.signal.aborted) { source.dispose(); return null; }
    return Object.freeze({ source, request });
  } catch (error) { source?.dispose(); throw error; }
  finally { offInitial(); controller.abort(); }
}
