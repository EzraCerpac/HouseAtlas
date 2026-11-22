/** The owner-configured radio station and the helper's now-playing reading.
 * Browsing only reads: GETs of the station and, while it would show, its cover.
 * Nothing here starts or controls playback. Playing means AirPlay audio is
 * arriving at the helper; the frequency is what the operator stated. Neither
 * says that anything is broadcast. A reading is believed until 15 seconds after
 * the helper last checked it, counted from when the page asked; past that, or
 * when anything is missing, malformed or refused, nothing shows. Rings show
 * possible reach from a reviewed placement only. */
import type { AtlasScene } from './types';

export const RADIO_FRESH_MS = 15_000;
export const RADIO_POLL_MS = 4_000;
const RADIO_REQUEST_MS = 10_000;
/** Attempts per cover digest; a later poll may retry after a failed one. */
const RADIO_COVER_TRIES = 3;
/** The medium-wave band the dial draws, inclusive. */
export const RADIO_BAND_KHZ = [520, 1710] as const;

export interface RadioScope { readonly workspaceId: string; readonly homeId: string }
export interface RadioTrack { readonly title: string | null; readonly artist: string | null }
export interface RadioCoverRef { readonly mediaType: 'image/jpeg' | 'image/png'; readonly sha256: string }
export interface RadioSnapshot {
  readonly state: 'playing' | 'stopped' | 'unknown';
  readonly since: string | null;
  readonly checkedAt: string;
  readonly track: RadioTrack | null;
  readonly lastTrack: RadioTrack | null;
  /** The cover of `lastTrack`, by digest. */
  readonly cover: RadioCoverRef | null;
}
export interface RadioPlacement { readonly publicationId: string; readonly spaceOccurrenceId: string }
/** `houseatlas.radio-station.v1`: station facts plus one passive read. */
export interface RadioStation {
  /** What the operator's station file states, or null when it is absent or unusable. */
  readonly frequencyKhz: number | null;
  readonly placement: RadioPlacement | null;
  readonly readAt: string;
  /** Present only when the server read a valid snapshot checked within 15 s. */
  readonly snapshot: RadioSnapshot | null;
}
/** The two GETs the page may send. `read` answers null when no station is
 * configured and throws RadioRefused when the viewer may not read it. */
export interface RadioPort {
  read(scope: RadioScope, signal: AbortSignal): Promise<RadioStation | null>;
  cover(scope: RadioScope, sha256: string, signal: AbortSignal): Promise<Blob>;
  /** The signed-in viewer, whose card choice this device keeps per home; null keeps it for the page only. */
  viewer?(): string | null;
}
/** A station or cover read was refused (401 or 403): nothing of the last reading is kept. */
export class RadioRefused extends Error {
  constructor() { super('Radio station read refused'); this.name = 'RadioRefused'; }
}

