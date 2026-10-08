import type { AtlasSessionInfo } from '../src/app/session';
import type { Scope } from '../src/app/types';
import {
  buildPinnedFileRequest,
  decodePinnedArtifact,
  decodePinnedAvailability,
  decodePinnedDiscovery,
  isPinnedUuid,
  pinnedAttemptKey,
  pinnedCapturable,
  pinnedCaptureQuery,
  samePinnedSource,
  PinnedFileError,
  type PinnedFileAvailability,
  type PinnedFileCapture,
  type PinnedFileClient,
  type PinnedFileDiscovery,
  type PinnedFileOffer,
  type PinnedFileSessionBinding,
  type PinnedFileUnknownRecord,
  type PinnedSourceRef,
} from '../src/api/pinned-file-client';

export interface PinnedFileClientOptions {
  getSessionBinding: () => PinnedFileSessionBinding | null;
  /** Actual host session/context replacement notifications; required. */
  subscribeSessionBinding: (changed: () => void) => () => void;
  transport?: typeof fetch;
}
/** Private custody of one actual binding; replaced, never reused, on change. */
interface Owner {
  readonly session: AtlasSessionInfo;
  readonly scope: Scope;
  readonly values: Readonly<Scope>;
  readonly identity: object;
}
interface Observed { sent: boolean; status: number | null }
type NoOffer = Extract<PinnedFileAvailability, { state: 'none' }>['observed'];
const MAX_TIMER = 2_147_483_647;
const stockRoot = (scope: Readonly<Scope>) =>
  `/api/atlas/stock/v3/workspaces/${encodeURIComponent(scope.workspaceId)}/homes/${encodeURIComponent(scope.homeId)}`;
const mediaHref = (scope: Readonly<Scope>, token: string) =>
  `/api/atlas/media/pinned-homebox/${encodeURIComponent(scope.workspaceId)}/${encodeURIComponent(scope.homeId)}/${encodeURIComponent(token)}`;

async function readJson(response: Response, limit: number, signal: AbortSignal): Promise<unknown> {
  const reader = response.body?.getReader();
  if (!reader) throw new TypeError('Response body missing');
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    for (;;) {
      const next = await reader.read();
      signal.throwIfAborted();
      if (next.done) break;
      length += next.value.byteLength;
      if (length > limit) throw new TypeError('Response exceeds bound');
      chunks.push(next.value);
    }
  } catch (error) {
    await reader.cancel().catch(() => undefined);
    throw error;
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) as unknown;
}

/** Local HomeBox file consumer. Discovery is informational, capture is one
 * explicit new read, and Media availability is display data. No result here is
 * a grant, proof of delivery, provider version or current remote claim. */
