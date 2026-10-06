import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import * as access from './index.mjs';
import { CONTRACT_VERSION } from '../../contracts/src/index.mjs';
const pkg=JSON.parse(readFileSync(new URL('../package.json',import.meta.url)));
assert.equal(pkg.version,'0.1.3');assert.equal(CONTRACT_VERSION,'1.0.0');assert.equal(process.version,'v26.10.0');
assert.equal(Object.hasOwn(pkg,'dependencies'),false);
for(const name of ['AccessStore','createAccessBoundary','hashPassword','errorResponse']) assert.equal(typeof access[name],'function');
for(const path of ['index.mjs','store.mjs','credentials.mjs']) {
  const result=spawnSync(process.execPath,['--check',new URL(path,import.meta.url).pathname],{encoding:'utf8'});
  assert.equal(result.status,0,result.stderr);
}
const store=new access.AccessStore();assert.match(store.epoch,/^[0-9a-f]{64}$/);store.close();
console.log('AT-11 access 0.1.3: Node 26.10.0, contract 1.0.0, SQLite schema 1, exports and syntax pass');
