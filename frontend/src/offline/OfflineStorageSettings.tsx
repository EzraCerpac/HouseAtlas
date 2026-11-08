import { useEffect, useState, useSyncExternalStore } from 'react';
import type { OfflineReadPort, OfflineStoragePort, OfflineStorageStatus } from './live-copy-types';
import { keepLibrary, setKeepLibrary, subscribeKeepLibrary } from './library-preference';

export interface OfflineStorageControls {
  readonly read: OfflineReadPort; readonly storage: OfflineStoragePort;
  /** Present only under the actual authenticated live owner. */
  readonly fillLibrary?: (signal: AbortSignal) => Promise<string>;
}
export const storageSize = (bytes: number) => `${(bytes / 1024 / 1024).toFixed(1)} MiB`;

export function OfflineStorageSettings({ controls }: { controls: OfflineStorageControls }) {
  const enabled = useSyncExternalStore(subscribeKeepLibrary, keepLibrary, () => true);
  const [status, setStatus] = useState<OfflineStorageStatus | null>(null);
  const [library, setLibrary] = useState<{ bytes: number; complete: boolean } | null>(null);
  const [message, setMessage] = useState<string | null>(null), [busy, setBusy] = useState(false);
  useEffect(() => {
    let request: AbortController | null = null;
    const refresh = () => {
      request?.abort(); request = new AbortController(); const signal = request.signal;
      void controls.storage.status(signal).then(result => { if (!signal.aborted) setStatus(result.status === 'ok' ? result.value : null); });
      void controls.read.readLast(signal).then(async copy => {
        const result = copy.status === 'ok' ? await controls.read.readCatalog(copy.value.handle, signal) : null;
        if (!signal.aborted) setLibrary(result?.status === 'ok' ? {
          bytes: result.value.documents.filter(row => row.lifecycle === 'active').reduce((sum, row) => sum + row.bytes, 0),
          complete: result.value.completeness === 'captured-complete',
        } : null);
      });
    };
    const stop = controls.read.subscribe(refresh); refresh();
    return () => { stop(); request?.abort(); };
  }, [controls]);
  const [attempt] = useState(() => ({ controller: null as AbortController | null, persistence: null as AbortController | null }));
  useEffect(() => () => { attempt.controller?.abort(); attempt.persistence?.abort(); }, [attempt]);
  const fill = async () => {
    if (busy || !controls.fillLibrary) return;
    setBusy(true); setMessage('Keeping library files…');
    const controller = new AbortController(); attempt.controller = controller;
    const result = await controls.fillLibrary(controller.signal).catch(() => 'Library files could not be kept.');
    if (!controller.signal.aborted) { setMessage(result); setBusy(false); }
  };
  return <fieldset className="field"><legend>Offline storage</legend>
    <label><input type="checkbox" checked={enabled} onChange={event => {
      const value = event.currentTarget.checked; setKeepLibrary(value); if (value) void fill();
      else { attempt.controller?.abort(); setBusy(false); setMessage('Automatic library downloads are off. Held files remain on this device.'); }
    }} /> Keep the native document library on this device</label>
    <p className="setting-static">{library ? `${library.complete ? 'Native library' : 'Partial native catalog'}: ${storageSize(library.bytes)}.` : 'Native library size is unavailable.'} HomeBox attachments and electrical discovery are separate sources.</p>
    <p className="setting-static">{status ? `${status.documents} files held · ${storageSize(status.bytes)} of ${storageSize(status.budgetBytes)} soft budget. Storage persistence: ${status.persistence}.` : 'Device storage status is unavailable.'}</p>
    {controls.fillLibrary ? <button type="button" className="btn" disabled={busy} onClick={() => void fill()}>Keep library now</button>
      : <p className="setting-static">Open live to download missing files. This preference applies on the next live read.</p>}
    <button type="button" className="btn" onClick={() => {
      const controller = new AbortController(); attempt.persistence?.abort(); attempt.persistence = controller;
      void controls.storage.requestPersistence(controller.signal).then(result => {
        if (!controller.signal.aborted) setMessage(result.status === 'ok' ? `Storage persistence: ${result.value}.` : 'Storage persistence could not be requested.');
      });
    }}>Ask browser to keep storage</button>
    <p className="setting-static" role="status">{message}</p>
  </fieldset>;
}
