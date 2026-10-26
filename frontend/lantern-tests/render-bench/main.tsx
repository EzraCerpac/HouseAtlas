// Generated 3D frame benchmark: a fictional house of boxes, sized like the
// served overview (about 1,900 primitives, 260k triangles), drawn by MeshLayer
// while the camera turns. Reports CPU time per frame and GPU API calls per
// frame. Synthetic geometry only; it qualifies no model, device or deployment.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { MeshLayer } from '../../src/lantern/canonical-ifc/MeshLayer';
import { makeProjection, prepareMeshes, type MeshInput } from '../../src/lantern/canonical-ifc/geometry';
import { GlbFormatError } from '../../src/lantern/canonical-ifc/glb-preflight';
import { loadStandardGlb } from '../../src/lantern/canonical-ifc/standard-glb';
import { loadStandardGlbInWorker } from '../../src/lantern/canonical-ifc/standard-glb-thread';
import { sha256OffThread } from '../../integration/sha256-thread';
import { BufferGeometry } from 'three/webgpu';
import { box as sampleBox, buildGlb } from '../canonical-ifc-visual/standard-glb-sample';

const params = new URLSearchParams(location.search);
const FRAMES = Number(params.get('frames') ?? 120), SELECT = params.has('select');
const RULES = { visibleFloors: 'all', clipY: null } as const, CONTEXT = ['room-L1-12'], TINTS = new Map([['room-L0-4', '#9FC5E8']]);
const LIGHT = [-.38, .84, .39] as const;
const PIECES = Number(params.get('pieces') ?? 1882);

