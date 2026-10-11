import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import atlas from '../../../../packages/contracts/schemas/atlas.schema.json';
import type { Scope, SourceRef } from '../../api/generated/contracts';
import { assertQuantityInput, equalQuantityJson, QuantityActionError, sameQuantityScope, type QuantityApproval, type QuantityClient, type QuantityPrepared, type QuantityPreviewWire, type QuantityResult } from '../../api/quantity-client';
import { startWebMcp } from '../adapter.js';
import type { AuthenticatedSession, CatalogTool, InvocationContext, JsonObject, JsonValue, ModelContextPort, SessionPort, SessionSnapshot, VisibleResultPort, WebMcpHandle } from '../ports.js';

export const QUANTITY_TOOL_NAME = 'houseatlas_homebox_quantity_change_await_person';
const format = 'atlas-webmcp-homebox-quantity-human-change/1' as const;
const admissionLimit = 65536;

/** Server-owned HomeBox sources for one exact scope. The revision is informational, not authority. */
export interface QuantityToolAdmission {
  readonly revision: string;
  /** The quantity client's own opaque identity, attached locally by the host; never deserialized. */
  readonly bindingIdentity: object | string;
  readonly scope: Scope;
  readonly installedSources: readonly SourceRef[];
}
export type QuantityAdmissionRow = Omit<QuantityToolAdmission, 'bindingIdentity'>;
export interface QuantityAdmissionPort { getSnapshot(): QuantityToolAdmission | null; subscribe(changed: () => void): () => void }

export const quantityAdmissionUrl = (scope: Scope) =>
  `/api/atlas/stock/v3/workspaces/${encodeURIComponent(scope.workspaceId)}/homes/${encodeURIComponent(scope.homeId)}/quantity-tool-admission`;

const ajv = new Ajv2020({ strict: true, allErrors: true, allowUnionTypes: true });
addFormats(ajv); ajv.addSchema(atlas);
const admissionSchema = ajv.compile<{ schemaVersion: 1; scope: Scope; revision: string; installedSources: SourceRef[] }>({
  type: 'object', additionalProperties: false, required: ['schemaVersion', 'scope', 'revision', 'installedSources'],
  properties: {
    schemaVersion: { const: 1 },
    scope: { $ref: `${atlas.$id}#/$defs/scope` },
    revision: { type: 'string', minLength: 1, maxLength: 128 },
    installedSources: { type: 'array', maxItems: 64, items: { $ref: `${atlas.$id}#/$defs/sourceRef` } },
  },
});
const freeze = <T,>(value: T): T => { if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); } return value; };

/** Strict deny-extra decode; every source is a unique complete homebox-entity ref in the requested scope. */
export function decodeQuantityAdmissionRow(raw: unknown, scope: Scope): QuantityAdmissionRow | null {
  try {
    if (!admissionSchema(raw) || !sameQuantityScope(raw.scope, scope)) return null;
    const sources = raw.installedSources;
    for (const [index, source] of sources.entries()) {
      if (source.key.sourceKind !== 'homebox-entity' || !sameQuantityScope(source, scope)
        || sources.some((other, prior) => prior < index && equalQuantityJson(other, source))) return null;
    }
    return Object.freeze({
      revision: raw.revision,
      scope: Object.freeze({ workspaceId: raw.scope.workspaceId, homeId: raw.scope.homeId }),
      installedSources: Object.freeze(sources.map(source => freeze(structuredClone(source)))),
    });
  } catch { return null; }
}

/** Stream-bounded read; any oversize, encoding or shape failure is no admission. Abort rethrows. */
export async function readQuantityAdmission(response: Response, scope: Scope, signal: AbortSignal): Promise<QuantityAdmissionRow | null> {
  const reader = response.body?.getReader(); if (!reader) return null;
  const chunks: Uint8Array[] = []; let length = 0;
  while (true) {
    const next = await reader.read(); signal.throwIfAborted();
    if (next.done) break;
    length += next.value.byteLength;
    if (length > admissionLimit) { await reader.cancel(); return null; }
    chunks.push(next.value);
  }
  const bytes = new Uint8Array(length); let offset = 0; for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  let raw: unknown;
  try { raw = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); } catch { return null; }
  return decodeQuantityAdmissionRow(raw, scope);
}

