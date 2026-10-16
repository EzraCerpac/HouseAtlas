import type { AtlasSessionInfo } from '../src/app/session';
import type { ReadyView } from '../src/app/types';
import type { StockAdmission } from '../src/app/StockApplication';
import type { NativeEvidenceDocumentClient, NativeEvidenceDocumentFrame } from '../src/lantern/scans/native-evidence-document-types';
import type { NativeGeometryFrame } from '../src/lantern/scans/native-read-types';
import type { NativeSceneAcceptedAnchor, NativeSceneAcceptedRoomMapping, NativeSceneFloorBinding, NativeSceneSourceSelection } from '../src/lantern/scans/native-scene-source-types';
import { readDocumentarySupport, documentaryReferences, matchesDocumentaryPdf, sameDocumentaryValue, type DocumentarySupport } from './native-scene-documentary-support';
import { ExactDecimal, isExactDecimal } from '../src/numeric/decimal';
import { parseLosslessJson, stringifyLosslessJson, type JsonForSerialization, type LosslessJson } from '../src/numeric/lossless-json';
import { createExactStockResultValidator, exactStockSafeInteger } from '../src/numeric/schema-validator';

type Row = { [key: string]: LosslessJson };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const SHA = /^[0-9a-f]{64}$/;
const ONE = ExactDecimal.parse('1'), MAX = ExactDecimal.parse('9007199254740991');
const MAX_HEAD = 4096;
const MAX_META = 1024 * 1024, MAX_ORIGINAL = 8 * 1024 * 1024, MAX_BODY = 1024 * 1024;
const DEADLINE_MS = 60_000;
const encoder = new TextEncoder();
function need(ok: unknown): asserts ok { if (!ok) throw new TypeError('Native scene association is unavailable or no longer current'); }
/** The shared lossless parser preserves numbers but is last-wins for keys.
 * Apply the existing scene reader's bounded lexical uniqueness pass first. */