/** Calls per frame, counted on the prototypes so every context is included. */
const calls = { gl: 0, gpu: 0 };
/** WebGL draw calls per canvas, so a swap can tell which canvas drew. */
const canvasDraws = new WeakMap<object, number>();
for (const proto of [globalThis.WebGLRenderingContext?.prototype, globalThis.WebGL2RenderingContext?.prototype]) {
  if (!proto) continue;
  for (const name of Object.getOwnPropertyNames(proto)) {
    const d = Object.getOwnPropertyDescriptor(proto, name);
    if (!d || typeof d.value !== 'function' || name === 'constructor') continue;
    // getError forces a round trip to the GPU process; skip it so frames measure submission, not the software GPU.
    const fn = d.value; Object.defineProperty(proto, name, { ...d, value: name === 'getError' ? function () { calls.gl++; return 0; }
      : name.startsWith('draw') ? function (this: WebGLRenderingContext, ...a: unknown[]) {
        calls.gl++; canvasDraws.set(this.canvas, (canvasDraws.get(this.canvas) ?? 0) + 1); return fn.apply(this, a);
      } : function (this: unknown, ...a: unknown[]) { calls.gl++; return fn.apply(this, a); } });
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
/** three.js walks every vertex of a geometry that has no bounding sphere on its
 * first frame; the scene supplies them for the model, so a swap should walk only
 * the few vertices of three's own full-screen passes. */
const spheres = { vertices: 0 };
const computeSphere = BufferGeometry.prototype.computeBoundingSphere;
BufferGeometry.prototype.computeBoundingSphere = function (this: BufferGeometry) {
  spheres.vertices += this.getAttribute('position')?.count ?? 0; return computeSphere.call(this);
};
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

function house(pieces: number): MeshInput[] {
  const meshes: MeshInput[] = [], floors = ['L0', 'L1', 'L2'], site = Math.round(pieces * .05), per = Math.floor((pieces - site) / 3);
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

/** Swaps in a second prepared set, as a Full model replaces Light, and records
 * the fewest canvases on screen at any moment until the new set is shown alone,
 * how many WebGL draws the new canvas made before the old one went, how many
 * frames the page drew meanwhile, its longest task, and any bounding sphere computed. */
function watchSwap(root: HTMLElement, into: object = {}) {
  const visible = () => [...root.querySelectorAll('canvas')].filter(canvas => !canvas.hidden && canvas.style.visibility !== 'hidden').length;
  const old = root.querySelector('canvas');
  let next: HTMLCanvasElement | null = null;
  const report = Object.assign(into, { fewestVisible: visible(), mostCanvases: root.querySelectorAll('canvas').length, newDrawsWhenShown: -1, done: false,
    framesMeanwhile: 0, longestTaskMs: 0, sphereVertices: 0 });
  const sphereStart = spheres.vertices;
  const tick = () => { if (report.done) return; report.framesMeanwhile++; raf(tick); }; raf(tick);
  const tasks = new PerformanceObserver(list => { for (const entry of list.getEntries()) report.longestTaskMs = Math.max(report.longestTaskMs, Math.round(entry.duration)); });
  try { tasks.observe({ type: 'longtask' }); } catch { /* no long task timing in this browser */ }
  const observer = new MutationObserver(() => {
    const canvases = [...root.querySelectorAll('canvas')];
    next ??= canvases.find(canvas => canvas !== old) ?? null;
    report.fewestVisible = Math.min(report.fewestVisible, visible());
    report.mostCanvases = Math.max(report.mostCanvases, canvases.length);
    if (report.mostCanvases > 1 && canvases.length === 1 && visible() === 1) {
      // WebGL draws only; WebGPU submissions carry no canvas.
      report.newDrawsWhenShown = next ? canvasDraws.get(next) ?? 0 : -1; report.done = true; observer.disconnect();
      for (const entry of tasks.takeRecords()) report.longestTaskMs = Math.max(report.longestTaskMs, Math.round(entry.duration));
      tasks.disconnect(); report.sphereVertices = spheres.vertices - sphereStart;
    }
  });
  observer.observe(root, { subtree: true, childList: true, attributes: true });
  return report;
}

/** The same generated GLB loaded on this thread and in the worker: identical
 * output, the bytes moved to the worker, and its refusals and cancellation
 * reach the caller as they would from loadStandardGlb. */
async function checkWorker() {
  const count = 24, signal = new AbortController().signal;
  const bytes = () => buildGlb({ roots: Array.from({ length: count }, (_, i) => i),
    meshes: Array.from({ length: count }, (_, i) => sampleBox([i, 0, 0], [i + .8, 1 + i % 3, .8])),
    nodes: Array.from({ length: count }, (_, i) => ({ mesh: i, translation: [0, i % 2, (i % 3) * .5] as const })) });
  const here = await loadStandardGlb(bytes(), 'atlas', signal);
  const sent = bytes(); let admitted = 0;
  const there = await loadStandardGlbInWorker(sent, 'atlas', signal, admission => { admitted = admission.work.triangles; });
  const refusal = new Error('refused'), reason = new Error('withdrawn'), controller = new AbortController();
  const refused = await loadStandardGlbInWorker(bytes(), 'atlas', signal, () => { throw refusal; }).then(() => 'loaded', error => error === refusal ? 'refused' : String(error));
  const pending = loadStandardGlbInWorker(bytes(), 'atlas', controller.signal); controller.abort(reason);
  const aborted = await pending.then(() => 'loaded', error => error === reason ? 'aborted' : String(error));
  const broken = bytes(); new DataView(broken.buffer).setUint32(4, 1, true);
  const malformed = await loadStandardGlbInWorker(broken, 'atlas', signal).then(() => 'loaded', error => error instanceof GlbFormatError ? error.stage : String(error));
  const plain = (glb: typeof here) => JSON.stringify(glb, (_, value: unknown) => ArrayBuffer.isView(value) ? Array.from(value as Float32Array) : value);
  return { same: plain(here) === plain(there), moved: sent.byteLength === 0, admitted: admitted === here.counts.triangles,
    meshes: there.meshes.length, refused, aborted, malformed };
}

/** The Full model's digest in its worker: the same SHA-256 as this thread,
 * the bytes moved there and back unchanged, and cancellation reaching the caller. */
async function checkDigestWorker() {
  const signal = new AbortController().signal, bytes = new Uint8Array(24 * 1024 * 1024);
  for (let at = 0, seed = 1; at < bytes.length; at++) { seed = (seed * 1103515245 + 12345) >>> 0; bytes[at] = seed >>> 24; }
  const kept = bytes.slice(), here = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
  const there = await sha256OffThread(bytes, signal);
  const reason = new Error('withdrawn'), controller = new AbortController();
  const pending = sha256OffThread(kept.slice(), controller.signal); controller.abort(reason);
  const aborted = await pending.then(() => 'hashed', error => error === reason ? 'aborted' : String(error));
  return { same: there.digest.every((value, at) => value === here[at]) && there.digest.length === 32,
    unchanged: there.bytes.length === kept.length && there.bytes.every((value, at) => value === kept[at]), moved: bytes.byteLength === 0, aborted };
}

function Bench() {
  // Each generation is a new prepared set of the same house, or of a larger one,
  // prepared before the swap starts, as the Full model arrives prepared from its worker.
  const [{ meshes, generation }, setSet] = useState(() => ({ meshes: prepareMeshes(house(PIECES)), generation: 0 }));
  const generations = useMemo(() => new WeakMap<object, number>(), []); generations.set(meshes, generation);
  const onShown = useCallback((set: readonly object[]) => {
    const log = (window as unknown as { shownSets?: number[] }); (log.shownSets ??= []).push(generations.get(set) ?? -1);
  }, [generations]);
  useEffect(() => {
    (window as unknown as { swap: (pieces?: number) => unknown }).swap = pieces => {
      // Prepared in this task; the swap is watched from the next one, as a worker's result arrives.
      const next = prepareMeshes(house(pieces ?? PIECES)), report = { done: false };
      setTimeout(() => { watchSwap(document.getElementById('root')!, report); setSet(current => ({ meshes: next, generation: current.generation + 1 })); });
      return report;
    };
    (window as unknown as { checkWorker: typeof checkWorker }).checkWorker = checkWorker;
    (window as unknown as { checkDigestWorker: typeof checkDigestWorker }).checkDigestWorker = checkDigestWorker;
  }, []);
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
    // Measured once, on the first set.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return <><output>{failure}</output>
    <MeshLayer meshes={meshes} projection={projection} rules={RULES} currentFloorId="L1" selectedOccurrenceId={selected}
      contextOccurrenceIds={CONTEXT} tints={TINTS} hidden={false} sourceColors sourceDim={.6} ambient={.55}
      twoSided shade="#5F6B7E" light={LIGHT} pitch="#C9A27E" ghostAlpha={.2} {...look} onUnavailable={setFailure} onShown={onShown} /></>;
}
createRoot(document.getElementById('root')!).render(<Bench />);
