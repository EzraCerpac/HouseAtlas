// Named ordinary positive: generated time-of-day lighting for the unified
// Atlas (#339). The pinned SunCalc places the sun for a neutral reference
// place, which a release or a device can replace; the light changes smoothly through a day, never falls below a
// readable floor, and turns with the model's north; the sky lights a face by its
// direction (#438), warm toward a low sun and cool away; the appearance table
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
const skyURL = await sourceURL('../src/lantern/canonical-ifc/sky-light.ts');
const daylightURL = await sourceURL('../src/lantern/unified-atlas/daylight.ts', { suncalc, '../canonical-ifc/sky-light': skyURL });
const { daylightAt, modelDirection, resolveSunPlace, stageBackdrop, stageColors, STAGE_GLOW_AT, STAGE_GLOW_RADII } = await import(daylightURL);
const { FLAT_SKY, LUMA } = await import(skyURL);
const geometryURL = await sourceURL('../src/lantern/canonical-ifc/geometry.ts');
const { writeAppearance, STATE_FLOATS, MAX_LAMPS, LAMP_COLOR, MeshPass, GLOW_STOPS } = await import(await sourceURL('../src/lantern/canonical-ifc/mesh-appearance.ts', { './geometry': geometryURL, './sky-light': skyURL }));
const { prepareMeshes, primitiveGlow, primitiveNight, primitiveRoughness } = await import(geometryURL);

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

// The sky's light by face direction (#438), as the shader evaluates its nine terms.
const irradiance = ({ irradiance: t }, [x, y, z]) => [0, 1, 2].map(c => t[c] + t[3 + c] * y + t[6 + c] * z + t[9 + c] * x + t[12 + c] * x * y
  + t[15 + c] * y * z + t[18 + c] * (3 * z * z - 1) + t[21 + c] * x * z + t[24 + c] * (x * x - y * y));
const luma = rgb => rgb.reduce((sum, value, c) => sum + value * LUMA[c], 0);
const warmth = rgb => rgb[0] / rgb[2];
// Without daylight the sky is the flat term drawn before: 0.7 looking down, 1.1 up, white.
vec(irradiance(FLAT_SKY, [0, 1, 0]), [1.1, 1.1, 1.1], 'flat sky up');
vec(irradiance(FLAT_SKY, [0, -1, 0]), [.7, .7, .7], 'flat sky down');
vec(irradiance(FLAT_SKY, [1, 0, 0]), [.9, .9, .9], 'flat sky side');
for (const at of ['2026-06-21T12:00:00Z', '2026-06-21T19:30:00Z', '2026-06-21T20:30:00Z', '2026-06-21T23:30:00Z']) {
  const { sky, altitude } = daylightAt(new Date(at), place);
  near(luma(irradiance(sky, [0, 1, 0])), 1.1, 1e-6, `sky looking up at ${at}`);
  assert.ok(luma(irradiance(sky, [0, -1, 0])) < luma(irradiance(sky, [1, 0, 0])), `the ground gives less than the sky at ${at}`);
  assert.equal(sky.irradiance.length, 27);
  assert.ok(sky.irradiance.every(Number.isFinite));
  // A wall facing the sun's side reads grey, so the hour's tint keeps the overall colour.
  const g = sky.glowToward, side = irradiance(sky, [-g[2], 0, g[0]]);
  assert.ok(Math.max(...side) - Math.min(...side) < 1e-6, `side wall grey at ${at}`);
  const toward = irradiance(sky, [g[0], 0, g[2]]), away = irradiance(sky, [-g[0], 0, -g[2]]);
  if (altitude > 20) assert.ok(Math.abs(warmth(toward) - warmth(away)) < .06, 'midday keeps the drawn palette');
  else if (altitude > -6) assert.ok(warmth(toward) > warmth(away) + .1, `low sun: walls toward it warmer than away at ${at}`);
  else assert.ok(Math.abs(warmth(toward) - warmth(away)) < .1, `deep night is even at ${at}`);
}

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
const { modelGeographicFor, showModelGeographic } = await import(await sourceURL('../src/lantern/unified-atlas/sun-place.ts', { react, './daylight': daylightURL }));
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
// The backdrop the surroundings fade into is the stage the stylesheet paints, at every hour.
for (const dusk of [0, .5, 1]) {
  const colors = stageColors(dusk), backdrop = stageBackdrop(dusk);
  assert.deepEqual([backdrop.top, backdrop.bottom, backdrop.glow], [colors['--ua-sky-top'], colors['--ua-sky-bottom'], colors['--ua-glow']]);
}
const percent = value => `${Math.round(value * 100)}%`;
assert.ok(css.includes(`radial-gradient(ellipse ${percent(STAGE_GLOW_RADII[0])} ${percent(STAGE_GLOW_RADII[1])} at ${percent(STAGE_GLOW_AT[0])} ${percent(STAGE_GLOW_AT[1])}, var(--ua-glow, #fffaf0) ${percent(GLOW_STOPS[0].at)}, `
  + `color-mix(in srgb, var(--ua-glow, #fffaf0) ${percent(GLOW_STOPS[1].alpha)}, transparent) ${percent(GLOW_STOPS[1].at)}, transparent ${percent(GLOW_STOPS[2].at)})`),
  'the shader paints the glow the stylesheet does');
