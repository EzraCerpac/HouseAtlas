// AT39 synthetic adapter and lifecycle ports. No browser, listener, provider or mutation.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { test } from 'node:test';

assert.ok(process.env.HOUSEATLAS_AT39_BUILD, 'Set HOUSEATLAS_AT39_BUILD to the compiled namespace directory');
const compiled = pathToFileURL(`${process.env.HOUSEATLAS_AT39_BUILD}/`);
const { startWebMcp, detectModelContext } = await import(new URL('index.js', compiled));
const { mountQuantityWebMcp, QUANTITY_TOOL_NAME } = await import(new URL('quantity.js', compiled));
const root = new URL('../../../', import.meta.url);
const read = path => JSON.parse(readFileSync(new URL(path, root), 'utf8'));
const require = createRequire(new URL('packages/contracts/package.json', root));
const Ajv2020 = require('ajv/dist/2020.js').default;
const addFormats = require('ajv-formats');
const schema = read('packages/contracts/schemas/atlas.schema.json');
const historySchema = read('packages/contracts/history/http-history.v1.1.0.schema.json');
const contexts = read('packages/contracts/history/fixtures/contexts.json');
const ajv = new Ajv2020({ strict: true, allErrors: true, allowUnionTypes: true });
addFormats(ajv);
const schemaUrl = new URL('packages/contracts/schemas/atlas.schema.json', root).href;
const historyUrl = new URL('packages/contracts/history/http-history.v1.1.0.schema.json', root).href;
ajv.addSchema(schema, schemaUrl);
ajv.addSchema(historySchema, historyUrl);
const validateHistory = ajv.getSchema(historyUrl);
const validateInput = ajv.compile(schema.$defs.recordRef);

// Synthetic catalog peer, NOT the production catalog or authorization policy.
const definition = {
  name: 'read_atlas_record_history',
  title: 'Read record history',
  description: 'Read recorded Atlas changes for the selected scoped record in commit order.',
  inputSchema: schema.$defs.recordRef,
  annotations: { readOnlyHint: true, untrustedContentHint: true, consequentialHint: false },
  parseInput(input) {
    assert.equal(validateInput(input), true, JSON.stringify(validateInput.errors));
    return structuredClone(input);
  },
};

function syntheticSession(initial = { state: 'authenticated', revision: 'synthetic-login-1/home-1' }) {
  let snapshot = initial;
  const listeners = new Set();
  return {
    getSnapshot: () => snapshot,
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    set(next) { snapshot = next; for (const listener of listeners) listener(); },
    get subscriberCount() { return listeners.size; },
  };
}

function syntheticBrowser() {
  return {
    tools: new Map(),
    registrations: [],
    async registerTool(tool, { signal }) {
      this.tools.set(tool.name, tool);
      this.registrations.push({ tool, signal });
      signal.addEventListener('abort', () => {
        if (this.tools.get(tool.name) === tool) this.tools.delete(tool.name);
      }, { once: true });
    },
  };
}

function setup({ sessions = syntheticSession(), result = [], events = [],
  browser = syntheticBrowser(), definitions = [definition], visible } = {}) {
  const calls = [];
  const visibleResults = [];
  const handle = startWebMcp({
    modelContext: browser, sessions,
    catalog: { toolsFor() { return definitions; } },
    service: {
      async execute(name, input, context) {
        events.push('service');
        calls.push({ name, input, context });
        return result;
      },
    },
    visible: visible ?? {
      async apply(name, value, context) {
        // One healthy asynchronous view update; no race/concurrency scenario.
        await Promise.resolve();
        visibleResults.push({ name, value, context });
        events.push('visible');
      },
    },
  });
  return { browser, sessions, handle, calls, visibleResults };
}

