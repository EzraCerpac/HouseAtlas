/** Safari/WebKit trackpad gestures (`gesturestart`, `gesturechange`,
 * `gestureend`). Their rotation (degrees) and scale are cumulative since the
 * gesture started, so each change applies `startYaw + rotation` and
 * `startZoom * scale` together instead of adding deltas. While a gesture is
 * active, the ctrl-wheel events WebKit sends for the same pinch are absorbed so
 * zoom is applied once. Chromium has no trackpad rotation event; nothing here
 * derives a twist from wheel, pointer or drag input. */
export interface TrackpadGestureEvent {
  readonly rotation: number;
  readonly scale: number;
  preventDefault(): void;
}
export interface TrackpadGestureOptions {
  readonly read: () => { readonly yaw: number; readonly zoom: number };
  readonly apply: (pose: { readonly yaw: number | null; readonly zoom: number }) => void;
  /** Whether a twist turns the view; a top-down plan keeps its orientation. */
  readonly rotates: () => boolean;
  readonly zoomLimits: { readonly min: number; readonly max: number };
}
export interface TrackpadGesture {
  readonly active: () => boolean;
  readonly start: (event: TrackpadGestureEvent) => void;
  readonly change: (event: TrackpadGestureEvent) => void;
  readonly end: (event: TrackpadGestureEvent) => void;
}

const finite = (value: number, fallback: number) => Number.isFinite(value) ? value : fallback;

export function createTrackpadGesture(options: TrackpadGestureOptions): TrackpadGesture {
  let start: { readonly yaw: number; readonly zoom: number } | null = null;
  return {
    active: () => start !== null,
    start: event => { event.preventDefault(); start = options.read(); },
    change: event => {
      if (start === null) return;
      event.preventDefault();
      const { min, max } = options.zoomLimits;
      const zoom = Math.min(max, Math.max(min, start.zoom * Math.max(0, finite(event.scale, 1))));
      options.apply({ yaw: options.rotates() ? start.yaw + finite(event.rotation, 0) : null, zoom });
    },
    end: event => { if (start === null) return; event.preventDefault(); start = null; },
  };
}

/** Element-scoped, non-passive listeners only on the stage itself, so page
 * gestures outside it keep their browser behaviour. Returns the cleanup. */
export function bindTrackpadGesture(node: HTMLElement, gesture: TrackpadGesture): () => void {
  const start = (event: Event) => gesture.start(event as unknown as TrackpadGestureEvent);
  const change = (event: Event) => gesture.change(event as unknown as TrackpadGestureEvent);
  const end = (event: Event) => gesture.end(event as unknown as TrackpadGestureEvent);
  node.addEventListener('gesturestart', start, { passive: false });
  node.addEventListener('gesturechange', change, { passive: false });
  node.addEventListener('gestureend', end, { passive: false });
  return () => {
    node.removeEventListener('gesturestart', start);
    node.removeEventListener('gesturechange', change);
    node.removeEventListener('gestureend', end);
  };
}
