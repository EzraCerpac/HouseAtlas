import type { Core_scope, Core_recordRef, Core_record, Core_mutation, Core_mutationResult, Core_batchMutation, Core_batchResult,
  Core_audit, Core_snapshot, Core_sourceRef, Core_sourceRegistration, Core_cacheStatus, Core_homeboxProjection, Core_networkRelation, Core_assetPayload } from './frozen-types.js';

export type DeepReadonly<T> = T extends object ? { readonly [K in keyof T]: DeepReadonly<T[K]> } : T;
export type Scope = Core_scope;
export type SourcePartition = Scope & { sourceInstanceId: string; collectionId: string };
export type MutationCachePartition = SourcePartition & { cacheEpoch: number };
export type MutationEntry = { target: Core_recordRef; command: Core_mutation };
export interface MutationClosure {
  recordRefs: Core_recordRef[]; missingRecordRefs: Core_recordRef[];
  sourceRefs: Core_sourceRef[]; sourcePartitions: SourcePartition[];
}
export interface MutationPreconditions {
  createdInBatch: Core_recordRef[];
  commands: Array<{
    target: Core_recordRef; operation: Core_mutation['operation']; expectedRevision: number | null;
    current: { revision: number; lifecycle: 'active' | 'tombstoned' } | null;
    requiredGuards: Core_recordRef[];
    guards: Array<{ record: Core_recordRef; expectedRevision: number; currentRevision: number | null }>;
  }>;
}
interface MutationContextBase {
  format: 'atlas-mutation-authorization-context/1'; schemaVersion: 1; contextId: string; scope: Scope;
  entries: MutationEntry[]; targets: Core_recordRef[]; batch: Core_batchMutation | null;
  /** Current active transaction prestate, including on replay; never reconstructed historical before-payloads. */
  original: Core_snapshot; closure: MutationClosure;
  /** Registered partitions' epochs captured once in this transaction; identical through every phase. */
  cachePartitions: MutationCachePartition[];
}
export type MutationAuthorizationContext = DeepReadonly<MutationContextBase & (
  { phase: 'intake'; candidate: null; preconditions: null; replay: null } |
  { phase: 'validate'; candidate: null; preconditions: MutationPreconditions; replay: null } |
  { phase: 'candidate' | 'precommit'; candidate: Core_snapshot; preconditions: MutationPreconditions; replay: null } |
  { phase: 'replay' | 'replay-precommit'; candidate: null; preconditions: null; replay: { results: Core_mutationResult[] } }
)>;
export interface StorageAuthorizationRequest {
  scope: Scope; capability: 'read' | 'read-history' | 'read-cache' | 'read-asset-manifest' | 'mutate' | 'publish-cache' | 'configure-source';
  source?: Core_sourceRef | SourcePartition | Core_sourceRegistration | Core_cacheStatus;
  sourcePartition?: SourcePartition; targets?: Core_recordRef[];
  /** Additive private facts only for execute/executeBatch; not client authority or a response payload. */
  readonly mutation?: MutationAuthorizationContext;
}
export interface AtlasStoreOptions {
  path: string; authorize(principal: unknown, request: StorageAuthorizationRequest): Scope & { actorId: string };
  clock?: () => string; id?: () => string; fault?: (stage: string, detail: unknown) => void;
  verifyAvailableAsset?: (record: Core_record) => { sha256: string; byteSize: number };
  allowSyntheticBootstrap?: boolean; busyTimeoutMs?: number;
}
export declare const DATABASE_VERSION: 3;
export declare const MUTATION_AUTHORIZATION_CONTEXT_FORMAT: 'atlas-mutation-authorization-context/1';
export declare class AtlasStore {
  constructor(options: AtlasStoreOptions);
  readonly databaseVersion: 3;
  close(): void;
  initializeSynthetic(snapshot: Core_snapshot): void;
  registerSource(principal: unknown, registration: Core_sourceRegistration): Core_sourceRegistration;
  execute(principal: unknown, scope: Scope, target: Core_recordRef, command: Core_mutation): Core_mutationResult;
  executeBatch(principal: unknown, scope: Scope, envelope: Core_batchMutation): Core_batchResult;
  readSnapshot(principal: unknown, scope: Scope): Core_snapshot;
  readRecord(principal: unknown, scope: Scope, target: Core_recordRef): Core_record;
  history(principal: unknown, scope: Scope, target: Core_recordRef): Core_audit[];
  readAssetManifest(principal: unknown, scope: Scope, target: Core_recordRef): Core_assetPayload;
  readCacheForPublication(principal: unknown, scope: Scope, partition: SourcePartition): { cache: Core_cacheStatus | null; cacheEpoch: number; homeboxEntities: Core_homeboxProjection[]; networkRelations: Core_networkRelation[] };
  replaceCacheGeneration(principal: unknown, scope: Scope, generation: { cache: Core_cacheStatus; homeboxEntities: Core_homeboxProjection[]; networkRelations: Core_networkRelation[]; complete: true; expectedGenerationId: string | null; expectedCacheEpoch: number }): Core_cacheStatus;
  recordCacheFailure(principal: unknown, scope: Scope, partition: SourcePartition, error: { code: NonNullable<Core_cacheStatus['error']>['code']; status?: 'error' | 'stale' | 'access-revoked' }): Core_cacheStatus;
}
