import { GlbFormatError, STANDARD_GLB_LIMITS, type GlbAdmission, type GlbContainer, type GlbLimits } from './glb-preflight';
import type { SourceBaseColor } from './geometry';

/** Frozen houseatlas.embedded-png-material.v1. No browser image decoder, URL,
 * canvas colour management or ImageBitmap enters this path. PNG samples remain
 * RGB8; the GPU's explicitly selected sRGB format handles base colour only. */
export const EMBEDDED_PNG_LIMITS = Object.freeze({ images: 64, dimension: 1024, pixels: 1_048_576,
  encodedPerImage: 2_097_152, scratch: 8_388_608 });
// Per-image bounds cap decoder memory; the image count only bounds the identity
// scan. How many textures fit is the tier's prepared and GPU budget, which
// charges every encoded image, its decoded RGBA and its complete mip chains.
const mib = (bytes: number) => (bytes / 1_048_576).toFixed(1);
type Row = Record<string, unknown>;
function need(value: unknown, message: string): asserts value { if (!value) throw new GlbFormatError('preflight', message); }
const row = (value: unknown): Row => { need(value !== null && typeof value === 'object' && !Array.isArray(value), 'Invalid embedded material record'); return value as Row; };
const list = (value: unknown): Row[] => { if (value === undefined) return []; need(Array.isArray(value), 'Invalid embedded material list'); return value.map(row); };
const at = (value: unknown, length: number): number => { need(Number.isSafeInteger(value) && (value as number) >= 0 && (value as number) < length, 'Embedded material index out of range'); return value as number; };
const whole = (value: unknown): number => { need(Number.isSafeInteger(value) && (value as number) >= 0, 'Invalid embedded byte range'); return value as number; };
const factor = (value: unknown, fallback: number): number => { if (value === undefined) return fallback; need(typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1, 'Invalid core material factor'); return value; };