test('healthy supported detection preserves the modelContext receiver', async () => {
  const browser = syntheticBrowser();
  assert.equal(detectModelContext({ modelContext: browser }), browser);
  const { handle, browser: active } = setup();
  assert.deepEqual(await handle.whenSettled(), { state: 'registered', toolNames: [definition.name] });
  const tool = active.tools.get(definition.name);
  assert.equal(tool.inputSchema, schema.$defs.recordRef);
  assert.deepEqual(tool.annotations, definition.annotations);
  handle.dispose();
  assert.equal(active.tools.size, 0);
});

for (const fixture of contexts.cases) {
  test(`healthy history transport preserves ${fixture.file}`, async () => {
    const result = read(`packages/contracts/history/fixtures/${fixture.file}`);
    assert.equal(validateHistory(result), true, JSON.stringify(validateHistory.errors));
    const events = [];
    const { browser, handle, calls, visibleResults } = setup({ result, events });
    await handle.whenSettled();
    const signal = new AbortController().signal;
    const output = await browser.tools.get(definition.name).execute(contexts.record, { signal });
    events.push('returned');
    assert.deepEqual(events, ['service', 'visible', 'returned']);
    assert.deepEqual(output, result);
    assert.equal(validateHistory(output), true, JSON.stringify(validateHistory.errors));
    assert.deepEqual(output.map(item => item.operation), fixture.expectedOperations);
    assert.notEqual(output, result);
    assert.deepEqual(calls[0].input, contexts.record);
    assert.equal(calls[0].name, definition.name);
    assert.deepEqual(calls[0].context.session, { state: 'authenticated', revision: 'synthetic-login-1/home-1' });
    assert.equal(calls[0].context.signal.aborted, false);
    assert.equal(visibleResults[0].context.session, calls[0].context.session);
    assert.notEqual(visibleResults[0].context.signal, calls[0].context.signal);
    assert.equal(visibleResults[0].context.signal.aborted, false);
    assert.deepEqual(visibleResults[0].value, result);
    assert.notEqual(visibleResults[0].value, output);
    handle.dispose();
  });
}

test('healthy sequential session selection replaces registration and cleans up', async () => {
  const { browser, sessions, handle } = setup();
  await handle.whenSettled();
  const states = [];
  const unsubscribeStatus = handle.subscribeStatus(() => states.push(handle.getStatus().state));
  const first = browser.registrations[0];
  sessions.set({ state: 'authenticated', revision: 'synthetic-login-1/home-1' });
  await handle.whenSettled();
  assert.equal(browser.registrations.length, 1);
  sessions.set({ state: 'authenticated', revision: 'synthetic-login-1/home-2' });
  await handle.whenSettled();
  assert.equal(first.signal.aborted, true);
  assert.equal(browser.registrations.length, 2);
  assert.equal(browser.tools.size, 1);
  assert.equal(sessions.subscriberCount, 1);
  assert.deepEqual(states, ['registering', 'registered']);
  unsubscribeStatus();
  handle.dispose();
  handle.dispose();
  assert.equal(browser.tools.size, 0);
  assert.equal(sessions.subscriberCount, 0);
  assert.deepEqual(handle.getStatus(), { state: 'disposed' });
});

test('healthy sign-in and sign-out availability uses the session port', async () => {
  const sessions = syntheticSession({ state: 'signed-out', revision: 'synthetic-signed-out-1' });
  const { browser, handle } = setup({ sessions });
  assert.deepEqual(await handle.whenSettled(), { state: 'inactive' });
  assert.equal(browser.registrations.length, 0);
  sessions.set({ state: 'authenticated', revision: 'synthetic-login-2/home-1' });
  assert.deepEqual(await handle.whenSettled(), { state: 'registered', toolNames: [definition.name] });
  sessions.set({ state: 'signed-out', revision: 'synthetic-signed-out-2' });
  assert.deepEqual(await handle.whenSettled(), { state: 'inactive' });
  assert.equal(browser.tools.size, 0);
  handle.dispose();
});

function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}

