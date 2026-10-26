import { useEffect, useId, useMemo, useRef, useState, type CSSProperties, type FocusEvent, type KeyboardEvent } from 'react';
import { getPosition } from 'suncalc';
import type { SunLocation } from './daylight';

/** The moment the 3D view is lit for: the clock, advancing each minute, until
 * a moment is picked; `set(null)` follows the clock again. */
export function useLightingTime(): { readonly at: Date; readonly live: boolean; readonly set: (at: Date | null) => void } {
  const [picked, setPicked] = useState<Date | null>(null);
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    if (picked !== null) return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const tick = () => { setNow(new Date()); timer = setTimeout(tick, 60_000 - Date.now() % 60_000 + 50); };
    const visible = () => { if (!document.hidden) { if (timer !== null) clearTimeout(timer); tick(); } };
    tick();
    document.addEventListener('visibilitychange', visible);
    return () => { if (timer !== null) clearTimeout(timer); document.removeEventListener('visibilitychange', visible); };
  }, [picked]);
  return { at: picked ?? now, live: picked === null, set: setPicked };
}

const pad = (n: number) => String(n).padStart(2, '0');
const clock = (at: Date) => `${pad(at.getHours())}:${pad(at.getMinutes())}`;
const DAY = 24 * 60;
/** Minutes after local midnight; the time moves in steps of this many. */
const STEP = 5;
/** Minutes a one-pixel drag on the chip moves the time: a day is about 360 px. */
const PER_PX = 4;
/** The sun's altitude every half hour of `at`'s day, in degrees. */
const SAMPLES = 48;

/** `at`'s day at `minutes` after local midnight. */
const onDay = (at: Date, minutes: number) => {
  const next = new Date(at); next.setHours(Math.floor(minutes / 60), minutes % 60, 0, 0); return next;
};
/** Sky tone for a sun altitude, from night through twilight to day. */
const sky = (altitude: number) => altitude > 8 ? '#f4e2ab' : altitude > 0 ? '#eeb47c' : altitude > -6 ? '#9a8fb4' : '#2f3554';

/** The lighting time as a chip in the Floor Stack's family: drag sideways on
 * it to move through today, tap it for a strip of the day's sky, Now returns
 * to the clock. The glyph draws the sun's path over today and where it is. */
