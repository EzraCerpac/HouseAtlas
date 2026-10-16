import type { ElectricalFixtureData } from '../overlays/electricity/fixture-types';
import type { ElectricityOverlayData } from '../overlays/electricity/types';

/** Consumer types for houseatlas.host-electrical-documentary-port.v1. The
 * source owner supplies the provider and identity adapter; nothing here
 * qualifies bytes, lineage, identity, access or custody. */
export const HOST_ELECTRICAL_DOCUMENTARY_CONTRACT = 'houseatlas.host-electrical-documentary-port.v1';

/** Exact lowercase 64-hex digest, validated by the host. */
export type Digest = string;

export type ElectricalModelBinding =
  | Readonly<{ kind: 'canonical-publication'; sourceRevisionId: string; publicationId: string;
      semanticMapRevisionId: string; semanticMapSha256: Digest }>
  | Readonly<{ kind: 'private-preview'; modelVersion: string; modelGlbSha256: Digest;
      canonicalSourceSha256: Digest | null; crosswalkSha256: Digest }>;

export type ElectricalDocumentaryTarget =
  | Readonly<{ kind: 'model-room'; roomId: string; spaceOccurrenceId: string | null }>
  | Readonly<{ kind: 'documentary-scope'; scopeId: string }>;

export type ElectricalSourceRole = 'original-sheet' | 'drawing-crop' | 'interpretation-record';
export type ElectricalRecordRole = 'socket-mark' | 'light-label' | 'light-annotation' | 'unresolved-symbol';

export interface ElectricalDocumentaryRequest {
  readonly binding: ElectricalModelBinding;
  readonly target: ElectricalDocumentaryTarget;
}

export type ElectricalAssociationScope = Readonly<{ kind: 'logical-room' }>
  | Readonly<{ kind: 'occurrences'; spaceOccurrenceIds: readonly string[] }>
  | Readonly<{ kind: 'documentary-only' }>;

export interface ElectricalDocumentaryRecord {
  readonly fixtureId: string;
  readonly role: ElectricalRecordRole;
  readonly associationScope: ElectricalAssociationScope;
  readonly sharedScopeIds: readonly string[];
}

export interface ElectricalDocumentarySource {
  /** Host-local opaque key; never a URL, path or native authority. */
  readonly sourceKey: string;
  readonly role: ElectricalSourceRole;
  readonly label: string;
  readonly sheetId: string | null;
  readonly pdfPage: number | null;
}

export interface ElectricalDocumentaryReadyFrame {
  readonly status: 'available';
  /** Opaque host identity; never serialized. */
  readonly lease: object;
  readonly viewKey: string;
  readonly binding: ElectricalModelBinding;
  readonly target: ElectricalDocumentaryTarget;
  readonly custody: 'native-retained' | 'private-local-review';
  readonly qualification: 'documentary-only';
  readonly reviewSha256: Digest;
  readonly fixtureLedgerSha256: Digest;
  readonly fixtureData: ElectricalFixtureData;
  readonly documentaryIndex: ElectricityOverlayData | null;
  readonly view: Readonly<{
    id: string;
    label: string;
    fixtureIds: readonly string[];
    records: readonly ElectricalDocumentaryRecord[];
    sources: readonly ElectricalDocumentarySource[];
    installedFixtureCount: null;
  }>;
}

export type ElectricalUnavailableReason = 'no-provider' | 'model-not-qualified' | 'room-link-not-qualified'
  | 'evidence-not-qualified' | 'source-unavailable' | 'selection-changed' | 'access-revoked';

export type ElectricalDocumentaryFrame = ElectricalDocumentaryReadyFrame
  | Readonly<{ status: 'unavailable' | 'stale' | 'revoked'; reason: ElectricalUnavailableReason }>;

