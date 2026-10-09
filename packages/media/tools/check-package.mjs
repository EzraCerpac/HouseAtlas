import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { CONTRACT_VERSION } from '../../contracts/src/index.mjs';
import { DATABASE_VERSION } from '../../storage/src/index.mjs';
import { DATABASE_CONTRACT_VERSION } from '../../storage/src/migrations.mjs';
import * as media from '../src/index.mjs';
const packageData=JSON.parse(readFileSync(new URL('../package.json',import.meta.url)));
assert.equal(process.versions.node,'26.10.0');assert.equal(packageData.version,media.MEDIA_VERSION);assert.equal(CONTRACT_VERSION,'1.1.0');assert.equal(DATABASE_CONTRACT_VERSION,'1.0.0');assert.equal(DATABASE_VERSION,3);
assert.deepEqual(Object.keys(media).sort(),['AssetVault','MAX_BYTES','MEDIA_VERSION','MediaError','captureRecovery','createMediaService','restoreRecovery','verifyRecovery'].sort());
for(const directory of ['src','test','tools'])for(const file of readdirSync(new URL(`../${directory}/`,import.meta.url)))if(file.endsWith('.mjs')){const result=spawnSync(process.execPath,['--check',fileURLToPath(new URL(`../${directory}/${file}`,import.meta.url))],{encoding:'utf8'});assert.equal(result.status,0,result.stderr);}
console.log(JSON.stringify({version:media.MEDIA_VERSION,node:process.versions.node,contract:CONTRACT_VERSION,databaseContract:DATABASE_CONTRACT_VERSION,databaseSchema:DATABASE_VERSION,exports:8,dependencies:0,syntax:'pass'}));
