/** Pointer gesture owner shared by the stage hook and generated interaction checks. */
export interface StageGesture {
  drag: { id: number; x: number; y: number; moved: boolean } | null;
  pointers: Map<number, { x: number; y: number }>;
  pinch: { distance: number; x: number; y: number } | null;
  pinched: boolean;
}
interface StagePointer {
  readonly button: number; readonly pointerId: number; readonly pointerType: string;
  readonly clientX: number; readonly clientY: number; readonly target: EventTarget | null;
  readonly currentTarget: HTMLElement;
}
type Update<T> = (update: (value: T) => T) => void;
export function createStagePointers(options: {
  readonly gesture: StageGesture; readonly top: boolean;
  readonly onTap: (x: number, y: number, target?: EventTarget | null) => void;
  readonly dragging: (value: boolean) => void;
  readonly zoom: Update<number>; readonly pan: Update<{ x: number; y: number }>;
  readonly orbit: Update<{ yaw: number; pitch: number }>;
}) {
  const g = options.gesture;
  const span = () => {
    const [a, b] = [...g.pointers.values()];
    return a && b ? { distance: Math.max(1, Math.hypot(b.x - a.x, b.y - a.y)), x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 } : null;
  };
  const end = () => { g.drag = null; options.dragging(false); };
  const forget = (id: number) => {
    g.pointers.delete(id);
    if (g.pointers.size < 2) g.pinch = null;
    if (g.pointers.size === 0) g.pinched = false;
  };
  return {
    onPointerDown(event: StagePointer) {
      if (event.button !== 0) return;
      if (event.pointerType === 'touch') g.pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
      if (g.pointers.size >= 2) {
        g.pinched = true; g.drag = null; g.pinch = span();
        // A projected label can move or unmount while zooming. Both fingers
        // belong to the stable viewport once the gesture becomes a pinch.
        for (const id of g.pointers.keys()) if (!event.currentTarget.hasPointerCapture(id)) event.currentTarget.setPointerCapture(id);
        options.dragging(true); return;
      }
      if (!g.pinched) g.drag = { id: event.pointerId, x: event.clientX, y: event.clientY, moved: false };
    },
    onPointerMove(event: StagePointer) {
      if (g.pointers.has(event.pointerId)) g.pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
      if (g.pinch) {
        const from = g.pinch, to = span(); if (!to) return;
        g.pinch = to;
        options.zoom(value => Math.min(8, Math.max(.6, value * to.distance / from.distance)));
        options.pan(value => ({ x: value.x + to.x - from.x, y: value.y + to.y - from.y }));
        return;
      }
      const d = g.drag; if (!d || d.id !== event.pointerId || g.pinched) return;
      const dx = event.clientX - d.x, dy = event.clientY - d.y;
      if (!d.moved && Math.hypot(dx, dy) < 5) return;
      if (!d.moved) { event.currentTarget.setPointerCapture(event.pointerId); options.dragging(true); }
      g.drag = { ...d, x: event.clientX, y: event.clientY, moved: true };
      if (options.top) options.pan(value => ({ x: value.x + dx, y: value.y + dy }));
      else options.orbit(value => ({ yaw: value.yaw + dx * .4, pitch: Math.min(68, Math.max(12, value.pitch - dy * .25)) }));
    },
    onPointerUp(event: StagePointer) {
      const multi = g.pinched, d = g.drag;
      forget(event.pointerId);
      if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
      if (multi) { if (g.pointers.size === 0) end(); return; }
      if (!d || d.id !== event.pointerId) return;
      end(); if (d.moved) return;
      const rect = event.currentTarget.getBoundingClientRect(); options.onTap(event.clientX - rect.left, event.clientY - rect.top, event.target);
    },
    onPointerCancel(event: StagePointer) {
      const owned = g.pointers.has(event.pointerId) || g.drag?.id === event.pointerId;
      forget(event.pointerId); if (owned) end();
    },
    onLostPointerCapture(event: StagePointer) {
      // Implicit capture can move from the hit canvas to its viewport. The
      // descendant's bubbling loss does not mean the live gesture was lost.
      if (event.target !== event.currentTarget) return;
      const matchingDrag = g.drag?.id === event.pointerId;
      const trackedTouch = g.pointers.has(event.pointerId);
      forget(event.pointerId);
      if (matchingDrag || trackedTouch) end();
    },
  };
}
