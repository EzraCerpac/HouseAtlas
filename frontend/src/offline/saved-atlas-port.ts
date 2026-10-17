import type { UnifiedAtlasRead } from '../lantern/unified-atlas/types';
import { readPackManifest, needPack, type PackManifest } from './manifest';
import { admitSavedAtlasCompanion, readSavedAtlasModel, readSavedAtlasRoomLinks,
  type SavedAtlasModel, type SavedAtlasRoomLinks } from './model-v2';
import { savedDigest, validateSavedHouse, type SavedHouse, type SavedHouseStore, type SavedResource } from './store';

export interface SavedAtlasRead extends UnifiedAtlasRead {
  readonly saved: Readonly<{ key: string; localRevision: string; snapshotId: string; capturedAt: string;
    completeness: PackManifest['completeness']; modelState: PackManifest['sections']['model']['state'];
    exclusions: PackManifest['exclusions']; descriptor: SavedAtlasModel }>;
  /** Exact admitted companion, including its original whitespace and numbers. */
  readonly companion: ArrayBuffer;
  readonly roomLinks: null | Readonly<{ bytes: ArrayBuffer; data: SavedAtlasRoomLinks; resource: SavedResource }>;
}
/** Data-only local adapter. It deliberately cannot impersonate a native
 * UnifiedAtlasPort/ModelOverviewSelection. Mounting needs an agreed local facade. */
export function createSavedAtlasDataAdapter(store: Pick<SavedHouseStore, 'list' | 'asset'>) {
  return {
    async read(input: SavedHouse, signal: AbortSignal): Promise<SavedAtlasRead | null> {
      // Own all metadata before the first await, as callers may change selection.
      const house = structuredClone(input); validateSavedHouse(house);
      const guard = async () => {
        signal.throwIfAborted();
        const active = (await store.list()).find(item => item.key === house.key);
        signal.throwIfAborted();
        needPack(active?.localRevision === house.localRevision && active.snapshotId === house.snapshotId);
      };
      await guard();
      const manifest = await readPackManifest(house.manifest, house.scope, true); await guard();
      needPack(manifest.snapshotId === house.snapshotId && manifest.capturedAt === house.capturedAt
        && manifest.resources.length === house.resources.length);
      for (const pin of manifest.resources) {
        const held = house.resources.find(item => item.id === pin.id);
        needPack(held && held.sha256 === pin.sha256 && held.bytes === pin.bytes && held.contentType === pin.contentType
          && held.role === pin.role && held.label === pin.label);
        // Older saved metadata may omit the canonical record; the manifest retains it.
        if (held.record !== undefined) needPack((held.record === null && pin.record === null)
          || (held.record?.recordType === pin.record?.recordType && held.record?.recordId === pin.record?.recordId
            && held.record?.revision === pin.record?.revision));
      }
      const read = async (resource: SavedResource): Promise<ArrayBuffer> => {
        await guard(); const blob = await store.asset(house, resource.id); await guard();
        needPack(blob.size === resource.bytes && blob.type === resource.contentType);
        const bytes = await blob.arrayBuffer(); await guard();
        needPack(bytes.byteLength === resource.bytes && await savedDigest(bytes) === resource.sha256); await guard();
        return bytes;
      };
      const rootSha = manifest.sections.model.resourceSha256;
      if (rootSha === null) { await guard(); return null; }
      const root = manifest.resources.find(resource => resource.sha256 === rootSha); needPack(root);
      const descriptor = readSavedAtlasModel(await read(root), manifest);
      if (descriptor.unified === null) { await guard(); return null; }
      const companion = await read(descriptor.unified.companion);
      const scene = admitSavedAtlasCompanion(companion, manifest, descriptor); await guard();
      needPack(descriptor.original);
      const model = new Uint8Array(await read(descriptor.original));
      const roomBytes = descriptor.unified.roomLinks === null ? null : await read(descriptor.unified.roomLinks);
      const roomLinks = roomBytes === null ? null : { bytes: roomBytes, data: readSavedAtlasRoomLinks(roomBytes, scene),
        resource: descriptor.unified.roomLinks! };
      await guard();
      return { scene, model, companion, roomLinks, saved: { key: house.key, localRevision: house.localRevision,
        snapshotId: house.snapshotId, capturedAt: manifest.capturedAt, completeness: manifest.completeness,
        modelState: manifest.sections.model.state, exclusions: manifest.exclusions, descriptor } };
    },
  };
}
