import type { ExactDecimal } from '../../numeric/decimal';
import type { NativeGeometryFrame } from './native-read-types';
import type { NativeEvidenceDocumentFrame } from './native-evidence-document-types';
import type { SchematicRoom, DisplayRoomRegion } from './presentation/types';
import type { NetworkOverlayData, NetworkPackagePlaceSelection } from '../overlays/network/types';
import type { ElectricityOverlayData } from '../overlays/electricity/types';
import type { ElectricalFixtureData } from '../overlays/electricity/fixture-types';

/** Independently reviewed host selection. The retained text cannot issue this selection. */
export interface NativeSceneSourceSelection {
  readonly sessionIdentity: object;
  readonly workspaceId: string;
  readonly homeId: string;
  readonly expiresAt: string;
  readonly buildingId: string;
  readonly viewKey: string;
  readonly sceneEvidenceId: string;
  readonly sceneAssetId: string;
  readonly sceneOriginalSha256: string;
  readonly sceneEvidenceRevision: number;
  readonly sceneAssetRevision: ExactDecimal;
  readonly acceptedRoomReceiptId: string | null;
  readonly acceptedRoomReceiptSha256: string | null;
  /** Complete anchor/target membership from the independently reviewed receipt. */
  readonly acceptedRoomAnchors: readonly NativeSceneAcceptedAnchor[];
  readonly sourceFloorBindings: readonly NativeSceneFloorBinding[];
}

export interface NativeSceneAcceptedAnchor {
  readonly id: string;
  readonly sourceFloorKey: string;
  readonly sourceOriginalSha256: string;
  readonly targets: readonly Readonly<{ packagePlaceKey: string; packagePlaceUuid: string }>[];
  readonly unresolvedLabels: readonly string[];
}

/** Explicit, independently reviewed source-floor to current native-floor relation. */
export interface NativeSceneFloorBinding {
  readonly sourceFloorKey: string;
  readonly sourceOriginalSha256: string;
  readonly nativeFloorKey: string;
  readonly nativeOriginalAssetId: string;
  readonly nativeOriginalSha256: string;
  readonly nativeGeometryId: string;
  readonly nativeGeometryRevision: ExactDecimal;
}

export type NativeSceneSubset<T> =
  | Readonly<{ status: 'available'; data: T }>
  | Readonly<{ status: 'unavailable'; reason: 'not-retained' | 'not-qualified' | 'source-unavailable' }>;

/** Owner-fenced view data. An available subset is documentary, not a native grant. */
export interface NativeSceneSourceFrame {
  readonly lease: object;
  readonly viewKey: string;
  readonly sourceEvidenceId: string;
  readonly sourceAssetId: string;
  readonly sourceOriginalSha256: string;
  readonly receiptId: string | null;
  readonly receiptSha256: string | null;
  readonly rooms: NativeSceneSubset<Readonly<{ rooms: readonly SchematicRoom[]; regions: readonly DisplayRoomRegion[] }>>;
  /** Exact full receipt membership for each displayable room; no native place ID. */
  readonly roomSelections: readonly Readonly<{ roomId: string; selection: NetworkPackagePlaceSelection }>[];
  readonly network: NativeSceneSubset<NetworkOverlayData>;
  readonly electricity: NativeSceneSubset<ElectricityOverlayData>;
  /** Historical source symbols only; no accepted diagram registration or media grant. */
  readonly electricalFixtures: NativeSceneSubset<ElectricalFixtureData>;
  readonly document: NativeEvidenceDocumentFrame;
  readonly geometry: NativeGeometryFrame;
}

export interface NativeSceneSourceClient {
  /** Call only after the host has supplied and freshly checked an independent selection. */
  open(selection: NativeSceneSourceSelection, geometry: NativeGeometryFrame, signal: AbortSignal): Promise<NativeSceneSourceFrame>;
  isCurrent(frame: NativeSceneSourceFrame): boolean;
  subscribeInvalidation(frame: NativeSceneSourceFrame, changed: () => void): () => void;
  release(frame: NativeSceneSourceFrame): void;
  dispose(): void;
}
