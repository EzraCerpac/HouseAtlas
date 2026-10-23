// SOURCE PREPARATION ONLY. No invocation before exact-source independent/owner
// review, registration and named-case release. Exactly one fixed --case per
// process; proposed commands must run serially and stop on the first failure.
// Generated data, actual production imports and unchanged synthetic IndexedDB.
// No browser/device, native service, listener, provider, private data or NAS.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'vite';
import { createSyntheticDisk, createSyntheticIndexedDB, syntheticRecords } from './synthetic-indexeddb.mjs';

const CASES = [
  'candidate-rejection-isolation',
  'candidate-read-retired',
  'reentrant-publication-retirement',
  'postcommit-verification-unconfirmed',
  'committed-write-retired-completion',
];
assert.equal(process.version, 'v26.10.0');
const chosen = process.argv[3];
assert.deepEqual(process.argv.slice(2), ['--case', chosen], 'Exactly one --case is required');
assert(CASES.includes(chosen), 'Select one of the five fixed cases; no aggregate mode');
const root = fileURLToPath(new URL('../', import.meta.url));
const scratch = mkdtempSync(join(tmpdir(), 'offline-identity-lifecycle-'));
const encode = text => new TextEncoder().encode(text).buffer;
const hash = bytes => createHash('sha256').update(Buffer.from(bytes)).digest('hex');
const clone = value => structuredClone(value);
const environments = [];
let h, failure = null, failed = false;
const started = new Date().toISOString();
const deadline = setTimeout(() => {
  console.error(JSON.stringify({ case: chosen, status: 'deadline-exceeded', started,
    observations: environments.map(env => env.evidence()) }));
  process.exit(1);
}, 60_000);

// All barriers are explicit promise handshakes. The unchanged IDB simulation
// owns its event scheduling; this runner adds no sleeps, polling or random race.
function barrier(label) {
  let enter, resume, entries = 0, releases = 0;
  const entered = new Promise(resolve => { enter = resolve; });
  const released = new Promise(resolve => { resume = resolve; });
  return {
    label, entered,
    async wait(value) { entries++; enter(value); await released; return value; },
    release() { releases++; resume(); },
    counts: () => ({ label, entries, releases }),
  };
}

