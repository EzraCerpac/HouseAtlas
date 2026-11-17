import { keys, need, integer, parseJson } from './config.ts';
import type { Config } from './config.ts';
import { collect, homeGuard, parsePing, unmeasured } from './collect.ts';
import type { Runner, CommandResult, addresses } from './collect.ts';
import type { Inventory } from './inventory.ts';
import { targets } from './inventory.ts';
import type { Store } from './store.ts';

export type Action = { kind: 'speed' } | { kind: 'ping'; deviceId: string } | { kind: 'port'; deviceId: string; port: number };
export function parseAction(value: unknown, config: Config): Action {
  const a = keys(value, ['kind'], ['deviceId', 'port']);
  need(['ping', 'port', 'speed'].includes(a.kind), 'Invalid action');
  keys(a, a.kind === 'speed' ? ['kind'] : a.kind === 'ping' ? ['kind', 'deviceId'] : ['kind', 'deviceId', 'port']);
  if (a.kind !== 'speed') need(typeof a.deviceId === 'string' && a.deviceId.length > 0 && a.deviceId.length <= 4096, 'Invalid device ID');
  if (a.kind === 'port') need(integer(a.port, 1, 65535) && config.actionPorts.includes(a.port), 'Port not allowed');
  return a as Action;
}
export function parseSpeed(result: CommandResult, at: number) {
  const fact = { state: 'unknown', recordedAt: new Date(at).toISOString(), downloadBitsPerSecond: null as number | null, uploadBitsPerSecond: null as number | null, latencyMs: null as number | null, reason: null as string | null };
  if (result.interrupted || result.code !== 0) return { ...fact, state: 'failed', reason: 'command-unavailable' };
  try {
    const v = parseJson(result.stdout) as Record<string, unknown>;
    need(v && typeof v === 'object' && !Array.isArray(v), 'Invalid speed output');
    for (const [key, field, max] of [['dl_throughput', 'downloadBitsPerSecond', 1e13], ['ul_throughput', 'uploadBitsPerSecond', 1e13], ['base_rtt', 'latencyMs', 120000]] as const) {
      if (Object.hasOwn(v, key)) {
        const n = v[key]; need(typeof n === 'number' && Number.isFinite(n) && n >= 0 && n <= max, 'Invalid speed metric');
        fact[field] = n;
      }
    }
    fact.state = [fact.downloadBitsPerSecond, fact.uploadBitsPerSecond, fact.latencyMs].every(n => n !== null) ? 'measured' : 'unknown';
    fact.reason = Object.hasOwn(v, 'error_code') || Object.hasOwn(v, 'error_domain') ? 'tool-error' : fact.state === 'unknown' ? 'missing-fields' : null;
    if (fact.reason === 'tool-error') fact.state = 'failed';
    return fact;
  } catch { return { ...fact, downloadBitsPerSecond: null, uploadBitsPerSecond: null, latencyMs: null, state: 'unknown', reason: 'malformed-output' }; }
}
export function wifiUnavailable(at: number) {
  // No stable, permission-independent stock CLI scan contract is qualified.
  // null is unknown visibility, never an assertion of zero nearby networks.
  return { state: 'unavailable', recordedAt: new Date(at).toISOString(), networks: null, reason: 'no-dependable-unprivileged-scanner' };
}
export class Actions {
  private active: Promise<unknown> | null = null;
  private speedReserved = false;
  private routine: Promise<unknown> | null = null;
  private stop = new AbortController();
  private store: Store; private config: Config; private runner: Runner; private local: typeof addresses; private now: () => number;
  constructor(store: Store, config: Config, runner: Runner, local: typeof addresses, now = Date.now) {
    this.store = store; this.config = config; this.runner = runner; this.local = local; this.now = now;
  }
  collectRoutine(doc: Inventory, signal: AbortSignal) {
    if (this.speedReserved) return Promise.resolve({ guard: 'unknown' as const, facts: new Map(doc.inventory.devices.map(d => [d.id, unmeasured(this.now(), 'speed-test-in-progress')])) });
    const cycle = collect(doc, this.config, this.runner, this.local, signal, this.now);
    this.routine = cycle;
    return cycle.finally(() => { this.routine = null; });
  }
  async shutdown() { this.stop.abort(); await this.active; }
  execute(action: Action, nightlyDate: string | null = null): Promise<any> {
    action = parseAction(action, this.config);
    if (this.active) return Promise.resolve({ status: 409, body: '{"error":"busy"}' });
    if (this.stop.signal.aborted) return Promise.resolve({ status: 503, body: '{"error":"shutdown"}' });
    // Block new ping probes immediately; an already-started cycle drains first.
    if (action.kind === 'speed') this.speedReserved = true;
    // Reserve synchronously before any asynchronous owner work.
    this.active = Promise.resolve().then(async () => {
      // Persist before dispatch: restart must not repeat a claimed night.
      if (nightlyDate) this.store.claimNight(nightlyDate);
      const signal = this.stop.signal;
      let result: unknown;
      if (action.kind === 'speed') {
        if (this.routine) await this.routine;
        let output: CommandResult;
        try { output = await this.runner('/usr/bin/networkQuality', ['-c', '-M', '60'], 65_000, signal); }
        catch { output = { stdout: '', code: null }; }
        result = parseSpeed(output, this.now());
        this.store.recordExtra('speed', result);
      } else {
        const doc = this.store.inventory();
        const target = doc ? targets(doc, this.config.home).get(action.deviceId) : undefined;
        // Unknown IDs are rejected rather than recorded as real devices.
        if (target === undefined) return { status: 400, body: '{"error":"unknown-device"}' };
        const guard = target ? await homeGuard(this.config.home, this.runner, this.local, signal) : 'unknown';
        const reason = !target ? 'no-target' : guard !== 'home' ? 'not-at-home' : null;
        if (action.kind === 'ping') {
          result = unmeasured(this.now(), reason ?? 'command-unavailable');
          if (!reason && !signal.aborted) {
            try { result = parsePing(await this.runner('/sbin/ping', ['-n', '-c', '1', '-W', '1000', target!], 2500, signal), this.now()); } catch { /* retain unknown */ }
          }
        } else {
          result = { state: 'unknown', reason: reason ?? 'command-unavailable' };
          if (!reason && !signal.aborted) {
            try {
              const r = await this.runner('/usr/bin/nc', ['-n', '-z', '-w', '2', target!, String(action.port)], 2500, signal);
              // A failed connect can mean timeout, refusal or another error.
              result = r.code === 0 && !r.interrupted ? { state: 'open', reason: null } : result;
            } catch { /* retain unknown */ }
          }
        }
      }
      const entry = { ...action, recordedAt: new Date(this.now()).toISOString(), result };
      this.store.recordExtra('action', entry);
      return { status: 200, body: JSON.stringify({ version: 1, ...entry }) };
    }).finally(() => { this.active = null; this.speedReserved = false; });
    return this.active;
  }
}

// Called by the periodic scheduler, using local civil time (including DST).
// First cycle at/after the configured minute runs once; no prior-day catch-up.
export async function periodic(store: Store, config: Config, actions: Actions, now = Date.now()) {
  const d = new Date(now);
  const date = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const [hour, minute] = config.speedTime.split(':').map(Number);
  if (d.getHours() * 60 + d.getMinutes() >= hour! * 60 + minute! && (store.lastNight() ?? '') < date) await actions.execute({ kind: 'speed' }, date);
  const previous = store.recentExtra('wifi', 1)[0];
  if (!previous || now - Date.parse(previous.recordedAt) >= config.wifiIntervalMs) store.recordExtra('wifi', wifiUnavailable(now));
}
