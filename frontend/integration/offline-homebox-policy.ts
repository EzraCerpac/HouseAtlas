import type { ReadyView } from '../src/app/types';
import type { OfflineHomeboxAttachmentRefV1 } from '../src/offline/live-copy-types';
import { HOMEBOX_ORIGINAL_MAX_BYTES } from '../src/offline/live-copy-owner';
import type { PinnedFileClient } from '../src/api/pinned-file-client';
import type { LiveCopyRetention } from './live-copy-retention';

/** Each read costs server admission and provider reads; the server separately bounds requests per session. */
export const HOMEBOX_AUTOMATIC_READS_PER_PASS = 32;

/** One bounded automatic pass over stored files listed by the current live view. The view only selects exact
 * associations and supplies size hints for scheduling; it is never treated as a complete HomeBox catalog.
 * Unknown sizes are skipped, nothing sent in this session is retried and an uncertain result stops the pass. */
export async function fillOfflineHomeboxOriginals(options: {
  owner: LiveCopyRetention; view: ReadyView; pinnedFiles: Pick<PinnedFileClient, 'getBindingIdentity' | 'getBindingScope' | 'discover'>; current(): boolean; enabled(): boolean; signal: AbortSignal;
}): Promise<{ message: string; complete: boolean }> {
  const { owner, view, signal, pinnedFiles } = options;
  const stopped = (status: string) => ({ message: `HomeBox file download stopped (${status}). Check held files before trying again.`, complete: false });
  const result = await owner.withHomeboxFillPass(view, pinnedFiles, signal, options.current, options.enabled, async pass => {
    // Two bounded walks borrow the current view. No full candidate/installed arrays survive an await.
    function* candidates() {
      for (const entry of view.entries) for (const attachment of entry.attachments) {
        if (attachment.kind !== 'stored-file' || entry.source.sourceKind !== 'homebox-entity') continue;
        const bytes = attachment.byteSize !== null && /^[1-9][0-9]{0,8}$/.test(attachment.byteSize) ? Number(attachment.byteSize) : null;
        if (bytes === null || bytes > HOMEBOX_ORIGINAL_MAX_BYTES) { yield null; continue; }
        const ref: OfflineHomeboxAttachmentRefV1 = { source: 'homebox-attachment', sourceInstanceId: entry.source.sourceInstanceId,
          collectionId: entry.source.collectionId, entityId: entry.source.externalId, attachmentId: attachment.attachmentId };
        yield { ref, bytes };
      }
    }
    let unknownSize = 0, uninstalled = 0, installed = 0, total = pass.otherBytes;
    for (const item of candidates()) {
      if (!item) { unknownSize++; continue; }
      if (!pass.installed(item.ref)) { uninstalled++; continue; }
      installed++; total += item.bytes;
      if (!Number.isSafeInteger(total)) return stopped('resource');
    }
    const skipped = unknownSize ? `; ${unknownSize} without a usable size stay online-only` : '';
    if (!installed && !uninstalled) return { message: `No HomeBox files to keep${skipped}.`, complete: unknownSize === 0 };
    if (!installed) return { message: 'No current enumerable HomeBox file source. Cached files stay online-only.', complete: false };
    if (total > pass.budgetBytes * 0.8) return { message: 'HomeBox files exceed the automatic storage budget.', complete: false };
    let held = 0, unavailable = uninstalled, reads = 0;
    for (const item of candidates()) {
      if (!item || !pass.installed(item.ref)) continue;
      const { ref } = item;
      if (!pass.current()) return stopped(signal.aborted ? 'aborted' : 'retired');
      const status = await pass.status(ref);
      if (!pass.current()) return stopped(signal.aborted ? 'aborted' : 'retired');
      if (status.status === 'ok' && status.value.availability === 'held') { held++; continue; }
      if (status.status !== 'ok') return stopped(status.status);
      if (owner.homeboxSent(ref)) { unavailable++; continue; }
      if (reads >= HOMEBOX_AUTOMATIC_READS_PER_PASS) return { message: `${held} HomeBox ${held === 1 ? 'file' : 'files'} on this device; more remain for a later pass.`, complete: false };
      if (!pass.current()) return stopped(signal.aborted ? 'aborted' : 'retired');
      reads++;
      const result = await pass.retain(ref);
      if (result.status === 'ok') held++;
      else if (result.status === 'uncertain' || result.status === 'retired' || result.status === 'aborted' || result.status === 'resource') return stopped(result.status);
      else unavailable++;
    }
    return { message: `${held} HomeBox ${held === 1 ? 'file' : 'files'} on this device${unavailable ? `; ${unavailable} unavailable` : ''}${skipped}.`,
      complete: unavailable === 0 && unknownSize === 0 };
  });
  return result.status === 'ok' ? result.value : stopped(result.reason ?? result.status);
}
