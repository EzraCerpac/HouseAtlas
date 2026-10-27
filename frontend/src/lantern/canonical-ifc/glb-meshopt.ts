import { GlbFormatError, readGlbContainer, STANDARD_GLB_LIMITS, type GlbLimits } from './glb-preflight';

/** Transfer compression for publication GLBs: `EXT_meshopt_compression`,
 * expanded back to the plain closed profile before anything else reads the
 * file. The preflight, the loader and every budget then see exactly the
 * decoded GLB, so compression never widens what is admitted; only the bytes
 * on the wire and in the offline cache shrink. Pins and digests stay on the
 * served (compressed) bytes.
 *
 * The admitted subset is what tools/model-bake writes and the backend expands
 * the same way (backend/src/config/atlas_scene_meshopt.rs): one GLB buffer,
 * one fallback buffer that every compressed view decodes into, and views in
 * `ATTRIBUTES` mode (4-, 8-, 12- or 16-byte float vertices) or `TRIANGLES` (2- or 4-byte
 * indices) mode without filters. Anything else is refused. */
export const MESHOPT = 'EXT_meshopt_compression';

type Row = Record<string, unknown>;
const isRow = (value: unknown): value is Row => value !== null && typeof value === 'object' && !Array.isArray(value);
function need(ok: unknown, reason: string): asserts ok { if (!ok) throw new GlbFormatError('container', reason); }
const integer = (value: unknown, min = 0) => Number.isInteger(value) && (value as number) >= min && (value as number) <= 0x7fffffff;
const only = (row: Row, keys: readonly string[]) => Object.keys(row).every(key => keys.includes(key));
const VIEW_EXTENSION = ['buffer', 'byteOffset', 'byteLength', 'byteStride', 'count', 'mode', 'filter'];

/** Whether the GLB declares meshopt compression; plain GLBs pass through untouched. */
export const usesMeshopt = (json: Row) => Array.isArray(json.extensionsUsed) && json.extensionsUsed.includes(MESHOPT);

interface Span { readonly offset: number; readonly length: number; readonly compressed?: { readonly offset: number; readonly length: number;
  readonly count: number; readonly stride: number; readonly mode: 'ATTRIBUTES' | 'TRIANGLES' } }

/** Returns `bytes` unchanged when nothing is compressed, otherwise the
 * equivalent plain GLB: one buffer, every view decoded in declaration order,
 * the extension removed. Refuses before decoding when the decoded views would
 * exceed `limits.bytes`. */
