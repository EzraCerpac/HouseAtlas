/** The owner-configured radio station and the helper's now-playing reading.
 * Browsing only reads: GETs of the station and, when its digest changes, the
 * cover. Nothing here starts or controls playback. A reading is believed for
 * 15 seconds after the helper last checked it; past that, or when anything is
 * missing or malformed, the state is unknown. Rings show possible reach from a
 * reviewed placement only; they never claim that any radio is on. */
import type { AtlasScene } from './types';

export const RADIO_FRESH_MS = 15_000;
/** A checkedAt this far ahead of the server's read is not believed. */
const RADIO_FUTURE_MS = 2_000;
export const RADIO_POLL_MS = 4_000;
const RADIO_REQUEST_MS = 10_000;
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
  readonly frequencyKhz: number;
  readonly placement: RadioPlacement | null;
  readonly readAt: string;
  readonly lastCheckedAt: string | null;
  /** Present only when the server read a valid snapshot checked within 15 s. */
  readonly snapshot: RadioSnapshot | null;
}
/** The two GETs the page may send. `read` answers null when no station is configured. */
export interface RadioPort {
  read(scope: RadioScope, signal: AbortSignal): Promise<RadioStation | null>;
  cover(scope: RadioScope, sha256: string, signal: AbortSignal): Promise<Blob>;
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
  const lastTrack = track(r.lastTrack);
  let cover: RadioCoverRef | null = null;
  if ('cover' in r) {
    const c = row(r.cover, ['mediaType', 'sha256']);
    need((c.mediaType === 'image/jpeg' || c.mediaType === 'image/png') && typeof c.sha256 === 'string' && SHA256.test(c.sha256) && lastTrack !== null);
    cover = Object.freeze({ mediaType: c.mediaType, sha256: c.sha256 });
  }
  return Object.freeze({ state, since, checkedAt: date(r.checkedAt), track: track(r.track), lastTrack, cover });
}
/** Closed decode of the station response; anything else throws. */
export function decodeRadioStation(v: Json): RadioStation {
  const r = row(v, ['schema', 'frequencyKhz', 'placement', 'readAt', 'lastCheckedAt', 'snapshot']);
  need(r.schema === 'houseatlas.radio-station.v1');
  const frequencyKhz = r.frequencyKhz;
  need(typeof frequencyKhz === 'number' && Number.isInteger(frequencyKhz) && frequencyKhz >= RADIO_BAND_KHZ[0] && frequencyKhz <= RADIO_BAND_KHZ[1]);
  let placement: RadioPlacement | null = null;
  if (r.placement !== null) {
    const p = row(r.placement, ['publicationId', 'spaceOccurrenceId']);
    need(typeof p.publicationId === 'string' && UUID.test(p.publicationId) && typeof p.spaceOccurrenceId === 'string' && ID.test(p.spaceOccurrenceId));
    placement = Object.freeze({ publicationId: p.publicationId, spaceOccurrenceId: p.spaceOccurrenceId });
  }
  const shot = snapshot(r.snapshot), lastCheckedAt = r.lastCheckedAt === null ? null : date(r.lastCheckedAt);
  need(shot === null || lastCheckedAt === shot.checkedAt);
  return Object.freeze({ frequencyKhz, placement, readAt: date(r.readAt), lastCheckedAt, snapshot: shot });
}

/** What the page last heard. `receivedAt` is on the feed's own monotonic clock. */
export interface RadioFeedState {
  /** null until the first answer; false when no station is configured. */
  readonly configured: boolean | null;
  readonly station: RadioStation | null;
  readonly receivedAt: number;
  readonly cover: { readonly sha256: string; readonly url: string } | null;
}
export type RadioView =
  | { readonly kind: 'none' }
  | { readonly kind: 'on-air'; readonly frequencyKhz: number; readonly track: RadioTrack | null; readonly coverUrl: string | null; readonly checkedAt: string }
  | { readonly kind: 'off-air'; readonly frequencyKhz: number; readonly lastTrack: RadioTrack | null; readonly coverUrl: string | null; readonly checkedAt: string }
  | { readonly kind: 'unknown'; readonly frequencyKhz: number; readonly lastCheckedAt: string | null };

/** Milliseconds since the helper checked, on the server's clock plus the page's
 * own elapsed time since the answer arrived, so the two clocks never mix. */
