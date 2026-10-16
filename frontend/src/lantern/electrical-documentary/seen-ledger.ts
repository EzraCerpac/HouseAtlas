import type { ElectricalDocumentaryReadyFrame } from './types';

/** Exact ledger fixture IDs applied during one bridge's review. */
export interface SeenLedger {
  /** Adds the applied view's IDs and returns the distinct count for its ledger. */
  record(frame: ElectricalDocumentaryReadyFrame): number;
}

/** One union per bridge. IDs dedupe across views, repeated occurrences and
 * shared records; per-view totals are never summed. A frame from a different
 * fixture ledger starts a new union, since IDs only compare within one ledger. */
export function createSeenLedger(): SeenLedger {
  let ledger: string | null = null, ids = new Set<string>();
  return {
    record(frame) {
      if (frame.fixtureLedgerSha256 !== ledger) { ledger = frame.fixtureLedgerSha256; ids = new Set(); }
      for (const id of frame.view.fixtureIds) ids.add(id);
      return ids.size;
    },
  };
}
