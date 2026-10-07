import type { Claim, ConflictInfo, HouseData, Item, Patch, System, Task } from '../data/types';
import { CLAIM_LABEL, findSpace, latestObservation, nameOf, search, unplaced } from '../data/query';
import { DEMO_TODAY, addDays, fmtDate, fmtDateTime, rel } from '../data/time';

// A scripted, local stand-in for an assistant. It only reads the fictional
// records in memory and answers with links to them. No model or service is used.

export type Seg = string | { cite: number } | { ref: string };

export interface Citation {
  n: number;
  id: string;
  why: string;
  claim?: Claim | undefined;
  when?: string | undefined;
}

export interface AnswerEntry {
  id: string;
  kind: 'answer';
  question: string;
  paras: Seg[][];
  citations: Citation[];
  caveat?: string;
  grounded: boolean;
}

export interface ProposalChange {
  key: string;
  title: string;
  detail: string;
  system: System;
  targetId: string;
  patch: Patch;
  forceOutcome?: 'completed' | 'conflict';
  conflict?: ConflictInfo;
  selected: boolean;
  writeId?: string;
}

export interface ProposalEntry {
  id: string;
  kind: 'proposal';
  question: string;
  intro: Seg[];
  changes: ProposalChange[];
  citations: Citation[];
  state: 'review' | 'applied' | 'dismissed';
}

export type AskEntry = AnswerEntry | ProposalEntry;

let seq = 1;
const nextId = () => `ask-${seq++}`;

/** Turns "Text [[id]] more {1}" into segments. */
export function t(s: string): Seg[] {
  const out: Seg[] = [];
  const re = /\[\[([^\]]+)\]\]|\{(\d+)\}/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(s))) {
    if (m.index > last) out.push(s.slice(last, m.index));
    if (m[1]) out.push({ ref: m[1] });
    else out.push({ cite: Number(m[2]) });
    last = m.index + m[0].length;
  }
  if (last < s.length) out.push(s.slice(last));
  return out;
}

class Cites {
  list: Citation[] = [];
  add(id: string, why: string, claim?: Claim, when?: string): number {
    const existing = this.list.find((c) => c.id === id);
    if (existing) return existing.n;
    const n = this.list.length + 1;
    this.list.push({ n, id, why, claim, when });
    return n;
  }
}

function mentionedItem(h: HouseData, q: string): Item | undefined {
  const lower = q.toLowerCase();
  let best: Item | undefined;
  let bestScore = 0;
  for (const it of h.items) {
    const words = it.name.toLowerCase().split(/[^a-z]+/).filter((w) => w.length >= 4);
    const score = words.filter((w) => lower.includes(w) || lower.includes(w.replace(/s$/, ''))).length;
    if (score > bestScore) {
      best = it;
      bestScore = score;
    }
  }
  return best;
}

function mentionedDevice(h: HouseData, q: string) {
  const lower = q.toLowerCase();
  return h.devices.find((d) => d.name.toLowerCase().split(/[^a-z]+/).some((w) => w.length >= 4 && lower.includes(w)));
}

export function suggestions(h: HouseData): string[] {
  const out = ['Where do I turn off the water?'];
  const load = h.loads.find((l) => h.circuits.length && h.outlets.find((o) => o.id === l.outletId)?.circuitId) ?? h.loads[0];
  if (load) out.push(`Which circuit is the ${nameOf(h, load.itemId).toLowerCase()} on?`);
  out.push('What upkeep is due soon?');
  const dev = h.devices.find((d) => d.kind === 'Printer') ?? h.devices[0];
  if (dev) out.push(`Is the ${dev.name.toLowerCase()} online?`);
  const p = proposalTarget(h);
  if (p) out.push(`Tidy up the ${p.item.name.toLowerCase()} records`);
  return out;
}

