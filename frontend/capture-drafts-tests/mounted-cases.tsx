import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { SessionApp } from '../src/app/SessionApp';
import { createNativeEvidenceClient } from '../src/api/native-evidence-client';
import { CAPTURE_MAX_BYTES, CAPTURE_TYPES } from '../src/capture-evidence/selection';
import { NativePlaceEvidence } from '../src/lantern/topology/NativePlaceEvidence';
import { CaptureDraftProvider } from '../src/capture-drafts-ui/Context';
import { DRAFT_DATABASE, openDraftStore } from '../src/capture-drafts/indexeddb';
import { createCaptureDraftAdapter } from '../integration/capture-drafts-adapter';

const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const scope = { workspaceId: uuid(1), homeId: uuid(2) };
const placeId = uuid(3), identityId = uuid(4), otherPlaceId = uuid(5), priorEvidence = uuid(6);
const timestamp = '2026-10-11T10:00:00Z';
const license = { status: 'unknown', reference: null };
const evidencePath = `/api/atlas/editing/v1/workspaces/${scope.workspaceId}/homes/${scope.homeId}/native-places/`;
const file = new File(['Generated desktop original\n'], 'desktop-original.txt', { type: 'text/plain', lastModified: 42 });
const formStatement = 'Synthetic desktop evidence';
const formReason = 'Exercise the mounted form';
const session = { schemaVersion: 1 as const, actorId: 'synthetic-actor', csrfToken: 'synthetic-session-marker',
  expiresAt: new Date(Date.now() + 600_000).toISOString() };

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

async function until<T>(predicate: () => T, label: string): Promise<NonNullable<T>> {
  const deadline = performance.now() + 2500;
  do {
    const value = predicate();
    if (value) return value;
    await new Promise(resolve => setTimeout(resolve, 10));
  } while (performance.now() < deadline);
  throw new Error(`Did not observe ${label}`);
}

const select = <T extends HTMLElement>(selector: string) => document.querySelector<T>(selector);
const button = (name: string) => [...document.querySelectorAll('button')].find(node => node.textContent === name);
const click = async (name: string) => (await until(() => {
  const node = button(name);
  return node && !node.disabled && node;
}, name)).click();
const status = (message: string) => until(() => [...document.querySelectorAll('[role=status], [role=alert]')]
  .some(node => node.textContent?.includes(message)), message);
const captureForm = 'form:has(input[type=file])';
const review = '[aria-label="Saved capture review"]';

