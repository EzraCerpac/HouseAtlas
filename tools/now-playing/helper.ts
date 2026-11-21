import type { Readable } from 'node:stream';
import { ItemParser } from './items.ts';
import { NowPlaying, coverName } from './state.ts';

export const HEARTBEAT_MS = 5000;
export const PLAYING_TTL_MS = 5000; // playing lasts this long after the latest evidence
export const RETRY_MS = 1000; // wait after a missing pipe or a read error

export type Clock = { now(): number; setTimeout(fn: () => void, ms: number): () => void };
export type Deps = {
  open(): Promise<Readable>;
  write(text: string): Promise<void>;
  writeCover(name: string, bytes: Buffer): Promise<void>;
  pruneCovers(keep: string | null): Promise<void>; // removes cover files other than `keep`
  clock: Clock;
  log(message: string): void;
};

export class Helper {
  private deps: Deps;
  private parser = new ItemParser();
  private model = new NowPlaying();
  private stopping = false;
  private stream: Readable | null = null;
  private wake: (() => void) | null = null;
  private cancelBeat: (() => void) | null = null;
  private cancelExpiry: (() => void) | null = null;
  private pump: Promise<void> | null = null;
  private dirty = false;
  private writeFailing = false;
  private loop: Promise<void> | null = null;
  private written: string | null = null; // cover file known to exist
  private prunePending = false; // a cover was written since the last successful pruning
  private kept: string | null | undefined; // cover file the last pruning kept; undefined until the first pruning
  constructor(deps: Deps) { this.deps = deps; }

  /** Publishes an "unknown" snapshot (throws if that fails), then reads the pipe in the background. */
  async start(): Promise<void> {
    await this.publish();
    this.arm();
    this.loop = this.run();
  }
  async stop(): Promise<void> {
    this.stopping = true;
    this.cancelBeat?.();
    this.disarmExpiry();
    this.stream?.destroy();
    this.wake?.();
    await this.loop;
    await this.pump;
    this.model.reset();
    try { await this.publish(); } catch { /* the last heartbeat ages out for readers */ }
  }
  /** Resolves when no snapshot write is pending or running. */
  async idle(): Promise<void> { while (this.pump) await this.pump; }

  /** Cover file first (once per change), then the snapshot that names it, then removal of covers it no longer names. */
  private async publish() {
    const cover = this.model.cover();
    const name = cover ? coverName(cover) : null;
    const text = JSON.stringify(this.model.snapshot(this.deps.clock.now())) + '\n';
    if (cover && name !== this.written) { await this.deps.writeCover(name!, cover.bytes); this.written = name; this.prunePending = true; }
    await this.deps.write(text);
    if (name !== this.kept || this.prunePending) {
      try { await this.deps.pruneCovers(name); this.kept = name; this.written = name; this.prunePending = false; } // only `name` remains
      catch { /* best effort; retried on the next write */ }
    }
  }
  private arm() {
    this.cancelBeat = this.deps.clock.setTimeout(() => { this.request(); this.arm(); }, HEARTBEAT_MS);
  }
  private disarmExpiry() { this.cancelExpiry?.(); this.cancelExpiry = null; }
  /** Own deadline, so "playing" turns "unknown" on time rather than at the next heartbeat. */
  private armExpiry() {
    this.disarmExpiry();
    this.cancelExpiry = this.deps.clock.setTimeout(() => {
      this.cancelExpiry = null;
      if (this.model.expire()) this.request();
    }, PLAYING_TTL_MS);
  }
  private request() {
    this.dirty = true;
    this.pump ??= this.drain();
  }
  private async drain() {
    try {
      while (this.dirty) {
        this.dirty = false;
        try { await this.publish(); this.writeFailing = false; }
        catch { if (!this.writeFailing) this.deps.log('Snapshot write failed; retrying on the next change or heartbeat'); this.writeFailing = true; }
      }
    } finally { this.pump = null; }
  }
  private sleep(ms: number) {
    return new Promise<void>(resolve => {
      const cancel = this.deps.clock.setTimeout(() => { this.wake = null; resolve(); }, ms);
      this.wake = () => { cancel(); this.wake = null; resolve(); };
    });
  }

  private async run() {
    let announced = false;
    while (!this.stopping) {
      try {
        const stream = await this.deps.open();
        if (this.stopping) { stream.destroy(); break; }
        this.stream = stream;
        announced = false;
        await new Promise<void>(resolve => {
          stream.on('data', (chunk: Buffer | string) => {
            let changed = false;
            for (const item of this.parser.feed(chunk)) {
              const effect = this.model.apply(item, this.deps.clock.now());
              changed = effect.changed || changed;
              if (effect.renew) this.armExpiry(); else if (!this.model.playing) this.disarmExpiry();
            }
            if (changed) this.request();
          });
          const done = () => resolve();
          stream.once('end', done); stream.once('close', done); stream.once('error', done);
        });
        stream.destroy();
      } catch {
        if (!announced) this.deps.log('Metadata pipe unavailable; retrying');
        announced = true;
      }
      this.stream = null;
      this.parser.reset();
      this.disarmExpiry();
      const changed = this.model.reset();
      if (this.stopping) break;
      if (changed) this.request(); // otherwise the heartbeat keeps `checkedAt` fresh
      await this.sleep(RETRY_MS);
    }
  }
}
