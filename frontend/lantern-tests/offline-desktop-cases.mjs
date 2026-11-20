import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

export function homeboxRoutes({ view, homeboxPin: pin, pdf }, stockBase, jsonRead) {
  const { scope } = view;
  const source = view.entries[0].source;
  const target = { authority: 'homebox', sourceInstanceId: pin.sourceInstanceId, collectionId: pin.collectionId,
    resourceKind: 'attachment', entityId: pin.entityId, resourceId: pin.attachmentId };
  const admission = stockBase(scope) + '/homebox-pinned-file-admission';
  const original = stockBase(scope).replace('/stock/v3/', '/stock/v4/') + '/homebox-offline-original';
  const reads = [];
  return { reads, respond(request, url) {
    if (request.method !== 'GET') return null;
    if (url.pathname === admission && !url.search) {
      reads.push('admission');
      return jsonRead({ schemaVersion: 1, scope, revision: 'generated-discovery', installedSources: [{ ...scope, key: source }] });
    }
    if (url.pathname !== original) return null;
    assert.deepEqual([...url.searchParams.keys()], ['request']);
    const { requestId, ...wire } = JSON.parse(url.searchParams.get('request'));
    assert.match(requestId, /^[0-9a-f-]{36}$/);
    assert.deepEqual(wire, { schemaVersion: 4, commandId: 'homebox.file.download', context: scope, target, payload: {} });
    reads.push('original');
    const facts = { schemaVersion: 1, requestId, scope: { ...scope, sourceInstanceId: pin.sourceInstanceId, collectionId: pin.collectionId },
      target, sha256: pin.sha256, byteSize: pin.bytes, contentType: pin.sourceContentType, observationId: pin.observationId,
      sourceRegistrationVersion: pin.sourceRegistrationVersion, sourceRegistrationSha256: pin.sourceRegistrationSha256,
      localCapture: { semantics: 'process-local-pinned-snapshot', statuses: [200, 200, 200],
        beforeRetrievedAt: pin.beforeRetrievedAt, bodyRetrievedAt: pin.bodyRetrievedAt, afterRetrievedAt: pin.afterRetrievedAt } };
    return new Response(Uint8Array.from(pdf), { headers: { 'content-type': 'application/octet-stream',
      'content-length': String(pdf.length), 'cache-control': 'private, no-store',
      'x-houseatlas-original': Buffer.from(JSON.stringify(facts)).toString('base64') } });
  } };
}

const dialog = '[role="dialog"]';
const fileTitle = 'Generated HomeBox PDF';
const button = (name, scope = '') =>
  `[...document.querySelectorAll(${JSON.stringify(scope + ' button')})].find(b =>
    (b.getAttribute('aria-label') ?? b.textContent) === ${JSON.stringify(name)} && !b.disabled && b.getClientRects().length)`;
const pdfCanvas = page => `[...document.querySelectorAll('${dialog} canvas')].find(c =>
  c.getAttribute('aria-label')?.endsWith(', PDF page ${page}') && c.width > 0 && getComputedStyle(c).visibility === 'visible')`;
export const displayFixtureSize = bytes => bytes < 1024 ? `${bytes} bytes` : `${(bytes / 1024).toFixed(1)} KiB`;

async function clickButton({ evaluate, poll }, name, scope) {
  const locator = button(name, scope);
  await poll(`Boolean(${locator})`, 10_000, name + ' missing');
  await evaluate(`${locator}.click()`);
}

export async function openOrdinaryHomebox(page, fixture) {
  const { poll } = page, click = (name, scope) => clickButton(page, name, scope);
  await click('Library', '.navrail');
  await click('File details for ' + fileTitle, 'main');
  await poll(`Boolean(${button('Open file', dialog)})`, 10_000, 'Ordinary Open file unavailable');
  assert(!fixture.homebox.reads.includes('original'), 'Bulk retention is disabled and opening details reads no original');
  await click('Open file', dialog);
  await poll(`document.querySelector('${dialog}')?.textContent.includes('Kept on this device.') &&
    Boolean(${pdfCanvas(1)})`, 15_000, 'Ordinary open did not render and retain the HomeBox PDF');
  assert(fixture.homebox.reads.includes('admission'), 'The generated association must be discovered');
  assert.equal(fixture.homebox.reads.filter(read => read === 'original').length, 1, 'Open file must read the original exactly once');
}

