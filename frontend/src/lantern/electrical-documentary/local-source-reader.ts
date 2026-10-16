import type { ElectricalSourceRole, LocalElectricalSourceReader, SourceOpenAction, SourceOpenContext } from './types';

/** Interpretation records larger than this are offered for saving only. */
export const LOCAL_TEXT_MAX_BYTES = 2 * 1024 * 1024;

export type LocalSourceRepresentation = 'pdf' | 'image' | 'text';
const EXPECTED: Readonly<Record<ElectricalSourceRole, { readonly type: string; readonly representation: LocalSourceRepresentation; readonly extension: string }>> = {
  'original-sheet': { type: 'application/pdf', representation: 'pdf', extension: 'pdf' },
  'drawing-crop': { type: 'image/jpeg', representation: 'image', extension: 'jpg' },
  'interpretation-record': { type: 'application/json', representation: 'text', extension: 'json' },
};
export const sourceFileName = (role: ElectricalSourceRole) => `${role}.${EXPECTED[role].extension}`;

/** One displayed local source. Immutable: every change publishes a new object. */
export interface LocalSourceDisplay {
  readonly id: number;
  readonly action: SourceOpenAction;
  readonly context: SourceOpenContext;
  readonly representation: LocalSourceRepresentation;
  /** Display lifetime. Aborted synchronously on clear, replacement or withdrawal. */
  readonly signal: AbortSignal;
  /** Owned object URL for the image and Save original; null if refused before reading. */
  readonly url: string | null;
  readonly status: 'loading' | 'shown' | 'failed';
  readonly message: string | null;
  /** Interpretation record exactly as decoded from its UTF-8 bytes; never parsed into a native payload. */
  readonly text: string | null;
}

/** Frame and selection currency for one source context, supplied by the
 * consumer that holds the frame. `watch` keeps both subscriptions while shown. */
export interface LocalSourceFence {
  isCurrent(context: SourceOpenContext): boolean;
  watch(context: SourceOpenContext, changed: () => void): () => void;
}

export interface LocalSourceReaderStore {
  /** Pass this to the bridge factory. */
  readonly reader: LocalElectricalSourceReader;
  subscribe(listener: () => void): () => void;
  snapshot(): LocalSourceDisplay | null;
  setFence(fence: LocalSourceFence | null): void;
  /** Called by the representation after its exact content is visible. */
  acknowledge(id: number): boolean;
  /** Resolves unavailable; `message` replaces the status unless the representation shows its own. */
  fail(id: number, message: string | null): void;
  isShowing(id: number): boolean;
  /** Synchronously hides the representation, cancels its work, revokes its URL
   * and resolves any pending open as unavailable. */
  clear(): void;
  dispose(): void;
}

interface Held {
  display: LocalSourceDisplay;
  readonly controller: AbortController;
  readonly stops: (() => void)[];
  settle: ((value: 'opened' | 'unavailable') => void) | null;
}

/** Owned local-Blob reader for verified PDF, JPEG and JSON source capabilities.
 * It never uploads, never makes a URL from a path and never casts these to
 * native Documents. `open` resolves `opened` only after the representation
 * acknowledges that the exact content is visible. */
