import { jsonRow, needPack, packPrefix, packText, readPackManifest, type PackManifest } from './manifest';
import { parseLosslessJson, JSON_LIMITS } from '../numeric/lossless-json';
import { admitSavedAtlasCompanion, readSavedAtlasModel, readSavedAtlasRoomLinks } from './model-v2';
import { savedDigest, savedHouseKey, SAVED_RANGE_BYTES, type SavedHouse, type SavedHouseStore, type SavedResource } from './store';
import type { SavedShellStatus } from './shell';
import type { AcquisitionPreparation, AcquisitionReceipt, OfflineProgress } from './acquisition-types';

type Stage = Awaited<ReturnType<SavedHouseStore['begin']>>;
type AcquisitionStore = Pick<SavedHouseStore, 'list' | 'begin' | 'retained' | 'range' | 'putRange' | 'put' | 'activate' | 'close'>;
interface DiscardOwner { discardStage(stage: { readonly key: string; readonly token: string; readonly epoch: string }): Promise<void> }
function hasDiscard(store: AcquisitionStore): store is AcquisitionStore & DiscardOwner {
  return 'discardStage' in store && typeof store.discardStage === 'function';
}
const base64Digest = (hash: string) => btoa(String.fromCharCode(...hash.match(/../g)!.map(value => Number.parseInt(value, 16))));
async function receive(response: Response, cap: number, signal: AbortSignal, guard: () => void): Promise<ArrayBuffer> {
  const declared = response.headers.get('content-length');
  needPack(declared !== null && /^(0|[1-9][0-9]*)$/.test(declared) && Number(declared) <= cap);
  const reader = response.body?.getReader(); needPack(reader);
  const cancel = () => { void reader.cancel().catch(() => undefined); };
  signal.addEventListener('abort', cancel, { once: true });
  const chunks: Uint8Array[] = []; let length = 0;
  try {
    for (;;) {
      guard(); const item = await reader.read(); guard(); if (item.done) break;
      needPack(item.value.byteLength <= cap - length && chunks.length < 16384);
      length += item.value.byteLength; chunks.push(item.value);
    }
    needPack(length === Number(declared)); const bytes = new Uint8Array(length);
    let at = 0; for (const chunk of chunks) { bytes.set(chunk, at); at += chunk.length; } return bytes.buffer;
  } catch (error) { cancel(); throw error; }
  finally { signal.removeEventListener('abort', cancel); reader.releaseLock(); }
}
/** Explicit-action owner. Private GET transport and public shell verification
 * remain separate channels. No global fetch, persistence request or prefetch. */
