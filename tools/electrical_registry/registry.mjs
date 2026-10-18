/** Offline documentary registry. No transport, admission, calibration or UI. */
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const digest = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const text = value => typeof value === 'string' && value.trim().length > 0;
const named = (value, max = 256) => text(value) && value.trim() === value && [...value].length <= max;
const plain = (value, max = 2048) => typeof value === 'string' && value.length <= max;
const uuid = value => typeof value === 'string' && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(value);
const kinds = ['socket', 'socket-candidate', 'light', 'appliance', 'unresolved'];
const point = value => Array.isArray(value) && value.length === 2 && value.every(n => Number.isFinite(n) && n >= 0 && n <= 1);
const box = value => Array.isArray(value) && value.length === 4 &&
  value.every(n => Number.isFinite(n) && n >= 0 && n <= 1) && value[0] <= value[2] && value[1] <= value[3];
const count = value => value === null || (Number.isSafeInteger(value) && value >= 1 && value <= 10000);
const sameReceipt = (a, b) => a && b && a.id === b.id && a.sha256 === b.sha256;
const pair = place => JSON.stringify([place?.packagePlaceKey, place?.packagePlaceUuid]);
export const MAX_EVIDENCE_JSON_BYTES = 16 * 1024 * 1024;
const sourceReference = value => named(value, 512) && value.split('/').length <= 8 &&
  value.split('/').every(part => /^[A-Za-z0-9][A-Za-z0-9._ -]{0,127}$/.test(part) &&
    part !== '.' && part !== '..' && !part.endsWith('.') && !part.endsWith(' '));

// Compare decimal values without expanding large exponents or rounding tokens.
function decimalKey(token) {
  const match = /^(-?)(0|[1-9]\d*)(?:\.(\d+))?(?:[eE]([+-]?\d+))?$/.exec(token);
  if (!match) throw new SyntaxError('Invalid evidence number');
  let digits = (match[2] + (match[3] ?? '')).replace(/^0+/, '');
  if (!digits) return '0';
  let exponent = BigInt(match[4] ?? '0') - BigInt((match[3] ?? '').length);
  const trimmed = digits.replace(/0+$/, '');
  exponent += BigInt(digits.length - trimmed.length); digits = trimmed;
  return `${match[1]}${digits}e${exponent}`;
}

/** Preflight decoded object keys before JSON.parse can discard conflicting evidence.
 * Same lexical approach as native-scene-documentary-support, without UI imports. */
function parseEvidenceJson(bytes) {
  if (bytes.byteLength > MAX_EVIDENCE_JSON_BYTES) throw new Error('Evidence JSON exceeds 16 MiB');
  const input = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
  let i = 0, members = 0;
  const need = ok => { if (!ok) throw new SyntaxError('Invalid or excessive evidence JSON'); };
  const space = () => { while (i < input.length && /[\x20\t\r\n]/.test(input[i])) i++; };
  const quoted = () => {
    need(input[i] === '"'); const start = i++;
    for (; i < input.length; i++) {
      if (input[i] === '\\') { i++; continue; }
      if (input[i] === '"') { i++; return JSON.parse(input.slice(start, i)); }
    }
    throw new SyntaxError('Unterminated evidence JSON string');
  };
  const scan = depth => {
    need(depth <= 64); space();
    if (input[i] === '{') {
      i++; space(); const seen = new Set();
      if (input[i] === '}') { i++; return; }
      for (;;) {
        const key = quoted(); need(++members <= 1000000);
        if (seen.has(key)) throw new SyntaxError('Duplicate decoded evidence JSON key');
        seen.add(key); space(); need(input[i++] === ':'); scan(depth + 1); space();
        if (input[i] === '}') { i++; return; }
        need(input[i++] === ','); space();
      }
    }
    if (input[i] === '[') {
      i++; space(); if (input[i] === ']') { i++; return; }
      for (;;) {
        need(++members <= 1000000); scan(depth + 1); space();
        if (input[i] === ']') { i++; return; }
        need(input[i++] === ',');
      }
    }
    if (input[i] === '"') { quoted(); return; }
    const start = i;
    while (i < input.length && !/[\x20\t\r\n,\]}]/.test(input[i])) i++;
    need(i > start);
    const token = input.slice(start, i);
    if (/^-?\d/.test(token)) {
      need(token.length <= 128 && Number.isFinite(Number(token)));
      need(decimalKey(token) === decimalKey(JSON.stringify(Number(token))));
    }
  };
  scan(0); space(); need(i === input.length);
  return JSON.parse(input); // Full JSON grammar validation after the key preflight.
}

