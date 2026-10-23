// Proposed presentation-only check. Do not invoke before exact-body review and
// source-owner guide/manifest registration. Immutable generated snapshots only:
// actual LocalEditPanel SSR, no adapter execution, storage, browser or faults.
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import { build } from 'vite';

assert.equal(process.version, 'v26.10.0');
assert.deepEqual(process.argv.slice(2), [], 'This runner takes no arguments');
const root = fileURLToPath(new URL('../', import.meta.url));
const require = createRequire(import.meta.url);
const scratch = mkdtempSync(join(tmpdir(), 'local-edit-panel-presentation-'));
let LocalEditPanel;
try {
  const entry = join(scratch, 'entry.ts');
  writeFileSync(entry, `export { LocalEditPanel } from ${JSON.stringify(join(root, 'src/local-edit-retention/LocalEditPanel.tsx'))};`);
  const built = await build({ root, configFile: false, logLevel: 'silent', build: { write: false,
    target: 'node26', minify: false, lib: { entry, formats: ['es'] },
    rolldownOptions: { external: id => /^(react|react-dom)(\/|$)/.test(id),
      output: { codeSplitting: false, paths: id => pathToFileURL(require.resolve(id)).href } } } });
  const output = Array.isArray(built) ? built[0] : built;
  const chunk = output.output.find(item => item.type === 'chunk' && item.isEntry);
  assert(chunk, 'Expected an SSR entry chunk');
  assert(!chunk.code.includes('__require("react")'));
  const modulePath = join(scratch, 'fixture.mjs');
  writeFileSync(modulePath, chunk.code);
  ({ LocalEditPanel } = await import(pathToFileURL(modulePath).href));
} finally { rmSync(scratch, { recursive: true, force: true }); }
const { createElement } = await import(new URL('../node_modules/react/index.js', import.meta.url).href);
const { renderToStaticMarkup } = await import(new URL('../node_modules/react-dom/server.node.js', import.meta.url).href);

function freeze(value) {
  if (value && typeof value === 'object') {
    for (const item of Object.values(value)) freeze(item);
    Object.freeze(value);
  }
  return value;
}
const recordId = 'Generated <record> & "quoted"';
const originalText = JSON.stringify({ label: 'Generated <b>original</b> & "quoted"' });
const proposalText = JSON.stringify({ label: 'Generated </textarea><b>proposal</b> & "quoted"' });
const scope = { workspaceId: '00000000-0000-4000-8000-000000000901',
  homeId: '00000000-0000-4000-8000-000000000902' };
const context = { scope, savedKey: `${scope.workspaceId}/${scope.homeId}`, snapshotId: 'a'.repeat(64),
  localRevision: '00000000-0000-4000-8000-000000000903' };
const summary = { key: 'generated-draft', recordType: 'identity', recordId,
  revision: '184467440737095516290000000007', resourceId: 'generated-identities', hasProposal: true };
const detail = { ...summary, originalSha256: 'b'.repeat(64), originalBytes: Buffer.byteLength(originalText),
  resourceSha256: 'c'.repeat(64), manifestSha256: 'd'.repeat(64), proposalSha256: 'e'.repeat(64),
  originalText, proposalText, canEdit: true, editorReason: null, version: 1 };
const candidate = { key: 'generated-candidate', recordId, revision: summary.revision,
  bytes: detail.originalBytes, sha256: detail.originalSha256, resourceSha256: detail.resourceSha256 };
const base = freeze({ localPartitionId: 'generated-local-space', context, status: 'ready',
  summaries: [summary], selectedKey: summary.key, detail, outcome: null, message: null,
  candidates: [candidate], candidateStatus: 'ready', candidateMessage: null,
  selectedCandidate: candidate.key, canRetain: false });