export function answer(h: HouseData, question: string): AskEntry {
  const q = question.toLowerCase();
  if (/\b(tidy|organi[sz]e|propose|clean up|sort out|fix up|improve)\b/.test(q)) {
    const p = proposal(h, question);
    if (p) return p;
  }
  if (/\b(water|stopcock|shut ?off|valve|leak|isolat)/.test(q)) return water(h, question);
  if (/\b(circuit|breaker|fuse|socket|outlet|power|plugged|electric)/.test(q)) return electrical(h, question);
  if (/\b(due|upkeep|maintenance|overdue|to ?do|this week|soon|service)\b/.test(q)) return due(h, question);
  if (/\b(online|offline|network|wi-?fi|router|printer|connected|internet|device)/.test(q)) return network(h, question);
  if (/\b(manual|guide|instructions|receipt|document|warranty)/.test(q)) return documents(h, question);
  if (/\b(where|find|location|located)\b/.test(q)) return where(h, question);
  return retrieval(h, question);
}

function water(h: HouseData, question: string): AnswerEntry {
  const c = new Cites();
  const paras: Seg[][] = [];
  const main = h.valves.find((v) => /stopcock/i.test(v.kind)) ?? h.valves.find((v) => /main/i.test(v.name));
  if (main) {
    const n = c.add(main.id, 'Valve record', main.locationClaim);
    if (main.spaceId && main.pos) {
      const ev = main.evidenceIds.find((e) => h.docs.find((d) => d.id === e)?.kind === 'photo');
      const en = ev ? c.add(ev, 'Photo of the valve', 'confirmed', h.docs.find((d) => d.id === ev)?.capturedAt) : undefined;
      paras.push(t(`The main shut-off is the [[${main.id}]] in the [[${main.spaceId}]] {${n}}.${main.note ? ` ${main.note}` : ''}${en ? ` There is a photo {${en}}.` : ''}`));
      paras.push(t(`Its last recorded state is "${main.documentedState.toLowerCase()}", ${CLAIM_LABEL[main.stateClaim].toLowerCase()}${main.stateObservedAt ? ` on ${fmtDate(main.stateObservedAt)}` : ''}.`));
    } else {
      paras.push(t(`The [[${main.id}]] has not been located yet {${n}}. ${main.note ?? ''}`));
    }
  } else {
    paras.push(['No main stopcock is recorded for this house.']);
  }
  const appliance = h.valves.filter((v) => v !== main && v.pos);
  if (appliance.length) {
    const refs = appliance.map((v) => `[[${v.id}]] {${c.add(v.id, 'Valve record', v.locationClaim)}}`).join(', ');
    paras.push(t(`For one appliance or tap, the recorded local valves are ${refs}.`));
  }
  const un = unplaced(h).valves.filter((v) => v !== main);
  for (const v of un) {
    const n = c.add(v.id, 'Valve without a position', v.locationClaim);
    paras.push(t(`[[${v.id}]] has no position on the plan {${n}}. ${v.note ?? ''}`));
  }
  return {
    id: nextId(),
    kind: 'answer',
    question,
    paras,
    citations: c.list,
    caveat: 'Positions and states are as documented, not live readings. Atlas does not trace where water flows.',
    grounded: true,
  };
}

