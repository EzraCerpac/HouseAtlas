import { useCallback, useLayoutEffect, useRef, useState } from 'react';
import type { PreparedMesh, Projection } from './geometry';
import { materialGpuResources, RENDER_LIMITS } from './gpu-budget';
import type { AppearanceInput } from './mesh-appearance';
import type { MeshScene } from './mesh-scene';
import { SceneBuildObservation } from './scene-build-observation';

export type { MeshPalette } from './mesh-appearance';
export { materialGpuResources, RENDER_LIMITS } from './gpu-budget';

interface Props extends AppearanceInput {
  readonly meshes: readonly PreparedMesh[];
  readonly projection: Projection;
  readonly hidden: boolean;
  readonly onUnavailable: (message: string) => void;
  /** GPU upload budget for this mesh set; RENDER_LIMITS.uploadBytes unless the host admitted a larger tier. */
  readonly uploadBytes?: number;
  /** A mesh set is on screen: drawn once, and the set it replaced is gone. */
  readonly onShown?: (meshes: readonly PreparedMesh[]) => void;
}

/** Whether this browser offers any 3D drawing API the renderer can use. */
const drawable = () => 'gpu' in navigator || document.createElement('canvas').getContext('webgl2') !== null;

/** A lost GPU device is rebuilt this many times before the view gives up. */
const REBUILDS = 2;

/** Contact shading waits until the camera has been still this long, then fades in over FADE_MS.
 * Frames drawn while the camera moves skip it, so orbiting costs no more than before. */
const SETTLE_MS = 180, FADE_MS = 240;
/** A still view keeps refining its contact shading for at most this long, and
 * skips a refining frame that would end past it, so a slow GPU stops after a
 * few averaged frames instead of drawing for seconds. */
const REFINE_MS = 400;
/** A frame drawn while the view moves should finish on the GPU within this long (30 frames a second). */
const MOVE_BUDGET_MS = 1000 / 30;
/** Moving frames draw this share of each axis's pixels. It starts at full and adapts to the
 * GPU time of moving frames (WebGPU only: WebGL2 has no cheap way to read that time), never
 * below one drawing-buffer pixel per layout pixel. A still view always draws at full resolution.
 * Learned once per page, so a new canvas starts where the last one settled. */
let moveScale = 1;
/** Each adjustment changes the pixel count by about 28%; frame cost is mostly per pixel on phones. */
const MOVE_STEP = 0.85;
/** One moving frame in this many is timed. The GPU queue is drained first, so the time is
 * that frame's own and not the backlog of frames submitted ahead of it. */
const MEASURE_EVERY = 8;
/** A new stage of the scene (mesh-scene.ts STAGES) cross-fades in over this long: a copy
 * of the last frame of the stage before fades out over it. */
const STAGE_FADE_MS = 400;
const reducedMotion = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true;

/** Lays a copy of the frame `canvas` has just drawn over it and fades the copy out.
 * Runs in the task that drew the frame, while the drawing buffer still holds it. */
function fadeOut(canvas: HTMLCanvasElement) {
  const copy = document.createElement('canvas'), context = copy.getContext('2d');
  if (!context || !canvas.parentElement) return;
  copy.width = canvas.width; copy.height = canvas.height;
  try { context.drawImage(canvas, 0, 0); } catch { return; }
  copy.className = 'cifc-canvas cifc-stage-fade'; copy.setAttribute('aria-hidden', 'true');
  canvas.after(copy);
  const done = () => copy.remove();
  copy.animate([{ opacity: 1 }, { opacity: 0 }], { duration: STAGE_FADE_MS, easing: 'ease-out' }).finished.then(done, done);
}

/** The on-device speed check (render-probe.ts) runs once per page, this long after the first model is on screen. */
const PROBE = typeof location !== 'undefined' && new URLSearchParams(location.search).has('render-probe'), PROBE_DELAY_MS = 1500;
/** The page's one check: not yet run, running on some canvas, or reported. */
let probeState: 'idle' | 'running' | 'done' = 'idle';

