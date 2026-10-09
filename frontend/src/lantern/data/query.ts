import type {
  Claim,
  Doc,
  EntityKind,
  HouseData,
  Item,
  Overlay,
  Pt,
  Space,
  Task,
  WriteOp,
} from './types';
import { daysUntil } from './time';

const PREFIX: [string, EntityKind][] = [
  ['sp-', 'space'],
  ['it-', 'item'],
  ['uk-', 'unknown'],
  ['ct-', 'container'],
  ['pn-', 'panel'],
  ['ci-', 'circuit'],
  ['ou-', 'outlet'],
  ['vl-', 'valve'],
  ['nd-', 'device'],
  ['cb-', 'cable'],
  ['doc-', 'doc'],
  ['mt-', 'task'],
];

export function kindOf(id: string): EntityKind | undefined {
  return PREFIX.find(([p]) => id.startsWith(p))?.[1];
}

export const KIND_LABEL: Record<EntityKind, string> = {
  space: 'Place',
  item: 'Belonging',
  unknown: 'Unknown record',
  container: 'Storage',
  panel: 'Electrical panel',
  circuit: 'Circuit',
  outlet: 'Outlet',
  valve: 'Valve',
  device: 'Network device',
  cable: 'Documented cable',
  doc: 'Document',
  task: 'Upkeep task',
};

export const CLAIM_LABEL: Record<Claim, string> = {
  confirmed: 'Confirmed',
  owner: 'Owner reported',
  source: 'Source reported',
  disputed: 'Disputed',
  unknown: 'Unknown',
};

export const CLAIM_HELP: Record<Claim, string> = {
  confirmed: 'Checked against evidence such as a photo, report or on-site check.',
  owner: 'Someone in the household recorded this. No supporting evidence yet.',
  source: 'Taken from a document or import, not checked on site.',
  disputed: 'Sources disagree. Review before relying on it.',
  unknown: 'Not known. Nothing has been assumed.',
};

export const OVERLAY_FOR_KIND: Partial<Record<EntityKind, Overlay>> = {
  item: 'belongings',
  container: 'belongings',
  panel: 'electrical',
  circuit: 'electrical',
  outlet: 'electrical',
  valve: 'water',
  device: 'network',
  cable: 'network',
  task: 'upkeep',
};

export function findSpace(h: HouseData, id?: string): Space | undefined {
  return id ? h.spaces.find((s) => s.id === id) : undefined;
}

/** Returns the record for any id, regardless of kind. */
export function getRecord(h: HouseData, id: string): unknown {
  switch (kindOf(id)) {
    case 'space':
      return h.spaces.find((x) => x.id === id);
    case 'item':
    case 'unknown':
      return h.items.find((x) => x.id === id);
    case 'container':
      return h.containers.find((x) => x.id === id);
    case 'panel':
      return h.panels.find((x) => x.id === id);
    case 'circuit':
      return h.circuits.find((x) => x.id === id);
    case 'outlet':
      return h.outlets.find((x) => x.id === id);
    case 'valve':
      return h.valves.find((x) => x.id === id);
    case 'device':
      return h.devices.find((x) => x.id === id);
    case 'cable':
      return h.cables.find((x) => x.id === id);
    case 'doc':
      return h.docs.find((x) => x.id === id);
    case 'task':
      return h.tasks.find((x) => x.id === id);
    default:
      return undefined;
  }
}

export function exists(h: HouseData, id: string): boolean {
  return getRecord(h, id) !== undefined;
}

export function nameOf(h: HouseData, id: string): string {
  const k = kindOf(id);
  const rec = getRecord(h, id) as Record<string, unknown> | undefined;
  if (!rec) return 'Missing record';
  if (k === 'outlet') return `Outlet ${rec.label as string}`;
  if (k === 'circuit') return `${rec.ref as string} ${rec.label as string}`;
  if (k === 'doc' || k === 'task') return rec.title as string;
  return rec.name as string;
}

export interface Location {
  floorId?: string | undefined;
  spaceId?: string | undefined;
  containerId?: string | undefined;
  pos?: Pt | undefined;
}

