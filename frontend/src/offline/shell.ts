export interface SavedShellStatus { readonly ready: boolean; readonly buildId: string | null }
const SAVED_SCRIPT = '/saved/service-worker.js', ROOT_SCRIPT = '/offline-entry-worker.js', PUBLIC_PREFIX = 'houseatlas-saved-public-';
function workers(registration: ServiceWorkerRegistration): ServiceWorker[] {
  return [...new Set([registration.installing, registration.waiting, registration.active].filter((worker): worker is ServiceWorker => worker !== null))];
}
function owned(registration: ServiceWorkerRegistration, script: string): boolean {
  const entries = workers(registration);
  return entries.length > 0 && entries.every(worker => worker.scriptURL === new URL(script, location.origin).href);
}
async function activated(registration: ServiceWorkerRegistration): Promise<ServiceWorker | null> {
  const worker = registration.installing ?? registration.waiting ?? registration.active;
  if (!worker) return null;
  if (worker.state !== 'activated') await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => { worker.removeEventListener('statechange', changed); reject(new Error('Public shell verification did not finish')); }, 60_000);
    const changed = () => {
      if (worker.state === 'activated' || worker.state === 'redundant') {
        clearTimeout(timer); worker.removeEventListener('statechange', changed);
        if (worker.state === 'activated') resolve(); else reject(new Error('Public shell unavailable'));
      }
    };
    worker.addEventListener('statechange', changed); changed();
  });
  return worker;
}
async function status(worker: ServiceWorker, message: string): Promise<SavedShellStatus> {
  return new Promise((resolve, reject) => {
    const channel = new MessageChannel(), timer = setTimeout(() => { channel.port1.close(); reject(new Error('Public shell status unavailable')); }, 60_000);
    channel.port1.onmessage = event => {
      clearTimeout(timer); channel.port1.close(); const value: unknown = event.data;
      if (value && typeof value === 'object' && 'ready' in value && 'buildId' in value
        && typeof value.ready === 'boolean' && typeof value.buildId === 'string' && /^[a-f0-9]{64}$/.test(value.buildId))
        resolve({ ready: value.ready, buildId: value.buildId });
      else resolve({ ready: false, buildId: null });
    };
    worker.postMessage(message, [channel.port2]);
  });
}
/** True once the root worker answers for exactly this build; false when a foreign worker owns the root. */
async function prepareRootEntry(expectedBuild: string): Promise<boolean> {
  const prior = await navigator.serviceWorker.getRegistration('/');
  if (prior?.scope === new URL('/', location.origin).href && !owned(prior, ROOT_SCRIPT)) return false;
  const registration = await navigator.serviceWorker.register(ROOT_SCRIPT, { scope: '/', updateViaCache: 'none' });
  try { await registration.update(); } catch { /* Existing installed build is checked below. */ }
  const worker = await activated(registration);
  if (!worker || !owned(registration, ROOT_SCRIPT)) return false;
  const result = await status(worker, 'root-entry-status');
  if (!result.ready || result.buildId !== expectedBuild) throw new Error('Root entry build unavailable');
  return true;
}
/** Registration is not readiness: the scoped worker verifies the full committed
 * public closure before answering. No online/session/storage permission probe.
 * The live app calls this after every launch, so a later launch without the
 * server opens the Saved entry; the Saved entry and Prepare call it too. */
export async function verifySavedShell(): Promise<SavedShellStatus> {
  if (!('serviceWorker' in navigator)) return { ready: false, buildId: null };
  let expectedBuild = document.querySelector<HTMLMetaElement>('meta[name="houseatlas-saved-shell-build"]')?.content;
  if (!expectedBuild) {
    // The generated fixture is outside /saved/. Read only the public production
    // entry to identify the intended build; no private/application route runs.
    const response = await fetch('/saved/index.html', { credentials: 'omit', redirect: 'error', cache: 'no-store' });
    if (!response.ok || response.headers.get('content-type')?.split(';')[0]?.trim() !== 'text/html') return { ready: false, buildId: null };
    const bytes = await response.arrayBuffer(); if (bytes.byteLength > 4_000_000) return { ready: false, buildId: null };
    expectedBuild = new TextDecoder().decode(bytes).match(/name="houseatlas-saved-shell-build" content="([a-f0-9]{64})"/)?.[1];
  }
  if (!expectedBuild || !/^[a-f0-9]{64}$/.test(expectedBuild)) return { ready: false, buildId: null };
  const prior = await navigator.serviceWorker.getRegistration('/saved/');
  if (prior?.scope === new URL('/saved/', location.origin).href && !owned(prior, SAVED_SCRIPT)) return { ready: false, buildId: null };
  const registration = await navigator.serviceWorker.register('/saved/service-worker.js', { scope: '/saved/', updateViaCache: 'none' });
  // An updated page cannot stamp a new Save with a retained old shell.
  try { await registration.update(); } catch { /* Expected build is still checked below. */ }
  const worker = await activated(registration);
  if (!worker || !owned(registration, SAVED_SCRIPT)) return { ready: false, buildId: null };
  const value = await status(worker, 'saved-shell-status');
  if (!value.ready || value.buildId !== expectedBuild) return { ready: false, buildId: null };
  // Root entry needs no private capture. Root availability is not part of the
  // Saved receipt/status. The page never prunes: a concurrent worker can finish
  // installing after a registration check. Each worker's activation keeps the
  // builds both scopes run plus the previous one (offline-worker-source.js).
  try { await prepareRootEntry(expectedBuild); }
  catch { /* Saved closure remains independently verified. */ }
  return { ready: true, buildId: value.buildId };
}

/** Explicit local cleanup of only this displayed build's owned registrations. */
export async function removeSavedShell(buildId: string): Promise<void> {
  if (!/^[a-f0-9]{64}$/.test(buildId)) throw new Error('Saved shell identity missing');
  for (const [scope, script, message] of [['/', ROOT_SCRIPT, 'root-entry-status'], ['/saved/', SAVED_SCRIPT, 'saved-shell-status']] as const) {
    const registration = await navigator.serviceWorker.getRegistration(scope);
    if (registration?.scope !== new URL(scope, location.origin).href || !owned(registration, script)) continue;
    const entries = workers(registration);
    // Never unregister a newer build, a worker still installing, or a foreign
    // registration. Status verifies identity even if its cache was removed.
    if (!entries.every(worker => worker.state === 'activated')) continue;
    const states = await Promise.all(entries.map(worker => status(worker, message)));
    if (!states.every(value => value.buildId === buildId)) continue;
    const current = workers(registration);
    if (current.length !== entries.length || !current.every(worker => entries.includes(worker)) || !owned(registration, script)) continue;
    await registration.unregister();
  }
  await caches.delete(PUBLIC_PREFIX + buildId);
}
