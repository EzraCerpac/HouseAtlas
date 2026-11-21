# Now-playing helper

One small Node 26.10.0 process reads shairport-sync's metadata pipe
and atomically replaces one bounded JSON snapshot file.
It has no listener, database, network access or playback control,
and it knows nothing about radio frequency, rooms or placement.
A reader (a later, separately reviewed backend route) reads the file; the helper never serves it.
This is G0 source work only, releasing none of G1–G5.
There is no installation, launchd configuration or shairport-sync configuration in this repository.
Do not run the commands below against household files before operational approval.

Runtime dependencies: Node built-ins only, using native TypeScript stripping:

```sh
node tools/now-playing/main.ts --pipe /absolute/path/to/shairport-sync-metadata --snapshot /absolute/path/to/now-playing.json
```

SIGTERM/SIGINT stop reading, cancel timers and leave a final `unknown` snapshot.

## Flags

Exactly two, each an absolute normalized path of at most 4096 characters, and different.
The snapshot's file name must not look like a cover file (see Snapshot contract).
Validation errors use fixed messages without input values.

`--pipe` must be a FIFO created by shairport-sync (`metadata` group, `enabled = "yes"`, `pipe_name`).
The shairport-sync configuration must also set `bitrate_stats_interval = 1.0` (see Freshness rule).
The helper opens it read-write and non-blocking, so it never waits for shairport-sync,
is always an attached reader (shairport-sync opens its write end only when it has metadata,
and would get ENXIO if no reader existed, losing that metadata) and never sees end-of-file
when shairport-sync's writer closes or restarts. If the FIFO is missing at startup or a read fails,
state is `unknown` and the helper retries every second. It polls with `fs.read` into one reused buffer
(every 100 ms while the pipe is empty) because `net.Socket` does not behave reliably on FIFOs on macOS.
The snapshot's directory must exist and should be dedicated to the helper (it also holds the cover files);
files are created mode 0600 under umask 077, so the reader must run as the same user.

## Snapshot contract

`houseatlas.now-playing.v1`, closed, small (typically well under 1 KiB, at most 8 KiB):

```json
{
  "schema": "houseatlas.now-playing.v1",
  "state": "playing",
  "since": "2026-01-01T12:00:02.000Z",
  "checkedAt": "2026-01-01T12:00:10.000Z",
  "track": { "title": "Example title", "artist": "Example artist" },
  "lastTrack": { "title": "Example title", "artist": "Example artist" },
  "cover": { "mediaType": "image/jpeg", "sha256": "<64 lowercase hex digits>" }
}
```

- `state`: `playing`, `stopped` or `unknown`.
- `since`: when the helper observed the event that set the current state; null for `unknown`.
  The pipe carries no source timestamps, so this is the helper's receipt time, not the song's start.
- `checkedAt`: helper heartbeat time, rewritten every 5 seconds.
  It shows the helper is alive and never implies anything is playing.
- `track`: the current track while `playing`, otherwise null.
  It is a track committed in the current session only: `pend` and `aend` end a session, and a new session
  without metadata shows `track` null until a title or artist arrives (metadata that arrives before `pbeg` counts).
  Within one session the previous track stays until the next metadata arrives, so `track` can lag a track change.
- `lastTrack`: the most recent track seen, kept as history across sessions, when stopped or unknown;
  null until a title or artist arrives after the helper first starts.
  `title` or `artist` is null when the source sent none.
  Text is stripped of control characters and cut at 256 characters.
