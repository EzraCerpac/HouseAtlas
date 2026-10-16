import { useEffect, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { loadStandardGlb, type StandardGlb } from '../canonical-ifc/standard-glb';
import { GlbFormatError, STANDARD_GLB_LIMITS } from '../canonical-ifc/glb-preflight';
import { RENDER_LIMITS } from '../canonical-ifc/MeshLayer';
import { declaredHex, hex, notDrawnReason, planReason, PLAN_CONTENT_TYPE, readPlan, readSitePublication, SITE_LIMITS, SitePublicationError,
  type SitePlan } from './publication';
import { createSiteBudget, createTurns, planPoints, runLimited, type SiteBudgetLimits } from './site-budget';
import type { SiteAsset, SitePin, SitePublication, SiteSourcePort } from './types';
import { stageMark } from '../observability/stage-timing';

export type SiteAssetOutcome =
  | { readonly status: 'drawn'; readonly asset: SiteAsset; readonly glb: StandardGlb; readonly keyPrefix: string }
  | { readonly status: 'plan'; readonly asset: SiteAsset; readonly plan: SitePlan }
  | { readonly status: 'not-drawn' | 'unavailable'; readonly asset: SiteAsset; readonly reason: string };

export type SiteState =
  | { readonly status: 'loading' }
  | { readonly status: 'invalidated'; readonly reason: string }
  | { readonly status: 'failed'; readonly message: string }
  | { readonly status: 'ready'; readonly publication: SitePublication; readonly assets: readonly SiteAssetOutcome[] };

const LOADING: SiteState = { status: 'loading' };

/** Shared limits for one publication. The prepared scene equals the
 * renderer's upload limit, so everything admitted can be drawn. */
export const SITE_SCENE_LIMITS: SiteBudgetLimits & { readonly reads: number } = Object.freeze({
  inputBytes: 4 * STANDARD_GLB_LIMITS.bytes, preparedBytes: RENDER_LIMITS.uploadBytes, planPoints: SITE_LIMITS.planCoordinates,
  /** Artifact reads in flight; GLB loads run one at a time in publication order. */
  reads: 2 });
class CapacityRefusal extends Error {}
/** A parsed source plan not yet admitted to the publication's plan budget. */
interface PlanRead { readonly unadmitted: SitePlan }
const message = (error: unknown, fallback: string) => error instanceof SitePublicationError || error instanceof GlbFormatError ? error.message : fallback;

/** Reads one pinned publication through the injected ports.
 *
 * Invalidation is subscribed for the exact publication/version before any
 * read, every read carries the owner's signal, and every result is fenced by
 * the owner token, pin and signal before it installs. Invalidation hides the
 * stage element, aborts reads and commits the cleared state synchronously, so
 * the WebGL layer releases its buffers before the callback returns.
 *
 * Reads run at most SITE_SCENE_LIMITS.reads at a time. Each GLB reserves its
 * declared bytes before reading and its prepared geometry from the actual
 * preflight counts before the loader allocates; loads run one at a time in
 * publication order. A source plan is parsed during its read but admitted to
 * the plan budget only in its publication-order turn, so read completion order
 * never decides which plan is shown. Assets beyond the budget are not drawn
 * and say why. */
export function useSitePublication(port: SiteSourcePort, stage: { readonly current: HTMLElement | null }) {
  const [state, setState] = useState<{ readonly owner: object; readonly port: SiteSourcePort; readonly pin: SitePin; readonly state: SiteState } | null>(null);
  const owner = useRef<object | null>(null);
  const { publicationId, version } = port.selection;
  useEffect(() => {
    const mine = {}, controller = new AbortController(), { signal } = controller;
    const pin = { publicationId, version };
    owner.current = mine;
    let inEffect = true;
    const commit = (next: SiteState) => {
      if (owner.current !== mine) return;
      if (inEffect) setState({ owner: mine, port, pin, state: next });
      else flushSync(() => setState({ owner: mine, port, pin, state: next }));
    };
    const invalidate = (reason: string) => {
      if (owner.current !== mine || signal.aborted) return;
      stage.current?.setAttribute('hidden', '');
      controller.abort();
      stageMark('site', 'invalidated');
      commit({ status: 'invalidated', reason: typeof reason === 'string' && reason ? reason : 'The publication was withdrawn.' });
    };
    // Subscribe first: an invalidation during any read below clears it.
    const unsubscribe = port.subscribeInvalidation(pin, invalidate);
    if (!signal.aborted) setState({ owner: mine, port, pin, state: LOADING });
    inEffect = false;
    const current = () => owner.current === mine && !signal.aborted;
    const budget = createSiteBudget(SITE_SCENE_LIMITS);
    const unavailable = (asset: SiteAsset, error: unknown): SiteAssetOutcome => {
      signal.throwIfAborted();
      return { status: 'unavailable', asset, reason: message(error, 'This asset could not be read') };
    };
    /** Reads and verifies one asset. A GLB comes back as verified bytes still
     * to load and a plan as parsed shapes still to admit. */
    const read = async (asset: SiteAsset, publication: SitePublication): Promise<SiteAssetOutcome | ArrayBuffer | PlanRead> => {
      const request = { ...pin, assetId: asset.assetId, expectedSha256: asset.sha256, expectedBytes: asset.bytes, signal };
      if (asset.contentType === PLAN_CONTENT_TYPE) {
        const refused = planReason(publication.siteFrame);
        if (refused) return { status: 'not-drawn', asset, reason: refused };
        if (!port.readSourcePlan) return { status: 'not-drawn', asset, reason: 'No source plan reader is connected' };
        const value = await port.readSourcePlan(request);
        signal.throwIfAborted();
        return { unadmitted: readPlan(value, publication.siteFrame.originSource) };
      }
      const refused = notDrawnReason(asset, publication.siteFrame)
        ?? (asset.bytes > STANDARD_GLB_LIMITS.bytes ? 'Not drawn: it is larger than the model preview limit' : null)
        // Reserved synchronously as each read starts, so in publication order.
        ?? budget.reserveInput(asset.bytes);
      if (refused) return { status: 'not-drawn', asset, reason: refused };
      const bytes = await port.readArtifact(request);
      signal.throwIfAborted();
      if (!(bytes instanceof ArrayBuffer) || bytes.byteLength !== asset.bytes) return { status: 'unavailable', asset, reason: 'The bytes read do not match the pinned size' };
      if (await hex(bytes) !== declaredHex(asset.sha256)) return { status: 'unavailable', asset, reason: 'The bytes read do not match the pinned SHA-256' };
      signal.throwIfAborted();
      return bytes;
    };
    /** Loads verified GLB bytes after reserving the prepared scene from the preflight counts. */
    const load = async (asset: SiteAsset, bytes: ArrayBuffer, at: number): Promise<SiteAssetOutcome> => {
      signal.throwIfAborted();
      const keyPrefix = `site${at}`;
      let reserved = 0;
      try {
        const glb = await loadStandardGlb(new Uint8Array(bytes), keyPrefix, signal, admission => {
          const over = budget.reservePrepared(admission.work.triangles);
          if (over) throw new CapacityRefusal(over);
          reserved = admission.work.triangles;
        });
        return { status: 'drawn', asset, keyPrefix, glb };
      } catch (error) {
        budget.releasePrepared(reserved);
        if (error instanceof CapacityRefusal) return { status: 'not-drawn', asset, reason: error.message };
        throw error;
      }
    };
    (async () => {
      stageMark('site', 'publication-start');
      const value = await port.loadPublication({ ...pin, signal });
      signal.throwIfAborted();
      const publication = readSitePublication(value, pin);
      stageMark('site', 'publication-read');
      const turns = createTurns(publication.assets.length);
      const assets = await runLimited(publication.assets.length, SITE_SCENE_LIMITS.reads, async at => {
        const asset = publication.assets[at]!;
        // Every index takes its turn exactly once, even after a failed or
        // aborted read, so a later load never waits on a missing turn.
        const result = await read(asset, publication).then(value => ({ value }), (error: unknown) => ({ error }));
        return turns.take(at, async (): Promise<SiteAssetOutcome> => {
          if ('error' in result) return unavailable(asset, result.error);
          const { value } = result;
          if (value instanceof ArrayBuffer) return load(asset, value, at).catch((error: unknown) => unavailable(asset, error));
          if ('unadmitted' in value) {
            signal.throwIfAborted();
            const over = budget.reservePlan(planPoints(value.unadmitted));
            return over ? { status: 'not-drawn', asset, reason: over } : { status: 'plan', asset, plan: value.unadmitted };
          }
          return value;
        });
      });
      if (!current()) return;
      commit({ status: 'ready', publication, assets });
      stageMark('site', 'scene-ready');
    })().catch((error: unknown) => {
      if (current()) commit({ status: 'failed', message: message(error, 'This site publication could not be read.') });
    });
    return () => {
      // Unmount or a new pin: unsubscribe, abort and drop every result.
      owner.current = null;
      controller.abort();
      unsubscribe();
    };
  }, [port, publicationId, version, stage]);
  // Render can precede passive-effect cleanup: the old owner's ready state
  // must never paint under a replacement port or publication/version pin.
  return state && state.port === port && state.pin.publicationId === publicationId && state.pin.version === version
    && state.owner === owner.current ? state.state : LOADING;
}