/** Structural consistency only; matching hashes never establish authorization. */
export function validateLedger(data) {
  const errors = [];
  const check = (ok, path, reason) => { if (!ok) errors.push({ path, reason }); };
  if (!data || typeof data !== 'object' || Array.isArray(data)) return [{ path: '$', reason: 'Expected ledger object' }];
  check(data.schema === 'houseatlas.documentary-electrical-fixtures.v1', 'schema', 'Unsupported documentary ledger schema');
  check(named(data.viewKey), 'viewKey', 'Bounded documentary source view key required');
  check(named(data.interpretationDate), 'interpretationDate', 'Bounded interpretation date required');
  check(data.symbolLegend && [true, false, null].includes(data.symbolLegend.xMeansSocket) &&
    count(data.symbolLegend.socketsPerX) && (data.symbolLegend.receiptId === null || named(data.symbolLegend.receiptId)),
  'symbolLegend', 'Explicit symbol interpretation, source quantity and receipt or null required');
  check(data.roomMappingReceipt === null || (named(data.roomMappingReceipt?.id) && digest(data.roomMappingReceipt?.sha256)),
    'roomMappingReceipt', 'Expected explicit null or receipt identity and digest');
  const tables = {};
  for (const name of ['sheets', 'regions', 'fixtures', 'groups', 'registrationReceipts']) {
    check(Array.isArray(data[name]) && data[name].length <= 10000, name, 'Expected bounded array (maximum 10000)');
    tables[name] = new Map();
    if (!Array.isArray(data[name]) || data[name].length > 10000) continue;
    for (const [i, row] of data[name].entries()) {
      const path = `${name}[${i}]`;
      check(named(row?.id) && !tables[name].has(row?.id), path, 'Expected unique bounded ID');
      if (row && typeof row === 'object') tables[name].set(row.id, row);
    }
  }
  if (errors.length) return errors;
  const refs = (ids, table) => Array.isArray(ids) && ids.length <= 10000 && ids.every(id => named(id)) && new Set(ids).size === ids.length && ids.every(id => table.has(id));
  const sheetRegions = new Map(data.sheets.map(s => [s.id, new Set(Array.isArray(s.regionIds) ? s.regionIds : [])]));
  const groupFixtures = new Map(data.groups.map(g => [g.id, new Set(Array.isArray(g.fixtureIds) ? g.fixtureIds : [])]));
  for (const s of data.sheets) {
    check(digest(s.originalPhotoSha256) && digest(s.renderedPhotoSha256), `sheets.${s.id}`, 'Source photo digests required');
    check(named(s.title, 512), `sheets.${s.id}.title`, 'Bounded source title required');
    check(sourceReference(s.originalPhoto), `sheets.${s.id}.originalPhoto`, 'Bounded relative documentary photo reference required');
    check(Number.isSafeInteger(s.pdfPage) && s.pdfPage >= 1 && s.pdfPage <= 10000, `sheets.${s.id}.pdfPage`, 'Expected PDF page 1..10000');
    check(s.sourceDate === null || named(s.sourceDate), `sheets.${s.id}.sourceDate`, 'Preserve explicit unknown or bounded source date');
    check(refs(s.regionIds, tables.regions) && s.regionIds.every(id => tables.regions.get(id).sheetId === s.id),
      `sheets.${s.id}.regionIds`, 'Region membership must agree with sheet');
  }
  const keys = new Map(), uuids = new Map(); let placeMemberships = 0;
  for (const r of data.regions) {
    check(named(r.label, 512), `regions.${r.id}.label`, 'Bounded region label required');
    const sheet = tables.sheets.get(r.sheetId);
    check(sheet && sheetRegions.get(sheet.id).has(r.id), `regions.${r.id}.sheetId`, 'Missing reciprocal sheet membership');
    check(r.physicalTransform === null && r.orientation === 'unregistered', `regions.${r.id}`, 'v1 preserves unknown physical transform/orientation');
    check(box(r.sourceBounds), `regions.${r.id}.sourceBounds`, 'Expected normalized source box');
    check(Array.isArray(r.sourceOutline) && r.sourceOutline.length <= 1024 && r.sourceOutline.every(point) &&
      typeof r.outlineClosed === 'boolean' && ['untraced', 'approximate-photo-trace'].includes(r.outlineBasis) &&
      (r.outlineBasis !== 'untraced' || (r.sourceOutline.length === 0 && r.outlineClosed === false)),
      `regions.${r.id}.sourceOutline`, 'Explicit bounded source outline, closure and documentary basis required');
    check(Array.isArray(r.places) && r.places.length <= 64, `regions.${r.id}.places`, 'Explicit documentary place array required (maximum 64)');
    placeMemberships += Array.isArray(r.places) ? r.places.length : 0;
    const seen = new Set();
    for (const p of Array.isArray(r.places) ? r.places : []) {
      check(p && typeof p === 'object' && !Array.isArray(p) && Object.keys(p).length === 4 &&
        ['packagePlaceKey', 'packagePlaceUuid', 'label', 'basis'].every(key => Object.hasOwn(p, key)) &&
        named(p.packagePlaceKey) && uuid(p.packagePlaceUuid) && named(p.label, 512) && ['owner-reported', 'inferred'].includes(p.basis),
        `regions.${r.id}.places`, 'Expected exact package key/UUID and association basis');
      if (!p) continue;
      check(!seen.has(pair(p)), `regions.${r.id}.places`, 'Duplicate place pair'); seen.add(pair(p));
      check(!keys.has(p.packagePlaceKey) || keys.get(p.packagePlaceKey) === p.packagePlaceUuid,
        `regions.${r.id}.places`, 'Package key maps to conflicting UUIDs');
      check(!uuids.has(p.packagePlaceUuid) || uuids.get(p.packagePlaceUuid) === p.packagePlaceKey,
        `regions.${r.id}.places`, 'Package UUID maps to conflicting keys');
      keys.set(p.packagePlaceKey, p.packagePlaceUuid); uuids.set(p.packagePlaceUuid, p.packagePlaceKey);
    }
  }
  check(placeMemberships <= 10000, 'regions.places', 'Maximum 10000 source-place memberships');
  const symbolKeys = new Set(); let fixtureRoomMemberships = 0;
  for (const f of data.fixtures) {
    const r = tables.regions.get(f.regionId), s = tables.sheets.get(f.sheetId);
    check(r && s && r.sheetId === f.sheetId, `fixtures.${f.id}`, 'Fixture sheet/region join must agree');
    fixtureRoomMemberships += Array.isArray(r?.places) ? r.places.length : 0;
    check(kinds.includes(f.kind), `fixtures.${f.id}.kind`, 'Unknown fixture kind');
    check(named(f.label, 512) && plain(f.glyph, 512) && (f.clusterId === null || named(f.clusterId, 512)), `fixtures.${f.id}`,
      'Fixture label, glyph text and explicit cluster ID required (glyph may be blank)');
    check(f.physicalCoordinate === null && f.wireRoute === null && f.currentState === 'historic-unverified' &&
      (f.physicalTransform === undefined || f.physicalTransform === null) &&
      (f.currentCircuitId === undefined || f.currentCircuitId === null),
      `fixtures.${f.id}`, 'v1 retains unknown physical placement/wiring and historical state');
    check(count(f.glyphCount) && count(f.fixtureCount), `fixtures.${f.id}`, 'Expected source quantities 1..10000 or null');
    check(Object.hasOwn(f, 'uncertainty') && (f.uncertainty === null || (text(f.uncertainty) && plain(f.uncertainty))),
      `fixtures.${f.id}.uncertainty`, 'Expected explicit null or nonempty uncertainty text');
    check(point(f.source?.normalizedPoint) && box(f.source?.normalizedBox), `fixtures.${f.id}.source`, 'Expected normalized source point and box');
    check(named(f.source?.symbolKey, 512) && !symbolKeys.has(f.source?.symbolKey),
      `fixtures.${f.id}.source.symbolKey`, 'Expected globally unique bounded source symbol key');
    symbolKeys.add(f.source?.symbolKey);
    check(Array.isArray(f.source?.literalLabels) && f.source.literalLabels.length <= 32 &&
      f.source.literalLabels.every(label => plain(label, 512)) && plain(f.source?.placementDescription),
      `fixtures.${f.id}.source`, 'Bounded literal annotations and placement description required');
    if (point(f.source?.normalizedPoint) && box(f.source?.normalizedBox)) {
      const [x, y] = f.source.normalizedPoint, [left, top, right, bottom] = f.source.normalizedBox;
      check(x >= left && x <= right && y >= top && y <= bottom,
        `fixtures.${f.id}.source.normalizedPoint`, 'Source point must lie inside its normalized box');
    }
    check(s && f.source?.originalPhotoSha256 === s.originalPhotoSha256 && f.source?.renderedPhotoSha256 === s.renderedPhotoSha256,
      `fixtures.${f.id}.source`, 'Fixture photo digests must match source sheet');
    const g = tables.groups.get(f.group?.id);
    check(f.group && (f.group.id === null || named(f.group.id)) &&
      (f.group.label === null || named(f.group.label, 512)) && (f.group.id === null) === (f.group.label === null) &&
      ['label-adjacent', 'drawn-arrow', 'uncertain', 'unknown'].includes(f.group.basis) && plain(f.group.note),
      `fixtures.${f.id}.group`, 'Explicit group ID/label parity, documentary basis and note text required');
    check(f.group?.id === null || (g && groupFixtures.get(g.id).has(f.id) && g.label === f.group.label),
      `fixtures.${f.id}.group`, 'Documentary group membership must agree');
  }
  check(fixtureRoomMemberships <= 10000, 'fixtures.roomAssociations', 'Maximum 10000 expanded fixture-room memberships');
  for (const g of data.groups) {
    check(named(g.label, 512), `groups.${g.id}.label`, 'Bounded documentary group label required');
    check(g.currentCircuitId === null && g.verifiedWiring === false && g.evidenceBasis === 'historic-drawing-label',
      `groups.${g.id}`, 'Documentary labels must not become verified circuits');
    check(refs(g.fixtureIds, tables.fixtures) && g.fixtureIds.every(id => tables.fixtures.get(id).group?.id === g.id),
      `groups.${g.id}.fixtureIds`, 'Fixture/group membership must agree');
  }
  let registrationMemberships = 0;
  for (const reg of data.registrationReceipts) {
    registrationMemberships += Array.isArray(reg.approvedFixtureIds) ? reg.approvedFixtureIds.length : 0;
    const region = tables.regions.get(reg.regionId), sheet = tables.sheets.get(reg.sheetId);
    check(digest(reg.sha256) && sameReceipt(reg.roomMappingReceipt, data.roomMappingReceipt), `registrationReceipts.${reg.id}`, 'Registration receipt identity must match room receipt');
    check(['proposed', 'source-reviewed-approximate', 'owner-reviewed-approximate'].includes(reg.status) && reg.physicalTransform === null,
      `registrationReceipts.${reg.id}`, 'Approximate registration cannot provide physical calibration');
    check(text(reg.basis) && plain(reg.basis) && text(reg.reviewQualification) && plain(reg.reviewQualification), `registrationReceipts.${reg.id}`,
      'Registration basis and review qualification must be nonempty text');
    check(region && sheet && region.sheetId === sheet.id && reg.originalPhotoSha256 === sheet.originalPhotoSha256 &&
      Array.isArray(region.places) && region.places.some(p => pair(p) === pair(reg)), `registrationReceipts.${reg.id}`, 'Registration must join exact source region and place pair');
    check(refs(reg.approvedFixtureIds, tables.fixtures) && reg.approvedFixtureIds.every(id => {
      const f = tables.fixtures.get(id); return f.regionId === reg.regionId && f.sheetId === reg.sheetId;
    }), `registrationReceipts.${reg.id}.approvedFixtureIds`, 'Registration fixture membership must agree');
    check(Array.isArray(reg.sourceAnchorIds) && reg.sourceAnchorIds.length > 0 && reg.sourceAnchorIds.length <= 32 && reg.sourceAnchorIds.every(id => named(id)) &&
      new Set(reg.sourceAnchorIds).size === reg.sourceAnchorIds.length, `registrationReceipts.${reg.id}.sourceAnchorIds`, 'Explicit unique source anchors required');
  }
  check(registrationMemberships <= 10000, 'registrationReceipts.approvedFixtureIds', 'Maximum 10000 expanded fixture-registration memberships');
  return errors;
}

