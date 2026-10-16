// Healthy synthetic checks for the native v2 source Documents reader and the
// PDF canvas budget. The production reader runs against the generated in-process
// transport of source-host-visual; no network, browser, storage or native host.
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
const frontend = new URL('../', import.meta.url);
const decimalURL = await sourceURL('../src/numeric/decimal.ts');
const losslessURL = await sourceURL('../src/numeric/lossless-json.ts', { './decimal': decimalURL });
const readerURL = await sourceURL('../integration/native-source-document-reader.ts', {
  'ajv-formats/dist/formats.js': new URL('./node_modules/ajv-formats/dist/formats.js', frontend).href,
  '../src/numeric/decimal': decimalURL, '../src/numeric/lossless-json': losslessURL });
const { createNativeSourceDocumentReader } = await import(readerURL);
const { createSyntheticDocumentServer } = await import(await sourceURL('./source-host-visual/synthetic-documents.ts'));
const { fitPdfCanvas, SOURCE_PDF_CANVAS } = await import(await sourceURL('../src/lantern/source-documents/pdf-canvas-fit.ts'));

const scope = { workspaceId: '00000000-0000-4000-8000-000000000800', homeId: '00000000-0000-4000-8000-000000000801' };
const session = { expiresAt: '2099-01-01T00:00:00Z' };
const binding = { sessionIdentity: session, expiresAt: session.expiresAt, scope };
const server = await createSyntheticDocumentServer(scope);
const reader = createNativeSourceDocumentReader({ origin: server.origin, transport: server.transport,
  getBinding: () => binding, subscribeBinding: () => () => {} });
const signal = new AbortController().signal;
const bytesOf = async frame => new Uint8Array(await reader.getBlob(frame).arrayBuffer());
const [surveyId, outlineId, tileId] = server.documentIds;

assert.ok(reader.owner(), 'the synthetic binding is current');
const first = await reader.list(null, signal);
assert.deepEqual(first.documents.map(document => document.documentId), [surveyId, outlineId]);
assert.equal(first.nextCursor, 'synthetic-page-2');
const second = await reader.list(first.nextCursor, signal);
assert.deepEqual(second.documents.map(document => document.documentId), [tileId]);
assert.equal(second.nextCursor, null);

const [survey, outline] = first.documents;
// A schema-valid leap second is accepted and keeps its recorded text.
assert.deepEqual(survey.provenance.observed, { value: '2016-12-31T23:59:60Z', precision: 'instant' });
assert.deepEqual(survey.provenance.published, { value: '2019', precision: 'year' });
assert.deepEqual(survey.provenance.frame.extent, ['0', '0', '50', '40']);
assert.equal(survey.provenance.url, 'https://example.invalid/synthetic/parcel-survey');
assert.deepEqual(survey.availability, { original: 'available', preview: 'available' });
assert.deepEqual(survey.preview.inputs, [survey.original]);
assert.notEqual(survey.preview.asset.assetId, survey.original.assetId, 'the preview is a different asset derived from this original');
assert.equal(outline.preview, null);
assert.equal(outline.availability.preview, 'not-qualified');
assert.deepEqual(outline.provenance.published, { value: '2024-02-29', precision: 'day' });
assert.equal(second.documents[0].availability.original, 'stale');
assert.equal(second.documents[0].preview, null);
assert.equal(second.documents[0].availability.preview, 'not-qualified', 'no preview lineage stays unqualified even when its original is stale');
// An ordered 3D extent with a negative minimum keeps its exact tokens.
assert.deepEqual(second.documents[0].provenance.frame.extent, ['0', '0', '-2', '50', '40', '12']);
assert.equal(JSON.stringify(await reader.get(surveyId, signal)), JSON.stringify(survey));

const original = await reader.openOriginal(surveyId, survey.revision, signal);
assert.equal(original.mode, 'original');
assert.equal(original.measuredContentType, 'application/pdf');
assert.deepEqual(original.asset, survey.original);
assert.ok(reader.isCurrent(original));
assert.equal(reader.getBlob(original).type, 'application/pdf');
assert.deepEqual(await bytesOf(original), server.bytes.get(survey.original.assetId));

// One lease at a time: opening the preview ends the original's lease first.
let ended = 0;
reader.subscribeInvalidation(original, () => { ended++; });
const preview = await reader.openPreview(surveyId, survey.revision, signal);
assert.equal(ended, 1);
assert.equal(reader.isCurrent(original), false);
assert.equal(reader.getBlob(original), null);
assert.equal(preview.measuredContentType, 'image/png');
assert.deepEqual(preview.asset, survey.preview.asset);
assert.deepEqual(await bytesOf(preview), server.bytes.get(survey.preview.asset.assetId));

const geojson = await reader.openOriginal(outlineId, outline.revision, signal);
assert.equal(geojson.measuredContentType, 'application/geo+json');
assert.equal(JSON.parse(new TextDecoder().decode(await bytesOf(geojson))).type, 'FeatureCollection');
reader.release(geojson);
assert.equal(reader.getBlob(geojson), null);
const disposedOwners = [];
reader.subscribeOwner(() => { disposedOwners.push(reader.owner()); });
reader.dispose();
assert.deepEqual(disposedOwners, [null], 'ordinary cleanup notifies once; a subscriber cannot recreate a disposed owner');
assert.equal(reader.owner(), null);

// Canvas budget arithmetic: an ordinary page is untouched; a tall page fits the budget.
assert.deepEqual(fitPdfCanvas(595, 842, 1.5, 2), { cssScale: 1.5, ratio: 2, width: 1785, height: 2526, reduced: false });
const tall = fitPdfCanvas(595, 60000, 1.5, 2);
assert.ok(tall.reduced && tall.height <= SOURCE_PDF_CANVAS.maxSide && tall.width * tall.height <= SOURCE_PDF_CANVAS.maxPixels);
assert.ok(tall.ratio >= 1 && tall.cssScale <= 1.5);

console.log('source documents reader: healthy synthetic checks passed');
