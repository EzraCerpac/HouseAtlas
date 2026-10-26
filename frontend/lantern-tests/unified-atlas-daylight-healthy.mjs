// Named ordinary positive: generated time-of-day lighting for the unified
// Atlas (#339). The pinned SunCalc places the sun for a neutral reference
// place, which a release or a device can replace; the light changes smoothly through a day, never falls below a
// readable floor, and turns with the model's north; the appearance table
// carries the shelter, kept-tone, glazing and emitter flags and the lamp points
// only when daylight is given, building glass moves to its own see-through pass
// with its opacity and frost, and leaves every other viewer as before. Pure source only: no browser, GPU,
// network, household location or data.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { transformWithOxc } from 'vite';

assert.equal(process.version, 'v26.10.0');
assert.deepEqual(process.argv.slice(2), [], 'This runner takes no arguments');
const frontend = new URL('../', import.meta.url);
const dataURL = code => `data:text/javascript;base64,${Buffer.from(code).toString('base64')}`;
async function sourceURL(relative, replacements = {}) {
  const file = new URL(relative, import.meta.url);
  let { code } = await transformWithOxc(readFileSync(file, 'utf8'), file.pathname, { lang: 'ts', target: 'esnext', tsconfig: false, sourcemap: false });
  for (const [specifier, url] of Object.entries(replacements)) {
    assert.ok(code.includes(JSON.stringify(specifier)), `Missing import ${specifier} in ${relative}`);
    code = code.replaceAll(JSON.stringify(specifier), JSON.stringify(url));
  }
  for (const match of code.matchAll(/^\s*import\s+(?:[\w$\s{},*]+?\s+from\s+)?["']([^"']+)["']/gm))
    assert.ok(match[1].startsWith('data:') || match[1].startsWith('file:'), `Unexpected import ${match[1]} in ${relative}`);
  return dataURL(code);
}
const suncalc = new URL('./node_modules/suncalc/index.js', frontend).href;
const { daylightAt, modelDirection, resolveSunPlace, stageColors } = await import(await sourceURL('../src/lantern/unified-atlas/daylight.ts', { suncalc }));
const geometryURL = await sourceURL('../src/lantern/canonical-ifc/geometry.ts');
const { writeAppearance, STATE_FLOATS, MAX_LAMPS, MeshPass } = await import(await sourceURL('../src/lantern/canonical-ifc/mesh-appearance.ts', { './geometry': geometryURL }));
const { prepareMeshes, primitiveNight, primitiveRoughness } = await import(geometryURL);

const near = (actual, expected, tolerance, label) => assert.ok(Math.abs(actual - expected) <= tolerance, `${label}: ${actual} not within ${tolerance} of ${expected}`);
const vec = (actual, expected, label) => expected.forEach((value, at) => near(actual[at], value, 1e-9, `${label}[${at}]`));

// Bearings: X east and -Z north in an unturned model; turning north turns them all.
vec(modelDirection(0, 0, 0), [0, 0, -1], 'north');
vec(modelDirection(90, 0, 0), [1, 0, 0], 'east');
vec(modelDirection(180, 0, 0), [0, 0, 1], 'south');
vec(modelDirection(0, 90, 0), [0, 1, 0], 'zenith');
vec(modelDirection(0, 0, 90), [1, 0, 0], 'north turned a quarter clockwise');
vec(modelDirection(90, 0, 90), [0, 0, 1], 'east turned a quarter clockwise');

// A neutral reference place (the Greenwich meridian), not any household location.
const place = { latitude: 51.48, longitude: 0, northDeg: 0 };
const solstice = daylightAt(new Date('2026-06-21T12:00:00Z'), place);
near(solstice.altitude, 62, 1, 'midsummer noon altitude');
assert.equal(solstice.night, false);
assert.equal(solstice.direct, 1);
assert.equal(solstice.lamp, 0);
assert.deepEqual([...solstice.tint], [1, 1, 1], 'full day draws the tones as before');
assert.deepEqual([...solstice.sunTint], [1, 1, 1]);
assert.ok(solstice.toward[2] > .4 && Math.abs(solstice.toward[0]) < .05, 'noon sun stands in the south');
near(Math.hypot(...solstice.toward), 1, 1e-9, 'sun direction is a unit vector');
assert.equal(solstice.dusk, 0);

