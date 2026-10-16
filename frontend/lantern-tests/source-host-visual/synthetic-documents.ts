/** Healthy anonymous native v2 source Documents served by an in-page fake
 * transport. Every value is generated here: no real agency, address, place,
 * coordinate, receipt or retained asset. Pins are computed from the generated
 * bytes, so the reader's frame, digest and length checks run unchanged. */

export interface SyntheticScope { readonly workspaceId: string; readonly homeId: string }
export interface SyntheticDocumentServer {
  readonly origin: string;
  readonly transport: typeof fetch;
  /** Document IDs in list order: survey PDF with preview, GeoJSON, stale TIFF. */
  readonly documentIds: readonly [string, string, string];
  readonly bytes: ReadonlyMap<string, Uint8Array<ArrayBuffer>>;
}

export const SYNTHETIC_ORIGIN = 'https://atlas.invalid';
const encoder = new TextEncoder();

let crcTable: Uint32Array | null = null;
function crc32(bytes: Uint8Array): number {
  crcTable ??= Uint32Array.from({ length: 256 }, (_, n) => {
    let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0;
  });
  let crc = 0xffffffff;
  for (const byte of bytes) crc = crcTable[(crc ^ byte) & 0xff]! ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}
function concat(parts: readonly Uint8Array[]): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.byteLength, 0)); let at = 0;
  for (const part of parts) { out.set(part, at); at += part.byteLength; } return out;
}
const u32 = (value: number) => Uint8Array.of(value >>> 24, (value >>> 16) & 255, (value >>> 8) & 255, value & 255);
function pngChunk(type: string, data: Uint8Array): Uint8Array {
  const head = concat([encoder.encode(type), data]);
  return concat([u32(data.byteLength), head, u32(crc32(head))]);
}
/** A small RGB PNG with stored (uncompressed) zlib blocks. */
function png(width: number, height: number, pixel: (x: number, y: number) => readonly [number, number, number]): Uint8Array<ArrayBuffer> {
  const raw = new Uint8Array((width * 3 + 1) * height);
  for (let y = 0, at = 0; y < height; y++) {
    raw[at++] = 0;
    for (let x = 0; x < width; x++) { const [r, g, b] = pixel(x, y); raw[at++] = r; raw[at++] = g; raw[at++] = b; }
  }
  const blocks: Uint8Array[] = [Uint8Array.of(0x78, 0x01)];
  for (let at = 0; at < raw.byteLength; at += 65535) {
    const part = raw.subarray(at, Math.min(raw.byteLength, at + 65535)), last = at + 65535 >= raw.byteLength ? 1 : 0;
    blocks.push(Uint8Array.of(last, part.byteLength & 255, part.byteLength >>> 8, ~part.byteLength & 255, (~part.byteLength >>> 8) & 255), part);
  }
  let a = 1, b = 0; for (const byte of raw) { a = (a + byte) % 65521; b = (b + a) % 65521; }
  blocks.push(u32(((b << 16) | a) >>> 0));
  const header = concat([u32(width), u32(height), Uint8Array.of(8, 2, 0, 0, 0)]);
  return concat([Uint8Array.of(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a), pngChunk('IHDR', header),
    pngChunk('IDAT', concat(blocks)), pngChunk('IEND', new Uint8Array())]);
}
/** A two-page vector PDF: a generic parcel sketch and a legend page. */
function pdf(): Uint8Array<ArrayBuffer> {
  const pages = [
    ['0.92 0.94 0.9 rg 40 40 515 340 re f', '0.55 0.6 0.58 RG 0.6 w',
      ...Array.from({ length: 9 }, (_, i) => `${40 + i * 64} 40 m ${40 + i * 64} 380 l S`),
      '0.16 0.3 0.42 RG 2 w 110 90 m 470 120 l 430 320 l 150 300 l h S',
      '0.82 0.5 0.2 RG 1.4 w 200 160 120 80 re S',
      'BT /F1 16 Tf 0.1 0.12 0.14 rg 56 392 Td (Synthetic parcel survey, sheet 1) Tj ET'],
    ['BT /F1 14 Tf 0.1 0.12 0.14 rg 56 360 Td (Legend, sheet 2) Tj ET',
      '0.16 0.3 0.42 RG 2 w 60 320 m 120 320 l S', 'BT /F1 11 Tf 132 316 Td (Generated boundary) Tj ET',
      '0.82 0.5 0.2 RG 1.4 w 60 290 60 16 re S', 'BT /F1 11 Tf 132 292 Td (Generated outline) Tj ET'],
  ];
  const objects = ['<< /Type /Catalog /Pages 2 0 R >>', `<< /Type /Pages /Kids [3 0 R 5 0 R] /Count 2 >>`];
  pages.forEach((lines, index) => {
    const stream = lines.join('\n');
    objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 420] /Resources << /Font << /F1 7 0 R >> >> /Contents ${4 + index * 2} 0 R >>`,
      `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`);
  });
  objects.push('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');
  let text = '%PDF-1.4\n'; const offsets: number[] = [];
  objects.forEach((body, index) => { offsets.push(text.length); text += `${index + 1} 0 obj\n${body}\nendobj\n`; });
  const xref = text.length;
  text += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map(at => `${String(at).padStart(10, '0')} 00000 n \n`).join('')}`;
  text += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return encoder.encode(text);
}

const hex = (bytes: ArrayBuffer) => [...new Uint8Array(bytes)].map(value => value.toString(16).padStart(2, '0')).join('');
const base64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes));
async function pinOf(assetId: string, revision: number, bytes: Uint8Array<ArrayBuffer>) {
  return { assetId, revision, sha256: hex(await crypto.subtle.digest('SHA-256', bytes)), bytes: bytes.byteLength };
}
const id = (n: number) => `00000000-0000-4000-8000-${String(900 + n).padStart(12, '0')}`;

