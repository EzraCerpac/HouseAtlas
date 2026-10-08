import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createEvidenceClient, isEvidenceId, type EvidenceRead } from '../../api/evidence-client';
import { useStore } from '../state/store';

/** Read only when the user activates the linked UUID. References remain plain text. */
export function LinkedEvidence({ evidenceId }: { evidenceId: string }) {
  const { projection, actions } = useStore();
  const view = projection.view;
  const scope = view.scope;
  const session = actions.session;
  const expiresAt = session?.expiresAt;
  const key = useMemo(() => ({ view, session, expiresAt, workspaceId: scope.workspaceId, homeId: scope.homeId, evidenceId }),
    [view, session, expiresAt, scope.workspaceId, scope.homeId, evidenceId]);
  const client = useMemo(() => createEvidenceClient(), []);
  const controller = useRef<AbortController | null>(null);
  const [result, setResult] = useState<{ key: typeof key; read: EvidenceRead } | null>(null);
  const expiry = expiresAt === undefined ? NaN : Date.parse(expiresAt);
  const sessionCurrent = !!session && Number.isFinite(expiry) && expiry > Date.now();
  const read: EvidenceRead = !sessionCurrent ? { status: 'expired' }
    : result?.key === key ? result.read : { status: 'idle' };

  useLayoutEffect(() => {
    setResult(null);
    const expire = () => {
      controller.current?.abort();
      controller.current = null;
      setResult({ key, read: { status: 'expired' } });
    };
    // Long sessions use bounded timer intervals; no read is triggered by this timer.
    let timer: ReturnType<typeof setTimeout> | undefined;
    const schedule = () => {
      const remaining = expiry - Date.now();
      if (!Number.isFinite(remaining) || remaining <= 0) { expire(); return; }
      timer = setTimeout(schedule, Math.min(remaining, 2_147_483_647));
    };
    schedule();
    return () => {
      if (timer !== undefined) clearTimeout(timer);
      controller.current?.abort();
      controller.current = null;
    };
  }, [key, expiry]);

  const load = async () => {
    if (!sessionCurrent || !isEvidenceId(evidenceId)) return;
    controller.current?.abort();
    const pending = new AbortController();
    controller.current = pending;
    setResult({ key, read: { status: 'loading' } });
    try {
      const next = await client.read(scope, evidenceId, pending.signal);
      if (!pending.signal.aborted && controller.current === pending)
        setResult({ key, read: next });
    } catch {
      if (!pending.signal.aborted && controller.current === pending)
        setResult({ key, read: { status: 'unavailable' } });
    }
  };
  if (!isEvidenceId(evidenceId)) return null;
  const record = read.status === 'ready' ? read.record : null;
  return <div className="linked-evidence" data-evidence-id={evidenceId} style={{ overflowWrap: 'anywhere' }}>
    <button type="button" className="btn" aria-label={`View evidence ${evidenceId}`}
      disabled={!sessionCurrent || read.status === 'loading'} onClick={() => void load()}>View evidence</button>
    {read.status === 'loading' && <p className="body-text" role="status">Loading evidence…</p>}
    {read.status === 'missing' && <p className="body-text" role="status">Evidence record not found.</p>}
    {read.status === 'denied' && <p className="body-text" role="status">Access to this evidence is denied.</p>}
    {read.status === 'expired' && <p className="body-text" role="status">The session for this evidence read has expired.</p>}
    {read.status === 'unavailable' && <p className="body-text" role="status">Evidence could not be loaded. Use View evidence to retry.</p>}
    {read.status === 'ready' && record && <details open>
      <summary>Evidence {record.target.recordId} · {record.lifecycle}</summary>
      <h3>Evidence</h3>
      <dl className="facts">
        <div><dt>Atlas read status</dt><dd>{read.sourceStatus}</dd></div>
        <div><dt>Record revision</dt><dd>{record.revision}</dd></div>
        <div><dt>Lifecycle</dt><dd>{record.lifecycle}</dd></div>
        <div><dt>Statement</dt><dd style={{ whiteSpace: 'pre-wrap' }}>{record.payload.statement}</dd></div>
        <div><dt>Supersedes evidence IDs</dt><dd>{record.payload.supersedesEvidenceIds.length ? record.payload.supersedesEvidenceIds.join(', ') : 'None supplied'}</dd></div>
      </dl>
      <h4>Original provenance</h4>
      <pre style={{ whiteSpace: 'pre-wrap' }}>{JSON.stringify(record.payload.provenance, null, 2)}</pre>
      <h4>Original references</h4>
      <pre style={{ whiteSpace: 'pre-wrap' }}>{JSON.stringify(record.payload.references, null, 2)}</pre>
    </details>}
  </div>;
}
