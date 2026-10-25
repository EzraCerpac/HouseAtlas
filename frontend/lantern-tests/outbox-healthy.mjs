// Healthy generated checks for the offline outbox: queueing, sending on
// reconnect, lost replies, conflicts and the person's choices. Synthetic
// IndexedDB and a generated server; no browser or network.
import assert from 'node:assert/strict';
import { createOutbox, KEEP_SYNCED } from '../src/outbox/outbox.ts';
import { openOutboxStore, OUTBOX_DATABASE } from '../src/outbox/store.ts';
import { setSyncMode } from '../src/outbox/preference.ts';
import { createSyntheticDisk, createSyntheticIndexedDB, syntheticRecords } from './synthetic-indexeddb.mjs';

assert.equal(process.version, 'v26.10.0');
assert.deepEqual(process.argv.slice(2), [], 'This runner takes no arguments');
const memory = new Map();
globalThis.localStorage = { getItem: key => memory.get(key) ?? null, setItem: (key, value) => memory.set(key, String(value)) };

const scope = { workspaceId: 'w1', homeId: 'h1' };
const context = { actorId: 'a1', csrfToken: 'csrf-1', ...scope };
const commands = '/api/atlas/stock/v3/workspaces/w1/homes/h1/commands';

/** A generated server: one revision per record, permanent idempotency keys,
 * refusal of an identical resend, and the retained-intent lookup. */
function createServer() {
  const server = { revisions: new Map(), keys: new Map(), posts: [], online: true, loseReplies: 0, status: null };
  server.transport = async (path, init) => {
    if (!server.online) throw new TypeError('Generated network unavailable');
    assert.equal(init.headers['X-Atlas-CSRF'], 'csrf-1');
    const body = JSON.parse(init.body);
    if (path === '/api/atlas/retained-intent') {
      const committed = server.keys.has(body.idempotencyKey);
      return Response.json({ lookupRequestId: body.requestId, inspection: { commandId: body.commandId,
        outcome: committed ? 'retained-commit' : 'not-retained-at-snapshot' } });
    }
    assert.equal(path, commands);
    server.posts.push(body);
    if (server.status) return Response.json({ code: 'GENERATED' }, { status: server.status });
    if (server.keys.has(body.idempotencyKey)) return Response.json({ code: 'SOURCE_UNAVAILABLE' }, { status: 503 });
    const current = server.revisions.get(body.target) ?? 1;
    if (body.base !== current) return Response.json({ code: 'CONFLICT' }, { status: 412 });
    server.revisions.set(body.target, current + 1);
    server.keys.set(body.idempotencyKey, body.requestId);
    if (server.loseReplies > 0) { server.loseReplies--; throw new TypeError('Generated reply lost'); }
    return Response.json({ requestId: body.requestId, commandId: body.commandId, status: 'committed', replayed: false });
  };
  return server;
}
let counter = 0;
function submission(target, base, label = `Rename ${target}`) {
  const requestId = `r${++counter}`;
  return { kind: 'place-name', label, target: { recordType: 'location-semantics', recordId: target }, intent: { label },
    commandId: 'atlas.batch.execute', requestId,
    body: JSON.stringify({ commandId: 'atlas.batch.execute', requestId, idempotencyKey: `k${counter}`, target, base }) };
}
let clock = Date.parse('2026-10-25T18:00:00Z');
function outboxOn(disk, server, extra = {}) {
  return createOutbox({ store: openOutboxStore(createSyntheticIndexedDB(disk)), transport: server.transport, now: () => clock++, ...extra });
}

// Online: Save sends at once.
{
  const disk = createSyntheticDisk(), server = createServer(), outbox = outboxOn(disk, server);
  outbox.configure(context);
  const entry = await outbox.submit(submission('kitchen', 1));
  assert.equal(entry.state, 'synced'); assert.equal(entry.sent, true);
  assert.equal(server.posts.length, 1); assert.equal(server.revisions.get('kitchen'), 2);
  assert.deepEqual(outbox.getSnapshot().waiting, 0);
  assert.equal(syntheticRecords(disk, OUTBOX_DATABASE, 'entries')[0].state, 'synced', 'The outcome is stored on the device');
}

// Offline: the edit waits, then goes out on reconnect after a lookup.
{
  const disk = createSyntheticDisk(), server = createServer(), outbox = outboxOn(disk, server);
  outbox.configure(context);
  server.online = false;
  const entry = await outbox.submit(submission('shed', 1, 'Rename Schuur to Werkplaats'));
  assert.equal(entry.state, 'waiting'); assert.equal(entry.sent, true, 'A failed dispatch counts as possibly sent');
  assert.equal(outbox.getSnapshot().waiting, 1);
  server.online = true;
  await outbox.drain();
  const [stored] = outbox.getSnapshot().entries;
  assert.equal(stored.state, 'synced'); assert.equal(server.posts.length, 1);
  assert.equal(stored.label, 'Rename Schuur to Werkplaats');
}

// A lost reply: the server committed, the lookup says so, nothing is resent.
{
  const disk = createSyntheticDisk(), server = createServer(), outbox = outboxOn(disk, server);
  outbox.configure(context);
  server.loseReplies = 1;
  const entry = await outbox.submit(submission('hall', 1));
  assert.equal(entry.state, 'waiting');
  await outbox.drain();
  assert.equal(outbox.getSnapshot().entries[0].state, 'synced');
  assert.equal(server.posts.length, 1, 'The committed envelope is not posted again');
  assert.equal(server.revisions.get('hall'), 2);
}

