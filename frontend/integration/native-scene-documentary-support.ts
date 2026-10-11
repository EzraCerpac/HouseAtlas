import { ExactDecimal, isExactDecimal } from '../src/numeric/decimal';
import { parseLosslessJson, type LosslessJson } from '../src/numeric/lossless-json';
import type { NativeEvidenceDocumentFrame } from '../src/lantern/scans/native-evidence-document-types';
import type { NativeSceneDrawingPdfReference, NativeSceneSourceSelection } from '../src/lantern/scans/native-scene-source-types';

type Row = { [key: string]: LosslessJson };
const SHA = /^[0-9a-f]{64}$/, UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const MAX = 8 * 1024 * 1024;
function need(ok: unknown): asserts ok { if (!ok) throw new TypeError('Reviewed drawing support is unavailable'); }
function row(value: LosslessJson | undefined, keys?: readonly string[]): Row {
  need(value !== null && typeof value === 'object' && !Array.isArray(value) && !isExactDecimal(value));
  if (keys) need(Object.keys(value).length === keys.length && Object.keys(value).every(k => keys.includes(k)));
  return value;
}
function str(value: LosslessJson | undefined, max = 512): string {
  need(typeof value === 'string' && value.length > 0 && value.length <= max); return value;
}
function sha(value: LosslessJson | undefined): string { const s = str(value, 64); need(SHA.test(s)); return s; }
function uuid(value: LosslessJson | undefined): string { const s = str(value, 36); need(UUID.test(s)); return s; }
function integer(value: LosslessJson | undefined, max = Number.MAX_SAFE_INTEGER): ExactDecimal {
  need(isExactDecimal(value) && value.isInteger && value.compare(ExactDecimal.parse('1')) >= 0
    && value.compare(ExactDecimal.parse(String(max))) <= 0); return value;
}
/** Reject duplicate decoded keys before the existing last-wins lossless parser. */
function parse(text: string): LosslessJson {
  need(text.length <= MAX); let i = 0, members = 0;
  const space = () => { while (i < text.length && /\s/.test(text[i]!)) i++; };
  const quoted = (): string => {
    need(text[i] === '"'); const start = i++;
    for (; i < text.length; i++) {
      if (text[i] === '\\') { i++; continue; }
      if (text[i] === '"') { i++; return JSON.parse(text.slice(start, i)) as string; }
    }
    throw new TypeError('Invalid drawing support JSON');
  };
  const scan = (depth: number): void => {
    need(depth <= 32); space();
    if (text[i] === '{') {
      i++; space(); const seen = new Set<string>(); if (text[i] === '}') { i++; return; }
      for (;;) { const key = quoted(); need(++members <= 50000 && !seen.has(key)); seen.add(key);
        space(); need(text[i++] === ':'); scan(depth + 1); space();
        if (text[i] === '}') { i++; return; } need(text[i++] === ','); space(); }
    }
    if (text[i] === '[') {
      i++; space(); if (text[i] === ']') { i++; return; }
      for (;;) { need(++members <= 50000); scan(depth + 1); space();
        if (text[i] === ']') { i++; return; } need(text[i++] === ','); }
    }
    if (text[i] === '"') { quoted(); return; }
    const start = i; while (i < text.length && !/[\s,\]}]/.test(text[i]!)) i++; need(i > start);
  };
  scan(0); space(); need(i === text.length); return parseLosslessJson(text);
}
function canonical(value: LosslessJson): string {
  if (isExactDecimal(value)) return value.token;
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  return `{${Object.keys(value).sort().map(k => `${JSON.stringify(k)}:${canonical(value[k]!)}`).join(',')}}`;
}
export function sameDocumentaryValue(a: LosslessJson, b: LosslessJson): boolean {
  if (isExactDecimal(a) || isExactDecimal(b)) return isExactDecimal(a) && isExactDecimal(b) && a.compare(b) === 0;
  if (a === null || b === null || typeof a !== 'object' || typeof b !== 'object') return a === b;
  if (Array.isArray(a) || Array.isArray(b)) return Array.isArray(a) && Array.isArray(b)
    && a.length === b.length && a.every((v, i) => sameDocumentaryValue(v, b[i]!));
  const keys = Object.keys(a); return keys.length === Object.keys(b).length
    && keys.every(k => Object.hasOwn(b, k) && sameDocumentaryValue(a[k]!, b[k]!));
}
async function digest(bytes: Uint8Array): Promise<string> {
  const own = new Uint8Array(bytes.length); own.set(bytes);
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256', own.buffer))]
    .map(v => v.toString(16).padStart(2, '0')).join('');
}
function freeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.values(value).forEach(freeze); Object.freeze(value);
  }
  return value;
}
export interface DocumentarySupport {
  readonly originalSha256: string;
  readonly roomMapping: Readonly<{ receiptId: string; originalSha256: string }>;
  readonly fixtureLedger: LosslessJson;
  readonly fixtureLedgerSha256: string;
  readonly correlationId: string;
  readonly correlationSha256: string;
  readonly reviewId: string;
  readonly reviewSha256: string;
  readonly reviewMarker: string;
  readonly pdf: Readonly<{ workspaceId: string; homeId: string; buildingId: string; evidenceId: string;
    evidenceRevision: number; assetId: string; assetRevision: ExactDecimal; sha256: string; byteSize: ExactDecimal }>;
  readonly references: readonly Readonly<{ sheetId: string; pdfPage: number;
    originalPhotoSha256: string; renderedPhotoSha256: string; pdfEmbeddedImageSha256: string }>[];
}
/** These original/review objects are reviewed evidence data, never self-issued grants.
 * Only a deliberate native Editor association review supplies the marker. */
