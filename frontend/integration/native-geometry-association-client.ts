import { createNativeGeometryReadClient } from './native-geometry-read-client';
import type { Scope } from '../src/app/types';
import type { AtlasSessionInfo } from '../src/app/session';
import type { StockAdmission } from '../src/app/StockApplication';
import { ExactDecimal, isExactDecimal } from '../src/numeric/decimal';
import { parseLosslessJson, stringifyLosslessJson, type JsonForSerialization, type LosslessJson } from '../src/numeric/lossless-json';
import { createExactStockResultValidator, exactStockSafeInteger } from '../src/numeric/schema-validator';
import type { NativeAssociationAdmission, NativeAssociationBinding, NativeAssociationClient,
  NativeAssociationPending, NativeAssociationPrepared, NativeAssociationSelection } from '../src/lantern/scans/native-association-types';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const SHA = /^[0-9a-f]{64}$/;
const COMMANDS = ['atlas.identity.get', 'atlas.location-semantics.get', 'atlas.evidence.get', 'atlas.asset.get',
  'atlas.batch.execute', 'atlas.evidence.create', 'atlas.geometry.create', 'atlas.identity.replace'] as const;
const MESH = 'application/vnd.houseatlas.magicplan-authored-mesh+json';
const MAX_BODY = 16_384, MAX_RESULT = 1024 * 1024, DEADLINE_MS = 30_000;
const bytes = new TextEncoder();
type Row = { [key: string]: LosslessJson };
type Kind = 'identity' | 'location-semantics' | 'evidence' | 'asset' | 'geometry';
type Guard = { target: { authority: 'atlas'; recordType: Kind; recordId: string }; revision: { kind: 'atlas'; value: ExactDecimal } };
function need(ok: unknown): asserts ok { if (!ok) throw new TypeError('Native geometry association is not current or qualified'); }
function row(value: LosslessJson): Row { need(value !== null && typeof value === 'object' && !Array.isArray(value) && !isExactDecimal(value)); return value; }
function list(value: LosslessJson): LosslessJson[] { need(Array.isArray(value)); return value; }
function field(value: Row, key: string): LosslessJson { need(Object.hasOwn(value, key)); return value[key]!; }
function text(value: LosslessJson, max = 4096): string { need(typeof value === 'string' && value.length > 0 && [...value].length <= max); return value; }
function id(value: LosslessJson): string { const result = text(value); need(UUID.test(result)); return result; }
function integer(value: LosslessJson): ExactDecimal {
  // Stock's published Atlas public-record/guard bound is 2^53-1. Keep the
  // numeric node exact; an out-of-contract u64 cannot become a rounded guard.
  need(isExactDecimal(value) && value.isInteger && value.compare(ExactDecimal.parse('1')) >= 0 &&
    value.compare(ExactDecimal.parse('9007199254740991')) <= 0);
  return value;
}
function equal(a: LosslessJson, b: LosslessJson): boolean {
  if (isExactDecimal(a) || isExactDecimal(b)) return isExactDecimal(a) && isExactDecimal(b) && a.compare(b) === 0;
  if (a === null || b === null || typeof a !== 'object' || typeof b !== 'object') return a === b;
  if (Array.isArray(a) || Array.isArray(b)) return Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((part, n) => equal(part, b[n]!));
  const keys = Object.keys(a); return keys.length === Object.keys(b).length && keys.every(key => Object.hasOwn(b, key) && equal(a[key]!, b[key]!));
}
function freezeTree(value: LosslessJson): LosslessJson {
  if (value !== null && typeof value === 'object' && !isExactDecimal(value)) { for (const child of Object.values(value)) freezeTree(child); Object.freeze(value); }
  return value;
}
function guard(kind: Kind, recordId: string, revision: ExactDecimal): Guard {
  return { target: { authority: 'atlas', recordType: kind, recordId }, revision: { kind: 'atlas', value: revision } };
}
function target(kind: Kind | 'geometry', recordId: string) { return { authority: 'atlas' as const, recordType: kind, recordId }; }
function cancel(response: Response) { void response.body?.cancel().catch(() => undefined); }
async function bounded<T>(outer: AbortSignal, work: (signal: AbortSignal) => Promise<T>): Promise<T> {
  const controller = new AbortController(); const forward = () => controller.abort(outer.reason);
  let stop!: (reason: unknown) => void;
  const ended = new Promise<never>((_, reject) => { stop = reject; });
  const aborted = () => stop(controller.signal.reason ?? new Error('Native geometry association stopped'));
  controller.signal.addEventListener('abort', aborted, { once: true }); outer.addEventListener('abort', forward, { once: true });
  const timer = setTimeout(() => controller.abort(new Error('Native geometry association deadline')), DEADLINE_MS);
  if (outer.aborted) forward();
  try { controller.signal.throwIfAborted(); return await Promise.race([work(controller.signal), ended]); }
  finally { clearTimeout(timer); outer.removeEventListener('abort', forward); controller.signal.removeEventListener('abort', aborted); controller.abort(); }
}
async function receive(response: Response, signal: AbortSignal): Promise<LosslessJson> {
  need(response.status === 200 && !response.redirected && response.type !== 'opaque' && response.type !== 'opaqueredirect');
  need(response.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase() === 'application/json');
  const length = response.headers.get('content-length');
  need(length === null || (/^(0|[1-9][0-9]*)$/.test(length) && BigInt(length) <= BigInt(MAX_RESULT)));
  const reader = response.body?.getReader(); need(reader);
  const abort = () => { void reader.cancel().catch(() => undefined); }; signal.addEventListener('abort', abort, { once: true });
  const chunks: Uint8Array[] = []; let total = 0;
  try {
    for (;;) {
      signal.throwIfAborted(); const next = await reader.read(); signal.throwIfAborted();
      if (next.done) break; need(next.value instanceof Uint8Array && next.value.length <= MAX_RESULT - total && chunks.length < 8192);
      total += next.value.length; chunks.push(next.value);
    }
    need(total > 0 && (length === null || BigInt(length) === BigInt(total)));
    const combined = new Uint8Array(total); let offset = 0;
    for (const chunk of chunks) { combined.set(chunk, offset); offset += chunk.length; }
    return parseLosslessJson(new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(combined));
  } catch (error) { abort(); throw error; }
  finally { signal.removeEventListener('abort', abort); reader.releaseLock(); }
}
function scalar(value: string) { for (const char of value) { const point = char.codePointAt(0)!; need(point < 0xd800 || point > 0xdfff); } }
/** The native Stock owner removes only the root requestId and approvalReceiptId,
 * then RFC 8785 hashes the full remaining batch. Schema-checked numeric leaves
 * here are bounded integers, so this canonical view cannot round a u64 guard. */
