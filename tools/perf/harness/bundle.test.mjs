import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import test from 'node:test';
import { childEnvironment, inspectBundle } from './bundle.mjs';
import { fixtureFacts, fixtures } from './fixtures.mjs';

test('bundle measures deduplicated eager JS and excludes lazy/CSS from startup', t => {
  const root = mkdtempSync(join(tmpdir(),'houseatlas-perf-bundle-unit-')); t.after(() => rmSync(root,{recursive:true,force:true}));
  mkdirSync(join(root,'assets'));
  const a = 'export const a=1;', b = 'export const b=2;';
  writeFileSync(join(root,'assets/a.js'),a); writeFileSync(join(root,'assets/b.js'),b);
  writeFileSync(join(root,'assets/lazy.js'),'x'.repeat(1000)); writeFileSync(join(root,'assets/main.css'),'x'.repeat(2000));
  writeFileSync(join(root,'index.html'),'<script type="module" src="/assets/a.js"></script><link rel="modulepreload" href="./assets/b.js"><link rel="modulepreload" href="/assets/b.js"><link rel="stylesheet" href="/assets/main.css">');
  const result = inspectBundle(root);
  assert.equal(result.bytes,Buffer.byteLength(a+b)); assert.equal(result.gzip,gzipSync(a).length+gzipSync(b).length);
  assert.equal(result.largest,2000); assert.deepEqual(result.startup,['assets/a.js','assets/b.js']);
});

test('child execution environment excludes credentials, browser paths and caller Node options', () => {
  const env = childEnvironment('/tmp/synthetic');
  assert.deepEqual(Object.keys(env).sort(),['LANG','NODE_ENV','NO_COLOR','PATH','TMPDIR','TZ']);
  assert.equal(env.NODE_ENV,'production'); assert.equal(env.TMPDIR,'/tmp/synthetic');
});

test('fixtures have stable byte hashes and the generated GLB declares its actual size', () => {
  const first = fixtures(), second = fixtures(); assert.deepEqual(fixtureFacts(first),fixtureFacts(second));
  const bytes = first[1].bytes, view = new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
  assert.equal(view.getUint32(0,true),0x46546c67); assert.equal(view.getUint32(8,true),bytes.byteLength);
  assert.equal(JSON.parse(new TextDecoder().decode(bytes.subarray(20,20+view.getUint32(12,true)))).nodes.length,1000);
});