function fixture() {
  let binding = { scope }, readScope = scope, rootGeneration = 1, currentSession = session;
  let foreground = true, openCount = 0, sessionReads = 0, rechecks = 0, posts = 0;
  let answer = async () => currentSession;
  let failChange: string | null = null;
  let nextResponse: ((signal: AbortSignal) => Promise<Response>) | null = null;
  let posted: { route: string; body: FormData | undefined } | null = null;
  const gets: string[] = [];
  const subscribers = new Set<() => void>();
  const record = (recordType: string, recordId: string, payload: object) => ({
    schemaVersion: 1, recordType, recordId, ...scope, revision: 1, lifecycle: 'active',
    createdAt: timestamp, updatedAt: timestamp, lastAuditId: uuid(7), payload,
  });
  function admission(id: string) {
    return { schemaVersion: 1, admissionKind: 'native-location', scope,
      record: record('location-semantics', id, { atlasId: identityId, semanticKind: 'room', reviewStatus: 'accepted', evidenceIds: [priorEvidence] }),
      identity: record('identity', identityId, { kind: 'location', evidenceIds: [priorEvidence] }),
      guards: [{ record: { recordType: 'evidence', recordId: priorEvidence }, expectedRevision: 1 },
        { record: { recordType: 'identity', recordId: identityId }, expectedRevision: 1 }],
      canAttachEvidence: true, maximumReasonCodePoints: 1024,
      attachmentPolicy: { contentTypes: CAPTURE_TYPES, maximumBytes: CAPTURE_MAX_BYTES,
        licenses: [{ label: 'Unknown', value: license }] } };
  }
  const evidence = createNativeEvidenceClient({
    getBinding: () => binding, owner: () => currentSession,
    subscribe(listener) { subscribers.add(listener); return () => { subscribers.delete(listener); }; },
    async exchange(actual, route, method, signal, body) {
      assert(actual === binding, 'Wrong evidence binding');
      if (method === 'GET') {
        assert(route === evidencePath + placeId || route === evidencePath + otherPlaceId, 'Unexpected evidence GET');
        gets.push(route);
        const held = nextResponse;
        nextResponse = null;
        if (held) return held(signal);
        return Response.json(admission(route.slice(evidencePath.length)));
      }
      if (method !== 'POST') throw new Error('Unexpected fixture method');
      posts++;
      posted = { route, body: body instanceof FormData ? body : undefined };
      return new Response('malformed synthetic reply');
    },
  });
  const refuse = () => { throw new Error('Unexpected source-backed operation'); };
  const adapter = createCaptureDraftAdapter({
    getSession: () => currentSession, getGeneration: () => rootGeneration, getReadScope: () => readScope,
    readSession: async () => { sessionReads++; return answer(); },
    foreground: () => foreground, recheckSession: () => { rechecks++; },
    editing: { replacePlace: refuse, loadPlace: refuse }, schemas: { validate: refuse },
    openStore() {
      openCount++;
      const store = openDraftStore();
      return { ...store, change(edit) {
        return store.change(rows => {
          const result = edit(rows);
          if (failChange) throw new DOMException('Synthetic transaction refusal', failChange);
          return result;
        });
      } };
    },
    placeEvidence: () => evidence,
  });
  adapter.observeCanonical(currentSession);
  adapter.setScope(scope);
  const disconnect = adapter.connect(window, document);
  const element = document.createElement('main');
  document.body.append(element);
  const root = createRoot(element);
  const render = (id: string | null) => flushSync(() => root.render(id === null ? null :
    <CaptureDraftProvider port={adapter.port}>
      <NativePlaceEvidence key={id} client={evidence} binding={binding}
        location={{ id: identityId, label: 'Synthetic room', semantics: [{
          lifecycle: 'active', target: { recordId: id }, payload: { reviewStatus: 'accepted' },
        }] } as never} index={{ data: { bindings: [], identities: [] } } as never}
        refresh={() => { throw new Error('A fixture without a committed response refreshed records'); }} />
    </CaptureDraftProvider>));
  return { adapter, root, render, gets, close() { root.unmount(); disconnect(); element.remove(); },
    get posts() { return posts; }, get openCount() { return openCount; },
    get posted() { return posted; },
    get sessionReads() { return sessionReads; }, get rechecks() { return rechecks; },
    setForeground(value: boolean) { foreground = value; window.dispatchEvent(new Event(value ? 'focus' : 'blur')); },
    setAnswer(next: typeof answer) { answer = next; },
    replaceGeneration() { rootGeneration++; },
    restoreSession() { answer = async () => currentSession; adapter.observeCanonical(currentSession); adapter.setScope(scope); },
    setHome(homeId: string) { readScope = { ...scope, homeId }; adapter.setScope(readScope); },
    replaceSession() {
      currentSession = { ...session, actorId: 'synthetic-other-actor' };
      adapter.observeCanonical(currentSession);
      adapter.setScope(scope);
    },
    replaceBinding() { binding = { scope: { ...scope, homeId: uuid(8) } }; for (const listener of subscribers) listener(); },
    holdAdmission(id: string) {
      let started: AbortSignal | null = null;
      const response = Promise.withResolvers<Response>();
      nextResponse = signal => { started = signal; return response.promise; };
      return { started: () => started, release: () => response.resolve(Response.json(admission(id))) };
    },
    failChange(name: string | null) { failChange = name; },
  };
}

async function open() {
  await click('Add native evidence');
  await until(() => {
    assert(![...document.querySelectorAll('[role=status]')].some(node => node.textContent === 'Current native evidence information could not be loaded.'),
      'Generated native admission was refused');
    return select<HTMLFormElement>(captureForm);
  }, 'admitted evidence form');
}

function fill() {
  select<HTMLTextAreaElement>(`${captureForm} [name=statement]`)!.value = formStatement;
  select<HTMLInputElement>(`${captureForm} [name=reason]`)!.value = formReason;
  select<HTMLSelectElement>(`${captureForm} [name=license]`)!.value = '0';
}

function choose(original: File) {
  const input = select<HTMLInputElement>(`${captureForm} [name=file]`)!;
  assert(!input.disabled, 'File input is disabled');
  const data = new DataTransfer();
  data.items.add(original);
  input.files = data.files;
  input.dispatchEvent(new Event('change', { bubbles: true }));
  assert(!input.value, 'Picker input did not reset for repeat selection');
  return input;
}

async function selected() {
  choose(file);
  await status('File selected.');
}

