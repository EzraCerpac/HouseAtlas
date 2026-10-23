import type { ExactDecimal } from '../../numeric/decimal';
import type { ElectricalFixtureSheet } from '../overlays/electricity/fixture-types';
import type { ElectricitySheet } from '../overlays/electricity/types';
import type { NativeEvidenceDocumentClient } from '../scans/native-evidence-document-types';
import type { NativeSceneDrawingPdfReference, NativeSceneDrawingProvenance } from '../scans/native-scene-source-types';

/** Source identity and source pins are retained; this is not a Document v2 record. */
export interface ElectricalLibraryRoom {
  readonly packagePlaceKey: string; readonly packagePlaceUuid: string;
  readonly nativePlaceId: string | null; readonly label: string;
  readonly basis: 'owner-reported' | 'inferred';
}
export interface ElectricalLibrarySheet {
  readonly sheet: ElectricalFixtureSheet;
  readonly documentary: ElectricitySheet | null;
  readonly rooms: readonly ElectricalLibraryRoom[];
}
export interface ElectricalLibraryPage extends ElectricalLibrarySheet {
  readonly reference: NativeSceneDrawingPdfReference;
}
export interface ElectricalLibraryDocument {
  /** Workspace/home/evidence/asset identity, never a filename or byte hash. */
  readonly key: string;
  readonly evidenceId: string; readonly evidenceRevision: number;
  readonly assetId: string; readonly assetRevision: ExactDecimal;
  readonly sha256: string; readonly byteSize: ExactDecimal;
  readonly pages: readonly ElectricalLibraryPage[];
}
export interface ElectricalLibraryFrame {
  readonly status: 'available'; readonly lease: object;
  readonly scope: Readonly<{ workspaceId: string; homeId: string }>;
  readonly buildingId: string;
  readonly documents: readonly ElectricalLibraryDocument[];
  /** Historical sheet references without a currently qualified PDF correlation. */
  readonly unlinkedSheets: readonly ElectricalLibrarySheet[];
  readonly provenance: NativeSceneDrawingProvenance | null;
}
export type ElectricalLibraryRead = ElectricalLibraryFrame | Readonly<{
  status: 'unavailable';
  reason: 'no-current-association' | 'current-source-unavailable' | 'selection-changed';
}>;
/** A reader owns one selected building. Source originals and drawing opens use
 * different native document owners, so Library cannot withdraw an Atlas read. */
export interface ElectricalLibraryReader {
  owner(): object | null;
  subscribeOwner(changed: () => void): () => void;
  read(buildingId: string, signal: AbortSignal): Promise<ElectricalLibraryRead>;
  isCurrent(frame: ElectricalLibraryFrame): boolean;
  subscribeInvalidation(frame: ElectricalLibraryFrame, changed: () => void): () => void;
  createDrawingClient(frame: ElectricalLibraryFrame): NativeEvidenceDocumentClient;
  release(frame: ElectricalLibraryFrame): void;
  dispose(): void;
}
/** Optional host composition. No service advertisement or writable capability
 * is inferred from the presence of this port. */
export interface ElectricalLibraryPort {
  createReader(): Promise<ElectricalLibraryReader>;
}