const midnight = daylightAt(new Date('2026-12-21T00:00:00Z'), place);
assert.equal(midnight.night, true);
assert.deepEqual([...midnight.toward], [0, 1, 0], 'after sunset the map is drawn from the zenith');
assert.equal(midnight.direct, 0);
assert.equal(midnight.lamp, 1);
assert.equal(midnight.dusk, 1);

// Turning the model's north turns the sun with it, about the vertical only.
const turned = daylightAt(new Date('2026-06-21T12:00:00Z'), { ...place, northDeg: 90 });
near(turned.toward[1], solstice.toward[1], 1e-9, 'altitude kept');
near(turned.toward[0], -solstice.toward[2], 1e-9, 'south moved onto -X');

// Where the sun is from: a device's location over the release's, the release's
// north always, and a neutral reference with north along -Z when neither says.
const release = { latitude: -33.9, longitude: 18.4, northDeg: 12 }, device = { latitude: 60, longitude: 25 };
assert.deepEqual(resolveSunPlace(null, null), { latitude: 51.48, longitude: 0, northDeg: 0, source: 'default' });
assert.deepEqual(resolveSunPlace(null, release), { ...release, source: 'model' });
assert.deepEqual(resolveSunPlace(device, release), { ...device, northDeg: 12, source: 'device' });
assert.deepEqual(resolveSunPlace(device, null), { ...device, northDeg: 0, source: 'device' });
// Settings keeps the shown release's location across views, but only while
// that home and publication are still the selected ones.
const react = new URL('./node_modules/react/index.js', frontend).href;
const { modelGeographicFor, showModelGeographic } = await import(await sourceURL('../src/lantern/unified-atlas/sun-place.ts', { react, './daylight': await sourceURL('../src/lantern/unified-atlas/daylight.ts', { suncalc }) }));
const chosen = { owner: {}, scope: { workspaceId: 'w', homeId: 'h' }, expiresAt: '', publicationId: 'p', manifestSha256: '' };
showModelGeographic({ workspaceId: 'w', homeId: 'h', publicationId: 'p' }, release);
assert.deepEqual(modelGeographicFor(chosen), release);
assert.equal(modelGeographicFor(null), null, 'No selected publication, no release location');
assert.equal(modelGeographicFor({ ...chosen, scope: { workspaceId: 'w', homeId: 'other' } }), null, 'Another home');
assert.equal(modelGeographicFor({ ...chosen, publicationId: 'next' }), null, 'Another publication');

// Through a whole winter and a whole summer day, a minute at a time: nothing
// jumps, the sky never falls below a readable share, lamps only after sunset.
for (const day of ['2026-06-21', '2026-12-21', '2026-10-26']) {
  let last = null;
  for (let minute = 0; minute <= 24 * 60; minute++) {
    const light = daylightAt(new Date(Date.parse(`${day}T00:00:00Z`) + minute * 60_000), place);
    for (const value of [...light.tint, ...light.sunTint, ...light.lampTint, light.direct, light.lamp, light.dusk])
      assert.ok(Number.isFinite(value), `${day} +${minute} min is finite`);
    assert.ok(Math.min(...light.tint) >= .5, `${day} +${minute} min keeps the readable floor`);
    assert.ok(Math.max(...light.tint, ...light.sunTint, ...light.lampTint) <= 1.1);
    if (!light.night) assert.equal(light.lamp, 0, `${day} +${minute} min: no lamps while the sun is up`);
    else assert.equal(light.direct, 0, `${day} +${minute} min: no direct sun after sunset`);
    if (last) for (const key of ['direct', 'lamp', 'dusk']) assert.ok(Math.abs(light[key] - last[key]) < .05, `${day} +${minute} min ${key} is smooth`);
    if (last) light.tint.forEach((value, at) => assert.ok(Math.abs(value - last.tint[at]) < .02, `${day} +${minute} min tint is smooth`));
    last = light;
  }
}

