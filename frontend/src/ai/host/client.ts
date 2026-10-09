import { bindAiLifecyclePort } from '../wire.js';
import type { AiLifecycleWirePort } from '../wire.js';
import { AiModelsUnauthorizedError } from '../types.js';
import type { AiClient, ReviewInput } from '../types.js';
import { decodeCancelReceipt, decodeConnectionSnapshot, decodeModelDiscovery, decodeRequestStatus, decodeRunOutcome } from './decode.js';

// Local settlement covers headers and body, not server cancellation or retry safety.
const readTimeoutMs = 15_000;
class ReadDeadline extends Error {}
function discard(response: Response) { void response.body?.cancel().catch(() => undefined); }
async function withReadDeadline<T>(outer: AbortSignal, exchange: (signal: AbortSignal) => Promise<T>): Promise<T> {
  outer.throwIfAborted();
  const controller = new AbortController();
  const forward = () => controller.abort(outer.reason);
  let reject!: (reason: unknown) => void;
  const stopped = new Promise<never>((_, no) => { reject = no; });
  const abort = () => reject(controller.signal.reason);
  controller.signal.addEventListener('abort', abort, { once: true });
  outer.addEventListener('abort', forward, { once: true });
  const timer = setTimeout(() => controller.abort(new ReadDeadline('Response unavailable after local deadline')), readTimeoutMs);
  try {
    const value = await Promise.race([exchange(controller.signal), stopped]);
    controller.signal.throwIfAborted();
    return value;
  } finally {
    clearTimeout(timer);
    outer.removeEventListener('abort', forward);
    controller.signal.removeEventListener('abort', abort);
  }
}
async function receive(response: Response, signal: AbortSignal): Promise<unknown> {
  const reader = response.body?.getReader();
  if (!reader) throw new TypeError('Response body missing');
  const cancel = () => { void reader.cancel().catch(() => undefined); };
  signal.addEventListener('abort', cancel, { once: true });
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    for (;;) {
      signal.throwIfAborted();
      const part = await reader.read();
      signal.throwIfAborted();
      if (part.done) break;
      length += part.value.byteLength;
      chunks.push(part.value);
    }
    const bytes = new Uint8Array(length);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    return JSON.parse(new TextDecoder().decode(bytes)) as unknown;
  } catch (error) { cancel(); throw error; }
  finally { signal.removeEventListener('abort', cancel); reader.releaseLock(); }
}

/** Every operation is already bound to the server's current actor/home/provider. */
export interface AiHostWirePort extends AiLifecycleWirePort {
  models?(signal: AbortSignal): Promise<unknown>;
  connection(signal: AbortSignal): Promise<unknown>;
  run(input: { readonly requestId: string; readonly prompt: string }, signal: AbortSignal): Promise<unknown>;
  cancel(requestId: string): Promise<unknown>;
  resume(input: ReviewInput, signal: AbortSignal): Promise<unknown>;
  requestStatus(requestId: string, signal: AbortSignal): Promise<unknown>;
}

/** No readiness policy, authority, approval receipt or retry is added here. */
export function bindAiHostPort(port: AiHostWirePort): AiClient {
  return {
    ...bindAiLifecyclePort(port),
    ...(port.models ? { models: async (signal: AbortSignal) => decodeModelDiscovery(await port.models!(signal)) } : {}),
    async connection(signal) { return decodeConnectionSnapshot(await port.connection(signal)); },
    async run(input, signal) { return decodeRunOutcome(await port.run(input, signal)); },
    async cancel(requestId) { return decodeCancelReceipt(await port.cancel(requestId), requestId); },
    async resume(input, signal) { return decodeRunOutcome(await port.resume(input, signal)); },
    async requestStatus(requestId, signal) { return decodeRequestStatus(await port.requestStatus(requestId, signal), requestId); },
  };
}

/** URLs must be explicitly supplied by the integrator after Rust route agreement. */
export interface AiHostEndpoints {
  readonly models?: string;
  readonly connection: string;
  readonly connectionAction: string;
  readonly connectionActionStatus: (actionId: string) => string;
  readonly run: string;
  readonly cancel: (requestId: string) => string;
  readonly openReview: string;
  readonly resume: string;
  readonly requestStatus: (requestId: string) => string;
}
export interface AiHostHttpOptions {
  readonly endpoints: AiHostEndpoints;
  /** Actual current application-session nonce. Never a provider credential. */
  readonly mutationHeaders: (signal: AbortSignal) => Promise<Readonly<Record<string, string>>>;
  /** Explicit synthetic transport is supported for healthy composition checks. */
  readonly fetch?: typeof globalThis.fetch;
}

function localPath(path: string): string {
  if (!path.startsWith('/') || path.startsWith('//') || /[\\\s#]/u.test(path))
    throw new TypeError('AI host requires a same-origin absolute path');
  return path;
}

/** Same-origin, cookie-authenticated host JSON. HTTP failure means uncertainty;
 * only decoded RunOutcome carries authoritative completion/error information. */
export function createAiHostClient(options: AiHostHttpOptions): AiClient {
  const transport = options.fetch ?? globalThis.fetch;
  const endpoints = { ...options.endpoints };
  async function request(path: string, signal: AbortSignal, body?: unknown, modelsRead = false, cancelConfirmation = false): Promise<unknown> {
    const url = localPath(path);
    const headers = new Headers(body === undefined ? undefined : await options.mutationHeaders(signal));
    headers.set('Accept', 'application/json');
    if (body !== undefined) headers.set('Content-Type', 'application/json');
    signal.throwIfAborted();
    const response = await transport(url, {
      method: body === undefined ? 'GET' : 'POST',
      credentials: 'same-origin', cache: 'no-store', redirect: 'error', signal, headers,
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    if (signal.aborted) { discard(response); signal.throwIfAborted(); }
    if (!response.ok) discard(response);
    if (modelsRead && (response.status === 401 || response.status === 403)) throw new AiModelsUnauthorizedError(response.status);
    if (!response.ok) throw new Error('AI host response is unavailable');
    const value: unknown = cancelConfirmation ? await receive(response, signal) : await response.json();
    signal.throwIfAborted();
    return value;
  }
  return bindAiHostPort({
    ...(endpoints.models === undefined ? {} : { models: (signal: AbortSignal) => request(endpoints.models!, signal, undefined, true) }),
    connection: signal => request(endpoints.connection, signal),
    connectionAction: (input, signal) => request(endpoints.connectionAction, signal, input),
    connectionActionStatus: (actionId, signal) => request(endpoints.connectionActionStatus(actionId), signal),
    run: (input, signal) => request(endpoints.run, signal, input),
    // The donor deliberately separates cancellation from the result's AbortSignal.
    cancel: requestId => withReadDeadline(new AbortController().signal, signal => request(endpoints.cancel(requestId), signal, { requestId }, false, true)),
    openReview: (input, signal) => request(endpoints.openReview, signal, input),
    resume: (input, signal) => request(endpoints.resume, signal, input),
    requestStatus: (requestId, signal) => request(endpoints.requestStatus(requestId), signal),
  });
}
