import { readFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ContractError } from '../../contracts/src/index.mjs';
export const { AtlasStore } = await import(process.env.ATLAS_STORAGE_MODULE ?? '../src/index.mjs');
export const U = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
export const scope = { workspaceId: U(1), homeId: U(2) };
export const principal = { ...scope, actorId: U(50), role: 'editor', active: true };
export const fixture = name => JSON.parse(readFileSync(new URL(`../../contracts/fixtures/${name}.snapshot.json`, import.meta.url)));
export const commandFixture = name => JSON.parse(readFileSync(new URL(`../../contracts/fixtures/${name}.json`, import.meta.url)));
export const ref = (recordType, n) => ({ recordType, recordId: U(n) });
export const guard = (recordType, n, expectedRevision = 1) => ({ record: ref(recordType, n), expectedRevision });
export const at = '2026-01-03T12:00:00Z';
export const authorize = (p, request) => {
  if (!p?.active) throw new ContractError('unauthenticated', 'Session unavailable');
  if (p.homeId !== request.scope.homeId || p.workspaceId !== request.scope.workspaceId) throw new ContractError('not-found', 'Home unavailable');
  if (!['read','read-history','read-cache','read-asset-manifest'].includes(request.capability) && p.role !== 'editor') throw new ContractError('forbidden', 'Editor required');
  if (request.capability === 'read-cache' && p.deniedSource &&
      p.deniedSource === (request.sourcePartition?.sourceInstanceId ?? request.source?.key?.sourceInstanceId)) throw new ContractError('forbidden', 'Source denied');
  return { actorId: p.actorId, ...request.scope };
};
export const options = path => ({ path, authorize, clock: () => at, allowSyntheticBootstrap: true,
  verifyAvailableAsset: r => ({ sha256: r.payload.sha256, byteSize: r.payload.byteSize }) });
export function temporary() { const dir = mkdtempSync(join(tmpdir(), 'atlas-storage-')); return { dir, path: join(dir, 'atlas.sqlite') }; }
export function seeded(name = 'plan-free', extra = {}) {
  const state = temporary(), store = new AtlasStore({ ...options(state.path), ...extra });
  store.initializeSynthetic(fixture(name)); return { ...state, store };
}
export const createCircuit = (mutation = 1000) => ({ ...commandFixture('create-circuit.mutation'), mutationId: U(mutation) });
export const circuitTarget = ref('circuit', 900);
export function replace(record, mutation, changes = {}, guards = [guard('evidence', 100)]) {
  return { schemaVersion: 1, mutationId: U(mutation), operation: 'replace', expectedRevision: record.revision,
    reason: 'Synthetic reviewed edit', guards, value: { recordType: record.recordType, payload: { ...record.payload, ...changes } } };
}
export function lifecycle(operation, mutation, revision = 1, guards = [guard('evidence', 100)]) {
  return { schemaVersion: 1, mutationId: U(mutation), operation, expectedRevision: revision, reason: 'Synthetic lifecycle review', guards };
}
export const partitionOf = s => ({ workspaceId: s.workspaceId, homeId: s.homeId, sourceInstanceId: s.sourceInstanceId, collectionId: s.collectionId });
export function nextGeneration(s, num = 950, expectedCacheEpoch = 0) {
  const cache = structuredClone(s.caches[0]);
  const entities = structuredClone(s.homeboxEntities.filter(p => p.source.sourceInstanceId === cache.sourceInstanceId));
  cache.generationId = U(num); cache.lastSuccessfulFetchAt = at; cache.lastAttemptAt = at;
  cache.status = 'fresh'; cache.error = null;
  for (const p of entities) p.retrievedAt = at;
  return { cache, complete: true, expectedGenerationId: s.caches[0].generationId, expectedCacheEpoch, homeboxEntities: entities, networkRelations: [] };
}
