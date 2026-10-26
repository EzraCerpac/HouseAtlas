import { GlbFormatError, type GlbAdmission, type GlbStage } from './glb-preflight';
import type { StandardGlb, StandardGlbOptions } from './standard-glb';

/** What the page sends the worker: one load, then its admission verdict. */
export type GlbWorkerRequest =
  | { readonly kind: 'load'; readonly bytes: Uint8Array<ArrayBuffer>; readonly keyPrefix: string; readonly admits: boolean; readonly options?: StandardGlbOptions }
  | { readonly kind: 'admitted' };
/** What the worker sends back: the admitted work (when the page asked to see
 * it), then the loaded GLB or the reason it was refused. */
export type GlbWorkerReply =
  | { readonly kind: 'admission'; readonly admission: GlbAdmission }
  | { readonly kind: 'loaded'; readonly glb: StandardGlb }
  | { readonly kind: 'failed'; readonly stage: GlbStage | null; readonly message: string };

/** loadStandardGlb in a dedicated worker. The preflight, loader and mesh
 * preparation are the same code; only the thread differs, so a large GLB (a
 * publication's Full detail) parses and prepares while the page keeps drawing.
 * `bytes` moves to the worker and is detached here. `admit` still runs on this
 * thread before the worker copies or extracts anything. Prepared vertex
 * streams and decoded textures move back without a copy. The worker ends when
 * the load settles or `signal` aborts. A browser without workers loads here. */
export async function loadStandardGlbInWorker(bytes: Uint8Array<ArrayBuffer>, keyPrefix: string, signal: AbortSignal,
  admit?: (admission: GlbAdmission) => void, options?: StandardGlbOptions): Promise<StandardGlb> {
  signal.throwIfAborted();
  if (typeof Worker === 'undefined') {
    const { loadStandardGlb } = await import('./standard-glb');
    return loadStandardGlb(bytes, keyPrefix, signal, admit, options);
  }
  return new Promise<StandardGlb>((resolve, reject) => {
    const worker = new Worker(new URL('./standard-glb.worker.ts', import.meta.url), { type: 'module', name: 'houseatlas-glb' });
    const settle = (finish: () => void) => { worker.terminate(); signal.removeEventListener('abort', abort); finish(); };
    const abort = () => settle(() => reject(signal.reason));
    signal.addEventListener('abort', abort, { once: true });
    worker.onerror = event => { event.preventDefault(); settle(() => reject(new GlbFormatError('load', 'The model worker could not start'))); };
    worker.onmessageerror = () => settle(() => reject(new GlbFormatError('load', 'The model worker reply could not be read')));
    worker.onmessage = ({ data }: MessageEvent<GlbWorkerReply>) => {
      if (data.kind === 'admission') {
        try { admit?.(data.admission); } catch (error) { settle(() => reject(error)); return; }
        worker.postMessage({ kind: 'admitted' } satisfies GlbWorkerRequest);
      } else if (data.kind === 'loaded') settle(() => resolve(data.glb));
      else settle(() => reject(data.stage === null ? new Error(data.message) : new GlbFormatError(data.stage, data.message)));
    };
    const owned = bytes.byteOffset === 0 && bytes.byteLength === bytes.buffer.byteLength ? bytes : bytes.slice();
    worker.postMessage({ kind: 'load', bytes: owned, keyPrefix, admits: admit !== undefined, ...(options ? { options } : {}) } satisfies GlbWorkerRequest, [owned.buffer]);
  });
}
