/** Display names and projected control layout only. Source identities stay unchanged. */
export function floorLabel(source: string): string {
  const names: Record<string, string> = { ground: 'Ground Floor', intermediate: 'Tussenfloor', upper: 'Upper Floor', attic: 'Attic' };
  return names[source.toLowerCase()] ?? source;
}

export interface CountMarker { readonly key: string; readonly occurrenceId: string; readonly count: number; readonly x: number; readonly y: number }
export interface ScreenBox { readonly l: number; readonly t: number; readonly r: number; readonly b: number }
export const countMarkerWidth = (count: number) => Math.max(28, String(count).length * 8 + 18);
/** Includes the marker's nine-pixel CSS pseudo-element on every side. */
export const countMarkerTarget = (row: CountMarker): ScreenBox => ({ l: row.x - countMarkerWidth(row.count) / 2 - 9,
  r: row.x + countMarkerWidth(row.count) / 2 + 9, t: row.y - 23, b: row.y + 23 });
const intersects = (a: ScreenBox, b: ScreenBox) => a.l < b.r && a.r > b.l && a.t < b.b && a.b > b.t;

/** Greedy, source-honest suppression: never move anchors or merge room counts.
 * A spatial grid bounds collision work; survivors keep their original DOM order. */
export function visibleCountMarkers<T extends CountMarker>(rows: readonly T[], size: { width: number; height: number },
  cover: readonly ScreenBox[], selected: string | null, context: readonly string[]): readonly T[] {
  const contexts = new Set(context), rank = (row: T) => row.occurrenceId === selected ? 0 : contexts.has(row.occurrenceId) ? 1 : 2;
  const ordered = [...rows].sort((a, b) => rank(a) - rank(b) || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  const cells = new Map<string, ScreenBox[]>(), kept = new Set<T>(), cell = 64;
  for (const row of ordered) {
    const box = countMarkerTarget(row);
    if (!Number.isFinite(box.l + box.r + box.t + box.b) || box.l < 0 || box.t < 0 || box.r > size.width || box.b > size.height
      || cover.some(panel => intersects(box, panel))) continue;
    const keys: string[] = [];
    for (let x = Math.floor(box.l / cell); x <= Math.floor(box.r / cell); x++)
      for (let y = Math.floor(box.t / cell); y <= Math.floor(box.b / cell); y++) keys.push(`${x}:${y}`);
    if (keys.some(key => cells.get(key)?.some(placed => intersects(box, placed)))) continue;
    kept.add(row);
    for (const key of keys) { let bucket = cells.get(key); if (!bucket) { bucket = []; cells.set(key, bucket); } bucket.push(box); }
  }
  return rows.filter(row => kept.has(row));
}