assert.ok(css.includes('linear-gradient(176deg, var(--ua-sky-top, #f1e9da) 0%, var(--ua-sky-bottom, #ddd0b7) 100%)'), 'and the sky under it');

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
assert.deepEqual(lit7.map((_, index) => marks(index)), [[0, 0], [0, 1], [0, 1], [0, 1], [0, 1]]);
assert.equal(nightFrame.lamps.length, 2, 'two close lamps light as one; a hidden one throws no light');
vec(nightFrame.lamps[0].at, [4.25, .1, .1], 'merged lamp point');
vec(nightFrame.lamps[1].at, [9.1, 3.1, .1], 'lifted lamp point');
assert.deepEqual(nightFrame.lamps.map(lamp => lamp.aim), [null, null], 'unaimed lamps light all around');

// Lamp colour: the hue of the emissive factor, brightest channel 1, its strength unread;
// a lamp known only by name keeps the warm default. The colour sits in texel 8 of each
// shown emitter and on its lamp point, and lamps that merge mix theirs by count.
const glows = materials => materials.map((_, index) => primitiveGlow(gltf(materials), 0, index));
assert.deepEqual(glows([{ emissiveFactor: [.5, .25, 0] }, { emissiveFactor: [.2, .4, .8] }, { emissiveFactor: [0, 0, 0] }, { name: 'Lamp glass' },
  { emissiveFactor: [1, -1, 0] }, { emissiveFactor: [1, 1] }]), [[1, .5, 0], [.25, .5, 1], undefined, undefined, undefined, undefined]);
const [blue, unlitPane] = prepareMeshes([
  { meshKey: 'blue', floorId: null, occurrenceId: null, positions: new Float32Array(9), indices: new Uint32Array([0, 1, 2]), sourceNight: 'emitter', sourceGlow: [.25, .5, 1] },
  { meshKey: 'pane', floorId: null, occurrenceId: null, positions: new Float32Array(9), indices: new Uint32Array([0, 1, 2]), sourceNight: 'glazing', sourceGlow: [1, 0, 0] },
]);
assert.deepEqual(blue.sourceGlow, [.25, .5, 1]); assert.equal(unlitPane.sourceGlow, undefined, 'only emitters carry a colour');
const hued = [{ ...at('red', 0), sourceGlow: [1, 0, 0] }, { ...at('white', .3), sourceGlow: [1, 1, 1] }, { ...at('white-b', .5), sourceGlow: [1, 1, 1] },
  at('named', 6), at('dark', 12)];
const hueTable = new Float32Array(hued.length * STATE_FLOATS);
const hueFrame = writeAppearance(hued, { ...base, twoSided: true, light: [0, 1, 0], daylight: midnight,
  emitterKeys: new Set(['red', 'white', 'white-b', 'named']) }, hueTable);