/** A stable number per prepared mesh set, for the canvas key. */
const meshSets = new WeakMap<readonly PreparedMesh[], number>();
let lastMeshSet = 0;
const meshSetId = (meshes: readonly PreparedMesh[]) => {
  let id = meshSets.get(meshes); if (id === undefined) { id = ++lastMeshSet; meshSets.set(meshes, id); }
  return id;
};

/** Shared-frame orthographic 3D layer, drawn by three.js on WebGPU (WebGL2
 * where WebGPU is unavailable). Draws on demand only; owns and releases every
 * GPU object, listener and frame callback it creates. A new mesh set builds on
 * its own canvas behind the one on screen, which stays until the new scene is
 * drawn, so swapping in a more detailed model never blanks the view. */
export function MeshLayer(props: Props) {
  const [shown, setShown] = useState<readonly PreparedMesh[] | null>(null);
  const wanted = useRef(props.meshes); wanted.current = props.meshes;
  const onShown = useRef(props.onShown); onShown.current = props.onShown;
  const ready = useCallback((meshes: readonly PreparedMesh[]) => {
    if (wanted.current === meshes) { setShown(meshes); onShown.current?.(meshes); }
  }, []);
  const sets = shown !== null && shown !== props.meshes ? [shown, props.meshes] : [props.meshes];
  return <>{sets.map(meshes => <MeshCanvas key={meshSetId(meshes)} {...props} meshes={meshes}
    building={meshes !== (shown ?? meshes)} onReady={ready} />)}</>;
}