test('disposal fences a late service result without aborting or repeating owner work', async () => {
  const completion = deferred();
  const { browser, handle, sessions, calls, visibleResults } = setup({ result: completion.promise });
  await handle.whenSettled();
  const retainedTool = browser.tools.get(definition.name);
  const operation = retainedTool.execute(contexts.record);
  const rejected = assert.rejects(operation, { name: 'InvalidStateError' });
  assert.equal(calls.length, 1);
  handle.dispose();
  assert.equal(browser.tools.size, 0);
  assert.equal(sessions.subscriberCount, 0);
  assert.equal(calls[0].context.signal.aborted, false, 'Disposal is not service cancellation');
  completion.resolve([]);
  await rejected;
  assert.equal(visibleResults.length, 0, 'Retired view must never receive the late result');
  await assert.rejects(retainedTool.execute(contexts.record), { name: 'InvalidStateError' });
  assert.equal(calls.length, 1, 'A retained callback must not start new owner work');
});

test('disposal aborts pending presentation and fences wire return even if the view ignores abort', async () => {
  const entered = deferred();
  const acknowledged = deferred();
  let viewContext;
  const { browser, handle, calls } = setup({ visible: {
    async apply(_name, _value, context) {
      viewContext = context;
      entered.resolve();
      // Deliberately ignore abort to exercise the adapter's final release fence.
      await acknowledged.promise;
    },
  } });
  await handle.whenSettled();
  const operation = browser.tools.get(definition.name).execute(contexts.record);
  const rejected = assert.rejects(operation, { name: 'InvalidStateError' });
  await entered.promise;
  assert.equal(viewContext.session, calls[0].context.session);
  handle.dispose();
  assert.equal(viewContext.signal.aborted, true);
  assert.equal(calls[0].context.signal.aborted, false);
  acknowledged.resolve();
  await rejected;
  assert.equal(calls.length, 1);
});

test('session replacement withholds an old result and retains the original invocation identity', async () => {
  const completion = deferred();
  const { browser, handle, sessions, calls, visibleResults } = setup({ result: completion.promise });
  await handle.whenSettled();
  const operation = browser.tools.get(definition.name).execute(contexts.record);
  const rejected = assert.rejects(operation, { name: 'AbortError' });
  sessions.set({ state: 'authenticated', revision: 'synthetic-login-2/home-2' });
  await handle.whenSettled();
  assert.equal(calls[0].context.signal.aborted, true);
  assert.equal(calls[0].context.session.revision, 'synthetic-login-1/home-1');
  completion.resolve([]);
  await rejected;
  assert.equal(visibleResults.length, 0);
  assert.deepEqual(await browser.tools.get(definition.name).execute(contexts.record), []);
  assert.equal(calls.length, 2);
  assert.equal(calls[1].context.session.revision, 'synthetic-login-2/home-2');
  assert.equal(visibleResults.length, 1);
  handle.dispose();
});

test('partial registration cleanup preserves an already underway canonical result', async () => {
  const completion = deferred();
  const browser = syntheticBrowser();
  const register = browser.registerTool.bind(browser);
  let operation;
  browser.registerTool = async (tool, options) => {
    if (tool.name !== definition.name) throw new Error('Synthetic second registration unavailable');
    await register(tool, options);
    operation = tool.execute(contexts.record);
  };
  const { handle, calls, visibleResults } = setup({ browser, result: completion.promise,
    definitions: [definition, { ...definition, name: 'synthetic_second_tool' }] });
  assert.deepEqual(await handle.whenSettled(), {
    state: 'failed', phase: 'registration', toolName: 'synthetic_second_tool',
  });
  assert.equal(browser.tools.size, 0);
  assert.equal(browser.registrations[0].signal.aborted, true);
  assert.equal(calls[0].context.signal.aborted, false);
  completion.resolve([]);
  assert.deepEqual(await operation, []);
  assert.equal(calls.length, 1);
  assert.equal(visibleResults.length, 1, 'Registration cleanup alone must not discard an underway result');
  handle.dispose();
});