export function rgbaMipBytes(width: number, height: number): number {
  let total = 0;
  do { total += width * height * 4; if (width === 1 && height === 1) break; width = Math.max(1, Math.floor(width / 2)); height = Math.max(1, Math.floor(height / 2)); } while (true);
  return total;
}
const CRC_TABLE = Uint32Array.from({ length: 256 }, (_, n) => { let c = n; for (let bit = 0; bit < 8; bit++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
function crc32(bytes: Uint8Array, start: number, end: number): number {
  let crc = 0xffffffff; for (let i = start; i < end; i++) crc = CRC_TABLE[(crc ^ bytes[i]!) & 255]! ^ (crc >>> 8); return (crc ^ 0xffffffff) >>> 0;
}
const ADAM7 = [[0, 0, 8, 8], [4, 0, 8, 8], [0, 4, 4, 8], [2, 0, 4, 4], [0, 2, 2, 4], [1, 0, 2, 2], [0, 1, 1, 2]] as const;
interface PngPass { readonly x: number; readonly y: number; readonly dx: number; readonly dy: number; readonly width: number; readonly height: number }
export interface EmbeddedPng {
  readonly key: number; readonly width: number; readonly height: number; readonly encoded: Uint8Array;
  readonly passes: readonly PngPass[];
  readonly inflatedBytes: number; readonly scratchBytes: number; readonly mipBytes: number;
}
/** Complete bounded framing and checksums, before decompression/allocation. */
export function admitRgbPng(bytes: Uint8Array, key = 0): EmbeddedPng {
  need(bytes.byteLength <= EMBEDDED_PNG_LIMITS.encodedPerImage && bytes.byteLength >= 57, 'PNG encoded size outside the profile');
  const signature = [137, 80, 78, 71, 13, 10, 26, 10];
  need(signature.every((v, i) => bytes[i] === v), 'Invalid PNG signature');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = 8, width = 0, height = 0, interlace = 0, ended = false, dataEnded = false, hasData = false, palette = false;
  while (offset < bytes.byteLength) {
    need(offset + 12 <= bytes.byteLength, 'Truncated PNG chunk');
    const size = view.getUint32(offset), end = offset + 12 + size;
    need(end <= bytes.byteLength, 'PNG chunk outside the retained bytes');
    const typeBytes = bytes.subarray(offset + 4, offset + 8);
    need([...typeBytes].every(v => v >= 65 && v <= 90 || v >= 97 && v <= 122) && (typeBytes[2]! & 32) === 0, 'Invalid PNG chunk type');
    const type = String.fromCharCode(...typeBytes);
    need(crc32(bytes, offset + 4, end - 4) === view.getUint32(end - 4), 'PNG checksum mismatch');
    need(offset !== 8 || type === 'IHDR', 'PNG must begin with IHDR');
    if (type === 'IHDR') {
      need(offset === 8 && size === 13, 'Invalid PNG header');
      width = view.getUint32(offset + 8); height = view.getUint32(offset + 12);
      need(width > 0 && height > 0 && width <= EMBEDDED_PNG_LIMITS.dimension && height <= EMBEDDED_PNG_LIMITS.dimension
        && width * height <= EMBEDDED_PNG_LIMITS.pixels, 'PNG dimensions outside the profile');
      need(bytes[offset + 16] === 8 && bytes[offset + 17] === 2 && bytes[offset + 18] === 0 && bytes[offset + 19] === 0,
        'Only RGB8 PNG with core compression and filtering is supported');
      interlace = bytes[offset + 20]!; need(interlace === 0 || interlace === 1, 'Unsupported PNG interlace');
    } else if (type === 'IDAT') {
      need(!dataEnded, 'PNG IDAT chunks must be consecutive'); hasData = true;
    } else {
      if (hasData) dataEnded = true;
      if (type === 'IEND') { need(size === 0 && hasData && end === bytes.byteLength, 'Invalid PNG end'); ended = true; }
      else if (type === 'PLTE') { need(!palette && !hasData && size > 0 && size <= 768 && size % 3 === 0, 'Invalid PNG palette'); palette = true; }
      else {
        need(!['acTL', 'fcTL', 'fdAT'].includes(type), 'Animated PNG is outside the profile');
        need((typeBytes[0]! & 32) !== 0, 'Unknown critical PNG chunk');
        // Ancillary colour profiles are inert. RGB values are not transformed.
        need(type !== 'tRNS', 'PNG transparency is outside the opaque profile');
      }
    }
    offset = end;
  }
  need(ended, 'PNG has no complete end');
  const passes: PngPass[] = (interlace ? ADAM7 : [[0, 0, 1, 1] as const]).map(([x, y, dx, dy]) => ({ x, y, dx, dy,
    width: Math.max(0, Math.ceil((width - x) / dx)), height: Math.max(0, Math.ceil((height - y) / dy)) })).filter(p => p.width > 0 && p.height > 0);
  const inflatedBytes = passes.reduce((n, p) => n + (p.width * 3 + 1) * p.height, 0);
  // Fixed inflated output + at most that much reader output + two RGB rows.
  const scratchBytes = inflatedBytes * 2 + width * 6 + CRC_TABLE.byteLength;
  need(scratchBytes <= EMBEDDED_PNG_LIMITS.scratch, 'PNG application scratch outside the profile');
  return { key, width, height, encoded: bytes, passes, inflatedBytes, scratchBytes, mipBytes: rgbaMipBytes(width, height) };
}

export interface EmbeddedImage { readonly key: number; readonly width: number; readonly height: number; readonly rgba: Uint8Array<ArrayBuffer>; readonly mipBytes: number }
export interface EmbeddedTexture { readonly key: string; readonly image: EmbeddedImage; readonly colorRole: 'srgb' | 'data' }
export interface EmbeddedMaterial {
  readonly baseColor: SourceBaseColor; readonly metallic: number; readonly roughness: number; readonly doubleSided: boolean;
  readonly baseColorTexture?: EmbeddedTexture; readonly normalTexture?: EmbeddedTexture; readonly metallicRoughnessTexture?: EmbeddedTexture;
}
interface TexturePin { readonly image: number; readonly role: 'srgb' | 'data'; readonly key: string }
interface MaterialPin {
  readonly baseColor: SourceBaseColor; readonly metallic: number; readonly roughness: number; readonly doubleSided: boolean;
  readonly baseColorTexture?: TexturePin; readonly normalTexture?: TexturePin; readonly metallicRoughnessTexture?: TexturePin;
}
export interface EmbeddedMaterialPlan {
  readonly images: readonly EmbeddedPng[]; readonly primitives: ReadonlyMap<string, MaterialPin>;
  readonly encodedBytes: number; readonly rgbaBytes: number; readonly scratchBytes: number;
  readonly attributeBytes: number; readonly expandedAttributeBytes: number; readonly preparedBytes: number; readonly gpuBytes: number;
}

/** Called only by the explicit Unified opt-in, after ordinary GLB preflight. */
export function admitEmbeddedPngMaterials(container: GlbContainer, admission: GlbAdmission, limits: GlbLimits = STANDARD_GLB_LIMITS): EmbeddedMaterialPlan {
  const { json, bin } = container, views = list(json.bufferViews), rawImages = list(json.images), images: EmbeddedPng[] = [], imageIds: number[] = [];
  need(rawImages.length <= EMBEDDED_PNG_LIMITS.images, `More than ${EMBEDDED_PNG_LIMITS.images} embedded PNG images`);
  let encodedBytes = 0, rgbaBytes = 0, scratchBytes = 0;
  for (const image of rawImages) {
    need(image.uri === undefined && image.mimeType === 'image/png' && bin !== null, 'Only PNG bufferViews in the retained GLB BIN are supported');
    const pin = views[at(image.bufferView, views.length)]!, start = pin.byteOffset === undefined ? 0 : whole(pin.byteOffset), length = whole(pin.byteLength);
    need(pin.buffer === 0 && pin.byteStride === undefined && start + length <= bin.byteLength, 'Invalid PNG bufferView');
    const bytes = bin.subarray(start, start + length);
    let found = images.find(p => p.encoded.length === bytes.length && p.encoded.every((v, i) => v === bytes[i]));
    if (!found) {
      found = admitRgbPng(bytes, images.length); images.push(found); encodedBytes += bytes.byteLength;
      rgbaBytes += found.width * found.height * 4; scratchBytes = Math.max(scratchBytes, found.scratchBytes);
    }
    imageIds.push(found.key);
  }
  const samplers = list(json.samplers), textures = list(json.textures);
  const textureImages = textures.map(texture => {
    const sampler = samplers[at(texture.sampler, samplers.length)]!;
    need(sampler.magFilter === 9729 && sampler.minFilter === 9987 && (sampler.wrapS ?? 10497) === 10497 && (sampler.wrapT ?? 10497) === 10497,
      'Only linear/trilinear REPEAT sampling is supported');
    return imageIds[at(texture.source, imageIds.length)]!;
  });
  const texture = (value: unknown, role: TexturePin['role']): TexturePin | undefined => {
    if (value === undefined) return;
    const pin = row(value); need((pin.texCoord ?? 0) === 0, 'Only TEXCOORD_0 is supported');
    const image = textureImages[at(pin.index, textureImages.length)]!;
    return { image, role, key: `${image}/9729/9987/10497/10497/${role}` };
  };
  const materials = list(json.materials).map<MaterialPin | null>(material => {
    const pbr = material.pbrMetallicRoughness === undefined ? {} : row(material.pbrMetallicRoughness);
    const baseColorTexture = texture(pbr.baseColorTexture, 'srgb'), normalTexture = texture(material.normalTexture, 'data'), metallicRoughnessTexture = texture(pbr.metallicRoughnessTexture, 'data');
    need(material.occlusionTexture === undefined && material.emissiveTexture === undefined, 'Unsupported texture slot');
    // Untextured materials retain legacy admission and opaque rendering,
    // including core BLEND materials. The new alpha rules apply only to maps.
    if (!baseColorTexture && !normalTexture && !metallicRoughnessTexture) return null;
    for (const [key] of Object.entries(material)) if (key.endsWith('Texture')) need(key === 'normalTexture', 'Unsupported texture slot');
    for (const [key] of Object.entries(pbr)) if (key.endsWith('Texture')) need(['baseColorTexture', 'metallicRoughnessTexture'].includes(key), 'Unsupported texture slot');
    need((material.alphaMode ?? 'OPAQUE') === 'OPAQUE' && (material.doubleSided === undefined || typeof material.doubleSided === 'boolean'), 'Only opaque core materials are supported');
    need(material.emissiveFactor === undefined || Array.isArray(material.emissiveFactor) && material.emissiveFactor.length === 3 && material.emissiveFactor.every(v => v === 0), 'Emissive materials are outside the profile');
    if (normalTexture) need((row(material.normalTexture).scale ?? 1) === 1, 'Only normalScale 1 is supported');
    const rawColor = pbr.baseColorFactor ?? [1, 1, 1, 1]; need(Array.isArray(rawColor) && rawColor.length === 4, 'Invalid base colour factor');
    const baseColor = Object.freeze(rawColor.map(v => factor(v, 1))) as unknown as SourceBaseColor;
    need(baseColor[3] === 1, 'Textured alpha factor must equal 1');
    return { baseColor, metallic: factor(pbr.metallicFactor, 1), roughness: factor(pbr.roughnessFactor, 1), doubleSided: material.doubleSided === true,
      ...(baseColorTexture ? { baseColorTexture } : {}), ...(normalTexture ? { normalTexture } : {}), ...(metallicRoughnessTexture ? { metallicRoughnessTexture } : {}) };
  });
  const accessors = list(json.accessors), primitives = new Map<string, MaterialPin>();
  let attributeBytes = 0, expandedAttributeBytes = 0;
  const usedTextures = new Map<string, TexturePin>();
  const attribute = (raw: unknown, size: number, vertices: number, kind: string) => {
    const a = accessors[at(raw, accessors.length)]!;
    need(a.componentType === 5126 && a.type === `VEC${size}` && a.normalized !== true && a.count === vertices, `Invalid ${kind} accessor`);
    const pin = views[at(a.bufferView, views.length)]!, start = whole(pin.byteOffset ?? 0) + whole(a.byteOffset ?? 0), stride = whole(pin.byteStride ?? size * 4);
    need(bin !== null, 'Missing attribute bytes'); const data = new DataView(bin.buffer, bin.byteOffset, bin.byteLength);
    for (let i = 0; i < vertices; i++) {
      let norm = 0;
      for (let c = 0; c < size; c++) {
        const value = data.getFloat32(start + i * stride + c * 4, true); need(Number.isFinite(value), `Non-finite ${kind}`);
        if (kind === 'UV') need(Math.abs(value) <= 1_000_000, 'UV outside the profile');
        if (kind === 'tangent' && c < 3) norm += value * value;
        if (kind === 'tangent' && c === 3) need(value === -1 || value === 1, 'Invalid tangent handedness');
      }
      if (kind === 'tangent') need(Math.abs(Math.sqrt(norm) - 1) <= .0001, 'Tangent direction is not unit length');
    }
  };
  const meshes = list(json.meshes);
  for (const node of admission.nodes) if (node.meshIndex !== null) {
    list(meshes[node.meshIndex]!.primitives).forEach((primitive, primitiveIndex) => {
      if (primitive.material === undefined) return;
      const material = materials[at(primitive.material, materials.length)]; if (!material) return;
      const attrs = row(primitive.attributes), position = accessors[at(attrs.POSITION, accessors.length)]!, vertices = whole(position.count);
      attribute(attrs.NORMAL, 3, vertices, 'normal'); attribute(attrs.TEXCOORD_0, 2, vertices, 'UV');
      if (material.normalTexture) attribute(attrs.TANGENT, 4, vertices, 'tangent');
      const indices = primitive.indices === undefined ? vertices : whole(accessors[at(primitive.indices, accessors.length)]!.count);
      attributeBytes += vertices * (material.normalTexture ? 36 : 20); expandedAttributeBytes += indices * 36;
      primitives.set(`${node.meshIndex}/${primitiveIndex}`, material);
      for (const pin of [material.baseColorTexture, material.normalTexture, material.metallicRoughnessTexture]) if (pin) usedTextures.set(pin.key, pin);
    });
  }
  const preparedBytes = admission.work.outputBytes + attributeBytes + expandedAttributeBytes + encodedBytes + rgbaBytes + scratchBytes;
  const textureGpuBytes = [...usedTextures.values()].reduce((n, pin) => n + images[pin.image]!.mipBytes, 0);
  const gpuBytes = admission.work.triangles * 72 + expandedAttributeBytes + textureGpuBytes;
  const textureBytes = encodedBytes + rgbaBytes + scratchBytes;
  need(preparedBytes <= limits.outputBytes, `Textured model needs ${mib(preparedBytes)} MiB prepared (${images.length} textures ${mib(textureBytes)} MiB,`
    + ` geometry ${mib(preparedBytes - textureBytes)} MiB); this quality tier allows ${mib(limits.outputBytes)} MiB`);
  need(gpuBytes <= limits.gpuBytes, `Textured model needs ${mib(gpuBytes)} MiB of GPU memory (${usedTextures.size} texture resources ${mib(textureGpuBytes)} MiB,`
    + ` geometry ${mib(gpuBytes - textureGpuBytes)} MiB); this quality tier allows ${mib(limits.gpuBytes)} MiB`);
  return { images, primitives, encodedBytes, rgbaBytes, scratchBytes, attributeBytes, expandedAttributeBytes, preparedBytes, gpuBytes };
}

const paeth = (a: number, b: number, c: number) => { const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c); return pa <= pb && pa <= pc ? a : pb <= pc ? b : c; };
export async function decodeRgbPng(png: EmbeddedPng, signal: AbortSignal): Promise<EmbeddedImage> {
  signal.throwIfAborted();
  need(png.encoded.buffer instanceof ArrayBuffer, 'PNG bytes must be owned ArrayBuffer views');
  const inflated = new Uint8Array(png.inflatedBytes);
  const encoded = new DataView(png.encoded.buffer, png.encoded.byteOffset, png.encoded.byteLength); let chunkOffset = 8;
  // Pull one admitted IDAT view at a time. Tiny IDAT chunks never create an
  // unbounded retained range/view list or an application concatenation buffer.
  const input = new ReadableStream<BufferSource>({ pull(controller) {
    while (chunkOffset < png.encoded.length) {
      const start = chunkOffset, length = encoded.getUint32(start); chunkOffset += length + 12;
      if (encoded.getUint32(start + 4) === 0x49444154 && length > 0) {
        controller.enqueue(new Uint8Array(png.encoded.buffer as ArrayBuffer, png.encoded.byteOffset + start + 8, length)); return;
      }
    }
    controller.close();
  } });
  const reader = input.pipeThrough(new DecompressionStream('deflate')).getReader();
  const abort = () => { void reader.cancel(signal.reason).catch(() => {}); };
  signal.addEventListener('abort', abort, { once: true }); let offset = 0;
  try {
    while (true) { const next = await reader.read(); signal.throwIfAborted(); if (next.done) break;
      need(offset + next.value.byteLength <= inflated.length, 'PNG decompression exceeds its dimensions'); inflated.set(next.value, offset); offset += next.value.length; }
    need(offset === inflated.length, 'PNG decompressed dimensions disagree');
  } catch (error) { await reader.cancel().catch(() => {}); if (signal.aborted) throw signal.reason; if (error instanceof GlbFormatError) throw error; throw new GlbFormatError('load', 'PNG decompression failed'); }
  finally { signal.removeEventListener('abort', abort); reader.releaseLock(); }
  signal.throwIfAborted();
  const rgba = new Uint8Array(png.width * png.height * 4); offset = 0;
  for (const pass of png.passes) {
    let previous = new Uint8Array(pass.width * 3), current = new Uint8Array(pass.width * 3);
    for (let y = 0; y < pass.height; y++) {
      const filter = inflated[offset++]!; need(filter <= 4, 'Unsupported PNG row filter');
      for (let x = 0; x < current.length; x++) { const a = x < 3 ? 0 : current[x - 3]!, b = previous[x]!, c = x < 3 ? 0 : previous[x - 3]!;
        current[x] = (inflated[offset++]! + (filter === 0 ? 0 : filter === 1 ? a : filter === 2 ? b : filter === 3 ? Math.floor((a + b) / 2) : paeth(a, b, c))) & 255; }
      for (let x = 0; x < pass.width; x++) { const out = ((pass.y + y * pass.dy) * png.width + pass.x + x * pass.dx) * 4;
        rgba[out] = current[x * 3]!; rgba[out + 1] = current[x * 3 + 1]!; rgba[out + 2] = current[x * 3 + 2]!; rgba[out + 3] = 255; }
      [previous, current] = [current, previous];
    }
  }
  signal.throwIfAborted(); return { key: png.key, width: png.width, height: png.height, rgba, mipBytes: png.mipBytes };
}

export async function decodeEmbeddedMaterials(plan: EmbeddedMaterialPlan, signal: AbortSignal): Promise<ReadonlyMap<string, EmbeddedMaterial>> {
  const images: EmbeddedImage[] = []; for (const image of plan.images) images.push(await decodeRgbPng(image, signal));
  const resources = new Map<string, EmbeddedTexture>();
  const texture = (pin: TexturePin): EmbeddedTexture => { let found = resources.get(pin.key); if (!found) { found = { key: pin.key, image: images[pin.image]!, colorRole: pin.role }; resources.set(pin.key, found); } return found; };
  const materials = new Map<string, EmbeddedMaterial>();
  for (const [key, pin] of plan.primitives) materials.set(key, { baseColor: pin.baseColor, metallic: pin.metallic, roughness: pin.roughness, doubleSided: pin.doubleSided,
    ...(pin.baseColorTexture ? { baseColorTexture: texture(pin.baseColorTexture) } : {}), ...(pin.normalTexture ? { normalTexture: texture(pin.normalTexture) } : {}),
    ...(pin.metallicRoughnessTexture ? { metallicRoughnessTexture: texture(pin.metallicRoughnessTexture) } : {}) });
  signal.throwIfAborted(); return materials;
}
