import type { PreparedMesh, Projection } from './geometry';
import type { MeshScene, StageTime } from './mesh-scene';
import type { SceneBuildSnapshot } from './scene-build-observation';

/** On-device speed check for the 3D view, opened by adding ?render-probe to the
 * address (Safari on a phone can, where the installed app cannot). Once the model
 * is on screen it turns the camera through a fixed arc, drawing back to back, and
 * times each frame until the GPU has finished it: first the view as drawn, then
 * with one cost changed at a time. Whichever change saves the most time is what
 * limits this device. The report holds device and model sizes only.
 * ?render-probe=drag skips that check; with either, each drag's frame times are
 * shown once it ends (createDragReadout). */

/** One measured case: drawing-buffer scale on each axis, share of every layer's
 * triangles, and contact shading (1 recomputes it every frame, as a view that has
 * just stopped does). */
interface Case { readonly label: string; readonly scale: number; readonly share: number; readonly shading: number }
const CASES: readonly Case[] = [
  { label: 'As drawn', scale: 1, share: 1, shading: 0 },
  { label: '¼ of the pixels', scale: .5, share: 1, shading: 0 },
  { label: '½ of the triangles', scale: 1, share: .5, shading: 0 },
  { label: '¼ of the triangles', scale: 1, share: .25, shading: 0 },
  { label: 'Contact shading', scale: 1, share: 1, shading: 1 },
];
/** Frames timed per case, after a few untimed ones that let pipelines and sizes settle. */
const FRAMES = 40, WARMUP = 4;
/** The camera turns this far per frame, in radians (1.5°): a slow orbit. */
const STEP = 1.5 * Math.PI / 180;

export interface ProbeSetup {
  readonly scene: MeshScene;
  readonly meshes: readonly PreparedMesh[];
  readonly projection: Projection;
  readonly width: number;
  readonly height: number;
  /** Existing timer-derived readiness timestamp; may include hidden readiness. Not paint. */
  readonly shownAt: number;
  /** Wall interval from before dynamic scene import through eager constructor completion. */
  readonly buildMs: number;
  readonly observation?: SceneBuildSnapshot | undefined;
  /** When each stage of the scene was ready to draw, and how long it took to prepare. */
  readonly stages: readonly StageTime[];
  /** Aborted when the canvas is released: the check stops and reports nothing. */
  readonly signal: AbortSignal;
}

/** The projection turned by `angle` about the vertical axis. */
function turned(q: Projection, angle: number): Projection {
  const c = Math.cos(angle), s = Math.sin(angle);
  return { ...q, ct: q.ct * c - q.st * s, st: q.st * c + q.ct * s };
}

const percentile = (sorted: readonly number[], p: number) => sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))]!;
const ms = (value: number) => `${value.toFixed(1)} ms`;
const s = (value: number) => `${(value / 1000).toFixed(1)} s`;

/** Runs every case and returns the report as plain text. The caller redraws the view afterwards. */
export async function runRenderProbe({ scene, meshes, projection, width, height, shownAt, buildMs, observation, stages, signal }: ProbeSetup): Promise<string> {
  const rows: string[] = [];
  let drawnVertices = 0;
  try {
    for (const test of CASES) {
      const vertices = scene.share(test.share); if (test.share === 1) drawnVertices = vertices;
      const w = Math.max(1, Math.round(width * test.scale)), h = Math.max(1, Math.round(height * test.scale)), times: number[] = [];
      for (let frame = 0; frame < WARMUP + FRAMES; frame++) {
        signal.throwIfAborted();
        const start = performance.now();
        scene.render(turned(projection, frame * STEP), null, w, h, test.shading);
        await scene.finished();
        if (frame >= WARMUP) times.push(performance.now() - start);
        // Untimed: let the page handle input and present between frames (WebGL2's read-back finishes synchronously).
        await new Promise(resolve => setTimeout(resolve));
      }
      times.sort((a, b) => a - b);
      rows.push(`${test.label.padEnd(20)}${ms(percentile(times, .5)).padStart(9)}${ms(percentile(times, .9)).padStart(10)}`);
    }
  } finally { scene.share(1); }
  signal.throwIfAborted();
  const triangles = meshes.reduce((sum, mesh) => sum + mesh.triangles, 0);
  return [
    '3D speed check',
    `${scene.backend} · ${width} × ${height} px (device pixel ratio ${window.devicePixelRatio || 1}) · ${triangles.toLocaleString('en')} triangles · ${(drawnVertices / 1e6).toFixed(2)}M vertices a frame`,
    `Approximate render-call readiness ${(shownAt / 1000).toFixed(1)} s from the performance time origin; scene-import/build wall time ${(buildMs / 1000).toFixed(1)} s`,
    'Readiness uses a delayed timer (or hidden readiness), not GPU completion or witnessed paint.',
    ...(observation ? [
      'Build phases: wall includes waits; explicit slice waits are subsets. Compile-call wall sums may overlap; none are additive GPU costs.',
      ...observation.phases.map(phase => `${phase.name}: ${ms(phase.wallMs)} wall; ${ms(phase.waitMs)} explicit slice wait; `
        + `${phase.compileCalls ?? 'unavailable'} compile calls / ${phase.compileWallMs === null ? 'unavailable' : ms(phase.compileWallMs)} compile wall; `
        + `${phase.creationRequests ?? 'unavailable'} backend creation requests`),
      `Hooks: compile ${observation.compileCounter}; backend creation ${observation.creationCounter}. Per-phase unavailable means no complete hook coverage; requests are not completed GPU pipelines or proven cache hits.`,
      `First successful render call: ${observation.firstDrawCpuMs === null ? 'unavailable' : ms(observation.firstDrawCpuMs)} CPU wall; `
        + `${observation.firstDrawCreationRequests ?? 'unavailable'} backend creation requests. No GPU/paint synchronization added.`,
    ] : []),
    '',
    `${'Stage'.padEnd(20)}${'ready at'.padStart(9)}${'prepared in'.padStart(13)}`,
    ...stages.map(({ stage, at, ms }) => `${stage.padEnd(20)}${s(at).padStart(9)}${s(ms).padStart(13)}`),
    '',
    `${''.padEnd(20)}${'median'.padStart(9)}${'slow 10%'.padStart(10)}`,
    ...rows,
  ].join('\n');
}

