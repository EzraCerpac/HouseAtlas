/** Documentary local data only. A partition is caller-supplied isolation, never
 * an actor, session, grant, live authorization, or a value derived from SavedHouse.
 * Browser-managed retention is not a backup or a device-durability guarantee. */
export interface LocalEditContext {
  readonly scope: Readonly<{ workspaceId: string; homeId: string }>;
  readonly savedKey: string;
  readonly snapshotId: string;
  readonly localRevision: string;
}

/** Exact selected resource descriptor. Its bytes may contain multiple records;
 * its digest must never be substituted for an individual record's digest. */
export interface LocalEditResourcePin {
  readonly id: string;
  readonly role: string;
  readonly label: string;
  readonly sha256: string;
  readonly bytes: number;
  readonly contentType: string;
  readonly record?: Readonly<{ recordType: string; recordId: string; revision: string }> | null;
}

export interface LocalEditSelection extends LocalEditContext {
  readonly selectedResource: LocalEditResourcePin;
  readonly recordIdentity: Readonly<{ recordType: string; recordId: string }>;
}

export interface LocalEditBytes {
  readonly bytes: ArrayBuffer;
  readonly sha256: string;
}

export interface LocalEditOriginal {
  /** Null means unavailable. Never extract or fabricate bytes from a proposal. */
  readonly bytes: ArrayBuffer | null;
  readonly sha256: string | null;
  /** Exact supplied string, including revisions beyond Number.MAX_SAFE_INTEGER.
   * Null remains unavailable even if a resource descriptor names a revision. */
  readonly revision: string | null;
}

export interface LocalEditInput extends LocalEditSelection {
  /** Exact supplied manifest, without parsing, canonicalization or re-encoding. */
  readonly manifest: LocalEditBytes;
  readonly original: LocalEditOriginal;
}

export interface LocalEditDraft extends LocalEditInput {
  readonly localPartitionId: string;
  readonly nativeAuthority: 'not-established';
  readonly currentBase: 'not-checked';
  /** Separate document bytes; null means no proposal. Reset only clears this. */
  readonly proposal: LocalEditBytes | null;
}

/** All results are detached. Mutation success means IndexedDB oncomplete, not
 * request success. Nothing here establishes a native operation or submission. */
export interface LocalEditRetentionStore {
  retain(input: LocalEditInput): Promise<LocalEditDraft>;
  get(selection: LocalEditSelection): Promise<LocalEditDraft | null>;
  list(context: LocalEditContext): Promise<readonly LocalEditDraft[]>;
  setProposal(selection: LocalEditSelection, bytes: ArrayBuffer): Promise<LocalEditDraft>;
  resetProposal(selection: LocalEditSelection): Promise<LocalEditDraft>;
  discard(selection: LocalEditSelection): Promise<boolean>;
  close(): Promise<void>;
}
