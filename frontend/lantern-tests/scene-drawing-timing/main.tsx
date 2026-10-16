/** SYNTHETIC responsiveness fixture: the actual NativeSceneDrawing against a
 * fake in-page evidence client whose open resolves after `?delay=` ms (default
 * 600, clamped to 0–5000 so the reader's own deadline is never reached). Open,
 * close and reopen record anonymous stage timings, listed below. The drawing
 * keeps its own product styles inside one positioned, bounded stage. No fetch,
 * native host, credential or household data. */
import { StrictMode, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { NativeSceneDrawing } from '../../src/lantern/scans/native-ui/NativeSceneDrawing';
import type { NativeEvidenceDocumentClient, NativeEvidenceDocumentFrame } from '../../src/lantern/scans/native-evidence-document-types';
import type { ElectricalFixtureSheet } from '../../src/lantern/overlays/electricity/fixture-types';
import { ExactDecimal } from '../../src/numeric/decimal';
import { StageTimings } from '../stage-timings/StageTimings';
import { syntheticPng } from '../source-host-visual/synthetic-documents';
import '../../src/lantern/styles/fonts.css';
import '../../src/lantern/styles/tokens.css';
import '../../src/lantern/styles/app.css';
import '../../src/lantern/styles/atlas.css';
import '../../src/lantern/scans/native-ui/native-scene.css';
import './fixture.css';

globalThis.fetch = async () => new Response(null, { status: 404 });
const requested = Number(new URLSearchParams(location.search).get('delay') ?? 600);
const delay = Number.isFinite(requested) ? Math.min(5000, Math.max(0, requested)) : 600;

const image = syntheticPng(320, 200, (x, y) => (x % 40 < 2 || y % 40 < 2 ? [52, 64, 85] : [243, 241, 234]));
const sha256 = [...new Uint8Array(await crypto.subtle.digest('SHA-256', image))].map(byte => byte.toString(16).padStart(2, '0')).join('');
const EVIDENCE = 'syn-evidence-0001';
const sheet: ElectricalFixtureSheet = { id: 'syn-sheet', title: 'Synthetic drawing', pdfPage: 1, originalPhoto: 'syn-photo',
  originalPhotoSha256: sha256, renderedPhotoSha256: sha256, sourceDate: null, regionIds: [] };
const evidenceIds = [EVIDENCE] as const;

/** Owned fake evidence client: one generated PNG, a fixed delay, no network. */
function fakeClient(): NativeEvidenceDocumentClient {
  const frames = new Set<NativeEvidenceDocumentFrame>();
  return {
    open: (evidenceId, signal) => new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        if (evidenceId !== EVIDENCE) { reject(new Error('Unknown fixture evidence')); return; }
        const frame: NativeEvidenceDocumentFrame = { lease: {}, evidenceId, evidenceRevision: 1, mode: 'inline-png',
          asset: { assetId: 'syn-asset-0001', revision: ExactDecimal.parse('1'), contentType: 'image/png', sha256,
            byteSize: ExactDecimal.parse(String(image.byteLength)), purpose: 'evidence-original', previewPolicy: 'safe-rendered',
            sourceLicense: { status: 'unknown', reference: null }, evidenceIds: [EVIDENCE] } };
        frames.add(frame); resolve(frame);
      }, delay);
      signal.addEventListener('abort', () => { clearTimeout(timer); reject(signal.reason); }, { once: true });
    }),
    isCurrent: frame => frames.has(frame),
    getBlob: frame => frames.has(frame) ? new Blob([image], { type: 'image/png' }) : null,
    subscribeInvalidation: () => () => {},
    release: frame => { frames.delete(frame); },
    dispose: () => frames.clear(),
  };
}
const client = fakeClient();

function Fixture() {
  const [open, setOpen] = useState(false);
  return <div className="lantern-host drawing-fixture">
    <header><h1>Synthetic drawing read, {delay} ms</h1>
      <p>A fake evidence client answers after a fixed delay. Open, close and reopen to compare cold and warm reads.</p></header>
    <div className="drawing-fixture-stage">
      {!open && <button type="button" className="chip-btn" onClick={() => setOpen(true)}>Open drawing</button>}
      {open && <NativeSceneDrawing client={client} sheet={sheet} evidenceIds={evidenceIds} current={() => true} onClose={() => setOpen(false)} />}
    </div>
    <StageTimings areas={['scene-drawing']} />
  </div>;
}
createRoot(document.getElementById('root')!).render(<StrictMode><Fixture /></StrictMode>);
