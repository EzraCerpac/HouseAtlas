import type { Scope } from '../app/types';
import type { IdentityRecord, LocationSemanticsRecord, License } from './generated/contracts';
import type { NativePlaceBinding } from './native-place-client';
import { CAPTURE_MAX_BYTES, CAPTURE_TYPES, selectEvidenceFile, type EvidenceSelection } from '../capture-evidence/selection';
import { validateSelectionClaim } from '../capture-evidence/types';
import { isExactDecimal, type ExactDecimal } from '../numeric/decimal';
import { parseLosslessJson, stringifyLosslessJson, type LosslessJson, type JsonForSerialization } from '../numeric/lossless-json';
import { createExactStockResultValidator, exactStockSafeInteger } from '../numeric/schema-validator';
import type { DecodedLocationSemanticsPayload } from '../numeric/stock-decoded';

type ExactIdentity = Omit<IdentityRecord, 'schemaVersion' | 'revision'> & { readonly schemaVersion: ExactDecimal; readonly revision: ExactDecimal };
type ExactPlace = Omit<LocationSemanticsRecord, 'schemaVersion' | 'revision' | 'payload'> & {
  readonly schemaVersion: ExactDecimal; readonly revision: ExactDecimal; readonly payload: DecodedLocationSemanticsPayload;
};
export interface NativeEvidenceGuard {
  readonly record: { readonly recordType: 'identity' | 'evidence'; readonly recordId: string };
  readonly expectedRevision: ExactDecimal;
}
export interface NativeEvidenceAdmission {
  readonly binding: NativePlaceBinding;
  readonly record: ExactPlace;
  readonly identity: ExactIdentity;
  readonly guards: readonly NativeEvidenceGuard[];
  readonly canAttachEvidence: boolean;
  readonly maximumReasonCodePoints: 1024;
  readonly attachmentPolicy?: { readonly contentTypes: readonly string[]; readonly maximumBytes: number;
    readonly licenses: readonly { readonly label: string; readonly value: License }[] };
}
export interface NativeEvidenceInput { readonly selection: EvidenceSelection; readonly statement: string; readonly reason: string; readonly sourceLicense: License }
/** IDs are data only. The exact file/form/session custody stays private. */
export interface NativeEvidencePrepared { readonly binding: NativePlaceBinding; readonly recordId: string; readonly requestId: string }
export interface NativeEvidencePending {
  readonly prepared: NativeEvidencePrepared; readonly outcome: 'unknown' | 'committed';
  readonly receipt?: LosslessJson; readonly evidenceId?: string; readonly assetId?: string;
}
export interface NativeEvidenceClient {
  getBinding(): NativePlaceBinding | null;
  subscribe(changed: () => void): () => void;
  subscribePending(changed: () => void): () => void;
  load(binding: NativePlaceBinding, recordId: string, signal: AbortSignal): Promise<NativeEvidenceAdmission>;
  prepare(admission: NativeEvidenceAdmission, input: NativeEvidenceInput, signal: AbortSignal): Promise<NativeEvidencePrepared>;
  commit(prepared: NativeEvidencePrepared, signal: AbortSignal): Promise<NativeEvidencePending>;
  pending(binding: NativePlaceBinding, recordId?: string): readonly NativeEvidencePending[];
  inspect(binding: NativePlaceBinding, prepared: NativeEvidencePrepared, signal: AbortSignal): Promise<{ readonly admission: NativeEvidenceAdmission; readonly retrySafety: 'not-established' }>;
  resolveOriginal(binding: NativePlaceBinding, prepared: NativeEvidencePrepared, signal: AbortSignal): Promise<{ readonly href: string } | null>;
}
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
function object(value: unknown): Record<string, LosslessJson> {
  if (!value || typeof value !== 'object' || Array.isArray(value) || isExactDecimal(value)) throw new TypeError('Native evidence data is incompatible');
  return value as Record<string, LosslessJson>;
}
function keys(value: Record<string, LosslessJson>, names: readonly string[]) {
  if (Object.keys(value).length !== names.length || names.some(name => !Object.hasOwn(value, name))) throw new TypeError('Native evidence fields differ');
}
function equal(left: LosslessJson, right: LosslessJson): boolean {
  if (isExactDecimal(left) || isExactDecimal(right)) return isExactDecimal(left) && isExactDecimal(right) && left.compare(right) === 0;
  if (left === null || right === null || typeof left !== 'object' || typeof right !== 'object') return left === right;
  if (Array.isArray(left) || Array.isArray(right)) return Array.isArray(left) && Array.isArray(right) && left.length === right.length && left.every((v, i) => equal(v, right[i]!));
  return Object.keys(left).length === Object.keys(right).length && Object.keys(left).every(k => Object.hasOwn(right, k) && equal(left[k]!, right[k]!));
}
function freeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
}
function discard(response: Response) { void response.body?.cancel().catch(() => undefined); }
async function receive(response: Response, signal: AbortSignal): Promise<LosslessJson> {
  const limit = 1024 * 1024, length = response.headers.get('content-length');
  if (length !== null && (!/^[0-9]+$/.test(length) || Number(length) > limit)) { discard(response); throw new TypeError('Native evidence body exceeds bound'); }
  const reader = response.body?.getReader();
  if (!reader) throw new TypeError('Native evidence body missing');
  const stop = () => { void reader.cancel().catch(() => undefined); };
  signal.addEventListener('abort', stop, { once: true });
  let bytes = new Uint8Array(16 * 1024), size = 0;
  try {
    for (;;) {
      signal.throwIfAborted(); const part = await reader.read(); signal.throwIfAborted();
      if (part.done) break;
      if (part.value.byteLength > limit - size) throw new TypeError('Native evidence body exceeds bound');
      const nextSize = size + part.value.byteLength;
      if (nextSize > bytes.byteLength) {
        let capacity = bytes.byteLength;
        while (capacity < nextSize) capacity = Math.min(capacity * 2, limit);
        const grown = new Uint8Array(capacity); grown.set(bytes.subarray(0, size)); bytes = grown;
      }
      bytes.set(part.value, size); size = nextSize;
    }
    return parseLosslessJson(new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes.subarray(0, size)));
  } catch (error) { stop(); throw error; }
  finally { signal.removeEventListener('abort', stop); reader.releaseLock(); }
}
async function sha(file: Blob): Promise<string> {
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256', await file.arrayBuffer()))].map(b => b.toString(16).padStart(2, '0')).join('');
}