// Generated data construction adapted from the healthy runner, never imported
// from its executable body. Two fixed included identities; no product validator
// is copied. The sole corrupt variant changes the second declared member hash;
// Atlas/manifest/aggregate resource hashes are independently calculated normally.
function generatedPack(memberMismatch = false) {
  const scope = { workspaceId: '00000000-0000-4000-8000-000000000e01', homeId: '00000000-0000-4000-8000-000000000e02' };
  const time = '2026-10-23T00:00:00Z';
  const id = n => '00000000-0000-4000-8000-' + n.toString(16).padStart(12, '0');
  const revisionJson = (value, token) => JSON.stringify({ ...value, revision: '__GENERATED_REVISION__' })
    .replace('"__GENERATED_REVISION__"', token);
  const originals = ['1.0', '1E+0'].map((token, index) => {
    const record = { schemaVersion: 1, ...scope, recordType: 'identity', recordId: id(0xe11 + index), revision: 1,
      lifecycle: 'active', createdAt: time, updatedAt: time, lastAuditId: id(0xe03), payload: { kind: 'location', evidenceIds: [] } };
    return { record, token, bytes: encode('\r\n ' + revisionJson(record, token) + '\n') };
  });
  const resources = new Map(), descriptors = [];
  function add(bytes, contentType, section, role = 'section') {
    const sha256 = hash(bytes); assert(!resources.has(sha256));
    resources.set(sha256, bytes.slice(0));
    descriptors.push({ sha256, bytes: bytes.byteLength, contentType, section, role, record: null });
    return sha256;
  }
  const homeHash = add(encode(JSON.stringify({ profile: 'houseatlas.home-read-pack.home.v1', scope,
    label: 'Generated lifecycle property', selection: { ...scope, buildingId: null, floorId: null, roomId: null } })), 'application/json', 'home');
  const combined = Buffer.concat(originals.map(row => Buffer.from(row.bytes)));
  const aggregateHash = add(combined.buffer.slice(combined.byteOffset, combined.byteOffset + combined.byteLength), 'application/octet-stream', 'atlas', 'original');
  let offset = 0;
  const members = originals.map(row => {
    const result = { ...scope, recordType: 'identity', recordId: row.record.recordId,
      offset, bytes: row.bytes.byteLength, sha256: hash(row.bytes) };
    offset += row.bytes.byteLength; return result;
  });
  const correctMembers = clone(members);
  if (memberMismatch) members[1].sha256 = (members[1].sha256[0] === '0' ? '1' : '0') + members[1].sha256.slice(1);
  assert.equal(members.filter((row, index) => row.sha256 !== correctMembers[index].sha256).length, memberMismatch ? 1 : 0);
  assert.deepEqual(members.map(row => ({ ...row, sha256: null })), correctMembers.map(row => ({ ...row, sha256: null })));
  const atlas = { contractVersion: '1.0.0', synthetic: true, records: originals.map(row => row.record),
    revisions: originals.map(row => ({ recordType: 'identity', recordId: row.record.recordId, revision: 1, lastAuditId: id(0xe03) })),
    sources: [], caches: [], nativeGeometry: [] };
  const extension = '{"profile":"houseatlas.home-read-pack.retained-identity-bodies.v1","resourceSha256":' + JSON.stringify(aggregateHash)
    + ',"bytes":' + combined.length + ',"members":[' + members.map((row, index) => revisionJson(row, originals[index].token)).join(',') + '],"omissions":[]}';
  const atlasHash = add(encode(JSON.stringify(atlas).slice(0, -1) + ',"retainedIdentityBodies":' + extension + '}\n'), 'application/json', 'atlas');
  const sections = Object.fromEntries(h.SECTION_NAMES.map(name => [name, { state: 'not-configured', resourceSha256: null, requiredBytesComplete: true }]));
  sections.home = { state: 'complete', resourceSha256: homeHash, requiredBytesComplete: true };
  sections.atlas = { state: 'complete', resourceSha256: atlasHash, requiredBytesComplete: true };
  const retained = { profile: 'houseatlas.home-read-pack.v1', scope, capturedAt: time, completeness: 'complete', limits: h.PACK_LIMITS,
    totals: { bytes: descriptors.reduce((sum, row) => sum + row.bytes, 0), resources: descriptors.length }, sections, resources: descriptors, exclusions: [] };
  const snapshotId = hash(encode(h.canonicalPack(h.parseLosslessJson(JSON.stringify(retained)))));
  const house = { version: 1, localRevision: id(0xe04), scope, key: scope.workspaceId + '/' + scope.homeId,
    snapshotId, label: 'Generated lifecycle copy', capturedAt: time, shellBuildId: 'f'.repeat(64),
    manifest: encode('\r\n ' + JSON.stringify({ ...retained, snapshotId }, null, 2) + '\r\n'),
    resources: descriptors.map(row => ({ id: row.sha256, sha256: row.sha256, bytes: row.bytes, contentType: row.contentType,
      role: row.section + '/' + row.role, label: row.section + ' ' + row.role, record: null })) };
  return { house, originals, resources, aggregateHash, atlasHash, input(index = 0) {
    const row = originals[index];
    return { scope: clone(scope), savedKey: house.key, snapshotId, localRevision: house.localRevision,
      selectedResource: clone(house.resources.find(pin => pin.sha256 === aggregateHash)),
      recordIdentity: { recordType: 'identity', recordId: row.record.recordId },
      manifest: { bytes: house.manifest.slice(0), sha256: hash(house.manifest) },
      original: { bytes: row.bytes.slice(0), sha256: hash(row.bytes), revision: row.token } };
  } };
}

