import type { ReactNode } from 'react';
import type { MeshProfile } from '../mesh-profile';
export type SceneOverlay = 'spaces' | 'electrical' | 'network';
export interface PresentationFloor {
  readonly key: string; readonly label: string; readonly short: string;
  readonly profile: MeshProfile | null; readonly unavailable?: string;
}
/** Owner-reviewed documentary identity; fractions are explicitly schematic display layout. */
export interface SchematicRoom {
  readonly id: string; readonly floorKey: string; readonly label: string;
  readonly packagePlaceKey: string; readonly packagePlaceUuid: string;
  readonly sourceAnchorIds: readonly string[]; readonly receiptId: string; readonly receiptSha256: string;
  readonly xFraction: number; readonly yFraction: number;
  readonly basis: 'schematic-room';
}
/** Source wall-bounded display region; door-gap closures remain provisional, never measured house geometry. */
export interface DisplayRoomRegion {
  readonly roomId: string; readonly floorKey: string;
  readonly packagePlaceKey: string; readonly packagePlaceUuid: string;
  readonly receiptId: string; readonly receiptSha256: string; readonly sourceAnchorIds: readonly string[];
  readonly polygons: readonly (readonly (readonly [number, number])[])[];
  readonly geometryQualification: string; readonly sourceGeometryHandles: readonly string[];
  readonly displayKind?: 'sleep' | 'wet' | 'circulation' | 'service' | 'living';
}
/** Same SVG viewBox as the mesh canvas; these points never represent measured physical positions. */
export interface ProjectedRoomAnchor {
  readonly id: string; readonly viewKey: string; readonly floorKey: string;
  readonly packagePlaceKey: string; readonly packagePlaceUuid: string;
  readonly sourceAnchorIds: readonly string[]; readonly receiptId: string; readonly receiptSha256: string;
  readonly base: readonly [number, number]; readonly top: readonly [number, number];
  readonly visible: boolean; readonly basis: 'schematic-room';
}
export interface SceneLayerContext {
  readonly viewKey: string; readonly anchors: readonly ProjectedRoomAnchor[];
  readonly ui: number; readonly unplacedDock: readonly [number, number];
  readonly selectedRoom: SchematicRoom | null;
}
export interface HouseScanSceneBaseProps {
  readonly active: boolean; readonly viewKey: string; readonly floors: readonly PresentationFloor[];
  readonly rooms: readonly SchematicRoom[]; readonly overlay: SceneOverlay;
  readonly roomRegions?: readonly DisplayRoomRegion[];
  readonly onOverlayChange: (value: SceneOverlay) => void;
  readonly renderLayer?: (context: SceneLayerContext) => ReactNode;
  readonly renderRoomActions?: (room: SchematicRoom) => ReactNode;
  readonly renderDetails?: (context: SceneLayerContext) => ReactNode;
  readonly onRoomSelect?: (room: SchematicRoom) => void;
}

export type HouseScanSceneProps = HouseScanSceneBaseProps & (
  { readonly selectedRoomId?: never; readonly onRoomSelectionChange?: (room: SchematicRoom | null) => void }
  | { readonly selectedRoomId: string | null; readonly onRoomSelectionChange: (room: SchematicRoom | null) => void }
);
