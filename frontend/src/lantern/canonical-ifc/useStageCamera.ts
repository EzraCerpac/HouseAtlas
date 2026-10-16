import { useEffect, useRef, useState, useSyncExternalStore, type KeyboardEvent, type PointerEvent, type RefObject } from 'react';
import { useEased } from '../atlas/useCamera';

export const motionQuery = '(prefers-reduced-motion: reduce)';
function subscribeMotion(change: () => void) {
  const query = matchMedia(motionQuery); query.addEventListener('change', change); return () => query.removeEventListener('change', change);
}
/** Existing OS reduced-motion preference; no separate setting. */
export function useReducedMotionPreference(): boolean {
  return useSyncExternalStore(subscribeMotion, () => matchMedia(motionQuery).matches, () => false);
}

const PITCH_3D = { min: 12, max: 68 }, ZOOM = { min: .6, max: 8 };
export const DEFAULT_ORBIT = { yaw: -32, pitch: 36 } as const;

/** Camera state and interaction shared by the canonical stage and the local
 * preview. Every change re-targets the eased pose, so navigation is always
 * interruptible; reduced motion (OS preference) snaps. */
export function useStageCamera({ element, top, reduced, onTap, onEscape }: {
  readonly element: RefObject<HTMLDivElement | null>;
  /** Top-down pose (plan or top view). */
  readonly top: boolean;
  readonly reduced: boolean;
  readonly onTap: (x: number, y: number) => void;
  readonly onEscape?: () => void;
}) {
  const [size, setSize] = useState({ width: 960, height: 640 });
  const [orbit, setOrbit] = useState<{ yaw: number; pitch: number }>(DEFAULT_ORBIT);
  const [zoom, setZoom] = useState(1), [pan, setPan] = useState({ x: 0, y: 0 });
  const [dragging, setDragging] = useState(false);
  const drag = useRef<{ id: number; x: number; y: number; moved: boolean } | null>(null);
  // Two touching pointers pinch to zoom and move to pan; neither turns nor taps.
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const pinch = useRef<{ distance: number; x: number; y: number } | null>(null);
  const span = () => {
    const [a, b] = [...pointers.current.values()];
    return a && b ? { distance: Math.max(1, Math.hypot(b.x - a.x, b.y - a.y)), x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 } : null;
  };
  // Top-down returns to the source orientation by the shortest turn.
  const topYaw = Math.round(orbit.yaw / 360) * 360;
  const eased = useEased({ yaw: top ? topYaw : orbit.yaw, pitch: top ? 90 : orbit.pitch, zoom, panX: pan.x, panY: pan.y },
    { reduced, tau: 140, snap: dragging ? ['yaw', 'pitch', 'panX', 'panY'] : [] });
  const planBlend = Math.min(1, Math.max(0, (eased.pitch - 72) / 16));

  useEffect(() => {
    const node = element.current; if (!node) return;
    const observer = new ResizeObserver(entries => {
      const rect = entries[0]?.contentRect; if (rect) setSize({ width: Math.max(1, Math.round(rect.width)), height: Math.max(1, Math.round(rect.height)) });
    });
    observer.observe(node); return () => observer.disconnect();
  }, [element]);
  // Pinch and ctrl/cmd + wheel zoom; an ordinary wheel keeps scrolling the page.
  useEffect(() => {
    const node = element.current; if (!node) return;
    const wheel = (event: WheelEvent) => {
      if (!event.ctrlKey && !event.metaKey) return;
      event.preventDefault(); setZoom(value => Math.min(ZOOM.max, Math.max(ZOOM.min, value * Math.exp(-event.deltaY * .004))));
    };
    node.addEventListener('wheel', wheel, { passive: false }); return () => node.removeEventListener('wheel', wheel);
  }, [element]);

  const turn = (delta: number) => setOrbit(value => ({ ...value, yaw: value.yaw + delta }));
  const tilt = (delta: number) => setOrbit(value => ({ ...value, pitch: Math.min(PITCH_3D.max, Math.max(PITCH_3D.min, value.pitch + delta)) }));
  const zoomBy = (factor: number) => setZoom(value => Math.min(ZOOM.max, Math.max(ZOOM.min, value * factor)));
  const fit = () => { setZoom(1); setPan({ x: 0, y: 0 }); if (!top) setOrbit(DEFAULT_ORBIT); };
  const endDrag = () => { drag.current = null; setDragging(false); };
  const forget = (id: number) => { pointers.current.delete(id); if (pointers.current.size < 2) pinch.current = null; };

  const bind = {
    onPointerDown: (event: PointerEvent<HTMLDivElement>) => {
      if (event.button !== 0) return;
      // Touch pointers are implicitly captured, so their up events always arrive here.
      if (event.pointerType === 'touch') pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
      if (pointers.current.size >= 2) {
        // A second finger turns the gesture into a pinch; the first finger's drag and tap end.
        drag.current = null; pinch.current = span();
        if (!event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.setPointerCapture(event.pointerId);
        setDragging(true); return;
      }
      drag.current = { id: event.pointerId, x: event.clientX, y: event.clientY, moved: false };
    },
    onPointerMove: (event: PointerEvent<HTMLDivElement>) => {
      if (pointers.current.has(event.pointerId)) pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
      const from = pinch.current;
      if (from) {
        const to = span(); if (!to) return;
        pinch.current = to;
        setZoom(value => Math.min(ZOOM.max, Math.max(ZOOM.min, value * to.distance / from.distance)));
        setPan(value => ({ x: value.x + to.x - from.x, y: value.y + to.y - from.y }));
        return;
      }
      const d = drag.current; if (!d || d.id !== event.pointerId) return;
      const dx = event.clientX - d.x, dy = event.clientY - d.y;
      if (!d.moved && Math.hypot(dx, dy) < 5) return;
      if (!d.moved) { event.currentTarget.setPointerCapture(event.pointerId); setDragging(true); }
      drag.current = { ...d, x: event.clientX, y: event.clientY, moved: true };
      if (top) setPan(value => ({ x: value.x + dx, y: value.y + dy }));
      else setOrbit(value => ({ yaw: value.yaw + dx * .4, pitch: Math.min(PITCH_3D.max, Math.max(PITCH_3D.min, value.pitch - dy * .25)) }));
    },
    onPointerUp: (event: PointerEvent<HTMLDivElement>) => {
      const multi = pinch.current !== null || pointers.current.size > 1;
      forget(event.pointerId);
      if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
      // The gesture stays a pinch until every finger has lifted.
      if (multi) { if (pointers.current.size === 0) endDrag(); return; }
      const d = drag.current; endDrag();
      if (!d || d.id !== event.pointerId || d.moved) return;
      const rect = event.currentTarget.getBoundingClientRect(); onTap(event.clientX - rect.left, event.clientY - rect.top);
    },
    onPointerCancel: (event: PointerEvent<HTMLDivElement>) => { forget(event.pointerId); endDrag(); },
    onLostPointerCapture: (event: PointerEvent<HTMLDivElement>) => {
      // Releasing capture on pointer up also lands here; only an unexpected loss ends the gesture.
      if (!pointers.current.has(event.pointerId)) return;
      forget(event.pointerId); endDrag();
    },
    onKeyDown: (event: KeyboardEvent<HTMLDivElement>) => {
      if (event.target !== event.currentTarget) return;
      const step = event.shiftKey ? 4 : 1;
      const keys: Record<string, () => void> = top
        ? { ArrowLeft: () => setPan(v => ({ ...v, x: v.x + 40 * step })), ArrowRight: () => setPan(v => ({ ...v, x: v.x - 40 * step })),
          ArrowUp: () => setPan(v => ({ ...v, y: v.y + 40 * step })), ArrowDown: () => setPan(v => ({ ...v, y: v.y - 40 * step })) }
        : { ArrowLeft: () => turn(-15 * step), ArrowRight: () => turn(15 * step), ArrowUp: () => tilt(6), ArrowDown: () => tilt(-6) };
      Object.assign(keys, { '+': () => zoomBy(1.15), '=': () => zoomBy(1.15), '-': () => zoomBy(1 / 1.15), '0': fit });
      if (onEscape) keys.Escape = onEscape;
      const action = keys[event.key]; if (!action) return;
      event.preventDefault(); action();
    },
  };
  return { size, eased, planBlend, dragging, zoom, zoomLimits: ZOOM, turn, zoomBy, fit, bind };
}