function electrical(h: HouseData, question: string): AnswerEntry {
  const c = new Cites();
  const paras: Seg[][] = [];
  const item = mentionedItem(h, question);
  if (item) {
    const load = h.loads.find((l) => l.itemId === item.id);
    if (!load) {
      paras.push(t(`There is no documented outlet for [[${item.id}]] {${c.add(item.id, 'Belonging record')}}, so I won’t guess which circuit it is on.`));
    } else {
      const outlet = h.outlets.find((o) => o.id === load.outletId)!;
      const circuit = h.circuits.find((x) => x.id === outlet.circuitId);
      const ln = c.add(outlet.id, `Documented connection: ${CLAIM_LABEL[load.claim].toLowerCase()}`, load.claim);
      if (circuit) {
        const cn = c.add(circuit.id, `Circuit record: ${CLAIM_LABEL[circuit.claim].toLowerCase()}`, circuit.claim);
        paras.push(t(`[[${item.id}]] is documented as plugged into [[${outlet.id}]] {${ln}}, which is on [[${circuit.id}]] at the [[${circuit.panelId}]] {${cn}}.`));
        paras.push([`${circuit.ref} is ${CLAIM_LABEL[circuit.claim].toLowerCase()}. ${circuit.claimNote}`]);
        for (const e of circuit.evidenceIds) {
          const d = h.docs.find((x) => x.id === e);
          if (d) c.add(d.id, 'Evidence for the circuit', undefined, d.capturedAt);
        }
      } else {
        paras.push(t(`[[${item.id}]] is documented as plugged into [[${outlet.id}]] {${ln}}, but which circuit that outlet is on has not been documented.`));
      }
      if (load.note) paras.push([load.note]);
    }
  } else {
    const shaky = h.circuits.filter((x) => x.claim === 'disputed' || x.claim === 'unknown');
    paras.push(t(`${h.circuits.length} circuits are documented at the panel. These need checking before anyone relies on them:`));
    for (const x of shaky) {
      const n = c.add(x.id, 'Circuit record', x.claim);
      paras.push(t(`[[${x.id}]] is ${CLAIM_LABEL[x.claim].toLowerCase()} {${n}}. ${x.claimNote}`));
    }
  }
  return {
    id: nextId(),
    kind: 'answer',
    question,
    paras,
    citations: c.list,
    caveat: 'This is documented grouping from labels and reports. It is not a traced wiring route and says nothing about live power.',
    grounded: true,
  };
}

function due(h: HouseData, question: string): AnswerEntry {
  const c = new Cites();
  const sched = h.tasks.filter((x) => x.status === 'scheduled' && x.due).sort((a, b) => a.due!.localeCompare(b.due!));
  const soon = sched.filter((x) => (x.due ?? '') <= addDays(DEMO_TODAY, 30));
  const paras: Seg[][] = [];
  if (!soon.length) paras.push(['Nothing is scheduled in the next 30 days.']);
  else paras.push([`${soon.length} upkeep tasks are due in the next 30 days:`]);
  for (const x of soon) {
    const n = c.add(x.id, 'Upkeep task', undefined, x.due);
    const overdue = x.due! < DEMO_TODAY;
    paras.push(t(`[[${x.id}]] for [[${x.targetId}]], ${overdue ? `overdue since ${fmtDate(x.due)}` : `due ${fmtDate(x.due)} (${rel(x.due)})`} {${n}}.`));
  }
  const later = sched.length - soon.length;
  if (later > 0) paras.push([`${later} more are scheduled after that.`]);
  return { id: nextId(), kind: 'answer', question, paras, citations: c.list, caveat: 'Nothing repeats automatically. Each occurrence is added by hand.', grounded: true };
}

function network(h: HouseData, question: string): AnswerEntry {
  const c = new Cites();
  const paras: Seg[][] = [];
  const d = mentionedDevice(h, question);
  if (d) {
    const ob = latestObservation(h, d.id);
    const n = c.add(d.id, 'Network device, read-only', undefined, ob?.observedAt);
    if (ob) {
      const stale = ob.observedAt < h.sources.networkObservedAt;
      paras.push(t(`Atlas can’t check whether [[${d.id}]] is online right now. It only reads router exports {${n}}.`));
      paras.push([`The latest observation is from ${fmtDateTime(ob.observedAt)}, retrieved ${fmtDateTime(ob.retrievedAt)}, with ${ob.confidence} confidence: “${ob.summary}”`]);
      paras.push([stale ? 'It was not in the most recent export. That does not mean it is switched off or gone.' : 'It was in the most recent export.']);
    } else {
      paras.push(t(`There are no observations for [[${d.id}]] {${n}}.`));
    }
    const exp = h.docs.find((x) => x.kind === 'export');
    if (exp) c.add(exp.id, 'Source export', undefined, exp.capturedAt);
  } else {
    const stale = h.devices.filter((x) => {
      const ob = latestObservation(h, x.id);
      return !ob || ob.observedAt < h.sources.networkObservedAt;
    });
    paras.push([`The last router export was observed ${fmtDateTime(h.sources.networkObservedAt)}. ${h.devices.length - stale.length} of ${h.devices.length} known devices were in it.`]);
    for (const x of stale) {
      const ob = latestObservation(h, x.id);
      const n = c.add(x.id, 'Not in latest export', undefined, ob?.observedAt);
      paras.push(t(`[[${x.id}]] was last observed ${ob ? rel(ob.observedAt) : 'never'} {${n}}.`));
    }
  }
  return { id: nextId(), kind: 'answer', question, paras, citations: c.list, caveat: 'Network records are passive observations. Missing or old data never means removed or off.', grounded: true };
}