export async function createSyntheticDocumentServer(scope: SyntheticScope): Promise<SyntheticDocumentServer> {
  const survey = pdf();
  const preview = png(240, 168, (x, y) => {
    const grid = x % 30 === 0 || y % 21 === 0, inside = x > 40 && x < 200 && y > 30 && y < 140;
    return grid ? [150, 160, 156] : inside ? [214, 226, 232] : [236, 239, 230];
  });
  const geojson = encoder.encode(JSON.stringify({ type: 'FeatureCollection', features: [{ type: 'Feature', properties: { name: 'Generated outline' },
    geometry: { type: 'Polygon', coordinates: [[[0, 0], [12, 0], [12, 8], [0, 8], [0, 0]]] } }] }));
  const tiff = Uint8Array.of(0x49, 0x49, 0x2a, 0x00, 0x08, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00);
  const [surveyPin, previewPin, geojsonPin, tiffPin] = await Promise.all([pinOf(id(11), 1, survey), pinOf(id(12), 1, preview),
    pinOf(id(13), 2, geojson), pinOf(id(14), 1, tiff)]);
  const bytes = new Map<string, Uint8Array<ArrayBuffer>>([[surveyPin.assetId, survey], [previewPin.assetId, preview],
    [geojsonPin.assetId, geojson], [tiffPin.assetId, tiff]]);
  const mimes = new Map([[surveyPin.assetId, 'application/pdf'], [previewPin.assetId, 'image/png'],
    [geojsonPin.assetId, 'application/geo+json'], [tiffPin.assetId, 'image/tiff']]);
  const record = (n: number, revision: number, title: string, original: typeof surveyPin, provenance: object, lineage: object | null) => ({
    schemaVersion: 2, recordType: 'geodata-document', recordId: id(n), workspaceId: scope.workspaceId, homeId: scope.homeId,
    revision, lifecycle: 'active', createdAt: '2026-10-01T09:00:00Z', updatedAt: '2026-10-08T12:30:00Z', lastAuditId: id(n + 50),
    payload: { profile: 'houseatlas.geodata-document.v2', title, original, provenance, preview: lineage },
  });
  const documents = [
    { availability: { original: 'available', preview: 'available' }, document: record(1, 3, 'Synthetic parcel survey', surveyPin, {
      agency: 'Synthetic Survey Office', url: 'https://example.invalid/synthetic/parcel-survey',
      license: { status: 'permitted', reference: 'Synthetic open licence 1.0' }, retrievedAt: '2026-10-08T12:00:00Z',
      published: { value: '2019', precision: 'year' },
      // A schema-valid leap second: recorded text is kept, never clock-converted.
      observed: { value: '2016-12-31T23:59:60Z', precision: 'instant' },
      frame: { crs: 'LOCAL:synthetic-site', axes: ['east', 'north'], linearUnit: 'metre', extent: [0, 0, 50, 40] },
      custodyReceiptSha256: 'c'.repeat(64),
    }, { asset: previewPin, inputs: [surveyPin], renderer: 'synthetic-renderer', rendererVersion: '1.0.0',
      rendererConfigSha256: 'd'.repeat(64), qualificationReceiptSha256: 'e'.repeat(64), sourceCropExtent: null,
      description: 'Stripped render of sheet 1 with metadata removed.' }) },
    { availability: { original: 'available', preview: 'not-qualified' }, document: record(2, 2, 'Synthetic outline export', geojsonPin, {
      agency: 'Synthetic Mapping Desk', url: null, license: { status: 'unknown', reference: null }, retrievedAt: '2026-10-07T08:15:00+02:00',
      published: { value: '2024-02-29', precision: 'day' }, observed: null,
      frame: { crs: null, axes: [], linearUnit: null, extent: null }, custodyReceiptSha256: 'f'.repeat(64),
    }, null) },
    { availability: { original: 'stale', preview: 'unavailable' }, document: record(3, 1, 'Synthetic elevation tile', tiffPin, {
      agency: 'Synthetic Survey Office', url: null, license: { status: 'restricted', reference: 'Synthetic internal use only' },
      retrievedAt: '2026-09-30T16:45:00Z', published: null, observed: { value: '2025-06-01', precision: 'day' },
      frame: { crs: 'LOCAL:synthetic-site', axes: ['east', 'north', 'up'], linearUnit: 'metre', extent: [0, 0, -2, 50, 40, 12] },
      custodyReceiptSha256: 'a'.repeat(64),
    }, null) },
  ].map(entry => ({ profile: 'houseatlas.geodata-document-read.v2', scope, ...entry }));
  const base = `/api/atlas/documents/v2/workspaces/${scope.workspaceId}/homes/${scope.homeId}/documents`;
  const json = (value: unknown) => new Response(JSON.stringify(value), { status: 200, headers: { 'Content-Type': 'application/json',
    'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' } });
  const transport: typeof fetch = async (input, init) => {
    init?.signal?.throwIfAborted();
    const url = new URL(String(input));
    if (url.origin !== SYNTHETIC_ORIGIN || init?.method !== 'GET' || init.credentials !== 'same-origin' || init.cache !== 'no-store'
      || init.redirect !== 'error' || init.mode !== 'same-origin' || !url.pathname.startsWith(base))
      throw new TypeError('Unexpected synthetic Documents request');
    const rest = url.pathname.slice(base.length);
    if (rest === '') {
      const cursor = url.searchParams.get('cursor');
      if (url.searchParams.get('limit') !== '50' || (cursor !== null && cursor !== 'synthetic-page-2')) return new Response(null, { status: 422 });
      return json(cursor === null ? { profile: 'houseatlas.geodata-document-list.v2', scope, documents: documents.slice(0, 2), nextCursor: 'synthetic-page-2' }
        : { profile: 'houseatlas.geodata-document-list.v2', scope, documents: documents.slice(2), nextCursor: null });
    }
    const match = /^\/([0-9a-f-]{36})(?:\/(original|preview))?$/.exec(rest);
    const found = match && documents.find(entry => entry.document.recordId === match[1]);
    if (!match || !found) return new Response(null, { status: 404 });
    const mode = match[2];
    if (!mode) return url.search ? new Response(null, { status: 422 }) : json(found);
    if (url.search !== `?expectedRevision=${found.document.revision}`) return new Response(null, { status: 409 });
    const lineage = found.document.payload.preview as { asset: typeof surveyPin } | null;
    const asset = mode === 'original' ? found.document.payload.original : lineage?.asset;
    if (!asset || found.availability[mode as 'original' | 'preview'] !== 'available') return new Response(null, { status: 404 });
    const body = bytes.get(asset.assetId)!, mime = mimes.get(asset.assetId)!;
    // Keys in RFC 8785 order; values are strings and integers only.
    const frame = JSON.stringify({ asset: { assetId: asset.assetId, bytes: asset.bytes, revision: asset.revision, sha256: asset.sha256 },
      documentId: found.document.recordId, documentRevision: found.document.revision, measuredContentType: mime, mode,
      profile: 'houseatlas.geodata-document-bytes.v2', scope: { homeId: scope.homeId, workspaceId: scope.workspaceId } });
    const digest = Uint8Array.from(asset.sha256.match(/../g)!, pair => parseInt(pair, 16));
    return new Response(body.slice(), { status: 200, headers: {
      'Content-Type': mime, 'Content-Length': String(body.byteLength),
      'Content-Disposition': mode === 'original' ? 'attachment; filename="geodata-original"' : 'inline; filename="geodata-preview.png"',
      'x-atlas-document-frame': base64(encoder.encode(frame)).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, ''),
      'content-digest': `sha-256=:${base64(digest)}:`, 'Content-Security-Policy': "sandbox; default-src 'none'",
      'Cache-Control': 'private, no-store', Pragma: 'no-cache', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer',
    } });
  };
  return { origin: SYNTHETIC_ORIGIN, transport, documentIds: [id(1), id(2), id(3)], bytes };
}

export { pdf as syntheticPdf, png as syntheticPng };
