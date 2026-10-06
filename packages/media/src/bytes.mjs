import { performance } from 'node:perf_hooks';

export const MAX_BYTES = 10 * 1024 * 1024;
export class MediaError extends Error {
  constructor(status = 404) { super('Media unavailable'); this.status = status; }
}
export const deny = (status = 404) => { throw new MediaError(status); };
export const exact = (value, keys) => {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).sort().join(',') !== [...keys].sort().join(',')) deny();
};

// One deadline covers transport, byte iteration, validation and rendering. Late
// results cannot publish. Cooperating providers receive the cancellation signal.
export async function timed(signal, timeoutMs, operation) {
  if (signal != null && !(signal instanceof AbortSignal)) deny(422);
  const controller = new AbortController(), started = performance.now();
  let rejectCancel;
  const cancelled = new Promise((_, reject) => { rejectCancel = reject; });
  const cancel = () => { controller.abort(); rejectCancel(new MediaError(503)); };
  cancelled.catch(() => {});
  const timer = setTimeout(cancel, timeoutMs);
  signal?.addEventListener('abort', cancel, { once: true });
  if (signal?.aborted) cancel();
  const check = () => { if (controller.signal.aborted || performance.now() - started >= timeoutMs) deny(503); };
  const wait = promise => Promise.race([promise, cancelled]);
  try {
    check();
    const result = await wait(operation({ signal: controller.signal, check, wait }));
    check(); return result;
  } finally {
    clearTimeout(timer); signal?.removeEventListener('abort', cancel);
    controller.abort();
  }
}

export async function collect(body, { signal, check, wait, maxBytes = MAX_BYTES }) {
  let iterator, reader;
  if (body instanceof Uint8Array) iterator = [body][Symbol.iterator]();
  else if (body?.getReader) { reader = body.getReader(); iterator = { next: () => reader.read(), return: () => reader.cancel() }; }
  else if (body?.[Symbol.asyncIterator]) iterator = body[Symbol.asyncIterator]();
  else if (body?.[Symbol.iterator]) iterator = body[Symbol.iterator]();
  else deny(415);
  const cancel = () => { try { Promise.resolve(iterator.return?.()).catch(() => {}); } catch {} };
  signal.addEventListener('abort', cancel, { once: true });
  let complete = false;
  try {
    let size = 0, count = 0; const chunks = [];
    while (true) {
      check(); const part = await wait(Promise.resolve(iterator.next())); check();
      if (part.done) break;
      if (++count > 65536) deny(413);
      if (!(part.value instanceof Uint8Array)) deny(415);
      size += part.value.byteLength;
      if (size > maxBytes) deny(413);
      chunks.push(new Uint8Array(part.value)); // Own every chunk before next().
    }
    const result = Buffer.alloc(size); let offset = 0;
    for (const chunk of chunks) { check(); result.set(chunk, offset); offset += chunk.length; }
    complete = true; return result;
  } finally {
    signal.removeEventListener('abort', cancel);
    if (!complete) cancel();
    if (reader) { try { reader.releaseLock(); } catch {} }
  }
}
