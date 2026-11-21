import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PassThrough } from 'node:stream';
import { mkdtempSync, writeFileSync, rmSync, realpathSync, symlinkSync, readFileSync, readdirSync, existsSync, openSync, closeSync, writeSync, mkdirSync, constants, statSync, lstatSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { checkDirectories, parseFlags } from './config.ts';
import { ItemParser, MAX_DATA_BYTES } from './items.ts';
import { NowPlaying, coverOf, coverName, MAX_COVER_BYTES } from './state.ts';
import type { Snapshot } from './state.ts';
import { Helper, HEARTBEAT_MS, PLAYING_TTL_MS, RETRY_MS } from './helper.ts';
import { openPipe } from './pipe.ts';
import type { Clock } from './helper.ts';
import { snapshotWriter, coverFiles, MAX_SNAPSHOT_BYTES } from './writer.ts';

const fourCC = (s: string) => Buffer.from(s, 'latin1').toString('hex');
// Exactly what shairport-sync's metadata/pipe.c writes (data only when length > 0).
const frame = (type: string, code: string, data?: Buffer | string) => {
  const bytes = data === undefined ? Buffer.alloc(0) : Buffer.from(data);
  const head = `<item><type>${fourCC(type)}</type><code>${fourCC(code)}</code><length>${bytes.length}</length>`;
  return bytes.length ? `${head}\n<data encoding="base64">\n${bytes.toString('base64')}</data></item>\n` : `${head}</item>\n`;
};
const ssnc = (code: string, data?: Buffer | string) => frame('ssnc', code, data);
const core = (code: string, data: string) => frame('core', code, data);
const track = (title: string, artist: string, rtp = '100') => ssnc('mdst', rtp) + core('asar', artist) + core('minm', title) + ssnc('mden', rtp);
const pic = (data: Buffer | string, rtp = '100') => ssnc('pcst', rtp) + ssnc('PICT', data) + ssnc('pcen', rtp);
// AirPlay 2 (metadata_hub_handle_command_plist.c): the picture sits inside mdst..mden with no pcst/pcen or RTP time.
const bundle2 = (title: string, artist: string, picture?: Buffer) => ssnc('mdst') + (picture ? ssnc('PICT', picture) : '') + core('asal', 'Album') + core('minm', title) + core('asar', artist) + ssnc('mden');
const abrt = (payload = '176400/44100/44100') => ssnc('abrt', payload);
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(60, 1)]);
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(60, 2)]);

function parse(...chunks: (string | Buffer)[]) { const p = new ItemParser(); return chunks.flatMap(c => p.feed(c)); }
const codes = (items: { code: string }[]) => items.map(i => i.code);

// Controlled clock: timers run only when advance() reaches them.
function fakeClock(start = Date.parse('2026-01-01T00:00:00Z')) {
  let now = start; let seq = 0;
  const timers = new Map<number, { at: number; fn: () => void }>();
  const clock: Clock = {
    now: () => now,
    setTimeout(fn, ms) { const id = seq++; timers.set(id, { at: now + ms, fn }); return () => { timers.delete(id); }; },
  };
  const settle = async () => { for (let i = 0; i < 5; i++) await new Promise(r => setImmediate(r)); };
  return {
    clock, timers, settle, set: (t: number) => { now = t; },
    async advance(ms: number) {
      const end = now + ms;
      for (;;) {
        const due = [...timers.entries()].filter(([, t]) => t.at <= end).sort((a, b) => a[1].at - b[1].at || a[0] - b[0])[0];
        if (!due) break;
        timers.delete(due[0]); now = due[1].at; due[1].fn(); await settle();
      }
      now = end; await settle();
    },
  };
}
function rig(opts: { failWrites?: () => boolean; failOpen?: () => boolean; failPrune?: () => boolean } = {}) {
  const c = fakeClock();
  const writes: Snapshot[] = []; const logs: string[] = []; const opens: number[] = []; const streams: PassThrough[] = [];
  const files = new Map<string, Buffer>(); const coverWrites: string[] = [];
  const helper = new Helper({
    clock: c.clock,
    async open() { opens.push(c.clock.now()); if (opts.failOpen?.()) throw new Error('no pipe'); const s = new PassThrough(); streams.push(s); return s; },
    async write(text) { if (opts.failWrites?.()) throw new Error('disk'); writes.push(JSON.parse(text)); },
    async writeCover(name, bytes) { coverWrites.push(name); files.set(name, bytes); },
    async pruneCovers(keep) { for (const n of [...files.keys()]) if (n !== keep) files.delete(n); if (opts.failPrune?.()) throw new Error('partial prune'); },
    log: m => logs.push(m),
  });
  const send = async (...chunks: string[]) => { for (const x of chunks) streams.at(-1)!.write(x); await c.settle(); };
  return { c, helper, writes, logs, opens, streams, files, coverWrites, send, last: () => writes.at(-1)! };
}

