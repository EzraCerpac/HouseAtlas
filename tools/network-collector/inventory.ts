import { need, keys, object, integer, ipv4, inSubnet } from './config.ts';
import type { Config } from './config.ts';

export const MAX_INVENTORY_BYTES = 1_048_576;
export type Inventory = { revision: number; inventory: { rooms: any[]; devices: any[]; interfaces: any[]; segments: any[]; links: any[]; positions: Record<string, { x: number; y: number }> } };
const text = (v: unknown, max = 2000): v is string => typeof v === 'string' && v.length <= max;
const id = (v: unknown): v is string => text(v, 4096) && v.length > 0;
const stamp = (v: unknown) => typeof v === 'string' && /^\d{4}-\d\d-\d\dT.*(?:Z|[+-]\d\d:\d\d)$/.test(v) && Number.isFinite(Date.parse(v));
export function canonical(value: any): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value !== null && typeof value === 'object') return `{${Object.keys(value).sort().map(k => `${JSON.stringify(k)}:${canonical(value[k])}`).join(',')}}`;
  return JSON.stringify(value);
}
export function validateInventory(value: unknown): Inventory {
  const doc = keys(value, ['revision', 'inventory']);
  need(integer(doc.revision, 0, Number.MAX_SAFE_INTEGER), 'Invalid inventory revision');
  const inv = keys(doc.inventory, ['rooms', 'devices', 'interfaces', 'segments', 'links', 'positions']);
  const all = new Set<string>();
  for (const name of ['rooms', 'devices', 'interfaces', 'segments', 'links']) {
    need(Array.isArray(inv[name]), 'Inventory collection must be an array');
    for (const row of inv[name]) {
      need(id(object(row).id) && !all.has(row.id), 'Inventory IDs must be unique and nonempty');
      all.add(row.id);
    }
  }
  need(all.size <= 1024 && inv.devices.length <= 64, 'Inventory exceeds 1024 records or 64 devices');
  const rooms = new Set(inv.rooms.map((r: any) => r.id));
  const devices = new Set(inv.devices.map((r: any) => r.id));
  const endpoints = new Set([...inv.devices, ...inv.interfaces, ...inv.segments].map(r => r.id));
  for (const row of inv.rooms) { keys(row, ['id', 'name']); need(text(row.name), 'Invalid room name'); }
  for (const row of inv.devices) {
    keys(row, ['id', 'name', 'kind'], ['role', 'mobility', 'roomId', 'notes']);
    need(text(row.name) && text(row.kind), 'Invalid device text');
    need(!Object.hasOwn(row, 'role') || ['infrastructure', 'client'].includes(row.role), 'Invalid device role');
    need(!Object.hasOwn(row, 'mobility') || ['fixed', 'mobile'].includes(row.mobility), 'Invalid device mobility');
    need(!Object.hasOwn(row, 'roomId') || rooms.has(row.roomId), 'Unknown device room');
    need(row.mobility !== 'mobile' || !Object.hasOwn(row, 'roomId'), 'Mobile device cannot have room');
    need(!Object.hasOwn(row, 'notes') || text(row.notes), 'Invalid device notes');
  }
  for (const row of inv.interfaces) {
    keys(row, ['id', 'deviceId', 'name', 'addresses'], ['mac']);
    need(devices.has(row.deviceId) && text(row.name), 'Invalid interface owner/name');
    need(Array.isArray(row.addresses) && row.addresses.length <= 16 && row.addresses.every((v: unknown) => text(v, 200)), 'Invalid interface addresses');
    need(!Object.hasOwn(row, 'mac') || (typeof row.mac === 'string' && /^(?:[\da-f]{2}:){5}[\da-f]{2}$/i.test(row.mac)), 'Invalid interface MAC');
  }
  for (const row of inv.segments) {
    keys(row, ['id', 'name', 'kind'], ['roomId']);
    need(text(row.name) && ['lan', 'powerline', 'unknown'].includes(row.kind), 'Invalid segment');
    need(!Object.hasOwn(row, 'roomId') || rooms.has(row.roomId), 'Unknown segment room');
  }
  for (const row of inv.links) {
    keys(row, ['id', 'from', 'to', 'medium', 'confidence'], ['observedAt', 'notes', 'reportedRate']);
    need(endpoints.has(row.from) && endpoints.has(row.to), 'Unknown link endpoint');
    need(['ethernet', 'wifi', 'powerline', 'unknown'].includes(row.medium) && ['confirmed', 'reported', 'inferred', 'unknown'].includes(row.confidence), 'Invalid link classification');
    need(!Object.hasOwn(row, 'notes') || text(row.notes), 'Invalid link notes');
    need(!Object.hasOwn(row, 'observedAt') || stamp(row.observedAt), 'Invalid link timestamp');
    if (Object.hasOwn(row, 'reportedRate')) {
      const r = keys(row.reportedRate, ['kind', 'mbps', 'source', 'observedAt']);
      need(r.kind === 'negotiated-port' && Number.isFinite(r.mbps) && r.mbps > 0 && r.mbps <= 1_000_000 && id(r.source) && stamp(r.observedAt), 'Invalid reported rate');
    }
  }
  for (const p of Object.values(object(inv.positions))) { keys(p, ['x', 'y']); need(Number.isFinite(p.x) && Number.isFinite(p.y), 'Invalid position'); }
  need(Buffer.byteLength(canonical(doc)) <= MAX_INVENTORY_BYTES, 'Inventory exceeds byte limit');
  return JSON.parse(canonical(doc));
}
// No DNS, discovery, address fallback or targets from configuration. One stable
// first IPv4 in the guarded subnet per device, in reviewed interface order.
export function targets(doc: Inventory, home: Config['home']): Map<string, string | null> {
  return new Map(doc.inventory.devices.map(d => [d.id, doc.inventory.interfaces.filter(i => i.deviceId === d.id).flatMap(i => i.addresses).find((a: string) => ipv4(a) && inSubnet(a, home.subnet)) ?? null]));
}