function MeshCanvas(props: Props & { readonly building: boolean; readonly onReady: (meshes: readonly PreparedMesh[]) => void }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const latest = useRef(props); latest.current = props;
  const redraw = useRef<(() => void) | null>(null);
  // Each mesh set gets a fresh canvas: a released renderer also releases its context.
  const [rebuilds, setRebuilds] = useState(0);
  const key = `${meshSetId(props.meshes)}:${props.sourceMaterials === true}:${rebuilds}`;
  // Camera moves redraw only; any other presentation change also rewrites the per-mesh state.
  const stale = useRef(true), moved = useRef(false);
  useLayoutEffect(() => { moved.current = true; redraw.current?.(); }, [props.projection, props.hidden]);
  useLayoutEffect(() => { stale.current = true; redraw.current?.(); },
    [props.rules, props.currentFloorId, props.selectedOccurrenceId, props.contextOccurrenceIds, props.tints, props.referenceKeys,
      props.hiddenKeys, props.selectedKeys, props.lifts, props.clips, props.dims, props.ghosts, props.palette, props.sourceColors, props.sourceMaterials, props.sourceDim, props.ambient, props.twoSided, props.shade, props.light, props.pitch, props.pitchKeys, props.site, props.ghostAlpha, props.daylight, props.shelterKeys, props.roomKeys,
      props.glazingKeys, props.emitterKeys, props.surroundings]);
  useLayoutEffect(() => {
    const element = canvas.current; if (!element || props.meshes.length === 0) return;
    const usesMaterials = props.sourceMaterials === true && props.meshes.some(mesh => mesh.sourceMaterial !== undefined);
    let disposed = false, frame: number | null = null, scene: MeshScene | null = null, drawn = false, probing = false, buildMs = 0;
    // Moving frames since the last timed one; whether the next moving frame is timed; whether drawing waits on the GPU queue (and a frame is pending).
    let untimed = 0, timeNext = false, waiting = false, deferred = false;
    let observation: SceneBuildObservation | undefined;
    // The scene builds over several frames; releasing the canvas abandons that build.
    const building = new AbortController();
    // Ready once a frame is drawn (or there is nothing to draw while hidden), so promoting this canvas never shows it empty.
    const ready = () => {
      if (drawn) return;
      drawn = true; latest.current.onReady(props.meshes);
      if (PROBE && probeState !== 'done') setTimeout(() => void probe(performance.now()), PROBE_DELAY_MS);
    };
    // Contact shading strength (0 to 1), the pending settle timer, and when the fade-in began.
    let shading = 0, settle: ReturnType<typeof setTimeout> | null = null, fading: number | null = null;
    // Whether the pending frame only refines the last one, until when refining may go on, and when the last frame was drawn.
    let refineOnly = false, refineUntil = 0, drawnAt = 0;
    const still = () => { settle = null; fading = performance.now(); schedule(); };
    const schedule = (refine = false) => {
      if (!refine) refineOnly = false;
      if (waiting) deferred = true;
      if (disposed || !scene || frame !== null || document.hidden || probing || waiting) return;
      refineOnly = refine;
      frame = requestAnimationFrame(() => { frame = null; try { render(); } catch { fail('The 3D model cannot be rendered.'); } });
    };
    const release = () => {
      if (disposed) return; disposed = true; building.abort();
      if (frame !== null) cancelAnimationFrame(frame); frame = null;
      if (settle !== null) clearTimeout(settle); settle = null;
      if (redraw.current === schedule) redraw.current = null;
      observation?.close(); scene?.dispose(); scene = null;
    };
    const fail = (message: string) => { const live = !disposed; release(); if (live) latest.current.onUnavailable(message); };
    const lost = (message: string) => {
      if (disposed) return;
      if (rebuilds < REBUILDS) { release(); setRebuilds(count => count + 1); } else fail(message);
    };
    const visibility = () => { if (!document.hidden) schedule(); };
    /** The drawing buffer: layout size at the device's pixel ratio up to 2 (times `scale`, never below 1), within RENDER_LIMITS.pixels. */
    const size = (scale = 1): [number, number] => {
      const dpr = Math.max(Math.min(1, window.devicePixelRatio || 1), Math.min(window.devicePixelRatio || 1, 2) * scale);
      const w = Math.max(1, Math.round(element.clientWidth * dpr)), h = Math.max(1, Math.round(element.clientHeight * dpr));
      const fit = Math.min(1, Math.sqrt(RENDER_LIMITS.pixels / (w * h)));
      return [Math.max(1, Math.floor(w * fit)), Math.max(1, Math.floor(h * fit))];
    };
    /** The speed check takes over the canvas while it runs; normal drawing resumes after. */
    const probe = async (shownAt: number) => {
      // A canvas replaced meanwhile leaves the check to its successor; a hidden one (Plan, or a set still swapping in),
      // or one whose predecessor is still checking, waits until it can run.
      if (probeState === 'done' || disposed || !scene) return;
      if (probeState === 'running' || latest.current.hidden || latest.current.building || !scene.complete() && !scene.failed()) { setTimeout(() => void probe(shownAt), PROBE_DELAY_MS); return; }
      probeState = 'running';
      if (frame !== null) cancelAnimationFrame(frame); frame = null;
      probing = true;
      try {
        const { runRenderProbe, showProbeReport } = await import('./render-probe');
        const [width, height] = size();
        if (!disposed && scene) {
          const report = await runRenderProbe({ scene, meshes: props.meshes, projection: latest.current.projection, width, height,
            shownAt: shownAt - PROBE_DELAY_MS, buildMs, observation: observation?.snapshot(), stages: scene.timeline, signal: building.signal });
          if (!disposed) { probeState = 'done'; showProbeReport(report); }
        }
      } catch {
        // A check that cannot finish leaves the view as it was; one cut short by a released canvas passes to its successor.
      }
      if (probeState === 'running') probeState = disposed ? 'idle' : 'done';
      probing = false; moved.current = true; schedule();
    };
    const render = () => {
      if (disposed || !scene) return;
      const p = latest.current;
      // A set swapping in is shown only once every stage is drawn, so a more detailed
      // model never replaces a finished view with its shell; one that cannot finish is
      // given up, and its owner keeps the view on screen. A shown view that cannot finish
      // keeps the stages it has.
      if (p.building) {
        while (scene.pending()) scene.advance();
        if (scene.failed() && !scene.complete()) { fail('The 3D model cannot be rendered.'); return; }
        if (!scene.complete()) return;
      }
      if (p.hidden) { ready(); return; }
      // A refining frame is expected to cost about what the last one did.
      const now = performance.now(), refine = refineOnly; refineOnly = false;
      if (!refine) refineUntil = now + REFINE_MS; else if (2 * now - drawnAt > refineUntil) return;
      if (moved.current) { moved.current = false; shading = 0; fading = null; if (settle !== null) clearTimeout(settle); settle = null; }
      if (fading !== null) {
        shading = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ? 1 : Math.min(1, (performance.now() - fading) / FADE_MS);
        if (shading < 1) schedule(); else fading = null;
      } else if (shading < 1 && settle === null) settle = setTimeout(still, SETTLE_MS);
      // Frames without contact shading are the moving ones (and the moment before the view settles).
      const moving = shading <= 0, [w, h] = size(moving ? moveScale : 1);
      // A newly prepared stage: the frame as it was, copied and faded out over the first frame
      // of the new stage. Contact shading fades in by its own strength instead.
      const next = scene.pending();
      if (next !== null) {
        if (next !== 'shading' && drawn && !reducedMotion()) {
          scene.render(p.projection, stale.current ? p : null, w, h, shading); stale.current = false; fadeOut(element);
        }
        scene.advance();
        if (next === 'shading' && shading > 0) { shading = 0; fading = performance.now(); }
        if (scene.pending() !== null || fading !== null) schedule();
      }
      if (element.dataset.stage !== scene.stage) element.dataset.stage = scene.stage;
      // While the view is still, each further frame averages the contact shading down to a clean result.
      const finishFirstDraw = observation?.firstDraw();
      if (scene.render(p.projection, stale.current ? p : null, w, h, shading)) schedule(true);
      // A shaded frame drawn after a drain queues work of its own, so the pending sample waits for the next drain.
      if (!moving) timeNext = false;
      else if (scene.backend === 'webgpu') {
        const timed = timeNext; timeNext = false;
        if (timed || ++untimed >= MEASURE_EVERY) {
          untimed = 0; waiting = true;
          // Either drain the queue ahead of the next moving frame, or time this one on a drained queue.
          void scene.finished().then(() => {
            if (timed) {
              const spent = performance.now() - now, floor = 1 / Math.min(window.devicePixelRatio || 1, 2);
              if (spent > MOVE_BUDGET_MS * 1.1) moveScale = Math.max(floor, moveScale * MOVE_STEP);
              else if (spent < MOVE_BUDGET_MS * 0.6) moveScale = Math.min(1, moveScale / MOVE_STEP);
            } else timeNext = true;
          }, () => undefined).finally(() => { waiting = false; if (deferred) { deferred = false; schedule(); } });
        }
      }
      finishFirstDraw?.();
      drawnAt = now; stale.current = false; ready();
    };
    document.addEventListener('visibilitychange', visibility);
    const resize = new ResizeObserver(() => schedule()); resize.observe(element);
    try { materialGpuResources(props.meshes, usesMaterials, props.uploadBytes); } catch { fail('The 3D model cannot be rendered.'); }
    if (!disposed) {
      const buildStart = performance.now();
      observation = PROBE ? new SceneBuildObservation() : undefined;
      observation?.phase('module-import');
      void import('./mesh-scene').then(({ createMeshScene }) => createMeshScene(element, props.meshes, usesMaterials, lost, building.signal, observation, () => schedule())).then(created => {
        if (disposed) { created.dispose(); return; }
        buildMs = performance.now() - buildStart; // the shell, the first stage drawn
        observation?.finishBuild();
        scene = created; stale.current = true; element.dataset.renderer = created.backend;
        redraw.current = schedule; schedule();
      }, () => fail(drawable() ? 'The 3D model cannot be rendered.' : 'This browser cannot draw the 3D model. Update the browser to view it.'));
    }
    return () => { release(); resize.disconnect(); document.removeEventListener('visibilitychange', visibility); };
    // The GPU scene is owned by one prepared mesh set; other props redraw only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  // A canvas still building keeps its layout size, so it draws at full size before it is shown.
  return <canvas key={key} ref={canvas} className="cifc-canvas" hidden={props.hidden} aria-hidden="true"
    style={props.building ? { visibility: 'hidden' } : undefined} />;
}
