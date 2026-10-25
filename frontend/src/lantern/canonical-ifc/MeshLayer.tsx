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
}

/** Whether this browser offers any 3D drawing API the renderer can use. */
const drawable = () => 'gpu' in navigator || document.createElement('canvas').getContext('webgl2') !== null;

/** A lost GPU device is rebuilt this many times before the view gives up. */
const REBUILDS = 2;

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
 * ready, so swapping in a more detailed model never blanks the view. */
export function MeshLayer(props: Props) {
  const [shown, setShown] = useState<readonly PreparedMesh[] | null>(null);
  const wanted = useRef(props.meshes); wanted.current = props.meshes;
  const ready = useCallback((meshes: readonly PreparedMesh[]) => { if (wanted.current === meshes) setShown(meshes); }, []);
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
  const stale = useRef(true);
  useLayoutEffect(() => { redraw.current?.(); }, [props.projection, props.hidden]);
  useLayoutEffect(() => { stale.current = true; redraw.current?.(); },
    [props.rules, props.currentFloorId, props.selectedOccurrenceId, props.contextOccurrenceIds, props.tints, props.referenceKeys,
      props.hiddenKeys, props.selectedKeys, props.lifts, props.clips, props.dims, props.ghosts, props.palette, props.sourceColors, props.sourceMaterials, props.sourceDim, props.ambient, props.twoSided, props.shade, props.light, props.pitch, props.pitchKeys, props.site, props.ghostAlpha]);
  useLayoutEffect(() => {
    const element = canvas.current; if (!element || props.meshes.length === 0) return;
    const usesMaterials = props.sourceMaterials === true && props.meshes.some(mesh => mesh.sourceMaterial !== undefined);
    let disposed = false, frame: number | null = null, scene: MeshScene | null = null;
    const schedule = () => {
      if (disposed || !scene || frame !== null || document.hidden) return;
      frame = requestAnimationFrame(() => { frame = null; try { render(); } catch { fail('The 3D model cannot be rendered.'); } });
    };
    const release = () => {
      if (disposed) return; disposed = true;
      if (frame !== null) cancelAnimationFrame(frame); frame = null;
      if (redraw.current === schedule) redraw.current = null;
      scene?.dispose(); scene = null;
    };
    const fail = (message: string) => { const live = !disposed; release(); if (live) latest.current.onUnavailable(message); };
    const lost = (message: string) => {
      if (disposed) return;
      if (rebuilds < REBUILDS) { release(); setRebuilds(count => count + 1); } else fail(message);
    };
    const visibility = () => { if (!document.hidden) schedule(); };
    const render = () => {
      if (disposed || !scene) return;
      const p = latest.current; if (p.hidden) return;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      let w = Math.max(1, Math.round(element.clientWidth * dpr)), h = Math.max(1, Math.round(element.clientHeight * dpr));
      const fit = Math.min(1, Math.sqrt(RENDER_LIMITS.pixels / (w * h))); w = Math.max(1, Math.floor(w * fit)); h = Math.max(1, Math.floor(h * fit));
      scene.render(p.projection, stale.current ? p : null, w, h); stale.current = false;
    };
    document.addEventListener('visibilitychange', visibility);
    const resize = new ResizeObserver(schedule); resize.observe(element);
    try { materialGpuResources(props.meshes, usesMaterials, props.uploadBytes); } catch { fail('The 3D model cannot be rendered.'); }
    if (!disposed) {
      void import('./mesh-scene').then(({ createMeshScene }) => createMeshScene(element, props.meshes, usesMaterials, lost)).then(created => {
        if (disposed) { created.dispose(); return; }
        scene = created; stale.current = true; element.dataset.renderer = created.backend;
        redraw.current = schedule; schedule(); latest.current.onReady(props.meshes);
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