function rejectDuplicateKeys(text: string): void {
  let i = 0, members = 0;
  const space = () => { while (/\s/.test(text[i] ?? '') && i < text.length) i++; };
  const quoted = (): string => {
    need(text[i] === '"'); const start = i++;
    for (; i < text.length; i++) {
      if (text[i] === '\\') { i++; continue; }
      if (text[i] === '"') { i++; return JSON.parse(text.slice(start, i)) as string; }
    }
    throw new TypeError('Invalid scene association JSON');
  };
  const scan = (depth: number): void => {
    need(depth <= 32); space();
    if (text[i] === '{') {
      i++; space(); const seen = new Set<string>();
      if (text[i] === '}') { i++; return; }
      for (;;) {
        const key = quoted(); need(++members <= 50000 && !seen.has(key)); seen.add(key);
        space(); need(text[i++] === ':'); scan(depth + 1); space();
        if (text[i] === '}') { i++; return; }
        need(text[i++] === ','); space();
      }
    }
    if (text[i] === '[') {
      i++; space(); if (text[i] === ']') { i++; return; }
      for (;;) { need(++members <= 50000); scan(depth + 1); space();
        if (text[i] === ']') { i++; return; } need(text[i++] === ','); }
    }
    if (text[i] === '"') { quoted(); return; }
    const start = i;
    while (i < text.length && !/[\s,\]}]/.test(text[i]!)) i++;
    need(i > start);
  };
  scan(0); space(); need(i === text.length);
}
function parse(text: string): LosslessJson { rejectDuplicateKeys(text); return parseLosslessJson(text); }
function row(value: LosslessJson | undefined, keys?: readonly string[]): Row {
  need(value !== null && typeof value === 'object' && !Array.isArray(value) && !isExactDecimal(value));
  if (keys) need(Object.keys(value).length === keys.length && Object.keys(value).every(key => keys.includes(key)));
  return value;
}
function list(value: LosslessJson | undefined, max: number): LosslessJson[] { need(Array.isArray(value) && value.length <= max); return value; }
function str(value: LosslessJson | undefined, max = 512): string { need(typeof value === 'string' && value.length > 0 && [...value].length <= max); return value; }
function uuid(value: LosslessJson | undefined): string { const result = str(value); need(UUID.test(result)); return result; }
function sha(value: LosslessJson | undefined): string { const result = str(value, 64); need(SHA.test(result)); return result; }
function integer(value: LosslessJson | undefined): ExactDecimal {
  need(isExactDecimal(value) && value.isInteger && value.compare(ONE) >= 0 && value.compare(MAX) <= 0);
  return value;
}
function equal(a: LosslessJson, b: LosslessJson): boolean {
  if (isExactDecimal(a) || isExactDecimal(b)) return isExactDecimal(a) && isExactDecimal(b) && a.compare(b) === 0;
  if (a === null || b === null || typeof a !== 'object' || typeof b !== 'object') return a === b;
  if (Array.isArray(a) || Array.isArray(b)) return Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((part, n) => equal(part, b[n]!));
  const keys = Object.keys(a); return keys.length === Object.keys(b).length && keys.every(key => Object.hasOwn(b, key) && equal(a[key]!, b[key]!));
}
function scalar(value: string): void {
  for (const char of value) { const point = char.codePointAt(0)!;
    need(point < 0xd800 || point > 0xdfff); }
}
function canonical(value: LosslessJson): string {
  if (isExactDecimal(value)) return JSON.stringify(exactStockSafeInteger(value));
  if (typeof value === 'string') { scalar(value); return JSON.stringify(value); }
  if (value === null || typeof value === 'boolean') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  return `{${Object.keys(value).sort().map(key => { scalar(key);
    return `${JSON.stringify(key)}:${canonical(value[key]!)}`; }).join(',')}}`;
}
async function digest(bytes: Uint8Array): Promise<string> {
  const owned = new Uint8Array(bytes.length); owned.set(bytes);
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256', owned.buffer))]
    .map(value => value.toString(16).padStart(2, '0')).join('');
}
async function requestDigest(request: LosslessJson): Promise<string> {
  const intent = { ...row(request) }; delete intent.requestId; delete intent.approvalReceiptId;
  return digest(encoder.encode(canonical(intent)));
}
function abortable<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const stop = () => { signal.removeEventListener('abort', stop); reject(signal.reason ?? new Error('Scene association stopped')); };
    signal.addEventListener('abort', stop, { once: true });
    promise.then(value => { signal.removeEventListener('abort', stop); resolve(value); },
      error => { signal.removeEventListener('abort', stop); reject(error); });
    if (signal.aborted) stop();
  });
}
async function bounded<T>(outer: AbortSignal, work: (signal: AbortSignal) => Promise<T>): Promise<T> {
  const controller = new AbortController(); const forward = () => controller.abort(outer.reason);
  outer.addEventListener('abort', forward, { once: true }); if (outer.aborted) forward();
  const timer = setTimeout(() => controller.abort(new Error('Scene association deadline')), DEADLINE_MS);
  try { controller.signal.throwIfAborted(); return await abortable(work(controller.signal), controller.signal); }
  finally { clearTimeout(timer); outer.removeEventListener('abort', forward); controller.abort(); }
}
async function responseJson(response: Response, signal: AbortSignal, maxBytes = MAX_META): Promise<LosslessJson> {
  need(response.status === 200 && !response.redirected && response.type !== 'opaque' && response.type !== 'opaqueredirect');
  need(response.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase() === 'application/json');
  const declared = response.headers.get('content-length');
  need(declared === null || /^(0|[1-9][0-9]*)$/.test(declared) && BigInt(declared) <= BigInt(maxBytes));
  const reader = response.body?.getReader(); need(reader); let total = 0; const chunks: Uint8Array[] = [];
  const cancel = () => { void reader.cancel().catch(() => undefined); };
  signal.addEventListener('abort', cancel, { once: true });
  try {
    for (;;) {
      signal.throwIfAborted(); const part = await abortable(reader.read(), signal); signal.throwIfAborted();
      if (part.done) break;
      need(part.value instanceof Uint8Array && part.value.length <= maxBytes - total && chunks.length < 8192);
      chunks.push(part.value); total += part.value.length;
    }
    need(total > 0 && (declared === null || BigInt(declared) === BigInt(total)));
    const bytes = new Uint8Array(total); let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
    return parse(new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes));
  } catch (error) { cancel(); throw error; }
  finally { signal.removeEventListener('abort', cancel); reader.releaseLock(); }
}
function anchors(value: LosslessJson): readonly NativeSceneAcceptedAnchor[] {
  const rows = list(value, 128); need(rows.length > 0); const ids = new Set<string>();
  return Object.freeze(rows.map(item => {
    const a = row(item, ['id','sourceFloorKey','sourceOriginalSha256','targets','unresolvedLabels']);
    const id = str(a.id); need(!ids.has(id)); ids.add(id);
    const pairs = new Set<string>();
    const targets = list(a.targets, 16).map(part => {
      const p = row(part, ['packagePlaceKey','packagePlaceUuid']);
      const key = str(p.packagePlaceKey, 512), identity = uuid(p.packagePlaceUuid);
      need(!pairs.has(`${key}\0${identity}`)); pairs.add(`${key}\0${identity}`);
      return Object.freeze({ packagePlaceKey: key, packagePlaceUuid: identity });
    });
    const unresolvedLabels = list(a.unresolvedLabels, 32).map(label => str(label));
    need(new Set(unresolvedLabels).size === unresolvedLabels.length);
    return Object.freeze({ id, sourceFloorKey: str(a.sourceFloorKey, 512), sourceOriginalSha256: sha(a.sourceOriginalSha256),
      targets: Object.freeze(targets), unresolvedLabels: Object.freeze(unresolvedLabels) });
  }));
}
function roomMappings(value: LosslessJson, accepted: readonly NativeSceneAcceptedAnchor[], expectedEvidenceIds: readonly string[]): readonly NativeSceneAcceptedRoomMapping[] {
  const anchorsById = new Map(accepted.map(anchor => [anchor.id, anchor]));
  const ids = new Set<string>();
  return Object.freeze(list(value, 256).map(item => {
    const mapping = row(item, ['sourceRoomId','sourceFloorKey','sourceOriginalSha256','sourceAnchorIds',
      'targets','unresolvedLabels','evidenceIds']);
    const sourceRoomId = str(mapping.sourceRoomId, 512), sourceFloorKey = str(mapping.sourceFloorKey, 512);
    const sourceOriginalSha256 = sha(mapping.sourceOriginalSha256);
    need(!ids.has(sourceRoomId)); ids.add(sourceRoomId);
    const sourceAnchorIds = list(mapping.sourceAnchorIds, 128).map(anchorId => str(anchorId, 512));
    need(sourceAnchorIds.length > 0 && new Set(sourceAnchorIds).size === sourceAnchorIds.length);
    for (const anchorId of sourceAnchorIds) {
      const anchor = anchorsById.get(anchorId);
      need(anchor && anchor.sourceFloorKey === sourceFloorKey && anchor.sourceOriginalSha256 === sourceOriginalSha256);
    }
    const pairs = new Set<string>();
    const targets = list(mapping.targets, 16).map(item => {
      const target = row(item, ['packagePlaceKey','packagePlaceUuid','atlasPlaceId']);
      const packagePlaceKey = str(target.packagePlaceKey, 512), packagePlaceUuid = uuid(target.packagePlaceUuid);
      const atlasPlaceId = target.atlasPlaceId === null ? null : uuid(target.atlasPlaceId);
      const pair = `${packagePlaceKey}\0${packagePlaceUuid}`;
      need(!pairs.has(pair)); pairs.add(pair);
      return Object.freeze({ packagePlaceKey, packagePlaceUuid, atlasPlaceId });
    });
    const unresolvedLabels = list(mapping.unresolvedLabels, 32).map(label => str(label, 512));
    need(new Set(unresolvedLabels).size === unresolvedLabels.length);
    const evidenceIds = list(mapping.evidenceIds, 32).map(evidenceId => uuid(evidenceId));
    need(new Set(evidenceIds).size === evidenceIds.length && evidenceIds.length === expectedEvidenceIds.length
      && expectedEvidenceIds.every(expected => evidenceIds.includes(expected)));
    return Object.freeze({ sourceRoomId, sourceFloorKey, sourceOriginalSha256, sourceAnchorIds: Object.freeze(sourceAnchorIds),
      evidenceIds: Object.freeze(evidenceIds), targets: Object.freeze(targets) });
  }));
}
function floors(value: LosslessJson, geometry: NativeGeometryFrame | null): readonly NativeSceneFloorBinding[] {
  const seen = new Set<string>(), sourceSeen = new Set<string>();
  return Object.freeze(list(value, 3).map(item => {
    const f = row(item, ['sourceFloorKey','sourceOriginalSha256','nativeFloorKey','nativeGeometryId',
      'nativeGeometryRevision','nativeOriginalAssetId','nativeOriginalSha256']);
    const nativeFloorKey = str(f.nativeFloorKey, 512), sourceFloorKey = str(f.sourceFloorKey, 512);
    need(!seen.has(nativeFloorKey) && !sourceSeen.has(sourceFloorKey));
    seen.add(nativeFloorKey); sourceSeen.add(sourceFloorKey);
    const nativeGeometryId = uuid(f.nativeGeometryId), nativeGeometryRevision = integer(f.nativeGeometryRevision);
    const nativeOriginalAssetId = uuid(f.nativeOriginalAssetId), nativeOriginalSha256 = sha(f.nativeOriginalSha256);
    if (geometry) {
    const match = geometry.floors.find(floor => floor.key === nativeFloorKey);
    need(match && match.geometryId === nativeGeometryId && match.geometryRevision.compare(nativeGeometryRevision) === 0
      && match.originalAssetId === nativeOriginalAssetId && match.originalSHA256 === nativeOriginalSha256);
    }
    return Object.freeze({ sourceFloorKey, sourceOriginalSha256: sha(f.sourceOriginalSha256), nativeFloorKey,
      nativeGeometryId, nativeGeometryRevision, nativeOriginalAssetId, nativeOriginalSha256 });
  }));
}

