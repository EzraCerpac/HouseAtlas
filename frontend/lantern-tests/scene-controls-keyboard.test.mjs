import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { transformWithOxc } from 'vite';

const dataURL = code => `data:text/javascript;base64,${Buffer.from(code).toString('base64')}`;
async function sourceURL(relative, lang, replacements = {}) {
  const file = new URL(relative, import.meta.url);
  let { code } = await transformWithOxc(readFileSync(file, 'utf8'), file.pathname,
    { lang, target: 'esnext', tsconfig: false, sourcemap: false, jsx: { runtime: 'automatic' } });
  for (const [specifier, url] of Object.entries(replacements)) {
    assert.ok(code.includes(JSON.stringify(specifier)), `Missing import ${specifier}`);
    code = code.replaceAll(JSON.stringify(specifier), JSON.stringify(url));
  }
  for (const match of code.matchAll(/^\s*import\s+(?:[\w$\s{},*]+?\s+from\s+)?["']([^"']+)["']/gm))
    assert.ok(match[1].startsWith('data:') || match[1].startsWith('file:'), `Unexpected import ${match[1]}`);
  return dataURL(code);
}
const frontend = new URL('../', import.meta.url);
const jsx = new URL('./node_modules/react/jsx-runtime.js', frontend).href;
const paletteURL = await sourceURL('../src/lantern/atlas/palette.ts', 'ts');
const iconURL = await sourceURL('../src/lantern/components/Icon.tsx', 'tsx', { 'react/jsx-runtime': jsx });
const controlsURL = await sourceURL('../src/lantern/scans/presentation/SceneControls.tsx', 'tsx', {
  'react/jsx-runtime': jsx, '../../components/Icon': iconURL, '../../atlas/palette': paletteURL,
});
const { SceneControls } = await import(controlsURL);
for (const selected of ['spaces', 'electrical', 'network']) {
  const markup = renderToStaticMarkup(createElement(SceneControls, {
    floors: [], selectedFloorKey: '', onFloorChange() {}, mode: 'plan', onModeChange() {},
    exploded: false, onExplodedChange() {}, yaw: 0, onYawChange() {}, pitch: 36,
    onPitchChange() {}, zoom: 1, onZoomChange() {}, overlay: selected,
    onOverlayChange() {}, onReset() {},
  }));
  const group = markup.match(/<div class="layer-bar"[^>]*>(.*?)<\/div>/)?.[0];
  assert.ok(group, 'Overlay controls render in their named group');
  assert.match(group, /role="group" aria-label="Overlay"/);
  assert.doesNotMatch(group, /radiogroup|role="radio"|aria-checked=/);
  const states = [...group.matchAll(/<button\b([^>]*)>/g)].map(([, attributes]) => attributes);
  assert.equal(states.length, 3, 'All overlays remain visible buttons');
  assert.deepEqual(states.map(attributes => /aria-pressed="true"/.test(attributes)),
    ['spaces', 'electrical', 'network'].map(key => key === selected));
  for (const [index, key] of ['spaces', 'electrical', 'network'].entries()) {
    const selectedStyle = /background:color-mix\(/.test(states[index])
      && /border-color:color-mix\(/.test(states[index]) && /color:var\(--ink\)/.test(states[index]);
    assert.equal(selectedStyle, key === selected, 'Only the selected overlay retains the selected styling');
  }
  assert.ok(states.every(attributes => /aria-label=/.test(attributes)));
  assert.ok(states.every(attributes => /type="button"/.test(attributes)));
}

console.log('PASS overlay buttons expose a single accurate pressed state for every selection.');
