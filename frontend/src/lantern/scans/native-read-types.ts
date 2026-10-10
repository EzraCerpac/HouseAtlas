import type { ExactDecimal } from '../../numeric/decimal';
import type { ScanFloor, ScanMeshReadPort } from './mesh-profile';

/** Private host observation. This object carries no cookie, token or grant. */
export interface NativeGeometryBinding {
  readonly sessionIdentity: object;
  readonly expiresAt: string;
  readonly scope: Readonly<{ workspaceId: string; homeId: string }>;
}

export interface NativeGeometryLicense {
  readonly status: 'unknown' | 'permitted' | 'restricted';
  readonly reference: string | null;
}

/** Actual native serde field names; revisions retain complete JSON spelling. */
export interface NativeGeometryFloor {
  readonly key: string;
  readonly exportLabel: string;
  readonly originalSha256: string;
  readonly derivativeSha256: string;
  readonly geometryId: string;
  readonly geometryRevision: ExactDecimal;
  readonly evidenceId: string;
  readonly evidenceRevision: ExactDecimal;
  readonly originalAssetId: string;
  readonly originalRevision: ExactDecimal;
  readonly derivativeAssetId: string;
  readonly derivativeRevision: ExactDecimal;
  readonly originalLicense: NativeGeometryLicense;
  readonly derivativeLicense: NativeGeometryLicense;
}

/** Explicit native-to-viewer hash-name adaptation, with identical facts. */
export interface NativeScanFloor extends ScanFloor, Omit<NativeGeometryFloor, 'originalSha256' | 'derivativeSha256'> {}

export interface NativeGeometryOffer {
  readonly floor: NativeGeometryFloor;
  readonly readPath: string;
}

export interface NativeGeometryDescriptor {
  readonly schemaVersion: ExactDecimal;
  readonly profile: 'houseatlas.magicplan-authored-mesh.v1';
  readonly scope: Readonly<{ workspaceId: string; homeId: string }>;
  readonly buildingId: string;
  readonly viewKey: string;
  readonly floors: readonly NativeGeometryOffer[];
  readonly physicalScale: 'unknown';
  readonly floorAlignment: 'unknown';
  readonly stageToHouseTransform: null;
}

/** Locally owned current observation, never native authorization. */
export interface NativeGeometryFrame {
  readonly lease: object;
  readonly viewKey: string;
  readonly descriptor: NativeGeometryDescriptor;
  readonly floors: readonly NativeScanFloor[];
  readonly readPort: ScanMeshReadPort;
}

export interface NativeGeometryReadClient {
  loadBuilding(buildingId: string, signal: AbortSignal): Promise<NativeGeometryFrame>;
  isCurrent(frame: NativeGeometryFrame): boolean;
  /** Stale/foreign frames notify immediately and cannot acquire a subscription. */
  subscribeInvalidation(frame: NativeGeometryFrame, invalidate: () => void): () => void;
  dispose(): void;
}
