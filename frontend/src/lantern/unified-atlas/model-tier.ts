/** Which tier an Atlas stage reads and which it asks the 3D layer to draw.
 * The model whose meshes are on screen (`displayed`) owns picking, labels and
 * every other read of the stage, so drawing and picking never use different
 * tiers. Nothing is on screen yet: read and draw Light, so Light shows first
 * however fast Full arrives. Then Full, once bound, is drawn behind it and
 * takes over only when the 3D layer shows its meshes. */
interface Tier { readonly meshes: readonly object[] }
export function stageTier<M extends Tier>(light: M, full: M | null, displayed: M | null): { readonly model: M; readonly target: M } {
  return { model: displayed ?? light, target: displayed !== null && full !== null ? full : light };
}
/** The model a shown mesh set belongs to: the current target's, or null for a set it no longer wants. */
export function shownTier<M extends Tier>(target: M, meshes: readonly object[]): M | null {
  return meshes === target.meshes ? target : null;
}
