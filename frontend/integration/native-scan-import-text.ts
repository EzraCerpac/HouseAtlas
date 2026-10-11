import type { SceneAssociationContext } from './native-scene-association-client';
import type { NativeDocumentBinding } from '../src/lantern/scans/native-document-types';
import { createNativeDocumentReadClient } from './native-document-read-client';
import { createNativeEvidenceDocumentClient } from './native-evidence-document-client';
import { ExactDecimal, isExactDecimal } from '../src/numeric/decimal';
import { parseLosslessJson, stringifyLosslessJson, type LosslessJson, type JsonForSerialization } from '../src/numeric/lossless-json';
import { createExactStockResultValidator, exactStockSafeInteger } from '../src/numeric/schema-validator';

/** Agent input is immutable file custody, not a browser selection claim. */
export interface NativeScanTextInput {
  readonly buildingId: string;
  readonly file: Blob;
  readonly filename: string;
  readonly sha256: string;
  readonly byteSize: number;
  readonly statement: string;
  readonly reason: string;
  readonly sourceLicense: { readonly status: 'unknown'; readonly reference: null };
}
export type NativeScanDispatchKind = 'text-asset' | 'text-evidence' | 'scene-association';
export interface NativeScanDispatch {
  readonly requestId: string;
  readonly body?: string;
  readonly metadata?: string;
  readonly sha256?: string;
  readonly byteSize?: number;
}
export interface NativeScanJournal {
  /** Must durably claim this one request before returning. No credentials supplied. */
  beforeDispatch(kind: NativeScanDispatchKind, input: NativeScanDispatch): Promise<void>;
  /** Raw validated receipts remain wire observations, not replacement receipts. */
  afterResult(kind: NativeScanDispatchKind, result: {
    readonly requestId: string; readonly outcome: 'committed' | 'unknown'; readonly receipt?: LosslessJson;
  }): Promise<void>;
}
export interface NativeScanImportOptions extends NativeScanJournal {
  getContext(): SceneAssociationContext | null;
  subscribe(changed: () => void): () => void;
  readonly origin: string;
  readonly transport: typeof fetch;
}
export type NativeScanTextResult = {
  readonly outcome: 'committed'; readonly assetId: string; readonly evidenceId: string;
  readonly assetReceipt: LosslessJson; readonly evidenceReceipt: LosslessJson;
} | { readonly outcome: 'unknown'; readonly phase: 'text-asset' | 'text-evidence'; readonly requestId: string }
  | { readonly outcome: 'partial'; readonly phase: 'text-asset' | 'text-evidence'; readonly requestId: string | null;
    readonly assetId:string; readonly assetRequestId:string; readonly assetReceipt:LosslessJson;
    readonly evidenceId?:string; readonly evidenceReceipt?:LosslessJson };
