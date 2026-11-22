/** The station's now-playing card and its reach rings on the stage. Read only:
 * no playback controls, and nothing here sends anything but the feed's GETs.
 * The card shows only while the reading is fresh and on air; the viewer may
 * tuck it to a tab at the stage's left edge, remembered on this device. */
import { useEffect, useRef, useState, useSyncExternalStore, type PointerEvent as ReactPointerEvent } from 'react';
import { dialFraction, radioView, type RadioFeed, type RadioFeedState, type RadioTrack, type RadioView } from './radio';

const clock = (iso: string) => new Date(iso).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit' });
type OnAir = Extract<RadioView, { kind: 'on-air' }>;

/** A medium-wave slide-rule dial, lit while on air. Its text is the card's. */
export function RadioDial({ frequencyKhz, lit }: { readonly frequencyKhz: number; readonly lit: boolean }) {
  const width = 200, left = 8, right = width - 8, at = (khz: number) => left + dialFraction(khz) * (right - left);
  const ticks = [];
  for (let khz = 550; khz <= 1700; khz += 50) {
    const major = khz % 200 === 0, x = at(khz).toFixed(1);
    ticks.push(<line key={khz} x1={x} x2={x} y1={major ? 17 : 19} y2={23} className={major ? 'is-major' : undefined} />);
  }
  const needle = at(frequencyKhz).toFixed(1);
  return <svg className={`ua-radio-dial${lit ? ' is-lit' : ''}`} viewBox={`0 0 ${width} 30`} aria-hidden="true" focusable="false">
    <rect className="ua-radio-glass" x={0.5} y={0.5} width={width - 1} height={29} rx={5} />
    <g className="ua-radio-ticks">{ticks}</g>
    <g className="ua-radio-numerals">
      {[600, 800, 1000, 1200, 1400, 1600].map(khz => <text key={khz} x={at(khz).toFixed(1)} y={12} textAnchor="middle">{khz}</text>)}
    </g>
    <line className="ua-radio-needle" x1={needle} x2={needle} y1={3} y2={27} />
  </svg>;
}

function TrackLines({ track }: { readonly track: RadioTrack | null }) {
  if (!track || (track.title === null && track.artist === null)) return <p className="ua-radio-title is-quiet">No track details</p>;
  return <>
    {track.title !== null && <p className="ua-radio-title">{track.title}</p>}
    {track.artist !== null && <p className="ua-radio-artist">{track.artist}</p>}
  </>;
}

export interface RadioCardProps {
  readonly view: OnAir;
  /** The reviewed transmitter room in the shown publication, or null. */
  readonly placeName: string | null;
  readonly time?: (iso: string) => string;
  readonly onHide?: () => void;
}
export function RadioCard({ view, placeName, time = clock, onHide }: RadioCardProps) {
  return <section className="ua-radio is-on-air" aria-label="Radio">
    <p className="ua-radio-state" role="status"><span className="ua-radio-lamp" aria-hidden="true" />On air · {view.frequencyKhz} kHz</p>
    {onHide && <button type="button" className="ua-radio-hide" aria-label="Hide radio" title="Hide radio" onClick={onHide}><Chevron /></button>}
    <div className="ua-radio-now">
      {view.coverUrl && <img className="ua-radio-cover" src={view.coverUrl} alt="" width={44} height={44} />}
      <div className="ua-radio-track"><TrackLines track={view.track} /></div>
    </div>
    <RadioDial frequencyKhz={view.frequencyKhz} lit />
    <p className="ua-radio-foot">
      <time dateTime={view.checkedAt}>Checked {time(view.checkedAt)}</time>
      {placeName && <span>Transmitter in {placeName}</span>}
    </p>
  </section>;
}
const Chevron = () => <svg className="icon" width={16} height={16} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
  <path d="M9 6l6 6-6 6" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
</svg>;

