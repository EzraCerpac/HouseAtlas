/** Drawing-buffer pixel ratio of the 3D view (drawing-buffer pixels per layout
 * pixel). A still view draws at full sharpness; frames drawn while it moves use
 * fewer pixels where the GPU cannot finish them within a display frame. Phones
 * spend most of a frame per pixel (#312), so a moving frame there starts at one
 * pixel per layout pixel instead of learning its way down from full. Pure, so
 * the generated checks run the same rule. */

/** A still frame draws at the device's pixel ratio, up to this. */
export const STILL_MAX_RATIO = 2;
/** A moving frame never draws fewer drawing-buffer pixels per layout pixel than this (nor more than a still one). */
export const MOVE_MIN_RATIO = .75;
/** Where the pointer is coarse (phones and tablets), moving frames start at this ratio. */
export const MOVE_TOUCH_RATIO = 1;
/** A moving frame should finish on the GPU within one 60 Hz display frame. */
export const MOVE_BUDGET_MS = 1000 / 60;
/** Each adjustment moves the ratio at most this far down, or exactly this far up (per axis). */
const MOVE_STEP_DOWN = .7, MOVE_STEP_UP = .85;
/** A motion slower than this share of the budget draws its next motion with fewer pixels, aiming at
 * MOVE_AIM of it; one faster than MOVE_FAST draws the next one a step sharper. A step up multiplies
 * the pixels by 1 / MOVE_STEP_UP² (about 1.38), which stays inside the band, so it never oscillates. */
const MOVE_SLOW = .9, MOVE_AIM = .75, MOVE_FAST = .5;
/** A motion needs this many timed frames before its time counts. */
export const MOTION_MIN_FRAMES = 8;

/** The pixel ratio of a still frame. */
export const stillRatio = (devicePixelRatio: number): number => Math.min(devicePixelRatio > 0 ? devicePixelRatio : 1, STILL_MAX_RATIO);

/** The lowest pixel ratio a moving frame may use. */
export const moveFloor = (devicePixelRatio: number): number => Math.min(stillRatio(devicePixelRatio), MOVE_MIN_RATIO);

/** A moving frame's ratio held within its floor and the still ratio. */
export const clampMoveRatio = (ratio: number, devicePixelRatio: number): number =>
  Math.min(stillRatio(devicePixelRatio), Math.max(moveFloor(devicePixelRatio), ratio));

/** Where moving frames start before any is timed: one pixel per layout pixel on a
 * coarse pointer, full sharpness otherwise. WebGL2 cannot time its frames cheaply,
 * so there this is also where they stay. */
export const startMoveRatio = (devicePixelRatio: number, coarsePointer: boolean): number =>
  coarsePointer ? clampMoveRatio(MOVE_TOUCH_RATIO, devicePixelRatio) : stillRatio(devicePixelRatio);

/** The next motion's ratio after one whose frames took a median `spentMs` on the GPU.
 * Too slow: fewer pixels, by the share it overran (frame cost is mostly per pixel on
 * phones), at most MOVE_STEP_DOWN per axis at once. Well within budget: one step
 * sharper. In between it stays. */
export function adaptMoveRatio(ratio: number, spentMs: number, devicePixelRatio: number): number {
  const current = clampMoveRatio(ratio, devicePixelRatio);
  if (spentMs > MOVE_BUDGET_MS * MOVE_SLOW) return clampMoveRatio(current * Math.max(MOVE_STEP_DOWN, Math.sqrt(MOVE_BUDGET_MS * MOVE_AIM / spentMs)), devicePixelRatio);
  if (spentMs < MOVE_BUDGET_MS * MOVE_FAST) return clampMoveRatio(current / MOVE_STEP_UP, devicePixelRatio);
  return current;
}

/** The ratio for the next motion once one has ended, from its frames' GPU times; null
 * when it had too few frames to say (a short glide keeps the ratio as it was). */
export function motionRatio(ratio: number, frameMs: readonly number[], devicePixelRatio: number): number | null {
  if (frameMs.length < MOTION_MIN_FRAMES) return null;
  const sorted = [...frameMs].sort((a, b) => a - b), median = sorted[sorted.length >> 1]!;
  return adaptMoveRatio(ratio, median, devicePixelRatio);
}

/** A run of moving frames: the pixel ratio it began with, kept until the view is still
 * again, its frames' GPU times as they arrive, how many timed frames the GPU has not
 * finished yet, and whether a still frame has ended it. */
export interface Motion { readonly ratio: number; readonly frameMs: number[]; pending: number; ended: boolean }

/** The motion a frame belongs to: a moving frame continues the motion in progress
 * (whatever has been learned since) or begins one at `learned`; a still frame has none. */
export const nextMotion = (current: Motion | null, moving: boolean, learned: number): Motion | null =>
  !moving ? null : current ?? { ratio: learned, frameMs: [], pending: 0, ended: false };

/** One frame of `motion` was submitted to the GPU. The returned function records its GPU
 * time once it has finished (null if it never did); once the motion has ended and none of
 * its frames is pending, `learn` gets all of their times. A backlogged GPU can finish a
 * short drag's frames after the still frame that ended it, so those late times still count. */
export function timeMotionFrame(motion: Motion, learn: (frameMs: readonly number[]) => void): (ms: number | null) => void {
  motion.pending++;
  return ms => {
    if (ms !== null) motion.frameMs.push(ms);
    if (--motion.pending === 0 && motion.ended) learn(motion.frameMs);
  };
}

/** A still frame has ended `motion`: `learn` gets its frames' times now, or once the last pending one finishes. */
export function endMotion(motion: Motion, learn: (frameMs: readonly number[]) => void): void {
  motion.ended = true;
  if (motion.pending === 0) learn(motion.frameMs);
}

/** The drawing buffer for a layout size at `ratio`, within `maxPixels`. */
export function bufferSize(width: number, height: number, ratio: number, maxPixels: number): [number, number] {
  const w = Math.max(1, Math.round(width * ratio)), h = Math.max(1, Math.round(height * ratio));
  const fit = Math.min(1, Math.sqrt(maxPixels / (w * h)));
  return [Math.max(1, Math.floor(w * fit)), Math.max(1, Math.floor(h * fit))];
}
