#!/usr/bin/env node
/** houseatlas-model-bake: detailed master GLB (+ atlas-scene.json) -> overview
 * GLB, matching companion, optional detail GLB and a bake report. Reads and
 * writes local files only. */
import { createHash } from 'node:crypto';
import { existsSync, lstatSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { admitInViewer, bindInViewer } from './src/admission.mjs';
import { BAKE_DEFAULTS, bakeDetail, bakeOverview } from './src/bake.mjs';

const { values } = parseArgs({ options: {
  model: { type: 'string' }, companion: { type: 'string' }, out: { type: 'string' }, detail: { type: 'boolean' },
  geographic: { type: 'string' }, triangles: { type: 'string' }, 'max-error': { type: 'string' }, 'structure-weight': { type: 'string' }, 'site-weight': { type: 'string' }, weld: { type: 'string' },
} });
if (!values.model || !values.out) {
  console.error('Usage: bake.mjs --model master.glb [--companion atlas-scene.json [--geographic LAT,LON,NORTH]] --out DIR [--detail] '
    + `[--triangles ${BAKE_DEFAULTS.triangles}] [--max-error ${BAKE_DEFAULTS.maxError}] [--structure-weight ${BAKE_DEFAULTS.structureWeight}] [--site-weight ${BAKE_DEFAULTS.siteWeight}] [--weld ${BAKE_DEFAULTS.weld}]`);
  process.exit(2);
}
const isSymlink = path => { try { return lstatSync(path).isSymbolicLink(); } catch { return false; } };
const number = (text, name) => { const n = Number(text); if (!Number.isFinite(n) || n <= 0) throw new Error(`--${name} must be a positive number`); return n; };
const overrides = {
  ...(values.triangles ? { triangles: Math.floor(number(values.triangles, 'triangles')) } : {}),
  ...(values['max-error'] ? { maxError: number(values['max-error'], 'max-error') } : {}),
  ...(values['structure-weight'] ? { structureWeight: number(values['structure-weight'], 'structure-weight') } : {}),
  ...(values['site-weight'] ? { siteWeight: number(values['site-weight'], 'site-weight') } : {}),
  ...(values.weld ? { weld: number(values.weld, 'weld') } : {}),
};
// Outputs are only ever created, never overwritten: an --out that already holds
// a file of the same name (the master itself, a link to it, an earlier bake) is
// refused, before any bake work.
const names = ['model.glb', ...(values.companion ? ['atlas-scene.json'] : []), ...(values.detail ? ['detail.glb'] : []), 'bake-report.json'];
for (const name of names) if (existsSync(join(values.out, name)) || isSymlink(join(values.out, name)))
  throw new Error(`${join(values.out, name)} already exists; bake into an empty --out directory`);
const started = Date.now();
const master = new Uint8Array(readFileSync(values.model));
const companion = values.companion ? JSON.parse(readFileSync(values.companion, 'utf8')) : null;
// Where the house stands, in degrees, and true north clockwise from the model's
// -Z: written into the companion's frame for the viewer's sun, so it travels
// with this release only.
if (values.geographic !== undefined) {
  const parts = values.geographic.split(',').map(Number), limits = [90, 180, 360];
  if (!companion || parts.length !== 3 || !parts.every((value, at) => Number.isFinite(value) && Math.abs(value) <= limits[at]))
    throw new Error('--geographic takes LAT,LON,NORTH in degrees (|lat| ≤ 90, |lon| ≤ 180, |north| ≤ 360) and needs --companion');
  const [latitude, longitude, northDeg] = parts;
  companion.frame = { ...companion.frame, geographic: { latitude, longitude, northDeg } };
}
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const binding = model => ({ boundPrimitives: model.parts.length, roomPickPrimitives: model.parts.filter(part => part.occurrenceId !== null).length,
  selectableOccurrences: model.selectable.size, levels: model.levelsById.size, buildings: model.buildingsById.size });
const { glb, companion: baked, report } = await bakeOverview(master, companion, overrides);
report.viewerAdmission = await admitInViewer(glb);
// The app's own scene admission and selector binding on the baked pair.
if (baked) report.viewerBinding = binding(await bindInViewer(glb, baked));
let detail = null;
if (values.detail) {
  detail = await bakeDetail(master, companion);
  const apart = value => value && JSON.stringify({ ...value, original: null });
  if (apart(detail.companion) !== apart(baked)) throw new Error('The detail does not keep the overview companion');
  // The publication.json `detail` pin, then the Full tier's own admission and binding.
  report.detail = { file: 'detail.glb', contentType: 'model/gltf-binary', sha256: sha256(detail.glb), bytes: detail.glb.byteLength,
    drawnTriangles: detail.drawnTriangles, viewerAdmission: await admitInViewer(detail.glb, 'detail') };
  if (baked) report.detail.viewerBinding = binding(await bindInViewer(glb, baked, detail.glb));
}
report.seconds = (Date.now() - started) / 1000;
mkdirSync(values.out, { recursive: true });
const create = (name, data) => {
  try { writeFileSync(join(values.out, name), data, { flag: 'wx' }); }
  catch (error) { if (error.code === 'EEXIST') throw new Error(`${join(values.out, name)} already exists; bake into an empty --out directory`); throw error; }
};
const outputs = [['model.glb', glb], ...(baked ? [['atlas-scene.json', JSON.stringify(baked)]] : []), ...(detail ? [['detail.glb', detail.glb]] : []),
  ['bake-report.json', `${JSON.stringify(report, null, 2)}\n`]];
for (const [name, data] of outputs) create(name, data);
const mib = bytes => (bytes / 1048576).toFixed(1);
console.log(`master   ${mib(report.master.bytes)} MiB, ${report.master.drawnTriangles} triangles`);
console.log(`overview ${mib(report.overview.bytes)} MiB, ${report.overview.drawnTriangles} triangles (budget ${report.budget.triangles})`);
console.log(`error    house context ${(report.contextErrorMetres * 1000).toFixed(1)} mm, structure ${(report.structureErrorMetres * 1000).toFixed(1)} mm, site ${(report.siteErrorMetres * 1000).toFixed(1)} mm`);
console.log(`admitted by the viewer preflight; GPU ledger ${mib(report.viewerAdmission.gpuBytes)} MiB`);
if (report.viewerBinding) console.log(`bound in the viewer: ${report.viewerBinding.boundPrimitives} primitives, ${report.viewerBinding.selectableOccurrences} selectable rooms`);
if (report.detail) console.log(`detail   ${mib(report.detail.bytes)} MiB, ${report.detail.drawnTriangles} triangles, admitted at Full; GPU ledger ${mib(report.detail.viewerAdmission.gpuBytes)} MiB`);
if (baked) console.log(`companion sha256 ${sha256(JSON.stringify(baked))}`);
