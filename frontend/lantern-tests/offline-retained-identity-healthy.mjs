// PROPOSED bounded serial generated positive. DO NOT INVOKE until exact-source
// review and a separate source-owner release of this named command. No browser,
// native service, listener, household data, fault/denial/retirement controls,
// automatic retry or submission. Healthy success qualifies only these paths.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import { build } from 'vite';
import { createSyntheticDisk, createSyntheticIndexedDB, syntheticRecords } from './synthetic-indexeddb.mjs';

assert.equal(process.version, 'v26.10.0');
assert.deepEqual(process.argv.slice(2), [], 'This runner takes no arguments');
const deadline = setTimeout(() => { console.error('Generated positive exceeded 60 seconds'); process.exit(1); }, 60_000);
const root = fileURLToPath(new URL('../', import.meta.url)), require = createRequire(import.meta.url);
const scratch = mkdtempSync(join(tmpdir(), 'offline-retained-identity-healthy-'));
const encode = text => new TextEncoder().encode(text).buffer;
const decode = bytes => new TextDecoder('utf-8', { fatal: true }).decode(bytes);
const hash = bytes => createHash('sha256').update(Buffer.from(bytes)).digest('hex');
const clone = value => structuredClone(value);
const MiB = 1024 * 1024;
let h, store, otherStore, adapter;
try {
  const entry = join(scratch, 'entry.ts');
  writeFileSync(entry, [
    `export * from ${JSON.stringify(join(root, 'src/local-edit-retention/saved-adapter.ts'))};`,
    `export { LocalEditPanel } from ${JSON.stringify(join(root, 'src/local-edit-retention/LocalEditPanel.tsx'))};`,
    `export { createLocalEditRetentionStore, LOCAL_EDIT_RETENTION_DATABASE } from ${JSON.stringify(join(root, 'src/local-edit-retention/store.ts'))};`,
    `export { canonicalPack, PACK_LIMITS, SECTION_NAMES } from ${JSON.stringify(join(root, 'src/offline/manifest.ts'))};`,
    `export { parseLosslessJson } from ${JSON.stringify(join(root, 'src/numeric/lossless-json.ts'))};`,
  ].join('\n'));
  const built = await build({ root, configFile: false, logLevel: 'silent', build: { write: false, target: 'node26', minify: false,
    lib: { entry, formats: ['es'] }, rolldownOptions: { external: id => /^(react|react-dom)(\/|$)/.test(id),
      output: { codeSplitting: false, paths: id => pathToFileURL(require.resolve(id)).href } } } });
  const output = Array.isArray(built) ? built[0] : built;
  const code = output.output.find(item => item.type === 'chunk' && item.isEntry).code;
  const modulePath = join(scratch, 'fixture.mjs'); writeFileSync(modulePath, code);
  h = await import(pathToFileURL(modulePath).href);
  const { createElement } = await import(new URL('../node_modules/react/index.js', import.meta.url).href);
  const { renderToStaticMarkup } = await import(new URL('../node_modules/react-dom/server.node.js', import.meta.url).href);
  const scope = { workspaceId: '00000000-0000-4000-8000-000000000c01', homeId: '00000000-0000-4000-8000-000000000c02' };
  const time = '2026-10-22T00:00:00Z', partition = 'generated-retained-identity-a';
  const id = n => '00000000-0000-4000-8000-' + n.toString(16).padStart(12, '0');
  const disk = createSyntheticDisk(), transactions = [];
  function factory() {
    const source = createSyntheticIndexedDB(disk);
    return { open(name, version) {
      assert.equal(name, h.LOCAL_EDIT_RETENTION_DATABASE); assert.equal(version, 1);
      const request = source.open(name, version); let success;
      Object.defineProperty(request, 'onsuccess', { set(callback) { success = callback; }, get() { return event => {
        const db = request.result, transact = db.transaction.bind(db);
        db.transaction = (names, mode) => {
          assert.deepEqual(names, ['drafts']);
          const tx = transact(names, mode), observation = { mode, completed: false };
          transactions.push(observation); let complete;
          Object.defineProperty(tx, 'oncomplete', { set(callback) { complete = callback; },
            get() { return event => { observation.completed = true; complete?.(event); }; } });
          return tx;
        }; success?.(event);
      }; } }); return request;
    } };
  }
  const rows = () => syntheticRecords(disk, h.LOCAL_EDIT_RETENTION_DATABASE, 'drafts');
  // Substitute only this generated control placeholder; raw numeric tokens are
  // never passed through Number/stringify. Documentary revisions are canonical.
  const withRevision = (row, token) => JSON.stringify({ ...row, revision: '__GENERATED_REVISION__' })
    .replace('"__GENERATED_REVISION__"', token);
  function identity(n, token, length = null) {
    const value = { schemaVersion: 1, ...scope, recordType: 'identity', recordId: id(n),
      revision: token.startsWith('9') ? 9007199254740991 : 1, lifecycle: 'active',
      createdAt: time, updatedAt: time, lastAuditId: id(0xc03), payload: { kind: 'location', evidenceIds: [] } };
    let text = '\r\n ' + withRevision(value, token) + '\n';
    if (length !== null) { assert(Buffer.byteLength(text) < length); text += ' '.repeat(length - Buffer.byteLength(text)); }
    return { value, token, bytes: encode(text) };
  }
  function pack(which, originals) {
    const resources = new Map(), descriptors = [];
    const add = (bytes, contentType, section, role = 'section') => {
      const sha256 = hash(bytes); assert(!resources.has(sha256)); resources.set(sha256, bytes.slice(0));
      descriptors.push({ sha256, bytes: bytes.byteLength, contentType, section, role, record: null }); return sha256;
    };
    const homeHash = add(encode(JSON.stringify({ profile: 'houseatlas.home-read-pack.home.v1', scope,
      label: 'Generated saved property ' + which, selection: { ...scope, buildingId: null, floorId: null, roomId: null } })), 'application/json', 'home');
    const included = originals.filter(row => row.bytes.byteLength <= MiB), omitted = originals.filter(row => row.bytes.byteLength > MiB);
    const aggregate = Buffer.concat(included.map(row => Buffer.from(row.bytes)));
    const aggregateHash = aggregate.length === 0 ? null : add(aggregate.buffer.slice(aggregate.byteOffset, aggregate.byteOffset + aggregate.byteLength), 'application/octet-stream', 'atlas', 'original');
    let offset = 0;
    const memberText = included.map(row => {
      const member = { ...scope, recordType: 'identity', recordId: row.value.recordId, offset, bytes: row.bytes.byteLength, sha256: hash(row.bytes) };
      offset += row.bytes.byteLength; return withRevision(member, row.token);
    });
    const omissionText = omitted.map(row => withRevision({ ...scope, recordType: 'identity', recordId: row.value.recordId,
      bytes: row.bytes.byteLength, sha256: hash(row.bytes), code: 'member-byte-budget' }, row.token));
    const atlas = { contractVersion: '1.0.0', synthetic: true, records: originals.map(row => row.value),
      revisions: originals.map(row => ({ recordType: 'identity', recordId: row.value.recordId, revision: row.value.revision, lastAuditId: id(0xc03) })),
      sources: [], caches: [], nativeGeometry: [] };
    const extension = '{"profile":"houseatlas.home-read-pack.retained-identity-bodies.v1","resourceSha256":' + JSON.stringify(aggregateHash)
      + ',"bytes":' + aggregate.length + ',"members":[' + memberText.join(',') + '],"omissions":[' + omissionText.join(',') + ']}';
    const atlasHash = add(encode(JSON.stringify(atlas).slice(0, -1) + ',"retainedIdentityBodies":' + extension + '}\n'), 'application/json', 'atlas');
    const sections = Object.fromEntries(h.SECTION_NAMES.map(name => [name, { state: 'not-configured', resourceSha256: null, requiredBytesComplete: true }]));
    sections.home = { state: 'complete', resourceSha256: homeHash, requiredBytesComplete: true };
    sections.atlas = { state: omitted.length ? 'partial' : 'complete', resourceSha256: atlasHash, requiredBytesComplete: !omitted.length };
    const retained = { profile: 'houseatlas.home-read-pack.v1', scope, capturedAt: time, completeness: omitted.length ? 'partial' : 'complete',
      limits: h.PACK_LIMITS, totals: { bytes: descriptors.reduce((sum, row) => sum + row.bytes, 0), resources: descriptors.length }, sections,
      resources: descriptors, exclusions: omitted.length ? [{ section: 'atlas', code: 'retained-identity-member-budget', label: 'An identity body exceeds the retained member bound' }] : [] };
    const canonical = value => h.canonicalPack(h.parseLosslessJson(JSON.stringify(value)));
    const snapshotId = hash(encode(canonical(retained)));
    // Deliberately noncanonical unchanged selected manifest: retention must not
    // use readPackManifest(...).localBytes as the original manifest.
    const manifest = encode('\r\n ' + JSON.stringify({ ...retained, snapshotId }, null, 2) + '\r\n');
    const house = { version: 1, localRevision: id(0xc10 + which), scope, key: scope.workspaceId + '/' + scope.homeId,
      snapshotId, label: 'Generated saved copy ' + which, capturedAt: time, shellBuildId: 'f'.repeat(64), manifest,
      resources: descriptors.map(row => ({ id: row.sha256, sha256: row.sha256, bytes: row.bytes, contentType: row.contentType,
        role: row.section + '/' + row.role, label: row.section + ' ' + row.role, record: null })) };
    const baseline = clone(house), payloads = [...resources].map(([key, bytes]) => [key, bytes.slice(0)]), reads = [];
    const selection = { house: clone(house), signal: new AbortController().signal, isCurrent: () => true,
      resources: { async list() { reads.push('list'); assert(reads.length <= 80); return [clone(house)]; },
        async asset(selected, resourceId) {
          assert.deepEqual(selected, baseline); assert(resources.has(resourceId)); reads.push(resourceId); assert(reads.length <= 80);
          const pin = house.resources.find(row => row.id === resourceId); return new Blob([resources.get(resourceId)], { type: pin.contentType });
        } } };
    return { house, baseline, payloads, resources, reads, selection, included, omitted, aggregateHash };
  }
  const multi = pack(1, [identity(0xd01, '1.0'), identity(0xd02, '1E+0'), identity(0xd03, '10e-1'),
    identity(0xd04, '9.007199254740991e+15', MiB), identity(0xd05, '1.0', MiB + 1)]);
  const single = pack(2, [identity(0xd11, '90071992547409910e-1')]);
  const omissionsOnly = pack(3, [identity(0xd21, '1E+0', MiB + 1)]);
  store = h.createLocalEditRetentionStore(partition, factory());
  otherStore = h.createLocalEditRetentionStore('generated-retained-identity-b', factory());
  const render = (selected, port) => renderToStaticMarkup(createElement(h.LocalEditPanel, { selection: selected, ...(port ? { adapter: port } : {}) }));
  assert(render(multi.selection, null).includes('Open local draft space'));
  adapter = h.createSavedLocalEditAdapter(multi.selection, partition, store);
  assert(render(multi.selection, adapter).includes('Read saved identity originals'));
  assert.equal(multi.reads.length, 0); assert.equal(disk.databases.size, 0, 'Construction/rendering reads and writes nothing');
  const stable = adapter.getSnapshot(); assert.equal(stable, adapter.getSnapshot()); assert(Object.isFrozen(stable));
  let notifications = 0;
  let stop = adapter.subscribe(() => {
    notifications++; assert(notifications <= 100);
    const snapshot = adapter.getSnapshot();
    assert(Object.isFrozen(snapshot));
    for (const candidate of snapshot.candidates) assert.equal(typeof candidate.revision, 'string');
    if (snapshot.status === 'ready') assert(transactions.every(tx => tx.completed));
  });
  await adapter.readCandidates();
  assert.equal(adapter.getSnapshot().candidateStatus, 'ready'); assert.equal(rows().length, 0);
  assert.deepEqual(adapter.getSnapshot().candidates.map(row => row.recordId), multi.included.map(row => row.value.recordId));
  assert.deepEqual(adapter.getSnapshot().candidates.map(row => row.revision), multi.included.map(row => row.token));
  assert(adapter.getSnapshot().candidateMessage.includes('1 oversized'));
  const firstKey = adapter.getSnapshot().candidates[0].key;
  const selected = await adapter.chooseCandidate(firstKey);
  assert.equal(selected.completion, 'verified'); assert.equal(selected.action, 'read'); assert.equal(selected.draft, null);
  assert.equal(adapter.getSnapshot().canRetain, true); assert.equal(rows().length, 0);
  assert(render(multi.selection, adapter).includes('Retain local draft'));
  function exact(draft, pack, original) {
    assert.deepEqual(draft.manifest, { bytes: pack.baseline.manifest, sha256: hash(pack.baseline.manifest) });
    assert.deepEqual(draft.original, { bytes: original.bytes, sha256: hash(original.bytes), revision: original.token });
    assert.equal(draft.original.bytes.byteLength, original.bytes.byteLength);
    assert.equal(draft.nativeAuthority, 'not-established'); assert.equal(draft.currentBase, 'not-checked');
    assert.deepEqual(draft.selectedResource, pack.baseline.resources.find(pin => pin.sha256 === pack.aggregateHash));
  }
  const retained = await adapter.retain();
  assert.equal(retained.completion, 'verified'); assert.equal(retained.action, 'retain'); exact(retained.draft, multi, multi.included[0]);
  assert.notEqual(retained.draft.original.sha256, retained.draft.selectedResource.sha256);
  assert.equal(adapter.getSnapshot().canRetain, false);
  const html = render(multi.selection, adapter);
  for (const label of ['Local proposal JSON', 'Retained original JSON', 'not established', 'Current base not checked', 'Retain local draft']) assert(html.includes(label));
  assert(!html.includes('<a '));
  const proposal = '{\n "proposed":"Local only 🧭", "revision":1E+0\n}\n';
  const proposed = await adapter.saveProposal(proposal); exact(proposed.draft, multi, multi.included[0]);
  assert.deepEqual(proposed.draft.proposal.bytes, encode(proposal));
  new Uint8Array(proposed.draft.original.bytes).fill(0); new Uint8Array(proposed.draft.manifest.bytes).fill(0);
  assert.equal(adapter.getSnapshot().detail.originalText, decode(multi.included[0].bytes));
  // Retain every valid included member serially, including the 1 MiB boundary.
  for (const candidate of adapter.getSnapshot().candidates.slice(1)) {
    await adapter.chooseCandidate(candidate.key);
    const result = await adapter.retain(); assert.equal(result.completion, 'verified');
    exact(result.draft, multi, multi.included.find(row => row.value.recordId === candidate.recordId));
  }
  const seed = clone(retained.draft); delete seed.localPartitionId; delete seed.nativeAuthority; delete seed.currentBase; delete seed.proposal;
  await otherStore.retain(seed);
  const unrelated = { ...clone(seed), snapshotId: 'a'.repeat(64), localRevision: id(0xc30) };
  await store.retain(unrelated);
  const beforeReopen = rows(); stop(); adapter.dispose(); await store.close();
  store = h.createLocalEditRetentionStore(partition, factory());
  adapter = h.createSavedLocalEditAdapter(multi.selection, partition, store);
  await adapter.list(); assert.equal(adapter.getSnapshot().summaries.length, 4);
  const key = adapter.getSnapshot().summaries.find(row => row.recordId === multi.included[0].value.recordId).key;
  const opened = await adapter.open(key); exact(opened.draft, multi, multi.included[0]);
  assert.deepEqual(opened.draft.proposal.bytes, encode(proposal)); assert.deepEqual(rows(), beforeReopen);
  await adapter.readCandidates();
  const beforeChoice = rows(); await adapter.chooseCandidate(firstKey);
  assert.equal(adapter.getSnapshot().canRetain, false, 'Existing draft opens; retention cannot overwrite it');
  assert.deepEqual(rows(), beforeChoice);
  const reset = await adapter.resetProposal(); exact(reset.draft, multi, multi.included[0]); assert.equal(reset.draft.proposal, null);
  assert.equal((await adapter.read()).completion, 'verified');
  const beforeDiscard = rows(), target = beforeDiscard.find(row => row.draft.localPartitionId === partition
    && row.draft.snapshotId === multi.house.snapshotId && row.draft.recordIdentity.recordId === multi.included[0].value.recordId);
  const discarded = await adapter.discard(); assert.equal(discarded.completion, 'verified'); assert.equal(discarded.discarded, true);
  assert.deepEqual(rows(), beforeDiscard.filter(row => row.id !== target.id));
  assert.equal(adapter.getSnapshot().canRetain, false, 'Discard never automatically re-enables retention');
  adapter.dispose();
  adapter = h.createSavedLocalEditAdapter(single.selection, partition, store);
  await adapter.readCandidates(); assert.equal(adapter.getSnapshot().candidates.length, 1);
  const candidate = adapter.getSnapshot().candidates[0]; assert.equal(candidate.sha256, candidate.resourceSha256);
  await adapter.chooseCandidate(candidate.key);
  const singleResult = await adapter.retain(); assert.equal(singleResult.completion, 'verified'); exact(singleResult.draft, single, single.included[0]);
  adapter.dispose();
  adapter = h.createSavedLocalEditAdapter(omissionsOnly.selection, partition, store);
  const beforeOmissions = rows(); await adapter.readCandidates();
  assert.equal(adapter.getSnapshot().candidateStatus, 'ready'); assert.deepEqual(adapter.getSnapshot().candidates, []);
  assert.equal(adapter.getSnapshot().canRetain, false); assert.deepEqual(rows(), beforeOmissions);
  assert.equal(omissionsOnly.aggregateHash, null);
  assert(!omissionsOnly.reads.some(value => omissionsOnly.house.resources.find(pin => pin.id === value)?.role === 'atlas/original'));
  for (const pack of [multi, single, omissionsOnly]) {
    assert.deepEqual(pack.house, pack.baseline);
    assert.deepEqual([...pack.resources], pack.payloads, 'All saved originals and unrelated resource bodies stay immutable');
  }
  assert.deepEqual([...disk.databases.keys()], [h.LOCAL_EDIT_RETENTION_DATABASE]);
  assert(transactions.length <= 80 && transactions.every(tx => tx.completed));
  console.log('PASS generated serial multi/single aggregate, exact lexical revisions, owned original/manifest bytes, independent member/resource pins, complete membership and omissions');
  console.log('PASS explicit choose/read/retain, proposal, reopen, reset and targeted discard; unrelated rows/partition and immutable saved resources preserved; actual panel SSR');
  console.log('Healthy source/simulated-storage evidence only. No negative, fault, reentrant/retirement, browser/device, native authority, current-base or submission qualification.');
} finally {
  adapter?.dispose(); await store?.close(); await otherStore?.close();
  rmSync(scratch, { recursive: true, force: true }); clearTimeout(deadline);
}