export async function expandMeshoptGlb(bytes: Uint8Array, limits: GlbLimits = STANDARD_GLB_LIMITS): Promise<Uint8Array> {
  if (bytes.byteLength > limits.bytes) throw new GlbFormatError('container', 'File is larger than the preview limit');
  const { json, bin } = readGlbContainer(bytes, limits);
  if (!usesMeshopt(json)) return bytes;
  const used = json.extensionsUsed as unknown[], required = json.extensionsRequired;
  need(used.length === 1 && Array.isArray(required) && required.length === 1 && required[0] === MESHOPT, 'Only meshopt compression is supported');
  need(bin !== null, 'A compressed GLB needs its BIN chunk');
  const buffers = json.buffers;
  need(Array.isArray(buffers) && buffers.length === 2 && buffers.every(isRow), 'A compressed GLB has one GLB buffer and one fallback buffer');
  const [glbBuffer, fallback] = buffers as Row[];
  need(glbBuffer!.uri === undefined && glbBuffer!.extensions === undefined && integer(glbBuffer!.byteLength, 1)
    && (glbBuffer!.byteLength as number) <= bin.byteLength, 'The GLB buffer must be the BIN chunk');
  const fallbackExtension = isRow(fallback!.extensions) ? fallback!.extensions[MESHOPT] : undefined;
  need(fallback!.uri === undefined && isRow(fallback!.extensions) && only(fallback!.extensions, [MESHOPT]) && isRow(fallbackExtension)
    && only(fallbackExtension, ['fallback']) && fallbackExtension.fallback === true && integer(fallback!.byteLength, 1), 'Invalid fallback buffer');
  const binLength = glbBuffer!.byteLength as number, fallbackLength = fallback!.byteLength as number;
  const views = json.bufferViews;
  need(Array.isArray(views) && views.every(isRow), 'Buffer views must be a list of objects');
  let decoded = 0;
  const spans: Span[] = (views as Row[]).map((view, at) => {
    const offset = view.byteOffset ?? 0, length = view.byteLength;
    need(integer(offset) && integer(length, 1), `Buffer view ${at} has an invalid range`);
    decoded += length as number;
    need(decoded <= limits.bytes, 'Decoded buffer views exceed the preview limit');
    if (view.buffer === 0) {
      need(view.extensions === undefined && (offset as number) + (length as number) <= binLength, `Buffer view ${at} is outside the buffer`);
      return { offset: offset as number, length: length as number };
    }
    const extension = isRow(view.extensions) ? view.extensions[MESHOPT] : undefined;
    need(view.buffer === 1 && isRow(view.extensions) && only(view.extensions, [MESHOPT]) && isRow(extension) && only(extension, VIEW_EXTENSION),
      `Buffer view ${at} must be meshopt compressed`);
    need((offset as number) + (length as number) <= fallbackLength, `Buffer view ${at} is outside the fallback buffer`);
    const { mode, count, byteStride: stride } = extension, source = extension.byteOffset ?? 0;
    need(extension.buffer === 0 && integer(source) && integer(extension.byteLength, 1)
      && (source as number) + (extension.byteLength as number) <= binLength, `Buffer view ${at} reads outside the BIN chunk`);
    need(extension.filter === undefined || extension.filter === 'NONE', `Buffer view ${at} uses a meshopt filter`);
    need(integer(count, 1) && integer(stride, 1) && (count as number) * (stride as number) === length, `Buffer view ${at} declares another decoded size`);
    if (mode === 'ATTRIBUTES')
      need([4, 8, 12, 16].includes(stride as number) && view.byteStride === stride, `Buffer view ${at} has an unsupported stride`);
    else need(mode === 'TRIANGLES' && (stride === 2 || stride === 4) && (count as number) % 3 === 0 && view.byteStride === undefined,
      `Buffer view ${at} has an unsupported meshopt mode`);
    return { offset: offset as number, length: length as number,
      compressed: { offset: source as number, length: extension.byteLength as number, count: count as number, stride: stride as number, mode } };
  });
  // The decoder (WebAssembly) loads only for a compressed file.
  const { MeshoptDecoder } = await import('three/examples/jsm/libs/meshopt_decoder.module.js');
  await MeshoptDecoder.ready;
  const pad = (length: number) => (length + 3) & ~3;
  const out = new Uint8Array(spans.reduce((sum, span) => sum + pad(span.length), 0));
  let at = 0;
  const placed = spans.map((span, index) => {
    const target = out.subarray(at, at + span.length), { compressed } = span;
    if (!compressed) target.set(bin.subarray(span.offset, span.offset + span.length));
    else try {
      MeshoptDecoder.decodeGltfBuffer(target, compressed.count, compressed.stride,
        bin.subarray(compressed.offset, compressed.offset + compressed.length), compressed.mode);
    } catch { throw new GlbFormatError('container', `Buffer view ${index} could not be decoded`); }
    const offset = at; at += pad(span.length);
    return offset;
  });
  const { extensionsUsed: _used, extensionsRequired: _required, ...rest } = json;
  return writePlainGlb({ ...rest, buffers: [{ byteLength: out.byteLength }],
    bufferViews: (views as Row[]).map(({ extensions: _extensions, ...view }, index) => ({ ...view, buffer: 0, byteOffset: placed[index] })) }, out);
}

function writePlainGlb(json: Row, bin: Uint8Array): Uint8Array {
  const text = new TextEncoder().encode(JSON.stringify(json)), pad = (length: number) => (length + 3) & ~3;
  const jsonLength = pad(text.byteLength), total = 28 + jsonLength + bin.byteLength;
  const out = new Uint8Array(total), view = new DataView(out.buffer);
  view.setUint32(0, 0x46546c67, true); view.setUint32(4, 2, true); view.setUint32(8, total, true);
  view.setUint32(12, jsonLength, true); view.setUint32(16, 0x4e4f534a, true);
  out.set(text, 20); out.fill(0x20, 20 + text.byteLength, 20 + jsonLength);
  view.setUint32(20 + jsonLength, bin.byteLength, true); view.setUint32(24 + jsonLength, 0x004e4942, true);
  out.set(bin, 28 + jsonLength);
  return out;
}