/** Shows the report over the page, with Copy and Close. */
export function showProbeReport(text: string): void {
  const panel = document.createElement('div');
  panel.setAttribute('role', 'dialog'); panel.setAttribute('aria-label', '3D speed check');
  panel.style.cssText = 'position:fixed;left:8px;right:8px;bottom:8px;z-index:9999;max-width:560px;margin:0 auto;padding:12px;'
    + 'box-sizing:border-box;max-height:calc(100vh - 16px);max-height:calc(100dvh - 16px);display:flex;flex-direction:column;overflow:hidden;'
    + 'border-radius:12px;background:Canvas;color:CanvasText;box-shadow:0 4px 24px rgb(0 0 0 / .3);font:12px/1.45 ui-monospace,monospace';
  const body = document.createElement('pre');
  body.style.cssText = 'margin:0 0 8px;white-space:pre-wrap;min-height:0;flex:1 1 auto;overflow:auto;overscroll-behavior:contain'; body.textContent = text;
  const button = (label: string, act: () => void) => {
    const element = document.createElement('button'); element.type = 'button'; element.className = 'btn'; element.textContent = label;
    element.style.marginRight = '8px'; element.addEventListener('click', act); return element;
  };
  const copy = button('Copy', () => { void navigator.clipboard?.writeText(text).then(() => { copy.textContent = 'Copied'; }, () => undefined); });
  const actions = document.createElement('div'); actions.style.cssText = 'flex:0 0 auto';
  actions.append(copy, button('Close', () => panel.remove()));
  panel.append(body, actions);
  panel.dataset.shownAt = String(performance.now());
  document.body.append(panel);
}

/** Times the frames of each drag (MeshLayer: frames drawn while a finger or pointer
 * moves the view) and, once it lets go, shows one line: the median and worst frame
 * time, the frame count, the backend and the pixel ratios drawn. On WebGPU a frame's
 * time runs from when it began (or the previous frame finished on the GPU, if later)
 * until the GPU has finished it, so a pause in the drag is not counted as a slow frame.
 * WebGL2 cannot see GPU completion cheaply; there it is the time between frames drawn,
 * leaving out gaps over PAUSE_MS. */
export interface DragReadout {
  /** One moving frame of a drag, begun at `start` (performance.now()); `finished` resolves once the GPU has finished it. */
  frame(start: number, finished: Promise<void> | null, ratio: number, still: number, backend: string): void;
  /** The drag has ended: its line is shown once its last frame has finished. */
  end(): void;
}
const PAUSE_MS = 250;

export function createDragReadout(): DragReadout {
  let drag: { times: number[]; lastDone: number; lastStart: number; ratio: number; still: number; backend: string; pending: Promise<void> } | null = null;
  let output: HTMLOutputElement | null = null;
  const show = (text: string) => {
    if (!output) {
      output = document.createElement('output');
      output.style.cssText = 'position:fixed;left:8px;right:8px;top:8px;z-index:9999;max-width:560px;margin:0 auto;padding:6px 10px;box-sizing:border-box;'
        + 'border-radius:8px;background:Canvas;color:CanvasText;box-shadow:0 2px 12px rgb(0 0 0 / .3);font:12px/1.4 ui-monospace,monospace;pointer-events:none';
      document.body.append(output);
    }
    output.textContent = text;
  };
  const ratio = (value: number) => String(Math.round(value * 100) / 100);
  return {
    frame(start, finished, moving, still, backend) {
      const current = drag ??= { times: [], lastDone: -Infinity, lastStart: NaN, ratio: moving, still, backend, pending: Promise.resolve() };
      current.ratio = moving; current.still = still;
      if (finished) {
        current.pending = finished.then(() => {
          const done = performance.now();
          current.times.push(done - Math.max(start, current.lastDone)); current.lastDone = done;
        }, () => undefined);
      } else {
        if (start - current.lastStart <= PAUSE_MS) current.times.push(start - current.lastStart);
        current.lastStart = start;
      }
    },
    end() {
      const ended = drag; if (!ended) return;
      drag = null;
      void ended.pending.then(() => {
        const times = [...ended.times].sort((a, b) => a - b); if (times.length === 0) return;
        const kind = ended.backend === 'webgpu' ? '' : ' (time between frames)';
        show(`Drag: median ${percentile(times, .5).toFixed(1)} ms, worst ${times[times.length - 1]!.toFixed(1)} ms, ${times.length} frames${kind}`
          + ` · ${ended.backend} · pixel ratio ${ratio(ended.ratio)} moving, ${ratio(ended.still)} still`);
      });
    },
  };
}