function environment(label, { memberMismatch = false, resourceBarrier = null, retainBarrier = null, rejectVerification = false } = {}) {
  const pack = generatedPack(memberMismatch), savedBaseline = clone(pack.house), resourceBaseline = clone([...pack.resources]);
  const disk = createSyntheticDisk(), transactions = [], events = [], opens = [], adapters = [], lifetimes = [], pending = [];
  const local = { retain: 0, get: 0, list: 0, setProposal: 0, resetProposal: 0, discard: 0 };
  const resource = { list: 0, asset: [], bodies: [] };
  const resourceErrors = [];
  const rejectedSelections = [];
  let armed = false, rejected = 0, retainReturned = null;
  function observedFactory() {
    const factory = createSyntheticIndexedDB(disk);
    return { open(name, version) {
      opens.push({ name, version });
      const request = factory.open(name, version); let success;
      Object.defineProperty(request, 'onsuccess', { set(callback) { success = callback; }, get() { return event => {
        const db = request.result, transact = db.transaction.bind(db);
        db.transaction = (names, mode) => {
          const tx = transact(names, mode), observation = { names: [...names], mode, completed: false };
          transactions.push(observation); let complete;
          Object.defineProperty(tx, 'oncomplete', { set(callback) { complete = callback; }, get() { return event => {
            observation.completed = true; events.push({ event: 'oncomplete', mode, commits: disk.commits }); complete?.(event);
          }; } }); return tx;
        }; success?.(event);
      }; } }); return request;
    } };
  }
  const partition = 'generated-identity-lifecycle-' + label;
  const actual = h.createLocalEditRetentionStore(partition, observedFactory());
  const port = {
    async retain(input) {
      local.retain++;
      const result = await actual.retain(input);
      // The real store only resolves oncomplete. Snapshot this observation;
      // assertions stay in the caller, outside event/observer boundaries.
      retainReturned = { completedWrites: transactions.filter(tx => tx.mode === 'readwrite' && tx.completed).length, commits: disk.commits };
      events.push({ event: 'retain-returned', ...retainReturned });
      if (rejectVerification) armed = true;
      return retainBarrier ? retainBarrier.wait(result) : result;
    },
    async get(selection) {
      local.get++;
      if (armed) { armed = false; rejected++; rejectedSelections.push(clone(selection));
        events.push({ event: 'verification-get-rejected', commits: disk.commits });
        throw new Error('Generated exact postcommit verification get rejection'); }
      return actual.get(selection);
    },
    async list(context) { local.list++; return actual.list(context); },
    async setProposal(selection, bytes) { local.setProposal++; return actual.setProposal(selection, bytes); },
    async resetProposal(selection) { local.resetProposal++; return actual.resetProposal(selection); },
    async discard(selection) { local.discard++; return actual.discard(selection); },
    close: () => actual.close(),
  };
  const checkedResource = read => async (...args) => {
    try { return await read(...args); }
    catch (error) { resourceErrors.push(String(error.stack ?? error)); throw error; }
  };
  const resources = {
    list: checkedResource(async () => { resource.list++; assert(resource.list <= 40); return [clone(pack.house)]; }),
    asset: checkedResource(async (selected, id) => {
      resource.asset.push(id); assert(resource.asset.length <= 8); assert.deepEqual(selected, savedBaseline);
      const pin = pack.house.resources.find(row => row.id === id); assert(pin && pack.resources.has(id));
      const blob = new Blob([pack.resources.get(id)], { type: pin.contentType }), read = blob.arrayBuffer.bind(blob);
      Object.defineProperty(blob, 'arrayBuffer', { value: () => { resource.bodies.push(id); return read(); } });
      return resourceBarrier && id === pack.aggregateHash ? resourceBarrier.wait(blob) : blob;
    }),
  };
  const env = { label, pack, disk, actual, port, partition, transactions, events, pending, rejectedSelections,
    rows: () => syntheticRecords(disk, h.LOCAL_EDIT_RETENTION_DATABASE, 'drafts'),
    counts: () => clone({ local, resource, commits: disk.commits, transactions: transactions.length }),
    injected: () => ({ rejected, retainReturned: clone(retainReturned) }),
    createAdapter() {
      const lifetime = new AbortController(); lifetimes.push(lifetime);
      const selection = { house: clone(pack.house), signal: lifetime.signal, isCurrent: () => !lifetime.signal.aborted, resources };
      const adapter = h.createSavedLocalEditAdapter(selection, partition, port); adapters.push(adapter);
      return { adapter, lifetime };
    },
    assertEvidence() {
      assert.deepEqual(resourceErrors, [], 'Resource-port assertion failures cannot masquerade as the selected admission mismatch');
      assert.deepEqual(pack.house, savedBaseline); assert.deepEqual([...pack.resources], resourceBaseline);
      assert(opens.length <= 1); for (const open of opens) assert.deepEqual(open, { name: h.LOCAL_EDIT_RETENTION_DATABASE, version: 1 });
      assert(transactions.length <= 24); assert(transactions.every(tx => tx.completed));
      assert(transactions.every(tx => JSON.stringify(tx.names) === '["drafts"]'));
      assert.equal(disk.quotaAborts, 0);
    },
    evidence: () => ({ label, counts: env.counts(), transactions: clone(transactions), events: clone(events), resourceErrors: [...resourceErrors],
      snapshots: adapters.map(adapter => adapter.getSnapshot()), rowCount: env.rows().length,
      injection: env.injected(), rejectedSelections: clone(rejectedSelections),
      barriers: [resourceBarrier, retainBarrier].filter(Boolean).map(gate => gate.counts()) }),
    async cleanup() {
      for (const adapter of adapters) adapter.dispose();
      for (const lifetime of lifetimes) lifetime.abort();
      for (const gate of [resourceBarrier, retainBarrier].filter(Boolean)) if (gate.counts().releases === 0) gate.release();
      await Promise.allSettled(pending); await actual.close();
    },
  };
  environments.push(env); return env;
}