export function createLocalSourceReader(): LocalSourceReaderStore {
  const listeners = new Set<() => void>();
  let fence: LocalSourceFence | null = null, held: Held | null = null, nextId = 0, disposed = false;
  const publish = () => { for (const listener of [...listeners]) listener(); };
  const update = (id: number, change: Partial<LocalSourceDisplay>) => {
    if (!held || held.display.id !== id) return false;
    held.display = { ...held.display, ...change }; publish(); return true;
  };
  const live = (entry: Held) => held === entry && !entry.controller.signal.aborted && !disposed
    && fence !== null && fence.isCurrent(entry.display.context);
  const settle = (entry: Held, value: 'opened' | 'unavailable') => {
    const resolve = entry.settle; entry.settle = null; resolve?.(value);
  };
  const close = (notify: boolean) => {
    const ending = held; held = null; if (!ending) return;
    // Abort first: listeners hide the DOM and cancel PDF work synchronously.
    ending.controller.abort();
    for (const stop of ending.stops.splice(0)) { try { stop(); } catch { /* independent owner */ } }
    if (ending.display.url) URL.revokeObjectURL(ending.display.url);
    settle(ending, 'unavailable');
    if (notify) publish();
  };
  const show = (action: SourceOpenAction, context: SourceOpenContext, status: LocalSourceDisplay['status'], message: string | null, url: string | null): Held => {
    close(false);
    const controller = new AbortController(), expected = EXPECTED[action.role];
    const entry: Held = { controller, stops: [], settle: null,
      display: { id: ++nextId, action, context, representation: expected.representation, signal: controller.signal, url, status, message, text: null } };
    held = entry;
    return entry;
  };

  const reader: LocalElectricalSourceReader = {
    isCurrent: context => !disposed && fence !== null && fence.isCurrent(context),
    open(action, signal, context) {
      // Fences immediately before any display effect.
      if (disposed || signal.aborted || !fence || !fence.isCurrent(context)) return Promise.resolve('unavailable');
      const expected = Object.hasOwn(EXPECTED, action.role) ? EXPECTED[action.role] : null;
      const refuse = (message: string) => {
        if (!expected || !fence) return Promise.resolve('unavailable' as const);
        // The truthful refusal is shown under the same frame and selection fences.
        const entry = show(action, context, 'failed', message, null);
        entry.stops.push(fence.watch(context, () => { if (held === entry) close(true); }));
        if (held === entry) publish();
        return Promise.resolve('unavailable' as const);
      };
      if (!expected || !(action.blob instanceof Blob)) return refuse('This source cannot be shown here.');
      if (action.contentType !== expected.type || action.blob.type !== expected.type)
        return refuse(`This source is not a ${expected.representation === 'pdf' ? 'PDF' : expected.representation === 'image' ? 'JPEG image' : 'JSON record'} and is not shown.`);
      if (action.role === 'original-sheet' && (action.pdfPage === null || !Number.isSafeInteger(action.pdfPage) || action.pdfPage < 1))
        return refuse('The source page for this sheet is not recorded, so no page is shown.');
      const entry = show(action, context, 'loading', null, URL.createObjectURL(action.blob));
      const result = new Promise<'opened' | 'unavailable'>(resolve => { entry.settle = resolve; });
      // The open signal guards only this pending request, not the shown view.
      const cancel = () => { if (entry.settle && held === entry) close(true); };
      signal.addEventListener('abort', cancel, { once: true });
      void result.finally(() => signal.removeEventListener('abort', cancel));
      entry.stops.push(fence.watch(context, () => { if (held === entry) close(true); }));
      if (held !== entry) return result;
      if (expected.representation === 'text') void readText(entry);
      publish();
      return result;
    },
  };

  async function readText(entry: Held) {
    const { blob } = entry.display.action;
    if (blob.size > LOCAL_TEXT_MAX_BYTES) { store.fail(entry.display.id, 'This record is too large to show here. Save the original to read it.'); return; }
    let text: string;
    try {
      text = new TextDecoder('utf-8', { fatal: true }).decode(await blob.arrayBuffer());
      // Parsed only to confirm it is JSON; the record is shown as written, so
      // every number keeps its exact original token.
      JSON.parse(text);
    } catch {
      if (live(entry)) store.fail(entry.display.id, 'This record is not readable JSON. Save the original to inspect it.');
      return;
    }
    // Late reads are discarded.
    if (live(entry)) update(entry.display.id, { text });
  }

  const store: LocalSourceReaderStore = {
    reader,
    subscribe(listener) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    snapshot: () => held?.display ?? null,
    setFence(next) { if (fence !== next) { close(true); fence = next; } },
    acknowledge(id) {
      const entry = held;
      if (!entry || entry.display.id !== id || !entry.settle) return false;
      if (!live(entry)) { close(true); return false; }
      update(id, { status: 'shown', message: null });
      settle(entry, 'opened');
      return true;
    },
    fail(id, message) {
      const entry = held;
      if (!entry || entry.display.id !== id || entry.controller.signal.aborted) return;
      update(id, { status: 'failed', message });
      settle(entry, 'unavailable');
    },
    isShowing: id => held !== null && held.display.id === id && live(held),
    clear: () => close(true),
    dispose() { if (disposed) return; disposed = true; close(true); fence = null; listeners.clear(); },
  };
  return store;
}