- `cover`: omitted when absent. The image is not in the snapshot: the helper writes its bytes once per change to
  `cover-<sha256 hex>.jpg` or `.png` (`.png` for `image/png`) in the snapshot's directory, mode 0600,
  before the snapshot that names it. Readers open `<dir>/cover-<sha256>.<ext>` and must verify that the bytes' SHA-256
  equals `sha256` and that their magic bytes match `mediaType`, otherwise treat the cover as absent
  (the file can be missing or replaced between reading the snapshot and the file).
  The helper removes every file named `cover-<64 hex>.jpg|png` in that directory that the snapshot no longer names,
  after writing the snapshot that stops naming it, and at startup; it never removes any other name,
  so give the helper its own directory.
  `mediaType` is `image/jpeg` or `image/png`, decided by the picture's magic bytes, never by metadata.
  At most 256 KiB decoded; larger or unrecognised pictures leave the cover absent.
  A cover belongs to the track it was matched to and is dropped when the track changes
  (a different title or artist, or a different `mper` source track identifier when both carry one):
  - Classic AirPlay: published only when the picture (`pcst`) and the track bundle (`mdst`) carry the same RTP time,
    in either order; a picture without a matching RTP time, or before any track, is omitted.
  - AirPlay 2: shairport-sync sends the picture inside the `mdst`..`mden` bundle of the command that carried it,
    with no RTP time; it belongs to that bundle's title and artist. A picture outside a bundle is omitted.
    The picture is shairport-sync's current now-playing state, so a late picture for an earlier item cannot be told apart;
    the source gives no finer grouping. Artwork it does not resend (unchanged image) leaves a new track without a cover.
  - Unmatched pictures, open bundles and RTP matches are discarded at `pend`, `aend`, a new stream (`pbeg`,
    which also follows a writer restart the helper cannot observe) and when the pipe is reattached,
    so a reused RTP time never gives an old cover to a new title. A new bundle also closes an unfinished picture wrapper.
- Not carried: album, volume, progress, history, client identity, addresses.

## Freshness rule

`playing` means recent compressed audio input reported by the receiver, nothing more:
- `ssnc/abrt` with a well-formed `bytes/samples/rate` payload and samples above zero is the evidence.
  Classic AirPlay (realtime) and AirPlay 2 (realtime and buffered) send it while audio is read;
  shairport-sync does so only when `bitrate_stats_interval` is nonzero, so the configuration must set `1.0`.
  Classic uncompressed (PCM) input never produces `abrt` and so is never reported as playing.
  A buffered AirPlay 2 stream is read at roughly playback pace, but the report follows input, not the speakers.
- Each `abrt` report renews `playing` for 5 seconds.
  A separate deadline timer then publishes `unknown` (never `stopped`) at once, not at the next heartbeat.
- `pbeg`, `prsm` and AirPlay 2 `pres` are not evidence: AirPlay 2 emits `pbeg` before any audio flows.
- `abrt` `0/0/0` (a meter reset) neither renews nor means stopped.
- `pend`, `pfls`, `aend` and AirPlay 2 `paus` mean `stopped`.
- `arst` is not evidence: shairport-sync sends it for any returned frame, silence after a flush included.
At startup, and after a read error and reopen, state is `unknown` until new evidence arrives.
`unknown` means no recent evidence: startup, silence for 5 seconds, or a receiver that went away.
`stopped` means the last event seen was a stop (`pend`, `pfls`, `aend`, `paus`).
Because the helper holds the pipe open itself it cannot see shairport-sync exit:
a dead or restarting receiver shows as `unknown` (5 seconds after the last audio report) or, if it had
stopped first, `stopped`; it never shows `playing`.
Metadata items alone (title, artist, cover) never change `state`.
Readers must treat a snapshot whose `checkedAt` is older than 15 seconds as `unknown`,
including a missing, unreadable or malformed file.

## Bounds

Pipe items are parsed incrementally and may be split across reads;
malformed or truncated items are dropped and parsing resumes at the next item, with a bounded buffer.
Data over 256 KiB is reported only for a picture (the cover is dropped);
for every other code the item is ignored and never changes state.
The same body bound applies whether a frame arrives whole or split.
Writes (snapshot and cover files alike) go to a uniquely named sibling temp file created exclusively with mode 0600,
then renamed over the target, so a reader sees the old or new complete file, never a partial one.
There is no fsync: a crash can only lose freshness, which readers treat as unknown, and covers are verified by digest.
Only a temp file this process created is removed.
A failed write is logged once, leaves the previous file, and is retried on the next change or heartbeat.
A failed first write at startup stops the helper.

## Limits

Nothing here installs, starts, supervises or configures anything, or touches real shairport-sync,
real media, accounts or the household.
Tests use fake streams, a controlled clock and disposable files, plus one disposable temporary FIFO
(created with `mkfifo`) opened by test writers the way shairport-sync opens it, with no second reader held; no shairport-sync is run.
Metadata sent before the helper first starts, or while it is stopped, is lost (shairport-sync opens the FIFO only when a reader exists).