/** artifacts are explicitly supplied local bytes, never paths, URLs or native IDs. */
export function buildRegistry(ledgerBytes, { artifacts = [], roomMappingBytes = null } = {}) {
  const data = parseEvidenceJson(ledgerBytes);
  const errors = validateLedger(data);
  if (errors.length) throw new Error(`Invalid documentary ledger: ${JSON.stringify(errors)}`);
  const retained = new Map(artifacts.map(a => [sha256(a.bytes), { label: a.label, bytes: a.bytes.byteLength }]));
  let roomMapping = { status: 'not-supplied', receipt: data.roomMappingReceipt };
  if (roomMappingBytes !== null) {
    const receipt = parseEvidenceJson(roomMappingBytes);
    if (!sameReceipt({ id: receipt.receiptId, sha256: sha256(roomMappingBytes) }, data.roomMappingReceipt)) {
      throw new Error('Room mapping receipt ID/digest mismatch');
    }
    roomMapping = { status: 'retained-byte-match', receipt: data.roomMappingReceipt };
  }
  const source = hash => ({ sha256: hash, status: retained.has(hash) ? 'retained-byte-match' : 'not-supplied',
    artifact: retained.get(hash) ?? null });
  const regionsById = new Map(data.regions.map(r => [r.id, r]));
  const registrationsByFixture = new Map(), registeredPairsByFixture = new Map();
  for (const registration of data.registrationReceipts) for (const id of registration.approvedFixtureIds) {
    if (!registrationsByFixture.has(id)) registrationsByFixture.set(id, []);
    registrationsByFixture.get(id).push(registration);
    if (registration.status !== 'proposed') {
      if (!registeredPairsByFixture.has(id)) registeredPairsByFixture.set(id, new Set());
      registeredPairsByFixture.get(id).add(pair(registration));
    }
  }
  const records = data.fixtures.map(f => {
    const region = regionsById.get(f.regionId);
    const registrations = registrationsByFixture.get(f.id) ?? [];
    return { fixtureId: f.id, kind: f.kind, label: f.label, glyph: f.glyph, clusterId: f.clusterId,
      sheetId: f.sheetId, regionId: f.regionId,
      source: structuredClone(f.source), documentaryGroup: structuredClone(f.group),
      glyphCount: f.glyphCount, sourceFixtureCount: f.fixtureCount, uncertainty: f.uncertainty,
      roomAssociations: structuredClone(region.places),
      approximateRegistrations: registrations.map(r => ({ id: r.id, sha256: r.sha256, status: r.status,
        basis: r.basis, reviewQualification: r.reviewQualification,
        packagePlaceKey: r.packagePlaceKey, packagePlaceUuid: r.packagePlaceUuid })),
      physicalCoordinate: null, physicalTransform: null, currentCircuitId: null, wireRoute: null,
      currentState: f.currentState };
  });
  const summarize = (rows, room = null) => ({ documentaryRecords: rows.length,
    byKind: Object.fromEntries(kinds.map(kind => [kind, rows.filter(f => f.kind === kind).length])),
    roomAssociatedRecords: rows.filter(f => f.roomAssociations.length > 0).length,
    roomAssociationInstances: rows.reduce((sum, f) => sum + f.roomAssociations.length, 0),
    sourceQuantityUnknownRecords: rows.filter(f => f.sourceFixtureCount === null).length,
    approximateRegisteredRecords: rows.filter(f => room === null
      ? registeredPairsByFixture.has(f.fixtureId)
      : registeredPairsByFixture.get(f.fixtureId)?.has(pair(room))).length,
    physicalLocationUnknownRecords: rows.length, currentCircuitUnknownRecords: rows.length,
    installedFixtureCount: null });
  const rooms = new Map();
  for (const region of data.regions) for (const place of region.places) {
    if (!rooms.has(pair(place))) rooms.set(pair(place), { packagePlaceKey: place.packagePlaceKey,
      packagePlaceUuid: place.packagePlaceUuid, regionIds: [] });
    rooms.get(pair(place)).regionIds.push(region.id);
  }
  const rowsByRoom = new Map(), rowsByRegion = new Map(), rowsBySheet = new Map();
  const append = (index, id, record) => {
    if (!index.has(id)) index.set(id, []);
    index.get(id).push(record);
  };
  for (const record of records) {
    append(rowsByRegion, record.regionId, record); append(rowsBySheet, record.sheetId, record);
    for (const place of record.roomAssociations) append(rowsByRoom, pair(place), record);
  }
  return { schema: 'houseatlas.documentary-placement-registry.v1',
    ledger: { sha256: sha256(ledgerBytes), bytes: ledgerBytes.byteLength, viewKey: data.viewKey, interpretationDate: data.interpretationDate },
    qualification: 'offline-documentary-consistency-only', roomMapping,
    symbolLegend: structuredClone(data.symbolLegend), documentaryGroups: structuredClone(data.groups),
    // Preserve every receipt, including source reviews that approve no fixture yet.
    registrationReceipts: structuredClone(data.registrationReceipts),
    completeness: summarize(records),
    rooms: [...rooms.values()].map(room => {
      const rows = rowsByRoom.get(pair(room)) ?? [];
      return { ...room, completeness: { ...summarize(rows, room), roomAssociationInstances: rows.length } };
    }),
    sheets: data.sheets.map(s => ({ sheetId: s.id, title: s.title, pdfPage: s.pdfPage, sourceDate: s.sourceDate, originalPhoto: s.originalPhoto,
      original: source(s.originalPhotoSha256), rendered: source(s.renderedPhotoSha256),
      completeness: summarize(rowsBySheet.get(s.id) ?? []) })),
    regions: data.regions.map(r => ({ regionId: r.id, sheetId: r.sheetId, label: r.label,
      sourceBounds: [...r.sourceBounds], sourceOutline: structuredClone(r.sourceOutline),
      outlineClosed: r.outlineClosed, outlineBasis: r.outlineBasis,
      roomAssociations: structuredClone(r.places), physicalTransform: null, orientation: r.orientation,
      completeness: summarize(rowsByRegion.get(r.id) ?? []) })),
    records,
    limitations: ['Documentary record counts are not installed fixture totals.',
      'Room associations and approximate display registrations do not calibrate source points.',
      'No physical locations, transforms, wiring routes or current circuit assignments are established.',
      'Byte matches establish local availability only; no native custody, current access or active-model mapping is qualified.'] };
}

