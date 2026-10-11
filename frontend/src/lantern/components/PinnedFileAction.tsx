import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import {
  PinnedFileError,
  pinnedAttemptKey,
  pinnedCapturable,
  samePinnedSource,
  type PinnedFileAvailability,
  type PinnedFileCapture,
  type PinnedFileDiscovery,
  type PinnedFileUnknownRecord,
  type PinnedSourceRef,
} from '../../api/pinned-file-client';
import { useStore } from '../state/store';

type DiscoveryState =
  | { readonly status: 'loading' }
  | { readonly status: 'failed'; readonly httpStatus: number | null }
  | { readonly status: 'ready'; readonly discovery: PinnedFileDiscovery };
/** A null availability means the single availability check is still running. */
type CaptureState =
  | { readonly status: 'capturing' }
  | { readonly status: 'refused' }
  | { readonly status: 'unknown' }
  | { readonly status: 'captured'; readonly capture: PinnedFileCapture; readonly availability: PinnedFileAvailability | null };
interface Slot<T> {
  readonly key: object;
  readonly value: T;
}

const noSubscription = () => () => {};
const noSnapshot = () => null;
const http = (status: number | null) => (status === null ? '' : ` (HTTP ${status})`);
const within = (ms: number) => (ms < 1000 ? 'under 1 s' : `${Math.floor(ms / 1000)} s`);
const unknownOutcome = (statuses: readonly (number | null)[]) =>
  `Capture outcome unknown${statuses.length ? ` (${statuses.map((status) => (status === null ? 'no HTTP status' : `HTTP ${status}`)).join(', ')})` : ''}. A local copy may have been issued without being delivered; no download is available from ${statuses.length > 1 ? `those ${statuses.length} attempts` : 'that attempt'}.`;
function noOffer(availability: Extract<PinnedFileAvailability, { state: 'none' }>): string {
  switch (availability.observed) {
    case 'unavailable':
      return ' (unavailable)';
    case 'unbound':
      return ' (no bound owner)';
    case 'expired':
      return ' (expired before display)';
    case 'error':
      return http(availability.status);
    default:
      return '';
  }
}

/** Explicit local HomeBox copy for one projected stored attachment. Discovery is
 * informational; capture runs only on click and each read is authorized anew.
 * Session, scope, source or render changes abort reads and mask results. */
