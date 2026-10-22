import { isExactDecimal } from '../numeric/decimal';
import { JSON_LIMITS, parseLosslessJson, type LosslessJson } from '../numeric/lossless-json';
import { createExactStockResultValidator } from '../numeric/schema-validator';
import { jsonRow, needPack, packText, readPackManifest } from '../offline/manifest';
import { savedDigest, validateSavedHouse, type SavedHouse, type SavedHouseStore, type SavedResource } from '../offline/store';
import type { LocalEditInput } from './types';

const MEMBER_BYTES = 1024 * 1024, CAPTURE_BYTES = 16 * MEMBER_BYTES, RECORDS = 10_000;
const SHA = /^[0-9a-f]{64}$/;
export interface RetainedIdentityCandidate {
  readonly key: string;
  readonly recordId: string;
  /** Original lexical token, never a cloned ExactDecimal node. */
  readonly revision: string;
  readonly bytes: number;
  readonly sha256: string;
  readonly resourceSha256: string;
}
export interface VerifiedRetainedIdentities {
  readonly candidates: readonly RetainedIdentityCandidate[];
  readonly omitted: number;
  /** Detached exact buffers. Parsed trees stay inside admission. */
  input(key: string): LocalEditInput;
}
function equalBytes(a: ArrayBuffer, b: ArrayBuffer): boolean {
  const x = new Uint8Array(a), y = new Uint8Array(b);
  return x.length === y.length && x.every((byte, index) => byte === y[index]);
}
function utf8(bytes: ArrayBuffer, max: number): string {
  needPack(bytes.byteLength <= max);
  const text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
  needPack(equalBytes(new TextEncoder().encode(text).buffer, bytes)); return text;
}

/** Admission-only preflight, before either existing last-wins parser. Decoded
 * keys are tracked per object, including unknown nested data and escaped keys.
 * No general parser semantics change, parsed projection or byte rewriting. */
function uniqueKeys(text: string): void {
  needPack(text.length <= JSON_LIMITS.textBytes);
  let offset = 0, nodes = 0;
  const space = () => { while (/[\t\n\r ]/.test(text[offset] ?? 'x')) offset++; };
  const string = (): string => {
    needPack(text[offset] === '"'); const start = offset++;
    while (offset < text.length) {
      const ch = text[offset++];
      if (ch === '"') return JSON.parse(text.slice(start, offset)) as string;
      if (ch === '\\') offset++;
    }
    throw new Error('Incomplete retained JSON string');
  };
  const value = (depth: number): void => {
    needPack(++nodes <= JSON_LIMITS.nodes && depth <= JSON_LIMITS.depth); space();
    const ch = text[offset];
    if (ch === '"') { string(); return; }
    if (ch === '{') {
      offset++; space(); const keys = new Set<string>();
      if (text[offset] === '}') { offset++; return; }
      while (true) {
        const key = string(); needPack(!keys.has(key)); keys.add(key); space();
        needPack(text[offset++] === ':'); value(depth + 1); space();
        if (text[offset] === '}') { offset++; return; }
        needPack(text[offset++] === ','); space();
      }
    }
    if (ch === '[') {
      offset++; space(); if (text[offset] === ']') { offset++; return; }
      while (true) {
        value(depth + 1); space(); if (text[offset] === ']') { offset++; return; }
        needPack(text[offset++] === ',');
      }
    }
    const start = offset;
    while (offset < text.length && !/[\t\n\r ,}\]]/.test(text[offset]!)) offset++;
    const token = text.slice(start, offset);
    needPack(/^(?:null|true|false|-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?)$/.test(token));
  };
  value(0); space(); needPack(offset === text.length);
}
function parse(bytes: ArrayBuffer, max: number): LosslessJson {
  const text = utf8(bytes, max); uniqueKeys(text); return parseLosslessJson(text);
}
function integer(value: LosslessJson | undefined, max: number, min = 0): number {
  needPack(isExactDecimal(value)); const result = value.toSafeInteger();
  needPack(result !== undefined && result >= min && result <= max); return result;
}
function sha(value: LosslessJson | undefined): string {
  needPack(typeof value === 'string' && SHA.test(value)); return value;
}
function revision(value: LosslessJson | undefined): string {
  integer(value, Number.MAX_SAFE_INTEGER, 1); needPack(isExactDecimal(value)); return value.token;
}
/** Whole documentary equality, with exact mathematical numeric comparison. */
function equalJson(a: LosslessJson, b: LosslessJson): boolean {
  if (isExactDecimal(a)) return isExactDecimal(b) && a.compare(b) === 0;
  if (a === null || typeof a !== 'object') return a === b;
  if (b === null || typeof b !== 'object' || isExactDecimal(b)) return false;
  if (Array.isArray(a)) return Array.isArray(b) && a.length === b.length && a.every((v, i) => equalJson(v, b[i]!));
  return !Array.isArray(b) && Object.keys(a).length === Object.keys(b).length
    && Object.keys(a).every(key => Object.hasOwn(b, key) && equalJson(a[key]!, b[key]!));
}
function pinTuple(p: SavedResource): string {
  return JSON.stringify([p.id, p.role, p.label, p.sha256, p.bytes, p.contentType,
    p.record === undefined ? [] : p.record === null ? null : [p.record.recordType, p.record.recordId, p.record.revision]]);
}
/** Complete selected copy, including manifest bytes and every resource pin. */
function sameHouse(a: SavedHouse, b: SavedHouse): boolean {
  return a.version === b.version && a.localRevision === b.localRevision && a.key === b.key
    && a.snapshotId === b.snapshotId && a.scope.workspaceId === b.scope.workspaceId && a.scope.homeId === b.scope.homeId
    && a.label === b.label && a.capturedAt === b.capturedAt && a.shellBuildId === b.shellBuildId
    && equalBytes(a.manifest, b.manifest) && a.resources.length === b.resources.length
    && a.resources.every((pin, index) => pinTuple(pin) === pinTuple(b.resources[index]!));
}