/** One descriptor, bounded content reads, no path-stat/read race or FIFO wait.
 * Explicit symlinks to regular files retain ordinary local input semantics. */
export function readEvidenceFile(path) {
  const fd = fs.openSync(path, fs.constants.O_RDONLY | fs.constants.O_NONBLOCK);
  try {
    const before = fs.fstatSync(fd, { bigint: true });
    if (!before.isFile()) throw new Error('Evidence JSON input must be a regular file');
    if (before.size < 0n || before.size > BigInt(MAX_EVIDENCE_JSON_BYTES)) throw new Error('Evidence JSON exceeds 16 MiB');
    const expected = Number(before.size), bytes = Buffer.allocUnsafe(expected + 1);
    let total = 0;
    for (;;) {
      const size = fs.readSync(fd, bytes, total, bytes.length - total, null);
      if (size === 0) break;
      total += size;
      if (total > MAX_EVIDENCE_JSON_BYTES) throw new Error('Evidence JSON exceeds 16 MiB');
      if (total > expected) throw new Error('Evidence JSON changed while reading');
    }
    const after = fs.fstatSync(fd, { bigint: true });
    if (before.size !== after.size || before.mtimeNs !== after.mtimeNs || before.ctimeNs !== after.ctimeNs ||
      BigInt(total) !== after.size) throw new Error('Evidence JSON changed while reading');
    return bytes.subarray(0, total);
  } finally { fs.closeSync(fd); }
}

