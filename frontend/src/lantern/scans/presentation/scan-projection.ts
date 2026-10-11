import { makeProjector } from '../../atlas/projection';
import type { Cam, Projector } from '../../atlas/projection';
import type { Pt } from '../../data/types';

/** Authored plan +Y is up; Lantern's original schematic plane +Y is down.
 * Reflect only the camera input basis, never the retained mesh/room coordinates.
 * This makes the camera look down onto the plan instead of showing its underside.
 */
export const SCAN_PLAN_Y_TO_CAMERA = -1 as const;

/** One basis for SVG rooms/anchors and the WebGL camera. No house registration. */
export function makeScanProjector(cam: Cam, center: Pt, S = 40): Projector {
  const camera = makeProjector(cam, [center[0], center[1] * SCAN_PLAN_Y_TO_CAMERA], S);
  const p: Projector['p'] = (x, y, z) => camera.p(x, y * SCAN_PLAN_Y_TO_CAMERA, z);
  return {
    ...camera,
    p,
    depth: (x, y, z) => camera.depth(x, y * SCAN_PLAN_Y_TO_CAMERA, z),
    facing: (nx, ny) => camera.facing(nx, ny * SCAN_PLAN_Y_TO_CAMERA),
    dir: (dx, dy) => camera.dir(dx, dy * SCAN_PLAN_Y_TO_CAMERA),
    planeMatrix: z => {
      const o = p(0, 0, z);
      const ax = camera.ct * S, ay = camera.st * camera.sf * S;
      const bx = -camera.st * S * SCAN_PLAN_Y_TO_CAMERA;
      const by = camera.ct * camera.sf * S * SCAN_PLAN_Y_TO_CAMERA;
      return `matrix(${ax.toFixed(4)} ${ay.toFixed(4)} ${bx.toFixed(4)} ${by.toFixed(4)} ${o[0].toFixed(2)} ${o[1].toFixed(2)})`;
    },
  };
}
