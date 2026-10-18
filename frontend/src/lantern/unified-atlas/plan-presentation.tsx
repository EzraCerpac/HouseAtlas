import { useMemo, type CSSProperties } from 'react';
import { relativePath } from '../canonical-ifc/geometry';
import { TONE_COLOR, badgeFill } from '../canonical-ifc/tones';
import { contextOccurrenceIds, planFeaturesForLevel, type AtlasModel, type OverlayLayerIndex } from './scene';
import type { AtlasLevel, AtlasOccurrence, AtlasPlanFeature, OverlayKind, PlanRole } from './types';
import type { RoomArea } from './measurements';

/** Shared Plan paint and small room facts; no stage, camera or loading state. */
export const PLAN_ORDER: Record<PlanRole, number> = { room: 0, stair: 1, wall: 2, opening: 3, context: 4 };
const OVERLAY_LABEL: Record<OverlayKind, string> = { electrical: 'Electrical', network: 'Network' };
const plural = (count: number, one: string) => `${count.toLocaleString()} ${count === 1 ? one : `${one}s`}`;

/** Empty plans remain navigable in the floor list, without a blank thumbnail. */
export function planTileLevels(model: AtlasModel, levels: readonly AtlasLevel[], planned: ReadonlySet<string>): readonly AtlasLevel[] {
  return levels.filter(level => !planned.has(level.levelId) && planFeaturesForLevel(model, level.levelId).length > 0);
}

/** Absence of a source-model area does not change the source geometry basis. */
export function AreaValue({ geometryBasis, area }: { readonly geometryBasis: AtlasOccurrence['geometryBasis']; readonly area: RoomArea | null }): string {
  return area ? `${area.text}${area.partial ? ', this part of the room' : ''}`
    : geometryBasis.kind === 'owner-estimated-pick-proxy' ? 'Not measured: estimated outline' : 'Area unavailable from model outline';
}

export function PlanRoom({ feature, path, pickable, selected, context, tints }: {
  readonly feature: AtlasPlanFeature; readonly path: string; readonly pickable: boolean; readonly selected: string | null;
  readonly context: readonly string[]; readonly tints: ReadonlyMap<string, string>;
}) {
  const key = feature.spaceOccurrenceId;
  const tier = key === null ? ' is-display-only' : key === selected ? ' is-selected' : context.includes(key) ? ' is-context' : !pickable ? ' is-other' : '';
  const tint = key !== null && (tier === '' || tier === ' is-other') ? tints.get(key) : undefined;
  return <path d={path} fillRule="evenodd" vectorEffect="non-scaling-stroke"
    className={`cifc-plan-space${tier}`} style={tint ? { fill: tint } as CSSProperties : undefined} />;
}

/** One other floor in its own frame: its authored plan, the active layers'
 * room counts and source positions on that floor only, and a way to go there. */
export function PlanTile({ model, level, layers, tints, selected, name, choose }: {
  readonly model: AtlasModel; readonly level: AtlasLevel; readonly layers: readonly OverlayLayerIndex[];
  readonly tints: ReadonlyMap<string, string>; readonly selected: string | null; readonly name: string; readonly choose: () => void;
}) {
  const W = 120, H = 84, PAD = 6;
  const context = useMemo(() => contextOccurrenceIds(model, selected), [model, selected]);
  const view = useMemo(() => {
    const features = planFeaturesForLevel(model, level.levelId);
    if (features.length === 0) return null;
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (const feature of features) for (const ring of model.featureRings.get(feature.featureId)!)
      for (const [x, z] of ring) { minX = Math.min(minX, x); maxX = Math.max(maxX, x); minZ = Math.min(minZ, z); maxZ = Math.max(maxZ, z); }
    const center = [(minX + maxX) / 2, 0, (minZ + maxZ) / 2] as const;
    const scale = Math.min((W - 2 * PAD) / Math.max(maxX - minX, 1e-3), (H - 2 * PAD) / Math.max(maxZ - minZ, 1e-3));
    const ordered = features.map((feature, at) => ({ feature, at })).sort((a, b) => PLAN_ORDER[a.feature.role] - PLAN_ORDER[b.feature.role] || a.at - b.at);
    return { center, scale, rows: ordered.map(({ feature }) => ({ feature, path: relativePath(model.featureRings.get(feature.featureId)!, center) })) };
  }, [model, level.levelId]);
  if (view === null) return null;
  const own = new Set(level.occurrenceIds);
  const counts = layers.map(layer => ({ kind: layer.kind, rooms: [...layer.placed.values()].filter(row => own.has(row.occurrenceId) && row.recordCount > 0) }));
  const summary = counts.filter(row => row.rooms.length > 0).map(row => {
    const records = new Set<string>();
    for (const room of row.rooms) for (const id of room.recordIds) records.add(id);
    return plural(records.size, `${OVERLAY_LABEL[row.kind].toLowerCase()} record`);
  }).join(', ');
  const at = (x: number, z: number) => [(x - view.center[0]) * view.scale + W / 2, (z - view.center[2]) * view.scale + H / 2] as const;
  return <button type="button" className="ua-tile" onClick={choose} aria-label={`Show ${name}${summary ? `: ${summary}` : ''}`}>
    <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} aria-hidden="true">
      <g transform={`translate(${W / 2} ${H / 2}) scale(${view.scale})`}>
        {view.rows.map(({ feature, path }) => feature.role === 'room'
          ? <PlanRoom key={feature.featureId} feature={feature} path={path} pickable={false} selected={selected} context={context} tints={tints} />
          : <path key={feature.featureId} d={path} fillRule="evenodd" vectorEffect="non-scaling-stroke" className={`ua-plan-${feature.role}`} />)}
      </g>
      {counts.map(row => row.rooms.map(room => {
        const point = model.labels.get(room.occurrenceId); if (!point) return null;
        const [x, y] = at(point.x, point.z);
        return <circle key={`${row.kind}:${room.occurrenceId}`} cx={x + (layers.length > 1 ? (row.kind === 'electrical' ? -3 : 3) : 0)} cy={y} r={3.5}
          style={{ fill: badgeFill(row.kind) }} />;
      }))}
      {layers.map(layer => [...layer.placed.values()].flatMap(placement => placement.positions.filter(row => own.has(row.occurrenceId)).map((row, index) => {
        const [x, y] = at(row.position[0], row.position[2]);
        return <rect key={`${layer.kind}:${row.occurrenceId}:${index}`} x={x - 2.5} y={y - 2.5} width={5} height={5} transform={`rotate(45 ${x} ${y})`}
          style={{ fill: TONE_COLOR[layer.kind] }} />;
      })))}
    </svg>
    <span className="ua-tile-name">{name}</span>
    {summary && <span className="ua-tile-sub">{summary}</span>}
  </button>;
}

