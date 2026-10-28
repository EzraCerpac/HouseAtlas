/** Embedded PNG textures for the overview: decode, halve until they fit a
 * pixel size, encode again. Only what an overview map needs: 8-bit greyscale,
 * RGB, palette, grey-alpha and RGBA, not interlaced. Anything else is left as
 * authored, and the caller reports it. */
import { deflateSync, inflateSync } from 'node:zlib';

const SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const CHANNELS = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 };

/** RGBA pixels of a PNG, or null where this decoder does not read the format. */
export function decodePng(bytes) {
  const png = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (png.length < 8 || !png.subarray(0, 8).equals(SIGNATURE)) return null;
  let at = 8, width = 0, height = 0, type = -1, palette = null, alpha = null; const data = [];
  while (at + 8 <= png.length) {
    const length = png.readUInt32BE(at), kind = png.toString('latin1', at + 4, at + 8), body = png.subarray(at + 8, at + 8 + length);
    if (kind === 'IHDR') {
      width = body.readUInt32BE(0); height = body.readUInt32BE(4); type = body[9];
      if (body[8] !== 8 || body[12] !== 0 || !(type in CHANNELS)) return null;
    } else if (kind === 'PLTE') palette = body;
    else if (kind === 'tRNS') alpha = body;
    else if (kind === 'IDAT') data.push(body);
    else if (kind === 'IEND') break;
    at += 12 + length;
  }
  if (width < 1 || height < 1 || (type === 3 && !palette)) return null;
  const channels = CHANNELS[type], stride = width * channels, raw = inflateSync(Buffer.concat(data));
  if (raw.length < height * (stride + 1)) return null;
  const rgba = new Uint8Array(width * height * 4);
  let previous = new Uint8Array(stride);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)], line = Uint8Array.from(raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1)));
    for (let x = 0; x < stride; x++) {
      const a = x >= channels ? line[x - channels] : 0, b = previous[x], c = x >= channels ? previous[x - channels] : 0;
      const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
      line[x] = (line[x] + [0, a, b, (a + b) >> 1, pa <= pb && pa <= pc ? a : pb <= pc ? b : c][filter]) & 255;
    }
    for (let x = 0; x < width; x++) {
      const s = x * channels, o = (y * width + x) * 4;
      if (type === 3) {
        const i = line[s]; rgba.set(palette.subarray(i * 3, i * 3 + 3), o); rgba[o + 3] = alpha && i < alpha.length ? alpha[i] : 255;
      } else if (channels <= 2) {
        rgba[o] = rgba[o + 1] = rgba[o + 2] = line[s]; rgba[o + 3] = channels === 2 ? line[s + 1] : 255;
      } else {
        rgba[o] = line[s]; rgba[o + 1] = line[s + 1]; rgba[o + 2] = line[s + 2]; rgba[o + 3] = channels === 4 ? line[s + 3] : 255;
      }
    }
    previous = line;
  }
  return { width, height, rgba };
}

const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc = bytes => { let c = 0xffffffff; for (const byte of bytes) c = crcTable[(c ^ byte) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
const chunk = (kind, body) => {
  const head = Buffer.alloc(8); head.writeUInt32BE(body.length, 0); head.write(kind, 4, 'latin1');
  const tail = Buffer.alloc(4); tail.writeUInt32BE(crc(Buffer.concat([head.subarray(4), body])), 0);
  return Buffer.concat([head, body, tail]);
};

/** An RGB PNG, or RGBA where any pixel is not opaque; Paeth-filtered rows. */
export function encodePng({ width, height, rgba }) {
  let opaque = true; for (let i = 3; i < rgba.length; i += 4) if (rgba[i] !== 255) { opaque = false; break; }
  const channels = opaque ? 3 : 4, stride = width * channels, raw = Buffer.alloc(height * (stride + 1));
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
  const header = Buffer.alloc(13); header.writeUInt32BE(width, 0); header.writeUInt32BE(height, 4); header[8] = 8; header[9] = opaque ? 2 : 6;
  return new Uint8Array(Buffer.concat([SIGNATURE, chunk('IHDR', header), chunk('IDAT', deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]));
}

const toLinear = Float32Array.from({ length: 256 }, (_, v) => { const c = v / 255; return c <= .04045 ? c / 12.92 : ((c + .055) / 1.055) ** 2.4; });
const toSrgb = value => { const c = value <= .0031308 ? value * 12.92 : 1.055 * value ** (1 / 2.4) - .055; return Math.round(Math.min(1, Math.max(0, c)) * 255); };

/** Halves the image (2 × 2 box, the last row or column repeated on odd sizes)
 * until neither side exceeds `size`. Colour maps average in linear light,
 * normal maps average the vectors and renormalize, data maps average as stored. */
export function shrinkImage(image, size, role) {
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
