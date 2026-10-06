import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { AtlasStore, DATABASE_VERSION, MUTATION_AUTHORIZATION_CONTEXT_FORMAT } from './index.mjs';
for (const dir of ['src','test']) for (const name of readdirSync(new URL(`../${dir}/`, import.meta.url)).filter(n => n.endsWith('.mjs'))) {
  const result = spawnSync(process.execPath, ['--check', fileURLToPath(new URL(`../${dir}/${name}`, import.meta.url))], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
}
for(const name of ['index.d.mts','frozen-types.d.ts']) {
  const result=spawnSync(process.execPath,['--check',fileURLToPath(new URL(name,import.meta.url))],{encoding:'utf8'});
  assert.equal(result.status,0,result.stderr);
}
assert.equal(MUTATION_AUTHORIZATION_CONTEXT_FORMAT,'atlas-mutation-authorization-context/1');
const store = new AtlasStore({ path: ':memory:', authorize: () => { throw new Error('No session'); } });
assert.equal(store.databaseVersion, DATABASE_VERSION); store.close();
console.log(`Storage source/declaration syntax, context exports and SQLite schema ${DATABASE_VERSION}: PASS (ordinary build; no tsc)`);