/** Rings on the floor, in scene metres. They show possible reach only. */
export const RADIO_RING_M = 4.5;
/** Waves leave every 1.2 s; still, they stand evenly spaced and fade outward. */
const RADIO_RINGS = 5, RADIO_RING_GAP_S = 1.2;
export interface RingPlace { readonly transform: string; readonly x: number; readonly z: number }
export function RadioRings({ place, reduced }: { readonly place: RingPlace; readonly reduced: boolean }) {
  const rings = Array.from({ length: RADIO_RINGS }, (_, at) => at);
  return <g className={`ua-radio-rings${reduced ? ' is-still' : ''}`} transform={place.transform}>
    {rings.map(at => <circle key={at} cx={place.x} cy={place.z} vectorEffect="non-scaling-stroke"
      r={reduced ? RADIO_RING_M * (at + 1) / RADIO_RINGS : RADIO_RING_M}
      style={reduced ? { opacity: 1 - at * .15, strokeWidth: 3 - at * .3 } : { animationDelay: `${(-at * RADIO_RING_GAP_S).toFixed(1)}s` }} />)}
  </g>;
}

function useFeed(feed: RadioFeed): RadioFeedState {
  return useSyncExternalStore(feed.subscribe, feed.state, feed.state);
}

/** Whether this viewer tucked the card away. Kept in this browser when it
 * allows; without storage it holds for the page's life. */
const TUCK_KEY = 'houseatlas.radio.tucked';
let tucked: boolean | null = null;
/** What mounts next after a tuck or show: it slides in, and takes focus when
 * the control the viewer used had it. */
let arrival: { readonly to: 'card' | 'tab'; readonly focus: boolean } | null = null;
const tuckListeners = new Set<() => void>();
const isTucked = () => {
  if (tucked === null) { try { tucked = globalThis.localStorage?.getItem(TUCK_KEY) === '1'; } catch { tucked = false; } }
  return tucked;
};
function setTucked(next: boolean, focus: boolean) {
  if (next === isTucked()) return;
  tucked = next; arrival = { to: next ? 'tab' : 'card', focus };
  try { if (next) globalThis.localStorage?.setItem(TUCK_KEY, '1'); else globalThis.localStorage?.removeItem(TUCK_KEY); } catch { /* kept for this page */ }
  for (const changed of [...tuckListeners]) changed();
}
const subscribeTuck = (changed: () => void) => { tuckListeners.add(changed); return () => { tuckListeners.delete(changed); }; };
const useTucked = () => useSyncExternalStore(subscribeTuck, isTucked, () => false);
/** Read once on mount: whether this element is the one just brought in. */
function useArrival(to: 'card' | 'tab', focus: () => void): boolean {
  const [arrived] = useState(() => arrival?.to === to);
  useEffect(() => {
    if (arrival?.to !== to) return;
    const take = arrival.focus; arrival = null;
    if (take) focus();
  }, []);
  return arrived;
}

/** A horizontal drag on the card or tab. It follows the pointer; a mostly
 * vertical move is left to the rail and page. */
interface Drag { readonly id: number; readonly x: number; readonly y: number; dx: number; t: number; v: number; on: boolean }
function startDrag(event: ReactPointerEvent<HTMLElement>): Drag | null {
  if (!event.isPrimary || event.button !== 0 || (event.target as Element).closest('.ua-radio-hide')) return null;
  return { id: event.pointerId, x: event.clientX, y: event.clientY, dx: 0, t: event.timeStamp, v: 0, on: false };
}
function moveDrag(drag: Drag, event: ReactPointerEvent<HTMLElement>): boolean {
  if (event.pointerId !== drag.id) return false;
  const dx = event.clientX - drag.x, dy = event.clientY - drag.y;
  if (!drag.on) {
    if (Math.abs(dx) < 8 || Math.abs(dx) < Math.abs(dy)) return false;
    drag.on = true;
    event.currentTarget.setPointerCapture(event.pointerId);
  }
  drag.v = (dx - drag.dx) / Math.max(1, event.timeStamp - drag.t); drag.dx = dx; drag.t = event.timeStamp;
  return true;
}