export function locate(h: HouseData, id: string): Location {
  const k = kindOf(id);
  switch (k) {
    case 'space': {
      const s = findSpace(h, id);
      return { spaceId: id, floorId: s?.floorId };
    }
    case 'item':
    case 'unknown': {
      const it = h.items.find((x) => x.id === id);
      if (!it) return {};
      const ct = it.containerId ? h.containers.find((c) => c.id === it.containerId) : undefined;
      const spaceId = it.spaceId ?? ct?.spaceId;
      return { spaceId, containerId: ct?.id, floorId: findSpace(h, spaceId)?.floorId, pos: it.pos ?? ct?.pos };
    }
    case 'container':
    case 'panel':
    case 'outlet':
    case 'valve':
    case 'device': {
      const rec = getRecord(h, id) as { spaceId?: string | undefined; pos?: Pt } | undefined;
      if (!rec) return {};
      return { spaceId: rec.spaceId, floorId: findSpace(h, rec.spaceId)?.floorId, pos: rec.pos };
    }
    case 'circuit': {
      const c = h.circuits.find((x) => x.id === id);
      return c ? locate(h, c.panelId) : {};
    }
    case 'cable': {
      const c = h.cables.find((x) => x.id === id);
      return c ? locate(h, c.fromId) : {};
    }
    case 'task': {
      const t = h.tasks.find((x) => x.id === id);
      return t ? locate(h, t.targetId) : {};
    }
    default:
      return {};
  }
}

export function breadcrumb(h: HouseData, id: string): string[] {
  const loc = locate(h, id);
  const parts: string[] = [];
  const floor = h.floors.find((f) => f.id === loc.floorId);
  if (floor) parts.push(floor.name);
  const sp = findSpace(h, loc.spaceId);
  if (sp && sp.id !== id) parts.push(sp.name);
  const ct = loc.containerId ? h.containers.find((c) => c.id === loc.containerId) : undefined;
  if (ct && ct.id !== id) parts.push(ct.name);
  return parts;
}

export function docsFor(h: HouseData, id: string): Doc[] {
  return h.docs.filter((d) => d.linkedTo.includes(id));
}

export function tasksFor(h: HouseData, id: string): Task[] {
  return h.tasks.filter((t) => t.targetId === id);
}

export function historyFor(h: HouseData, id: string) {
  return h.history.filter((e) => e.targetId === id).sort((a, b) => b.at.localeCompare(a.at));
}

export function writesFor(h: HouseData, id: string): WriteOp[] {
  return h.writes.filter((w) => w.targetId === id && w.status !== 'completed' && w.status !== 'discarded');
}

export function itemsIn(h: HouseData, spaceId: string): Item[] {
  return h.items.filter((it) => kindOf(it.id) === 'item' && (it.spaceId ?? h.containers.find((c) => c.id === it.containerId)?.spaceId) === spaceId);
}

/** Anything placed in the room: used for room summaries and counts. */
export function roomContents(h: HouseData, spaceId: string) {
  const items = itemsIn(h, spaceId);
  const containers = h.containers.filter((c) => c.spaceId === spaceId);
  const outlets = h.outlets.filter((o) => o.spaceId === spaceId);
  const panels = h.panels.filter((p) => p.spaceId === spaceId);
  const valves = h.valves.filter((v) => v.spaceId === spaceId);
  const devices = h.devices.filter((d) => d.spaceId === spaceId);
  const relatedIds = new Set<string>([
    spaceId,
    ...items.map((x) => x.id),
    ...containers.map((x) => x.id),
    ...outlets.map((x) => x.id),
    ...panels.map((x) => x.id),
    ...valves.map((x) => x.id),
    ...devices.map((x) => x.id),
  ]);
  const tasks = h.tasks.filter((t) => relatedIds.has(t.targetId));
  const docs = h.docs.filter((d) => d.linkedTo.some((l) => relatedIds.has(l)));
  return { items, containers, outlets, panels, valves, devices, tasks, docs };
}

export function dueState(t: Task, now?: string): 'overdue' | 'soon' | 'later' | 'done' {
  if (t.status === 'done') return 'done';
  const d = daysUntil(t.due, now);
  if (d === undefined) return 'later';
  if (d < 0) return 'overdue';
  if (d <= 14) return 'soon';
  return 'later';
}

export function latestObservation(h: HouseData, deviceId: string) {
  const d = h.devices.find((x) => x.id === deviceId);
  if (!d) return undefined;
  return [...d.observations].sort((a, b) => b.observedAt.localeCompare(a.observedAt))[0];
}

/** Records that exist but cannot be placed on the plan. */
export function unplaced(h: HouseData) {
  const noRoomItems = h.items.filter((i) => kindOf(i.id) === 'item' && !i.spaceId && !i.containerId);
  const roomOnlyItems = h.items.filter((i) => {
    if (kindOf(i.id) !== 'item') return false;
    const loc = locate(h, i.id);
    const sp = findSpace(h, loc.spaceId);
    return loc.spaceId && !loc.pos && sp?.geometry === 'reviewed';
  });
  const valves = h.valves.filter((v) => !v.pos);
  const devices = h.devices.filter((d) => !d.spaceId);
  return { noRoomItems, roomOnlyItems, valves, devices };
}

// ---------- Search ----------

export interface SearchHit {
  id: string;
  kind: EntityKind;
  title: string;
  context: string;
  score: number;
}

