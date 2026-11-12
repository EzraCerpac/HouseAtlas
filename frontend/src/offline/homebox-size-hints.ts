import type { OfflineDisplayData } from './live-copy-types';
import { ExactDecimal } from '../numeric/decimal';

export interface HomeboxSizeHints {
  readonly files: number;
  readonly knownSizes: number;
  readonly unknownSizes: number;
  /** Sum of known hints only; null means their sum exceeds safe integer range. */
  readonly hintBytes: number | null;
  readonly aboveAutomaticLimit: number;
}

// Display boundary only. This module neither admits downloads nor imports their owner.
const AUTOMATIC_FILE_LIMIT_BYTES = 10 * 1024 * 1024;
function hintBytes(token: string | null | undefined): number | null {
  if (typeof token !== 'string') return null;
  try {
    const bytes = ExactDecimal.parse(token).toSafeInteger();
    return bytes !== undefined && bytes >= 0 ? bytes : null;
  } catch { return null; }
}

/** Captured metadata only, not measured retained bytes, source discovery or a complete catalog. */
export function summarizeHomeboxSizeHints(data: OfflineDisplayData): HomeboxSizeHints {
  const hints = new Map<string, number | null>();
  for (const entry of data.entries) {
    if (entry.source.sourceKind !== 'homebox-entity') continue;
    for (const attachment of entry.attachments) {
      if (attachment.kind !== 'stored-file') continue;
      const key = JSON.stringify([data.scope.workspaceId, data.scope.homeId, entry.source.sourceInstanceId,
        entry.source.collectionId, entry.source.externalId, attachment.attachmentId]);
      const bytes = hintBytes(attachment.byteSize);
      // A conflicting or unknown duplicate stays unknown in either input order.
      hints.set(key, hints.has(key) && hints.get(key) !== bytes ? null : bytes);
    }
  }
  let knownSizes = 0, aboveAutomaticLimit = 0, total: number | null = 0;
  for (const bytes of hints.values()) {
    if (bytes === null) continue;
    knownSizes++;
    if (bytes > AUTOMATIC_FILE_LIMIT_BYTES) aboveAutomaticLimit++;
    if (total !== null) total = bytes > Number.MAX_SAFE_INTEGER - total ? null : total + bytes;
  }
  return { files: hints.size, knownSizes, unknownSizes: hints.size - knownSizes, hintBytes: total, aboveAutomaticLimit };
}