function need(ok: unknown): asserts ok { if (!ok) throw new TypeError('Radio station response unavailable'); }
type Json = null | boolean | number | string | readonly Json[] | { readonly [key: string]: Json };
type Row = { readonly [key: string]: Json };
function row(v: Json | undefined, keys: readonly string[], optional: readonly string[] = []): Row {
  need(v !== null && typeof v === 'object' && !Array.isArray(v));
  const object = v as Row;
  need(keys.every(key => key in object) && Object.keys(object).every(key => keys.includes(key) || optional.includes(key)));
  return object;
}
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const ID = /^[A-Za-z0-9\-_.:]{1,128}$/;
const SHA256 = /^[0-9a-f]{64}$/;
// RFC 3339 with an explicit zone, as both the helper and the server write it.
const DATE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/;
function date(v: Json | undefined): string { need(typeof v === 'string' && DATE.test(v) && Number.isFinite(Date.parse(v))); return v; }
function text(v: Json | undefined): string | null {
  if (v === null) return null;
  // eslint-disable-next-line no-control-regex
  need(typeof v === 'string' && [...v].length <= 256 && !/[\u0000-\u001f\u007f-\u009f]/.test(v));
  return v;
}
function track(v: Json | undefined): RadioTrack | null {
  if (v === null) return null;
  const r = row(v, ['title', 'artist']);
  return Object.freeze({ title: text(r.title), artist: text(r.artist) });
}
function snapshot(v: Json | undefined): RadioSnapshot | null {
  if (v === null) return null;
  const r = row(v, ['schema', 'state', 'since', 'checkedAt', 'track', 'lastTrack'], ['cover']);
  need(r.schema === 'houseatlas.now-playing.v1');
  need(r.state === 'playing' || r.state === 'stopped' || r.state === 'unknown');
  const state = r.state, since = r.since === null ? null : date(r.since);
  need((state === 'unknown') === (since === null));
  const lastTrack = track(r.lastTrack), current = track(r.track);
  need(state === 'playing' || current === null); // the current track exists only while playing
  let cover: RadioCoverRef | null = null;
  if ('cover' in r) {
    const c = row(r.cover, ['mediaType', 'sha256']);
    need((c.mediaType === 'image/jpeg' || c.mediaType === 'image/png') && typeof c.sha256 === 'string' && SHA256.test(c.sha256) && lastTrack !== null);
    cover = Object.freeze({ mediaType: c.mediaType, sha256: c.sha256 });
  }
  return Object.freeze({ state, since, checkedAt: date(r.checkedAt), track: current, lastTrack, cover });
}
/** Closed decode of the station response; anything else throws. */
export function decodeRadioStation(v: Json): RadioStation {
  const r = row(v, ['schema', 'frequencyKhz', 'placement', 'readAt', 'snapshot']);
  need(r.schema === 'houseatlas.radio-station.v1');
  const frequencyKhz = r.frequencyKhz;
  need(frequencyKhz === null || (typeof frequencyKhz === 'number' && Number.isInteger(frequencyKhz) && frequencyKhz >= RADIO_BAND_KHZ[0] && frequencyKhz <= RADIO_BAND_KHZ[1]));
  let placement: RadioPlacement | null = null;
  if (r.placement !== null) {
    const p = row(r.placement, ['publicationId', 'spaceOccurrenceId']);
    need(typeof p.publicationId === 'string' && UUID.test(p.publicationId) && typeof p.spaceOccurrenceId === 'string' && ID.test(p.spaceOccurrenceId));
    placement = Object.freeze({ publicationId: p.publicationId, spaceOccurrenceId: p.spaceOccurrenceId });
  }
  return Object.freeze({ frequencyKhz, placement, readAt: date(r.readAt), snapshot: snapshot(r.snapshot) });
}

/** What the page last heard. */
export interface RadioFeedState {
  /** null until the first answer; false when no station is configured. */
  readonly configured: boolean | null;
  readonly station: RadioStation | null;
  /** Until when the reading is believed, on the feed's own monotonic clock; null once it is not. */
  readonly freshUntil: number | null;
  readonly cover: { readonly sha256: string; readonly url: string } | null;
}
/** What the card shows: only a fresh playing reading has one. */
export interface RadioOnAir {
  readonly frequencyKhz: number | null;
  readonly track: RadioTrack | null;
  readonly coverUrl: string | null;
  readonly checkedAt: string;
}

/** Until when an answer to a request sent at `sentAt` is believed: the
 * server's age at its read is counted from the send, so waiting for the answer
 * never extends it. A check ahead of the server's read counts as age 0. */
