import { useLayoutEffect, useMemo, useRef, useSyncExternalStore } from 'react';
import type { SourceRef } from '../../api/generated/contracts';
import { QuantityActionError, type QuantityApproval, type QuantityClient, type QuantityPrepared, type QuantityResult } from '../../api/quantity-client';
import { QuantityPreview, type QuantityHandoffState, type QuantityPersonHandoff } from '../../lantern/components/QuantityPreview';
import type { ModelContextPort } from '../ports.js';
import { useCommittedResult } from '../useCommittedResult.js';
import { agentFacade, mountQuantityWebMcp, type AgentHandoffPort, type QuantityAdmissionPort, type QuantityHandoffCustody, type QuantityHandoffEnd, type QuantityHandoffEnded, type QuantityHandoffReservation, type QuantityToolOutput } from './tool.js';

/** Person requests are never aborted by the deadline, the assistant or view teardown. */
const never = new AbortController().signal;
const stale = () => new QuantityActionError('changed', 'Assistant handoff');
type Step = 'approval' | 'submission';
interface Attempt { readonly step: Step; state: 'started' | 'settled' | 'failed'; value: QuantityApproval | QuantityResult | null; error: unknown }

/** Recorder for one offered preview. approve/dispatch are reachable only through the person's clicks. */
class Handoff implements QuantityPersonHandoff {
  readonly prepared: QuantityPrepared;
  readonly identity: object | string;
  readonly wait: Promise<QuantityHandoffEnd>;
  /** Appended synchronously before each client call; every Ended value derives from it. */
  readonly #ledger: Attempt[] = [];
  readonly #client: QuantityClient;
  readonly #changed: () => void;
  readonly #listeners = new Set<() => void>();
  readonly #timer: ReturnType<typeof setTimeout>;
  #resolve: (end: QuantityHandoffEnd) => void = () => {};
  #reject: (reason: unknown) => void = () => {};
  #unsubscribe: (() => void) | null;
  #custody: QuantityHandoffCustody | null = null;
  #approval: QuantityApproval | null = null;
  #result: { readonly value: QuantityResult; readonly prepared: QuantityPrepared } | null = null;
  #done = false; #open = true; #acknowledged = false; #invocationEnded = false; #closed = false;
  #state: QuantityHandoffState;
  constructor(prepared: QuantityPrepared, identity: object | string, client: QuantityClient, changed: () => void, signal: AbortSignal) {
    this.prepared = prepared; this.identity = identity; this.#client = client; this.#changed = changed;
    this.wait = new Promise((resolve, reject) => { this.#resolve = resolve; this.#reject = reject; });
    this.#state = this.#snapshot();
    // The original preview deadline bounds the wait; it never aborts an attempt in flight.
    this.#timer = setTimeout(() => this.#deadline(), Math.max(0, prepared.expiresAt - performance.now()));
    this.#unsubscribe = client.subscribeSessionBinding(() => { if (!client.isCurrent(identity)) this.#end(new DOMException('Tool session is no longer current', 'InvalidStateError')); });
    signal.addEventListener('abort', () => this.#end(signal.reason), { once: true });
  }
  readonly subscribe = (changed: () => void) => { this.#listeners.add(changed); return () => { this.#listeners.delete(changed); }; };
  readonly getState = () => this.#state;
  get source(): SourceRef { return this.prepared.wire.source; }
  get inFlight() { return this.#ledger.some(attempt => attempt.state === 'started'); }
  get closed() { return this.#closed; }
  custody() { return this.#custody; }
  acknowledge() { this.#acknowledged = true; this.#publish(); }
  endInvocation() { this.#end(new DOMException('Assistant invocation ended', 'AbortError')); }
  dispose() { this.#unsubscribe?.(); this.#unsubscribe = null; }
  async approve(): Promise<void> {
    if (!this.#attemptable() || this.prepared.wire.policy.approval !== 'human-required' || this.#ledger.some(a => a.step === 'approval')) throw stale();
    const attempt = this.#start('approval');
    let receipt: QuantityApproval;
    try { receipt = await this.#client.approve(this.prepared, never); }
    catch (error) { this.#failed(attempt, error); throw error; }
    // An issued approval never settles the assistant wait; the person still submits or dismisses.
    attempt.state = 'settled'; attempt.value = receipt; this.#approval = receipt; this.#publish();
  }
  async submit(): Promise<void> {
    const approval = this.#approval;
    if (!this.#attemptable() || this.#ledger.some(a => a.step === 'submission')
      || (this.prepared.wire.policy.approval === 'human-required') !== (approval !== null)) throw stale();
    const attempt = this.#start('submission');
    let value: QuantityResult;
    try { value = await this.#client.dispatch(this.prepared, approval, never); }
    catch (error) { this.#failed(attempt, error); throw error; }
    attempt.state = 'settled'; attempt.value = value; this.#result = { value, prepared: this.prepared };
    this.#settle({ outcome: 'native-result', native: value }); this.#publish();
  }
  dismiss() {
    if (this.#done || this.inFlight) return;
    this.#settle({ outcome: 'ended-before-submission', cause: 'dismissed-by-person', submissionAttempt: 'none-started' }); this.#publish();
  }
  close() { if (!this.#state.closable) return; this.#closed = true; this.dispose(); this.#publish(); }
  #attemptable() {
    return this.#open && !this.#done && !this.#closed && !this.inFlight && this.#client.isCurrent(this.identity)
      && this.#client.isCurrentPrepared(this.prepared) && performance.now() < this.prepared.expiresAt
      && this.#client.getUncertainty(this.source) === null;
  }
  #start(step: Step) { const attempt: Attempt = { step, state: 'started', value: null, error: undefined }; this.#ledger.push(attempt); this.#publish(); return attempt; }
  #failed(attempt: Attempt, error: unknown) {
    attempt.state = 'failed'; attempt.error = error;
    const uncertainty = this.#client.getUncertainty(this.source);
    let ended: QuantityHandoffEnded;
    if (error instanceof QuantityActionError) {
      const state = error.state;
      ended = state === 'unknown' ? { outcome: 'outcome-unknown', step: attempt.step, cause: 'response-unknown', message: error.message, uncertainty }
        : { outcome: 'refused', step: attempt.step, state, message: error.message };
    } else ended = { outcome: 'outcome-unknown', step: attempt.step, cause: 'response-unvalidated', message: 'Response could not be validated.', uncertainty };
    this.#settle(ended); this.#publish();
  }
  #deadline() {
    if (this.#done) return;
    const pending = this.#ledger.find(attempt => attempt.state === 'started');
    this.#settle(pending ? { outcome: 'outcome-unknown', step: pending.step, cause: 'in-flight-at-deadline',
      message: `Preview deadline reached while the ${pending.step} response was pending. Outcome unknown; do not retry automatically.`, uncertainty: this.#client.getUncertainty(this.source) }
      : { outcome: 'ended-before-submission', cause: 'preview-deadline', submissionAttempt: 'none-started' });
    this.#publish();
  }
  #settle(ended: QuantityHandoffEnded) {
    if (this.#done) return;
    this.#done = true; this.#open = false; clearTimeout(this.#timer);
    const custody = Object.freeze({ prepared: this.prepared, approval: this.#approval, native: ended.outcome === 'native-result' ? ended.native : null });
    this.#custody = custody;
    this.#resolve({ approval: custody.approval, ended });
  }
  /** Invocation abort or session change: closed to new attempts; in-flight requests continue and stay recorded. */
  #end(reason: unknown) {
    if (!this.#done) { this.#done = true; clearTimeout(this.#timer); this.#reject(reason); }
    this.#invocationEnded = true; this.#open = false; this.#publish();
  }
  #publish() { this.#state = this.#snapshot(); for (const listener of [...this.#listeners]) listener(); this.#changed(); }
  #snapshot(): QuantityHandoffState {
    const inFlight = this.inFlight;
    return Object.freeze({
      approval: this.#approval, result: this.#result,
      approvalAttempted: this.#ledger.some(a => a.step === 'approval'),
      submissionAttempted: this.#ledger.some(a => a.step === 'submission'),
      inFlight, open: this.#open && !this.#done && !this.#closed, settled: this.#done,
      dismissible: !this.#done && !inFlight,
      closable: this.#done && !inFlight && !this.#closed && (this.#acknowledged || this.#invocationEnded),
      notice: this.#done && inFlight ? 'Response pending after the assistant wait ended. Outcome unknown until received.'
        : this.#invocationEnded && !this.#acknowledged ? 'Assistant request ended. No further approval or submission is offered here.' : null,
    });
  }
}

interface Slot { readonly identity: object | string; source: SourceRef | null; handoff: Handoff | null }

/** Module-private per-client custody; outlives view teardown. One current workflow per session. */
export class QuantityHandoffs {
  readonly #client: QuantityClient;
  readonly #listeners = new Set<() => void>();
  readonly #offered = new WeakSet<QuantityPrepared>();
  /** Earlier-session handoffs whose attempts are still pending; dropped once settled. */
  readonly #retired = new Set<Handoff>();
  #slot: Slot | null = null;
  constructor(client: QuantityClient) { this.#client = client; }
  readonly subscribe = (changed: () => void) => {
    this.#listeners.add(changed); const off = this.#client.subscribeSessionBinding(changed);
    return () => { this.#listeners.delete(changed); off(); };
  };
  /** Only the current session's open handoff; replacement masks earlier custody entirely. */
  readonly getSnapshot = (): Handoff | null => {
    const handoff = this.#slot?.handoff;
    return handoff && !handoff.closed && handoff.identity === this.#client.getBindingIdentity() ? handoff : null;
  };
  agentPort(): AgentHandoffPort { return { reserve: () => this.#reserve() }; }
  #changed() {
    for (const handoff of this.#retired) if (!handoff.inFlight) this.#retired.delete(handoff);
    for (const listener of [...this.#listeners]) listener();
  }
  #busy(identity: object | string) {
    const slot = this.#slot;
    if (!slot || slot.identity !== identity) return false;
    const handoff = slot.handoff;
    if (handoff) return !handoff.closed || handoff.inFlight || this.#client.getUncertainty(handoff.source) !== null;
    if (slot.source) return this.#client.getUncertainty(slot.source) !== null;
    return true;
  }
  #reserve(): QuantityHandoffReservation | null {
    const identity = this.#client.getBindingIdentity();
    if (identity === null) throw new DOMException('Tool session is no longer current', 'InvalidStateError');
    if (this.#busy(identity)) return null;
    const prior = this.#slot?.handoff;
    if (prior) { prior.dispose(); if (prior.inFlight) this.#retired.add(prior); }
    const slot: Slot = { identity, source: null, handoff: null };
    this.#slot = slot;
    const own = () => this.#slot === slot;
    const release = () => { if (own() && !slot.handoff && !slot.source) { this.#slot = null; this.#changed(); } };
    return {
      release,
      hold: source => { if (own() && !slot.handoff) { slot.source = structuredClone(source); this.#changed(); } },
      offer: (prepared, signal) => {
        if (!own() || slot.handoff || slot.source) return Promise.reject(new DOMException('Tool session is no longer current', 'InvalidStateError'));
        if (signal.aborted) return Promise.reject(signal.reason);
        if (this.#offered.has(prepared) || prepared.bindingIdentity !== slot.identity || !this.#client.isCurrentPrepared(prepared))
          return Promise.reject(new TypeError('Quantity preview custody differs'));
        this.#offered.add(prepared);
        const handoff = new Handoff(prepared, slot.identity, this.#client, () => this.#changed(), signal);
        slot.handoff = handoff; this.#changed();
        return handoff.wait;
      },
      custody: () => slot.handoff?.custody() ?? null,
      acknowledge: () => slot.handoff?.acknowledge(),
      end: () => { if (slot.handoff) slot.handoff.endInvocation(); else release(); },
    };
  }
}
const stores = new WeakMap<QuantityClient, QuantityHandoffs>();
function handoffsFor(client: QuantityClient) {
  let store = stores.get(client);
  if (!store) { store = new QuantityHandoffs(client); stores.set(client, store); }
  return store;
}

function describe(output: QuantityToolOutput): string {
  if (output.outcome === 'not-prepared') return `Assistant quantity request not prepared: ${output.message}`;
  if (output.outcome === 'preview-outcome-unknown') return output.message;
  const ended = output.ended;
  if (ended.outcome === 'native-result') return 'Native result offered to the assistant.';
  if (ended.outcome === 'ended-before-submission') return ended.cause === 'preview-deadline'
    ? 'Preview deadline reached with no submission started; offered to the assistant.'
    : 'Dismissed with no submission started; offered to the assistant.';
  return `Offered to the assistant: ${ended.message}`;
}

type Lease = ReturnType<ReturnType<typeof useCommittedResult<QuantityToolOutput>>['activate']>;

export function QuantityHandoffLeaf({ client, admission, modelContext }: { client: QuantityClient; admission: QuantityAdmissionPort; modelContext: ModelContextPort }) {
  const store = useMemo(() => handoffsFor(client), [client]);
  const identity = useSyncExternalStore(client.subscribeSessionBinding, client.getBindingIdentity, () => null);
  const admitted = useSyncExternalStore(admission.subscribe, admission.getSnapshot, () => null);
  const handoff = useSyncExternalStore(store.subscribe, store.getSnapshot, () => null);
  // One result view per original session/scope binding, admission and custody store.
  const view = useMemo(() => ({ store, identity, admitted }), [store, identity, admitted]);
  const { value, activate } = useCommittedResult<QuantityToolOutput>(view);
  const lease = useRef<{ readonly lease: Lease; readonly identity: object | string | null } | null>(null);
  useLayoutEffect(() => {
    const current = activate();
    lease.current = { lease: current, identity };
    return () => { current.deactivate(); if (lease.current?.lease === current) lease.current = null; };
  }, [activate, identity]);
  useLayoutEffect(() => {
    const handle = mountQuantityWebMcp({ modelContext, admission, facade: agentFacade(client), offers: store.agentPort(), visible: {
      apply: (_toolName, result, context) => {
        const current = lease.current;
        if (!current || current.identity === null || current.identity !== client.getBindingIdentity())
          return Promise.reject(new DOMException('Result view activation is no longer current', 'InvalidStateError'));
        return current.lease.commit(result as unknown as QuantityToolOutput, context.signal);
      },
    } });
    return () => handle.dispose();
  }, [client, store, admission, modelContext]);
  const shown = handoff && identity !== null ? handoff : null;
  const status = value && (value.outcome !== 'person-handoff-ended' || (shown !== null && value.preview.previewId === shown.prepared.wire.previewId)) ? describe(value) : null;
  if (!shown && status === null) return null;
  return <section className="quantity-handoff" aria-label={shown ? 'Assistant-prepared HomeBox quantity' : 'Assistant HomeBox quantity request'}>
    {shown && <><p>Prepared by an assistant tool.</p>
      <QuantityPreview client={client} source={shown.prepared.wire.source} renderIdentity={shown} sourceIdentity={shown} handoff={shown} /></>}
    {status !== null && <p role="status">{status}</p>}
  </section>;
}