export function PinnedFileAction({ docId }: { docId: string }) {
  const { projection, actions } = useStore();
  const client = actions.pinnedFiles;
  const scope = projection.view.scope;
  const entry = projection.entries.get(docId);
  const attachment = projection.attachments.get(docId);
  const attachmentId = attachment?.kind === 'stored-file' ? attachment.attachmentId : null;
  // Exact original six-field reference; compared as supplied, never normalized.
  const source = useMemo<PinnedSourceRef | null>(
    () => (entry ? Object.freeze({
      workspaceId: entry.workspaceId,
      homeId: entry.homeId,
      key: Object.freeze({
        sourceInstanceId: entry.source.sourceInstanceId,
        collectionId: entry.source.collectionId,
        sourceKind: entry.source.sourceKind,
        externalId: entry.source.externalId,
      }),
    }) : null),
    [entry],
  );
  const identity = useSyncExternalStore<object | null>(
    client?.subscribeSessionBinding ?? noSubscription, client?.getBindingIdentity ?? noSnapshot, noSnapshot);
  const prior = useSyncExternalStore<PinnedFileUnknownRecord | null>(
    client?.subscribeUnknown ?? noSubscription,
    () => (client && identity && source && attachmentId !== null ? client.getUnknown(identity, source, attachmentId) : null),
    noSnapshot);
  const bound = client && identity ? client.getBindingScope(identity) : null;
  const live = !!bound && !!source && bound.workspaceId === scope.workspaceId && bound.homeId === scope.homeId
    && source.workspaceId === scope.workspaceId && source.homeId === scope.homeId;
  const capturable = !!source && attachmentId !== null && pinnedCapturable(source, attachmentId);
  const sourceKey = source && attachmentId !== null ? pinnedAttemptKey(source, attachmentId) : '';
  const slotKey = useMemo<object>(() => ({}), [client, identity, docId, sourceKey, scope.workspaceId, scope.homeId, live, capturable]);
  const [discovery, setDiscovery] = useState<Slot<DiscoveryState> | null>(null);
  const [captured, setCaptured] = useState<Slot<CaptureState> | null>(null);
  const [, setTick] = useState(0);
  const discoveryController = useRef<AbortController | null>(null);
  const captureController = useRef<AbortController | null>(null);

  const discoveryNow = discovery?.key === slotKey ? discovery.value : null;
  const captureNow = captured?.key === slotKey ? captured.value : null;
  const availability = captureNow?.status === 'captured' ? captureNow.availability : null;
  const offer = availability?.state === 'offer' ? availability.offer : null;
  const busy = captureNow?.status === 'capturing' || (captureNow?.status === 'captured' && captureNow.availability === null);
  const matched = discoveryNow?.status === 'ready' && !!source
    && discoveryNow.discovery.installedSources.some((row) => samePinnedSource(row, source));

  const discover = (key: object) => {
    if (!client || identity === null) return;
    discoveryController.current?.abort();
    const controller = new AbortController();
    discoveryController.current = controller;
    const current = () => !controller.signal.aborted && discoveryController.current === controller;
    setDiscovery({ key, value: { status: 'loading' } });
    void client.discover(identity, controller.signal).then(
      (found) => { if (current()) setDiscovery({ key, value: { status: 'ready', discovery: found } }); },
      (error: unknown) => {
        if (current()) setDiscovery({ key, value: { status: 'failed', httpStatus: error instanceof PinnedFileError ? error.status : null } });
      },
    );
  };
  const capture = async () => {
    const ready = discoveryNow?.status === 'ready' ? discoveryNow.discovery : null;
    if (!client || !live || !ready || !matched || !source || attachmentId === null || busy) return;
    captureController.current?.abort();
    const controller = new AbortController();
    captureController.current = controller;
    const key = slotKey;
    const current = () => !controller.signal.aborted && captureController.current === controller;
    setCaptured({ key, value: { status: 'capturing' } });
    let result: PinnedFileCapture;
    try {
      result = await client.capture(ready, source, attachmentId, controller.signal);
    } catch (error) {
      // Only a local refusal proves nothing was sent; everything else stays unknown.
      if (current()) setCaptured({ key, value: error instanceof PinnedFileError && !error.sent ? { status: 'refused' } : { status: 'unknown' } });
      return;
    }
    if (!current()) return;
    setCaptured({ key, value: { status: 'captured', capture: result, availability: null } });
    let observed: PinnedFileAvailability;
    try {
      observed = await client.resolve(result, controller.signal);
    } catch {
      if (current()) setCaptured({ key, value: { status: 'captured', capture: result, availability: Object.freeze({ state: 'none', observed: 'error', status: null }) } });
      return;
    }
    if (current()) setCaptured({ key, value: { status: 'captured', capture: result, availability: observed } });
  };

  useEffect(() => {
    if (live && capturable) discover(slotKey);
    return () => {
      discoveryController.current?.abort();
      discoveryController.current = null;
      captureController.current?.abort();
      captureController.current = null;
    };
    // slotKey changes with every binding, scope, source or render input.
  }, [slotKey]);
  useEffect(() => {
    if (!offer) return undefined;
    const timer = setTimeout(() => setTick((tick) => tick + 1), Math.min(Math.max(0, offer.expiresAt - performance.now()) + 1, 2_147_483_647));
    return () => clearTimeout(timer);
  }, [offer]);
  const offerLive = offer !== null && client?.isOfferCurrent(offer) === true;

  if (!client || attachmentId === null || !source) return null;
  const artifact = captureNow?.status === 'captured' ? captureNow.capture.artifact : null;
  return (
    <>
      <h3>Local copy</h3>
      {!capturable ? (
        <p className="fine">Unavailable: this source or attachment has an invalid HomeBox identifier.</p>
      ) : !live ? (
        <p className="fine">Unavailable: session or home is not current.</p>
      ) : (
        <>
          {(discoveryNow === null || discoveryNow.status === 'loading') && <p className="fine" role="status">Checking local file sources…</p>}
          {discoveryNow?.status === 'failed' && (
            <>
              <p className="fine" role="status">Local file sources could not be checked{http(discoveryNow.httpStatus)}.</p>
              <button type="button" className="btn btn-small" onClick={() => discover(slotKey)}>Check sources</button>
            </>
          )}
          {discoveryNow?.status === 'ready' && !matched && <p className="fine">This record’s source is not an enumerable local HomeBox file source.</p>}
          {prior ? (
            <p className="fine" role="status">{unknownOutcome(prior.statuses)}</p>
          ) : captureNow?.status === 'unknown' && <p className="fine" role="status">{unknownOutcome([])}</p>}
          {matched && (
            <button type="button" className="btn" disabled={busy} onClick={() => void capture()}>
              {captureNow || prior ? 'Capture again (new read)' : 'Capture local copy'}
            </button>
          )}
          {captureNow?.status === 'capturing' && <p className="fine" role="status">Capturing local copy…</p>}
          {captureNow?.status === 'refused' && <p className="fine" role="status">Capture not sent: session, home or source checks did not pass.</p>}
          {artifact && (
            <>
              <dl className="facts">
                <div><dt>Copy</dt><dd>Process-local snapshot, not a HomeBox version</dd></div>
                <div><dt>SHA-256</dt><dd style={{ overflowWrap: 'anywhere' }}>{artifact.sha256}</dd></div>
                <div><dt>Size</dt><dd>{artifact.byteSize} bytes</dd></div>
                <div>
                  <dt>Recorded media type</dt>
                  <dd style={{ overflowWrap: 'anywhere', whiteSpace: 'pre-wrap' }}>
                    {artifact.contentType === null ? 'Not supplied' : artifact.contentType === '' ? 'Empty value' : <code>{artifact.contentType}</code>}
                  </dd>
                </div>
                <div><dt>First check retrieved</dt><dd>{artifact.localCapture.beforeRetrievedAt}</dd></div>
                <div><dt>File retrieved</dt><dd>{artifact.localCapture.bodyRetrievedAt}</dd></div>
                <div><dt>Final check retrieved</dt><dd>{artifact.localCapture.afterRetrievedAt}</dd></div>
              </dl>
              {availability === null && <p className="fine" role="status">Checking download availability…</p>}
              {offer && (offerLive ? (
                <p>
                  <a className="btn" href={offer.href} download rel="noopener" referrerPolicy="same-origin">Download local copy</a>
                  <span className="fine"> Link valid for at most {within(offer.remainingMs)} from the availability check.</span>
                </p>
              ) : (
                <p className="fine" role="status">Download link expired. Another capture is a new read.</p>
              ))}
              {availability?.state === 'none' && (
                <p className="fine" role="status">No download link for this capture{noOffer(availability)}. This does not show that no copy was retained.</p>
              )}
            </>
          )}
        </>
      )}
    </>
  );
}