export function radioFreshUntil(station: RadioStation | null, sentAt: number): number | null {
  const shot = station?.snapshot;
  if (!station || !shot) return null;
  const age = Math.max(0, Date.parse(station.readAt) - Date.parse(shot.checkedAt));
  return age > RADIO_FRESH_MS ? null : sentAt + RADIO_FRESH_MS - age;
}
const sameTrack = (a: RadioTrack | null, b: RadioTrack | null) => a !== null && b !== null && a.title === b.title && a.artist === b.artist;
/** The cover belongs to lastTrack; it shows only while that is the current track. */
function shownCover(state: RadioFeedState, now: number): string | null {
  const shot = state.station?.snapshot;
  return shot?.cover && radioView(state, now) && sameTrack(shot.track, shot.lastTrack) ? shot.cover.sha256 : null;
}
export function radioView(state: RadioFeedState, now: number): RadioOnAir | null {
  const station = state.station, shot = station?.snapshot;
  if (!station || !shot || shot.state !== 'playing' || state.freshUntil === null || now > state.freshUntil) return null;
  const cover = shot.cover && sameTrack(shot.track, shot.lastTrack) && state.cover?.sha256 === shot.cover.sha256 ? state.cover.url : null;
  return { frequencyKhz: station.frequencyKhz, track: shot.track, coverUrl: cover, checkedAt: shot.checkedAt };
}
/** The reviewed occurrence in this exact publication, or null. Never inferred. */
export function radioPlacement(station: RadioStation | null, scene: AtlasScene): string | null {
  const placement = station?.placement;
  if (!placement || placement.publicationId !== scene.publication.publicationId) return null;
  return scene.occurrences.some(row => row.spaceOccurrenceId === placement.spaceOccurrenceId) ? placement.spaceOccurrenceId : null;
}
/** The needle's place along the dial, 0 at the band's low end. */
export function dialFraction(frequencyKhz: number): number {
  return Math.min(1, Math.max(0, (frequencyKhz - RADIO_BAND_KHZ[0]) / (RADIO_BAND_KHZ[1] - RADIO_BAND_KHZ[0])));
}

export interface RadioEnvironment {
  now(): number;
  hidden(): boolean;
  onVisibility(changed: () => void): () => void;
  setTimeout(run: () => void, ms: number): unknown;
  clearTimeout(timer: unknown): void;
  createObjectURL(blob: Blob): string;
  revokeObjectURL(url: string): void;
}
export function browserRadioEnvironment(): RadioEnvironment {
  return {
    now: () => performance.now(),
    hidden: () => document.visibilityState === 'hidden',
    onVisibility(changed) { document.addEventListener('visibilitychange', changed); return () => document.removeEventListener('visibilitychange', changed); },
    setTimeout: (run, ms) => globalThis.setTimeout(run, ms),
    clearTimeout: timer => globalThis.clearTimeout(timer as ReturnType<typeof setTimeout>),
    createObjectURL: blob => URL.createObjectURL(blob),
    revokeObjectURL: url => URL.revokeObjectURL(url),
  };
}
export interface RadioFeed {
  subscribe(changed: () => void): () => void;
  state(): RadioFeedState;
  dispose(): void;
}
/** Polls only while someone watches and the page is visible: about every four
 * seconds, one request at a time, and at once when the page shows again. A
 * failed read keeps the last answer until it expires, which publishes a new
 * state. A refused station or cover read drops it at once and stops polling
 * until the feed is made again (the Atlas remounts) or, when the page shows
 * again or is watched again, the signed-in viewer has changed. */
