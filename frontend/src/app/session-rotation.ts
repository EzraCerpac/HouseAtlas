import type { AtlasSessionInfo } from './session';

/** A caller explicitly requests rotation. The old intent is never submitted
 * here. An uncertain POST requires a separate canonical check, never a retry. */
export async function reconcileSessionRotation(
  read: (signal: AbortSignal) => Promise<AtlasSessionInfo | null>,
  rotate: (current: AtlasSessionInfo, signal: AbortSignal) => Promise<AtlasSessionInfo>,
  signal: AbortSignal,
): Promise<AtlasSessionInfo> {
  signal.throwIfAborted();
  const before = await read(signal);
  signal.throwIfAborted();
  if (!before || !(Date.parse(before.expiresAt) > Date.now())) throw new Error('Current session required');
  const receipt = await rotate(before, signal);
  signal.throwIfAborted();
  if (receipt.actorId !== before.actorId || receipt.expiresAt !== before.expiresAt)
    throw new Error('Session rotation changed identity or expiry');
  const canonical = await read(signal);
  signal.throwIfAborted();
  // Native session GET exposes a stable marker derived from the exact cookie;
  // the issued receipt's nonce differs from that canonical representation.
  if (!canonical || canonical.actorId !== receipt.actorId || canonical.expiresAt !== receipt.expiresAt
    || canonical.csrfToken === before.csrfToken
    || !(Date.parse(canonical.expiresAt) > Date.now())) throw new Error('Check the current session');
  return canonical;
}