async function qualifyCurrentResponse(raw:LosslessJson,next:SceneAssociationContext,buildingId:string,viewKey:string,
  geometry:NativeGeometryFrame|null,validator:ReturnType<typeof createExactStockResultValidator>):Promise<SceneAssociationRead> {
  const output = row(raw);
      if (output.status === 'unavailable') {
        row(raw, ['status','reason','association']);
        need(output.association === null && (output.reason === 'no-current-association' || output.reason === 'current-source-unavailable'));
        return Object.freeze({ status: 'unavailable' as const,
          reason: output.reason as 'no-current-association' | 'current-source-unavailable' });
      }
      row(raw, ['status','association']); need(output.status === 'available');
      // Root registers the exact closed Stock3 Atlas record root. The current
      // route returns a raw stored record, not a Stock atlasReceipt envelope.
      need(validator.validateNativeEvidenceShape('scene-association', output.association!));
      const record = row(output.association, ['schemaVersion','recordType','recordId','workspaceId','homeId','revision',
        'lifecycle','createdAt','updatedAt','lastAuditId','payload']);
      need(integer(record.schemaVersion).compare(ONE) === 0 && record.recordType === 'scene-association'
        && record.lifecycle === 'active' && record.workspaceId === next.view.scope.workspaceId
        && record.homeId === next.view.scope.homeId);
      const recordId = uuid(record.recordId), revision = integer(record.revision);
      const p = row(record.payload, ['profile','buildingId','associationVersion','previousAssociationId',
        'reviewStatus','reviewStatement','sourceDocuments','acceptedReceipt','sourceFloors','roomMappings']);
      need(p.profile === 'houseatlas.native-scene-association.v1' && p.buildingId === buildingId
        && p.reviewStatus === 'accepted' && integer(p.associationVersion));
      const docs = list(p.sourceDocuments, 2); need(docs.length === 2);
      const documents = docs.map(item => row(item, ['role','evidenceId','evidenceRevision','originalAssetId',
        'originalAssetRevision','originalSha256','contentType']));
      const primary = documents.find(doc => doc.role === 'primary-scene');
      const historical = documents.find(doc => doc.role === 'documentary-sheet');
      need(primary && historical && documents.filter(doc => doc.role === 'primary-scene').length === 1
        && documents.filter(doc => doc.role === 'documentary-sheet').length === 1
        && primary.contentType === 'text/plain' && historical.contentType === 'text/plain'
        && primary.originalAssetId !== historical.originalAssetId);
      for (const doc of documents) { uuid(doc.evidenceId); uuid(doc.originalAssetId);
        integer(doc.evidenceRevision); integer(doc.originalAssetRevision); sha(doc.originalSha256); }
      const receipt = row(p.acceptedReceipt, ['receiptId','canonicalJson','canonicalSha256','anchors']);
      const literal = str(receipt.canonicalJson, 131072);
      const parsed = row(parse(literal), ['profile','receiptId','sourceReceiptSha256','anchors']);
      need(parsed.profile === 'houseatlas.native-scene-room-review.v1' && canonical(parsed) === literal
        && parsed.receiptId === receipt.receiptId && parsed.sourceReceiptSha256 === historical.originalSha256
        && await digest(encoder.encode(literal)) === receipt.canonicalSha256
        && equal(parsed.anchors!, receipt.anchors!));
      need(receipt.anchors !== undefined);
      const acceptedRoomAnchors = anchors(receipt.anchors);
      const expectedEvidenceIds = documents.map(doc => uuid(doc.evidenceId));
      const acceptedRoomMappings = roomMappings(p.roomMappings!, acceptedRoomAnchors, expectedEvidenceIds);
      const sourceFloorBindings = floors(p.sourceFloors!, geometry);
      const selection: NativeSceneSourceSelection = Object.freeze({ sessionIdentity: next.sessionIdentity,
        workspaceId: next.view.scope.workspaceId, homeId: next.view.scope.homeId,
        expiresAt: next.session.expiresAt, buildingId, viewKey,
        sceneEvidenceId: uuid(primary.evidenceId), historicalSceneEvidenceId: uuid(historical.evidenceId), sceneAssetId: uuid(primary.originalAssetId),
        sceneOriginalSha256: sha(primary.originalSha256),
        sceneEvidenceRevision: exactStockSafeInteger(integer(primary.evidenceRevision)),
        sceneAssetRevision: integer(primary.originalAssetRevision),
        acceptedRoomReceiptId: str(receipt.receiptId, 256), acceptedRoomReceiptSha256: sha(receipt.canonicalSha256),
        acceptedRoomAnchors, acceptedRoomMappings, sourceFloorBindings });
  return Object.freeze({status:'available',recordId,revision,payload:record.payload!,selection});
}

/** Source-only current read. The actual authenticated endpoint qualifies native
 * floor references; it does not require a displayed legacy geometry frame.
 * guard is the owning host's exact publication/session/current-attempt fence. */
export async function readNativeOverlayAssociation(next:SceneAssociationContext,buildingId:string,viewKey:string,
  signal:AbortSignal,guard:()=>void,transport:typeof fetch=fetch):Promise<SceneAssociationRead> {
  guard();need(UUID.test(buildingId)&&next.sessionIdentity&&Number.isFinite(Date.parse(next.session.expiresAt))&&Date.parse(next.session.expiresAt)>Date.now());
  return bounded(signal,async signal=>{
    guard();const response=await transport(`/api/atlas/scene/v1/workspaces/${next.view.scope.workspaceId}/homes/${next.view.scope.homeId}/buildings/${buildingId}/current`,
      {method:'GET',headers:{Accept:'application/json'},signal,credentials:'same-origin',cache:'no-store',redirect:'error',mode:'same-origin'});
    let raw:LosslessJson;try{raw=await responseJson(response,signal);}catch(error){void response.body?.cancel().catch(()=>undefined);throw error;}
    guard();const result=await qualifyCurrentResponse(raw,next,buildingId,viewKey,null,createExactStockResultValidator());guard();return result;
  });
}

