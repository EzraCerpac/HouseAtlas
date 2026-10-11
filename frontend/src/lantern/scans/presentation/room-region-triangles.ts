/** Ear clipping for admitted simple display rings. No source coordinates or physical transform are changed. */
export function triangulateRoomRing(ring: readonly (readonly [number, number])[]): readonly number[] {
  if (ring.length < 3 || ring.length > 512) throw new Error('Room ring bound');
  const cross = (a: number, b: number, c: number) => {
    const x = ring[a]!, y = ring[b]!, z = ring[c]!;
    return (y[0]-x[0])*(z[1]-x[1])-(y[1]-x[1])*(z[0]-x[0]);
  };
  const area = ring.reduce((sum,a,i) => { const b=ring[(i+1)%ring.length]!; return sum+a[0]*b[1]-b[0]*a[1]; },0);
  if (!Number.isFinite(area) || Math.abs(area)<1e-10) throw new Error('Room ring area');
  const ids = ring.map((_,i)=>i); if (area<0) ids.reverse();
  const result: number[] = []; let work=0;
  while(ids.length>3) {
    let clipped=false;
    for(let i=0;i<ids.length;i++) {
      if(++work>512*512) throw new Error('Room triangulation bound');
      const a=ids[(i+ids.length-1)%ids.length]!,b=ids[i]!,c=ids[(i+1)%ids.length]!;
      if(cross(a,b,c)<=1e-12) continue;
      if(ids.some(p=>p!==a&&p!==b&&p!==c&&cross(a,b,p)>=-1e-12&&cross(b,c,p)>=-1e-12&&cross(c,a,p)>=-1e-12)) continue;
      result.push(a,b,c); ids.splice(i,1); clipped=true; break;
    }
    if(!clipped) throw new Error('Unsupported room ring');
  }
  result.push(...ids); return result;
}