export async function readDocumentarySupport(bytes: Uint8Array, guard: () => void): Promise<DocumentarySupport | null> {
  guard(); need(bytes.length > 0 && bytes.length <= MAX);
  const text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
  let value: LosslessJson;
  try { value = parse(text); } catch { return null; } // Ordinary historical originals remain valid legacy input.
  if (value === null || typeof value !== 'object' || Array.isArray(value) || isExactDecimal(value)
    || value.schema !== 'houseatlas.documentary-scene-support.v1') return null;
  const input = row(value, ['schema','roomMapping','fixtureLedger','crosswalk','review']);
  const original = async (item: LosslessJson | undefined, canonicalRequired = false) => {
    const p = row(item, ['json','sha256']), json = str(p.json, MAX), expected = sha(p.sha256), parsed = parse(json);
    if (canonicalRequired) need(canonical(parsed) === json);
    guard(); need(await digest(new TextEncoder().encode(json)) === expected); guard();
    return { value: parsed, sha256: expected };
  };
  const mapping = await original(input.roomMapping), ledger = await original(input.fixtureLedger);
  const mappingId = str(row(mapping.value).receiptId, 256);
  const ledgerReceipt = row(row(ledger.value).roomMappingReceipt, ['id','sha256']);
  need(ledgerReceipt.id === mappingId && ledgerReceipt.sha256 === mapping.sha256);
  const crosswalk = await original(input.crosswalk, true), review = await original(input.review, true);
  const c = row(crosswalk.value, ['profile','correlationId','fixtureLedgerSha256','pdf','references']);
  need(c.profile === 'houseatlas.documentary-sheet-pdf-correlation.v1' && c.fixtureLedgerSha256 === ledger.sha256);
  const correlationId = str(c.correlationId, 256);
  const p = row(c.pdf, ['workspaceId','homeId','buildingId','evidenceId','evidenceRevision','assetId','assetRevision','sha256','byteSize']);
  const pdf = { workspaceId: uuid(p.workspaceId), homeId: uuid(p.homeId), buildingId: uuid(p.buildingId),
    evidenceId: uuid(p.evidenceId), evidenceRevision: integer(p.evidenceRevision).toSafeInteger()!,
    assetId: uuid(p.assetId), assetRevision: integer(p.assetRevision), sha256: sha(p.sha256), byteSize: integer(p.byteSize, 10485760) };
  need(Array.isArray(c.references) && c.references.length > 0 && c.references.length <= 128);
  const seen = new Set<string>();
  const references = c.references.map(item => {
    const r = row(item, ['sheetId','pdfPage','originalPhotoSha256','renderedPhotoSha256','pdfEmbeddedImageSha256']);
    const sheetId = str(r.sheetId, 256); need(!seen.has(sheetId)); seen.add(sheetId);
    return { sheetId, pdfPage: integer(r.pdfPage, 100000).toSafeInteger()!, originalPhotoSha256: sha(r.originalPhotoSha256),
      renderedPhotoSha256: sha(r.renderedPhotoSha256), pdfEmbeddedImageSha256: sha(r.pdfEmbeddedImageSha256) };
  });
  need(Array.isArray(row(ledger.value).sheets));
  for (const r of references) {
    const matching = (row(ledger.value).sheets as LosslessJson[]).map(v => row(v)).filter(s => s.id === r.sheetId);
    need(matching.length === 1 && integer(matching[0]!.pdfPage, 100000).toSafeInteger() === r.pdfPage
      && matching[0]!.originalPhotoSha256 === r.originalPhotoSha256 && matching[0]!.renderedPhotoSha256 === r.renderedPhotoSha256);
  }
  const reviewed = row(review.value, ['profile','reviewId','crosswalkSha256','roomMappingSha256','sourceReviewJson','sourceReviewSha256']);
  need(reviewed.profile === 'houseatlas.documentary-sheet-pdf-review.v1'
    && reviewed.crosswalkSha256 === crosswalk.sha256 && reviewed.roomMappingSha256 === mapping.sha256);
  const reviewId = str(reviewed.reviewId, 256), sourceReviewJson = str(reviewed.sourceReviewJson, MAX);
  parse(sourceReviewJson); guard(); need(await digest(new TextEncoder().encode(sourceReviewJson)) === sha(reviewed.sourceReviewSha256)); guard();
  const originalSha256 = await digest(bytes); guard();
  const reviewMarker = `\n[HouseAtlas drawing review v1 support:${originalSha256} crosswalk:${crosswalk.sha256} review:${review.sha256}]`;
  return freeze({ originalSha256, roomMapping: { receiptId: mappingId, originalSha256: mapping.sha256 },
    fixtureLedger: ledger.value, fixtureLedgerSha256: ledger.sha256, correlationId, correlationSha256: crosswalk.sha256,
    reviewId, reviewSha256: review.sha256, reviewMarker, pdf, references });
}
export function documentaryReferences(support: DocumentarySupport, selection: NativeSceneSourceSelection): readonly NativeSceneDrawingPdfReference[] {
  need(support.pdf.workspaceId === selection.workspaceId && support.pdf.homeId === selection.homeId
    && support.pdf.buildingId === selection.buildingId);
  return Object.freeze(support.references.map(r => Object.freeze({ correlationId: support.correlationId,
    correlationSha256: support.correlationSha256, workspaceId: selection.workspaceId, homeId: selection.homeId,
    buildingId: selection.buildingId, viewKey: selection.viewKey, sceneOriginalSha256: selection.sceneOriginalSha256,
    sceneEvidenceId: selection.sceneEvidenceId, sceneEvidenceRevision: selection.sceneEvidenceRevision,
    sceneAssetId: selection.sceneAssetId, sceneAssetRevision: selection.sceneAssetRevision,
    sheetId: r.sheetId, pdfPage: r.pdfPage, originalPhotoSha256: r.originalPhotoSha256,
    renderedPhotoSha256: r.renderedPhotoSha256, evidenceId: support.pdf.evidenceId,
    evidenceRevision: support.pdf.evidenceRevision, assetId: support.pdf.assetId,
    assetRevision: support.pdf.assetRevision, assetSha256: support.pdf.sha256, byteSize: support.pdf.byteSize })));
}
export function matchesDocumentaryPdf(support: DocumentarySupport, frame: NativeEvidenceDocumentFrame, blob: Blob | null): boolean {
  return frame.evidenceId === support.pdf.evidenceId && frame.evidenceRevision === support.pdf.evidenceRevision
    && frame.asset.assetId === support.pdf.assetId && frame.asset.revision.compare(support.pdf.assetRevision) === 0
    && frame.asset.sha256 === support.pdf.sha256 && frame.asset.byteSize.compare(support.pdf.byteSize) === 0
    && frame.asset.contentType === 'application/pdf' && frame.asset.purpose === 'evidence-original'
    && frame.asset.previewPolicy === 'download-only' && frame.mode === 'original-download'
    && blob?.type === 'application/pdf' && blob.size === support.pdf.byteSize.toSafeInteger();
}
