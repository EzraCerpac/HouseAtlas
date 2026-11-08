import type { LiveCopyRetention } from './live-copy-retention';

/** One bounded pass, with no retry of uncertain storage results or invented authority. */
export async function fillOfflineLibrary(owner: LiveCopyRetention, signal: AbortSignal, enabled: () => boolean = () => true): Promise<string> {
  const catalog = await owner.retainCatalog(signal);
  if (catalog.status !== 'ok') return `The document list could not be read (${catalog.status}).`;
  const initial = await owner.read.readLast(signal);
  if (initial.status !== 'ok') return 'The held home is unavailable.';
  const revision = initial.value.snapshot.snapshotRevision;
  const rows = catalog.value.documents.filter(row => row.lifecycle === 'active');
  const status = await owner.storage.status(signal);
  if (status.status !== 'ok') return 'Device storage status is unavailable.';
  const bytes = rows.reduce((sum, row) => sum + row.bytes, 0);
  // Leave room for metadata and other held information; avoid cycling an oversized library through LRU.
  if (bytes > status.value.budgetBytes * 0.8) return 'These documents exceed the automatic storage budget. Files opened online can still be kept.';
  let kept = 0, unavailable = 0;
  for (const row of rows) {
    if (signal.aborted || !enabled()) return 'Library download stopped. Files already held remain on this device.';
    if (row.recordedAvailability !== 'available') { unavailable++; continue; }
    const copy = await owner.read.readLast(signal);
    if (copy.status !== 'ok' || copy.value.snapshot.snapshotRevision !== revision) return 'The held home changed. Open live to read it again.';
    const held = await owner.read.documentStatus(copy.value.handle, row, signal);
    if (held.status === 'ok' && held.value.availability === 'held') { kept++; continue; }
    if (signal.aborted || !enabled()) return 'Library download stopped. Files already held remain on this device.';
    const result = await owner.retainDocument(row.documentId, row.documentRevision, signal);
    if (result.status === 'ok') kept++;
    else if (result.status === 'retired' || result.status === 'aborted' || result.status === 'uncertain') return `Library download stopped (${result.status}). Check held files before trying again.`;
    else unavailable++;
  }
  return `${kept} ${kept === 1 ? 'file' : 'files'} on this device${unavailable ? `; ${unavailable} unavailable` : ''}.`;
}
