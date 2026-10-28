// Deterministic checked-in browser resources from the retained pinned authority.
// No compiler, subprocess, network, validation run or household input.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { schemaSubset } from './subset.mjs';

const repository = new URL('../../', import.meta.url);
const read = path => readFileSync(new URL(path, repository), 'utf8');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const json = value => JSON.stringify(value) + '\n';
const agentPath = 'contracts/stock-wire3/agent/agent.schema.json';
const atlasPath = 'packages/contracts/schemas/atlas.schema.json';
const catalogPath = 'contracts/stock-wire3/agent/operation-catalog.json';
const familyPath = 'contracts/stock-wire3/agent/tool-families.json';
const pinnedPath = 'contracts/stock-wire4/pinned-homebox-file.v4.schema.json';
const directory = 'contracts/client-schemas/';

export function clientSchemaOutputs() {
  const adoption = JSON.parse(read('contracts/stock-wire3/adoption-manifest.json'));
  const pinnedAdoption = JSON.parse(read('contracts/stock-wire4/adoption-manifest.json'));
  const sources = [agentPath, atlasPath, catalogPath, familyPath, pinnedPath].map(path => {
    const bytes = read(path), sha256 = hash(bytes);
    const pin = [...adoption.files, adoption.frozenAtlasSchema, ...pinnedAdoption.resources].find(row => row.path === path);
    assert.equal(sha256, pin?.sha256, `Changed authoritative input: ${path}`);
    return { path, sha256, bytes: Buffer.byteLength(bytes) };
  });
  const agent = JSON.parse(read(agentPath)), atlas = JSON.parse(read(atlasPath));
  const catalog = JSON.parse(read(catalogPath)), families = JSON.parse(read(familyPath));
  const pinned = JSON.parse(read(pinnedPath));
  const ref = name => `${agent.$id}#/$defs/${name}`;
  // Stock families accept any current host admission, including child-only arms.
  // Never infer a smaller schema from today's configured/supported host commands.
  const ajvRoots = [ref('stockError'), ref('contextSelection'),
    ...catalog.commands.flatMap(row => [agent.$id + row.inputSchema, agent.$id + row.outputSchema]),
    ...families.families.map(row => agent.$id + row.inputSchema),
    ...['scope', 'sourceRef', 'guard', 'recordRef', 'license', 'location-semanticsRecord'].map(name => `${atlas.$id}#/$defs/${name}`),
    ...['request_homebox_file_download_v4', 'result_homebox_file_capture_v4'].map(name => `${pinned.$id}#/$defs/${name}`)];
  // Read the closed evaluator's actual maps rather than maintain a second list.
  const evaluator = read('frontend/src/numeric/schema-validator.ts');
  const exactRoots = [];
  for (const name of ['roots', 'mutationRoots', 'nativeRequests', 'nativeReads', 'nativeEvidenceShapes']) {
    const start = evaluator.indexOf(`const ${name}`), tail = evaluator.slice(start);
    assert(start >= 0, `Missing evaluator map: ${name}`);
    const end = tail.search(/\n\}(?:\);|;)/);
    assert(end > 0, `Unrecognized evaluator map: ${name}`);
    const values = [...tail.slice(0, end).matchAll(/:\s*['"]([^'"]+)['"]/g)].map(match => match[1]);
    assert(values.length > 0, `Empty evaluator map: ${name}`);
    exactRoots.push(...values.map(value => name === 'nativeEvidenceShapes'
      ? `${atlas.$id}#/$defs/${value}` : value.startsWith('#') ? agent.$id + value : ref(value)));
  }
  const ajv = schemaSubset([agent, atlas, pinned], ajvRoots)[0];
  const exact = schemaSubset([agent, atlas], exactRoots)[0];
  // Every number in the closed evaluator's source schemas is an exact safe
  // integer; refuse any future change that JSON.parse/stringify could round.
  function safeNumbers(value) {
    if (typeof value === 'number') assert(Number.isSafeInteger(value), 'Unsafe exact schema number');
    else if (value && typeof value === 'object') Object.values(value).forEach(safeNumbers);
  }
  safeNumbers(exact);
  const fields = ['commandId', 'authority', 'effect', 'inputSchema', 'outputSchema', 'confirmation', 'toolFamily'];
  const projectedCatalog = { ...Object.fromEntries(Object.entries(catalog).filter(([key]) => key !== 'commands')),
    commands: catalog.commands.map(row => Object.fromEntries(fields.map(key => {
      assert(Object.hasOwn(row, key), `Missing consumed catalog field: ${key}`); return [key, row[key]];
    }))) };
  const outputs = new Map([
    ['agent-ajv.schema.json', json(ajv)],
    ['agent-exact.schema.json', json(exact)],
    ['agent-exact-pin.json', json(hash(json(exact)))],
    ['operation-catalog.json', json(projectedCatalog)],
  ]);
  const pins = { format: 'houseatlas-client-schema-subset/1', generator: 'tools/client-schemas/generate.mjs', sources,
    roots: { ajv: [...new Set(ajvRoots)].sort(), exact: [...new Set(exactRoots)].sort() }, catalogFields: fields,
    outputs: Object.fromEntries([...outputs].map(([path, bytes]) => [path, { sha256: hash(bytes), bytes: Buffer.byteLength(bytes) }])) };
  outputs.set('pins.json', JSON.stringify(pins, null, 2) + '\n');
  return new Map([...outputs].map(([path, bytes]) => [directory + path, bytes]));
}

export function generateClientSchemas({ check = false } = {}) {
  const outputs = clientSchemaOutputs();
  for (const [path, bytes] of outputs) {
    if (check) assert.equal(read(path), bytes, `${path} differs; run node tools/client-schemas/generate.mjs`);
    else {
      const target = new URL(path, repository);
      mkdirSync(new URL('./', target), { recursive: true });
      writeFileSync(target, bytes);
    }
  }
  return outputs;
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  assert(process.argv.slice(2).every(arg => arg === '--check'), 'Usage: generate.mjs [--check]');
  const outputs = generateClientSchemas({ check: process.argv.includes('--check') });
  console.log(`Client schema generation ${process.argv.includes('--check') ? 'matches' : 'wrote'} ${outputs.size} deterministic artifacts`);
}
