import type { ElectricityOverlayData, ElectricityPackagePlaceSelection, ElectricityRoomAssociation, ElectricitySelection, ElectricitySheet } from './types';

export type ElectricityScenePoint = readonly [number, number];
/** Structurally matches geometry's ProjectedRoomAnchor. DISPLAY only. */
export interface ElectricitySceneAnchor {
  readonly id: string; readonly viewKey: string; readonly floorKey: string;
  readonly packagePlaceKey: string; readonly packagePlaceUuid: string;
  readonly sourceAnchorIds: readonly string[]; readonly receiptId: string; readonly receiptSha256: string;
  readonly base: ElectricityScenePoint; readonly top: ElectricityScenePoint;
  readonly visible: boolean; readonly basis: 'schematic-room';
}
/** Host-qualified projection of the separate accepted owner room receipt.
 * This is documentary source membership, never a physical or native binding. */
export interface ElectricitySceneMapping {
  readonly schema: 'houseatlas.documentary-electricity-room-context.v1';
  readonly viewKey: string; readonly receiptId: string; readonly receiptSha256: string;
  readonly associations: readonly {
    readonly floorKey: string; readonly sourceAnchorId: string;
    readonly packagePlaceKey: string; readonly packagePlaceUuid: string;
    readonly unresolvedLabels: readonly string[];
  }[];
}
export type ElectricitySceneSelection = ElectricitySelection
  | { readonly kind: 'electricity-room'; readonly anchorId: string }
  | { readonly kind: 'electricity-records' }
  | { readonly kind: 'electricity-unplaced' };
export interface ElectricitySceneGroup {
  readonly anchor: ElectricitySceneAnchor; readonly label: string;
  readonly sheets: readonly ElectricitySheet[];
  readonly associations: readonly { readonly sheetId: string; readonly room: ElectricityRoomAssociation }[];
}
export interface ElectricitySceneProjection {
  readonly groups: readonly ElectricitySceneGroup[];
  readonly sheets: readonly ElectricitySheet[];
  readonly unplaced: readonly ElectricitySheet[];
  readonly drawingCount: number; readonly associationCount: number;
  readonly ui: number; readonly dock: ElectricityScenePoint;
}
export interface ElectricitySceneProps {
  readonly active: boolean; readonly viewKey: string; readonly data: ElectricityOverlayData | null;
  readonly mapping: ElectricitySceneMapping | null;
  readonly anchors: readonly ElectricitySceneAnchor[];
  readonly ui: number; readonly unplacedDock: ElectricityScenePoint;
  readonly selectedPlaceId?: string | null;
  readonly selectedPackagePlaces?: ElectricityPackagePlaceSelection | null;
  readonly selection: ElectricitySceneSelection | null;
  readonly onSelectionChange: (selection: ElectricitySceneSelection | null) => void;
}
export interface ElectricitySceneLayerProps extends ElectricitySceneProps {
  readonly labelPoint?: ElectricityScenePoint;
}
export interface ElectricitySceneInspectorProps extends ElectricitySceneProps {
  readonly onOpenSource?: (sheetId: string, pdfPage: number) => void;
}
