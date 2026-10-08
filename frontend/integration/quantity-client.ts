import type { SourceRef } from '../src/api/generated/contracts';
import { assertQuantityInput, equalQuantityJson, decodeQuantityApproval, decodeQuantityAvailability, decodeQuantityPreview, decodeQuantityResult, QuantityActionError, sameQuantityScope, type QuantityClient, type QuantityPrepared, type QuantitySessionBinding, type QuantityApproval } from '../src/api/quantity-client';

export interface QuantityClientOptions {
  getSessionBinding: () => QuantitySessionBinding | null;
  /** Actual host session/context replacement notifications; required. */
  subscribeSessionBinding: (changed: () => void) => () => void;
  transport?: typeof fetch;
}
const root = '/api/atlas/homebox/quantity';
const freeze = <T,>(value: T): T => { if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); } return value; };
/** Private custody data only; grants no proof, approval or reconciliation authority. */
interface DispatchCustody { readonly prepared: QuantityPrepared; readonly approval: QuantityApproval | null }
interface UnknownAttempt extends DispatchCustody { readonly action: string; readonly source: SourceRef; readonly binding: QuantitySessionBinding; readonly at: number; readonly status: number | null }
const dispatchUnconfirmed = 'Prior dispatch outcome unconfirmed. The quantity change may have been admitted or applied. Further quantity mutations for this source are held in this session; do not infer failure, rollback or safe retry.';
export function createQuantityClient(options: QuantityClientOptions): QuantityClient {
  const transport = options.transport ?? globalThis.fetch;
  let publicOwner: QuantitySessionBinding | null = null, publicIdentity: object = {};
  const subscribe = (changed: () => void) => {
    let timer: ReturnType<typeof setTimeout> | undefined, disposed = false;
    const schedule = () => {
      if (timer !== undefined) clearTimeout(timer);
      const binding = options.getSessionBinding();
      if (!binding || disposed) return;
      const remaining = Date.parse(binding.session.expiresAt) - Date.now();
      if (!Number.isFinite(remaining)) return;
      timer = setTimeout(() => { if (disposed) return; changed(); if (remaining > 2147483647) schedule(); }, Math.max(0, Math.min(remaining, 2147483647)));
    };
    const unsubscribe = options.subscribeSessionBinding(() => { changed(); schedule(); });
    schedule(); return () => { disposed = true; if (timer !== undefined) clearTimeout(timer); unsubscribe(); };
  };
  const getPublicIdentity = () => {
    const binding = options.getSessionBinding();
    if (!binding || !isCurrent(binding)) return null;
    if (!publicOwner || !isCurrent(publicOwner)) {
      publicOwner = { identity: binding.identity, scope: { ...binding.scope }, session: { ...binding.session } };
      publicIdentity = {};
    }
    return publicIdentity;
  };
  const preparedOwners = new WeakMap<QuantityPrepared, QuantitySessionBinding>(), approvals = new WeakMap<QuantityApproval, QuantityPrepared>();
  const spentApproval = new WeakSet<QuantityPrepared>(), spentDispatch = new WeakSet<QuantityPrepared>();
  const isCurrent = (binding: QuantitySessionBinding) => {
    const now = options.getSessionBinding();
    return !!now && now.identity === binding.identity && sameQuantityScope(now.scope, binding.scope)
      && now.session.actorId === binding.session.actorId && now.session.csrfToken === binding.session.csrfToken
      && now.session.expiresAt === binding.session.expiresAt && Date.parse(now.session.expiresAt) > Date.now();
  };
  const current = (source: SourceRef) => {
    const original = options.getSessionBinding();
    if (!original || !isCurrent(original) || !sameQuantityScope(original.scope, source)) throw new QuantityActionError('expired', 'Session');
    return { identity: original.identity, scope: { ...original.scope }, session: { ...original.session } };
  };
  // Strong private references; every matching unknown attempt is retained.
  const unknownPosts: Array<{ source: SourceRef; binding: QuantitySessionBinding; message: string; attempts: UnknownAttempt[] }> = [];
  const sameBinding = (a: QuantitySessionBinding, b: QuantitySessionBinding) => a.identity === b.identity
    && sameQuantityScope(a.scope, b.scope) && a.session.actorId === b.session.actorId
    && a.session.csrfToken === b.session.csrfToken && a.session.expiresAt === b.session.expiresAt;
  const getUncertainty = (source: SourceRef) => {
    const binding = options.getSessionBinding();
    if (!binding || !isCurrent(binding) || !sameQuantityScope(binding.scope, source)) return null;
    return unknownPosts.find(row => sameBinding(row.binding, binding) && equalQuantityJson(row.source, source))?.message ?? null;
  };
  const unknown = (source: SourceRef, binding: QuantitySessionBinding, action: string, custody?: DispatchCustody, status: number | null = null) => {
    let row = unknownPosts.find(row => sameBinding(row.binding, binding) && equalQuantityJson(row.source, source));
    if (!row) {
      row = { source: structuredClone(source), binding, message: `Prior ${action} response unavailable. Issuance or admission may have occurred. Further quantity mutations for this source are held in this session; do not infer rollback or safe retry.`, attempts: [] };
      unknownPosts.push(row);
    }
    if (custody) {
      row.attempts.push(Object.freeze({ action, source, binding, prepared: custody.prepared, approval: custody.approval, at: Date.now(), status }));
      if (action === 'dispatch') row.message = dispatchUnconfirmed;
    }
    return new QuantityActionError('unknown', action);
  };
  const holdUnknown = (source: SourceRef) => { if (getUncertainty(source)) throw new QuantityActionError('unknown', 'Prior quantity action'); };
  const check = (prepared: QuantityPrepared) => {
    if (!preparedOwners.has(prepared) || !isCurrent(preparedOwners.get(prepared)!)) throw new QuantityActionError('expired', 'Session');
    if (performance.now() >= prepared.expiresAt) throw new QuantityActionError('changed', 'Preview expired');
  };
  async function request(action: string, binding: QuantitySessionBinding, signal: AbortSignal, body?: object, query = '', originalSource?: SourceRef, custody?: DispatchCustody) {
    if (!isCurrent(binding)) throw new QuantityActionError('expired', 'Session');
    const controller = new AbortController();
    const abort = () => controller.abort(); signal.addEventListener('abort', abort, { once: true });
    const unsubscribe = subscribe(() => { if (!isCurrent(binding)) controller.abort(); });
    let posted = false, status: number | null = null;
    try {
      signal.throwIfAborted(); if (!isCurrent(binding)) throw new QuantityActionError('expired', 'Session');
      const raw = body ? JSON.stringify(body) : undefined;
      if (raw && new TextEncoder().encode(raw).length > (action === 'preview' ? 16384 : 4096)) throw new TypeError('Quantity request exceeds transport bound');
      posted = !!body;
      const response = await transport(`${root}/${action}${query}`, { method: body ? 'POST' : 'GET', credentials: 'same-origin', cache: 'no-store', redirect: 'error', signal: controller.signal,
        headers: { Accept: 'application/json', ...(body ? { 'Content-Type': 'application/json', 'X-Atlas-CSRF': binding.session.csrfToken } : {}) }, ...(raw ? { body: raw } : {}) });
      status = response.status;
      controller.signal.throwIfAborted();
      if (!isCurrent(binding)) throw new QuantityActionError('expired', 'Session');
      // Posted dispatch 503 may be overloaded before or after native admission: outcome unconfirmed.
      if (!response.ok) throw new QuantityActionError(posted && action === 'dispatch' && response.status === 503 ? 'unknown' : ({401:'expired',403:'denied',404:'absent',409:'changed',503:'unavailable'} as const)[response.status as 401] ?? 'unknown', action);
      const reader = response.body?.getReader(); if (!reader) throw new TypeError('Quantity response missing');
      const chunks: Uint8Array[] = []; let length = 0;
      while (true) { const next = await reader.read(); controller.signal.throwIfAborted(); if (next.done) break; length += next.value.byteLength; if (length > 1048576) { await reader.cancel(); throw new TypeError('Quantity response exceeds bound'); } chunks.push(next.value); }
      const bytes = new Uint8Array(length); let offset = 0; for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
      if (!isCurrent(binding)) throw new QuantityActionError('expired', 'Session');
      return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) as unknown;
    } catch (error) {
      if (posted && originalSource && (!(error instanceof QuantityActionError) || error.state === 'unknown' || controller.signal.aborted || !isCurrent(binding))) throw unknown(originalSource, binding, action, custody, status);
      if (error instanceof QuantityActionError && !controller.signal.aborted) throw error;
      if (posted) throw new QuantityActionError('unknown', action);
      throw error;
    } finally { unsubscribe(); signal.removeEventListener('abort', abort); }
  }
  return {
    getBindingIdentity: getPublicIdentity,
    getUncertainty,
    subscribeSessionBinding: subscribe,
    isCurrent: identity => getPublicIdentity() === identity,
    isCurrentPrepared: prepared => { const binding = preparedOwners.get(prepared); return !!binding && isCurrent(binding); },
    async checkAvailability(source, signal) {
      assertQuantityInput(source, 0, 'Availability'); const original = structuredClone(source), binding = current(original);
      const query = new URLSearchParams({ workspaceId: original.workspaceId, homeId: original.homeId, sourceInstanceId: original.key.sourceInstanceId, collectionId: original.key.collectionId, externalId: original.key.externalId });
      if (query.toString().length > 65536) throw new TypeError('Quantity source exceeds transport bound');
      return decodeQuantityAvailability(await request('availability', binding, signal, undefined, `?${query}`), original);
    },
    async preview(source, quantity, reason, signal) {
      assertQuantityInput(source, quantity, reason); holdUnknown(source); const original = structuredClone(source), binding = current(original), start = performance.now();
      const raw = await request('preview', binding, signal, { source: original, quantity, reason }, '', original);
      try {
        const wire = await decodeQuantityPreview(raw, original, quantity, reason); signal.throwIfAborted();
        if (!isCurrent(binding)) throw new QuantityActionError('expired', 'Session');
        const prepared = Object.freeze({ wire: freeze(wire), bindingIdentity: getPublicIdentity()!, expiresAt: start + wire.lifetime.remainingMs }); preparedOwners.set(prepared, binding); check(prepared); return prepared;
      } catch { throw unknown(original, binding, 'preview'); }
    },
    async approve(prepared, signal) {
      check(prepared); holdUnknown(prepared.wire.source); if (prepared.wire.policy.approval !== 'human-required' || spentApproval.has(prepared)) throw new TypeError('Approval action unavailable');
      spentApproval.add(prepared); const p = prepared.wire;
      const raw = await request('approval', preparedOwners.get(prepared)!, signal, { previewId: p.previewId, requestDigest: p.requestDigest, planDigest: p.planDigest, policyId: p.policy.id, policyVersion: p.policy.version, policyEpoch: p.policy.epoch, acknowledgement: true }, '', p.source);
      try { check(prepared); const receipt = freeze(decodeQuantityApproval(raw, p)); approvals.set(receipt, prepared); return receipt; } catch { throw unknown(p.source, preparedOwners.get(prepared)!, 'approval'); }
    },
    async dispatch(prepared, approval, signal) {
      check(prepared); holdUnknown(prepared.wire.source); const p = prepared.wire;
      if (spentDispatch.has(prepared) || (p.policy.approval === 'human-required' ? !approval || approvals.get(approval) !== prepared : approval !== null)) throw new TypeError('Dispatch action unavailable');
      spentDispatch.add(prepared);
      const custody: DispatchCustody = Object.freeze({ prepared, approval });
      const raw = await request('dispatch', preparedOwners.get(prepared)!, signal, { previewId: p.previewId, requestDigest: p.requestDigest, planDigest: p.planDigest, approvalReceiptId: approval?.approvalReceiptId ?? null }, '', p.source, custody);
      try { if (!isCurrent(preparedOwners.get(prepared)!)) throw new Error('Session changed'); return freeze(decodeQuantityResult(raw, p)); } catch { throw unknown(p.source, preparedOwners.get(prepared)!, 'dispatch', custody); }
    },
  };
}
