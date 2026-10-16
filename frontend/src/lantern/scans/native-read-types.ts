import type { ExactDecimal } from '../../numeric/decimal';
import type { ScanFloor, ScanMeshReadPort } from './mesh-profile';
import type { IFC_GLB_PROFILE } from './ifc-glb-profile';
import type { MESH_PROFILE } from './mesh-profile';

/** Private host observation. This object carries no cookie, token or grant. */
export interface NativeGeometryBinding {
  readonly sessionIdentity: object;
  /** The canonical session's authenticated actor; absent, nothing persists. */
  readonly actorId?: string;
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
  readonly profile: typeof MESH_PROFILE | typeof IFC_GLB_PROFILE;
  readonly originalContentType: 'model/vnd.usdz+zip' | 'application/x-step';
  readonly derivativeContentType: 'application/vnd.houseatlas.magicplan-authored-mesh+json' | 'model/gltf-binary';
  readonly sourceUnits?: 'unknown'; readonly declaredSourceUnits?: 'mm'; readonly sourceUpAxis?: 'unknown'; readonly declaredSourceUpAxis?: 'Z';
  readonly glbUnits?: 'm'; readonly glbUpAxis?: 'Y';
  readonly sourceToGlb?: { readonly axisMap: readonly ['x', 'z', '-y']; readonly scale: 0.001 };
  readonly converter?: { readonly name: string; readonly version: string; readonly configSha256: string };
}

/** Explicit native-to-viewer hash-name adaptation, with identical facts. */
export type NativeScanFloor = ScanFloor & Omit<NativeGeometryFloor, 'originalSha256' | 'derivativeSha256'>;

export interface NativeGeometryOffer {
  readonly floor: NativeGeometryFloor;
  readonly readPath: string;
}

export interface NativeGeometryDescriptor {
  readonly schemaVersion: ExactDecimal;
  readonly profile: 'houseatlas.magicplan-authored-mesh.v1' | 'houseatlas.native-geometry.v2';
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

export interface NativeGeometryLoadOptions {
  /** Explicit user refresh: no retained or stored mesh bytes are reused. */
  readonly refresh?: boolean;
}

export interface NativeGeometryReadClient {
  /** The descriptor is always read afresh; `options` affects mesh reuse only. */
  loadBuilding(buildingId: string, signal: AbortSignal, options?: NativeGeometryLoadOptions): Promise<NativeGeometryFrame>;
  isCurrent(frame: NativeGeometryFrame): boolean;
  /** Stale/foreign frames notify immediately and cannot acquire a subscription. */
  subscribeInvalidation(frame: NativeGeometryFrame, invalidate: () => void): () => void;
  dispose(): void;
}
