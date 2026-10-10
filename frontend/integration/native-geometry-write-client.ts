import type { Scope } from '../src/app/types';
import type { AtlasSessionInfo } from '../src/app/session';
import type { StockAdmission } from '../src/app/StockApplication';
import type { NativeGeometryBinding, NativeGeometryCustodyReceipt, NativeGeometryInput,
  NativeGeometryKind, NativeGeometryLicense, NativeGeometryPending, NativeGeometryPrepared,
  NativeGeometryWriteClient } from '../src/lantern/scans/native-write-types';
import { isExactDecimal } from '../src/numeric/decimal';
import { parseLosslessJson, stringifyLosslessJson, type LosslessJson } from '../src/numeric/lossless-json';
import { createExactStockResultValidator, exactStockSafeInteger } from '../src/numeric/schema-validator';

const derivativeType = 'application/vnd.houseatlas.magicplan-authored-mesh+json';
const originalLimit = 10 * 1024 * 1024;
const derivativeLimit = 8 * 1024 * 1024;
const bodyLimit = 1024 * 1024;
const command = 'atlas.asset.create';
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const encoder = new TextEncoder();
function require(value: boolean): asserts value {
  if (!value) throw new TypeError('Native geometry custody does not match its original intent');
}
function object(value: LosslessJson): { [key: string]: LosslessJson } {
  if (!value || typeof value !== 'object' || Array.isArray(value) || isExactDecimal(value))
    throw new TypeError('Expected native geometry object');
  return value;
}
function field(value: { [key: string]: LosslessJson }, key: string): LosslessJson {
  if (!Object.hasOwn(value, key)) throw new TypeError('Native geometry field missing');
  return value[key]!;
}
function array(value: LosslessJson): LosslessJson[] {
  if (!Array.isArray(value)) throw new TypeError('Expected native geometry array');
  return value;
}
function freezeTree(value: LosslessJson): LosslessJson {
  if (value && typeof value === 'object' && !isExactDecimal(value)) {
    for (const child of Object.values(value)) freezeTree(child);
    Object.freeze(value);
  }
  return value;
}
function scalarText(value: string) {
  // Rust strings contain Unicode scalar values. Reject lone UTF-16 surrogates
  // before UTF-8 encoding can silently replace them.
  for (const char of value) {
    const point = char.codePointAt(0)!;
    if (point >= 0xd800 && point <= 0xdfff) throw new TypeError('Invalid native text');
  }
}
function license(value: NativeGeometryLicense): NativeGeometryLicense {
  if (!value || Object.keys(value).length !== 2 || !Object.hasOwn(value, 'status') || !Object.hasOwn(value, 'reference') ||
      !['unknown', 'permitted', 'restricted'].includes(value.status) ||
      (value.reference !== null && (typeof value.reference !== 'string' || !value.reference || [...value.reference].length > 4096)))
    throw new TypeError('Invalid native geometry license');
  if (value.reference !== null) scalarText(value.reference);
  return Object.freeze({ status: value.status, reference: value.reference });
}
function cancel(response: Response) { void response.body?.cancel().catch(() => undefined); }
/** Both headers and the owned body share one hard settlement budget. */
async function bounded<T>(outer: AbortSignal, action: (signal: AbortSignal) => Promise<T>): Promise<T> {
  const controller = new AbortController();
  const forward = () => controller.abort(outer.reason);
  let reject!: (error: unknown) => void;
  const stopped = new Promise<never>((_, no) => { reject = no; });
  const stop = () => reject(controller.signal.reason);
  controller.signal.addEventListener('abort', stop, { once: true });
  outer.addEventListener('abort', forward, { once: true });
  const timer = setTimeout(() => controller.abort(new Error('Native geometry exchange exceeded deadline')), 30000);
  if (outer.aborted) forward();
  try { controller.signal.throwIfAborted(); return await Promise.race([action(controller.signal), stopped]); }
  finally { clearTimeout(timer); outer.removeEventListener('abort', forward); controller.signal.removeEventListener('abort', stop); }
}
async function receive(response: Response, signal: AbortSignal): Promise<string> {
  const length = response.headers.get('content-length');
  if (length !== null && (!/^[0-9]+$/.test(length) || Number(length) > bodyLimit)) {
    cancel(response); throw new TypeError('Native geometry receipt exceeds bound');
  }
  const reader = response.body?.getReader();
  if (!reader) throw new TypeError('Native geometry receipt body missing');
  const stop = () => { void reader.cancel().catch(() => undefined); };
  signal.addEventListener('abort', stop, { once: true });
  const chunks: Uint8Array[] = []; let bytes = 0;
  try {
    for (;;) {
      signal.throwIfAborted(); const part = await reader.read(); signal.throwIfAborted();
      if (part.done) break;
      bytes += part.value.byteLength;
      if (bytes > bodyLimit) throw new TypeError('Native geometry receipt exceeds bound');
      chunks.push(part.value);
    }
    const body = new Uint8Array(bytes); let offset = 0;
    for (const chunk of chunks) { body.set(chunk, offset); offset += chunk.byteLength; }
    return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(body);
  } catch (error) { stop(); throw error; }
  finally { signal.removeEventListener('abort', stop); reader.releaseLock(); }
}
async function hash(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new Uint8Array(bytes).buffer);
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
}
/** This serializer is restricted to the schema-checked single asset intent:
 * its numeric leaves are safe integers. The native JCS owner sorts UTF-16 keys
 * and excludes ONLY root requestId/approvalReceiptId for this Atlas command.
 * Exact receipt trees are never rewritten with this canonical digest view. */
