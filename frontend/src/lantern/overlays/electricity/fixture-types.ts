import type { ElectricityPackagePlaceSelection } from './types';

export type FixturePoint = readonly [number, number];
/** [left, top, right, bottom], normalized to the upright source photo. */
export type FixtureBox = readonly [number, number, number, number];
export type FixtureKind = 'socket' | 'socket-candidate' | 'light' | 'appliance' | 'unresolved';

export interface ElectricalFixture {
  readonly id: string;
  readonly sheetId: string;
  readonly regionId: string;
  readonly clusterId: string | null;
  readonly kind: FixtureKind;
  readonly label: string;
  readonly glyph: string;
  readonly source: {
    readonly symbolKey: string;
    readonly originalPhotoSha256: string;
    readonly renderedPhotoSha256: string;
    readonly normalizedBox: FixtureBox;
    readonly normalizedPoint: FixturePoint;
    readonly literalLabels: readonly string[];
    readonly placementDescription: string;
  };
  readonly group: {
    /** Package documentary group ID, never a native verified circuit. */
    readonly id: string | null;
    readonly label: string | null;
    readonly basis: 'label-adjacent' | 'drawn-arrow' | 'uncertain' | 'unknown';
    readonly note: string;
  };
  readonly glyphCount: number | null;
  readonly fixtureCount: number | null;
  readonly uncertainty: string | null;
  readonly currentState: 'historic-unverified';
  readonly physicalCoordinate: null;
  readonly wireRoute: null;
}

export interface ElectricalFixtureRegion {
  readonly id: string;
  readonly sheetId: string;
  readonly label: string;
  readonly sourceOutline: readonly FixturePoint[];
  readonly outlineClosed: boolean;
  readonly sourceBounds: FixtureBox;
  readonly outlineBasis: 'untraced' | 'approximate-photo-trace';
  readonly places: readonly {
    readonly packagePlaceKey: string;
    readonly packagePlaceUuid: string;
    readonly label: string;
    readonly basis: 'owner-reported' | 'inferred';
  }[];
  readonly orientation: 'unregistered';
  readonly physicalTransform: null;
}

export interface ElectricalFixtureSheet {
  readonly id: string;
  readonly title: string;
  readonly pdfPage: number;
  readonly originalPhoto: string;
  readonly originalPhotoSha256: string;
  readonly renderedPhotoSha256: string;
  readonly sourceDate: string | null;
  readonly regionIds: readonly string[];
}

export interface ElectricalFixtureData {
  readonly schema: 'houseatlas.documentary-electrical-fixtures.v1';
  readonly viewKey: string;
  readonly interpretationDate: string;
  readonly symbolLegend: {
    readonly xMeansSocket: boolean | null;
    readonly socketsPerX: number | null;
    readonly receiptId: string | null;
  };
  readonly roomMappingReceipt: { readonly id: string; readonly sha256: string } | null;
  readonly registrationReceipts: readonly ElectricalDiagramRegistration[];
  readonly sheets: readonly ElectricalFixtureSheet[];
  readonly groups: readonly ElectricalDocumentaryGroup[];
  readonly regions: readonly ElectricalFixtureRegion[];
  readonly fixtures: readonly ElectricalFixture[];
}

export interface ElectricalDocumentaryGroup {
  readonly id: string;
  readonly label: string;
  readonly fixtureIds: readonly string[];
  readonly evidenceBasis: 'historic-drawing-label';
  readonly currentCircuitId: null;
  readonly verifiedWiring: false;
}

/** Reviewed source-diagram registration is separate from room naming. */
export interface ElectricalDiagramRegistration {
  readonly id: string;
  readonly sha256: string;
  readonly status: 'proposed' | 'source-reviewed-approximate' | 'owner-reviewed-approximate';
  readonly roomMappingReceipt: { readonly id: string; readonly sha256: string };
  readonly sheetId: string;
  readonly regionId: string;
  readonly originalPhotoSha256: string;
  readonly packagePlaceKey: string;
  readonly packagePlaceUuid: string;
  readonly sourceAnchorIds: readonly string[];
  readonly approvedFixtureIds: readonly string[];
  readonly basis: string;
  readonly reviewQualification: string;
  readonly physicalTransform: null;
}

export interface ElectricityFixtureDiagramProps {
  readonly active: boolean;
  readonly viewKey: string;
  readonly data: ElectricalFixtureData | null;
  readonly selectedRegionId: string | null;
  readonly selectedFixtureId: string | null;
  readonly selectedGroup: string | null;
  readonly selectedPackagePlaces?: ElectricityPackagePlaceSelection | null;
  readonly onRegionChange: (regionId: string) => void;
  readonly onFixtureChange: (fixtureId: string | null) => void;
  readonly onGroupChange: (group: string | null) => void;
  /** Explicit host resolver; local paths and stored labels never become URLs. */
  readonly sourceImageUrl?: string | null;
  readonly showSourceImage?: boolean;
  readonly onOpenSource?: (sheetId: string, pdfPage: number) => void;
}

/** Host-projected fixture point qualified by a separate reviewed diagram registration.
 * SVG DISPLAY units only. No physical coordinate is created by this type. */
export interface ProjectedElectricalFixture {
  readonly fixtureId: string;
  readonly regionId: string;
  readonly viewKey: string;
  readonly packagePlaceKey: string;
  readonly packagePlaceUuid: string;
  readonly sourceAnchorIds: readonly string[];
  readonly originalPhotoSha256: string;
  readonly sourcePoint: FixturePoint;
  readonly registrationReceiptId: string;
  readonly registrationReceiptSha256: string;
  readonly point: FixturePoint;
  readonly visible: boolean;
  readonly basis: 'reviewed-approximate-diagram' | 'proposed-diagram-alignment';
}

export interface ElectricityFixtureLayerProps {
  readonly active: boolean;
  readonly viewKey: string;
  readonly data: ElectricalFixtureData | null;
  readonly placements: readonly ProjectedElectricalFixture[];
  /** Explicitly preview this one proposed registration. This does not accept it. */
  readonly registrationPreviewId?: string | null;
  readonly selectedFixtureId: string | null;
  readonly selectedGroup: string | null;
  readonly ui: number;
  readonly onFixtureChange: (fixtureId: string) => void;
}

/** URL resolved by the authorized host for these exact source bytes.
 * File paths and documentary labels are never interpreted as URLs. */
export interface ElectricityDrawingSource {
  readonly sheetId: string;
  readonly title: string;
  readonly pdfPage: number;
  readonly kind: 'image' | 'pdf';
  readonly url: string;
  readonly sha256: string;
  readonly custody: 'private-local-copy' | 'native-retained-asset';
}

export interface ElectricityDrawingViewerProps {
  readonly source: ElectricityDrawingSource | null;
  readonly onClose: () => void;
}