function canonical(value: LosslessJson): string {
  if (isExactDecimal(value)) return JSON.stringify(exactStockSafeInteger(value));
  if (value === null || typeof value === 'boolean') return JSON.stringify(value);
  if (typeof value === 'string') { scalar(value); return JSON.stringify(value); }
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  return `{${Object.keys(value).sort().map(key => { scalar(key); return `${JSON.stringify(key)}:${canonical(value[key]!)}`; }).join(',')}}`;
}
async function digest(request: LosslessJson): Promise<string> {
  const intent = { ...row(request) }; delete intent.requestId; delete intent.approvalReceiptId;
  const hash = await crypto.subtle.digest('SHA-256', bytes.encode(canonical(intent)));
  return [...new Uint8Array(hash)].map(part => part.toString(16).padStart(2, '0')).join('');
}

export interface NativeAssociationHostContext {
  /** Stable opaque identity of the actual canonical private-host session owner. */
  readonly sessionIdentity: object;
  readonly session: AtlasSessionInfo;
  readonly scope: Scope;
  readonly admission: StockAdmission;
}
type Epoch = object;
type Owner = { identity: object; actor: string; csrf: string; expiry: string; workspace: string; home: string; epoch: Epoch };
type Current = Owner & { binding: NativeAssociationBinding; revision: string; commands: string };
type Admitted = { epoch: Epoch; records: Map<string, Row> };
type Intent = { epoch: Epoch; admission: NativeAssociationAdmission };
type Pending = { epoch: Epoch; outcome: 'unknown' | 'committed'; receipt?: LosslessJson };