export function DaylightControl({ at, live, night, place, onChange }: {
  readonly at: Date; readonly live: boolean; readonly night: boolean; readonly place: SunLocation;
  readonly onChange: (at: Date | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const [scrubbing, setScrubbing] = useState(false);
  const head = useRef<HTMLButtonElement>(null);
  const id = useId();
  const minutes = at.getHours() * 60 + at.getMinutes();
  const dayKey = `${at.getFullYear()}-${at.getMonth()}-${at.getDate()}`;
  const altitudes = useMemo(() => Array.from({ length: SAMPLES + 1 },
    (_, k) => getPosition(onDay(at, Math.min(DAY - 1, k * DAY / SAMPLES)), place.latitude, place.longitude).altitude * 180 / Math.PI),
  // One path per day and place, not per minute.
  [dayKey, place.latitude, place.longitude]);
  const set = (value: number) => onChange(onDay(at, ((Math.round(value / STEP) * STEP) % DAY + DAY) % DAY));
  const close = () => { setOpen(false); head.current?.focus({ preventScroll: true }); };
  const keys = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key !== 'Escape' || !open) return;
    event.preventDefault(); event.stopPropagation(); close();
  };
  const blur = (event: FocusEvent<HTMLElement>) => {
    if (open && event.relatedTarget instanceof Node && !event.currentTarget.contains(event.relatedTarget)) setOpen(false);
  };
  useEffect(() => {
    if (!open) return;
    const away = (event: PointerEvent) => { if (!(event.target instanceof Node) || !head.current?.closest('.ua-time')?.contains(event.target)) setOpen(false); };
    document.addEventListener('pointerdown', away, true);
    return () => document.removeEventListener('pointerdown', away, true);
  }, [open]);
  // A sideways drag on the head scrubs the time instead of opening the strip.
  const drag = useRef<{ readonly x: number; readonly from: number; moved: boolean } | null>(null);
  const stop = () => { drag.current = null; setScrubbing(false); };
  const step = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    event.preventDefault(); event.stopPropagation();
    set(minutes + (event.key === 'ArrowRight' ? 1 : -1) * (event.shiftKey ? 60 : 15));
  };
  // Day above the horizon, night below it, each scaled to fill its half.
  const up = Math.max(5, ...altitudes), down = Math.max(5, ...altitudes.map(altitude => -altitude));
  const y = (altitude: number) => 14 - (altitude > 0 ? altitude / up * 9 : altitude / down * 6);
  const path = altitudes.map((altitude, k) => `${k ? 'L' : 'M'}${(2 + k * 22 / SAMPLES).toFixed(2)} ${y(altitude).toFixed(2)}`).join('');
  const here = getPosition(at, place.latitude, place.longitude).altitude * 180 / Math.PI;
  const strip = { '--time-sky': `linear-gradient(90deg, ${altitudes.map((altitude, k) => `${sky(altitude)} ${(k / SAMPLES * 100).toFixed(1)}%`).join(', ')})` } as CSSProperties;
  return (
    <div className={`ua-time${open ? ' is-open' : ''}${live ? '' : ' is-picked'}${scrubbing ? ' is-scrubbing' : ''}`} onKeyDown={keys} onBlur={blur}>
      <div className="ua-time-paper">
        <button ref={head} type="button" className="ua-time-head" aria-expanded={open} aria-controls={`${id}-strip`}
          aria-label={`Lighting time ${clock(at)}${live ? ', now' : ''}`} aria-describedby={`${id}-hint`}
          title="Drag sideways to change the time" onKeyDown={step}
          onPointerDown={event => {
            if (event.button !== 0) return;
            // Held from the press, so a drag that leaves the chip early still scrubs.
            drag.current = { x: event.clientX, from: minutes, moved: false }; event.currentTarget.setPointerCapture(event.pointerId);
          }}
          onPointerMove={event => {
            // A press released elsewhere never reached click: no button held, no drag.
            const start = drag.current; if (start && event.buttons === 0) { stop(); return; }
            if (!start) return;
            const dx = event.clientX - start.x;
            if (!start.moved) {
              if (Math.abs(dx) < 6) return;
              start.moved = true; setScrubbing(true);
            }
            set(start.from + dx * PER_PX);
          }}
          onPointerUp={() => { if (drag.current?.moved) setScrubbing(false); }}
          onPointerCancel={stop}
          onClick={() => { const moved = drag.current?.moved; drag.current = null; if (!moved) setOpen(!open); }}>
          <svg className={`ua-time-glyph${night ? ' is-night' : ''}`} width={26} height={26} viewBox="0 0 26 26" aria-hidden="true">
            <path className="ua-time-horizon" d="M2 14H24" />
            <path className="ua-time-path" d={path} />
            <circle className="ua-time-sun" cx={2 + minutes / DAY * 22} cy={y(here)} r={3} />
          </svg>
          <span className="ua-time-clock">{clock(at)}</span>
          <span id={`${id}-hint`} className="sr-only">Drag sideways or use the arrow keys to change the time.</span>
        </button>
        {!live && <button type="button" className="ua-time-now" onClick={() => onChange(null)}>Now</button>}
      </div>
      <div id={`${id}-strip`} className="ua-time-card" role="group" aria-label="Lighting time" hidden={!open && !scrubbing}>
        <input type="range" className="ua-time-strip" style={strip} min={0} max={DAY - STEP} step={STEP} value={minutes - minutes % STEP}
          aria-label="Time of day" aria-valuetext={clock(at)} onChange={event => set(Number(event.currentTarget.value))} />
        <div className="ua-time-hours" aria-hidden="true"><span>0</span><span>6</span><span>12</span><span>18</span><span>24</span></div>
      </div>
    </div>
  );
}
