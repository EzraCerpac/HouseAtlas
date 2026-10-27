import { useCallback, useLayoutEffect, useRef, useState } from 'react';
import type { PreparedMesh, Projection } from './geometry';
import { materialGpuResources, RENDER_LIMITS } from './gpu-budget';
import type { AppearanceInput } from './mesh-appearance';
import type { MeshScene } from './mesh-scene';

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
/** The on-device speed check (render-probe.ts) runs once per page, this long after the first model is on screen. */
const PROBE = typeof location !== 'undefined' && new URLSearchParams(location.search).has('render-probe'), PROBE_DELAY_MS = 1500;
let probed = false;

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
    // The scene builds over several frames; releasing the canvas abandons that build.
    const building = new AbortController();
    // Ready once a frame is drawn (or there is nothing to draw while hidden), so promoting this canvas never shows it empty.
    const ready = () => {
      if (drawn) return;
      drawn = true; latest.current.onReady(props.meshes);
      if (PROBE && !probed) { probed = true; setTimeout(() => void probe(performance.now()), PROBE_DELAY_MS); }
    };
    // Contact shading strength (0 to 1), the pending settle timer, and when the fade-in began.
    let shading = 0, settle: ReturnType<typeof setTimeout> | null = null, fading: number | null = null;
    // Whether the pending frame only refines the last one, until when refining may go on, and when the last frame was drawn.
    let refineOnly = false, refineUntil = 0, drawnAt = 0;
    const still = () => { settle = null; fading = performance.now(); schedule(); };
    const schedule = (refine = false) => {
      if (!refine) refineOnly = false;
      if (disposed || !scene || frame !== null || document.hidden || probing) return;
      refineOnly = refine;
      frame = requestAnimationFrame(() => { frame = null; try { render(); } catch { fail('The 3D model cannot be rendered.'); } });
    };
    const release = () => {
      if (disposed) return; disposed = true; building.abort();
      if (frame !== null) cancelAnimationFrame(frame); frame = null;
      if (settle !== null) clearTimeout(settle); settle = null;
      if (redraw.current === schedule) redraw.current = null;
      scene?.dispose(); scene = null;
    };
    const fail = (message: string) => { const live = !disposed; release(); if (live) latest.current.onUnavailable(message); };
    const lost = (message: string) => {
      if (disposed) return;
      if (rebuilds < REBUILDS) { release(); setRebuilds(count => count + 1); } else fail(message);
    };
    const visibility = () => { if (!document.hidden) schedule(); };
    /** The drawing buffer: layout size at the device's pixel ratio up to 2, within RENDER_LIMITS.pixels. */
    const size = (): [number, number] => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const w = Math.max(1, Math.round(element.clientWidth * dpr)), h = Math.max(1, Math.round(element.clientHeight * dpr));
      const fit = Math.min(1, Math.sqrt(RENDER_LIMITS.pixels / (w * h)));
      return [Math.max(1, Math.floor(w * fit)), Math.max(1, Math.floor(h * fit))];
    };
    /** The speed check takes over the canvas while it runs; normal drawing resumes after. */
    const probe = async (shownAt: number) => {
      if (disposed || !scene || latest.current.hidden) return;
      if (frame !== null) cancelAnimationFrame(frame); frame = null;
      probing = true;
      try {
        const { runRenderProbe, showProbeReport } = await import('./render-probe');
        const [width, height] = size();
        if (!disposed && scene) showProbeReport(await runRenderProbe({ scene, meshes: props.meshes, projection: latest.current.projection, width, height, shownAt: shownAt - PROBE_DELAY_MS, buildMs }));
      } catch { /* A check that cannot finish leaves the view as it was. */ }
      probing = false; moved.current = true; schedule();
    };
    const render = () => {
      if (disposed || !scene) return;
      const p = latest.current; if (p.hidden) { ready(); return; }
      // A refining frame is expected to cost about what the last one did.
      const now = performance.now(), refine = refineOnly; refineOnly = false;
      if (!refine) refineUntil = now + REFINE_MS; else if (2 * now - drawnAt > refineUntil) return;
      const [w, h] = size();
      if (moved.current) { moved.current = false; shading = 0; fading = null; if (settle !== null) clearTimeout(settle); settle = null; }
      if (fading !== null) {
        shading = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ? 1 : Math.min(1, (performance.now() - fading) / FADE_MS);
        if (shading < 1) schedule(); else fading = null;
      } else if (shading < 1 && settle === null) settle = setTimeout(still, SETTLE_MS);
      // While the view is still, each further frame averages the contact shading down to a clean result.
      if (scene.render(p.projection, stale.current ? p : null, w, h, shading)) schedule(true);
      drawnAt = now; stale.current = false; ready();
    };
    document.addEventListener('visibilitychange', visibility);
    const resize = new ResizeObserver(() => schedule()); resize.observe(element);
    try { materialGpuResources(props.meshes, usesMaterials, props.uploadBytes); } catch { fail('The 3D model cannot be rendered.'); }
    if (!disposed) {
      const buildStart = performance.now();
      void import('./mesh-scene').then(({ createMeshScene }) => createMeshScene(element, props.meshes, usesMaterials, lost, building.signal)).then(created => {
        if (disposed) { created.dispose(); return; }
        buildMs = performance.now() - buildStart;
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