const SLIDE_MS = 220;
function TuckableCard({ view, placeName, reduced }: { readonly view: OnAir; readonly placeName: string | null; readonly reduced: boolean }) {
  const host = useRef<HTMLDivElement>(null), drag = useRef<Drag | null>(null), timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const arrived = useArrival('card', () => host.current?.querySelector<HTMLButtonElement>('.ua-radio-hide')?.focus());
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);
  const place = (x: number, ms = 0) => {
    const el = host.current; if (!el) return;
    el.style.transition = ms && !reduced ? `transform ${ms}ms cubic-bezier(0.3, 0, 0.2, 1)` : 'none';
    el.style.transform = x ? `translateX(${x}px)` : '';
  };
  const tuck = () => {
    const el = host.current, focus = !!el?.contains(document.activeElement);
    if (!el || reduced) { setTucked(true, focus); return; }
    place(-(el.offsetWidth + 32), SLIDE_MS);
    timer.current = setTimeout(() => setTucked(true, focus), SLIDE_MS);
  };
  const release = () => { drag.current = null; host.current?.classList.remove('is-dragging'); };
  return <div ref={host} className={`ua-radio-dock${arrived && !reduced ? ' is-arriving' : ''}`}
    onPointerDown={event => { drag.current = startDrag(event); }}
    onPointerMove={event => { const d = drag.current; if (d && moveDrag(d, event)) { host.current?.classList.add('is-dragging'); place(Math.min(0, d.dx)); } }}
    onPointerUp={event => {
      const d = drag.current; release();
      if (!d?.on || event.pointerId !== d.id) return;
      if (d.dx < -Math.min(96, (host.current?.offsetWidth ?? 240) * 0.35) || (d.dx < -24 && d.v < -0.45)) tuck(); else place(0, 160);
    }}
    onPointerCancel={() => { if (drag.current?.on) place(0, 160); release(); }}>
    <RadioCard view={view} placeName={placeName} onHide={tuck} />
  </div>;
}
function RadioTab({ reduced }: { readonly reduced: boolean }) {
  const button = useRef<HTMLButtonElement>(null), drag = useRef<Drag | null>(null);
  const arrived = useArrival('tab', () => button.current?.focus());
  const show = () => setTucked(false, button.current === document.activeElement);
  const nudge = (x: number) => { if (button.current) button.current.style.transform = x ? `translateX(${x}px)` : ''; };
  return <button ref={button} type="button" className={`ua-radio-tab${arrived && !reduced ? ' is-arriving' : ''}`} aria-label="Show radio" title="Show radio"
    onClick={show}
    onPointerDown={event => { drag.current = startDrag(event); }}
    onPointerMove={event => { const d = drag.current; if (d && moveDrag(d, event)) nudge(Math.max(0, Math.min(24, d.dx))); }}
    onPointerUp={event => { const d = drag.current; drag.current = null; nudge(0); if (d?.on && event.pointerId === d.id && d.dx > 24) show(); }}
    onPointerCancel={() => { drag.current = null; nudge(0); }}>
    <span className="ua-radio-lamp" aria-hidden="true" /><Chevron />
  </button>;
}

/** Subscribing starts the feed's polling; unmounting the Atlas stops it. */
export function RadioCardSlot({ feed, placeName, now, reduced }: {
  readonly feed: RadioFeed; readonly placeName: (state: RadioFeedState) => string | null; readonly now: () => number; readonly reduced: boolean;
}) {
  const state = useFeed(feed), view = radioView(state, now()), hidden = useTucked();
  if (view.kind !== 'on-air') return null;
  return hidden ? <RadioTab reduced={reduced} /> : <TuckableCard view={view} placeName={placeName(state)} reduced={reduced} />;
}
export function RadioRingsSlot({ feed, place, now, reduced }: {
  readonly feed: RadioFeed; readonly place: (state: RadioFeedState) => RingPlace | null; readonly now: () => number; readonly reduced: boolean;
}) {
  const state = useFeed(feed), at = radioView(state, now()).kind === 'on-air' ? place(state) : null;
  return at ? <RadioRings place={at} reduced={reduced} /> : null;
}
