/** Informational account-only read of the host's stored AI credential record.
 * Reads are explicit; the session allocation stays private to this client. */
import { decodeConnectionSnapshot } from './decode.js';
import type { ConnectionSnapshot } from '../types.js';
import type { AtlasSessionInfo } from '../../app/session.js';
import type { Scope } from '../../app/types.js';

/** Identity of one actual session allocation and completed view scope. It
 * carries no session token; only reference equality is meaningful. */
export interface AccountObservationBinding {
  readonly scope: Readonly<Scope>;
}
/** Stored, previously validated subject; never a workspace, grant or credential. */
export interface AccountIdentity {
  readonly accountId: string;
  readonly label: string;
}
/** observedAt timestamps the host's local record read, never provider freshness. */
export interface AccountObservation {
  readonly accountIdentity: AccountIdentity | null;
  readonly connection: ConnectionSnapshot;
  readonly observedAt: string;
}
export type AccountRead =
  | { readonly status: 'observed'; readonly observation: AccountObservation }
  | { readonly status: 'denied' }
  | { readonly status: 'unavailable' };
export interface AccountObservationClient {
  getBinding(): AccountObservationBinding | null;
  subscribe(changed: () => void): () => void;
  read(binding: AccountObservationBinding, signal: AbortSignal): Promise<AccountRead>;
}

const responseLimit = 65536;
const denied: AccountRead = { status: 'denied' };
const unavailable: AccountRead = { status: 'unavailable' };
const encoder = new TextEncoder();

function object(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value))
    throw new TypeError('Invalid AI account object');
  const row = value as Record<string, unknown>;
  if (Object.keys(row).length !== keys.length || keys.some(key => !Object.hasOwn(row, key)))
    throw new TypeError('Invalid AI account fields');
  return row;
}
function text(value: unknown): string {
  if (typeof value !== 'string') throw new TypeError('Invalid AI account string');
  return value;
}
function accountIdentity(value: unknown): AccountIdentity | null {
  if (value === null) return null;
  const row = object(value, ['accountId', 'label']);
  const accountId = text(row['accountId']), label = text(row['label']);
  // Mirrors the host subject filter: non-empty, bounded, no Cc characters.
  if (accountId.length === 0 || encoder.encode(accountId).length > 1024
    || /\p{Cc}/u.test(accountId) || /[\uD800-\uDFFF]/u.test(accountId))
    throw new TypeError('Invalid AI account subject');
  // Application display metadata; an empty label is retained as data.
  if (encoder.encode(label).length > 256 || /[\uD800-\uDFFF]/u.test(label))
    throw new TypeError('Invalid AI account label');
  return { accountId, label };
}
/** Exact host RFC 3339 output: UTC 'Z', millisecond precision, trailing zeros
 * trimmed. Retained verbatim; never parsed into a Date. */
function observedAt(value: unknown): string {
  const stamp = text(value);
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{0,2}[1-9])?Z$/u.exec(stamp);
  if (!match) throw new TypeError('Invalid AI account timestamp');
  const year = Number(match[1]), month = Number(match[2]), day = Number(match[3]);
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (month < 1 || month > 12 || day < 1 || day > (days[month - 1] ?? 0)
    || Number(match[4]) > 23 || Number(match[5]) > 59 || Number(match[6]) > 59)
    throw new TypeError('Invalid AI account timestamp');
  return stamp;
}

/** Exact native account DTO. The shared snapshot's workspace display stays null. */
export function decodeAccountObservation(value: unknown): AccountObservation {
  const row = object(value, ['accountIdentity', 'connection', 'observedAt']);
  const identity = accountIdentity(row['accountIdentity']);
  const connection = decodeConnectionSnapshot(row['connection']);
  if (connection.account !== null) throw new TypeError('Unexpected AI account workspace display');
  if (identity !== null && connection.authorization === 'unconfigured')
    throw new TypeError('Invalid AI account authorization');
  return { accountIdentity: identity, connection, observedAt: observedAt(row['observedAt']) };
}

function discard(response: Response): void {
  void response.body?.cancel().catch(() => undefined);
}
/** Bounded byte read. Overflow and stream failure yield null; a stale binding
 * or abort cancels the stream and throws. The lock is always released. */
async function receive(body: ReadableStream<Uint8Array>, assertCurrent: () => void): Promise<Uint8Array | null> {
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let received = 0;
  try {
    for (;;) {
      const chunk = await reader.read().catch(() => null);
      assertCurrent();
      if (chunk === null) return null;
      if (chunk.done) break;
      received += chunk.value.byteLength;
      if (received > responseLimit) {
        void reader.cancel().catch(() => undefined);
        return null;
      }
      chunks.push(chunk.value);
    }
  } catch (error) {
    void reader.cancel().catch(() => undefined);
    throw error;
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(received);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return bytes;
}

export function createAccountObservationClient(options: {
  readonly getSessionBinding: () => { readonly session: AtlasSessionInfo; readonly scope: Scope } | null;
  readonly subscribeSessionBinding: (changed: () => void) => () => void;
  readonly fetch?: typeof fetch;
}): AccountObservationClient {
  const request = options.fetch ?? ((...args: Parameters<typeof fetch>) => fetch(...args));
  let cached: { readonly session: AtlasSessionInfo; readonly scope: Scope; readonly binding: AccountObservationBinding } | null = null;
  // Stable while both the session allocation and the scope reference persist.
  function getBinding(): AccountObservationBinding | null {
    const next = options.getSessionBinding();
    if (!next) { cached = null; return null; }
    if (!cached || cached.session !== next.session || cached.scope !== next.scope)
      cached = { session: next.session, scope: next.scope, binding: Object.freeze({
        scope: Object.freeze({ workspaceId: next.scope.workspaceId, homeId: next.scope.homeId }),
      }) };
    return cached.binding;
  }
  async function read(binding: AccountObservationBinding, signal: AbortSignal): Promise<AccountRead> {
    const assertCurrent = () => {
      signal.throwIfAborted();
      if (getBinding() !== binding) throw new Error('AI account binding changed');
    };
    assertCurrent();
    const { workspaceId, homeId } = binding.scope;
    let response: Response;
    try {
      response = await request(`/api/atlas/v1/workspaces/${encodeURIComponent(workspaceId)}/homes/${encodeURIComponent(homeId)}/ai/account`, {
        method: 'GET', credentials: 'same-origin', cache: 'no-store', redirect: 'error', signal,
        headers: { Accept: 'application/json' },
      });
    } catch (error) {
      if (signal.aborted) throw error;
      return unavailable;
    }
    try { assertCurrent(); } catch (error) { discard(response); throw error; }
    // The host collapses every cause; nothing beyond denial is inferred here.
    if (response.status === 401 || response.status === 403) { discard(response); return denied; }
    if (response.status !== 200 || !response.body
      || Number(response.headers.get('Content-Length')) > responseLimit) { discard(response); return unavailable; }
    const bytes = await receive(response.body, assertCurrent);
    if (!bytes) return unavailable;
    let value: unknown;
    try { value = JSON.parse(new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes)); } catch { return unavailable; }
    assertCurrent();
    try { return { status: 'observed', observation: decodeAccountObservation(value) }; } catch { return unavailable; }
  }
  return { getBinding, subscribe: changed => options.subscribeSessionBinding(changed), read };
}
