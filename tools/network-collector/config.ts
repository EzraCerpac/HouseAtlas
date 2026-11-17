import { constants, openSync, closeSync, fstatSync, readFileSync, lstatSync } from 'node:fs';
import { dirname, isAbsolute, resolve } from 'node:path';
import { isIP } from 'node:net';

export class Refusal extends Error {}
export function need(ok: unknown, message: string): asserts ok {
  if (!ok) throw new Refusal(message);
}
export function object(value: unknown): Record<string, any> {
  need(value !== null && typeof value === 'object' && !Array.isArray(value), 'Expected object');
  return value as Record<string, any>;
}
export function keys(value: unknown, required: string[], optional: string[] = []) {
  const row = object(value);
  need(required.every(k => Object.hasOwn(row, k)) && Object.keys(row).every(k => [...required, ...optional].includes(k)), 'Unexpected or missing field');
  return row;
}
export const integer = (n: unknown, min: number, max: number): n is number => typeof n === 'number' && Number.isSafeInteger(n) && n >= min && n <= max;
export const loopback = (s: string) => s === '127.0.0.1' || s === '::1';
export function privateDirectory(path: string) {
  need(isAbsolute(path) && resolve(path) === path, 'Private path must be absolute and normalized');
  const s = lstatSync(path);
  need(s.isDirectory() && !s.isSymbolicLink() && (s.mode & 0o7777) === 0o700 && s.uid === process.geteuid?.(), 'Private directory must be owned by this user, mode 0700');
  // Refuse symlinked ancestors as well as the selected directory.
  for (let p = dirname(path); p !== dirname(p); p = dirname(p)) need(!lstatSync(p).isSymbolicLink(), 'Private path contains symlink');
}
export function readPrivate(path: string, maxBytes: number): string {
  privateDirectory(dirname(path));
  const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const s = fstatSync(fd);
    need(s.isFile() && s.nlink === 1 && (s.mode & 0o7777) === 0o600 && s.uid === process.geteuid?.(), 'Private file must be owned by this user, mode 0600, single link');
    need(s.size <= maxBytes, 'Private file exceeds byte limit');
    const bytes = readFileSync(fd);
    need(bytes.length <= maxBytes, 'Private file exceeds byte limit');
    const after = fstatSync(fd);
    need(after.size === s.size && after.mtimeMs === s.mtimeMs && after.ctimeMs === s.ctimeMs, 'Private file changed while reading');
    return bytes.toString('utf8');
  } finally { closeSync(fd); }
}
export type Config = {
  listen: { address: string; port: number };
  home: { gateway: string; routerMac: string; interface: string; subnet: string };
  speedTime: string; wifiIntervalMs: number; actionPorts: number[];
  intervalMs: number; rawDays: number; hourlyMonths: number; storePath: string; inventoryPath: string;
};
export const ipv4 = (s: unknown): s is string => typeof s === 'string' && isIP(s) === 4;
export function inSubnet(ip: string, cidr: string) {
  const [base, bits] = cidr.split('/');
  if (!ipv4(ip) || !ipv4(base)) return false;
  const number = (s: string) => s.split('.').reduce((n, x) => ((n << 8) | Number(x)) >>> 0, 0);
  const mask = (0xffffffff << (32 - Number(bits))) >>> 0;
  return (number(ip) & mask) === (number(base) & mask);
}
export function validateConfig(input: unknown): Config {
  const c = keys(input, ['listen', 'home', 'storePath', 'inventoryPath'], ['intervalMs', 'rawDays', 'hourlyMonths', 'speedTime', 'wifiIntervalMs', 'actionPorts']);
  const l = keys(c.listen, ['address', 'port']);
  need(loopback(l.address), 'Listen address must be exactly 127.0.0.1 or ::1');
  need(integer(l.port, 1, 65535), 'Listen port must be 1..65535');
  const h = keys(c.home, ['gateway', 'routerMac', 'interface', 'subnet']);
  need(ipv4(h.gateway) && typeof h.subnet === 'string' && /^\d+\.\d+\.\d+\.\d+\/(?:[1-9]|[12]\d|30)$/.test(h.subnet) && inSubnet(h.gateway, h.subnet), 'Invalid IPv4 home subnet/gateway');
  need(typeof h.routerMac === 'string' && /^(?:[\da-f]{2}:){5}[\da-f]{2}$/i.test(h.routerMac), 'Invalid router MAC');
  need(typeof h.interface === 'string' && /^[a-zA-Z][a-zA-Z0-9]{0,31}$/.test(h.interface), 'Invalid local interface');
  for (const k of ['storePath', 'inventoryPath']) need(typeof c[k] === 'string' && isAbsolute(c[k]) && resolve(c[k]) === c[k], 'Paths must be absolute and normalized');
  need(c.storePath !== c.inventoryPath, 'Store and inventory paths must differ');
  for (const k of ['speedTime', 'wifiIntervalMs', 'actionPorts']) need(!Object.hasOwn(c, k) || c[k] !== null, 'Invalid action configuration');
  const result = { ...c, speedTime: c.speedTime ?? '03:00', wifiIntervalMs: c.wifiIntervalMs ?? 900_000, actionPorts: c.actionPorts ?? [22, 80, 443], intervalMs: c.intervalMs ?? 60_000, rawDays: c.rawDays ?? 30, hourlyMonths: c.hourlyMonths ?? 13 } as Config;
  need(integer(result.intervalMs, 60_000, 86_400_000), 'intervalMs must be 60000..86400000');
  need(integer(result.rawDays, 1, 30) && integer(result.hourlyMonths, 3, 13), 'Retention must be rawDays 1..30, hourlyMonths 3..13');
  need(typeof result.speedTime === 'string' && /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(result.speedTime), 'Invalid nightly time');
  need(integer(result.wifiIntervalMs, 60_000, 86_400_000), 'Invalid Wi-Fi interval');
  need(Array.isArray(result.actionPorts) && result.actionPorts.length <= 16 && result.actionPorts.every(p => integer(p, 1, 65535)) && new Set(result.actionPorts).size === result.actionPorts.length, 'Invalid action ports');
  return result;
}
export const loadConfig = (path: string) => validateConfig(parseJson(readPrivate(path, 16_384)));

