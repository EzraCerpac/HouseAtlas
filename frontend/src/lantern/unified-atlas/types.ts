import type { PlanRing } from '../canonical-ifc/model';
import type { ModelOverviewSelection } from '../source-models/overview-types';
import type { UnifiedAtlasOverlayOpen, UnifiedAtlasOverlaySource } from '../../../integration/unified-atlas-overlay-source';

/** One selected Blender/Bonsai publication read as `houseatlas.unified-atlas-scene.v1`.
 * Every coordinate is in the glTF world frame after node transforms were
 * applied once; nothing here is a physical registration or a native grant. */
export type Vec3 = readonly [number, number, number];
export interface Box { readonly min: Vec3; readonly max: Vec3 }

export interface AtlasBuilding {
  readonly buildingId: string;
  readonly label: string;
  readonly nativePlaceId: string | null;
  readonly bounds: Box;
  readonly levelIds: readonly string[];
}
export interface AtlasLevel {
  readonly levelId: string;
  readonly buildingId: string;
  readonly label: string;
  readonly nativePlaceId: string | null;
  /** Source elevation as authored; a source fact, not a scene coordinate. */
  readonly sourceElevationM: number | null;
  readonly elevationBasis: string | null;
  readonly occurrenceIds: readonly string[];
  readonly bounds: Box;
}
export type NativeBindingStatus = 'reviewed' | 'historical' | 'unmapped';
export interface AtlasRoom {
  readonly roomId: string;
  readonly buildingId: string;
  readonly label: string;
  readonly nativePlaceId: string | null;
  readonly nativeBinding: { readonly status: NativeBindingStatus; readonly receiptSha256: string | null };
  readonly occurrenceIds: readonly string[];
}
export type GeometryBasisKind = 'source-model' | 'owner-estimated-pick-proxy';
export interface AtlasOccurrence {
  readonly spaceOccurrenceId: string;
  readonly roomId: string;
  readonly buildingId: string;
  readonly levelId: string;
  readonly bounds: Box;
  readonly planFeatureIds: readonly string[];
  readonly geometryBasis: { readonly kind: GeometryBasisKind; readonly sourceRef: string | null; readonly note: string | null };
}
export type MeshRole = 'structure' | 'roof' | 'slab' | 'room-pick' | 'context';
export interface AtlasMeshBinding {
  readonly artifactId: 'model';
  readonly nodeIndex: number;
  readonly meshIndex: number;
  readonly primitiveIndices: readonly number[];
  readonly buildingId: string;
  readonly levelIds: readonly string[];
  readonly spaceOccurrenceId: string | null;
  readonly role: MeshRole;
}
export type PlanRole = 'room' | 'wall' | 'opening' | 'stair' | 'context';
export interface AtlasPolygon { readonly outer: PlanRing; readonly holes: readonly PlanRing[] }
export interface AtlasPlanFeature {
  readonly featureId: string;
  readonly roomId: string | null;
  readonly spaceOccurrenceId: string | null;
  readonly role: PlanRole;
  readonly polygons: readonly AtlasPolygon[];
}
export interface AtlasPlan {
  readonly planId: string;
  readonly buildingId: string;
  readonly levelId: string;
  readonly coordinates: 'scene-XZ-metres';
  readonly featureIds: readonly string[];
  readonly features: readonly AtlasPlanFeature[];
}
export type OverlayKind = 'electrical' | 'network';
export type OverlayAnchor =
  | { readonly kind: 'room-summary' }
  | { readonly kind: 'source-position'; readonly position: Vec3; readonly basis: string };
export interface AtlasOverlayBinding {
  readonly publicationId: string;
  readonly kind: OverlayKind;
  readonly sourceRevision: string;
  /** Original source and retrieval dates exactly as supplied. */
  readonly sourceUpdatedAt: string | null;
  readonly retrievedAt: string | null;
  readonly roomId: string;
  readonly spaceOccurrenceId: string | null;
  readonly nativePlaceId: string | null;
  readonly recordIds: readonly string[];
  readonly anchor: OverlayAnchor;
}
/** One producer exclusion, kept as supplied text. */
export interface AtlasExclusion { readonly id: string | null; readonly reason: string | null }
export interface AtlasCoverage {
  /** Listed occurrence IDs, or null when the producer gave a count only. */
  readonly selectable: readonly string[] | null;
  readonly selectableCount: number;
  readonly unselectable: readonly string[] | null;
  readonly unselectableCount: number;
  readonly exclusions: readonly AtlasExclusion[];
}
export interface AtlasScene {
  readonly profile: 'houseatlas.unified-atlas-scene.v1';
  readonly scope: Readonly<{ workspaceId: string; homeId: string }>;
  readonly selection: Readonly<{ revision: string; publicationId: string }>;
  readonly publication: Readonly<{ publicationId: string; sourceRevisionId: string; sourceSha256: string; semanticsSha256: string }>;
  readonly model: Readonly<{ bytes: number; sha256: string; href: string }>;
  /** The same publication unsimplified, for devices that opt into Full quality. */
  readonly detail: Readonly<{ bytes: number; sha256: string; href: string }> | null;
  readonly buildings: readonly AtlasBuilding[];
  readonly levels: readonly AtlasLevel[];
  readonly rooms: readonly AtlasRoom[];
  readonly occurrences: readonly AtlasOccurrence[];
  readonly meshBindings: readonly AtlasMeshBinding[];
  readonly plans: readonly AtlasPlan[];
  readonly overlayBindings: readonly AtlasOverlayBinding[];
  readonly coverage: AtlasCoverage;
}

