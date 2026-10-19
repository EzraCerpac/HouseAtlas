/** Wheel input does not identify trackpad versus mouse hardware. Only the
 * unified Atlas opts into ordinary wheel pan; scrolling viewers keep page mode. */
export type StageWheelMode = 'page' | 'pan';

export interface StageWheelInput {
  readonly deltaX: number; readonly deltaY: number; readonly deltaMode: number;
  readonly ctrlKey: boolean; readonly metaKey: boolean;
  readonly cancelable: boolean; readonly defaultPrevented: boolean;
}
export type StageWheelIntent =
  | { readonly kind: 'pan'; readonly x: number; readonly y: number }
  | { readonly kind: 'zoom'; readonly deltaY: number }
  | { readonly kind: 'absorb' };

/** Pure routing and CSS-pixel conversion. Modifier zoom retains its original
 * raw deltaY; line/page conversion and the per-event viewport cap apply only
 * to pan. A line is 16 CSS pixels, a page is one viewport on that axis. */
export function stageWheelIntent(event: StageWheelInput, options: {
  readonly mode?: StageWheelMode;
  readonly gestureActive: boolean;
  readonly width: number; readonly height: number;
}): StageWheelIntent | null {
  if (event.defaultPrevented) return null;
  if (event.ctrlKey || event.metaKey) {
    if (!Number.isFinite(event.deltaY)) return null;
    return options.gestureActive ? { kind: 'absorb' } : { kind: 'zoom', deltaY: event.deltaY };
  }
  // Existing modifier zoom also handles noncancelable events. Pan must be
  // cancelable so the same event cannot move both map and scrolling content.
  if (options.mode !== 'pan' || !event.cancelable) return null;
  if (!Number.isFinite(event.deltaX) || !Number.isFinite(event.deltaY)
    || !Number.isFinite(options.width) || options.width <= 0
    || !Number.isFinite(options.height) || options.height <= 0) return null;
  if (event.deltaX === 0 && event.deltaY === 0) return null;
  if (options.gestureActive) return { kind: 'absorb' };
  if (event.deltaMode !== 0 && event.deltaMode !== 1 && event.deltaMode !== 2) return null;
  const scaleX = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? options.width : 1;
  const scaleY = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? options.height : 1;
  return { kind: 'pan',
    x: event.deltaX === 0 ? 0 : -Math.min(options.width, Math.max(-options.width, event.deltaX * scaleX)),
    y: event.deltaY === 0 ? 0 : -Math.min(options.height, Math.max(-options.height, event.deltaY * scaleY)) };
}
