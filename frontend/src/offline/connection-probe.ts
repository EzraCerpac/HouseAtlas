import { useCallback, useEffect, useRef, useState } from 'react';

/** How often the Saved viewer asks whether the live host answers again, while visible. */
export const PROBE_INTERVAL_MS = 30_000;
export const PROBE_TIMEOUT_MS = 5_000;

/** True when the live entry answers at all: any HTTP status, including a
 * sign-in or error page, means the host is reachable. Only a rejected or
 * timed-out read counts as offline. Nothing is cached or read from the body. */
export async function probeLiveHost(transport: typeof fetch = fetch, origin = location.origin): Promise<boolean> {
  try {
    const response = await transport(new URL('/', origin).href, {
      method: 'GET', cache: 'no-store', credentials: 'same-origin', redirect: 'manual', signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
    });
    void response.body?.cancel().catch(() => undefined);
    return true;
  } catch { return false; }
}

export interface LiveHostState {
  /** null before the first answer. */
  readonly reachable: boolean | null;
  readonly checking: boolean;
  check(): void;
}

/** Checks on open, every PROBE_INTERVAL_MS while the page is visible, when the
 * browser reports it is online again, and when asked. */
export function useLiveHost(probe: () => Promise<boolean> = probeLiveHost): LiveHostState {
  const [reachable, setReachable] = useState<boolean | null>(null);
  const [checking, setChecking] = useState(false);
  const running = useRef(false);
  const check = useCallback(() => {
    if (running.current) return;
    running.current = true; setChecking(true);
    void probe().then(value => setReachable(value)).finally(() => { running.current = false; setChecking(false); });
  }, [probe]);
  useEffect(() => {
    check();
    const timer = setInterval(() => { if (document.visibilityState === 'visible') check(); }, PROBE_INTERVAL_MS);
    const visible = () => { if (document.visibilityState === 'visible') check(); };
    addEventListener('online', check); document.addEventListener('visibilitychange', visible);
    return () => { clearInterval(timer); removeEventListener('online', check); document.removeEventListener('visibilitychange', visible); };
  }, [check]);
  return { reachable, checking, check };
}