function documents(h: HouseData, question: string): AnswerEntry {
  const c = new Cites();
  const item = mentionedItem(h, question);
  if (!item) return retrieval(h, question);
  const docs = h.docs.filter((d) => d.linkedTo.includes(item.id));
  const paras: Seg[][] = [];
  if (!docs.length) paras.push(t(`No documents are linked to [[${item.id}]] yet.`));
  for (const d of docs) {
    const n = c.add(d.id, d.storage === 'link' ? 'External link, not stored' : 'Stored file', undefined, d.addedAt);
    paras.push(t(`[[${d.id}]] is ${d.storage === 'link' ? 'an external link, so only the address is kept' : `a stored ${d.kind}`} {${n}}.`));
  }
  return { id: nextId(), kind: 'answer', question, paras, citations: c.list, grounded: true };
}

function where(h: HouseData, question: string): AnswerEntry {
  const c = new Cites();
  const item = mentionedItem(h, question);
  if (!item) return retrieval(h, question);
  const n = c.add(item.id, `Location ${CLAIM_LABEL[item.locationClaim].toLowerCase()}`, item.locationClaim);
  const ct = h.containers.find((x) => x.id === item.containerId);
  const sp = findSpace(h, item.spaceId ?? ct?.spaceId);
  const paras: Seg[][] = [];
  if (!sp) paras.push(t(`Nobody knows where [[${item.id}]] is {${n}}. ${item.locationNote ?? ''}`));
  else if (ct) paras.push(t(`[[${item.id}]] is recorded inside [[${ct.id}]] in the [[${sp.id}]] {${n}}.`));
  else paras.push(t(`[[${item.id}]] is recorded in the [[${sp.id}]] {${n}}.${item.locationNote ? ` ${item.locationNote}` : ''}`));
  paras.push([`That location is ${CLAIM_LABEL[item.locationClaim].toLowerCase()}.`]);
  const pending = h.writes.find((w) => w.targetId === item.id && (w.status === 'uncertain' || w.status === 'queued' || w.status === 'running'));
  if (pending) paras.push([`A change is in progress: “${pending.title}”. Its result is not confirmed yet.`]);
  return { id: nextId(), kind: 'answer', question, paras, citations: c.list, grounded: true };
}

function retrieval(h: HouseData, question: string): AnswerEntry {
  const words = question
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length >= 4 && !['what', 'where', 'which', 'when', 'does', 'have', 'there', 'with', 'about', 'this', 'that', 'house'].includes(w));
  const seen = new Map<string, number>();
  for (const w of words) for (const hit of search(h, w).slice(0, 6)) seen.set(hit.id, (seen.get(hit.id) ?? 0) + hit.score);
  const top = [...seen.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4);
  const c = new Cites();
  if (!top.length) {
    return {
      id: nextId(),
      kind: 'answer',
      question,
      paras: [['None of the demo records mention that. Try asking about water, circuits, upkeep, the network or a belonging by name.']],
      citations: [],
      grounded: false,
    };
  }
  const paras: Seg[][] = [['I don’t have a scripted answer for that. These records match your words, best first:']];
  for (const [id] of top) {
    const n = c.add(id, 'Matching record');
    paras.push(t(`[[${id}]] {${n}}`));
  }
  return { id: nextId(), kind: 'answer', question, paras, citations: c.list, caveat: 'Keyword matches only. Open a record to read it in full.', grounded: true };
}