/** Read-only saved resource ports; never parsed readSavedPackSections provenance.
 * Caller guards allocation generation as well as selection lifetime. */
export async function readRetainedIdentityCandidates(
  store: Pick<SavedHouseStore, 'list' | 'asset'>, input: SavedHouse, isCurrent: () => boolean,
): Promise<VerifiedRetainedIdentities> {
  const house = structuredClone(input); validateSavedHouse(house);
  const current = () => { needPack(isCurrent()); };
  const guard = async () => {
    current(); const houses = await store.list(); current();
    const matches = houses.filter(row => row.key === house.key); needPack(matches.length === 1);
    validateSavedHouse(matches[0]!); needPack(sameHouse(house, matches[0]!));
  };
  await guard(); current();
  // Keep this raw preflight before readPackManifest's last-wins parsing.
  const manifestText = utf8(house.manifest, JSON_LIMITS.textBytes); uniqueKeys(manifestText);
  const manifest = await readPackManifest(house.manifest, house.scope, true); current();
  needPack(manifest.snapshotId === house.snapshotId && manifest.capturedAt === house.capturedAt
    && manifest.resources.length === house.resources.length
    && manifest.resources.every(pin => house.resources.some(held => pinTuple(pin) === pinTuple(held))));
  await guard(); current();
  const read = async (pin: SavedResource, max: number) => {
    needPack(pin.bytes <= max); await guard(); current();
    const blob = await store.asset(structuredClone(house), pin.id); current();
    needPack(blob.size === pin.bytes && blob.type === pin.contentType);
    const bytes = await blob.arrayBuffer(); current();
    needPack(bytes.byteLength === pin.bytes);
    const hash = await savedDigest(bytes); current(); needPack(hash === pin.sha256);
    await guard(); current(); return bytes;
  };
  const atlasPin = manifest.resources.find(pin => pin.sha256 === manifest.sections.atlas.resourceSha256);
  needPack(atlasPin?.role === 'atlas/section' && atlasPin.contentType === 'application/json' && atlasPin.record === null);
  const atlasBytes = await read(atlasPin, JSON_LIMITS.textBytes); current();
  const atlas = jsonRow(parse(atlasBytes, JSON_LIMITS.textBytes));
  needPack(Array.isArray(atlas.records) && atlas.records.length <= RECORDS);
  const extension = jsonRow(atlas.retainedIdentityBodies, ['profile', 'resourceSha256', 'bytes', 'members', 'omissions']);
  needPack(extension.profile === 'houseatlas.home-read-pack.retained-identity-bodies.v1'
    && Array.isArray(extension.members) && Array.isArray(extension.omissions)
    && extension.members.length + extension.omissions.length <= RECORDS);
  const validator = createExactStockResultValidator();
  const records = new Map<string, LosslessJson>();
  for (const raw of atlas.records) {
    const record = jsonRow(raw); if (record.recordType !== 'identity') continue;
    needPack(validator.validateNativeEvidenceShape('identity', record));
    const id = packText(record.recordId);
    needPack(record.workspaceId === house.scope.workspaceId && record.homeId === house.scope.homeId && !records.has(id));
    revision(record.revision); records.set(id, record);
  }
  const identities = new Set<string>(); let captured = 0, offset = 0;
  const members: (RetainedIdentityCandidate & { offset: number })[] = [];
  for (const [omitted, entries] of [[false, extension.members], [true, extension.omissions]] as const) {
    let previous: string | null = null;
    for (const raw of entries) {
      const row = jsonRow(raw, ['workspaceId', 'homeId', 'recordType', 'recordId', 'revision', 'bytes', 'sha256', omitted ? 'code' : 'offset']);
      const id = packText(row.recordId), token = revision(row.revision), length = integer(row.bytes, CAPTURE_BYTES, 1);
      const record = records.get(id); needPack(record);
      needPack(row.workspaceId === house.scope.workspaceId && row.homeId === house.scope.homeId && row.recordType === 'identity'
        && (previous === null || previous < id) && !identities.has(id));
      needPack(equalJson(jsonRow(record).revision!, row.revision!));
      previous = id; identities.add(id); captured += length; needPack(captured <= CAPTURE_BYTES);
      const hash = sha(row.sha256);
      if (omitted) needPack(length > MEMBER_BYTES && row.code === 'member-byte-budget');
      else {
        needPack(length <= MEMBER_BYTES && integer(row.offset, CAPTURE_BYTES) === offset);
        members.push({ key: id, recordId: id, revision: token, bytes: length, sha256: hash, offset, resourceSha256: '' });
        offset += length;
      }
    }
  }
  needPack(identities.size === records.size && identities.size > 0);
  needPack(integer(extension.bytes, CAPTURE_BYTES) === offset);
  const inputs = new Map<string, LocalEditInput>(), candidates: RetainedIdentityCandidate[] = [];
  if (members.length === 0) needPack(extension.resourceSha256 === null && offset === 0);
  else {
    const aggregateHash = sha(extension.resourceSha256);
    const pin = manifest.resources.find(resource => resource.sha256 === aggregateHash);
    needPack(pin?.role === 'atlas/original' && pin.contentType === 'application/octet-stream' && pin.record === null && pin.bytes === offset);
    // Verify the complete aggregate before slicing; single-member equality of
    // aggregate/member hashes is valid and does not merge their attribution.
    const aggregate = await read(pin, CAPTURE_BYTES); current();
    const manifestHash = await savedDigest(house.manifest); current();
    for (const member of members) {
      const bytes = aggregate.slice(member.offset, member.offset + member.bytes);
      const text = utf8(bytes, MEMBER_BYTES); uniqueKeys(text);
      const hash = await savedDigest(bytes); current(); needPack(hash === member.sha256);
      const record = jsonRow(parseLosslessJson(text));
      needPack(validator.validateNativeEvidenceShape('identity', record)
        && record.workspaceId === house.scope.workspaceId && record.homeId === house.scope.homeId
        && record.recordType === 'identity' && record.recordId === member.recordId
        && revision(record.revision) === member.revision && equalJson(record, records.get(member.recordId)!));
      inputs.set(member.key, { scope: { ...house.scope }, savedKey: house.key, snapshotId: house.snapshotId, localRevision: house.localRevision,
        selectedResource: structuredClone(pin), recordIdentity: { recordType: 'identity', recordId: member.recordId },
        manifest: { bytes: house.manifest, sha256: manifestHash }, original: { bytes, sha256: hash, revision: member.revision } });
      const { offset: _offset, ...candidate } = member;
      candidates.push(Object.freeze({ ...candidate, resourceSha256: aggregateHash }));
    }
  }
  await guard(); current();
  return Object.freeze({ candidates: Object.freeze(candidates), omitted: extension.omissions.length,
    input(key: string) { const found = inputs.get(key); needPack(found); return structuredClone(found); } });
}
