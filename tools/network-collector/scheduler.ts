import { setTimeout as delay } from 'node:timers/promises';

export class Scheduler {
  private active: Promise<void> | null = null;
  private stop = new AbortController();
  private cycle: (signal: AbortSignal) => Promise<void>;
  constructor(cycle: (signal: AbortSignal) => Promise<void>) { this.cycle = cycle; }
  tick(): Promise<void> {
    if (this.stop.signal.aborted || this.active) return Promise.resolve();
    this.active = Promise.resolve().then(() => this.cycle(this.stop.signal)).finally(() => { this.active = null; });
    return this.active;
  }
  async shutdown() { this.stop.abort(); await this.active; }
  async run(intervalMs: number, clock = () => performance.now(), sleep = (ms: number, signal: AbortSignal) => delay(ms, undefined, { signal })) {
    const origin = clock();
    let next = origin;
    while (!this.stop.signal.aborted) {
      try { await sleep(Math.max(0, next - clock()), this.stop.signal); } catch { if (this.stop.signal.aborted) break; throw new Error('Scheduler wait failed'); }
      if (this.stop.signal.aborted) break;
      await this.tick();
      // Skip missed slots; never accumulate interval drift or catch up after
      // sleep, a long cycle or restart. Wall time is only for fact timestamps.
      next = origin + (Math.floor((clock() - origin) / intervalMs) + 1) * intervalMs;
    }
  }
}