function observe(adapter, env, reaction = null) {
  let calls = 0;
  const notices = [], errors = [];
  const stop = adapter.subscribe(() => {
    calls++;
    try {
      const state = adapter.getSnapshot();
      notices.push({ state, counts: env.counts(), frozen: Object.isFrozen(state),
        completed: env.transactions.every(tx => tx.completed) });
      reaction?.(state);
    } catch (error) { errors.push(String(error.stack ?? error)); }
  });
  return { notices, stop, check() {
    // Production intentionally swallows observer exceptions. No test assertion
    // lives inside that boundary; include capture/reaction errors explicitly.
    assert.deepEqual(errors, []); assert.equal(notices.length, calls); assert(calls <= 64);
    for (const notice of notices) {
      assert(notice.frozen);
      if (notice.state.status === 'ready' && notice.state.outcome?.completion === 'verified') assert(notice.completed);
    }
  } };
}
function exact(row, env) {
  const input = env.pack.input();
  assert(row); assert.deepEqual(row.original, input.original); assert.deepEqual(row.manifest, input.manifest);
  assert.deepEqual(row.selectedResource, input.selectedResource); assert.deepEqual(row.recordIdentity, input.recordIdentity);
  assert.equal(row.localPartitionId, env.partition); assert.equal(row.nativeAuthority, 'not-established');
  assert.equal(row.currentBase, 'not-checked'); assert.equal(row.proposal, null);
}
async function selectCandidate(adapter, env) {
  await adapter.readCandidates();
  const state = adapter.getSnapshot(); assert.equal(state.candidateStatus, 'ready'); assert.equal(state.candidates.length, 2);
  assert.deepEqual(state.candidates.map(row => row.recordId), env.pack.originals.map(row => row.record.recordId));
  const selected = await adapter.chooseCandidate(state.candidates[0].key);
  assert.equal(selected.completion, 'verified'); assert.equal(selected.action, 'read'); assert.equal(selected.draft, null);
  assert.equal(adapter.getSnapshot().canRetain, true); assert.equal(env.rows().length, 0);
  return selected;
}