export interface HostElectricalDocumentaryPort {
  readonly contract: typeof HOST_ELECTRICAL_DOCUMENTARY_CONTRACT;
  read(request: ElectricalDocumentaryRequest, signal: AbortSignal): Promise<ElectricalDocumentaryFrame>;
  isCurrent(frame: ElectricalDocumentaryReadyFrame): boolean;
  subscribeInvalidation(frame: ElectricalDocumentaryReadyFrame, changed: () => void): () => void;
  openSource(frame: ElectricalDocumentaryReadyFrame, sourceKey: string, signal: AbortSignal): Promise<'opened' | 'unavailable'>;
  release(frame: ElectricalDocumentaryReadyFrame): void;
}

// Local model review seam ---------------------------------------------------

/** The exact File objects whose bytes the active standard-loader renderer
 * consumed. A second File with identical bytes is not this capability. */
export type RendererFiles = Readonly<{ modelFile: File; manifestFile: File; referenceFile: File }>;

/** Stable opaque renderer context; `capture()` always returns the same frozen
 * object for one renderer, which carries the RendererFiles identities. */
export type RendererSelectionContext = RendererFiles;

export interface SelectionOwner {
  capture(): RendererSelectionContext;
  isCurrent(context: object): boolean;
  /** Notifies synchronously on renderer, session, scope or access withdrawal. */
  subscribe(context: object, changed: () => void): () => void;
}

/** Context the source host passes to the reader: the provider frame context
 * plus the stable selection context. */
export interface SourceOpenContext {
  readonly frame: ElectricalDocumentaryReadyFrame;
  readonly binding: ElectricalModelBinding;
  readonly reviewSha256: Digest;
  readonly fixtureLedgerSha256: Digest;
  readonly custody: 'native-retained' | 'private-local-review';
  readonly selectionContext: object;
}

/** Immutable verified local source capability handed over by the host. */
export interface SourceOpenAction {
  readonly blob: Blob;
  readonly sourceKey: string;
  readonly role: ElectricalSourceRole;
  readonly contentType: string;
  /** One-based source page. For crops and interpretation records it is PDF provenance only. */
  readonly pdfPage: number | null;
  readonly sha256: Digest;
  readonly bytes: number;
  readonly label: string;
  readonly binding: ElectricalModelBinding;
}

export interface LocalElectricalSourceReader {
  isCurrent?(context: SourceOpenContext): boolean;
  open(action: SourceOpenAction, signal: AbortSignal, context: SourceOpenContext): Promise<'opened' | 'unavailable'>;
}

export interface ElectricalBridge {
  readonly port: HostElectricalDocumentaryPort;
  readonly binding: ElectricalModelBinding;
  /** Actual loader node association index; null stays unqualified. */
  resolvePickedNode(nodeIndex: number): ElectricalDocumentaryTarget | null;
  /** Accepts only an exact explicit target; no label or IFC-ID lookup. */
  resolveTarget(target: ElectricalDocumentaryTarget): ElectricalDocumentaryTarget | null;
  close(): void;
}

export type CreateElectricalBridge = (options: RendererFiles & {
  readonly selectionOwner: SelectionOwner;
  readonly reader: LocalElectricalSourceReader;
  readonly signal: AbortSignal;
}) => Promise<ElectricalBridge>;

/** Source-owner supplied selector entry. Labels are display only; the target
 * still passes through `resolveTarget`. */
export interface ElectricalTargetChoice {
  readonly label: string;
  readonly target: ElectricalDocumentaryTarget;
}

/** Session, scope and access ownership supplied by the host. `current()`
 * returns one stable token per owner (null when none); a different token
 * retires every renderer captured under the previous one. */
export interface ReviewSessionOwner {
  current(): object | null;
  subscribe(changed: () => void): () => void;
}

/** Optional review inputs for the local model viewer. All are source-owner
 * supplied and must be stable for one renderer; absent inputs leave the viewer
 * usable and electrical documents unavailable without any request. */
export interface LocalModelReviewOptions {
  readonly createElectricalBridge?: CreateElectricalBridge;
  /** Explicit logical-room, occurrence or documentary-scope choices. */
  readonly electricalTargets?: readonly ElectricalTargetChoice[];
  readonly session?: ReviewSessionOwner;
}
