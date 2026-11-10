import type { ReadyView } from '../src/app/types';
import type { OfflineHomeboxAttachmentRefV1 } from '../src/offline/live-copy-types';
import { HOMEBOX_ORIGINAL_MAX_BYTES } from '../src/offline/live-copy-owner';
import type { LiveCopyRetention } from './live-copy-retention';

/** Each read costs server admission and provider reads; the server separately bounds requests per session. */
export const HOMEBOX_AUTOMATIC_READS_PER_PASS = 32;

/** One bounded automatic pass over stored files listed by the current live view. The view only selects exact
 * associations and supplies size hints for scheduling; it is never treated as a complete HomeBox catalog.
 * Unknown sizes are skipped, nothing sent in this session is retried and an uncertain result stops the pass. */
export async function fillOfflineHomeboxOriginals(options: {
  owner: LiveCopyRetention; view: ReadyView; current(): boolean; enabled(): boolean; signal: AbortSignal;
}): Promise<{ message: string; complete: boolean }> {
  const { owner, view, signal } = options;
  const live = () => !signal.aborted && options.current() && options.enabled();
  const stopped = (status: string) => ({ message: `HomeBox file download stopped (${status}). Check held files before trying again.`, complete: false });
  const candidates: { ref: OfflineHomeboxAttachmentRefV1; bytes: number }[] = [];
  let unknownSize = 0;
  for (const entry of view.entries) for (const attachment of entry.attachments) {
    if (attachment.kind !== 'stored-file' || entry.source.sourceKind !== 'homebox-entity') continue;
    const bytes = attachment.byteSize !== null && /^[1-9][0-9]{0,8}$/.test(attachment.byteSize) ? Number(attachment.byteSize) : null;
    if (bytes === null || bytes > HOMEBOX_ORIGINAL_MAX_BYTES) { unknownSize++; continue; }
    candidates.push({ bytes, ref: { source: 'homebox-attachment', sourceInstanceId: entry.source.sourceInstanceId,
      collectionId: entry.source.collectionId, entityId: entry.source.externalId, attachmentId: attachment.attachmentId } });
  }
  const skipped = unknownSize ? `; ${unknownSize} without a usable size stay online-only` : '';
  if (!candidates.length) return { message: `No HomeBox files to keep${skipped}.`, complete: unknownSize === 0 };
  if (!live()) return stopped('stopped');
  const copy = await owner.read.readLast(signal);
  if (copy.status !== 'ok') return stopped(copy.status);
  const [native, electrical, storage] = await Promise.all([owner.read.readCatalog(copy.value.handle, signal),
    owner.read.readElectricalCatalog(copy.value.handle, signal), owner.storage.status(signal)]);
  if (storage.status !== 'ok' || native.status !== 'ok' && native.status !== 'missing' || electrical.status !== 'ok' && electrical.status !== 'missing')
    return { message: 'Held file sizes could not be checked. Automatic HomeBox downloads paused.', complete: false };
  // Size hints are display data; they schedule work but never admit bytes, which the store measures itself.
  const total = candidates.reduce((sum, row) => sum + row.bytes, 0)
    + (native.status === 'ok' ? native.value.documents.filter(row => row.lifecycle === 'active').reduce((sum, row) => sum + row.bytes, 0) : 0)
    + (electrical.status === 'ok' ? electrical.value.buildings.reduce((sum, building) => sum + building.documents.reduce((n, d) => n + Number(d.pin.byteSize), 0), 0) : 0);
  if (total > storage.value.budgetBytes * 0.8) return { message: 'HomeBox files exceed the automatic storage budget.', complete: false };
  let held = 0, unavailable = 0, reads = 0;
  for (const { ref } of candidates) {
    if (!live()) return stopped(signal.aborted ? 'aborted' : 'retired');
    const status = await owner.read.homeboxStatus(copy.value.handle, ref, signal);
    if (status.status === 'ok' && status.value.availability === 'held') { held++; continue; }
    if (status.status !== 'ok') return stopped(status.status);
    if (owner.homeboxSent(ref)) { unavailable++; continue; }
    if (reads >= HOMEBOX_AUTOMATIC_READS_PER_PASS) return { message: `${held} HomeBox ${held === 1 ? 'file' : 'files'} on this device; more remain for a later pass.`, complete: false };
    if (!live()) return stopped(signal.aborted ? 'aborted' : 'retired');
    reads++;
    const result = await owner.retainHomeboxOriginal(ref, signal);
    if (result.status === 'ok') held++;
    else if (result.status === 'uncertain' || result.status === 'retired' || result.status === 'aborted') return stopped(result.status);
    else unavailable++;
  }
  return { message: `${held} HomeBox ${held === 1 ? 'file' : 'files'} on this device${unavailable ? `; ${unavailable} unavailable` : ''}${skipped}.`,
    complete: unavailable === 0 && unknownSize === 0 };
}
