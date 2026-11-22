import {
  useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type CSSProperties, type FocusEvent,
  type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent,
} from 'react';
import { createPortal } from 'react-dom';
import { Icon } from '../components/Icon';
import { useReducedMotion, useSelect, useStore } from '../state/store';
import { kindOf } from '../data/query';
import type { TopologyContext } from '../topology/TopologyProvider';
import { homeboxPlaceOf, homeboxPlaceRecords } from '../topology/homebox-place';
import { useEased } from '../atlas/useCamera';
import { BIRCH_DARK, CARD } from '../atlas/palette';
import { frameZoomMinimum, makeProjection, relativePath, type DrawRules, type PreparedMesh, type Projection, type Viewport } from '../canonical-ifc/geometry';
import { DETAIL_GLB_LIMITS, GlbFormatError, type GlbAdmission } from '../canonical-ifc/glb-preflight';
import type { StandardGlb } from '../canonical-ifc/standard-glb';
import { firstHouseDrawn, noteFirstModel, noteLoadStep } from '../canonical-ifc/load-ledger';
import { MeshLayer, RENDER_LIMITS, type MeshPalette } from '../canonical-ifc/MeshLayer';
import { afterNextFrame } from '../canonical-ifc/after-next-frame';
import { PITCH_3D, useStageCamera, type StageFraming } from '../canonical-ifc/useStageCamera';
import { TONE_COLOR, badgeFill, toneTint } from '../canonical-ifc/tones';
import { PREPARED_BYTES_PER_TRIANGLE } from '../site-artifacts/site-budget';
import { createLiveAtlasPresentationPort, savedAtlasInitialState } from '../../offline/saved-atlas-presentation';
import type { AtlasPresentationPort, AtlasPresentationSelection } from './types';
import {
  admitAtlasDisplayForRead, atlasOrigin, atlasReducer, atlasSurroundings, bindAtlasModel, displayLevelAnchor, displayLevelLabel, contextOccurrenceIds, easePresentation, frameBox, hasExplodableLevels, initialAtlasState, isAtlasGlazing, labelHeight,
  levelLift, occurrenceFloorHeight, occurrenceLiftLevel, partLifts, partSectionTargets, partSectionCuts, pickTarget, plainLabelInFocus, planFeaturesForLevel, planPickTarget, presentAtlas, sectionCeilings, sectionCuts, sectionGoals, sectionTargets,
  targetAction, type AtlasAction, type AtlasLayer, type AtlasModel, type AtlasViewState, type OverlayLayerIndex,
} from './scene';
import { AtlasReadError, createStartLedger, type AtlasReadFailure, type MeshRole, type OverlayKind, type StoredAtlasRead, type UnifiedAtlasPort,
  type UnifiedAtlasRead } from './types';
import { atlasLevelName, atlasScopedLevelName, countClearedLabelY, drawnRoomFloors, drawnRoomNames, countMarkerTarget, countMarkerWidth, LABEL_TAG_RISE, placePlanRoomLabels, placeStageLabels, drawnStageLabels, labelHitHeight, unnamedRooms, nextUnnamedSnapshot, type UnnamedSnapshot, planLabelFrame, planLabelObstacles, stageLabelBox, stageLabelHeight, stageLabelPad,
  planRoomLabelFits, preparePlanLabelPaper, atlasBuildingName, atlasOccurrenceName, preparePlanLabelShape, visibleCountMarkers, labelHitBoxes, stageHitStyle, type CountMarker, type PlanLabelInput, type RoomLabel } from './labels';
import { documentaryOverlayIndex } from './runtime-overlays';
import { carriesMeasurements, edgeSpans, estimatedOccurrences, placeLabels, roomArea } from './measurements';
import { useDocumentaryOverlays } from './useDocumentaryOverlays';
import { modelUpdatesAllowed, useModelUpdates } from './model-updates';
import { fullModelWanted, useModelQuality } from './model-quality';
import { daylightAt, resolveSunPlace, stageBackdrop, stageColors } from './daylight';
import { showModelGeographic, useSunLocation } from './sun-place';
import { DaylightControl, useLightingTime } from './DaylightControl';
import { shownTier, stageTier } from './model-tier';
import { NetworkGraph, type StageTrace } from './NetworkGraph';
import { currentStageTrace, publishStageTrace } from './network-trace';
import { LayerDetailsDock, useLayerDetailsFocus, useShortLayerDetails } from './LayerDetailsDock';
import { NetworkStageConnections, networkRoomConnections, networkStubEnd, networkStubLength, type NetworkDeviceAnchor } from './NetworkStageConnections';
import { admittedNetworkDevices, NETWORK_GLYPHS, networkGlyphOffset, networkGlyphSlot, networkGlyphSlots, networkUnplacedReason } from './network-map';
import { linkTouches, networkCardContent, type NetworkFocus } from './NetworkCard';
import { InternetSpeeds, type NetworkCollector } from './NetworkTests';
import { createCollectorStore, scopeKey } from './network-tests';
import { networkConnectionNodeKey } from './network-connections';
import { PLAN_ORDER, PlanRoom, PlanTile, planTileLevels } from './plan-presentation';
import { OVERLAY_ICON, OVERLAY_KINDS, OVERLAY_LABEL, plural, stampTime } from './atlas-text';
import { FloorStack } from './FloorStack';
import { RadioCardSlot, RadioRingsSlot, type RingPlace } from './RadioCard';
import { browserRadioEnvironment, createRadioFeed, radioPlacement, type RadioFeed, type RadioFeedState } from './radio';
import { Inspector, listedLevels, RoomList, type RoomBelongingsSource, type RoomBelongingsState } from './AtlasInspector';
import { electricalGroups } from './electrical-group';
import type { ElectricalTraceSource } from './electrical-trace';
import type { NetworkOverlayDevice } from '../overlays/network/types';
import { MeasurementKey, OverlayKey } from './AtlasKeys';
import '../canonical-ifc/canonical-ifc.css';
import './unified-atlas.css';

/** One Atlas for the selected Blender/Bonsai publication: buildings, floors,
 * rooms and the same publication's plans in one renderer, one selection and
 * one camera on one Lantern stage. Every transition re-targets eased values
 * (frame, explosion, each building's section plane, camera), so the latest
 * action always wins; reduced motion snaps. */

/** A stored copy on screen while its fresh read is still running or has failed in transport. */
export interface StoredCopy { readonly storedAt: string; readonly refresh: 'pending' | 'failed' | 'held' }
type Outcome = { readonly status: 'ready'; readonly model: AtlasModel; readonly entryBuildingId: string | null | undefined; readonly stored?: StoredCopy;
    readonly start?: UnifiedAtlasRead['start'] | undefined }
  | { readonly status: 'failed'; readonly reason: AtlasReadFailure }
  /** Downloads wait for the user and nothing is stored on this device yet. */
  | { readonly status: 'held' };
interface Loaded { readonly selection: AtlasPresentationSelection; readonly attempt: number; readonly outcome: Outcome }
/** The Full tier for one Light model on screen: loading, swapped in, or kept on Light after a failure. */
interface Detail { readonly light: AtlasModel; readonly model: AtlasModel | null; readonly failed: boolean }
/** The Full tier offered to one stage: its model once bound, or that it failed. */
interface StageDetail { readonly model: AtlasModel | null; readonly failed: boolean }

const FAILURE: Record<AtlasReadFailure, { readonly text: string; readonly retry: string | null }> = {
  absent: { text: 'No room map is published for this model yet.', retry: null },
  stale: { text: 'The selected model changed while loading.', retry: 'Load again' },
  unavailable: { text: 'The room map could not be loaded.', retry: 'Try again' },
  invalid: { text: 'The room map does not match this model, so it is not shown.', retry: 'Check again' },
  'too-large': { text: 'This model is larger than the viewer supports.', retry: null },
  denied: { text: 'Access to this room map was refused.', retry: 'Try again' },
};

// View state per exact overview owner, manifest and publication revision, for this tab only.
const memory = new Map<string, AtlasViewState>();
// Views whose Spread floors the viewer or an explicit start set; the rest
// follow spreadAll.
const spreadChosen = new Set<string>();
const MEMORY_ENTRIES = 8;
const overviewOwners = new WeakMap<object, number>();
let nextOverviewOwner = 0;
const ownerKey = (identity: object) => {
  let owner = overviewOwners.get(identity);
  if (owner === undefined) { owner = ++nextOverviewOwner; overviewOwners.set(identity, owner); }
  return owner;
};
const memoryKey = (model: AtlasModel, overview: AtlasPresentationSelection) => {
  const owner = ownerKey(overview.kind === 'live' ? overview.overview : overview.owner);
  const { scope, publication, selection } = model.scene;
  // Display policy only groups existing identities; changing it must not
  // remount this same admitted source and discard the selected room/floor.
  return `${owner}/${overview.kind === 'live' ? overview.overview.manifestSha256 : `${overview.localRevision}/${overview.snapshotId}/${overview.overviewManifestSha256}`}/${scope.workspaceId}/${scope.homeId}/${publication.publicationId}/${publication.semanticsSha256}/${selection.revision}`;
};
// Source owners whose first view has committed; an explicit start applies only to that view.
const startLedger = createStartLedger();
function remember(key: string, state: AtlasViewState) {
  memory.delete(key); memory.set(key, state);
  while (memory.size > MEMORY_ENTRIES) { const old = memory.keys().next().value!; memory.delete(old); spreadChosen.delete(old); }
}

/** A source the host can open in place of the Atlas; listed in the narrow-stage menu. */
export interface OtherSource { readonly id: string; readonly label: string; readonly open: () => void }

/** A lens over the Atlas, held by the host workspace. */
export interface AtlasLensState { readonly kind: 'places'; readonly reading: boolean }
/** The host's lens: its state and setter, the element in the lens panel this
 * Atlas renders its own model rooms into, and the panel's id.
 * Read wide, the Atlas stands as an inset: drawn, out of the tab order, its
 * controls set aside until the host shows the map again. */
export interface AtlasLensHost {
  readonly value: AtlasLensState | null;
  readonly set: (next: AtlasLensState | null) => void;
  readonly target: HTMLElement | null;
  readonly panelId: string;
}

export interface AtlasPresentationEnvironment {
  readonly reducedMotion: boolean;
  readonly openDocuments?: () => void;
  readonly archive?: { readonly included: boolean; readonly setIncluded: (included: boolean) => void };
  /** Absent in the saved viewer. */
  readonly lens?: AtlasLensHost;
  /** Reviewed breaker/panel projection from the current overlay-frame owner,
   * replaced or withdrawn with that frame. Otherwise a current frame's own
   * projection for the selected group's ledger is used (only the example house supplies one). */
  readonly electricalData?: ElectricalTraceSource;
  /** The live host's building records for a selected room's belongings;
   * absent in a saved copy, whose card lists none (it does not read the copy's held records). */
  readonly roomBelongings?: RoomBelongingsSource;
}
interface AtlasProps {
  readonly port: UnifiedAtlasPort | AtlasPresentationPort;
  readonly otherSources?: readonly OtherSource[];
  readonly environment?: AtlasPresentationEnvironment;
  /** The live host's lens; an explicit environment supplies its own. */
  readonly lens?: AtlasLensHost;
  /** The live host's building records (its topology provider). */
  readonly buildingRecords?: Pick<TopologyContext, 'activate' | 'reload' | 'readable' | 'index' | 'status'>;
}
export default function UnifiedAtlas(props: AtlasProps) {
  return props.environment ? <AtlasPresentation {...props} environment={props.environment} /> : <LiveAtlasPresentation {...props} />;
}
function LiveAtlasPresentation(props: AtlasProps) {
  const { dispatch, actions, projection } = useStore(), reducedMotion = useReducedMotion(), select = useSelect();
  const roomBelongings = useRoomBelongings(props.buildingRecords, projection, select);
  return <AtlasPresentation {...props} environment={{ reducedMotion,
    openDocuments: () => dispatch({ type: 'view', view: 'library' }),
    ...(actions.archiveVisibility ? { archive: actions.archiveVisibility } : {}),
    ...(props.lens ? { lens: props.lens } : {}),
    ...(roomBelongings ? { roomBelongings } : {}) }} />;
}

/** A selected room with a reviewed Atlas place asks for the home's building
 * records once; the read is the provider's own and is held while this Atlas
 * stays mounted, so later rooms reuse it. Browsing, hovering and the room
 * list ask for nothing. Belongings come from the Home records already loaded
 * (archive choice applied), joined only through a reviewed binding. */
function useRoomBelongings(records: AtlasProps['buildingRecords'], projection: ReturnType<typeof useStore>['projection'],
  select: (id: string) => void): RoomBelongingsSource | undefined {
  const [wanted, setWanted] = useState(false);
  const activate = records?.activate;
  useEffect(() => wanted && activate ? activate() : undefined, [wanted, activate]);
  const index = records?.index ?? null, status = records?.status, readable = records?.readable ?? false, reload = records?.reload;
  return useMemo(() => {
    if (!reload) return undefined;
    const contents = [...projection.entries].filter(([id]) => { const kind = kindOf(id); return kind === 'item' || kind === 'space' || kind === 'unknown'; });
    const read = (atlasPlaceId: string): RoomBelongingsState => {
      if (!readable) return { status: 'not-readable' };
      if (!wanted || status === 'loading' || status === undefined) return { status: 'loading' };
      if (status !== 'ready') return { status: 'failed', reason: status };
      if (!index) return { status: 'loading' };
      const link = homeboxPlaceOf(index, projection.view, atlasPlaceId);
      if (link.status !== 'linked') return { status: link.status };
      const { place } = link, records = homeboxPlaceRecords(place, contents, projection.view.caches);
      if (records.hidden) return { status: 'archived-hidden' };
      const { belongings, innerPlaces, cache } = records;
      return { status: 'linked', place: place.entity.name.trim() || 'Unnamed place', placeEntry: place, placeFlagged: records.flagged, innerPlaces,
        belongings: belongings.map(({ id, entry, flagged, unclassified }) => ({ id, entry, flagged, name: entry.entity.name.trim() || 'Unnamed record',
          detail: [unclassified ? 'Unclassified record' : entry.entity.entityType?.name, entry.entity.quantity === null ? null : `Quantity ${entry.entity.quantity}`].filter(Boolean).join(' · ') })),
        cache: cache ? { status: cache.displayStatus, at: cache.lastSuccessfulFetchAt ?? null } : null };
    };
    return { request: () => setWanted(true), retry: reload, open: select, read };
  }, [index, status, readable, reload, wanted, projection, select]);
}

/** While the room map is not open, the places lens still says why the model's
 * own rooms are absent. */
function LensStatus({ lens, children }: { readonly lens: AtlasLensHost | undefined; readonly children: string }) {
  return lens?.value?.kind === 'places' && lens.target ? createPortal(<p className="ua-lens-status" role="status">{children}</p>, lens.target) : null;
}
/** Until the stage mounts with its own opener (Place records in the Rooms
 * list), the host's places lens opens here. */