const snapshot = (patch = {}) => freeze(structuredClone({ ...base, ...patch }));
// The panel consumes only the selection lifetime during SSR; house metadata is
// supplied for the same interface shape, with no admission/storage operation.
function selection({ aborted = false, current = true } = {}) {
  const lifetime = new AbortController();
  if (aborted) lifetime.abort();
  return Object.freeze({ house: freeze({ version: 1, scope: structuredClone(scope), key: context.savedKey,
    snapshotId: context.snapshotId, localRevision: context.localRevision, label: 'Generated saved copy',
    capturedAt: '2026-10-23T00:00:00Z', shellBuildId: 'f'.repeat(64), resources: [], manifest: new ArrayBuffer(0) }),
    signal: lifetime.signal, isCurrent: () => current });
}
const operationCalls = [];
const operations = ['list', 'readCandidates', 'chooseCandidate', 'retain', 'open', 'read',
  'saveProposal', 'resetProposal', 'discard', 'closeDetail', 'dispose'];
function render(state, selected = selection()) {
  const before = JSON.stringify(state);
  const adapter = Object.freeze({ getSnapshot: () => state,
    subscribe: () => { operationCalls.push('subscribe'); assert.fail('SSR must not subscribe'); },
    ...Object.fromEntries(operations.map(name => [name, () => {
      operationCalls.push(name); assert.fail(`SSR dispatched adapter.${name}`);
    }])) });
  const html = renderToStaticMarkup(createElement(LocalEditPanel, { selection: selected, adapter }));
  assert.equal(JSON.stringify(state), before, 'Rendering must preserve the immutable snapshot');
  assert.deepEqual(operationCalls, [], 'Rendering must dispatch no adapter operations');
  return html;
}
const escape = text => text.replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;',
  '"': '&quot;', "'": '&#x27;' })[ch]);
function buttons(html) {
  return [...html.matchAll(/<button\b([^>]*)>([\s\S]*?)<\/button>/g)]
    .map(([, attributes, body]) => ({ attributes, text: body.replace(/<[^>]*>/g, '') }));
}
function button(html, text, disabled) {
  const found = buttons(html).filter(item => item.text === text);
  assert.equal(found.length, 1, `Expected one button: ${text}`);
  assert.equal(/\bdisabled=""/.test(found[0].attributes), disabled, `Disabled state: ${text}`);
}
const mutations = ['Save local proposal', 'Reset local proposal', 'Discard local draft'];
function noEditor(html) {
  assert(!html.includes('<textarea'), 'No proposal editor');
  assert(!html.includes('<form'), 'No actionable proposal form');
  for (const label of mutations) assert(!buttons(html).some(item => item.text === label), `No stale ${label}`);
}
function pendingControls(html) {
  for (const label of [...mutations, 'Retain local draft', 'Read saved identity originals',
    'Read local drafts', 'Read local draft']) button(html, label, true);
  for (const item of buttons(html)) {
    if (item.text !== 'Close local draft') assert(/\bdisabled=""/.test(item.attributes), item.text);
  }
  button(html, 'Close local draft', false);
  assert.match(html, /<textarea\b[^>]*\bdisabled=""/);
}

const ready = render(snapshot());
for (const label of mutations) button(ready, label, false);
button(ready, 'Read local drafts', false);
button(ready, 'Read local draft', false);
assert.match(ready, /<textarea\b/);
assert(!/<textarea\b[^>]*\bdisabled/.test(ready));
assert(ready.includes(escape(originalText)), 'Retained record text is escaped');
assert(ready.includes(escape(proposalText)), 'Proposal textarea text is escaped');
assert(ready.includes(escape(recordId)), 'Record identity text is escaped');
assert(!ready.includes('<b>'));
assert(!ready.includes('<record>'));
assert(!ready.includes('</textarea><b>'));
assert(ready.includes(summary.revision), 'Large lexical revision remains exact');

// These are static presentation inputs, not transitions or interrupted work.
for (const [status, message] of [['opening', 'Reading local draft…'], ['pending', 'Saving local change…']]) {
  const html = render(snapshot({ status }));
  assert(html.includes(`<p role="status">${message}</p>`));
  pendingControls(html);
}
const listing = render(snapshot({ status: 'listing', detail: null, selectedKey: null,
  summaries: [], selectedCandidate: null, canRetain: false }));
