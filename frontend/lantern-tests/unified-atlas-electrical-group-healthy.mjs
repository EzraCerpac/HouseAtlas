// Generated documentary records; no browser, native authority or provider.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { transformWithOxc } from 'vite';
assert.equal(process.version, 'v26.10.0');
assert.deepEqual(process.argv.slice(2), []);
const file = new URL('../src/lantern/unified-atlas/electrical-group.ts', import.meta.url);
const { code } = await transformWithOxc(readFileSync(file, 'utf8'), file.pathname, { lang: 'ts', target: 'esnext', tsconfig: false });
const { electricalGroups } = await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`);
const membership = JSON.stringify({ id: 'group', label: 'A', fixtureIds: ['a', 'b', 'c'] });
const record = (id, source = 'generated-source', membershipValue = membership) => ({
  key: JSON.stringify(['houseatlas-documentary-record.v1', 'workspace', 'home', 'primary-scene', 'scene', 'symbol', id]),
  id, label: id, category: 'Historical symbol', detail: '', qualification: 'unverified', sourceDate: null, retrievedAt: null, connections: [],
  sourceFacts: [{ label: 'Drawing group membership', value: membershipValue }, { label: 'Source original SHA256', value: source }],
});
const a = record('a'), b = record('b'), c = record('c');
const data = { rooms: new Map([['room-1', { electrical: [a], network: [] }], ['room-2', { electrical: [b], network: [] }]]),
  unplaced: { electrical: [c], network: [] } };
const [group] = electricalGroups(data);
assert.equal(group.label, 'A');
assert.equal(group.missing, 0);
assert.deepEqual(group.members.map(row => row.rooms), [['room-1'], ['room-2'], []]);
assert.equal(electricalGroups({ ...data, unplaced: { electrical: [], network: [] } })[0].missing, 1);
assert.equal(electricalGroups({ ...data, rooms: new Map([['room-1', { electrical: [record('a', 'other')], network: [] }]]) }).length, 2);
assert.equal(electricalGroups({ ...data, rooms: new Map([['room-1', { electrical: [record('a', 'generated-source', 'invalid')], network: [] }]]), unplaced: { electrical: [], network: [] } }).length, 0);
assert.deepEqual(electricalGroups(null), []);
console.log('Generated electrical drawing group projection passed');
