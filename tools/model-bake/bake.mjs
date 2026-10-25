#!/usr/bin/env node
/** houseatlas-model-bake: detailed master GLB (+ atlas-scene.json) -> overview
 * GLB, matching companion and a bake report. Reads and writes local files only. */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { admitInViewer } from './src/admission.mjs';
import { BAKE_DEFAULTS, bakeOverview } from './src/bake.mjs';

const { values } = parseArgs({ options: {
  model: { type: 'string' }, companion: { type: 'string' }, out: { type: 'string' },
  triangles: { type: 'string' }, 'max-error': { type: 'string' }, 'structure-weight': { type: 'string' },
} });
if (!values.model || !values.out) {
  console.error('Usage: bake.mjs --model master.glb [--companion atlas-scene.json] --out DIR '
    + `[--triangles ${BAKE_DEFAULTS.triangles}] [--max-error ${BAKE_DEFAULTS.maxError}] [--structure-weight ${BAKE_DEFAULTS.structureWeight}]`);
  process.exit(2);
}
const number = (text, name) => { const n = Number(text); if (!Number.isFinite(n) || n <= 0) throw new Error(`--${name} must be a positive number`); return n; };
const overrides = {
  ...(values.triangles ? { triangles: Math.floor(number(values.triangles, 'triangles')) } : {}),
  ...(values['max-error'] ? { maxError: number(values['max-error'], 'max-error') } : {}),
  ...(values['structure-weight'] ? { structureWeight: number(values['structure-weight'], 'structure-weight') } : {}),
};
const started = Date.now();
const master = new Uint8Array(readFileSync(values.model));
const companion = values.companion ? JSON.parse(readFileSync(values.companion, 'utf8')) : null;
const { glb, companion: baked, report } = await bakeOverview(master, companion, overrides);
report.viewerAdmission = await admitInViewer(glb);
report.seconds = (Date.now() - started) / 1000;
mkdirSync(values.out, { recursive: true });
writeFileSync(join(values.out, 'model.glb'), glb);
if (baked) writeFileSync(join(values.out, 'atlas-scene.json'), JSON.stringify(baked));
writeFileSync(join(values.out, 'bake-report.json'), `${JSON.stringify(report, null, 2)}\n`);
const mib = bytes => (bytes / 1048576).toFixed(1);
console.log(`master   ${mib(report.master.bytes)} MiB, ${report.master.drawnTriangles} triangles`);
console.log(`overview ${mib(report.overview.bytes)} MiB, ${report.overview.drawnTriangles} triangles (budget ${report.budget.triangles})`);
console.log(`error    context ${(report.contextErrorMetres * 1000).toFixed(1)} mm, structure ${(report.structureErrorMetres * 1000).toFixed(1)} mm`);
console.log(`admitted by the viewer preflight; GPU ledger ${mib(report.viewerAdmission.gpuBytes)} MiB`);
if (baked) console.log(`companion sha256 ${(await import('node:crypto')).createHash('sha256').update(JSON.stringify(baked)).digest('hex')}`);
