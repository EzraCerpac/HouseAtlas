import { parseLosslessJson, type LosslessJson } from '../numeric/lossless-json';
import { jsonRow, needPack, readPackManifest, type JsonRow, type PackManifest } from './manifest';
import { savedDigest, type SavedHouse, type SavedHouseStore } from './store';

export const SAVED_SECTION_LIMIT = 8 * 1024 * 1024;
export const SAVED_OVERLAY_SECTIONS = ['atlas', 'inventory', 'network', 'documents'] as const;
export type SavedOverlaySection = typeof SAVED_OVERLAY_SECTIONS[number];
export interface SavedPackSections {
  readonly house: SavedHouse;
  readonly manifest: PackManifest;
  readonly roots: Readonly<Record<SavedOverlaySection, JsonRow | null>>;
  /** Original lossless trees retain all metadata, including unsupported facets. */
  readonly availability: ReadonlyMap<string, boolean>;
  readonly originals: ReadonlyMap<string, Uint8Array<ArrayBuffer>>;
}
/** Reads only explicit retained bytes. The raw model companion has its own
 * <=12 MiB admission path; it never enters this generic <=8 MiB parser. */
export async function readSavedPackSections(store: Pick<SavedHouseStore, 'list' | 'asset'>, input: SavedHouse,
  signal: AbortSignal): Promise<SavedPackSections> {
  const house = structuredClone(input);
  const guard = async () => {
    signal.throwIfAborted();
    const actual = (await store.list()).find(row => row.key === house.key);
    signal.throwIfAborted(); needPack(actual?.localRevision === house.localRevision && actual.snapshotId === house.snapshotId);
  };
  await guard();
  const manifest = await readPackManifest(house.manifest, house.scope, true); await guard();
  needPack(manifest.snapshotId === house.snapshotId && manifest.capturedAt === house.capturedAt);
  const roots = {} as Record<SavedOverlaySection, JsonRow | null>, availability = new Map<string, boolean>();
  const read = async (sha: string) => {
    const pin = manifest.resources.find(resource => resource.sha256 === sha); needPack(pin);
    const held = house.resources.find(resource => resource.id === pin.id);
    needPack(held && held.sha256 === pin.sha256 && held.bytes === pin.bytes && held.contentType === pin.contentType && held.role === pin.role);
    await guard(); const blob = await store.asset(house, pin.id); await guard();
    needPack(blob.size === pin.bytes && blob.type === pin.contentType);
    const bytes = await blob.arrayBuffer(); await guard();
    needPack(bytes.byteLength === pin.bytes && await savedDigest(bytes) === sha); await guard();
    availability.set(sha, true); return bytes;
  };
  const consumed = new Map<string, LosslessJson>();
  for (const section of SAVED_OVERLAY_SECTIONS) {
    const sha = manifest.sections[section].resourceSha256;
    if (sha === null) { roots[section] = null; continue; }
    const pin = manifest.resources.find(resource => resource.sha256 === sha); needPack(pin && pin.bytes <= SAVED_SECTION_LIMIT && pin.contentType === 'application/json');
    let value = consumed.get(sha);
    if (value === undefined) { value = parseLosslessJson(new TextDecoder('utf-8', { fatal: true }).decode(await read(sha))); consumed.set(sha, value); }
    roots[section] = jsonRow(value);
  }
  // Resource availability is established by actual verified bytes, including
  // cross-section SHA reuse. The manifest's canonical first descriptor wins.
  for (const pin of manifest.resources) if (!availability.has(pin.sha256)
    && (pin.role.startsWith('documents/') || pin.record?.recordType === 'geodata-document')) await read(pin.sha256);
  const originals = new Map<string, Uint8Array<ArrayBuffer>>();
  // Only exact factual source-document pins request historical originals.
  const records = roots.atlas?.records;
  if (Array.isArray(records)) for (const raw of records) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw) || !('recordType' in raw) || raw.recordType !== 'scene-association') continue;
    const record = jsonRow(raw), payload = jsonRow(record.payload);
    if (!Array.isArray(payload.sourceDocuments)) continue;
    for (const source of payload.sourceDocuments) {
      const document = jsonRow(source), sha = document.originalSha256;
      if (typeof sha !== 'string' || originals.has(sha)) continue;
      const pin = manifest.resources.find(resource => resource.sha256 === sha);
      if (pin?.contentType === 'text/plain' && pin.bytes <= SAVED_SECTION_LIMIT) originals.set(sha, new Uint8Array(await read(sha)));
    }
  }
  if (Array.isArray(records)) for (const raw of records) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw) || !('recordType' in raw) || raw.recordType !== 'asset') continue;
    const record = jsonRow(raw), payload = jsonRow(record.payload), sha = payload.sha256;
    if (payload.purpose !== 'evidence-original' || payload.contentType !== 'application/pdf' || typeof sha !== 'string' || originals.has(sha)) continue;
    const pin = manifest.resources.find(resource => resource.sha256 === sha);
    if (pin?.contentType === 'application/pdf' && pin.bytes <= 10_485_760) originals.set(sha, new Uint8Array(await read(sha)));
  }
  await guard(); return { house, manifest, roots, availability, originals };
}