type Row = { [key: string]: LosslessJson };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[0-9a-f]{12}$/;
const SHA = /^[0-9a-f]{64}$/;
const encoder = new TextEncoder();
function need(value: unknown): asserts value { if (!value) throw new TypeError('Native scan document is not current or qualified'); }
function row(value: LosslessJson | undefined): Row {
  need(value !== null && typeof value === 'object' && !Array.isArray(value) && !isExactDecimal(value)); return value;
}
function list(value: LosslessJson | undefined): LosslessJson[] { need(Array.isArray(value)); return value; }
function exact(value: LosslessJson | undefined): ExactDecimal {
  need(isExactDecimal(value) && value.isInteger && value.compare(ExactDecimal.parse('1')) >= 0);
  exactStockSafeInteger(value); return value;
}
function scalar(value: string, bound: number): void {
  need(typeof value === 'string' && value.trim() && [...value].length <= bound);
  for (const character of value) { const point = character.codePointAt(0)!; need(point < 0xd800 || point > 0xdfff); }
}
export async function nativeScanImportDigest(bytes: Uint8Array): Promise<string> {
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256', new Uint8Array(bytes).buffer))]
    .map(value => value.toString(16).padStart(2, '0')).join('');
}
/** Source bytes never undergo stringify or a silent UTF-8 replacement. */
export async function verifyNativeScanText(input: NativeScanTextInput, signal: AbortSignal): Promise<string> {
  signal.throwIfAborted(); need(UUID.test(input.buildingId) && SHA.test(input.sha256));
  scalar(input.filename, 255); need(!/[\/\\\u0000-\u001f]/.test(input.filename));
  scalar(input.statement, 4096); scalar(input.reason, 1024);
  need(input.sourceLicense?.status === 'unknown' && input.sourceLicense.reference === null
    && Object.keys(input.sourceLicense).length === 2);
  need(input.file instanceof Blob && input.byteSize === input.file.size && input.byteSize > 0 && input.byteSize <= 8 * 1024 * 1024);
  const bytes = new Uint8Array(await input.file.arrayBuffer()); signal.throwIfAborted();
  need(bytes.length === input.byteSize && await nativeScanImportDigest(bytes) === input.sha256); signal.throwIfAborted();
  return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
}
function canonical(value: LosslessJson): string {
  if (isExactDecimal(value)) return JSON.stringify(exactStockSafeInteger(value));
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key]!)}`).join(',')}}`;
}
async function requestDigest(value: LosslessJson): Promise<string> {
  const intent = { ...row(value) }; delete intent.requestId; delete intent.approvalReceiptId;
  return nativeScanImportDigest(encoder.encode(canonical(intent)));
}
export async function nativeScanImportWait<T>(work: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const stop = () => { signal.removeEventListener('abort', stop); reject(signal.reason); };
    signal.addEventListener('abort', stop, { once: true });
    work.then(value => { signal.removeEventListener('abort', stop); resolve(value); }, error => { signal.removeEventListener('abort', stop); reject(error); });
    if (signal.aborted) stop();
  });
}
export async function nativeScanImportResponseJson(response: Response, signal: AbortSignal): Promise<LosslessJson> {
  const reader = response.body?.getReader();
  try {
    need(response.status === 200 && !response.redirected && response.type !== 'opaque'
      && response.type !== 'opaqueredirect' && response.headers.get('content-type') === 'application/json' && reader);
    const length = response.headers.get('content-length'); need(length === null || /^\d+$/.test(length) && Number(length) <= 1024 * 1024);
    const chunks: Uint8Array[] = []; let bytes = 0;
    for (;;) { signal.throwIfAborted(); const next = await nativeScanImportWait(reader.read(), signal); signal.throwIfAborted();
      if (next.done) break; need(chunks.length < 8192 && next.value.length <= 1024 * 1024 - bytes);
      chunks.push(next.value); bytes += next.value.length; }
    need(bytes > 0 && (length === null || Number(length) === bytes));
    const joined = new Uint8Array(bytes); let offset = 0; for (const chunk of chunks) { joined.set(chunk, offset); offset += chunk.length; }
    return parseLosslessJson(new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(joined));
  } catch (error) { if (reader) void reader.cancel().catch(() => undefined); else void response.body?.cancel().catch(() => undefined); throw error; }
  finally { reader?.releaseLock(); }
}
/** One factory is one live operation lane. UNKNOWN permanently holds this lane;
 * the caller's durable journal must hold it across process replacement as well. */