export function createPinnedFileClient(options: PinnedFileClientOptions): PinnedFileClient {
  const transport = options.transport ?? globalThis.fetch;
  let owner: Owner | null = null;
  const live = (session: AtlasSessionInfo) => {
    const expiry = Date.parse(session.expiresAt);
    return Number.isFinite(expiry) && expiry > Date.now();
  };
  // Stable only while the same session allocation, the same scope object and an
  // unexpired session are observed; any observed gap discards the identity.
  const currentOwner = (): Owner | null => {
    const binding = options.getSessionBinding();
    if (!binding || !live(binding.session)) { owner = null; return null; }
    if (!owner || owner.session !== binding.session || owner.scope !== binding.scope)
      owner = Object.freeze({
        session: binding.session,
        scope: binding.scope,
        values: Object.freeze({ workspaceId: binding.scope.workspaceId, homeId: binding.scope.homeId }),
        identity: Object.freeze({}),
      });
    return owner;
  };
  const isCurrent = (candidate: Owner) => currentOwner() === candidate;
  // Client-lifetime observer, so every host gap is seen without mounted readers.
  options.subscribeSessionBinding(() => { currentOwner(); });
  const subscribeSessionBinding = (changed: () => void) => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    let disposed = false;
    const schedule = () => {
      if (timer !== undefined) clearTimeout(timer);
      timer = undefined;
      const binding = options.getSessionBinding();
      if (disposed || !binding) return;
      const remaining = Date.parse(binding.session.expiresAt) - Date.now();
      if (!Number.isFinite(remaining) || remaining <= 0) return;
      timer = setTimeout(() => {
        timer = undefined;
        if (disposed) return;
        currentOwner();
        changed();
        if (remaining > MAX_TIMER) schedule();
      }, Math.min(remaining + 1, MAX_TIMER));
    };
    const unsubscribe = options.subscribeSessionBinding(() => { currentOwner(); changed(); schedule(); });
    schedule();
    return () => { disposed = true; if (timer !== undefined) clearTimeout(timer); unsubscribe(); };
  };

  // Unknown capture outcomes per actual session allocation and exact source;
  // the source key carries the scope values, so a same-home view reload keeps
  // the hold. Shown only through the current binding identity.
  const unknownRows = new WeakMap<AtlasSessionInfo, Map<string, PinnedFileUnknownRecord>>();
  const unknownListeners = new Set<() => void>();
  const recordUnknown = (found: Owner, key: string, status: number | null) => {
    let rows = unknownRows.get(found.session);
    if (!rows) { rows = new Map(); unknownRows.set(found.session, rows); }
    const prior = rows.get(key);
    rows.set(key, Object.freeze({ statuses: Object.freeze([...(prior?.statuses ?? []), status]) }));
    // Recorded first; a throwing listener cannot skip the record or replace the error.
    for (const changed of [...unknownListeners]) try { changed(); } catch (error) { queueMicrotask(() => { throw error; }); }
  };
  const getUnknown = (identity: object, source: PinnedSourceRef, attachmentId: string): PinnedFileUnknownRecord | null => {
    const found = currentOwner();
    if (!found || found.identity !== identity || source.workspaceId !== found.values.workspaceId || source.homeId !== found.values.homeId) return null;
    return unknownRows.get(found.session)?.get(pinnedAttemptKey(source, attachmentId)) ?? null;
  };
  const subscribeUnknown = (changed: () => void) => {
    unknownListeners.add(changed);
    return () => { unknownListeners.delete(changed); };
  };

  const exchange = async (found: Owner, url: string, limit: number, signal: AbortSignal, observed: Observed): Promise<unknown> => {
    const controller = new AbortController();
    const abort = () => controller.abort();
    signal.addEventListener('abort', abort, { once: true });
    if (signal.aborted) abort();
    const unsubscribe = subscribeSessionBinding(() => { if (!isCurrent(found)) controller.abort(); });
    try {
      controller.signal.throwIfAborted();
      if (!isCurrent(found)) throw new TypeError('Session or home changed');
      observed.sent = true;
      const response = await transport(url, {
        method: 'GET', credentials: 'same-origin', cache: 'no-store', redirect: 'error',
        headers: { Accept: 'application/json' }, signal: controller.signal,
      });
      observed.status = response.status;
      controller.signal.throwIfAborted();
      if (!response.ok) {
        await response.body?.cancel().catch(() => undefined);
        throw new TypeError('Response status not usable');
      }
      const value = await readJson(response, limit, controller.signal);
      if (!isCurrent(found)) throw new TypeError('Session or home changed');
      return value;
    } finally {
      unsubscribe();
      signal.removeEventListener('abort', abort);
    }
  };

  const discoveries = new WeakMap<PinnedFileDiscovery, Owner>();
  const discover = async (identity: object, signal: AbortSignal): Promise<PinnedFileDiscovery> => {
    const found = currentOwner();
    if (!found || found.identity !== identity || !isPinnedUuid(found.values.workspaceId) || !isPinnedUuid(found.values.homeId))
      throw new PinnedFileError('unavailable', 'discovery', null, false);
    const observed: Observed = { sent: false, status: null };
    try {
      const raw = await exchange(found, `${stockRoot(found.values)}/homebox-pinned-file-admission`, 65_536, signal, observed);
      const discovery = decodePinnedDiscovery(raw, found.values);
      if (!isCurrent(found)) throw new TypeError('Session or home changed');
      discoveries.set(discovery, found);
      return discovery;
    } catch (error) {
      if (signal.aborted) throw error;
      throw new PinnedFileError('unavailable', 'discovery', observed.status, observed.sent);
    }
  };

  let capturing = false;
  const captures = new WeakMap<PinnedFileCapture, { readonly owner: Owner; readonly token: string }>();
  const resolved = new WeakSet<PinnedFileCapture>();
  const prepare = (source: PinnedSourceRef, attachmentId: string) => {
    try {
      // A fresh requestId only for this genuinely new read; never derived or reused.
      const request = buildPinnedFileRequest(source, attachmentId, crypto.randomUUID());
      return { request, url: `${stockRoot(request.context)}/homebox-pinned-file${pinnedCaptureQuery(request)}` };
    } catch {
      return null;
    }
  };
  const capture = async (discovery: PinnedFileDiscovery, source: PinnedSourceRef, attachmentId: string, signal: AbortSignal): Promise<PinnedFileCapture> => {
    const found = discoveries.get(discovery);
    // The admitted full reference itself, matched exactly; no substitution or remapping.
    const original = discovery.installedSources.find((row) => samePinnedSource(row, source));
    if (!found || !isCurrent(found) || !original || !pinnedCapturable(original, attachmentId) || capturing || signal.aborted)
      throw new PinnedFileError('unavailable', 'capture', null, false);
    const prepared = prepare(original, attachmentId);
    if (!prepared) throw new PinnedFileError('unavailable', 'capture', null, false);
    capturing = true;
    const observed: Observed = { sent: false, status: null };
    try {
      const decoded = decodePinnedArtifact(await exchange(found, prepared.url, 65_536, signal, observed), prepared.request);
      if (!isCurrent(found)) throw new TypeError('Session or home changed');
      const result: PinnedFileCapture = Object.freeze({ source: original, attachmentId, request: prepared.request, artifact: decoded.facts });
      captures.set(result, Object.freeze({ owner: found, token: decoded.downloadToken }));
      return result;
    } catch (error) {
      if (!observed.sent) {
        if (signal.aborted) throw error;
        throw new PinnedFileError('unavailable', 'capture', null, false);
      }
      // Once sent, every status, body, network, abort, decode or correlation
      // failure may follow issuance without delivery. The status is preserved.
      recordUnknown(found, pinnedAttemptKey(original, attachmentId), observed.status);
      throw new PinnedFileError('unknown', 'capture', observed.status, true);
    } finally {
      capturing = false;
    }
  };

  const offers = new WeakMap<PinnedFileOffer, Owner>();
  const none = (observed: NoOffer, status: number | null): PinnedFileAvailability => Object.freeze({ state: 'none', observed, status });
  const resolve = async (captured: PinnedFileCapture, signal: AbortSignal): Promise<PinnedFileAvailability> => {
    const custody = captures.get(captured);
    if (!custody || resolved.has(captured) || !isCurrent(custody.owner) || signal.aborted) return none('refused', null);
    resolved.add(captured);
    const href = mediaHref(captured.request.context, custody.token);
    const observed: Observed = { sent: false, status: null };
    // Anchor the server's floored budget at the START of this call, never at receipt.
    const start = performance.now();
    try {
      const availability = decodePinnedAvailability(await exchange(custody.owner, `${href}/availability`, 1024, signal, observed));
      if (availability.state !== 'available') return none(availability.state, observed.status);
      const offer: PinnedFileOffer = Object.freeze({ href, remainingMs: availability.remainingMs, expiresAt: start + availability.remainingMs });
      if (!isCurrent(custody.owner) || performance.now() >= offer.expiresAt) return none('expired', observed.status);
      offers.set(offer, custody.owner);
      return Object.freeze({ state: 'offer', offer });
    } catch (error) {
      if (signal.aborted) throw error;
      return none('error', observed.status);
    }
  };
  const isOfferCurrent = (offer: PinnedFileOffer) => {
    const found = offers.get(offer);
    return !!found && isCurrent(found) && performance.now() < offer.expiresAt;
  };

  return Object.freeze({
    getBindingIdentity: () => currentOwner()?.identity ?? null,
    getBindingScope: (identity: object) => {
      const found = currentOwner();
      return found && found.identity === identity ? found.values : null;
    },
    subscribeSessionBinding,
    getUnknown,
    subscribeUnknown,
    discover,
    capture,
    resolve,
    isOfferCurrent,
  });
}