async function captureControls(f: ReturnType<typeof fixture>) {
  f.render(placeId);
  await open();
  fill();
  const isRetained = () => {
    const fields = new FormData(select<HTMLFormElement>(captureForm)!);
    assert(fields.get('statement') === formStatement && fields.get('reason') === formReason && fields.get('license') === '0',
      'Selection modified the evidence form fields');
    assert(f.posts === 0, 'Selection sent a POST');
  };
  const input = choose(file);
  await status('File selected.');
  input.dispatchEvent(new Event('cancel', { bubbles: true }));
  await status('Selection cancelled.');
  assert(select(captureForm)?.textContent?.includes(`Selected: ${file.name}`), 'Cancel removed the original');
  await selected();
  await click('Remove file');
  await status('File removed.');
  isRetained();
  for (const [invalid, explanation] of [
    [new File([new Uint8Array([0, 0, 0, 24, 102, 116, 121, 112, 104, 101, 105, 99])], 'unsupported.heic', { type: 'image/heic' }), 'HEIC/HEIF is not supported yet'],
    [new File(['%PDF-1.7'], 'wrong-signature.jpg', { type: 'image/jpeg' }), 'contents do not match'],
    [new File([], 'empty.txt', { type: 'text/plain' }), 'Choose a file containing evidence'],
    [new File([new Uint8Array(CAPTURE_MAX_BYTES + 1)], 'too-big.txt', { type: 'text/plain' }), 'exceeds the displayed size limit'],
  ] as const) {
    choose(invalid);
    await status(explanation);
    assert(button('Upload native evidence')?.disabled, 'Refused selection remained submittable');
    isRetained();
  }

  for (const retire of ['close', 'unmount', 'replace-binding'] as const) {
    if (retire !== 'close') { f.render(placeId); await open(); fill(); }
    await selected();
    const held = f.holdAdmission(placeId);
    await click('Upload native evidence');
    const signal = await until(held.started, 'fresh selected-place admission');
    if (retire === 'close') await click('Close');
    else if (retire === 'unmount') f.render(null);
    else f.replaceBinding();
    assert(signal.aborted, `${retire} did not abort fresh admission`);
    held.release();
    await until(() => !select(captureForm), `${retire} keeping the form retired`);
    assert(f.posts === 0, `${retire} allowed an old upload`);
  }
}

async function captureUnknown(f: ReturnType<typeof fixture>) {
  f.render(otherPlaceId);
  await open(); fill(); await selected();
  const upload = button('Upload native evidence')!;
  upload.click(); upload.click();
  await status('Completion is unknown.');
  assert(f.posts === 1 && f.gets.filter(route => route === evidencePath + otherPlaceId).length === 2,
    'Expected one upload to the selected place after fresh admission');
  const uploaded = f.posted?.body?.get('file');
  const metadata = JSON.parse(String(f.posted?.body?.get('metadata')));
  assert(f.posted?.route === evidencePath + otherPlaceId + '/evidence' && metadata.recordId === otherPlaceId
    && metadata.statement === formStatement && metadata.reason === formReason && metadata.capture.filename === file.name
    && uploaded instanceof File && await uploaded.text() === await file.text(), 'Wrong target, form or original in multipart POST');
  assert(upload.disabled && select(captureForm)?.textContent?.includes(`Selected: ${file.name}`),
    'Uncertain upload cleared the selection or left retry enabled');
  upload.click();
  assert(f.posts === 1, 'Uncertain upload was resent');
}

async function saveFromUi(f: ReturnType<typeof fixture>) {
  f.render(placeId);
  await open();
  assert(f.openCount === 0 && !(await indexedDB.databases()).some(row => row.name === DRAFT_DATABASE),
    'Browsing or opening Add evidence created the draft database');
  fill(); await selected();
  select<HTMLInputElement>('[aria-label="Local capture drafts"] input[type=checkbox]')!.click();
  await click('Save local draft');
  await status('Unsent draft saved on this browser.');
}

async function reviewFromUi() {
  await click('View local drafts');
  await click(`Review ${file.name}`);
  await until(() => select<HTMLAnchorElement>(`${review} a[download]`), 'read-only original download');
}

