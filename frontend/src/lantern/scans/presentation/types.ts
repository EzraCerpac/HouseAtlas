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
}
export interface HouseScanSceneProps {
  readonly active: boolean; readonly viewKey: string; readonly floors: readonly PresentationFloor[];
  readonly rooms: readonly SchematicRoom[]; readonly overlay: SceneOverlay;
  readonly onOverlayChange: (value: SceneOverlay) => void;
  readonly renderLayer?: (context: SceneLayerContext) => ReactNode;
  readonly renderDetails?: (context: SceneLayerContext) => ReactNode;
  readonly onRoomSelect?: (room: SchematicRoom) => void;
}