export interface SceneAssociationContext {
  readonly sessionIdentity: object;
  readonly session: AtlasSessionInfo;
  readonly view: ReadyView;
  readonly admission: StockAdmission | null;
}
export interface SceneAssociationCandidate {
  readonly buildingId: string;
  readonly primaryEvidenceId: string;
  readonly historicalEvidenceId: string;
  /** Deliberate host-reviewed joins; never extracted as an authorization claim from the source text. */
  readonly sourceFloors: readonly JsonForSerialization[];
  readonly roomMappings: readonly JsonForSerialization[];
  readonly guards: readonly JsonForSerialization[];
}
export interface SceneAssociationCurrent {
  readonly status: 'available'; readonly recordId: string; readonly revision: ExactDecimal;
  readonly payload: LosslessJson; readonly selection: NativeSceneSourceSelection;
}
export type SceneAssociationRead = SceneAssociationCurrent |
  Readonly<{ status: 'unavailable'; reason: 'no-current-association' | 'current-source-unavailable' }>;
export interface SceneAssociationPrepared {
  readonly buildingId: string; readonly requestId: string; readonly targetId: string;
  readonly body: string; readonly requestDigest: string; readonly payload: LosslessJson;
  readonly drawingReview?: DocumentarySupport;
}
export interface SceneAssociationPending {
  readonly prepared: SceneAssociationPrepared; readonly outcome: 'unknown' | 'committed';
}
export interface SceneAssociationClient {
  getBinding(): object | null;
  canCreate(buildingId: string): boolean;
  subscribe(changed: () => void): () => void;
  pending(buildingId: string): readonly SceneAssociationPending[];
  isPreparedCurrent(prepared: SceneAssociationPrepared): boolean;
  readCurrent(buildingId: string, geometry: NativeGeometryFrame, signal: AbortSignal): Promise<SceneAssociationRead>;
  /** Qualified before descriptor-changing writes; the opaque token belongs to this owner. */
  capturePrevious(buildingId: string, geometry: NativeGeometryFrame, signal: AbortSignal): Promise<Readonly<{ token: object; current: SceneAssociationRead }>>;
  validatePrevious(token: object, geometry: NativeGeometryFrame, signal: AbortSignal): Promise<SceneAssociationRead>;
  prepare(candidate: SceneAssociationCandidate, geometry: NativeGeometryFrame,
    statement: string, reason: string, signal: AbortSignal, previous?: object): Promise<SceneAssociationPrepared>;
  releasePrepared(prepared: SceneAssociationPrepared): void;
  submit(prepared: SceneAssociationPrepared, geometry: NativeGeometryFrame, signal: AbortSignal, confirmDrawingSupport?: boolean, onPending?: () => void): Promise<SceneAssociationRead>;
  resolve(prepared: SceneAssociationPrepared, geometry: NativeGeometryFrame, signal: AbortSignal): Promise<SceneAssociationRead>;
  dispose(): void;
}