function LensOpeners({ lens }: { readonly lens: AtlasLensHost | undefined }) {
  if (!lens) return null;
  return <div className="ua-lens-openers">
    <button type="button" className="chip-btn" data-lens-return="" onClick={() => { if (lens.value?.kind !== 'places') lens.set({ kind: 'places', reading: false }); }}>
      <Icon name="rooms" size={15} />Place records</button>
  </div>;
}
function AtlasPresentation({ port: suppliedPort, otherSources, environment }: AtlasProps & { readonly environment: AtlasPresentationEnvironment }) {
  const port = useMemo(() => 'kind' in suppliedPort ? suppliedPort : createLiveAtlasPresentationPort(suppliedPort), [suppliedPort]);
  const subscribe = useCallback((changed: () => void) => port.subscribe(changed), [port]);
  const current = useCallback(() => port.current(), [port]);
  const selection = useSyncExternalStore(subscribe, current, current);
  const [attempt, setAttempt] = useState(0);
  // The selection an explicit download or retry was asked for. A later
  // selection is held again until the user asks for it too.
  const [asked, setAsked] = useState<AtlasPresentationSelection | null>(null);
  const ask = useCallback(() => { setAsked(selection); setAttempt(value => value + 1); }, [selection]);
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  // The stored copy bound for this selection, reused by a retry without a second parse.
  const storedCopy = useRef<{ readonly selection: AtlasPresentationSelection; readonly read: StoredAtlasRead; readonly model: AtlasModel } | null>(null);
  // A selection the server refused: its stored copy stays hidden until an authorized read succeeds.
  const refused = useRef<AtlasPresentationSelection | null>(null);
  // Switching Settings from When I ask to Automatic starts a held read in place.
  const updates = useModelUpdates();
  const previousUpdates = useRef(updates);
  useEffect(() => {
    const was = previousUpdates.current;
    previousUpdates.current = updates;
    const held = loaded?.selection === selection && (loaded.outcome.status === 'held' || loaded.outcome.status === 'ready' && loaded.outcome.stored?.refresh === 'held');
    if (was === 'ask' && updates === 'automatic' && held) setAttempt(value => value + 1);
  }, [updates]); // Only a change of preference starts it.

  useEffect(() => {
    if (!selection) return;
    noteLoadStep('home');
    const controller = new AbortController(), signal = controller.signal;
    // Legacy optional host fallback. Protected read metadata takes precedence,
    // including explicit null. No private values need enter the static index.
    const displayElement = document.getElementById('houseatlas-atlas-display');
    const displayText = displayElement instanceof HTMLScriptElement && displayElement.type === 'application/json' ? displayElement.textContent : null;
    let hostDisplayConfig: unknown;
    try {
      if (displayText !== null) {
        if (new TextEncoder().encode(displayText).byteLength > 32 * 1024) throw new Error('Display policy too large');
        hostDisplayConfig = JSON.parse(displayText);
      }
    } catch { hostDisplayConfig = {}; } // Matching malformed host configuration refuses rather than guesses.
    const bind = async (read: UnifiedAtlasRead): Promise<{ readonly model: AtlasModel; readonly parsedCopy: boolean }> => {
      const policy = admitAtlasDisplayForRead(read, hostDisplayConfig);
      // The read's model bytes have verified against its scene's pin. What this
      // loader build prepared from those same bytes on this device stands in for
      // the parse; the same admission and binding run on it. The lookup is
      // optional and bounded: one that stalls is passed over and the bytes are parsed.
      const deadline = new Promise<null>(resolve => setTimeout(resolve, PARSED_LOOKUP_MS, null));
      const lookup = port.kind === 'live' && selection.kind === 'live' && port.parsed ? port.parsed(selection).catch(() => null) : null;
      const { loadStandardGlb, LOADER_BUILD } = await import('../canonical-ifc/standard-glb');
      signal.throwIfAborted();
      const store = LOADER_BUILD === null ? null : await Promise.race([lookup, deadline]);
      // Prepared geometry is reserved from the preflight counts before the loader allocates.
      const admit = (admission: GlbAdmission) => {
        if ((admission.work.gpuBytes ?? admission.work.triangles * PREPARED_BYTES_PER_TRIANGLE) > RENDER_LIMITS.uploadBytes) throw new AtlasReadError('too-large');
      };
      const { sha256 } = read.scene.model, bytes = read.model.byteLength;
      const kept = store && LOADER_BUILD !== null ? await Promise.race([store.read(sha256, bytes, LOADER_BUILD).catch(() => null), deadline]) : null;
      signal.throwIfAborted();
      // A copy that is refused here is parsed again below, which gives the verdict and replaces it.
      if (kept) try { admit(kept); return { model: bindAtlasModel(read.scene, kept, policy), parsedCopy: true }; } catch { /* parse */ }
      const glb = await loadStandardGlb(read.model, 'atlas', signal, admit, { embeddedPngMaterials: true });
      signal.throwIfAborted();
      // Copying it into storage holds this thread for a while, so it waits until the first frame is on screen.
      // An open abandoned before then lets go of the model and keeps nothing.
      if (store && LOADER_BUILD !== null) {
        let pending: StandardGlb | null = glb;
        const release = () => { pending = null; };
        signal.addEventListener('abort', release, { once: true });
        void firstHouseDrawn.then(() => afterNextFrame(signal)).then(() => afterNextFrame(signal)).then(() => {
          if (pending && !signal.aborted) store.keep(sha256, bytes, LOADER_BUILD, pending);
        }, () => undefined).finally(() => { release(); signal.removeEventListener('abort', release); });
      }
      return { model: bindAtlasModel(read.scene, glb, policy), parsedCopy: false };
    };
    // Stale while revalidate: this device's last verified copy of the same
    // publication and manifest shows at once; the fresh read still decides.
    // With downloads held, only an explicit Check for update starts it.
    const fetchNow = port.kind !== 'live' || asked === selection || modelUpdatesAllowed();
    let settled = false;
    const stored: Promise<{ readonly read: StoredAtlasRead; readonly model: AtlasModel } | null> = (async () => {
      if (port.kind !== 'live' || selection.kind !== 'live' || !port.stored || refused.current === selection) return null;
      if (storedCopy.current?.selection === selection) {
        const kept = storedCopy.current;
        if (!fetchNow) setLoaded({ selection, attempt, outcome: { status: 'ready', model: kept.model, entryBuildingId: kept.read.entryBuildingId, start: kept.read.start,
          stored: { storedAt: kept.read.storedAt, refresh: 'held' } } });
        return kept;
      }
      storedCopy.current = null;
      try {
        const began = performance.now(), read = await port.stored(selection, signal), parsing = performance.now();
        if (!read || settled) return null;
        const { model, parsedCopy } = await bind(read);
        if (settled || signal.aborted) return null;
        noteFirstModel('saved', performance.now() - parsing, parsing - began, parsedCopy);
        storedCopy.current = { selection, read, model };
        setLoaded({ selection, attempt, outcome: { status: 'ready', model, entryBuildingId: read.entryBuildingId, start: read.start,
          stored: { storedAt: read.storedAt, refresh: fetchNow ? 'pending' : 'held' } } });
        return { read, model };
      } catch { return null; }
    })();
    if (!fetchNow) {
      void stored.then(shown => { if (!shown && !signal.aborted) setLoaded({ selection, attempt, outcome: { status: 'held' } }); });
      return () => controller.abort();
    }
    void (async () => {
      let outcome: Outcome, parsed: number | null = null, parsedCopy = false;
      try {
        const read = port.kind === 'saved' && selection.kind === 'saved' ? await port.read(selection, signal)
          : port.kind === 'live' && selection.kind === 'live' ? await port.read(selection, signal) : (() => { throw new AtlasReadError('stale'); })();
        const shown = await stored;
        signal.throwIfAborted();
        // The same scene and model bytes confirm the copy on screen in place.
        const same = shown && read.envelopeSha256 !== undefined && read.envelopeSha256 === shown.read.envelopeSha256
          && read.scene.model.sha256 === shown.read.scene.model.sha256 && read.entryBuildingId === shown.read.entryBuildingId
          && JSON.stringify(shown.model.displayConfig) === JSON.stringify(admitAtlasDisplayForRead(read, hostDisplayConfig));
        const parsing = performance.now(), bound = same ? null : await bind(read), model = bound?.model ?? shown!.model;
        if (bound) { parsed = performance.now() - parsing; parsedCopy = bound.parsedCopy; }
        outcome = { status: 'ready', model, entryBuildingId: read.entryBuildingId, start: read.start };
        storedCopy.current = null;
        refused.current = null;
      } catch (error) {
        if (signal.aborted) return;
        // A model file the standard loader refuses does not match its room map.
        const reason = error instanceof AtlasReadError ? error.reason : error instanceof GlbFormatError ? 'invalid' : 'unavailable';
        if (reason === 'denied') { refused.current = selection; storedCopy.current = null; }
        // Only a transport failure keeps a verified stored copy on screen, marked as not updated.
        const shown = reason === 'unavailable' ? await stored : null;
        outcome = shown ? { status: 'ready', model: shown.model, entryBuildingId: shown.read.entryBuildingId, start: shown.read.start, stored: { storedAt: shown.read.storedAt, refresh: 'failed' } }
          : { status: 'failed', reason };
      }
      settled = true;
      if (signal.aborted) return;
      if (parsed !== null) noteFirstModel('fresh', parsed, undefined, parsedCopy);
      setLoaded({ selection, attempt, outcome });
    })();
    return () => controller.abort();
  }, [port, selection, attempt, asked]);

  // Full quality: once a fresh Light model is on screen, the publication's
  // detail model loads behind it and replaces it with the same selectors, so
  // the view, selection and floors stay as they are. A stored copy, a held
  // download or a failure keeps Light.
  const quality = useModelQuality();
  const fresh = loaded?.selection === selection && loaded.outcome.status === 'ready' && !loaded.outcome.stored ? loaded.outcome.model : null;
  const wantsFull = fresh !== null && fresh.scene.detail !== null && port.kind === 'live' && port.readDetail !== undefined
    && selection?.kind === 'live' && fullModelWanted(quality);
  const [detail, setDetail] = useState<Detail | null>(null);
  useEffect(() => {
    if (!wantsFull || port.kind !== 'live' || !port.readDetail || selection?.kind !== 'live') return;
    const light = fresh, controller = new AbortController(), signal = controller.signal;
    setDetail({ light, model: null, failed: false });
    void (async () => {
      try {
        const bytes = await port.readDetail!(selection, light.scene, signal);
        // Parsed and prepared in a worker: millions of triangles never hold up the Light model on screen.
        const { loadStandardGlbInWorker } = await import('../canonical-ifc/standard-glb-thread');
        signal.throwIfAborted();
        const glb = await loadStandardGlbInWorker(bytes, 'atlas', signal, admission => {
          if ((admission.work.gpuBytes ?? admission.work.triangles * PREPARED_BYTES_PER_TRIANGLE) > RENDER_LIMITS.detailUploadBytes) throw new AtlasReadError('too-large');
        }, { embeddedPngMaterials: true, limits: DETAIL_GLB_LIMITS });
        signal.throwIfAborted();
        const model = bindAtlasModel(light.scene, glb, light.displayConfig);
        if (!signal.aborted) setDetail({ light, model, failed: false });
      } catch { if (!signal.aborted) setDetail({ light, model: null, failed: true }); }
    })();
    // Leaving Full, or this Light model, releases the detail model too.
    return () => { controller.abort(); setDetail(null); };
    // The Light model identifies the read; the selection and port come with it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wantsFull, fresh]);
  const full = wantsFull && detail?.light === fresh ? detail : null;
  const keepLight = useCallback(() => setDetail(value => value && { ...value, model: null, failed: true }), []);

  if (!selection) return <section className="ua-shell" aria-label="Atlas"><p className="ua-state" role="status">No model is selected.</p>
    <LensOpeners lens={environment.lens} />
    <LensStatus lens={environment.lens}>No model is selected, so no model rooms are shown.</LensStatus></section>;
  // A retry keeps a stored copy on screen while it runs.
  const outcome = loaded && loaded.selection === selection && (loaded.attempt === attempt
    || loaded.outcome.status === 'ready' && loaded.outcome.stored) ? loaded.outcome : null;
  if (!outcome) return <section className="ua-shell is-loading" aria-label="Atlas" aria-busy="true">
    <div className="ua-state" role="status"><span className="ua-spinner" aria-hidden="true" />Loading the room map…</div>
    <LensOpeners lens={environment.lens} />
    <LensStatus lens={environment.lens}>Model rooms appear when the room map has loaded.</LensStatus>
  </section>;
  if (outcome.status === 'held') return <section className="ua-shell" aria-label="Atlas">
    <LensStatus lens={environment.lens}>The room map is not on this device yet.</LensStatus>
    <div className="ua-state" role="status">
      <p>The room map is not on this device yet.</p>
      <div className="ua-state-actions"><button type="button" className="btn btn-small" onClick={ask}>Download room map</button></div>
    </div>
    <LensOpeners lens={environment.lens} />
  </section>;
  if (outcome.status === 'failed') {
    const failure = FAILURE[outcome.reason];
    return <section className="ua-shell" aria-label="Atlas">
      <LensStatus lens={environment.lens}>The room map is unavailable, so its model rooms are not shown.</LensStatus>
      <div className="ua-state" role="alert">
        <p>{failure.text}</p>
        {failure.retry && <div className="ua-state-actions"><button type="button" className="btn btn-small" onClick={ask}>{failure.retry}</button></div>}
      </div>
      <LensOpeners lens={environment.lens} />
    </section>;
  }
  const stored = outcome.stored && (loaded!.attempt === attempt ? outcome.stored : { ...outcome.stored, refresh: 'pending' as const });
  const stageDetail: StageDetail | null = full?.light === outcome.model ? { model: full.model, failed: full.failed } : null;
  // Same scene, so the same view-state key: the Full model takes over the Light stage in place.
  return <AtlasStage key={`${ownerKey(suppliedPort)}/${memoryKey(outcome.model, selection)}`} model={outcome.model} port={port} sourceOwner={suppliedPort} selection={selection} entryBuildingId={outcome.entryBuildingId} start={outcome.start}
    otherSources={otherSources ?? []} environment={environment} {...(stored ? { stored, retry: ask } : {})}
    {...(stageDetail ? { detail: stageDetail, keepLight } : {})} />;
}

// ---------------------------------------------------------------------------

/** How long the parsed-copy lookup may hold up a parse, as the stored-copy lookup does (CACHE_LOOKUP_MS). */
const PARSED_LOOKUP_MS = 3000;
const RULES: DrawRules = { visibleFloors: 'all', clipY: null };
/** Fallback architecture, when a primitive has no explicit source base colour,
 * as an axonometric drawing in four values on the birch
 * board: white card walls in light, the walls turned away in warm umber, slopes
 * in a darker graphite and cuts in deep poché, with lantern-yellow selection.
 * Out-of-focus floors and neighbours step back toward a grey stone that stays
 * apart from the warm board. Explicit glTF colours take precedence over these
 * presentation tones; selection and overlay highlights remain Lantern tones. */
const ATLAS_MESH_PALETTE: Partial<MeshPalette> = {
  // The selected floor takes the selected name tag's full lantern (--lantern), so it outshines the warm floors beside it.
  paper: '#BDB8AE', wall: CARD, top: '#ECDDBF', cut: '#54463A', room: '#F3DFC0', selected: '#FFD15C', context: '#FBEFC8', ghost: '#E2D9C8',
};
const ATLAS_AMBIENT = .62, ATLAS_SHADE = '#4A3F33', ATLAS_PITCH = '#7C736C';
/** Fallback terrain without an explicit source colour reads as part of the board, one flat pale birch tone with no
 * slope shading, so its facets never compete with the buildings; floors cut
 * away above the focus stay a faint outline; their faces add up where they
 * overlap, so each stays light enough that stacked walls never haze the
 * floor below. Presentation only. */
const ATLAS_SITE = '#E0CFA6', ATLAS_GHOST_ALPHA = .05;
/** Depth of a picked-out room's tinted floor plate above its pick geometry's floor, in metres. */
const ROOM_PLATE = .02;
/** Authored materials step back at under half the fallback dimming: context
 * grass stays green, the fence and glazing stay dark, and neighbours keep
 * their own colours, while the focused building alone is at full strength. */
const ATLAS_SOURCE_DIM = .45;
/** Meshes that roof the house over: at night a face beneath them is indoors and lamp-lit. */
const SHELTER_ROLES: ReadonlySet<MeshRole> = new Set(['structure', 'roof', 'slab']);
/** Of those, the ones whose glass shows lit rooms at night; glass in the context never does. */
/** The birch board under the property: its thickness below the lowest floor, in metres. */
const BOARD_DEPTH = .4;
/** Contact shadow of each building's lowest floor on the board, cast away from the sun, in metres. */
const SHADOW_LENGTH = .55;
/** Plan Fit keeps rooms at a readable drawing scale, in pixels per metre: a
 * room part 1.5 m clear has the 18 px a plain room name needs. */
const PLAN_READABLE = 12;
/** Space kept around a floor's own rooms and walls when Fit frames them, in metres. */
const PLAN_ROOM_MARGIN = 1;
/** Selected tag in 3D: leader length and tag centre above the anchor, in pixels. */
const LEADER = 34, TAG_RISE = LABEL_TAG_RISE;
const LAYER_LABEL: Record<AtlasLayer, string> = { ...OVERLAY_LABEL, measurements: 'Measurements' };
const LAYER_TONE: Record<AtlasLayer, string> = { electrical: TONE_COLOR.electrical, network: TONE_COLOR.network, measurements: BIRCH_DARK };
const LAYER_KINDS = ['electrical', 'network', 'measurements'] as const satisfies readonly AtlasLayer[];
/** Side by side when both layers count the same room: far enough apart that their touch targets never overlap. */
const MARKER_SPREAD = 30;
/** Marks a room drawn from an estimated outline on the model, as the room list does. */
const PRELIMINARY = ' · Preliminary';
const isPreliminary = (model: AtlasModel, occurrenceId: string) => model.occurrencesById.get(occurrenceId)!.geometryBasis.kind === 'owner-estimated-pick-proxy';

// ---------------------------------------------------------------------------
// The unobscured stage: floating panels claim edge bands, and the shared camera
// fits what is left. Drawing, picking and labels keep one mapping in stage pixels.

/** Stage pixels: left, top, right, bottom. */
type Box = { readonly l: number; readonly t: number; readonly r: number; readonly b: number };
const NO_INSET: Box = { l: 0, t: 0, r: 0, b: 0 };
/** Space kept between a panel and the framed model, in pixels. */
const CLEAR = 8;
/** Smallest framed side worth keeping; when panels leave less, the whole stage is used. */
const MIN_FRAME = 96;
/** Widest stage, in pixels, that takes the compact phone controls; matches the ua-stage container query. */
const COMPACT_STAGE = 720;
/** Least height, in pixels, of the floor list beside a docked key column: All floors and one whole floor row. */
const LADDER_FLOOR = 112;
/** Largest share of a phone stage an open sheet may take and still count whole; a taller one (a short landscape stage) counts as its head. */
const OPEN_SHEET = .6;

// A top-layer reading sheet never claims space in the map's fitted frame.
const laidOut = (node: Element) => !node.matches(':modal') && getComputedStyle(node).display !== 'none';
const showing = (node: Element) => laidOut(node) && getComputedStyle(node).visibility !== 'hidden';

/** Fits within this share of the best count as equal, so a frame a few pixels
 * larger never wins over one with far more of the stage around the model. */
const FIT_TIE = .92;

/** Each panel is cleared by the edge band that costs the frame least: every
 * assignment of panels to bands is scored by the fit it leaves. Near ties keep more area. */
function safeInsets(cover: readonly Box[], width: number, height: number, fit: (w: number, h: number) => number): Box {
  const options: { readonly inset: Box; readonly value: number; readonly area: number }[] = [];
  for (let pick = 0; pick < 4 ** cover.length; pick++) {
    let l = 0, t = 0, r = 0, b = 0;
    cover.forEach((o, at) => {
      const band = Math.floor(pick / 4 ** at) % 4;
      if (band === 0) l = Math.max(l, o.r + CLEAR); else if (band === 1) t = Math.max(t, o.b + CLEAR);
      else if (band === 2) r = Math.max(r, width - o.l + CLEAR); else b = Math.max(b, height - o.t + CLEAR);
    });
    const w = width - l - r, h = height - t - b;
    if (w >= MIN_FRAME && h >= MIN_FRAME) options.push({ inset: { l, t, r, b }, value: fit(w, h), area: w * h });
  }
  const top = Math.max(...options.map(option => option.value));
  return options.filter(option => option.value >= top * FIT_TIE - 1e-9)
    .reduce<{ inset: Box; area: number } | null>((best, option) => !best || option.area > best.area ? option : best, null)?.inset ?? NO_INSET;
}

/** The shared camera fitted to an inset region, reported in whole-stage pixels. */
function insetProjection(base: Projection, dx: number, dy: number, viewport: Viewport): Projection {
  return { ...base, ox: base.ox + dx, oy: base.oy + dy, viewport,
    project(x, y, z) { const [px, py, depth] = base.project(x, y, z); return [px + dx, py + dy, depth]; },
    planMatrix: y => `translate(${dx} ${dy}) ${base.planMatrix(y)}` };
}

/** Panels over the stage, in stage pixels: the view tools, the building and
 * floor rail, the overlays, the network graph and the sheet. Each container is
 * a transparent band, so its visible children are measured within it. A closed
 * sheet counts as its head. On a phone an open sheet counts whole: the
 * stylesheet opens it to one height whatever it lists, so the model is framed
 * in the stage above it, moving once as it opens and once as it closes, never
 * with its content; the overlays it hides keep their place. A tablet's card,
 * or a sheet taller than OPEN_SHEET of the stage, still counts as its head. The
 * graph beside the model claims its own band; over a narrow
 * stage it is the whole view, and the model keeps its frame behind it.
 * Wide stages dock the layer keys under the floor rail: the dock counts with
 * the rail it continues, never as one span across to the layer bar, so
 * opening or closing a key leaves the model's frame where it is. A short
 * rail scrolls inside its own frame, so its rows count only where they show. */
function measureCover(root: HTMLElement, stage: HTMLElement): { readonly cover: Box[]; readonly sheet: boolean; readonly graphCovers: boolean } {
  const frame = stage.getBoundingClientRect();
  const clip = (rect: DOMRect, within: DOMRect): Box | null => {
    const l = Math.max(rect.left, within.left, frame.left), t = Math.max(rect.top, within.top, frame.top);
    const r = Math.min(rect.right, within.right, frame.right), b = Math.min(rect.bottom, within.bottom, frame.bottom);
    return r - l > 1 && b - t > 1 ? { l: Math.round(l - frame.left), t: Math.round(t - frame.top), r: Math.round(r - frame.left), b: Math.round(b - frame.top) } : null;
  };
  const join = (sum: Box | null, box: Box | null): Box | null => !box ? sum : !sum ? box
    : { l: Math.min(sum.l, box.l), t: Math.min(sum.t, box.t), r: Math.max(sum.r, box.r), b: Math.max(sum.b, box.b) };
  const union = (selector: string, shown = showing, apart: Element | null = null): Box | null => {
    const band = root.querySelector(selector); if (!band || !shown(band)) return null;
    const within = band.getBoundingClientRect();
    return [...band.children].filter(child => child !== apart && shown(child)).map(child => clip(child.getBoundingClientRect(), within)).reduce(join, null);
  };
  // The floor list never shrinks below its first rows, so the current floor
  // stays a usable target; past that the whole rail scrolls.
  const rail = root.querySelector<HTMLElement>('.ua-scope');
  const ladder = rail?.querySelector<HTMLElement>('.ua-stack.is-rail .ua-stack-floors') ?? null;
  const floor = ladder && laidOut(ladder) ? Math.min(ladder.scrollHeight + ladder.offsetHeight - ladder.clientHeight, LADDER_FLOOR) : null;
  if (floor !== null) root.style.setProperty('--ua-ladder-floor', `${floor}px`);
  else root.style.removeProperty('--ua-ladder-floor');
  // The stylesheet decides whether the keys are docked: the layer band becomes a grid.
  const bottom = root.querySelector('.ua-bottom');
  const dock = bottom && laidOut(bottom) && getComputedStyle(bottom).display === 'grid' ? bottom.querySelector(':scope > .ua-keys') : null;
  // The dock takes only the height the rail leaves: below its fixed rows and
  // the floor list's first rows, measured in layout, so the rail's own scroll
  // never changes it. The dock's foot does not depend on its height.
  if (dock && rail && laidOut(dock)) {
    const top = rail.getBoundingClientRect().top;
    const end = ladder && floor !== null ? ladder.offsetTop + floor
      : [...rail.children].filter(laidOut).reduce((most, child) => Math.max(most, (child as HTMLElement).offsetTop + (child as HTMLElement).offsetHeight), 0);
    root.style.setProperty('--ua-dock-room', `${Math.floor(dock.getBoundingClientRect().bottom - top - end - CLEAR)}px`);
  } else root.style.removeProperty('--ua-dock-room');
  const docked = dock && laidOut(dock) ? clip(dock.getBoundingClientRect(), frame) : null;
  // The rail stops above the dock.
  if (docked) root.style.setProperty('--ua-dock', `${Math.round(frame.height) - docked.t}px`);
  else root.style.removeProperty('--ua-dock');
  const tools = union('.ua-tools'), scope = union('.ua-scope');
  // Overlays stand below these rows on narrow stages, and an open sheet stops above them.
  if (tools) root.style.setProperty('--ua-tools-end', `${tools.b}px`);
  // The floor chip stops short of the tool on its own row; the stamp row below is not beside it.
  const toolsBand = root.querySelector('.ua-tools'), toolsTop = toolsBand?.getBoundingClientRect().top ?? 0;
  const toolsLeft = Math.min(...[...toolsBand?.children ?? []].filter(child => showing(child) && child.getBoundingClientRect().top < toolsTop + 4).map(child => child.getBoundingClientRect().left));
  if (toolsBand && showing(toolsBand) && Number.isFinite(toolsLeft)) root.style.setProperty('--ua-tools-w', `${Math.round(frame.right - toolsLeft)}px`);
  else root.style.removeProperty('--ua-tools-w');
  if (scope) root.style.setProperty('--ua-scope-end', `${Math.max(scope.b, tools?.b ?? 0)}px`);
  // The stylesheet decides whether the panel is a sheet; its head keeps one height open or closed.
  const panel = root.querySelector('.ua-inspector'), head = panel?.querySelector('.ua-sheet-head');
  const style = panel ? getComputedStyle(panel) : null;
  const sheet = style?.position === 'absolute';
  let peek: Box | null = null;
  if (panel && head && style && sheet) {
    const rect = panel.getBoundingClientRect();
    const whole = frame.width <= COMPACT_STAGE && panel.classList.contains('is-open') && rect.height <= frame.height * OPEN_SHEET;
    const top = whole ? rect.top
      : rect.bottom - head.getBoundingClientRect().height - parseFloat(style.borderTopWidth) - parseFloat(style.borderBottomWidth);
    peek = clip(new DOMRect(rect.left, top, rect.width, rect.bottom - top), frame);
  }
  const graphPanel = root.querySelector('.ua-graph');
  const graph = graphPanel && showing(graphPanel) ? clip(graphPanel.getBoundingClientRect(), frame) : null;
  const graphCovers = graph !== null && graph.r - graph.l > frame.width * .6;
  return { cover: [tools, join(scope, docked), union('.ua-bottom', laidOut, dock), peek, graphCovers ? null : graph].filter((box): box is Box => box !== null), sheet, graphCovers };
}

/** A device the reviewed room mapping places in a room, drawn as a glyph there. */
interface PlacedDevice { readonly key: string; readonly graphKey: string; readonly device: NetworkOverlayDevice }
interface StageMarker extends CountMarker {
  readonly kind: OverlayKind; readonly roomLabel: string;
  /** Outside the current building or floor: kept visible as property context. */
  readonly context: boolean;
  /** Network: the room's placed devices, drawn as glyphs in place of a count. */
  readonly devices?: readonly PlacedDevice[];
  /** Too little room for the row: one chip with the count opens the room's device list. */
  readonly folded?: boolean;
}

/** Until Spread floors is set, all floors in 3D open spread, roof off, so every
 * floor's rooms show; a floor or room closes the house to its cutaway. */
const spreadAll = (model: AtlasModel, state: AtlasViewState): AtlasViewState =>
  atlasReducer(model, state, { type: 'explode', exploded: state.levelId === null && state.occurrenceId === null && hasExplodableLevels(model, state.buildingId) });

function AtlasStage({ model: lighter, port, sourceOwner, selection, entryBuildingId, start, otherSources, environment, stored, retry, detail, keepLight }: { readonly model: AtlasModel; readonly port: AtlasPresentationPort; readonly sourceOwner: object;
  readonly selection: AtlasPresentationSelection; readonly entryBuildingId: string | null | undefined; readonly otherSources: readonly OtherSource[]; readonly environment: AtlasPresentationEnvironment;
  readonly start?: UnifiedAtlasRead['start'] | undefined; readonly stored?: StoredCopy; readonly retry?: () => void;
  /** The Full tier for this Light model; a 3D failure while it applies goes back to Light through `keepLight`. */
  readonly detail?: StageDetail; readonly keepLight?: () => void }) {
  // The model on screen owns the stage; see stageTier.
  const [displayed, setDisplayed] = useState<AtlasModel | null>(null);
  const { model, target } = stageTier(lighter, detail?.model ?? null, displayed);
  const wanted = useRef(target); wanted.current = target;
  const onShown = useCallback((meshes: readonly PreparedMesh[]) => {
    const shown = shownTier(wanted.current, meshes); if (shown) setDisplayed(shown);
  }, []);
  const detailNote = !detail || (detail.model !== null && model === detail.model) ? null : detail.failed ? 'failed' : 'loading';
  const archive = environment.archive;
  const reduced = environment.reducedMotion;
  const key = memoryKey(model, selection);
  const [state, setState] = useState<AtlasViewState>(() => {
    const base = memory.get(key) ?? (port.kind === 'saved' ? savedAtlasInitialState(model) : initialAtlasState(model,
      entryBuildingId === undefined ? port.entryBuildingId?.(model.scene) ?? null : entryBuildingId));
    // An explicit start wins, only on the first view committed through this source owner.
    const pending = startLedger.pending(sourceOwner, start);
    const begun = pending?.reduce((value, action) => atlasReducer(model, value, action), base) ?? base;
    if (pending?.some(action => action.type === 'explode')) spreadChosen.add(key);
    return spreadChosen.has(key) ? begun : spreadAll(model, begun);
  });
  useEffect(() => { startLedger.committed(sourceOwner); }, [sourceOwner]);
  const dispatch = useCallback((action: AtlasAction) => {
    if (action.type === 'explode') spreadChosen.add(key);
    setState(value => {
      const next = atlasReducer(model, value, action);
      return spreadChosen.has(key) ? next : spreadAll(model, next);
    });
  }, [model, key]);
  useEffect(() => { remember(key, state); }, [key, state]);
  const [failure, setFailure] = useState<string | null>(null);
  const shell = useRef<HTMLElement>(null);
  const viewport = useRef<HTMLDivElement>(null);
  const plan = state.view === 'plan';
  const outwardFocus = useRef<Element | null>(null);
  // An open network card is the first level out; set below, once the card's state exists.
  const leaveNetworkCard = useRef<() => boolean>(() => false);
  const out = useCallback(() => {
    if (leaveNetworkCard.current()) return;
    outwardFocus.current = document.activeElement;
    dispatch({ type: 'out' });
  }, [dispatch]);
  useLayoutEffect(() => {
    const origin = outwardFocus.current; outwardFocus.current = null;
    if (origin && !origin.isConnected && (document.activeElement === document.body || document.activeElement === null))
      viewport.current?.focus({ preventScroll: true });
  }, [state.buildingId, state.levelId, state.occurrenceId]);

  const selected = state.occurrenceId;
  const context = useMemo(() => contextOccurrenceIds(model, selected), [model, selected]);
  // Layers are property-wide at every scope; selection highlights and never filters them.
  const { electrical: electricalOn, network: networkOn } = state.layers;
  const runtimeConfigured = Boolean(port.kind === 'saved' || port.createOverlays || port.savedDocumentary);
  const runtime = useDocumentaryOverlays(port, selection, model, electricalOn || networkOn);
  const overlays = useMemo<ReadonlyMap<OverlayKind, OverlayLayerIndex>>(() => runtime.records ? new Map(OVERLAY_KINDS.map(kind =>
    [kind, documentaryOverlayIndex(model, runtime.records!, kind)])) : runtimeConfigured
      ? new Map(OVERLAY_KINDS.map(kind => [kind, { kind, placed: new Map(), unplaced: [], records: 0, unplacedRecords: 0 } satisfies OverlayLayerIndex]))
      : model.overlays, [runtime.records, runtimeConfigured, model]);
  const active = useMemo(() => OVERLAY_KINDS.filter(kind => kind === 'electrical' ? electricalOn : networkOn).map(kind => overlays.get(kind)!),
    [overlays, electricalOn, networkOn]);
  // Rooms with records light in the first active layer's tint; hidden room picks become visible for them only.
  const tints = useMemo(() => {
    const map = new Map<string, string>();
    for (const layer of active) for (const placement of layer.placed.values())
      if (!map.has(placement.occurrenceId)) map.set(placement.occurrenceId, toneTint(layer.kind));
    return map;
  }, [active]);
  // Keyed by content, so an unchanged highlight set keeps the presentation stable.
  const highlightKey = [...new Set([...(selected ? [selected] : []), ...context, ...tints.keys()])].sort().join('\n');
  const highlighted = useMemo(() => new Set(highlightKey ? highlightKey.split('\n') : []), [highlightKey]);
  const presentation = useMemo(() => presentAtlas(model, state, highlighted), [model, state, highlighted]);

  // One eased frame for buildings, floors and plans, relative to a fixed model origin.
  const origin = useMemo(() => atlasOrigin(model), [model]);
  const frame = useMemo(() => frameBox(model, state, presentation), [model, state, presentation]);
  const frameGoal = {
    cx: (frame.min[0] + frame.max[0]) / 2 - origin[0], cy: (frame.min[1] + frame.max[1]) / 2 - origin[1], cz: (frame.min[2] + frame.max[2]) / 2 - origin[2],
    sx: frame.max[0] - frame.min[0], sy: frame.max[1] - frame.min[1], sz: frame.max[2] - frame.min[2], explode: presentation.explodeTarget,
  };
  // Opening: the model settles into its frame from slightly farther away.
  // Reduced motion starts settled.
  const eased = useEased(frameGoal, { reduced, tau: 170,
    intro: { sx: frameGoal.sx * 1.35, sy: frameGoal.sy * 1.35, sz: frameGoal.sz * 1.35, explode: 0 } });
  const t = Math.min(1, Math.max(0, eased.explode));
  const bounds = useMemo(() => {
    const c = [eased.cx + origin[0], eased.cy + origin[1], eased.cz + origin[2]], s = [eased.sx, eased.sy, eased.sz];
    return { min: [0, 1, 2].map(axis => c[axis]! - s[axis]! / 2), max: [0, 1, 2].map(axis => c[axis]! + s[axis]! / 2) } as unknown as { min: readonly [number, number, number]; max: readonly [number, number, number] };
  }, [eased, origin]);

  // Building planes and per-part cuts share one persistent easing owner;
  // retargeting retains each actual current cut for drawing, picking and labels.
  // Heights ease relative to the model's own datum, wherever the source frame puts it.
  const ceilings = useMemo(() => sectionCeilings(model), [model]);
  const sectionGoal = useMemo(() => sectionTargets(model, presentation, ceilings), [model, presentation, ceilings]);
  const partGoals = useMemo(() => partSectionTargets(model, presentation, sectionGoal, ceilings), [model, presentation, sectionGoal, ceilings]);
  const sectionEased = useEased(sectionGoals(sectionGoal, origin[1], partGoals), { reduced, tau: 210 });
  const cuts = useMemo(() => sectionCuts(sectionEased, sectionGoal, origin[1]), [sectionEased, sectionGoal, origin]);
  const partCuts = useMemo(() => partSectionCuts(sectionEased, partGoals, origin[1]), [sectionEased, partGoals, origin]);
  const shown = useMemo(() => easePresentation(model, presentation, t, cuts, sectionGoal, ceilings, { cuts: partCuts, targets: partGoals }), [model, presentation, t, cuts, sectionGoal, ceilings, partCuts, partGoals]);
  // A picked-out room tints its floor, never its whole volume, so its walls and
  // neighbours stay in view; the selected room adds its outline on that floor.
  // Drawing only: picks keep `shown.clips`.
  const roomParts = useMemo(() => model.parts.filter(part => part.role === 'room-pick'), [model]);
  const drawnClips = useMemo(() => {
    const clips = new Map(shown.clips);
    for (const { mesh } of roomParts) if (!shown.hidden.has(mesh.meshKey)) {
      const plate = mesh.yRange[0] + ROOM_PLATE, clip = clips.get(mesh.meshKey) ?? null;
      clips.set(mesh.meshKey, clip === null ? plate : Math.min(clip, plate));
    }
    return clips;
  }, [roomParts, shown]);

  const [sheetOpen, setSheetOpen] = useState(false);

  // Panels over the stage, re-measured when their content or size changes, with
  // the sheet open or closed. Panels never depend on the camera, and the band
  // offsets written here never change the measured rows, so measuring cannot
  // feed back into itself.
  // Narrow stages fold the other floors and the layer details behind one
  // control each, so the focus keeps the stage; one opens at a time. Wide
  // stages dock the layer details under the rail and fold only the floors.
  const [drawer, setDrawer] = useState<'floors' | 'layers' | null>(null);
  // The logical network graph: its own panel, beside the model or over a narrow stage.
  const graphs = networkOn ? runtime.records?.networkGraphs ?? [] : [];
  // The Network collector while the layer shows: nothing is read until a
  // device card or the open key asks, and turning the layer off drops it.
  const collectorPort = port.kind === 'live' ? port.networkCollector : undefined;
  const [collector, setCollector] = useState<NetworkCollector | null>(null);
  useEffect(() => {
    if (!networkOn || !collectorPort) { setCollector(null); return; }
    const store = createCollectorStore(collectorPort);
    setCollector({ port: collectorPort, store });
    return () => store.dispose();
  }, [networkOn, collectorPort]);
  // The radio station while the Atlas shows: its card and, on air, rings from its reviewed room.
  const radioPort = port.kind === 'live' ? port.radio : undefined;
  const { workspaceId: radioWorkspace, homeId: radioHome } = model.scene.scope;
  const [radio, setRadio] = useState<{ readonly feed: RadioFeed; readonly now: () => number } | null>(null);
  useEffect(() => {
    if (!radioPort) { setRadio(null); return; }
    const env = browserRadioEnvironment(), feed = createRadioFeed(radioPort, { workspaceId: radioWorkspace, homeId: radioHome }, env);
    setRadio({ feed, now: env.now });
    return () => feed.dispose();
  }, [radioPort, radioWorkspace, radioHome]);
  // Each Network source with collector facts in a current frame; a stored copy has no collector.
  // Each also keeps the retrieval times of its facts that report a changed device list.
  const collectorScopes = useMemo(() => {
    const scopes = new Map<string, { readonly scope: NonNullable<NetworkOverlayDevice['liveFacts']>['source']; readonly label: string; readonly mismatches: (string | null)[] }>();
    for (const graph of graphs) if (!graph.storedAt) for (const device of graph.data.devices) if (device.liveFacts) {
      const key = scopeKey(device.liveFacts.source);
      if (!scopes.has(key)) scopes.set(key, { scope: device.liveFacts.source, label: graph.data.source.label, mismatches: [] });
      if (device.liveFacts.measurementReason === 'inventory-revision-mismatch') scopes.get(key)!.mismatches.push(device.liveFacts.retrievedAt);
    }
    return [...scopes.values()];
  }, [graphs]);
  const hostLens = environment.lens;
  const lens = hostLens?.value ?? null;
  // Read wide, the stage is the host's inset: drawn and kept current, its
  // controls set aside and the stage out of the tab order.
  const readingInset = lens?.reading === true;
  const [graphOpen, setGraphOpen] = useState(false);
  const showGraph = graphOpen && graphs.length > 0;
  // A device or link a card asked to show, chosen in the graph as it opens.
  const [graphStart, setGraphStart] = useState<{ readonly graphKey: string; readonly serial: number;
    readonly choice: { readonly kind: 'device' | 'link'; readonly id: string } } | null>(null);
  const [graphCovers, setGraphCovers] = useState(false);
  const graphStageFocus = useRef<HTMLElement | null>(null);
  const [cover, setCover] = useState<readonly Box[]>([]);
  // A phone-sized stage keeps one slim row above the model and one below it:
  // the lighting time, the Network lens, the archive filter and the other
  // sources fold into one menu, building and floor into the Floor Stack, the
  // view, the camera and the layers into one dock. One of them opens at a time. A wide stage keeps the rail,
  // one bar of view tools ending in the same menu (the lighting time, the
  // archive filter and the other sources), and the layer bar.
  const [compact, setCompact] = useState(false);
  // The collapsed head can wrap at narrow widths or enlarged text sizes.
  // Keep the overlay band above its actual height rather than a fixed estimate.
  useLayoutEffect(() => {
    const root = shell.current, head = root?.querySelector<HTMLElement>('.ua-sheet-head');
    if (!root || !head) return;
    const measure = () => {
      const height = head.getBoundingClientRect().height;
      if (height > 0) root.style.setProperty('--ua-peek', `${Math.ceil(height)}px`);
    };
    measure();
    const observer = new ResizeObserver(measure); observer.observe(head);
    return () => { observer.disconnect(); root.style.removeProperty('--ua-peek'); };
  }, [selected, compact]);
  const shortLayerDetails = useShortLayerDetails(compact);
  const [menu, setMenu] = useState<'view' | 'stack' | 'layers' | 'camera' | null>(null);
  const layersKey = `${state.layers.electrical}${state.layers.network}${state.layers.measurements}`;
  const chrome = `${plan}\n${sheetOpen}\n${layersKey}\n${selected}\n${state.buildingId}\n${state.levelId}\n${state.exploded}\n${drawer}\n${showGraph}\n${compact}\n${lens?.kind}\n${readingInset}`;
  useLayoutEffect(() => {
    const root = shell.current, stage = viewport.current;
    if (!root || !stage) return;
    const measure = () => {
      const stageRect = stage.getBoundingClientRect();
      setCompact(stageRect.width <= COMPACT_STAGE);
      root.style.setProperty('--ua-stage-height', `${stageRect.height}px`);
      const next = measureCover(root, stage);
      setCover(value => JSON.stringify(value) === JSON.stringify(next.cover) ? value : next.cover);
      setGraphCovers(next.graphCovers);
      // Beside the stage the panel is never a sheet: a wider stage closes it,
      // so the overlays and room controls it hid return.
      if (!next.sheet) setSheetOpen(false);
    };
    measure();
    // Re-measured on the next frame, outside the observer's own delivery.
    let pending: number | null = null;
    const observer = new ResizeObserver(() => { if (pending === null) pending = requestAnimationFrame(() => { pending = null; measure(); }); });
    observer.observe(stage);
    for (const band of root.querySelectorAll('.ua-tools, .ua-scope, .ua-bottom, .ua-inspector, .ua-graph')) {
      observer.observe(band);
      for (const child of band.children) observer.observe(child);
    }
    return () => { observer.disconnect(); if (pending !== null) cancelAnimationFrame(pending); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chrome]);
  // Choosing a room, the selected one included, leaves any network card for the room's own.
  const select = (occurrenceId: string | null) => { leaveNetworkCard.current(); dispatch({ type: 'select', occurrenceId }); };
  // A tap resolves against what is drawn now, mid-transition included, and the
  // reducer re-targets every eased value; an empty tap moves out one level.
  const minimumZoom = useRef(.6);
  const camera = useStageCamera({ element: viewport, top: plan, reduced, wheel: 'pan', onEscape: out, minimumZoom: () => minimumZoom.current,
    onTap: (px, py, target) => {
      const label = target instanceof Element ? target.closest<HTMLButtonElement>('button[data-atlas-occurrence]') : null;
      if (label?.dataset.atlasOccurrence && model.selectable.has(label.dataset.atlasOccurrence)) {
        select(label.dataset.atlasOccurrence); return;
      }
      const link = target instanceof Element ? target.closest<SVGElement>('[data-network-link]') : null;
      if (link?.dataset.networkLink) { setNetFocus({ kind: 'link', key: link.dataset.networkLink }); return; }
      if (!projection) return;
      const action = targetAction(camera.planBlend >= .5 ? planPickTarget(model, presentation, state, t, projection, px, py)
        : pickTarget(model, shown, state, t, projection, px, py));
      // An empty tap first leaves a network card.
      if (netFocus !== null) { setNetFocus(null); if (action.type === 'out') return; }
      dispatch(action);
    } });
  const { planBlend, size } = camera;
  // Fitted to the stage the panels leave clear, scored for the target view: the
  // whole model in 3D, the plan's own extent in Plan. Insets ease with the frame.
  const safe = useMemo(() => safeInsets(cover, size.width, size.height, plan
    ? (w, h) => Math.min(w / Math.max(frameGoal.sx, 1e-3), h / Math.max(frameGoal.sz, 1e-3)) : (w, h) => Math.min(w, h)),
  [cover, size.width, size.height, plan, frameGoal.sx, frameGoal.sz]);
  const inset = useEased(safe, { reduced, tau: 170 });
  // A floor's plan on a small stage: when the floor with its site context would
  // draw the rooms below a readable scale, Fit frames the floor's own rooms and
  // walls instead. Context stays drawn past the frame and returns on zoom-out or
  // pan; wide stages already draw the whole floor at that scale, so nothing moves.
  const planRooms = useMemo(() => {
    const levelId = presentation.focusLevelId;
    if (!plan || levelId === null) return null;
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (const feature of planFeaturesForLevel(model, levelId)) {
      if (feature.role !== 'room' && feature.role !== 'wall' && feature.role !== 'opening') continue;
      for (const ring of model.featureRings.get(feature.featureId)!) for (const [x, z] of ring) {
        minX = Math.min(minX, x); maxX = Math.max(maxX, x); minZ = Math.min(minZ, z); maxZ = Math.max(maxZ, z);
      }
    }
    return minX <= maxX && minZ <= maxZ ? { minX: minX - PLAN_ROOM_MARGIN, maxX: maxX + PLAN_ROOM_MARGIN, minZ: minZ - PLAN_ROOM_MARGIN, maxZ: maxZ + PLAN_ROOM_MARGIN } : null;
  }, [plan, presentation.focusLevelId, model]);
  const readableGoal = useMemo(() => {
    const whole = { zoom: 1, dx: 0, dz: 0 };
    if (!planRooms) return whole;
    const view = { width: Math.max(1, size.width - safe.l - safe.r), height: Math.max(1, size.height - safe.t - safe.b) };
    const top = { yaw: 0, pitch: 90, zoom: 1, panX: 0, panY: 0 };
    const kWhole = makeProjection(top, frame, view, 1).k;
    if (kWhole >= PLAN_READABLE) return whole;
    const rooms = { min: [planRooms.minX, frame.min[1], planRooms.minZ], max: [planRooms.maxX, frame.max[1], planRooms.maxZ] } as unknown as typeof frame;
    const zoom = Math.min(makeProjection(top, rooms, view, 1).k, PLAN_READABLE) / kWhole;
    return zoom <= 1.01 ? whole : { zoom, dx: (planRooms.minX + planRooms.maxX - frame.min[0] - frame.max[0]) / 2, dz: (planRooms.minZ + planRooms.maxZ - frame.min[2] - frame.max[2]) / 2 };
  }, [planRooms, frame, size.width, size.height, safe]);
  const readable = useEased(readableGoal, { reduced, tau: 170 });
  minimumZoom.current = frameZoomMinimum(bounds,
    { width: Math.max(1, size.width - inset.l - inset.r), height: Math.max(1, size.height - inset.t - inset.b) },
    camera.eased, planBlend, 1 + (readable.zoom - 1) * planBlend,
    { x: readable.dx * planBlend, z: readable.dz * planBlend }, .6);
  const projection = useMemo(() => {
    const view = { width: Math.max(1, size.width - inset.l - inset.r), height: Math.max(1, size.height - inset.t - inset.b) };
    // Applied with the plan, so the 3D view and its depth range never change.
    const pose = { ...camera.eased, zoom: camera.eased.zoom * (1 + (readable.zoom - 1) * planBlend) };
    const base = makeProjection(pose, bounds, view, planBlend);
    const dx = readable.dx * planBlend, dz = readable.dz * planBlend;
    const centred = dx === 0 && dz === 0 ? base : makeProjection({ ...pose,
      panX: pose.panX - base.k * (dx * base.ct - dz * base.st), panY: pose.panY - base.k * (dx * base.st + dz * base.ct) * base.sf }, bounds, view, planBlend);
    return insetProjection(centred, inset.l, inset.t, size);
  }, [camera.eased, bounds, size, planBlend, inset, readable]);
  // The real sun for the chosen moment, fixed to the house: shadows fall where they would.
  // Where the release says the house stands, unless this device set its own location.
  const sunLocation = useSunLocation(), geographic = model.scene.geographic, lightingTime = useLightingTime();
  const { workspaceId, homeId } = model.scene.scope, { publicationId } = model.scene.publication;
  useEffect(() => showModelGeographic({ workspaceId, homeId, publicationId }, geographic), [workspaceId, homeId, publicationId, geographic]);
  const sunPlace = useMemo(() => resolveSunPlace(sunLocation, geographic), [sunLocation, geographic]);
  const daylight = useMemo(() => daylightAt(lightingTime.at, sunPlace), [lightingTime.at, sunPlace]);
  const light = daylight.toward, across = Math.max(1e-6, Math.hypot(light[0], light[2]));
  const shadowOffset = [-light[0] / across * SHADOW_LENGTH, -light[2] / across * SHADOW_LENGTH] as const;
  const stageStyle = useMemo(() => stageColors(daylight.dusk) as CSSProperties, [daylight.dusk]);
  const lifts = useMemo(() => partLifts(model, presentation, t), [model, presentation, t]);
  // Roof slopes take the pitch tone; site terrain the flat board tone. By role only, never by name.
  const roofKeys = useMemo(() => new Set(model.parts.filter(part => part.role === 'roof').map(part => part.mesh.meshKey)), [model]);
  const site = useMemo(() => ({ keys: new Set(model.parts.filter(part => part.role === 'context').map(part => part.mesh.meshKey)), tone: ATLAS_SITE }), [model]);
  // Context fades into the stage with distance from the house, and is not drawn past the fade.
  const around = useMemo(() => atlasSurroundings(model, PITCH_3D.min), [model]);
  const surroundings = useMemo(() => around ? { ...around, backdrop: stageBackdrop(daylight.dusk) } : undefined, [around, daylight.dusk]);
  const shelterKeys = useMemo(() => new Set(model.parts.filter(part => SHELTER_ROLES.has(part.role)).map(part => part.mesh.meshKey)), [model]);
  const roomKeys = useMemo(() => new Set(model.parts.filter(part => part.role === 'room-pick').map(part => part.mesh.meshKey)), [model]);
  // After dusk the house's own glass shows its lit rooms, and every lamp glows.
  const glazingKeys = useMemo(() => new Set(model.parts.filter(isAtlasGlazing)
    .map(part => part.mesh.meshKey)), [model]);
  const emitterKeys = useMemo(() => new Set(model.parts.filter(part => part.mesh.sourceNight === 'emitter').map(part => part.mesh.meshKey)), [model]);
  const showCanvas = planBlend < 1 && failure === null;

  // A new place is framed whole: zoom and pan return, the chosen orbit stays.
  // Within one place, Plan and 3D each keep the user's own zoom and pan, so a
  // look at the other view and back returns to the same framing.
  const placeLevel = state.levelId === null ? null : displayLevelAnchor(model, state.levelId);
  const place = `${state.buildingId}\n${placeLevel}\n${state.exploded}`;
  const frameView = plan ? `plan:${state.levelId}` : '3d';
  const framed = useRef({ place, view: frameView });
  const viewFraming = useRef(new Map<string, StageFraming>());
  useEffect(() => {
    const left = framed.current;
    if (left.place === place && left.view === frameView) return;
    if (left.place === place) viewFraming.current.set(left.view, camera.framing); else viewFraming.current.clear();
    framed.current = { place, view: frameView };
    const saved = viewFraming.current.get(frameView);
    if (saved) camera.restore(saved); else camera.reframe();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [place, frameView]);
  // On a phone a lens opening, closing or changing resizes the map band: the
  // model is framed whole again in the band it leaves, the chosen orbit kept.
  const lensKind = lens?.kind ?? null;
  const lensFramed = useRef(lensKind);
  useEffect(() => {
    if (lensFramed.current === lensKind) return;
    lensFramed.current = lensKind;
    if (compact) camera.reframe();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lensKind, compact]);

  // Plans relative to the fixed origin; one translate follows the eased centre.
  // Each drawn floor keeps its own height, so the property plan never stacks floors.
  const planLevelsKey = presentation.planLevels.join('\n');
  const planGroups = useMemo(() => (planLevelsKey ? planLevelsKey.split('\n') : []).map(levelId => {
    const features = planFeaturesForLevel(model, levelId).map((feature, at) => ({ feature, at }))
      .sort((a, b) => PLAN_ORDER[a.feature.role] - PLAN_ORDER[b.feature.role] || a.at - b.at)
      .map(({ feature }) => ({ feature, path: relativePath(model.featureRings.get(feature.featureId)!, origin) }));
    return { levelId, features };
  }), [model, planLevelsKey, origin]);
  const planned = useMemo(() => new Set(planGroups.map(group => group.levelId)), [planGroups]);
  const planAt = (y: number) => `${projection.planMatrix(y)} translate(${origin[0] - projection.center[0]} ${origin[2] - projection.center[2]})`;
  const planTransform = (levelId: string) => planAt(model.floorY.get(levelId)! + levelLift(presentation, levelId, t));
  const selectedOutline = useMemo(() => {
    const occurrence = selected === null ? undefined : model.occurrencesById.get(selected), shape = selected === null ? undefined : model.shapes.get(selected);
    return occurrence && shape ? { occurrenceId: occurrence.spaceOccurrenceId, levelId: occurrence.levelId, path: shape.map(rings => relativePath(rings, origin)).join(' ') } : null;
  }, [model, selected, origin]);
  const planDrawn = planGroups.some(group => group.features.length > 0);
  // The reviewed transmitter room, named only when it resolves in this publication.
  const radioPlaceName = (state: RadioFeedState) => {
    const id = radioPlacement(state.station, model.scene);
    return id ? atlasOccurrenceName(model, id) : null;
  };
  // Rings sit on the transmitter room's floor at its label point, only while that floor is drawn.
  const radioRingPlace = (state: RadioFeedState): RingPlace | null => {
    const id = radioPlacement(state.station, model.scene), occurrence = id ? model.occurrencesById.get(id) : undefined, point = id ? model.labels.get(id) : undefined;
    if (!id || !occurrence || !point || !(planBlend >= .5 ? planned.has(occurrence.levelId) : presentation.visibleLevels.has(occurrence.levelId))) return null;
    return { transform: planAt(occurrenceFloorHeight(model, presentation, id, t) + ROOM_PLATE), x: point.x - origin[0], z: point.z - origin[2] };
  };
  const planShown = planBlend > 0 && planDrawn;
  const sitePlan = plan && presentation.focusLevelId === null;

  // The ground the buildings stand on: one plate under every building, in the model frame.
  const ground = useMemo(() => {
    const b = model.scene.buildings, m = 3;
    const minX = Math.min(...b.map(row => row.bounds.min[0])), maxX = Math.max(...b.map(row => row.bounds.max[0]));
    const minZ = Math.min(...b.map(row => row.bounds.min[2])), maxZ = Math.max(...b.map(row => row.bounds.max[2]));
    return { y: Math.min(...b.map(row => row.bounds.min[1])), x: minX - m - origin[0], z: minZ - m - origin[2], w: maxX - minX + 2 * m, h: maxZ - minZ + 2 * m };
  }, [model, origin]);
  // The board ends where the surroundings start to fade (a box `near` past the house, its
  // corners rounded by `near`), so whatever fades lies over the stage it fades into.
  const whole = around && { x: around.center[0] - around.half[0] - around.near - origin[0], z: around.center[1] - around.half[1] - around.near - origin[2],
    w: 2 * (around.half[0] + around.near), h: 2 * (around.half[1] + around.near), r: around.near };
  // Each building's lowest authored floor plan, as its contact shadow on the board.
  const footprints = useMemo(() => model.floorBuildings.flatMap(row => {
    const lowest = model.levelsByBuilding.get(row.buildingId)?.[0];
    return !lowest ? [] : planFeaturesForLevel(model, lowest.levelId).filter(feature => feature.role === 'room' || feature.role === 'wall')
      .map(feature => ({ key: feature.featureId, path: relativePath(model.featureRings.get(feature.featureId)!, origin) }));
  }), [model, origin]);
  const gridId = `ua-grid-${useId().replace(/[^A-Za-z0-9_-]/g, '')}`;
  const boardClip = whole ? `url(#${gridId}-whole)` : undefined;

  const lift = (occurrenceId: string) => levelLift(presentation, occurrenceLiftLevel(model, occurrenceId), t);
  // Anchors glide from a room's top (or its section) down to its floor as the
  // camera tips into Plan, so labels and counts never jump between views.
  const settle = planBlend * planBlend * (3 - 2 * planBlend);
  const anchorOf = (occurrenceId: string) => {
    const point = model.labels.get(occurrenceId); if (!point) return null;
    const floor = model.floorY.get(model.occurrencesById.get(occurrenceId)!.levelId)!, top = labelHeight(model, shown, occurrenceId, false);
    const [x, sy] = projection.project(point.x, top + (floor - top) * settle + lift(occurrenceId), point.z);
    return { x, y: sy, clearance: point.clearance };
  };
  // A plan shows only its own floors' points; other floors appear in their own small plans, never flattened onto this one.
  const onStage = (occurrenceId: string) => planBlend < .5 || planned.has(model.occurrencesById.get(occurrenceId)!.levelId);

  // Room controls follow what a tap would pick: rooms revealed by the eased
  // section in 3D, the target floor's plan once the camera has tipped into Plan.
  const live = planBlend >= .5 ? presentation.pickable : shown.pickable;
  // In 3D, a name drawn on more than one floor adds that room's own floor, selected
  // floor or not; unique names stay bare, and a plan shows bare names. Spread
  // floors stand apart, so there the floor is left off a name whose namesakes
  // each stand on their own floor; the accessible name keeps it.
  // An estimated room outline keeps its Preliminary marker on the model, measured with its name.
  const spreadNames = state.exploded && !plan;
  const labelTexts = useMemo(() => new Map([...drawnRoomNames(model, live, state.buildingId, !plan,
    spreadNames ? key => occurrenceLiftLevel(model, key) : undefined)].map(([key, name]) =>
    [key, isPreliminary(model, key) ? `${name}${PRELIMINARY}` : name] as const)), [live, model, plan, state.buildingId, spreadNames]);
  const nameText = (label: RoomLabel) => isPreliminary(model, label.id) && label.text.endsWith(PRELIMINARY)
    ? <>{label.text.slice(0, -PRELIMINARY.length)}<tspan className="ua-label-note">{PRELIMINARY}</tspan></> : label.text;
  const labelFloors = useMemo(() => drawnRoomFloors(model, live, state.buildingId, !plan), [live, model, plan, state.buildingId]);
  // Touch targets, 3D and Plan alike, are reserved at the 44 px they are drawn at.
  const coarse = useSyncExternalStore(coarseChanges, coarseNow, () => false);
  // Devices the reviewed room mapping places in each room, the source's root first.
  // A room with any is drawn as their glyphs in place of the Network count.
  const admittedDevices = useMemo(() => networkOn ? admittedNetworkDevices(runtime.records) : [], [networkOn, runtime.records]);
  const roomDevices = useMemo(() => {
    const devices = new Map((runtime.records?.networkGraphs ?? []).flatMap(graph => graph.data.devices.map(device =>
      [networkConnectionNodeKey(graph.key, 'device', device.id), { graphKey: graph.key, device }] as const)));
    const rooms = new Map<string, PlacedDevice[]>();
    for (const row of admittedDevices) {
      const key = networkConnectionNodeKey(row.graphKey, 'device', row.deviceId), found = devices.get(key);
      if (!found) continue;
      const own = rooms.get(row.roomId) ?? [];
      if (!own.some(item => item.key === key)) own.push({ key, ...found });
      rooms.set(row.roomId, own);
    }
    for (const own of rooms.values()) own.sort((a, b) => Number(b.device.sourceRoot === true) - Number(a.device.sourceRoot === true)
      || a.device.label.localeCompare(b.device.label) || (a.key < b.key ? -1 : 1));
    return rooms;
  }, [admittedDevices, runtime.records]);
  const markers = useMemo(() => {
    const rows: StageMarker[] = [];
    const spread = active.length > 1;
    for (const layer of active) for (const placement of layer.placed.values()) {
      const occurrenceId = placement.occurrenceId;
      // A binding with no record IDs keeps its tint and provenance but has no count to show.
      if (placement.recordCount === 0 || !onStage(occurrenceId)) continue;
      const at = anchorOf(occurrenceId); if (!at) continue;
      const devices = layer.kind === 'network' ? roomDevices.get(placement.roomId) : undefined;
      rows.push({ key: `${layer.kind}:${occurrenceId}`, kind: layer.kind, occurrenceId, roomLabel: atlasOccurrenceName(model, occurrenceId),
        count: devices?.length ?? placement.recordCount, x: at.x + (spread ? (layer.kind === 'electrical' ? -MARKER_SPREAD : MARKER_SPREAD) : 0), y: at.y,
        context: !live.has(occurrenceId),
        ...devices ? { devices, width: networkGlyphSlots(devices.length) * networkGlyphSlot(coarse) } : {} });
    }
    return rows;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, live, presentation, shown, projection, t, planBlend, model, planned, roomDevices, coarse]);
  // A room's row of device glyphs that does not fit folds to one count chip, kept where that fits.
  const counts = useMemo(() => {
    const kept = visibleCountMarkers(markers, size, cover, selected, context), shownRows = new Set(kept);
    const folded = markers.filter(row => row.devices && row.devices.length > 1 && !shownRows.has(row))
      .map(row => ({ ...row, folded: true, width: Math.max(countMarkerWidth(row.count), networkGlyphSlot(coarse)) }));
    return folded.length > 0 ? visibleCountMarkers([...kept, ...folded], size, cover, selected, context) : kept;
  }, [markers, size, cover, selected, context, coarse]);
  // Parts of one room on several floors in view share its name; their counts then name the floor too.
  const sharedNames = useMemo(() => {
    const seen = new Map<string, number>();
    for (const row of counts) seen.set(`${row.kind}\n${row.roomLabel}`, (seen.get(`${row.kind}\n${row.roomLabel}`) ?? 0) + 1);
    return new Set([...seen].filter(([, shown]) => shown > 1).map(([name]) => name));
  }, [counts]);
  const countGroups = useMemo(() => {
    const groups = new Map<string, StageMarker[]>();
    for (const marker of counts) { const own = groups.get(marker.occurrenceId) ?? []; own.push(marker); groups.set(marker.occurrenceId, own); }
    return groups;
  }, [counts]);
  const markerAt = useMemo(() => new Set(counts.map(row => row.occurrenceId)), [counts]);
  const positions = useMemo(() => active.flatMap(layer => [...layer.placed.values()].flatMap(placement => placement.positions.flatMap((row, at) => {
    if (!onStage(row.occurrenceId)) return [];
    const [x, y] = projection.project(row.position[0], row.position[1] + lift(row.occurrenceId), row.position[2]);
    return [{ key: JSON.stringify([layer.kind, row.occurrenceId, at]), kind: layer.kind, x, y, context: !live.has(row.occurrenceId) }];
  }))),
  // eslint-disable-next-line react-hooks/exhaustive-deps
  [active, live, presentation, projection, t, planned, planBlend]);

  // The whole property's qualified room associations, independent of focus or
  // count-label collision suppression. These are logical summaries, not routes.
  // A device's route to the router, chosen in the network graph, also lights on the stage.
  const [electricalGroupSelection, setElectricalGroupSelection] = useState<{ key: string; records: typeof runtime.records } | null>(null);
  useEffect(() => { setElectricalGroupSelection(null); }, [runtime.records, electricalOn]);
  useEffect(() => { if (state.occurrenceId === null) setElectricalGroupSelection(null); }, [state.occurrenceId]);
  const groups = useMemo(() => electricalGroups(electricalOn ? runtime.records : null), [electricalOn, runtime.records]);
  const electricalGroup = state.occurrenceId === null || electricalGroupSelection?.records !== runtime.records ? null
    : groups.find(group => group.key === electricalGroupSelection.key) ?? null;
  const groupRooms = new Set(electricalGroup?.members.flatMap(member => member.rooms) ?? []);
  const onElectricalGroup = (key: string) => {
    const group = groups.find(row => row.members.some(member => member.record.key === key));
    setElectricalGroupSelection(group ? { key: group.key, records: runtime.records } : null);
  };
  const [networkTrace, setNetworkTrace] = useState<StageTrace | null>(null);
  const onNetworkTrace = useCallback((graphKey: string, trace: StageTrace | null, data: StageTrace['data']) =>
    setNetworkTrace(current => publishStageTrace(current, graphKey, data, trace)), []);
  const stageTrace = currentStageTrace(networkTrace, graphs, showGraph);
  // Each placed device's glyph on the stage: its slot in its room's row, the
  // +n chip for the rest, or the room's anchor where the row is not drawn.
  const glyphPoints = useMemo(() => {
    const points = new Map<string, readonly [number, number]>();
    for (const row of counts) if (row.devices) {
      const slots = networkGlyphSlots(row.devices.length);
      row.devices.forEach((device, at) => points.set(`${device.key}\n${row.occurrenceId}`,
        row.folded ? [row.x, row.y] : [row.x + networkGlyphOffset(Math.min(at, slots - 1), slots, coarse), row.y]));
    }
    return points;
  }, [counts, coarse]);
  const networkConnections = useMemo(() => networkRoomConnections(networkOn ? runtime.records : null,
    admittedDevices.flatMap(row => (model.roomsById.get(row.roomId)?.occurrenceIds ?? []).flatMap((occurrenceId): NetworkDeviceAnchor[] => {
      if (!model.selectable.has(occurrenceId)) return [];
      const glyph = glyphPoints.get(`${networkConnectionNodeKey(row.graphKey, 'device', row.deviceId)}\n${occurrenceId}`);
      const at = glyph ? null : anchorOf(occurrenceId);
      return glyph ? [{ ...row, occurrenceId, point: glyph }] : at ? [{ ...row, occurrenceId, point: [at.x + (active.length > 1 ? MARKER_SPREAD : 0), at.y] }] : [];
    }))),
  // eslint-disable-next-line react-hooks/exhaustive-deps
  [networkOn, runtime.records, admittedDevices, glyphPoints, model, projection, presentation, shown, t, planBlend, active.length]);
  // A device, link or room's devices chosen on the map show in the card; the camera stays where it is.
  const [netFocus, setNetFocus] = useState<NetworkFocus | null>(null);
  useEffect(() => { setNetFocus(null); }, [runtime.records, networkOn, state.occurrenceId]);
  const focusNode = netFocus?.kind === 'device' ? netFocus.key : null, focusLink = netFocus?.kind === 'link' ? netFocus.key : null;
  leaveNetworkCard.current = () => { if (netFocus === null) return false; setNetFocus(null); return true; };
  // Glyphs drawn as chosen: the device, or both ends of the link.
  const chosenDevices = useMemo(() => {
    if (focusNode !== null) return new Set([focusNode]);
    const row = focusLink === null ? undefined : networkConnections.connections.find(item => item.key === focusLink);
    return new Set(row ? networkConnections.nodes.filter(node => node.device && linkTouches(row, node.key)).map(node => node.key) : []);
  }, [focusNode, focusLink, networkConnections]);

  // The selected room's tag stands on a leader in 3D and folds onto its floor
  // as the camera reaches Plan: one landmark through every view.
  const foldedRise = Math.min(1, Math.max(0, 1 - planBlend / .6));
  const [labelFonts, setLabelFonts] = useState({ text: 'sans-serif', display: 'serif', revision: 0 });
  useLayoutEffect(() => {
    let mounted = true;
    const measure = () => {
      if (!mounted || !viewport.current) return;
      const style = getComputedStyle(viewport.current);
      setLabelFonts(previous => ({ text: style.getPropertyValue('--text').trim() || 'sans-serif',
        display: style.getPropertyValue('--display').trim() || 'serif', revision: previous.revision + 1 }));
    };
    measure();
    void document.fonts.ready.then(measure);
    document.fonts.addEventListener('loadingdone', measure);
    return () => { mounted = false; document.fonts.removeEventListener('loadingdone', measure); };
  }, []);
  const targetHeight = labelHitHeight(coarse);
  const planTextMetrics = useMemo(() => {
    const canvas = document.createElement('canvas'), drawing = canvas.getContext('2d');
    const metrics = new Map<string, { width: number; height: number; advance?: number }>();
    for (const occurrenceId of live) {
      const tier = occurrenceId === selected ? 'selected' : context.includes(occurrenceId) ? 'context' : 'plain';
      const text = labelTexts.get(occurrenceId)!;
      const fontSize = tier === 'selected' ? 15 : 12.5, halo = tier === 'selected' ? 17 : tier === 'context' ? 13 : 4.5;
      if (!drawing) { metrics.set(occurrenceId, { width: Infinity, height: Infinity }); continue; }
      drawing.font = `${tier === 'selected' ? 750 : tier === 'context' ? 700 : 600} ${fontSize}px ${tier === 'selected' ? labelFonts.display : labelFonts.text}`;
      const bounds = drawing.measureText(text);
      metrics.set(occurrenceId, { advance: bounds.width,
        width: bounds.width + 2 * Math.max(Math.abs(bounds.actualBoundingBoxLeft), Math.abs(bounds.actualBoundingBoxRight - bounds.width)) + halo + 1,
        height: 2 * Math.max(Math.abs(bounds.actualBoundingBoxAscent - fontSize * .35), Math.abs(bounds.actualBoundingBoxDescent + fontSize * .35)) + halo + 1 });
    }
    return metrics;
  }, [live, selected, context, labelTexts, labelFonts]);
  /** A name's paper, as wide as the measured name: the selected tag on either
   * stage, or another room's quiet chip in 3D. */
  const nameTag = (id: string, tier: RoomLabel['tier'], anchor: 'start' | 'middle' | 'end' = 'middle', x = 0) => {
    const advance = planTextMetrics.get(id)?.advance;
    if (advance === undefined) return null;
    const left = x - (anchor === 'start' ? 0 : anchor === 'end' ? advance : advance / 2), pad = stageLabelPad(tier), h = stageLabelHeight(tier);
    return <rect className={tier === 'selected' ? 'cifc-label-tag' : 'ua-label-chip'} x={left - pad} y={-h / 2} width={advance + 2 * pad} height={h} rx={h / 2} />;
  };
  const labelPaper = useMemo(() => preparePlanLabelPaper(planGroups.flatMap(group => group.features.map(row => row.feature))), [planGroups]);
  // Only the fit decision looks ahead to top view. It does not alter the camera.
  const selectedNeedsStandingTag = useMemo(() => {
    if (!plan || selected === null || presentation.focusLevelId === null) return false;
    const anchor = model.labels.get(selected), polygons = model.roomPolygons.get(selected), metrics = planTextMetrics.get(selected);
    if (!anchor || !polygons || !metrics) return true;
    const view = { width: Math.max(1, size.width - inset.l - inset.r), height: Math.max(1, size.height - inset.t - inset.b) };
    const top = makeProjection({ ...camera.eased, pitch: 90, zoom: camera.eased.zoom * readable.zoom }, bounds, view, 1);
    const frame = planLabelFrame(top.project, model.floorY.get(model.occurrencesById.get(selected)!.levelId)!);
    const [x, y] = top.project(anchor.x, model.floorY.get(model.occurrencesById.get(selected)!.levelId)!, anchor.z);
    const currentAnchor = anchorOf(selected);
    const ownCounts = currentAnchor ? (countGroups.get(selected) ?? []).map(marker => ({ ...marker,
      x: x + marker.x - currentAnchor.x, y: y + marker.y - currentAnchor.y })) : [];
    return !planRoomLabelFits({ id: selected, text: '', tier: 'selected', x, y: y - (markerAt.has(selected) ? 22 : 0), anchorX: x, anchorY: y,
      rise: 0, clearance: anchor.clearance, shape: preparePlanLabelShape(polygons), metrics, targetHeight }, frame, ownCounts);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [plan, selected, presentation, shown, model, planTextMetrics, size, inset, camera.eased, readable.zoom, bounds, markerAt, countGroups, projection, t, planBlend, targetHeight]);
  const standingSelection = useRef<string | null>(null);
  // The standing goal survives the early return tilt, until the ordinary
  // 3D rise reaches one. Otherwise it would dip and then rise a second time.
  const keepStanding = selectedNeedsStandingTag || (!plan && foldedRise < 1 && selected !== null && standingSelection.current === selected);
  useLayoutEffect(() => {
    if (plan) standingSelection.current = selectedNeedsStandingTag ? selected : null;
    else if (foldedRise === 1 || standingSelection.current !== selected) standingSelection.current = null;
  }, [plan, selectedNeedsStandingTag, selected, foldedRise]);
  const standingTag = useEased({ rise: keepStanding ? 1 : 0 }, { reduced, tau: 100 });
  const rise = Math.max(foldedRise, standingTag.rise);
  const calloutDirections = useRef<ReadonlyMap<string, number>>(new Map());
  const settledPlan = plan && planBlend === 1 && presentation.focusLevelId !== null;
  // Room names wait for the 3D layer's first drawn frame, so none stands over an empty site.
  const undrawn = showCanvas && displayed === null && model.meshes.length > 0;
  const labels = useMemo(() => {
    if (undrawn) return [];
    const rows: (RoomLabel & { clearance: number; anchorX: number; anchorY: number })[] = [];
    for (const occurrenceId of live) {
      const at = anchorOf(occurrenceId); if (!at) continue;
      const tier = occurrenceId === selected ? 'selected' : context.includes(occurrenceId) ? 'context' : 'plain';
      // Plain labels cover the selected group; lower context stays quiet.
      if (tier === 'plain' && ((!settledPlan && at.clearance * projection.k < 18)
        || !plainLabelInFocus(model, presentation, occurrenceId))) continue;
      const lifted = markerAt.has(occurrenceId) ? 22 : 0;
      const metrics = planTextMetrics.get(occurrenceId), preferredY = at.y - lifted;
      // Ease the extra full-target clearance with Plan, so settlement itself
      // never changes the name's offset from 22 pixels to its resolved height.
      const clearY = metrics ? countClearedLabelY({ id: occurrenceId, x: at.x, y: preferredY, metrics, targetHeight }, countGroups.get(occurrenceId) ?? []) : preferredY;
      rows.push({ id: occurrenceId, text: labelTexts.get(occurrenceId)!, x: at.x, y: preferredY + (clearY - preferredY) * settle,
        anchorX: at.x, anchorY: at.y, tier, clearance: at.clearance, rise: tier === 'selected' ? rise : 0 });
    }
    const rank = { selected: 0, context: 1, plain: 2 } as const;
    rows.sort((a, b) => rank[a.tier] - rank[b.tier] || b.clearance - a.clearance);
    if (settledPlan) {
      const frame = planLabelFrame(projection.project, model.floorY.get(presentation.focusLevelId!)! + levelLift(presentation, presentation.focusLevelId!, t));
      const candidates: PlanLabelInput[] = rows.flatMap(row => {
        const polygons = model.roomPolygons.get(row.id), at = anchorOf(row.id), metrics = planTextMetrics.get(row.id);
        return polygons && at && metrics ? [{ ...row, anchorX: at.x, anchorY: at.y, metrics, targetHeight, shape: preparePlanLabelShape(polygons) }] : [];
      });
      return placePlanRoomLabels(candidates, size, cover, counts, frame, labelPaper, calloutDirections.current);
    }
    // Panels count as placed: a room name under one is left to the room list.
    return placeStageLabels(rows, row => planTextMetrics.get(row.id)?.advance, size, cover);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [live, presentation, shown, projection, t, planBlend, selected, context, markerAt, model, size, cover, settledPlan, planTextMetrics, counts, countGroups, labelPaper, rise, undrawn, labelTexts, targetHeight]);
  useLayoutEffect(() => {
    if (settledPlan) {
      const directions = new Map(calloutDirections.current);
      for (const row of labels) if (row.plan?.direction != null) directions.set(row.id, row.plan.direction);
      calloutDirections.current = directions;
    }
  }, [settledPlan, labels]);

  // Measurements: off by default; areas for the rooms in view, edge spans for
  // the selected room or else those rooms, dropped where they would collide.
  const measuring = state.layers.measurements;
  const measured = useMemo(() => measuring ? [...live].filter(onStage) : [],
  // eslint-disable-next-line react-hooks/exhaustive-deps
    [measuring, live, planned, planBlend]);
  const measures = useMemo(() => {
    if (!measuring) return { areas: [], spans: [] };
    const blocked: Box[] = [...cover, ...labels.flatMap(row => {
      if (row.plan) return planLabelObstacles(row);
      return [stageLabelBox(row, planTextMetrics.get(row.id)?.advance)];
    }), ...counts.map(countMarkerTarget)];
    const areas = placeLabels(measured.flatMap(occurrenceId => {
      const area = roomArea(model, occurrenceId), at = area && anchorOf(occurrenceId);
      if (!area || !at) return [];
      const text = area.partial ? `${area.text}, this part` : area.text;
      return [{ key: occurrenceId, text, measured: area.measured, x: at.x, y: at.y + 17, w: text.length * 6.6 + 10, h: 16 }];
    }), blocked, size);
    const owners = selected !== null && measured.includes(selected) ? [selected] : measured;
    const spans = owners.flatMap(occurrenceId => {
      const y = model.floorY.get(model.occurrencesById.get(occurrenceId)!.levelId)! + lift(occurrenceId);
      return edgeSpans(model, occurrenceId).filter(span => span.drawn).flatMap(span => {
        const a = projection.project(span.a[0], y, span.a[1]), b = projection.project(span.b[0], y, span.b[1]);
        const mx = (span.a[0] + span.b[0]) / 2, mz = (span.a[1] + span.b[1]) / 2;
        const m = projection.project(mx, y, mz), n = projection.project(mx + span.inward[0], y, mz + span.inward[1]);
        const nx = n[0] - m[0], ny = n[1] - m[1], nl = Math.hypot(nx, ny), screen = Math.hypot(b[0] - a[0], b[1] - a[1]);
        const w = span.text.length * 6.4 + 8;
        if (nl < 1e-6 || screen < w + 12) return [];
        const ux = nx / nl, uy = ny / nl;
        return [{ key: span.key, text: span.text, measured: span.measured, length: screen, w, h: 15, x: m[0] + ux * 12, y: m[1] + uy * 12,
          line: [a[0] + ux * 4, a[1] + uy * 4, b[0] + ux * 4, b[1] + uy * 4] as const }];
      });
    }).sort((p, q) => q.length - p.length);
    const placedAreas: Box[] = areas.map(row => ({ l: row.x - row.w / 2, r: row.x + row.w / 2, t: row.y - row.h / 2, b: row.y + row.h / 2 }));
    return { areas, spans: placeLabels(spans, [...blocked, ...placedAreas], size) };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [measuring, measured, selected, labels, counts, cover, size, projection, presentation, t, model]);
  const estimated = useMemo(() => measuring ? estimatedOccurrences(model, model.selectable).length : 0, [measuring, model]);

  // The moving section, drawn only while it travels and fading as it lands.
  // One plane is true only while the building's floors stand at their source
  // heights; parted floors are each cut at their own lift, so the cue stays off
  // and the floors themselves show the cut.
  const planes = useMemo(() => planBlend >= .5 ? [] : model.floorBuildings.flatMap((row, at) => {
    const cut = cuts[at]!, away = Math.abs(cut - sectionGoal[at]!);
    if (away < .02 || cut >= ceilings[at]! - 1e-3 || (t > 0 && hasExplodableLevels(model, row.buildingId))) return [];
    const b = row.bounds, m = .3;
    const points = ([[b.min[0] - m, b.min[2] - m], [b.max[0] + m, b.min[2] - m], [b.max[0] + m, b.max[2] + m], [b.min[0] - m, b.max[2] + m]] as const)
      .map(([x, z]) => projection.project(x, cut, z)).map(([x, py]) => `${x.toFixed(1)},${py.toFixed(1)}`).join(' ');
    return [{ key: row.buildingId, points, opacity: Math.min(1, away / .8) * (1 - planBlend * 2) }];
  }), [planBlend, model, cuts, sectionGoal, ceilings, t, projection]);

  // Building names on the property plan, at each building's own plan.
  const siteNames = useMemo(() => !sitePlan ? [] : planGroups.flatMap(group => {
    const rings = group.features.flatMap(row => model.featureRings.get(row.feature.featureId)!);
    if (rings.length === 0) return [];
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (const ring of rings) for (const [x, z] of ring) { minX = Math.min(minX, x); maxX = Math.max(maxX, x); minZ = Math.min(minZ, z); maxZ = Math.max(maxZ, z); }
    const [x, y] = projection.project((minX + maxX) / 2, model.floorY.get(group.levelId)!, minZ);
    return [{ key: group.levelId, text: atlasBuildingName(model, model.levelsById.get(group.levelId)!.buildingId), x, y: y - 10 }];
  }), [sitePlan, planGroups, model, projection]);

  // Stage buttons exist only where the whole control is in view: inside the
  // stage and clear of every panel. Covered rooms stay in the room list.
  // Touch targets are computed at the 44 px they are drawn at (coarse, above); the pointer can change (a docked tablet).
  const hitBoxes = useMemo(() => labelHitBoxes(labels, size, cover, counts, row => planTextMetrics.get(row.id)?.advance, coarse), [labels, size, cover, counts, planTextMetrics, coarse]);
  const hits = useMemo(() => labels.filter(row => hitBoxes.has(row)), [labels, hitBoxes]);
  // In a plan, a link to another floor ends in a stub with that floor's badge.
  const floorBadges = useMemo(() => {
    if (!networkOn || planBlend < .5) return [];
    const badges = new Map<string, { key: string; x: number; y: number; levelId: string; name: string; names: string[]; box: { l: number; r: number; t: number; b: number } }>();
    for (const row of networkConnections.connections) for (const placement of row.placements) {
      const fromShown = onStage(placement.from.occurrenceId), toShown = onStage(placement.to.occurrenceId);
      if (fromShown === toShown) continue;
      const [near, far] = fromShown ? [placement.from, placement.to] : [placement.to, placement.from];
      const levelId = model.occurrencesById.get(far.occurrenceId)!.levelId, [x, y] = networkStubEnd(near.point, far.point, networkStubLength(coarse));
      const key = `${Math.round(near.point[0])},${Math.round(near.point[1])}\n${levelId}`;
      if (!badges.has(key)) {
        // Only where the whole badge is in view and clear of panels, glyphs, room names and other badges;
        // otherwise its link stays in the device's card and the graph.
        // Named within the near end's building; another building's floor keeps its building.
        const name = atlasScopedLevelName(model, levelId, model.occurrencesById.get(near.occurrenceId)!.buildingId);
        const half = Math.max(coarse ? 22 : 11, (name.length * 6.5 + 20) / 2), tall = coarse ? 22 : 11;
        const box = { l: x - half, r: x + half, t: y - tall, b: y + tall };
        const hit = (other: { l: number; r: number; t: number; b: number }) => box.l < other.r && box.r > other.l && box.t < other.b && box.b > other.t;
        if (box.l < 0 || box.t < 0 || box.r > size.width || box.b > size.height || cover.some(hit) || counts.some(row => hit(countMarkerTarget(row)))
          || [...hitBoxes.values()].some(hit)
          || [...badges.values()].some(other => hit(other.box))) continue;
        badges.set(key, { key, x, y, levelId, name, names: [], box });
      }
      const badge = badges.get(key)!;
      const farEnd = far === placement.to ? row.to : row.from, farKey = farEnd.ownerDeviceKey ?? farEnd.nodeKey;
      const farName = networkConnections.nodes.find(node => node.key === farKey)?.label ?? farEnd.label;
      if (!badge.names.includes(farName)) badge.names.push(farName);
    }
    return [...badges.values()];
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [networkOn, planBlend, networkConnections, planned, model, size, cover, counts, coarse, hitBoxes]);
  // On touch a drawn name promises a tap: names without a target are not drawn
  // (an open sheet sets every target aside), and with a room selected the other
  // rooms named on its floor step back to a quiet pill of the same size.
  const drawnLabels = useMemo(() => drawnStageLabels(labels, hitBoxes, coarse, sheetOpen), [labels, hitBoxes, coarse, sheetOpen]);
  const selectedLevel = selected === null ? null : model.occurrencesById.get(selected)!.levelId;
  const quietLabel = (label: (typeof labels)[number]) => coarse && label.tier === 'plain'
    && model.occurrencesById.get(label.id)!.levelId === selectedLevel;
  // Rooms in view and in the label focus that the model leaves unnamed, marked
  // in the Rooms list. Taken with the sheet closed, since the open sheet covers
  // the stage and sets names aside.
  const unnamedNow = (undrawn ? [] : unnamedRooms(live, id => id === selected || context.includes(id)
    || plainLabelInFocus(model, presentation, id), drawnStageLabels(labels, hitBoxes, coarse))).join('\n');
  // Held for one view and scope: retaken or cleared when either changes.
  const unnamedScope = `${state.view}\n${state.buildingId}\n${state.levelId}\n${state.exploded}`;
  const [unnamedHeld, setUnnamed] = useState<UnnamedSnapshot>({ scope: '', ids: '' });
  useLayoutEffect(() => { setUnnamed(held => nextUnnamedSnapshot(held, unnamedScope, unnamedNow, sheetOpen)); }, [sheetOpen, unnamedNow, unnamedScope]);
  const unnamed = useMemo(() => new Set(unnamedHeld.scope === unnamedScope && unnamedHeld.ids ? unnamedHeld.ids.split('\n') : []), [unnamedHeld, unnamedScope]);
  // A focused stage control can leave the stage: its tag rises past an edge,
  // a panel grows over it or its floor is cut away. Focus then returns to the
  // stage itself, without scrolling, instead of falling to the page.
  const stageFocus = useRef<string | null>(null);
  const stageKeys = [...hits.map(label => `label:${label.id}`), ...counts.flatMap(markerKeys), ...floorBadges.map(row => `floor:${row.key}`)].join('\n');
  useLayoutEffect(() => {
    const key = stageFocus.current;
    if (key === null || stageKeys.split('\n').includes(key)) return;
    stageFocus.current = null;
    const active = document.activeElement;
    if (active === null || active === document.body) viewport.current?.focus({ preventScroll: true });
  }, [stageKeys]);
  const focusIn = (event: FocusEvent<HTMLDivElement>) => {
    stageFocus.current = event.target instanceof HTMLElement ? event.target.dataset.stageKey ?? null : null;
  };
  const focusOut = (event: FocusEvent<HTMLDivElement>) => {
    const node = event.target; if (!(node instanceof HTMLElement)) return;
    const key = node.dataset.stageKey;
    if (key === undefined || stageFocus.current !== key) return;
    if (event.relatedTarget !== null) { stageFocus.current = null; return; }
    // Focus went nowhere: kept for recovery only if the control itself was removed.
    queueMicrotask(() => { if (node.isConnected && stageFocus.current === key) stageFocus.current = null; });
  };

  // On a wide stage a floor list cut short beside the docked keys keeps a
  // floor in view: the focused one, through the scrolling rail too, else the
  // current one. The page itself never scrolls.
  useLayoutEffect(() => {
    const ladders = compact ? [] : [...(shell.current?.querySelectorAll<HTMLElement>('.ua-stack-floors') ?? [])];
    const reveal = (frame: HTMLElement, target: HTMLElement) => {
      const box = target.getBoundingClientRect(), edge = frame.getBoundingClientRect();
      if (box.top < edge.top) frame.scrollTop -= edge.top - box.top + 6;
      else if (box.bottom > edge.bottom) frame.scrollTop += box.bottom - edge.bottom + 6;
    };
    const align = () => {
      for (const row of ladders) {
        if (row.getClientRects().length === 0) continue;
        const active = document.activeElement;
        const focused = active instanceof HTMLElement && active !== row && row.contains(active) ? active : null;
        const target = focused ?? row.querySelector<HTMLElement>('[aria-pressed="true"]');
        if (!target) continue;
        if (row.scrollHeight > row.clientHeight) reveal(row, target);
        // Only a focused floor moves the rail itself, so a rail scrolled by hand stays put otherwise.
        const rail = row.closest<HTMLElement>('.ua-scope');
        if (focused && rail && rail.scrollHeight > rail.clientHeight) reveal(rail, focused);
      }
    };
    align();
    const observer = new ResizeObserver(align);
    for (const row of ladders) { observer.observe(row); const rail = row.closest('.ua-scope'); if (rail) observer.observe(rail); }
    return () => observer.disconnect();
  }, [state.buildingId, state.levelId, plan, size.width, compact]);

  // Only buildings with floors are navigable; context-only groups stay drawn around them.
  const buildings = model.floorBuildings;
  const ladderBuildingId = state.buildingId ?? (buildings.length === 1 ? buildings[0]!.buildingId : null);
  const ladderLevels = ladderBuildingId === null ? [] : model.levelsByBuilding.get(ladderBuildingId) ?? [];
  const building = ladderBuildingId === null ? null : model.buildingsById.get(ladderBuildingId)!;
  const focusLevel = presentation.focusLevelId === null ? null : model.levelsById.get(presentation.focusLevelId)!;
  const scopeLabel = focusLevel ? (!plan ? displayLevelLabel(model, focusLevel.levelId) : null) ?? atlasLevelName(model, focusLevel.levelId, buildings.length > 1)
    : state.buildingId === null && model.scene.buildings.length > 1 ? 'all buildings' : building ? atlasBuildingName(model, building.buildingId) : 'this model';
  const canExplode = !plan && hasExplodableLevels(model, state.buildingId);
  const selectionLevel = selected ? model.occurrencesById.get(selected)!.levelId : null;
  const contextLevels = new Set(context.map(key => model.occurrencesById.get(key)!.levelId));
  // One level out, named for where it leads.
  const buildingName = building ? atlasBuildingName(model, building.buildingId) : null;
  const backTo = state.occurrenceId !== null ? (state.levelId !== null ? (!plan ? displayLevelLabel(model, state.levelId) : null) ?? atlasLevelName(model, state.levelId) : buildingName)
    : state.levelId !== null ? buildingName
    : state.buildingId !== null ? 'All buildings' : null;
  const buildingNav = model.scene.buildings.length > 1 && buildings.length > 0;
  // The Floor Stack already steps out of a floor or building (All floors, All buildings); Back only leaves
  // a room, on a phone: a wide stage's rail already names that floor and the panel clears the room.
  const showBack = compact && backTo !== null && state.occurrenceId !== null;
  // Other planned floors of the property as small plans beside the focus; a
  // phone already steps floors from the stack chip, so it keeps the map whole.
  const tiles = useMemo(() => !plan || compact ? [] : planTileLevels(model, [...(ladderBuildingId === null ? [] : [ladderBuildingId]),
    ...buildings.map(row => row.buildingId).filter(id => id !== ladderBuildingId)]
    .flatMap(id => [...(model.levelsByBuilding.get(id) ?? [])].reverse()), planned), [plan, compact, ladderBuildingId, buildings, model, planned]);
  // Turn and zoom with their names shown, in the phone dock's Camera tray with
  // Spread floors as a switch, and in the menu where the dock has no tray (a
  // short landscape stage) or a narrow wide bar tucks them away.
  const cameraButtons = <>
    {!plan && <>
      <button type="button" className="ua-cam-btn" onClick={() => camera.turn(-45)}><Icon name="rotl" size={18} /><span>Turn left</span></button>
      <button type="button" className="ua-cam-btn" onClick={() => camera.turn(45)}><Icon name="rotr" size={18} /><span>Turn right</span></button>
    </>}
    <button type="button" className="ua-cam-btn" disabled={camera.zoom >= camera.zoomLimits.max} onClick={() => camera.zoomBy(1.3)}><Icon name="plus" size={18} /><span>Zoom in</span></button>
    <button type="button" className="ua-cam-btn" disabled={camera.zoom <= camera.zoomLimits.min} onClick={() => camera.zoomBy(1 / 1.3)}><Icon name="minus" size={18} /><span>Zoom out</span></button>
    {canExplode && compact && <button type="button" className="ua-cam-btn ua-cam-spread" aria-pressed={state.exploded}
      onClick={() => dispatch({ type: 'explode', exploded: !state.exploded })}>
      <Icon name="explode" size={18} /><span>Spread floors</span><span className="ua-switch" aria-hidden="true" /></button>}
  </>;
  const tileBuildings = new Set(tiles.map(level => level.buildingId)).size;
  const hasKeys = active.length > 0 || measuring;
  const keysCount = active.length + (measuring ? 1 : 0);
  // A fold whose content is gone closes, so it never reopens by itself later.
  useEffect(() => {
    if ((drawer === 'floors' && tiles.length === 0) || (drawer === 'layers' && !hasKeys)) setDrawer(null);
  }, [drawer, tiles.length, hasKeys]);
  const fold = (which: 'floors' | 'layers') => setDrawer(value => value === which ? null : which);
  const floorsFold = useRef<HTMLButtonElement>(null), layersFold = useRef<HTMLButtonElement>(null);
  const keysDock = useRef<HTMLDialogElement>(null);
  const foldIds = useId();
  // Choosing another floor hands the stage back to the plan; focus stays on the fold that opened it.
  const chooseTile = (levelId: string) => {
    const narrow = floorsFold.current !== null && floorsFold.current.getClientRects().length > 0;
    setDrawer(null); dispatch({ type: 'level', levelId });
    if (narrow) floorsFold.current?.focus({ preventScroll: true });
  };
  // On a wide stage an open floors strip is the next Escape target anywhere on
  // the stage, after the menu and the graph and before the camera or a step
  // out: it folds back and focus returns to its opener. The compact folds
  // keep their own behaviour.
  const stripEscape = (event: ReactKeyboardEvent<HTMLElement>) => {
    if (event.key !== 'Escape' || event.defaultPrevented || event.nativeEvent.isComposing || drawer === null
      || (event.target as HTMLElement).closest('.ua-layer-dialog[aria-modal="true"]')) return;
    if ((event.target as HTMLElement).closest('input, textarea, select, [contenteditable="true"]')) return;
    // A compact drawer folds before Escape reaches the map, from inside it or
    // from its fold, and focus returns to the fold that opened it.
    if (compact) {
      const fold = drawer === 'layers' ? layersFold.current : floorsFold.current;
      const panel = drawer === 'layers' ? keysDock.current : shell.current?.querySelector('.ua-tiles.is-unfolded');
      const target = event.target as Node;
      if (!panel?.contains(target) && !fold?.contains(target)) return;
      event.preventDefault(); event.stopPropagation();
      setDrawer(null); fold?.focus({ preventScroll: true });
      return;
    }
    if (drawer !== 'floors') return;
    // A strip stepped aside under an open card is not the target.
    const strip = shell.current?.querySelector('.ua-tiles.is-unfolded');
    if (!strip || strip.getClientRects().length === 0 || getComputedStyle(strip).visibility !== 'visible') return;
    event.preventDefault(); event.stopPropagation();
    setDrawer(null); floorsFold.current?.focus({ preventScroll: true });
  };
  // A change of stage mode never leaves focus in a part the new mode hides:
  // keys focused in the dock unfold on a narrow stage, and the layer details
  // fold, hidden on a wide stage, hands focus to the docked keys. Focus the
  // browser already dropped is found where the stage guard kept it.
  useLayerDetailsFocus({ compact, drawer, dock: keysDock, trigger: layersFold, focusOrigin: graphStageFocus, setDrawer });

  // The graph opens from the network key and returns focus there when it closes.
  const graphOpener = useRef<HTMLElement | null>(null), graphReturn = useRef<HTMLElement | null>(null);
  const graphHeading = useRef<HTMLHeadingElement>(null), graphFocus = useRef<HTMLElement | null>(null);
  const graphId = useId();
  const closeGraph = () => { graphReturn.current = graphOpener.current ?? viewport.current; graphOpener.current = null; setGraphOpen(false); };
  const toggleGraph = () => {
    if (showGraph) { closeGraph(); return; }
    graphOpener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setGraphOpen(true);
  };
  // After the commit, so the controls under a covering graph are no longer inert.
  useLayoutEffect(() => {
    if (showGraph) { graphHeading.current?.focus({ preventScroll: true }); return; }
    const back = graphReturn.current; graphReturn.current = null;
    const removedFocus = graphFocus.current; graphFocus.current = null;
    const lostFocus = document.activeElement === document.body && removedFocus !== null && !removedFocus.isConnected;
    if (back || lostFocus) {
      const available = (target: HTMLElement | null): target is HTMLElement => target !== null && target.isConnected
        && target.getClientRects().length > 0 && !target.closest('[inert], [hidden], [aria-hidden="true"]')
        && !target.matches(':disabled') && getComputedStyle(target).visibility === 'visible';
      const target = back ?? graphOpener.current;
      (available(target) ? target : viewport.current)?.focus({ preventScroll: true });
    }
    graphOpener.current = null;
  }, [showGraph]);
  // With no network source the graph stays closed until asked again.
  useEffect(() => { if (!networkOn || graphs.length === 0) setGraphOpen(false); }, [networkOn, graphs.length]);
  const graphKeys = (event: ReactKeyboardEvent<HTMLElement>) => {
    if (event.key !== 'Escape' || event.defaultPrevented) return;
    event.preventDefault(); closeGraph();
  };
  // Over a narrow stage the graph is the whole view: what lies under it leaves the tab order.
  const underGraph = showGraph && graphCovers;
  // The stage's controls leave the tab order under a covering graph and while
  // the stage is the host's inset.
  const stageInert = underGraph || readingInset;
  // A card's Show in graph opens the graph on that device or link.
  const showInGraph = (graphKey: string, choice: { readonly kind: 'device' | 'link'; readonly id: string }) => {
    setGraphStart(value => ({ graphKey, choice, serial: (value?.serial ?? 0) + 1 }));
    if (!showGraph) { graphOpener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null; setGraphOpen(true); }
    else graphHeading.current?.focus({ preventScroll: true });
    if (compact) setSheetOpen(false);
  };
  const networkCard = netFocus && networkOn ? networkCardContent({ focus: netFocus, connections: networkConnections, graphs, choose: setNetFocus, showInGraph, collector,
    roomName: id => ({ room: atlasOccurrenceName(model, id), floor: atlasScopedLevelName(model, model.occurrencesById.get(id)!.levelId, state.buildingId) }) }) : null;
  // Unplaced devices for the Network key, by why they have no room.
  const unplacedDevices = useMemo(() => networkConnections.nodes.filter(node => node.device && node.anchors.length === 0)
    .map(node => ({ key: node.key, label: node.label, kind: node.device!.kind, reason: networkUnplacedReason(node.device!) })), [networkConnections]);
  // Escape in the Atlas's part of the lens belongs to the lens, never the camera.
  const lensKeys = (event: ReactKeyboardEvent<HTMLElement>) => {
    if (event.key !== 'Escape' || event.defaultPrevented || event.nativeEvent.isComposing || !hostLens || !lens) return;
    if ((event.target as HTMLElement).closest('input, textarea, select, [contenteditable="true"]')) return;
    event.preventDefault(); event.stopPropagation();
    hostLens.set(lens.reading ? { ...lens, reading: false } : null);
  };
  const graphCoveredBefore = useRef(false);
  useLayoutEffect(() => {
    const entering = underGraph && !graphCoveredBefore.current;
    graphCoveredBefore.current = underGraph;
    if (!entering) return;
    const active = document.activeElement, origin = graphStageFocus.current;
    graphStageFocus.current = null;
    const inCoveredStage = (target: HTMLElement | null) => target !== null && target.isConnected
      && shell.current?.contains(target) && target.closest('[inert]') !== null;
    // Inert may either leave focus on its former control or evict it to body.
    // Deliberate focus outside the stage, or already in the graph, stays put.
    const removedStageControl = origin !== null && !origin.isConnected;
    if ((active instanceof HTMLElement && inCoveredStage(active))
      || ((active === null || active === document.body) && (inCoveredStage(origin) || removedStageControl)))
      graphHeading.current?.focus({ preventScroll: true });
  }, [underGraph]);

  // The compact menu, the Floor Stack and the layer tray close on Escape, on a
  // tap elsewhere (a drag of the model included) or when focus leaves them;
  // Escape returns focus to the control that opened them.
  const menuButton = useRef<HTMLButtonElement>(null), stackHead = useRef<HTMLButtonElement>(null), layersButton = useRef<HTMLButtonElement>(null);
  const cameraButton = useRef<HTMLButtonElement>(null);
  const opener = (which: 'view' | 'stack' | 'layers' | 'camera') => which === 'view' ? menuButton : which === 'stack' ? stackHead : which === 'camera' ? cameraButton : layersButton;
  const menuIds = useId();
  // Remember only focus in controls which can disappear across the breakpoint
  // or when the host archive filter is unchecked. Deliberate focus moves and
  // outside taps must not be pulled back into the Atlas.
  const chromeFocus = useRef<HTMLElement | null>(null);
  useEffect(() => {
    const host = shell.current?.closest('.lantern-host');
    if (!host) return;
    const owner = (target: HTMLElement) => target.closest('.archive-filter, .atlas-source-details, .ua-menu, .ua-stack, .ua-tools > .seg, .ua-tools > .ctrl-group, .ua-dock');
    const focused = (event: globalThis.FocusEvent) => {
      const target = event.target;
      chromeFocus.current = target instanceof HTMLElement && host.contains(target) && owner(target) ? target : null;
    };
    const blurred = (event: globalThis.FocusEvent) => {
      const target = chromeFocus.current;
      if (!target || event.target !== target) return;
      if (event.relatedTarget !== null) { chromeFocus.current = null; return; }
      // Chrome can dispatch blur just before removing a focused node. Wait
      // until that commit finishes before distinguishing it from an explicit
      // blur of a surviving control.
      queueMicrotask(() => {
        if (chromeFocus.current === target && target.isConnected && target.getClientRects().length > 0) chromeFocus.current = null;
      });
    };
    const tapped = (event: PointerEvent) => {
      const target = chromeFocus.current;
      if (target && event.target instanceof Node && !owner(target)?.contains(event.target)) chromeFocus.current = null;
      if (event.target instanceof Node && !shell.current?.contains(event.target)) graphStageFocus.current = null;
    };
    document.addEventListener('focusin', focused);
    document.addEventListener('focusout', blurred);
    document.addEventListener('pointerdown', tapped, true);
    return () => {
      document.removeEventListener('focusin', focused);
      document.removeEventListener('focusout', blurred);
      document.removeEventListener('pointerdown', tapped, true);
    };
  }, []);
  useLayoutEffect(() => {
    const origin = chromeFocus.current;
    if (!origin) return;
    const available = (target: HTMLElement | null): target is HTMLElement => target !== null && target.isConnected
      && target.getClientRects().length > 0 && !target.closest('[inert], [hidden], [aria-hidden="true"]')
      && !target.matches(':disabled') && getComputedStyle(target).visibility === 'visible';
    const active = document.activeElement;
    if (active !== origin && active !== document.body) { chromeFocus.current = null; return; }
    if (available(origin)) return;
    chromeFocus.current = null;
    if (underGraph) return; // The graph owns its own heading and return focus.
    const target = compact ? menuButton.current : viewport.current;
    if (available(target)) target.focus({ preventScroll: true });
  });
  useEffect(() => { setMenu(value => underGraph || (!compact && value !== 'stack') ? null : value); }, [compact, underGraph]);
  useEffect(() => {
    if (menu === null) return;
    const away = (event: PointerEvent) => {
      const owner = shell.current?.querySelector(menu === 'view' ? '.ua-menu' : menu === 'stack' ? '.ua-stack' : '.ua-dock');
      if (!(event.target instanceof Node) || !owner?.contains(event.target)) setMenu(null);
    };
    document.addEventListener('pointerdown', away, true);
    return () => document.removeEventListener('pointerdown', away, true);
  }, [menu]);
  // Focus moving to another control closes it; focus lost to nothing (a control
  // that became disabled) leaves it open, and taps elsewhere close it above.
  const menuBlur = (which: 'view' | 'stack' | 'layers' | 'camera') => (event: FocusEvent<HTMLElement>) => {
    if (menu === which && event.relatedTarget instanceof Node && !event.currentTarget.contains(event.relatedTarget)) setMenu(null);
  };
  // Place records, at the end of the Rooms list, opens the host's places lens.
  // On a phone the lens takes the sheet's place; the Rooms sheet returns folded.
  const openPlaces = hostLens ? () => {
    setMenu(null);
    if (compact) setSheetOpen(false);
    hostLens.set({ kind: 'places', reading: false });
  } : undefined;
  const chooseBuilding = (buildingId: string | null) => {
    dispatch({ type: 'building', buildingId });
    if (menu === 'stack' && compact) { setMenu(null); stackHead.current?.focus({ preventScroll: true }); }
  };

  // An open compact menu, then the graph, is the first Escape target across
  // Atlas, including the viewport's camera handler.
  const graphEscape = (event: ReactKeyboardEvent<HTMLElement>) => {
    // Modal key events belong to the reading sheet, before any map/menu Escape.
    if ((event.target as HTMLElement).closest('.ua-layer-dialog[aria-modal="true"]')) return;
    if (event.key !== 'Escape' || event.defaultPrevented || event.nativeEvent.isComposing) return;
    if (menu !== null) {
      event.preventDefault(); event.stopPropagation();
      opener(menu).current?.focus({ preventScroll: true }); setMenu(null);
      return;
    }
    if (!showGraph) return;
    event.preventDefault(); event.stopPropagation(); closeGraph();
  };

  const escape = (event: ReactKeyboardEvent<HTMLElement>) => {
    if (event.key !== 'Escape' || event.defaultPrevented || event.nativeEvent.isComposing
      || (event.target as HTMLElement).closest('.ua-layer-dialog[aria-modal="true"]')) return;
    const target = event.target as HTMLElement;
    if (target.closest('input, textarea, select, [contenteditable="true"]')) return;
    event.preventDefault(); out();
  };

  const layerChips = LAYER_KINDS.map(kind => {
    const on = state.layers[kind], index = kind === 'measurements' ? null : overlays.get(kind)!;
    return <button key={kind} type="button" className="layer-chip" aria-pressed={on}
      style={{ '--layer': LAYER_TONE[kind] } as CSSProperties} onClick={() => dispatch({ type: 'layer', layer: kind, on: !on })}>
      <span className="layer-swatch" aria-hidden="true" />{LAYER_LABEL[kind]}
      {on && kind !== 'measurements' && index!.records === 0 && <span className="ua-chip-note">{!runtimeConfigured || runtime.records?.[kind] === 'available' ? '0' : runtime.reason === 'loading' ? 'loading' : runtime.records?.[kind] === 'partial' ? 'partial' : 'unavailable'}</span>}</button>;
  });

  return <section ref={shell} className={`ua-shell is-stage${plan ? ' is-plan' : ''}${sheetOpen ? ' is-sheet-open' : ''}${showGraph ? ' is-graph-open' : ''}${underGraph ? ' is-graph-covering' : ''}${compact ? ' is-compact' : ''}${lens ? ' has-lens' : ''}${readingInset ? ' is-inset' : ''}`}
    aria-label="Atlas" onKeyDownCapture={graphEscape} onKeyDown={escape}
    onFocusCapture={event => {
      const target = event.target;
      graphStageFocus.current = target instanceof HTMLElement && target.closest('.ua-scope, .ua-tools, .ua-viewport, .ua-bottom') ? target : null;
    }}
    onBlurCapture={event => {
      const origin = graphStageFocus.current;
      if (!origin || event.target !== origin) return;
      if (event.relatedTarget !== null && event.relatedTarget !== document.body) { graphStageFocus.current = null; return; }
      queueMicrotask(() => {
        if (graphStageFocus.current === origin && origin.isConnected && origin.getClientRects().length > 0
          && !origin.closest('[inert], [hidden], [aria-hidden="true"]') && getComputedStyle(origin).visibility === 'visible') graphStageFocus.current = null;
      });
    }}>
    <div className="ua-stage" style={stageStyle} onKeyDownCapture={stripEscape}>
      <div className="ua-scope" inert={stageInert} onBlur={menuBlur('stack')}>
        {port.savedDocumentary && <p className="ua-snapshot-note" role="note">
          <Icon name="history" size={15} />
          <span className="ua-snapshot-kind">Saved <span className="ua-snapshot-wide">documentary </span>snapshot</span>
          <time dateTime={port.savedDocumentary.observedAt} title={port.savedDocumentary.observedAt}>observed {stampTime(port.savedDocumentary.observedAt)}</time>
        </p>}
        {stored && <p className="ua-snapshot-note ua-stored-note" role="status" aria-busy={stored.refresh === 'pending'}>
          <Icon name="history" size={15} />
          <span className="ua-snapshot-kind">Stored copy</span>
          <time dateTime={stored.storedAt} title={stored.storedAt}>{stampTime(stored.storedAt)}</time>
          {stored.refresh === 'pending' ? <span>· updating</span> : stored.refresh === 'held'
            ? retry && <button type="button" className="btn btn-small btn-quiet" onClick={retry}>Check for update</button> : <>
            <span>· not updated</span>
            {retry && <button type="button" className="btn btn-small btn-quiet" onClick={retry}>Try again</button>}
          </>}
        </p>}
        {detailNote && <p className="ua-snapshot-note ua-detail-note" role="status" aria-busy={detailNote === 'loading'}>
          <Icon name="atlas" size={15} />
          <span className="ua-snapshot-kind">{detailNote === 'loading' ? 'Loading full detail' : 'Full detail unavailable'}</span>
          <span>{detailNote === 'loading' ? 'the lighter model is shown meanwhile' : 'showing the lighter model'}</span>
        </p>}
        {radio && <RadioCardSlot feed={radio.feed} now={radio.now} reduced={reduced} placeName={radioPlaceName} />}
        <FloorStack model={model} levels={ladderLevels} buildings={buildings} buildingNav={buildingNav}
          building={building && buildingName ? { buildingId: building.buildingId, label: buildingName } : null}
          state={state} dispatch={dispatch} chooseBuilding={chooseBuilding}
          shownLevel={plan && planDrawn ? presentation.focusLevelId : null} selectionLevel={selectionLevel} contextLevels={contextLevels}
          compact={compact} open={menu === 'stack'} setOpen={open => setMenu(open ? 'stack' : null)}
          head={stackHead} panelId={`${menuIds}-stack`} />
        {/* A phone's Back, under the chip that already names the floor: one level out of a room,
            its full name saying where it leads. */}
        {showBack && <button type="button" className="chip-btn ua-back" onClick={out} aria-label={`Back to ${backTo}`} title={`Back to ${backTo}`}>
          <Icon name="back" size={15} /><span aria-hidden="true">Back</span></button>}
      </div>

      <div className="ua-tools" inert={stageInert}>
        {/* Compact: the view moves to the dock below, by the thumb. */}
        {!compact && <div className="seg" role="group" aria-label="Atlas view">
          <button type="button" aria-pressed={!plan} onClick={() => dispatch({ type: 'view', view: '3d' })}>3D</button>
          <button type="button" aria-pressed={plan} onClick={() => dispatch({ type: 'view', view: 'plan' })}>Plan</button>
        </div>}
        {/* Wide: Spread floors beside the view; compact keeps it in the Camera tray. */}
        {!compact && canExplode && <div className="seg">
          <button type="button" className="ua-spread" aria-pressed={state.exploded} aria-label="Spread floors" title="Spread floors"
            onClick={() => dispatch({ type: 'explode', exploded: !state.exploded })}><Icon name="explode" size={16} /><span aria-hidden="true">Spread floors</span></button>
        </div>}
        <div className="ctrl-group" role="group" aria-label="Camera">
          {!plan && <>
            <button type="button" className="ctrl-btn ua-turn" aria-label="Turn left" onClick={() => camera.turn(-45)}><Icon name="rotl" size={17} /></button>
            <button type="button" className="ctrl-btn ua-turn" aria-label="Turn right" onClick={() => camera.turn(45)}><Icon name="rotr" size={17} /></button>
          </>}
          <button type="button" className="ctrl-btn ua-zoom" aria-label="Zoom in" disabled={camera.zoom >= camera.zoomLimits.max} onClick={() => camera.zoomBy(1.3)}><Icon name="plus" size={17} /></button>
          <button type="button" className="ctrl-btn ua-zoom" aria-label="Zoom out" disabled={camera.zoom <= camera.zoomLimits.min} onClick={() => camera.zoomBy(1 / 1.3)}><Icon name="minus" size={17} /></button>
          <button type="button" className="ctrl-btn ua-fit" aria-label="Fit view" title="Fit view" onClick={camera.fit}><Icon name="fit" size={17} /><span aria-hidden="true">Fit</span></button>
        </div>
        {/* Compact: the snapshot stamp takes the free width. One menu holds the lighting
            time, the archive filter and the other sources. */}
        {compact && port.savedDocumentary && <p className="ua-stamp" role="note">
          <span className="ua-stamp-kind">Saved snapshot</span>
          <time dateTime={port.savedDocumentary.observedAt} title={port.savedDocumentary.observedAt}>
            <span className="sr-only">observed </span>{stampTime(port.savedDocumentary.observedAt)}</time>
        </p>}
        {(compact || !plan || archive || otherSources.length > 0) && <div className="ua-menu" onBlur={menuBlur('view')}>
          <button ref={menuButton} type="button" className="ctrl-btn ua-menu-btn" aria-label="View and sources" title="View and sources"
            aria-expanded={menu === 'view'} aria-controls={`${menuIds}-view`} onClick={() => setMenu(value => value === 'view' ? null : 'view')}>
            {/* Named for what it holds: the lighting time and archive filter (the view), and the other sources. */}
            <Icon name="sliders" size={17} className="ua-menu-glyph" /><span aria-hidden="true">View &amp; sources</span>
          </button>
          <div id={`${menuIds}-view`} className="ua-menu-panel" hidden={menu !== 'view'}>
            {/* Shown only on a short landscape stage, whose dock has no Camera tray,
                and on a wide stage too narrow for its bar's turn and zoom buttons. */}
            <div className="ua-menu-camera" role="group" aria-label="Camera">
              <p className="ua-menu-label" aria-hidden="true">Camera</p>
              {cameraButtons}
            </div>
            {!plan && <div className="ua-menu-time">
              <p className="ua-menu-label" aria-hidden="true">Lighting time</p>
              <DaylightControl at={lightingTime.at} live={lightingTime.live} night={daylight.night} place={sunPlace} onChange={lightingTime.set} />
            </div>}
            {archive && <label className="ua-menu-check"><input type="checkbox" checked={archive.included}
              onChange={event => archive.setIncluded(event.currentTarget.checked)} /><span>Include archived HomeBox records</span></label>}
            {otherSources.length > 0 && <nav className="ua-menu-sources" aria-labelledby={`${menuIds}-sources`}>
              <p id={`${menuIds}-sources`} className="ua-menu-label">Other sources</p>
              {otherSources.map(row => <button key={row.id} type="button" className="ua-menu-row" onClick={() => { setMenu(null); row.open(); }}>
                <span>{row.label}</span><Icon name="chevron" size={15} /></button>)}
            </nav>}
          </div>
        </div>}
      </div>

      <div ref={viewport} className={`cifc-viewport ua-viewport${camera.dragging ? ' is-dragging' : ''}`} tabIndex={0} role="group"
        aria-label={`${plan ? 'Plan' : '3D'} of ${scopeLabel}. Arrow keys ${plan ? 'pan' : 'turn'}, plus and minus zoom, Escape goes back one level.`}
        {...camera.bind} onFocus={focusIn} onBlur={focusOut} inert={stageInert}>
        {/* The birch board: its edge a little below the lowest floor, its top lit
            across, and the metric grid once a metre is wide enough to read. In
            Plan it recedes to a faint plate under the drafting sheet, so the
            rooms and walls lead. */}
        <svg className="cifc-svg ua-ground-svg" width={size.width} height={size.height} viewBox={`0 0 ${size.width} ${size.height}`} aria-hidden="true"
          style={planBlend > 0 ? { opacity: 1 - .82 * planBlend } : undefined}>
          <defs>
            <pattern id={gridId} width={1} height={1} patternUnits="userSpaceOnUse"><path d="M1 0H0V1" className="ua-grid-line" /></pattern>
            <linearGradient id={`${gridId}-board`} x1="0" y1="0" x2="1" y2="1">
              <stop offset="0" className="ua-board-lit" /><stop offset="1" className="ua-board-shade" />
            </linearGradient>
            {whole && <clipPath id={`${gridId}-whole`}><rect x={whole.x} y={whole.z} width={whole.w} height={whole.h} rx={whole.r} /></clipPath>}
          </defs>
          <g transform={`${projection.planMatrix(ground.y - BOARD_DEPTH)} translate(${origin[0] - projection.center[0]} ${origin[2] - projection.center[2]})`}>
            <rect className="ua-ground-edge" x={ground.x} y={ground.z} width={ground.w} height={ground.h} rx={.6} clipPath={boardClip} />
          </g>
          <g transform={`${projection.planMatrix(ground.y)} translate(${origin[0] - projection.center[0]} ${origin[2] - projection.center[2]})`}>
            <rect className="ua-ground" x={ground.x} y={ground.z} width={ground.w} height={ground.h} rx={.6} clipPath={boardClip}
              fill={`url(#${gridId}-board)`} vectorEffect="non-scaling-stroke" />
            {projection.k >= 10 && planBlend < .5 && <rect className="ua-ground-grid" x={ground.x} y={ground.z} width={ground.w} height={ground.h} clipPath={boardClip} fill={`url(#${gridId})`} />}
            {/* One group opacity, so overlapping rooms and walls shade the board once. */}
            {planBlend < 1 && footprints.length > 0 && daylight.direct > 0 && <g className="ua-ground-shadow" style={{ opacity: .2 * (1 - planBlend) * daylight.direct }}
              transform={`translate(${shadowOffset[0]} ${shadowOffset[1]})`}>
              {footprints.map(row => <path key={row.key} d={row.path} fillRule="evenodd" />)}
            </g>}
          </g>
        </svg>
        <div className="cifc-canvas-wrap" style={{ opacity: 1 - planBlend }}>
          <MeshLayer meshes={target.meshes} onShown={onShown} projection={projection} interacting={camera.dragging} rules={RULES} currentFloorId={presentation.focusLevelId}
            selectedOccurrenceId={selected} contextOccurrenceIds={context} tints={tints} hidden={!showCanvas}
            hiddenKeys={shown.hidden} lifts={lifts} clips={drawnClips} dims={shown.dims} ghosts={shown.ghosts} sourceColors sourceMaterials sourceDim={ATLAS_SOURCE_DIM} palette={ATLAS_MESH_PALETTE} ambient={ATLAS_AMBIENT} twoSided shade={ATLAS_SHADE} light={light} pitch={ATLAS_PITCH}
            pitchKeys={roofKeys} site={site} ghostAlpha={ATLAS_GHOST_ALPHA} daylight={daylight} shelterKeys={shelterKeys} roomKeys={roomKeys}
            glazingKeys={glazingKeys} emitterKeys={emitterKeys} surroundings={surroundings}
            uploadBytes={target !== lighter || model !== lighter ? RENDER_LIMITS.detailUploadBytes : RENDER_LIMITS.uploadBytes}
            onUnavailable={message => { if (target !== lighter && keepLight) keepLight(); else setFailure(message); }} />
        </div>
        <svg className="cifc-svg" width={size.width} height={size.height} viewBox={`0 0 ${size.width} ${size.height}`} aria-hidden="true">
          {planes.map(row => <polygon key={row.key} className="ua-section" points={row.points} style={{ opacity: row.opacity }} />)}
          {selectedOutline && planBlend < 1 && presentation.visibleLevels.has(selectedOutline.levelId) && <path className="ua-selected-outline" d={selectedOutline.path}
            transform={planAt(occurrenceFloorHeight(model, presentation, selectedOutline.occurrenceId, t) + ROOM_PLATE)} fillRule="evenodd" vectorEffect="non-scaling-stroke" style={{ opacity: 1 - planBlend }} />}
          {/* Keyed by floor: a new floor's plan fades in over the eased camera. */}
          {planShown && planGroups.map(group => <g key={group.levelId} className="ua-plan" style={{ opacity: planBlend }} transform={planTransform(group.levelId)}>
            {group.features.map(({ feature, path }) => feature.role === 'room'
              ? <PlanRoom key={feature.featureId} feature={feature} path={path} pickable={feature.spaceOccurrenceId !== null && presentation.pickable.has(feature.spaceOccurrenceId)}
                selected={selected} context={context} tints={tints} />
              : <path key={feature.featureId} d={path} fillRule="evenodd" vectorEffect="non-scaling-stroke" className={`ua-plan-${feature.role}`} />)}
          </g>)}
          {siteNames.length > 0 && <g className="ua-site-names" style={{ opacity: planBlend }}>
            {siteNames.map(row => <text key={row.key} x={row.x} y={row.y} textAnchor="middle">{row.text}</text>)}
          </g>}
          {/* Reported links between device glyphs; a plan keeps its own floors' links and stubs toward the others. */}
          {networkOn && <NetworkStageConnections connections={networkConnections} selected={netFocus?.kind === 'room' ? netFocus.occurrenceId : selected}
            focusNode={focusNode} focusLink={focusLink} trace={stageTrace} shown={planBlend < .5 ? undefined : onStage} stubs={planBlend >= .5 ? networkStubLength(coarse) : 0}
            spread={state.exploded && planBlend < .5} floorOf={id => model.occurrencesById.get(id)?.levelId} hitWidth={coarse ? 24 : 12} />}
          {positions.length > 0 && <g className="ua-positions">
            {positions.map(row => <rect key={row.key} className={row.context ? 'is-context' : undefined} style={{ '--layer': TONE_COLOR[row.kind] } as CSSProperties}
              x={row.x - 4} y={row.y - 4} width={8} height={8} transform={`rotate(45 ${row.x} ${row.y})`} />)}
          </g>}
          {radio && <RadioRingsSlot feed={radio.feed} now={radio.now} reduced={reduced} place={radioRingPlace} />}
          {measuring && <g className="ua-measure">
            {measures.spans.map(row => <g key={row.key} className={row.measured ? 'is-measured' : undefined}>
              <line x1={row.line[0]} y1={row.line[1]} x2={row.line[2]} y2={row.line[3]} />
              <text className="ua-measure-halo" x={row.x} y={row.y} textAnchor="middle" dy="0.35em">{row.text}</text>
              <text x={row.x} y={row.y} textAnchor="middle" dy="0.35em">{row.text}</text>
            </g>)}
            {measures.areas.map(row => <g key={row.key} className={`ua-measure-area${row.measured ? ' is-measured' : ''}`}>
              <text className="ua-measure-halo" x={row.x} y={row.y} textAnchor="middle" dy="0.35em">{row.text}</text>
              <text x={row.x} y={row.y} textAnchor="middle" dy="0.35em">{row.text}</text>
            </g>)}
          </g>}
          <g className="cifc-labels">
            {drawnLabels.map(label => label.plan ? <g key={label.id} className={`cifc-label is-${label.tier}${label.plan.mode === 'rotated' || label.plan.mode === 'callout' ? ' ua-plan-label-new' : ''}`}>
              {label.tier === 'selected' && <circle className="ua-ripple" cx={label.anchorX} cy={label.anchorY} r={18} />}
              {label.plan.mode === 'callout' && label.plan.leader && <g className="ua-plan-label-leader">
                <polyline className="ua-plan-label-leader-halo" points={label.plan.leader.points.map(point => point.join(',')).join(' ')} />
                <polyline points={label.plan.leader.points.map(point => point.join(',')).join(' ')} />
                {label.plan.leader.dot && <circle cx={label.anchorX} cy={label.anchorY} r={2.5} />}
              </g>}
              {label.tier === 'selected' && label.plan.leader && <>
                <line x1={label.plan.leader.points[0]![0]} y1={label.plan.leader.points[0]![1]}
                  x2={label.plan.leader.points[1]![0]} y2={label.plan.leader.points[1]![1]} />
                {label.plan.leader.dot && <circle cx={label.anchorX} cy={label.anchorY} r={3.5} />}
              </>}
              <g transform={`translate(${label.plan.x} ${label.plan.y}) rotate(${label.plan.angle})`}>
                {(label.tier === 'selected' && nameTag(label.id, 'selected', label.plan.textAnchor, label.plan.textX))
                  || <text className="cifc-label-halo" textAnchor={label.plan.textAnchor} x={label.plan.textX} dy="0.35em">{label.text}</text>}
                <text textAnchor={label.plan.textAnchor} x={label.plan.textX} dy="0.35em">{nameText(label)}</text>
              </g>
            </g> : <g key={label.id} className={`cifc-label is-${label.tier}${quietLabel(label) ? ' is-quiet' : ''}`} transform={`translate(${label.x.toFixed(1)} ${label.y.toFixed(1)})`}>
              {/* Mounted once per selection: one ring answers the choice. */}
              {label.tier === 'selected' && <circle className="ua-ripple" r={18} />}
              {label.rise > .02 && <><line x1={0} y1={0} x2={0} y2={(-LEADER * label.rise).toFixed(1)} /><circle r={3.5} /></>}
              <g transform={label.rise > 0 ? `translate(0 ${(-TAG_RISE * label.rise).toFixed(1)})` : undefined}>
                {/* Each name is one measured pill: the selected tag, or a quiet chip; a stroked halo only without a measurement. */}
                {nameTag(label.id, label.tier) || <text className="cifc-label-halo" textAnchor="middle" dy="0.35em">{label.text}</text>}
                <text textAnchor="middle" dy="0.35em">{nameText(label)}</text>
              </g>
            </g>)}
          </g>
        </svg>
        {hits.map(label => <button key={label.id} type="button" className={`ua-label-hit${label.plan?.mode === 'rotated' || label.plan?.mode === 'callout' ? ' ua-plan-label-new' : ''}`}
          data-atlas-occurrence={label.id} data-stage-key={`label:${label.id}`}
          style={label.plan ? { left: label.plan.x, top: label.plan.y, width: label.plan.width, height: label.plan.height, minWidth: 0, minHeight: 0,
            transform: `translate(-50%, -50%) rotate(${label.plan.angle}deg)` } : stageHitStyle(hitBoxes.get(label)!)}
          aria-label={`Select room: ${atlasOccurrenceName(model, label.id)}${labelFloors.get(label.id) ? ` · ${labelFloors.get(label.id)}` : ''}${isPreliminary(model, label.id) ? ', preliminary' : ''}`} onPointerDown={label.plan?.mode === 'callout' ? stop : undefined}
          onPointerUp={label.plan?.mode === 'callout' ? stop : undefined}
          onClick={event => { if (label.plan?.mode === 'callout' || event.detail === 0) select(label.id); }} />)}
        {counts.map(row => row.devices && !row.folded ? <NetworkGlyphs key={row.key} row={row as StageMarker & { devices: readonly PlacedDevice[] }} coarse={coarse}
          chosen={chosenDevices} room={netFocus?.kind === 'room' ? netFocus.occurrenceId : null} choose={setNetFocus}
          floor={atlasScopedLevelName(model, model.occurrencesById.get(row.occurrenceId)!.levelId, state.buildingId)} />
        : row.devices ? <button key={row.key} type="button" className={`ua-marker ua-net-folded${row.context ? ' is-context' : ''}${netFocus?.kind === 'room' && netFocus.occurrenceId === row.occurrenceId ? ' is-chosen' : ''}`}
          data-stage-key={`marker:${row.key}`} style={{ left: row.x, top: row.y, width: row.width, '--layer': badgeFill('network') } as CSSProperties}
          aria-label={`${row.roomLabel}, ${atlasScopedLevelName(model, model.occurrencesById.get(row.occurrenceId)!.levelId, state.buildingId)}: ${plural(row.count, 'network device')}`}
          onPointerDown={stop} onPointerUp={stop} onClick={() => setNetFocus({ kind: 'room', occurrenceId: row.occurrenceId })}><Icon name="network" size={12} /><span>{row.count}</span></button>
        : <button key={row.key} type="button" className={`ua-marker${row.context ? ' is-context' : ''}${row.kind === 'electrical' && groupRooms.has(model.occurrencesById.get(row.occurrenceId)!.roomId) ? ' is-electrical-group' : ''}`} data-stage-key={`marker:${row.key}`}
          style={{ left: row.x, top: row.y, width: countMarkerWidth(row.count), '--layer': badgeFill(row.kind) } as CSSProperties}
          aria-label={`${row.roomLabel}: ${plural(row.count, `${OVERLAY_LABEL[row.kind].toLowerCase()} record`)}${row.context || sharedNames.has(`${row.kind}\n${row.roomLabel}`) ? `, ${atlasLevelName(model, model.occurrencesById.get(row.occurrenceId)!.levelId, buildings.length > 1)}` : ''}`}
          onPointerDown={stop} onPointerUp={stop} onClick={() => select(row.occurrenceId)}><Icon name={OVERLAY_ICON[row.kind]} size={12} /><span>{row.count}</span></button>)}
        {floorBadges.map(row => <button key={row.key} type="button" className="ua-net-floor" data-stage-key={`floor:${row.key}`}
          style={{ left: row.x, top: row.y }} aria-label={`Show ${row.name}: linked to ${row.names.join(', ')}`}
          onPointerDown={stop} onPointerUp={stop} onClick={() => dispatch({ type: 'level', levelId: row.levelId })}>
          {row.name}</button>)}
        {failure && !plan && <p className="cifc-stage-note" role="status">3D view is unavailable. Use Plan or check Source details.</p>}
        {plan && planBlend >= 1 && !planDrawn && <p className="cifc-stage-note" role="status">
          {focusLevel ? `No plan for ${atlasLevelName(model, focusLevel.levelId)} in this model.` : 'This model has no floors to show as a plan.'}</p>}
      </div>

      <div className="ua-bottom" inert={stageInert}>
        {/* The keys come first: on a wide stage they are the dock, and the
            floors strip sits just before the fold that opens it. */}
        {hasKeys && <LayerDetailsDock dock={keysDock} trigger={layersFold} id={`${foldIds}-layers`}
          short={shortLayerDetails} expanded={drawer === 'layers'} close={() => setDrawer(null)}>
          {active.map(layer => <OverlayKey key={layer.kind} layer={layer} records={runtime.records} stored={runtime.stored}
            buildings={runtime.buildings}
            publishedOnly={!runtimeConfigured} openDocuments={environment.openDocuments && (() => {
              if (shortLayerDetails) setDrawer(null); environment.openDocuments?.();
            })}
            availability={runtime.records?.[layer.kind] ?? (!runtimeConfigured ? 'available' : runtime.reason === 'loading' ? 'loading' : 'unavailable')}
            network={layer.kind === 'network' && graphs.length > 0 ? { devices: networkConnections.coverage.devices.total, unplaced: unplacedDevices,
              open: key => { if (shortLayerDetails) setDrawer(null); setNetFocus({ kind: 'device', key }); },
              graph: { id: graphId, open: showGraph, toggle: () => { if (shortLayerDetails) setDrawer(null); toggleGraph(); } },
              speed: collector && collectorScopes.length > 0 && <InternetSpeeds collector={collector} rows={collectorScopes} /> } : null} />)}
          {measuring && <MeasurementKey estimated={estimated} shown={measured.length} exact={measured.filter(key => carriesMeasurements(model, key)).length} />}
        </LayerDetailsDock>}
        {tiles.length > 0 && <nav id={`${foldIds}-floors`} className={`ua-tiles${drawer === 'floors' ? ' is-unfolded' : ''}`} aria-label="Other floor plans">
          {tiles.map(level => <PlanTile key={level.levelId} model={model} level={level} layers={active} tints={tints} selected={selected}
            name={atlasLevelName(model, level.levelId, buildings.length > 1)} choose={() => chooseTile(level.levelId)} />)}
        </nav>}
        {/* Each fold opens its content just above it. Wide stages keep only
            the floors fold, beside the layer bar; the keys stay docked. */}
        {(tiles.length > 0 || hasKeys) && <div className="ua-folds">
          {tiles.length > 0 && <button ref={floorsFold} type="button" className="ua-fold ua-fold-floors" aria-expanded={drawer === 'floors'} aria-controls={`${foldIds}-floors`}
            onClick={() => fold('floors')}>
            {/* Counted across every building shown in the rail, said so when that is more than one. */}
            <Icon name="layers" size={16} /><span className="ua-fold-name">Other floor plans{tileBuildings > 1
              && <small className="ua-fold-scope"> in {tileBuildings.toLocaleString()} buildings</small>}</span>{' '}<span className="ua-fold-count">{tiles.length.toLocaleString()}</span>
            <Icon name="chevronDown" size={15} /></button>}
          {hasKeys && <button ref={layersFold} type="button" className="ua-fold ua-fold-layers" aria-expanded={drawer === 'layers'} aria-controls={`${foldIds}-layers`}
            aria-haspopup={shortLayerDetails ? 'dialog' : undefined}
            onClick={() => fold('layers')}>
            <Icon name="info" size={16} /><span>Layer details</span>{' '}<span className="ua-fold-count">{keysCount.toLocaleString()}</span>
            <Icon name="chevronDown" size={15} /></button>}
        </div>}
        {/* Compact: one dock holds Fit view by the thumb, the view, 3D or Plan, and the
            layers, as one glyph, their name and how many are on, that open the labelled layer chips above them. */}
        {compact ? <div className="ua-dock" onBlur={menuBlur(menu === 'camera' ? 'camera' : 'layers')}>
          <button type="button" className="ua-dock-btn ua-dock-fit" aria-label="Fit view" title="Fit view" onClick={camera.fit}><Icon name="fit" size={18} /><span aria-hidden="true">Fit</span></button>
          {/* Turn and zoom by the thumb: they open above the dock, as the layers do. */}
          <button ref={cameraButton} type="button" className="ua-dock-btn ua-dock-camera" aria-expanded={menu === 'camera'} aria-controls={`${menuIds}-camera`}
            onClick={() => setMenu(value => value === 'camera' ? null : 'camera')}>
            <span>Camera</span><Icon name="chevronDown" size={14} /></button>
          <div id={`${menuIds}-camera`} className="ua-dock-tray ua-dock-camera-tray" role="group" aria-label="Camera" hidden={menu !== 'camera'}>
            {cameraButtons}
          </div>
          <div className="ua-dock-view" role="group" aria-label="Atlas view">
            <button type="button" className="ua-dock-btn" aria-pressed={!plan} onClick={() => dispatch({ type: 'view', view: '3d' })}>3D</button>
            <button type="button" className="ua-dock-btn" aria-pressed={plan} onClick={() => dispatch({ type: 'view', view: 'plan' })}>Plan</button>
          </div>
          <button ref={layersButton} type="button" className="ua-dock-btn ua-dock-layers" aria-expanded={menu === 'layers'} aria-controls={`${menuIds}-layers`}
            aria-label={`Layers: ${LAYER_KINDS.filter(kind => state.layers[kind]).map(kind => LAYER_LABEL[kind]).join(', ') || 'none shown'}`}
            onClick={() => setMenu(value => value === 'layers' ? null : 'layers')}>
            <Icon name="layers" size={18} /><span>Layers</span>
            {LAYER_KINDS.some(kind => state.layers[kind]) && <span className="ua-dock-count" aria-hidden="true">{LAYER_KINDS.filter(kind => state.layers[kind]).length}</span>}
          </button>
          {/* A short landscape stage shows the chips inline, always open. */}
          <div id={`${menuIds}-layers`} className="layer-bar ua-dock-tray" role="group" aria-label="Layers" hidden={menu !== 'layers' && !shortLayerDetails}>
            {layerChips}
          </div>
        </div> : <div className="layer-bar" role="group" aria-label="Layers">{layerChips}</div>}
      </div>

      {/* The logical network in its own frame: beside the model on wide stages,
          the whole view on narrow ones, with one way back either way. */}
      {showGraph && <section id={graphId} className="ua-graph" aria-labelledby={`${graphId}-title`} onKeyDown={graphKeys}
        onFocusCapture={event => { graphFocus.current = event.target instanceof HTMLElement ? event.target : null; }}
        onBlurCapture={event => {
          // A deliberate move outside the mounted graph is not removal loss.
          if (!event.currentTarget.contains(event.relatedTarget) && graphFocus.current?.isConnected) graphFocus.current = null;
        }}
        style={{ '--layer': TONE_COLOR.network } as CSSProperties}>
        <header className="ua-graph-head">
          <span className="ua-logical-swatch" aria-hidden="true" />
          <h2 id={`${graphId}-title`} ref={graphHeading} tabIndex={-1}>Logical network graph</h2>
          <button type="button" className="chip-btn ua-graph-close" onClick={closeGraph}><Icon name="close" size={15} /><span>Close graph</span></button>
        </header>
        <div className="ua-graph-body">
          {graphs.map(graph => <NetworkGraph key={graphStart?.graphKey === graph.key ? `${graph.key}:${graphStart.serial}` : graph.key} graph={graph} onTrace={onNetworkTrace}
            initial={graphStart?.graphKey === graph.key ? graphStart.choice : null} />)}
        </div>
      </section>}
    </div>

    <Inspector model={model} state={state} dispatch={action => { if (action.type === 'select') leaveNetworkCard.current(); dispatch(action); }} context={context} renderFailure={failure}
      runtime={runtime.records} runtimeReason={runtime.reason} runtimeConfigured={runtimeConfigured}
      electricalGroup={electricalGroup} canElectricalGroup={key => groups.some(group => group.members.some(member => member.record.key === key))} onElectricalGroup={onElectricalGroup} clearElectricalGroup={() => setElectricalGroupSelection(null)}
      electricalData={electricalOn ? environment.electricalData ?? runtime.electricalData.find(source => electricalGroup !== null
        && source.ledger.sceneEvidenceId === electricalGroup.source.sceneEvidenceId
        && source.ledger.sceneOriginalSha256 === electricalGroup.source.sceneOriginalSha256) : undefined}
      openPlaces={openPlaces}
      open={sheetOpen} setOpen={setSheetOpen} unnamed={unnamed} shownLevel={plan && planDrawn && state.levelId === null ? presentation.focusLevelId : null}
      openDocuments={environment.openDocuments} belongings={environment.roomBelongings}
      network={networkCard && { ...networkCard, close: () => setNetFocus(null) }}
      networkDevices={graphs.length > 0 ? { inRoom: roomId => (roomDevices.get(roomId) ?? []).map(row => ({ key: row.key, label: row.device.label, kind: row.device.kind,
        recordKey: graphs.find(graph => graph.key === row.graphKey)?.deviceRecordKeys?.get(row.device.id) ?? null })),
        open: key => setNetFocus({ kind: 'device', key }) } : undefined} />

    {/* This model's own part of the host's places lens: its rooms, chosen as
        on the stage. Rendered into the lens panel; state, reads and selection
        stay with this Atlas. */}
    {hostLens?.target && lens?.kind === 'places' && createPortal(<div className="ua-lens-native" onKeyDown={lensKeys}>
      <section className="ua-lens-section" aria-labelledby={`${graphId}-rooms`}>
        <h3 id={`${graphId}-rooms`}>Model rooms</h3>
        {/* On a phone the lens stands where the room sheet does: choosing
            a room hands the stage and its sheet back. */}
        <RoomList model={model} levels={listedLevels(model, state)} buildingId={state.buildingId} nested
          choose={key => { select(key); if (compact) hostLens.set(null); }} />
      </section>
    </div>, hostLens.target)}
  </section>;
}

const stop = (event: ReactPointerEvent) => event.stopPropagation();
/** Stage keys of a marker's controls: its count, or each drawn glyph and the +n chip. */
const markerKeys = (row: StageMarker) => !row.devices || row.folded ? [`marker:${row.key}`]
  : [...row.devices.slice(0, row.devices.length > NETWORK_GLYPHS ? NETWORK_GLYPHS : undefined).map(device => `marker:${row.key}:${device.key}`),
    ...row.devices.length > NETWORK_GLYPHS ? [`marker:${row.key}:more`] : []];
/** A room's placed devices as glyphs fanned in a row around its anchor: up to
 * three, then a +n chip for that room's device list. Each opens its card. */
function NetworkGlyphs({ row, coarse, chosen, room, choose, floor }: {
  readonly row: StageMarker & { readonly devices: readonly PlacedDevice[] }; readonly coarse: boolean;
  readonly chosen: ReadonlySet<string>; readonly room: string | null; readonly choose: (next: NetworkFocus) => void;
  /** The room's floor, within the chosen building. */
  readonly floor: string;
}) {
  const slots = networkGlyphSlots(row.devices.length), more = row.devices.length - NETWORK_GLYPHS;
  const where = `${row.roomLabel}, ${floor}`;
  return <>
    {row.devices.slice(0, more > 0 ? NETWORK_GLYPHS : undefined).map((item, at) => <button key={item.key} type="button"
      className={`ua-net-device${row.context ? ' is-context' : ''}${item.device.sourceRoot ? ' is-root' : ''}${chosen.has(item.key) ? ' is-chosen' : ''}${item.device.confidence === 'accepted' || item.device.confidence === 'recorded' ? '' : ' is-uncertain'}`}
      data-stage-key={`marker:${row.key}:${item.key}`} style={{ left: row.x + networkGlyphOffset(at, slots, coarse), top: row.y, '--layer': badgeFill('network') } as CSSProperties}
      aria-label={`${item.device.label}${item.device.kind ? `, ${item.device.kind}` : ''}: ${where}`}
      onPointerDown={stop} onPointerUp={stop} onClick={() => choose({ kind: 'device', key: item.key })}><span className="ua-net-dot" /></button>)}
    {more > 0 && <button type="button" className={`ua-net-more${row.context ? ' is-context' : ''}${room === row.occurrenceId ? ' is-chosen' : ''}`}
      data-stage-key={`marker:${row.key}:more`} style={{ left: row.x + networkGlyphOffset(NETWORK_GLYPHS, slots, coarse), top: row.y, '--layer': badgeFill('network') } as CSSProperties}
      aria-label={`+${more} more network devices: ${where}`}
      onPointerDown={stop} onPointerUp={stop} onClick={() => choose({ kind: 'room', occurrenceId: row.occurrenceId })}>+{more}</button>}
  </>;
}
const COARSE = '(pointer: coarse)';
const coarseNow = () => window.matchMedia?.(COARSE).matches === true;
const coarseChanges = (changed: () => void) => {
  const query = window.matchMedia?.(COARSE);
  query?.addEventListener('change', changed);
  return () => query?.removeEventListener('change', changed);
};