/** The only client surface reachable from the agent path: no approve, no dispatch. */
export type AgentQuantityFacade = Pick<QuantityClient,
  'getBindingIdentity' | 'getUncertainty' | 'subscribeSessionBinding' | 'isCurrentPrepared' | 'checkAvailability' | 'preview'>;
export const agentFacade = (c: QuantityClient): AgentQuantityFacade => ({
  getBindingIdentity: () => c.getBindingIdentity(), getUncertainty: s => c.getUncertainty(s),
  subscribeSessionBinding: f => c.subscribeSessionBinding(f), isCurrentPrepared: p => c.isCurrentPrepared(p),
  checkAvailability: (s, g) => c.checkAvailability(s, g), preview: (s, q, r, g) => c.preview(s, q, r, g) });

type RefusedState = 'expired' | 'denied' | 'absent' | 'changed' | 'unavailable';
/** Derived only from the person attempt ledger; never a claim of who acted. */
export type QuantityHandoffEnded =
  | { readonly outcome: 'native-result'; readonly native: QuantityResult }
  | { readonly outcome: 'refused'; readonly step: 'approval' | 'submission'; readonly state: RefusedState; readonly message: string }
  | { readonly outcome: 'outcome-unknown'; readonly step: 'approval' | 'submission';
      readonly cause: 'response-unknown' | 'response-unvalidated' | 'in-flight-at-deadline' | 'invocation-ended';
      readonly message: string; readonly uncertainty: string | null }
  | { readonly outcome: 'ended-before-submission'; readonly cause: 'preview-deadline' | 'dismissed-by-person'; readonly submissionAttempt: 'none-started' };

export type QuantityToolOutput =
  | { readonly format: typeof format; readonly outcome: 'not-prepared';
      readonly state: 'handoff-active' | 'held' | RefusedState; readonly message: string; readonly uncertainty: string | null }
  | { readonly format: typeof format; readonly outcome: 'preview-outcome-unknown'; readonly message: string; readonly uncertainty: string | null }
  | { readonly format: typeof format; readonly outcome: 'person-handoff-ended';
      readonly preview: QuantityPreviewWire; readonly approval: QuantityApproval | null; readonly ended: QuantityHandoffEnded; readonly cachedQuantity: 'unchanged' };

export interface QuantityHandoffEnd { readonly approval: QuantityApproval | null; readonly ended: QuantityHandoffEnded }
export interface QuantityHandoffCustody { readonly prepared: QuantityPrepared; readonly approval: QuantityApproval | null; readonly native: QuantityResult | null }
/** One synchronously reserved workflow. Release only for a definitive pre-preview error or cancel. */
export interface QuantityHandoffReservation {
  release(): void;
  /** Preview outcome unknown: stays held while the client reports uncertainty for this source. */
  hold(source: SourceRef): void;
  /** prepared must be the exact object the facade preview resolved; never a clone or wire rebuild. */
  offer(prepared: QuantityPrepared, signal: AbortSignal): Promise<QuantityHandoffEnd>;
  custody(): QuantityHandoffCustody | null;
  acknowledge(): void;
  end(): void;
}
export interface AgentHandoffPort { reserve(): QuantityHandoffReservation | null }

const unavailable = () => new DOMException('Tool session is no longer current', 'InvalidStateError');
const signedOut: SessionSnapshot = { state: 'signed-out', revision: 'quantity-admission-absent' };
const sameJson = (a: unknown, b: unknown) => { try { return equalQuantityJson(a, b); } catch { return false; } };
const notPrepared = (state: 'handoff-active' | 'held' | RefusedState, message: string, uncertainty: string | null): QuantityToolOutput =>
  ({ format, outcome: 'not-prepared', state, message, uncertainty });