test('disposal during input parsing prevents service dispatch', async () => {
  let handle;
  const tool = { ...definition, parseInput(input) {
    handle.dispose();
    return definition.parseInput(input);
  } };
  const mounted = setup({ definitions: [tool] });
  handle = mounted.handle;
  await handle.whenSettled();
  await assert.rejects(mounted.browser.tools.get(definition.name).execute(contexts.record),
    { name: 'InvalidStateError' });
  assert.equal(mounted.calls.length, 0);
  assert.equal(mounted.visibleResults.length, 0);
});

// Actual quantity mount/adapter, with fake preview and handoff owners. These
// examples issue no approval, submission, provider request or native mutation.
function quantityHarness({ holdOffer = false, visible } = {}) {
  const uid = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
  const scope = { workspaceId: uid(1), homeId: uid(2) };
  const source = { ...scope, key: { sourceInstanceId: uid(3), collectionId: uid(4),
    sourceKind: 'homebox-entity', externalId: uid(5) } };
  const bindingIdentity = {};
  const admitted = { revision: 'synthetic-quantity-custody', bindingIdentity, scope, installedSources: [source] };
  const input = { source, quantity: 3, reason: 'Synthetic quantity custody' };
  const prepared = { bindingIdentity, expiresAt: performance.now() + 60000, wire: {
    format: 'atlas-homebox-quantity-preview/1', resolvedScope: scope, source, previewId: uid(9),
    requestDigest: 'a'.repeat(64), planDigest: 'b'.repeat(64),
    request: { schemaVersion: 3, commandId: 'homebox.entity.quantity.set', requestId: uid(8),
      context: scope, target: { authority: 'homebox', sourceInstanceId: uid(3), collectionId: uid(4),
        resourceKind: 'entity', resourceId: uid(5) }, payload: { quantity: 3 },
      idempotencyKey: uid(6), reason: input.reason, approvalReceiptId: uid(10),
      preconditions: { providerObservation: { kind: 'provider-observation', handle: uid(7) }, atlasGuards: [] } },
    observed: { quantity: '2.00', updatedAt: null, retrievedAt: '2026-01-01T00:00:00Z' },
    effect: { quantity: 3, method: 'PATCH', path: `/api/v1/entities/${uid(5)}`, body: { quantity: 3 } },
    policy: { id: 'synthetic-policy', version: '1', epoch: 1, approval: 'human-required', maximumQuantity: 10 },
    assurance: { installedBuild: 'configured-not-runtime-attested', causality: false, atomicCompareAndSet: false },
    lifetime: { remainingMs: 60000 },
  } };
  const ended = { approval: null, ended: { outcome: 'ended-before-submission',
    cause: 'dismissed-by-person', submissionAttempt: 'none-started' } };
  const counts = { reserve: 0, availability: 0, preview: 0, offer: 0, acknowledge: 0, end: 0 };
  const offered = deferred(), completion = deferred();
  const views = [];
  let reserved = false, serviceSignal;
  const browser = syntheticBrowser();
  const handle = mountQuantityWebMcp({ modelContext: browser,
    admission: { getSnapshot: () => admitted, subscribe: () => () => {} },
    facade: {
      getBindingIdentity: () => bindingIdentity, getUncertainty: () => null,
      subscribeSessionBinding: () => () => {}, isCurrentPrepared: value => value === prepared,
      async checkAvailability() { counts.availability++; return { state: 'available' }; },
      async preview() { counts.preview++; return prepared; },
    },
    offers: { reserve() {
      counts.reserve++;
      if (reserved) return null;
      reserved = true;
      return {
        release() { reserved = false; }, hold() { throw new Error('Unexpected synthetic hold'); },
        async offer(value, signal) {
          assert.equal(value, prepared);
          serviceSignal = signal; counts.offer++; offered.resolve();
          return holdOffer ? completion.promise : ended;
        },
        custody: () => ({ prepared, approval: null, native: null }),
        acknowledge() { counts.acknowledge++; reserved = false; },
        end() { counts.end++; },
      };
    } },
    visible: { async apply(...args) {
      views.push({ result: args[1], context: args[2], input: args[3] });
      await visible?.(...args);
    } },
  });
  return { browser, handle, input, prepared, counts, views, offered,
    complete: () => completion.resolve(ended), signal: () => serviceSignal };
}