export function createNativeSceneAssociationClient(options: {
  getContext(): SceneAssociationContext | null;
  subscribe(changed: () => void): () => void;
  primaryReview: NativeEvidenceDocumentClient;
  historicalReview: NativeEvidenceDocumentClient;
  /** A fresh independent owner per temporary read or prepared PDF lease. */
  createDrawingReview?: () => NativeEvidenceDocumentClient;
  geometryCurrent(frame: NativeGeometryFrame): boolean;
  transport?: typeof fetch;
}): SceneAssociationClient {
  const validator = createExactStockResultValidator();
  const transport = options.transport ?? ((...args: Parameters<typeof fetch>) => fetch(...args));
  type PendingRow = { owner: object; workspaceId: string; homeId: string; buildingId: string;
    outcome: 'unknown' | 'committed' };
  const listeners = new Set<() => void>(), pending = new Map<SceneAssociationPrepared, PendingRow>();
  const preparedOwner = new WeakMap<SceneAssociationPrepared, object>();
  const previousOwner = new WeakMap<object, { owner: object; buildingId: string; head: SceneAssociationRead }>();
  const held = new Map<SceneAssociationPrepared, { primary: NativeEvidenceDocumentFrame;
    historical: NativeEvidenceDocumentFrame; stopPrimary: () => void; stopHistorical: () => void;
    withdrawn: AbortController; pdfOwner?: NativeEvidenceDocumentClient; pdf?: NativeEvidenceDocumentFrame; stopPdf?: () => void }>();
  const dispatched = new WeakSet<SceneAssociationPrepared>();
  let binding: object | null = null, tuple = '', disposed = false;
  let pendingBinding: object | null = null, pendingTuple = '', lastPendingSession: object | null = null;
  const notify = () => { for (const listener of listeners) listener(); };
  const context = () => {
    need(!disposed); const next = options.getContext(); need(next && next.sessionIdentity && typeof next.sessionIdentity === 'object');
    need(next.session.schemaVersion === 1 && next.session.actorId && next.session.csrfToken
      && Number.isFinite(Date.parse(next.session.expiresAt)) && Date.parse(next.session.expiresAt) > Date.now());
    need(UUID.test(next.view.scope.workspaceId) && UUID.test(next.view.scope.homeId)
      && (!next.admission || next.admission.scope.workspaceId === next.view.scope.workspaceId
        && next.admission.scope.homeId === next.view.scope.homeId));
    // A dispatched unknown survives changes in write admission or canEdit.
    // Prepared document leases still use the stricter authority-sensitive binding below.
    const pendingKey = JSON.stringify([next.session.actorId,next.session.csrfToken,next.session.expiresAt,
      next.view.scope.workspaceId,next.view.scope.homeId]);
    if (!pendingBinding || pendingTuple !== pendingKey || lastPendingSession !== next.sessionIdentity) {
      pendingBinding = Object.freeze({}); pendingTuple = pendingKey; lastPendingSession = next.sessionIdentity;
    }
    const key = JSON.stringify([next.session.actorId,next.session.csrfToken,next.session.expiresAt,
      next.view.scope.workspaceId,next.view.scope.homeId,next.view.canEdit,
      next.admission?.revision ?? null,next.admission?.commandIds ?? null]);
    if (!binding || tuple !== key || lastSession !== next.sessionIdentity) {
      binding = Object.freeze({}); tuple = key; lastSession = next.sessionIdentity;
    }
    return next;
  };
  let lastSession: object | null = null;
  const current = (owner: object, geometry?: NativeGeometryFrame) => {
    try { const next = context(); return binding === owner && (!geometry || options.geometryCurrent(geometry)) && next; }
    catch { return false; }
  };
  const pendingCurrent = (owner: object, geometry?: NativeGeometryFrame) => {
    try { const next = context(); return pendingBinding === owner
      && (!geometry || options.geometryCurrent(geometry)) && next; }
    catch { return false; }
  };
  const availableWrite = (next: SceneAssociationContext) => next.view.canEdit === true
    && next.admission?.commandIds.includes('atlas.scene-association.create') === true;
  const visiblePending = (buildingId: string, owner: object, next: SceneAssociationContext) =>
    [...pending].filter(([, item]) => item.owner === owner
      && item.workspaceId === next.view.scope.workspaceId && item.homeId === next.view.scope.homeId
      && item.buildingId === buildingId);
  const unknown = (buildingId: string, owner: object, next: SceneAssociationContext) =>
    visiblePending(buildingId, owner, next).some(([, item]) => item.outcome === 'unknown');
  const path = (next: SceneAssociationContext) => `/api/atlas/stock/v3/workspaces/${next.view.scope.workspaceId}/homes/${next.view.scope.homeId}`;
  const obtain = async (url: string, init: RequestInit, signal: AbortSignal, maxBytes = MAX_META) => {
    const response = await abortable(transport(url, { ...init, signal, credentials: 'same-origin',
      cache: 'no-store', redirect: 'error', mode: 'same-origin' }), signal);
    try { return await responseJson(response, signal, maxBytes); }
    catch (error) { void response.body?.cancel().catch(() => undefined); throw error; }
  };
  const buildingHasEvidence = async (buildingId: string, evidenceId: string, next: SceneAssociationContext,
    owner: object, geometry: NativeGeometryFrame, signal: AbortSignal) => {
    const raw = await obtain(`${path(next)}/records/identity/${buildingId}`, { method: 'GET', headers: { Accept: 'application/json' } }, signal);
    need(current(owner, geometry) && validator.validateNativeRead('atlas.identity.get', raw));
    const r = row(raw), scope = row(r.resolvedScope), data = row(r.data), records = list(data.records, 1);
    need(r.commandId === 'atlas.identity.get' && r.status === 'read' && r.replayed === false
      && scope.workspaceId === next.view.scope.workspaceId && scope.homeId === next.view.scope.homeId
      && data.sourceStatus === 'current' && data.nextCursor === null && records.length === 1);
    const record = row(records[0]), target = row(record.target), payload = row(record.payload);
    need(target.authority === 'atlas' && target.recordType === 'identity' && target.recordId === buildingId
      && record.lifecycle === 'active' && Array.isArray(payload.evidenceIds));
    return payload.evidenceIds.includes(evidenceId);
  };
  const readCurrent = async (buildingId: string, geometry: NativeGeometryFrame, outer: AbortSignal): Promise<SceneAssociationRead> => {
    need(UUID.test(buildingId)); const next = context(), owner = binding!;
    need(options.geometryCurrent(geometry) && geometry.descriptor.buildingId === buildingId
      && geometry.descriptor.scope.workspaceId === next.view.scope.workspaceId
      && geometry.descriptor.scope.homeId === next.view.scope.homeId);
    return bounded(outer, async signal => {
      const url = `/api/atlas/scene/v1/workspaces/${next.view.scope.workspaceId}/homes/${next.view.scope.homeId}/buildings/${buildingId}/current`;
      const raw = await obtain(url, { method: 'GET', headers: { Accept: 'application/json' } }, signal);
      need(current(owner, geometry));
      const qualified=await qualifyCurrentResponse(raw,next,buildingId,geometry.viewKey,geometry,validator);
      need(current(owner,geometry));if(qualified.status!=='available')return qualified;
      const recordId=qualified.recordId,revision=qualified.revision,p=row(qualified.payload);
      const documents=list(p.sourceDocuments,2).map(item=>row(item));
      const historical=documents.find(doc=>doc.role==='documentary-sheet')!;
      let selection=qualified.selection;
      // A current native review binds the exact support bytes. It does not
      // natively certify photo/page semantics, which remain independently reviewed evidence.
      if (options.createDrawingReview) {
        const documents = options.createDrawingReview(); let frame: NativeEvidenceDocumentFrame | null = null;
        try {
          const opening = documents.open(uuid(historical.evidenceId), signal);
          void opening.then(late => { if (signal.aborted) documents.release(late); }, () => undefined);
          frame = await abortable(opening, signal);
          const guard = () => { signal.throwIfAborted(); need(current(owner, geometry) && frame && documents.isCurrent(frame)); };
          guard(); need(frame.evidenceRevision === exactStockSafeInteger(integer(historical.evidenceRevision))
            && frame.asset.assetId === historical.originalAssetId && frame.asset.revision.compare(integer(historical.originalAssetRevision)) === 0
            && frame.asset.sha256 === historical.originalSha256 && frame.asset.contentType === 'text/plain');
          const blob = documents.getBlob(frame); need(blob?.type === 'text/plain' && blob.size <= MAX_ORIGINAL);
          const bytes = new Uint8Array(await abortable(blob.arrayBuffer(), signal)); guard();
          const support = await readDocumentarySupport(bytes, guard); guard();
          if (support && support.originalSha256 === historical.originalSha256
            && str(p.reviewStatement, 4096).endsWith(support.reviewMarker)
            && support.pdf.workspaceId === next.view.scope.workspaceId && support.pdf.homeId === next.view.scope.homeId
            && support.pdf.buildingId === buildingId
            && await buildingHasEvidence(buildingId, support.pdf.evidenceId, next, owner, geometry, signal)) {
            guard(); selection = Object.freeze({ ...selection, drawingReferences: documentaryReferences(support, selection),
              drawingSupport: Object.freeze({ evidenceId: frame.evidenceId, evidenceRevision: frame.evidenceRevision,
                assetId: frame.asset.assetId, assetRevision: frame.asset.revision, originalSha256: support.originalSha256,
                reviewMarker: support.reviewMarker }) });
          }
        } catch { signal.throwIfAborted(); need(current(owner, geometry)); /* Unreadable/unreviewed support retains the legacy path. */ }
        finally { if (frame) documents.release(frame); documents.dispose(); }
      }
      need(current(owner, geometry));
      return Object.freeze({ status: 'available' as const, recordId, revision, payload: qualified.payload, selection });
    });
  };
  const releasePrepared = (prepared: SceneAssociationPrepared) => {
    const item = held.get(prepared); if (!item) return;
    held.delete(prepared); item.stopPrimary(); item.stopHistorical(); item.withdrawn.abort();
    options.primaryReview.release(item.primary); options.historicalReview.release(item.historical);
    item.stopPdf?.(); if (item.pdf && item.pdfOwner) item.pdfOwner.release(item.pdf); item.pdfOwner?.dispose();
  };
  const validatePrevious = async (token: object, geometry: NativeGeometryFrame, outer: AbortSignal): Promise<SceneAssociationRead> => {
    const captured = previousOwner.get(token), next = context(), owner = binding!;
    need(captured && captured.owner === owner && current(owner, geometry)
      && geometry.descriptor.buildingId === captured.buildingId
      && geometry.descriptor.scope.workspaceId === next.view.scope.workspaceId
      && geometry.descriptor.scope.homeId === next.view.scope.homeId);
    const head = captured.head;
    return bounded(outer, async signal => {
      // One authenticated snapshot selects the complete retained chain in the
      // backend and returns only its head pins. Historical payloads need not fit
      // together in a frontend metadata response. This remains a read-point
      // proof; the backend checks the actual predecessor atomically on submit.
      const expectedDigest = head.status === 'available'
        ? await abortable(digest(encoder.encode(canonical(head.payload))), signal) : null;
      signal.throwIfAborted(); need(current(owner, geometry));
      const url = `/api/atlas/scene/v1/workspaces/${next.view.scope.workspaceId}/homes/${next.view.scope.homeId}/buildings/${captured.buildingId}/head`;
      const raw = await obtain(url, { method: 'GET', headers: { Accept: 'application/json' } }, signal, MAX_HEAD);
      signal.throwIfAborted(); need(current(owner, geometry));
      const output = row(raw, ['schema','scope','buildingId','status','reason','head']);
      const scope = row(output.scope, ['workspaceId','homeId']);
      need(output.schema === 'houseatlas.native-scene-head.v1'
        && uuid(scope.workspaceId) === next.view.scope.workspaceId && uuid(scope.homeId) === next.view.scope.homeId
        && uuid(output.buildingId) === captured.buildingId);
      const assertHead = (condition: unknown): void => {
        if (!condition) throw new TypeError('Native scan prior scene head changed; custody remains held');
      };
      if (output.status === 'unavailable') {
        need(output.head === null && (output.reason === 'no-current-association' || output.reason === 'current-source-unavailable'));
        assertHead(head.status === 'unavailable' && head.reason === 'no-current-association'
          && output.reason === 'no-current-association');
      } else {
        need(output.status === 'available' && output.reason === null);
        const observed = row(output.head, ['recordId','revision','payloadSha256']);
        const recordId = uuid(observed.recordId), revision = integer(observed.revision), payloadSha256 = sha(observed.payloadSha256);
        assertHead(head.status === 'available' && recordId === head.recordId
          && revision.compare(head.revision) === 0 && payloadSha256 === expectedDigest);
      }
      signal.throwIfAborted(); need(current(owner, geometry));
      return head;
    });
  };
  const unsubscribe = options.subscribe(() => { const prior = binding; try { context(); } catch { binding = null; }
    if (binding !== prior) for (const item of held.keys()) releasePrepared(item);
    notify(); });
  return {
    getBinding() { try { context(); return binding; } catch { return null; } },
    canCreate(buildingId) { try { const next = context(); return UUID.test(buildingId)
      && availableWrite(next) && !unknown(buildingId, pendingBinding!, next); }
      catch { return false; } },
    subscribe(changed) { listeners.add(changed); return () => listeners.delete(changed); },
    pending(buildingId) { try { const next = context(); if (!UUID.test(buildingId)) return Object.freeze([]);
      return Object.freeze(visiblePending(buildingId, pendingBinding!, next).map(([prepared, item]) =>
        Object.freeze({ prepared, outcome: item.outcome }))); }
      catch { return Object.freeze([]); } },
    isPreparedCurrent(prepared) { const item = held.get(prepared), owner = preparedOwner.get(prepared);
      return !!item && !!owner && !item.withdrawn.signal.aborted && !!current(owner)
        && options.primaryReview.isCurrent(item.primary) && options.historicalReview.isCurrent(item.historical)
        && (!item.pdf || !!item.pdfOwner?.isCurrent(item.pdf)); },
    readCurrent,
    async capturePrevious(buildingId, geometry, signal) {
      const next = context(), owner = binding!;
      need(availableWrite(next) && current(owner, geometry));
      const observed = await readCurrent(buildingId, geometry, signal);
      need(current(owner, geometry) && (observed.status === 'available' || observed.reason === 'no-current-association'));
      const freeze = (value: LosslessJson): LosslessJson => {
        if (value !== null && typeof value === 'object') {
          for (const part of Object.values(value)) freeze(part as LosslessJson);
          Object.freeze(value);
        }
        return value;
      };
      const head: SceneAssociationRead = observed.status === 'available'
        ? Object.freeze({ ...observed, payload: freeze(parse(stringifyLosslessJson(observed.payload))) }) : observed;
      const token = Object.freeze({}); previousOwner.set(token, { owner, buildingId, head });
      return Object.freeze({ token, current: head });
    },
    validatePrevious,
    releasePrepared,
    async prepare(candidate, geometry, statement, reason, outer, previous) {
      need(UUID.test(candidate.buildingId) && UUID.test(candidate.primaryEvidenceId)
        && UUID.test(candidate.historicalEvidenceId) && candidate.primaryEvidenceId !== candidate.historicalEvidenceId
        && statement.trim() && [...statement].length <= 4096 && reason.trim() && [...reason].length <= 4096);
      scalar(statement); scalar(reason);
      const next = context(), owner = binding!; need(availableWrite(next)
        && visiblePending(candidate.buildingId, pendingBinding!, next).length < 16
        && !unknown(candidate.buildingId, pendingBinding!, next) && options.geometryCurrent(geometry));
      return bounded(outer, async signal => {
        let primary: NativeEvidenceDocumentFrame | null = null, historical: NativeEvidenceDocumentFrame | null = null;
        let stopPrimary: () => void = () => undefined, stopHistorical: () => void = () => undefined, stopPdf: () => void = () => undefined;
        let pdfOwner: NativeEvidenceDocumentClient | undefined, pdf: NativeEvidenceDocumentFrame | undefined;
        const withdrawn = new AbortController();
        const guard = () => need(!signal.aborted && !withdrawn.signal.aborted
          && current(owner, geometry) && availableWrite(context())
          && primary && historical && options.primaryReview.isCurrent(primary)
          && options.historicalReview.isCurrent(historical) && (!pdf || !!pdfOwner?.isCurrent(pdf)));
        let retained = false;
        try {
          primary = await options.primaryReview.open(candidate.primaryEvidenceId, signal);
          historical = await options.historicalReview.open(candidate.historicalEvidenceId, signal);
          stopPrimary = options.primaryReview.subscribeInvalidation(primary, () => { withdrawn.abort(); notify(); });
          stopHistorical = options.historicalReview.subscribeInvalidation(historical, () => { withdrawn.abort(); notify(); });
          guard(); need(primary && historical);
          need(primary.asset.contentType === 'text/plain' && historical.asset.contentType === 'text/plain'
            && primary.asset.assetId !== historical.asset.assetId);
          const pBlob = options.primaryReview.getBlob(primary), hBlob = options.historicalReview.getBlob(historical);
          need(pBlob && hBlob && pBlob.size > 0 && pBlob.size <= MAX_ORIGINAL && hBlob.size <= MAX_ORIGINAL);
          const pBytes = new Uint8Array(await abortable(pBlob.arrayBuffer(), signal)); guard();
          const hBytes = new Uint8Array(await abortable(hBlob.arrayBuffer(), signal)); guard();
          need(await digest(pBytes) === primary.asset.sha256 && await digest(hBytes) === historical.asset.sha256);
          const source = row(parse(new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(pBytes)));
          need(source.schema === 'houseatlas.native-scene-source.v1' || source.schema === 'houseatlas.native-scene-source.v2');
          row(source, source.schema === 'houseatlas.native-scene-source.v1'
            ? ['schema','receiptCanonicalJson','rooms','network','electricity']
            : ['schema','receiptCanonicalJson','rooms','network','electricity','electricalFixtures']);
          const literal = str(source.receiptCanonicalJson, 131072), parsed = row(parse(literal),
            ['profile','receiptId','sourceReceiptSha256','anchors']);
          need(parsed.profile === 'houseatlas.native-scene-room-review.v1' && canonical(parsed) === literal
            && sha(parsed.sourceReceiptSha256) === historical.asset.sha256);
          need(parsed.anchors !== undefined);
          const acceptedAnchors = anchors(parsed.anchors), canonicalSha256 = await digest(encoder.encode(literal)); guard();
          const room = row(source.rooms, ['status','reason','receiptId','receiptSha256','entries','regions']);
          need(room.status === 'available' && room.reason === null && room.receiptId === parsed.receiptId
            && room.receiptSha256 === canonicalSha256);
          const currentHead = previous === undefined ? await readCurrent(candidate.buildingId, geometry, signal)
            : await validatePrevious(previous, geometry, signal); guard();
          if (previous !== undefined) need(previousOwner.get(previous)?.buildingId === candidate.buildingId);
          const sourceFloors = parseLosslessJson(stringifyLosslessJson(candidate.sourceFloors));
          const roomMappings = parseLosslessJson(stringifyLosslessJson(candidate.roomMappings));
          const guards = parseLosslessJson(stringifyLosslessJson(candidate.guards));
          if (previous !== undefined && currentHead.status === 'available') {
            const priorGuards = list(guards, 100);
            const existing = priorGuards.find(value => {
              const selected = row(row(value).target);
              return selected.recordType === 'scene-association' && selected.recordId === currentHead.recordId;
            });
            if (existing) need(integer(row(row(existing).revision).value).compare(currentHead.revision) === 0);
            else priorGuards.push({ target: { authority: 'atlas', recordType: 'scene-association', recordId: currentHead.recordId },
              revision: { kind: 'atlas', value: currentHead.revision } });
          }
          floors(sourceFloors, geometry);
          need(list(roomMappings, 256).length === list(room.entries, 32).length && list(guards, 100).length > 0);
          const ids = new Set<string>();
          for (const item of list(roomMappings, 256)) {
            const mapping = row(item, ['sourceRoomId','sourceFloorKey','sourceOriginalSha256','sourceAnchorIds',
              'targets','unresolvedLabels','evidenceIds']);
            const id = str(mapping.sourceRoomId); need(!ids.has(id)); ids.add(id);
            const entry = list(room.entries, 32).map(value => row(value)).find(value => value.id === id);
            need(entry && entry.sourceFloorKey === mapping.sourceFloorKey
              && entry.sourceOriginalSha256 === mapping.sourceOriginalSha256
              && equal(entry.sourceAnchorIds!, mapping.sourceAnchorIds!)
              && list(mapping.targets, 16).some(target => {
                const t = row(target); return t.packagePlaceKey === entry.packagePlaceKey
                  && t.packagePlaceUuid === entry.packagePlaceUuid;
              }));
            for (const anchorId of list(mapping.sourceAnchorIds, 128)) {
              const anchor = acceptedAnchors.find(anchor => anchor.id === anchorId);
              need(anchor && anchor.sourceFloorKey === entry.sourceFloorKey
                && anchor.sourceOriginalSha256 === entry.sourceOriginalSha256
                && anchor.targets.length === 1
                && anchor.targets[0]!.packagePlaceKey === entry.packagePlaceKey
                && anchor.targets[0]!.packagePlaceUuid === entry.packagePlaceUuid);
            }
          }
          const drawingReview = await readDocumentarySupport(hBytes, guard); guard();
          if (drawingReview) {
            need(options.createDrawingReview && drawingReview.originalSha256 === historical.asset.sha256
              && drawingReview.pdf.workspaceId === next.view.scope.workspaceId && drawingReview.pdf.homeId === next.view.scope.homeId
              && drawingReview.pdf.buildingId === candidate.buildingId);
            const fixtures = row(row(source.electricalFixtures).documentaryFixtures);
            need(sameDocumentaryValue(fixtures, drawingReview.fixtureLedger));
            need(await buildingHasEvidence(candidate.buildingId, drawingReview.pdf.evidenceId, next, owner, geometry, signal)); guard();
            pdfOwner = options.createDrawingReview();
            const documentOwner = pdfOwner, opening = documentOwner.open(drawingReview.pdf.evidenceId, signal);
            void opening.then(late => { if (signal.aborted) documentOwner.release(late); }, () => undefined);
            pdf = await abortable(opening, signal);
            stopPdf = pdfOwner.subscribeInvalidation(pdf, () => { withdrawn.abort(); notify(); }); guard();
            need(matchesDocumentaryPdf(drawingReview, pdf, pdfOwner.getBlob(pdf)));
          }
          const reviewedStatement = drawingReview ? statement + drawingReview.reviewMarker : statement;
          need([...reviewedStatement].length <= 4096);
          const documents = [{ role: 'primary-scene', evidenceId: primary.evidenceId,
            evidenceRevision: primary.evidenceRevision, originalAssetId: primary.asset.assetId,
            originalAssetRevision: primary.asset.revision, originalSha256: primary.asset.sha256, contentType: 'text/plain' },
          { role: 'documentary-sheet', evidenceId: historical.evidenceId,
            evidenceRevision: historical.evidenceRevision, originalAssetId: historical.asset.assetId,
            originalAssetRevision: historical.asset.revision, originalSha256: historical.asset.sha256, contentType: 'text/plain' }];
          const prior = currentHead.status === 'available' ? currentHead : null;
          const version = prior ? ExactDecimal.parse((BigInt(exactStockSafeInteger(integer(row(prior.payload).associationVersion))) + 1n).toString()) : ONE;
          const payload = { profile: 'houseatlas.native-scene-association.v1', buildingId: candidate.buildingId,
            associationVersion: version, previousAssociationId: prior?.recordId ?? null,
            reviewStatus: 'accepted', reviewStatement: reviewedStatement, sourceDocuments: documents,
            acceptedReceipt: { receiptId: str(parsed.receiptId, 256), canonicalJson: literal, canonicalSha256,
              anchors: parsed.anchors! }, sourceFloors, roomMappings };
          const targetId = crypto.randomUUID(), requestId = crypto.randomUUID();
          const request: JsonForSerialization = { schemaVersion: 3, commandId: 'atlas.scene-association.create',
            requestId, context: { workspaceId: next.view.scope.workspaceId, homeId: next.view.scope.homeId },
            target: { authority: 'atlas', recordType: 'scene-association', recordId: targetId },
            payload, idempotencyKey: crypto.randomUUID(), reason, preconditions: { target: null, guards }, approvalReceiptId: null };
          const body = stringifyLosslessJson(request); need(encoder.encode(body).length <= MAX_BODY);
          const parsedRequest = parseLosslessJson(body);
          need(validator.validateNativeRequest('atlas.scene-association.create', parsedRequest)); guard();
          const prepared: SceneAssociationPrepared = Object.freeze({ buildingId: candidate.buildingId, requestId,
            targetId, body, requestDigest: await requestDigest(parsedRequest), payload: row(parsedRequest).payload!,
            ...(drawingReview ? { drawingReview } : {}) });
          guard();
          preparedOwner.set(prepared, owner);
          held.set(prepared, { primary, historical, stopPrimary, stopHistorical, withdrawn,
            ...(pdfOwner && pdf ? { pdfOwner, pdf, stopPdf } : {}) });
          retained = true; return prepared;
        } finally {
          if (!retained) {
            stopPrimary(); stopHistorical(); stopPdf();
            if (pdf && pdfOwner) pdfOwner.release(pdf); pdfOwner?.dispose();
            if (primary) options.primaryReview.release(primary);
            if (historical) options.historicalReview.release(historical);
          }
        }
      });
    },
    async submit(prepared, geometry, outer, confirmDrawingSupport, onPending) {
      const owner = preparedOwner.get(prepared), source = held.get(prepared);
      need(owner && source && !source.withdrawn.signal.aborted && !dispatched.has(prepared) && current(owner, geometry)
        && options.primaryReview.isCurrent(source.primary) && options.historicalReview.isCurrent(source.historical)
        && (!source.pdf || !!source.pdfOwner?.isCurrent(source.pdf)));
      need(!prepared.drawingReview || confirmDrawingSupport === true);
      const next = context(); need(availableWrite(next) && !unknown(prepared.buildingId, pendingBinding!, next));
      dispatched.add(prepared); pending.set(prepared, { owner: pendingBinding!, workspaceId: next.view.scope.workspaceId,
        homeId: next.view.scope.homeId, buildingId: prepared.buildingId, outcome: 'unknown' }); onPending?.(); notify();
      try { return await bounded(outer, async signal => {
        const raw = await obtain(`${path(next)}/commands`, { method: 'POST',
          headers: { Accept: 'application/json', 'Content-Type': 'application/json', 'X-Atlas-CSRF': next.session.csrfToken },
          body: prepared.body }, signal);
        need(current(owner, geometry) && validator.validateMutation('atlas.scene-association.create',
          '#/$defs/result_atlas_scene_association_create', raw));
        const output = row(raw), scope = row(output.resolvedScope), data = row(output.data, ['auditIds','records','requestDigest']);
        need(output.commandId === 'atlas.scene-association.create' && output.requestId === prepared.requestId
          && output.status === 'committed' && output.replayed === false && uuid(output.operationId)
          && scope.workspaceId === next.view.scope.workspaceId && scope.homeId === next.view.scope.homeId
          && data.requestDigest === prepared.requestDigest);
        const records = list(data.records, 1), audits = list(data.auditIds, 1);
        need(records.length === 1 && audits.length === 1 && uuid(audits[0]));
        const record = row(records[0]), target = row(record.target);
        need(target.authority === 'atlas' && target.recordType === 'scene-association'
          && target.recordId === prepared.targetId && record.lifecycle === 'active'
          && integer(record.revision).compare(ONE) === 0 && equal(record.payload!, prepared.payload));
        const head = await readCurrent(prepared.buildingId, geometry, signal);
        need(head.status === 'available' && head.recordId === prepared.targetId && equal(head.payload, prepared.payload));
        need(current(owner, geometry)); pending.set(prepared, { owner: pendingBinding!,
          workspaceId: next.view.scope.workspaceId, homeId: next.view.scope.homeId,
          buildingId: prepared.buildingId, outcome: 'committed' }); notify(); return head;
      }); } finally { releasePrepared(prepared); }
    },
    async resolve(prepared, geometry, signal) {
      const next = context(), owner = pendingBinding, item = pending.get(prepared);
      need(owner && item && item.outcome === 'unknown' && item.owner === owner
        && item.workspaceId === next.view.scope.workspaceId && item.homeId === next.view.scope.homeId
        && item.buildingId === prepared.buildingId && pendingCurrent(owner, geometry));
      const head = await readCurrent(prepared.buildingId, geometry, signal);
      need(pendingCurrent(owner, geometry));
      if (head.status === 'available' && head.recordId === prepared.targetId && equal(head.payload, prepared.payload)) {
        pending.set(prepared, { ...item, outcome: 'committed' }); notify();
      }
      return head;
    },
    dispose() { disposed = true; unsubscribe(); for (const item of held.keys()) releasePrepared(item);
      binding = null; pendingBinding = null; listeners.clear(); }
  };
}

