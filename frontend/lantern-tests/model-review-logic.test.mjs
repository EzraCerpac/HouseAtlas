// Healthy synthetic checks for the local model review owners and the site
// publication reader. Pure modules only: no React, browser, network, storage,
// provider, private input or native host. Failure and revocation classes are
// not exercised here.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { transformWithOxc } from 'vite';

const dataURL = code => `data:text/javascript;base64,${Buffer.from(code).toString('base64')}`;
async function sourceURL(relative, replacements = {}) {
  const file = new URL(relative, import.meta.url);
  let { code } = await transformWithOxc(readFileSync(file, 'utf8'), file.pathname,
    { lang: 'ts', target: 'esnext', tsconfig: false, sourcemap: false });
  for (const [specifier, url] of Object.entries(replacements)) {
    assert.ok(code.includes(JSON.stringify(specifier)), `Missing import ${specifier} in ${relative}`);
    code = code.replaceAll(JSON.stringify(specifier), JSON.stringify(url));
  }
  for (const match of code.matchAll(/^\s*import\s+(?:[\w$\s{},*]+?\s+from\s+)?["']([^"']+)["']/gm))
    assert.ok(match[1].startsWith('data:') || match[1].startsWith('file:'), `Unexpected import ${match[1]} in ${relative}`);
  return dataURL(code);
}

const { createRendererOwner } = await import(await sourceURL('../src/lantern/electrical-documentary/renderer-owner.ts'));
const { createLocalSourceReader } = await import(await sourceURL('../src/lantern/electrical-documentary/local-source-reader.ts'));
const siteTypesURL = await sourceURL('../src/lantern/site-artifacts/types.ts');
const site = await import(await sourceURL('../src/lantern/site-artifacts/publication.ts', { './types': siteTypesURL }));
const sampleURL = await sourceURL('./canonical-ifc-visual/standard-glb-sample.ts');
const { createSyntheticSitePort, SYNTHETIC_SITE_PIN } = await import(await sourceURL('./source-host-visual/synthetic-site.ts',
  { '../canonical-ifc-visual/standard-glb-sample': sampleURL }));

// Renderer owner: one stable context over the original File objects.
{
  const files = { modelFile: new File(['glb'], 'a.glb'), manifestFile: new File(['{}'], 'a.json'), referenceFile: null };
  let token = {}; const sessionListeners = new Set();
  const session = { current: () => token, subscribe(changed) { sessionListeners.add(changed); return () => sessionListeners.delete(changed); } };
  const handle = createRendererOwner(files, session);
  const context = handle.owner.capture();
  assert.equal(handle.owner.capture(), context);
  assert.equal(context.modelFile, files.modelFile);
  assert.equal(context.manifestFile, files.manifestFile);
  assert.ok(Object.isFrozen(context));
  assert.equal(handle.owner.isCurrent(context), true);
  assert.equal(handle.owner.isCurrent({ ...context }), false, 'an equal-looking copy is not the owner context');
  let notified = 0;
  handle.owner.subscribe(context, () => { notified++; });
  token = {};
  for (const changed of [...sessionListeners]) changed();
  assert.equal(notified, 1);
  assert.equal(handle.isLive(), false);
  assert.equal(handle.owner.isCurrent(context), false);
  assert.equal(sessionListeners.size, 0, 'the session subscription ends on retirement');
  handle.retire();
  assert.equal(notified, 1, 'retirement notifies once');

  const plain = createRendererOwner(files);
  let plainNotified = 0;
  plain.owner.subscribe(plain.context, () => { plainNotified++; });
  plain.retire(); plain.retire();
  assert.equal(plainNotified, 1);
}

// Local source reader: JSON text is acknowledged only after it is shown, and
// clearing revokes the owned URL synchronously.
{
  const created = [], revoked = [];
  const { createObjectURL, revokeObjectURL } = URL;
  URL.createObjectURL = blob => { const url = `blob:synthetic/${created.length}`; created.push({ url, blob }); return url; };
  URL.revokeObjectURL = url => { revoked.push(url); };
  try {
    const store = createLocalSourceReader();
    const context = { selectionContext: {} };
    const watchers = [];
    store.setFence({ isCurrent: candidate => candidate === context, watch(candidate, changed) { watchers.push(changed); return () => {}; } });
    const blob = new Blob([JSON.stringify({ record: 'synthetic', items: [1, 2] })], { type: 'application/json' });
    const action = Object.freeze({ blob, sourceKey: 'syn-record', role: 'interpretation-record', contentType: 'application/json',
      pdfPage: null, sha256: 'sha256:synthetic', bytes: blob.size, label: 'Synthetic record', binding: {} });
    const opened = store.reader.open(action, new AbortController().signal, context);
    const loading = store.snapshot();
    assert.equal(loading.status, 'loading');
    assert.equal(loading.representation, 'text');
    assert.equal(loading.url, 'blob:synthetic/0');
    for (let at = 0; at < 20 && store.snapshot().text === null; at++) await new Promise(resolve => setTimeout(resolve, 0));
    const read = store.snapshot();
    assert.equal(read.text, JSON.stringify({ record: 'synthetic', items: [1, 2] }, null, 2));
    assert.equal(read.status, 'loading', 'text alone does not settle the open');
    assert.equal(store.acknowledge(read.id), true);
    assert.equal(await opened, 'opened');
    assert.equal(store.snapshot().status, 'shown');
    assert.equal(store.isShowing(read.id), true);
    store.clear();
    assert.equal(store.snapshot(), null);
    assert.deepEqual(revoked, ['blob:synthetic/0']);
    assert.equal(read.signal.aborted, true);
    store.dispose();
  } finally {
    URL.createObjectURL = createObjectURL; URL.revokeObjectURL = revokeObjectURL;
  }
}