function canonicalAssetIntent(value: LosslessJson): string {
  if (isExactDecimal(value)) return JSON.stringify(exactStockSafeInteger(value));
  if (value === null || typeof value === 'boolean') return JSON.stringify(value);
  if (typeof value === 'string') { scalarText(value); return JSON.stringify(value); }
  if (Array.isArray(value)) return `[${value.map(canonicalAssetIntent).join(',')}]`;
  return `{${Object.keys(value).sort().map(key => {
    scalarText(key); return `${JSON.stringify(key)}:${canonicalAssetIntent(value[key]!)}`;
  }).join(',')}}`;
}
/** Supplied only by the private native host. sessionIdentity is the actual
 * canonical session owner's stable opaque object, rotated by that owner on
 * session replacement/logout. Never mint it per getter call or derive it from
 * actor/CSRF/expiry strings. DTO snapshots themselves may be fresh clones. */
export interface NativeGeometryHostContext {
  readonly sessionIdentity: object;
  readonly session: AtlasSessionInfo;
  readonly scope: Scope;
  readonly admission: StockAdmission;
}
type Epoch = object;
type OwnerPin = { sessionIdentity: object; actorId: string; csrf: string; expiry: string;
  workspace: string; home: string; epoch: Epoch };
type ContextPin = NativeGeometryHostContext & OwnerPin & {
  admissionRevision: string; commands: string; binding: NativeGeometryBinding };
type IntentPin = { epoch: Epoch; original?: NativeGeometryCustodyReceipt };
type LedgerRow = { epoch: Epoch; outcome: 'unknown' | 'committed'; receipt?: NativeGeometryCustodyReceipt };

