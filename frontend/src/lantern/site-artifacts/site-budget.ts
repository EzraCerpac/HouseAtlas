/** Publication-wide work budget for one site scene.
 *
 * Every GLB is still admitted by the closed per-file preflight. This budget
 * adds the shared limits across one publication, reserved before the work
 * they cover:
 * - input: declared GLB bytes, reserved before each read;
 * - prepared: drawn triangles at the renderer's prepared size (position and
 *   normal per corner), reserved from the actual preflight counts before the
 *   loader allocates, and capped at the renderer's upload limit so the scene
 *   is never refused after the work is done;
 * - plan: 2D source plan coordinates retained for drawing.
 * Reservations follow publication order, so the same publication always draws
 * the same assets: input before each read starts (reads start in index order),
 * prepared and plan inside each index's ordered turn. Refused assets keep their
 * pins and a truthful reason. */

import { addGpuBytes, stateTableBytes } from '../canonical-ifc/glb-preflight';

/** Bytes the prepared mesh holds per drawn triangle: 3 corners × 6 floats × 4. */
export const PREPARED_BYTES_PER_TRIANGLE = 72;

export interface SiteBudgetLimits {
  /** Declared GLB bytes read across the publication. */
  readonly inputBytes: number;
  /** GPU upload limit for prepared vertices and the combined mesh state table. */
  readonly preparedBytes: number;
  /** Source plan coordinates retained across the publication. */
  readonly planPoints: number;
}

export interface SiteBudget {
  /** Reserves declared bytes before a read; returns why it is refused, or null. */
  reserveInput(bytes: number): string | null;
  /** Reserves the prepared scene for `triangles` before loading; returns why it is refused, or null. */
  reservePrepared(triangles: number, instances: number): string | null;
  /** Returns a prepared reservation whose load produced nothing. */
  releasePrepared(triangles: number, instances: number): void;
  /** Reserves retained plan coordinates; returns why it is refused, or null. */
  reservePlan(points: number): string | null;
  used(): { readonly inputBytes: number; readonly preparedBytes: number; readonly gpuBytes: number; readonly planPoints: number };
}

const mb = (bytes: number) => `${(bytes / 1_000_000).toLocaleString('en', { maximumFractionDigits: 1 })} MB`;

export function createSiteBudget(limits: SiteBudgetLimits): SiteBudget {
  for (const limit of [limits.inputBytes, limits.preparedBytes, limits.planPoints]) addGpuBytes(limit);
  let inputBytes = 0, preparedBytes = 0, instances = 0, planPoints = 0;
  return {
    reserveInput(bytes) {
      const nextBytes = addGpuBytes(inputBytes, bytes);
      if (nextBytes > limits.inputBytes)
        return `Not drawn: reading it would exceed this site's ${mb(limits.inputBytes)} model input budget (${mb(bytes)} needed, ${mb(limits.inputBytes - inputBytes)} left)`;
      inputBytes = nextBytes; return null;
    },
    reservePrepared(triangles, count) {
      if (!Number.isSafeInteger(triangles) || triangles < 0) throw new Error('Invalid triangle count');
      const bytes = triangles * PREPARED_BYTES_PER_TRIANGLE;
      const nextBytes = addGpuBytes(preparedBytes, bytes), nextInstances = addGpuBytes(instances, count);
      const currentGpu = addGpuBytes(preparedBytes, stateTableBytes(instances));
      const nextGpu = addGpuBytes(nextBytes, stateTableBytes(nextInstances));
      if (nextGpu > limits.preparedBytes)
        return `Not drawn: it would exceed this site's ${mb(limits.preparedBytes)} scene budget (${mb(nextGpu - currentGpu)} needed, ${mb(limits.preparedBytes - currentGpu)} left)`;
      preparedBytes = nextBytes; instances = nextInstances; return null;
    },
    releasePrepared(triangles, count) {
      if (!Number.isSafeInteger(triangles) || triangles < 0) throw new Error('Invalid triangle count');
      const bytes = triangles * PREPARED_BYTES_PER_TRIANGLE;
      addGpuBytes(bytes, count);
      if (bytes > preparedBytes || count > instances) throw new Error('Invalid site budget release');
      preparedBytes -= bytes; instances -= count;
    },
    reservePlan(points) {
      const nextPoints = addGpuBytes(planPoints, points);
      if (nextPoints > limits.planPoints)
        return `Not shown: its ${points.toLocaleString('en')} plan points would exceed this site's ${limits.planPoints.toLocaleString('en')} point budget`;
      planPoints = nextPoints; return null;
    },
    used: () => ({ inputBytes, preparedBytes, gpuBytes: addGpuBytes(preparedBytes, stateTableBytes(instances)), planPoints }),
  };
}

/** Retained 2D coordinates of a parsed plan. */
export const planPoints = (plan: { readonly shapes: readonly { readonly paths: readonly (readonly unknown[])[] }[] }) =>
  plan.shapes.reduce((sum, shape) => sum + shape.paths.reduce((total, path) => total + path.length, 0), 0);

/** Runs `step` for each index with at most `limit` running at once, starting
 * them in index order. */
export async function runLimited<T>(count: number, limit: number, step: (at: number) => Promise<T>): Promise<T[]> {
  const results = new Array<T>(count);
  let next = 0;
  const worker = async () => { while (next < count) { const at = next++; results[at] = await step(at); } };
  await Promise.all(Array.from({ length: Math.min(limit, count) }, worker));
  return results;
}

/** Serializes steps in index order: step `at` runs after every lower index's
 * step has finished. Each index must take its turn exactly once. */
export function createTurns(count: number) {
  const done = Array.from({ length: count }, () => { let resolve!: () => void; const promise = new Promise<void>(r => { resolve = r; }); return { promise, resolve }; });
  return {
    async take<T>(at: number, step: () => Promise<T>): Promise<T> {
      try { if (at > 0) await done[at - 1]!.promise; return await step(); }
      finally { done[at]!.resolve(); }
    },
  };
}
