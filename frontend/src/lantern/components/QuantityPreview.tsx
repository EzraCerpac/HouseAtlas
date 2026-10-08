import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react';
import type { SourceRef } from '../../api/generated/contracts';
import { QuantityActionError, type QuantityApproval, type QuantityClient, type QuantityPrepared, type QuantityResult } from '../../api/quantity-client';

/** Every network action requires an explicit click; browsing only renders. */
export function QuantityPreview({ client, source, renderIdentity, sourceIdentity }: { client: QuantityClient; source: SourceRef; renderIdentity: object; sourceIdentity: object }) {
  const sessionIdentity = useSyncExternalStore(client.subscribeSessionBinding, client.getBindingIdentity, () => null);
  const last = useRef({ client, sessionIdentity, renderIdentity, sourceIdentity, sourceKey: JSON.stringify(source), revision: 0 });
  const sourceKey = JSON.stringify(source);
  if (last.current.client !== client || last.current.sessionIdentity !== sessionIdentity || last.current.renderIdentity !== renderIdentity || last.current.sourceIdentity !== sourceIdentity || last.current.sourceKey !== sourceKey) {
    last.current = { client, sessionIdentity, renderIdentity, sourceIdentity, sourceKey, revision: last.current.revision + 1 };
  }
  return <QuantityPreviewCurrent key={last.current.revision} client={client} source={source} />;
}
function QuantityPreviewCurrent({ client, source }: { client: QuantityClient; source: SourceRef }) {
  const binding = useSyncExternalStore(client.subscribeSessionBinding, client.getBindingIdentity, () => null);
  const [available, setAvailable] = useState(false), [busy, setBusy] = useState(false), [notice, setNotice] = useState('');
  const [uncertainty, setUncertainty] = useState('');
  const [quantity, setQuantity] = useState(''), [reason, setReason] = useState('');
  const [prepared, setPrepared] = useState<QuantityPrepared | null>(null), [approval, setApproval] = useState<QuantityApproval | null>(null), [result, setResult] = useState<{ value: QuantityResult; prepared: QuantityPrepared } | null>(null);
  const [clock, setClock] = useState(0), [approvalAttempted, setApprovalAttempted] = useState(false), [dispatchAttempted, setDispatchAttempted] = useState(false);
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
  useEffect(() => { if (!prepared) return; const timer = window.setTimeout(() => { if (previewPanel.current?.contains(document.activeElement)) { if (previewButton.current && !previewButton.current.disabled) previewButton.current.focus(); else section.current?.focus(); } setClock(performance.now()); }, Math.max(0, prepared.expiresAt - performance.now())); return () => clearTimeout(timer); }, [prepared]);
  const heldUncertainty = client.getUncertainty(source) ?? uncertainty;
  const sessionCurrent = !!binding && client.isCurrent(binding);
  const visible = prepared && sessionCurrent && client.isCurrentPrepared(prepared) && performance.now() < prepared.expiresAt && clock < prepared.expiresAt ? prepared : null;
  const run = async (label: string, action: () => Promise<void>, mutation = false) => {
    if (fence.current || !sessionCurrent || (mutation && heldUncertainty)) return;
    fence.current = true; const token = revision.current; setBusy(true); setNotice(label);
    try { await action(); } catch (error) { if (revision.current === token) { const message = error instanceof QuantityActionError ? error.message : 'Response could not be validated.'; setNotice(message); if (mutation && (!(error instanceof QuantityActionError) || error.state === 'unknown')) setUncertainty(message + ' Further quantity mutations are held in this context.'); } }
    finally { if (revision.current === token) { fence.current = false; setBusy(false); } }
  };
  const controller = () => { active.current?.abort(); const next = new AbortController(); active.current = next; return next.signal; };
  const current = (token: number) => token === revision.current && !!binding && client.isCurrent(binding);
  // The native result stays bound to its original preview; session/source/render replacement clears or masks it.
  const reset = () => { setPrepared(null); setApproval(null); setApprovalAttempted(false); setDispatchAttempted(false); };
  const parsed = /^[0-9]+$/.test(quantity) ? Number(quantity) : NaN;
  const inputValid = Number.isSafeInteger(parsed) && parsed >= 0 && !!reason.trim() && new TextEncoder().encode(reason).length <= 2048;
  const p = visible?.wire;
  const native = result && sessionCurrent && client.isCurrentPrepared(result.prepared) ? result.value.result : null;
  return <section ref={section} tabIndex={-1} className="quantity-preview" style={{ minWidth: 0, overflowWrap: 'anywhere' }} aria-label="HomeBox quantity" aria-busy={busy}>
    <h3>HomeBox quantity</h3>
    <button type="button" className="btn" disabled={busy || !sessionCurrent} onClick={() => void run('Checking quantity availability…', async () => {
      reset(); setAvailable(false); const token = revision.current; const value = await client.checkAvailability(source, controller());
      if (current(token)) { setAvailable(value.state === 'available'); setNotice(value.state === 'available' ? 'Quantity preview available.' : 'Quantity preview unavailable.'); }
    })}>Check quantity availability</button>
    {available && sessionCurrent && <>
      <label className="field">Proposed quantity<input aria-label="Proposed quantity" inputMode="numeric" value={quantity} disabled={busy} onChange={e => { setQuantity(e.target.value); reset(); }} /></label>
      <label className="field">Reason<textarea aria-label="Quantity change reason" value={reason} disabled={busy} onChange={e => { setReason(e.target.value); reset(); }} /></label>
      <button ref={previewButton} type="button" className="btn" disabled={busy || !inputValid || !!heldUncertainty} onClick={() => void run('Preparing quantity preview…', async () => {
        reset(); const token = revision.current; const value = await client.preview(source, parsed, reason, controller());
        if (current(token)) { setClock(performance.now()); setPrepared(value); }
      }, true)}>Preview quantity change</button>
    </>}
    {prepared && !visible && sessionCurrent && <p role="status">Preview expired or unavailable. Create a new preview explicitly.</p>}
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
      {p.policy.approval === 'human-required' && !approval && <button type="button" className="btn" disabled={busy || approvalAttempted || !!heldUncertainty} onClick={() => void run('Requesting quantity approval…', async () => {
        if (!visible || performance.now() >= visible.expiresAt) throw new QuantityActionError('changed', 'Preview expired'); setApprovalAttempted(true); const token = revision.current;
        const value = await client.approve(visible, controller()); if (current(token)) setApproval(value);
      }, true)}>Approve this exact quantity change</button>}
      <button type="button" className="btn" disabled={busy || !!heldUncertainty || dispatchAttempted || (p.policy.approval === 'human-required' && !approval)} onClick={() => void run('Submitting quantity change…', async () => {
        if (!visible || performance.now() >= visible.expiresAt) throw new QuantityActionError('changed', 'Preview expired'); setDispatchAttempted(true); const token = revision.current;
        const value = await client.dispatch(visible, approval, controller()); if (current(token)) setResult({ value, prepared: visible });
      }, true)}>Submit quantity change</button>
    </div>}
    {native && <div role="status"><h4>Native result</h4>
      <dl className="facts">{['state', 'verification', 'operationId', 'requestId', 'responseSuccess', 'readbackAgrees', 'observedAt', 'readbackDigest', 'causalityProven', 'atomicProviderCAS', 'nativeEditorRacePossible', 'unknownScopeFenceRetained', 'code', 'retry'].filter(key => Object.hasOwn(native, key)).map(key => <div key={key}><dt>{({state:'State',verification:'Verification',operationId:'Operation identifier',requestId:'Request identifier',responseSuccess:'Provider response success',readbackAgrees:'Original readback agrees',observedAt:'Observed at',readbackDigest:'Original readback digest',causalityProven:'Causality proven',atomicProviderCAS:'Atomic provider compare-and-set',nativeEditorRacePossible:'Native editor race possible',unknownScopeFenceRetained:'Unknown scope fence retained',code:'Code',retry:'Native retry advice'} as Record<string,string>)[key]}</dt><dd>{native[key] === null ? 'Not supplied' : String(native[key])}</dd></div>)}
      {native['remoteActivity'] && <div><dt>Remote activity</dt><dd>{String((native['remoteActivity'] as Record<string, unknown>)['state'])}</dd></div>}</dl>
      <p>Cached quantity is unchanged. Readback agreement does not establish causality.</p>
    </div>}
    {sessionCurrent && heldUncertainty && <p role="alert">{heldUncertainty}</p>}
    <p role="status" aria-live="polite">{sessionCurrent ? notice : 'Session unavailable.'}</p>
  </section>;
}
