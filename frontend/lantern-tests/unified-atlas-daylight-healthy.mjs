// Named ordinary positive: generated time-of-day lighting for the unified
// Atlas (#339). The pinned SunCalc places the sun for a neutral reference
// place, which a release or a device can replace; the light changes smoothly through a day, never falls below a
// readable floor, and turns with the model's north; the appearance table
// carries the shelter and kept-tone flags only when daylight is given, and
// leaves every other viewer as before. Pure source only: no browser, GPU,
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
const { writeAppearance, STATE_FLOATS } = await import(await sourceURL('../src/lantern/canonical-ifc/mesh-appearance.ts', { './geometry': geometryURL }));

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

console.log('unified-atlas-daylight-healthy: ok');