async function draftBrowserLifecycle(f: ReturnType<typeof fixture>) {
  await saveFromUi(f);
  await click('Close');
  await open();
  await reviewFromUi();
  const link = select<HTMLAnchorElement>(`${review} a[download]`)!;
  const bytes = await (await fetch(link.href)).text();
  assert(link.download === file.name && bytes === await file.text(), 'Local review download differs from the original');
  const reads = f.sessionReads;
  f.setForeground(false);
  await until(() => !select(review), 'background review retirement');
  f.setForeground(true);
  await until(() => f.sessionReads === reads + 1 && f.adapter.port.current(), 'one foreground canonical recheck');
  assert(!select(review) && f.posts === 0, 'Foreground return automatically reviewed or sent');
  f.setAnswer(async () => { throw Object.assign(new Error('Synthetic canonical refusal'), { status: 503 }); });
  await click('View local drafts');
  const beforeRefusal = f.sessionReads;
  await click(`Review ${file.name}`);
  await until(() => f.sessionReads === beforeRefusal + 1 && !f.adapter.port.current()
    && select('[aria-label="Local capture drafts"]')?.getAttribute('aria-busy') === 'false', 'canonical refusal and operation retirement');
  assert(!select(review) && !f.adapter.port.current() && f.posts === 0, 'Unavailable canonical read opened a review or sent');

  f.restoreSession();
  f.setHome(uuid(9));
  assert((await f.adapter.port.list()).length === 0, 'Another home saw the original');
  f.setHome(scope.homeId);
  f.replaceGeneration();
  assert(!f.adapter.port.current(), 'An unobserved session generation was accepted');
  f.restoreSession();
  await reviewFromUi();

  // The runner has armed a different same-origin tab. Ask it to send the exact
  // production message over the real session channel.
  const peer = new BroadcastChannel('synthetic-draft-peer-control');
  try {
    peer.postMessage('invalidate');
    await until(() => f.rechecks === 1 && !select(review), 'other-tab review invalidation');
  } finally { peer.close(); }
  assert(!f.adapter.port.current() && f.posts === 0, 'A broadcast restored authority or sent an upload');

  f.replaceSession();
  assert((await f.adapter.port.list()).length === 0, 'Another account saw the original');
  const store = openDraftStore();
  try {
    const rows = await store.read();
    assert(rows.length === 1 && rows[0].owner.actorId === session.actorId && rows[0].state === 'unsent',
      'Lifecycle retirement modified the saved original or its owner');
  } finally { store.close(); }
}

async function draftCleanupRefusal(f: ReturnType<typeof fixture>) {
  await saveFromUi(f);
  fill(); await selected();
  select<HTMLInputElement>('[aria-label="Local capture drafts"] input[type=checkbox]')!.click();
  f.failChange('QuotaExceededError');
  await click('Save local draft');
  await status('this browser has no room for the file. Nothing was sent.');
  const store = openDraftStore();
  try {
    const before = await store.read();
    let signOuts = 0;
    const refuse = () => { throw new Error('Unexpected application action'); };
    flushSync(() => f.root.render(<SessionApp client={{ load: async () => ({ status: 'denied' }), loadHome: refuse }}
      sessions={{ session: async () => session, login: refuse, async signOut() { signOuts++; } }}
      localCaptures={f.adapter.port} />));
    await click('Sign out');
    select<HTMLInputElement>('[role=dialog] input[type=checkbox]')!.click();
    await click('Delete local captures and sign out');
    await status('Local captures could not be removed. You are still signed in.');
    assert(signOuts === 0 && (await store.read())[0]?.id === before[0]?.id && before.length === 1,
      'Quota or cleanup failure removed a row or signed out');
    await click('Cancel');
    await until(() => !select('[role=dialog]'), 'sign-out cancellation');
    assert(signOuts === 0, 'Cancel signed out');
    await click('Sign out');
    await click('Keep local captures and sign out');
    await until(() => signOuts === 1, 'explicit keep-and-sign-out');
    const after = await store.read();
    assert(after.length === 1 && after[0].id === before[0].id && await after[0].original.text() === await file.text() && f.posts === 0,
      'Keep-and-sign-out changed the original or sent an upload');
  } finally { store.close(); }
}

const cases = {
  'mounted-capture-controls': captureControls,
  'mounted-capture-unknown': captureUnknown,
  'mounted-draft-lifecycle': draftBrowserLifecycle,
  'mounted-draft-cleanup-refusal': draftCleanupRefusal,
};
const name = new URLSearchParams(location.search).get('case') as keyof typeof cases;
const f = fixture();
let result;
try {
  assert(Object.hasOwn(cases, name), 'Unknown mounted case');
  const nativeFetch = window.fetch.bind(window);
  window.fetch = (input, init) => {
    assert(typeof input === 'string' && input.startsWith(`blob:${location.origin}/`), 'Unexpected fixture network access');
    return nativeFetch(input, init);
  };
  await cases[name](f);
  result = { ok: true, evidence: { mounted: true } };
} catch (error) {
  result = { ok: false, error: error instanceof Error ? error.message : String(error) };
} finally {
  f.close();
}
document.body.textContent = JSON.stringify(result);
document.body.dataset.status = 'complete';
