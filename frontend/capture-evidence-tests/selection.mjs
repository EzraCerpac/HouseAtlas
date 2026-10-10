// Exact browser-selection source, synthetic File bodies and no transport.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { transformWithOxc } from '../node_modules/vite/dist/node/index.js';
const url = code => `data:text/javascript;base64,${Buffer.from(code).toString('base64')}`;
const typesPath = new URL('../src/capture-evidence/types.ts', import.meta.url);
const types = url((await transformWithOxc(readFileSync(typesPath, 'utf8'), typesPath.pathname)).code);
const source = new URL('../src/capture-evidence/selection.ts', import.meta.url);
const compiled = (await transformWithOxc(readFileSync(source, 'utf8'), source.pathname)).code.replaceAll('"./types"', JSON.stringify(types));
const { selectEvidenceFile, CAPTURE_MAX_BYTES } = await import(url(compiled));
const policy = { maximumBytes: CAPTURE_MAX_BYTES, contentTypes: ['image/jpeg', 'image/png', 'application/pdf', 'text/plain'] };
const bytes = name => readFileSync(new URL(`fixtures/${name}`, import.meta.url));
const sha = value => createHash('sha256').update(value).digest('hex');
const select = file => selectEvidenceFile(file, 'file-picker', policy, new AbortController().signal, '2026-10-10T12:00:00.000Z');
const args = process.argv.slice(2);
if (!args.length) {
  for (const [name, type] of [['synthetic-photo.jpg', 'image/jpeg'], ['synthetic-photo-progressive.jpg', 'image/jpeg'], ['synthetic-image.png', 'image/png'], ['synthetic-document.pdf', 'application/pdf'], ['synthetic-note.txt', 'text/plain']]) {
    const input = bytes(name), original = new File([input], name, { type });
    const result = await select(original);
    assert.equal(result.original, original); assert.equal(result.file, original);
    assert.equal(sha(new Uint8Array(await result.file.arrayBuffer())), sha(input));
    assert.equal(result.capture.filename, name); assert.equal(result.capture.reportedContentType, type);
    assert.equal(result.capture.byteOrigin, 'browser-returned-unmodified');
  }
  for (const type of ['', 'application/octet-stream', 'image/jpg']) {
    const original = new File([bytes('synthetic-photo.jpg')], 'synthetic-photo.jpg', { type, lastModified: 42 });
    const result = await select(original);
    assert.equal(result.file.type, 'image/jpeg'); assert.equal(result.original, original);
    assert.equal(result.file.lastModified, original.lastModified);
    assert.equal(result.capture.reportedContentType, type);
    assert.equal(sha(new Uint8Array(await result.file.arrayBuffer())), sha(new Uint8Array(await original.arrayBuffer())));
  }
  for (const type of ['', 'application/octet-stream']) {
    const original = new File([bytes('synthetic-note.txt')], 'synthetic-note.txt', { type });
    const result = await select(original);
    assert.equal(result.file.type, 'text/plain'); assert.equal(result.original, original);
    assert.equal(result.capture.reportedContentType, type);
    assert.equal(sha(new Uint8Array(await result.file.arrayBuffer())), sha(new Uint8Array(await original.arrayBuffer())));
  }
  console.log('PASS healthy: five supported synthetic files; byte-identical MIME-label normalization, original browser labels retained');
} else {
  assert.equal(args.length, 2); assert.equal(args[0], '--case');
  switch (args[1]) {
    case 'reject-heic': {
      const heif = new Uint8Array([0,0,0,24,102,116,121,112,104,101,105,99]);
      await assert.rejects(select(new File([heif], 'synthetic.heic', { type: 'image/heic' })), /HEIC/);
      await assert.rejects(select(new File([heif], 'synthetic.jpg', { type: 'image/jpeg' })), /HEIC/); break;
    }
    case 'reject-conflicting-mime':
      await assert.rejects(select(new File([bytes('synthetic-image.png')], 'synthetic.png', { type: 'image/jpeg' })), /do not match/); break;
    case 'reject-malformed-text':
      await assert.rejects(select(new File([new Uint8Array([255])], 'synthetic.txt', { type: 'text/plain' })), /UTF-8/); break;
    case 'reject-oversized-file':
      await assert.rejects(select(new File([new Uint8Array(CAPTURE_MAX_BYTES + 1)], 'synthetic.txt', { type: 'text/plain' })), /exceeds/); break;
    case 'reject-empty-file':
      await assert.rejects(select(new File([], 'empty.txt', { type: 'text/plain' })), /containing/); break;
    case 'selection-abort': {
      const controller = new AbortController(); controller.abort();
      await assert.rejects(selectEvidenceFile(new File([bytes('synthetic-photo.jpg')], 'synthetic.jpg', { type: 'image/jpeg' }), 'photo-picker', policy, controller.signal)); break;
    }
    default: throw new Error('Unlisted regression case');
  }
  console.log(`PASS exact bounded synthetic regression ${args[1]}`);
}