const ordinals = new WeakMap<object, number>(); let nextOrdinal = 0;
const ordinal = (value: object) => { let n = ordinals.get(value); if (n === undefined) { n = ++nextOrdinal; ordinals.set(value, n); } return n; };
const sourceDefs = JSON.parse(JSON.stringify({ sourceRef: atlas.$defs.sourceRef, sourceKey: atlas.$defs.sourceKey })) as JsonObject;
const inputSchemas = new WeakMap<QuantityToolAdmission, JsonObject>();
function inputSchemaFor(a: QuantityToolAdmission): JsonObject {
  let schema = inputSchemas.get(a);
  if (!schema) {
    schema = {
      type: 'object', additionalProperties: false, required: ['source', 'quantity', 'reason'], $defs: sourceDefs,
      properties: {
        source: { allOf: [{ $ref: '#/$defs/sourceRef' }], enum: JSON.parse(JSON.stringify(a.installedSources)) as JsonValue[] },
        quantity: { type: 'integer', minimum: 0, maximum: Number.MAX_SAFE_INTEGER },
        reason: { type: 'string', minLength: 1, maxLength: 2048, description: 'At most 2048 UTF-8 bytes.' },
      },
    };
    inputSchemas.set(a, schema);
  }
  return schema;
}

function quantityTool(a: QuantityToolAdmission, admission: QuantityAdmissionPort, facade: AgentQuantityFacade): CatalogTool {
  return {
    name: QUANTITY_TOOL_NAME,
    title: 'HomeBox quantity change for a person to approve',
    description: 'Prepare a HomeBox quantity change preview for this exact item and show it in HouseAtlas. Then wait, at most until the preview deadline, for a person there to approve and submit it or dismiss it. Returns the native result or how the handoff ended. This tool cannot approve or submit. Its result is not evidence of who acted.',
    inputSchema: inputSchemaFor(a),
    annotations: { readOnlyHint: false, untrustedContentHint: true, consequentialHint: true },
    parseInput(input) {
      if (typeof input !== 'object' || input === null || Array.isArray(input)) throw new TypeError('Quantity tool input is incompatible');
      const prototype: unknown = Object.getPrototypeOf(input);
      const keys = Object.keys(input);
      if ((prototype !== Object.prototype && prototype !== null) || keys.length !== 3 || !['source', 'quantity', 'reason'].every(key => Object.hasOwn(input, key)))
        throw new TypeError('Quantity tool input is incompatible');
      const { source, quantity, reason } = input as { source: unknown; quantity: unknown; reason: unknown };
      if (typeof quantity !== 'number' || typeof reason !== 'string') throw new TypeError('Quantity tool input is incompatible');
      assertQuantityInput(source as SourceRef, quantity, reason);
      if (admission.getSnapshot() !== a || facade.getBindingIdentity() !== a.bindingIdentity) throw unavailable();
      if (!sameQuantityScope(source as SourceRef, a.scope) || !a.installedSources.some(admitted => sameJson(admitted, source)))
        throw new TypeError('Quantity source is not admitted');
      return { source: JSON.parse(JSON.stringify(source)) as JsonObject, quantity, reason };
    },
  };
}

