import { useEffect, useId, useRef, useState, type FocusEvent, type KeyboardEvent } from 'react';
import { getTimes } from 'suncalc';
import { Icon } from '../components/Icon';
import type { SunPlace } from './daylight';

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
const day = (at: Date) => `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}`;
/** Minutes after local midnight; the slider moves in steps of this many. */
const STEP = 5;

/** The lighting time: a button showing the hour the house is lit for, and a
 * panel to drag through the day, pick a date or return to now. */
export function DaylightControl({ at, live, night, place, onChange }: {
  readonly at: Date; readonly live: boolean; readonly night: boolean; readonly place: SunPlace;
  readonly onChange: (at: Date | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const button = useRef<HTMLButtonElement>(null);
  const id = useId();
  const minutes = at.getHours() * 60 + at.getMinutes();
  const times = getTimes(at, place.latitude, place.longitude);
  const close = () => { setOpen(false); button.current?.focus({ preventScroll: true }); };
  const keys = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key !== 'Escape' || !open) return;
    event.preventDefault(); event.stopPropagation(); close();
  };
  const blur = (event: FocusEvent<HTMLElement>) => {
    if (open && event.relatedTarget instanceof Node && !event.currentTarget.contains(event.relatedTarget)) setOpen(false);
  };
  useEffect(() => {
    if (!open) return;
    const away = (event: PointerEvent) => { if (!(event.target instanceof Node) || !button.current?.parentElement?.contains(event.target)) setOpen(false); };
    document.addEventListener('pointerdown', away, true);
    return () => document.removeEventListener('pointerdown', away, true);
  }, [open]);
  return (
    <div className="ua-daylight" onKeyDown={keys} onBlur={blur}>
      <button ref={button} type="button" className={`ctrl-btn ctrl-wide ua-daylight-btn${live ? '' : ' is-picked'}`}
        aria-expanded={open} aria-controls={`${id}-panel`} aria-label={`Lighting time ${clock(at)}${live ? ', now' : ''}`}
        onClick={() => setOpen(value => !value)}>
        <Icon name={night ? 'moon' : 'sun'} size={17} /><span>{clock(at)}</span>
      </button>
      <div id={`${id}-panel`} className="ua-menu-panel ua-daylight-panel" hidden={!open} role="group" aria-label="Lighting time">
        <label className="ua-daylight-row">
          <span>Time</span>
          <input type="range" min={0} max={24 * 60 - STEP} step={STEP} value={minutes - minutes % STEP}
            aria-valuetext={clock(at)} onChange={event => {
              const value = Number(event.currentTarget.value), next = new Date(at);
              next.setHours(Math.floor(value / 60), value % 60, 0, 0); onChange(next);
            }} />
          <output>{clock(at)}</output>
        </label>
        <label className="ua-daylight-row">
          <span>Date</span>
          <input type="date" value={day(at)} required onChange={event => {
            const [y, m, d] = event.currentTarget.value.split('-').map(Number);
            if (!y || !m || !d) return;
            const next = new Date(at); next.setFullYear(y, m - 1, d); onChange(next);
          }} />
        </label>
        <p className="ua-daylight-sun">
          {times.sunrise && times.sunset
            ? <>Sunrise <time dateTime={times.sunrise.toISOString()}>{clock(times.sunrise)}</time>, sunset <time dateTime={times.sunset.toISOString()}>{clock(times.sunset)}</time></>
            : times.alwaysUp ? 'The sun stays up all day.' : 'The sun stays down all day.'}
        </p>
        <button type="button" className="btn ua-daylight-now" disabled={live} onClick={() => onChange(null)}>Now</button>
      </div>
    </div>
  );
}