assert(listing.includes('<p role="status">Reading local drafts…</p>'));
button(listing, 'Read local drafts', true);
button(listing, 'Read saved identity originals', true);
noEditor(listing);
const readingCandidates = render(snapshot({ candidateStatus: 'reading', candidates: [],
  selectedCandidate: null, canRetain: false }));
assert(readingCandidates.includes('<p role="status">Verifying saved identity originals…</p>'));
for (const label of [...mutations, 'Read saved identity originals', 'Read local drafts', 'Read local draft']) {
  button(readingCandidates, label, true);
}
assert.match(readingCandidates, /<textarea\b[^>]*\bdisabled=""/);
assert(!readingCandidates.includes('Saving local change…'));

const unconfirmedMessage = 'Local write completion is unconfirmed. Read local draft before another write; no safe retry is established.';
const unconfirmed = render(snapshot({ status: 'completion-unconfirmed', detail: null,
  message: unconfirmedMessage, canRetain: false }));
assert(unconfirmed.includes(`<p role="alert">${unconfirmedMessage}</p>`));
noEditor(unconfirmed);
button(unconfirmed, 'Retain local draft', true);
button(unconfirmed, 'Read saved identity originals', true);
button(unconfirmed, 'Read local drafts', false);
button(unconfirmed, 'Read local draft', false);
button(unconfirmed, 'Close local draft', false);
const existingList = unconfirmed.match(/<ul\b[^>]*aria-label="Existing local drafts"[^>]*>([\s\S]*?)<\/ul>/);
assert(existingList, 'Existing local drafts list is present');
const existing = buttons(existingList[1]).find(item => item.text.startsWith('identity: '));
assert(existing, 'Existing local draft remains explicitly readable');
assert(!/\bdisabled=""/.test(existing.attributes));
const candidateList = unconfirmed.match(/<ul\b[^>]*aria-label="Verified saved identity candidates"[^>]*>([\s\S]*?)<\/ul>/);
assert(candidateList, 'Verified saved identity candidates list is present');
const unconfirmedCandidate = buttons(candidateList[1]).find(item => item.text.startsWith('identity: '));
assert(unconfirmedCandidate, 'Verified saved identity candidate remains visible');
assert(/\bdisabled=""/.test(unconfirmedCandidate.attributes), 'Candidate selection remains disabled');

const retiredState = snapshot({ status: 'retired', summaries: [], selectedKey: null, detail: null,
  candidates: [], candidateStatus: 'idle', selectedCandidate: null, canRetain: false });
const retired = render(retiredState);
noEditor(retired);
button(retired, 'Read local drafts', true);
button(retired, 'Read saved identity originals', true);
assert(!retired.includes(escape(recordId)), 'Retired snapshot exposes no stale record');
assert(!retired.includes('Read local draft</button>'));
assert(!retired.includes('Retain local draft</button>'));
// Invalid lifetime with an otherwise populated snapshot must render nothing.
assert.equal(render(snapshot(), selection({ aborted: true })), '');
assert.equal(render(snapshot(), selection({ current: false })), '');

const missingReason = 'Exact original bytes, hash or revision are unavailable.';
for (const missing of [{ originalText: null, originalBytes: null }, { originalSha256: null }, { revision: null }]) {
  const html = render(snapshot({ detail: { ...detail, ...missing, canEdit: false, editorReason: missingReason } }));
  assert(html.includes(`<p role="status">${missingReason}</p>`));
  assert(!html.includes('<textarea'));
  assert(!html.includes('<form'));
  assert(!buttons(html).some(item => item.text === 'Save local proposal'));
  assert(html.includes('<dd>Unavailable</dd>'));
  button(html, 'Read local draft', false);
  // Reset/discard remain explicit local draft actions; evidence gates editing.
  button(html, 'Reset local proposal', false);
  button(html, 'Discard local draft', false);
}
assert.deepEqual(operationCalls, []);
console.log('PASS generated LocalEditPanel SSR: pending read/write controls, unconfirmed explicit reads, retired/invalid selections, missing evidence, escaped text and no adapter dispatch.');
console.log('Presentation only; no adapter transitions, storage, browser events, fault injection, recovery or device qualification.');