export function createNativeGeometryWriteClient(options: {
  getContext(): NativeGeometryHostContext | null;
  subscribe(changed: () => void): () => void;
  transport?: typeof fetch;
}): NativeGeometryWriteClient {
  const validator = createExactStockResultValidator();
  const transport = options.transport ?? ((...args: Parameters<typeof fetch>) => fetch(...args));
  const intents = new WeakMap<NativeGeometryPrepared, IntentPin>();
  const receipts = new WeakMap<NativeGeometryCustodyReceipt, Epoch>();
  const dispatched = new WeakSet<NativeGeometryPrepared>();
  const ledger = new Map<NativeGeometryPrepared, LedgerRow>();
  const listeners = new Set<() => void>();
  const notify = () => { for (const changed of listeners) queueMicrotask(changed); };
  let cached: ContextPin | null = null;
  // Missing admission/view scope temporarily masks the current binding. Keep
  // the last accepted actual owner tuple separately so restoring that same
  // context cannot erase an already submitted unknown custody hold.
  let acceptedOwner: OwnerPin | null = null;
  const getBinding = (): NativeGeometryBinding | null => {
    const next = options.getContext();
    if (!next || next.sessionIdentity === null || typeof next.sessionIdentity !== 'object' ||
        next.session.schemaVersion !== 1 || !next.session.actorId || !next.session.csrfToken ||
        !Number.isFinite(Date.parse(next.session.expiresAt)) || Date.parse(next.session.expiresAt) <= Date.now() ||
        !uuid.test(next.scope.workspaceId) || !uuid.test(next.scope.homeId) ||
        next.scope.workspaceId !== next.admission.scope.workspaceId || next.scope.homeId !== next.admission.scope.homeId) {
      cached = null; return null;
    }
    const sameSession = acceptedOwner && next.sessionIdentity === acceptedOwner.sessionIdentity && next.session.actorId === acceptedOwner.actorId &&
      next.session.csrfToken === acceptedOwner.csrf && next.session.expiresAt === acceptedOwner.expiry &&
      next.scope.workspaceId === acceptedOwner.workspace && next.scope.homeId === acceptedOwner.home;
    if (!sameSession) acceptedOwner = { sessionIdentity: next.sessionIdentity,
      actorId: next.session.actorId, csrf: next.session.csrfToken, expiry: next.session.expiresAt,
      workspace: next.scope.workspaceId, home: next.scope.homeId, epoch: Object.freeze({}) };
    const commands = JSON.stringify(next.admission.commandIds);
    if (!cached || cached.epoch !== acceptedOwner!.epoch ||
        next.admission.revision !== cached.admissionRevision || commands !== cached.commands) {
      cached = { ...next, ...acceptedOwner!, admissionRevision: next.admission.revision,
        commands, binding: Object.freeze({ scope: Object.freeze({ workspaceId: next.scope.workspaceId, homeId: next.scope.homeId }) }) };
    }
    return cached!.binding;
  };
  const current = (binding: NativeGeometryBinding, epoch?: Epoch) => getBinding() === binding &&
    (epoch === undefined || cached!.epoch === epoch) && cached!.admission.commandIds.includes(command);
  const unknown = () => cached && [...ledger.values()].some(row => row.epoch === cached!.epoch && row.outcome === 'unknown');
  // Bound retained Blob memory without evicting an unresolved input or receipt.
  const canPrepare = (binding: NativeGeometryBinding) => current(binding) && !unknown() && ledger.size < 16;
  const assertCurrent = (binding: NativeGeometryBinding, epoch?: Epoch) => {
    if (!current(binding, epoch)) throw new Error('Native geometry context changed');
  };
  const prepare = async (binding: NativeGeometryBinding, kind: NativeGeometryKind, input: NativeGeometryInput,
    contentType: string, signal: AbortSignal, original?: NativeGeometryCustodyReceipt): Promise<NativeGeometryPrepared> => {
    signal.throwIfAborted(); require(canPrepare(binding));
    const epoch = cached!.epoch;
    if (kind === 'original') require(contentType === 'model/vnd.usdz+zip' || contentType === 'application/x-step');
    else {
      require(contentType === derivativeType && original !== undefined && original.kind === 'original' && receipts.get(original) === epoch);
      const originalPayload = object(field(object(original.originalRequest), 'payload'));
      require(object(field(originalPayload, 'staged')).contentType === 'model/vnd.usdz+zip');
    }
    scalarText(input.filename); scalarText(input.reason);
    require(!!input.filename && [...input.filename].length <= 255 && !/[\/\\\u0000-\u001f]/.test(input.filename));
    require(!!input.reason.trim() && [...input.reason].length <= 1024);
    const sourceLicense = license(input.sourceLicense);
    require(input.file instanceof Blob && input.file.size > 0 && input.file.size <= (kind === 'original' ? originalLimit : derivativeLimit));
    // Blob bytes are immutable. The copy fixes the actual multipart MIME rather
    // than trusting an incoming File.type or changing the original byte content.
    const file = Object.freeze(new Blob([input.file], { type: contentType }));
    const filename = input.filename; const reason = input.reason;
    return bounded(signal, async active => {
      const bytes = new Uint8Array(await file.arrayBuffer()); active.throwIfAborted(); assertCurrent(binding, epoch);
      require(bytes.byteLength === file.size);
      const sha256 = await hash(bytes); active.throwIfAborted(); assertCurrent(binding, epoch);
      const requestId = crypto.randomUUID(); const idempotencyKey = crypto.randomUUID();
      const metadata = JSON.stringify({ schemaVersion: 1, requestId, idempotencyKey, context: binding.scope,
        reason, filename, contentType, sourceLicense });
      require(encoder.encode(metadata).byteLength <= 16384);
      const prepared: NativeGeometryPrepared = Object.freeze({ binding, kind, requestId, idempotencyKey, metadata,
        file, filename, contentType, sourceLicense, sha256, byteSize: bytes.byteLength,
        ...(original ? { originalAssetId: original.assetId } : {}) });
      intents.set(prepared, { epoch, ...(original ? { original } : {}) });
      return prepared;
    });
  };
  const validate = async (prepared: NativeGeometryPrepared, raw: string): Promise<NativeGeometryCustodyReceipt> => {
    const wrapper = object(parseLosslessJson(raw));
    require(Object.keys(wrapper).length === 4 && exactStockSafeInteger(field(wrapper, 'schemaVersion')) === 1 &&
      field(wrapper, 'association') === 'not-associated');
    const request = field(wrapper, 'originalRequest'); const result = field(wrapper, 'result');
    require(validator.validateNativeRequest(command, request));
    require(validator.validateMutation(command, '#/$defs/result_atlas_asset_create', result));
    const root = object(request); const output = object(result);
    const context = object(field(root, 'context')); const resolved = object(field(output, 'resolvedScope'));
    const scope = prepared.binding.scope;
    require(context.workspaceId === scope.workspaceId && context.homeId === scope.homeId &&
      resolved.workspaceId === scope.workspaceId && resolved.homeId === scope.homeId &&
      root.requestId === prepared.requestId && root.idempotencyKey === prepared.idempotencyKey &&
      output.requestId === prepared.requestId && output.commandId === command && output.status === 'committed' && output.replayed === false &&
      root.commandId === command && root.approvalReceiptId === null);
    const metadata = object(parseLosslessJson(prepared.metadata));
    require(root.reason === metadata.reason);
    const target = object(field(root, 'target'));
    require(target.authority === 'atlas' && target.recordType === 'asset' && typeof target.recordId === 'string' && uuid.test(target.recordId));
    if (prepared.originalAssetId !== undefined) require(target.recordId !== prepared.originalAssetId);
    const payload = object(field(root, 'payload')); const staged = object(field(payload, 'staged'));
    const purpose = prepared.kind === 'original' ? 'geometry-original' : 'derived-preview';
    require(payload.purpose === purpose && array(field(payload, 'evidenceIds')).length === 0 &&
      staged.sha256 === prepared.sha256 && exactStockSafeInteger(field(staged, 'byteSize')) === prepared.byteSize &&
      staged.contentType === prepared.contentType && staged.filename === prepared.filename);
    const sourceLicense = object(field(payload, 'sourceLicense'));
    require(sourceLicense.status === prepared.sourceLicense.status && sourceLicense.reference === prepared.sourceLicense.reference);
    const conditions = object(field(root, 'preconditions')); const guards = array(field(conditions, 'guards'));
    require(conditions.target === null && guards.length === (prepared.kind === 'original' ? 0 : 1));
    if (prepared.kind === 'derivative') {
      const guard = object(guards[0]!); const guarded = object(field(guard, 'target')); const revision = object(field(guard, 'revision'));
      // The branded original receipt proves its creation revision only. A later
      // changed original cannot be silently substituted for this selected input.
      require(guarded.authority === 'atlas' && guarded.recordType === 'asset' && guarded.recordId === prepared.originalAssetId &&
        revision.kind === 'atlas' && exactStockSafeInteger(field(revision, 'value')) === 1);
    }
    const data = object(field(output, 'data')); const records = array(field(data, 'records')); const audits = array(field(data, 'auditIds'));
    require(records.length === 1 && audits.length === 1);
    const record = object(records[0]!); const recordTarget = object(field(record, 'target')); const asset = object(field(record, 'payload'));
    require(recordTarget.authority === target.authority && recordTarget.recordType === target.recordType && recordTarget.recordId === target.recordId &&
      exactStockSafeInteger(field(record, 'revision')) === 1 && record.lifecycle === 'active' && asset.owner === 'atlas' &&
      asset.purpose === purpose && asset.sha256 === prepared.sha256 && exactStockSafeInteger(field(asset, 'byteSize')) === prepared.byteSize &&
      asset.contentType === prepared.contentType && asset.availability === 'available' && asset.previewPolicy === 'download-only' &&
      array(field(asset, 'evidenceIds')).length === 0);
    const assetLicense = object(field(asset, 'sourceLicense'));
    require(assetLicense.status === prepared.sourceLicense.status && assetLicense.reference === prepared.sourceLicense.reference);
    const intent = { ...root }; delete intent.requestId; delete intent.approvalReceiptId;
    require(data.requestDigest === await hash(encoder.encode(canonicalAssetIntent(intent))));
    const originalRequestBody = stringifyLosslessJson(request);
    require(encoder.encode(originalRequestBody).byteLength <= 16384);
    freezeTree(request); freezeTree(result);
    return Object.freeze({ schemaVersion: 1, kind: prepared.kind, association: 'not-associated', assetId: target.recordId,
      originalRequest: request, result, originalRequestBody, responseBody: raw });
  };
  return {
    getBinding, canPrepare,
    subscribe: changed => options.subscribe(changed),
    subscribePending(changed) { listeners.add(changed); return () => { listeners.delete(changed); }; },
    pending(binding): readonly NativeGeometryPending[] {
      if (getBinding() !== binding) return Object.freeze([]);
      return Object.freeze([...ledger].filter(([, row]) => row.epoch === cached!.epoch).map(([prepared, row]) =>
        Object.freeze({ prepared, outcome: row.outcome, ...(row.receipt ? { receipt: row.receipt } : {}) })));
    },
    prepareOriginal: (binding, input, signal) => prepare(binding, 'original', input, input.contentType, signal),
    prepareDerivative: (binding, original, input, signal) => prepare(binding, 'derivative', input, derivativeType, signal, original),
    async commit(prepared, signal) {
      signal.throwIfAborted(); const pin = intents.get(prepared);
      require(pin !== undefined && !dispatched.has(prepared)); assertCurrent(prepared.binding, pin.epoch); require(!unknown() && ledger.size < 16);
      require(prepared.file.size === prepared.byteSize && prepared.byteSize > 0 &&
        prepared.byteSize <= (prepared.kind === 'original' ? originalLimit : derivativeLimit) && encoder.encode(prepared.metadata).byteLength <= 16384);
      if (pin.original) require(receipts.get(pin.original) === pin.epoch && pin.original.assetId === prepared.originalAssetId);
      const scope = prepared.binding.scope;
      const base = `/api/atlas/geometry/v1/workspaces/${encodeURIComponent(scope.workspaceId)}/homes/${encodeURIComponent(scope.homeId)}`;
      const path = prepared.kind === 'original' ? `${base}/originals` : `${base}/originals/${encodeURIComponent(prepared.originalAssetId!)}/derivative`;
      const form = new FormData(); form.append('metadata', prepared.metadata); form.append('file', prepared.file, prepared.filename);
      // Submitted/unknown is recorded before the sole exchange. HTTP failure,
      // timeout, aborted transport and withheld responses never imply absence.
      dispatched.add(prepared); ledger.set(prepared, { epoch: pin.epoch, outcome: 'unknown' }); notify();
      return bounded(signal, async active => {
        const controller = new AbortController(); const forward = () => controller.abort(active.reason);
        active.addEventListener('abort', forward, { once: true });
        const changed = () => { if (!current(prepared.binding, pin.epoch)) controller.abort(new Error('Native geometry context changed')); };
        const unsubscribe = options.subscribe(changed);
        try {
          active.throwIfAborted(); changed(); controller.signal.throwIfAborted(); assertCurrent(prepared.binding, pin.epoch);
          const csrf = cached!.csrf;
          const response = await transport(path, { method: 'POST', credentials: 'same-origin', cache: 'no-store', redirect: 'error',
            headers: { Accept: 'application/json', 'x-atlas-csrf': csrf }, body: form, signal: controller.signal });
          if (controller.signal.aborted || !current(prepared.binding, pin.epoch)) { cancel(response); throw new Error('Native geometry context changed'); }
          if (response.status !== 200 || response.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase() !== 'application/json') {
            cancel(response); throw new Error('Native geometry custody outcome is unknown');
          }
          const raw = await receive(response, controller.signal); controller.signal.throwIfAborted(); assertCurrent(prepared.binding, pin.epoch);
          const receipt = await validate(prepared, raw); controller.signal.throwIfAborted(); assertCurrent(prepared.binding, pin.epoch);
          receipts.set(receipt, pin.epoch); ledger.set(prepared, { epoch: pin.epoch, outcome: 'committed', receipt }); notify();
          return receipt;
        } finally { unsubscribe(); active.removeEventListener('abort', forward); }
      });
    },
  };
}
