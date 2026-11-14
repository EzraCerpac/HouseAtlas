import { useEffect, useMemo, useRef, useState } from 'react';
import type { HomeboxOriginalFrame, HomeboxOriginalReader, HomeboxOriginalsPort, HomeboxRetentionAttempt } from '../homebox-originals/types';
import type { OfflineHomeboxAttachmentRefV1 } from '../../offline/live-copy-types';
import { useStore } from '../state/store';
import { SourcePdf } from '../source-documents/SourcePdf';

export interface HomeboxOriginalActionProps { readonly docId: string; readonly port?: HomeboxOriginalsPort }
/** Ordinary open of a HomeBox file: one bounded verified read that is kept on this device. */
export function HomeboxOriginalAction({ docId, port }: HomeboxOriginalActionProps) {
  const { projection, house } = useStore();
  const entry = projection.entries.get(docId), attachment = projection.attachments.get(docId);
  const title = house.docs.find(doc => doc.id === docId)?.title ?? 'HomeBox file';
  const key = useMemo(() => ({}), [port, projection.view, entry, attachment, docId]);
  const latest = useRef(key); latest.current = key;
  const [readerSlot, setReader] = useState<{ key: object; reader: HomeboxOriginalReader } | null>(null);
  const [opened, setOpened] = useState<{ key: object; frame: HomeboxOriginalFrame; attempt: HomeboxRetentionAttempt | null } | null>(null);
  const [message, setMessage] = useState<{ key: object; text: string } | null>(null);
  const [busy, setBusy] = useState<object | null>(null), [, tick] = useState(0);
  const [uncertain, setUncertain] = useState<object | null>(null);
  const request = useRef<AbortController | null>(null);
  const frameRef = useRef<HomeboxOriginalFrame | null>(null);
  const downloadRef = useRef<{ url: string; controller: AbortController } | null>(null);
  const clearDownload = () => {
    const held = downloadRef.current; downloadRef.current = null;
    if (held) { held.controller.abort(); URL.revokeObjectURL(held.url); }
  };
  const reader = readerSlot?.key === key ? readerSlot.reader : null;
  const currentOpen = opened?.key === key && reader?.isCurrent(opened.frame) ? opened : null;
  const blob = currentOpen ? reader!.getBlob(currentOpen.frame) : null;
  const [download, setDownload] = useState<{ blob: Blob; url: string; signal: AbortSignal } | null>(null);
  useEffect(() => {
    if (!port || !entry || entry.source.sourceKind !== 'homebox-entity' || attachment?.kind !== 'stored-file') return;
    const controller = new AbortController(); request.current = controller;
    let owned: HomeboxOriginalReader | null = null, unsubscribe: (() => void) | undefined;
    const current = () => latest.current === key && !controller.signal.aborted;
    void port.createReader(projection.view, controller.signal).then(result => {
      if (!current()) { if (result.status === 'ok') result.value.dispose(); return; }
      if (result.status !== 'ok') { setMessage({ key, text: `Opening files here is unavailable (${result.status}).` }); return; }
      owned = result.value; unsubscribe = owned.subscribe(() => {
        if (current()) {
          if (frameRef.current && !owned!.isCurrent(frameRef.current)) clearDownload();
          tick(value => value + 1);
        }
      });
      setReader({ key, reader: owned });
    }).catch(() => { if (current()) setMessage({ key, text: 'Opening files here is unavailable.' }); });
    return () => { controller.abort(); unsubscribe?.(); clearDownload(); owned?.dispose(); if (request.current === controller) request.current = null; };
  }, [key, port, projection.view, entry, attachment]);
  useEffect(() => {
    if (!blob || !reader || !currentOpen || !reader.isCurrent(currentOpen.frame)) return;
    const controller = new AbortController(), url = URL.createObjectURL(blob);
    downloadRef.current = { controller, url };
    setDownload({ blob, url, signal: controller.signal });
    return () => { if (downloadRef.current?.url === url) clearDownload(); };
  }, [blob]);
  if (!port || entry?.source.sourceKind !== 'homebox-entity' || attachment?.kind !== 'stored-file') return null;
  const open = async () => {
    const signal = request.current?.signal;
    if (!reader || !signal || signal.aborted || latest.current !== key || busy === key) return;
    setBusy(key); setMessage({ key, text: 'Opening…' });
    const ref: OfflineHomeboxAttachmentRefV1 = { source: 'homebox-attachment', sourceInstanceId: entry.source.sourceInstanceId,
      collectionId: entry.source.collectionId, entityId: entry.source.externalId, attachmentId: attachment.attachmentId };
    // Set once storage may have started: from then on a failure cannot claim that nothing was kept.
    let storing = false;
    try {
      const result = await reader.open(ref, signal);
      if (latest.current !== key || signal.aborted) { if (result.status === 'ok') reader.release(result.frame); return; }
      if (result.status !== 'ok') {
        setMessage({ key, text: result.status === 'busy' || result.status === 'settling' ? 'This file is already being opened.'
          : result.status === 'spent' ? 'This file was already requested in this session and is not requested again. Reload the page to try again.'
          : result.status === 'limit' ? 'Over 10 MiB: too large to keep on this device. Download original opens it without keeping it.'
          : result.status === 'unknown' ? 'Reading this file did not complete. No new copy was kept on this device. Reload the page to try again.'
          : result.status === 'unavailable' && result.reason === 'cancellation-ownership' ? 'This file is being kept on this device in the background. Open it again shortly.'
          : `This file could not be opened (${result.status}). No new copy was kept on this device.` }); return;
      }
      frameRef.current = result.frame;
      if (result.backing === 'exact-held') {
        // Reborrowed from the exact copy already held on this device; nothing new to store.
        setOpened({ key, frame: result.frame, attempt: null }); setMessage({ key, text: 'On this device.' }); return;
      }
      // Opening keeps the same verified bytes, independent of the whole-library preference.
      const retained = reader.retain(result.frame), attempt = retained.status === 'ok' ? retained.value : null;
      setOpened({ key, frame: result.frame, attempt });
      setMessage({ key, text: attempt ? 'Keeping a copy on this device…' : `Not kept on this device (${retained.status}).` });
      if (attempt) {
        storing = true;
        const stored = await attempt.result;
        if (latest.current !== key || signal.aborted) return;
        setUncertain(stored.status === 'uncertain' ? key : null);
        setMessage({ key, text: stored.status === 'ok' ? 'Kept on this device.'
          : stored.status === 'uncertain' ? 'Not known whether this file was kept on this device.'
          : stored.status === 'quota' ? 'Not kept on this device: device storage is full.'
          : `Not kept on this device (${stored.status}).` });
      }
    } catch {
      if (latest.current !== key || signal.aborted) return;
      if (storing) { setUncertain(key); setMessage({ key, text: 'This file was read. Not known whether it was kept on this device.' }); }
      else setMessage({ key, text: 'This file could not be opened. No new copy was kept on this device.' });
    }
    finally { if (latest.current === key) setBusy(null); }
  };
  const heldDownload = blob && download?.blob === blob && !download.signal.aborted ? download : null;
  return <section aria-label="Open file">
    {!currentOpen && <button className="btn btn-primary" type="button" disabled={!reader || busy === key} onClick={() => void open()}>Open file</button>}
    {message?.key === key && <p role="status">{message.text}</p>}
    {opened?.key === key && !currentOpen && <p>This copy was withdrawn or its sign-in changed.</p>}
    {heldDownload && <>
      {blob!.type === 'application/pdf' ? <SourcePdf blob={blob!} title={title} signal={heldDownload.signal} />
        : <p>No preview for this file type.</p>}
      <a className="btn" href={heldDownload.url} download={title} onClick={event => {
        if (!currentOpen || !reader?.isCurrent(currentOpen.frame)) { event.preventDefault(); clearDownload(); }
      }}>Save file</a>
    </>}
    {currentOpen?.attempt && uncertain === key && <button className="btn" type="button" onClick={() => {
      const signal = request.current?.signal; if (!signal || !currentOpen.attempt) return;
      void currentOpen.attempt.reconcile(signal).then(result => {
        if (latest.current === key && !signal.aborted) setMessage({ key, text: result.status === 'held'
          ? 'Kept on this device.' : `Still not known whether this file is on this device (${result.status}). Nothing was read or written again.` });
      });
    }}>Check this device</button>}
  </section>;
}