const cases = {
  async 'candidate-rejection-isolation'() {
    const env = environment('rejection', { memberMismatch: true });
    // Only setup seeds a matching existing row. The first member is unchanged;
    // the second member's declared hash is the sole admission defect.
    exact(await env.actual.retain(env.pack.input()), env);
    const { adapter } = env.createAdapter(), watch = observe(adapter, env);
    await adapter.list();
    assert.equal(adapter.getSnapshot().summaries.length, 1);
    const key = adapter.getSnapshot().summaries[0].key;
    exact((await adapter.open(key)).draft, env);
    const prior = env.counts(), rows = env.rows(), detail = clone(adapter.getSnapshot().detail);
    await adapter.readCandidates(); watch.check();
    const rejected = adapter.getSnapshot();
    assert.equal(rejected.candidateStatus, 'unavailable'); assert.deepEqual(rejected.candidates, []);
    assert.equal(rejected.canRetain, false); assert.equal(rejected.selectedCandidate, null);
    assert.equal(rejected.status, 'ready'); assert.deepEqual(rejected.detail, detail); assert.equal(rejected.detail.canEdit, true);
    assert.deepEqual(env.counts().local, prior.local); assert.equal(env.disk.commits, prior.commits);
    assert.deepEqual(env.counts().resource.asset, [env.pack.atlasHash, env.pack.aggregateHash]);
    assert.deepEqual(env.counts().resource.bodies, [env.pack.atlasHash, env.pack.aggregateHash]);
    assert.equal(await adapter.retain(), null);
    assert.equal(await adapter.chooseCandidate(env.pack.originals[0].record.recordId), null);
    assert.deepEqual(env.rows(), rows); assert.deepEqual(env.counts().local, prior.local);
    exact((await adapter.read()).draft, env); watch.check();
    assert.deepEqual(env.rows(), rows); assert.equal(env.disk.commits, prior.commits);
    assert.equal(env.counts().local.retain, 0); // seed bypassed the adapter port
    assert(!watch.notices.some(notice => notice.state.candidateStatus === 'ready'));
    env.assertEvidence(); watch.stop();
  },
  async 'candidate-read-retired'() {
    const gate = barrier('aggregate-resource-return');
    const env = environment('read-retired', { resourceBarrier: gate });
    const { adapter, lifetime } = env.createAdapter(), watch = observe(adapter, env);
    const reading = adapter.readCandidates(); env.pending.push(reading);
    const held = await gate.entered;
    assert(held instanceof Blob); assert.equal(held.size, env.pack.house.resources.find(pin => pin.id === env.pack.aggregateHash).bytes);
    assert.deepEqual(gate.counts(), { label: gate.label, entries: 1, releases: 0 });
    assert.equal(adapter.getSnapshot().candidateStatus, 'reading');
    lifetime.abort();
    const retired = adapter.getSnapshot(), count = watch.notices.length, atRetirement = env.counts();
    assert.equal(retired.status, 'retired');
    gate.release(); await reading; watch.check();
    assert.deepEqual(gate.counts(), { label: gate.label, entries: 1, releases: 1 });
    assert.equal(adapter.getSnapshot(), retired); assert.equal(watch.notices.length, count);
    assert.deepEqual(env.counts(), atRetirement);
    assert.deepEqual(env.counts().resource.bodies, [env.pack.atlasHash]);
    assert.deepEqual(env.rows(), []); assert.equal(env.disk.databases.size, 0);
    assert.equal(await adapter.retain(), null); assert.deepEqual(env.counts(), atRetirement);
    assert(!watch.notices.some(notice => notice.state.candidateStatus === 'ready'));
    env.assertEvidence(); watch.stop();
  },
  async 'reentrant-publication-retirement'() {
    // Fixed 2x2 subcases, serial fresh stores: two publication seams and the two
    // existing memory-retirement actions. No timing fuzz or additional cases.
    for (const phase of ['reading', 'selected']) for (const action of ['closeDetail', 'dispose']) {
      const env = environment('reentrant-' + phase + '-' + action);
      const { adapter } = env.createAdapter();
      if (phase === 'selected') {
        await adapter.readCandidates(); assert.equal(adapter.getSnapshot().candidateStatus, 'ready');
        assert.equal(adapter.getSnapshot().candidates.length, 2);
      }
      let fired = 0, trigger = null;
      const watch = observe(adapter, env, state => {
        if (fired === 0 && (phase === 'reading' ? state.candidateStatus === 'reading' : state.selectedCandidate !== null)) {
          fired++; trigger = env.counts(); adapter[action]();
        }
      });
      const key = env.pack.originals[0].record.recordId;
      const result = phase === 'reading' ? await adapter.readCandidates() : await adapter.chooseCandidate(key);
      watch.check(); assert.equal(fired, 1); assert(trigger);
      if (phase === 'selected') assert.equal(result, null);
      assert.deepEqual(env.counts(), trigger, 'No stale resource or storage dispatch after reentrant retirement');
      const state = adapter.getSnapshot(); assert.equal(state.status, action === 'dispose' ? 'retired' : 'listed');
      assert.equal(state.selectedKey, null); assert.equal(state.selectedCandidate, null);
      assert.equal(state.detail, null); assert.equal(state.canRetain, false);
      assert.equal(await adapter.retain(), null); assert.equal(await adapter.read(), null);
      assert.deepEqual(env.counts(), trigger); assert.deepEqual(env.rows(), []); assert.equal(env.disk.databases.size, 0);
      assert(!watch.notices.some(notice => ['opening', 'pending', 'ready'].includes(notice.state.status)));
      if (phase === 'reading') assert.equal(env.counts().resource.list, 0);
      env.assertEvidence(); watch.stop();
    }
  },
  async 'postcommit-verification-unconfirmed'() {
    const env = environment('unconfirmed', { rejectVerification: true });
    const { adapter } = env.createAdapter(), watch = observe(adapter, env);
    const selected = await selectCandidate(adapter, env); watch.check();
    const failed = await adapter.retain(); watch.check();
    assert.equal(failed.action, 'retain'); assert.equal(failed.completion, 'completion-unconfirmed'); assert.equal(failed.published, true);
    assert.deepEqual(failed.selection, selected.selection); assert.equal(failed.selectionGeneration, selected.selectionGeneration);
    assert.equal(adapter.getSnapshot().status, 'completion-unconfirmed'); assert.equal(adapter.getSnapshot().canRetain, false);
    assert.equal(adapter.getSnapshot().detail, null); assert.equal(env.rows().length, 1);
    assert.deepEqual(env.injected(), { rejected: 1, retainReturned: { completedWrites: 1, commits: 1 } });
    assert.deepEqual(env.rejectedSelections, [selected.selection], 'Only the exact next controller verification selection was rejected');
    const ordered = env.events.map(item => item.event);
    const returned = ordered.indexOf('retain-returned'), rejected = ordered.indexOf('verification-get-rejected');
    assert(returned > 0 && rejected === returned + 1);
    assert.deepEqual(env.events[returned - 1], { event: 'oncomplete', mode: 'readwrite', commits: 1 });
    exact(await env.actual.get(selected.selection), env);
    const rows = env.rows(), counts = env.counts(), uncertain = adapter.getSnapshot();
    assert.equal(await adapter.retain(), null);
    assert.equal(await adapter.saveProposal('{"generated":"local proposal"}\n'), null);
    assert.equal(await adapter.resetProposal(), null); assert.equal(await adapter.discard(), null);
    assert.equal(adapter.getSnapshot(), uncertain); assert.deepEqual(env.counts(), counts); assert.deepEqual(env.rows(), rows);
    assert.equal(env.counts().local.retain, 1); assert.equal(env.disk.commits, 1);
    const read = await adapter.read(); watch.check();
    assert.equal(read.action, 'read'); assert.equal(read.completion, 'verified'); assert.equal(read.published, true); exact(read.draft, env);
    assert.equal(adapter.getSnapshot().status, 'ready'); assert.equal(adapter.getSnapshot().detail.canEdit, true);
    assert.equal(adapter.getSnapshot().canRetain, false, 'Existing committed row cannot be retained again');
    assert.deepEqual(env.rows(), rows); assert.equal(env.counts().local.retain, 1); assert.equal(env.disk.commits, 1);
    assert(!watch.notices.some(notice => notice.state.outcome?.action === 'retain' && notice.state.outcome.completion === 'verified'));
    assert.equal(env.counts().local.setProposal + env.counts().local.resetProposal + env.counts().local.discard, 0);
    env.assertEvidence(); watch.stop();
  },
  async 'committed-write-retired-completion'() {
    const gate = barrier('committed-retain-return');
    const env = environment('write-retired', { retainBarrier: gate });
    const { adapter, lifetime } = env.createAdapter(), oldWatch = observe(adapter, env);
    const selected = await selectCandidate(adapter, env); oldWatch.check();
    const retaining = adapter.retain(); env.pending.push(retaining);
    const committed = await gate.entered;
    exact(committed, env);
    assert.deepEqual(env.injected(), { rejected: 0, retainReturned: { completedWrites: 1, commits: 1 } });
    assert.deepEqual(gate.counts(), { label: gate.label, entries: 1, releases: 0 });
    assert.equal(adapter.getSnapshot().status, 'pending'); assert.equal(env.rows().length, 1);
    const rows = env.rows();
    lifetime.abort();
    const retired = adapter.getSnapshot(), notices = oldWatch.notices.length;
    assert.equal(retired.status, 'retired');
    const { adapter: replacement } = env.createAdapter(), replacementWatch = observe(replacement, env);
    const fresh = replacement.getSnapshot(); assert.equal(fresh.status, 'idle');
    gate.release();
    const result = await retaining; oldWatch.check(); replacementWatch.check();
    assert.deepEqual(gate.counts(), { label: gate.label, entries: 1, releases: 1 });
    assert.equal(result.action, 'retain'); assert.equal(result.completion, 'verified'); assert.equal(result.published, false);
    assert.equal(result.localPartitionId, env.partition); assert.equal(result.selectionGeneration, selected.selectionGeneration);
    assert.deepEqual(result.selection, selected.selection); exact(result.draft, env);
    assert.equal(adapter.getSnapshot(), retired); assert.equal(oldWatch.notices.length, notices);
    assert.equal(replacement.getSnapshot(), fresh); assert.equal(replacementWatch.notices.length, 0);
    assert.equal(fresh.outcome, null); assert.equal(fresh.detail, null); assert.equal(fresh.canRetain, false);
    exact(await env.actual.get(selected.selection), env); assert.deepEqual(env.rows(), rows);
    assert.equal(env.counts().local.retain, 1); assert.equal(env.counts().local.get, 2, 'Absent read plus old controller verification read');
    assert.equal(env.counts().local.setProposal + env.counts().local.resetProposal + env.counts().local.discard, 0);
    assert.equal(env.disk.commits, 1, 'Retirement did not cancel or roll back the committed row');
    env.assertEvidence(); oldWatch.stop(); replacementWatch.stop();
  },
};

