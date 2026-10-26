/** What the worker sends back: the bytes it was given and their SHA-256, or null when it could not hash. */
export type Sha256WorkerReply = { readonly bytes: Uint8Array<ArrayBuffer>; readonly digest: ArrayBuffer } | null;

/** SHA-256 of a large buffer off the page's thread. WebCrypto copies its input
 * synchronously before hashing, which for a 100+ MB model is one long task on
 * the page; here `bytes` moves to a dedicated worker, is hashed there, and
 * comes back with its digest without a copy. Use the returned bytes: `bytes`
 * is detached. The worker ends when the digest settles or `signal` aborts. A
 * browser without workers hashes here. */
export async function sha256OffThread(bytes: Uint8Array<ArrayBuffer>, signal: AbortSignal)
  : Promise<{ readonly bytes: Uint8Array<ArrayBuffer>; readonly digest: Uint8Array<ArrayBuffer> }> {
  signal.throwIfAborted();
  if (typeof Worker === 'undefined') return { bytes, digest: new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)) };
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./sha256.worker.ts', import.meta.url), { type: 'module', name: 'houseatlas-sha256' });
    const settle = (finish: () => void) => { worker.terminate(); signal.removeEventListener('abort', abort); finish(); };
    const abort = () => settle(() => reject(signal.reason));
    signal.addEventListener('abort', abort, { once: true });
    worker.onerror = event => { event.preventDefault(); settle(() => reject(new Error('The digest worker could not start'))); };
    worker.onmessageerror = () => settle(() => reject(new Error('The digest worker reply could not be read')));
    worker.onmessage = ({ data }: MessageEvent<Sha256WorkerReply>) => settle(() => data
      ? resolve({ bytes: data.bytes, digest: new Uint8Array(data.digest) })
      : reject(new Error('The digest worker could not hash the bytes')));
    const owned = bytes.byteOffset === 0 && bytes.byteLength === bytes.buffer.byteLength ? bytes : bytes.slice();
    worker.postMessage(owned, [owned.buffer]);
  });
}