/** Verified scene plus the exact pinned model bytes for the same selection revision. */
export interface UnifiedAtlasRead {
  readonly scene: AtlasScene;
  readonly model: Uint8Array<ArrayBuffer>;
  /** Optional presentation metadata owned by this exact admitted read. Null is
   * explicitly unconfigured; omitted local ports may supply their own callback. */
  readonly entryBuildingId?: string | null;
  /** SHA-256 of the exact scene envelope, when the reader has it; equal
   * digests and model bytes let a fresh read confirm a stored copy in place. */
  readonly envelopeSha256?: string;
}
/** A verified copy from this device's own store, shown while the fresh read runs. */
export interface StoredAtlasRead extends UnifiedAtlasRead { readonly storedAt: string }
export type AtlasReadFailure = 'absent' | 'stale' | 'unavailable' | 'invalid' | 'too-large' | 'denied';
export class AtlasReadError extends Error {
  constructor(readonly reason: AtlasReadFailure, message: string = reason) { super(message); }
}
/** The selected publication is the existing overview selection; the Atlas
 * read is opt-in beside it and never substitutes another source. */
export interface UnifiedAtlasPort {
  current(): ModelOverviewSelection | null;
  subscribe(changed: () => void): () => void;
  read(selection: ModelOverviewSelection, signal: AbortSignal): Promise<UnifiedAtlasRead>;
  /** The last verified read of this exact selection's publication and
   * manifest kept on this device, or null. Display only: `read` still runs. */
  stored?(selection: ModelOverviewSelection, signal: AbortSignal): Promise<StoredAtlasRead | null>;
  /** The building the Atlas opens on, bound by the source owner for this
   * publication. Never inferred from names, plan order or size; an absent or
   * unknown ID opens the only building with floors, else the whole property. */
  entryBuildingId?(scene: AtlasScene): string | null;
  /** Explicit saved presentation, not a native source frame or current lease. */
  readonly savedDocumentary?: {
    readonly observedAt: string;
    records(scene: AtlasScene, selectable: ReadonlySet<string>): import('./runtime-overlays').PropertyRecords;
  };
  /** Separate current documentary owner; never changes producer semantics. */
  createOverlays?(selection: ModelOverviewSelection, scene: AtlasScene, building: AtlasBuilding, signal: AbortSignal): Promise<{
    readonly source: UnifiedAtlasOverlaySource; readonly request: UnifiedAtlasOverlayOpen;
  } | null>;
}

/** Presentation ownership is separate from the unchanged native read contract. */
export interface LiveAtlasSelection { readonly kind: 'live'; readonly overview: ModelOverviewSelection }
export interface SavedAtlasSelection {
  readonly kind: 'saved'; readonly owner: object;
  readonly scope: Readonly<{ workspaceId: string; homeId: string }>;
  readonly publicationId: string; readonly overviewManifestSha256: string; readonly semanticsSha256: string;
  readonly selectionRevision: string; readonly snapshotId: string; readonly localRevision: string; readonly capturedAt: string;
}
export type AtlasPresentationSelection = LiveAtlasSelection | SavedAtlasSelection;
export interface LiveAtlasPresentationPort {
  readonly kind: 'live';
  current(): LiveAtlasSelection | null;
  subscribe(changed: () => void): () => void;
  read(selection: LiveAtlasSelection, signal: AbortSignal): Promise<UnifiedAtlasRead>;
  stored?(selection: LiveAtlasSelection, signal: AbortSignal): Promise<StoredAtlasRead | null>;
  entryBuildingId?(scene: AtlasScene): string | null;
  readonly savedDocumentary?: UnifiedAtlasPort['savedDocumentary'];
  createOverlays?(selection: LiveAtlasSelection, scene: AtlasScene, building: AtlasBuilding, signal: AbortSignal): ReturnType<NonNullable<UnifiedAtlasPort['createOverlays']>>;
}
export interface SavedAtlasPresentationPort {
  readonly kind: 'saved';
  current(): SavedAtlasSelection | null;
  subscribe(changed: () => void): () => void;
  read(selection: SavedAtlasSelection, signal: AbortSignal): Promise<UnifiedAtlasRead>;
  readonly savedDocumentary: NonNullable<UnifiedAtlasPort['savedDocumentary']>;
  dispose(): void;
}
export type AtlasPresentationPort = LiveAtlasPresentationPort | SavedAtlasPresentationPort;