/** Complete-only, no-clobber publication; never remove the selected output. */
export function writeRegistryFile(output, registry) {
  const serialized = JSON.stringify(registry, null, 2); // Serialize before touching the filesystem.
  if (serialized === undefined) throw new Error('Registry output must be JSON serializable');
  const body = `${serialized}\n`;
  const target = resolve(output);
  const directory = fs.mkdtempSync(join(dirname(target), '.houseatlas-registry-'));
  const temporary = join(directory, 'registry.json');
  let fd = null, failure = null, published = false;
  const cleanupErrors = [];
  const close = () => { const owned = fd; fd = null; if (owned !== null) fs.closeSync(owned); };
  try {
    fd = fs.openSync(temporary, 'wx', 0o600);
    fs.writeFileSync(fd, body);
    fs.fsyncSync(fd);
    close();
    fs.linkSync(temporary, target); // Atomic visibility without replacing any existing path.
    published = true;
  } catch (error) { failure = error; }
  finally {
    try { close(); } catch (error) { cleanupErrors.push(error); }
    try { fs.unlinkSync(temporary); } catch (error) { if (error.code !== 'ENOENT') cleanupErrors.push(error); }
    try { fs.rmdirSync(directory); } catch (error) { cleanupErrors.push(error); }
  }
  if (failure && !cleanupErrors.length) throw failure;
  if (failure || cleanupErrors.length) throw new AggregateError([...(failure ? [failure] : []), ...cleanupErrors],
    published ? 'Complete registry published; private staging cleanup failed' : 'Registry publication failed');
}

// Explicit local inputs only. Both JSON inputs are bounded before parsing.
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const args = process.argv.slice(2);
  if (args.length < 2) throw new Error('Usage: node registry.mjs LEDGER_JSON NEW_OUTPUT_JSON [--room-mapping JSON] [--artifact FILE ...]');
  const [ledger, output, ...options] = args;
  const artifacts = []; let roomMappingBytes = null;
  for (let i = 0; i < options.length; i += 2) {
    if (!options[i + 1]) throw new Error('Missing option value');
    if (options[i] === '--artifact') artifacts.push({ label: options[i + 1], bytes: fs.readFileSync(options[i + 1]) });
    else if (options[i] === '--room-mapping' && roomMappingBytes === null) roomMappingBytes = readEvidenceFile(options[i + 1]);
    else throw new Error(`Unknown or duplicate option: ${options[i]}`);
  }
  const registry = buildRegistry(readEvidenceFile(ledger), { artifacts, roomMappingBytes });
  writeRegistryFile(output, registry);
  console.log(JSON.stringify({ output, ledger: registry.ledger, completeness: registry.completeness }));
}
