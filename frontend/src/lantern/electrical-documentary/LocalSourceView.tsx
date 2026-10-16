import { useEffect, useLayoutEffect, useRef, useSyncExternalStore, type MouseEvent } from 'react';
import { SourcePdf } from '../source-documents/SourcePdf';
import { sourceFileName, type LocalSourceDisplay, type LocalSourceReaderStore } from './local-source-reader';
import { clearReaderTarget, returnFromSource, revealShownSource, setReaderTarget } from './source-focus';
import type { ElectricalSourceRole } from './types';
import './electrical-documentary.css';

export const SOURCE_ROLE_LABEL: Readonly<Record<ElectricalSourceRole, string>> = {
  'original-sheet': 'Original sheet', 'drawing-crop': 'Drawing crop', 'interpretation-record': 'Interpretation record',
};
const count = (value: number) => value.toLocaleString('en');
/** A crop's or record's page is provenance only; only the original sheet is paged. */
export function pageProvenance(role: ElectricalSourceRole, pdfPage: number | null) {
  if (pdfPage === null) return role === 'original-sheet' ? 'Source page not recorded' : 'No source page recorded';
  return role === 'original-sheet' ? `Page ${pdfPage} of the original PDF` : `From page ${pdfPage} of the original sheet`;
}
const visible = (element: Element | null) => element !== null && element.isConnected && element.closest('[hidden]') === null
  && element.getClientRects().length > 0;

/** Shows the one local source opened through the host. Withdrawal hides it,
 * cancels PDF work, drops the image and clears text synchronously. */
export function LocalSourceView({ store }: { readonly store: LocalSourceReaderStore }) {
  const display = useSyncExternalStore(store.subscribe, store.snapshot);
  if (!display) return null;
  return <LocalSourceFrame key={display.id} store={store} display={display} />;
}

function LocalSourceFrame({ store, display }: { readonly store: LocalSourceReaderStore; readonly display: LocalSourceDisplay }) {
  const box = useRef<HTMLDivElement>(null), image = useRef<HTMLImageElement>(null), text = useRef<HTMLPreElement>(null);
  const section = useRef<HTMLElement>(null), revealed = useRef(false);
  const mounted = useRef(false);
  const { action, context, id, signal } = display;
  useLayoutEffect(() => {
    if (section.current) setReaderTarget(store, id, section.current);
    return () => clearReaderTarget(store, id);
  }, [store, id]);
  // Once the exact content is visible, the user's Open leads here. The helper
  // rechecks that this display is still shown and current before it moves.
  useEffect(() => {
    if (display.status !== 'shown' || revealed.current) return;
    revealed.current = true;
    revealShownSource(store, id);
  }, [store, id, display.status]);
  useLayoutEffect(() => {
    const withdraw = () => {
      box.current?.setAttribute('hidden', '');
      image.current?.removeAttribute('src');
      if (text.current) text.current.textContent = '';
    };
    if (signal.aborted) withdraw();
    signal.addEventListener('abort', withdraw, { once: true });
    return () => signal.removeEventListener('abort', withdraw);
  }, [signal]);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      // Unmount clears this display unless StrictMode remounted the same view.
      queueMicrotask(() => { if (!mounted.current && store.snapshot()?.id === id) store.clear(); });
    };
  }, [store, id]);
  // An interpretation record acknowledges after its text is committed and visible.
  useEffect(() => {
    if (display.representation !== 'text' || display.text === null || display.status !== 'loading') return;
    const frame = requestAnimationFrame(() => {
      if (visible(text.current) && text.current!.textContent === display.text) store.acknowledge(id);
      else store.fail(id, 'This record could not be shown here. Save the original to read it.');
    });
    return () => cancelAnimationFrame(frame);
  }, [store, id, display.representation, display.text, display.status]);
  const onImage = () => {
    const element = image.current;
    if (!element || signal.aborted) return;
    element.decode().then(() => {
      if (!signal.aborted && element.naturalWidth > 0 && visible(element)) store.acknowledge(id);
      else if (!signal.aborted) store.fail(id, 'This image could not be shown here. Save the original to view it.');
    }, () => { if (!signal.aborted) store.fail(id, 'This image could not be decoded here. Save the original to view it.'); });
  };
  const save = (event: MouseEvent<HTMLAnchorElement>) => { if (!store.isShowing(id)) { event.preventDefault(); store.clear(); } };
  const role = SOURCE_ROLE_LABEL[action.role];
  const shown = display.status !== 'failed' || display.representation === 'pdf';
  return <section ref={section} className="esrc" aria-label={`${role}: ${action.label}`} tabIndex={-1}>
    <header className="esrc-head">
      <div>
        <h3>{action.label}</h3>
        <p>{role}. {pageProvenance(action.role, action.pdfPage)}.</p>
      </div>
      <button type="button" className="chip-btn" onClick={() => { store.clear(); returnFromSource(store); }}>Close source</button>
    </header>
    {display.message && <p className="esrc-status" role="status">{display.message}</p>}
    {display.status === 'loading' && display.representation !== 'pdf' && <p className="esrc-status" role="status">
      {display.representation === 'image' ? 'Decoding image…' : 'Reading record…'}</p>}
    {display.url && shown && <div ref={box} className={`esrc-body is-${display.representation}`}>
      {display.representation === 'pdf' && action.pdfPage !== null && <SourcePdf blob={action.blob} title={action.label}
        initialPage={action.pdfPage} signal={signal}
        onOutcome={outcome => { if (outcome === 'opened') store.acknowledge(id); else store.fail(id, null); }} />}
      {display.representation === 'image' && <img ref={image} src={display.url} alt={`${role}: ${action.label}`}
        onLoad={onImage} onError={() => store.fail(id, 'This image could not be decoded here. Save the original to view it.')} />}
      {display.representation === 'text' && display.text !== null && <pre ref={text} tabIndex={0}
        aria-label={`${role}: ${action.label}`}>{display.text}</pre>}
    </div>}
    <div className="esrc-foot">
      {display.url && <a className="btn btn-small" href={display.url} download={sourceFileName(action.role)} onClick={save}>
        Save original ({count(action.bytes)} bytes)</a>}
      <dl className="cifc-facts is-source">
        <div><dt>Custody</dt><dd>{context.custody === 'private-local-review' ? 'Private local review copy. Not retained by HouseAtlas.' : 'Retained source'}</dd></div>
        <div><dt>SHA-256</dt><dd><code>{action.sha256}</code><span>{count(action.bytes)} bytes, {action.contentType}</span></dd></div>
        <div><dt>Qualification</dt><dd>Documentary only. Not a current installation record.</dd></div>
      </dl>
    </div>
  </section>;
}