export const SEARCH_GROUPS: { label: string; kinds: EntityKind[] }[] = [
  { label: 'Rooms & places', kinds: ['space'] },
  { label: 'Belongings and storage', kinds: ['item', 'container'] },
  { label: 'Unclassified records', kinds: ['unknown'] },
  { label: 'Manuals and documents', kinds: ['doc'] },
  { label: 'Upkeep', kinds: ['task'] },
  { label: 'Electrical and water', kinds: ['panel', 'circuit', 'outlet', 'valve'] },
  { label: 'Network', kinds: ['device', 'cable'] },
];

function scoreText(q: string, title: string, extra: string): number {
  const t = title.toLowerCase();
  const e = extra.toLowerCase();
  const terms = q.split(/\s+/).filter(Boolean);
  let total = 0;
  for (const term of terms) {
    if (t.startsWith(term)) total += 100;
    else if (t.split(/[\s,()'-]+/).some((w) => w.startsWith(term))) total += 70;
    else if (t.includes(term)) total += 45;
    else if (e.includes(term)) total += 18;
    else return 0;
  }
  return total;
}

export function search(h: HouseData, query: string): SearchHit[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const hits: SearchHit[] = [];
  const push = (id: string, kind: EntityKind, title: string, extra: string, context: string) => {
    const s = scoreText(q, title, extra);
    if (s > 0) hits.push({ id, kind, title, context, score: s });
  };
  const where = (id: string) => breadcrumb(h, id).join(', ') || 'No location recorded';

  for (const s of h.spaces) {
    const former = (s.formerNames ?? []).map((f) => f.name).join(' ');
    push(s.id, 'space', s.name, `${s.semanticKind ?? ''} ${former} ${s.note ?? ''}`, h.floors.find((f) => f.id === s.floorId)?.name ?? '');
  }
  for (const c of h.containers) push(c.id, 'container', c.name, `${c.kind} storage cupboard`, where(c.id));
  for (const i of h.items) {
    const kind = kindOf(i.id);
    if (kind === 'item' || kind === 'unknown') {
      push(i.id, kind, i.name, `${i.category} ${i.manufacturer ?? ''} ${i.model ?? ''} ${i.note ?? ''}`, where(i.id));
    }
  }
  for (const d of h.docs) {
    const linked = d.linkedTo.map((l) => nameOf(h, l)).join(' ');
    push(d.id, 'doc', d.title, `${d.kind === 'unknown' ? '' : d.kind} ${d.storage === 'link' ? 'link external' : 'stored file'} ${linked} ${d.summary ?? ''}`, d.storage === 'link' ? 'External link' : d.kind === 'unknown' ? 'Stored file' : `Stored ${d.kind}`);
  }
  for (const t of h.tasks) {
    push(t.id, 'task', t.title, `maintenance upkeep ${t.status} ${nameOf(h, t.targetId)}`, `${t.status === 'done' ? 'Done' : t.status === 'scheduled' ? 'Scheduled' : 'No schedule supplied'}, ${nameOf(h, t.targetId)}`);
  }
  for (const p of h.panels) push(p.id, 'panel', p.name, 'electrical panel fuse board breaker', where(p.id));
  for (const c of h.circuits) push(c.id, 'circuit', `${c.ref} ${c.label}`, `circuit breaker electrical ${c.rating}`, `Circuit on ${nameOf(h, c.panelId)}`);
  for (const o of h.outlets) push(o.id, 'outlet', `Outlet ${o.label}`, `${o.kind} socket electrical`, where(o.id));
  for (const v of h.valves) push(v.id, 'valve', v.name, `${v.kind} valve water shut off isolator ${v.serves}`, where(v.id));
  for (const d of h.devices) push(d.id, 'device', d.name, `${d.kind} network wifi`, where(d.id));
  for (const c of h.cables) push(c.id, 'cable', c.name, `${c.medium} cable network`, 'Documented cabling');

  return hits.sort((a, b) => b.score - a.score || a.title.localeCompare(b.title));
}

// ---------- Identity ----------

const ALPHA = 'ABCDEFGHJKMNPQRSTVWXYZ23456789';

/** Stable Atlas identity code, derived from the record id, never from its name. */
export function atlasCode(id: string): string {
  let h1 = 2166136261;
  for (let i = 0; i < id.length; i++) {
    h1 ^= id.charCodeAt(i);
    h1 = Math.imul(h1, 16777619);
  }
  let n = h1 >>> 0;
  let out = '';
  for (let i = 0; i < 6; i++) {
    out += ALPHA[n % ALPHA.length];
    n = Math.floor(n / ALPHA.length) + (i + 1) * 7919;
  }
  return `AT-${out.slice(0, 4)}-${out.slice(4)}`;
}
