import type { DocumentaryRecord, PropertyRecords } from './runtime-overlays';

export interface ElectricalGroup {
  readonly key: string;
  readonly label: string;
  readonly members: readonly { readonly record: DocumentaryRecord; readonly rooms: readonly string[] }[];
  readonly missing: number;
}

/** Only exact, reciprocal source membership and already admitted room links are used. */
export function electricalGroups(records: PropertyRecords | null): ElectricalGroup[] {
  if (!records) return [];
  const entries = new Map<string, { record: DocumentaryRecord; rooms: Set<string> }>();
  for (const [room, rows] of records.rooms) for (const record of rows.electrical) {
    const entry = entries.get(record.key) ?? { record, rooms: new Set<string>() };
    entry.rooms.add(room); entries.set(record.key, entry);
  }
  for (const record of records.unplaced.electrical) if (!entries.has(record.key)) entries.set(record.key, { record, rooms: new Set() });
  const groups = new Map<string, { label: string; ids: string[]; members: Map<string, { record: DocumentaryRecord; rooms: Set<string> }> }>();
  for (const entry of entries.values()) {
    if (entry.record.category !== 'Historical symbol') continue;
    try {
      const identity = JSON.parse(entry.record.key);
      const group = JSON.parse(entry.record.sourceFacts.find(f => f.label === 'Drawing group membership')?.value ?? 'null');
      const source = entry.record.sourceFacts.find(f => f.label === 'Source original SHA256')?.value;
      if (!Array.isArray(identity) || identity.length !== 7 || identity[5] !== 'symbol' || !source || !group
        || typeof group.id !== 'string' || typeof group.label !== 'string' || !Array.isArray(group.fixtureIds)
        || !group.fixtureIds.every((id: unknown) => typeof id === 'string') || !group.fixtureIds.includes(entry.record.id)) continue;
      const key = JSON.stringify([...identity.slice(0, 5), source, group.id, group.fixtureIds]);
      const own = groups.get(key) ?? { label: group.label, ids: group.fixtureIds as string[], members: new Map() };
      own.members.set(entry.record.id, entry); groups.set(key, own);
    } catch { /* Invalid or older saved metadata does not establish a group. */ }
  }
  return [...groups].map(([key, group]) => ({ key, label: group.label,
    members: [...group.members.values()].map(({ record, rooms }) => ({ record, rooms: [...rooms] })),
    missing: group.ids.length - group.members.size }));
}
