import { useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react';
import type { NativeEvidenceDocumentClient, NativeEvidenceDocumentFrame } from '../scans/native-evidence-document-types';

/** Mount only for a current saved Atlas evidence reference. No URL leaves this surface. */
export function NativeEvidenceDocument({ client, evidenceId }: {
  readonly client: NativeEvidenceDocumentClient; readonly evidenceId: string;
}) {
  const [state, setState] = useState<'idle' | 'loading' | 'ready' | 'unavailable'>('idle');
  const [shown, setShown] = useState<{ frame: NativeEvidenceDocumentFrame; url: string } | null>(null);
  const [zoom, setZoom] = useState(1);
  const controller = useRef<AbortController | null>(null);
  const displayed = useRef<{ frame: NativeEvidenceDocumentFrame; url: string } | null>(null);
  const unsubscribe = useRef<(() => void) | null>(null);
  const surface = useRef<HTMLElement | null>(null), opener = useRef<HTMLButtonElement>(null), closer = useRef<HTMLButtonElement>(null);
  const restore = useRef(false);
  const clear = (focus: boolean) => {
    controller.current?.abort(); controller.current = null;
    if (surface.current) surface.current.hidden = true; // Lease withdrawal precedes React's next paint.
    const current = displayed.current; displayed.current = null;
    unsubscribe.current?.(); unsubscribe.current = null;
    if (current) { URL.revokeObjectURL(current.url); client.release(current.frame); }
    setShown(null);
    if (focus) { restore.current = true; opener.current?.focus(); }
  };
  useLayoutEffect(() => {
    setShown(null); setState('idle');
    // Key changes and unmount must remove the old URL before another render paints.
    return () => {
      controller.current?.abort(); controller.current = null;
      if (surface.current) surface.current.hidden = true;
      const current = displayed.current; displayed.current = null;
      unsubscribe.current?.(); unsubscribe.current = null;
      if (current) { URL.revokeObjectURL(current.url); client.release(current.frame); }
    };
  }, [client, evidenceId]);
  useLayoutEffect(() => {
    if (shown && client.isCurrent(shown.frame)) { if (surface.current) surface.current.hidden = false; closer.current?.focus(); }
    else if (restore.current) { restore.current = false; opener.current?.focus(); }
  }, [shown, client]);
  const open = async () => {
    clear(false); setZoom(1);
    const next = new AbortController(); controller.current = next; setState('loading');
    let frame: NativeEvidenceDocumentFrame | null = null;
    try {
      frame = await client.open(evidenceId, next.signal);
      if (next.signal.aborted || controller.current !== next || !client.isCurrent(frame)) { client.release(frame); return; }
      const blob = client.getBlob(frame);
      if (!blob || (frame.mode === 'inline-png' && blob.type !== 'image/png')) throw new Error('Original unavailable');
      const url = URL.createObjectURL(blob);
      const nextShown = { frame, url };
      displayed.current = nextShown;
      unsubscribe.current = client.subscribeInvalidation(frame, () => {
        if (displayed.current?.frame !== frame) return;
        clear(false); setState('unavailable');
      });
      if (!client.isCurrent(frame) || displayed.current !== nextShown) { clear(false); setState('unavailable'); return; }
      setShown(nextShown); setState('ready'); frame = null;
    } catch {
      if (!next.signal.aborted && controller.current === next) setState('unavailable');
      if (frame) client.release(frame);
    } finally { if (controller.current === next) controller.current = null; }
  };
  const close = () => { clear(true); setState('idle'); };
  const keys = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key === 'Escape') { event.preventDefault(); close(); return; }
    if (event.key !== 'Tab') return;
    const buttons = [...event.currentTarget.querySelectorAll<HTMLElement>('button, a[href]')]
      .filter(element => !element.hasAttribute('disabled'));
    if (!buttons.length) return;
    const first = buttons[0]!, last = buttons[buttons.length - 1]!;
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  };
  return <div className="native-evidence-document">
    <button ref={opener} type="button" disabled={state === 'loading'} onClick={() => void open()}>Open original</button>
    {state === 'loading' && <p role="status">Checking saved original…</p>}
    {state === 'unavailable' && <p role="status">The current original could not be opened. Use Open original to retry.</p>}
    {shown && client.isCurrent(shown.frame) && <section ref={surface} role="dialog" aria-modal="true"
      aria-label={shown.frame.mode === 'inline-png' ? 'Saved PNG preview' : 'Saved original download'} onKeyDown={keys}>
      <button ref={closer} type="button" onClick={close}>Close</button>
      {shown.frame.mode === 'inline-png' ? <>
        <p>Saved PNG preview · Atlas original {shown.frame.asset.assetId}</p>
        <div role="group" aria-label="Preview size">
          <button type="button" disabled={zoom <= 0.5} onClick={() => setZoom(value => Math.max(0.5, value / 2))}>Zoom out</button>
          <button type="button" disabled={zoom >= 4} onClick={() => setZoom(value => Math.min(4, value * 2))}>Zoom in</button>
        </div>
        <div style={{ maxHeight: '75vh', overflow: 'auto' }}>
          <img src={shown.url} alt="Saved PNG document preview" style={{ width: `${zoom * 100}%`, maxWidth: 'none', height: 'auto' }} />
        </div>
      </> : <>
        <p>This original is available as a download. An inline preview is unavailable.</p>
        <a href={shown.url} download={`atlas-original-${shown.frame.asset.assetId}.${shown.frame.asset.contentType === 'application/pdf' ? 'pdf' : shown.frame.asset.contentType === 'image/jpeg' ? 'jpg' : shown.frame.asset.contentType === 'image/png' ? 'png' : 'txt'}`} >Download original</a>
      </>}
    </section>}
  </div>;
}
