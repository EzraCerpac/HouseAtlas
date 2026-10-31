import { useEffect, useRef, useState } from 'react';

/** Reconcile a changed key set before either rendering or advancing it. Keep
 * finite existing tracks, initialize new tracks at their finite target, and
 * retire removed tracks. Stable valid input keeps its object identity. */
export function initializeEased<T extends Record<string, number>>(current: Readonly<Record<string, number>>, target: T): T {
  const keys = Object.keys(target);
  let same = Object.keys(current).length === keys.length;
  for (const key of keys) {
    if (!Number.isFinite(target[key])) throw new RangeError('Easing targets must be finite');
    if (!Object.hasOwn(current, key) || !Number.isFinite(current[key])) same = false;
  }
  if (same) return current as T;
  return Object.fromEntries(keys.map(key => [key, Number.isFinite(current[key]) ? current[key]! : target[key]!])) as T;
}

/** The production RAF step, shared with the generated key-update checks. */
export function advanceEased<T extends Record<string, number>>(current: Readonly<Record<string, number>>, target: T, alpha: number): { value: T; settled: boolean } {
  const retained = initializeEased(current, target);
  const next = { ...retained } as Record<string, number>;
  let settled = true;
  for (const key of Object.keys(target)) {
    const targetValue = target[key]!;
    const value = retained[key]! + (targetValue - retained[key]!) * alpha;
    const close = Math.abs(targetValue - value) < Math.max(0.002, Math.abs(targetValue) * 1e-4);
    next[key] = close ? targetValue : value;
    if (!close) settled = false;
  }
  return { value: next as T, settled };
}

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
    cur.current = initializeEased(cur.current, goal.current);
    if (opts.snap?.length) {
      const snapped = { ...cur.current };
      for (const k of opts.snap) (snapped as Record<string, number>)[k as string] = goal.current[k]!;
      cur.current = snapped;
    }
    const step = (t: number) => {
      const dt = last.current == null ? 16 : Math.min(48, t - last.current);
      last.current = t;
      const a = 1 - Math.exp(-dt / tau);
      const next = advanceEased(cur.current, goal.current, a);
      cur.current = next.value;
      setValue(cur.current);
      if (next.settled) {
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

  // A render can introduce keys before the passive effect or next RAF runs.
  // Downstream section conversion must receive finite values in that frame.
  return initializeEased(value, target);
}