// Site publication: the synthetic pin validates and its plan is read with the
// declared origin subtracted; nothing is fitted or transformed.
{
  const port = createSyntheticSitePort(0);
  const signal = new AbortController().signal;
  const publication = site.readSitePublication(await port.loadPublication({ ...SYNTHETIC_SITE_PIN, signal }), SYNTHETIC_SITE_PIN);
  assert.deepEqual(publication.pin, SYNTHETIC_SITE_PIN);
  assert.deepEqual(publication.siteFrame.originSource, [1000.25, 2000.5, 0]);
  assert.equal(publication.assets.length, 3);
  assert.equal(publication.groups.length, 5);
  assert.deepEqual(publication.groups.filter(group => !group.defaultVisible).map(group => [group.groupId, group.assetId]),
    [['syn-group-reference', 'syn-asset-envelope']]);
  assert.equal(publication.features.length, 5);
  assert.equal(publication.canonicalHouse.qualifiedMatrixDeclared, false);
  assert.equal(publication.canonicalHouse.provisionalPoseDeclared, false);
  const [glb, envelope, plan] = publication.assets;
  assert.equal(site.notDrawnReason(glb, publication.siteFrame), null);
  assert.equal(envelope.kind, site.REFERENCE_ENVELOPE_KIND);
  assert.equal(site.notDrawnReason(envelope, publication.siteFrame), null);
  assert.equal(site.notDrawnReason(plan, publication.siteFrame), 'Source plan, shown in 2D only');
  assert.equal(site.planReason(publication.siteFrame), null);
  const bytes = await port.readArtifact({ ...SYNTHETIC_SITE_PIN, assetId: glb.assetId, expectedSha256: glb.sha256, expectedBytes: glb.bytes, signal });
  assert.equal(bytes.byteLength, glb.bytes);
  assert.equal(await site.hex(bytes), site.declaredHex(glb.sha256));
  const shapes = site.readPlan(await port.readSourcePlan({ ...SYNTHETIC_SITE_PIN, assetId: plan.assetId, expectedSha256: plan.sha256, expectedBytes: plan.bytes, signal }),
    publication.siteFrame.originSource);
  assert.equal(shapes.skipped, 0);
  assert.deepEqual(shapes.shapes.map(shape => [shape.featureId, shape.kind]),
    [['syn-feature-parcel', 'area'], ['syn-feature-main', 'area'], ['syn-feature-garden', 'area'], ['syn-feature-hedge', 'line']]);
  assert.deepEqual(shapes.shapes[1].paths[0], [[0, -7], [9, -7], [9, 0], [0, 0], [0, -7]]);
  assert.deepEqual(shapes.shapes[3].paths[0][0], [-18, 12]);
}

// Site scene budget: small arithmetic over shared limits, reserved in
// publication order, with bounded reads and one load at a time.
{
  const { createSiteBudget, createTurns, planPoints, runLimited, PREPARED_BYTES_PER_TRIANGLE } = await import(await sourceURL('../src/lantern/site-artifacts/site-budget.ts'));
  assert.equal(PREPARED_BYTES_PER_TRIANGLE, 72);
  const budget = createSiteBudget({ inputBytes: 1000, preparedBytes: 72 * 10, planPoints: 5 });
  assert.equal(budget.reserveInput(600), null);
  assert.equal(budget.reserveInput(400), null);
  assert.match(budget.reserveInput(1), /input budget/);
  assert.equal(budget.reservePrepared(6), null);
  assert.match(budget.reservePrepared(5), /scene budget/);
  assert.equal(budget.reservePrepared(4), null, 'a later smaller asset still fits');
  budget.releasePrepared(4);
  assert.deepEqual(budget.used(), { inputBytes: 1000, preparedBytes: 72 * 6, planPoints: 0 });
  assert.equal(budget.reservePlan(5), null);
  assert.match(budget.reservePlan(1), /point budget/);

  let running = 0, peak = 0;
  const order = [];
  const turns = createTurns(5);
  const results = await runLimited(5, 2, async at => {
    running++; peak = Math.max(peak, running);
    // Later reads finish first; loads still run in index order.
    await new Promise(resolve => setTimeout(resolve, (5 - at) * 2));
    running--;
    return turns.take(at, async () => { order.push(at); return at * 10; });
  });
  assert.equal(peak, 2);
  assert.deepEqual(order, [0, 1, 2, 3, 4]);
  assert.deepEqual(results, [0, 10, 20, 30, 40]);

  // Plan admission happens in each ordered turn: the later plan's read
  // finishes first, yet the first plan is the one admitted.
  assert.equal(planPoints({ shapes: [{ paths: [[1, 2, 3], [4, 5]] }, { paths: [[6]] }] }), 6);
  const plans = createSiteBudget({ inputBytes: 0, preparedBytes: 0, planPoints: 10 });
  const planTurns = createTurns(2);
  const admitted = await runLimited(2, 2, async at => {
    await new Promise(resolve => setTimeout(resolve, (2 - at) * 4));
    return planTurns.take(at, async () => plans.reservePlan(6));
  });
  assert.equal(admitted[0], null);
  assert.match(admitted[1], /point budget/);
}

console.log('model review logic: renderer owner, local JSON reader, synthetic site publication and site budget passed');
