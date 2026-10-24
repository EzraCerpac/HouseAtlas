/** Browser timeouts are bounded; a wake-up is not proof of absolute expiry.
 * Cancellation owns every rearm, including after a backward clock adjustment. */
export function scheduleSessionExpiry(expiresAt: number, expire: () => void): () => void {
  let cancelled = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const arm = () => {
    const remaining = expiresAt - Date.now();
    timer = setTimeout(observe, Number.isFinite(remaining)
      ? Math.max(1, Math.min(remaining + 1, 2_147_483_647)) : 1);
  };
  const observe = () => {
    timer = undefined;
    if (cancelled) return;
    const remaining = expiresAt - Date.now();
    if (!Number.isFinite(remaining) || remaining <= 0) {
      cancelled = true;
      expire();
    } else arm();
  };
  // Keep expiry callbacks asynchronous so publication can finish installing
  // its cancellation handle even if the deadline passed during allocation.
  arm();
  return () => {
    cancelled = true;
    if (timer !== undefined) clearTimeout(timer);
    timer = undefined;
  };
}
