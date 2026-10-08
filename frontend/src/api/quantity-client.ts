import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import agent from '../../../contracts/stock-wire3/agent/agent.schema.json';
import atlas from '../../../packages/contracts/schemas/atlas.schema.json';
import type { SourceRef, Scope } from './generated/contracts';
import type { AtlasSessionInfo } from '../app/session';
import type { StockRequestEnvelope, StockResultEnvelope } from '../webmcp/stock';

export interface QuantitySessionBinding {
  /** Host-owned identity replaced on every session/context replacement. */
  readonly identity: object | string;
  readonly session: AtlasSessionInfo;
  readonly scope: Scope;
}
export interface QuantityAvailability {
  format: 'atlas-homebox-quantity-availability/1'; resolvedScope: Scope; source: SourceRef;
  state: 'available' | 'unavailable';
}
export interface QuantityPreviewWire {
  format: 'atlas-homebox-quantity-preview/1'; resolvedScope: Scope; source: SourceRef;
  previewId: string; request: StockRequestEnvelope; requestDigest: string; planDigest: string;
  observed: { quantity: string; updatedAt: string | null; retrievedAt: string };
  effect: { quantity: number; method: 'PATCH'; path: string; body: { quantity: number } };
  policy: { id: string; version: string; epoch: number; approval: 'no-human' | 'human-required'; maximumQuantity: number | null };
  assurance: { installedBuild: 'configured-not-runtime-attested'; causality: false; atomicCompareAndSet: false };
  lifetime: { remainingMs: number };
}
export interface QuantityPrepared { readonly wire: QuantityPreviewWire; readonly bindingIdentity: object | string; readonly expiresAt: number }
export interface QuantityApproval {
  format: 'atlas-homebox-quantity-approval/1'; resolvedScope: Scope; source: SourceRef;
  previewId: string; requestDigest: string; planDigest: string; approvalReceiptId: string; evidenceDigest: string;
}
export interface QuantityResult {
  format: 'atlas-homebox-quantity-result/1'; resolvedScope: Scope; source: SourceRef;
  previewId: string; requestDigest: string; planDigest: string; result: StockResultEnvelope;
}
export interface QuantityClient {
  getBindingIdentity(): object | string | null;
  /** Sanitized prior ambiguous POST for this original source/current session. */
  getUncertainty(source: SourceRef): string | null;
  /** Notifies after a hold is recorded or its message changes; read via getUncertainty. Implementers record every posted unknown before rejecting, so views defer other errors to this store. Optional: legacy clients keep render-time reads and a conservative local hold. */
  subscribeUncertainty?(changed: () => void): () => void;
  subscribeSessionBinding(changed: () => void): () => void;
  isCurrent(identity: object | string): boolean;
  isCurrentPrepared(prepared: QuantityPrepared): boolean;
  checkAvailability(source: SourceRef, signal: AbortSignal): Promise<QuantityAvailability>;
  preview(source: SourceRef, quantity: number, reason: string, signal: AbortSignal): Promise<QuantityPrepared>;
  approve(prepared: QuantityPrepared, signal: AbortSignal): Promise<QuantityApproval>;
  dispatch(prepared: QuantityPrepared, approval: QuantityApproval | null, signal: AbortSignal): Promise<QuantityResult>;
}
export class QuantityActionError extends Error {
  constructor(readonly state: 'expired' | 'denied' | 'absent' | 'changed' | 'unavailable' | 'unknown', readonly action: string) {
    // Preview performs no reserve, admission or receipt issuance; a held prior action may be only a preview.
    super(state === 'unknown' ? (action === 'Prior quantity action' ? 'Prior quantity action outcome unknown; do not retry automatically.' : `${action} response unavailable. ${action === 'preview' ? 'Preview outcome unknown' : 'Issuance or admission may have occurred'}; do not retry automatically.`) : `${action}: ${state}.${['preview', 'approval', 'dispatch'].includes(action) ? ' No completion established; do not infer rollback or safe retry.' : ''}`);
  }
}
const text = { type: 'string', minLength: 1 };
const uuid = { type: 'string', format: 'uuid', pattern: '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' };
const digest = { type: 'string', pattern: '^[0-9a-f]{64}$' };
const integer = { type: 'integer', minimum: 0, maximum: Number.MAX_SAFE_INTEGER };
const nullable = (schema: object) => ({ anyOf: [schema, { type: 'null' }] });
const object = (properties: Record<string, object>) => ({ type: 'object', additionalProperties: false, required: Object.keys(properties), properties });
const scope = { $ref: `${atlas.$id}#/$defs/scope` }, source = { $ref: `${atlas.$id}#/$defs/sourceRef` };
const correlation = { resolvedScope: scope, source, previewId: uuid, requestDigest: digest, planDigest: digest };
const ajv = new Ajv2020({ strict: true, allErrors: true, allowUnionTypes: true });
addFormats(ajv); ajv.addSchema(atlas); ajv.addSchema(agent);
const availabilitySchema = ajv.compile<QuantityAvailability>(object({ format: { const: 'atlas-homebox-quantity-availability/1' }, resolvedScope: scope, source, state: { enum: ['available', 'unavailable'] } }));
const previewSchema = ajv.compile<QuantityPreviewWire>(object({ format: { const: 'atlas-homebox-quantity-preview/1' }, ...correlation,
  request: { $ref: `${agent.$id}#/$defs/request_homebox_entity_quantity_set` },
  observed: object({ quantity: { type: 'string', pattern: '^-?(?:0|[1-9][0-9]*)(?:\\.[0-9]+)?(?:[eE][+-]?[0-9]+)?$' }, updatedAt: nullable({ type: 'string' }), retrievedAt: text }),
  effect: object({ quantity: integer, method: { const: 'PATCH' }, path: text, body: object({ quantity: integer }) }),
  policy: object({ id: text, version: { type: 'string', maxLength: 20, pattern: '^(?:0|[1-9][0-9]*)$' }, epoch: integer, approval: { enum: ['no-human', 'human-required'] }, maximumQuantity: nullable(integer) }),
  assurance: object({ installedBuild: { const: 'configured-not-runtime-attested' }, causality: { const: false }, atomicCompareAndSet: { const: false } }),
  lifetime: object({ remainingMs: { type: 'integer', minimum: 1, maximum: 60000 } }),
}));
const approvalSchema = ajv.compile<QuantityApproval>(object({ format: { const: 'atlas-homebox-quantity-approval/1' }, ...correlation, approvalReceiptId: uuid, evidenceDigest: digest }));
const resultSchema = ajv.compile<QuantityResult>(object({ format: { const: 'atlas-homebox-quantity-result/1' }, ...correlation, result: { $ref: `${agent.$id}#/$defs/result_homebox_entity_quantity_set` } }));
export const equalQuantityJson = (a: unknown, b: unknown): boolean => canonical(a) === canonical(b);
/** Published RFC8785 JS scalar and UTF16 key order; reject non-IJSON strings. */
function wellFormed(value: string): boolean {
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i);
    if (code >= 0xd800 && code <= 0xdbff) { const next = value.charCodeAt(++i); if (!(next >= 0xdc00 && next <= 0xdfff)) return false; }
    else if (code >= 0xdc00 && code <= 0xdfff) return false;
  }
  return true;
}
function canonical(value: unknown): string {
  if (typeof value === 'string') { if (!wellFormed(value)) throw new TypeError('Invalid Unicode'); return JSON.stringify(value); }
  if (value === null || typeof value === 'boolean') return JSON.stringify(value);
  if (typeof value === 'number' && Number.isFinite(value)) return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype) {
    const row = value as Record<string, unknown>;
    return `{${Object.keys(row).sort().map(k => `${canonical(k)}:${canonical(row[k])}`).join(',')}}`;
  }
  throw new TypeError('Expected JSON data');
}
export async function quantityRequestDigest(request: StockRequestEnvelope): Promise<string> {
  const intent = structuredClone(request) as Record<string, unknown> & { target: Record<string, unknown> }; delete intent['requestId']; delete intent['approvalReceiptId'];
  if (intent.target['authority'] === 'homebox') delete (intent['preconditions'] as Record<string, unknown>)['providerObservation'];
  const bytes = new TextEncoder().encode(canonical(intent));
  const hash = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(hash), byte => byte.toString(16).padStart(2, '0')).join('');
}
export function assertQuantityInput(source: SourceRef, quantity: number, reason: string) {
  const check = ajv.getSchema(`${atlas.$id}#/$defs/sourceRef`)!;
  if (!check(source) || source.key.sourceKind !== 'homebox-entity' || !Number.isSafeInteger(quantity) || quantity < 0
    || typeof reason !== 'string' || !reason.trim() || !wellFormed(reason) || new TextEncoder().encode(reason).length > 2048)
    throw new TypeError('Quantity input is incompatible');
}
export function decodeQuantityAvailability(value: unknown, original: SourceRef): QuantityAvailability {
  if (!availabilitySchema(value) || !equalQuantityJson(value.source, original) || !sameQuantityScope(value.resolvedScope, original)) throw new TypeError('Availability correlation differs');
  return value;
}
export const sameQuantityScope = (a: Scope, b: Scope) => a.workspaceId === b.workspaceId && a.homeId === b.homeId;
export async function decodeQuantityPreview(value: unknown, original: SourceRef, quantity: number, reason: string): Promise<QuantityPreviewWire> {
  if (!previewSchema(value)) throw new TypeError('Quantity preview is incompatible');
  if (BigInt(value.policy.version) > 18446744073709551615n) throw new TypeError('Policy version exceeds native u64');
  const request = value.request;
  if (!equalQuantityJson(value.source, original) || !sameQuantityScope(value.resolvedScope, original) || !sameQuantityScope(request.context, original)
    || request.commandId !== 'homebox.entity.quantity.set' || request.target['sourceInstanceId'] !== original.key.sourceInstanceId
    || request.target['collectionId'] !== original.key.collectionId || request.target['resourceId'] !== original.key.externalId
    || request.payload['quantity'] !== quantity || request['reason'] !== reason
    // The reserved UUID is correlation data only; approval requires issuance.
    || (value.policy.approval === 'human-required' ? typeof request['approvalReceiptId'] !== 'string' : request['approvalReceiptId'] !== null)
    || value.effect.quantity !== quantity || value.effect.body.quantity !== quantity
    || value.effect.path !== `/api/v1/entities/${original.key.externalId}`
    || (value.policy.maximumQuantity !== null && quantity > value.policy.maximumQuantity)
    || await quantityRequestDigest(request) !== value.requestDigest) throw new TypeError('Quantity preview correlation differs');
  return value;
}
function correlates(value: QuantityApproval | QuantityResult, preview: QuantityPreviewWire) {
  return sameQuantityScope(value.resolvedScope, preview.resolvedScope) && equalQuantityJson(value.source, preview.source)
    && value.previewId === preview.previewId && value.requestDigest === preview.requestDigest && value.planDigest === preview.planDigest;
}
export function decodeQuantityApproval(value: unknown, preview: QuantityPreviewWire): QuantityApproval {
  if (!approvalSchema(value) || !correlates(value, preview) || preview.policy.approval !== 'human-required'
    || value.approvalReceiptId !== preview.request['approvalReceiptId']) throw new TypeError('Approval correlation differs');
  return value;
}
export function decodeQuantityResult(value: unknown, preview: QuantityPreviewWire): QuantityResult {
  if (!resultSchema(value) || !correlates(value, preview) || value.result.requestId !== preview.request.requestId
    || (!Object.hasOwn(value.result, 'code') && (value.result['commandId'] !== preview.request.commandId || !equalQuantityJson(value.result['resolvedScope'], preview.resolvedScope) || value.result['requestDigest'] !== preview.requestDigest))) throw new TypeError('Quantity result correlation differs');
  return value;
}