const texel8 = index => [...hueTable.subarray(index * STATE_FLOATS + 32, index * STATE_FLOATS + 36)];
assert.deepEqual(hued.map((_, index) => texel8(index)), [[1, 0, 0, 0], [1, 1, 1, 0], [1, 1, 1, 0], [...LAMP_COLOR, 0].map(Math.fround), [0, 0, 0, 0]]);
vec(hueFrame.lamps[0].color, [1, 2 / 3, 2 / 3], 'three merged lamps mix their colours by count');
assert.deepEqual(hueFrame.lamps[1].color, LAMP_COLOR, 'a lamp with no stated colour stays warm');

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
const paneRow = index => [paneTable[index * STATE_FLOATS + 20], paneTable[index * STATE_FLOATS + 27], paneTable[index * STATE_FLOATS + 30]].map(value => Math.round(value * 100) / 100);
assert.deepEqual(panes.map((_, index) => paneRow(index)), [[4, .1, 0], [4, .3, 1], [4, .1, 0], [MeshPass.Unbound, 0, 0], [4, .85, 0]]);
assert.ok(!paneFrame.passes.has(MeshPass.Bound));
const paneless = new Float32Array(panes.length * STATE_FLOATS);
writeAppearance(panes, { ...base, glazingKeys: new Set(panes.map(row => row.meshKey)) }, paneless);
assert.ok(panes.every((_, index) => paneless[index * STATE_FLOATS + 20] === MeshPass.Unbound && paneless[index * STATE_FLOATS + 27] === 0));
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
// Room volumes are flagged only with daylight, and the frame says whether any exist.
const roomed = writeAppearance(lit7, { ...base, twoSided: true, light: [0, 1, 0], daylight: midnight, roomKeys: new Set(['glass']) }, nightTable);
assert.equal(roomed.rooms, true); assert.deepEqual(lit7.map((_, index) => nightTable[index * STATE_FLOATS + 26]), [1, 0, 0, 0, 0]);
assert.equal(writeAppearance(lit7, { ...base, twoSided: true, light: [0, 1, 0], roomKeys: new Set(['glass']) }, nightTable).rooms, false);
assert.equal(nightTable[26], 0, 'no room flag without daylight');
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
assert.ok(dayless.every((value, index) => index % STATE_FLOATS < 30 || value === 0), 'other viewers never get night marks or lamp colours');

// Surroundings: flagged in texel 8.w only for twoSided viewers that give them; a mesh wholly
// past the far edge of the fade is not drawn, one that reaches inside it is.
const spot = (meshKey, x0, x1) => ({ ...mesh(meshKey), bounds: { min: [x0, 0, 0], max: [x1, 1, 1] } });
const tall = { ...spot('tall', 44, 48), bounds: { min: [44, 0, 0], max: [48, 12, 1] } };
const around = [spot('house', -5, 5), spot('near-tree', 8, 9), spot('far-hill', 30, 60), spot('past', 44, 48), tall];
const surroundings = { keys: new Set(['near-tree', 'far-hill', 'past', 'tall']), center: [0, .5], half: [5, .5], near: 4, far: 36, ground: 0, lean: 2,
  backdrop: { top: '#ff0000', bottom: '#00ff00', glow: '#0000ff', glowAt: [.5, .5], glowRadii: [1, 1] } };
const aroundTable = new Float32Array(around.length * STATE_FLOATS);
const aroundFrame = writeAppearance(around, { ...base, twoSided: true, surroundings }, aroundTable);
assert.deepEqual(around.map((_, index) => aroundTable[index * STATE_FLOATS + 35]), [0, 1, 1, 1, 1], 'surroundings carry the fade flag');
assert.deepEqual(around.map((_, index) => aroundTable[index * STATE_FLOATS + 20]), [MeshPass.Unbound, MeshPass.Unbound, MeshPass.Unbound, MeshPass.None, MeshPass.Unbound],
  'only surroundings seen against ground wholly past the fade are left out; a tall one can stand against nearer ground');
assert.deepEqual(aroundFrame.fade, { center: [0, .5], half: [5, .5], near: 4, far: 36, ground: 0,
  backdrop: { top: [1, 0, 0], bottom: [0, 1, 0], glow: [0, 0, 1], glowAt: [.5, .5], glowRadii: [1, 1] } }, 'backdrop colours as display values');
const flat = new Float32Array(around.length * STATE_FLOATS), flatFrame = writeAppearance(around, { ...base, surroundings }, flat);
assert.equal(flatFrame.fade, null); assert.ok(around.every((_, index) => flat[index * STATE_FLOATS + 35] === 0 && flat[index * STATE_FLOATS + 20] !== MeshPass.None),
  'viewers without twoSided lighting never fade or drop anything');
assert.equal(writeAppearance(around, { ...base, twoSided: true }, new Float32Array(around.length * STATE_FLOATS)).fade, null);

console.log('unified-atlas-daylight-healthy: ok');
