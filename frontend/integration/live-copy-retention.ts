import type { ElectricalLibraryReader, ElectricalLibraryFrame } from '../src/lantern/electrical-library/types';
import type { NativeEvidenceDocumentFrame } from '../src/lantern/scans/native-evidence-document-types';
import type { ReadyView } from '../src/app/types';
import type { AtlasSessionInfo } from '../src/app/session';
import type { SourceDocumentsPort, SourceDocument, SourceDocumentFrame, SourceDocumentReader } from '../src/lantern/source-documents/types';
import type { OfflineHomeboxAttachmentRefV1, OfflineHomeboxPinV1, OfflineElectricalPinV1, OfflineElectricalBuildingV1, OfflineCatalogItemV1, OfflineCatalogV1, OfflineDocumentPinV1, OfflineResult, OfflineBackend, OfflineAtlasReferenceV1, OfflineReadPort } from '../src/offline/live-copy-types';
import { createLiveCopyOwner, LIVE_COPY_LIMITS, electricalPinBytes, validElectricalPin, validHomeboxRef, listsAttachment, admitJson, stringPayload, type LiveCopyActor, type LiveCopyHome } from '../src/offline/live-copy-owner';
import { openLiveCopyBackend } from '../src/offline/live-copy-indexeddb';
import type { HomeboxOriginalFrame, HomeboxOriginalReader, HomeboxOriginalOpenResult, HomeboxOriginalSource,
  HomeboxRetentionAttempt, HomeboxRetentionReconciliation, HomeboxOriginalJoinResult, HomeboxFillPass, HomeboxFillOutcome } from '../src/lantern/homebox-originals/types';

