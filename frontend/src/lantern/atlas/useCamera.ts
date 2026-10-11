import { useEffect, useRef, useState } from 'react';

/**
 * Eases a set of numeric camera values toward their targets.
 * Keys listed in `snap` jump immediately (used while dragging).
 * Reduced motion snaps everything.
 */
export function useEased<T extends Record<string, number>>(
  target: T,
  opts: { reduced: boolean; snap?: (keyof T)[]; intro?: Partial<T> | undefined; tau?: number },
): T {
  const [value, setValue] = useState<T>(() => (opts.reduced || !opts.intro ? target : { ...target, ...opts.intro }));
  const cur = useRef(value);
  const goal = useRef(target);
  goal.current = target;
  const raf = useRef<number | null>(null);
  const last = useRef<number | null>(null);
  const tau = opts.tau ?? 130;
  const sig = Object.keys(target)
    .map((k) => `${k}:${target[k]!.toFixed(4)}`)
    .join('|');
  const snapSig = (opts.snap ?? []).join(',');

  useEffect(() => {
    if (opts.reduced) {
      cur.current = goal.current;
      setValue(goal.current);
      return;
    }
    if (opts.snap?.length) {
      const snapped = { ...cur.current };
      for (const k of opts.snap) (snapped as Record<string, number>)[k as string] = goal.current[k]!;
      cur.current = snapped;
    }
    const step = (t: number) => {
      const dt = last.current == null ? 16 : Math.min(48, t - last.current);
      last.current = t;
      const a = 1 - Math.exp(-dt / tau);
      const c = cur.current;
      const g = goal.current;
      const next = { ...c } as Record<string, number>;
      let settled = true;
      for (const k of Object.keys(g)) {
        const current = c[k]!;
        const targetValue = g[k]!;
        const v = current + (targetValue - current) * a;
        const close = Math.abs(targetValue - v) < Math.max(0.002, Math.abs(targetValue) * 1e-4);
        next[k] = close ? targetValue : v;
        if (!close) settled = false;
      }
      cur.current = next as T;
      setValue(cur.current);
      if (settled) {
        raf.current = null;
        last.current = null;
      } else {
        raf.current = requestAnimationFrame(step);
      }
    };
    if (raf.current == null) {
      last.current = null;
      raf.current = requestAnimationFrame(step);
    }
    return () => {
      if (raf.current != null) cancelAnimationFrame(raf.current);
      raf.current = null;
      last.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sig, opts.reduced, snapSig]);

  return value;
}