// Stage colours: the day values are the stylesheet's own fallbacks.
assert.deepEqual(stageColors(0), { '--ua-glow': '#fffaf0', '--ua-sky-top': '#f1e9da', '--ua-sky-bottom': '#ddd0b7',
  '--ua-board-lit': '#ecdbb4', '--ua-board-shade': '#d4b988', '--ua-board-edge': '#8f7046' });
const css = readFileSync(new URL('../src/lantern/unified-atlas/unified-atlas.css', import.meta.url), 'utf8');
for (const [name, value] of Object.entries(stageColors(0))) assert.ok(css.includes(`var(${name}, ${value})`), `${name} falls back to ${value}`);
assert.notDeepEqual(stageColors(1), stageColors(0));

// Appearance: daylight adds the shelter and kept-tone flags in texel 7, and
// frame values default to plain light for every viewer that does not opt in.
const mesh = (meshKey, occurrenceId = null) => ({ meshKey, occurrenceId, floorId: 'f', triangles: 1, vertices: new Float32Array(18),
  bounds: { min: [0, 0, 0], max: [1, 1, 1] } });
const meshes = [mesh('wall'), mesh('room', 'o:room'), mesh('tree')];
const base = { rules: { visibleFloors: 'all', clipY: null }, currentFloorId: 'f', selectedOccurrenceId: 'o:room', contextOccurrenceIds: [], tints: new Map() };
const plain = new Float32Array(meshes.length * STATE_FLOATS), plainFrame = writeAppearance(meshes, { ...base, twoSided: true }, plain);
assert.equal(plainFrame.direct, 1); assert.equal(plainFrame.night, false); assert.equal(plainFrame.lamp, 0);
assert.deepEqual([...plainFrame.tint, ...plainFrame.sunTint, ...plainFrame.lampTint], [1, 1, 1, 1, 1, 1, 1, 1, 1]);
for (let at = 0; at < meshes.length; at++) assert.deepEqual([...plain.subarray(at * STATE_FLOATS + 28, at * STATE_FLOATS + 32)], [0, 0, 0, 0]);
const lit = new Float32Array(meshes.length * STATE_FLOATS);
const frame = writeAppearance(meshes, { ...base, twoSided: true, light: [0, 1, 0], daylight: midnight, shelterKeys: new Set(['wall']) }, lit);
assert.equal(frame.night, true); assert.equal(frame.lamp, 1); assert.equal(frame.direct, 0);
vec(frame.light, [0, 1, 0], 'night light');
const flags = at => [...lit.subarray(at * STATE_FLOATS + 28, at * STATE_FLOATS + 30)];
assert.deepEqual(flags(0), [1, 0], 'a shelter mesh roofs the house over');
assert.deepEqual(flags(1), [0, 1], 'the selected room keeps its tone');
assert.deepEqual(flags(2), [0, 0], 'other meshes take the hour as drawn');
// Without twoSided (every other viewer) daylight is ignored.
const other = new Float32Array(meshes.length * STATE_FLOATS), otherFrame = writeAppearance(meshes, { ...base, daylight: midnight, shelterKeys: new Set(['wall']) }, other);
assert.equal(otherFrame.lamp, 0); assert.equal(otherFrame.direct, 1); assert.deepEqual([...otherFrame.tint], [1, 1, 1]);
for (let at = 0; at < meshes.length; at++) assert.deepEqual([...other.subarray(at * STATE_FLOATS + 28, at * STATE_FLOATS + 30)], [0, 0]);

