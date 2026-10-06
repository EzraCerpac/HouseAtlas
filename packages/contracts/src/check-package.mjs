import { readdirSync, readFileSync } from 'node:fs';
import { validateShape, validateSnapshot, validateResult, schema, CONTRACT_VERSION } from './index.mjs';
for (const name of Object.keys(schema.$defs)) validateCompile(name);
function validateCompile(name) {
  // Compile every definition, even when the empty object fails its data shape.
  try { validateShape(name, {}); } catch (e) { if (e.code !== 'invalid-contract') throw e; }
}
for (const file of readdirSync(new URL('../fixtures/', import.meta.url)).filter(f => f.endsWith('.json'))) {
  const value = JSON.parse(readFileSync(new URL(`../fixtures/${file}`, import.meta.url)));
  if (file.endsWith('.snapshot.json')) validateSnapshot(value);
  else if (file.endsWith('.mutation.json')) validateShape('mutation', value);
  else if (file.endsWith('.wire.json')) validateShape('homeboxPageWire', value);
  else if (file.endsWith('.result.json')) validateResult(value);
  else if (file.endsWith('.batch.json')) validateShape('batchMutation', value);
  else throw new Error(`Unknown fixture naming convention: ${file}`);
}
console.log(`HouseAtlas contracts ${CONTRACT_VERSION}: all schemas compile and fixtures validate`);
