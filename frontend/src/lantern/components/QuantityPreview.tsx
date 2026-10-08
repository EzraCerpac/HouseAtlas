import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react';
import type { SourceRef } from '../../api/generated/contracts';
import { QuantityActionError, type QuantityApproval, type QuantityClient, type QuantityPrepared, type QuantityResult } from '../../api/quantity-client';

/** Ledger view of an assistant-prepared preview; the recorder owns attempts and their outcomes. */
export interface QuantityHandoffState {
  readonly approval: QuantityApproval | null;
  readonly result: { readonly value: QuantityResult; readonly prepared: QuantityPrepared } | null;
  readonly approvalAttempted: boolean;
  readonly submissionAttempted: boolean;
  readonly inFlight: boolean;
  /** Accepts a new person attempt. */
  readonly open: boolean;
  /** The assistant wait has ended. */
  readonly settled: boolean;
  readonly dismissible: boolean;
  readonly closable: boolean;
  readonly notice: string | null;
}
/** Opt-in: the same opaque prepared object; Approve and Submit remain person clicks on the full client. */
export interface QuantityPersonHandoff {
  readonly prepared: QuantityPrepared;
  readonly subscribe: (changed: () => void) => () => void;
  readonly getState: () => QuantityHandoffState;
  approve(): Promise<void>;
  submit(): Promise<void>;
  dismiss(): void;
  close(): void;
}
const noSubscription = () => () => {};
const noHandoffState = () => null;