let outcome;
try {
  const entry = join(scratch, 'entry.ts');
  writeFileSync(entry, [
    `export { createSavedLocalEditAdapter } from ${JSON.stringify(join(root, 'src/local-edit-retention/saved-adapter.ts'))};`,
    `export { createLocalEditRetentionStore, LOCAL_EDIT_RETENTION_DATABASE } from ${JSON.stringify(join(root, 'src/local-edit-retention/store.ts'))};`,
    `export { canonicalPack, PACK_LIMITS, SECTION_NAMES } from ${JSON.stringify(join(root, 'src/offline/manifest.ts'))};`,
    `export { parseLosslessJson } from ${JSON.stringify(join(root, 'src/numeric/lossless-json.ts'))};`,
  ].join('\n'));
  const built = await build({ root, configFile: false, logLevel: 'silent', build: { write: false, target: 'node26', minify: false,
    lib: { entry, formats: ['es'] }, rolldownOptions: { output: { codeSplitting: false } } } });
  const output = Array.isArray(built) ? built[0] : built;
  const modulePath = join(scratch, 'fixture.mjs');
  writeFileSync(modulePath, output.output.find(item => item.type === 'chunk' && item.isEntry).code);
  h = await import(pathToFileURL(modulePath).href);
  await cases[chosen]();
} catch (error) { failed = true; failure = error; }
finally {
  // Preserve case observations before releasing any failed-case barrier for
  // cleanup. Cleanup never deletes retained rows or turns a failure into PASS.
  outcome = { case: chosen, status: failed ? 'failed' : 'passed', started, finished: new Date().toISOString(),
    observations: environments.map(env => env.evidence()), error: failed ? String(failure?.stack ?? failure) : null };
  const cleaned = await Promise.allSettled(environments.map(env => env.cleanup()));
  const cleanupErrors = cleaned.filter(item => item.status === 'rejected').map(item => String(item.reason));
  if (cleanupErrors.length) { outcome.status = 'failed'; outcome.cleanupErrors = cleanupErrors; }
  rmSync(scratch, { recursive: true, force: true }); clearTimeout(deadline);
}
if (outcome.status === 'failed') { console.error(JSON.stringify(outcome)); process.exitCode = 1; }
else console.log(JSON.stringify({ ...outcome,
  scope: 'Only this generated source/simulated-storage regression; no browser/device/NAS, native authority/current-base or deployment acceptance.' }));