export function createNativeGeometryAssociationClient(options: {
  getContext(): NativeAssociationHostContext | null;
  subscribe(changed: () => void): () => void;
  transport?: typeof fetch;
  /** Explicit same-origin descriptor owner URL in non-browser hosts. */
  origin?: string;
}): NativeAssociationClient {
  const validator = createExactStockResultValidator();
  const transport = options.transport ?? ((...args: Parameters<typeof fetch>) => fetch(...args));
  const admissions = new WeakMap<NativeAssociationAdmission, Admitted>();
  const intents = new WeakMap<NativeAssociationPrepared, Intent>();
  const dispatched = new WeakSet<NativeAssociationPrepared>();
  const ledger = new Map<NativeAssociationPrepared, Pending>();
  const listeners = new Set<() => void>();
  const notify = () => { for (const listener of listeners) queueMicrotask(listener); };
  let owner: Owner | null = null, cached: Current | null = null;
  const getBinding = (): NativeAssociationBinding | null => {
    let next: NativeAssociationHostContext | null;
    try { next = options.getContext(); } catch { cached = null; return null; }
    if (!next || !next.sessionIdentity || typeof next.sessionIdentity !== 'object' || next.session.schemaVersion !== 1 ||
      !next.session.actorId || !next.session.csrfToken || !Number.isFinite(Date.parse(next.session.expiresAt)) ||
      Date.parse(next.session.expiresAt) <= Date.now() || !UUID.test(next.scope.workspaceId) || !UUID.test(next.scope.homeId) ||
      next.scope.workspaceId !== next.admission.scope.workspaceId || next.scope.homeId !== next.admission.scope.homeId) {
      cached = null; return null; // A gap masks; it never erases an unknown ledger row.
    }
    const same = owner && owner.identity === next.sessionIdentity && owner.actor === next.session.actorId &&
      owner.csrf === next.session.csrfToken && owner.expiry === next.session.expiresAt &&
      owner.workspace === next.scope.workspaceId && owner.home === next.scope.homeId;
    if (!same) owner = { identity: next.sessionIdentity, actor: next.session.actorId, csrf: next.session.csrfToken,
      expiry: next.session.expiresAt, workspace: next.scope.workspaceId, home: next.scope.homeId, epoch: Object.freeze({}) };
    const commands = JSON.stringify(next.admission.commandIds);
    if (!cached || cached.epoch !== owner!.epoch || cached.revision !== next.admission.revision || cached.commands !== commands) {
      cached = { ...owner!, revision: next.admission.revision, commands,
        binding: Object.freeze({ scope: Object.freeze({ workspaceId: next.scope.workspaceId, homeId: next.scope.homeId }) }) };
    }
    return cached.binding;
  };
  const admittedCommands = () => { const next = options.getContext(); return !!next && COMMANDS.every(command => next.admission.commandIds.includes(command)); };
  const current = (binding: NativeAssociationBinding, epoch?: Epoch) => getBinding() === binding &&
    (epoch === undefined || cached!.epoch === epoch) && admittedCommands();
  const requireCurrent = (binding: NativeAssociationBinding, epoch?: Epoch) => need(current(binding, epoch));
  const unknown = () => cached && [...ledger.values()].some(item => item.epoch === cached!.epoch && item.outcome === 'unknown');
  const stockPath = (binding: NativeAssociationBinding) => `/api/atlas/stock/v3/workspaces/${binding.scope.workspaceId}/homes/${binding.scope.homeId}`;
  const serialize = (value: JsonForSerialization, commandId: string): { body: string; parsed: LosslessJson } => {
    const body = stringifyLosslessJson(value); need(bytes.encode(body).length <= MAX_BODY);
    const parsed = parseLosslessJson(body); need(validator.validateNativeRequest(commandId, parsed));
    return { body, parsed };
  };
  const read = async (binding: NativeAssociationBinding, epoch: Epoch, kind: Kind, recordId: string, signal: AbortSignal): Promise<Row> => {
    requireCurrent(binding, epoch);
    const commandId = `atlas.${kind}.get`, requestId = crypto.randomUUID();
    const { body } = serialize({ schemaVersion: 3, commandId, requestId, context: binding.scope,
      target: target(kind, recordId), payload: {} }, commandId);
    const url = `${stockPath(binding)}/invoke?request=${encodeURIComponent(body)}`; need(url.length <= 32_768);
    const response = await transport(url, { method: 'GET', credentials: 'same-origin', cache: 'no-store', redirect: 'error',
      signal, headers: { Accept: 'application/json' } });
    try {
      requireCurrent(binding, epoch); const result = await receive(response, signal); requireCurrent(binding, epoch);
      need(validator.validateNativeRead(commandId, result));
      const output = row(result), scope = row(field(output, 'resolvedScope')), data = row(field(output, 'data'));
      need(output.commandId === commandId && output.requestId === requestId && output.status === 'read' &&
        scope.workspaceId === binding.scope.workspaceId && scope.homeId === binding.scope.homeId &&
        data.sourceStatus === 'current' && data.nextCursor === null);
      const records = list(field(data, 'records')); need(records.length === 1);
      const record = row(records[0]!); const found = row(field(record, 'target'));
      need(found.authority === 'atlas' && found.recordType === kind && found.recordId === recordId && record.lifecycle === 'active');
      integer(field(record, 'revision')); return record;
    } catch (error) { cancel(response); throw error; }
  };
  const added = (kind: Kind | 'geometry', recordId: string, payload: JsonForSerialization, reason: string,
    guards: readonly Guard[], revision: ExactDecimal | null = null) => ({ schemaVersion: 3, commandId: `atlas.${kind}.${revision ? 'replace' : 'create'}`,
    requestId: crypto.randomUUID(), context: cached!.binding.scope, target: target(kind, recordId), payload, reason,
    idempotencyKey: crypto.randomUUID(), approvalReceiptId: null,
    preconditions: { target: revision ? { kind: 'atlas', value: revision } : null, guards } });
  const validateInput = (selection: NativeAssociationSelection) => {
    need(UUID.test(selection.buildingId) && UUID.test(selection.semanticsId) && UUID.test(selection.originalAssetId) &&
      UUID.test(selection.derivativeAssetId) && selection.originalAssetId !== selection.derivativeAssetId &&
      (selection.previousGeometryId == null || UUID.test(selection.previousGeometryId)));
  };
  options.subscribe(() => { getBinding(); notify(); });
  getBinding();
  return {
    getBinding, subscribe: changed => options.subscribe(changed),
    subscribePending(changed) { listeners.add(changed); return () => { listeners.delete(changed); }; },
    pending(binding): readonly NativeAssociationPending[] {
      if (!current(binding)) return Object.freeze([]);
      return Object.freeze([...ledger].filter(([, item]) => item.epoch === cached!.epoch).map(([prepared, item]) =>
        Object.freeze({ prepared, outcome: item.outcome, ...(item.receipt ? { receipt: item.receipt } : {}) })));
    },
    async load(binding, selection, signal) {
      validateInput(selection); requireCurrent(binding); need(!unknown() && ledger.size < 16);
      const epoch = cached!.epoch;
      return bounded(signal, async active => {
        const records = new Map<string, Row>();
        const get = async (kind: Kind, recordId: string) => {
          const key = `${kind}:${recordId}`; if (!records.has(key)) records.set(key, await read(binding, epoch, kind, recordId, active));
          return records.get(key)!;
        };
        const identity = await get('identity', selection.buildingId);
        const semantics = await get('location-semantics', selection.semanticsId);
        const identityPayload = row(field(identity, 'payload')), semanticsPayload = row(field(semantics, 'payload'));
        need(identityPayload.kind === 'location' && semanticsPayload.atlasId === selection.buildingId &&
          semanticsPayload.semanticKind === 'building' && semanticsPayload.reviewStatus === 'accepted');
        const original = await get('asset', selection.originalAssetId), derivative = await get('asset', selection.derivativeAssetId);
        for (const [record, purpose, mime] of [[original, 'geometry-original', 'model/vnd.usdz+zip'],
          [derivative, 'derived-preview', MESH]] as const) {
          const payload = row(field(record, 'payload'));
          need(payload.owner === 'atlas' && payload.purpose === purpose && payload.contentType === mime &&
            payload.availability === 'available' && payload.previewPolicy === 'download-only' && SHA.test(text(field(payload, 'sha256'))));
        }
        for (const value of [...list(field(identityPayload, 'evidenceIds')), ...list(field(semanticsPayload, 'evidenceIds'))])
          await get('evidence', id(value));
        if (selection.previousGeometryId != null) {
          need(options.getContext()!.admission.commandIds.includes('atlas.geometry.get'));
          const previous = await get('geometry', selection.previousGeometryId);
          const payload = row(field(previous, 'payload'));
          const version = integer(field(payload, 'geometryVersion'));
          need(version.compare(ExactDecimal.parse('9007199254740991')) < 0 && payload.producer === 'magicplan' &&
            payload.exportFormat === 'usdz' && payload.coordinateUnits === 'unknown' && payload.scale === null &&
            payload.transform === null && list(field(payload, 'mappings')).length === 0);
          const ids = list(field(payload, 'evidenceIds')).map(id); need(ids.length === 1);
          const evidence = await get('evidence', ids[0]!);
          const evidencePayload = row(field(evidence, 'payload'));
          const previousOriginalId = id(field(payload, 'originalAssetId'));
          const references = list(field(evidencePayload, 'references')).map(row); need(references.length === 2);
          need(references[0]!.kind === 'atlas-asset' && references[0]!.assetId === previousOriginalId && references[1]!.kind === 'atlas-asset');
          const previousDerivativeId = id(field(references[1]!, 'assetId'));
          const previousOriginal = await get('asset', previousOriginalId), previousDerivative = await get('asset', previousDerivativeId);
          // The existing native reader admits only actual owner-issued current
          // descriptors. Its floor membership supplies the head/building proof.
          const readBinding = Object.freeze({ sessionIdentity: cached!.identity, expiresAt: cached!.expiry, scope: binding.scope });
          const reader = createNativeGeometryReadClient({
            origin: options.origin ?? globalThis.location.origin, transport,
            getBinding: () => current(binding, epoch) ? readBinding : null,
            subscribeBinding: options.subscribe,
          });
          try {
            const frame = await reader.loadBuilding(selection.buildingId, active);
            requireCurrent(binding, epoch);
            const head = frame.descriptor.floors.find(item => item.floor.geometryId === selection.previousGeometryId)?.floor;
            need(head && equal(head.geometryRevision, field(previous, 'revision')) && head.evidenceId === ids[0] &&
              equal(head.evidenceRevision, field(evidence, 'revision')) && head.originalAssetId === previousOriginalId &&
              head.derivativeAssetId === previousDerivativeId && equal(head.originalRevision, field(previousOriginal, 'revision')) &&
              equal(head.derivativeRevision, field(previousDerivative, 'revision')) &&
              head.originalSha256 === row(field(previousOriginal, 'payload')).sha256 &&
              head.derivativeSha256 === row(field(previousDerivative, 'payload')).sha256);
          } finally { reader.dispose(); }
        }
        requireCurrent(binding, epoch); need(!unknown() && records.size <= 100);
        const admission: NativeAssociationAdmission = Object.freeze({ binding,
          selection: Object.freeze({ ...selection }), records: Object.freeze([...records.values()].map(record => freezeTree(record))) });
        admissions.set(admission, { epoch, records }); return admission;
      });
    },
    prepare(admission, input) {
      const pin = admissions.get(admission); need(pin); requireCurrent(admission.binding, pin.epoch);
      need(!unknown() && ledger.size < 16 && input.statement.trim() && [...input.statement].length <= 4096 &&
        input.reason.trim() && [...input.reason].length <= 1024);
      scalar(input.statement); scalar(input.reason);
      const { buildingId, semanticsId, originalAssetId, derivativeAssetId } = admission.selection;
      const find = (kind: Kind, recordId: string) => { const found = pin.records.get(`${kind}:${recordId}`); need(found); return found; };
      const identity = find('identity', buildingId), semantics = find('location-semantics', semanticsId);
      const identityPayload = row(field(identity, 'payload')), semanticsPayload = row(field(semantics, 'payload'));
      const evidenceIds = list(field(identityPayload, 'evidenceIds')).map(id);
      const semanticIds = list(field(semanticsPayload, 'evidenceIds')).map(id);
      const guards: Guard[] = [guard('identity', buildingId, integer(field(identity, 'revision'))),
        guard('location-semantics', semanticsId, integer(field(semantics, 'revision'))),
        guard('asset', originalAssetId, integer(field(find('asset', originalAssetId), 'revision'))),
        guard('asset', derivativeAssetId, integer(field(find('asset', derivativeAssetId), 'revision')))];
      for (const evidenceId of new Set([...evidenceIds, ...semanticIds]))
        guards.push(guard('evidence', evidenceId, integer(field(find('evidence', evidenceId), 'revision'))));
      need(guards.length <= 100 && new Set(evidenceIds).size === evidenceIds.length && !unknown());
      const previousGeometryId = admission.selection.previousGeometryId ?? null;
      const predecessorGuards: Guard[] = [];
      let geometryVersion = ExactDecimal.parse('1');
      if (previousGeometryId !== null) {
        const previous = find('geometry', previousGeometryId), payload = row(field(previous, 'payload'));
        geometryVersion = ExactDecimal.parse((BigInt(exactStockSafeInteger(integer(field(payload, 'geometryVersion')))) + 1n).toString());
        const previousEvidenceId = id(list(field(payload, 'evidenceIds'))[0]!);
        const references = list(field(row(field(find('evidence', previousEvidenceId), 'payload')), 'references')).map(row);
        for (const [kind, recordId] of [['geometry', previousGeometryId], ['evidence', previousEvidenceId],
          ['asset', id(field(references[0]!, 'assetId'))], ['asset', id(field(references[1]!, 'assetId'))]] as const)
          predecessorGuards.push(guard(kind, recordId, integer(field(find(kind, recordId), 'revision'))));
        for (const item of predecessorGuards) if (!guards.some(other => equal(other, item))) guards.push(item);
      }
      need(guards.length <= 100);
      const evidenceId = crypto.randomUUID(), geometryId = crypto.randomUUID();
      const evidencePayload = { statement: input.statement, provenance: { source: null, sourceRevision: null,
        sourceConfidence: null, evidenceBasis: 'owner-report', factAt: null, retrievedAt: new Date().toISOString(),
        vantage: null, uncertainty: { status: 'unknown', explanation: null } }, supersedesEvidenceIds: [],
        references: [{ kind: 'atlas-asset', assetId: originalAssetId }, { kind: 'atlas-asset', assetId: derivativeAssetId }] };
      const geometryPayload = { producer: 'magicplan', producerVersion: null, exportFormat: 'usdz', originalAssetId,
        coordinateUnits: 'unknown', scale: null, transform: null, geometryVersion,
        previousGeometryId, mappings: [], evidenceIds: [evidenceId] };
      const identityReplacement = { ...identityPayload, evidenceIds: [...evidenceIds, evidenceId] };
      const children = [added('evidence', evidenceId, evidencePayload, input.reason,
        guards.filter(item => item.target.recordType === 'asset')),
      added('geometry', geometryId, geometryPayload, input.reason,
        [guard('asset', originalAssetId, integer(field(find('asset', originalAssetId), 'revision'))), ...predecessorGuards]),
      added('identity', buildingId, identityReplacement, input.reason,
        guards.filter(item => item.target.recordType === 'evidence'), integer(field(identity, 'revision')))];
      for (const child of children) {
        const encoded = serialize(child, child.commandId);
        need(validator.validateNativeRequest(child.commandId, encoded.parsed));
      }
      const requestId = crypto.randomUUID();
      const { body, parsed } = serialize({ schemaVersion: 3, commandId: 'atlas.batch.execute', requestId,
        context: admission.binding.scope, target: { authority: 'atlas', kind: 'batch', batchId: crypto.randomUUID() },
        payload: { commands: children }, idempotencyKey: crypto.randomUUID(), reason: input.reason,
        approvalReceiptId: null, preconditions: { target: null, guards } }, 'atlas.batch.execute');
      const prepared: NativeAssociationPrepared = Object.freeze({ binding: admission.binding,
        selection: admission.selection, requestId, body, originalRequest: freezeTree(parsed) });
      intents.set(prepared, { epoch: pin.epoch, admission }); return prepared;
    },
    async commit(prepared, signal) {
      const pin = intents.get(prepared); need(pin && !dispatched.has(prepared));
      requireCurrent(prepared.binding, pin.epoch); need(!unknown() && ledger.size < 16);
      need(typeof prepared.body === 'string' && bytes.encode(prepared.body).length <= MAX_BODY);
      const request = parseLosslessJson(prepared.body), root = row(request);
      need(equal(request, prepared.originalRequest) && root.requestId === prepared.requestId &&
        validator.validateNativeRequest('atlas.batch.execute', request));
      const children = list(field(row(field(root, 'payload')), 'commands')).map(row);
      need(children.length === 3 && ['atlas.evidence.create', 'atlas.geometry.create', 'atlas.identity.replace']
        .every((name, n) => children[n]!.commandId === name && validator.validateNativeRequest(name, children[n]!)));
      const scope = row(field(root, 'context'));
      need(scope.workspaceId === prepared.binding.scope.workspaceId && scope.homeId === prepared.binding.scope.homeId &&
        children.every(child => { const context = row(field(child, 'context')); return context.workspaceId === scope.workspaceId && context.homeId === scope.homeId; }));
      const url = `/api/atlas/geometry/v1/workspaces/${scope.workspaceId}/homes/${scope.homeId}/buildings/${prepared.selection.buildingId}/associations`;
      // No automatic resend. Record the exact body before the only POST; all
      // transport, timeout, abort and correlation failures retain unknown.
      dispatched.add(prepared); ledger.set(prepared, { epoch: pin.epoch, outcome: 'unknown' }); notify();
      return bounded(signal, async active => {
        const controller = new AbortController(), forward = () => controller.abort(active.reason);
        active.addEventListener('abort', forward, { once: true });
        const changed = () => { if (!current(prepared.binding, pin.epoch)) controller.abort(new Error('Native geometry context changed')); };
        const stop = options.subscribe(changed);
        try {
          changed(); controller.signal.throwIfAborted(); requireCurrent(prepared.binding, pin.epoch);
          const csrf = options.getContext()!.session.csrfToken;
          const response = await transport(url, { method: 'POST', credentials: 'same-origin', cache: 'no-store', redirect: 'error',
            signal: controller.signal, headers: { Accept: 'application/json', 'Content-Type': 'application/json', 'X-Atlas-CSRF': csrf }, body: prepared.body });
          try {
            requireCurrent(prepared.binding, pin.epoch); const result = await receive(response, controller.signal);
            requireCurrent(prepared.binding, pin.epoch);
            need(validator.validateMutation('atlas.batch.execute', '#/$defs/result_atlas_batch_execute', result));
            const output = row(result), resolved = row(field(output, 'resolvedScope')), data = row(field(output, 'data'));
            need(output.commandId === 'atlas.batch.execute' && output.requestId === prepared.requestId &&
              output.status === 'committed' && output.replayed === false &&
              resolved.workspaceId === scope.workspaceId && resolved.homeId === scope.homeId);
            const records = list(field(data, 'records')).map(row), audits = list(field(data, 'auditIds'));
            need(records.length === 3 && audits.length === 3 && new Set(audits.map(id)).size === 3);
            for (let n = 0; n < 3; n++) {
              const child = children[n]!, record = records[n]!, expected = row(field(child, 'target'));
              const got = row(field(record, 'target'));
              need(equal(expected, got) && record.lifecycle === 'active');
              const revision = integer(field(record, 'revision'));
              const prior = field(row(field(child, 'preconditions')), 'target');
              const expectedRevision = prior === null ? ExactDecimal.parse('1') :
                ExactDecimal.parse((BigInt(exactStockSafeInteger(integer(field(row(prior), 'value')))) + 1n).toString());
              need(revision.compare(expectedRevision) === 0);
              const payload = row(field(record, 'payload')), intended = row(field(child, 'payload'));
              if (n === 1) { const copy = { ...payload }; delete copy.importedAt; need(typeof payload.importedAt === 'string' && equal(copy, intended)); }
              else need(equal(payload, intended));
            }
            const requestDigest = text(field(data, 'requestDigest')); need(SHA.test(requestDigest) && requestDigest === await digest(request));
            active.throwIfAborted(); controller.signal.throwIfAborted();
            requireCurrent(prepared.binding, pin.epoch);
            ledger.set(prepared, { epoch: pin.epoch, outcome: 'committed', receipt: freezeTree(result) }); notify();
            return result;
          } catch (error) { cancel(response); throw error; }
        } finally { stop(); active.removeEventListener('abort', forward); }
      });
    },
  };
}
