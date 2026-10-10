/** Offline Node bridge for the exact browser source modules used by these fixtures. */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { transformWithOxc } from 'vite';

const source = (path) => new URL(path.startsWith('integration/') ? `../${path}` : `../src/${path}`, import.meta.url);
const dataUrl = (code) => `data:text/javascript;base64,${Buffer.from(code).toString('base64')}`;
const rawSchema = (path) => dataUrl(`export default ${JSON.stringify(readFileSync(new URL(path, import.meta.url), 'utf8'))};`);
const jsonSchema = (path) => dataUrl(`export default ${JSON.stringify(JSON.parse(readFileSync(new URL(path, import.meta.url), 'utf8')))};`);
const agentSchema = rawSchema('../../contracts/stock-wire3/agent/agent.schema.json');
const atlasSchema = rawSchema('../../packages/contracts/schemas/atlas.schema.json');
const agentJson = jsonSchema('../../contracts/stock-wire3/agent/agent.schema.json');
const atlasJson = jsonSchema('../../packages/contracts/schemas/atlas.schema.json');
const pinnedV4Json = jsonSchema('../../contracts/stock-wire4/pinned-homebox-file.v4.schema.json');
const formats = new URL('../node_modules/ajv-formats/dist/formats.js', import.meta.url).href;
const ajv = new URL('../node_modules/ajv/dist/2020.js', import.meta.url).href;
const addFormats = new URL('../node_modules/ajv-formats/dist/index.js', import.meta.url).href;
const links = Object.freeze({
  'numeric/decimal.ts': {},
  'numeric/lossless-json.ts': { './decimal': 'numeric/decimal.ts' },
  'numeric/schema-validator.ts': {
    './decimal': 'numeric/decimal.ts',
    'ajv-formats/dist/formats.js': formats,
    '../../../contracts/stock-wire3/agent/agent.schema.json?raw': agentSchema,
    '../../../packages/contracts/schemas/atlas.schema.json?raw': atlasSchema,
  },
  'numeric/stock-decoded.ts': {
    './decimal': 'numeric/decimal.ts', './schema-validator': 'numeric/schema-validator.ts',
  },
  'api/geometry-client.ts': {
    '../numeric/lossless-json': 'numeric/lossless-json.ts',
    '../numeric/schema-validator': 'numeric/schema-validator.ts',
    '../numeric/stock-decoded': 'numeric/stock-decoded.ts',
  },
  'api/evidence-client.ts': {
    'ajv/dist/2020.js': ajv, 'ajv-formats': addFormats,
    '../numeric/lossless-json': 'numeric/lossless-json.ts',
    '../numeric/schema-validator': 'numeric/schema-validator.ts',
    '../numeric/stock-decoded': 'numeric/stock-decoded.ts',
  },
  'api/topology-client.ts': {
    '../numeric/lossless-json': 'numeric/lossless-json.ts',
    '../numeric/schema-validator': 'numeric/schema-validator.ts',
    '../numeric/stock-decoded': 'numeric/stock-decoded.ts',
  },
  'api/network-relations-client.ts': {
    '../numeric/decimal': 'numeric/decimal.ts',
    '../numeric/lossless-json': 'numeric/lossless-json.ts',
  },
  'ai/wire.ts': {},
  'ai/types.ts': {},
  'ai/host/decode.ts': {
    '../wire.js': 'ai/wire.ts', '../../numeric/decimal': 'numeric/decimal.ts',
  },
  'ai/host/client.ts': {
    '../wire.js': 'ai/wire.ts', '../types.js': 'ai/types.ts', './decode.js': 'ai/host/decode.ts',
    '../../numeric/lossless-json': 'numeric/lossless-json.ts',
  },
  'lantern/topology/model.ts': {
    '../../numeric/decimal': 'numeric/decimal.ts',
    '../../numeric/lossless-json': 'numeric/lossless-json.ts',
  },
  'lantern/atlas/geometry.ts': {},
  'api/pinned-file-client.ts': {
    'ajv/dist/2020.js': ajv, 'ajv-formats': addFormats,
    '../../../contracts/stock-wire3/agent/agent.schema.json': agentJson,
    '../../../contracts/stock-wire4/pinned-homebox-file.v4.schema.json': pinnedV4Json,
    '../../../packages/contracts/schemas/atlas.schema.json': atlasJson,
  },
  'integration/pinned-file-client.ts': {
    '../src/api/pinned-file-client': 'api/pinned-file-client.ts',
  },
});
const loaded = new Map();

/** Compile only listed actual modules. Rewrite import targets; leave source logic intact. */
export async function loadNumericSource(path) {
  assert(Object.hasOwn(links, path), `Unlisted source module: ${path}`);
  if (loaded.has(path)) return loaded.get(path);
  const file = source(path);
  let { code } = await transformWithOxc(readFileSync(file, 'utf8'), file.pathname,
    { lang: 'ts', target: 'esnext', tsconfig: false, sourcemap: false });
  for (const [specifier, destination] of Object.entries(links[path])) {
    const replacement = destination.startsWith('data:') || destination.startsWith('file:')
      ? destination : await loadNumericSource(destination);
    const literal = JSON.stringify(specifier);
    assert(code.includes(literal), `Missing source import ${specifier} in ${path}`);
    code = code.replaceAll(literal, JSON.stringify(replacement));
  }
  // Every runtime import must be one of the exact replacement targets above.
  for (const match of code.matchAll(/^\s*import\s+(?:[\w$\s{},*]+?\s+from\s+)?["']([^"']+)["']/gm)) {
    assert(match[1].startsWith('data:') || match[1].startsWith('file:'),
      `Unexpected runtime import ${match[1]} in ${path}`);
  }
  const url = dataUrl(code);
  loaded.set(path, url);
  return url;
}
