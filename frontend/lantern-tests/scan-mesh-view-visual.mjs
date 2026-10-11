/** SOURCE ONLY until exact Root registration. Static accessible markup and
 * healthy synthetic display-buffer checks. This does not exercise live WebGL,
 * pointer picking, context loss or screenshot acceptance. No browser/listener. */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { transformWithOxc } from 'vite';
import { loadScanProfileSource, syntheticMeshFixture } from './scan-mesh-read.mjs';

const dataUrl = code => `data:text/javascript;base64,${Buffer.from(code).toString('base64')}`;
async function jsxSource(filename, replacements) {
  const file = new URL(`../src/lantern/scans/${filename}`, import.meta.url);
  let { code } = await transformWithOxc(readFileSync(file, 'utf8'), file.pathname,
    { lang: 'tsx', target: 'esnext', tsconfig: false, sourcemap: false, jsx: { runtime: 'automatic' } });
  for (const [specifier, url] of Object.entries(replacements)) {
    assert(code.includes(JSON.stringify(specifier)), `Missing JSX import ${specifier}`);
    code = code.replaceAll(JSON.stringify(specifier), JSON.stringify(url));
  }
  for (const match of code.matchAll(/^\s*import\s+(?:[\w$\s{},*]+?\s+from\s+)?["']([^"']+)["']/gm))
    assert(match[1].startsWith('data:') || match[1].startsWith('file:'), `Unexpected runtime import ${match[1]}`);
  return dataUrl(code);
}
const profileUrl = await loadScanProfileSource();
const { parseMeshProfile, prepareMeshRender } = await import(profileUrl);
const react = new URL('../node_modules/react/index.js', import.meta.url).href;
const jsx = new URL('../node_modules/react/jsx-runtime.js', import.meta.url).href;
const canvasUrl = await jsxSource('MeshCanvas.tsx', { react, 'react/jsx-runtime': jsx, './mesh-profile': profileUrl });
const previewUrl = await jsxSource('ScanPreview.tsx', { react, 'react/jsx-runtime': jsx, './MeshCanvas': canvasUrl, './mesh-profile': profileUrl });
const { MeshCanvas } = await import(canvasUrl), { ScanPreview } = await import(previewUrl);
const profile = await parseMeshProfile(new TextEncoder().encode(JSON.stringify(syntheticMeshFixture())), new AbortController().signal);
const markup = renderToStaticMarkup(createElement(MeshCanvas, { profile, viewKey: 'synthetic-view', selectedSourceId: null, onPick() {}, onUnavailable() {} }));
for (const label of ['Reset view', 'Top view', 'Zoom in', 'Zoom out', 'Wireframe', 'Preparing source meshes']) assert(markup.includes(label));
assert(markup.includes('tabindex="0"')); assert(markup.includes('source meshes. Drag or use arrow keys'));
let reads = 0;
const port = { isCurrent: () => true, subscribeInvalidation: () => () => {}, async read() { reads++; throw new Error('Closed view must not read'); } };
const preview = renderToStaticMarkup(createElement(ScanPreview, { viewKey: 'synthetic-view', buildingLabel: 'Synthetic building', floors: [], port, active: true }));
assert(preview.includes('Incomplete scan — physical scale and floor alignment unverified.')); assert(preview.includes('No scan preview available.')); assert.equal(reads, 0);
const hidden = renderToStaticMarkup(createElement(ScanPreview, { viewKey: 'synthetic-view', buildingLabel: 'Synthetic building', floors: [], port, active: false })); assert.equal(hidden, '');
const display = await prepareMeshRender(profile, new AbortController().signal);
const p = display.meshes[0].vertices;
assert(Math.abs(p[0] + Math.SQRT1_2) < 1e-6 && Math.abs(p[1] + Math.SQRT1_2) < 1e-6);
assert(Math.abs(p[6] - Math.SQRT1_2) < 1e-6 && Math.abs(p[13] - Math.SQRT1_2) < 1e-6);
assert.equal(p[2], 0); assert.equal(profile.meshes[0].composedLocalToStageMatrixTokens[12], '2.5000');
console.log('PASS static accessible scan controls and synthetic camera-fit buffers; live browser/GPU visual QA still required');