export function createHouseAcquisition(options: {
  readonly scope: SavedHouse['scope']; readonly label: string; readonly store: AcquisitionStore;
  readonly signal: AbortSignal; readonly current: () => boolean;
  readonly onProgress: (progress: OfflineProgress) => void;
  readonly transport: typeof fetch; readonly verifyShell: () => Promise<SavedShellStatus>;
  readonly onCleanupPending?: () => void;
}) {
  // Check before any local write; older store donors cannot safely cancel stages.
  const store = options.store;
  if (!hasDiscard(store)) throw new Error('Saving is unavailable until local stage cleanup is installed');
  const scope = Object.freeze({ ...options.scope }), label = options.label;
  const signal = AbortSignal.any([options.signal, AbortSignal.timeout(30 * 60 * 1000)]);
  const guard = () => { signal.throwIfAborted(); needPack(options.current()); };
  let prepared: { public: AcquisitionPreparation; manifest: PackManifest } | null = null;
  let active = false;
  const get = async (path: string, cap: number, mime: string, range?: { start: number; end: number; total: number; sha: string }) => {
    guard(); const requestSignal = AbortSignal.any([signal, AbortSignal.timeout(30000)]);
    const check = () => { requestSignal.throwIfAborted(); guard(); };
    const response = await options.transport(path, { method: 'GET', credentials: 'same-origin', cache: 'no-store', redirect: 'error', signal: requestSignal,
      headers: { Accept: mime, ...(range ? { Range: `bytes=${range.start}-${range.end}` } : {}) } });
    try {
      check(); needPack(response.status === (range ? 206 : 200) && !response.redirected
        && response.headers.get('content-type')?.split(';')[0]?.trim() === mime
        && response.headers.get('cache-control') === 'private, no-store' && response.headers.get('x-content-type-options') === 'nosniff');
      if (range) needPack(response.headers.get('content-range') === `bytes ${range.start}-${range.end}/${range.total}`
        && response.headers.get('x-atlas-offline-resource-sha256') === range.sha);
      const bytes = await receive(response, cap, requestSignal, check); check();
      const digest = await savedDigest(bytes); check();
      const declaredDigest = response.headers.get('content-digest');
      if (range || declaredDigest !== null) needPack(declaredDigest === `sha-256=:${base64Digest(digest)}:`);
      return bytes;
    } catch (error) { void response.body?.cancel().catch(() => undefined); throw error; }
  };
  return {
    async prepare(): Promise<AcquisitionPreparation> {
      guard(); needPack(!active && prepared === null); active = true;
      try {
        const prior = (await store.list()).find(house => house.key === savedHouseKey(scope)) ?? null; guard();
        options.onProgress({ phase: 'app', done: 0, total: 0 });
        const shell = await options.verifyShell(); guard();
        needPack(shell.ready && typeof shell.buildId === 'string' && /^[a-f0-9]{64}$/.test(shell.buildId));
        const manifest = await readPackManifest(await get(`${packPrefix(scope)}/manifest`, JSON_LIMITS.textBytes, 'application/json'), scope); guard();
        const publicValue: AcquisitionPreparation = Object.freeze({ label, capturedAt: manifest.capturedAt, snapshotId: manifest.snapshotId,
          shellBuildId: shell.buildId, totalBytes: manifest.totalBytes, resources: manifest.resources.length,
          completeness: manifest.completeness, exclusions: manifest.exclusions, prior: prior === null ? null : structuredClone(prior) });
        prepared = { public: publicValue, manifest }; return publicValue;
      } finally { active = false; }
    },
    async save(preparation: AcquisitionPreparation, replaceRevision?: string): Promise<AcquisitionReceipt> {
      guard(); needPack(!active && prepared?.public === preparation);
      const { manifest } = prepared;
      needPack(preparation.prior ? replaceRevision === preparation.prior.localRevision : replaceRevision === undefined);
      active = true; let stage: Stage | null = null, committed = false;
      try {
        const prior = (await store.list()).find(house => house.key === savedHouseKey(scope)) ?? null; guard();
        // Exact prior revision narrows a stale confirmation; this is not a cross-tab CAS.
        needPack((prior?.localRevision ?? null) === (preparation.prior?.localRevision ?? null));
        // Capture the actual handle before checking cancellation after this await.
        stage = await store.begin({ version: 1, key: savedHouseKey(scope), snapshotId: manifest.snapshotId, scope,
          capturedAt: manifest.capturedAt, label, shellBuildId: preparation.shellBuildId, resources: manifest.resources, manifest: manifest.localBytes });
        guard();
        const held = new Map<string, ArrayBuffer>(); let done = 0;
        const read = async (resource: SavedResource) => {
          guard(); let bytes = await store.retained(stage!, resource); guard();
          if (!bytes) {
            const assembly = new Uint8Array(resource.bytes);
            for (let start = 0; start < resource.bytes; start += SAVED_RANGE_BYTES) {
              const end = Math.min(resource.bytes, start + SAVED_RANGE_BYTES) - 1;
              let chunk = await store.range(stage!, resource, start); guard();
              if (!chunk) {
                chunk = await get(`${packPrefix(scope)}/snapshots/${manifest.snapshotId}/resources/${resource.sha256}`, end - start + 1,
                  resource.contentType, { start, end, total: resource.bytes, sha: resource.sha256 }); guard();
                needPack(chunk.byteLength === end - start + 1); await store.putRange(stage!, resource, start, chunk); guard();
              }
              assembly.set(new Uint8Array(chunk), start);
              options.onProgress({ phase: 'house', done: done + end + 1, total: manifest.totalBytes });
            }
            bytes = assembly.buffer;
          }
          needPack(bytes.byteLength === resource.bytes && await savedDigest(bytes) === resource.sha256); guard();
          held.set(resource.sha256, bytes); done += resource.bytes;
          options.onProgress({ phase: 'house', done, total: manifest.totalBytes });
          return bytes;
        };
        const rootSha = manifest.sections.model.resourceSha256;
        const root = rootSha === null ? null : manifest.resources.find(item => item.sha256 === rootSha);
        needPack(rootSha === null || root);
        if (root) needPack(root.bytes <= JSON_LIMITS.textBytes);
        const model = root ? readSavedAtlasModel(await read(root), manifest) : null; guard();
        // Only the model-v2 root may admit the raw 12 MiB companion exception.
        for (const resource of manifest.resources) {
          const bytes = held.get(resource.sha256) ?? await read(resource); guard();
          if (Object.values(manifest.sections).some(section => section.resourceSha256 === resource.sha256)) {
            needPack(resource.bytes <= JSON_LIMITS.textBytes);
            const body = jsonRow(parseLosslessJson(new TextDecoder('utf-8', { fatal: true }).decode(bytes)));
            if (manifest.sections.home.resourceSha256 === resource.sha256) {
              const selected = jsonRow(body.scope); needPack(selected.workspaceId === scope.workspaceId && selected.homeId === scope.homeId);
              needPack(body.profile === 'houseatlas.home-read-pack.home.v1'); packText(body.label);
            }
          }
          await store.put(stage, resource, bytes); guard();
        }
        if (model?.unified) {
          const companion = held.get(model.unified.companion.sha256); needPack(companion);
          const scene = admitSavedAtlasCompanion(companion, manifest, model);
          if (model.unified.roomLinks) {
            const mapping = held.get(model.unified.roomLinks.sha256); needPack(mapping); readSavedAtlasRoomLinks(mapping, scene);
          }
        }
        guard();
        const house = await store.activate(stage, { signal, current: options.current });
        // Actual activation success wins over late cancellation or owner retirement.
        committed = true; return { house, completeness: manifest.completeness, exclusions: manifest.exclusions };
      } finally {
        try {
          if (stage && !committed) {
            try { await store.discardStage(stage); }
            catch { try { options.onCleanupPending?.(); } catch { /* preserve the original acquisition outcome */ } }
          }
        }
        finally { active = false; }
      }
    },
    async close() { needPack(!active); await store.close(); },
  };
}