test('flags are two absolute, normalized, different paths', () => {
  const ok = ['--pipe', '/example/pipe/metadata', '--snapshot', '/example/now-playing.json'];
  assert.deepEqual(parseFlags(ok), { pipePath: '/example/pipe/metadata', snapshotPath: '/example/now-playing.json' });
  const sha = 'a'.repeat(64);
  for (const bad of [[], ok.slice(0, 2), ok.slice(2), [...ok, '--extra', 'x'], [...ok, 'positional'], ['--pipe', 'relative', ...ok.slice(2)], ['--pipe', '/a\0b', ...ok.slice(2)],
    [...ok.slice(0, 3), '/example/../x.json'], ['--pipe', '/example/x', '--snapshot', '/example/x'], [...ok.slice(0, 3), `/${'a'.repeat(4096)}`], [...ok.slice(0, 3), `/example/cover-${sha}.jpg`],
    [...ok.slice(0, 3), `/example/Cover-${sha.toUpperCase()}.JPG`], // aliases a cover file on a case-insensitive file system
    ['--pipe', '/example/metadata', ...ok.slice(2)], ['--pipe', '/Example/metadata', ...ok.slice(2)], // the pipe must not sit among the covers
    [...ok, '--pipe', '/example/pipe/other'], [...ok, '--snapshot', '/example/other.json']])
    assert.throws(() => parseFlags(bad), (e: Error) => !/example|relative|positional/.test(e.message), bad.join(' ').slice(0, 60)); // fixed messages, no input values
  // Directories are compared by identity: a symlinked parent cannot put the pipe among the snapshot's files.
  const dir = mkdtempSync(join(realpathSync(tmpdir()), 'now-playing-flags-'));
  try {
    mkdirSync(join(dir, 'pipe')); mkdirSync(join(dir, 'state')); symlinkSync(join(dir, 'state'), join(dir, 'alias'));
    const flags = (pipeDir: string, snapDir: string) => parseFlags(['--pipe', join(dir, pipeDir, 'metadata'), '--snapshot', join(dir, snapDir, 'now-playing.json')]);
    checkDirectories(flags('pipe', 'state'));
    assert.throws(() => checkDirectories(flags('alias', 'state')), /snapshot directory/);
    assert.throws(() => checkDirectories(flags('missing', 'state')), /must exist/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('parser reads items split at every byte boundary and batched in one chunk', () => {
  const text = ssnc('pbeg') + core('minm', 'Zażółć gęślą jaźń') + ssnc('PICT', JPEG) + ssnc('pend');
  const whole = parse(text);
  assert.deepEqual(codes(whole), ['pbeg', 'minm', 'PICT', 'pend']);
  assert.equal(whole[0]!.type, 'ssnc'); assert.equal(whole[1]!.type, 'core');
  assert.equal(whole[1]!.data.toString('utf8'), 'Zażółć gęślą jaźń'); assert.ok(whole[2]!.data.equals(JPEG));
  const bytes = Buffer.from(text);
  const split = parse(...Array.from(bytes, (_, i) => bytes.subarray(i, i + 1)));
  assert.deepEqual(split, whole);
  for (const size of [2, 3, 7, 64]) assert.deepEqual(parse(...Array.from({ length: Math.ceil(bytes.length / size) }, (_, i) => bytes.subarray(i * size, (i + 1) * size))), whole);
  assert.deepEqual(parse('\n  \n' + ssnc('pbeg') + 'noise'), [whole[0]]);
});

test('parser drops malformed and truncated items and resynchronises', () => {
  const good = ssnc('pbeg');
  const badFrames = [
    '<item><type>zz</type><code>70626567</code><length>0</length></item>\n',
    `<item><type>${fourCC('ssnc')}</type><code>70626567</code><length>3</length>\n<data encoding="base64">\n!!!!</data></item>\n`,
    `<item><type>${fourCC('core')}</type><code>${fourCC('minm')}</code><length>9</length>\n<data encoding="base64">\n${Buffer.from('abc').toString('base64')}</data></item>\n`, // length mismatch
    `<item><type>${fourCC('core')}</type><code>${fourCC('minm')}</code><length>3</length>\n<data encoding="base64">\nYWJj</item>\n`, // missing </data>
    `<item><type>${fourCC('core')}</type><code>${fourCC('minm')}</code><length>3</length>\n<data encoding="base64">\nYW`, // truncated, next item follows
    '<item><type>73736e63</type><code>12</code><length>0</length></item>\n', // short code
    '<item><type>73736e63</type><code>70626567</code><length>0</length>junk</item>\n',
    '<item><item><item>',
    '<item>' + 'x'.repeat(200),
  ];
  for (const bad of badFrames) assert.deepEqual(codes(parse(bad + good)), ['pbeg'], bad.slice(0, 60));
  assert.deepEqual(codes(parse(badFrames.join('') + good + badFrames.join(''))), ['pbeg']);
});

test('parser bounds its buffer and reports oversize items without data', () => {
  const p = new ItemParser();
  assert.deepEqual(p.feed('x'.repeat(5_000_000)), []);
  assert.ok((p as any).buf.length <= 6);
  // Declared oversize: flagged, body discarded across many chunks, parser recovers.
  const big = Buffer.alloc(MAX_DATA_BYTES + 1, 7);
  const text = ssnc('PICT', big) + ssnc('pend');
  const items = parse(...(text.match(/[\s\S]{1,4096}/g) as string[]));
  assert.deepEqual(codes(items), ['PICT', 'pend']);
  assert.equal(items[0]!.oversize, true); assert.equal(items[0]!.data.length, 0);
  // Declared small but actually unbounded body: the buffer stays bounded and the next item is read.
  const liar = `<item><type>${fourCC('ssnc')}</type><code>${fourCC('PICT')}</code><length>10</length>\n<data encoding="base64">\n`;
  const q = new ItemParser();
  q.feed(liar);
  for (let i = 0; i < 200; i++) { q.feed('A'.repeat(65536)); assert.ok((q as any).buf.length < 70_000); }
  assert.deepEqual(codes(q.feed('</data></item>\n' + ssnc('pbeg'))), ['pbeg']);
  // Exactly at the cap is delivered whole.
  assert.equal(parse(ssnc('PICT', Buffer.alloc(MAX_DATA_BYTES, 1)))[0]!.data.length, MAX_DATA_BYTES);
});

test('an oversize or truncated frame never carries a state change; only a picture reports oversize', () => {
  const head = (code: string, length: number) => `<item><type>${fourCC('ssnc')}</type><code>${fourCC(code)}</code><length>${length}</length>`;
  for (const code of ['pbeg', 'pend', 'abrt', 'paus', 'mdst', 'mden', 'pcst']) {
    const big = head(code, MAX_DATA_BYTES + 1) + '\n<data encoding="base64">\n' + 'A'.repeat(100_000);
    assert.deepEqual(parse(big + '</data></item>\n' + ssnc('pfls')), parse(ssnc('pfls')), code);
    assert.deepEqual(codes(parse(head(code, 999_999_999) + ssnc('pfls'))), ['pfls'], code); // header alone, no body
    assert.deepEqual(codes(parse(head(code, 0) + ssnc('pfls'))), ['pfls'], code); // truncated
  }
  const m = new NowPlaying();
  for (const i of parse(ssnc('pend'), head('abrt', MAX_DATA_BYTES + 1), '\n<data encoding="base64">\nAAAA</data></item>\n')) m.apply(i, 0);
  assert.equal(m.snapshot(0).state, 'stopped');
  const picture = parse(head('PICT', MAX_DATA_BYTES + 1) + '\n<data encoding="base64">\nAAAA</data></item>\n');
  assert.deepEqual([picture.length, picture[0]!.code, picture[0]!.oversize], [1, 'PICT', true]);
  const coreBig = `<item><type>${fourCC('core')}</type><code>${fourCC('minm')}</code><length>${MAX_DATA_BYTES + 1}</length>\n<data encoding="base64">\nAAAA</data></item>\n`;
  assert.deepEqual(parse(coreBig), []);
});

test('the body bound applies the same to whole and split frames', () => {
  const padded = (pad: number) => `<item><type>${fourCC('ssnc')}</type><code>${fourCC('minm')}</code><length>3</length>\n<data encoding="base64">\nYWJj${' '.repeat(pad)}</data></item>\n`;
  const next = ssnc('pbeg');
  const bytes = (text: string) => { const b = Buffer.from(text); return Array.from(b, (_, i) => b.subarray(i, i + 1)); };
  for (const pad of [0, 100, 479, 480, 481, 5000]) {
    const text = padded(pad) + next;
    const whole = parse(text);
    assert.deepEqual(parse(...bytes(text)), whole, `pad ${pad}`);
    assert.deepEqual(parse(...(text.match(/[\s\S]{1,64}/g) as string[])), whole, `pad ${pad}`);
    assert.deepEqual(codes(whole), pad >= 480 ? ['pbeg'] : ['minm', 'pbeg'], `pad ${pad}`);
  }
});

test('only abrt means playing; pbeg, prsm and pres do not; stop codes stop; arst and abrt 0/0/0 are not evidence', () => {
  const m = new NowPlaying(); const t = Date.parse('2026-01-01T00:00:00Z');
  const feed = (text: string, at: number) => parse(text).map(i => m.apply(i, at));
  const changed = (text: string, at: number) => feed(text, at).some(e => e.changed);
  const renews = (text: string, at: number) => feed(text, at).some(e => e.renew);
  assert.deepEqual(m.snapshot(t), { schema: 'houseatlas.now-playing.v1', state: 'unknown', since: null, checkedAt: new Date(t).toISOString(), track: null, lastTrack: null });
  feed(track('Song', 'Artist'), t + 1);
  assert.equal(m.snapshot(t + 1).state, 'unknown'); // metadata alone is not evidence of playing
  // AirPlay 2 buffered setup emits pbeg before any audio: play start, resume and AirPlay 2 pres are not evidence.
  for (const code of ['pbeg', 'prsm', 'pres']) { assert.equal(renews(ssnc(code), t + 2), false, code); assert.equal(changed(ssnc(code), t + 2), false, code); assert.equal(m.snapshot(t + 2).state, 'unknown', code); }
  assert.equal(changed(abrt(), t + 2), true);
  let s = m.snapshot(t + 9);
  assert.deepEqual([s.state, s.since, s.track, s.lastTrack], ['playing', new Date(t + 2).toISOString(), { title: 'Song', artist: 'Artist' }, { title: 'Song', artist: 'Artist' }]);
  assert.equal(renews(abrt(), t + 3), true); assert.equal(changed(abrt(), t + 3), false); // more evidence keeps `since` and content
  for (const code of ['pbeg', 'prsm', 'pres']) { feed(ssnc(code), t + 4); assert.equal(m.snapshot(t + 4).state, 'playing', code); } // and they never stop it
  feed(ssnc('pend'), t + 5); s = m.snapshot(t + 5);
  assert.deepEqual([s.state, s.since, s.track, s.lastTrack?.title], ['stopped', new Date(t + 5).toISOString(), null, 'Song']);
  for (const code of ['pbeg', 'prsm', 'pres']) { feed(ssnc(code), t + 5); assert.equal(m.snapshot(t + 5).state, 'stopped', code); } // a start alone does not leave stopped
  for (const [code, data] of [['arst', '0/0/0'], ['arst', '5/6/7'], ['abrt', '0/0/0'], ['abrt', '0/100/44100'], ['abrt', '100/0/44100'], ['abrt', '1/2'], ['abrt', 'x/2/3'], ['abrt', '1/2/3/4'], ['abrt', '-1/2/3'], ['abrt', '']] as const)
    { assert.equal(renews(ssnc(code, data), t + 6), false, `${code} ${data}`); assert.equal(m.snapshot(t + 6).state, 'stopped'); }
  feed(abrt(), t + 7); assert.equal(m.snapshot(t + 7).state, 'playing');
  assert.equal(renews(abrt('0/0/0'), t + 8), false); assert.equal(m.snapshot(t + 8).state, 'playing'); // a reset neither renews nor stops
  for (const code of ['pfls', 'aend', 'paus', 'pend']) {
    feed(abrt(), t + 9); assert.equal(m.snapshot(t + 9).state, 'playing', code);
    feed(ssnc(code, code === 'pfls' ? '123' : undefined), t + 10); s = m.snapshot(t + 10); assert.deepEqual([s.state, s.track, s.lastTrack?.title], ['stopped', null, 'Song'], code);
  }
  feed(ssnc('abeg'), t + 11); feed(core('asal', 'Album'), t + 11);
  assert.equal(m.snapshot(t + 11).state, 'stopped'); // abeg and album are unused
  feed(abrt(), t + 12); assert.equal(m.expire(), true); s = m.snapshot(t + 12); // expiry is unknown, never stopped
  assert.deepEqual([s.state, s.since, s.track, s.lastTrack?.title], ['unknown', null, null, 'Song']); assert.equal(m.expire(), false);
  feed(abrt(), t + 13); m.reset(); s = m.snapshot(t + 13);
  assert.deepEqual([s.state, s.since, s.track, s.lastTrack?.title], ['unknown', null, null, 'Song']);
});

test('a new bundle replaces both fields and metadata outside a bundle still applies', () => {
  const m = new NowPlaying();
  const feed = (text: string) => parse(text).forEach(i => m.apply(i, 0));
  feed(track('One', 'A')); feed(ssnc('mdst') + core('minm', 'Two') + ssnc('mden')); // no artist this time
  assert.deepEqual(m.snapshot(0).lastTrack, { title: 'Two', artist: null });
  feed(ssnc('mdst') + ssnc('mden')); assert.equal(m.snapshot(0).lastTrack?.title, 'Two'); // empty bundle changes nothing
  feed(core('minm', 'Three') + core('asar', 'C')); assert.deepEqual(m.snapshot(0).lastTrack, { title: 'Three', artist: 'C' });
  feed(track('  \u0000Pad\u0007ded  ', 'x'.repeat(1000)));
  const t = m.snapshot(0).lastTrack!; assert.equal(t.title, 'Padded'); assert.equal(t.artist!.length, 256);
  feed(track('   ', '')); assert.equal(m.snapshot(0).lastTrack?.title, 'Padded'); // all-empty text is not a track
});

test('cover is verified by magic bytes, capped at 256 KiB and tied to its track by RTP time', () => {
  assert.equal(coverOf(JPEG)!.mediaType, 'image/jpeg'); assert.equal(coverOf(PNG)!.mediaType, 'image/png');
  assert.equal(coverOf(Buffer.from('GIF89a......')), null); assert.equal(coverOf(Buffer.from([0xff, 0xd8])), null);
  assert.equal(coverOf(Buffer.alloc(0)), null);
  const atCap = Buffer.concat([JPEG, Buffer.alloc(MAX_COVER_BYTES - JPEG.length, 3)]);
  assert.equal(coverOf(atCap)!.bytes.length, MAX_COVER_BYTES);
  assert.equal(coverOf(PNG)!.sha256, createHash('sha256').update(PNG).digest('hex'));
  assert.equal(coverName(coverOf(PNG)!), `cover-${coverOf(PNG)!.sha256}.png`); assert.equal(coverName(coverOf(JPEG)!), `cover-${coverOf(JPEG)!.sha256}.jpg`);
  assert.equal(coverOf(Buffer.concat([atCap, Buffer.from([0])])), null);
  const m = new NowPlaying();
  const feed = (text: string) => parse(text).forEach(i => m.apply(i, 0));
  const cover = () => m.snapshot(0).cover?.mediaType ?? null;
  feed(track('One', 'A', '100')); assert.equal(cover(), null);
  feed(pic(PNG, '100')); assert.equal(cover(), 'image/png'); // track first, then its picture
  assert.deepEqual(m.snapshot(0).cover, { mediaType: 'image/png', sha256: createHash('sha256').update(PNG).digest('hex') }); assert.ok(m.cover()!.bytes.equals(PNG));
  feed(track('One', 'A', '100')); assert.equal(cover(), 'image/png'); // the same bundle again keeps its picture
  feed(track('Two', 'A', '200')); assert.equal(cover(), null); // a late picture of the old track is never shown on the new one
  feed(pic(PNG, '100')); assert.equal(cover(), null);
  feed(pic(JPEG, '200')); assert.equal(cover(), 'image/jpeg');
  feed(track('Three', 'A', '300')); assert.equal(cover(), null);
  feed(pic(JPEG, '300')); assert.equal(cover(), 'image/jpeg');
  const n = new NowPlaying(); const nfeed = (text: string) => parse(text).forEach(i => n.apply(i, 0));
  nfeed(pic(PNG, '400')); assert.equal('cover' in n.snapshot(0), false); assert.equal(n.snapshot(0).lastTrack, null); // a picture before any track is never published
  nfeed(track('Four', 'A', '400')); assert.equal(n.snapshot(0).cover?.mediaType, 'image/png'); // picture first, then its track
  // Without a shared RTP time the picture is omitted.
  const o = new NowPlaying(); const ofeed = (text: string) => parse(text).forEach(i => o.apply(i, 0));
  ofeed(ssnc('mdst') + core('minm', 'Five') + ssnc('mden') + ssnc('PICT', PNG)); assert.equal('cover' in o.snapshot(0), false);
  ofeed(ssnc('mdst') + core('minm', 'Five') + ssnc('mden') + ssnc('pcst', '5') + ssnc('PICT', PNG) + ssnc('pcen', '5')); assert.equal('cover' in o.snapshot(0), false);
  ofeed(track('Six', 'A', '600') + ssnc('PICT', PNG)); assert.equal('cover' in o.snapshot(0), false); // picture without pcst
  ofeed(ssnc('pcst', '600') + ssnc('pcen', '600') + ssnc('PICT', PNG)); assert.equal('cover' in o.snapshot(0), false); // pcen ends the association
  ofeed(core('minm', 'Seven')); ofeed(pic(PNG, '600')); assert.equal('cover' in o.snapshot(0), false); // items outside a bundle carry no RTP time
  ofeed(track('Eight', 'A', 'abc')); ofeed(pic(PNG, 'abc')); assert.equal('cover' in o.snapshot(0), false); // unusable RTP payloads never match
  // Bad pictures withdraw the old one.
  feed(track('Nine', 'A', '900')); feed(pic(JPEG, '900')); assert.equal(cover(), 'image/jpeg');
  feed(pic(Buffer.from('not an image at all'), '900')); assert.equal(cover(), null);
  feed(pic(JPEG, '900')); feed(pic(Buffer.alloc(MAX_COVER_BYTES + 1, 0xff), '900')); assert.equal(cover(), null); // oversize replacement
  feed(pic(JPEG, '900')); m.reset(); assert.equal(cover(), 'image/jpeg'); // EOF keeps the last picture with the last track
});

test('AirPlay 2 pictures inside the bundle belong to that bundle only', () => {
  const m = new NowPlaying();
  const feed = (text: string) => parse(text).forEach(i => m.apply(i, 0));
  const cover = () => m.snapshot(0).cover?.mediaType ?? null;
  feed(bundle2('One', 'A', PNG)); assert.equal(cover(), 'image/png'); assert.equal(m.snapshot(0).lastTrack?.title, 'One');
  feed(bundle2('One', 'A')); assert.equal(cover(), 'image/png'); // a repeat of the same track (progress update) keeps its cover
  feed(bundle2('Two', 'A')); assert.equal(cover(), null); // a different track without a picture never inherits it
  feed(bundle2('Two', 'A')); assert.equal(cover(), null);
  feed(bundle2('Three', 'B', JPEG)); assert.equal(cover(), 'image/jpeg');
  feed(bundle2('Three', 'B', Buffer.from('not an image'))); assert.equal(cover(), null); // an unusable picture withdraws the cover
  feed(bundle2('Four', 'B', JPEG)); feed(ssnc('PICT', PNG)); assert.equal(cover(), 'image/jpeg'); // a picture outside any bundle is dropped
  feed(ssnc('mdst') + ssnc('PICT', PNG) + ssnc('mden')); assert.equal(cover(), 'image/jpeg'); // no title or artist: not a track, no change
  feed(core('minm', 'Five')); assert.equal(cover(), null); // outside a bundle, a different title drops the cover
  // A classic pcst without an RTP time never attaches, even inside a bundle.
  feed(bundle2('Six', 'B', JPEG)); feed(ssnc('mdst') + ssnc('pcst') + ssnc('PICT', PNG) + ssnc('pcen') + core('minm', 'Seven') + ssnc('mden')); assert.equal(cover(), null);
  assert.equal(m.snapshot(0).lastTrack?.title, 'Seven');
});

test('artwork never carries across a reattach or a session boundary', () => {
  const run = (setup: string, reset: (m: NowPlaying) => void, after: string) => {
    const m = new NowPlaying(); const feed = (text: string) => parse(text).forEach(i => m.apply(i, 0));
    feed(setup); reset(m); feed(after); return m.snapshot(0);
  };
  const eof = (m: NowPlaying) => m.reset();
  const end = (code: string) => (m: NowPlaying) => parse(ssnc(code)).forEach(i => m.apply(i, 0));
  // A reused RTP time after the pipe is reattached must not give an old cover to a new title.
  assert.equal('cover' in run(track('Old', 'A', '100') + pic(PNG, '100'), eof, track('New', 'B', '100')), false);
  assert.equal('cover' in run(track('Old', 'A', '100') + pic(PNG, '100'), end('pend'), track('New', 'B', '100')), false);
  assert.equal('cover' in run(bundle2('Old', 'A', PNG), end('aend'), bundle2('New', 'B')), false);
  // A late picture of the old RTP time after reattach is not matched to the new bundle either.
  assert.equal('cover' in run(track('Old', 'A', '100'), eof, track('New', 'B', '100') + pic(PNG, '100')), true); // the new picture belongs to the new track
  assert.equal('cover' in run(track('Old', 'A', '100'), eof, pic(PNG, '100') + track('New', 'B', '100')), true);
  // Unmatched pending pictures are discarded on reset and at session end.
  assert.equal('cover' in run(pic(PNG, '700'), eof, track('X', 'A', '700')), false);
  assert.equal('cover' in run(pic(PNG, '800'), end('pend'), track('Y', 'A', '800')), false);
  assert.equal('cover' in run(pic(PNG, '810'), end('aend'), track('Y', 'A', '810')), false);
  assert.equal('cover' in run(pic(PNG, '820'), end('pfls'), track('Y', 'A', '820')), true); // a flush inside a session is not a boundary
  // A half-open bundle or picture is discarded too.
  assert.equal('cover' in run(ssnc('mdst') + ssnc('PICT', PNG) + core('minm', 'Cut'), eof, core('minm', 'Cut2') + ssnc('mden')), false);
  assert.equal('cover' in run(ssnc('pcst', '900'), eof, ssnc('PICT', PNG) + track('Z', 'A', '900')), false);
  // The matched cover stays with its own last track while stopped, unknown or after EOF.
  for (const reset of [eof, end('pend'), end('aend')]) {
    const s = run(track('Own', 'A', '100') + pic(PNG, '100'), reset, '');
    assert.deepEqual([s.lastTrack?.title, s.cover?.mediaType], ['Own', 'image/png']);
  }
  // The same title and artist again after a reattach keeps its own cover.
  assert.equal(run(bundle2('Own', 'A', PNG), eof, bundle2('Own', 'A')).cover?.mediaType, 'image/png');
});

test('track identifiers and new streams bound artwork', () => {
  const m = new NowPlaying();
  const feed = (text: string) => parse(text).forEach(i => m.apply(i, 0));
  const cover = () => m.snapshot(0).cover?.mediaType ?? null;
  const id = (n: number) => { const b = Buffer.alloc(8); b.writeBigUInt64LE(BigInt(n)); return frame('core', 'mper', b); };
  const withId = (title: string, n: number, picture?: Buffer) => ssnc('mdst') + (picture ? ssnc('PICT', picture) : '') + id(n) + core('minm', title) + core('asar', 'A') + ssnc('mden');
  feed(withId('Same', 1, PNG)); assert.equal(cover(), 'image/png');
  feed(withId('Same', 1)); assert.equal(cover(), 'image/png'); // same identifier: a repeat keeps its cover
  feed(withId('Same', 2)); assert.equal(cover(), null); // same title and artist, different identifier: a different track
  feed(withId('Kept', 3, PNG)); feed(bundle2('Kept', 'A')); feed(withId('Kept', 4)); assert.equal(cover(), null); // a bundle without an identifier keeps the known one
  feed(withId('Reused', 5, PNG)); feed(ssnc('pbeg')); feed(withId('Other', 5)); assert.equal(cover(), null); // an identifier never joins different titles
  // An unobserved writer restart: a new stream (pbeg) discards pending classic artwork, so a reused RTP time cannot match.
  const r = new NowPlaying(); const rf = (text: string) => parse(text).forEach(i => r.apply(i, 0));
  rf(pic(PNG, '500')); rf(ssnc('pbeg')); rf(track('Fresh', 'B', '500'));
  assert.equal('cover' in r.snapshot(0), false);
  assert.equal(r.snapshot(0).state, 'unknown'); // pbeg is never playing evidence
  // An unfinished classic picture wrapper does not swallow the next AirPlay 2 bundle's own picture.
  const w = new NowPlaying(); const wf = (text: string) => parse(text).forEach(i => w.apply(i, 0));
  wf(ssnc('pcst', '600')); wf(bundle2('Next', 'C', JPEG));
  assert.equal(w.snapshot(0).cover?.mediaType, 'image/jpeg');
});

test('snapshot has a closed shape and stays small even with the largest cover and longest texts', () => {
  const m = new NowPlaying();
  const wide = '\u{1d11e}'.repeat(300); // four-byte characters: the worst case for text
  parse(track(wide, wide) + abrt() + pic(Buffer.concat([JPEG, Buffer.alloc(MAX_COVER_BYTES - JPEG.length, 9)]))).forEach(i => m.apply(i, 1));
  const s = m.snapshot(2);
  assert.deepEqual(Object.keys(s), ['schema', 'state', 'since', 'checkedAt', 'track', 'lastTrack', 'cover']);
  assert.deepEqual(Object.keys(s.track!), ['title', 'artist']); assert.deepEqual(Object.keys(s.cover!), ['mediaType', 'sha256']);
  assert.ok(Buffer.byteLength(JSON.stringify(s)) < MAX_SNAPSHOT_BYTES);
  const n = new NowPlaying(); parse(track('Song', 'Artist') + abrt() + pic(PNG)).forEach(i => n.apply(i, 1));
  assert.ok(Buffer.byteLength(JSON.stringify(n.snapshot(2))) < 1024); // the cover is not in the snapshot
  assert.deepEqual(Object.keys(new NowPlaying().snapshot(0)), ['schema', 'state', 'since', 'checkedAt', 'track', 'lastTrack']);
});

test('track shows only a track committed in the current session; lastTrack stays as history', () => {
  const m = new NowPlaying(); const feed = (text: string) => parse(text).forEach(i => m.apply(i, 0));
  const view = () => { const s = m.snapshot(0); return [s.state, s.track?.title ?? null, s.lastTrack?.title ?? null]; };
  feed(track('Song', 'A') + abrt()); assert.deepEqual(view(), ['playing', 'Song', 'Song']);
  for (const end of ['pend', 'aend']) {
    feed(ssnc(end)); feed(ssnc('pbeg') + abrt()); // a new session whose metadata never arrives
    assert.deepEqual(view(), ['playing', null, 'Song'], end);
    feed(track('Next', 'B')); assert.deepEqual(view(), ['playing', 'Next', 'Next'], end);
    feed(track('Song', 'A'));
  }
  feed(ssnc('pend') + track('Early', 'C') + ssnc('pbeg') + abrt()); assert.deepEqual(view(), ['playing', 'Early', 'Early']); // metadata before pbeg counts
  feed(ssnc('pfls') + abrt()); assert.deepEqual(view(), ['playing', 'Early', 'Early']); // a flush is not a session end
  feed(ssnc('aend') + abrt('0/0/0') + abrt()); assert.deepEqual(view(), ['playing', null, 'Early']);
  m.reset(); feed(track('After', 'D') + abrt()); assert.equal(view()[1], 'After');
  // Loose title or artist items in a new session never borrow the previous session's fields or cover.
  for (const end of ['pend', 'aend', 'reset']) {
    const n = new NowPlaying(); const nf = (text: string) => parse(text).forEach(i => n.apply(i, 0));
    nf(bundle2('Old song', 'Old artist', PNG));
    if (end === 'reset') n.reset(); else nf(ssnc(end));
    nf(ssnc('pbeg') + core('minm', 'New song') + abrt());
    assert.deepEqual(n.snapshot(0).track, { title: 'New song', artist: null }, end);
    assert.equal('cover' in n.snapshot(0), false, end);
    nf(core('asar', 'New artist')); // within the session, loose items still update incrementally
    assert.deepEqual(n.snapshot(0).track, { title: 'New song', artist: 'New artist' }, end);
  }
});

test('startup is unknown, and a running helper alone never implies playing', async () => {
  const r = rig();
  await r.helper.start(); await r.c.settle();
  assert.equal(r.writes.length, 1); assert.equal(r.last().state, 'unknown'); assert.equal(r.last().since, null);
  assert.equal(r.opens.length, 1);
  await r.c.advance(60_000);
  assert.ok(r.writes.every(w => w.state === 'unknown' && w.track === null));
  await r.helper.stop();
});

test('heartbeat rewrites the snapshot every five seconds with a new checkedAt', async () => {
  const r = rig();
  await r.helper.start(); await r.c.settle();
  const t0 = r.c.clock.now();
  await r.send(ssnc('pend'));
  assert.equal(r.last().state, 'stopped');
  const before = r.writes.length;
  await r.c.advance(HEARTBEAT_MS - 1); assert.equal(r.writes.length, before);
  await r.c.advance(1); assert.equal(r.writes.length, before + 1);
  await r.c.advance(3 * HEARTBEAT_MS); assert.equal(r.writes.length, before + 4);
  const beats = r.writes.slice(before);
  assert.deepEqual(beats.map(w => Date.parse(w.checkedAt) - t0), [5000, 10000, 15000, 20000]);
  assert.ok(beats.every(w => w.state === 'stopped' && w.since === new Date(t0).toISOString()));
  await r.helper.stop();
});

test('pipe end becomes unknown, reopens after a fixed second and recovers on evidence', async () => {
  const r = rig();
  await r.helper.start(); await r.c.settle();
  await r.send(track('Song', 'Artist'), abrt());
  assert.equal(r.last().state, 'playing');
  r.streams[0]!.end(); await r.c.settle();
  assert.equal(r.last().state, 'unknown'); assert.equal(r.last().since, null); assert.equal(r.last().track, null); assert.equal(r.last().lastTrack?.title, 'Song');
  for (let i = 0; i < 3; i++) {
    const n = r.opens.length;
    await r.c.advance(RETRY_MS - 1); assert.equal(r.opens.length, n);
    await r.c.advance(1); assert.equal(r.opens.length, n + 1);
    r.streams.at(-1)!.end(); await r.c.settle();
  }
  await r.c.advance(RETRY_MS);
  await r.send(abrt()); // evidence after reopen
  assert.equal(r.last().state, 'playing'); assert.equal(r.last().track, null); // a reattach may be a new session: no stale title
  assert.equal(r.last().lastTrack?.title, 'Song');
  await r.helper.stop();
});

test('a missing pipe is retried every second with unknown state and one message per outage', async () => {
  let missing = true;
  const r = rig({ failOpen: () => missing });
  await r.helper.start(); await r.c.settle();
  await r.c.advance(5 * RETRY_MS);
  assert.deepEqual(r.opens.slice(1).map((t, i) => t - r.opens[i]!), [1000, 1000, 1000, 1000, 1000]);
  assert.equal(r.logs.filter(l => /unavailable/.test(l)).length, 1);
  assert.ok(r.writes.every(w => w.state === 'unknown'));
  missing = false; await r.c.advance(RETRY_MS); await r.send(abrt()); assert.equal(r.last().state, 'playing');
  await r.helper.stop();
});

test('a frame cut by EOF is discarded and does not complete on the next attachment', async () => {
  const r = rig();
  await r.helper.start(); await r.c.settle();
  const whole = abrt(); await r.send(whole.slice(0, 30));
  r.streams[0]!.end(); await r.c.settle(); await r.c.advance(1000);
  await r.send(whole.slice(30));
  assert.equal(r.last().state, 'unknown');
  await r.send(whole); assert.equal(r.last().state, 'playing');
  await r.helper.stop();
});

test('write failures do not stop the helper and recover; a failed first write refuses startup', async () => {
  let fail = false;
  const r = rig({ failWrites: () => fail });
  await r.helper.start(); await r.c.settle();
  fail = true; await r.send(ssnc('pend')); await r.c.advance(2 * HEARTBEAT_MS);
  assert.equal(r.logs.filter(l => /write failed/.test(l)).length, 1);
  fail = false; await r.c.advance(HEARTBEAT_MS);
  assert.equal(r.last().state, 'stopped');
  await r.helper.stop();
  const bad = rig({ failWrites: () => true });
  await assert.rejects(bad.helper.start());
  assert.equal(bad.opens.length, 0); assert.equal(bad.c.timers.size, 0);
});

test('stop closes the stream, cancels timers and leaves an unknown snapshot', async () => {
  const r = rig();
  await r.helper.start(); await r.c.settle();
  await r.send(abrt()); assert.equal(r.last().state, 'playing');
  await r.helper.stop();
  assert.equal(r.streams[0]!.destroyed, true); assert.equal(r.c.timers.size, 0);
  assert.equal(r.last().state, 'unknown'); const n = r.writes.length;
  await r.c.advance(60_000); assert.equal(r.writes.length, n); assert.equal(r.opens.length, 1);
  // Stop while waiting to reopen.
  const q = rig(); await q.helper.start(); await q.c.settle(); q.streams[0]!.end(); await q.c.settle();
  await q.helper.stop(); assert.equal(q.c.timers.size, 0);
});

test('snapshot replacement is atomic and a failed replacement keeps the previous snapshot', async () => {
  const dir = mkdtempSync(join(realpathSync(tmpdir()), 'now-playing-write-'));
  try {
    const path = join(dir, 'now-playing.json'); const seen: string[] = [];
    let failRename = false;
    const write = snapshotWriter(path, { beforeRename() {
      // The new content exists only as a sibling temp file; the target is absent or the complete previous document.
      const names = readdirSync(dir); seen.push(names.join(','));
      assert.ok(names.every(n => n === 'now-playing.json' || n.startsWith('now-playing.json.') && n.endsWith('.tmp')));
      if (existsSync(path)) JSON.parse(readFileSync(path, 'utf8'));
      if (failRename) throw new Error('rename');
    } });
    await write('{"n":1}\n'); assert.equal(readFileSync(path, 'utf8'), '{"n":1}\n');
    await write('{"n":2}\n'); assert.equal(readFileSync(path, 'utf8'), '{"n":2}\n');
    assert.deepEqual(readdirSync(dir), ['now-playing.json']);
    assert.ok(seen.every(s => /\.tmp/.test(s)));
    failRename = true;
    await assert.rejects(write('{"n":3}\n'));
    assert.equal(readFileSync(path, 'utf8'), '{"n":2}\n'); assert.deepEqual(readdirSync(dir), ['now-playing.json']);
    await assert.rejects(write(' '.repeat(MAX_SNAPSHOT_BYTES + 1))); assert.deepEqual(readdirSync(dir), ['now-playing.json']);
    assert.equal((await import('node:fs')).statSync(path).mode & 0o777, 0o600);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('helper publishes complete snapshots to a real file through fake pipe streams', async () => {
  const dir = mkdtempSync(join(realpathSync(tmpdir()), 'now-playing-e2e-'));
  try {
    const path = join(dir, 'now-playing.json'); const covers = coverFiles(dir);
    const c = fakeClock(); const streams: PassThrough[] = [];
    const helper = new Helper({ clock: c.clock, async open() { const s = new PassThrough(); streams.push(s); return s; }, write: snapshotWriter(path), writeCover: covers.write, pruneCovers: covers.prune, log: () => {} });
    await helper.start(); await c.settle();
    assert.equal(JSON.parse(readFileSync(path, 'utf8')).state, 'unknown');
    streams[0]!.write(track('Song', 'Artist') + abrt() + pic(PNG)); await c.settle(); await helper.idle();
    const s = JSON.parse(readFileSync(path, 'utf8')) as Snapshot;
    const sha = createHash('sha256').update(PNG).digest('hex');
    assert.deepEqual([s.schema, s.state, s.track, s.cover], ['houseatlas.now-playing.v1', 'playing', { title: 'Song', artist: 'Artist' }, { mediaType: 'image/png', sha256: sha }]);
    assert.ok(readFileSync(join(dir, `cover-${sha}.png`)).equals(PNG)); assert.equal(statSync(join(dir, `cover-${sha}.png`)).mode & 0o777, 0o600);
    await helper.stop();
    assert.equal(JSON.parse(readFileSync(path, 'utf8')).state, 'unknown'); assert.deepEqual(readdirSync(dir).sort(), ['now-playing.json', `cover-${sha}.png`].sort());
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('a cover is written once per change, before its snapshot, and unreferenced covers are removed', async () => {
  let fail = false, failPrune = false;
  const r = rig({ failWrites: () => fail, failPrune: () => failPrune });
  await r.helper.start(); await r.c.settle();
  const shaOf = (b: Buffer) => createHash('sha256').update(b).digest('hex');
  await r.send(bundle2('One', 'A', PNG), abrt());
  assert.deepEqual(r.coverWrites, [coverName({ mediaType: 'image/png', sha256: shaOf(PNG) })]);
  assert.deepEqual([...r.files.keys()], r.coverWrites); assert.equal(r.last().cover?.sha256, shaOf(PNG));
  await r.c.advance(HEARTBEAT_MS * 4); await r.send(abrt('1/1/1'));
  assert.equal(r.coverWrites.length, 1); // heartbeats and state changes never rewrite the cover
  await r.send(bundle2('Two', 'A', JPEG));
  assert.deepEqual([...r.files.keys()], [coverName({ mediaType: 'image/jpeg', sha256: shaOf(JPEG) })]); // the old cover is gone
  await r.send(bundle2('Three', 'A')); // a track without a picture
  assert.equal('cover' in r.last(), false); assert.equal(r.files.size, 0);
  await r.send(bundle2('Four', 'A', JPEG)); // an earlier picture comes back: its file is written again
  assert.deepEqual([...r.files.keys()], [coverName({ mediaType: 'image/jpeg', sha256: shaOf(JPEG) })]);
  // A cover written for a snapshot that then failed is removed once a later snapshot lands, even one naming the old cover.
  fail = true; await r.send(bundle2('Five', 'A', PNG)); fail = false;
  await r.send(bundle2('Four', 'A', JPEG));
  assert.deepEqual([...r.files.keys()], [coverName({ mediaType: 'image/jpeg', sha256: shaOf(JPEG) })]);
  // Pruning that removes the old cover and then fails never leaves a snapshot naming a missing cover file.
  failPrune = true; await r.send(bundle2('Six', 'A')); failPrune = false;
  assert.equal(r.files.size, 0);
  await r.send(bundle2('Four', 'A', JPEG));
  assert.deepEqual([...r.files.keys()], [coverName({ mediaType: 'image/jpeg', sha256: shaOf(JPEG) })]);
  await r.helper.stop();
});

test('playing expires to unknown on its own deadline, renewed only by abrt', async () => {
  const r = rig();
  await r.helper.start(); await r.c.settle();
  await r.c.advance(1000); // keep the 5 s deadline off the heartbeat times
  await r.send(ssnc('pbeg')); assert.equal(r.last().state, 'unknown'); // a start alone starts no deadline and no playing
  await r.send(abrt());
  assert.equal(r.last().state, 'playing');
  await r.c.advance(PLAYING_TTL_MS - 1); assert.equal(r.last().state, 'playing');
  const n = r.writes.length; await r.c.advance(1);
  assert.ok(r.writes.length > n); assert.equal(r.last().state, 'unknown'); assert.equal(r.last().since, null); assert.equal(r.last().track, null);
  assert.equal(Date.parse(r.last().checkedAt) - Date.parse(r.writes[0]!.checkedAt), 1000 + PLAYING_TTL_MS); // published at the deadline, not at a heartbeat
  // abrt renews; arst, pbeg and abrt 0/0/0 do not.
  await r.send(abrt()); assert.equal(r.last().state, 'playing');
  for (let i = 0; i < 6; i++) { await r.c.advance(4000); await r.send(abrt()); assert.equal(r.last().state, 'playing'); }
  await r.c.advance(4000); await r.send(ssnc('arst', '0/0/0'), ssnc('pbeg'), abrt('0/0/0'));
  assert.equal(r.last().state, 'playing'); await r.c.advance(1000); assert.equal(r.last().state, 'unknown');
  // Stop codes publish stopped at once and cancel the deadline; abrt after paus resumes.
  await r.send(abrt()); await r.send(ssnc('paus')); assert.equal(r.last().state, 'stopped');
  await r.c.advance(60_000); assert.equal(r.last().state, 'stopped');
  await r.send(abrt()); assert.equal(r.last().state, 'playing');
  // EOF cancels the deadline.
  r.streams.at(-1)!.end(); await r.c.settle(); assert.equal(r.last().state, 'unknown');
  await r.helper.stop(); assert.equal(r.c.timers.size, 0);
});

test('a real FIFO always has a reader: shairport-sync can open it before, between and after writers, and nothing is missed', async () => {
  const dir = mkdtempSync(join(realpathSync(tmpdir()), 'now-playing-fifo-'));
  const writers: number[] = [];
  let helper: Helper | null = null;
  try {
    const path = join(dir, 'metadata'); execFileSync('mkfifo', [path]);
    const c = fakeClock(); const writes: Snapshot[] = []; let opens = 0;
    const open = openPipe(path);
    helper = new Helper({ clock: c.clock, async open() { opens++; return open(); }, async write(t) { writes.push(JSON.parse(t)); }, async writeCover() {}, async pruneCovers() {}, log: () => {} });
    const real = (ms: number) => new Promise(r => setTimeout(r, ms));
    const until = async (ok: () => boolean) => { for (let i = 0; i < 100 && !ok(); i++) await real(20); assert.ok(ok()); };
    // Exactly how shairport-sync opens its write end: no reader may be held by this test (ENXIO without one).
    const writer = () => { const w = openSync(path, constants.O_WRONLY | constants.O_NONBLOCK); writers.push(w); return w; };
    const drop = (w: number) => { closeSync(w); writers.splice(writers.indexOf(w), 1); };
    await helper.start(); await until(() => opens === 1);
    let w = writer(); // first writer, opened after the helper started
    writeSync(w, track('Song', 'Artist') + abrt() + pic(PNG));
    await until(() => writes.at(-1)!.state === 'playing');
    assert.equal(writes.at(-1)!.cover?.mediaType, 'image/png');
    drop(w); // the writer goes away; the helper stays attached, no EOF, no reopen, no reset
    await real(400);
    assert.equal(opens, 1); assert.equal(writes.at(-1)!.state, 'playing'); assert.equal(writes.at(-1)!.track?.title, 'Song');
    w = writer(); // a later writer must open successfully even though the previous one closed
    writeSync(w, ssnc('pend')); await until(() => writes.at(-1)!.state === 'stopped');
    writeSync(w, abrt()); await until(() => writes.at(-1)!.state === 'playing');
    drop(w);
    w = writer(); writeSync(w, ssnc('paus')); drop(w); // written then closed at once: still read
    await until(() => writes.at(-1)!.state === 'stopped');
    assert.equal(opens, 1); assert.equal(writes.at(-1)!.lastTrack?.title, 'Song');
  } finally {
    for (const w of writers) closeSync(w);
    if (helper) await helper.stop();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a regular file at the pipe path is refused', async () => {
  const dir = mkdtempSync(join(realpathSync(tmpdir()), 'now-playing-notfifo-'));
  try { const path = join(dir, 'metadata'); writeFileSync(path, ''); await assert.rejects(openPipe(path)()); }
  finally { rmSync(dir, { recursive: true, force: true }); }
});

test('the snapshot writer uses unique exclusive 0600 temp files and removes only its own', async () => {
  const dir = mkdtempSync(join(realpathSync(tmpdir()), 'now-playing-temp-'));
  try {
    const path = join(dir, 'now-playing.json');
    // Pre-existing files at the former predictable temp name are never opened, truncated or unlinked.
    const old = `${path}.${process.pid}.tmp`;
    const outside = join(dir, 'outside'); writeFileSync(outside, 'keep');
    symlinkSync(outside, old);
    const temps: string[] = []; let failRename = false;
    const write = snapshotWriter(path, { beforeRename() {
      const names = readdirSync(dir).filter(n => n.startsWith('now-playing.json.') && n.endsWith('.tmp') && join(dir, n) !== old);
      assert.equal(names.length, 1); temps.push(names[0]!);
      assert.equal(statSync(join(dir, names[0]!)).mode & 0o777, 0o600);
      if (failRename) throw new Error('rename');
    } });
    await write('{"n":1}\n'); await write('{"n":2}\n');
    assert.notEqual(temps[0], temps[1]); assert.ok(temps.every(t => /^now-playing\.json\.\d+\.[0-9a-f]{16}\.tmp$/.test(t)));
    failRename = true; await assert.rejects(write('{"n":3}\n'));
    assert.equal(readFileSync(path, 'utf8'), '{"n":2}\n'); assert.equal(readFileSync(outside, 'utf8'), 'keep');
    assert.deepEqual(readdirSync(dir).sort(), ['now-playing.json', `now-playing.json.${process.pid}.tmp`, 'outside']);
    // A failed open leaves other files alone: a missing directory creates and removes nothing.
    await assert.rejects(snapshotWriter(join(dir, 'missing', 'x.json'))('{}\n'));
    assert.deepEqual(readdirSync(dir).sort(), ['now-playing.json', `now-playing.json.${process.pid}.tmp`, 'outside']);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('cover files are exclusive 0600 sibling files and pruning touches only cover names', async () => {
  const dir = mkdtempSync(join(realpathSync(tmpdir()), 'now-playing-covers-'));
  try {
    const files = coverFiles(dir); const sha = (c: string) => c.repeat(64);
    const a = `cover-${sha('a')}.jpg`, b = `cover-${sha('b')}.png`;
    await files.write(a, JPEG); await files.write(b, PNG); await files.write(a, JPEG); // writing again replaces
    assert.ok(readFileSync(join(dir, a)).equals(JPEG)); assert.equal(statSync(join(dir, a)).mode & 0o777, 0o600);
    assert.deepEqual(readdirSync(dir).sort(), [a, b]);
    await assert.rejects(Promise.resolve().then(() => files.write('cover-short.jpg', JPEG)), /cover file name/);
    await assert.rejects(Promise.resolve().then(() => files.write('../escape.jpg', JPEG)));
    const others = ['now-playing.json', `cover-${sha('c')}.gif`, `cover-${sha('d')}.jpg.tmp`, `cover-${'e'.repeat(63)}.jpg`, `Cover-${sha('f')}.jpg`, 'notes.txt'];
    for (const n of others) writeFileSync(join(dir, n), 'keep');
    // Only regular files are removed: a directory, a symlink or a FIFO with a cover name is left alone.
    const odd = [`cover-${sha('9')}.png`, `cover-${sha('8')}.jpg`, `cover-${sha('7')}.png`];
    mkdirSync(join(dir, odd[0]!)); symlinkSync(join(dir, 'notes.txt'), join(dir, odd[1]!)); execFileSync('mkfifo', [join(dir, odd[2]!)]);
    await files.prune(a);
    assert.ok(existsSync(join(dir, a))); assert.ok(!existsSync(join(dir, b)));
    for (const n of odd) assert.ok(lstatSync(join(dir, n)), n);
    assert.equal(readFileSync(join(dir, 'notes.txt'), 'utf8'), 'keep'); // the link's target is untouched
    for (const n of others) assert.equal(readFileSync(join(dir, n), 'utf8'), 'keep', n);
    await files.prune(null); assert.deepEqual(readdirSync(dir).sort(), [...others, ...odd].sort());
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
