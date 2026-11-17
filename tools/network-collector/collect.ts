import { spawn } from 'node:child_process';
import type { EventEmitter } from 'node:events';
import { networkInterfaces } from 'node:os';
import { inSubnet } from './config.ts';
import type { Config } from './config.ts';
import { targets } from './inventory.ts';
import type { Inventory } from './inventory.ts';
import type { Fact, Guard } from './store.ts';

export type CommandResult = { stdout: string; code: number | null; interrupted?: boolean };
export type Runner = (file: string, args: string[], timeoutMs: number, signal: AbortSignal) => Promise<CommandResult>;
type Child = {
  stdout: EventEmitter & { destroy(): unknown }; stderr: EventEmitter & { destroy(): unknown };
  once(event: string, listener: (...args: any[]) => void): unknown;
  removeListener(event: string, listener: (...args: any[]) => void): unknown;
  kill(signal: NodeJS.Signals): unknown;
};
export type SpawnChild = (file: string, args: string[], options: {
  shell: false; stdio: ['ignore', 'pipe', 'pipe']; env: NodeJS.ProcessEnv;
}) => Child;
export const createRunner = (spawnChild: SpawnChild = spawn): Runner => (file, args, timeoutMs, signal) => new Promise(resolve => {
  if (signal.aborted) return resolve({ stdout: '', code: null, interrupted: true });
  const child = spawnChild(file, args, { shell: false, stdio: ['ignore', 'pipe', 'pipe'], env: { PATH: '/usr/bin:/bin:/usr/sbin:/sbin', LANG: 'C', LC_ALL: 'C' } });
  let stdout = '', size = 0, interrupted = false, finished = false;
  let escalation: ReturnType<typeof setTimeout> | undefined;
  let teardown: ReturnType<typeof setTimeout> | undefined;
  const stop = () => {
    if (interrupted || finished) return;
    interrupted = true;
    escalation = setTimeout(() => {
      // A killed child may never report close (e.g. inherited open pipes).
      // Release callers after one final bounded drain, without claiming exit.
      teardown = setTimeout(() => {
        finish(null);
        child.stdout.destroy(); child.stderr.destroy();
      }, 250);
      child.kill('SIGKILL');
    }, 250);
    child.kill('SIGTERM');
  };
  const timer = setTimeout(stop, timeoutMs);
  const output = (v: Buffer) => { size += v.length; if (size > 65_536) stop(); else stdout += v.toString(); };
  const errorOutput = (v: Buffer) => { size += v.length; if (size > 65_536) stop(); };
  child.stdout.on('data', output); child.stderr.on('data', errorOutput);
  const failed = () => finish(null);
  const finish = (code: number | null) => {
    if (finished) return;
    finished = true;
    clearTimeout(timer); clearTimeout(escalation); clearTimeout(teardown); signal.removeEventListener('abort', stop);
    child.stdout.removeListener('data', output); child.stderr.removeListener('data', errorOutput);
    child.removeListener('error', failed); child.removeListener('close', finish);
    resolve({ stdout, code, interrupted });
  };
  child.once('error', failed); child.once('close', finish);
  signal.addEventListener('abort', stop, { once: true });
  if (signal.aborted) stop();
});
export const run = createRunner();
export const addresses = (iface: string) => networkInterfaces()[iface]?.filter(a => !a.internal).map(a => a.address) ?? [];
export async function homeGuard(home: Config['home'], runner: Runner, local: typeof addresses, signal: AbortSignal): Promise<Guard> {
  try {
    const route = await runner('/sbin/route', ['-n', 'get', 'default'], 2500, signal);
    if (route.code !== 0 || route.interrupted || signal.aborted) return 'unknown';
    const gateway = route.stdout.match(/^\s*gateway:\s*(\S+)/m)?.[1];
    const iface = route.stdout.match(/^\s*interface:\s*(\S+)/m)?.[1];
    if (!gateway || !iface) return 'unknown';
    if (gateway !== home.gateway || iface !== home.interface || !local(iface).some(ip => inSubnet(ip, home.subnet))) return 'not-at-home';
    const arp = await runner('/usr/sbin/arp', ['-an'], 2500, signal);
    if (arp.code !== 0 || arp.interrupted || signal.aborted) return 'unknown';
    const row = arp.stdout.split('\n').map(line => line.match(/\(([^)]+)\) at ([\da-f:]+) on (\S+)/i)).find(m => m?.[1] === gateway && m?.[3] === iface);
    if (!row) return 'unknown';
    const mac = row[2]!.split(':').map(x => x.padStart(2, '0')).join(':').toLowerCase();
    return mac === home.routerMac.toLowerCase() ? 'home' : 'not-at-home';
  } catch { return 'unknown'; }
}
export function unmeasured(at: number, reason: string): Fact {
  return { state: 'not-measured', latencyMs: null, loss: null, measuredAt: null, recordedAt: new Date(at).toISOString(), reason };
}
export function parsePing(result: CommandResult, at: number): Fact {
  const unknown = () => unmeasured(at, 'command-unavailable');
  if (result.interrupted || result.code === null) return unknown();
  const summary = result.stdout.match(/(\d+) packets transmitted, (\d+) (?:packets )?received/);
  if (!summary || Number(summary[1]) !== 1 || ![0, 1].includes(Number(summary[2]))) return unknown();
  const received = Number(summary[2]);
  if (received === 0 && result.code !== 2 && result.code !== 1) return unknown();
  const rtt = result.stdout.match(/(?:round-trip|rtt).*?= ([\d.]+)\/([\d.]+)\/([\d.]+)(?:\/[\d.]+)?\s*ms/);
  const numbers = rtt?.slice(1, 4).map(Number);
  if (received && (result.code !== 0 || !numbers || !numbers.every(n => Number.isFinite(n) && n >= 0 && n <= 2500) || numbers[0]! > numbers[1]! || numbers[1]! > numbers[2]!)) return unknown();
  return { state: received ? 'reachable' : 'no-reply', latencyMs: received ? numbers![1]! : null, loss: 1 - received, measuredAt: new Date(at).toISOString(), recordedAt: new Date(at).toISOString(), reason: null };
}
export async function collect(doc: Inventory, config: Config, runner: Runner, local: typeof addresses, signal: AbortSignal, now = Date.now) {
  const guard = await homeGuard(config.home, runner, local, signal);
  const entries = [...targets(doc, config.home)];
  const facts = new Map<string, Fact>();
  // Four workers bound a 64-device cycle to at most 48 seconds of pings including forced teardown.
  let cursor = 0;
  await Promise.all(Array.from({ length: 4 }, async () => {
    while (cursor < entries.length) {
      const [device, target] = entries[cursor++]!;
      let fact = unmeasured(now(), guard === 'home' ? 'no-target' : 'not-at-home');
      if (guard === 'home' && target && !signal.aborted) {
        try { fact = parsePing(await runner('/sbin/ping', ['-n', '-c', '1', '-W', '1000', target], 2500, signal), now()); }
        catch { fact = unmeasured(now(), 'command-unavailable'); }
      }
      if (signal.aborted) fact = unmeasured(now(), 'shutdown');
      facts.set(device, fact);
    }
  }));
  return { guard, facts };
}
