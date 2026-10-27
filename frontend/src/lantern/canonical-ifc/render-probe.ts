import type { PreparedMesh, Projection } from './geometry';
import type { MeshScene } from './mesh-scene';

/** On-device speed check for the 3D view, opened by adding ?render-probe to the
 * address (Safari on a phone can, where the installed app cannot). Once the model
 * is on screen it turns the camera through a fixed arc, drawing back to back, and
 * times each frame until the GPU has finished it: first the view as drawn, then
 * with one cost changed at a time. Whichever change saves the most time is what
 * limits this device. The report holds device and model sizes only. */

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
  /** Milliseconds from opening the page to the model's first frame, and building its GPU scene. */
  readonly shownAt: number;
  readonly buildMs: number;
}

/** The projection turned by `angle` about the vertical axis. */
function turned(q: Projection, angle: number): Projection {
  const c = Math.cos(angle), s = Math.sin(angle);
  return { ...q, ct: q.ct * c - q.st * s, st: q.st * c + q.ct * s };
}

const percentile = (sorted: readonly number[], p: number) => sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))]!;
const ms = (value: number) => `${value.toFixed(1)} ms`;

/** Runs every case and returns the report as plain text. The caller redraws the view afterwards. */
export async function runRenderProbe({ scene, meshes, projection, width, height, shownAt, buildMs }: ProbeSetup): Promise<string> {
  const rows: string[] = [];
  let drawnVertices = 0;
  try {
    for (const test of CASES) {
      const vertices = scene.share(test.share); if (test.share === 1) drawnVertices = vertices;
      const w = Math.max(1, Math.round(width * test.scale)), h = Math.max(1, Math.round(height * test.scale)), times: number[] = [];
      for (let frame = 0; frame < WARMUP + FRAMES; frame++) {
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
  const triangles = meshes.reduce((sum, mesh) => sum + mesh.triangles, 0);
  return [
    '3D speed check',
    `${scene.backend} · ${width} × ${height} px (device pixel ratio ${window.devicePixelRatio || 1}) · ${triangles.toLocaleString('en')} triangles · ${(drawnVertices / 1e6).toFixed(2)}M vertices a frame`,
    `Model on screen ${(shownAt / 1000).toFixed(1)} s after opening; GPU scene built in ${(buildMs / 1000).toFixed(1)} s`,
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
    + 'border-radius:12px;background:Canvas;color:CanvasText;box-shadow:0 4px 24px rgb(0 0 0 / .3);font:12px/1.45 ui-monospace,monospace';
  const body = document.createElement('pre');
  body.style.cssText = 'margin:0 0 8px;white-space:pre-wrap'; body.textContent = text;
  const button = (label: string, act: () => void) => {
    const element = document.createElement('button'); element.type = 'button'; element.className = 'btn'; element.textContent = label;
    element.style.marginRight = '8px'; element.addEventListener('click', act); return element;
  };
  const copy = button('Copy', () => { void navigator.clipboard?.writeText(text).then(() => { copy.textContent = 'Copied'; }, () => undefined); });
  panel.append(body, copy, button('Close', () => panel.remove()));
  panel.dataset.shownAt = String(performance.now());
  document.body.append(panel);
}
