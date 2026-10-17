import { useEffect, useRef, useState, useSyncExternalStore, type KeyboardEvent, type RefObject } from 'react';
import { useEased } from '../atlas/useCamera';
import { createStagePointers, type StageGesture } from './stage-pointers';
import { bindTrackpadGesture, createTrackpadGesture } from './trackpad-gesture';

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
  readonly onTap: (x: number, y: number, target?: EventTarget | null) => void;
  readonly onEscape?: () => void;
}) {
  const [size, setSize] = useState({ width: 960, height: 640 });
  const [orbit, setOrbit] = useState<{ yaw: number; pitch: number }>(DEFAULT_ORBIT);
  const [zoom, setZoom] = useState(1), [pan, setPan] = useState({ x: 0, y: 0 });
  const [dragging, setDragging] = useState(false);
  const gesture = useRef<StageGesture>({ drag: null, pointers: new Map(), pinch: null, pinched: false });
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
  const live = useRef({ yaw: orbit.yaw, zoom, top });
  live.current = { yaw: orbit.yaw, zoom, top };
  // Pinch and ctrl/cmd + wheel zoom; an ordinary wheel keeps scrolling the page.
  // Safari trackpad twist turns and pinch zooms through its gesture events; the
  // ctrl-wheel WebKit sends for the same pinch is absorbed meanwhile.
  useEffect(() => {
    const node = element.current; if (!node) return;
    const trackpad = createTrackpadGesture({
      read: () => ({ yaw: live.current.yaw, zoom: live.current.zoom }),
      apply: pose => {
        setZoom(pose.zoom);
        if (pose.yaw !== null) { const yaw = pose.yaw; setOrbit(value => ({ ...value, yaw })); }
      },
      rotates: () => !live.current.top,
      zoomLimits: ZOOM,
    });
    const wheel = (event: WheelEvent) => {
      if (!event.ctrlKey && !event.metaKey) return;
      event.preventDefault();
      if (trackpad.active()) return;
      setZoom(value => Math.min(ZOOM.max, Math.max(ZOOM.min, value * Math.exp(-event.deltaY * .004))));
    };
    node.addEventListener('wheel', wheel, { passive: false });
    const unbind = bindTrackpadGesture(node, trackpad);
    return () => { node.removeEventListener('wheel', wheel); unbind(); };
  }, [element]);

  const turn = (delta: number) => setOrbit(value => ({ ...value, yaw: value.yaw + delta }));
  const tilt = (delta: number) => setOrbit(value => ({ ...value, pitch: Math.min(PITCH_3D.max, Math.max(PITCH_3D.min, value.pitch + delta)) }));
  const zoomBy = (factor: number) => setZoom(value => Math.min(ZOOM.max, Math.max(ZOOM.min, value * factor)));
  const fit = () => { setZoom(1); setPan({ x: 0, y: 0 }); if (!top) setOrbit(DEFAULT_ORBIT); };
  /** Zoom and pan back to the framed scope; the chosen orbit stays. */
  const reframe = () => { setZoom(1); setPan({ x: 0, y: 0 }); };
  const bind = {
    ...createStagePointers({ gesture: gesture.current, top, onTap, dragging: setDragging, zoom: setZoom, pan: setPan, orbit: setOrbit }),
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
  return { size, eased, planBlend, dragging, zoom, zoomLimits: ZOOM, turn, zoomBy, fit, reframe, bind };
}