type State = { readonly session: AtlasSessionInfo | null; readonly view: ReadyView | null };
/** Stable data-only host owner. No UI, network at construction, authority recovery or outbox configuration. */
export function createLiveCopyRetention(options: {
  readonly factory: IDBFactory | undefined; readonly backend?: OfflineBackend; readonly state: () => State;
  readonly documents: () => SourceDocumentsPort;
  readonly atlasReference?: (identity: { readonly actorId: string; readonly scope: Readonly<{ workspaceId: string; homeId: string }> },
    signal: AbortSignal) => Promise<OfflineAtlasReferenceV1 | null>;
  readonly storage?: Pick<StorageManager, 'estimate' | 'persisted' | 'persist'>;
  readonly events?: Pick<EventTarget, 'addEventListener' | 'removeEventListener'>;
  readonly channel?: { postMessage(value: string): void; close(): void; onmessage: ((event: MessageEvent) => void) | null };
  /** Same-origin transport for the HomeBox offline-original GET; defaults to fetch, never configured from storage. */
  readonly homeboxTransport?: typeof fetch;
}) {
  const channel = options.channel;
  const quiet = () => {};
  const owner = createLiveCopyOwner(options.backend ?? openLiveCopyBackend(options.factory), {
    ...(options.storage ? { storage: options.storage } : {}),
    changed: () => channel?.postMessage('changed'),
  });
  if (channel) channel.onmessage = () => { owner.refreshCopies(); refreshHomeboxOriginals(); };
  const recheckCopies = () => { owner.refreshCopies(); refreshHomeboxOriginals(); };
  options.events?.addEventListener('focus', recheckCopies); options.events?.addEventListener('visibilitychange', recheckCopies);
  const outcomeListeners = new Set<() => void>();
  let actor: LiveCopyActor | null = null, observed: AtlasSessionInfo | null = null, generation = 0;
  let lastResult: OfflineResult<unknown> = { status: 'missing' };
  const remember = <T>(result: OfflineResult<T>): OfflineResult<T> => { lastResult = result; for (const cb of [...outcomeListeners]) { try { cb(); } catch { /* outcome remains available */ } } return result; };
  async function observe(session: AtlasSessionInfo | null, current: () => boolean) {
    const attempt = ++generation; actor = null; observed = null;
    refreshHomeboxOriginals();
    const result = await owner.observeActor(session?.actorId ?? null, () => attempt === generation && current());
    if (result.status === 'ok' && attempt === generation && current()) { actor = result.value; observed = session; }
    return remember(result);
  }
  function witness(): OfflineResult<{ actor: LiveCopyActor; session: AtlasSessionInfo; view: ReadyView; current: () => boolean }> {
    const { session, view } = options.state();
    if (!actor || !observed || session !== observed || !view || view.status !== 'ready'
      || !Number.isFinite(Date.parse(session.expiresAt)) || Date.parse(session.expiresAt) <= Date.now()) return { status: 'retired' };
    const originalActor = actor, attempt = generation, actorId = session.actorId, expiresAt = session.expiresAt;
    const workspaceId = view.scope.workspaceId, homeId = view.scope.homeId;
    const current = () => {
      const latest = options.state();
      return owner.currentActor(originalActor) && attempt === generation && latest.session === session && latest.view === view && observed === session
        && session.actorId === actorId && session.expiresAt === expiresAt
        && view.scope.workspaceId === workspaceId && view.scope.homeId === homeId
        && Date.parse(session.expiresAt) > Date.now();
    };
    if (!current()) return { status: 'retired' };
    return { status: 'ok', value: { actor: originalActor, session, view, current } };
  }
  function binding(): OfflineResult<{ home: LiveCopyHome; current: () => boolean }> {
    const captured = witness(); if (captured.status !== 'ok') return captured;
    const { actor, view, current } = captured.value;
    const result = owner.bindHome(actor, view.scope, current);
    return result.status === 'ok' ? { status: 'ok', value: { home: result.value, current } } : result;
  }
  // Sent HomeBox reads per actual session allocation. Any sent outcome (including unknown) is never repeated
  // automatically for that association, even with a fresh requestId; nothing here persists.
  type Mode = 'explicit' | 'bulk';
  type Claim = { state: 'reserved-unsent' | 'in-flight' | 'sent-success' | 'definitive-refusal' | 'sent-unknown';
    ref: Readonly<OfflineHomeboxAttachmentRefV1>; scope: Readonly<ReadyView['scope']>; payload: number; mode: Mode; sourceIdentity: object | undefined;
    controller: AbortController; waiters: Set<{ live(): boolean; wake(held?: OfflineResult<null>): void }>; cancelled: boolean; settled: boolean; publicUnknown: boolean;
    record?: FrameRecord; pending?: Promise<OfflineResult<FrameRecord>>; outcome?: OfflineResult<FrameRecord>;
    rehydration?: Promise<OfflineResult<Blob>>;
    rehydrationController?: AbortController; rehydrationAborting?: boolean };
  const homeboxSent = new WeakMap<AtlasSessionInfo, Map<string, Claim>>();
  const safeCurrent = (current: () => boolean) => { try { return current(); } catch { return false; } };
  const B = 10_485_760, KiB = 1024;
  // Instance-local application-payload accounting, not browser/native/GC/RSS accounting.
  let claimCount = 0, claimPayload = 0, readerCount = 0, interestCount = 0, residentBytes = 0;
  type PipelineLease = { released: boolean };
  let pipeline: PipelineLease | null = null, quarantined = false;
  const resource = (account: string) => ({ status: 'resource' as const, resource: account });
  const takePipeline = () => {
    if (pipeline || quarantined) return null;
    const token: PipelineLease = { released: false }; pipeline = token; return token;
  };
  const releasePipeline = (token: PipelineLease) => { token.released = true; if (pipeline === token && !quarantined) pipeline = null; };
  const borrowPipeline = (enclosing?: PipelineLease) => quarantined ? null
    : enclosing && pipeline === enclosing && !enclosing.released ? enclosing : takePipeline();
  const claimKeyAdmission = (scope: ReadyView['scope'], ref: OfflineHomeboxAttachmentRefV1) => {
    const fields = [scope.workspaceId, scope.homeId, ref.sourceInstanceId, ref.collectionId, ref.entityId, ref.attachmentId];
    const encoded = admitJson(fields, 20 * KiB);
    let refs = 0;
    for (const value of [ref.source, ref.sourceInstanceId, ref.collectionId, ref.entityId, ref.attachmentId]) refs += stringPayload(value);
    return { fields, payload: encoded.utf8 + encoded.utf16 * 2 + refs };
  };
  const findClaim = (session: AtlasSessionInfo, scope: ReadyView['scope'], ref: OfflineHomeboxAttachmentRefV1) => {
    for (const claim of homeboxSent.get(session)?.values() ?? []) if (claim.scope.workspaceId === scope.workspaceId
      && claim.scope.homeId === scope.homeId && claim.ref.sourceInstanceId === ref.sourceInstanceId
      && claim.ref.collectionId === ref.collectionId && claim.ref.entityId === ref.entityId && claim.ref.attachmentId === ref.attachmentId) return claim;
    return undefined;
  };
  const lifetimes = new Set<{ current(): boolean; stop(): void }>();
  function refreshHomeboxOriginals() {
    for (const life of [...lifetimes]) if (!safeCurrent(life.current)) life.stop();
  }
  // Actual session expiry only; no producer snapshot window or provider-membership lease.
  function track(current: () => boolean, expiry: number, stop: () => void): () => void {
    let timer: ReturnType<typeof setTimeout> | undefined, ended = false;
    const remove = () => { if (timer !== undefined) clearTimeout(timer); lifetimes.delete(life); };
    const life = { current, stop() { if (!ended) { ended = true; remove(); stop(); } } };
    const arm = () => {
      if (!safeCurrent(current)) { life.stop(); return; }
      timer = setTimeout(arm, Math.min(2_147_483_647, Math.max(1, expiry - Date.now())));
    };
    lifetimes.add(life); arm();
    return () => { ended = true; remove(); };
  }
  interface FrameRecord {
    readonly frame: HomeboxOriginalFrame; readonly reader: object;
    readonly ref: Readonly<OfflineHomeboxAttachmentRefV1>; readonly pin: Readonly<OfflineHomeboxPinV1>;
    readonly binding: Readonly<{ session: AtlasSessionInfo; view: ReadyView; actorId: string;
      scope: Readonly<ReadyView['scope']>; actor: LiveCopyActor; current: () => boolean }>;
    readonly notify: () => void;
    stopTracking: () => void;
    blob: Blob | null; ui: boolean; storage: boolean; retired: boolean;
    storageController?: AbortController; attempt?: HomeboxRetentionAttempt;
    bulkSignal?: AbortSignal;
    root: FrameRecord; claim: Claim; children: Set<FrameRecord>; workToken?: PipelineLease; borrowed: boolean;
  }
  const frames = new WeakMap<HomeboxOriginalFrame, FrameRecord>();
  function cleanupFrame(record: FrameRecord) {
    const root = record.root;
    if (!record.ui && record.borrowed) { record.borrowed = false; record.blob = null; root.children.delete(record); interestCount--; }
    if (!root.children.size && !root.storage && !root.claim.waiters.size && root.blob) {
      root.blob = null; residentBytes -= B; root.stopTracking();
    }
  }
  function retireFrame(record: FrameRecord) {
    const root = record.root; if (root.retired) return;
    root.retired = true; root.claim.controller.abort(); root.storageController?.abort();
    for (const child of [...root.children]) { child.ui = false; child.retired = true; cleanupFrame(child); child.notify(); }
    cleanupFrame(root);
  }
  const frameCurrent = (record: FrameRecord) => !record.root.retired && safeCurrent(record.root.binding.current);
  function borrow(root: FrameRecord, reader: object, notify: () => void): HomeboxOriginalOpenResult {
    if (!frameCurrent(root)) return { status: 'retired' };
    if (root.children.size + root.claim.waiters.size + Number(root.storage) >= 8 || interestCount >= 32) return resource('handles');
    const frame = Object.freeze({}) as HomeboxOriginalFrame;
    const child: FrameRecord = { ...root, frame, reader, notify, root, ui: true, borrowed: true };
    root.children.add(child); interestCount++; frames.set(frame, child);
    return { status: 'ok', frame, backing: 'memory' };
  }
  async function acquireHomebox(refInput: OfflineHomeboxAttachmentRefV1, signal: AbortSignal,
    reader: object, additionalCurrent: () => boolean, notify: () => void, mode: Mode = 'explicit',
    prepare?: (signal: AbortSignal, ref: Readonly<OfflineHomeboxAttachmentRefV1>) => Promise<boolean>, joinOnly = false, enclosingToken?: PipelineLease,
    interestCurrent: () => boolean = () => true, sourceIdentity?: object): Promise<HomeboxOriginalJoinResult> {
    const b = witness(); if (b.status !== 'ok') return { status: 'retired' };
    const { session, view, actor: originalActor } = b.value;
    if (!session || !view || !originalActor || !validHomeboxRef(refInput)) return { status: 'invalid' };
    if (!listsAttachment(view, refInput)) return { status: 'missing' };
    const expiry = Date.parse(session.expiresAt);
    const current = () => b.value.current() && Date.now() < expiry && safeCurrent(additionalCurrent);
    const liveInterest = () => !signal.aborted && current() && safeCurrent(interestCurrent);
    if (!liveInterest()) return { status: signal.aborted ? 'aborted' : 'retired' };
    if (interestCount >= 32) return resource('interests');
    let claim = findClaim(session, view.scope, refInput);
    if (claim?.cancelled && !claim.settled || claim?.rehydrationAborting) return { status: 'settling' };
    if (claim?.publicUnknown) return { status: 'spent', outcome: 'unknown' };
    if (claim && (claim.state === 'sent-unknown' || claim.state === 'definitive-refusal'))
      return { status: 'spent', outcome: claim.state === 'sent-unknown' ? 'unknown' : 'definitive-refusal' };
    if (claim && claim.sourceIdentity !== sourceIdentity) return { status: 'retired' };
    if (claim && claim.mode !== mode && (!claim.settled || claim.record?.storage || pipeline !== null && pipeline === claim.record?.workToken))
      return { status: 'unavailable', reason: 'cancellation-ownership' };
    if (claim?.record?.storage && mode === 'bulk' && claim.record.bulkSignal !== signal)
      return { status: 'unavailable', reason: 'cancellation-ownership' };
    if (!claim && joinOnly) return { status: 'not-started' };
    let claims = homeboxSent.get(session);
    if (!claims) { claims = new Map(); homeboxSent.set(session, claims); }
    if (!claim) {
      const token = borrowPipeline(enclosingToken);
      if (!token) return resource('pipeline');
      let payload = 0, key = '', charged = false;
      let captured: readonly string[] = [];
      try {
        const { fields, payload: keyPayload } = claimKeyAdmission(view.scope, refInput);
        const bindingPayload = 4 * stringPayload(session.actorId) + 4 * stringPayload(session.expiresAt)
          + 8 * (stringPayload(view.scope.workspaceId) + stringPayload(view.scope.homeId));
        payload = 64 * KiB;
        if (keyPayload > 20 * KiB || bindingPayload > 4 * KiB || claimCount >= 256 || claimPayload + payload > 16 * 1024 * KiB)
          { if (!enclosingToken) releasePipeline(token); return resource('claims'); }
        if (residentBytes + B > 2 * B) { if (!enclosingToken) releasePipeline(token); return resource('resident-bytes'); }
        claimPayload += payload; claimCount++; residentBytes += B; charged = true;
        captured = fields; key = JSON.stringify(captured);
      } catch {
        if (charged) { claimPayload -= payload; claimCount--; residentBytes -= B; }
        if (!enclosingToken) releasePipeline(token); return resource('metadata');
      }
      const fresh: Claim = { state: 'reserved-unsent', ref: Object.freeze({ source: 'homebox-attachment', sourceInstanceId: captured[2]!,
        collectionId: captured[3]!, entityId: captured[4]!, attachmentId: captured[5]! }),
        scope: Object.freeze({ workspaceId: captured[0]!, homeId: captured[1]! }),
        payload, mode, sourceIdentity, controller: new AbortController(), waiters: new Set(), cancelled: false, settled: false, publicUnknown: false };
      claims.set(key, fresh); claim = fresh;
      const untrack = track(current, expiry, () => { fresh.controller.abort(); fresh.cancelled = true; if (fresh.record) retireFrame(fresh.record); });
      const interested = () => { for (const waiter of fresh.waiters) if (waiter.live()) return true; return false; };
      fresh.pending = Promise.resolve().then(async (): Promise<OfflineResult<FrameRecord>> => {
        let reserved = true;
        try {
          if (!interested()) return { status: 'retired' };
          if (prepare && !await prepare(fresh.controller.signal, fresh.ref)) return { status: 'unavailable' };
          const { readHomeboxOriginal } = await import('../src/offline/homebox-original-reader');
          if (fresh.controller.signal.aborted || !current() || !interested()) return { status: 'retired' };
          fresh.state = 'in-flight';
          const read = await readHomeboxOriginal({ scope: fresh.scope, ref: fresh.ref, signal: fresh.controller.signal,
            ...(options.homeboxTransport ? { transport: options.homeboxTransport } : {}) });
          if (read.status === 'unavailable' && !read.sent) fresh.state = 'reserved-unsent';
          else fresh.state = read.status === 'ok' ? 'sent-success' : read.status === 'unknown' ? 'sent-unknown' : 'definitive-refusal';
          if (read.status !== 'ok') return { status: read.status === 'unknown' ? 'uncertain' : read.status };
          let pinPayload = 0;
          for (const field in read.pin) { const value = read.pin[field as keyof OfflineHomeboxPinV1]; if (typeof value === 'string') pinPayload += stringPayload(value); }
          if (pinPayload > 40 * KiB) return resource('pin');
          const pin = Object.freeze({ ...read.pin });
          const root: FrameRecord = { frame: Object.freeze({}) as HomeboxOriginalFrame, reader: {}, ref: fresh.ref, pin,
            binding: Object.freeze({ session, view, actorId: session.actorId, scope: fresh.scope, actor: originalActor, current }),
            notify: quiet, stopTracking: untrack, blob: null, ui: false, storage: false, retired: false,
            claim: fresh, children: new Set<FrameRecord>(), borrowed: false, workToken: token, root: null as unknown as FrameRecord };
          root.root = root; fresh.record = root;
          if (fresh.cancelled || fresh.controller.signal.aborted || !current() || !interested()) return { status: 'retired' };
          root.blob = new Blob([read.bytes.slice(0)], { type: pin.contentType ?? 'application/octet-stream' });
          reserved = false; return { status: 'ok', value: root };
        } catch (error) {
          if ((error as { status?: string })?.status === 'resource') return resource('preparation');
          // Discovery's port may settle before its transport. No replacement work is admitted on doubt.
          quarantined = true;
          if (fresh.state === 'in-flight') fresh.state = 'sent-unknown';
          return { status: current() ? 'unavailable' : 'retired' };
        } finally {
          fresh.settled = true;
          if (fresh.state === 'reserved-unsent') { claims!.delete(key); claimCount--; claimPayload -= payload; }
          if (reserved) { residentBytes -= B; untrack(); }
          if (!enclosingToken) releasePipeline(token);
        }
      }).then(outcome => {
        fresh.outcome = outcome;
        for (const waiter of fresh.waiters) waiter.wake();
        return outcome;
      });
    }
    const selected = claim;
    if (selected.waiters.size + (selected.record?.children.size ?? 0) + Number(selected.record?.storage ?? false) >= 8
      || interestCount >= 32) return resource('interests');
    // Underlying work notifies this bounded set once. A cancelled waiter leaves no callback
    // attached to the still-pending shared promise, so repeated cancellation cannot grow a hidden queue.
    let wake!: (held?: OfflineResult<null>) => void, rehydrated: OfflineResult<null> | undefined;
    const changed = new Promise<void>(resolve => { wake = held => { rehydrated = held; resolve(); }; });
    const waiter = { live: liveInterest, wake }; selected.waiters.add(waiter); interestCount++;
    let transferred = false;
    const abort = () => {
      selected.waiters.delete(waiter);
      if (!selected.waiters.size && !selected.settled) {
        selected.cancelled = true;
        if (selected.state !== 'reserved-unsent') selected.publicUnknown = true;
        selected.controller.abort();
      }
      if (!selected.waiters.size && selected.rehydration) { selected.rehydrationAborting = true; selected.rehydrationController?.abort(); }
      wake();
    };
    signal.addEventListener('abort', abort, { once: true }); if (signal.aborted) abort();
    try {
      if (!selected.outcome) await changed;
      if (!liveInterest()) return { status: signal.aborted ? 'aborted' : 'retired' };
      const outcome = selected.outcome!;
      if (outcome.status !== 'ok') return outcome.status === 'uncertain' ? { status: 'unknown' } : outcome;
      const root = outcome.value;
      if (!frameCurrent(root)) return { status: 'retired' };
      let backing: 'memory' | 'exact-held' = 'memory';
      if (!root.blob) {
        if (!selected.rehydration) {
          const token = borrowPipeline(enclosingToken);
          if (!token) return resource('pipeline');
          if (residentBytes + B > 2 * B) { if (!enclosingToken) releasePipeline(token); return resource('resident-bytes'); }
          residentBytes += B; const controller = new AbortController(); selected.rehydrationController = controller;
          let restored: OfflineResult<null> = { status: 'unavailable' };
          selected.rehydration = (async (): Promise<OfflineResult<Blob>> => {
            let installed = false;
            try {
              const home = owner.bindHome(root.binding.actor, root.binding.scope, root.binding.current);
              if (home.status !== 'ok') return home;
              const held = await owner.readHomeboxObservation(home.value, root.pin, controller.signal);
              if (held.status === 'uncertain') quarantined = true;
              if (held.status !== 'ok') return held;
              if (controller.signal.aborted || !frameCurrent(root)) return { status: 'retired' };
              root.blob = held.value; installed = true;
              root.stopTracking = track(root.binding.current, expiry, () => retireFrame(root));
              return held;
            } finally {
              if (!installed) residentBytes -= B;
              if (!enclosingToken) releasePipeline(token);
            }
          })().catch((): OfflineResult<Blob> => ({ status: 'unavailable' })).then(outcome => {
            // The terminal receipt must not become an idle second reference to the restored Blob.
            restored = outcome.status === 'ok' ? { status: 'ok', value: null } : outcome;
            return outcome;
          }).finally(() => {
            delete selected.rehydration; delete selected.rehydrationController;
            selected.rehydrationAborting = false; cleanupFrame(root);
            for (const waiter of selected.waiters) waiter.wake(restored);
          });
        }
        await changed;
        if (!liveInterest()) return { status: signal.aborted ? 'aborted' : 'retired' };
        const held = rehydrated!;
        if (held.status !== 'ok') {
          if (held.status === 'integrity' || held.status === 'retired') { retireFrame(root); return held; }
          return { status: 'unavailable', reason: held.status === 'missing' ? 'held-missing' : 'local-storage' };
        }
        if (!liveInterest() || !frameCurrent(root)) return { status: signal.aborted ? 'aborted' : 'retired' };
        backing = 'exact-held';
      }
      selected.waiters.delete(waiter); interestCount--; transferred = true;
      const result = borrow(root, reader, notify);
      return result.status === 'ok' ? { ...result, backing } : result;
    } finally {
      signal.removeEventListener('abort', abort); selected.waiters.delete(waiter); if (!transferred) interestCount--;
      if (selected.record) cleanupFrame(selected.record);
    }
  }
  function retainHomeboxFrame(input: FrameRecord, mode: Mode = 'explicit', enclosingToken?: PipelineLease,
    interestCurrent: () => boolean = () => true, bulkSignal?: AbortSignal): OfflineResult<HomeboxRetentionAttempt> {
    const record = input.root;
    if (record.storage && record.claim.mode !== mode) return { status: 'unavailable' };
    if (record.storage && mode === 'bulk' && record.bulkSignal !== bulkSignal) return { status: 'unavailable' };
    if (record.attempt) return { status: 'ok', value: record.attempt };
    if (interestCount >= 32 || record.children.size + record.claim.waiters.size >= 8) return resource('storage-interest');
    const token = borrowPipeline(enclosingToken);
    if (!token) return resource('pipeline');
    const controller = new AbortController(); record.storageController = controller; record.storage = true;
    record.claim.mode = mode; record.workToken = token;
    if (bulkSignal) record.bulkSignal = bulkSignal; else delete record.bulkSignal;
    interestCount++;
    const current = () => record.storage && !controller.signal.aborted && record.blob !== null && frameCurrent(record)
      && (mode === 'explicit' || safeCurrent(interestCurrent));
    const work = async (): Promise<OfflineResult<Readonly<OfflineHomeboxPinV1>>> => {
      try {
        const blob = record.blob;
        if (!blob || !current()) return { status: 'retired' };
        const bytes = await blob.arrayBuffer();
        if (!current() || record.blob !== blob) return { status: 'retired' };
        const home = owner.bindHome(record.binding.actor, record.binding.scope, current);
        if (home.status !== 'ok') return home;
        const stored = await owner.keepHomeboxDocument(home.value, record.pin, bytes, controller.signal);
        return stored.status === 'ok' ? { status: 'ok', value: record.pin } : stored;
      } catch { return { status: current() ? 'unavailable' : 'retired' }; }
    };
    // The operation owns its signal, not the UI. The existing storage deadline is not increased.
    let timer: ReturnType<typeof setTimeout> | undefined, timedOut = false;
    const deadline = new Promise<OfflineResult<Readonly<OfflineHomeboxPinV1>>>(resolve => {
      timer = setTimeout(() => { timedOut = true; quarantined = true; resolve({ status: 'uncertain' }); controller.abort(); }, 10_000);
    });
    const underlying = work().then(outcome => {
      // A backend unknown can precede native settlement: never reuse its reservation on that evidence.
      if (outcome.status === 'uncertain') quarantined = true;
      if (outcome.status !== 'uncertain') {
        // A late conclusive owner return proves this work settled, but never changes the public result.
        if (timedOut && pipeline === token) quarantined = false;
        record.storage = false; interestCount--; cleanupFrame(record);
        if (!enclosingToken || token.released) releasePipeline(token);
      }
      return outcome;
    });
    const result = Promise.race([underlying, deadline]).then(outcome => {
      if (outcome.status === 'integrity' || !frameCurrent(record)) retireFrame(record);
      return outcome;
    }).finally(() => { if (timer !== undefined) clearTimeout(timer); });
    const attempt: HomeboxRetentionAttempt = Object.freeze({ result,
      async reconcile(signal: AbortSignal): Promise<HomeboxRetentionReconciliation> {
        const current = () => !signal.aborted && frameCurrent(record);
        const fail = (): HomeboxRetentionReconciliation => ({ status: signal.aborted ? 'aborted' : 'retired' });
        if (!current()) return fail();
        try {
          const readToken = takePipeline(); if (!readToken) return { status: 'unavailable' };
          try {
            const home = owner.bindHome(record.binding.actor, record.binding.scope, current);
            if (home.status !== 'ok') return { status: home.status === 'integrity' ? 'integrity' : 'retired' };
            const bytes = await owner.readHomeboxObservation(home.value, record.pin, signal); if (!current()) return fail();
            if (bytes.status === 'uncertain') quarantined = true;
            if (bytes.status === 'integrity' || bytes.status === 'retired') { retireFrame(record); return { status: bytes.status }; }
            return bytes.status === 'ok' ? { status: 'held', pin: record.pin }
              : bytes.status === 'missing' ? { status: 'unresolved' } : { status: 'unavailable' };
          } finally { releasePipeline(readToken); }
        } catch { return current() ? { status: 'unavailable' } : fail(); }
      },
    });
    record.attempt = attempt; return { status: 'ok', value: attempt };
  }
  function createHomeboxOriginalReader(view: ReadyView, source: HomeboxOriginalSource): OfflineResult<HomeboxOriginalReader> {
    if (readerCount >= 8) return resource('readers');
    if (view.scope.workspaceId.length !== 36 || view.scope.homeId.length !== 36) return { status: 'invalid' };
    const scopePayload = stringPayload(view.scope.workspaceId) + stringPayload(view.scope.homeId);
    if (claimPayload + scopePayload > 16 * 1024 * KiB) return resource('metadata');
    const b = witness(), identity = source.getBindingIdentity();
    if (b.status !== 'ok' || options.state().view !== view || !identity) return { status: 'retired' };
    const bound = source.getBindingScope(identity);
    if (!bound || bound.workspaceId !== view.scope.workspaceId || bound.homeId !== view.scope.homeId) return { status: 'retired' };
    readerCount++; claimPayload += scopePayload;
    const scope = Object.freeze({ workspaceId: view.scope.workspaceId, homeId: view.scope.homeId });
    const bindingCurrent = b.value.current;
    const token = {}, listeners = new Set<() => void>(), borrows = new Set<HomeboxOriginalFrame>(), pending = new Set<AbortController>();
    let disposed = false, retired = false;
    const current = () => {
      const latest = source.getBindingScope(identity);
      return !retired && bindingCurrent() && source.getBindingIdentity() === identity
        && latest?.workspaceId === scope.workspaceId && latest.homeId === scope.homeId;
    };
    const notify = () => { for (const cb of [...listeners]) { try { cb(); } catch { /* notification is not authority */ } } };
    const untrack = track(current, Date.parse(options.state().session!.expiresAt), () => {
      retired = true; for (const request of pending) request.abort();
      for (const frame of borrows) { const record = frames.get(frame); if (record) retireFrame(record); } notify();
    });
    const release = (frame: HomeboxOriginalFrame) => {
      const record = frames.get(frame); if (!record || record.reader !== token) return;
      record.ui = false; borrows.delete(frame); cleanupFrame(record);
    };
    const admitted = (frame: HomeboxOriginalFrame) => {
      const record = frames.get(frame);
      return !disposed && record?.reader === token && record.ui && frameCurrent(record) ? record : null;
    };
    const read = async (refInput: OfflineHomeboxAttachmentRefV1, signal: AbortSignal, joinOnly: boolean): Promise<HomeboxOriginalJoinResult> => {
        if (disposed || !current()) return { status: 'retired' };
        if (!validHomeboxRef(refInput)) return { status: 'invalid' };
        if (pending.size + borrows.size >= 4 || interestCount >= 32) return resource('reader-interests');
        let visited = 0, attachments = 0;
        if (view.entries.length > 2056) return resource('view-entries');
        for (const entry of view.entries) {
          if (++visited > 2056) return resource('view-entries');
          for (const attachment of entry.attachments) {
            if (++attachments > 2056) return resource('view-attachments');
            if (entry.source.sourceKind !== 'homebox-entity' || entry.source.sourceInstanceId !== refInput.sourceInstanceId
              || entry.source.collectionId !== refInput.collectionId || entry.source.externalId !== refInput.entityId
              || attachment.kind !== 'stored-file' || attachment.attachmentId !== refInput.attachmentId || attachment.byteSize === null) continue;
            if (attachment.byteSize.length > LIVE_COPY_LIMITS.viewBytes) return resource('size-hint');
            if (/^[0-9]+$/.test(attachment.byteSize)) {
              let start = 0; while (start < attachment.byteSize.length && attachment.byteSize.charCodeAt(start) === 48) start++;
              if (attachment.byteSize.length - start > 8 || Number(attachment.byteSize.slice(start)) > B) return { status: 'limit' };
            }
          }
        }
        if (!listsAttachment(view, refInput)) return { status: 'missing' };
        const request = new AbortController(), cancel = () => request.abort();
        pending.add(request); signal.addEventListener('abort', cancel, { once: true });
        if (signal.aborted) request.abort();
        try {
          const prepare = async (workSignal: AbortSignal, captured: Readonly<OfflineHomeboxAttachmentRefV1>) => {
            const discovery = await source.discover(identity, workSignal);
            admitJson(discovery, 65536);
            return current() && !workSignal.aborted && discovery.scope.workspaceId === scope.workspaceId && discovery.scope.homeId === scope.homeId
              && discovery.installedSources.length <= 64 && discovery.installedSources.some(row => row.workspaceId === scope.workspaceId && row.homeId === scope.homeId
                && row.key.sourceKind === 'homebox-entity' && row.key.sourceInstanceId === captured.sourceInstanceId
                && row.key.collectionId === captured.collectionId && row.key.externalId === captured.entityId);
          };
          const opened = await acquireHomebox(refInput, request.signal, token, current, notify, 'explicit', prepare, joinOnly, undefined, () => true, identity);
          if (opened.status === 'ok') {
            if (disposed || !current() || request.signal.aborted) { release(opened.frame); return { status: 'retired' }; }
            borrows.add(opened.frame);
          }
          return opened;
        } catch { return { status: !current() || disposed ? 'retired' : signal.aborted ? 'aborted' : 'unavailable' }; }
        finally { signal.removeEventListener('abort', cancel); pending.delete(request); }
    };
    return { status: 'ok', value: {
      scope,
      async open(refInput, signal) { const result = await read(refInput, signal, false); return result.status === 'not-started' ? { status: 'unavailable' } : result; },
      join(refInput, signal) { return read(refInput, signal, true); },
      isCurrent: frame => admitted(frame) !== null,
      getBlob: frame => admitted(frame)?.root.blob ?? null,
      subscribe(changed) {
        if (disposed) return () => {};
        if (listeners.size && !listeners.has(changed)) throw Object.assign(new Error('HomeBox subscriber capacity'), { status: 'resource', resource: 'subscribers' });
        listeners.add(changed); return () => { listeners.delete(changed); };
      },
      retain(frame) {
        const record = admitted(frame); return record ? retainHomeboxFrame(record) : { status: 'retired' };
      },
      release,
      dispose() { if (disposed) return; disposed = true; readerCount--; claimPayload -= scopePayload; untrack(); for (const request of pending) request.abort();
        for (const frame of [...borrows]) release(frame); listeners.clear(); },
    } };
  }
  async function bulkOriginal(ref: OfflineHomeboxAttachmentRefV1, signal: AbortSignal,
    genuineCurrent: () => boolean, enclosingToken?: PipelineLease, bulkCurrent: () => boolean = () => !signal.aborted,
    sourceIdentity?: object): Promise<OfflineResult<OfflineHomeboxPinV1>> {
    const opened = await acquireHomebox(ref, signal, {}, genuineCurrent, quiet, 'bulk', undefined, false, enclosingToken, bulkCurrent, sourceIdentity);
    if (opened.status !== 'ok') return remember({ status: opened.status === 'unknown' || opened.status === 'busy'
      || opened.status === 'spent' || opened.status === 'settling' ? 'uncertain'
      : opened.status === 'not-started' ? 'unavailable' : opened.status });
    const record = frames.get(opened.frame)!;
    const cancel = () => record.root.storageController?.abort();
    try {
      const retained = retainHomeboxFrame(record, 'bulk', enclosingToken, bulkCurrent, signal);
      if (retained.status !== 'ok') return remember(retained);
      signal.addEventListener('abort', cancel, { once: true }); if (signal.aborted) cancel();
      record.ui = false; cleanupFrame(record);
      return remember(await retained.value.result);
    } finally { signal.removeEventListener('abort', cancel); record.ui = false; cleanupFrame(record); }
  }
  async function withHomeboxFillPass(view: ReadyView, source: HomeboxOriginalSource, signal: AbortSignal,
    sourceCurrent: () => boolean, enabled: () => boolean,
    work: (pass: HomeboxFillPass) => Promise<HomeboxFillOutcome>): Promise<OfflineResult<HomeboxFillOutcome> & { readonly reason?: 'source-unavailable' }> {
    if (interestCount >= 32) return resource('interests');
    const b = witness(), identity = source.getBindingIdentity();
    const originalActor = b.status === 'ok' ? b.value.actor : null;
    if (b.status !== 'ok' || !originalActor || options.state().view !== view || !identity) return { status: 'retired' };
    const token = takePipeline(); if (!token) return resource('pipeline'); interestCount++;
    const genuine = () => b.value.current() && safeCurrent(sourceCurrent) && options.state().view === view
      && source.getBindingIdentity() === identity && source.getBindingScope(identity)?.workspaceId === view.scope.workspaceId
      && source.getBindingScope(identity)?.homeId === view.scope.homeId;
    let active = true, operating = false, charged = true;
    const releasePass = () => { if (charged) { charged = false; interestCount--; } releasePipeline(token); };
    const live = () => active && !signal.aborted && genuine() && safeCurrent(enabled);
    let discovery: Awaited<ReturnType<HomeboxOriginalSource['discover']>> | null = null;
    let preparingSource = true;
    try {
      if (!live()) return { status: signal.aborted ? 'aborted' : 'retired' };
      let entries = 0, attachments = 0, eligible = false, withoutSize = 0;
      for (const entry of view.entries) {
        if (++entries > 2056) return resource('view-entries');
        for (const attachment of entry.attachments) {
          if (++attachments > 2056) return resource('view-attachments');
          if (attachment.kind === 'stored-file' && attachment.byteSize !== null && attachment.byteSize.length > LIVE_COPY_LIMITS.viewBytes) return resource('size-hint');
          if (attachment.kind === 'stored-file' && entry.source.sourceKind === 'homebox-entity') {
            const bytes = attachment.byteSize !== null && /^[1-9][0-9]{0,8}$/.test(attachment.byteSize) ? Number(attachment.byteSize) : null;
            if (bytes !== null && bytes <= B) eligible = true; else withoutSize++;
          }
        }
      }
      if (!eligible) return { status: 'ok', value: { message: `No HomeBox files to keep${withoutSize ? `; ${withoutSize} without a usable size stay online-only` : ''}.`, complete: withoutSize === 0 } };
      discovery = await source.discover(identity, signal);
      admitJson(discovery, 65536);
      if (!live() || discovery.scope.workspaceId !== view.scope.workspaceId || discovery.scope.homeId !== view.scope.homeId) return { status: 'retired' };
      if (discovery.installedSources.length > 64) return resource('discovery');
      preparingSource = false;
      const home = owner.bindHome(originalActor, view.scope, genuine); if (home.status !== 'ok') return home;
      const summary = await owner.homeboxFillSummary(home.value, signal);
      if (summary.status !== 'ok') { if (summary.status === 'uncertain') quarantined = true; return summary; }
      if (!live()) return { status: signal.aborted ? 'aborted' : 'retired' };
      const installed = (ref: OfflineHomeboxAttachmentRefV1) => discovery?.installedSources.some(row => row.workspaceId === view.scope.workspaceId
        && row.homeId === view.scope.homeId && row.key.sourceKind === 'homebox-entity' && row.key.sourceInstanceId === ref.sourceInstanceId
        && row.key.collectionId === ref.collectionId && row.key.externalId === ref.entityId) === true;
      return { status: 'ok', value: await work({
        otherBytes: summary.value.nativeBytes + summary.value.electricalBytes, budgetBytes: summary.value.budgetBytes,
        current: live, installed,
        async status(ref) {
          if (!live()) return { status: signal.aborted ? 'aborted' : 'retired' };
          if (operating || quarantined) return resource('pipeline');
          // Apply the same exact escaped-key/ref allowance before the owner's status key is built.
          try { if (claimKeyAdmission(view.scope, ref).payload > 20 * KiB) return resource('metadata'); }
          catch { return resource('metadata'); }
          operating = true;
          try {
            const result = await owner.homeboxObservationStatus(home.value, ref, signal);
            if (result.status === 'uncertain') quarantined = true;
            return live() ? result : { status: signal.aborted ? 'aborted' : 'retired' };
          } finally { operating = false; if (!active) releasePass(); }
        },
        async retain(ref) {
          if (!live() || !installed(ref)) return { status: 'retired' };
          if (operating || quarantined) return resource('pipeline');
          operating = true;
          try { return await bulkOriginal(ref, signal, genuine, token, live, identity); }
          finally { operating = false; if (!active) releasePass(); }
        },
      }) };
    } catch (error) {
      if ((error as { status?: string })?.status === 'resource') return resource('preparation');
      quarantined = true;
      if (signal.aborted) return { status: 'aborted' };
      if (!genuine()) return { status: 'retired' };
      return { status: 'unavailable', ...(preparingSource ? { reason: 'source-unavailable' as const } : {}) };
    } finally { active = false; discovery = null; if (!operating) releasePass(); }
  }
  const metadata = (row: SourceDocument): OfflineCatalogItemV1 => ({
    documentId: row.documentId, documentRevision: row.revision, title: row.title, lifecycle: row.lifecycle,
    assetId: row.original.assetId, assetRevision: row.original.revision, sha256: row.original.sha256,
    bytes: row.original.bytes, recordedAvailability: row.availability.original,
  });
  /** Explicit authorized enumeration; no partial catalog is constructed from a single open. */
  async function retainCatalog(signal: AbortSignal, additionalCurrent: () => boolean = () => true): Promise<OfflineResult<OfflineCatalogV1>> {
    const b = binding(); if (b.status !== 'ok') return remember(b);
    const retired = () => signal.aborted || !b.value.current() || !additionalCurrent();
    let reader: Awaited<ReturnType<SourceDocumentsPort['createReader']>> | null = null;
    try {
      reader = await options.documents().createReader();
      if (retired()) return remember({ status: signal.aborted ? 'aborted' : 'retired' });
      const identity = reader.owner(); if (!identity) return remember({ status: 'retired' });
      const rows: OfflineCatalogItemV1[] = [], cursors = new Set<string>();
      let cursor: string | null = null;
      do {
        const page = await reader.list(cursor, signal);
        if (retired() || reader.owner() !== identity) return remember({ status: signal.aborted ? 'aborted' : 'retired' });
        rows.push(...page.documents.map(metadata));
        if (rows.length > LIVE_COPY_LIMITS.documents) return remember({ status: 'limit' });
        cursor = page.nextCursor;
        if (cursor !== null) { if (cursors.has(cursor)) return remember({ status: 'integrity' }); cursors.add(cursor); }
      } while (cursor !== null);
      const catalog: OfflineCatalogV1 = { version: 1, capturedAt: new Date().toISOString(), completeness: 'captured-complete', documents: rows };
      if (!actor || retired()) return remember({ status: signal.aborted ? 'aborted' : 'retired' });
      const live = owner.bindHome(actor, options.state().view!.scope, () => !retired() && reader!.owner() === identity);
      if (live.status !== 'ok') return remember(live);
      const result = await owner.keepCatalog(live.value, catalog, signal);
      return remember(result.status === 'ok' ? { status: 'ok', value: catalog } : result);
    } catch { return remember({ status: signal.aborted ? 'aborted' : retired() ? 'retired' : 'unavailable' }); }
    finally { reader?.dispose(); }
  }
  return {
    read: { homeboxStatus: owner.homeboxStatus, readHomeboxDocument: owner.readHomeboxDocument, readElectricalCatalog: owner.readElectricalCatalog, electricalStatus: owner.electricalStatus, readElectricalDocument: owner.readElectricalDocument, readLast: owner.readLast, readCatalog: owner.readCatalog, readDocument: owner.readDocument, documentStatus: owner.documentStatus,
      async atlasReference(handle, signal) {
        const identity = await owner.copyIdentity(handle, signal); if (identity.status !== 'ok') return identity;
        try {
          const resolve: NonNullable<typeof options.atlasReference> = options.atlasReference ?? (async (selected, requestSignal) => {
            const module = await import('./unified-atlas-cache');
            requestSignal.throwIfAborted();
            const store = module.openUnifiedAtlasStore(options.factory);
            try {
              await store.ready(); requestSignal.throwIfAborted();
              const last = await module.readLastAtlas(store); requestSignal.throwIfAborted();
              const p = last?.pointer;
              if (!p || p.actorId !== selected.actorId || p.workspaceId !== selected.scope.workspaceId || p.homeId !== selected.scope.homeId) return null;
              return { version: 1 as const, scope: { workspaceId: p.workspaceId, homeId: p.homeId },
                publicationId: p.publicationId, manifestSha256: p.manifestSha256, atlasActorRevision: p.actorRevision };
            } finally { await store.close(); }
          });
          const reference = await resolve(identity.value, signal);
          const latest = await owner.copyIdentity(handle, signal); if (latest.status !== 'ok') return latest;
          if (reference && (reference.version !== 1 || reference.scope.workspaceId !== identity.value.scope.workspaceId
            || reference.scope.homeId !== identity.value.scope.homeId || typeof reference.publicationId !== 'string'
            || !reference.publicationId || reference.publicationId.length > 1024 || !/^[a-f0-9]{64}$/.test(reference.manifestSha256)
            || !reference.atlasActorRevision || reference.atlasActorRevision.length > 1024)) return { status: 'integrity' } as const;
          if (identity.value.actorRevision !== latest.value.actorRevision) return { status: 'retired' } as const;
          return { status: 'ok', value: reference } as const;
        } catch { return { status: signal.aborted ? 'aborted' : 'unavailable' } as const; }
      }, subscribe(changed: () => void) {
      outcomeListeners.add(changed); const unsubscribe = owner.subscribe(changed);
      return () => { outcomeListeners.delete(changed); unsubscribe(); };
    } } satisfies OfflineReadPort,
    storage: { status: owner.status, requestPersistence: owner.requestPersistence, clear: async () => {
      generation++; actor = null; observed = null; refreshHomeboxOriginals(); return remember(await owner.clear());
    } },
    observe,
    lastResult: () => lastResult,
    /** Synchronous retirement on sign-out/host replacement, even before lazy deletion. */
    retire() { generation++; actor = null; observed = null; refreshHomeboxOriginals(); owner.invalidate(); },
    createHomeboxOriginalReader,
    refreshHomeboxOriginals,
    async capture(view: ReadyView, signal: AbortSignal) {
      const b = binding(); if (b.status !== 'ok') return remember(b);
      if (options.state().view !== view) return remember({ status: 'retired' } as const);
      return remember(await owner.keepView(b.value.home, view, signal));
    },
    retainCatalog(signal: AbortSignal) { return retainCatalog(signal); },
    /** Pins come from a fresh exact native read and its still-current leased byte frame, never a title or cached URL. */
    async retainDocument(documentId: string, revision: number, signal: AbortSignal): Promise<OfflineResult<OfflineDocumentPinV1>> {
      const b = binding(); if (b.status !== 'ok') return remember(b);
      let reader: Awaited<ReturnType<SourceDocumentsPort['createReader']>> | null = null;
      let frame: SourceDocumentFrame | null = null;
      try {
        reader = await options.documents().createReader(); if (!b.value.current() || signal.aborted) return remember({ status: signal.aborted ? 'aborted' : 'retired' });
        const row = await reader.get(documentId, signal);
        if (!b.value.current() || row.documentId !== documentId || row.revision !== revision
          || row.lifecycle !== 'active' || row.availability.original !== 'available') return remember({ status: 'retired' });
        frame = await reader.openOriginal(documentId, revision, signal);
        const current = () => b.value.current() && !signal.aborted && reader!.isCurrent(frame!);
        if (!current()) return remember({ status: signal.aborted ? 'aborted' : 'retired' });
        if (frame.documentId !== documentId || frame.documentRevision !== revision || frame.mode !== 'original'
          || frame.asset.assetId !== row.original.assetId || frame.asset.revision !== row.original.revision
          || frame.asset.sha256 !== row.original.sha256 || frame.asset.bytes !== row.original.bytes) return remember({ status: 'integrity' });
        const blob = reader.getBlob(frame); if (!blob) return remember({ status: 'retired' });
        const bytes = await blob.arrayBuffer(); if (!current()) return remember({ status: signal.aborted ? 'aborted' : 'retired' });
        const pin: OfflineDocumentPinV1 = { documentId, documentRevision: revision, assetId: frame.asset.assetId,
          assetRevision: frame.asset.revision, sha256: frame.asset.sha256, bytes: frame.asset.bytes, contentType: frame.measuredContentType };
        // Capture the lease's currentness in a second home handle through final transaction completion.
        if (!actor) return remember({ status: 'retired' });
        const live = owner.bindHome(actor, row.scope, current); if (live.status !== 'ok') return remember(live);
        const result = await owner.keepDocument(live.value, pin, bytes, signal);
        return remember(result.status === 'ok' ? { status: 'ok', value: pin } : result);
      } catch { return remember({ status: signal.aborted ? 'aborted' : b.value.current() ? 'unavailable' : 'retired' }); }
      finally { if (frame) reader?.release(frame); reader?.dispose(); }
    },
    /** Borrows an already verified original; the caller alone owns its reader and lease. */
    async retainDocumentFrame(reader: SourceDocumentReader, frame: SourceDocumentFrame, document: SourceDocument,
      signal: AbortSignal): Promise<OfflineResult<OfflineDocumentPinV1>> {
      const b = binding(); if (b.status !== 'ok') return remember(b);
      const identity = reader.owner(), scope = options.state().view!.scope;
      const current = () => b.value.current() && !signal.aborted && identity !== null
        && reader.owner() === identity && reader.isCurrent(frame);
      const retired = (): OfflineResult<never> => ({ status: signal.aborted ? 'aborted' : 'retired' });
      try {
        if (!current()) return remember(retired());
        if (document.scope.workspaceId !== scope.workspaceId || document.scope.homeId !== scope.homeId
          || document.lifecycle !== 'active' || document.availability.original !== 'available'
          || frame.mode !== 'original' || frame.documentId !== document.documentId || frame.documentRevision !== document.revision
          || frame.asset.assetId !== document.original.assetId || frame.asset.revision !== document.original.revision
          || frame.asset.sha256 !== document.original.sha256 || frame.asset.bytes !== document.original.bytes)
          return remember({ status: 'integrity' });
        const blob = reader.getBlob(frame);
        if (!blob || !current()) return remember(retired());
        if (blob.size !== frame.asset.bytes || blob.type !== frame.measuredContentType) return remember({ status: 'integrity' });
        const pin: OfflineDocumentPinV1 = { documentId: document.documentId, documentRevision: document.revision,
          assetId: frame.asset.assetId, assetRevision: frame.asset.revision, sha256: frame.asset.sha256,
          bytes: frame.asset.bytes, contentType: frame.measuredContentType };
        const matches = (catalog: OfflineCatalogV1) => catalog.completeness === 'captured-complete'
          && catalog.documents.some(row => { const expected = metadata(document);
            return Object.keys(expected).every(key => row[key as keyof OfflineCatalogItemV1] === expected[key as keyof OfflineCatalogItemV1]); });
        let catalog: OfflineCatalogV1 | null = null;
        const copy = await owner.readLast(signal); if (!current()) return remember(retired());
        if (copy.status === 'ok') {
          const selected = await owner.copyIdentity(copy.value.handle, signal); if (!current()) return remember(retired());
          if (selected.status !== 'ok') return remember(selected);
          if (selected.value.actorId === options.state().session!.actorId && selected.value.scope.workspaceId === scope.workspaceId
            && selected.value.scope.homeId === scope.homeId) {
            const stored = await owner.readCatalog(copy.value.handle, signal); if (!current()) return remember(retired());
            if (stored.status === 'ok') catalog = stored.value;
            else if (stored.status !== 'missing') return remember(stored);
          }
        } else if (copy.status !== 'missing') return remember(copy);
        if (!catalog || !matches(catalog)) {
          const fresh = await retainCatalog(signal, current); if (!current()) return remember(retired());
          if (fresh.status !== 'ok') return remember(fresh);
          if (!matches(fresh.value)) return remember({ status: 'integrity' });
        }
        if (!current() || reader.getBlob(frame) !== blob) return remember(retired());
        const bytes = await blob.arrayBuffer();
        if (!current() || reader.getBlob(frame) !== blob || !actor) return remember(retired());
        const live = owner.bindHome(actor, document.scope, current); if (live.status !== 'ok') return remember(live);
        const result = await owner.keepDocument(live.value, pin, bytes, signal);
        return remember(result.status === 'ok' ? { status: 'ok', value: pin } : result);
      } catch { return remember(signal.aborted || !current() ? retired() : { status: 'unavailable' }); }
    },
    /** True when this session allocation already sent a read for the exact association. */
    homeboxSent(ref: OfflineHomeboxAttachmentRefV1): boolean {
      const { session, view } = options.state();
      return !!session && !!view && !!findClaim(session, view.scope, ref);
    },
    withHomeboxFillPass,
    /** One borrowed HomeBox original for an exact stored-file association in the current live view.
     * The reader module loads lazily; unknown transport outcomes report 'uncertain' and are never replayed. */
    async retainHomeboxOriginal(ref: OfflineHomeboxAttachmentRefV1, signal: AbortSignal,
      additionalCurrent: () => boolean = () => true): Promise<OfflineResult<OfflineHomeboxPinV1>> {
      return bulkOriginal(ref, signal, additionalCurrent);
    },
    /** Confirmed absence retires only this building's local catalog membership.
     * Empty provenance grants no source access; original bytes remain subject to
     * catalog membership and the existing actor/home/transaction witnesses. */
    async retireElectricalLibrary(buildingId: string, signal: AbortSignal, current: () => boolean): Promise<OfflineResult<{ evicted: number }>> {
      const b = binding(); if (b.status !== 'ok') return remember(b);
      const live = () => !signal.aborted && b.value.current() && current();
      try {
        if (!live() || !actor) return remember({ status: signal.aborted ? 'aborted' : 'retired' });
        const home = owner.bindHome(actor, options.state().view!.scope, live);
        if (home.status !== 'ok') return remember(home);
        return remember(await owner.keepElectricalCatalog(home.value, {
          buildingId, capturedAt: new Date().toISOString(), provenance: null, documents: [],
        }, signal));
      } catch { return remember({ status: signal.aborted ? 'aborted' : 'unavailable' }); }
    },
    /** Captures one genuinely read building. The caller retains ownership of its reader/frame. */
    async retainElectricalLibrary(reader: ElectricalLibraryReader, frame: ElectricalLibraryFrame, signal: AbortSignal,
      retention: { readonly includeBytes?: boolean; readonly evidenceId?: string; readonly enabled?: () => boolean } = {}): Promise<OfflineResult<{ held: number; unavailable: number; bytes: number }>> {
      const b = binding(); if (b.status !== 'ok') return remember(b);
      const identity = reader.owner();
      const current = () => b.value.current() && reader.owner() === identity && identity !== null && reader.isCurrent(frame);
      const retired = (): OfflineResult<never> => ({ status: signal.aborted ? 'aborted' : 'retired' });
      let client: ReturnType<ElectricalLibraryReader['createDrawingClient']> | null = null;
      let opened: NativeEvidenceDocumentFrame | null = null;
      try {
        if (!current() || signal.aborted || !actor) return remember(retired());
        const scope = options.state().view!.scope;
        if (frame.scope.workspaceId !== scope.workspaceId || frame.scope.homeId !== scope.homeId) return remember({ status: 'integrity' });
        const live = owner.bindHome(actor, frame.scope, current); if (live.status !== 'ok') return remember(live);
        const documents = frame.documents.map(document => {
          const pin: OfflineElectricalPinV1 = { source: 'electrical-evidence', buildingId: frame.buildingId,
            evidenceId: document.evidenceId, evidenceRevision: document.evidenceRevision, assetId: document.assetId,
            assetRevision: document.assetRevision.token, byteSize: document.byteSize.token, sha256: document.sha256, contentType: 'application/pdf' };
          if (!validElectricalPin(pin)) throw new Error('Invalid electrical original pins');
          const pages = document.pages.map(page => {
            const reference = page.reference;
            if (reference.workspaceId !== frame.scope.workspaceId || reference.homeId !== frame.scope.homeId
              || reference.buildingId !== frame.buildingId || reference.evidenceId !== pin.evidenceId
              || reference.evidenceRevision !== pin.evidenceRevision || reference.assetId !== pin.assetId
              || reference.assetRevision.token !== pin.assetRevision || reference.byteSize.token !== pin.byteSize
              || reference.assetSha256 !== pin.sha256 || reference.sheetId !== page.sheet.id || reference.pdfPage !== page.sheet.pdfPage
              || reference.originalPhotoSha256 !== page.sheet.originalPhotoSha256 || reference.renderedPhotoSha256 !== page.sheet.renderedPhotoSha256)
              throw new Error('Electrical page correlation differs');
            return { sheetId: page.sheet.id, title: page.sheet.title, pdfPage: page.sheet.pdfPage, sourceDate: page.sheet.sourceDate,
              correlationId: reference.correlationId, correlationSha256: reference.correlationSha256,
              originalPhotoSha256: reference.originalPhotoSha256, renderedPhotoSha256: reference.renderedPhotoSha256 };
          });
          return { pin, pages };
        });
        const p = frame.provenance;
        const building: OfflineElectricalBuildingV1 = { buildingId: frame.buildingId, capturedAt: new Date().toISOString(), documents,
          provenance: p ? { historicalRoomMappingReceipt: { id: p.historicalRoomMappingReceipt.id, sha256: p.historicalRoomMappingReceipt.sha256 },
            fixtureLedgerSha256: p.fixtureLedgerSha256, supportOriginalSha256: p.supportOriginalSha256,
            currentNativeRoomReview: { id: p.currentNativeRoomReview.id, sha256: p.currentNativeRoomReview.sha256 } } : null };
        const catalogResult = await owner.keepElectricalCatalog(live.value, building, signal);
        if (catalogResult.status !== 'ok') return remember(catalogResult);
        const bytes = documents.reduce((sum, row) => sum + electricalPinBytes(row.pin), 0);
        let held = 0, unavailable = 0;
        const summary = () => ({ status: 'ok' as const, value: { held, unavailable, bytes } });
        if (retention.includeBytes === false || retention.enabled?.() === false) return remember(summary());
        const copy = await owner.readLast(signal); if (copy.status !== 'ok') return remember(copy);
        const [electrical, native, storage] = await Promise.all([owner.readElectricalCatalog(copy.value.handle, signal),
          owner.readCatalog(copy.value.handle, signal), owner.status(signal)]);
        if (electrical.status !== 'ok') return remember(electrical);
        if (storage.status !== 'ok') return remember(storage);
        if (native.status !== 'ok' && native.status !== 'missing') return remember(native);
        const allBytes = electrical.value.buildings.reduce((sum, row) => sum + row.documents.reduce((n, d) => n + electricalPinBytes(d.pin), 0), 0)
          + (native.status === 'ok' ? native.value.documents.filter(row => row.lifecycle === 'active').reduce((sum, row) => sum + row.bytes, 0) : 0);
        // Explicit opens may keep their selected original; automatic fill refuses budget churn.
        if (!retention.evidenceId && allBytes > storage.value.budgetBytes * 0.8) return remember(summary());
        client = reader.createDrawingClient(frame);
        for (const document of documents) {
          if (retention.evidenceId && document.pin.evidenceId !== retention.evidenceId) continue;
          if (!current() || signal.aborted) return remember(retired());
          if (retention.enabled?.() === false) break;
          const pin = document.pin, previous = await owner.electricalStatus(copy.value.handle, pin, signal);
          if (previous.status === 'ok' && previous.value.availability === 'held') { held++; continue; }
          if (previous.status !== 'ok' && previous.status !== 'missing' && previous.status !== 'integrity') return remember(previous);
          try { opened = await client.open(pin.evidenceId, signal); }
          catch {
            if (!current() || signal.aborted) return remember(retired());
            unavailable++; continue;
          }
          const byteCurrent = () => current() && opened !== null && client!.isCurrent(opened);
          if (!byteCurrent() || signal.aborted) return remember(retired());
          const asset = opened.asset;
          if (opened.mode !== 'original-download' || opened.evidenceId !== pin.evidenceId || opened.evidenceRevision !== pin.evidenceRevision
            || asset.assetId !== pin.assetId || asset.revision.token !== pin.assetRevision || asset.byteSize.token !== pin.byteSize
            || asset.sha256 !== pin.sha256 || asset.contentType !== 'application/pdf' || asset.purpose !== 'evidence-original')
            return remember({ status: 'integrity' });
          const blob = client.getBlob(opened);
          if (!blob || blob.size !== electricalPinBytes(pin) || blob.type !== 'application/pdf') return remember({ status: 'integrity' });
          const original = await blob.arrayBuffer();
          if (!byteCurrent() || signal.aborted || !actor) return remember(retired());
          const admitted = owner.bindHome(actor, frame.scope, byteCurrent); if (admitted.status !== 'ok') return remember(admitted);
          const result = await owner.keepElectricalDocument(admitted.value, pin, original, signal);
          client.release(opened); opened = null;
          if (result.status === 'ok') held++;
          else if (result.status === 'retired' || result.status === 'aborted' || result.status === 'uncertain') return remember(result);
          else unavailable++;
        }
        return remember(summary());
      } catch { return remember({ status: signal.aborted ? 'aborted' : current() ? 'integrity' : 'retired' }); }
      finally { if (opened) client?.release(opened); client?.dispose(); }
    },
    close() { generation++; actor = null; observed = null; refreshHomeboxOriginals(); owner.close(); outcomeListeners.clear();
      options.events?.removeEventListener('focus', recheckCopies); options.events?.removeEventListener('visibilitychange', recheckCopies);
      if (channel) { channel.onmessage = null; channel.close(); } },
  };
}
export type LiveCopyRetention = ReturnType<typeof createLiveCopyRetention>;