/** Native-only evidence. No SourceRef, stock wrapper, persisted auth, draft store or retry. */
export function createNativeEvidenceClient(options: {
  getBinding(): NativePlaceBinding | null;
  subscribe(changed: () => void): () => void;
  owner(binding: NativePlaceBinding): object;
  exchange(binding: NativePlaceBinding, path: string, method: 'GET' | 'POST' | 'HEAD', signal: AbortSignal, body?: FormData): Promise<Response>;
}): NativeEvidenceClient {
  const validator = createExactStockResultValidator();
  const admissions = new WeakSet<NativeEvidenceAdmission>();
  type Entry = { owner: object; scope: Readonly<Scope>; admission: NativeEvidenceAdmission; metadata: string;
    digest: string; size: number; type: string; outcome: 'unknown' | 'committed'; receipt?: LosslessJson; evidenceId?: string; assetId?: string; file?: File };
  const custody = new WeakMap<NativeEvidencePrepared, Entry>(), submitted = new Map<NativeEvidencePrepared, Entry>();
  const listeners = new Set<() => void>();
  const notify = () => { for (const changed of listeners) changed(); };
  const current = (binding: NativePlaceBinding, signal?: AbortSignal, owner?: object) => {
    signal?.throwIfAborted();
    if (options.getBinding() !== binding || (owner && options.owner(binding) !== owner)) throw new Error('Native evidence context changed');
    return options.owner(binding);
  };
  const path = (binding: NativePlaceBinding, recordId: string) => {
    if (!uuid.test(recordId) || !uuid.test(binding.scope.workspaceId) || !uuid.test(binding.scope.homeId)) throw new TypeError('Native evidence target differs');
    return `/api/atlas/editing/v1/workspaces/${encodeURIComponent(binding.scope.workspaceId)}/homes/${encodeURIComponent(binding.scope.homeId)}/native-places/${encodeURIComponent(recordId)}`;
  };
  const sameScope = (left: Readonly<Scope>, right: Readonly<Scope>) => left.workspaceId === right.workspaceId && left.homeId === right.homeId;
  const entries = (binding: NativePlaceBinding) => {
    const owner = current(binding);
    return [...submitted].filter(([, e]) => e.owner === owner && sameScope(e.scope, binding.scope));
  };
  const writable = (binding: NativePlaceBinding) => {
    if (entries(binding).some(([, e]) => e.outcome === 'unknown')) throw new Error('Prior native evidence completion is unknown; do not resend');
    while (submitted.size >= 64) {
      const oldest = [...submitted].find(([, e]) => e.outcome === 'committed');
      if (!oldest) throw new Error('Native evidence attempt limit reached');
      submitted.delete(oldest[0]);
    }
  };
  async function bounded<T>(binding: NativePlaceBinding, outer: AbortSignal, action: (signal: AbortSignal) => Promise<T>): Promise<T> {
    const owner = current(binding, outer), active = new AbortController();
    const forward = () => active.abort(outer.reason);
    const unsubscribe = options.subscribe(() => { try { current(binding, undefined, owner); } catch (error) { active.abort(error); } });
    outer.addEventListener('abort', forward, { once: true });
    let reject!: (reason: unknown) => void;
    const stopped = new Promise<never>((_, no) => { reject = no; });
    const stop = () => reject(active.signal.reason);
    active.signal.addEventListener('abort', stop, { once: true });
    const timer = setTimeout(() => active.abort(new Error('Native evidence exchange exceeded deadline')), 30000);
    if (outer.aborted) forward();
    try { current(binding, active.signal, owner); const result = await Promise.race([action(active.signal), stopped]); current(binding, active.signal, owner); return result; }
    finally { clearTimeout(timer); unsubscribe(); outer.removeEventListener('abort', forward); active.signal.removeEventListener('abort', stop); }
  }
  const decode = (binding: NativePlaceBinding, recordId: string, value: LosslessJson): NativeEvidenceAdmission => {
    const row = object(value), allowed = row['canAttachEvidence'] === true;
    keys(row, ['schemaVersion', 'admissionKind', 'scope', 'record', 'identity', 'guards', 'canAttachEvidence', 'maximumReasonCodePoints', ...(allowed ? ['attachmentPolicy'] : [])]);
    const scope = object(row['scope']); keys(scope, ['workspaceId', 'homeId']);
    if (exactStockSafeInteger(row['schemaVersion']!) !== 1 || row['admissionKind'] !== 'native-location' || typeof row['canAttachEvidence'] !== 'boolean'
      || exactStockSafeInteger(row['maximumReasonCodePoints']!) !== 1024 || !sameScope(scope as unknown as Scope, binding.scope)
      || !validator.validateNativeEvidenceShape('location-semantics', row['record']!) || !validator.validateNativeEvidenceShape('identity', row['identity']!)) throw new TypeError('Native evidence admission differs');
    const record = row['record'] as unknown as ExactPlace, identity = row['identity'] as unknown as ExactIdentity;
    if (record.recordId !== recordId || record.lifecycle !== 'active' || record.payload.reviewStatus !== 'accepted'
      || identity.lifecycle !== 'active' || identity.payload.kind !== 'location' || record.payload.atlasId !== identity.recordId
      || !sameScope(record, binding.scope) || !sameScope(identity, binding.scope)) throw new TypeError('Native evidence records differ');
    if (!Array.isArray(row['guards']) || row['guards'].length > 99) throw new TypeError('Native evidence guard limit');
    const guards = row['guards'] as unknown as NativeEvidenceGuard[], expected = new Set([
      `identity:${identity.recordId}`, ...record.payload.evidenceIds.map(id => `evidence:${id}`), ...identity.payload.evidenceIds.map(id => `evidence:${id}`),
    ]);
    let previous = '';
    for (const guard of guards) {
      if (!validator.validateNativeEvidenceShape('guard', guard as unknown as LosslessJson)) throw new TypeError('Native evidence guard incompatible');
      const key = `${guard.record.recordType}:${guard.record.recordId}`;
      if (key <= previous || !expected.delete(key)) throw new TypeError('Native evidence guard closure or order differs');
      previous = key;
      if (guard.record.recordType === 'identity' && guard.expectedRevision.compare(identity.revision) !== 0) throw new TypeError('Native identity guard revision differs');
    }
    if (expected.size) throw new TypeError('Native evidence guard closure missing');
    let policy: NativeEvidenceAdmission['attachmentPolicy'];
    if (allowed) {
      const p = object(row['attachmentPolicy']); keys(p, ['contentTypes', 'maximumBytes', 'licenses']);
      if (!Array.isArray(p['contentTypes']) || p['contentTypes'].length !== CAPTURE_TYPES.length || !p['contentTypes'].every((type, i) => type === CAPTURE_TYPES[i])
        || exactStockSafeInteger(p['maximumBytes']!) !== CAPTURE_MAX_BYTES || !Array.isArray(p['licenses']) || p['licenses'].length !== 1) throw new TypeError('Native attachment policy differs');
      const choice = object(p['licenses'][0]); keys(choice, ['label', 'value']);
      const license = object(choice['value']); keys(license, ['status', 'reference']);
      if (typeof choice['label'] !== 'string' || !choice['label'].trim() || [...choice['label']].length > 255 || license['status'] !== 'unknown' || license['reference'] !== null) throw new TypeError('Native attachment license differs');
      policy = { contentTypes: [...CAPTURE_TYPES], maximumBytes: CAPTURE_MAX_BYTES, licenses: [{ label: choice['label'], value: { status: 'unknown', reference: null } }] };
    }
    const admission = freeze({ binding, record, identity, guards, canAttachEvidence: allowed, maximumReasonCodePoints: 1024 as const, ...(policy ? { attachmentPolicy: policy } : {}) });
    admissions.add(admission); return admission;
  };
  const load = (binding: NativePlaceBinding, recordId: string, signal: AbortSignal) => bounded(binding, signal, async active => {
    const response = await options.exchange(binding, path(binding, recordId), 'GET', active);
    if (response.status !== 200) { discard(response); throw new Error('Native evidence admission unavailable'); }
    const value = await receive(response, active); current(binding, active); return decode(binding, recordId, value);
  });
  const view = (prepared: NativeEvidencePrepared, entry: Entry): NativeEvidencePending => Object.freeze({ prepared, outcome: entry.outcome,
    ...(entry.receipt ? { receipt: entry.receipt, evidenceId: entry.evidenceId, assetId: entry.assetId } : {}) });
  const owned = (binding: NativePlaceBinding, prepared: NativeEvidencePrepared) => {
    const entry = submitted.get(prepared);
    if (!entry || !entries(binding).some(([p]) => p === prepared)) throw new Error('Native evidence attempt is outside the current session/home');
    return entry;
  };
  return {
    getBinding() {
      const binding = options.getBinding();
      try { if (binding) options.owner(binding); return binding; } catch { return null; }
    }, subscribe: options.subscribe,
    subscribePending(changed) { listeners.add(changed); return () => { listeners.delete(changed); }; },
    load,
    async prepare(admission, input, signal) {
      if (!admissions.has(admission) || !admission.canAttachEvidence || !admission.attachmentPolicy) throw new Error('Native evidence is not admitted');
      const binding = admission.binding, owner = current(binding, signal); writable(binding);
      const selection = { original: input.selection.original, file: input.selection.file, capture: { ...input.selection.capture } }, statement = input.statement, reason = input.reason;
      const license = { ...input.sourceLicense }, capture = { ...selection.capture };
      if (!statement.trim() || [...statement].length > 4096 || !reason.trim() || [...reason].length > 1024
        || Object.keys(license).length !== 2 || license.status !== 'unknown' || license.reference !== null) throw new TypeError('Native evidence form exceeds policy');
      validateSelectionClaim(capture, selection.original.name);
      if (capture.reportedContentType !== selection.original.type || !(selection.original instanceof File) || !(selection.file instanceof File)
        || selection.file.name !== selection.original.name || selection.file.size !== selection.original.size || selection.file.size < 1 || selection.file.size > CAPTURE_MAX_BYTES) throw new TypeError('Native evidence file differs');
      return bounded(binding, signal, async active => {
        const canonical = await selectEvidenceFile(selection.original, capture.selectionMethod, admission.attachmentPolicy!, active, capture.selectedAt);
        const [digest, originalDigest] = await Promise.all([sha(selection.file), sha(selection.original)]); current(binding, active, owner);
        if (digest !== originalDigest || selection.file.type !== canonical.file.type) throw new TypeError('Native evidence browser-original bytes differ');
        // File checks precede the final fresh native admission. This GET is data, never authority.
        const latest = await load(binding, admission.record.recordId, active);
        if (!latest.canAttachEvidence || !latest.attachmentPolicy || latest.identity.recordId !== admission.identity.recordId) throw new Error('Native evidence target/access changed');
        if (exactStockSafeInteger(latest.identity.revision) >= Number.MAX_SAFE_INTEGER) throw new Error('Native identity revision limit');
        writable(binding); current(binding, active, owner);
        const requestId = crypto.randomUUID(), idempotencyKey = crypto.randomUUID();
        const metadata = stringifyLosslessJson({ schemaVersion: 2, requestId, idempotencyKey, context: { ...binding.scope },
          recordId: latest.record.recordId, expectedRevision: exactStockSafeInteger(latest.record.revision), guards: latest.guards,
          statement, sourceLicense: license, reason, filename: selection.file.name, contentType: selection.file.type, capture } as unknown as JsonForSerialization);
        if (new TextEncoder().encode(metadata).byteLength > 64 * 1024) throw new TypeError('Native evidence metadata exceeds bound');
        const prepared = Object.freeze({ binding, recordId: latest.record.recordId, requestId });
        custody.set(prepared, { owner, scope: binding.scope, admission: latest, metadata, digest, size: selection.file.size, type: selection.file.type, outcome: 'unknown', file: selection.file });
        return prepared;
      });
    },
    async commit(prepared, signal) {
      const entry = custody.get(prepared), binding = prepared.binding;
      if (!entry || submitted.has(prepared) || !entry.file) throw new Error('Native evidence attempt unavailable or already dispatched');
      current(binding, signal, entry.owner); writable(binding);
      return bounded(binding, signal, async active => {
        current(binding, active, entry.owner); writable(binding);
        const body = new FormData(); body.append('metadata', entry.metadata); body.append('file', entry.file!, entry.file!.name);
        // Conservative one-shot marker precedes the sole transport call. No native stock input is synthesized.
        submitted.set(prepared, entry); notify(); current(binding, active, entry.owner);
        const response = await options.exchange(binding, path(binding, prepared.recordId) + '/evidence', 'POST', active, body);
        if (response.status !== 200) { discard(response); throw new Error('Native evidence completion unknown'); }
        const value = await receive(response, active); current(binding, active, entry.owner);
        if (!validator.validateMutation('atlas.batch.execute', '#/$defs/result_atlas_batch_execute', value)) throw new TypeError('Native evidence receipt incompatible');
        const result = object(value), scope = object(result['resolvedScope']), data = object(result['data']);
        const records = data['records'] as Array<Record<string, LosslessJson>>, audits = data['auditIds'] as string[];
        if (result['requestId'] !== prepared.requestId || result['commandId'] !== 'atlas.batch.execute' || result['status'] !== 'committed' || !sameScope(scope as unknown as Scope, entry.scope)
          || ![2, 3].includes(records.length) || audits.length !== records.length || new Set(audits).size !== audits.length) throw new TypeError('Native evidence receipt correlation differs');
        const byType = new Map(records.map(record => [object(record['target'])['recordType'], record]));
        if (byType.size !== records.length || !byType.has('evidence') || !byType.has('identity') || (records.length === 3 && !byType.has('asset'))) throw new TypeError('Native evidence receipt targets differ');
        const evidence = byType.get('evidence')!, identity = byType.get('identity')!, ep = object(evidence['payload']), ip = object(identity['payload']);
        const eid = object(evidence['target'])['recordId'] as string, references = ep['references'] as Array<Record<string, LosslessJson>>;
        if (evidence['lifecycle'] !== 'active' || exactStockSafeInteger(evidence['revision']!) !== 1 || !uuid.test(eid)
          || identity['lifecycle'] !== 'active' || object(identity['target'])['recordId'] !== entry.admission.identity.recordId
          || exactStockSafeInteger(identity['revision']!) !== exactStockSafeInteger(entry.admission.identity.revision) + 1
          || !equal(ip, { ...entry.admission.identity.payload, evidenceIds: [...entry.admission.identity.payload.evidenceIds, eid] } as unknown as LosslessJson)
          || references.length !== 1 || references[0]!['kind'] !== 'atlas-asset' || typeof references[0]!['assetId'] !== 'string' || !uuid.test(references[0]!['assetId'])) throw new TypeError('Native evidence record correlation differs');
        const metadata = object(parseLosslessJson(entry.metadata)), provenance = object(ep['provenance']);
        const expectedClaim = metadata['capture']!;
        if (ep['statement'] !== metadata['statement'] || (ep['supersedesEvidenceIds'] as LosslessJson[]).length !== 0
          || provenance['source'] !== null || provenance['sourceRevision'] !== null || provenance['sourceConfidence'] !== null || provenance['factAt'] !== null || provenance['evidenceBasis'] !== 'unknown'
          || !equal(provenance['uncertainty']!, { status: 'unknown', explanation: null }) || typeof provenance['vantage'] !== 'string'
          || !provenance['vantage'].startsWith('Browser selection claim v1: ') || !equal(parseLosslessJson(provenance['vantage'].slice('Browser selection claim v1: '.length)), expectedClaim)) throw new TypeError('Native evidence original provenance differs');
        const assetId = references[0]!['assetId'] as string, asset = byType.get('asset');
        if (asset) {
          const payload = object(asset['payload']);
          if (object(asset['target'])['recordId'] !== assetId || asset['lifecycle'] !== 'active' || exactStockSafeInteger(asset['revision']!) !== 1
            || payload['sha256'] !== entry.digest || exactStockSafeInteger(payload['byteSize']!) !== entry.size || payload['contentType'] !== entry.type
            || payload['owner'] !== 'atlas' || payload['purpose'] !== 'evidence-original' || payload['availability'] !== 'available'
            || !equal(payload['sourceLicense']!, metadata['sourceLicense']!) || (entry.type === 'image/jpeg' && payload['previewPolicy'] !== 'download-only')) throw new TypeError('Native original asset differs');
        }
        entry.receipt = freeze(value); entry.evidenceId = eid; entry.assetId = assetId; entry.outcome = 'committed'; delete entry.file;
        notify(); return view(prepared, entry);
      });
    },
    pending(binding, recordId) { return entries(binding).filter(([p]) => recordId === undefined || p.recordId === recordId).map(([p, e]) => view(p, e)); },
    async inspect(binding, prepared, signal) {
      owned(binding, prepared);
      const admission = await load(binding, prepared.recordId, signal); owned(binding, prepared); current(binding, signal);
      return { admission, retrySafety: 'not-established' };
    },
    async resolveOriginal(binding, prepared, signal) {
      const entry = owned(binding, prepared);
      if (entry.outcome !== 'committed' || !entry.assetId || !entry.receipt) return null;
      return bounded(binding, signal, async active => {
        // Same descriptor/canonical key order as the actual native Media resolver; no storage key or stock token.
        const digest = await sha(new Blob([JSON.stringify({ assetId: entry.assetId, kind: 'atlas-asset' })]));
        current(binding, active, entry.owner);
        const href = `/api/atlas/media/${encodeURIComponent(binding.scope.workspaceId)}/${encodeURIComponent(binding.scope.homeId)}/${digest}/download`;
        const url = new URL(href, window.location.origin);
        if (url.origin !== window.location.origin || url.search || url.hash || url.username || url.password) throw new TypeError('Native original route differs');
        const response = await options.exchange(binding, href, 'HEAD', active);
        let headerBytes = 0; response.headers.forEach((v, k) => { headerBytes += new TextEncoder().encode(k + v).byteLength; });
        const length = response.headers.get('content-length'), disposition = response.headers.get('content-disposition');
        const available = response.status === 200 && headerBytes <= 16 * 1024 && !response.body
          && response.headers.get('content-type') === entry.type && length !== null && /^[0-9]+$/.test(length) && Number(length) === entry.size
          && disposition !== null && disposition.length <= 2048 && disposition.startsWith('attachment;');
        discard(response); current(binding, active, entry.owner); owned(binding, prepared);
        return available ? Object.freeze({ href }) : null;
      });
    },
  };
}
