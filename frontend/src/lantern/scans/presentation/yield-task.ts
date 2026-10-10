/** Cooperative task boundary without nested-timer delay. No limit or clock is changed. */
export function yieldTask(signal: AbortSignal): Promise<void> {
  signal.throwIfAborted();
  return new Promise<void>((resolve, reject) => {
    let settled = false;
    const channel = typeof MessageChannel === 'undefined' ? null : new MessageChannel();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const finish = (aborted: boolean): void => {
      if (settled) return;
      settled = true;
      signal.removeEventListener('abort', stop);
      if (timer !== undefined) clearTimeout(timer);
      if (channel) { channel.port1.onmessage = null; channel.port1.close(); channel.port2.close(); }
      if (aborted) reject(signal.reason); else resolve();
    };
    const stop = (): void => finish(true);
    signal.addEventListener('abort', stop, { once: true });
    if (channel) { channel.port1.onmessage = () => finish(false); channel.port2.postMessage(0); }
    else timer = setTimeout(() => finish(false), 0);
    if (signal.aborted) stop();
  });
}