test('quantity custody survives separate contexts and acknowledges only after the visible commit', async () => {
  const entered = deferred(), committed = deferred();
  const q = quantityHarness({ visible: async () => { entered.resolve(); await committed.promise; } });
  await q.handle.whenSettled();
  const operation = q.browser.tools.get(QUANTITY_TOOL_NAME).execute(q.input);
  await Promise.race([entered.promise, operation.then(() => { throw new Error('Returned before view commit'); })]);
  assert.equal(q.counts.acknowledge, 0);
  assert.notEqual(q.views[0].context.signal, q.signal());
  assert.notEqual(q.views[0].input, q.input, 'Each invocation uses its own parsed object');
  committed.resolve();
  const result = await operation;
  assert.equal(result.outcome, 'person-handoff-ended');
  assert.deepEqual(result.preview, q.prepared.wire);
  assert.equal(result.ended.submissionAttempt, 'none-started');
  assert.equal(q.counts.acknowledge, 1);
  assert.equal(q.counts.end, 0);
  assert.equal(q.counts.preview, 1);
  q.handle.dispose();
});

test('quantity custody stays per invocation for simultaneous identical caller inputs', async () => {
  const q = quantityHarness({ holdOffer: true });
  await q.handle.whenSettled();
  const tool = q.browser.tools.get(QUANTITY_TOOL_NAME);
  const first = tool.execute(q.input);
  await Promise.race([q.offered.promise, first.then(() => { throw new Error('Returned before handoff end'); })]);
  const second = await tool.execute(q.input);
  assert.equal(second.outcome, 'not-prepared');
  assert.equal(second.state, 'handoff-active');
  assert.equal(q.counts.acknowledge, 0, 'Busy result cannot acknowledge the first reservation');
  q.complete();
  assert.equal((await first).outcome, 'person-handoff-ended');
  assert.notEqual(q.views[0].input, q.views[1].input);
  assert.deepEqual(q.views[0].input, q.views[1].input);
  assert.equal(q.counts.reserve, 2);
  assert.equal(q.counts.preview, 1);
  assert.equal(q.counts.offer, 1);
  assert.equal(q.counts.acknowledge, 1);
  assert.equal(q.counts.end, 0);
  q.handle.dispose();
});

test('quantity custody does not acknowledge disposal before or during presentation', async () => {
  for (const duringView of [false, true]) {
    const entered = deferred(), committed = deferred();
    const q = quantityHarness({ holdOffer: true,
      visible: duringView ? async () => { entered.resolve(); await committed.promise; } : undefined });
    await q.handle.whenSettled();
    const operation = q.browser.tools.get(QUANTITY_TOOL_NAME).execute(q.input);
    const rejected = assert.rejects(operation, { name: 'InvalidStateError' });
    await q.offered.promise;
    if (duringView) { q.complete(); await entered.promise; }
    q.handle.dispose();
    assert.equal(q.signal().aborted, false);
    q.complete(); committed.resolve();
    await rejected;
    assert.equal(q.views.length, duringView ? 1 : 0);
    assert.equal(q.counts.end, duringView ? 1 : 0);
    assert.equal(q.counts.acknowledge, 0);
    assert.equal(q.counts.preview, 1);
    assert.equal(q.counts.offer, 1);
  }
});
