/** Bounded, anonymous stage timing for local responsiveness evidence.
 *
 * Entries carry only a fixed area, a fixed event name and small enumerated or
 * numeric details: no identifiers, labels, paths, coordinates or user data.
 * They stay in this tab (User Timing marks plus an in-memory ring) and are
 * never sent anywhere. The ring and the marks it created are bounded together:
 * each ring entry owns one uniquely named mark, `houseatlas:<area>:<event>:<n>`
 * with a local sequence number, which is cleared by that exact name when the
 * entry leaves the ring. Marks of other owners are never cleared. */

export type StageArea = 'site' | 'scan-atlas' | 'network-scene' | 'scene-drawing' | 'model' | 'source';
/** Fixed tokens only; free text never enters an entry. */
export type StageToken = 'pointer' | 'keyboard' | 'midpoint' | 'endpoint' | 'edge' | 'pin' | 'dock' | 'none'
  | 'cold' | 'warm' | 'png' | 'pdf' | 'image' | 'text' | 'shown' | 'unavailable' | 'empty' | 'timeout' | 'withdrawn' | 'failed';
export type StageDetail = Readonly<Record<string, number | boolean | StageToken>>;
export interface StageEntry { readonly area: StageArea; readonly event: string; readonly at: number; readonly detail: StageDetail | null }

export const STAGE_TIMING_LIMIT = 200;
const ring: { readonly entry: StageEntry; readonly mark: string | null }[] = [];
let sequence = 0;
const clearOwned = (mark: string | null) => { if (mark !== null) try { performance.clearMarks(mark); } catch { /* timing is optional */ } };
const listeners = new Set<() => void>();
const EVENT = /^[a-z][a-z0-9-]{0,47}$/;

/** Records one stage event. Invalid names are dropped rather than recorded. */
export function stageMark(area: StageArea, event: string, detail?: StageDetail) {
  if (!EVENT.test(event)) return;
  const at = typeof performance === 'undefined' ? Date.now() : performance.now();
  const entry: StageEntry = Object.freeze({ area, event, at, detail: detail ? Object.freeze({ ...detail }) : null });
  let mark: string | null = `houseatlas:${area}:${event}:${++sequence}`;
  try { performance.mark(mark, { startTime: at, detail: entry.detail }); } catch { mark = null; /* timing is optional */ }
  ring.push({ entry, mark });
  while (ring.length > STAGE_TIMING_LIMIT) clearOwned(ring.shift()!.mark);
  for (const changed of listeners) { try { changed(); } catch { /* independent */ } }
}

/** Starts a span; the returned function records `<event>-end` with its duration. */
export function stageSpan(area: StageArea, event: string, detail?: StageDetail) {
  const start = typeof performance === 'undefined' ? Date.now() : performance.now();
  stageMark(area, `${event}-start`, detail);
  let done = false;
  return (end?: StageDetail) => {
    if (done) return; done = true;
    const now = typeof performance === 'undefined' ? Date.now() : performance.now();
    stageMark(area, `${event}-end`, { ...detail, ...end, ms: Math.round((now - start) * 10) / 10 });
  };
}

export const readStageTimings = (): readonly StageEntry[] => ring.map(item => item.entry);
export function subscribeStageTimings(changed: () => void) { listeners.add(changed); return () => { listeners.delete(changed); }; }
export function clearStageTimings() {
  for (const item of ring.splice(0)) clearOwned(item.mark);
  for (const changed of listeners) { try { changed(); } catch { /* independent */ } }
}
