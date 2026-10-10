import type { ReactNode } from 'react';
import { LANTERN_EDGE } from '../../atlas/palette';
import type { Projector } from '../../atlas/projection';
import type { DisplayFloor } from './SceneMeshCanvas';
import type { DisplayRoomRegion, SchematicRoom } from './types';

interface Props {
  readonly regions: readonly DisplayRoomRegion[]; readonly rooms: readonly SchematicRoom[];
  readonly floors: readonly DisplayFloor[]; readonly projector: Projector; readonly ui: number;
  readonly plan: boolean; readonly exploded: number; readonly selectedFloorKey: string;
  readonly selectedRoomId: string | null; readonly overlay: string;
  readonly onSelect: (room: SchematicRoom) => void;
}
/** Hit regions are the source-derived interior polygons, not label circles or invented room rectangles. */
export function RoomRegions(p: Props) {
  return <g className="source-room-regions" aria-label="Rooms in the provisional scanned floor plans">
    {p.regions.slice(0, 32).flatMap(region => {
      const room = p.rooms.find(r => r.id === region.roomId && r.floorKey === region.floorKey && r.packagePlaceKey === region.packagePlaceKey
        && r.packagePlaceUuid === region.packagePlaceUuid && r.receiptId === region.receiptId && r.receiptSha256 === region.receiptSha256
        && region.sourceAnchorIds.length > 0 && region.sourceAnchorIds.every(id => r.sourceAnchorIds.includes(id)));
      const floor = p.floors.find(f => f.key === region.floorKey);
      if (!room || !floor || p.plan && floor.key !== p.selectedFloorKey || region.polygons.length > 16) return [];
      const z = (floor.surfaceY-floor.minY)*floor.scale + .005 + (p.plan ? 0 : floor.index * (3.2 + p.exploded * 3.4));
      const polygons = region.polygons.filter(poly => poly.length >= 3 && poly.length <= 512 && poly.every(v => v.length === 2 && v.every(n => Number.isFinite(n) && n >= 0 && n <= 1)));
      if (polygons.length !== region.polygons.length || !polygons.length) return [];
      const selected = p.selectedRoomId === room.id;
      const opacity = !p.plan && p.exploded > .8 && floor.key !== p.selectedFloorKey ? .4 : 1;
      const point = (v: readonly [number, number], height = z) => p.projector.p((v[0] - .5) * floor.width, (v[1] - .5) * floor.depth, height);
      const points = (poly: readonly (readonly [number, number])[], height = z) => poly.map(v => point(v, height).join(',')).join(' ');
      return <g key={room.id} className="source-room" role="button" tabIndex={0} aria-label={`Select ${room.label}, ${region.floorKey} room`}
        aria-pressed={selected} onClick={() => p.onSelect(room)}
        onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); event.stopPropagation(); p.onSelect(room); } }}>
        <path className="room-hit-region" d={polygons.map(poly => poly.map((v,i) => `${i ? 'L' : 'M'}${point(v).join(',')}`).join(' ')+' Z').join(' ')} fillRule="evenodd" fill="transparent"
          stroke={selected ? LANTERN_EDGE : 'rgba(30,38,56,.12)'} strokeWidth={selected ? 1.8*p.ui : .6} strokeLinejoin="round" />
        {selected && polygons.map((poly, index) => <g key={`glow-${index}`} pointerEvents="none">
          {poly.map((a, i) => {
            const b = poly[(i + 1) % poly.length]!;
            return <polygon key={i} points={[point(a), point(b), point(b, z + 1.9), point(a, z + 1.9)].map(v => v.join(',')).join(' ')} fill="url(#room-lantern-face)" opacity={.55} />;
          })}
          <polygon points={points(poly, z + 1.9)} fill="none" stroke={LANTERN_EDGE} strokeOpacity={.75} strokeWidth={1.1 * p.ui} />
        </g>)}
        <text className="room-name" transform={`translate(${point([room.xFraction, room.yFraction]).join(' ')}) scale(${p.ui})`} textAnchor="middle" dominantBaseline="middle" fontSize={12} fillOpacity={opacity} pointerEvents="none">{room.label}</text>
        <title>{room.label} · {region.geometryQualification}</title>
      </g>;
    })}
  </g>;
}

export function RoomInspector({ room, region, onClose, actions }: { readonly room: SchematicRoom; readonly region: DisplayRoomRegion; readonly onClose: () => void; readonly actions?: ReactNode }) {
  return <aside className="stage-ui source-room-inspector" aria-label={`${room.label} room details`}>
    <header><h2>{room.label}</h2><button type="button" onClick={onClose} aria-label="Close room details">Close</button></header>
    <p>Room matched to the scanned plan from your confirmed labels.</p>
    <p className="room-boundary-note">Provisional outline from the incomplete scan. Door and window gaps were closed for room selection; review the boundary before relying on it.</p>
    {actions}
    <details><summary>Source and matching</summary><p>Incomplete scan · physical scale and floor alignment unknown.</p>
      <p>{region.geometryQualification}</p>
      <p>Room identity and room outline are separate. This selection creates no native place or physical fixture position.</p>
      <dl><dt>Stable package place</dt><dd>{room.packagePlaceKey}</dd><dt>Source labels</dt><dd>{room.sourceAnchorIds.join(', ')}</dd><dt>Source geometry</dt><dd>{region.sourceGeometryHandles.join(', ')}</dd><dt>Matching receipt</dt><dd>{room.receiptId} · {room.receiptSha256}</dd></dl>
    </details>
  </aside>;
}