/** Every network action requires an explicit click; browsing only renders. */
export function QuantityPreview({ client, source, renderIdentity, sourceIdentity, handoff }: { client: QuantityClient; source: SourceRef; renderIdentity: object; sourceIdentity: object; handoff?: QuantityPersonHandoff }) {
  const sessionIdentity = useSyncExternalStore(client.subscribeSessionBinding, client.getBindingIdentity, () => null);
  const last = useRef({ client, sessionIdentity, renderIdentity, sourceIdentity, handoff, sourceKey: JSON.stringify(source), revision: 0 });
  const sourceKey = JSON.stringify(source);
  if (last.current.client !== client || last.current.sessionIdentity !== sessionIdentity || last.current.renderIdentity !== renderIdentity || last.current.sourceIdentity !== sourceIdentity || last.current.handoff !== handoff || last.current.sourceKey !== sourceKey) {
    last.current = { client, sessionIdentity, renderIdentity, sourceIdentity, handoff, sourceKey, revision: last.current.revision + 1 };
  }
  return <QuantityPreviewCurrent key={last.current.revision} client={client} source={source} handoff={handoff} />;
}
function QuantityPreviewCurrent({ client, source, handoff }: { client: QuantityClient; source: SourceRef; handoff?: QuantityPersonHandoff | undefined }) {
  const binding = useSyncExternalStore(client.subscribeSessionBinding, client.getBindingIdentity, () => null);
  const ledger = useSyncExternalStore<QuantityHandoffState | null>(handoff ? handoff.subscribe : noSubscription, handoff ? handoff.getState : noHandoffState, noHandoffState);
  // Scalar snapshot; source/session changes remount via the parent revision key, and getUncertainty masks non-current bindings.
  const held = useSyncExternalStore<string | null>(client.subscribeUncertainty ?? noSubscription, () => client.getUncertainty(source), () => null);
  const [available, setAvailable] = useState(false), [busy, setBusy] = useState(false), [notice, setNotice] = useState('');
  const [uncertainty, setUncertainty] = useState('');
  const [quantity, setQuantity] = useState(''), [reason, setReason] = useState('');
  const [ownPrepared, setPrepared] = useState<QuantityPrepared | null>(null), [ownApproval, setApproval] = useState<QuantityApproval | null>(null), [result, setResult] = useState<{ value: QuantityResult; prepared: QuantityPrepared } | null>(null);
  const [clock, setClock] = useState(0), [ownApprovalAttempted, setApprovalAttempted] = useState(false), [ownDispatchAttempted, setDispatchAttempted] = useState(false);
  const section = useRef<HTMLElement | null>(null);
  const previewButton = useRef<HTMLButtonElement | null>(null), previewPanel = useRef<HTMLDivElement | null>(null);
  const active = useRef<AbortController | null>(null), fence = useRef(false), revision = useRef(0);
  useLayoutEffect(() => {
    const unsubscribe = client.subscribeSessionBinding(() => {
      revision.current++; active.current?.abort(); fence.current = false;
      setPrepared(null); setApproval(null); setResult(null); setAvailable(false); setBusy(false); setNotice('Session or scope changed.'); setUncertainty('');
    });
    return () => { revision.current++; active.current?.abort(); unsubscribe(); };
  }, [client]);
  // A handoff shows exactly the offered prepared object and its ledger; no new preview is created here.
  const prepared = handoff ? handoff.prepared : ownPrepared;
  const approval = handoff ? ledger?.approval ?? null : ownApproval;
  const approvalAttempted = handoff ? !!ledger?.approvalAttempted : ownApprovalAttempted;
  const dispatchAttempted = handoff ? !!ledger?.submissionAttempted : ownDispatchAttempted;
  const closedToPerson = !!handoff && !ledger?.open;
  const working = busy || !!ledger?.inFlight;
  useEffect(() => { if (!prepared) return; const timer = window.setTimeout(() => { if (previewPanel.current?.contains(document.activeElement)) { if (previewButton.current && !previewButton.current.disabled) previewButton.current.focus(); else section.current?.focus(); } setClock(performance.now()); }, Math.max(0, prepared.expiresAt - performance.now())); return () => clearTimeout(timer); }, [prepared]);
  const heldUncertainty = held ?? uncertainty;
  const sessionCurrent = !!binding && client.isCurrent(binding);
  const visible = prepared && sessionCurrent && client.isCurrentPrepared(prepared) && performance.now() < prepared.expiresAt && clock < prepared.expiresAt ? prepared : null;
  const run = async (label: string, action: () => Promise<void>, mutation = false) => {
    if (fence.current || !sessionCurrent || (mutation && heldUncertainty)) return;
    fence.current = true; const token = revision.current; setBusy(true); setNotice(label);
    try { await action(); } catch (error) {
      if (revision.current === token) {
        // A subscribed client records every posted unknown in its held store; other errors defer to that store. Legacy clients keep the conservative local hold.
        const holdLocally = error instanceof QuantityActionError ? error.state === 'unknown' : !client.subscribeUncertainty;
        const message = error instanceof QuantityActionError ? error.message : !mutation || holdLocally ? 'Response could not be validated.' : client.getUncertainty(source) ? 'Quantity action not completed; the recorded hold applies.' : 'Quantity action not completed; no unconfirmed request is recorded for this source.';
        setNotice(message); if (mutation && holdLocally) setUncertainty(message + ' Further quantity mutations are held in this context.');
      }
    }
    finally { if (revision.current === token) { fence.current = false; setBusy(false); } }
  };
  const controller = () => { active.current?.abort(); const next = new AbortController(); active.current = next; return next.signal; };
  const current = (token: number) => token === revision.current && !!binding && client.isCurrent(binding);
  // The native result stays bound to its original preview; session/source/render replacement clears or masks it.
  const reset = () => { setPrepared(null); setApproval(null); setApprovalAttempted(false); setDispatchAttempted(false); };
  const parsed = /^[0-9]+$/.test(quantity) ? Number(quantity) : NaN;
  const inputValid = Number.isSafeInteger(parsed) && parsed >= 0 && !!reason.trim() && new TextEncoder().encode(reason).length <= 2048;
  const p = visible?.wire;
  // A handoff result remains shown after preview expiry, bound to the original prepared object.
  const native = handoff
    ? ledger?.result && sessionCurrent && ledger.result.prepared === handoff.prepared ? ledger.result.value.result : null
    : result && sessionCurrent && client.isCurrentPrepared(result.prepared) ? result.value.result : null;
  return <section ref={section} tabIndex={-1} className="quantity-preview" style={{ minWidth: 0, overflowWrap: 'anywhere' }} aria-label="HomeBox quantity" aria-busy={working}>
    <h3>HomeBox quantity</h3>
    {!handoff && <button type="button" className="btn" disabled={busy || !sessionCurrent} onClick={() => void run('Checking quantity availability…', async () => {
      reset(); setAvailable(false); const token = revision.current; const value = await client.checkAvailability(source, controller());
      if (current(token)) { setAvailable(value.state === 'available'); setNotice(value.state === 'available' ? 'Quantity preview available.' : 'Quantity preview unavailable.'); }
    })}>Check quantity availability</button>}
    {!handoff && available && sessionCurrent && <>
      <label className="field">Proposed quantity<input aria-label="Proposed quantity" inputMode="numeric" value={quantity} disabled={busy} onChange={e => { setQuantity(e.target.value); reset(); }} /></label>
      <label className="field">Reason<textarea aria-label="Quantity change reason" value={reason} disabled={busy} onChange={e => { setReason(e.target.value); reset(); }} /></label>
      <button ref={previewButton} type="button" className="btn" disabled={busy || !inputValid || !!heldUncertainty} onClick={() => void run('Preparing quantity preview…', async () => {
        reset(); const token = revision.current; const value = await client.preview(source, parsed, reason, controller());
        if (current(token)) { setClock(performance.now()); setPrepared(value); }
      }, true)}>Preview quantity change</button>
    </>}
    {prepared && !visible && sessionCurrent && <p role="status">{handoff ? 'Preview expired. No new preview is offered here.' : 'Preview expired or unavailable. Create a new preview explicitly.'}</p>}
    {p && <div ref={previewPanel}>
      <dl className="facts">
        <div><dt>Observed quantity</dt><dd>{p.observed.quantity}</dd></div>
        <div><dt>Updated at source</dt><dd>{p.observed.updatedAt ?? 'Unknown'}</dd></div>
        <div><dt>Retrieved</dt><dd>{p.observed.retrievedAt}</dd></div>
        <div><dt>Proposed quantity</dt><dd>{p.effect.quantity}</dd></div>
        <div><dt>Native effect</dt><dd><code>{p.effect.method} {p.effect.path}</code></dd></div>
        <div><dt>Reason</dt><dd>{String(p.request['reason'])}</dd></div>
        <div><dt>Workspace</dt><dd><code>{p.source.workspaceId}</code></dd></div>
        <div><dt>Home</dt><dd><code>{p.source.homeId}</code></dd></div>
        <div><dt>Source instance</dt><dd><code>{p.source.key.sourceInstanceId}</code></dd></div>
        <div><dt>Collection</dt><dd><code>{p.source.key.collectionId}</code></dd></div>
        <div><dt>Source identifier</dt><dd><code>{p.source.key.externalId}</code></dd></div>
        <div><dt>Request identifier</dt><dd><code>{p.request.requestId}</code></dd></div>
        <div><dt>Request digest</dt><dd><code>{p.requestDigest}</code></dd></div>
        <div><dt>Plan digest</dt><dd><code>{p.planDigest}</code></dd></div>
        <div><dt>Policy maximum quantity</dt><dd>{p.policy.maximumQuantity ?? 'No maximum supplied'}</dd></div>
        {approval && <><div><dt>Approval receipt</dt><dd><code>{approval.approvalReceiptId}</code></dd></div><div><dt>Approval evidence digest</dt><dd><code>{approval.evidenceDigest}</code></dd></div></>}
        <div><dt>Policy</dt><dd>{p.policy.id} · {p.policy.version} · epoch {p.policy.epoch}</dd></div>
        <div><dt>Approval</dt><dd>{p.policy.approval === 'human-required' ? approval ? 'Approval issued; quantity not dispatched by approval.' : 'Human approval required.' : 'No human approval required by this policy.'}</dd></div>
        <div><dt>Installed build</dt><dd>{p.assurance.installedBuild}</dd></div>
      </dl>
      <details><summary>Full original stock request</summary><pre style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{JSON.stringify(p.request, null, 2)}</pre></details>
      <p>Causality and atomic compare-and-set are not established.</p>
      {p.policy.approval === 'human-required' && !approval && <button type="button" className="btn" disabled={working || approvalAttempted || closedToPerson || !!heldUncertainty} onClick={() => void run('Requesting quantity approval…', async () => {
        if (!visible || performance.now() >= visible.expiresAt) throw new QuantityActionError('changed', 'Preview expired');
        if (handoff) { await handoff.approve(); return; }
        setApprovalAttempted(true); const token = revision.current;
        const value = await client.approve(visible, controller()); if (current(token)) setApproval(value);
      }, true)}>Approve this exact quantity change</button>}
      <button type="button" className="btn" disabled={working || !!heldUncertainty || dispatchAttempted || closedToPerson || (p.policy.approval === 'human-required' && !approval)} onClick={() => void run('Submitting quantity change…', async () => {
        if (!visible || performance.now() >= visible.expiresAt) throw new QuantityActionError('changed', 'Preview expired');
        if (handoff) { await handoff.submit(); return; }
        setDispatchAttempted(true); const token = revision.current;
        const value = await client.dispatch(visible, approval, controller()); if (current(token)) setResult({ value, prepared: visible });
      }, true)}>Submit quantity change</button>
    </div>}
    {native && <div role="status"><h4>Native result</h4>
      <dl className="facts">{['state', 'verification', 'operationId', 'requestId', 'responseSuccess', 'readbackAgrees', 'observedAt', 'readbackDigest', 'causalityProven', 'atomicProviderCAS', 'nativeEditorRacePossible', 'unknownScopeFenceRetained', 'code', 'retry'].filter(key => Object.hasOwn(native, key)).map(key => <div key={key}><dt>{({state:'State',verification:'Verification',operationId:'Operation identifier',requestId:'Request identifier',responseSuccess:'Provider response success',readbackAgrees:'Original readback agrees',observedAt:'Observed at',readbackDigest:'Original readback digest',causalityProven:'Causality proven',atomicProviderCAS:'Atomic provider compare-and-set',nativeEditorRacePossible:'Native editor race possible',unknownScopeFenceRetained:'Unknown scope fence retained',code:'Code',retry:'Native retry advice'} as Record<string,string>)[key]}</dt><dd>{native[key] === null ? 'Not supplied' : String(native[key])}</dd></div>)}
      {native['remoteActivity'] && <div><dt>Remote activity</dt><dd>{String((native['remoteActivity'] as Record<string, unknown>)['state'])}</dd></div>}</dl>
      <p>Cached quantity is unchanged. Readback agreement does not establish causality.</p>
    </div>}
    {handoff && ledger && sessionCurrent && <div>
      {ledger.notice && <p role="status">{ledger.notice}</p>}
      {ledger.settled
        ? <button type="button" className="btn" disabled={!ledger.closable} onClick={() => handoff.close()}>Close</button>
        : <button type="button" className="btn" disabled={!ledger.dismissible} onClick={() => handoff.dismiss()}>Dismiss preview</button>}
    </div>}
    {sessionCurrent && heldUncertainty && <p role="alert">{heldUncertainty}</p>}
    <p role="status" aria-live="polite">{sessionCurrent ? notice : 'Session unavailable.'}</p>
  </section>;
}
