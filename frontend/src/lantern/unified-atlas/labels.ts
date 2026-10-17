import type { AtlasModel } from './scene';

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

export const LABEL_TAG_RISE = 49;
export const labelHitWidth = (text: string) => Math.max(44, Math.min(320, text.length * 7 + 12));
export interface RoomLabel { readonly id: string; readonly text: string; readonly x: number; readonly y: number; readonly rise: number; readonly tier: 'selected' | 'context' | 'plain' }
export const labelHitTarget = (row: RoomLabel): ScreenBox => ({ l: row.x - labelHitWidth(row.text) / 2,
  r: row.x + labelHitWidth(row.text) / 2, t: row.y - LABEL_TAG_RISE * row.rise - 16, b: row.y - LABEL_TAG_RISE * row.rise + 16 });

/** SVG names remain visible independently; only safe action targets enter the tab order. */
export function visibleLabelHits<T extends RoomLabel>(rows: readonly T[], size: { width: number; height: number },
  cover: readonly ScreenBox[], counts: readonly CountMarker[]): readonly T[] {
  const rank = { selected: 0, context: 1, plain: 2 };
  const ordered = [...rows].sort((a, b) => rank[a.tier] - rank[b.tier] || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return nonOverlappingTargets(rows, ordered, labelHitTarget, size, cover, counts.map(countMarkerTarget));
}

const levelNames = new WeakMap<AtlasModel, ReadonlyMap<string, string>>();
/** Source labels stay first. Duplicate display names use source elevations,
 * with a source-order discriminator where known/unknown elevations still tie. */
export function atlasLevelNames(model: AtlasModel): ReadonlyMap<string, string> {
  const cached = levelNames.get(model); if (cached) return cached;
  const names = new Map<string, string>();
  for (const building of model.scene.buildings) {
    const levels = building.levelIds.map(id => model.levelsById.get(id)!);
    const groups = new Map<string, typeof levels>();
    for (const level of levels) { const key = floorLabel(level.label); const own = groups.get(key) ?? []; own.push(level); groups.set(key, own); }
    for (const [name, group] of groups) {
      const qualified = group.map(level => group.length === 1 ? name : `${name} · ${level.sourceElevationM === null ? 'source elevation unknown' : `source ${level.sourceElevationM} m`}`);
      group.forEach((level, at) => {
        const text = qualified[at]!;
        names.set(level.levelId, qualified.filter(other => other === text).length > 1
          ? `${text} · source level ${building.levelIds.indexOf(level.levelId) + 1}` : text);
      });
    }
    // Source labels may themselves contain qualifier-like text. If the final
    // display strings collide, a unique suffix on every source level closes it.
    if (new Set(levels.map(level => names.get(level.levelId))).size !== levels.length)
      levels.forEach((level, at) => names.set(level.levelId, `${names.get(level.levelId)} · source level ${at + 1}`));
  }
  levelNames.set(model, names); return names;
}
export function atlasLevelName(model: AtlasModel, id: string, scope = false): string {
  const level = model.levelsById.get(id)!;
  return `${atlasLevelNames(model).get(id)!}${scope ? `, ${model.buildingsById.get(level.buildingId)!.label}` : ''}`;
}

/** Greedy, source-honest suppression: never move anchors or merge room counts.
 * A spatial grid bounds collision work; survivors keep their original DOM order. */
export function visibleCountMarkers<T extends CountMarker>(rows: readonly T[], size: { width: number; height: number },
  cover: readonly ScreenBox[], selected: string | null, context: readonly string[]): readonly T[] {
  const contexts = new Set(context), rank = (row: T) => row.occurrenceId === selected ? 0 : contexts.has(row.occurrenceId) ? 1 : 2;
  const ordered = [...rows].sort((a, b) => rank(a) - rank(b) || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  return nonOverlappingTargets(rows, ordered, countMarkerTarget, size, cover);
}

function nonOverlappingTargets<T>(rows: readonly T[], ordered: readonly T[], target: (row: T) => ScreenBox,
  size: { width: number; height: number }, cover: readonly ScreenBox[], reserved: readonly ScreenBox[] = []): readonly T[] {
  const cells = new Map<string, ScreenBox[]>(), kept = new Set<T>(), cell = 64;
  const keysOf = (box: ScreenBox) => {
    const keys: string[] = [];
    for (let x = Math.floor(box.l / cell); x <= Math.floor(box.r / cell); x++)
      for (let y = Math.floor(box.t / cell); y <= Math.floor(box.b / cell); y++) keys.push(`${x}:${y}`);
    return keys;
  };
  const reserve = (box: ScreenBox, keys: readonly string[]) => {
    for (const key of keys) { let bucket = cells.get(key); if (!bucket) { bucket = []; cells.set(key, bucket); } bucket.push(box); }
  };
  for (const box of reserved) reserve(box, keysOf(box));
  for (const row of ordered) {
    const box = target(row);
    if (!Number.isFinite(box.l + box.r + box.t + box.b) || box.l < 0 || box.t < 0 || box.r > size.width || box.b > size.height
      || cover.some(panel => intersects(box, panel))) continue;
    const keys = keysOf(box);
    if (keys.some(key => cells.get(key)?.some(placed => intersects(box, placed)))) continue;
    kept.add(row);
    reserve(box, keys);
  }
  return rows.filter(row => kept.has(row));
}
