// Generated 3D frame benchmark: a fictional house of boxes, sized like the
// served overview (about 1,900 primitives, 260k triangles), drawn by MeshLayer
// while the camera turns. Reports CPU time per frame and GPU API calls per
// frame. Synthetic geometry only; it qualifies no model, device or deployment.
import { useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { MeshLayer } from '../../src/lantern/canonical-ifc/MeshLayer';
import { makeProjection, prepareMeshes, type MeshInput } from '../../src/lantern/canonical-ifc/geometry';

const params = new URLSearchParams(location.search);
const FRAMES = Number(params.get('frames') ?? 120), SELECT = params.has('select');
const RULES = { visibleFloors: 'all', clipY: null } as const, CONTEXT = ['room-L1-12'], TINTS = new Map([['room-L0-4', '#9FC5E8']]);
const LIGHT = [-.38, .84, .39] as const;
const PIECES = Number(params.get('pieces') ?? 1882);

/** Calls per frame, counted on the prototypes so every context is included. */
const calls = { gl: 0, gpu: 0 };
for (const proto of [globalThis.WebGLRenderingContext?.prototype, globalThis.WebGL2RenderingContext?.prototype]) {
  if (!proto) continue;
  for (const name of Object.getOwnPropertyNames(proto)) {
    const d = Object.getOwnPropertyDescriptor(proto, name);
    if (!d || typeof d.value !== 'function' || name === 'constructor') continue;
    // getError forces a round trip to the GPU process; skip it so frames measure submission, not the software GPU.
    const fn = d.value; Object.defineProperty(proto, name, { ...d, value: name === 'getError' ? function () { calls.gl++; return 0; }
      : function (this: unknown, ...a: unknown[]) { calls.gl++; return fn.apply(this, a); } });
  }
}
for (const cls of ['GPURenderPassEncoder', 'GPUCommandEncoder', 'GPUQueue', 'GPURenderBundleEncoder'] as const) {
  const proto = (globalThis as Record<string, { prototype: object } | undefined>)[cls]?.prototype; if (!proto) continue;
  for (const name of Object.getOwnPropertyNames(proto)) {
    const d = Object.getOwnPropertyDescriptor(proto, name);
    if (!d || typeof d.value !== 'function' || name === 'constructor') continue;
    const fn = d.value; Object.defineProperty(proto, name, { ...d, value: function (this: unknown, ...a: unknown[]) { calls.gpu++; return fn.apply(this, a); } });
  }
}
const frames: { ms: number; gl: number; gpu: number }[] = [];
const raf = window.requestAnimationFrame.bind(window);
window.requestAnimationFrame = callback => raf(time => {
  const gl = calls.gl, gpu = calls.gpu, t = performance.now();
  callback(time);
  if (calls.gl > gl || calls.gpu > gpu) frames.push({ ms: performance.now() - t, gl: calls.gl - gl, gpu: calls.gpu - gpu });
});

/** A box split into n × n quads per face, wound outward. */
function box(min: [number, number, number], max: [number, number, number], n: number) {
  const positions: number[] = [], indices: number[] = [];
  const faces: [number, number, number, 1 | -1][] = [[0, 1, 2, 1], [0, 1, 2, -1], [1, 2, 0, 1], [1, 2, 0, -1], [2, 0, 1, 1], [2, 0, 1, -1]];
  for (const [a, b, c, sign] of faces) {
    const start = positions.length / 3;
    for (let i = 0; i <= n; i++) for (let j = 0; j <= n; j++) {
      const p = [0, 0, 0]; p[a] = min[a] + (max[a] - min[a]) * i / n; p[b] = min[b] + (max[b] - min[b]) * j / n; p[c] = sign > 0 ? max[c] : min[c];
      positions.push(...p);
    }
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
      const q = start + i * (n + 1) + j, r = q + n + 1;
      if (sign > 0) indices.push(q, r, q + 1, q + 1, r, r + 1); else indices.push(q, q + 1, r, q + 1, r + 1, r);
    }
  }
  return { positions: new Float32Array(positions), indices: new Uint32Array(indices) };
}

