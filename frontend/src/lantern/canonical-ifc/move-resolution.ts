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

/** The next moving-frame ratio after one moving frame took `spentMs` to finish on a
 * drained GPU queue. Too slow: fewer pixels, by the share the frame overran (frame
 * cost is mostly per pixel on phones), at most MOVE_STEP_DOWN per axis at once. Well
 * within budget: one step sharper. In between it stays, so it never oscillates. */
export function adaptMoveRatio(ratio: number, spentMs: number, devicePixelRatio: number): number {
  const current = clampMoveRatio(ratio, devicePixelRatio);
  if (spentMs > MOVE_BUDGET_MS * 1.1) return clampMoveRatio(current * Math.max(MOVE_STEP_DOWN, Math.sqrt(MOVE_BUDGET_MS / spentMs)), devicePixelRatio);
  if (spentMs < MOVE_BUDGET_MS * .6) return clampMoveRatio(current / MOVE_STEP_UP, devicePixelRatio);
  return current;
}
