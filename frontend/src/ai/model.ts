import type { AiErrorCode, CancellationState, ConnectionSnapshot, Usage } from './types.js';

export const failureMessages: Readonly<Record<AiErrorCode, string>> = {
  'connection-unavailable': 'Connection is unavailable.',
  'invalid-input': 'The request input is invalid.',
  'invalid-catalog': 'The tool catalog is unavailable for this request.',
  'invalid-provider-output': 'The provider response could not be used.',
  'unknown-tool': 'The requested tool is unavailable.',
  'limit-reached': 'The request reached its processing limit.',
  'cancel-requested': 'Cancellation was requested. Provider completion is unconfirmed.',
  'provider-unavailable': 'The inference provider is unavailable.',
  'usage-limit-reached': 'The inference usage limit was reached.',
  'domain-unavailable': 'The requested data is unavailable.',
};

export function canInfer(connection: ConnectionSnapshot): boolean {
  return connection.account !== null
    && connection.authorization === 'connected'
    && connection.eligibility !== 'ineligible'
    && connection.paidUseAdmission !== 'held'
    && connection.runtime.route !== 'unset'
    && connection.runtime.qualification === 'qualified'
    && connection.runtime.availability === 'ready'
    && (connection.permission === 'granted'
      || (connection.method !== 'sign-in-with-chatgpt' && connection.permission === 'not-applicable'));
}

export function readinessMessage(connection: ConnectionSnapshot): string {
  if (connection.eligibility === 'ineligible') return 'This connection is not eligible for inference.';
  if (connection.authorization === 'unconfigured') return 'Connection is not configured.';
  if (connection.authorization === 'sign-in-required') return 'Sign-in is required.';
  if (connection.authorization === 'expired') return 'Authorization has expired.';
  if (connection.account === null) return 'The active account is unknown.';
  if (connection.permission === 'denied') return 'Inference permission was denied.';
  if (connection.permission !== 'granted'
    && (connection.method === 'sign-in-with-chatgpt' || connection.permission !== 'not-applicable')) return 'Inference permission is unknown.';
  if (connection.paidUseAdmission === 'held') return 'Inference is disabled until zero paid use is verified or specific credit spending is approved.';
  if (connection.runtime.route === 'unset') return 'An inference runtime has not been selected.';
  if (connection.runtime.qualification === 'held') return 'The selected inference runtime is awaiting qualification.';
  if (connection.runtime.availability === 'sleeping') return 'The runtime is sleeping.';
  if (connection.runtime.availability === 'unreachable') return 'The runtime is unreachable.';
  if (connection.runtime.availability === 'unknown') return 'Runtime availability is unknown.';
  return connection.eligibility === 'unknown'
    ? 'Ready to request inference. Eligibility will be checked.' : 'Ready';
}

export function cancellationMessage(cancellation: CancellationState): string | null {
  switch (cancellation.status) {
    case 'idle': return null;
    case 'sending': return 'Sending cancellation request.';
    case 'unavailable': return 'Cancellation status is unavailable. Request completion is unconfirmed.';
    case 'received':
      switch (cancellation.receipt.status) {
        case 'requested': return 'Cancellation requested. Waiting for the final result.';
        case 'confirmed': return 'Cancellation confirmed. Waiting for the final result.';
        case 'already-finished': return 'The request has finished. Waiting for the result.';
        case 'unsupported': return 'Cancellation is unavailable for this request. Waiting for the result.';
      }
  }
}

export function tokenCount(value: Usage[keyof Usage]): string {
  return value === null ? 'Unknown' : value.toLocaleString('en-US');
}