export async function checkDesktopLibrary(page, fixture) {
  const { evaluate, poll, send } = page, click = (name, scope) => clickButton(page, name, scope);
  await click('Library', '.navrail');
  const opener = button('Open ' + fileTitle, 'main');
  await click('Open ' + fileTitle, 'main');
  const pagePixels = async page => {
    await poll(`Boolean(${pdfCanvas(page)}) && document.querySelector('${dialog}').textContent.includes('Page ${page} of 2')`, 15_000, 'Page ' + page + ' did not render');
    const pixels = await evaluate(`(() => {
      const canvas = ${pdfCanvas(page)}, { width, height } = canvas;
      const rgba = canvas.getContext('2d').getImageData(0, 0, width, height).data;
      let ink = 0;
      for (let i = 0; i < rgba.length; i += 4)
        if (rgba[i + 3] && Math.min(rgba[i], rgba[i + 1], rgba[i + 2]) < 200) ink++;
      return { ink, sample: Array.from(canvas.getContext('2d').getImageData(width >> 1, height >> 1, 1, 1).data) };
    })()`);
    assert(pixels.ink > 0, 'The drawn page contains visible marks');
    return pixels.sample;
  };
  const first = await pagePixels(1);
  await click('Next page', dialog);
  assert.notDeepEqual(await pagePixels(2), first, 'The second page has a different center pixel');
  assert.equal(await evaluate(`[...document.querySelectorAll('${dialog} button')].find(b => b.textContent === 'Next page').disabled`), true);
  const download = await evaluate(`(async () => {
    const link = [...document.querySelectorAll('${dialog} a[download]')].find(a => a.textContent === 'Save held original');
    const response = await fetch(link.href);
    const bytes = await response.arrayBuffer();
    const digest = await crypto.subtle.digest('SHA-256', bytes);
    return { bytes: Array.from(new Uint8Array(bytes)), sha256: Array.from(new Uint8Array(digest)),
      mime: response.headers.get('content-type') };
  })()`);
  assert.deepEqual(download, { bytes: fixture.pdf,
    sha256: [...createHash('sha256').update(Uint8Array.from(fixture.pdf)).digest()], mime: 'application/pdf' });
  for (const type of ['rawKeyDown', 'keyUp'])
    await send('Input.dispatchKeyEvent', { type, key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
  await poll(`!document.querySelector('${dialog}') && document.activeElement === ${opener}`, 5_000, 'Escape did not restore the PDF opener');

  // Sum actual byte records, independently of the metadata-based Settings owner.
  const held = await evaluate(`(async () => {
    const request = indexedDB.open('houseatlas-live-readonly-copy-v1');
    const db = await new Promise((resolve, reject) => { request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
    try {
      const tx = db.transaction('bytes'), rows = tx.objectStore('bytes').getAll();
      return await new Promise((resolve, reject) => {
        tx.oncomplete = () => resolve(rows.result.reduce((sum, bytes) => sum + bytes.byteLength, 0));
        tx.onabort = () => reject(tx.error);
      });
    } finally { db.close(); }
  })()`);
  assert(held > fixture.pdf.length, 'The total includes retained metadata and the original');
  await click('Settings');
  await poll(`document.querySelector('${dialog}')?.textContent.includes(${JSON.stringify(`1 files held · ${displayFixtureSize(held)} of 250.0 MiB soft budget. Storage persistence: not-granted.`)})`, 5_000,
    'Settings does not show the independently measured held total');
  assert.equal(await evaluate('globalThis.persistenceCalls'), 0, 'Reading Settings did not request persistence');
  for (const [granted, expected] of [[false, 'not-granted'], [true, 'granted']]) {
    await evaluate(`globalThis.allowPersistence = ${granted}`);
    await click('Ask browser to keep storage', dialog);
    await poll(`document.querySelector('${dialog} fieldset [role="status"]')?.textContent === 'Storage persistence: ${expected}.'`, 5_000,
      'Persistence result did not reach Settings');
  }
  assert.equal(await evaluate('globalThis.persistenceCalls'), 2);
  await click('Close', dialog);
  await click('Settings');
  await poll(`[...document.querySelectorAll('${dialog} fieldset p')].some(p => p.textContent.includes('Storage persistence: granted.'))`, 5_000,
    'A fresh status read did not show granted persistence');
  await click('Close', dialog);
}

export async function checkLibraryEviction({ evaluate, poll }, fixture) {
  const result = await evaluate(`(async () => {
    const { createLiveCopyOwner } = await import(${JSON.stringify(fixture.copyOwnerURL)});
    const { openLiveCopyBackend } = await import(${JSON.stringify(fixture.copyBackendURL)});
    const channel = new BroadcastChannel('houseatlas-live-readonly-copy-v1');
    const copies = createLiveCopyOwner(openLiveCopyBackend(indexedDB), {
      limits: { documents: 1 }, changed: () => channel.postMessage('changed'),
    });
    try {
      const actor = await copies.observeActor(${JSON.stringify(fixture.owner.actorId)}, () => true);
      const home = copies.bindHome(actor.value, ${JSON.stringify(fixture.view.scope)}, () => true);
      const pin = { ...${JSON.stringify(fixture.homeboxPin)}, attachmentId: '00000000-0000-4000-8000-000000000043' };
      return await copies.keepHomeboxDocument(home.value, pin, Uint8Array.from(${JSON.stringify(fixture.pdf)}).buffer, new AbortController().signal);
    } finally { copies.close(); channel.close(); }
  })()`);
  assert.deepEqual(result, { status: 'ok', value: { evicted: 1 } });
  await poll(`(() => {
    const title = [...document.querySelectorAll('main strong')].find(e => e.textContent === ${JSON.stringify(fileTitle)});
    const row = title?.closest('li');
    return row?.textContent.includes('Not held on this device') &&
      !row.querySelector('button:not(:disabled)') && !document.querySelector('${dialog} canvas');
  })()`, 10_000, 'The evicted original remained available in Library');
}

export async function checkReconnect({ evaluate, poll }, fixture, restoreConnection) {
  const waiting = () => evaluate(`(async () => {
    const { openOutboxStore } = await import(${JSON.stringify(fixture.outboxURL)});
    const store = openOutboxStore(indexedDB);
    try { return await store.list(); } finally { store.close(); }
  })()`);
  await poll(`document.querySelector('button.offline-pill')?.textContent.includes('1 change waiting')`, 5_000,
    'The retained shell did not show the waiting change');
  await restoreConnection();
  // Check connection may also have run from the browser's visibility event.
  await evaluate(`document.querySelector('button.offline-pill:not(:disabled)')?.click()`);
  await poll(`document.querySelector('a.offline-pill')?.textContent === 'Back online · Open live to sync 1 change'`, 10_000,
    'Returning connectivity did not offer the explicit live handoff');
  assert.equal(await evaluate('location.pathname'), '/saved/index.html');
  assert.deepEqual(await waiting(), [fixture.entry], 'The reachability probe must preserve the entire waiting entry');
  await evaluate(`document.querySelector('a.offline-pill').click()`);
  await poll(`location.pathname === '/' && location.search === '?live'
    && [...document.querySelectorAll('h1, h2')].some(h => h.textContent === 'Sign in')`, 15_000,
    'Open live did not ask for a new session after the fake host refused the previous one');
  assert.deepEqual(await waiting(), [fixture.entry], 'A refused session must leave the exact waiting edit untouched');
}

export async function checkPartialPack({ evaluate, poll, send }, { capturedAt, snapshotId, localRevision }) {
  const key = async (name, code) => {
    const events = name === 'Enter' ? ['rawKeyDown', 'char', 'keyUp'] : ['rawKeyDown', 'keyUp'];
    for (const type of events)
      await send('Input.dispatchKeyEvent', { type, key: name, code: name, windowsVirtualKeyCode: code,
        ...(type === 'char' ? { text: '\r' } : {}) });
  };
  const activate = async (locator, label) => {
    await poll(`Boolean(${locator})`, 10_000, label + ' missing');
    await evaluate(`${locator}.focus()`);
    await key('Enter', 13);
  };
  await activate(button('Open saved Atlas'), 'Open saved Atlas');
  const coverage = '.saved-coverage';
  await poll(`document.querySelector('${coverage} summary')?.textContent.startsWith('Saved coverage: partial pack;')`, 10_000,
    'The Saved viewer did not identify partial coverage');
  assert.deepEqual(await evaluate(`(() => {
    const coverage = document.querySelector('${coverage}'), [localRevision, snapshotId] = [...coverage.querySelectorAll('dd')].map(n => n.textContent);
    return { capturedAt: coverage.querySelector('time').dateTime, snapshotId, localRevision };
  })()`), { capturedAt, snapshotId, localRevision }, 'The reopened partial copy must show its exact capture and revision');
  assert(await evaluate(`document.querySelector('${coverage}').textContent.includes('Additional source relations not retained')`));

  const ax = async name => {
    const { nodes } = await send('Accessibility.getFullAXTree');
    assert(nodes.some(node => !node.ignored && node.role?.value === 'button' && node.name?.value === name),
      'Chrome accessibility tree is missing button ' + name);
  };
  const rung = (scope, name) => `[...document.querySelectorAll('${scope} button')].find(b =>
    b.querySelector('.ua-rung-name')?.textContent === '${name}' && b.getClientRects().length)`;
  const house = rung('.ua-stack-buildings', 'Synthetic house');
  await poll(`Boolean(${house})`, 10_000, 'Saved room map did not load');
  await ax('Synthetic house');
  await activate(house, 'Synthetic house');
  const ground = rung('.ua-stack-floors', 'Ground floor');
  await activate(ground, 'Ground floor');
  await activate(button('Plan', '[aria-label="Atlas view"]'), 'Plan');
  const hall = `[...document.querySelectorAll('button[aria-label^="Select room: Hall"]')].find(b => b.getClientRects().length)`;
  await poll(`Boolean(${hall})`, 10_000, 'Hall room control missing in Plan');
  const hallName = await evaluate(`${hall}.getAttribute('aria-label')`);
  await ax(hallName);
  await activate(hall, 'Hall');
  const stage = `document.querySelector('.ua-shell [aria-label^="Plan of "], .ua-shell [aria-label^="3D of "]')`;
  const selectedRoom = `document.querySelector('aside[aria-label="Selected room"] h2')`;
  const checkHall = async mode => {
    await poll(`${stage}?.getAttribute('aria-label').startsWith('${mode} of ') && ${selectedRoom}?.textContent === 'Hall'`,
      5_000, mode + ' must show Hall as the selected room');
    assert.equal(await evaluate(`${ground}?.getAttribute('aria-pressed')`), 'true', mode + ' must keep Ground floor selected');
  };
  await checkHall('Plan');
  await activate(button('3D', '[aria-label="Atlas view"]'), '3D');
  await checkHall('3D');
  await activate(button('Plan', '[aria-label="Atlas view"]'), 'Plan');
  await checkHall('Plan');
  await evaluate(`${stage}.focus()`);
  await key('Escape', 27);
  await poll(`${ground}?.getAttribute('aria-pressed') === 'true' && !${selectedRoom}`, 5_000, 'Escape did not return from room to its floor');
}
