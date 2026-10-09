import { createContext, useContext, useLayoutEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import type { AccountObservation, AccountObservationBinding, AccountObservationClient, AccountRead } from './host/account-client.js';

const AccountObservationContext = createContext<AccountObservationClient | null>(null);

/** Supplied by the integration host only; without it no account section renders. */
export function AccountObservationProvider({ client, children }: {
  readonly client: AccountObservationClient;
  readonly children: ReactNode;
}) {
  return <AccountObservationContext.Provider value={client}>{children}</AccountObservationContext.Provider>;
}

type Shown = AccountRead | { readonly status: 'loading' };
const authorizationLabels: Record<AccountObservation['connection']['authorization'], string> = {
  connected: 'Connected', expired: 'Expired', 'sign-in-required': 'Sign-in required', unconfigured: 'Not configured',
};

/** Explicit informational read of the host's local account record; never on mount. */
export function AccountObservationSection() {
  const client = useContext(AccountObservationContext);
  return client ? <AccountSection client={client} /> : null;
}
function AccountSection({ client }: { readonly client: AccountObservationClient }) {
  const binding = useSyncExternalStore(client.subscribe, client.getBinding);
  const [stored, setStored] = useState<{ readonly binding: AccountObservationBinding; readonly read: Shown } | null>(null);
  const current = useRef<AccountObservationBinding | null>(null);
  const controller = useRef<AbortController | null>(null);
  useLayoutEffect(() => {
    current.current = binding;
    return () => {
      current.current = null;
      controller.current?.abort();
      controller.current = null;
    };
  }, [binding]);
  // A read from a prior session allocation or scope never renders.
  const read = binding !== null && stored?.binding === binding ? stored.read : null;
  const refresh = () => {
    if (binding === null || current.current !== binding || controller.current) return;
    const abort = new AbortController();
    controller.current = abort;
    const live = () => !abort.signal.aborted && current.current === binding && client.getBinding() === binding;
    setStored({ binding, read: { status: 'loading' } });
    void client.read(binding, abort.signal).then(
      result => { if (live()) setStored({ binding, read: result }); },
      () => { if (live()) setStored({ binding, read: { status: 'unavailable' } }); },
    ).finally(() => { if (controller.current === abort) controller.current = null; });
  };
  const observation = read?.status === 'observed' ? read.observation : null;
  const identity = observation?.accountIdentity ?? null;
  let message: string;
  if (binding === null) message = 'Account observation requires a current session and loaded home.';
  else switch (read?.status) {
    case undefined: message = 'Account has not been read for this session and home.'; break;
    case 'loading': message = 'Reading account…'; break;
    case 'denied': message = 'The host declined this account observation.'; break;
    case 'unavailable': message = 'Account observation is unavailable.'; break;
    case 'observed': message = identity === null ? 'No stored account identity is available.'
      : observation?.connection.authorization === 'connected' ? '' : 'Stored identity only; it is not a current grant.'; break;
  }
  const loading = read?.status === 'loading';
  return <section className="setting" aria-label="AI account">
    <div className="setting-text">
      <h2>AI account</h2>
      <p className="muted">Local record only. It does not establish a workspace, eligibility, inference permission, paid use, model access or provider freshness.</p>
      <p role="status">{message}</p>
      {observation && <dl className="ha-ai__facts">
        {identity && <>
          <div><dt>Account label</dt><dd>{identity.label === '' ? <span className="muted">Empty label</span> : identity.label}</dd></div>
          <div><dt>Account subject</dt><dd>{identity.accountId}</dd></div>
        </>}
        <div><dt>Authorization</dt><dd>{authorizationLabels[observation.connection.authorization]}</dd></div>
        <div><dt>Observed locally at</dt><dd><time dateTime={observation.observedAt}>{observation.observedAt}</time></dd></div>
      </dl>}
    </div>
    <button type="button" disabled={binding === null || loading} onClick={refresh}>{loading ? 'Refreshing account…' : 'Refresh account'}</button>
  </section>;
}
