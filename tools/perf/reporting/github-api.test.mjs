import assert from 'node:assert/strict';
import test from 'node:test';
import { createGithubApi } from './github-api.mjs';

test('artifact redirect receives no job token; only trusted HTTPS storage hosts are accepted', async () => {
  const calls = [];
  const api = createGithubApi({ token: 'synthetic-token', repository: 'example/HouseAtlas', runAttempt: 1,
    fetchImpl: async (url, options) => { calls.push({ url, options }); return calls.length === 1 ?
      new Response(null, { status: 302, headers: { location: 'https://fixture.blob.core.windows.net/artifact?sig=synthetic' } }) : new Response(Buffer.from('bounded')); } });
  assert.equal((await api.downloadArtifact(9)).toString(), 'bounded');
  assert.equal(calls[0].options.headers.authorization, 'Bearer synthetic-token');
  assert.equal(calls[1].options.headers, undefined);
  for (const location of ['http://fixture.blob.core.windows.net/x', 'https://evil.example/x', 'https://x.blob.core.windows.net.evil.example/x']) {
    const bad = createGithubApi({ token: 'synthetic-token', repository: 'example/HouseAtlas', runAttempt: 1,
      fetchImpl: async () => new Response(null, { status: 302, headers: { location } }) });
    await assert.rejects(bad.downloadArtifact(9));
  }
});
test('artifact and metadata responses are bounded and comments use structured JSON', async () => {
  const oversized = createGithubApi({ token: 'synthetic-token', repository: 'example/HouseAtlas', runAttempt: 1,
    fetchImpl: async () => new Response(Buffer.alloc(262145)) });
  await assert.rejects(oversized.downloadArtifact(9));
  const calls = [];
  const api = createGithubApi({ token: 'synthetic-token', repository: 'example/HouseAtlas', runAttempt: 2,
    fetchImpl: async (url, options) => { calls.push({ url, options }); return Response.json({ id: 10 }); } });
  await api.createComment(7, 'Synthetic\n`literal` $()');
  assert.equal(calls[0].options.method, 'POST');
  assert.equal(calls[0].options.headers['content-type'], 'application/json');
  assert.deepEqual(JSON.parse(calls[0].options.body), { body: 'Synthetic\n`literal` $()' });
  await api.getRun(2);
  assert(calls[1].url.endsWith('/actions/runs/2/attempts/2'));
});
