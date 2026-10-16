/** Site artifact consumer ports, houseatlas.site-artifact-consumer-contract.v1.
 * The host injects explicitly authorized artifact or local-preview reads; no
 * endpoint is implied and no NAS route is asserted. */

export const SITE_ARTIFACT_CONSUMER_CONTRACT = 'houseatlas.site-artifact-consumer-contract.v1';
export const SITE_ARTIFACT_PUBLICATION_SCHEMA = 'houseatlas.site-artifact-publication.v1';

export interface SitePin { readonly publicationId: string; readonly version: number }
export interface SiteArtifactRequest extends SitePin {
  readonly assetId: string;
  readonly expectedSha256: string;
  readonly expectedBytes: number;
  readonly signal: AbortSignal;
}

/** Minimal GeoJSON shape accepted for 2D source plans. */
export interface PlanFeatureCollection {
  readonly type: 'FeatureCollection';
  readonly features: readonly unknown[];
}

export interface SiteArtifactPort {
  loadPublication(request: SitePin & { readonly signal: AbortSignal }): Promise<unknown>;
  readArtifact(request: SiteArtifactRequest): Promise<ArrayBuffer>;
  /** 2D display only. Absent: plan assets are listed but not read. */
  readSourcePlan?(request: SiteArtifactRequest): Promise<PlanFeatureCollection>;
  subscribeInvalidation(selection: SitePin, onInvalidate: (reason: string) => void): () => void;
}

/** One immutable publication chosen by the host. */
export interface SiteSourcePort extends SiteArtifactPort { readonly selection: SitePin }

type Vec3 = readonly [number, number, number];
export type SiteAxis = 'east' | 'west' | 'north' | 'south' | 'up' | 'down';

export interface SiteFrame {
  readonly horizontalCRS: string;
  readonly verticalDatum: string;
  readonly unit: string;
  /** Declared source origin, kept at full double precision; never inferred. */
  readonly originSource: Vec3;
  readonly modelingAxes: readonly [SiteAxis, SiteAxis, SiteAxis];
  readonly rendererAxes: readonly [SiteAxis, SiteAxis, SiteAxis];
}

export interface SiteAsset {
  readonly assetId: string;
  readonly kind: string;
  readonly sha256: string;
  readonly bytes: number;
  readonly contentType: string;
  readonly frame: string;
  readonly sourcePoseAlreadyApplied: boolean;
  readonly poseAppliedByAssembly: boolean;
  /** Inert. Never resolved, fetched or used as a fallback. */
  readonly href: string | null;
  readonly storageKind: string | null;
}

export interface SiteGroup {
  readonly groupId: string;
  readonly assetId: string;
  readonly nodeIndices: readonly number[];
  readonly meshIndices: readonly number[];
  readonly sourceFeatureId: string | null;
  readonly sourceGlobalId: string | null;
  readonly sourceStoreyLabel: string | null;
  readonly defaultVisible: boolean;
  readonly coverage: string;
}

export interface SiteFeature {
  readonly sourceFeatureId: string;
  readonly displayName: string;
  readonly defaultVisible2D: boolean;
  readonly defaultVisible3D: boolean;
  readonly groupIds: readonly string[];
  readonly sourceGeometryDimensions: 2 | 3;
  readonly sourceGeometryElevation: number | null;
  readonly coverage: { readonly mode: string; readonly reason: string | null };
}

export interface SitePublication {
  readonly pin: SitePin;
  readonly artifactAvailability: string;
  readonly kind: string;
  readonly native: { readonly sitePublicationId: string | null; readonly availability: string };
  readonly modelingArtifactAssetId: string | null;
  readonly siteFrame: SiteFrame;
  readonly assets: readonly SiteAsset[];
  readonly groups: readonly SiteGroup[];
  readonly features: readonly SiteFeature[];
  readonly canonicalHouse: {
    readonly status: string;
    readonly assetId: string | null;
    readonly groupIds: readonly string[];
    /** Declared only; this consumer never multiplies it in. */
    readonly qualifiedMatrixDeclared: boolean;
    readonly provisionalPoseDeclared: boolean;
  };
}
