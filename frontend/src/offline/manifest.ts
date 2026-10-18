import { isExactDecimal } from '../numeric/decimal';
import { JSON_LIMITS, parseLosslessJson, type LosslessJson } from '../numeric/lossless-json';
import { savedDigest, type SavedHouse, type SavedResource } from './store';

export const SECTION_NAMES = ['home', 'atlas', 'inventory', 'network', 'documents', 'model'] as const;
export type SectionName = typeof SECTION_NAMES[number];
export type JsonRow = { [key: string]: LosslessJson };
export const PACK_LIMITS = Object.freeze({ metadataBytes: 16777216, totalBytes: 134217728, resources: 512, rangeBytes: 4194304 });
const SHA = /^[0-9a-f]{64}$/, UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
export function needPack(value: unknown): asserts value { if (!value) throw new Error('The saved-house export is unavailable or changed'); }
export function jsonRow(value: LosslessJson | undefined, keys?: readonly string[]): JsonRow {
  needPack(value !== null && typeof value === 'object' && !Array.isArray(value) && !isExactDecimal(value));
  if (keys) needPack(Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key)));
  return value;
}
export function packText(value: LosslessJson | undefined, limit = 256): string {
  needPack(typeof value === 'string' && value.length > 0 && value.length <= limit && !/[\u0000-\u001f\u007f]/.test(value)); return value;
}
function integer(value: LosslessJson | undefined, max: number): number {
  needPack(isExactDecimal(value) && /^(0|[1-9][0-9]*)$/.test(value.token));
  const number = value.toSafeInteger(); needPack(number !== undefined && number <= max); return number;
}
function sha(value: LosslessJson | undefined): string { needPack(typeof value === 'string' && SHA.test(value)); return value; }
export function canonicalPack(value: LosslessJson): string {
  if (isExactDecimal(value)) return value.token;
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map(canonicalPack).join(',') + ']';
  return '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + canonicalPack(value[key]!)).join(',') + '}';
}
export interface PackSection { readonly state: 'complete' | 'partial' | 'unavailable' | 'not-configured';
  readonly resourceSha256: string | null; readonly requiredBytesComplete: boolean }
export interface PackManifest {
  readonly scope: SavedHouse['scope']; readonly snapshotId: string; readonly capturedAt: string;
  readonly completeness: 'complete' | 'partial'; readonly totalBytes: number;
  readonly sections: Readonly<Record<SectionName, PackSection>>; readonly resources: readonly SavedResource[];
  readonly exclusions: readonly Readonly<{ section: SectionName; code: string; label: string }>[];
  readonly localBytes: ArrayBuffer;
}
export const packPrefix = (scope: SavedHouse['scope']) => `/api/atlas/offline/v1/workspaces/${scope.workspaceId}/homes/${scope.homeId}`;
/** Checked transport URLs are discarded; only inert, exact documentary JSON is
 * retained. Content IDs never establish online authority or a session. */
