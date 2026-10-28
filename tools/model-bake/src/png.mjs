/** Embedded PNG textures for the overview: decode, halve until they fit a
 * pixel size, encode again. The bake rewrites only what the viewer would admit
 * as authored (embedded-png-material.ts admitRgbPng): opaque 8-bit RGB, not
 * interlaced, with whole, checksummed framing. Anything else is left as
 * authored, for the viewer's own checks to judge, and the caller reports it. */
import { crc32, deflateSync, inflateSync } from 'node:zlib';

const SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
/** The viewer's per-image bounds (EMBEDDED_PNG_LIMITS): larger sources stay refused as authored. */
const LIMITS = { dimension: 1024, pixels: 1_048_576, encoded: 2_097_152 };
const letters = bytes => [...bytes].every(v => v >= 65 && v <= 90 || v >= 97 && v <= 122);

/** RGBA pixels (alpha 255) of a PNG, or null where the bake leaves the PNG as authored. */
export function decodePng(bytes) {
  const png = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (png.length < 57 || png.length > LIMITS.encoded || !png.subarray(0, 8).equals(SIGNATURE)) return null;
  let at = 8, width = 0, height = 0, ended = false, dataEnded = false, palette = false; const data = [];
  while (at < png.length) {
    if (ended || at + 12 > png.length) return null;
    const length = png.readUInt32BE(at), end = at + 12 + length, type = png.subarray(at + 4, at + 8), kind = type.toString('latin1');
    if (end > png.length || !letters(type) || (type[2] & 32) !== 0 || crc32(png.subarray(at + 4, end - 4)) !== png.readUInt32BE(end - 4)) return null;
    const body = png.subarray(at + 8, end - 4);
    if ((at === 8) !== (kind === 'IHDR')) return null;
    if (kind === 'IHDR') {
      if (length !== 13) return null;
      width = body.readUInt32BE(0); height = body.readUInt32BE(4);
      if (width < 1 || height < 1 || width > LIMITS.dimension || height > LIMITS.dimension || width * height > LIMITS.pixels || body[8] !== 8 || body[9] !== 2 || body[10] !== 0 || body[11] !== 0 || body[12] !== 0) return null;
    } else if (kind === 'IDAT') {
      if (dataEnded) return null; data.push(body);
    } else {
      if (data.length) dataEnded = true;
      if (kind === 'IEND') { if (length !== 0 || !data.length) return null; ended = true; }
      else if (kind === 'PLTE') { if (palette || data.length || length === 0 || length > 768 || length % 3) return null; palette = true; }
      else if (((type[0] & 32) === 0 || kind === 'tRNS' || ['acTL', 'fcTL', 'fdAT'].includes(kind))) return null;
    }
    at = end;
  }
  if (!ended) return null;
  const stride = width * 3;
  let raw; try { raw = inflateSync(Buffer.concat(data)); } catch { return null; }
  if (raw.length !== height * (stride + 1)) return null;
  const rgba = new Uint8Array(width * height * 4).fill(255);
  let previous = new Uint8Array(stride);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    if (filter > 4) return null;
    const line = Uint8Array.from(raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1)));
    for (let x = 0; x < stride; x++) {
      const a = x >= 3 ? line[x - 3] : 0, b = previous[x], c = x >= 3 ? previous[x - 3] : 0;
      const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
      line[x] = (line[x] + [0, a, b, (a + b) >> 1, pa <= pb && pa <= pc ? a : pb <= pc ? b : c][filter]) & 255;
    }
    for (let x = 0; x < width; x++) rgba.set(line.subarray(x * 3, x * 3 + 3), (y * width + x) * 4);
    previous = line;
  }
  return { width, height, rgba };
}

const chunk = (kind, body) => {
  const head = Buffer.alloc(8); head.writeUInt32BE(body.length, 0); head.write(kind, 4, 'latin1');
  const tail = Buffer.alloc(4); tail.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), body])), 0);
  return Buffer.concat([head, body, tail]);
};

