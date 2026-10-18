export interface SavedShellStatus { readonly ready: boolean; readonly buildId: string | null }
/** Registration is not readiness: the scoped worker verifies the full committed
 * public closure before answering. No online/session/storage permission probe. */
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
  const registration = await navigator.serviceWorker.register('/saved/service-worker.js', { scope: '/saved/', updateViaCache: 'none' });
  // An updated page cannot stamp a new Save with a retained old shell.
  try { await registration.update(); } catch { /* Expected build is still checked below. */ }
  const worker = registration.installing ?? registration.waiting ?? registration.active;
  if (!worker) return { ready: false, buildId: null };
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
  return new Promise((resolve, reject) => {
    const channel = new MessageChannel(), timer = setTimeout(() => { channel.port1.close(); reject(new Error('Public shell status unavailable')); }, 60_000);
    channel.port1.onmessage = event => {
      clearTimeout(timer); channel.port1.close(); const value: unknown = event.data;
      if (value && typeof value === 'object' && 'ready' in value && value.ready === true && 'buildId' in value
        && typeof value.buildId === 'string' && value.buildId === expectedBuild) resolve({ ready: true, buildId: value.buildId });
      else resolve({ ready: false, buildId: null });
    };
    worker.postMessage('saved-shell-status', [channel.port2]);
  });
}

/** Explicit local cleanup of only this verified saved build and exact scope. */
export async function removeSavedShell(buildId: string): Promise<void> {
  if (!/^[a-f0-9]{64}$/.test(buildId)) throw new Error('Saved shell identity missing');
  const registration = await navigator.serviceWorker.getRegistration('/saved/');
  if (registration?.scope === new URL('/saved/', location.origin).href) await registration.unregister();
  await caches.delete('houseatlas-saved-public-' + buildId);
}