// A tab closed mid-send: a new page looks the entry up before sending, once.
{
  const disk = createSyntheticDisk(), server = createServer();
  const first = outboxOn(disk, server);
  first.configure(context);
  server.loseReplies = 1;
  await first.submit(submission('attic', 1));
  const second = outboxOn(disk, server);
  await second.reload();
  assert.equal(second.getSnapshot().waiting, 1);
  second.configure(context);
  await second.drain();
  second.configure(context);
  await second.drain();
  assert.equal(second.getSnapshot().entries[0].state, 'synced');
  assert.equal(server.posts.length, 1, 'Restarting never sends twice');
}

// A conflict needs the person; later edits to that record wait behind it.
{
  const disk = createSyntheticDisk(), server = createServer(), outbox = outboxOn(disk, server);
  server.online = false;
  outbox.configure(context);
  const stale = await outbox.submit(submission('garage', 1, 'Rename Garage to Werkplaats'));
  const behind = await outbox.submit(submission('garage', 2, 'Rename again'));
  const other = await outbox.submit(submission('porch', 1));
  server.revisions.set('garage', 2); // Someone else changed it meanwhile.
  server.online = true;
  await outbox.drain();
  const state = id => outbox.getSnapshot().entries.find(row => row.id === id);
  assert.equal(state(stale.id).state, 'needs-you'); assert.equal(state(stale.id).problem, 'changed');
  assert.equal(state(behind.id).state, 'waiting', 'An edit queued behind a conflict on the same record waits');
  assert.equal(state(other.id).state, 'synced', 'Other records are not held up');
  assert.equal(outbox.getSnapshot().needsYou, 1);

  // Keep mine: prepared again against the current revision, with a new key.
  outbox.register('place-name', {
    current: async () => 'Werkplaats (changed elsewhere)',
    rebase: async entry => {
      const requestId = `r${++counter}`;
      return { requestId, label: entry.label, body: JSON.stringify({ commandId: entry.commandId, requestId, idempotencyKey: `k${counter}`, target: 'garage', base: server.revisions.get('garage') }) };
    },
  });
  assert.equal(await outbox.current(stale.id, AbortSignal.timeout(1000)), 'Werkplaats (changed elsewhere)');
  await outbox.keepMine(stale.id, AbortSignal.timeout(1000));
  assert.equal(state(stale.id).state, 'synced'); assert.equal(server.revisions.get('garage'), 3);
  assert.equal(state(behind.id).state, 'needs-you', 'The queued follow-up now meets the newer revision and asks too');
  await outbox.useTheirs(behind.id);
  assert.equal(state(behind.id), undefined);
  assert.equal(syntheticRecords(disk, OUTBOX_DATABASE, 'entries').some(row => row.id === behind.id), false);
}

// Refusals map to what the person can do about them.
for (const [status, problem] of [[403, 'denied'], [404, 'removed'], [422, 'rejected']]) {
  const disk = createSyntheticDisk(), server = createServer(), outbox = outboxOn(disk, server);
  outbox.configure(context);
  server.status = status;
  const entry = await outbox.submit(submission('loft', 1));
  assert.equal(entry.state, 'needs-you'); assert.equal(entry.problem, problem);
}

// Signed out: nothing is lost and the host hears about it.
{
  const disk = createSyntheticDisk(), server = createServer();
  let signedOut = 0;
  const outbox = outboxOn(disk, server, { signedOut: () => { signedOut++; } });
  outbox.configure(context);
  server.status = 401;
  const entry = await outbox.submit(submission('cellar', 1));
  assert.equal(entry.state, 'waiting'); assert.equal(signedOut, 1);
}

// Another person or home never sends someone else's queued edits.
{
  const disk = createSyntheticDisk(), server = createServer(), outbox = outboxOn(disk, server);
  server.online = false;
  outbox.configure(context);
  await outbox.submit(submission('study', 1));
  server.online = true;
  outbox.configure({ ...context, actorId: 'a2' });
  await outbox.drain();
  assert.equal(outbox.getSnapshot().entries[0].state, 'waiting');
  assert.equal(server.posts.length, 0);
}

// "When I ask": reconnecting sends nothing until the person presses Send.
{
  const disk = createSyntheticDisk(), server = createServer(), outbox = outboxOn(disk, server);
  server.online = false;
  outbox.configure(context);
  await outbox.submit(submission('bath', 1));
  setSyncMode('ask');
  server.online = true;
  outbox.configure(context);
  await outbox.drain();
  assert.equal(outbox.getSnapshot().entries[0].state, 'waiting');
  await outbox.drain({ force: true });
  assert.equal(outbox.getSnapshot().entries[0].state, 'synced');
  setSyncMode('automatic');
}

// Only the most recent synced entries are kept for the recent list.
{
  const disk = createSyntheticDisk(), server = createServer(), outbox = outboxOn(disk, server);
  outbox.configure(context);
  for (let index = 0; index < KEEP_SYNCED + 3; index++) await outbox.submit(submission(`room-${index}`, 1));
  const kept = outbox.getSnapshot().entries;
  assert.equal(kept.length, KEEP_SYNCED);
  assert.equal(kept.at(-1).target.recordId, `room-${KEEP_SYNCED + 2}`);
  assert.equal(syntheticRecords(disk, OUTBOX_DATABASE, 'entries').length, KEEP_SYNCED);
}
console.log(JSON.stringify({ outbox: 'healthy', cases: 10 }));
