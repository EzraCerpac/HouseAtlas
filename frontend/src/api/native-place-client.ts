import type { Scope } from '../app/types';
import type { AtlasSessionInfo } from '../app/session';
import { createRetainedIntentClient, type RetainedIntentRead } from './retained-intent-client';
import type { StockAdmission } from '../app/StockApplication';
import type { TopologyRecord } from './topology-client';
import type { DecodedLocationSemanticsPayload } from '../numeric/stock-decoded';
import { isExactDecimal } from '../numeric/decimal';
import { parseLosslessJson, stringifyLosslessJson, type JsonForSerialization, type LosslessJson } from '../numeric/lossless-json';
import { createExactStockResultValidator, exactStockSafeInteger } from '../numeric/schema-validator';
import { createNativeEvidenceClient, type NativeEvidenceClient } from './native-evidence-client';

export interface NativePlaceBinding { readonly scope: Readonly<Scope> }
type Guard = { target: { authority: 'atlas'; recordType: string; recordId: string }; revision: { kind: 'atlas'; value: number } };
export interface NativePlaceAdmission {
  readonly binding: NativePlaceBinding;
  readonly record: TopologyRecord<'location-semantics'>;
  readonly guards: readonly Guard[];
}
export interface NativePlacePrepared {
  readonly binding: NativePlaceBinding;
  readonly requestId: string;
  readonly commandId: 'atlas.batch.execute';
  readonly body: string;
}
export interface NativePlaceCompletion { readonly status: 'committed' | 'notCommitted'; readonly receipt: LosslessJson }
export interface NativePlacePending {
  readonly prepared: NativePlacePrepared;
  readonly outcome: 'unknown' | 'committed';
  readonly receipt?: LosslessJson;
  readonly inspection?: RetainedIntentRead;
}
export interface NativePlaceClient {
  readonly evidence: NativeEvidenceClient;
  getBinding(): NativePlaceBinding | null;
  subscribe(changed: () => void): () => void;
  subscribePending(changed: () => void): () => void;
  pending(binding: NativePlaceBinding): readonly NativePlacePending[];
  inspect(binding: NativePlaceBinding, prepared: NativePlacePrepared, signal: AbortSignal): Promise<RetainedIntentRead>;
  canCreate(binding: NativePlaceBinding, withMembership: boolean): boolean;
  canRename(binding: NativePlaceBinding): boolean;
  load(binding: NativePlaceBinding, recordId: string, signal: AbortSignal): Promise<NativePlaceAdmission>;
  prepareCreate(binding: NativePlaceBinding, input: { label: string; kind: 'building' | 'room'; statement: string; reason: string;
    building?: { identity: TopologyRecord<'identity'>; classification: TopologyRecord<'location-semantics'> } }): NativePlacePrepared;
  prepareRename(admission: NativePlaceAdmission, input: { label: string | null; statement: string; reason: string }): NativePlacePrepared;
  commit(prepared: NativePlacePrepared, signal: AbortSignal): Promise<NativePlaceCompletion>;
}
const target = (recordType: string, recordId: string) => ({ authority: 'atlas' as const, recordType, recordId });
const guard = (recordType: string, recordId: string, value: number): Guard => ({ target: target(recordType, recordId), revision: { kind: 'atlas', value } });
const id = () => crypto.randomUUID();
const reasonLimit = 1024;
function text(value: string, maximum: number) {
  if (!value.trim() || [...value].length > maximum) throw new TypeError('Native place text exceeds its field limit');
}
function cancel(response: Response) { void response.body?.cancel().catch(() => undefined); }
function sameJson(left: LosslessJson, right: LosslessJson): boolean {
  if (isExactDecimal(left) || isExactDecimal(right)) return isExactDecimal(left) && isExactDecimal(right) && left.compare(right) === 0;
  if (left === null || right === null || typeof left !== 'object' || typeof right !== 'object') return left === right;
  if (Array.isArray(left) || Array.isArray(right)) return Array.isArray(left) && Array.isArray(right) && left.length === right.length && left.every((value, index) => sameJson(value, right[index]!));
  const keys = Object.keys(left);
  return keys.length === Object.keys(right).length && keys.every(key => Object.hasOwn(right, key) && sameJson(left[key]!, right[key]!));
}
/** Headers and the owned body share a hard settlement bound, including abort-ignoring transports. */
async function bounded<T>(outer: AbortSignal, action: (signal: AbortSignal) => Promise<T>): Promise<T> {
  const controller = new AbortController();
  const forward = () => controller.abort(outer.reason);
  let reject!: (reason: unknown) => void;
  const stopped = new Promise<never>((_, no) => { reject = no; });
  const abort = () => reject(controller.signal.reason);
  controller.signal.addEventListener('abort', abort, { once: true });
  outer.addEventListener('abort', forward, { once: true });
  const timer = setTimeout(() => controller.abort(new Error('Native place exchange exceeded deadline')), 30000);
  if (outer.aborted) forward();
  try { controller.signal.throwIfAborted(); return await Promise.race([action(controller.signal), stopped]); }
  finally { clearTimeout(timer); outer.removeEventListener('abort', forward); controller.signal.removeEventListener('abort', abort); }
}
async function receive(response: Response, signal: AbortSignal): Promise<LosslessJson> {
  const maximum = 1024 * 1024;
  const length = response.headers.get('content-length');
  if (length !== null && (!/^[0-9]+$/.test(length) || Number(length) > maximum)) { cancel(response); throw new TypeError('Native place body exceeds bound'); }
  const reader = response.body?.getReader();
  if (!reader) throw new TypeError('Native place body missing');
  const stop = () => { void reader.cancel().catch(() => undefined); };
  signal.addEventListener('abort', stop, { once: true });
  const chunks: Uint8Array[] = []; let bytes = 0;
  try {
    for (;;) {
      signal.throwIfAborted(); const part = await reader.read(); signal.throwIfAborted();
      if (part.done) break;
      bytes += part.value.byteLength;
      if (bytes > maximum) throw new TypeError('Native place body exceeds bound');
      chunks.push(part.value);
    }
    const body = new Uint8Array(bytes); let offset = 0;
    for (const chunk of chunks) { body.set(chunk, offset); offset += chunk.byteLength; }
    return parseLosslessJson(new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(body));
  } catch (error) { stop(); throw error; }
  finally { signal.removeEventListener('abort', stop); reader.releaseLock(); }
}
export function createNativePlaceClient(options: {
  getContext(): { session: AtlasSessionInfo; scope: Scope; admission: StockAdmission } | null;
  subscribe(changed: () => void): () => void;
  transport?: typeof fetch;
}): NativePlaceClient {
  const validator = createExactStockResultValidator();
  const transport = options.transport ?? ((...args: Parameters<typeof fetch>) => fetch(...args));
  const dispatched = new WeakSet<NativePlacePrepared>();
  const retained = createRetainedIntentClient(transport);
  // Memory-only submitted inputs survive form/view remount; the private session is never returned.
  const ledger = new Map<NativePlacePrepared, { session: AtlasSessionInfo; outcome: 'unknown' | 'committed'; receipt?: LosslessJson; inspection?: RetainedIntentRead }>();
  const listeners = new Set<() => void>();
  const notify = () => { for (const changed of listeners) changed(); };
  let cached: { session: AtlasSessionInfo; scope: Scope; admission: StockAdmission; binding: NativePlaceBinding } | null = null;
  const getBinding = () => {
    const next = options.getContext();
    if (!next || next.scope.workspaceId !== next.admission.scope.workspaceId || next.scope.homeId !== next.admission.scope.homeId) { cached = null; return null; }
    if (!cached || next.session !== cached.session || next.scope !== cached.scope || next.admission !== cached.admission)
      cached = { ...next, binding: Object.freeze({ scope: Object.freeze({ ...next.scope }) }) };
    return cached.binding;
  };
  const has = (binding: NativePlaceBinding, commands: readonly string[]) => getBinding() === binding && commands.every(command => cached!.admission.commandIds.includes(command));
  const canCreate = (binding: NativePlaceBinding, membership: boolean) => has(binding, ['atlas.batch.execute', 'atlas.evidence.create', 'atlas.identity.create', 'atlas.location-semantics.create',
    ...(membership ? ['atlas.relation.create'] : [])]);
  const canRename = (binding: NativePlaceBinding) => has(binding, ['atlas.batch.execute', 'atlas.evidence.create', 'atlas.location-semantics.replace',
    'atlas.location-semantics.get', 'atlas.identity.get', 'atlas.evidence.get']);
  const current = (binding: NativePlaceBinding, signal?: AbortSignal) => {
    signal?.throwIfAborted(); if (getBinding() !== binding) throw new Error('Native place context changed');
  };
  const path = (binding: NativePlaceBinding) => `/api/atlas/stock/v3/workspaces/${encodeURIComponent(binding.scope.workspaceId)}/homes/${encodeURIComponent(binding.scope.homeId)}`;
  const selectedEntries = (binding: NativePlaceBinding) => {
    current(binding);
    return [...ledger].filter(([prepared, entry]) => entry.session === cached!.session
      && prepared.binding.scope.workspaceId === binding.scope.workspaceId && prepared.binding.scope.homeId === binding.scope.homeId);
  };
  const writable = (binding: NativePlaceBinding) => {
    while (ledger.size >= 64) {
      const oldest = [...ledger].find(([, entry]) => entry.outcome === 'committed');
      if (!oldest) break;
      ledger.delete(oldest[0]);
    }
    if (ledger.size >= 64 || selectedEntries(binding).some(([, entry]) => entry.outcome === 'unknown'))
      throw new Error('Inspect the prior submitted native place request before another change');
  };
  const serialize = (request: JsonForSerialization): string => {
    const body = stringifyLosslessJson(request);
    const raw = parseLosslessJson(body);
    const parsed = raw as { commandId: string; payload?: { commands?: Array<{ commandId: string }> } };
    if (!validator.validateNativeRequest(parsed.commandId, raw)) throw new TypeError('Native place request is incompatible');
    if (parsed.commandId === 'atlas.batch.execute') for (const child of parsed.payload!.commands!) {
      if (!validator.validateNativeRequest(child.commandId, child as unknown as LosslessJson)) throw new TypeError('Native place child request is incompatible');
    }
    if (new TextEncoder().encode(body).byteLength > 16384) throw new TypeError('Native place request exceeds native transport bound');
    return body;
  };
  async function get(binding: NativePlaceBinding, type: 'identity' | 'evidence' | 'location-semantics', recordId: string, signal: AbortSignal) {
    const commandId = `atlas.${type}.get`, requestId = id();
    if (!has(binding, [commandId])) throw new Error('Native read is not admitted');
    const body = serialize({ schemaVersion: 3, commandId, requestId, context: { workspaceId: binding.scope.workspaceId, homeId: binding.scope.homeId }, target: target(type, recordId), payload: {} });
    const value = await bounded(signal, async active => {
      current(binding, active);
      const response = await transport(`${path(binding)}/invoke?request=${encodeURIComponent(body)}`, { method: 'GET', credentials: 'same-origin', cache: 'no-store', redirect: 'error', signal: active, headers: { Accept: 'application/json' } });
      try { current(binding, active); } catch (error) { cancel(response); throw error; }
      if (!response.ok) { cancel(response); throw new Error('Native place read unavailable'); }
      const result = await receive(response, active); current(binding, active); return result;
    });
    if (!validator.validateNativeRead(commandId, value)) throw new TypeError('Native place result incompatible');
    const result = value as unknown as { requestId: string; commandId: string; status: string; resolvedScope: Scope; data: { records: Array<{ target: { authority: string; recordType: string; recordId: string }; revision: LosslessJson; lifecycle: string; payload: DecodedLocationSemanticsPayload }> } };
    if (result.requestId !== requestId || result.commandId !== commandId || result.status !== 'read' || result.resolvedScope.workspaceId !== binding.scope.workspaceId || result.resolvedScope.homeId !== binding.scope.homeId || result.data.records.length !== 1) throw new TypeError('Native place result correlation differs');
    const record = result.data.records[0]!;
    if (record.target.authority !== 'atlas' || record.target.recordType !== type || record.target.recordId !== recordId || record.lifecycle !== 'active') throw new TypeError('Native place target differs');
    return { ...record, revision: exactStockSafeInteger(record.revision) };
  }
  const command = (binding: NativePlaceBinding, type: string, verb: string, recordId: string, payload: JsonForSerialization, reason: string, guards: readonly Guard[], revision: number | null = null) => ({ schemaVersion: 3,
    commandId: `atlas.${type}.${verb}`, requestId: id(), context: { workspaceId: binding.scope.workspaceId, homeId: binding.scope.homeId }, target: target(type, recordId), payload, reason, idempotencyKey: id(), approvalReceiptId: null,
    preconditions: { target: revision === null ? null : { kind: 'atlas', value: revision }, guards } });
  const evidence = (statement: string) => ({ statement, provenance: { source: null, sourceRevision: null, sourceConfidence: null, evidenceBasis: 'owner-report', factAt: null,
    retrievedAt: new Date().toISOString(), vantage: null, uncertainty: { status: 'unknown', explanation: null } }, supersedesEvidenceIds: [], references: [] });
  const batch = (binding: NativePlaceBinding, commands: JsonForSerialization[], reason: string, guards: readonly Guard[]): NativePlacePrepared => {
    const requestId = id();
    const body = serialize({ schemaVersion: 3, commandId: 'atlas.batch.execute', requestId, context: { workspaceId: binding.scope.workspaceId, homeId: binding.scope.homeId }, target: { authority: 'atlas', kind: 'batch', batchId: id() }, payload: { commands },
      idempotencyKey: id(), reason, approvalReceiptId: null, preconditions: { target: null, guards } });
    return Object.freeze({ binding, requestId, commandId: 'atlas.batch.execute', body });
  };
  const evidenceOwners = new WeakMap<AtlasSessionInfo, object>();
  const evidenceClient = createNativeEvidenceClient({
    getBinding, subscribe: options.subscribe,
    owner(binding) {
      current(binding);
      const session = cached!.session;
      if (!Number.isFinite(Date.parse(session.expiresAt)) || Date.parse(session.expiresAt) <= Date.now()) throw new Error('Native evidence session expired');
      let owner = evidenceOwners.get(session);
      if (!owner) { owner = Object.freeze({}); evidenceOwners.set(session, owner); }
      return owner;
    },
    async exchange(binding, url, method, signal, body) {
      current(binding, signal);
      const session = cached!.session;
      if (Date.parse(session.expiresAt) <= Date.now()) throw new Error('Native evidence session expired');
      const response = await transport(url, { method, signal, credentials: 'same-origin', cache: 'no-store', redirect: 'error',
        headers: { Accept: 'application/json', ...(method === 'POST' ? { 'X-Atlas-CSRF': session.csrfToken } : {}) }, ...(body ? { body } : {}) });
      try { current(binding, signal); if (cached!.session !== session || Date.parse(session.expiresAt) <= Date.now()) throw new Error('Native evidence session changed'); }
      catch (error) { cancel(response); throw error; }
      return response;
    },
  });
  return {
    evidence: evidenceClient,
    getBinding, subscribe: options.subscribe, canCreate, canRename,
    subscribePending(changed) { listeners.add(changed); return () => { listeners.delete(changed); }; },
    pending(binding) { return selectedEntries(binding).map(([prepared, entry]) => ({ prepared, outcome: entry.outcome, ...(entry.receipt ? { receipt: entry.receipt } : {}), ...(entry.inspection ? { inspection: entry.inspection } : {}) })); },
    async inspect(binding, prepared, signal) {
      current(binding, signal);
      const entry = ledger.get(prepared);
      if (!entry || !selectedEntries(binding).some(([value]) => value === prepared)) throw new Error('Submitted request is outside the current session and home');
      const result = await retained.readSerializedNativePlace(prepared.body, () => {
        current(binding, signal);
        if (cached!.session !== entry.session) throw new Error('Submitted request session changed');
        return { session: cached!.session, scope: { ...binding.scope }, commandIds: cached!.admission.commandIds };
      }, signal);
      current(binding, signal);
      entry.inspection = result;
      if (result.status === 'ready' && result.receipt.inspection.outcome === 'retained-commit') entry.outcome = 'committed';
      // Snapshot absence never releases an unknown request or establishes retry safety.
      notify();
      return result;
    },
    async load(binding, recordId, signal) {
      if (!canRename(binding)) throw new Error('Native naming is not admitted');
      return bounded(signal, async sequence => {
      const record = await get(binding, 'location-semantics', recordId, sequence);
      if (record.payload.reviewStatus !== 'accepted') throw new TypeError('Native classification is not accepted');
      const references = [{ type: 'identity' as const, id: record.payload.atlasId }, ...record.payload.evidenceIds.map(id => ({ type: 'evidence' as const, id }))];
      if (record.payload.elevation?.status === 'known' && !references.some(ref => ref.type === 'identity' && ref.id === (record.payload.elevation as { datumAtlasId: string }).datumAtlasId)) references.push({ type: 'identity', id: record.payload.elevation.datumAtlasId });
      const guards: Guard[] = [];
      for (const ref of references) { const value = await get(binding, ref.type, ref.id, sequence); if (ref.type === 'identity' && ref.id === record.payload.atlasId && (value.payload as unknown as { kind: string }).kind !== 'location') throw new TypeError('Native identity is not a location'); guards.push(guard(ref.type, ref.id, value.revision)); }
      current(binding, sequence);
      return { binding, record: record as unknown as TopologyRecord<'location-semantics'>, guards };
      });
    },
    prepareCreate(binding, input) {
      current(binding); writable(binding); text(input.label, 256); text(input.statement, 4096); text(input.reason, reasonLimit);
      if (!canCreate(binding, input.building !== undefined)) throw new Error('Native creation is not admitted');
      const eid = id(), iid = id(), sid = id();
      const commands: JsonForSerialization[] = [command(binding, 'evidence', 'create', eid, evidence(input.statement), input.reason, []),
        command(binding, 'identity', 'create', iid, { kind: 'location', evidenceIds: [eid] }, input.reason, []),
        command(binding, 'location-semantics', 'create', sid, { atlasId: iid, semanticKind: input.kind, reviewStatus: 'accepted', evidenceIds: [eid], label: input.label }, input.reason,
          [])];
      const rootGuards: Guard[] = [];
      if (input.building) {
        const { identity, classification } = input.building;
        if (input.kind !== 'room' || identity.lifecycle !== 'active' || identity.payload.kind !== 'location' || classification.lifecycle !== 'active' || classification.payload.reviewStatus !== 'accepted'
          || classification.payload.semanticKind !== 'building' || classification.payload.atlasId !== identity.target.recordId) throw new TypeError('Membership building differs');
        rootGuards.push(guard('identity', identity.target.recordId, identity.revision), guard('location-semantics', classification.target.recordId, classification.revision));
        commands.push(command(binding, 'relation', 'create', id(), { kind: 'location-membership', membershipKind: 'building', from: { kind: 'atlas-record', ref: { recordType: 'identity', recordId: identity.target.recordId } },
          to: { kind: 'atlas-record', ref: { recordType: 'identity', recordId: iid } }, reviewStatus: 'accepted', uncertainty: { status: 'supported', explanation: null }, evidenceIds: [eid] }, input.reason,
          [guard('identity', identity.target.recordId, identity.revision)]));
      }
      return batch(binding, commands, input.reason, rootGuards);
    },
    prepareRename(admission, input) {
      current(admission.binding); writable(admission.binding); if (!canRename(admission.binding)) throw new Error('Native naming is not admitted');
      if (input.label !== null) text(input.label, 256); text(input.statement, 4096); text(input.reason, reasonLimit);
      const { label: _old, ...original } = admission.record.payload, eid = id();
      const payload = { ...original, ...(input.label === null ? {} : { label: input.label }), evidenceIds: [...original.evidenceIds, eid] };
      const commands: JsonForSerialization[] = [command(admission.binding, 'evidence', 'create', eid, evidence(input.statement), input.reason, []),
        command(admission.binding, 'location-semantics', 'replace', admission.record.target.recordId, payload as unknown as JsonForSerialization, input.reason,
          admission.guards, admission.record.revision)];
      return batch(admission.binding, commands, input.reason, [...admission.guards, guard('location-semantics', admission.record.target.recordId, admission.record.revision)]);
    },
    async commit(prepared, signal) {
      current(prepared.binding, signal);
      if (dispatched.has(prepared)) throw new Error('Native prepared request was already dispatched; inspect retained completion');
      // Repeat the complete-body transport bound before any public-input dispatch or ledger write.
      if (typeof prepared.body !== 'string' || new TextEncoder().encode(prepared.body).byteLength > 16384)
        throw new TypeError('Native place request exceeds native transport bound');
      // Full exact request validation is repeated at dispatch; this string is the retained reconciliation input.
      const raw = parseLosslessJson(prepared.body);
      const parsed = raw as unknown as { commandId: string; requestId: string; context: Scope; payload: { commands: Array<{ commandId: string; context: Scope; target: LosslessJson; payload: LosslessJson; preconditions: { target: { value: LosslessJson } | null } }> } };
      if (parsed.requestId !== prepared.requestId || parsed.commandId !== prepared.commandId || !validator.validateNativeRequest(prepared.commandId, raw)
        || !has(prepared.binding, [prepared.commandId, ...parsed.payload.commands.map(command => command.commandId)])) throw new TypeError('Native prepared request differs');
      if (parsed.context.workspaceId !== prepared.binding.scope.workspaceId || parsed.context.homeId !== prepared.binding.scope.homeId
        || parsed.payload.commands.some(child => child.context.workspaceId !== prepared.binding.scope.workspaceId || child.context.homeId !== prepared.binding.scope.homeId
          || !validator.validateNativeRequest(child.commandId, child as unknown as LosslessJson))) throw new TypeError('Native prepared scope or child differs');
      const result = await bounded(signal, async active => {
        current(prepared.binding, active);
        writable(prepared.binding);
        dispatched.add(prepared);
        ledger.set(prepared, { session: cached!.session, outcome: 'unknown' });
        notify();
        const csrf = cached!.session.csrfToken;
        const response = await transport(`${path(prepared.binding)}/commands`, { method: 'POST', credentials: 'same-origin', cache: 'no-store', redirect: 'error', signal: active,
          headers: { Accept: 'application/json', 'Content-Type': 'application/json', 'x-atlas-csrf': csrf }, body: prepared.body });
        try { current(prepared.binding, active); } catch (error) { cancel(response); throw error; }
        if (!response.ok) { cancel(response); throw new Error('Native place completion unknown'); }
        const value = await receive(response, active); current(prepared.binding, active); return value;
      });
      if (!validator.validateMutation(prepared.commandId, '#/$defs/result_atlas_batch_execute', result)) throw new TypeError('Native place completion incompatible');
      const row = result as unknown as { requestId: string; commandId: string; status: string; resolvedScope: Scope; data: { records: Array<{ target: LosslessJson; payload: LosslessJson; revision: LosslessJson; lifecycle: string }>; auditIds: string[] } };
      if (row.requestId !== prepared.requestId || row.commandId !== prepared.commandId || row.resolvedScope.workspaceId !== prepared.binding.scope.workspaceId || row.resolvedScope.homeId !== prepared.binding.scope.homeId) throw new TypeError('Native place completion correlation differs');
      if (row.data.records.length !== parsed.payload.commands.length || row.data.auditIds.length !== parsed.payload.commands.length
        || parsed.payload.commands.some(child => {
          const record = row.data.records.find(record => sameJson(record.target, child.target));
          const expected = child.preconditions.target === null ? 1 : exactStockSafeInteger(child.preconditions.target.value) + 1;
          return !record || record.lifecycle !== 'active' || exactStockSafeInteger(record.revision) !== expected || !sameJson(record.payload, child.payload);
        })) throw new TypeError('Native place receipt targets differ');
      ledger.get(prepared)!.receipt = result;
      ledger.get(prepared)!.outcome = 'committed';
      notify();
      return { status: row.status === 'committed' ? 'committed' : 'notCommitted', receipt: result };
    },
  };
}