// Night marks: the producer's core emissive factor and blended glass first;
// until a model carries them, generic glass and lamp words in material names.
const gltf = materials => ({ meshes: [{ primitives: materials.map((_, material) => ({ material })) }], materials });
const night = materials => materials.map((_, at) => primitiveNight(gltf(materials), 0, at));
assert.deepEqual(night([
  { emissiveFactor: [.9, .7, .4] }, { emissiveFactor: [0, 0, 0] }, { alphaMode: 'BLEND', pbrMetallicRoughness: { baseColorFactor: [.5, .6, .7, .3] } },
  { alphaMode: 'BLEND', pbrMetallicRoughness: { baseColorFactor: [.5, .6, .7, 1] } }, { name: 'Clear glazing' }, { name: 'Porch lamp glass' },
  { name: 'Bulb' }, { name: 'Lamp housing metal' }, { name: 'Glassy paint', emissiveFactor: [0, 0, 0] }, {},
  { name: 'Lamp lens backing', emissiveFactor: [0, 0, 0] },
]), ['emitter', undefined, 'glazing', undefined, 'glazing', 'emitter', 'emitter', undefined, undefined, undefined, 'glazing']);
// The name fallback reads the material's own name only, never its mesh's or node's.
assert.equal(primitiveNight({ meshes: [{ name: 'Lamp lens', primitives: [{ material: 0 }] }], nodes: [{ name: 'Headlamp', mesh: 0 }], materials: [{ name: 'Backing' }] }, 0, 0), undefined);
assert.equal(primitiveNight(gltf([{}]), 0, 1), undefined, 'a primitive without a material');
assert.equal(primitiveNight({ meshes: [{ primitives: [{}] }] }, 0, 0), undefined);

// Night flags in texel 7 and lamp points: only with daylight, only shown emitters,
// lifted with their mesh, close ones merged, at most MAX_LAMPS.
const at = (key, x, z = 0) => ({ ...mesh(key), bounds: { min: [x, 0, z], max: [x + .2, .2, z + .2] } });
const lit7 = [at('glass', 0), at('lamp-a', 4), at('lamp-b', 4.3), at('lamp-far', 9), at('hidden-lamp', 20)];
const nightTable = new Float32Array(lit7.length * STATE_FLOATS);
const nightFrame = writeAppearance(lit7, { ...base, selectedOccurrenceId: null, twoSided: true, light: [0, 1, 0], daylight: midnight,
  glazingKeys: new Set(['glass']), emitterKeys: new Set(['lamp-a', 'lamp-b', 'lamp-far', 'hidden-lamp']),
  hiddenKeys: new Set(['hidden-lamp']), lifts: new Map([['lamp-far', 3]]) }, nightTable);
const marks = index => [...nightTable.subarray(index * STATE_FLOATS + 30, index * STATE_FLOATS + 32)];
assert.deepEqual(lit7.map((_, index) => marks(index)), [[1, 0], [0, 1], [0, 1], [0, 1], [0, 1]]);
assert.equal(nightFrame.lamps.length, 2, 'two close lamps light as one; a hidden one throws no light');
vec(nightFrame.lamps[0].at, [4.25, .1, .1], 'merged lamp point');
vec(nightFrame.lamps[1].at, [9.1, 3.1, .1], 'lifted lamp point');
assert.deepEqual(nightFrame.lamps.map(lamp => lamp.aim), [null, null], 'unaimed lamps light all around');

// Building glass: its own see-through pass, out of the solid passes, covering what lies
// behind by its material alpha (or a light default) and frosted by its roughness;
// a selected pane keeps the solid pick tone, and without daylight nothing changes.
assert.equal(nightTable[STATE_FLOATS * 0 + 20], MeshPass.Glass);
assert.ok(nightFrame.passes.has(MeshPass.Glass));
const panes = [{ ...mesh('clear') }, { ...mesh('tinted'), sourceBaseColor: [.4, .5, .6, .3], sourceRoughness: .9 }, { ...mesh('half'), sourceRoughness: .5 },
  { ...mesh('picked') }, { ...mesh('heavy'), sourceBaseColor: [0, 0, 0, .99] }];