// ---------------- Proposal ----------------

function proposalTarget(h: HouseData, question?: string): { item: Item; manualId: string; task: Task } | undefined {
  const candidates = h.items
    .map((item) => {
      const manual = h.docs.find((d) => d.kind === 'manual' && d.storage === 'stored' && d.linkedTo.includes(item.id));
      const task = h.tasks.filter((x) => x.targetId === item.id && x.status === 'scheduled').sort((a, b) => (a.due ?? '').localeCompare(b.due ?? ''))[0];
      return manual && task ? { item, manualId: manual.id, task } : undefined;
    })
    .filter(Boolean) as { item: Item; manualId: string; task: Task }[];
  if (question) {
    const m = mentionedItem(h, question);
    const hit = candidates.find((x) => x.item.id === m?.id);
    if (hit) return hit;
  }
  return candidates[0];
}

function proposal(h: HouseData, question: string): ProposalEntry | undefined {
  const target = proposalTarget(h, question);
  if (!target) return undefined;
  const { item, manualId, task } = target;
  const c = new Cites();
  const ni = c.add(item.id, 'Belonging record');
  const nm = c.add(manualId, 'Stored manual');
  const nt = c.add(task.id, 'Upkeep task', undefined, task.due);
  const manual = h.docs.find((d) => d.id === manualId)!;
  const next = addDays(task.due && task.due > DEMO_TODAY ? task.due : DEMO_TODAY, 30);
  const newTask: Task = { id: `mt-ai-${seq++}`, title: task.title, targetId: item.id, due: next, status: 'scheduled', cadence: task.cadence, evidenceIds: [] };
  const mine = `${item.note ? `${item.note} ` : ''}Model ${item.model?.replace(' (fictional)', '') ?? 'as on manual cover'}.`.trim();
  const changes: ProposalChange[] = [];
  if (!(task.docIds ?? []).includes(manualId)) {
    changes.push({
      key: 'link',
      title: `Link the manual to “${task.title}”`,
      detail: `So whoever does it can open ${manual.title} straight from the task.`,
      system: 'Atlas',
      targetId: task.id,
      patch: { op: 'linkDoc', docId: manualId, targetId: task.id },
      forceOutcome: 'completed',
      selected: true,
    });
  }
  changes.push({
    key: 'schedule',
    title: `Schedule the next “${task.title}” for ${fmtDate(next)}`,
    detail: 'One occurrence, added by hand. Nothing will repeat automatically.',
    system: 'HomeBox',
    targetId: item.id,
    patch: { op: 'addTask', task: newTask },
    selected: true,
  });
  changes.push({
    key: 'note',
    title: `Add the model number to the ${item.name.toLowerCase()} note`,
    detail: `New note: “${mine}”`,
    system: 'HomeBox',
    targetId: item.id,
    patch: { op: 'updateItem', id: item.id, set: { note: mine } },
    forceOutcome: 'conflict',
    conflict: {
      field: 'Note',
      base: item.note ?? '',
      mine,
      theirs: `${item.note ? `${item.note} ` : ''}Door spring replaced, Sept 2026.`,
      theirsBy: 'Tomas',
      theirsAt: '2026-10-07T09:58:00',
      baseRev: item.rev,
      theirsRev: item.rev + 1,
    },
    selected: true,
  });
  return {
    id: nextId(),
    kind: 'proposal',
    question,
    intro: t(
      `Based on [[${item.id}]] {${ni}}, its manual [[${manualId}]] {${nm}} and the task [[${task.id}]] {${nt}}, here is what I would change. Nothing happens until you apply it, and each change is saved separately.`,
    ),
    changes,
    citations: c.list,
    state: 'review',
  };
}
