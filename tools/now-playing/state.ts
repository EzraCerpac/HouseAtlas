import { createHash } from 'node:crypto';
import { MAX_DATA_BYTES } from './items.ts';
import type { Item } from './items.ts';

export const SCHEMA = 'houseatlas.now-playing.v1';
export const MAX_COVER_BYTES = MAX_DATA_BYTES; // 256 KiB decoded
const MAX_TEXT = 256; // code points per title/artist

export type Track = { title: string | null; artist: string | null };
export type CoverRef = { mediaType: 'image/jpeg' | 'image/png'; sha256: string };
export type Cover = CoverRef & { bytes: Buffer };
export type Snapshot = {
  schema: typeof SCHEMA;
  state: 'playing' | 'stopped' | 'unknown';
  since: string | null;
  checkedAt: string;
  track: Track | null;
  lastTrack: Track | null;
  cover?: CoverRef;
};

const text = (data: Buffer): string | null => {
  const s = new TextDecoder('utf-8').decode(data).replace(/[\u0000-\u001f\u007f-\u009f]/g, '').trim();
  const cut = [...s].slice(0, MAX_TEXT).join('').trim();
  return cut === '' ? null : cut;
};
export function coverOf(data: Buffer): Cover | null {
  if (data.length === 0 || data.length > MAX_COVER_BYTES) return null;
  const sha256 = createHash('sha256').update(data).digest('hex');
  if (data.length >= 3 && data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff) return { mediaType: 'image/jpeg', sha256, bytes: data };
  if (data.length >= 8 && data.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return { mediaType: 'image/png', sha256, bytes: data };
  return null;
}
/** Sibling file name of a cover in the snapshot's directory. */
export const coverName = (c: CoverRef) => `cover-${c.sha256}.${c.mediaType === 'image/png' ? 'png' : 'jpg'}`;
// Receiver events used as evidence (classic AirPlay and AirPlay 2):
//   playing evidence: `abrt` "bytes/samples/rate" with samples > 0 (compressed audio input is flowing,
//     reported about once a second when bitrate_stats_interval = 1.0). It is the only evidence.
//     `pbeg`, `prsm` and `pres` are not: AirPlay 2 buffered setup emits `pbeg` before any audio flows.
//     `abrt` 0/0/0 is a meter reset: it neither renews nor stops.
//   stopped: `pend` (play end), `pfls` (flush), `aend` (active state ended), `paus` (AirPlay 2 pause).
// `arst` is deliberately not evidence: shairport-sync emits it for any returned frame, silence included.
// The helper expires "playing" to "unknown" (never "stopped") when no evidence renews it in time.
export type Effect = { changed: boolean; renew: boolean };
const ABRT = /^(\d{1,20})\/(\d{1,20})\/(\d{1,10})$/;
const abrtPlaying = (data: Buffer) => {
  const m = ABRT.exec(data.toString('latin1'));
  return m !== null && Number(m[1]) > 0 && Number(m[2]) > 0 && Number(m[3]) > 0;
};
// pcst/mdst/mden carry the source's RTP time as decimal text; items sharing it belong together.
const rtpOf = (data: Buffer): string | null => /^\d{1,20}$/.exec(data.toString('latin1').trim())?.[0] ?? null;

export class NowPlaying {
  private state: Snapshot['state'] = 'unknown';
  private since: number | null = null;
  private lastTrack: Track | null = null;
  private lastRtp: string | null = null; // RTP time of the bundle that gave lastTrack
  private lastId: string | null = null; // source track identifier (core/mper) of lastTrack, when sent
  private seen = false; // a track was committed since the last session end (pend/aend); `track` shows only then
  private lastCover: Cover | null = null; // belongs to lastTrack alone; dropped when the track changes
  private picture: { cover: Cover; rtp: string } | null = null; // classic picture still waiting for its track
  private pictureOpen = false; // between pcst and pcen (classic: the picture carries its own RTP time)
  private pictureRtp: string | null = null; // from that pcst
  // title/artist seen since the last mdst; `cover` is a picture inside the bundle (AirPlay 2): undefined none, null unusable
  private bundle: { track: Track; rtp: string | null; id: string | null; cover?: Cover | null } | null = null;

  get playing() { return this.state === 'playing'; }

  /** Back to "unknown" (startup, pipe EOF). The last track and its own cover are kept; unmatched artwork is not. */
  /** Returns whether the published content changed. A reattach may be a new session, so `track` waits for new metadata. */
  reset(): boolean {
    const before = JSON.stringify(this.content());
    this.state = 'unknown'; this.since = null; this.seen = false; this.clearPending();
    return JSON.stringify(this.content()) !== before;
  }

  private clearPending() {
    this.bundle = null; this.picture = null; this.pictureOpen = false; this.pictureRtp = null; this.lastRtp = null;
  }

  /** "playing" without fresh evidence becomes "unknown"; returns whether that changed. */
  expire(): boolean {
    if (this.state !== 'playing') return false;
    this.state = 'unknown'; this.since = null;
    return true;
  }

  /** Applies one item observed at `now`. */
  apply(item: Item, now: number): Effect {
    const before = JSON.stringify(this.content());
    const { type, code } = item;
    let renew = false;
    if (item.oversize && !(type === 'ssnc' && code === 'PICT')) return { changed: false, renew };
    if (type === 'ssnc') {
      if (code === 'abrt' && abrtPlaying(item.data)) { renew = true; this.set('playing', now); }
      else if (code === 'pend' || code === 'pfls' || code === 'aend' || code === 'paus') {
        this.set('stopped', now);
        if (code === 'pend' || code === 'aend') { this.clearPending(); this.seen = false; } // session boundary: nothing unmatched carries over, and lastTrack is history
      }
      else if (code === 'pbeg') this.clearPending(); // a new stream (also after an unobserved writer restart); not playing evidence
      else if (code === 'mdst') {
        // A picture wrapper never encloses a bundle: an unfinished pcst belongs to a writer that went away.
        this.pictureOpen = false; this.pictureRtp = null;
        this.bundle = { track: { title: null, artist: null }, rtp: rtpOf(item.data), id: null };
      }
      else if (code === 'mden') this.commit();
      else if (code === 'pcst') { this.pictureOpen = true; this.pictureRtp = rtpOf(item.data); }
      else if (code === 'pcen') { this.pictureOpen = false; this.pictureRtp = null; }
      else if (code === 'PICT') this.receive(item.oversize ? null : coverOf(item.data));
    } else if (type === 'core' && code === 'mper') {
      if (this.bundle && item.data.length > 0 && item.data.length <= 16) this.bundle.id = item.data.toString('hex');
    } else if (type === 'core' && (code === 'minm' || code === 'asar')) {
      const open = this.bundle !== null;
      // Outside a bundle, an item updates the current session's track; a new session starts from nothing, not history.
      const base = this.seen && this.lastTrack ? this.lastTrack : { title: null, artist: null };
      const b = this.bundle ?? { track: { ...base }, rtp: null, id: null };
      b.track[code === 'minm' ? 'title' : 'artist'] = text(item.data);
      this.bundle = b;
      if (!open) this.commit(); // tolerate items outside an mdst/mden bundle, updating the last track without an RTP time
    }
    return { changed: JSON.stringify(this.content()) !== before, renew };
  }

  private set(state: 'playing' | 'stopped', now: number) {
    if (this.state !== state) { this.state = state; this.since = now; }
  }
  // A picture is shown only for the track it demonstrably belongs to; otherwise there is no cover.
  //   Classic AirPlay: pcst/PICT/pcen carry an RTP time, matched to the track bundle's (either order).
  //   AirPlay 2: shairport-sync sends the picture inside the mdst..mden bundle of the command that carried it,
  //   with no pcst/pcen; it belongs to that bundle's title and artist.
  //   A picture anywhere else is dropped. An unusable picture withdraws the current cover.
  private receive(cover: Cover | null) {
    if (this.pictureOpen) {
      if (!cover) { this.picture = null; this.lastCover = null; return; }
      const rtp = this.pictureRtp;
      if (rtp === null) { this.picture = null; return; }
      if (rtp === this.lastRtp) { this.lastCover = cover; this.picture = null; } else this.picture = { cover, rtp };
    } else if (this.bundle) this.bundle.cover = cover;
  }
  private commit() {
    const b = this.bundle;
    this.bundle = null;
    if (!b || (b.track.title === null && b.track.artist === null)) return;
    const current = this.seen; // lastTrack belongs to this session, not history
    this.seen = true;
    const prev = this.lastTrack;
    // Same track: committed earlier in this session, same title and artist, and no conflicting source identifier.
    // The identifier (sender-scoped, not always sent) can only tell tracks apart, never join different titles;
    // a missing one keeps the known one. A new session never inherits history's cover.
    const same = current && prev !== null && prev.title === b.track.title && prev.artist === b.track.artist &&
      (b.id === null || this.lastId === null || b.id === this.lastId);
    this.lastTrack = b.track; this.lastRtp = b.rtp; this.lastId = b.id ?? (same ? this.lastId : null);
    if (b.cover !== undefined) { this.lastCover = b.cover; this.picture = null; }
    else if (this.picture && b.rtp !== null && this.picture.rtp === b.rtp) { this.lastCover = this.picture.cover; this.picture = null; }
    else if (!same) { this.lastCover = null; this.picture = null; }
  }
  private content() {
    const cover = this.lastCover ? { mediaType: this.lastCover.mediaType, sha256: this.lastCover.sha256 } : null;
    return { state: this.state, since: this.since, track: this.state === 'playing' && this.seen ? this.lastTrack : null, lastTrack: this.lastTrack, cover };
  }
  /** The bytes of the cover the snapshot references, if any. */
  cover(): Cover | null { return this.lastCover; }
  snapshot(now: number): Snapshot {
    const c = this.content();
    const s: Snapshot = {
      schema: SCHEMA, state: c.state, since: c.since === null ? null : new Date(c.since).toISOString(),
      checkedAt: new Date(now).toISOString(), track: c.track, lastTrack: c.lastTrack,
    };
    if (c.cover) s.cover = c.cover;
    return s;
  }
}
