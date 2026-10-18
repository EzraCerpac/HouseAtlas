import type { PackManifest } from './manifest';
import type { SavedHouse } from './store';

export interface OfflineProgress { readonly phase: 'app' | 'house'; readonly done: number; readonly total: number }
export interface AcquisitionPreparation {
  readonly label: string; readonly capturedAt: string; readonly snapshotId: string;
  readonly shellBuildId: string; readonly totalBytes: number; readonly resources: number;
  readonly completeness: PackManifest['completeness']; readonly exclusions: PackManifest['exclusions'];
  readonly prior: SavedHouse | null;
}
export interface AcquisitionReceipt {
  readonly house: SavedHouse; readonly completeness: PackManifest['completeness'];
  readonly exclusions: PackManifest['exclusions'];
}
export interface AcquisitionState {
  readonly status: 'idle' | 'preparing' | 'ready' | 'saving' | 'canceled' | 'retired' | 'unavailable' | 'saved';
  readonly preparation?: AcquisitionPreparation; readonly progress?: OfflineProgress;
  readonly receipt?: AcquisitionReceipt; readonly message?: string;
}
/** Observing this port performs no transport or local-storage reads. */
export interface HouseAcquisitionPort {
  getState(): AcquisitionState;
  subscribe(listener: () => void): () => void;
  prepare(): Promise<void>;
  save(replaceRevision?: string): Promise<void>;
  cancel(): void;
}
