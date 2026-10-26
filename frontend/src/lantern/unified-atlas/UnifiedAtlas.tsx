import {
  useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type CSSProperties, type FocusEvent,
  type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent,
} from 'react';
import { createPortal } from 'react-dom';
import { Icon } from '../components/Icon';
import { useReducedMotion, useStore } from '../state/store';
import { useEased } from '../atlas/useCamera';
import { BIRCH, BIRCH_DARK, CARD, LANTERN } from '../atlas/palette';
import { frameZoomMinimum, makeProjection, relativePath, type DrawRules, type PreparedMesh, type Projection, type Viewport } from '../canonical-ifc/geometry';
import { DETAIL_GLB_LIMITS, GlbFormatError } from '../canonical-ifc/glb-preflight';
import { MeshLayer, RENDER_LIMITS, type MeshPalette } from '../canonical-ifc/MeshLayer';
import { useStageCamera, type StageFraming } from '../canonical-ifc/useStageCamera';
import { TONE_COLOR, badgeFill, toneTint } from '../canonical-ifc/tones';
import { PREPARED_BYTES_PER_TRIANGLE } from '../site-artifacts/site-budget';
import { createLiveAtlasPresentationPort, savedAtlasInitialState } from '../../offline/saved-atlas-presentation';
import type { AtlasPresentationPort, AtlasPresentationSelection } from './types';
import {
  atlasOrigin, atlasReducer, bindAtlasModel, contextOccurrenceIds, easePresentation, frameBox, hasExplodableLevels, initialAtlasState, labelHeight,
  levelLift, occurrenceLiftLevel, partLifts, pickTarget, planFeaturesForLevel, planPickTarget, presentAtlas, sectionCeilings, sectionCuts, sectionGoals, sectionTargets,
  targetAction, unplacedByReason, type AtlasAction, type AtlasLayer, type AtlasModel, type AtlasViewState, type OverlayLayerIndex, type UnplacedReason,
} from './scene';
import { AtlasReadError, type AtlasLevel, type AtlasOccurrence, type AtlasReadFailure, type AtlasRoom, type MeshRole, type OverlayKind, type StoredAtlasRead, type UnifiedAtlasPort,
  type UnifiedAtlasRead } from './types';
import { PublishedOverlayDetails, PublishedUnplacedBinding } from './PublishedOverlayDetails';
import { atlasLevelName, countClearedLabelY, countMarkerTarget, countMarkerWidth, LABEL_TAG_RISE, labelHitWidth, placePlanRoomLabels, planLabelFrame, planLabelObstacles,
  planRoomLabelFits, preparePlanLabelPaper, atlasBuildingName, atlasExclusionText, atlasOccurrenceName, preparePlanLabelShape, visibleCountMarkers, visibleLabelHits, type CountMarker, type PlanLabelInput, type RoomLabel } from './labels';
import { documentaryOverlayIndex, type BuildingCoverage, type DocumentaryRecord, type PropertyRecords, type SourceFact } from './runtime-overlays';
import { edgeSpans, estimatedOccurrences, MEASUREMENT_BASIS, placeLabels, roomArea } from './measurements';
import { useDocumentaryOverlays } from './useDocumentaryOverlays';
import { modelUpdatesAllowed, useModelUpdates } from './model-updates';
import { fullModelWanted, useModelQuality } from './model-quality';
import { daylightAt, stageColors } from './daylight';
import { useSunPlace } from './sun-place';
import { DaylightControl, useLightingTime } from './DaylightControl';
import { shownTier, stageTier } from './model-tier';
import { NetworkGraph } from './NetworkGraph';
import { LayerDetailsDock, useLayerDetailsFocus, useShortLayerDetails } from './LayerDetailsDock';
import { NetworkStageConnections, networkRoomConnections } from './NetworkStageConnections';
import type { NetworkConnections } from './network-connections';
import { AreaValue, PLAN_ORDER, PlanRoom, PlanTile, planTileLevels } from './plan-presentation';
import '../canonical-ifc/canonical-ifc.css';
import './unified-atlas.css';

/** One Atlas for the selected Blender/Bonsai publication: buildings, floors,
 * rooms and the same publication's plans in one renderer, one selection and
 * one camera on one Lantern stage. Every transition re-targets eased values
 * (frame, explosion, each building's section plane, camera), so the latest
 * action always wins; reduced motion snaps. */

/** A stored copy on screen while its fresh read is still running or has failed in transport. */
export interface StoredCopy { readonly storedAt: string; readonly refresh: 'pending' | 'failed' | 'held' }
type Outcome = { readonly status: 'ready'; readonly model: AtlasModel; readonly entryBuildingId: string | null | undefined; readonly stored?: StoredCopy }
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
const MEMORY_ENTRIES = 8;
const overviewOwners = new WeakMap<object, number>();
let nextOverviewOwner = 0;
const memoryKey = (model: AtlasModel, overview: AtlasPresentationSelection) => {
  const identity = overview.kind === 'live' ? overview.overview : overview.owner;
  let owner = overviewOwners.get(identity);
  if (owner === undefined) { owner = ++nextOverviewOwner; overviewOwners.set(identity, owner); }
  const { scope, publication, selection } = model.scene;
  return `${owner}/${overview.kind === 'live' ? overview.overview.manifestSha256 : `${overview.localRevision}/${overview.snapshotId}/${overview.overviewManifestSha256}`}/${scope.workspaceId}/${scope.homeId}/${publication.publicationId}/${publication.semanticsSha256}/${selection.revision}`;
};
function remember(key: string, state: AtlasViewState) {
  memory.delete(key); memory.set(key, state);
  while (memory.size > MEMORY_ENTRIES) memory.delete(memory.keys().next().value!);
}

/** A source the host can open in place of the Atlas; listed in the narrow-stage menu. */
export interface OtherSource { readonly id: string; readonly label: string; readonly open: () => void }

/** A lens over the Atlas, held by the host workspace. */
export interface AtlasLensState { readonly kind: 'places' | 'network'; readonly reading: boolean }
/** The host's lens: its state and setter, the element in the lens panel this
 * Atlas renders its own model rooms or network graph into, and the panel's id.
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
  readonly openNetwork?: () => void;
  readonly openDocuments?: () => void;
  readonly archive?: { readonly included: boolean; readonly setIncluded: (included: boolean) => void };
  /** Absent in the saved viewer, which keeps its own graph panel. */
  readonly lens?: AtlasLensHost;
}
interface AtlasProps {
  readonly port: UnifiedAtlasPort | AtlasPresentationPort;
  readonly onOpenModel?: () => void;
  readonly otherSources?: readonly OtherSource[];
  readonly environment?: AtlasPresentationEnvironment;
  /** The live host's lens; an explicit environment supplies its own. */
  readonly lens?: AtlasLensHost;
}
export default function UnifiedAtlas(props: AtlasProps) {
  return props.environment ? <AtlasPresentation {...props} environment={props.environment} /> : <LiveAtlasPresentation {...props} />;
}
function LiveAtlasPresentation(props: AtlasProps) {
  const { dispatch, actions } = useStore(), reducedMotion = useReducedMotion();
  // Open Network routes to the Network lens beside this same Atlas.
  return <AtlasPresentation {...props} environment={{ reducedMotion,
    openNetwork: () => dispatch({ type: 'view', view: 'network' }),
    openDocuments: () => dispatch({ type: 'view', view: 'library' }),
    ...(actions.archiveVisibility ? { archive: actions.archiveVisibility } : {}),
    ...(props.lens ? { lens: props.lens } : {}) }} />;
}

/** While the room map is not open, the lens panel still says why the model's
 * own rooms and network graph are absent. */
