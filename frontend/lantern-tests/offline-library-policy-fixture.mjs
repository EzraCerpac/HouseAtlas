import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import vm from 'node:vm';
import { loadNumericSource } from './load-numeric-source.mjs';

export async function checkOfflineLibraryPolicy() {
  const code = stripTypeScriptTypes(readFileSync(new URL('../integration/offline-library-policy.ts', import.meta.url), 'utf8'));
  const { fillOfflineLibrary } = await import('data:text/javascript;base64,' + Buffer.from(code).toString('base64'));
  function fixture() {
    const calls = [], docs = [{ documentId: 'held', documentRevision: 1, lifecycle: 'active', bytes: 10, recordedAvailability: 'available' },
      { documentId: 'new', documentRevision: 2, lifecycle: 'active', bytes: 20, recordedAvailability: 'available' },
      { documentId: 'unavailable', documentRevision: 1, lifecycle: 'active', bytes: 30, recordedAvailability: 'unavailable' }];
    let revision = 'initial';
    const owner = { retainCatalog: async () => ({ status: 'ok', value: { documents: docs } }),
      storage: { status: async () => ({ status: 'ok', value: { budgetBytes: 100 } }) },
      read: { readElectricalCatalog: async () => ({ status: 'missing' }), readLast: async () => ({ status: 'ok', value: { handle: {}, snapshot: { snapshotRevision: revision } } }),
        documentStatus: async (_copy, row) => ({ status: 'ok', value: { availability: row.documentId === 'held' ? 'held' : 'not-held' } }) },
      retainDocument: async (id, rev) => { calls.push([id, rev]); return { status: 'ok' }; } };
    return { owner, docs, calls, replace() { revision = 'replaced'; } };
  }
  const cases = [], signal = () => new AbortController().signal;
  {
    const { owner, calls } = fixture();
    assert.equal(await fillOfflineLibrary(owner, signal()), '2 files on this device; 1 unavailable.');
    assert.deepEqual(calls, [['new', 2]]);
    cases.push('offline-library-policy-held-skip-and-exact-revision');
  }
  {
    const { owner, docs, calls } = fixture(); docs[1].bytes = 100;
    assert.match(await fillOfflineLibrary(owner, signal()), /exceed/); assert.deepEqual(calls, []);
    cases.push('offline-library-policy-budget-before-byte-reads');
    const mixed = fixture();
    mixed.owner.read.readElectricalCatalog = async () => ({ status: 'ok', value: { buildings: [{ documents: [{ pin: { byteSize: '30' } }] }] } });
    assert.match(await fillOfflineLibrary(mixed.owner, signal()), /exceed/);
    assert.deepEqual(mixed.calls, [], 'native 60 + electrical 30 refuses an 80-byte automatic limit before eviction');
    mixed.owner.read.readElectricalCatalog = async () => ({ status: 'unavailable' });
    assert.match(await fillOfflineLibrary(mixed.owner, signal()), /sizes could not be checked/);
    assert.deepEqual(mixed.calls, [], 'unknown electrical size does not admit native byte reads');

  }
  {
    const { owner, docs, calls } = fixture(); docs[0].documentId = 'first'; docs[2].recordedAvailability = 'available';
    owner.retainDocument = async id => { calls.push(id); return { status: 'uncertain' }; };
    let stopped = 0;
    assert.match(await fillOfflineLibrary(owner, signal(), () => true, () => { stopped++; }), /uncertain/); assert.deepEqual(calls, ['first']);
    assert.equal(stopped, 1, 'composed source scheduling stops after uncertain storage');
    cases.push('offline-library-policy-uncertain-stops-without-retry');
  }
  {
    const { owner, calls } = fixture(); let enabled = true;
    owner.read.documentStatus = async () => { enabled = false; return { status: 'ok', value: { availability: 'not-held' } }; };
    assert.match(await fillOfflineLibrary(owner, signal(), () => enabled), /stopped/); assert.deepEqual(calls, []);
    cases.push('offline-library-policy-preference-off-before-next-download');
  }
  {
    const { owner, calls, replace } = fixture(); let reads = 0;
    const read = owner.read.readLast;
    owner.read.readLast = async () => { if (++reads === 2) replace(); return read(); };
    assert.match(await fillOfflineLibrary(owner, signal()), /changed/); assert.deepEqual(calls, []);
    cases.push('offline-library-policy-snapshot-replacement-stops');
  }
  {
    for (const blocked of ['catalog', 'snapshot', 'storage', 'electrical', 'budget', 'document']) {
      const f = fixture(); let stopped = 0;
      if (blocked === 'catalog') f.owner.retainCatalog = async () => ({ status: 'unavailable' });
      if (blocked === 'snapshot') f.owner.read.readLast = async () => ({ status: 'unavailable' });
      if (blocked === 'storage') f.owner.storage.status = async () => ({ status: 'unavailable' });
      if (blocked === 'electrical') f.owner.read.readElectricalCatalog = async () => ({ status: 'unavailable' });
      if (blocked === 'budget') f.owner.storage.status = async () => ({ status: 'ok', value: { budgetBytes: 1 } });
      if (blocked === 'document') {
        f.docs.splice(0, f.docs.length, f.docs[1]); // Only this failed available original can stop the pass.
        f.owner.retainDocument = async () => ({ status: 'unavailable' });
      }
      await fillOfflineLibrary(f.owner, signal(), () => true, () => { stopped++; });
      assert.equal(stopped, 1, blocked);
    }
    cases.push('offline-native-incomplete-pass-reports-stop-to-source-composition');
  }
  const model = await loadNumericSource('lantern/topology/model.ts');
  const electricalCode = stripTypeScriptTypes(readFileSync(new URL('../integration/offline-electrical-policy.ts', import.meta.url), 'utf8'))
    .replace("'../src/lantern/topology/model'", JSON.stringify(model));
  const { fillOfflineElectricalLibraries } = await import('data:text/javascript;base64,' + Buffer.from(electricalCode).toString('base64'));
  function electricalFixture(reason = 'no-current-association') {
    const calls = [], binding = {}, identity = {}, buildingId = '00000000-0000-4000-8000-000000000003';
    let live = true, sameReader = true, retirement = 'ok';
    const records = {
      identity: [{ lifecycle: 'active', target: { recordId: buildingId }, payload: { kind: 'location' } }], binding: [], relation: [],
      'location-semantics': [{ lifecycle: 'active', target: { recordId: 'generated-semantics' },
        payload: { atlasId: buildingId, reviewStatus: 'accepted', semanticKind: 'building', label: 'Generated building' } }],
    };
    const options = { signal: signal(), current: () => live, enabled: () => true,
      view: { scope: { workspaceId: 'generated-workspace', homeId: 'generated-home' }, entries: [] },
      topology: { getBinding: () => binding, listAll: async (_binding, kind) => ({ status: 'ready', snapshotSha256: 'a'.repeat(64), records: records[kind] }) },
      port: { createReader: async () => ({ owner: () => sameReader ? identity : null,
        read: async () => ({ status: 'unavailable', reason }), dispose() {}, release() { assert.fail('absence has no available frame'); } }) },
      owner: { retainElectricalLibrary() { assert.fail('absence must not retain an invented frame'); },
        async retireElectricalLibrary(id, selected, current) { assert.equal(id, buildingId); assert.equal(selected, options.signal);
          assert(current()); calls.push(id); return { status: retirement }; } },
    };
    return { options, calls, retire: value => { retirement = value; }, invalidateReader: () => { sameReader = false; }, stop: () => { live = false; } };
  }
  {
    const f = electricalFixture();
    assert.equal((await fillOfflineElectricalLibraries(f.options)).complete, true); assert.equal(f.calls.length, 1);
    const unavailable = electricalFixture('current-source-unavailable');
    assert.equal((await fillOfflineElectricalLibraries(unavailable.options)).complete, false); assert.equal(unavailable.calls.length, 0);
    cases.push('offline-electrical-confirmed-absence-only-retires-membership');
  }
  {
    const f = electricalFixture(); f.retire('uncertain');
    assert.equal((await fillOfflineElectricalLibraries(f.options)).complete, false); assert.equal(f.calls.length, 1);
    const changed = electricalFixture();
    const createReader = changed.options.port.createReader;
    changed.options.port.createReader = async () => { const reader = await createReader(); const read = reader.read;
      reader.read = async () => { const result = await read(); changed.invalidateReader(); return result; }; return reader; };
    assert.equal((await fillOfflineElectricalLibraries(changed.options)).complete, false); assert.equal(changed.calls.length, 0);
    cases.push('offline-electrical-uncertain-or-retired-absence-stops-composition');
  }
  // Execute the exact private root function body with generated lazy modules and
  // owner allocations. Only dynamic module resolution is replaced; no UI/HTTP.
  const rootSource = readFileSync(new URL('../integration/main.tsx', import.meta.url), 'utf8');
  const start = rootSource.indexOf('async function fillDeviceLibrary('), end = rootSource.indexOf('function LiveOfflineSettings()', start);
  assert(start >= 0 && end > start);
  const fillCode = stripTypeScriptTypes(rootSource.slice(start, end))
    .replace(/import\('([^']+)'\)/g, (_all, name) => `loadPolicy(${JSON.stringify(name)})`);
  for (const outcome of ['incomplete', 'uncertain', 'view-replaced', 'aborted', 'disabled', 'catalog-unavailable', 'native-unavailable', 'complete']) {
    const session = {}, view = {}; let enabled = true, homebox = 0, electricalPasses = 0;
    const controller = new AbortController();
    const context = { currentSession: session, currentReadyView: view, topology: {}, sourceElectricalLibrary: {}, pinnedFiles: {},
      loadPolicy: async name => name === './offline-library-policy' ? { fillOfflineLibrary: async (_owner, _signal, _enabled, stop) => { if (outcome === 'native-unavailable') stop(); return 'Native result.'; } }
        : name === './offline-homebox-policy' ? { fillOfflineHomeboxOriginals: async () => { homebox++; return { message: 'HomeBox complete.' }; } }
          : { fillOfflineElectricalLibraries: async () => {
            if (++electricalPasses === 1) return { complete: true, message: 'Measured.' };
            if (outcome === 'view-replaced') context.currentReadyView = {};
            if (outcome === 'aborted') controller.abort(); if (outcome === 'disabled') enabled = false;
            return { complete: !['incomplete', 'uncertain'].includes(outcome), message: 'Electrical result.' };
          } },
    };
    const fill = vm.runInNewContext(fillCode + '\nfillDeviceLibrary', context);
    await fill({ retainCatalog: async () => ({ status: outcome === 'catalog-unavailable' ? 'unavailable' : 'ok' }) }, controller.signal, () => enabled);
    assert.equal(homebox, outcome === 'complete' ? 1 : 0, outcome);
  }
  cases.push('offline-root-homebox-follows-only-complete-native-electrical-current-enabled-pass');
  return cases;
}