function age(station: RadioStation, receivedAt: number, now: number): number | null {
  if (!station.snapshot) return null;
  const served = Date.parse(station.readAt) - Date.parse(station.snapshot.checkedAt);
  return served < -RADIO_FUTURE_MS ? null : served + Math.max(0, now - receivedAt);
}
/** When the current reading stops being believed, on the feed clock, or null. */
export function radioExpiry(state: RadioFeedState): number | null {
  const at = state.station && age(state.station, state.receivedAt, state.receivedAt);
  return at === null || at === undefined || at > RADIO_FRESH_MS ? null : state.receivedAt + RADIO_FRESH_MS - at + 1;
}
const sameTrack = (a: RadioTrack | null, b: RadioTrack | null) => a !== null && b !== null && a.title === b.title && a.artist === b.artist;
export function radioView(state: RadioFeedState, now: number): RadioView {
  const station = state.station;
  if (!station) return { kind: 'none' };
  const shot = station.snapshot, elapsed = age(station, state.receivedAt, now);
  if (!shot || elapsed === null || elapsed > RADIO_FRESH_MS || shot.state === 'unknown')
    return { kind: 'unknown', frequencyKhz: station.frequencyKhz, lastCheckedAt: shot?.checkedAt ?? station.lastCheckedAt };
  const coverUrl = shot.cover && state.cover?.sha256 === shot.cover.sha256 ? state.cover.url : null;
  // The cover belongs to lastTrack; on air it shows only while that is the current track.
  if (shot.state === 'playing') return { kind: 'on-air', frequencyKhz: station.frequencyKhz, track: shot.track,
    coverUrl: sameTrack(shot.track, shot.lastTrack) ? coverUrl : null, checkedAt: shot.checkedAt };
  return { kind: 'off-air', frequencyKhz: station.frequencyKhz, lastTrack: shot.lastTrack, coverUrl, checkedAt: shot.checkedAt };
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
 * failed read keeps the last answer, which then ages into unknown. */
export function createRadioFeed(port: RadioPort, scope: RadioScope, env: RadioEnvironment = browserRadioEnvironment(), interval = RADIO_POLL_MS): RadioFeed {
  let state: RadioFeedState = { configured: null, station: null, receivedAt: 0, cover: null };
  const listeners = new Set<() => void>();
  let disposed = false, poll: unknown = null, expiry: unknown = null, inflight: AbortController | null = null;
  let coverRequest: { sha256: string; controller: AbortController } | null = null, coverTried: string | null = null;
  let unvisibility: (() => void) | null = null;
  const notify = () => { for (const changed of [...listeners]) changed(); };
  const set = (next: RadioFeedState) => { if (!disposed) { state = next; notify(); } };
  const watching = () => !disposed && listeners.size > 0 && !env.hidden();
  const clear = (timer: unknown) => { if (timer !== null) env.clearTimeout(timer); return null; };
  function stop() {
    poll = clear(poll);
    inflight?.abort(); inflight = null;
  }
  function schedule(ms: number) {
    poll = clear(poll);
    if (watching()) poll = env.setTimeout(() => { poll = null; void read(); }, ms);
  }
  function armExpiry() {
    expiry = clear(expiry);
    const at = radioExpiry(state);
    if (at !== null) expiry = env.setTimeout(() => { expiry = null; notify(); }, Math.max(0, at - env.now()));
  }
  function wantCover(station: RadioStation | null) {
    const sha = station?.snapshot?.cover?.sha256 ?? null;
    if (sha === null || sha === state.cover?.sha256 || sha === coverRequest?.sha256 || sha === coverTried) return;
    coverRequest?.controller.abort();
    const controller = new AbortController();
    coverRequest = { sha256: sha, controller }; coverTried = sha;
    port.cover(scope, sha, controller.signal).then(blob => {
      if (coverRequest?.controller !== controller || disposed) return;
      coverRequest = null;
      if (state.cover) env.revokeObjectURL(state.cover.url);
      set({ ...state, cover: { sha256: sha, url: env.createObjectURL(blob) } });
    }, () => { if (coverRequest?.controller === controller) coverRequest = null; });
  }
  async function read() {
    if (!watching() || inflight) return;
    const controller = new AbortController();
    inflight = controller;
    const timeout = env.setTimeout(() => controller.abort(), RADIO_REQUEST_MS);
    try {
      const station = await port.read(scope, controller.signal);
      if (inflight !== controller || disposed) return;
      set({ ...state, configured: station !== null, station, receivedAt: env.now() });
      armExpiry();
      wantCover(station);
    } catch {
      // Kept: the last answer ages into unknown on its own.
    } finally {
      env.clearTimeout(timeout);
      if (inflight === controller) { inflight = null; if (state.configured !== false) schedule(interval); }
    }
  }
  function visibility() {
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
      stop(); expiry = clear(expiry); coverRequest?.controller.abort(); coverRequest = null;
      unvisibility?.(); unvisibility = null;
      if (state.cover) env.revokeObjectURL(state.cover.url);
      disposed = true; listeners.clear();
    },
  };
}