function house(): MeshInput[] {
  const meshes: MeshInput[] = [], floors = ['L0', 'L1', 'L2'], site = Math.round(PIECES * .05), per = Math.floor((PIECES - site) / 3);
  floors.forEach((floorId, f) => {
    const columns = Math.ceil(Math.sqrt(per * 1.4));
    for (let i = 0; i < per; i++) {
      const x = (i % columns) * .62, z = Math.floor(i / columns) * .62, y = f * 2.9, h = i % 7 === 0 ? 2.6 : .3 + (i % 5) * .35;
      const { positions, indices } = box([x, y, z], [x + .5, y + h, z + .5], i % 2 ? 3 : 4);
      meshes.push({ meshKey: `${floorId}-${i}`, floorId, occurrenceId: i % 4 === 0 ? `room-${floorId}-${i % 40}` : null, positions, indices,
        ...(i % 3 === 0 ? { sourceBaseColor: [.5, .32, .2, 1] as const } : {}) });
    }
  });
  for (let i = 0; i < site; i++) {
    const { positions, indices } = box([-6 + (i % 10) * 3, -.2, -6 + Math.floor(i / 10) * 3], [-3.2 + (i % 10) * 3, 0, -3.2 + Math.floor(i / 10) * 3], 4);
    meshes.push({ meshKey: `site-${i}`, floorId: null, occurrenceId: null, positions, indices });
  }
  return meshes;
}

function Bench() {
  const meshes = useMemo(() => prepareMeshes(house()), []);
  const bounds = useMemo(() => {
    const min: [number, number, number] = [Infinity, Infinity, Infinity], max: [number, number, number] = [-Infinity, -Infinity, -Infinity];
    for (const m of meshes) for (let a = 0; a < 3; a++) { min[a] = Math.min(min[a]!, m.bounds.min[a]!); max[a] = Math.max(max[a]!, m.bounds.max[a]!); }
    return { min, max };
  }, [meshes]);
  const [yaw, setYaw] = useState(30), [failure, setFailure] = useState('');
  // With ?select, every frame also moves the selection, so every mesh's state is rewritten and uploaded.
  const selected = SELECT ? `room-L1-${Math.round(yaw / 1.5) % 40}` : 'room-L1-8';
  const size = { width: window.innerWidth, height: window.innerHeight };
  const projection = useMemo(() => makeProjection({ yaw, pitch: 35, zoom: Number(params.get('zoom') ?? 2.2), panX: 0, panY: 0 }, bounds, size, 0), [yaw, bounds, size.width, size.height]);
  const look = useMemo(() => {
    const site = new Set(meshes.filter(m => m.meshKey.startsWith('site')).map(m => m.meshKey));
    const roofs = new Set(meshes.filter(m => m.floorId === 'L2' && m.meshKey.endsWith('7')).map(m => m.meshKey));
    const dims = new Map(meshes.map(m => [m.meshKey, m.floorId === 'L1' ? 0 : .5]));
    const ghosts = new Map(meshes.filter(m => m.floorId === 'L2').map(m => [m.meshKey, null]));
    const hiddenKeys = new Set(ghosts.keys());
    const clips = new Map(meshes.filter(m => m.floorId === 'L1').map(m => [m.meshKey, 4.3]));
    return { site: { keys: site, tone: '#DDE3D3' }, pitchKeys: roofs, dims, ghosts, hiddenKeys, clips };
  }, [meshes]);
  useEffect(() => {
    // Measure FRAMES drawn frames after the first one, however slowly the GPU presents them.
    let started = false; const id = setInterval(() => {
      if (frames.length === 0) return;
      if (!started) { started = true; frames.length = 0; }
      if (frames.length < FRAMES) { setYaw(value => value + 1.5); return; }
      clearInterval(id);
      const sorted = frames.map(f => f.ms).sort((a, b) => a - b), at = (q: number) => sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))]!;
      (window as unknown as { benchDone: unknown }).benchDone = { frames: frames.length, median: at(.5), p95: at(.95),
        gl: Math.round(frames.reduce((s, f) => s + f.gl, 0) / frames.length), gpu: Math.round(frames.reduce((s, f) => s + f.gpu, 0) / frames.length),
        renderer: document.querySelector('canvas')?.dataset.renderer, triangles: meshes.reduce((s, m) => s + m.triangles, 0), pieces: meshes.length };
    }, 40);
    return () => clearInterval(id);
  }, [meshes]);
  return <><output>{failure}</output>
    <MeshLayer meshes={meshes} projection={projection} rules={RULES} currentFloorId="L1" selectedOccurrenceId={selected}
      contextOccurrenceIds={CONTEXT} tints={TINTS} hidden={false} sourceColors sourceDim={.6} ambient={.55}
      twoSided shade="#5F6B7E" light={LIGHT} pitch="#C9A27E" ghostAlpha={.2} {...look} onUnavailable={setFailure} /></>;
}
createRoot(document.getElementById('root')!).render(<Bench />);
