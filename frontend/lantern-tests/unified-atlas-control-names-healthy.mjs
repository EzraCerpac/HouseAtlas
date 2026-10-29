// Named ordinary positive: generated Atlas control names (#207). Duplicate
// building and same-floor room labels get distinct, source-qualified names;
// the model hash is shown whole; exclusion notes invent no name. Labels only:
// no browser, network, native authority or household data.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { transformWithOxc } from 'vite';
assert.equal(process.version, 'v26.10.0');
assert.deepEqual(process.argv.slice(2), []);
const path = new URL('../src/lantern/unified-atlas/labels.ts', import.meta.url);
const { code } = await transformWithOxc(readFileSync(path, 'utf8'), path.pathname,
  { lang: 'ts', target: 'esnext', tsconfig: false, sourcemap: false });
assert.doesNotMatch(code, /^\s*import\s/m, 'labels.ts keeps type-only imports');
const { atlasBuildingName, atlasExclusionText, atlasLevelName, atlasOccurrenceName } =
  await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`);

const building = (buildingId, label, levelIds) => ({ buildingId, label, levelIds });
const level = (levelId, buildingId, label, occurrenceIds) => ({ levelId, buildingId, label, sourceElevationM: null, occurrenceIds });
const room = (roomId, label, occurrenceIds) => ({ roomId, label, occurrenceIds });
const occurrence = (spaceOccurrenceId, roomId, levelId) => ({ spaceOccurrenceId, roomId, levelId });
function model({ buildings, levels, rooms, occurrences }) {
  const byId = (rows, key) => new Map(rows.map(row => [row[key], row]));
  return { scene: { buildings, levels, rooms, occurrences }, buildingsById: byId(buildings, 'buildingId'),
    levelsById: byId(levels, 'levelId'), roomsById: byId(rooms, 'roomId'), occurrencesById: byId(occurrences, 'spaceOccurrenceId') };
}

const generated = model({
  buildings: [building('b:house', 'House', ['l:ground', 'l:upper']), building('b:shed-a', 'Shed', ['l:shed-a']),
    building('b:shed-b', 'Shed', ['l:shed-b'])],
  levels: [level('l:ground', 'b:house', 'ground', ['o:bed-1', 'o:bed-2', 'o:hall-1', 'o:hall-2', 'o:kitchen']),
    level('l:upper', 'b:house', 'upper', ['o:bed-3', 'o:hall-3']), level('l:shed-a', 'b:shed-a', 'ground', []),
    level('l:shed-b', 'b:shed-b', 'ground', [])],
  rooms: [room('r:bed-a', 'Bedroom', ['o:bed-1']), room('r:bed-b', 'Bedroom', ['o:bed-2', 'o:bed-3']),
    room('r:hall', 'Hall', ['o:hall-1', 'o:hall-2', 'o:hall-3']), room('r:kitchen', 'Kitchen', ['o:kitchen'])],
  occurrences: [occurrence('o:bed-1', 'r:bed-a', 'l:ground'), occurrence('o:bed-2', 'r:bed-b', 'l:ground'),
    occurrence('o:bed-3', 'r:bed-b', 'l:upper'), occurrence('o:hall-1', 'r:hall', 'l:ground'),
    occurrence('o:hall-2', 'r:hall', 'l:ground'), occurrence('o:hall-3', 'r:hall', 'l:upper'),
    occurrence('o:kitchen', 'r:kitchen', 'l:ground')],
});

// Buildings: unique labels stay as authored; namesakes add their source position.
assert.equal(atlasBuildingName(generated, 'b:house'), 'House');
assert.equal(atlasBuildingName(generated, 'b:shed-a'), 'Shed · source building 2');
assert.equal(atlasBuildingName(generated, 'b:shed-b'), 'Shed · source building 3');
assert.equal(atlasLevelName(generated, 'l:shed-b', true), 'Ground Floor, Shed · source building 3');

// Rooms: distinct namesakes on one floor and parts of one room both separate.
const ground = generated.levelsById.get('l:ground').occurrenceIds.map(id => atlasOccurrenceName(generated, id));
assert.deepEqual(ground, ['Bedroom · source room 1', 'Bedroom · source room 2', 'Hall · part 1 of 2', 'Hall · part 2 of 2', 'Kitchen']);
assert.equal(new Set(ground).size, ground.length);
// Another floor is its own scope: one bedroom and one hall part there need no qualifier.
assert.equal(atlasOccurrenceName(generated, 'o:bed-3'), 'Bedroom');
assert.equal(atlasOccurrenceName(generated, 'o:hall-3'), 'Hall');

// Source labels that already read like a qualifier still end distinct.
const literal = model({
  buildings: [building('b:one', 'Shed · source building 2', []), building('b:two', 'Shed', []), building('b:three', 'Shed', [])],
  levels: [level('l:one', 'b:one', 'ground', ['o:a', 'o:b', 'o:c'])],
  rooms: [room('r:a', 'Store · part 1 of 2', ['o:a']), room('r:b', 'Store', ['o:b', 'o:c'])],
  occurrences: [occurrence('o:a', 'r:a', 'l:one'), occurrence('o:b', 'r:b', 'l:one'), occurrence('o:c', 'r:b', 'l:one')],
});
const buildingNames = ['b:one', 'b:two', 'b:three'].map(id => atlasBuildingName(literal, id));
assert.equal(new Set(buildingNames).size, 3, buildingNames.join(' | '));
const roomNames = ['o:a', 'o:b', 'o:c'].map(id => atlasOccurrenceName(literal, id));
assert.equal(new Set(roomNames).size, 3, roomNames.join(' | '));
assert.ok(roomNames.every((name, at) => name.startsWith(['Store · part 1 of 2', 'Store', 'Store'][at])));

// Exclusions: known occurrences by control name, other IDs as given, reasons kept; nothing invented.
assert.equal(atlasExclusionText(generated, { id: 'o:hall-2', reason: 'No pick mesh' }), 'Hall · part 2 of 2: No pick mesh');
assert.equal(atlasExclusionText(generated, { id: 'source:unknown', reason: null }), 'source:unknown');
assert.equal(atlasExclusionText(generated, { id: null, reason: 'Outline is open' }), 'Outline is open');
assert.equal(atlasExclusionText(generated, { id: null, reason: null }), 'No source ID or reason given.');

// The shell and its panel files use these names and show the whole model hash as selectable text.
const shell = ['UnifiedAtlas.tsx', 'atlas-text.ts', 'FloorStack.tsx', 'AtlasInspector.tsx', 'AtlasKeys.tsx']
  .map(file => readFileSync(new URL(`../src/lantern/unified-atlas/${file}`, import.meta.url), 'utf8')).join('\n');
const css = readFileSync(new URL('../src/lantern/unified-atlas/unified-atlas.css', import.meta.url), 'utf8');
assert.doesNotMatch(shell, /'Unnamed'/);
assert.doesNotMatch(shell, /sha256\.slice\(/);
assert.match(shell, /<code className="ua-hash">\{model\.scene\.model\.sha256\}<\/code>/);
assert.match(css, /\.ua-source \.ua-hash \{[^}]*user-select: all/);
assert.match(shell, /aria-label=\{`Select room: \$\{atlasOccurrenceName\(model, label\.id\)\}`\}/);
assert.match(shell, /<span>\{atlasOccurrenceName\(model, key\)\}<\/span>/);
assert.match(shell, /<span className="ua-rung-name">\{atlasBuildingName\(model, row\.buildingId\)\}<\/span><\/button>/);
console.log('PASS: generated building, room-part and exclusion names stay distinct; full model hash shown as selectable text.');