// JSON.parse alone accepts duplicate keys. Walk tokens first to refuse ambiguous
// private configuration/inventory, excessive depth and nonfinite numbers.
export function parseJson(source: string): unknown {
  const tokens = source.match(/"(?:[^"\\\u0000-\u001f]|\\(?:["\\/bfnrt]|u[\da-fA-F]{4}))*"|-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?|true|false|null|[{}\[\],:]|\s+|./gs) ?? [];
  const list = tokens.filter(t => !/^\s+$/.test(t));
  let pos = 0;
  function value(depth: number) {
    need(depth <= 100, 'JSON nesting exceeds limit');
    const token = list[pos++];
    if (token === '{' || token === '[') {
      const end = token === '{' ? '}' : ']';
      const seen = new Set<string>();
      if (list[pos] === end) { pos++; return; }
      do {
        if (token === '{') {
          const key = list[pos++]; need(key?.startsWith('"'), 'Invalid JSON object key');
          const name = JSON.parse(key!); need(!seen.has(name), 'Duplicate JSON key'); seen.add(name);
          need(list[pos++] === ':', 'Invalid JSON object');
        }
        value(depth + 1);
        if (list[pos] !== ',') break;
        pos++;
      } while (true);
      need(list[pos++] === end, 'Invalid JSON container');
    } else {
      need(token !== undefined, 'Invalid JSON value');
      let decoded: unknown;
      try { decoded = JSON.parse(token!); } catch { throw new Refusal('Invalid JSON token'); }
      need(typeof decoded !== 'number' || Number.isFinite(decoded), 'Nonfinite JSON number');
    }
  }
  value(0); need(pos === list.length, 'Trailing JSON content');
  return JSON.parse(source);
}
