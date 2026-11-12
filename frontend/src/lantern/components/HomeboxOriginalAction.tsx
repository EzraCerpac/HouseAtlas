import { useEffect, useMemo, useRef, useState } from 'react';
import type { HomeboxOriginalFrame, HomeboxOriginalReader, HomeboxOriginalsPort, HomeboxRetentionAttempt } from '../homebox-originals/types';
import type { OfflineHomeboxAttachmentRefV1 } from '../../offline/live-copy-types';
import { useStore } from '../state/store';
import { SourcePdf } from '../source-documents/SourcePdf';

export interface HomeboxOriginalActionProps { readonly docId: string; readonly port?: HomeboxOriginalsPort }
/** Additional bounded read, not interception of either issued-URL download action. */
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
      if (result.status !== 'ok') { setMessage({ key, text: `Verified-copy access unavailable (${result.status}).` }); return; }
      owned = result.value; unsubscribe = owned.subscribe(() => {
        if (current()) {
          if (frameRef.current && !owned!.isCurrent(frameRef.current)) clearDownload();
          tick(value => value + 1);
        }
      });
      setReader({ key, reader: owned });
    }).catch(() => { if (current()) setMessage({ key, text: 'Verified-copy access unavailable.' }); });
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
    setBusy(key); setMessage({ key, text: 'Reading one verified copy…' });
    const ref: OfflineHomeboxAttachmentRefV1 = { source: 'homebox-attachment', sourceInstanceId: entry.source.sourceInstanceId,
      collectionId: entry.source.collectionId, entityId: entry.source.externalId, attachmentId: attachment.attachmentId };
    try {
      const result = await reader.open(ref, signal);
      if (latest.current !== key || signal.aborted) { if (result.status === 'ok') reader.release(result.frame); return; }
      if (result.status !== 'ok') {
        setMessage({ key, text: result.status === 'busy' ? 'A copy is already being read. No additional read started.'
          : result.status === 'spent' ? `This session already spent this file read (${result.outcome}). No new read started. Inspect copies marked “On this device” in Library.`
          : result.status === 'limit' ? 'This file exceeds the 10 MiB verified-copy limit. The separate original download action is unchanged.'
          : result.status === 'unknown' ? 'Read outcome unknown. No automatic retry or alternate download was started.'
          : `Verified copy unavailable (${result.status}). No alternate download was started.` }); return;
      }
      frameRef.current = result.frame;
      // Keep-on-open is explicit tier one, independent of the whole-library preference.
      const retained = reader.retain(result.frame), attempt = retained.status === 'ok' ? retained.value : null;
      setOpened({ key, frame: result.frame, attempt });
      setMessage({ key, text: attempt ? 'Verified bytes ready. Keeping these same bytes on this device…' : `Verified bytes ready; keeping failed (${retained.status}).` });
      if (attempt) {
        const stored = await attempt.result;
        if (latest.current !== key || signal.aborted) return;
        setMessage({ key, text: stored.status === 'ok' ? 'This verified copy is on this device.'
          : stored.status === 'uncertain' ? 'Keeping outcome unknown. Check this exact copy before any further action.'
          : `Keeping failed (${stored.status}). Saving uses the same verified bytes only while this read remains current.` });
      }
    } catch { if (latest.current === key && !signal.aborted) setMessage({ key, text: 'Verified-copy action failed. No automatic retry was started.' }); }
    finally { if (latest.current === key) setBusy(null); }
  };
  const heldDownload = blob && download?.blob === blob && !download.signal.aborted ? download : null;
  return <section aria-label="Verified HomeBox copy">
    <h3>Verified copy for this device</h3>
    <p>This is a separate read of up to 10 MiB, not a HomeBox version or a complete library copy. The original download actions are unchanged.</p>
    {!currentOpen && <button className="btn" type="button" disabled={!reader || busy === key} onClick={() => void open()}>Read and keep verified copy</button>}
    {message?.key === key && <p role="status">{message.text}</p>}
    {opened?.key === key && !currentOpen && <p>This copy was withdrawn or its application binding changed.</p>}
    {heldDownload && <>
      <a className="btn" href={heldDownload.url} download={title} onClick={event => {
        if (!currentOpen || !reader?.isCurrent(currentOpen.frame)) { event.preventDefault(); clearDownload(); }
      }}>Save these verified bytes</a>
      {blob!.type === 'application/pdf' ? <SourcePdf blob={blob!} title={title} signal={heldDownload.signal} />
        : <p>Preview unavailable for this type. Save the verified bytes without opening a renderer.</p>}
    </>}
    {currentOpen?.attempt && <button className="btn" type="button" onClick={() => {
      const signal = request.current?.signal; if (!signal || !currentOpen.attempt) return;
      void currentOpen.attempt.reconcile(signal).then(result => {
        if (latest.current === key && !signal.aborted) setMessage({ key, text: result.status === 'held'
          ? 'This exact verified copy is held on this device.' : `Exact-copy keeping status: ${result.status}. No read or write was retried.` });
      });
    }}>Check this exact held copy</button>}
  </section>;
}