function LensStatus({ lens, children }: { readonly lens: AtlasLensHost | undefined; readonly children: string }) {
  return lens?.value && lens.target ? createPortal(<p className="ua-lens-status" role="status">{children}</p>, lens.target) : null;
}
function AtlasPresentation({ port: suppliedPort, onOpenModel, otherSources, environment }: AtlasProps & { readonly environment: AtlasPresentationEnvironment }) {
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
    const controller = new AbortController(), signal = controller.signal;
    const bind = async (read: UnifiedAtlasRead) => {
      const { loadStandardGlb } = await import('../canonical-ifc/standard-glb');
      signal.throwIfAborted();
      // Prepared geometry is reserved from the preflight counts before the loader allocates.
      const glb = await loadStandardGlb(read.model, 'atlas', signal, admission => {
        if ((admission.work.gpuBytes ?? admission.work.triangles * PREPARED_BYTES_PER_TRIANGLE) > RENDER_LIMITS.uploadBytes) throw new AtlasReadError('too-large');
      }, { embeddedPngMaterials: true });
      signal.throwIfAborted();
      return bindAtlasModel(read.scene, glb);
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
        if (!fetchNow) setLoaded({ selection, attempt, outcome: { status: 'ready', model: kept.model, entryBuildingId: kept.read.entryBuildingId,
          stored: { storedAt: kept.read.storedAt, refresh: 'held' } } });
        return kept;
      }
      storedCopy.current = null;
      try {
        const read = await port.stored(selection, signal);
        if (!read || settled) return null;
        const model = await bind(read);
        if (settled || signal.aborted) return null;
        storedCopy.current = { selection, read, model };
        setLoaded({ selection, attempt, outcome: { status: 'ready', model, entryBuildingId: read.entryBuildingId,
          stored: { storedAt: read.storedAt, refresh: fetchNow ? 'pending' : 'held' } } });
        return { read, model };
      } catch { return null; }
    })();
    if (!fetchNow) {
      void stored.then(shown => { if (!shown && !signal.aborted) setLoaded({ selection, attempt, outcome: { status: 'held' } }); });
      return () => controller.abort();
    }
    void (async () => {
      let outcome: Outcome;
      try {
        const read = port.kind === 'saved' && selection.kind === 'saved' ? await port.read(selection, signal)
          : port.kind === 'live' && selection.kind === 'live' ? await port.read(selection, signal) : (() => { throw new AtlasReadError('stale'); })();
        const shown = await stored;
        signal.throwIfAborted();
        // The same scene and model bytes confirm the copy on screen in place.
        const same = shown && read.envelopeSha256 !== undefined && read.envelopeSha256 === shown.read.envelopeSha256
          && read.scene.model.sha256 === shown.read.scene.model.sha256 && read.entryBuildingId === shown.read.entryBuildingId;
        outcome = { status: 'ready', model: same ? shown.model : await bind(read), entryBuildingId: read.entryBuildingId };
        storedCopy.current = null;
        refused.current = null;
      } catch (error) {
        if (signal.aborted) return;
        // A model file the standard loader refuses does not match its room map.
        const reason = error instanceof AtlasReadError ? error.reason : error instanceof GlbFormatError ? 'invalid' : 'unavailable';
        if (reason === 'denied') { refused.current = selection; storedCopy.current = null; }
        // Only a transport failure keeps a verified stored copy on screen, marked as not updated.
        const shown = reason === 'unavailable' ? await stored : null;
        outcome = shown ? { status: 'ready', model: shown.model, entryBuildingId: shown.read.entryBuildingId, stored: { storedAt: shown.read.storedAt, refresh: 'failed' } }
          : { status: 'failed', reason };
      }
      settled = true;
      if (!signal.aborted) setLoaded({ selection, attempt, outcome });
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
        const model = bindAtlasModel(light.scene, glb);
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
    <LensStatus lens={environment.lens}>No model is selected, so no model rooms or network graph are shown.</LensStatus></section>;
  // A retry keeps a stored copy on screen while it runs.
  const outcome = loaded && loaded.selection === selection && (loaded.attempt === attempt
    || loaded.outcome.status === 'ready' && loaded.outcome.stored) ? loaded.outcome : null;
  if (!outcome) return <section className="ua-shell is-loading" aria-label="Atlas" aria-busy="true">
    <div className="ua-state" role="status"><span className="ua-spinner" aria-hidden="true" />Loading the room map…</div>
    <LensStatus lens={environment.lens}>Model rooms and the network graph appear when the room map has loaded.</LensStatus>
  </section>;
  if (outcome.status === 'held') return <section className="ua-shell" aria-label="Atlas">
    <LensStatus lens={environment.lens}>The room map is not on this device yet.</LensStatus>
    <div className="ua-state" role="status">
      <p>The room map is not on this device yet.</p>
      <div className="ua-state-actions"><button type="button" className="btn btn-small" onClick={ask}>Download room map</button></div>
    </div>
  </section>;
  if (outcome.status === 'failed') {
    const failure = FAILURE[outcome.reason];
    return <section className="ua-shell" aria-label="Atlas">
      <LensStatus lens={environment.lens}>The room map is unavailable, so its model rooms and network graph are not shown.</LensStatus>
      <div className="ua-state" role="alert">
        <p>{failure.text}</p>
        <div className="ua-state-actions">
          {failure.retry && <button type="button" className="btn btn-small" onClick={ask}>{failure.retry}</button>}
          {onOpenModel && <button type="button" className="btn btn-small btn-quiet" onClick={onOpenModel}>Open model overview</button>}
        </div>
      </div>
    </section>;
  }
  const stored = outcome.stored && (loaded!.attempt === attempt ? outcome.stored : { ...outcome.stored, refresh: 'pending' as const });
  const stageDetail: StageDetail | null = full?.light === outcome.model ? { model: full.model, failed: full.failed } : null;
  // Same scene, so the same view-state key: the Full model takes over the Light stage in place.
  return <AtlasStage key={memoryKey(outcome.model, selection)} model={outcome.model} port={port} selection={selection} entryBuildingId={outcome.entryBuildingId}
    otherSources={otherSources ?? []} environment={environment} {...(stored ? { stored, retry: ask } : {})}
    {...(stageDetail ? { detail: stageDetail, keepLight } : {})} />;
}

// ---------------------------------------------------------------------------

const RULES: DrawRules = { visibleFloors: 'all', clipY: null };
/** Fallback architecture, when a primitive has no explicit source base colour,
 * as an axonometric drawing in four values on the birch
 * board: white card walls in light, the walls turned away in warm umber, slopes
 * in a darker graphite and cuts in deep poché, with lantern-yellow selection.
 * Out-of-focus floors and neighbours step back toward a grey stone that stays
 * apart from the warm board. Explicit glTF colours take precedence over these
 * presentation tones; selection and overlay highlights remain Lantern tones. */
const ATLAS_MESH_PALETTE: Partial<MeshPalette> = {
  paper: '#BDB8AE', wall: CARD, top: '#ECDDBF', cut: '#54463A', room: '#F3DFC0', selected: LANTERN, context: '#FBEFC8', ghost: '#E2D9C8',
};
const ATLAS_AMBIENT = .62, ATLAS_SHADE = '#4A3F33', ATLAS_PITCH = '#7C736C';
/** Fallback terrain without an explicit source colour reads as part of the board, one flat pale birch tone with no
 * slope shading, so its facets never compete with the buildings; floors cut
 * away above the focus stay a faint outline; their faces add up where they
 * overlap, so each stays light enough that stacked walls never haze the
 * floor below. Presentation only. */
const ATLAS_SITE = '#E0CFA6', ATLAS_GHOST_ALPHA = .05;
/** Authored materials step back at under half the fallback dimming: context
 * grass stays green, the fence and glazing stay dark, and neighbours keep
 * their own colours, while the focused building alone is at full strength. */
const ATLAS_SOURCE_DIM = .45;
/** Meshes that roof the house over: at night a face beneath them is indoors and lamp-lit. */
const SHELTER_ROLES: ReadonlySet<MeshRole> = new Set(['structure', 'roof', 'slab']);
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
const OVERLAY_KINDS: readonly OverlayKind[] = ['electrical', 'network'];
const OVERLAY_LABEL: Record<OverlayKind, string> = { electrical: 'Electrical', network: 'Network' };
const OVERLAY_ICON: Record<OverlayKind, 'plug' | 'wifi'> = { electrical: 'plug', network: 'wifi' };
const LAYER_LABEL: Record<AtlasLayer, string> = { ...OVERLAY_LABEL, measurements: 'Measurements' };
const LAYER_TONE: Record<AtlasLayer, string> = { electrical: TONE_COLOR.electrical, network: TONE_COLOR.network, measurements: BIRCH_DARK };
/** Side by side when both layers count the same room. */
const MARKER_SPREAD = 24;
const UNPLACED_LABEL: Record<UnplacedReason, string> = {
  'not-linked': 'room not linked to a home place',
  'room-absent': 'room not in this model',
  'other-publication': 'from another model version',
  'occurrence-mismatch': 'floor part does not belong to the room',
  'no-placement': 'room has no position in this model',
  'not-selectable': 'no selectable room part',
};
const LINK_LABEL = { reviewed: 'Linked to a home place', historical: 'Linked in an earlier review only', unmapped: 'Not linked to a home place yet' } as const;
const plural = (count: number, one: string, many = `${one}s`) => `${count.toLocaleString()} ${count === 1 ? one : many}`;
const elevation = (value: number) => `${value > 0 ? '+' : value < 0 ? '−' : ''}${Math.abs(value)} m`;
/** A UTC time as written, shortened to the minute for the stage; the exact value stays in Source. */
const stampTime = (value: string) => {
  const match = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]00:?00)$/.exec(value);
  return match ? `${match[1]} ${match[2]} UTC` : value;
};

/** Short rung marks from each floor's own display name: initials, without a
 * trailing "floor". Marks that repeat within a building gain a source-order number. */
function floorMarks(model: AtlasModel, levels: readonly AtlasLevel[]): ReadonlyMap<string, string> {
  const marks = levels.map(level => {
    const words = atlasLevelName(model, level.levelId).split(' · ')[0]!.split(/\s+/).filter(Boolean);
    const kept = words.length > 1 && /^floor$/i.test(words[words.length - 1]!) ? words.slice(0, -1) : words;
    return kept.map(word => /[\p{L}\p{N}]/u.exec(word)?.[0] ?? '').join('').slice(0, 2).toUpperCase() || '·';
  });
  return new Map(levels.map((level, at) => {
    const mark = marks[at]!, same = marks.filter(other => other === mark).length;
    return [level.levelId, same > 1 ? `${mark}${marks.slice(0, at + 1).filter(other => other === mark).length}` : mark];
  }));
}

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

// A top-layer reading sheet never claims space in the map's fitted frame.
const laidOut = (node: Element) => !node.matches(':modal') && getComputedStyle(node).display !== 'none';
const showing = (node: Element) => laidOut(node) && getComputedStyle(node).visibility !== 'hidden';

/** Each panel is cleared by the edge band that costs the frame least: every
 * assignment of panels to bands is scored by the fit it leaves. Ties keep more area. */
function safeInsets(cover: readonly Box[], width: number, height: number, fit: (w: number, h: number) => number): Box {
  let best = NO_INSET, score = -1, area = -1;
  for (let pick = 0; pick < 4 ** cover.length; pick++) {
    let l = 0, t = 0, r = 0, b = 0;
    cover.forEach((o, at) => {
      const band = Math.floor(pick / 4 ** at) % 4;
      if (band === 0) l = Math.max(l, o.r + CLEAR); else if (band === 1) t = Math.max(t, o.b + CLEAR);
      else if (band === 2) r = Math.max(r, width - o.l + CLEAR); else b = Math.max(b, height - o.t + CLEAR);
    });
    const w = width - l - r, h = height - t - b;
    if (w < MIN_FRAME || h < MIN_FRAME) continue;
    const value = fit(w, h);
    if (value > score + 1e-9 || (value > score - 1e-9 && w * h > area)) { best = { l, t, r, b }; score = value; area = w * h; }
  }
  return best;
}

/** The shared camera fitted to an inset region, reported in whole-stage pixels. */
function insetProjection(base: Projection, dx: number, dy: number, viewport: Viewport): Projection {
  return { ...base, ox: base.ox + dx, oy: base.oy + dy, viewport,
    project(x, y, z) { const [px, py, depth] = base.project(x, y, z); return [px + dx, py + dy, depth]; },
    planMatrix: y => `translate(${dx} ${dy}) ${base.planMatrix(y)}` };
}

/** Panels over the stage, in stage pixels: the view tools, the building and
 * floor rail, the overlays, the network graph and the sheet head. Each
 * container is a transparent band, so its visible children are measured
 * within it. An open sheet counts as its head, and the overlays it hides keep
 * their place, so opening it never moves the model while a resize still
 * re-fits it. The graph beside the model claims its own band; over a narrow
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
  const ladder = rail?.querySelector<HTMLElement>(':scope > .ua-ladder') ?? null;
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
  if (scope) root.style.setProperty('--ua-scope-end', `${Math.max(scope.b, tools?.b ?? 0)}px`);
  // The stylesheet decides whether the panel is a sheet; its head keeps one height open or closed.
  const panel = root.querySelector('.ua-inspector'), head = panel?.querySelector('.ua-sheet-head');
  const style = panel ? getComputedStyle(panel) : null;
  const sheet = style?.position === 'absolute';
  let peek: Box | null = null;
  if (panel && head && style && sheet) {
    const rect = panel.getBoundingClientRect();
    const top = rect.bottom - head.getBoundingClientRect().height - parseFloat(style.borderTopWidth) - parseFloat(style.borderBottomWidth);
    peek = clip(new DOMRect(rect.left, top, rect.width, rect.bottom - top), frame);
  }
  const graphPanel = root.querySelector('.ua-graph');
  const graph = graphPanel && showing(graphPanel) ? clip(graphPanel.getBoundingClientRect(), frame) : null;
  const graphCovers = graph !== null && graph.r - graph.l > frame.width * .6;
  return { cover: [tools, join(scope, docked), union('.ua-bottom', laidOut, dock), peek, graphCovers ? null : graph].filter((box): box is Box => box !== null), sheet, graphCovers };
}

interface StageMarker extends CountMarker {
  readonly kind: OverlayKind; readonly roomLabel: string;
  /** Outside the current building or floor: kept visible as property context. */
  readonly context: boolean;
}