/** An 8-bit RGB PNG with Paeth-filtered rows, from opaque RGBA pixels. */
export function encodePng({ width, height, rgba }) {
  for (let i = 3; i < rgba.length; i += 4) if (rgba[i] !== 255) throw new RangeError('encodePng writes opaque RGB only');
  const channels = 3, stride = width * channels, raw = Buffer.alloc(height * (stride + 1));
  let previous = new Uint8Array(stride);
  for (let y = 0; y < height; y++) {
    const line = new Uint8Array(stride);
    for (let x = 0; x < width; x++) for (let k = 0; k < channels; k++) line[x * channels + k] = rgba[(y * width + x) * 4 + k];
    raw[y * (stride + 1)] = 4;
    for (let x = 0; x < stride; x++) {
      const a = x >= channels ? line[x - channels] : 0, b = previous[x], c = x >= channels ? previous[x - channels] : 0;
      const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
      raw[y * (stride + 1) + 1 + x] = (line[x] - (pa <= pb && pa <= pc ? a : pb <= pc ? b : c)) & 255;
    }
    previous = line;
  }
  const header = Buffer.alloc(13); header.writeUInt32BE(width, 0); header.writeUInt32BE(height, 4); header[8] = 8; header[9] = 2;
  return new Uint8Array(Buffer.concat([SIGNATURE, chunk('IHDR', header), chunk('IDAT', deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]));
}

const toLinear = Float32Array.from({ length: 256 }, (_, v) => { const c = v / 255; return c <= .04045 ? c / 12.92 : ((c + .055) / 1.055) ** 2.4; });
const toSrgb = value => { const c = value <= .0031308 ? value * 12.92 : 1.055 * value ** (1 / 2.4) - .055; return Math.round(Math.min(1, Math.max(0, c)) * 255); };

/** Halves the image (2 × 2 box, the last row or column repeated on odd sizes)
 * until neither side exceeds `size`. Colour maps average in linear light,
 * normal maps average the vectors and renormalize, data maps average as stored. */
export function shrinkImage(image, size, role) {
  if (!(size >= 1)) throw new RangeError(`texture size ${size} is below one pixel`);
  let { width, height, rgba } = image;
  while (width > size || height > size) {
    const w = Math.max(1, Math.ceil(width / 2)), h = Math.max(1, Math.ceil(height / 2)), out = new Uint8Array(w * h * 4);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const taps = [[2 * x, 2 * y], [2 * x + 1, 2 * y], [2 * x, 2 * y + 1], [2 * x + 1, 2 * y + 1]]
        .map(([sx, sy]) => (Math.min(sy, height - 1) * width + Math.min(sx, width - 1)) * 4);
      const o = (y * w + x) * 4;
      if (role === 'normal') {
        let nx = 0, ny = 0, nz = 0;
        for (const t of taps) { nx += rgba[t] / 127.5 - 1; ny += rgba[t + 1] / 127.5 - 1; nz += rgba[t + 2] / 127.5 - 1; }
        const length = Math.hypot(nx, ny, nz) || 1;
        out[o] = Math.round((nx / length + 1) * 127.5); out[o + 1] = Math.round((ny / length + 1) * 127.5); out[o + 2] = Math.round((nz / length + 1) * 127.5);
      } else for (let k = 0; k < 3; k++) {
        out[o + k] = role === 'srgb' ? toSrgb(taps.reduce((sum, t) => sum + toLinear[rgba[t + k]], 0) / 4)
          : Math.round(taps.reduce((sum, t) => sum + rgba[t + k], 0) / 4);
      }
      out[o + 3] = Math.round(taps.reduce((sum, t) => sum + rgba[t + 3], 0) / 4);
    }
    width = w; height = h; rgba = out;
  }
  return { width, height, rgba };
}
