/** Proposed generated-only checks. Register each exact command with the source
 * owner before execution. The separately selected retirement case is a bounded
 * fake/local-only reentrancy regression, outside the default healthy example.
 * No native host, browser, credentials or writes. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'vite';

assert.equal(process.version, 'v26.10.0');
const selectedCase = process.argv.length === 2 ? 'healthy' : process.argv.length === 4 && process.argv[2] === '--case' ? process.argv[3] : null;
assert(['healthy', 'reentrant-retirement'].includes(selectedCase), 'Select the healthy example or the separately registered retirement case');
const root = resolve(fileURLToPath(new URL('../../', import.meta.url)));
const scratch = mkdtempSync(join(tmpdir(), 'houseatlas-electrical-library-read-'));
const paths = ['frontend/integration/native-electrical-library-reader.ts', 'frontend/src/lantern/electrical-library/project.ts',
  'frontend/src/lantern/electrical-library/types.ts', 'frontend/lantern-tests/electrical-library-visual/synthetic-electrical.ts'];
let reader;
try {
  const entry = join(scratch, 'entry.ts');
  writeFileSync(entry, `export {createNativeElectricalLibraryReader} from ${JSON.stringify(join(root, paths[0]))};\nexport {projectElectricalLibrary} from ${JSON.stringify(join(root, paths[1]))};\nexport {createSyntheticElectricalLibrary} from ${JSON.stringify(join(root, paths[3]))};\n`);
  const built = await build({ root: join(root, 'frontend'), configFile: false, logLevel: 'silent',
    build: { write: false, target: 'node26', minify: false, lib: { entry, formats: ['es'] } } });
  const output = Array.isArray(built) ? built[0] : built;
  const modulePath = join(scratch, 'reader.mjs'); writeFileSync(modulePath, output.output.find(item => item.type === 'chunk' && item.isEntry).code);
  const { createNativeElectricalLibraryReader, createSyntheticElectricalLibrary } = await import(pathToFileURL(modulePath).href);
  if (selectedCase === 'reentrant-retirement') {
    const results = [];
    for (const trigger of ['retirement', 'binding-change', 'initial-owner']) {
      const fixture = await createSyntheticElectricalLibrary();
      let context = fixture.options.getContext(), later;
      reader = createNativeElectricalLibraryReader({ ...fixture.options, getContext: () => context });
      if (trigger === 'initial-owner') {
        let notified = false;
        const off = reader.subscribeOwner(() => {
          if (!notified) { notified = true; later = reader.read(fixture.buildingId, new AbortController().signal); }
        });
        const older = await reader.read(fixture.buildingId, new AbortController().signal);
        off(); assert.equal(older.status, 'unavailable'); assert.equal(older.reason, 'selection-changed');
      } else {
        const first = await reader.read(fixture.buildingId, new AbortController().signal);
        assert.equal(first.status, 'available');
        reader.subscribeInvalidation(first, () => { later = reader.read(fixture.buildingId, new AbortController().signal); });
        if (trigger === 'retirement') {
          const older = await reader.read(fixture.buildingId, new AbortController().signal);
          assert.equal(older.status, 'unavailable'); assert.equal(older.reason, 'selection-changed');
        } else {
          context = { ...context, sessionIdentity: Object.freeze({}) };
          assert.ok(reader.owner(), 'binding is published before its retirement notification');
        }
      }
      assert.ok(later, 'a synchronous subscriber requested the newer read');
      const latest = await later;
      assert.equal(latest.status, 'available'); assert.ok(reader.isCurrent(latest), 'the older call cannot overwrite the newer attempt');
      assert.equal(fixture.counts.owners, trigger === 'initial-owner' ? 2 : 4, 'superseded calls allocate no orphan source clients');
      reader.release(latest); reader.dispose(); reader = null;
      assert.equal(fixture.counts.owners, fixture.counts.disposes);
      assert.equal(fixture.counts.owners, fixture.counts.releases);
      results.push({ trigger, counts: fixture.counts });
    }
    console.log(JSON.stringify({ check: 'electrical-library-reentrant-retirement', fictional: true, results }));
  } else {
  const fixture = await createSyntheticElectricalLibrary();
  assert.equal(fixture.view.entries.length, 0);
  assert.equal(fixture.view.sourceDocumentsService, undefined);
  assert.equal(fixture.view.modelOverviewService, undefined);
  reader = createNativeElectricalLibraryReader(fixture.options);
  assert.ok(reader.owner()); const owner = reader.owner();
  const frame = await reader.read(fixture.buildingId, new AbortController().signal);
  assert.equal(frame.status, 'available'); assert.equal(reader.owner(), owner); assert.ok(reader.isCurrent(frame));
  assert.equal(frame.documents.length, 1);
  const document = frame.documents[0];
  assert.equal(document.evidenceId, fixture.pdfEvidenceId); assert.equal(document.assetId, fixture.pdfAssetId);
  assert.equal(document.evidenceRevision, 4); assert.equal(document.assetRevision.token, '7');
  assert.equal(document.sha256, fixture.pdfSha); assert.equal(document.byteSize.toSafeInteger(), fixture.pdf.length);
  assert.deepEqual(document.pages.map(page => page.reference.pdfPage), [2, 9, 18]);
  assert.equal(document.pages[0].rooms[0].nativePlaceId, '00000000-0000-4000-8000-000000000041');
  assert.equal(document.pages[1].rooms[0].nativePlaceId, '00000000-0000-4000-8000-000000000042');
  assert.equal(document.pages[2].rooms.length, 0);
  assert.equal(document.pages[1].rooms[0].basis, 'inferred');
  assert.equal(document.pages[0].sheet.sourceDate, null);
  assert.equal(document.pages[0].documentary.source.retrievedAt, null);
  assert.equal(document.pages[0].documentary.openUncertainty, 'Fictional source; no verified wiring');
  assert.equal(frame.unlinkedSheets.length, 0);
  assert.equal(fixture.counts.opens.includes(fixture.pdfEvidenceId), false, 'listing references does not open original PDF bytes');
  const drawing = reader.createDrawingClient(frame);
  const pdfFrame = await drawing.open(document.evidenceId, new AbortController().signal);
  const bytes = new Uint8Array(await drawing.getBlob(pdfFrame).arrayBuffer());
  assert.equal(createHash('sha256').update(bytes).digest('hex'), fixture.pdfSha);
  assert.equal(pdfFrame.mode, 'original-download'); assert.equal(pdfFrame.asset.previewPolicy, 'download-only');
  assert.ok(reader.isCurrent(frame), 'a dedicated PDF client leaves source-original leases current');
  drawing.release(pdfFrame); drawing.dispose();
  assert.ok(reader.isCurrent(frame));
  const deadline = performance.now() + 15_000;
  while (fixture.counts.heads === 0 && performance.now() < deadline) await new Promise(resolve => setTimeout(resolve, 100));
  assert.equal(fixture.counts.heads, 1, 'one normal sequential same-head refresh');
  assert.ok(reader.isCurrent(frame));
  reader.release(frame); reader.dispose(); reader = null;
  assert.equal(fixture.counts.owners, fixture.counts.disposes);
  assert.equal(fixture.counts.releases, 3, 'two retained originals and one explicit PDF open released');
  console.log(JSON.stringify({ check: 'electrical-library-read', fictional: true, documents: 1, pages: [2, 9, 18],
    pdfSha256: fixture.pdfSha, counts: fixture.counts,
    sourcePins: Object.fromEntries(paths.map(path => [path, createHash('sha256').update(readFileSync(join(root, path))).digest('hex')])) }));
  }
} finally { reader?.dispose(); rmSync(scratch, { recursive: true, force: true }); }
