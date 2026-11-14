/** The example's fictional files beyond the source Documents: one HomeBox
 * stored-file original and one electrical drawing PDF. Both are generated here
 * or by the existing electrical fixture, and both are read through the
 * production readers behind in-page fake transports and an in-memory copy
 * store. Nothing reaches the network, IndexedDB or a real account. */
import type { AtlasSessionInfo } from '../src/app/session';
import type { Attachment, ReadyView } from '../src/app/types';
import type { HomeboxOriginalSource, HomeboxOriginalsPort } from '../src/lantern/homebox-originals/types';
import type { SourceDocumentsPort } from '../src/lantern/source-documents/types';
import type { OfflineBackend } from '../src/offline/live-copy-types';
import { createLiveCopyRetention } from '../integration/live-copy-retention';
import { createNativeSourceDocumentReader } from '../integration/native-source-document-reader';
import { createSyntheticDocumentServer } from '../lantern-tests/source-host-visual/synthetic-documents';
import { createSyntheticElectricalLibrary } from '../lantern-tests/electrical-library-visual/synthetic-electrical';

const EXPIRES = '2099-01-01T00:00:00Z';
const RETRIEVED = '2026-01-03T10:15:00Z';
/** A fixed local actor for the in-page copy store; not a session or account. */
const SESSION: AtlasSessionInfo = Object.freeze({ schemaVersion: 1, actorId: 'example-house-local', csrfToken: 'example-unused', expiresAt: EXPIRES });

/** The example's source Documents: the production native reader over the
 * in-page synthetic document server. One fixed local owner, not a session. */
export function createExampleSourceDocuments(scope: Readonly<{ workspaceId: string; homeId: string }>): SourceDocumentsPort {
  const binding = { sessionIdentity: Object.freeze({}), expiresAt: EXPIRES, scope };
  return { createReader: () => createSyntheticDocumentServer(scope).then(server => createNativeSourceDocumentReader({
    origin: server.origin, transport: server.transport, getBinding: () => binding, subscribeBinding: () => () => {},
  })) };
}