export async function readPackManifest(bytes: ArrayBuffer, expected: SavedHouse['scope'], local = false): Promise<PackManifest> {
  needPack(UUID.test(expected.workspaceId) && UUID.test(expected.homeId) && bytes.byteLength <= JSON_LIMITS.textBytes);
  const value = jsonRow(parseLosslessJson(new TextDecoder('utf-8', { fatal: true }).decode(bytes)),
    ['profile', 'scope', 'snapshotId', 'capturedAt', 'completeness', 'limits', 'totals', 'sections', 'resources', 'exclusions']);
  needPack(value.profile === 'houseatlas.home-read-pack.v1');
  const foundScope = jsonRow(value.scope, ['workspaceId', 'homeId']);
  needPack(foundScope.workspaceId === expected.workspaceId && foundScope.homeId === expected.homeId);
  const scope = { ...expected }, snapshotId = sha(value.snapshotId), capturedAt = packText(value.capturedAt, 64);
  needPack(Number.isFinite(Date.parse(capturedAt)) && (value.completeness === 'complete' || value.completeness === 'partial'));
  const limits = jsonRow(value.limits, Object.keys(PACK_LIMITS));
  for (const [key, limit] of Object.entries(PACK_LIMITS)) needPack(integer(limits[key], limit) === limit);
  needPack(Array.isArray(value.resources) && value.resources.length <= PACK_LIMITS.resources);
  const digests = new Set<string>(); let totalBytes = 0;
  const localResources: LosslessJson[] = [];
  const resources = value.resources.map<SavedResource>(raw => {
    const resource = jsonRow(raw, ['sha256', 'bytes', 'contentType', 'section', 'role', 'record', ...(local ? [] : ['href'])]);
    const digest = sha(resource.sha256), size = integer(resource.bytes, PACK_LIMITS.totalBytes);
    needPack(size > 0 && !digests.has(digest)); digests.add(digest); totalBytes += size;
    const contentType = packText(resource.contentType, 128), section = packText(resource.section), role = packText(resource.role);
    needPack(SECTION_NAMES.some(name => name === section) && ['section', 'original', 'preview', 'model'].includes(role)
      && /^[a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+-]+$/.test(contentType));
    let label = section + ' ' + role;
    let recordIdentity: SavedResource['record'] = null;
    if (resource.record !== null) {
      const record = jsonRow(resource.record, ['recordType', 'recordId', 'revision']);
      packText(record.recordType); label = packText(record.recordId);
      needPack(isExactDecimal(record.revision) && /^[1-9][0-9]*$/.test(record.revision.token));
      recordIdentity = { recordType: packText(record.recordType), recordId: label, revision: record.revision.token };
    }
    if (!local) needPack(resource.href === `${packPrefix(scope)}/snapshots/${snapshotId}/resources/${digest}`);
    const { href: _href, ...saved } = resource; localResources.push(saved);
    return { id: digest, sha256: digest, bytes: size, contentType, role: section + '/' + role, label, record: recordIdentity };
  });
  needPack(totalBytes <= PACK_LIMITS.totalBytes);
  const totals = jsonRow(value.totals, ['bytes', 'resources']);
  needPack(integer(totals.bytes, PACK_LIMITS.totalBytes) === totalBytes && integer(totals.resources, PACK_LIMITS.resources) === resources.length);
  const sectionsRaw = jsonRow(value.sections, SECTION_NAMES), sections = {} as Record<SectionName, PackSection>;
  for (const name of SECTION_NAMES) {
    const section = jsonRow(sectionsRaw[name], ['state', 'resourceSha256', 'requiredBytesComplete']);
    needPack(section.state === 'complete' || section.state === 'partial' || section.state === 'unavailable' || section.state === 'not-configured');
    needPack(typeof section.requiredBytesComplete === 'boolean');
    const pin = section.resourceSha256 === null ? null : sha(section.resourceSha256);
    if (pin) needPack(resources.some(resource => resource.sha256 === pin && resource.contentType === 'application/json' && resource.role === `${name}/section`));
    if (section.state === 'complete') needPack(pin !== null && section.requiredBytesComplete);
    if (value.completeness === 'complete') needPack(section.state === 'complete' || section.state === 'not-configured');
    sections[name] = { state: section.state, resourceSha256: pin, requiredBytesComplete: section.requiredBytesComplete };
  }
  needPack(sections.home.state === 'complete' && sections.home.resourceSha256 !== null);
  needPack(Array.isArray(value.exclusions) && value.exclusions.length <= 20000);
  const exclusions = value.exclusions.map(raw => {
    const entry = jsonRow(raw, ['section', 'code', 'label']), section = packText(entry.section);
    needPack(SECTION_NAMES.some(name => name === section));
    return { section: section as SectionName, code: packText(entry.code), label: packText(entry.label, 2048) };
  });
  const { snapshotId: _id, ...withoutId } = value;
  const retained = { ...withoutId, resources: localResources };
  needPack(await savedDigest(new TextEncoder().encode(canonicalPack(retained)).buffer) === snapshotId);
  return { scope, snapshotId, capturedAt, completeness: value.completeness, totalBytes, resources, sections, exclusions,
    localBytes: new TextEncoder().encode(canonicalPack({ ...retained, snapshotId })).buffer };
}
