/** Generated nonbrowser search/Places navigation checks. No listener or provider. */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { transformWithOxc } from 'vite';
import { loadNumericSource } from './load-numeric-source.mjs';
import { nativePlaceSearch, openNativePlaceSearchHit } from '../src/lantern/topology/search.ts';

const jsxUrl = new URL('../node_modules/react/jsx-runtime.js', import.meta.url).href;
const { renderToStaticMarkup } = await import(new URL('../node_modules/react-dom/server.node.js', import.meta.url));
const moduleUrl = source => `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`;
async function compile(path, imports = {}) {
  const file = new URL(path, import.meta.url);
  let { code } = await transformWithOxc(readFileSync(file, 'utf8'), file.pathname,
    { lang: path.endsWith('tsx') ? 'tsx' : 'ts', jsx: { runtime: 'automatic' }, target: 'esnext', tsconfig: false });
  for (const [specifier, url] of Object.entries(imports)) {
    assert(code.includes(JSON.stringify(specifier)), `Missing import ${specifier}`);
    code = code.replaceAll(JSON.stringify(specifier), JSON.stringify(url));
  }
  for (const match of code.matchAll(/^\s*import\s+(?:[\w$\s{},*]+?\s+from\s+)?["']([^"']+)["']/gm))
    assert(match[1].startsWith('data:') || match[1].startsWith('file:'), `Unexpected import ${match[1]}`);
  return moduleUrl(code);
}
const time = await compile('../src/lantern/data/time.ts', {
  'ajv-formats/dist/formats.js': new URL('../node_modules/ajv-formats/dist/formats.js', import.meta.url).href,
});
const queryUrl = await compile('../src/lantern/data/query.ts', { './time': time });
const { search } = await import(queryUrl);
const { buildTopologyIndex } = await import(await loadNumericSource('lantern/topology/model.ts'));
const scope = { workspaceId: '00000000-0000-4000-8000-000000000001', homeId: '00000000-0000-4000-8000-000000000002' };
const ids = [10, 11, 12].map(n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`);
const data = {
  identities: ids.map(id => ({ target: { recordId: id }, lifecycle: 'active', payload: { kind: 'location' } })),
  semantics: ids.map((id, i) => ({ target: { recordId: `semantic-${i}` }, lifecycle: 'active',
    payload: { atlasId: id, reviewStatus: 'accepted', semanticKind: 'room', label: 'Side room' } })),
  bindings: [], relations: [], sourceStatuses: ['current'],
};
const house = {
  id: JSON.stringify(Object.values(scope)), name: 'Generated home', geometry: 'none',
  floors: [{ id: 'fl-index', name: 'Places', hasPlan: false, order: 0 }],
  spaces: [{ id: 'sp-generated', name: 'HomeBox room', floorId: 'fl-index', kind: 'service', geometry: 'none' }],
  items: [{ id: 'it-generated', name: 'Generated appliance', model: 'MODEL-42', category: 'Appliance', locationClaim: 'unknown' }],
  docs: [], tasks: [], containers: [], panels: [], circuits: [], outlets: [], valves: [], devices: [], cables: [],
  openings: [], loads: [], links: [], history: [], writes: [], people: [], sources: {},
};
const index = buildTopologyIndex(data, { scope, entries: [] }, new Map());
const nativeHits = nativePlaceSearch(index, 'ready', 'sIdE rOoM');
assert.equal(nativeHits.length, 3);
assert.equal(new Set(nativeHits.map(hit => hit.id)).size, 3);
assert(nativeHits.every(hit => hit.title.startsWith('Side room') && hit.context.includes(hit.id)));
assert(nativeHits.every(hit => hit.context.includes('Atlas name') && hit.context.includes('Atlas records: current')));
assert.equal(search(house, 'Side room').length, 0);
assert.equal(search(house, 'HomeBox room')[0].id, 'sp-generated');
assert.equal(search(house, 'MODEL-42')[0].id, 'it-generated');

// A qualified native label can differ from its HomeBox source label.
const boundEntry = { ...scope, source: { sourceInstanceId: 'generated-source', collectionId: 'generated-collection',
  sourceKind: 'homebox-entity', externalId: 'generated-room' }, entity: { name: 'HomeBox room' } };
const boundData = { ...data, bindings: [{ target: { recordId: 'generated-binding' }, lifecycle: 'active',
  payload: { reviewStatus: 'accepted', atlasId: ids[1], source: boundEntry.source } }] };
const boundIndex = buildTopologyIndex(boundData, { scope, entries: [boundEntry] }, new Map([['sp-generated', boundEntry]]));
assert.equal(boundIndex.locations.get(ids[1]).selectId, 'sp-generated');
assert.equal(boundIndex.locations.get(ids[1]).name, 'Side room');
const boundHit = nativePlaceSearch(boundIndex, 'ready', 'Side room').find(hit => hit.id === ids[1]);
const calls = [];
const ports = {
  select: id => calls.push({ type: 'select', sel: id }),
  chooseSaved: hit => calls.push({ type: 'saved', ...hit }),
  chooseBuilding: id => calls.push({ type: 'building', id }),
  dispatch: action => calls.push(action),
  close: () => calls.push({ type: 'search', open: false }),
};
assert(openNativePlaceSearchHit(boundHit, boundIndex, 'ready', house, ports));
assert.deepEqual(calls.splice(0), [{ type: 'saved', id: 'sp-generated', kind: 'space' }]);
assert(openNativePlaceSearchHit(nativeHits[0], index, 'ready', house, ports));
const placesActions = [{ type: 'select', sel: null }, { type: 'building', id: null },
  { type: 'view', view: 'rooms' }, { type: 'search', open: false }];
assert.deepEqual(calls.splice(0), placesActions);
// A join absent from the current visible saved view uses the native list route.
assert(openNativePlaceSearchHit(boundHit, boundIndex, 'ready', { ...house, spaces: [] }, ports));
assert.deepEqual(calls.splice(0), placesActions);
assert.deepEqual(nativePlaceSearch(null, 'loading', 'Side room'), []);
assert.deepEqual(nativePlaceSearch(index, 'unavailable', 'Side room'), []);
assert.equal(openNativePlaceSearchHit(nativeHits[0], null, 'loading', house, ports), false);
assert.equal(openNativePlaceSearchHit(nativeHits[0], boundIndex, 'unavailable', house, ports), false);
const replacedIndex = { ...index, locations: new Map(index.locations).set(nativeHits[0].id, { ...nativeHits[0].location }) };
assert.equal(openNativePlaceSearchHit(nativeHits[0], replacedIndex, 'ready', house, ports), false);
assert.deepEqual(calls, []);

// Actual SearchPalette render/events with an explicit synchronous hook seam.
// Effects, DOM focus, transport, actual React mounting and provider fences are
// not simulated. The existing provider owns read/session/lease fencing.
const key = 'houseatlas.native-place-search-healthy';
const stateExpr = `globalThis[Symbol.for(${JSON.stringify(key)})]`;
const harness = { q: '', stateSlot: 0, effects: [], calls, leases: 0,
  store: { house, projection: { house, view: { scope, entries: [] }, entries: new Map() },
    state: { view: 'atlas', atlasLens: null }, actions: {} },
};
harness.store.dispatch = action => calls.push(action);
harness.topology = { index, status: 'ready', activate() {
  harness.leases++;
  let active = true;
  return () => { if (active) { active = false; harness.leases--; } };
}, chooseBuilding: ports.chooseBuilding };
const hooks = moduleUrl(`
export function useState() { const s=${stateExpr}; return [s.stateSlot++ === 0 ? s.q : 0, () => {}]; }
export function useMemo(fn) { return fn(); }
export function useRef(current) { return { current }; }
export function useEffect(fn) { ${stateExpr}.effects.push(fn); }
export function useLayoutEffect() {}
`);
const store = moduleUrl(`export function useStore() { return ${stateExpr}.store; }
export function useSelect() { return id => ${stateExpr}.calls.push({type:'select', sel:id}); }`);
const topology = moduleUrl(`export function useTopology() { return ${stateExpr}.topology; }`);
const icon = await compile('../src/lantern/components/Icon.tsx', { 'react/jsx-runtime': jsxUrl });
const ui = await compile('../src/lantern/components/ui.tsx', {
  'react/jsx-runtime': jsxUrl, '../data/query': queryUrl, '../state/store': store, './Icon': icon,
});
const model = await compile('../src/app/model.ts');
const palette = await compile('../src/lantern/components/SearchPalette.tsx', {
  react: hooks, 'react/jsx-runtime': jsxUrl, '../data/query': queryUrl, '../data/time': time,
  '../state/store': store, './Icon': icon, './ui': ui, '../../app/model': model,
  '../topology/TopologyProvider': topology,
  '../topology/search': new URL('../src/lantern/topology/search.ts', import.meta.url).href,
});
const { SearchPalette } = await import(palette);
function nodes(node) {
  if (!node || typeof node !== 'object') return [];
  if (Array.isArray(node)) return node.flatMap(nodes);
  return [node, ...nodes(node.props?.children)];
}
function render(q, currentIndex = index, status = 'ready') {
  harness.q = q; harness.stateSlot = 0; harness.effects = [];
  harness.topology = { ...harness.topology, index: currentIndex, status };
  const tree = SearchPalette();
  return { tree, markup: renderToStaticMarkup(tree), options: nodes(tree).filter(node => node.props?.role === 'option') };
}
globalThis[Symbol.for(key)] = harness;
try {
  const opened = render('Side room');
  assert.equal(opened.options.length, 3);
  assert(opened.markup.includes('Atlas identity') && opened.markup.includes('Opens whole-home Places'));
  const release = harness.effects[0]();
  assert.equal(harness.leases, 1);
  opened.options[0].props.onClick();
  assert.deepEqual(calls.splice(0), placesActions);
  const input = nodes(opened.tree).find(node => node.props?.role === 'combobox');
  let prevented = false;
  input.props.onKeyDown({ key: 'Enter', preventDefault() { prevented = true; } });
  assert(prevented);
  assert.deepEqual(calls.splice(0), placesActions);
  release(); release(); assert.equal(harness.leases, 0);
  // Serial retirement/reopen: only the currently supplied provider index is used.
  const retired = render('Side room', null, 'loading');
  assert.equal(retired.options.length, 0);
  assert(retired.markup.includes('Loading Atlas places') && retired.markup.includes('No matching saved records'));
  const reopened = render('Side room', replacedIndex);
  assert.equal(reopened.options.length, 3);
  const releaseReopen = harness.effects[0]();
  assert.equal(harness.leases, 1); releaseReopen(); assert.equal(harness.leases, 0);
  const unavailable = render('MODEL-42', null, 'unavailable');
  assert.equal(unavailable.options.length, 1);
  assert(unavailable.markup.includes('Atlas places are unavailable') && unavailable.markup.includes('Generated appliance'));
  const oldPlace = render('HomeBox room');
  oldPlace.options[0].props.onClick();
  assert.deepEqual(calls.splice(0), [{ type: 'select', sel: 'sp-generated' }, { type: 'search', open: false }]);
  const boundRender = render('Side room', boundIndex);
  boundRender.options.find(node => node.props.children[1].props.children.startsWith(boundHit.title)).props.onClick();
  assert.deepEqual(calls.splice(0), [{ type: 'select', sel: 'sp-generated' }, { type: 'search', open: false }]);
} finally {
  delete globalThis[Symbol.for(key)];
}
console.log('PASS generated native-place search, distinct identities, saved/model queries, current-hit navigation, serial activation/release and coverage markup; no browser/provider qualification');