/** One-page vector PDF with Helvetica text lines; no font or image files. */
export function examplePdf(lines: readonly string[]): Uint8Array<ArrayBuffer> {
  const escape = (text: string) => text.replace(/[\\()]/g, char => `\\${char}`);
  const content = `0.93 0.9 0.84 rg 30 30 535 360 re f\nBT /F1 18 Tf 0 0 0 rg 50 350 Td 24 TL\n${lines.map(line => `(${escape(line)}) Tj T*`).join('\n')}\nET`;
  const objects = ['<< /Type /Catalog /Pages 2 0 R >>', '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 420] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>',
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'];
  let text = '%PDF-1.4\n'; const offsets: number[] = [];
  objects.forEach((object, i) => { offsets.push(text.length); text += `${i + 1} 0 obj\n${object}\nendobj\n`; });
  const xref = text.length;
  text += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map(offset => `${String(offset).padStart(10, '0')} 00000 n \n`).join('')}`;
  text += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return new TextEncoder().encode(text);
}

/** The reading lamp's stored manual: a HomeBox-style original. */
export const LAMP_MANUAL_BYTES = examplePdf(['SYNTHETIC EXAMPLE HOUSE', 'Fictional reading lamp manual',
  'Invented for HouseAtlas demonstrations.', 'No real product, household or source.']);
export const LAMP_MANUAL: Extract<Attachment, { kind: 'stored-file' }> = Object.freeze({
  attachmentId: '00000000-0000-4000-8000-0000000e0a01', title: 'Fictional reading lamp manual', kind: 'stored-file',
  contentType: 'application/pdf', byteSize: String(LAMP_MANUAL_BYTES.byteLength),
  // No issued URL: the example has no media host. The verified-copy read below supplies the bytes.
  downloadHref: null, previewHref: null,
});

const hex = async (bytes: Uint8Array<ArrayBuffer>) => [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))]
  .map(n => n.toString(16).padStart(2, '0')).join('');

/** Transactional in-memory store with the IndexedDB backend's interface. */
function memoryBackend(): OfflineBackend {
  let data = new Map(['control', 'metadata', 'bytes'].map(table => [table, new Map<string, unknown>()]));
  let tail: Promise<unknown> = Promise.resolve();
  return {
    transaction(write, work) {
      const run = tail.then(async () => {
        const draft = structuredClone(data), table = (name: string) => draft.get(name)!;
        const value = await work({
          get: async <T,>(name: string, key: string) => structuredClone(table(name).get(key)) as T | undefined,
          // Key order and the row bound follow the IndexedDB cursor.
          async scan(name, maxRows, visit) {
            let count = 0;
            for (const key of [...table(name).keys()].sort()) {
              if (++count > maxRows) throw Object.assign(new Error('Offline scan capacity exceeded'), { name: 'OfflineResourceLimit' });
              await visit(key, structuredClone(table(name).get(key)));
            }
          },
          put: async (name, key, row) => { table(name).set(key, structuredClone(row)); },
          remove: async (name, key) => { table(name).delete(key); },
          empty: async name => { table(name).clear(); },
        });
        if (write) data = draft;
        return value;
      });
      tail = run.catch(() => undefined);
      return run;
    },
    close() {},
  };
}

/** Answers only the production HomeBox offline-original GET for the listed
 * example attachments, with the facts header the real host sends. */
function homeboxOriginalServer(view: ReadyView, served?: () => void): typeof fetch {
  const files = new Map(view.entries.flatMap(entry => entry.attachments.flatMap(attachment =>
    attachment.kind === 'stored-file' && attachment.attachmentId === LAMP_MANUAL.attachmentId
      ? [[JSON.stringify([entry.source.sourceInstanceId, entry.source.collectionId, entry.source.externalId, attachment.attachmentId]), LAMP_MANUAL_BYTES] as const] : [])));
  const prefix = `/api/atlas/stock/v4/workspaces/${view.scope.workspaceId}/homes/${view.scope.homeId}/homebox-offline-original?`;
  return async (input, init) => {
    init?.signal?.throwIfAborted();
    const url = String(input);
    if (!url.startsWith(prefix) || init?.method !== 'GET') return new Response(null, { status: 404 });
    const request = JSON.parse(new URLSearchParams(url.slice(prefix.length)).get('request') ?? 'null');
    const target = request?.target, bytes = target && files.get(JSON.stringify([target.sourceInstanceId, target.collectionId, target.entityId, target.resourceId]));
    if (request?.commandId !== 'homebox.file.download' || !bytes) return new Response(null, { status: 404 });
    const facts = { schemaVersion: 1, requestId: request.requestId, observationId: crypto.randomUUID(),
      scope: { ...request.context, sourceInstanceId: target.sourceInstanceId, collectionId: target.collectionId }, target,
      sourceRegistrationVersion: 1, sourceRegistrationSha256: 'f'.repeat(64), sha256: await hex(bytes), byteSize: bytes.byteLength,
      contentType: 'application/pdf', localCapture: { semantics: 'process-local-pinned-snapshot', statuses: [200, 200, 200],
        beforeRetrievedAt: RETRIEVED, bodyRetrievedAt: RETRIEVED, afterRetrievedAt: RETRIEVED } };
    const header = btoa(String.fromCharCode(...new TextEncoder().encode(JSON.stringify(facts))));
    served?.();
    return new Response(bytes.slice(0), { headers: { 'content-type': 'application/octet-stream', 'x-houseatlas-original': header } });
  };
}

/** The production verified-copy owner over an in-memory store: "Read and keep
 * verified copy" reads the example original and keeps it until the page closes.
 * `served` observes each answered original read (tests only). */
export async function createExampleHomeboxOriginals(view: ReadyView, documents: SourceDocumentsPort, served?: () => void): Promise<HomeboxOriginalsPort> {
  const retention = createLiveCopyRetention({ factory: undefined, backend: memoryBackend(), documents: () => documents,
    state: () => ({ session: SESSION, view }), homeboxTransport: homeboxOriginalServer(view, served) });
  const observed = await retention.observe(SESSION, () => true);
  // As the live host does after each completed view: observe, then keep the view.
  const captured = observed.status === 'ok' ? await retention.capture(view, new AbortController().signal) : observed;
  if (captured.status !== 'ok') throw new Error(`Example copy store unavailable (${captured.status})`);
  const identity = Object.freeze({}), scope = Object.freeze({ ...view.scope });
  // The example's one HomeBox source counts as an installed local file source.
  const installedSources = view.entries.filter(entry => entry.attachments.length > 0).map(entry => Object.freeze({
    workspaceId: scope.workspaceId, homeId: scope.homeId, key: Object.freeze({ sourceInstanceId: entry.source.sourceInstanceId,
      collectionId: entry.source.collectionId, sourceKind: 'homebox-entity' as const, externalId: entry.source.externalId }) }));
  const source: HomeboxOriginalSource = {
    getBindingIdentity: () => identity,
    getBindingScope: owned => owned === identity ? scope : null,
    async discover(owned, signal) {
      signal.throwIfAborted();
      if (owned !== identity) throw new Error('Example file source is retired');
      return { schemaVersion: 1, scope, revision: 'example-1', installedSources };
    },
  };
  return {
    async createReader(requested, signal) {
      if (signal.aborted) return { status: 'aborted' };
      return requested === view ? retention.createHomeboxOriginalReader(requested, source) : { status: 'retired' };
    },
  };
}

/** The existing fictional electrical drawing fixture, placed on the example's
 * house building, read by the production Electrical Library reader. */
export function createExampleElectrical(view: ReadyView, building: Readonly<{ nativePlaceId: string; label: string }>) {
  return createSyntheticElectricalLibrary('pdf', 'available', { scope: view.scope, buildingId: building.nativePlaceId,
    buildingLabel: building.label, homeLabel: view.homeLabel });
}
