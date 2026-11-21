/** The station's now-playing card and its reach rings on the stage. Read only:
 * no playback controls, and nothing here sends anything but the feed's GETs. */
import { useSyncExternalStore } from 'react';
import { dialFraction, radioView, type RadioFeed, type RadioFeedState, type RadioTrack, type RadioView } from './radio';

const clock = (iso: string) => new Date(iso).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit' });
const stateText = (view: Exclude<RadioView, { kind: 'none' }>) =>
  `${view.kind === 'on-air' ? 'On air' : view.kind === 'off-air' ? 'Off air' : 'Unknown'} · ${view.frequencyKhz} kHz`;

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
  readonly view: Exclude<RadioView, { kind: 'none' }>;
  /** The reviewed transmitter room in the shown publication, or null. */
  readonly placeName: string | null;
  readonly time?: (iso: string) => string;
}
export function RadioCard({ view, placeName, time = clock }: RadioCardProps) {
  const onAir = view.kind === 'on-air', shown = view.kind === 'on-air' ? view.track : view.kind === 'off-air' ? view.lastTrack : null;
  const coverUrl = view.kind === 'unknown' ? null : view.coverUrl;
  return <section className={`ua-radio is-${view.kind}`} aria-label="Radio">
    <p className="ua-radio-state" role="status"><span className="ua-radio-lamp" aria-hidden="true" />{stateText(view)}</p>
    {view.kind !== 'unknown' && <div className="ua-radio-now">
      {coverUrl && <img className="ua-radio-cover" src={coverUrl} alt="" width={44} height={44} />}
      <div className="ua-radio-track">
        {view.kind === 'off-air' && <p className="ua-radio-kicker">Last played</p>}
        <TrackLines track={shown} />
      </div>
    </div>}
    <RadioDial frequencyKhz={view.frequencyKhz} lit={onAir} />
    <p className="ua-radio-foot">
      {view.kind === 'unknown'
        ? view.lastCheckedAt ? <time dateTime={view.lastCheckedAt}>Last confirmed {time(view.lastCheckedAt)}</time> : <span>Not confirmed</span>
        : <time dateTime={view.checkedAt}>Checked {time(view.checkedAt)}</time>}
      {placeName && <span>Transmitter in {placeName}</span>}
    </p>
  </section>;
}

/** Soft rings on the floor, in scene metres. They show possible reach only. */
export const RADIO_RING_M = 4.5;
export interface RingPlace { readonly transform: string; readonly x: number; readonly z: number }
export function RadioRings({ place, reduced }: { readonly place: RingPlace; readonly reduced: boolean }) {
  const rings = [0, 1, 2];
  return <g className={`ua-radio-rings${reduced ? ' is-still' : ''}`} transform={place.transform}>
    {rings.map(at => <circle key={at} cx={place.x} cy={place.z} vectorEffect="non-scaling-stroke"
      r={reduced ? RADIO_RING_M * (at + 1) / rings.length : RADIO_RING_M}
      style={reduced ? { opacity: .6 - at * .18 } : { animationDelay: `${(-at * 1.2).toFixed(1)}s` }} />)}
  </g>;
}

function useFeed(feed: RadioFeed): RadioFeedState {
  return useSyncExternalStore(feed.subscribe, feed.state, feed.state);
}
/** Subscribing starts the feed's polling; unmounting the Atlas stops it. */
export function RadioCardSlot({ feed, placeName, now }: { readonly feed: RadioFeed; readonly placeName: (state: RadioFeedState) => string | null; readonly now: () => number }) {
  const state = useFeed(feed), view = radioView(state, now());
  return view.kind === 'none' ? null : <RadioCard view={view} placeName={placeName(state)} />;
}
export function RadioRingsSlot({ feed, place, now, reduced }: {
  readonly feed: RadioFeed; readonly place: (state: RadioFeedState) => RingPlace | null; readonly now: () => number; readonly reduced: boolean;
}) {
  const state = useFeed(feed), at = radioView(state, now()).kind === 'on-air' ? place(state) : null;
  return at ? <RadioRings place={at} reduced={reduced} /> : null;
}