export function createRadioFeed(port: RadioPort, scope: RadioScope, env: RadioEnvironment = browserRadioEnvironment(), interval = RADIO_POLL_MS): RadioFeed {
  let state: RadioFeedState = { configured: null, station: null, freshUntil: null, cover: null };
  const listeners = new Set<() => void>();
  let disposed = false, poll: unknown = null, expiry: unknown = null, inflight: AbortController | null = null;
  let coverRequest: { sha256: string; controller: AbortController } | null = null, coverFailures = { sha256: '', count: 0 };
  let unvisibility: (() => void) | null = null;
  /** Set by a refusal, with the viewer it was refused to. */
  let refused: { readonly viewer: string | null } | null = null;
  const notify = () => { for (const changed of [...listeners]) changed(); };
  const set = (next: RadioFeedState) => { if (!disposed) { state = next; notify(); } };
  const watching = () => !disposed && refused === null && listeners.size > 0 && !env.hidden();
  const clear = (timer: unknown) => { if (timer !== null) env.clearTimeout(timer); return null; };
  /** Stopped on purpose, so not counted as a failure. */
  function dropCover() {
    const request = coverRequest;
    coverRequest = null; request?.controller.abort();
  }
  function stop() {
    poll = clear(poll);
    inflight?.abort(); inflight = null;
    dropCover();
  }
  function schedule(ms: number) {
    poll = clear(poll);
    if (watching()) poll = env.setTimeout(() => { poll = null; void read(); }, ms);
  }
  function armExpiry() {
    expiry = clear(expiry);
    const until = state.freshUntil;
    if (until !== null) expiry = env.setTimeout(() => { expiry = null; set({ ...state, freshUntil: null }); wantCover(); }, Math.max(0, until - env.now() + 1));
  }
  function forget() {
    dropCover(); expiry = clear(expiry);
    if (state.cover) env.revokeObjectURL(state.cover.url);
    set({ configured: null, station: null, freshUntil: null, cover: null });
  }
  function refuse() {
    refused = { viewer: port.viewer?.() ?? null };
    stop(); forget();
  }
  /** Fetches the cover the view would show and aborts one it no longer would
   * (stopped, expired, another track). The feed does not know whether the card
   * is tucked: tucking is presentation only, so a tucked card's cover still
   * loads and shows at once when the card comes back. */
  function wantCover() {
    const sha = watching() ? shownCover(state, env.now()) : null;
    if (coverRequest && coverRequest.sha256 !== sha) dropCover();
    if (sha === null || sha === state.cover?.sha256 || coverRequest) return;
    if (coverFailures.sha256 === sha && coverFailures.count >= RADIO_COVER_TRIES) return;
    const controller = new AbortController(), deadline = env.setTimeout(() => controller.abort(), RADIO_REQUEST_MS);
    coverRequest = { sha256: sha, controller };
    port.cover(scope, sha, controller.signal).then(blob => {
      env.clearTimeout(deadline);
      if (coverRequest?.controller !== controller || disposed) return;
      coverRequest = null;
      if (state.cover) env.revokeObjectURL(state.cover.url);
      set({ ...state, cover: { sha256: sha, url: env.createObjectURL(blob) } });
    }, error => {
      env.clearTimeout(deadline);
      if (coverRequest?.controller !== controller) return;
      coverRequest = null;
      if (error instanceof RadioRefused) { refuse(); return; }
      coverFailures = { sha256: sha, count: coverFailures.sha256 === sha ? coverFailures.count + 1 : 1 };
    });
  }
  async function read() {
    if (!watching() || inflight) return;
    const controller = new AbortController(), sentAt = env.now();
    inflight = controller;
    const timeout = env.setTimeout(() => controller.abort(), RADIO_REQUEST_MS);
    try {
      const station = await port.read(scope, controller.signal);
      if (inflight !== controller || disposed) return;
      const until = radioFreshUntil(station, sentAt);
      set({ ...state, configured: station !== null, station, freshUntil: until !== null && until >= env.now() ? until : null });
      armExpiry();
      wantCover();
    } catch (error) {
      // Refused: drop the reading now and stop. Otherwise it is kept until it expires.
      if (inflight === controller && !disposed && error instanceof RadioRefused) refuse();
    } finally {
      env.clearTimeout(timeout);
      if (inflight === controller) { inflight = null; if (state.configured !== false) schedule(interval); }
    }
  }
  function visibility() {
    if (refused && !disposed && (port.viewer?.() ?? null) !== refused.viewer) refused = null;
    if (watching()) { if (!inflight && poll === null) void read(); } else stop();
  }
  return {
    subscribe(changed) {
      listeners.add(changed);
      if (listeners.size === 1 && !disposed) { unvisibility = env.onVisibility(visibility); visibility(); }
      return () => {
        listeners.delete(changed);
        if (listeners.size === 0) { stop(); unvisibility?.(); unvisibility = null; }
      };
    },
    state: () => state,
    dispose() {
      if (disposed) return;
      stop(); expiry = clear(expiry);
      unvisibility?.(); unvisibility = null;
      if (state.cover) env.revokeObjectURL(state.cover.url);
      disposed = true; listeners.clear();
    },
  };
}
