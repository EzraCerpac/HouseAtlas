/** Yield after a browser frame, or to a message task while hidden. Abandoning a
 * scene must settle the yield even when the browser has suspended its RAFs. */
export function afterNextFrame(signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    let frame: number | null = null, channel: MessageChannel | null = null, settled = false;
    const finish = (aborted = false) => {
      if (settled) return;
      settled = true;
      if (frame !== null) cancelAnimationFrame(frame);
      channel?.port1.close(); channel?.port2.close();
      document.removeEventListener('visibilitychange', visibility);
      signal?.removeEventListener('abort', abort);
      if (aborted) reject(signal?.reason); else resolve();
    };
    const abort = () => finish(true);
    const task = () => {
      if (settled || channel) return;
      if (frame !== null) { cancelAnimationFrame(frame); frame = null; }
      channel = new MessageChannel();
      channel.port1.onmessage = () => finish();
      channel.port2.postMessage(null);
    };
    const visibility = () => { if (document.hidden) task(); };
    if (signal?.aborted) { abort(); return; }
    signal?.addEventListener('abort', abort, { once: true });
    document.addEventListener('visibilitychange', visibility);
    if (document.hidden) task(); else frame = requestAnimationFrame(task);
  });
}