const paneTable = new Float32Array(panes.length * STATE_FLOATS);
const paneFrame = writeAppearance(panes, { ...base, twoSided: true, light: [0, 1, 0], daylight: midnight, selectedKeys: new Set(['picked']),
  glazingKeys: new Set(panes.map(row => row.meshKey)) }, paneTable);
const paneRow = index => [paneTable[index * STATE_FLOATS + 20], ...paneTable.subarray(index * STATE_FLOATS + 26, index * STATE_FLOATS + 28)].map(value => Math.round(value * 100) / 100);
assert.deepEqual(panes.map((_, index) => paneRow(index)), [[4, .1, 0], [4, .3, 1], [4, .1, 0], [MeshPass.Unbound, 0, 0], [4, .85, 0]]);
assert.ok(!paneFrame.passes.has(MeshPass.Bound));
const paneless = new Float32Array(panes.length * STATE_FLOATS);
writeAppearance(panes, { ...base, glazingKeys: new Set(panes.map(row => row.meshKey)) }, paneless);
assert.ok(panes.every((_, index) => paneless[index * STATE_FLOATS + 20] === MeshPass.Unbound && paneless[index * STATE_FLOATS + 26] === 0));
const roughGltf = factor => ({ meshes: [{ primitives: [{ material: 0 }] }], materials: [{ pbrMetallicRoughness: { roughnessFactor: factor } }] });
assert.equal(primitiveRoughness(roughGltf(.2), 0, 0), .2);
assert.equal(primitiveRoughness(roughGltf(2), 0, 0), undefined, 'an out-of-range roughness is not read');
assert.equal(primitiveRoughness({ meshes: [{ primitives: [{ material: 0 }] }], materials: [{}] }, 0, 0), undefined);
assert.equal(prepareMeshes([{ meshKey: 'g', floorId: null, occurrenceId: null, positions: new Float32Array(9), indices: new Uint32Array([0, 1, 2]),
  sourceNight: 'glazing', sourceRoughness: .7 }])[0].sourceRoughness, .7);

// Aimed lamps: an emitter whose glowing faces mostly face one way (a lens) beams
// that way; a closed or all-round one (a bulb, a glass box) does not; nothing else aims.
const quad = (x, z) => new Float32Array([x, 0, z, x, 1, z, x, 0, z + 1, x, 1, z + 1]);
const box = new Float32Array([0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0, 0, 0, 1, 1, 0, 1, 1, 1, 1, 0, 1, 1]);
const boxFaces = new Uint32Array([0, 2, 1, 0, 3, 2, 4, 5, 6, 4, 6, 7, 0, 1, 5, 0, 5, 4, 3, 7, 6, 3, 6, 2, 0, 4, 7, 0, 7, 3, 1, 2, 6, 1, 6, 5]);
const [lens, lensFlipped, bulb, pane] = prepareMeshes([
  { meshKey: 'lens', floorId: null, occurrenceId: null, positions: quad(0, 0), indices: new Uint32Array([0, 1, 2, 1, 3, 2]), sourceNight: 'emitter' },
  { meshKey: 'lens-back', floorId: null, occurrenceId: null, positions: quad(0, 0), indices: new Uint32Array([0, 2, 1, 1, 2, 3]), sourceNight: 'emitter' },
  { meshKey: 'bulb', floorId: null, occurrenceId: null, positions: box, indices: boxFaces, sourceNight: 'emitter' },
  { meshKey: 'pane', floorId: null, occurrenceId: null, positions: quad(0, 0), indices: new Uint32Array([0, 2, 1, 1, 2, 3]), sourceNight: 'glazing' },
]);
vec(lens.aim, [1, 0, 0], 'a lens aims along its outward face'); vec(lensFlipped.aim, [-1, 0, 0], 'its winding decides which way');
assert.equal(bulb.aim, undefined, 'a closed emitter lights all around'); assert.equal(pane.aim, undefined, 'only emitters aim');
const aimed = (key, x, aim) => ({ ...at(key, x), aim });
const beams = [aimed('left', 0, [0, 0, 1]), aimed('left-b', .3, [0, .6, .8]), aimed('right', .5, [1, 0, 0]), at('round', .2)];
const beamFrame = writeAppearance(beams, { ...base, twoSided: true, light: [0, 1, 0], daylight: midnight, emitterKeys: new Set(beams.map(row => row.meshKey)) },
  new Float32Array(beams.length * STATE_FLOATS));
