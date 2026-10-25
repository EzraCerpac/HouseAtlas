// Synthetic schema bytes only. No browser, Access, service dispatch or transport.
// Runs in ordinary CI through run-healthy.mjs.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { build } from 'vite';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';

assert.equal(process.version, 'v26.10.0');
globalThis.fetch = () => { throw new Error('Batch descriptor fixtures forbid external fetch'); };
const fixtures = JSON.parse(readFileSync(new URL('../../fixtures/integration/mcp-batch-discovery.json', import.meta.url)));
assert.equal(fixtures.synthetic, true);
const frontend = fileURLToPath(new URL('../', import.meta.url));
const built = await build({ root: frontend, configFile: false, logLevel: 'silent',
  build: { write: false, target: 'node26',
    lib: { entry: fileURLToPath(new URL('../src/webmcp/stock-schema.ts', import.meta.url)), formats: ['es'] },
    rolldownOptions: { output: { codeSplitting: false } }, minify: false } });
const output = Array.isArray(built) ? built[0] : built;
const code = output.output.find(row => row.type === 'chunk' && row.isEntry).code;
const { stockInputSchema, stockCatalog } = await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`);
const operation = id => {
  const result = stockCatalog.commands.find(command => command.commandId === id);
  assert(result, `Canonical operation exists: ${id}`);
  return result;
};
const batchRef = operation('atlas.batch.execute').inputSchema;
const batchKey = 'agent__request_atlas_batch_execute';
const all = stockCatalog.commands.map(command => command.commandId);
const original = stockInputSchema([batchRef], all);
const canonical = original.$defs[batchKey];
const commands = batch => batch.properties.payload.properties.commands;
assert.equal(commands(canonical).items.oneOf.length, 39);
for (const fixture of fixtures.cases) {
  const refs = fixture.topLevelCommandIds.map(id => operation(id).inputSchema);
  // Top-level refs deliberately contain only the batch for these cases. Full
  // host admission must retain eligible children outside those refs/families.
  const schema = stockInputSchema(refs, fixture.admittedCommandIds);
  const ajv = new Ajv2020({ strict: false });
  addFormats(ajv);
  const validate = ajv.compile(schema); // Includes empty-child descriptor validity.
  if (fixture.expectedChildCommandIds === null) {
    assert.equal(schema.$defs[batchKey], undefined);
    continue;
  }
  const expected = structuredClone(canonical);
  const arms = fixture.expectedChildCommandIds.map(id => ({
    $ref: operation(id).inputSchema.replace('#/$defs/', '#/$defs/agent__'),
  }));
  commands(expected).items = arms.length ? { ...commands(expected).items, oneOf: arms } : false;
  assert.deepEqual(schema.$defs[batchKey], expected, fixture.name);
  assert.equal(schema.$defs.agent__request_atlas_valve_create, undefined);
  for (const count of [0, 1, 100, 101]) {
    const request = structuredClone(fixtures.batch);
    request.payload.commands = Array.from({ length: count }, () => structuredClone(fixtures.child));
    const hasCircuit = fixture.admittedCommandIds.includes('atlas.circuit.create');
    assert.equal(validate(request), hasCircuit && count >= 1 && count <= 100, `${fixture.name}: ${count} children`);
  }
  const request = structuredClone(fixtures.batch);
  request.payload.commands = [structuredClone(fixtures.child)];
  delete request.approvalReceiptId;
  assert.equal(validate(request), false, 'Required null receipt cannot become omission');
}
// No admission argument grants no child support. It never falls back to the
// full 39-arm union, and specialization never mutates the canonical resource.
assert.equal(commands(stockInputSchema([batchRef]).$defs[batchKey]).items, false);
assert.deepEqual(stockInputSchema([batchRef], all), original);
console.log('Synthetic WebMCP batch discovery fixtures: five shared profiles and bounded arrays');
