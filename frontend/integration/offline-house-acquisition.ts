import type { ReadyView, Scope } from '../src/app/types';
import type { AcquisitionState, HouseAcquisitionPort } from '../src/offline/acquisition-types';
import type { createHouseAcquisition } from '../src/offline/acquire-house';
import type { createSavedHouseStore } from '../src/offline/store';
import type { verifySavedShell } from '../src/offline/shell';

type Session = { readonly expiresAt: string };
type State = { readonly session: Session | null; readonly scope: Scope | null; readonly view: ReadyView | null };
type Modules = { readonly createHouseAcquisition: typeof createHouseAcquisition;
  readonly createSavedHouseStore: typeof createSavedHouseStore; readonly verifySavedShell: typeof verifySavedShell };
type Owner = { readonly session: Session; readonly scope: Scope; readonly view: ReadyView;
  readonly expiry: string; readonly workspaceId: string; readonly homeId: string; readonly label: string };
type Operation = { readonly controller: AbortController; readonly owner: Owner;
  core: ReturnType<typeof createHouseAcquisition> | null; busy: boolean; cleanupPending: boolean; committed: boolean };
/** Native session/view identities own only acquisition, never the saved receipt.
 * Refresh is synchronous and is called by the existing owner notifications. */
export function createOfflineHouseAcquisition(options: {
  readonly state: () => State; readonly origin: string;
  readonly load?: () => Promise<Modules>; readonly transport?: typeof fetch;
}) {
  const origin = new URL(options.origin).origin;
  const listeners = new Set<() => void>();
  let value: AcquisitionState = { status: 'idle' }, selected: Owner | null = null;
  let operation: Operation | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const publish = (next: AcquisitionState) => { value = { ...next, ...(value.receipt && !next.receipt ? { receipt: value.receipt } : {}) };
    for (const changed of [...listeners]) { try { changed(); } catch { /* observers do not own storage */ } } };
  const valid = (owner: Owner) => {
    const state = options.state();
    return state.session === owner.session && state.scope === owner.scope && state.view === owner.view
      && state.view.scope === state.scope && owner.session.expiresAt === owner.expiry
      && owner.scope.workspaceId === owner.workspaceId && owner.scope.homeId === owner.homeId
      && Number.isFinite(Date.parse(owner.expiry)) && Date.parse(owner.expiry) > Date.now();
  };
  const close = async (target: Operation) => {
    try { await target.core?.close(); } finally { if (operation === target) operation = null; }
  };
  function refresh() {
    if (selected && valid(selected)) return;
    if (timer !== undefined) { clearTimeout(timer); timer = undefined; }
    const hadOwner = selected !== null; selected = null;
    const pending = operation;
    if (pending) { pending.controller.abort(); if (!pending.busy) void close(pending).catch(() => undefined); }
    const { session, scope, view } = options.state();
    if (session && scope && view && view.scope === scope && Number.isFinite(Date.parse(session.expiresAt))
      && Date.parse(session.expiresAt) > Date.now()) {
      selected = { session, scope, view, expiry: session.expiresAt, workspaceId: scope.workspaceId, homeId: scope.homeId, label: view.homeLabel };
      const observe = () => { timer = undefined; if (selected && valid(selected)) schedule(); else refresh(); };
      const schedule = () => { if (selected) timer = setTimeout(observe, Math.min(2_147_483_647, Math.max(1, Date.parse(selected.expiry) - Date.now() + 1))); };
      schedule();
    }
    if (hadOwner || pending) publish({ status: 'retired', message: 'The live home changed. Prepare a new copy for the current home.' });
  }
  const port: HouseAcquisitionPort = {
    getState: () => value,
    subscribe(listener) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    async prepare() {
      // Capture every native identity and the actual house label before lazy import.
      refresh(); const owner = selected;
      if (!owner || operation) return;
      const target: Operation = { owner, controller: new AbortController(), core: null, busy: true, cleanupPending: false, committed: false };
      operation = target; publish({ status: 'preparing' });
      const current = () => operation === target && selected === owner && valid(owner) && !target.controller.signal.aborted;
      let keep = false;
      let store: ReturnType<typeof createSavedHouseStore> | null = null;
      try {
        const module = await (options.load ? options.load() : Promise.all([
          import('../src/offline/acquire-house'), import('../src/offline/store'), import('../src/offline/shell'),
        ]).then(([acquisition, storage, shell]) => ({ ...acquisition, ...storage, ...shell })));
        if (!current()) throw new Error('The live home changed');
        store = module.createSavedHouseStore();
        const prefix = `/api/atlas/offline/v1/workspaces/${owner.workspaceId}/homes/${owner.homeId}`;
        // Only the admitted manifest and exact snapshot resources reach this owned transport.
        const transport: typeof fetch = (input, init) => {
          if (!current() || typeof input !== 'string' || !init || init.method !== 'GET' || init.credentials !== 'same-origin')
            return Promise.reject(new Error('The live home changed'));
          const url = new URL(input, origin);
          const resource = new RegExp('^' + prefix + '/snapshots/[a-f0-9]{64}/resources/[a-f0-9]{64}$');
          if (url.origin !== origin || url.search || url.hash || (url.pathname !== prefix + '/manifest' && !resource.test(url.pathname)))
            return Promise.reject(new Error('The house resource is unavailable'));
          return (options.transport ?? fetch)(url.href, init);
        };
        target.core = module.createHouseAcquisition({ scope: { workspaceId: owner.workspaceId, homeId: owner.homeId }, label: owner.label,
          store, signal: target.controller.signal, current, transport, verifyShell: module.verifySavedShell,
          onProgress(progress) { if (current()) publish({ status: value.status === 'preparing' ? 'preparing' : 'saving', progress,
            ...(value.preparation ? { preparation: value.preparation } : {}) }); },
          onCleanupPending() { target.cleanupPending = true; },
        });
        const preparation = await target.core.prepare();
        if (!current()) throw new Error('The live home changed');
        keep = true; publish({ status: 'ready', preparation });
      } catch {
        if (current()) publish({ status: 'unavailable', message: 'The house copy could not be prepared. Check browser storage and try again.' });
      } finally {
        target.busy = false;
        if (!keep) {
          if (target.core) await close(target).catch(() => undefined);
          else {
            try { await store?.close(); } catch { /* retain the explicit unavailable/canceled outcome */ }
            finally { if (operation === target) operation = null; }
          }
        }
      }
    },
    async save(replaceRevision) {
      refresh(); const target = operation, preparation = value.preparation;
      if (!target?.core || target.busy || !preparation || value.status !== 'ready') return;
      target.busy = true; publish({ status: 'saving', preparation });
      try {
        const receipt = await target.core.save(preparation, replaceRevision);
        // This is a local commit receipt even if refresh/cancel retired the host.
        target.committed = true;
        publish({ status: 'saved', receipt });
      } catch {
        if (selected === target.owner && !target.controller.signal.aborted)
          publish({ status: 'unavailable', message: 'The house copy was not saved. Any previous saved copy is retained.' });
      } finally {
        if (target.cleanupPending) publish({ ...value, message: 'Saving stopped. Pending local download data could not be removed; any previous saved copy is retained.' });
        target.busy = false; await close(target).catch(() => undefined);
      }
    },
    cancel() {
      const target = operation; if (!target || target.committed) return;
      target.controller.abort(); publish({ status: 'canceled', message: 'Saving canceled. Any previous saved copy is retained.' });
      if (!target.busy) void close(target).catch(() => undefined);
    },
  };
  return { port, refresh };
}
