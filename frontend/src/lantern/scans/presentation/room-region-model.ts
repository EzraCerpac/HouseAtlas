import type { DisplayRoomRegion, SchematicRoom } from './types';

/** One identity/provenance fence for hits, highlights and details. Display geometry is separate from place identity. */
export function regionMatchesRoom(region: DisplayRoomRegion, room: SchematicRoom): boolean {
  return region.roomId === room.id && region.floorKey === room.floorKey && region.packagePlaceKey === room.packagePlaceKey
    && region.packagePlaceUuid === room.packagePlaceUuid && region.receiptId === room.receiptId && region.receiptSha256 === room.receiptSha256
    && /^[a-f0-9]{64}$/.test(region.receiptSha256) && region.sourceAnchorIds.length > 0 && region.sourceAnchorIds.length <= 32
    && new Set(region.sourceAnchorIds).size === region.sourceAnchorIds.length && region.sourceAnchorIds.every(id => room.sourceAnchorIds.includes(id));
}

export function admittedRoomRegions(regions: readonly DisplayRoomRegion[], rooms: readonly SchematicRoom[]): readonly DisplayRoomRegion[] {
  if (regions.length > 32 || rooms.length > 32 || new Set(rooms.map(room => room.id)).size !== rooms.length) return [];
  let vertices = 0;
  const result: DisplayRoomRegion[] = [];
  for (const region of regions) {
    const matchingRooms = rooms.filter(room => regionMatchesRoom(region, room));
    if (matchingRooms.length !== 1 || regions.filter(r => r.roomId === region.roomId).length !== 1
      || !region.geometryQualification || region.geometryQualification.length > 2048 || !region.sourceGeometryHandles.length
      || region.sourceGeometryHandles.length > 256 || !region.polygons.length || region.polygons.length > 16) continue;
    let valid = true;
    for (const poly of region.polygons) {
      vertices += poly.length;
      if (vertices > 8192) return [];
      if (poly.length < 3 || poly.length > 512 || !poly.every(v => v.length === 2 && v.every(n => Number.isFinite(n) && n >= 0 && n <= 1))) { valid = false; break; }
      let twiceArea = 0;
      for (let i = 0; i < poly.length; i++) { const a = poly[i]!, b = poly[(i + 1) % poly.length]!; twiceArea += a[0] * b[1] - a[1] * b[0]; }
      if (Math.abs(twiceArea) < 1e-8 || !simpleRing(poly)) { valid = false; break; }
    }
    if (valid) result.push(region);
  }
  return result;
}

type Point = readonly [number, number];
function simpleRing(poly: readonly Point[]): boolean {
  const cross = (a: Point, b: Point, c: Point) => (b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]);
  const on = (a: Point, b: Point, p: Point) => Math.abs(cross(a,b,p)) < 1e-12 && p[0]>=Math.min(a[0],b[0])-1e-12 && p[0]<=Math.max(a[0],b[0])+1e-12 && p[1]>=Math.min(a[1],b[1])-1e-12 && p[1]<=Math.max(a[1],b[1])+1e-12;
  for (let i=0;i<poly.length;i++) {
    const a=poly[i]!,b=poly[(i+1)%poly.length]!;
    if (Math.hypot(a[0]-b[0],a[1]-b[1])<1e-12) return false;
    for (let j=i+1;j<poly.length;j++) {
      if (j===i+1 || i===0 && j===poly.length-1) continue;
      const c=poly[j]!,d=poly[(j+1)%poly.length]!;
      if (cross(a,b,c)*cross(a,b,d)<0 && cross(c,d,a)*cross(c,d,b)<0 || on(a,b,c) || on(a,b,d) || on(c,d,a) || on(c,d,b)) return false;
    }
  }
  return true;
}
