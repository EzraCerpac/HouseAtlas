/** Owned offline-launch fixture resources only; no process discovery or user profiles. */
import { rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, isAbsolute, resolve } from 'node:path';

function within(promise, ms) {
  return new Promise(resolve => {
    const timer = setTimeout(() => resolve(false), ms);
    promise.then(() => { clearTimeout(timer); resolve(true); });
  });
}

/** Attach immediately after spawn so an early exit/close cannot be missed.
 * Browser.close acknowledgement is not evidence that its process or pipes closed. */
export function trackOfflineBrowser(child, { graceMs = 2000, termMs = 2000, killMs = 3000 } = {}) {
  for (const [value, maximum] of [[graceMs, 2000], [termMs, 2000], [killMs, 3000]])
    if (!Number.isSafeInteger(value) || value <= 0 || value > maximum)
      throw new Error('Invalid owned-browser shutdown budget');
  let closed = false, exited = child.exitCode !== null || child.signalCode !== null;
  const closure = new Promise(resolve => child.once('close', () => { closed = true; resolve(); }));
  child.once('exit', () => { exited = true; });
  let stopping;
  return requestClose => stopping ??= (async () => {
    if (!closed) {
      // A silent protocol pipe must not prevent the owned-process deadline.
      void Promise.resolve().then(requestClose).catch(() => {});
      if (await within(closure, graceMs)) return;
    } else return;
    const signal = name => { if (!exited) { try { child.kill(name); } catch { /* closure still has its deadline */ } } };
    signal('SIGTERM');
    if (await within(closure, termMs)) return;
    signal('SIGKILL');
    if (await within(closure, killMs)) return;
    // Release only our handles so the failing harness can terminate. This is
    // not a claim that an unresponsive child or its descendants disappeared.
    for (const pipe of child.stdio ?? []) pipe?.destroy?.();
    child.unref?.();
    throw new Error('Owned offline browser did not close within shutdown budget; synthetic profile retained');
  })();
}

/** Bounded retries for a generated directory created by this fixture. Call only
 * after confirmed browser close. Delayed browser helpers may still release files. */
export async function removeOfflineScratch(directory, { remove = rmSync, retryDelayMs = 100, retries = 5 } = {}) {
  if (!Number.isSafeInteger(retries) || retries < 0 || retries > 5
    || !Number.isSafeInteger(retryDelayMs) || retryDelayMs < 0 || retryDelayMs > 100)
    throw new Error('Invalid owned-profile retry budget');
  if (!isAbsolute(directory) || resolve(dirname(directory)) !== resolve(tmpdir())
    || !/^houseatlas-offline-launch-[a-zA-Z0-9]+$/.test(basename(directory)))
    throw new Error('Refusing cleanup outside the owned offline-launch scratch namespace');
  for (let attempt = 0; ; attempt++) {
    try { remove(directory, { recursive: true, force: true }); return; }
    catch (error) {
      if (!['ENOTEMPTY', 'EBUSY', 'EPERM'].includes(error?.code) || attempt >= retries) throw error;
      await new Promise(resolve => setTimeout(resolve, retryDelayMs));
    }
  }
}
