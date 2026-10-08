import { useLayoutEffect, useMemo, useRef, useState } from "react";
import { canReadRetainedIntent, createRetainedIntentClient, type RetainedIntentRead } from "../../api/retained-intent-client.js";
import type { StockCompletion, StockSessionPort } from "../stock.js";
import { useSessionViewToken, type RenderIdentity } from "../useCommittedResult.js";

/** An explicit passive lookup, independent of stock execution and its lease. */
export function SavedReceipt({ completion, sessions, renderIdentity }: {
  readonly completion: StockCompletion;
  readonly sessions: StockSessionPort;
  readonly renderIdentity?: RenderIdentity;
}) {
  const token = useSessionViewToken(sessions);
  const identity = useMemo(() => ({}), [completion, sessions, token, renderIdentity]);
  const currentIdentity = useRef(identity);
  currentIdentity.current = identity;
  const controller = useRef<AbortController | null>(null);
  const client = useMemo(() => createRetainedIntentClient(), []);
  const [entry, setEntry] = useState<{ identity: object; read: RetainedIntentRead | { status: "loading" } } | null>(null);
  useLayoutEffect(() => () => {
    controller.current?.abort();
    controller.current = null;
  }, [identity]);
  const context = () => {
    const snapshot = sessions.getSnapshot();
    if (snapshot.state !== "authenticated" || snapshot.revision !== completion.sessionRevision)
      throw new TypeError("Command session is no longer current");
    const value = sessions.getContext(snapshot);
    if (value.scope.workspaceId !== completion.request.context.workspaceId
      || value.scope.homeId !== completion.request.context.homeId)
      throw new TypeError("Command scope is no longer current");
    return value;
  };
  let current = false;
  try { context(); current = true; } catch { /* Existing session owner remains authoritative. */ }
  const supported = canReadRetainedIntent(completion.request);
  const read = current && entry?.identity === identity ? entry.read : null;
  const inspect = () => {
    if (!supported || controller.current) return;
    let scope;
    try { scope = context().scope; } catch { return; }
    const pending = new AbortController();
    controller.current = pending;
    setEntry({ identity, read: { status: "loading" } });
    const active = () => {
      if (pending.signal.aborted || currentIdentity.current !== identity) return false;
      try { context(); return true; } catch { return false; }
    };
    void client.read(completion.request, scope, pending.signal).then(result => {
      if (active()) setEntry({ identity, read: result });
    }).catch(() => {
      if (active()) setEntry({ identity, read: { status: "unavailable" } });
    }).finally(() => {
      if (controller.current === pending) controller.current = null;
    });
  };
  return <section aria-label="Saved receipt">
    <button type="button" onClick={inspect} disabled={!current || !supported || read?.status === "loading"}>Saved receipt</button>
    {!supported && <p>Saved receipt lookup is unavailable for this command or request size.</p>}
    {!current && <p>Saved receipt lookup requires the original current session and home.</p>}
    {read?.status === "loading" && <p role="status">Reading saved receipt…</p>}
    {read?.status === "unavailable" && <p role="status">Saved receipt could not be read.</p>}
    {read?.status === "denied" && <p role="status">Saved receipt access is denied.</p>}
    {read?.status === "expired" && <p role="status">Sign in to read the saved receipt.</p>}
    {read?.status === "ready" && <>
      <p>Retained Atlas stock only. Retry safety is not established.</p>
      {!read.receipt.committedResult && <p>No matching retained commit was found at this snapshot. This does not establish rollback.</p>}
      {read.receipt.committedResult && <p>Original media release and HTTP delivery are not established.</p>}
      <pre aria-label="Saved receipt response">{JSON.stringify(read.receipt, null, 2)}</pre>
    </>}
  </section>;
}