assert.equal(beamFrame.lamps.length, 3, 'close beams merge only when aimed alike, and never with an all-round lamp');
vec(beamFrame.lamps[0].aim, [0, .6 / Math.hypot(.6, 1.8), 1.8 / Math.hypot(.6, 1.8)], 'merged beams share their direction');
assert.deepEqual(beamFrame.lamps.slice(1).map(lamp => lamp.aim), [[1, 0, 0], null]);
const many = Array.from({ length: MAX_LAMPS + 4 }, (_, index) => at(`lamp-${index}`, index * 2));
assert.equal(writeAppearance(many, { ...base, twoSided: true, light: [0, 1, 0], daylight: midnight, emitterKeys: new Set(many.map(row => row.meshKey)) },
  new Float32Array(many.length * STATE_FLOATS)).lamps.length, MAX_LAMPS);
// A lamp the section cuts away whole throws no light; one the cut reaches still does.
const ceiling = { ...mesh('ceiling-lamp'), bounds: { min: [0, 2.8, 0], max: [.2, 3, .2] } }, wall = { ...at('wall-lamp', 5), bounds: { min: [5, 1.5, 0], max: [5.2, 2.5, .2] } };
assert.equal(writeAppearance([ceiling, wall], { ...base, twoSided: true, light: [0, 1, 0], daylight: midnight, rules: { ...base.rules, clipY: 2 },
  emitterKeys: new Set(['ceiling-lamp', 'wall-lamp']) }, new Float32Array(2 * STATE_FLOATS)).lamps.length, 1);
// Lamps are gathered only while they are on, and many far-apart emitters stay cheap.
assert.deepEqual(writeAppearance(lit7, { ...base, twoSided: true, light: [0, 1, 0], daylight: { ...midnight, lamp: 0 },
  emitterKeys: new Set(['lamp-a']) }, new Float32Array(lit7.length * STATE_FLOATS)).lamps, []);
const crowd = Array.from({ length: 20_000 }, (_, index) => at(`crowd-${index}`, (index % 200) * 2, Math.floor(index / 200) * 2));
const timed = emitterKeys => {
  const started = performance.now();
  const frame = writeAppearance(crowd, { ...base, twoSided: true, light: [0, 1, 0], daylight: midnight, emitterKeys }, new Float32Array(crowd.length * STATE_FLOATS));
  return { frame, ms: performance.now() - started };
};
const unlit = timed(new Set()), crowded = timed(new Set(crowd.map(row => row.meshKey)));
assert.equal(crowded.frame.lamps.length, MAX_LAMPS);
assert.ok(crowded.ms < unlit.ms * 6 + 100, `20,000 separate emitters took ${Math.round(crowded.ms)} ms, against ${Math.round(unlit.ms)} ms without lamps`);
const dayless = new Float32Array(lit7.length * STATE_FLOATS);
assert.deepEqual(writeAppearance(lit7, { ...base, glazingKeys: new Set(['glass']), emitterKeys: new Set(['lamp-a']) }, dayless).lamps, []);
assert.ok(dayless.every((value, index) => index % STATE_FLOATS < 30 || value === 0), 'other viewers never get night marks');

console.log('unified-atlas-daylight-healthy: ok');