export function mountQuantityWebMcp(o: {
  readonly modelContext: ModelContextPort; readonly admission: QuantityAdmissionPort;
  readonly facade: AgentQuantityFacade; readonly offers: AgentHandoffPort; readonly visible: VisibleResultPort;
}): WebMcpHandle {
  const { admission, facade, offers } = o;
  const expected = new WeakMap<InvocationContext, { readonly output: QuantityToolOutput; readonly reservation: QuantityHandoffReservation | null }>();
  const currentAdmission = () => { const a = admission.getSnapshot(); return a && facade.getBindingIdentity() === a.bindingIdentity ? a : null; };
  // Zero installed sources leaves the tool unregistered.
  const snapshotOf = (a: QuantityToolAdmission | null): SessionSnapshot => a && a.installedSources.length > 0
    ? { state: 'authenticated', revision: JSON.stringify(['quantity-admission', ordinal(a), a.revision]) } : signedOut;
  const admittedFor = (session: AuthenticatedSession) => {
    const a = currentAdmission(), now = snapshotOf(a);
    return a && now.state === session.state && now.revision === session.revision ? a : null;
  };
  const sessions: SessionPort = {
    getSnapshot: () => snapshotOf(currentAdmission()),
    subscribe: changed => { const off = admission.subscribe(changed), offBinding = facade.subscribeSessionBinding(changed); return () => { off(); offBinding(); }; },
  };
  return startWebMcp({
    modelContext: o.modelContext,
    sessions,
    catalog: { toolsFor: session => { const a = admittedFor(session); return a ? [quantityTool(a, admission, facade)] : []; } },
    service: {
      async execute(toolName, input, context) {
        if (toolName !== QUANTITY_TOOL_NAME) throw new TypeError('Unknown quantity tool');
        const a = admittedFor(context.session); if (!a) throw unavailable();
        const { signal } = context;
        const source = input['source'] as unknown as SourceRef, quantity = input['quantity'] as number, reason = input['reason'] as string;
        const finish = (output: QuantityToolOutput, reservation: QuantityHandoffReservation | null) => {
          expected.set(context, { output, reservation }); return output as unknown as JsonValue;
        };
        // Reserved synchronously so two invocations can never both pass the busy check.
        const reservation = offers.reserve();
        if (!reservation) return finish(notPrepared('handoff-active', 'Another assistant quantity handoff is active or held in this session.', facade.getUncertainty(source)), null);
        try {
          const held = facade.getUncertainty(source);
          if (held !== null) { reservation.release(); return finish(notPrepared('held', held, held), null); }
          let state: 'available' | 'unavailable';
          try { state = (await facade.checkAvailability(source, signal)).state; }
          catch (error) {
            reservation.release(); signal.throwIfAborted();
            if (error instanceof QuantityActionError) {
              const refused = error.state;
              if (refused !== 'unknown') return finish(notPrepared(refused, error.message, null), null);
              throw new TypeError('Quantity availability response unavailable. No preview was requested.');
            }
            throw error;
          }
          if (state !== 'available') { reservation.release(); return finish(notPrepared('unavailable', 'HomeBox quantity preview unavailable for this source.', null), null); }
          if (admittedFor(context.session) !== a) throw unavailable();
          signal.throwIfAborted();
          let prepared: QuantityPrepared;
          try { prepared = await facade.preview(source, quantity, reason, signal); }
          catch (error) {
            if (error instanceof QuantityActionError) {
              const refused = error.state;
              if (refused === 'unknown' && error.action !== 'Prior quantity action') {
                reservation.hold(source); signal.throwIfAborted();
                return finish({ format, outcome: 'preview-outcome-unknown', message: error.message, uncertainty: facade.getUncertainty(source) }, null);
              }
              reservation.release(); signal.throwIfAborted();
              return finish(refused === 'unknown' ? notPrepared('held', error.message, facade.getUncertainty(source)) : notPrepared(refused, error.message, null), null);
            }
            reservation.release(); signal.throwIfAborted();
            throw error;
          }
          if (!facade.isCurrentPrepared(prepared) || admittedFor(context.session) !== a) throw unavailable();
          const { approval, ended } = await reservation.offer(prepared, signal);
          const custody = reservation.custody();
          // Wire objects are embedded verbatim and must be the decoded custody objects themselves.
          if (!custody || custody.prepared !== prepared || custody.approval !== approval
            || (approval !== null && approval.previewId !== prepared.wire.previewId)
            || (ended.outcome === 'native-result' && (ended.native !== custody.native || ended.native.previewId !== prepared.wire.previewId)))
            throw new TypeError('Quantity handoff custody differs');
          signal.throwIfAborted();
          return finish({ format, outcome: 'person-handoff-ended', preview: prepared.wire, approval, ended, cachedQuantity: 'unchanged' }, reservation);
        } catch (error) { reservation.end(); throw error; }
      },
    },
    visible: {
      async apply(toolName, result, context, input) {
        const entry = expected.get(context); expected.delete(context);
        // The transport clone is compared structurally; reference identity is not expected after cloning.
        if (!entry || !sameJson(result, entry.output)) { entry?.reservation?.end(); throw new TypeError('Quantity tool result differs from custody'); }
        try { await o.visible.apply(toolName, result, context, input); }
        catch (error) { entry.reservation?.end(); throw error; }
        entry.reservation?.acknowledge();
      },
    },
  });
}