export function createNativeScanTextImporter(options: NativeScanImportOptions) {
  const parsedOrigin = new URL(options.origin); need(parsedOrigin.protocol === 'https:' && parsedOrigin.origin === options.origin);
  const validator = createExactStockResultValidator();
  let disposed = false, busy = false, held = false;
  let binding: NativeDocumentBinding | null = null, ownerKey = '';
  const getBinding = () => {
    let next: SceneAssociationContext | null; try { next = options.getContext(); } catch { binding = null; return null; }
    if (disposed || !next || !next.sessionIdentity || next.session.schemaVersion !== 1
      || !next.session.actorId || !next.session.csrfToken || Date.parse(next.session.expiresAt) <= Date.now()
      || !Number.isFinite(Date.parse(next.session.expiresAt)) || !next.view.canEdit || !next.admission
      || !UUID.test(next.view.scope.workspaceId) || !UUID.test(next.view.scope.homeId)
      || next.admission.scope.workspaceId !== next.view.scope.workspaceId || next.admission.scope.homeId !== next.view.scope.homeId) { binding = null; return null; }
    const key = JSON.stringify([next.session.actorId,next.session.csrfToken,next.session.expiresAt,next.view.scope.workspaceId,
      next.view.scope.homeId,next.admission.revision,next.admission.commandIds]);
    if (!binding || binding.sessionIdentity !== next.sessionIdentity || key !== ownerKey) {
      ownerKey = key; binding = Object.freeze({ sessionIdentity: next.sessionIdentity, expiresAt: next.session.expiresAt,
        scope: Object.freeze({ ...next.view.scope }) });
    }
    return binding;
  };
  const original = createNativeDocumentReadClient({ getBinding, subscribeBinding: options.subscribe, origin: options.origin, transport: options.transport });
  const evidence = createNativeEvidenceDocumentClient({ getBinding, subscribeBinding: options.subscribe, origin: options.origin, transport: options.transport });
  const root = (pin: NativeDocumentBinding) => `/api/atlas/stock/v3/workspaces/${pin.scope.workspaceId}/homes/${pin.scope.homeId}`;
  const target = (kind: string, recordId: string) => ({ authority: 'atlas', recordType: kind, recordId });
  const guard = (kind: string, recordId: string, revision: ExactDecimal) => ({ target: target(kind,recordId), revision: { kind: 'atlas', value: revision } });
  return {
    async importText(supplied: NativeScanTextInput, outer: AbortSignal): Promise<NativeScanTextResult> {
      need(!disposed && !busy && !held);
      const input: NativeScanTextInput = Object.freeze({ ...supplied, sourceLicense: Object.freeze({ ...supplied.sourceLicense }) }); busy = true;
      const controller = new AbortController(), forward = () => controller.abort(outer.reason);
      outer.addEventListener('abort', forward, { once: true }); if (outer.aborted) forward();
      const timer = setTimeout(() => controller.abort(new Error('Native scan text exchange exceeded deadline')), 60_000);
      let phase: 'text-asset' | 'text-evidence' = 'text-asset', requestId = '', sent = false;
      let terminal = false, wireDispatched = false;
      let knownAsset: {assetId:string;requestId:string;receipt:LosslessJson} | null = null;
      let knownEvidence: {evidenceId:string;receipt:LosslessJson} | null = null;
      const pin = getBinding();
      const check = () => { controller.signal.throwIfAborted(); need(pin && getBinding() === pin); };
      const stop = options.subscribe(() => { if (!pin || getBinding() !== pin) controller.abort(new Error('Native scan context changed')); });
      const exchange = async (url: string, init: RequestInit) => {
        check(); const response = await nativeScanImportWait(options.transport(url, { ...init, signal: controller.signal, credentials: 'same-origin',
          cache: 'no-store', redirect: 'error', mode: 'same-origin' }), controller.signal);
        try { check(); const value = await nativeScanImportResponseJson(response,controller.signal); check(); return value; }
        catch (error) { void response.body?.cancel().catch(() => undefined); throw error; }
      };
      const read = async (kind: string, id: string): Promise<Row> => {
        const output = await exchange(`${root(pin!)}/records/${kind}/${id}`, { method: 'GET', headers: { Accept: 'application/json' } });
        need(validator.validateNativeRead(`atlas.${kind}.get`,output)); const r = row(output), data = row(r.data), scope = row(r.resolvedScope);
        need(r.commandId === `atlas.${kind}.get` && r.status === 'read' && r.replayed === false && scope.workspaceId === pin!.scope.workspaceId
          && scope.homeId === pin!.scope.homeId && data.sourceStatus === 'current' && data.nextCursor === null);
        const records = list(data.records); need(records.length === 1); const record = row(records[0]), t = row(record.target);
        need(t.authority === 'atlas' && t.recordType === kind && t.recordId === id && record.lifecycle === 'active'); exact(record.revision); return record;
      };
      const receipt = (raw: LosslessJson, command: string, id: string, count: number): Row[] => {
        need(validator.validateMutation(command, `#/$defs/result_${command.replaceAll('.','_')}`, raw));
        const r = row(raw), scope = row(r.resolvedScope), data = row(r.data);
        need(r.commandId === command && r.requestId === id && r.status === 'committed' && r.replayed === false && UUID.test(String(r.operationId))
          && scope.workspaceId === pin!.scope.workspaceId && scope.homeId === pin!.scope.homeId);
        const records = list(data.records).map(row), audits = list(data.auditIds);
        need(records.length === count && audits.length === count && new Set(audits).size === count && audits.every(id => typeof id === 'string' && UUID.test(id)));
        return records;
      };
      try {
        check(); const context = options.getContext()!;
        need(['atlas.asset.create','atlas.evidence.create','atlas.identity.replace','atlas.batch.execute'].every(id => context.admission!.commandIds.includes(id)));
        await nativeScanImportWait(verifyNativeScanText(input,controller.signal),controller.signal); check();
        // Prove the actual selected building exists before the first write.
        const firstIdentity = await read('identity',input.buildingId); need(row(firstIdentity.payload).kind === 'location');
        requestId = crypto.randomUUID(); const metadata = JSON.stringify({ schemaVersion:1,requestId,idempotencyKey:crypto.randomUUID(),
          context:pin!.scope,reason:input.reason,filename:input.filename,contentType:'text/plain',sourceLicense:input.sourceLicense });
        need(encoder.encode(metadata).length <= 16384);
        const multipart = new FormData(); multipart.append('metadata',metadata);
        multipart.append('file',new Blob([input.file],{type:'text/plain'}),input.filename);
        held = true; sent = true;
        await nativeScanImportWait(options.beforeDispatch(phase,{requestId,metadata,sha256:input.sha256,byteSize:input.byteSize}),controller.signal); check();
        wireDispatched = true; const assetReceipt = await exchange(`${root(pin!)}/assets`,{method:'POST',headers:{Accept:'application/json','X-Atlas-CSRF':context.session.csrfToken},body:multipart});
        const assetRecord = receipt(assetReceipt,'atlas.asset.create',requestId,1)[0]!, assetTarget = row(assetRecord.target), payload = row(assetRecord.payload);
        const assetId = assetTarget.recordId; need(typeof assetId === 'string' && UUID.test(assetId) && assetTarget.authority === 'atlas' && assetTarget.recordType === 'asset'
          && exact(assetRecord.revision).compare(ExactDecimal.parse('1')) === 0 && assetRecord.lifecycle === 'active'
          && payload.owner === 'atlas' && payload.purpose === 'evidence-original' && payload.contentType === 'text/plain' && payload.sha256 === input.sha256
          && exactStockSafeInteger(payload.byteSize!) === input.byteSize && payload.availability === 'available' && payload.previewPolicy === 'download-only'
          && list(payload.evidenceIds).length === 0 && canonical(payload.sourceLicense!) === canonical(parseLosslessJson(JSON.stringify(input.sourceLicense))));
        terminal = true; knownAsset = {assetId,requestId,receipt:assetReceipt};
        await nativeScanImportWait(options.afterResult(phase,{requestId,outcome:'committed',receipt:assetReceipt}),controller.signal); check();
        const assetFrame = await original.loadOriginal({assetId,revision:exact(assetRecord.revision),sha256:input.sha256,contentType:'text/plain',byteSize:ExactDecimal.parse(String(input.byteSize))},controller.signal);
        try { check(); need(original.isCurrent(assetFrame) && original.getBlob(assetFrame)?.size === input.byteSize); }
        finally { original.release(assetFrame); }
        phase = 'text-evidence'; requestId = ''; sent = false; terminal = false; wireDispatched = false;
        const identity = await read('identity',input.buildingId), identityPayload = row(identity.payload), oldIds = list(identityPayload.evidenceIds);
        need(identityPayload.kind === 'location' && oldIds.length <= 97 && new Set(oldIds).size === oldIds.length);
        const asset = await read('asset',assetId); need(canonical(asset) === canonical(assetRecord));
        const prior = await Promise.all(oldIds.map(id => { need(typeof id === 'string' && UUID.test(id)); return read('evidence',id); }));
        const evidenceId = crypto.randomUUID();
        const evidencePayload: JsonForSerialization = { statement:input.statement,provenance:{source:null,sourceRevision:null,sourceConfidence:null,
          evidenceBasis:'unknown',factAt:null,retrievedAt:new Date().toISOString(),vantage:null,uncertainty:{status:'unknown',explanation:null}},
          supersedesEvidenceIds:[],references:[{kind:'atlas-asset',assetId}] };
        const identityReplacement = { ...identityPayload, evidenceIds:[...oldIds,evidenceId] };
        const assetGuard = guard('asset',assetId,exact(asset.revision));
        const evidenceGuards = prior.map(record => guard('evidence',String(row(record.target).recordId),exact(record.revision)));
        const child = (kind: string, recordId: string, value: JsonForSerialization, guards: JsonForSerialization[], revision: ExactDecimal | null) => ({
          schemaVersion:3,commandId:`atlas.${kind}.${revision ? 'replace' : 'create'}`,requestId:crypto.randomUUID(),context:pin!.scope,
          target:target(kind,recordId),payload:value,idempotencyKey:crypto.randomUUID(),reason:input.reason,approvalReceiptId:null,
          preconditions:{target:revision ? {kind:'atlas',value:revision} : null,guards} });
        const commands = [child('evidence',evidenceId,evidencePayload,[assetGuard],null),
          child('identity',input.buildingId,identityReplacement,evidenceGuards,exact(identity.revision))];
        for (const command of commands) need(validator.validateNativeRequest(command.commandId,parseLosslessJson(stringifyLosslessJson(command))));
        requestId = crypto.randomUUID(); const body = stringifyLosslessJson({schemaVersion:3,commandId:'atlas.batch.execute',requestId,context:pin!.scope,
          target:{authority:'atlas',kind:'batch',batchId:crypto.randomUUID()},payload:{commands},idempotencyKey:crypto.randomUUID(),reason:input.reason,
          approvalReceiptId:null,preconditions:{target:null,guards:[guard('identity',input.buildingId,exact(identity.revision)),assetGuard,...evidenceGuards]}});
        need(encoder.encode(body).length <= 1024 * 1024 && validator.validateNativeRequest('atlas.batch.execute',parseLosslessJson(body)));
        sent = true; await nativeScanImportWait(options.beforeDispatch(phase,{requestId,body}),controller.signal); check();
        wireDispatched = true; const evidenceReceipt = await exchange(`${root(pin!)}/commands`,{method:'POST',headers:{Accept:'application/json','Content-Type':'application/json','X-Atlas-CSRF':context.session.csrfToken},body});
        const records = receipt(evidenceReceipt,'atlas.batch.execute',requestId,2), byKind = new Map(records.map(record => [row(record.target).recordType,record]));
        const er = byKind.get('evidence'), ir = byKind.get('identity'); need(er && ir && byKind.size === 2);
        need(row(er.target).recordId === evidenceId && er.lifecycle === 'active' && exact(er.revision).compare(ExactDecimal.parse('1')) === 0
          && canonical(er.payload!) === canonical(parseLosslessJson(stringifyLosslessJson(evidencePayload)))
          && row(ir.target).recordId === input.buildingId && ir.lifecycle === 'active'
          && exact(ir.revision).compare(ExactDecimal.parse(String(exactStockSafeInteger(identity.revision!) + 1))) === 0
          && canonical(ir.payload!) === canonical(identityReplacement));
        need(row(row(evidenceReceipt).data).requestDigest === await requestDigest(parseLosslessJson(body)));
        terminal = true; knownEvidence = {evidenceId,receipt:evidenceReceipt};
        await nativeScanImportWait(options.afterResult(phase,{requestId,outcome:'committed',receipt:evidenceReceipt}),controller.signal); check();
        const currentIdentity = await read('identity',input.buildingId); need(canonical(currentIdentity) === canonical(ir));
        const frame = await evidence.open(evidenceId,controller.signal);
        try { check(); need(evidence.isCurrent(frame) && frame.evidenceRevision === 1 && frame.asset.assetId === assetId
          && frame.asset.revision.compare(ExactDecimal.parse('1')) === 0 && frame.asset.sha256 === input.sha256
          && frame.asset.contentType === 'text/plain' && exactStockSafeInteger(frame.asset.byteSize) === input.byteSize
          && evidence.getBlob(frame)?.size === input.byteSize); }
        finally { evidence.release(frame); }
        held = false; return Object.freeze({outcome:'committed',assetId,evidenceId,assetReceipt,evidenceReceipt});
      } catch (error) {
        // Once any asset POST has been claimed, subsequent failures also hold
        // the lane; known custody is never silently uploaded again.
        if (!held) throw error;
        if (knownAsset && (terminal || !wireDispatched)) return Object.freeze({outcome:'partial',phase,
          requestId:wireDispatched ? requestId : null,assetId:knownAsset.assetId,assetRequestId:knownAsset.requestId,assetReceipt:knownAsset.receipt,
          ...(knownEvidence ? {evidenceId:knownEvidence.evidenceId,evidenceReceipt:knownEvidence.receipt} : {})});
        if (sent && requestId && !terminal) { try { await nativeScanImportWait(options.afterResult(phase,{requestId,outcome:'unknown'}),controller.signal); } catch { /* Private journal failure also holds. */ } }
        need(requestId); return Object.freeze({outcome:'unknown',phase,requestId});
      } finally { clearTimeout(timer); stop(); outer.removeEventListener('abort',forward); controller.abort(); busy = false; }
    },
    isHeld: () => held,
    dispose() { disposed = true; original.dispose(); evidence.dispose(); binding = null; },
  };
}
