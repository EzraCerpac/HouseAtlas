// AT39 healthy synthetic ports only. No browser, listener, provider or mutation.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { test } from 'node:test';

assert.ok(process.env.HOUSEATLAS_AT39_BUILD, 'Set HOUSEATLAS_AT39_BUILD to the compiled namespace directory');
const compiled = pathToFileURL(`${process.env.HOUSEATLAS_AT39_BUILD}/`);
const { startWebMcp, detectModelContext } = await import(new URL('index.js', compiled));
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

function setup({ sessions = syntheticSession(), result = [], events = [] } = {}) {
  const browser = syntheticBrowser();
  const calls = [];
  const visibleResults = [];
  const handle = startWebMcp({
    modelContext: browser, sessions,
    catalog: { toolsFor() { return [definition]; } },
    service: {
      async execute(name, input, context) {
        events.push('service');
        calls.push({ name, input, context });
        return result;
      },
    },
    visible: {
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
    assert.equal(visibleResults[0].context, calls[0].context);
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