function AtlasStage({ model: lighter, port, selection, entryBuildingId, otherSources, environment, stored, retry, detail, keepLight }: { readonly model: AtlasModel; readonly port: AtlasPresentationPort;
  readonly selection: AtlasPresentationSelection; readonly entryBuildingId: string | null | undefined; readonly otherSources: readonly OtherSource[]; readonly environment: AtlasPresentationEnvironment;
  readonly stored?: StoredCopy; readonly retry?: () => void;
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
  const [state, setState] = useState<AtlasViewState>(() => memory.get(key) ?? (port.kind === 'saved' ? savedAtlasInitialState(model) : initialAtlasState(model,
    entryBuildingId === undefined ? port.entryBuildingId?.(model.scene) ?? null : entryBuildingId)));
  const dispatch = useCallback((action: AtlasAction) => setState(value => atlasReducer(model, value, action)), [model]);
  useEffect(() => { remember(key, state); }, [key, state]);
  const [failure, setFailure] = useState<string | null>(null);
  const shell = useRef<HTMLElement>(null);
  const viewport = useRef<HTMLDivElement>(null);
  const plan = state.view === 'plan';
  const outwardFocus = useRef<Element | null>(null);
  const out = useCallback(() => {
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

  // One section plane per building: it sweeps to the focus floor while the
  // floors above fade, and the same eased clips are drawn, picked and labelled.
  // Heights ease relative to the model's own datum, wherever the source frame puts it.
  const ceilings = useMemo(() => sectionCeilings(model), [model]);
  const sectionGoal = useMemo(() => sectionTargets(model, presentation, ceilings), [model, presentation, ceilings]);
  const sectionEased = useEased(sectionGoals(sectionGoal, origin[1]), { reduced, tau: 210 });
  const cuts = useMemo(() => sectionCuts(sectionEased, sectionGoal, origin[1]), [sectionEased, sectionGoal, origin]);
  const shown = useMemo(() => easePresentation(model, presentation, t, cuts, sectionGoal, ceilings), [model, presentation, t, cuts, sectionGoal, ceilings]);

  const [sheetOpen, setSheetOpen] = useState(false);
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
  }, [selected]);

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
  // With a host lens the graph opens in the Network lens beside this stage;
  // without one (the saved viewer) it keeps its own panel.
  const hostLens = environment.lens;
  const lens = hostLens?.value ?? null;
  // Read wide, the stage is the host's inset: drawn and kept current, its
  // controls set aside and the stage out of the tab order.
  const readingInset = lens?.reading === true;
  const [graphOpen, setGraphOpen] = useState(false);
  const showGraph = !hostLens && graphOpen && graphs.length > 0;
  const [graphCovers, setGraphCovers] = useState(false);
  const graphStageFocus = useRef<HTMLElement | null>(null);
  const [cover, setCover] = useState<readonly Box[]>([]);
  // A phone-sized stage keeps two slim rows above the model and one below it:
  // the camera, the archive filter and the other sources fold into one menu,
  // the buildings into one chooser. One of them opens at a time.
  const [compact, setCompact] = useState(false);
  const shortLayerDetails = useShortLayerDetails(compact);
  const [menu, setMenu] = useState<'view' | 'buildings' | null>(null);
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
  const select = (occurrenceId: string | null) => dispatch({ type: 'select', occurrenceId });
  // A tap resolves against what is drawn now, mid-transition included, and the
  // reducer re-targets every eased value; an empty tap moves out one level.
  const minimumZoom = useRef(.6);
  const camera = useStageCamera({ element: viewport, top: plan, reduced, wheel: 'pan', onEscape: out, minimumZoom: () => minimumZoom.current,
    onTap: (px, py, target) => {
      const label = target instanceof Element ? target.closest<HTMLButtonElement>('button[data-atlas-occurrence]') : null;
      if (label?.dataset.atlasOccurrence && model.selectable.has(label.dataset.atlasOccurrence)) {
        select(label.dataset.atlasOccurrence); return;
      }
      if (!projection) return;
      dispatch(targetAction(camera.planBlend >= .5 ? planPickTarget(model, presentation, state, t, projection, px, py)
        : pickTarget(model, shown, state, t, projection, px, py)));
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
  const sunPlace = useSunPlace(), lightingTime = useLightingTime();
  const daylight = useMemo(() => daylightAt(lightingTime.at, sunPlace), [lightingTime.at, sunPlace]);
  const light = daylight.toward, across = Math.max(1e-6, Math.hypot(light[0], light[2]));
  const shadowOffset = [-light[0] / across * SHADOW_LENGTH, -light[2] / across * SHADOW_LENGTH] as const;
  const stageStyle = useMemo(() => stageColors(daylight.dusk) as CSSProperties, [daylight.dusk]);
  const lifts = useMemo(() => partLifts(model, presentation, t), [model, presentation, t]);
  // Roof slopes take the pitch tone; site terrain the flat board tone. By role only, never by name.
  const roofKeys = useMemo(() => new Set(model.parts.filter(part => part.role === 'roof').map(part => part.mesh.meshKey)), [model]);
  const site = useMemo(() => ({ keys: new Set(model.parts.filter(part => part.role === 'context').map(part => part.mesh.meshKey)), tone: ATLAS_SITE }), [model]);
  const shelterKeys = useMemo(() => new Set(model.parts.filter(part => SHELTER_ROLES.has(part.role)).map(part => part.mesh.meshKey)), [model]);
  const showCanvas = planBlend < 1 && failure === null;

  // A new place is framed whole: zoom and pan return, the chosen orbit stays.
  // Within one place, Plan and 3D each keep the user's own zoom and pan, so a
  // look at the other view and back returns to the same framing.
  const place = `${state.buildingId}\n${state.levelId}\n${state.exploded}`;
  const framed = useRef({ place, view: state.view });
  const viewFraming = useRef(new Map<AtlasViewState['view'], StageFraming>());
  useEffect(() => {
    const left = framed.current;
    if (left.place === place && left.view === state.view) return;
    if (left.place === place) viewFraming.current.set(left.view, camera.framing); else viewFraming.current.clear();
    framed.current = { place, view: state.view };
    const saved = viewFraming.current.get(state.view);
    if (saved) camera.restore(saved); else camera.reframe();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [place, state.view]);

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
  const planTransform = (levelId: string) => `${projection.planMatrix(model.floorY.get(levelId)! + levelLift(presentation, levelId, t))} translate(${origin[0] - projection.center[0]} ${origin[2] - projection.center[2]})`;
  const planShown = planBlend > 0 && planGroups.some(group => group.features.length > 0);
  const sitePlan = plan && presentation.focusLevelId === null;

  // The ground the buildings stand on: one plate under every building, in the model frame.
  const ground = useMemo(() => {
    const b = model.scene.buildings, m = 3;
    const minX = Math.min(...b.map(row => row.bounds.min[0])), maxX = Math.max(...b.map(row => row.bounds.max[0]));
    const minZ = Math.min(...b.map(row => row.bounds.min[2])), maxZ = Math.max(...b.map(row => row.bounds.max[2]));
    return { y: Math.min(...b.map(row => row.bounds.min[1])), x: minX - m - origin[0], z: minZ - m - origin[2], w: maxX - minX + 2 * m, h: maxZ - minZ + 2 * m };
  }, [model, origin]);
  // Each building's lowest authored floor plan, as its contact shadow on the board.
  const footprints = useMemo(() => model.floorBuildings.flatMap(row => {
    const lowest = model.levelsByBuilding.get(row.buildingId)?.[0];
    return !lowest ? [] : planFeaturesForLevel(model, lowest.levelId).filter(feature => feature.role === 'room' || feature.role === 'wall')
      .map(feature => ({ key: feature.featureId, path: relativePath(model.featureRings.get(feature.featureId)!, origin) }));
  }), [model, origin]);
  const gridId = `ua-grid-${useId().replace(/[^A-Za-z0-9_-]/g, '')}`;

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
  const markers = useMemo(() => {
    const rows: StageMarker[] = [];
    const spread = active.length > 1;
    for (const layer of active) for (const placement of layer.placed.values()) {
      const occurrenceId = placement.occurrenceId;
      // A binding with no record IDs keeps its tint and provenance but has no count to show.
      if (placement.recordCount === 0 || !onStage(occurrenceId)) continue;
      const at = anchorOf(occurrenceId); if (!at) continue;
      rows.push({ key: `${layer.kind}:${occurrenceId}`, kind: layer.kind, occurrenceId, roomLabel: atlasOccurrenceName(model, occurrenceId),
        count: placement.recordCount, x: at.x + (spread ? (layer.kind === 'electrical' ? -MARKER_SPREAD : MARKER_SPREAD) : 0), y: at.y,
        context: !live.has(occurrenceId) });
    }
    return rows;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, live, presentation, shown, projection, t, planBlend, model, planned]);
  const counts = useMemo(() => visibleCountMarkers(markers, size, cover, selected, context), [markers, size, cover, selected, context]);
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
  const networkConnections = useMemo(() => networkRoomConnections(networkOn ? runtime.records : null,
    networkOn && runtime.records ? [...runtime.records.rooms.keys()].flatMap(roomId =>
      (model.roomsById.get(roomId)?.occurrenceIds ?? []).flatMap(occurrenceId => {
        if (!model.selectable.has(occurrenceId)) return [];
        const at = anchorOf(occurrenceId); if (!at) return [];
        return [{ roomId, occurrenceId, point: [at.x + (active.length > 1 ? MARKER_SPREAD : 0), at.y] as const }];
      })) : []),
  // eslint-disable-next-line react-hooks/exhaustive-deps
  [networkOn, runtime.records, model, projection, presentation, shown, t, planBlend, active.length]);

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
  const planTextMetrics = useMemo(() => {
    const canvas = document.createElement('canvas'), drawing = canvas.getContext('2d');
    const metrics = new Map<string, { width: number; height: number; advance?: number }>();
    for (const occurrenceId of live) {
      const tier = occurrenceId === selected ? 'selected' : context.includes(occurrenceId) ? 'context' : 'plain';
      const text = model.roomsById.get(model.occurrencesById.get(occurrenceId)!.roomId)!.label;
      const fontSize = tier === 'selected' ? 15 : 12.5, halo = tier === 'selected' ? 17 : tier === 'context' ? 13 : 4.5;
      if (!drawing) { metrics.set(occurrenceId, { width: Infinity, height: Infinity }); continue; }
      drawing.font = `${tier === 'selected' ? 750 : tier === 'context' ? 700 : 600} ${fontSize}px ${tier === 'selected' ? labelFonts.display : labelFonts.text}`;
      const bounds = drawing.measureText(text);
      metrics.set(occurrenceId, { advance: bounds.width,
        width: bounds.width + 2 * Math.max(Math.abs(bounds.actualBoundingBoxLeft), Math.abs(bounds.actualBoundingBoxRight - bounds.width)) + halo + 1,
        height: 2 * Math.max(Math.abs(bounds.actualBoundingBoxAscent - fontSize * .35), Math.abs(bounds.actualBoundingBoxDescent + fontSize * .35)) + halo + 1 });
    }
    return metrics;
  }, [live, selected, context, model, labelFonts]);
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
      rise: 0, clearance: anchor.clearance, shape: preparePlanLabelShape(polygons), metrics }, frame, ownCounts);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [plan, selected, presentation, shown, model, planTextMetrics, size, inset, camera.eased, readable.zoom, bounds, markerAt, countGroups, projection, t, planBlend]);
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
  const labels = useMemo(() => {
    const rows: (RoomLabel & { clearance: number; anchorX: number; anchorY: number })[] = [];
    for (const occurrenceId of live) {
      const at = anchorOf(occurrenceId); if (!at) continue;
      const tier = occurrenceId === selected ? 'selected' : context.includes(occurrenceId) ? 'context' : 'plain';
      // Plain labels stay on the floor in focus; lower floors seen through the section stay quiet.
      if (tier === 'plain' && ((!settledPlan && at.clearance * projection.k < 18)
        || (presentation.focusLevelId !== null && model.occurrencesById.get(occurrenceId)!.levelId !== presentation.focusLevelId))) continue;
      const lifted = markerAt.has(occurrenceId) ? 22 : 0;
      const metrics = planTextMetrics.get(occurrenceId), preferredY = at.y - lifted;
      // Ease the extra full-target clearance with Plan, so settlement itself
      // never changes the name's offset from 22 pixels to its resolved height.
      const clearY = metrics ? countClearedLabelY({ id: occurrenceId, x: at.x, y: preferredY, metrics }, countGroups.get(occurrenceId) ?? []) : preferredY;
      rows.push({ id: occurrenceId, text: model.roomsById.get(model.occurrencesById.get(occurrenceId)!.roomId)!.label, x: at.x, y: preferredY + (clearY - preferredY) * settle,
        anchorX: at.x, anchorY: at.y, tier, clearance: at.clearance, rise: tier === 'selected' ? rise : 0 });
    }
    const rank = { selected: 0, context: 1, plain: 2 } as const;
    rows.sort((a, b) => rank[a.tier] - rank[b.tier] || b.clearance - a.clearance);
    if (settledPlan) {
      const frame = planLabelFrame(projection.project, model.floorY.get(presentation.focusLevelId!)! + levelLift(presentation, presentation.focusLevelId!, t));
      const candidates: PlanLabelInput[] = rows.flatMap(row => {
        const polygons = model.roomPolygons.get(row.id), at = anchorOf(row.id), metrics = planTextMetrics.get(row.id);
        return polygons && at && metrics ? [{ ...row, anchorX: at.x, anchorY: at.y, metrics, shape: preparePlanLabelShape(polygons) }] : [];
      });
      return placePlanRoomLabels(candidates, size, cover, counts, frame, labelPaper, calloutDirections.current);
    }
    // Panels count as placed: a room name under one is left to the room list.
    const placed: Box[] = [...cover];
    return rows.filter(row => {
      const w = Math.min(220, row.text.length * 7.2 + (row.tier === 'plain' ? 14 : 26)), h = row.tier === 'plain' ? 22 : 30;
      const middle = row.y - TAG_RISE * row.rise;
      const box = { l: row.x - w / 2, r: row.x + w / 2, t: middle - h / 2, b: middle + h / 2 };
      if (row.tier !== 'selected' && (box.l < 4 || box.r > size.width - 4 || box.t < 4 || box.b > size.height - 4
        || placed.some(o => box.l < o.r && box.r > o.l && box.t < o.b && box.b > o.t))) return false;
      placed.push(box); return true;
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [live, presentation, shown, projection, t, planBlend, selected, context, markerAt, model, size, cover, settledPlan, planTextMetrics, counts, countGroups, labelPaper, rise]);
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
      const w = Math.min(220, row.text.length * 7.2 + 26), middle = row.y - TAG_RISE * row.rise;
      return [{ l: row.x - w / 2, r: row.x + w / 2, t: middle - 15, b: middle + 15 }];
    }), ...counts.map(countMarkerTarget)];
    const areas = placeLabels(measured.flatMap(occurrenceId => {
      const area = roomArea(model, occurrenceId), at = area && anchorOf(occurrenceId);
      if (!area || !at) return [];
      const text = area.partial ? `${area.text}, this part` : area.text;
      return [{ key: occurrenceId, text, x: at.x, y: at.y + 17, w: text.length * 6.6 + 10, h: 16 }];
    }), blocked, size);
    const owners = selected !== null && measured.includes(selected) ? [selected] : measured;
    const spans = owners.flatMap(occurrenceId => {
      const y = model.floorY.get(model.occurrencesById.get(occurrenceId)!.levelId)! + lift(occurrenceId);
      return edgeSpans(model, occurrenceId).flatMap(span => {
        const a = projection.project(span.a[0], y, span.a[1]), b = projection.project(span.b[0], y, span.b[1]);
        const mx = (span.a[0] + span.b[0]) / 2, mz = (span.a[1] + span.b[1]) / 2;
        const m = projection.project(mx, y, mz), n = projection.project(mx + span.inward[0], y, mz + span.inward[1]);
        const nx = n[0] - m[0], ny = n[1] - m[1], nl = Math.hypot(nx, ny), screen = Math.hypot(b[0] - a[0], b[1] - a[1]);
        const w = span.text.length * 6.4 + 8;
        if (nl < 1e-6 || screen < w + 12) return [];
        const ux = nx / nl, uy = ny / nl;
        return [{ key: span.key, text: span.text, length: screen, w, h: 15, x: m[0] + ux * 12, y: m[1] + uy * 12,
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
  const hits = useMemo(() => visibleLabelHits(labels, size, cover, counts), [labels, size, cover, counts]);
  // A focused stage control can leave the stage: its tag rises past an edge,
  // a panel grows over it or its floor is cut away. Focus then returns to the
  // stage itself, without scrolling, instead of falling to the page.
  const stageFocus = useRef<string | null>(null);
  const stageKeys = [...hits.map(label => `label:${label.id}`), ...counts.map(row => `marker:${row.key}`)].join('\n');
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

  // Keep the current choice inside its own row, never scrolling the page.
  // The chooser and host disclosures can change that row's width independently
  // of the viewport, including one commit after a breakpoint transition. On a
  // wide stage a floor list cut short beside the docked keys keeps a floor in
  // view: the focused one, through the scrolling rail too, else the current one.
  useLayoutEffect(() => {
    const rows = [...(shell.current?.querySelectorAll<HTMLElement>('.ua-buildings, .ua-ladder') ?? [])];
    const ladders = compact ? [] : rows.filter(row => row.classList.contains('ua-ladder'));
    const reveal = (frame: HTMLElement, target: HTMLElement) => {
      const box = target.getBoundingClientRect(), edge = frame.getBoundingClientRect();
      if (box.top < edge.top) frame.scrollTop -= edge.top - box.top + 6;
      else if (box.bottom > edge.bottom) frame.scrollTop += box.bottom - edge.bottom + 6;
    };
    const align = () => {
      for (const row of rows) {
        const current = row.querySelector<HTMLElement>('[aria-pressed="true"]');
        if (!current || row.scrollWidth <= row.clientWidth || row.getClientRects().length === 0) continue;
        const box = current.getBoundingClientRect(), edge = row.getBoundingClientRect();
        if (box.left < edge.left) row.scrollLeft -= edge.left - box.left + 12;
        else if (box.right > edge.right) row.scrollLeft += box.right - edge.right + 12;
      }
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
    for (const row of rows) observer.observe(row);
    // The rail can shorten while its floor list keeps its least height.
    for (const row of ladders) { const rail = row.closest('.ua-scope'); if (rail) observer.observe(rail); }
    return () => observer.disconnect();
  }, [state.buildingId, state.levelId, plan, size.width, compact]);

  // Only buildings with floors are navigable; context-only groups stay drawn around them.
  const buildings = model.floorBuildings;
  const ladderBuildingId = state.buildingId ?? (buildings.length === 1 ? buildings[0]!.buildingId : null);
  const ladderLevels = ladderBuildingId === null ? [] : model.levelsByBuilding.get(ladderBuildingId) ?? [];
  const building = ladderBuildingId === null ? null : model.buildingsById.get(ladderBuildingId)!;
  const focusLevel = presentation.focusLevelId === null ? null : model.levelsById.get(presentation.focusLevelId)!;
  const scopeLabel = focusLevel ? atlasLevelName(model, focusLevel.levelId, buildings.length > 1)
    : state.buildingId === null && model.scene.buildings.length > 1 ? 'all buildings' : building ? atlasBuildingName(model, building.buildingId) : 'this model';
  const canExplode = !plan && hasExplodableLevels(model, state.buildingId);
  const selectionLevel = selected ? model.occurrencesById.get(selected)!.levelId : null;
  const contextLevels = new Set(context.map(key => model.occurrencesById.get(key)!.levelId));
  // One level out, named for where it leads.
  const buildingName = building ? atlasBuildingName(model, building.buildingId) : null;
  const backTo = state.occurrenceId !== null ? (state.levelId !== null ? atlasLevelName(model, state.levelId) : buildingName)
    : state.levelId !== null ? buildingName
    : state.buildingId !== null ? 'All buildings' : null;
  const buildingNav = model.scene.buildings.length > 1 && buildings.length > 0;
  // One building chosen: the All buildings choice right below is the same step out, so Back would only repeat it.
  const showBack = backTo !== null && !(buildingNav && state.occurrenceId === null && state.levelId === null);
  // Other planned floors of the property as small plans beside the focus.
  const tiles = useMemo(() => !plan ? [] : planTileLevels(model, [...(ladderBuildingId === null ? [] : [ladderBuildingId]),
    ...buildings.map(row => row.buildingId).filter(id => id !== ladderBuildingId)]
    .flatMap(id => [...(model.levelsByBuilding.get(id) ?? [])].reverse()), planned), [plan, ladderBuildingId, buildings, model, planned]);
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
  // The Network lens toggle, in the network key, where the host has a lens.
  const lensGraph = hostLens ? { id: hostLens.panelId, open: lens?.kind === 'network',
    toggle: () => hostLens.set(lens?.kind === 'network' ? null : { kind: 'network', reading: false }) } : null;
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

  // The compact menu and building chooser close on Escape, on a tap elsewhere
  // or when focus leaves them; Escape returns focus to the control that opened them.
  const menuButton = useRef<HTMLButtonElement>(null), pickButton = useRef<HTMLButtonElement>(null);
  const menuIds = useId();
  // Remember only focus in controls which can disappear across the breakpoint
  // or when the host archive filter is unchecked. Deliberate focus moves and
  // outside taps must not be pulled back into the Atlas.
  const chromeFocus = useRef<HTMLElement | null>(null);
  useEffect(() => {
    const host = shell.current?.closest('.lantern-host');
    if (!host) return;
    const owner = (target: HTMLElement) => target.closest('.archive-filter, .atlas-source-details, .ua-menu, .ua-pick, .ua-buildings, .ua-tools > .ctrl-group');
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
  useEffect(() => { if (!compact || underGraph) setMenu(null); }, [compact, underGraph]);
  useEffect(() => {
    if (menu === null) return;
    const away = (event: PointerEvent) => {
      const owner = shell.current?.querySelector(menu === 'view' ? '.ua-menu' : '.ua-scope');
      if (!(event.target instanceof Node) || !owner?.contains(event.target)) setMenu(null);
    };
    document.addEventListener('pointerdown', away, true);
    return () => document.removeEventListener('pointerdown', away, true);
  }, [menu]);
  // Focus moving to another control closes it; focus lost to nothing (a control
  // that became disabled) leaves it open, and taps elsewhere close it above.
  const menuBlur = (which: 'view' | 'buildings') => (event: FocusEvent<HTMLElement>) => {
    if (menu === which && event.relatedTarget instanceof Node && !event.currentTarget.contains(event.relatedTarget)) setMenu(null);
  };
  const chooseBuilding = (buildingId: string | null) => {
    dispatch({ type: 'building', buildingId });
    if (menu === 'buildings') { setMenu(null); pickButton.current?.focus({ preventScroll: true }); }
  };

  // An open compact menu, then the graph, is the first Escape target across
  // Atlas, including the viewport's camera handler.
  const graphEscape = (event: ReactKeyboardEvent<HTMLElement>) => {
    // Modal key events belong to the reading sheet, before any map/menu Escape.
    if ((event.target as HTMLElement).closest('.ua-layer-dialog[aria-modal="true"]')) return;
    if (event.key !== 'Escape' || event.defaultPrevented || event.nativeEvent.isComposing) return;
    if (menu !== null) {
      event.preventDefault(); event.stopPropagation();
      (menu === 'view' ? menuButton : pickButton).current?.focus({ preventScroll: true }); setMenu(null);
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

  const pickLabel = state.buildingId === null ? 'All buildings' : buildingName ?? 'All buildings';
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
      <div className="ua-scope" inert={stageInert} onBlur={menuBlur('buildings')}>
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
        {showBack && <button type="button" className="chip-btn ua-back" onClick={out} aria-label={`Back to ${backTo}`}>
          <Icon name="back" size={15} /><span>{backTo}</span></button>}
        {/* Compact: one chooser names the current building and opens the list below it. */}
        {buildingNav && compact && <button ref={pickButton} type="button" className="chip-btn ua-pick" aria-expanded={menu === 'buildings'}
          aria-controls={`${menuIds}-buildings`} onClick={() => setMenu(value => value === 'buildings' ? null : 'buildings')}>
          <Icon name={state.buildingId === null ? 'atlas' : 'building'} size={15} />
          <span className="sr-only">Building: </span><span className="ua-pick-name">{pickLabel}</span>
          <Icon name="chevronDown" size={15} /></button>}
        {buildingNav && <nav id={`${menuIds}-buildings`} className={`ua-buildings${menu === 'buildings' ? ' is-open' : ''}`} aria-label="Buildings">
          <button type="button" className="chip-btn" aria-pressed={state.buildingId === null}
            onClick={() => chooseBuilding(null)}><Icon name="atlas" size={15} />All buildings</button>
          {buildings.map(row => <button key={row.buildingId} type="button" className="chip-btn" aria-pressed={state.buildingId === row.buildingId}
            onClick={() => chooseBuilding(row.buildingId)}><Icon name="building" size={15} />{atlasBuildingName(model, row.buildingId)}</button>)}
        </nav>}
        <DatumLadder model={model} levels={ladderLevels} building={buildingName === null ? null : { label: buildingName }} state={state} dispatch={dispatch}
          shownLevel={plan ? presentation.focusLevelId : null} selectionLevel={selectionLevel} contextLevels={contextLevels} />
      </div>

      <div className="ua-tools" inert={stageInert}>
        <div className="seg" role="group" aria-label="Atlas view">
          <button type="button" aria-pressed={!plan} onClick={() => dispatch({ type: 'view', view: '3d' })}>3D</button>
          <button type="button" aria-pressed={plan} onClick={() => dispatch({ type: 'view', view: 'plan' })}>Plan</button>
        </div>
        {canExplode && <button type="button" className="ctrl-btn ctrl-wide" aria-pressed={state.exploded}
          onClick={() => dispatch({ type: 'explode', exploded: !state.exploded })}>
          <Icon name="explode" size={17} /><span>Exploded</span></button>}
        <div className="ctrl-group" role="group" aria-label="Camera">
          {!plan && <>
            <button type="button" className="ctrl-btn ua-turn" aria-label="Turn left" onClick={() => camera.turn(-45)}><Icon name="rotl" size={17} /></button>
            <button type="button" className="ctrl-btn ua-turn" aria-label="Turn right" onClick={() => camera.turn(45)}><Icon name="rotr" size={17} /></button>
          </>}
          <button type="button" className="ctrl-btn" aria-label="Zoom in" disabled={camera.zoom >= camera.zoomLimits.max} onClick={() => camera.zoomBy(1.3)}><Icon name="plus" size={17} /></button>
          <button type="button" className="ctrl-btn" aria-label="Zoom out" disabled={camera.zoom <= camera.zoomLimits.min} onClick={() => camera.zoomBy(1 / 1.3)}><Icon name="minus" size={17} /></button>
          <button type="button" className="ctrl-btn" aria-label="Fit view" title="Fit view" onClick={camera.fit}><Icon name="fit" size={17} /></button>
        </div>
        {!plan && <DaylightControl at={lightingTime.at} live={lightingTime.live} night={daylight.night} place={sunPlace} onChange={lightingTime.set} />}
        {/* Compact: the snapshot stamp takes the free width, and one menu holds
            the camera, the archive filter and the other sources. */}
        {compact && port.savedDocumentary && <p className="ua-stamp" role="note">
          <span className="ua-stamp-kind">Saved snapshot</span>
          <time dateTime={port.savedDocumentary.observedAt} title={port.savedDocumentary.observedAt}>
            <span className="sr-only">observed </span>{stampTime(port.savedDocumentary.observedAt)}</time>
        </p>}
        {compact && <div className="ua-menu" onBlur={menuBlur('view')}>
          <button ref={menuButton} type="button" className="ctrl-btn ua-menu-btn" aria-label="View and sources" title="View and sources"
            aria-expanded={menu === 'view'} aria-controls={`${menuIds}-view`} onClick={() => setMenu(value => value === 'view' ? null : 'view')}>
            <svg width={18} height={18} viewBox="0 0 24 24" aria-hidden="true"><circle cx={5} cy={12} r={1.9} /><circle cx={12} cy={12} r={1.9} /><circle cx={19} cy={12} r={1.9} /></svg>
          </button>
          <div id={`${menuIds}-view`} className="ua-menu-panel" hidden={menu !== 'view'}>
            <div className="ua-menu-camera" role="group" aria-label="Camera">
              {!plan && <>
                <button type="button" className="ctrl-btn" aria-label="Turn left" title="Turn left" onClick={() => camera.turn(-45)}><Icon name="rotl" size={18} /></button>
                <button type="button" className="ctrl-btn" aria-label="Turn right" title="Turn right" onClick={() => camera.turn(45)}><Icon name="rotr" size={18} /></button>
              </>}
              <button type="button" className="ctrl-btn" aria-label="Zoom in" title="Zoom in" disabled={camera.zoom >= camera.zoomLimits.max} onClick={() => camera.zoomBy(1.3)}><Icon name="plus" size={18} /></button>
              <button type="button" className="ctrl-btn" aria-label="Zoom out" title="Zoom out" disabled={camera.zoom <= camera.zoomLimits.min} onClick={() => camera.zoomBy(1 / 1.3)}><Icon name="minus" size={18} /></button>
              <button type="button" className="ctrl-btn ua-menu-fit" onClick={camera.fit}><Icon name="fit" size={18} /><span>Fit view</span></button>
            </div>
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
          </defs>
          <g transform={`${projection.planMatrix(ground.y - BOARD_DEPTH)} translate(${origin[0] - projection.center[0]} ${origin[2] - projection.center[2]})`}>
            <rect className="ua-ground-edge" x={ground.x} y={ground.z} width={ground.w} height={ground.h} rx={.6} />
          </g>
          <g transform={`${projection.planMatrix(ground.y)} translate(${origin[0] - projection.center[0]} ${origin[2] - projection.center[2]})`}>
            <rect className="ua-ground" x={ground.x} y={ground.z} width={ground.w} height={ground.h} rx={.6}
              fill={`url(#${gridId}-board)`} vectorEffect="non-scaling-stroke" />
            {projection.k >= 10 && planBlend < .5 && <rect className="ua-ground-grid" x={ground.x} y={ground.z} width={ground.w} height={ground.h} fill={`url(#${gridId})`} />}
            {/* One group opacity, so overlapping rooms and walls shade the board once. */}
            {planBlend < 1 && footprints.length > 0 && daylight.direct > 0 && <g className="ua-ground-shadow" style={{ opacity: .2 * (1 - planBlend) * daylight.direct }}
              transform={`translate(${shadowOffset[0]} ${shadowOffset[1]})`}>
              {footprints.map(row => <path key={row.key} d={row.path} fillRule="evenodd" />)}
            </g>}
          </g>
        </svg>
        <div className="cifc-canvas-wrap" style={{ opacity: 1 - planBlend }}>
          <MeshLayer meshes={target.meshes} onShown={onShown} projection={projection} rules={RULES} currentFloorId={presentation.focusLevelId}
            selectedOccurrenceId={selected} contextOccurrenceIds={context} tints={tints} hidden={!showCanvas}
            hiddenKeys={shown.hidden} lifts={lifts} clips={shown.clips} dims={shown.dims} ghosts={shown.ghosts} sourceColors sourceMaterials sourceDim={ATLAS_SOURCE_DIM} palette={ATLAS_MESH_PALETTE} ambient={ATLAS_AMBIENT} twoSided shade={ATLAS_SHADE} light={light} pitch={ATLAS_PITCH}
            pitchKeys={roofKeys} site={site} ghostAlpha={ATLAS_GHOST_ALPHA} daylight={daylight} shelterKeys={shelterKeys}
            uploadBytes={target !== lighter || model !== lighter ? RENDER_LIMITS.detailUploadBytes : RENDER_LIMITS.uploadBytes}
            onUnavailable={message => { if (target !== lighter && keepLight) keepLight(); else setFailure(message); }} />
        </div>
        <svg className="cifc-svg" width={size.width} height={size.height} viewBox={`0 0 ${size.width} ${size.height}`} aria-hidden="true">
          {planes.map(row => <polygon key={row.key} className="ua-section" points={row.points} style={{ opacity: row.opacity }} />)}
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
          {networkOn && planBlend < 1 && <g opacity={1 - planBlend}>
            <NetworkStageConnections connections={networkConnections} selected={selected} />
          </g>}
          {positions.length > 0 && <g className="ua-positions">
            {positions.map(row => <rect key={row.key} className={row.context ? 'is-context' : undefined} style={{ '--layer': TONE_COLOR[row.kind] } as CSSProperties}
              x={row.x - 4} y={row.y - 4} width={8} height={8} transform={`rotate(45 ${row.x} ${row.y})`} />)}
          </g>}
          {measuring && <g className="ua-measure">
            {measures.spans.map(row => <g key={row.key}>
              <line x1={row.line[0]} y1={row.line[1]} x2={row.line[2]} y2={row.line[3]} />
              <text className="ua-measure-halo" x={row.x} y={row.y} textAnchor="middle" dy="0.35em">{row.text}</text>
              <text x={row.x} y={row.y} textAnchor="middle" dy="0.35em">{row.text}</text>
            </g>)}
            {measures.areas.map(row => <g key={row.key} className="ua-measure-area">
              <text className="ua-measure-halo" x={row.x} y={row.y} textAnchor="middle" dy="0.35em">{row.text}</text>
              <text x={row.x} y={row.y} textAnchor="middle" dy="0.35em">{row.text}</text>
            </g>)}
          </g>}
          <g className="cifc-labels">
            {labels.map(label => label.plan ? <g key={label.id} className={`cifc-label is-${label.tier}${label.plan.mode === 'rotated' || label.plan.mode === 'callout' ? ' ua-plan-label-new' : ''}`}>
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
                <text className="cifc-label-halo" textAnchor={label.plan.textAnchor} x={label.plan.textX} dy="0.35em">{label.text}</text>
                <text textAnchor={label.plan.textAnchor} x={label.plan.textX} dy="0.35em">{label.text}</text>
              </g>
            </g> : <g key={label.id} className={`cifc-label is-${label.tier}`} transform={`translate(${label.x.toFixed(1)} ${label.y.toFixed(1)})`}>
              {/* Mounted once per selection: one ring answers the choice. */}
              {label.tier === 'selected' && <circle className="ua-ripple" r={18} />}
              {label.rise > .02 && <><line x1={0} y1={0} x2={0} y2={(-LEADER * label.rise).toFixed(1)} /><circle r={3.5} /></>}
              <g transform={label.rise > 0 ? `translate(0 ${(-TAG_RISE * label.rise).toFixed(1)})` : undefined}>
                <text className="cifc-label-halo" textAnchor="middle" dy="0.35em">{label.text}</text>
                <text textAnchor="middle" dy="0.35em">{label.text}</text>
              </g>
            </g>)}
          </g>
        </svg>
        {hits.map(label => <button key={label.id} type="button" className={`ua-label-hit${label.plan?.mode === 'rotated' || label.plan?.mode === 'callout' ? ' ua-plan-label-new' : ''}`}
          data-atlas-occurrence={label.id} data-stage-key={`label:${label.id}`}
          style={label.plan ? { left: label.plan.x, top: label.plan.y, width: label.plan.width, height: label.plan.height,
            transform: `translate(-50%, -50%) rotate(${label.plan.angle}deg)` } : { left: label.x, top: label.y - TAG_RISE * label.rise, width: labelHitWidth(label.text) }}
          aria-label={`Select room: ${atlasOccurrenceName(model, label.id)}`} onPointerDown={label.plan?.mode === 'callout' ? stop : undefined}
          onPointerUp={label.plan?.mode === 'callout' ? stop : undefined}
          onClick={event => { if (label.plan?.mode === 'callout' || event.detail === 0) select(label.id); }} />)}
        {counts.map(row => <button key={row.key} type="button" className={`ua-marker${row.context ? ' is-context' : ''}`} data-stage-key={`marker:${row.key}`}
          style={{ left: row.x, top: row.y, width: countMarkerWidth(row.count), '--layer': badgeFill(row.kind) } as CSSProperties}
          aria-label={`${row.roomLabel}: ${plural(row.count, `${OVERLAY_LABEL[row.kind].toLowerCase()} record`)}${row.context ? `, ${atlasLevelName(model, model.occurrencesById.get(row.occurrenceId)!.levelId, buildings.length > 1)}` : ''}`}
          onPointerDown={stop} onPointerUp={stop} onClick={() => select(row.occurrenceId)}>{row.count}</button>)}
        {failure && !plan && <p className="cifc-stage-note" role="status">3D view is unavailable. Use Plan or check Source details.</p>}
        {plan && planBlend >= 1 && !planGroups.some(group => group.features.length > 0) && <p className="cifc-stage-note" role="status">
          {focusLevel ? `No plan for ${atlasLevelName(model, focusLevel.levelId)} in this model.` : 'This model has no floors to show as a plan.'}</p>}
      </div>

      <div className="ua-bottom" inert={stageInert}>
        {/* The keys come first: on a wide stage they are the dock, and the
            floors strip sits just before the fold that opens it. */}
        {hasKeys && <LayerDetailsDock dock={keysDock} trigger={layersFold} id={`${foldIds}-layers`}
          short={shortLayerDetails} expanded={drawer === 'layers'} close={() => setDrawer(null)}>
          {active.map(layer => <OverlayKey key={layer.kind} layer={layer} records={runtime.records}
            connectionCoverage={layer.kind === 'network' ? networkConnections.coverage : null}
            buildings={runtime.buildings}
            publishedOnly={!runtimeConfigured} openDocuments={environment.openDocuments && (() => {
              if (shortLayerDetails) setDrawer(null); environment.openDocuments?.();
            })}
            availability={runtime.records?.[layer.kind] ?? (!runtimeConfigured ? 'available' : runtime.reason === 'loading' ? 'loading' : 'unavailable')}
            openNetwork={environment.openNetwork && (() => {
              if (shortLayerDetails) setDrawer(null); environment.openNetwork?.();
            })}
            graph={layer.kind === 'network' && graphs.length > 0 ? {
              id: lensGraph?.id ?? graphId, open: lensGraph?.open ?? showGraph,
              toggle: () => { if (shortLayerDetails) setDrawer(null); (lensGraph?.toggle ?? toggleGraph)(); },
            } : null} />)}
          {measuring && <MeasurementKey estimated={estimated} shown={measured.length} />}
        </LayerDetailsDock>}
        {tiles.length > 0 && <nav id={`${foldIds}-floors`} className={`ua-tiles${drawer === 'floors' ? ' is-unfolded' : ''}`} aria-label="Other floors">
          {tiles.map(level => <PlanTile key={level.levelId} model={model} level={level} layers={active} tints={tints} selected={selected}
            name={atlasLevelName(model, level.levelId, buildings.length > 1)} choose={() => chooseTile(level.levelId)} />)}
        </nav>}
        {/* Each fold opens its content just above it. Wide stages keep only
            the floors fold, beside the layer bar; the keys stay docked. */}
        {(tiles.length > 0 || hasKeys) && <div className="ua-folds">
          {tiles.length > 0 && <button ref={floorsFold} type="button" className="ua-fold ua-fold-floors" aria-expanded={drawer === 'floors'} aria-controls={`${foldIds}-floors`}
            onClick={() => fold('floors')}>
            <Icon name="layers" size={16} /><span>Other floors</span>{' '}<span className="ua-fold-count">{tiles.length.toLocaleString()}</span>
            <Icon name="chevronDown" size={15} /></button>}
          {hasKeys && <button ref={layersFold} type="button" className="ua-fold ua-fold-layers" aria-expanded={drawer === 'layers'} aria-controls={`${foldIds}-layers`}
            aria-haspopup={shortLayerDetails ? 'dialog' : undefined}
            onClick={() => fold('layers')}>
            <Icon name="info" size={16} /><span>Layer details</span>{' '}<span className="ua-fold-count">{keysCount.toLocaleString()}</span>
            <Icon name="chevronDown" size={15} /></button>}
        </div>}
        <div className="layer-bar" role="group" aria-label="Layers">
          {(['electrical', 'network', 'measurements'] as const).map(kind => {
            const on = state.layers[kind], index = kind === 'measurements' ? null : overlays.get(kind)!;
            return <button key={kind} type="button" className="layer-chip" aria-pressed={on}
              style={{ '--layer': LAYER_TONE[kind] } as CSSProperties} onClick={() => dispatch({ type: 'layer', layer: kind, on: !on })}>
              <span className="layer-swatch" aria-hidden="true" />{LAYER_LABEL[kind]}
              {on && kind !== 'measurements' && index!.records === 0 && <span className="ua-chip-note">{!runtimeConfigured || runtime.records?.[kind] === 'available' ? '0' : runtime.reason === 'loading' ? 'loading' : runtime.records?.[kind] === 'partial' ? 'partial' : 'unavailable'}</span>}</button>;
          })}
        </div>
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
          {graphs.map(graph => <NetworkGraph key={graph.key} graph={graph} />)}
        </div>
      </section>}
    </div>

    <Inspector model={model} state={state} dispatch={dispatch} context={context} renderFailure={failure}
      runtime={runtime.records} runtimeReason={runtime.reason} runtimeConfigured={runtimeConfigured}
      open={sheetOpen} setOpen={setSheetOpen}
      openDocuments={environment.openDocuments}
      openNetwork={environment.openNetwork} />

    {/* This model's own part of the host lens: its rooms, chosen as on the
        stage, or its logical network graph. Rendered into the lens panel;
        state, reads and selection stay with this Atlas. */}
    {hostLens?.target && lens && createPortal(<div className="ua-lens-native" onKeyDown={lensKeys}>
      {lens.kind === 'places'
        ? <section className="ua-lens-section" aria-labelledby={`${graphId}-rooms`}>
          <h3 id={`${graphId}-rooms`}>Model rooms</h3>
          {/* On a phone the lens stands where the room sheet does: choosing
              a room hands the stage and its sheet back. */}
          <RoomList model={model} levels={listedLevels(model, state)} levelName={levelId => atlasLevelName(model, levelId, model.floorBuildings.length > 1)}
            choose={key => { dispatch({ type: 'select', occurrenceId: key }); if (compact) hostLens.set(null); }} />
        </section>
        : <NetworkLensSection graphs={graphs} networkOn={networkOn} published={!runtimeConfigured}
          availability={runtime.records?.network ?? (!runtimeConfigured ? 'available' : runtime.reason === 'loading' ? 'loading' : 'unavailable')}
          headingId={`${graphId}-network`} showLayer={() => dispatch({ type: 'layer', layer: 'network', on: true })} />}
    </div>, hostLens.target)}
  </section>;
}

/** The model's network in the Network lens. Its graph is read with the
 * Network layer, as on the stage; the lens offers that layer alone and never
 * changes another. */
function NetworkLensSection({ graphs, networkOn, published, availability, headingId, showLayer }: {
  readonly graphs: NonNullable<PropertyRecords['networkGraphs']>; readonly networkOn: boolean; readonly published: boolean;
  readonly availability: 'available' | 'partial' | 'unavailable' | 'loading'; readonly headingId: string; readonly showLayer: () => void;
}) {
  return <section className="ua-lens-section" aria-labelledby={headingId} style={{ '--layer': TONE_COLOR.network } as CSSProperties}>
    <h3 id={headingId}><span className="ua-logical-swatch" aria-hidden="true" />Logical network graph</h3>
    {!networkOn ? <>
      <p>The model's network records are read with the Network layer.</p>
      <button type="button" className="btn btn-small" onClick={showLayer}>Show Network layer</button>
    </> : <>
      {availability === 'partial' && <p className="ua-unplaced">Some buildings or sources are unavailable; their records are not counted.</p>}
      {graphs.length > 0 ? graphs.map(graph => <NetworkGraph key={graph.key} graph={graph} />)
        : <p role="status">{availability === 'loading' ? 'Loading room sources…' : availability === 'unavailable' ? 'Current room sources are unavailable.'
          : published ? 'No logical network graph in this publication.' : 'No logical network graph in the available source.'}</p>}
    </>}
  </section>;
}

const stop = (event: ReactPointerEvent) => event.stopPropagation();

// ---------------------------------------------------------------------------

/** Floors at their actual scene heights: spacing follows the lowest room
 * floor of each level, with a minimum touch gap. Each rung names its floor,
 * its selectable rooms and whether it has a plan. */
function DatumLadder({ model, levels, building, state, dispatch, shownLevel, selectionLevel, contextLevels }: {
  readonly model: AtlasModel; readonly levels: readonly AtlasLevel[]; readonly building: { readonly label: string } | null;
  readonly state: AtlasViewState; readonly dispatch: (action: AtlasAction) => void;
  /** The floor Plan draws for a whole-building scope. */
  readonly shownLevel: string | null;
  readonly selectionLevel: string | null; readonly contextLevels: ReadonlySet<string>;
}) {
  const top = [...levels].reverse();
  const marks = useMemo(() => floorMarks(model, levels), [model, levels]);
  const gaps = top.map((level, at) => {
    const below = top[at + 1]; if (!below) return 0;
    return Math.max(50, (model.floorY.get(level.levelId)! - model.floorY.get(below.levelId)!) * 22);
  });
  const whole = state.levelId === null && state.buildingId !== null;
  return <nav className="ua-ladder" aria-label={building ? `Floors of ${building.label}` : 'Floors'}>
    <button type="button" className={`ua-rung ua-rung-all${whole ? ' is-current' : ''}`} aria-pressed={whole} disabled={levels.length === 0}
      onClick={() => dispatch({ type: 'level', levelId: null })}>
      {/* Compact rows show "All" beside the floor marks; the name stays whole. */}
      <span className="ua-rung-name">All<span className="ua-rung-all-rest"> floors</span></span>
    </button>
    <ol className="ua-rungs">
      {top.map((level, at) => {
        const current = state.levelId === level.levelId;
        const drawn = !current && state.levelId === null && shownLevel === level.levelId;
        const holds = selectionLevel === level.levelId, also = !holds && contextLevels.has(level.levelId);
        const rooms = level.occurrenceIds.filter(key => model.selectable.has(key)).length;
        const hasPlan = model.plansByLevel.has(level.levelId);
        // Spacing above this floor: its height difference to the floor listed before it.
        return <li key={level.levelId} style={at > 0 ? { '--rung-gap': `${gaps[at - 1]}px` } as CSSProperties : undefined}>
          <button type="button" className={`ua-rung${current ? ' is-current' : drawn ? ' is-shown' : ''}`} aria-pressed={current}
            title={level.elevationBasis ?? undefined}
            aria-label={`${atlasLevelName(model, level.levelId)}: ${plural(rooms, 'room')}${hasPlan ? '' : ', no plan'}${drawn ? ', plan shown' : ''}${holds ? ', has the selected room' : also ? ', has another part of the selected room' : ''}`}
            onClick={() => dispatch({ type: 'level', levelId: level.levelId })}>
            <span className="ua-rung-tick" aria-hidden="true">{marks.get(level.levelId)}</span>
            <span className="ua-rung-name">{atlasLevelName(model, level.levelId)}</span>
            <span className="ua-rung-sub">{plural(rooms, 'room')}{hasPlan ? '' : ', no plan'}</span>
            {(holds || also) && <span className={`ua-rung-mark${also ? ' is-context' : ''}`} aria-hidden="true" />}
          </button>
        </li>;
      })}
    </ol>
  </nav>;
}

// ---------------------------------------------------------------------------

/** Floors listed for the current scope, highest first. */
function listedLevels(model: AtlasModel, state: AtlasViewState): readonly AtlasLevel[] {
  return state.levelId !== null ? [model.levelsById.get(state.levelId)!]
    : model.scene.buildings.filter(row => state.buildingId === null || row.buildingId === state.buildingId)
      .flatMap(row => [...model.levelsByBuilding.get(row.buildingId)!].reverse());
}

/** Beside the stage when there is room; otherwise a sheet over the stage's
 * lower edge whose head (rooms or the selected room) stays in view. */
function Inspector({ model, state, dispatch, context, openNetwork, openDocuments, renderFailure, runtime, runtimeReason, runtimeConfigured, open, setOpen }: {
  readonly model: AtlasModel; readonly state: AtlasViewState; readonly dispatch: (action: AtlasAction) => void;
  readonly context: readonly string[]; readonly openNetwork: (() => void) | undefined;
  readonly renderFailure: string | null;
  readonly runtime: PropertyRecords | null; readonly runtimeReason: string; readonly runtimeConfigured: boolean;
  readonly openDocuments: (() => void) | undefined;
  readonly open: boolean; readonly setOpen: (open: boolean) => void;
}) {
  const bodyId = useId();
  const occurrence = state.occurrenceId === null ? null : model.occurrencesById.get(state.occurrenceId)!;
  // A choice made inside the panel replaces its content, so focus follows to the new heading.
  const heading = useRef<HTMLHeadingElement>(null);
  const refocus = useRef(false);
  const choose = (occurrenceId: string | null) => { refocus.current = true; dispatch({ type: 'select', occurrenceId }); };
  useEffect(() => {
    if (!refocus.current) return;
    refocus.current = false; heading.current?.focus();
  }, [state.occurrenceId]);
  const levelName = (levelId: string) => {
    return atlasLevelName(model, levelId, model.floorBuildings.length > 1);
  };
  // Shown only while the panel is a sheet.
  const toggle = (noun: string) => <button type="button" className="ua-sheet-toggle" aria-expanded={open} aria-controls={bodyId}
    onClick={() => setOpen(!open)}><Icon name="chevronDown" size={18} /><span>{open ? `Hide ${noun}` : `Show ${noun}`}</span></button>;
  const kinds = OVERLAY_KINDS.filter(kind => state.layers[kind]);

  if (!occurrence) {
    const levels = listedLevels(model, state);
    const count = levels.reduce((sum, level) => sum + level.occurrenceIds.filter(key => model.selectable.has(key)).length, 0);
    return <aside className={`ua-inspector${open ? ' is-open' : ''}`} aria-label="Rooms">
      <div className="ua-sheet-head">
        <div className="ua-sheet-title">
          <h2 ref={heading} tabIndex={-1}>Rooms</h2>
          <p className="ua-sheet-sub">{plural(count, 'room')}{levels.length === 1 ? `, ${levelName(levels[0]!.levelId)}` : ` on ${plural(levels.length, 'floor')}`}</p>
        </div>
        {toggle('rooms')}
      </div>
      <div className="ua-sheet-body" id={bodyId}>
        {/* Choosing from the list hands the stage back to the model. */}
        <RoomList model={model} levels={levels} choose={key => { setOpen(false); choose(key); }} levelName={levelName} />
        <SourceDetails model={model} renderFailure={renderFailure} overlayReason={runtimeReason} runtimeSource={runtime?.sourceFacts ?? []} />
      </div>
    </aside>;
  }

  const room = model.roomsById.get(occurrence.roomId)!;
  const basis = occurrence.geometryBasis;
  const area = state.layers.measurements ? roomArea(model, occurrence.spaceOccurrenceId) : null;
  const overlays = OVERLAY_KINDS.map(kind => {
    const index = model.overlays.get(kind)!;
    return { kind, placement: index.placed.get(occurrence.spaceOccurrenceId) ?? null,
      unplaced: index.unplaced.filter(row => row.binding.roomId === room.roomId
        && (row.binding.spaceOccurrenceId === null || row.binding.spaceOccurrenceId === occurrence.spaceOccurrenceId)) };
  }).filter(row => !runtimeConfigured && (row.placement || row.unplaced.length > 0));
  return <aside className={`ua-inspector is-room${open ? ' is-open' : ''}`} aria-label="Selected room">
    <div className="ua-sheet-head">
      <div className="ua-sheet-title">
        <h2 ref={heading} tabIndex={-1}>{room.label}</h2>
        <p className="ua-room-floor">{levelName(occurrence.levelId)}</p>
      </div>
      {toggle('details')}
      <button type="button" className="ctrl-btn" aria-label="Clear room" onClick={() => choose(null)}><Icon name="close" size={17} /></button>
    </div>
    {/* Keyed by room part: the new room's facts settle in. */}
    <div className="ua-sheet-body" id={bodyId} key={occurrence.spaceOccurrenceId}>
      {context.length > 0 && <div className="ua-also" role="group" aria-label="Also on">
        <span>Also on</span>
        {context.map(key => <button key={key} type="button" className="chip-btn" onClick={() => choose(key)}>
          {levelName(model.occurrencesById.get(key)!.levelId)}</button>)}
      </div>}

      {/* The room's standing facts: one line of labelled chips under the head. */}
      <dl className="ua-facts ua-room-facts">
        <div><dt>Layout</dt><dd>{basis.kind === 'owner-estimated-pick-proxy' ? 'Estimated layout' : 'From the model'}</dd></div>
        <div><dt>Home place</dt><dd className={`ua-link is-${room.nativeBinding.status}`}>{runtime?.rooms.has(room.roomId) ? 'Linked for these sources' : room.nativeBinding.status === 'historical' ? 'Link needs review' : LINK_LABEL[room.nativeBinding.status]}</dd></div>
        {state.layers.measurements && <div><dt>Area</dt><dd><AreaValue geometryBasis={basis} area={area} /></dd></div>}
      </dl>

      {runtime && <RoomContentsSummary runtime={runtime} roomId={room.roomId} layers={state.layers} />}

      {/* Open while Measurements is on; it folds away when a long list of
          spans would push the records down. */}
      {state.layers.measurements && area && <section aria-label="Model outline dimensions" className="ua-records ua-spans-section">
        <details className="ua-spans" open>
          <summary><Icon name="ruler" size={16} className="ua-spans-glyph" />
            <span className="ua-spans-title">Outline spans{area.partial ? ' for this room part' : ''}</span></summary>
          <p>{MEASUREMENT_BASIS}</p>
          <dl className="ua-facts">{edgeSpans(model, occurrence.spaceOccurrenceId).map((span, at) =>
            <div key={span.key}><dt>Outline span {at + 1}</dt><dd>{span.text}</dd></div>)}</dl>
        </details>
      </section>}

      {/* One group per layer that is on: its glyph, name and how many records
          this room's source supplies, the source state before the rows, then
          the records in source order. */}
      {runtime && kinds.map(kind => {
        const records = runtime.rooms.has(room.roomId) && runtime[kind] !== 'unavailable' ? runtime.rooms.get(room.roomId)![kind] : null;
        return <section key={kind} className="ua-records" aria-label={`${OVERLAY_LABEL[kind]} in this room`}>
          <h3 className="ua-records-head"><Icon name={OVERLAY_ICON[kind]} size={16} />{OVERLAY_LABEL[kind]}
            {records && records.length > 0 && <span className="ua-records-count">{plural(records.length, 'record')}</span>}</h3>
          {runtime[kind] === 'partial' && <p className="ua-records-state">{kind === 'electrical' ? 'Some electrical sources or buildings are unavailable.' : 'The network source is unavailable for some buildings.'}</p>}
          {!runtime.rooms.has(room.roomId) ? <p className="ua-records-state">Room source link unavailable.</p>
            : runtime[kind] === 'unavailable' ? <p className="ua-records-state">Source unavailable.</p>
            : <DocumentaryRecords records={records!} openDocuments={openDocuments} />}
        </section>;
      })}

      {overlays.length > 0 && <section className="ua-records" aria-label="Records in this room">
        {overlays.map(({ kind, placement, unplaced }) => <div key={kind} className="ua-record" style={{ '--layer': TONE_COLOR[kind] } as CSSProperties}>
          <h3><Icon name={OVERLAY_ICON[kind]} size={16} />{OVERLAY_LABEL[kind]}</h3>
          {placement && <PublishedOverlayDetails placement={placement} />}
          {unplaced.length > 0 && <p className="ua-unplaced">
            {plural(new Set(unplaced.flatMap(row => row.binding.recordIds)).size, 'record')} not placed: {[...new Set(unplaced.map(row => UNPLACED_LABEL[row.reason]))].join('; ')}.</p>}
          {kind === 'network' && openNetwork && <button type="button" className="text-btn" onClick={openNetwork}>Open Network</button>}
        </div>)}
      </section>}
      <SourceDetails model={model} occurrence={occurrence} room={room} renderFailure={renderFailure} overlayReason={runtimeReason} runtimeSource={runtime?.sourceFacts ?? []} />
    </div>
  </aside>;
}

/** What the loaded sources hold for this room, one line per layer: the
 * supplied list's length and the source's own state, or why there is none.
 * A layer that is off still lists what is already loaded, marked off; nothing
 * here toggles a layer, fetches or counts beyond the supplied list. */
function RoomContentsSummary({ runtime, roomId, layers }: {
  readonly runtime: PropertyRecords; readonly roomId: string; readonly layers: AtlasViewState['layers'];
}) {
  const linked = runtime.rooms.get(roomId);
  return <section className="ua-contents" aria-label="In this room">
    <h3 className="ua-contents-title">In this room</h3>
    <ul>{OVERLAY_KINDS.map(kind => {
      const records = linked && runtime[kind] !== 'unavailable' ? linked[kind] : null;
      const source = !linked ? 'Room source link unavailable' : runtime[kind] === 'unavailable' ? 'Source unavailable'
        : runtime[kind] === 'partial' ? 'Partial source' : null;
      return <li key={kind} className={`ua-contents-row${layers[kind] ? '' : ' is-off'}${source ? ' is-qualified' : ''}`}>
        <Icon name={OVERLAY_ICON[kind]} size={16} />
        <span className="ua-contents-name">{OVERLAY_LABEL[kind]}</span>
        {records && <span className="ua-contents-count">{plural(records.length, 'record')}</span>}
        {source && <span className="ua-contents-state">{source}</span>}
        {!layers[kind] && <span className="ua-contents-off">Layer off</span>}
      </li>;
    })}</ul>
  </section>;
}

function DocumentaryRecords({ records, openDocuments }: { readonly records: readonly DocumentaryRecord[]; readonly openDocuments: (() => void) | undefined }) {
  // Short type names and glyphs for the categories the source names; any other
  // category shows its original string. The full category stays in the details.
  const types: Readonly<Record<string, { readonly short: string; readonly icon: string }>> = {
    'Electrical drawing': { short: 'Drawing', icon: 'file' },
    'Historical symbol': { short: 'Historic symbol', icon: 'symbol' },
    'Recorded device': { short: 'Device', icon: 'box' },
    'Recorded connection': { short: 'Connection', icon: 'link' },
    'Network endpoint': { short: 'Endpoint', icon: 'network' },
  };
  if (!records.length) return <p>No linked records in the available source.</p>;
  // Collapsed, each row names the record, its type and its qualification;
  // opened, its category and detail, dates, connections and sources.
  return <div className="ua-docs">{records.map(record => {
    const type = Object.prototype.hasOwnProperty.call(types, record.category) ? types[record.category]! : null;
    return <details className="ua-refs ua-doc" key={record.key}>
      <summary>
        <Icon name={type?.icon ?? 'record'} size={16} className="ua-doc-glyph" />
        <span className="ua-doc-head">
          <span className="ua-doc-label">{record.label}</span>
          <span className="ua-doc-type">{type?.short ?? record.category}</span>
        </span>
        <span className="ua-doc-qual">{record.qualification}</span>
      </summary>
      {/* Opened: the record's own facts, labelled, with every connection. */}
      <dl className="ua-doc-facts">
        <div><dt>Category</dt><dd>{record.category}</dd></div>
        {record.detail && <div><dt>Detail</dt><dd>{record.detail}</dd></div>}
        <div><dt>Source date</dt><dd>{record.sourceDate ?? 'unknown'}</dd></div>
        <div><dt>Retrieved</dt><dd>{record.retrievedAt ?? 'unknown'}</dd></div>
        {record.connections.length > 0 && <div><dt>Connections</dt><dd><ul>{record.connections.map((connection, at) => <li key={at}>{connection}</li>)}</ul></dd></div>}
      </dl>
      {openDocuments && (record.category === 'Electrical drawing' || record.category === 'Historical symbol') && <button type="button" className="text-btn" onClick={openDocuments}>Open Documents</button>}
      <details className="ua-source"><summary>Source</summary><dl><div><dt>Source record</dt><dd>{record.id}</dd></div>
        {record.sourceFacts.map(fact => <div key={fact.label}><dt>{fact.label}</dt><dd>{fact.value ?? 'unknown'}</dd></div>)}
      </dl></details>
      {record.observations && record.observations.length > 0 && <details className="ua-source">
        <summary>Other source observations ({record.observations.length})</summary>
        <DocumentaryRecords records={record.observations} openDocuments={openDocuments} />
      </details>}
    </details>;
  })}</div>;
}

function RoomList({ model, levels, choose, levelName }: {
  readonly model: AtlasModel; readonly levels: readonly AtlasLevel[]; readonly choose: (occurrenceId: string) => void;
  readonly levelName: (levelId: string) => string;
}) {
  const coverage = model.scene.coverage;
  return <div className="ua-rooms">
    {levels.map(level => {
      const keys = level.occurrenceIds.filter(key => model.selectable.has(key));
      return <section key={level.levelId} aria-label={levelName(level.levelId)}>
        <h3>{levelName(level.levelId)}</h3>
        {keys.length === 0 ? <p className="ua-empty">No selectable rooms.</p>
          : <ul>{keys.map(key => {
            const occurrence = model.occurrencesById.get(key)!;
            return <li key={key}><button type="button" className="ua-room-btn" onClick={() => choose(key)}>
              <span>{atlasOccurrenceName(model, key)}</span>
              {occurrence.geometryBasis.kind === 'owner-estimated-pick-proxy' && <span className="ua-tag">Preliminary</span>}
            </button></li>;
          })}</ul>}
      </section>;
    })}
    {coverage.unselectableCount > 0 && <p className="ua-coverage">{plural(coverage.unselectableCount, 'room part')} in this model cannot be selected yet.</p>}
  </div>;
}

function SourceDetails({ model, occurrence, room, renderFailure, overlayReason, runtimeSource }: {
  readonly model: AtlasModel; readonly occurrence?: AtlasOccurrence; readonly room?: AtlasRoom; readonly renderFailure: string | null;
  readonly overlayReason: string;
  readonly runtimeSource?: readonly SourceFact[];
}) {
  const { publication, coverage } = model.scene;
  const elevations = model.scene.levels.filter(level => level.elevationBasis !== null || level.sourceElevationM !== null);
  // Logical rooms the publication keeps without any occurrence: placement unknown, not selectable.
  const unpositioned = model.scene.rooms.filter(row => row.occurrenceIds.length === 0);
  return <details className="ua-source">
    <summary>Source</summary>
    <dl>
      <div><dt>Model revision</dt><dd>{publication.sourceRevisionId}</dd></div>
      <div><dt>Model file</dt><dd>{(model.scene.model.bytes / 1_048_576).toFixed(1)} MiB, SHA-256 <code className="ua-hash">{model.scene.model.sha256}</code></dd></div>
      {renderFailure && <div><dt>3D diagnostic</dt><dd>{renderFailure}</dd></div>}
      {overlayReason !== 'not-loaded' && <div><dt>Overlay source</dt><dd>{overlayReason}</dd></div>}
      {runtimeSource?.map(fact => <div key={fact.label}><dt>{fact.label}</dt><dd>{fact.value ?? 'unknown'}</dd></div>)}
      {occurrence && <div><dt>Room layout</dt><dd>{occurrence.geometryBasis.kind === 'owner-estimated-pick-proxy' ? 'Estimated pick area; not measured or reviewed.' : 'Source model geometry.'}
        {occurrence.geometryBasis.note && <span className="ua-note">{occurrence.geometryBasis.note}</span>}</dd></div>}
      {occurrence?.geometryBasis.sourceRef && <div><dt>Room source</dt><dd>{occurrence.geometryBasis.sourceRef}</dd></div>}
      {room && <div><dt>Place link</dt><dd>{LINK_LABEL[room.nativeBinding.status]}</dd></div>}
      <div><dt>Position</dt><dd>Model frame only. Not aligned to the physical site.</dd></div>
      {elevations.length > 0 && <div><dt>Source elevations</dt><dd><ul>{elevations.map(level => <li key={level.levelId}>{atlasLevelName(model, level.levelId, model.scene.buildings.length > 1)}: {level.sourceElevationM !== null ? `${elevation(level.sourceElevationM)}; ` : ''}{level.elevationBasis ?? 'Datum not specified.'} <code>{level.levelId}</code></li>)}</ul></dd></div>}
      {coverage.exclusions.length > 0 && <div><dt>Not selectable</dt><dd><ul>
        {coverage.exclusions.map((row, at) => <li key={at}>{atlasExclusionText(model, row)}</li>)}
      </ul></dd></div>}
      {unpositioned.length > 0 && <div><dt>No model position</dt><dd><ul>
        {unpositioned.map(row => <li key={row.roomId}>{row.label}, {atlasBuildingName(model, row.buildingId)}</li>)}
      </ul></dd></div>}
    </dl>
  </details>;
}

const COVERAGE_TEXT = { available: 'Available', partial: 'Partial', unavailable: 'Unavailable' } as const;

function OverlayKey({ layer, openNetwork, availability, records, buildings, openDocuments, publishedOnly, graph, connectionCoverage }: {
  readonly layer: OverlayLayerIndex; readonly openNetwork: (() => void) | undefined; readonly openDocuments: (() => void) | undefined;
  readonly records: PropertyRecords | null; readonly availability: 'available' | 'partial' | 'unavailable' | 'loading';
  readonly publishedOnly: boolean;
  readonly buildings: readonly BuildingCoverage[];
  readonly connectionCoverage: NetworkConnections['coverage'] | null;
  /** The logical network graph's own panel, when the source has one. */
  readonly graph: { readonly id: string; readonly open: boolean; readonly toggle: () => void } | null;
}) {
  const reasons = unplacedByReason(layer);
  const unplaced = records?.unplaced[layer.kind] ?? [];
  // Topology stays separate from physical points: connections are logical only.
  const connections = layer.kind === 'network' ? unplaced.filter(record => record.category === 'Recorded connection') : [];
  const others = layer.kind === 'network' ? unplaced.filter(record => record.category !== 'Recorded connection') : unplaced;
  // Closed, the head keeps the layer's state in view; the explanation and
  // unplaced records open on request, so the model keeps the stage.
  const [closed, setClosed] = useState(true);
  const bodyId = useId();
  return <section className={`ua-key${closed ? ' is-closed' : ''}`} aria-label={`${OVERLAY_LABEL[layer.kind]} layer`} style={{ '--layer': TONE_COLOR[layer.kind] } as CSSProperties}>
    <button type="button" className="ua-key-head" aria-expanded={!closed} aria-controls={bodyId} onClick={() => setClosed(value => !value)}>
      <Icon name={OVERLAY_ICON[layer.kind]} size={17} /><span className="ua-key-label">{OVERLAY_LABEL[layer.kind]}</span>
      {/* A count only where the source answered; unavailable is not zero. */}
      <span className={`ua-key-count${availability === 'unavailable' || availability === 'partial' ? ' is-warn' : ''}`}>
        {availability === 'loading' ? 'Loading' : availability === 'unavailable' ? 'Unavailable'
          : `${plural(layer.records, 'record')}${availability === 'partial' ? ', partial' : ''}${layer.unplacedRecords > 0 ? `, ${layer.unplacedRecords.toLocaleString()} not placed` : ''}`}
      </span>
      <Icon name="chevronDown" size={16} />
    </button>
    <div className="ua-key-body" id={bodyId} hidden={closed}>
      <p>{availability === 'loading' ? 'Loading room sources…' : availability === 'unavailable' ? 'Current room sources are unavailable.'
        : availability === 'partial' ? 'Some buildings or sources are unavailable; their records are not counted.'
        : publishedOnly && layer.records === 0 ? 'No source references in this publication.'
        : layer.records === 0 ? 'No linked records in the available source.' : 'Counts show source records per room across the property, not device positions.'}</p>
      {buildings.length > 0 && <ul className="ua-coverage-list" aria-label="Coverage by building">
        {buildings.map((row: BuildingCoverage) => <li key={row.buildingId} className={`is-${row[layer.kind]}`}>
          <span className="ua-coverage-name">{row.label}</span>
          <span className="ua-coverage-state">{COVERAGE_TEXT[row[layer.kind]]}{row.reason !== 'available' ? `: ${row.reason}` : ''}</span></li>)}
      </ul>}
      {graph && <button type="button" className="ua-graph-open" aria-expanded={graph.open} aria-controls={graph.id} onClick={graph.toggle}>
        <span className="ua-logical-swatch" aria-hidden="true" /><span>Logical network graph</span><Icon name="network" size={16} />
      </button>}
      {connectionCoverage && <p>3D lines show {connectionCoverage.links.anchored} of {connectionCoverage.links.total} logical connections at reviewed room summaries;
        {' '}{connectionCoverage.links.unplaced} have no complete room association. They do not show device positions or cable routes.
        {connectionCoverage.sharedMediumAssociations.anchored > 0 && ` ${connectionCoverage.sharedMediumAssociations.anchored} shared-medium associations are shown separately.`}</p>}
      {connections.length > 0 && <details className="ua-logical">
        <summary><span className="ua-logical-swatch" aria-hidden="true" />{plural(connections.length, 'logical connection')}, no cable routes</summary>
        <DocumentaryRecords records={connections} openDocuments={openDocuments} />
      </details>}
      {(layer.unplacedRecords > 0 || layer.unplaced.length > 0) && <details>
        <summary>{others.length > 0 ? `${plural(others.length, 'record')} not placed` : layer.unplacedRecords > 0 ? `${plural(layer.unplacedRecords, 'record')} not placed` : 'Unplaced source bindings'}</summary>
        {others.length > 0 ? <DocumentaryRecords records={others} openDocuments={openDocuments} />
          : <><ul>{[...reasons].map(([reason, count]) => <li key={reason}>{plural(count, 'record')}: {UNPLACED_LABEL[reason]}</li>)}</ul>
            {!closed && layer.unplaced.map((row, at) => <PublishedUnplacedBinding key={at} binding={row.binding} reason={UNPLACED_LABEL[row.reason]} />)}</>}
      </details>}
      {layer.kind === 'network' && openNetwork && <button type="button" className="text-btn" onClick={openNetwork}>Open Network</button>}
    </div>
  </section>;
}

/** The measurement qualifier on one line: approximate, and how many outlines
 * are estimated; the basis opens below it. */
function MeasurementKey({ estimated, shown }: { readonly estimated: number; readonly shown: number }) {
  const [closed, setClosed] = useState(true);
  const bodyId = useId();
  return <section className={`ua-key ua-measure-key${closed ? ' is-closed' : ''}`} aria-label="Measurements layer"
    style={{ '--layer': BIRCH_DARK, '--plate': BIRCH } as CSSProperties}>
    <button type="button" className="ua-key-head" aria-expanded={!closed} aria-controls={bodyId} onClick={() => setClosed(value => !value)}>
      <svg className="ua-rule-glyph" width={17} height={17} viewBox="0 0 24 24" aria-hidden="true">
        <path d="M3.5 15.5 15.5 3.5l5 5-12 12Z M7 12l2 2 M10 9l2.5 2.5 M13 6l2 2" /></svg>
      <span className="ua-key-label">Measurements</span>
      <span className="ua-key-count">{shown === 0 ? 'Choose a floor or room' : `Approximate${estimated > 0 ? `, ${plural(estimated, 'estimated outline')}` : ''}`}</span>
      <Icon name="chevronDown" size={16} />
    </button>
    <div className="ua-key-body" id={bodyId} hidden={closed}>
      <p>{MEASUREMENT_BASIS}</p>
      {shown === 0 && <p className="ua-key-note">Choose a floor or room to see its dimensions.</p>}
      {estimated > 0 && <p className="ua-key-note">{plural(estimated, 'room part')} with an estimated outline not measured.</p>}
    </div>
  </section>;
}