/** Current native building -> evidence qualification used by the source-only
 * overlay owner before offering the separately reviewed PDF correlation. */
export async function readNativeOverlayBuildingEvidence(next:SceneAssociationContext,buildingId:string,evidenceId:string,
  signal:AbortSignal,guard:()=>void,transport:typeof fetch=fetch):Promise<boolean>{
  guard();need(UUID.test(buildingId)&&UUID.test(evidenceId));
  const response=await transport(`/api/atlas/stock/v3/workspaces/${next.view.scope.workspaceId}/homes/${next.view.scope.homeId}/records/identity/${buildingId}`,
    {method:'GET',headers:{Accept:'application/json'},signal,credentials:'same-origin',cache:'no-store',redirect:'error',mode:'same-origin'});
  let raw:LosslessJson;try{raw=await responseJson(response,signal);}catch(error){void response.body?.cancel().catch(()=>undefined);throw error;}
  guard();need(createExactStockResultValidator().validateNativeRead('atlas.identity.get',raw));
  const r=row(raw),scope=row(r.resolvedScope),data=row(r.data),records=list(data.records,1);
  need(r.commandId==='atlas.identity.get'&&r.status==='read'&&r.replayed===false&&scope.workspaceId===next.view.scope.workspaceId&&scope.homeId===next.view.scope.homeId&&data.sourceStatus==='current'&&data.nextCursor===null&&records.length===1);
  const record=row(records[0]),target=row(record.target),payload=row(record.payload);
  need(target.authority==='atlas'&&target.recordType==='identity'&&target.recordId===buildingId&&record.lifecycle==='active'&&Array.isArray(payload.evidenceIds));guard();return payload.evidenceIds.includes(evidenceId);
}
