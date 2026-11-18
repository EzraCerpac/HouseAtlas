import { EMBEDDED_IMAGE_LIMITS } from './png.mjs';

const need = (condition, message) => { if (!condition) throw new Error(message); };

// Inspect the whole single-scan profile before PDF.js allocates coefficients.
// In particular, reject extra frames, alternate line counts and tables that
// could make the decoder advance past the segment boundaries inspected here.
function baselineFrame(bytes) {
  const { dimension, pixels, encodedPerImage } = EMBEDDED_IMAGE_LIMITS;
  need(bytes.length >= 4 && bytes.length <= encodedPerImage, 'JPEG encoded size outside the texture profile');
  const data = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  need(data.getUint16(0) === 0xffd8 && data.getUint16(bytes.length - 2) === 0xffd9, 'Incomplete JPEG framing');
  let at = 2, frame, restartInterval = 0;
  while (at + 4 <= bytes.length) {
    need(bytes[at++] === 0xff, 'Invalid JPEG header marker');
    while (bytes[at] === 0xff) at++;
    const marker = bytes[at++], length = at + 2 <= bytes.length ? data.getUint16(at) : 0;
    const body = at + 2, end = at + length;
    need(length >= 2 && end <= bytes.length - 2, 'Invalid JPEG segment length');
    at = end;
    if (marker === 0xc0) {
      need(!frame && length >= 8 && bytes[body] === 8, 'JPEG must have one RGB8 or grayscale baseline frame');
      const height = data.getUint16(body + 1), width = data.getUint16(body + 3), count = bytes[body + 5];
      need(width > 0 && height > 0 && width <= dimension && height <= dimension && width * height <= pixels,
        'JPEG dimensions outside the texture profile');
      need((count === 1 || count === 3) && length === 8 + count * 3, 'Unsupported JPEG component layout');
      const ids = new Set();
      let blocks = 0, maxH = 0, maxV = 0;
      // At 1024 px, PDF.js coefficient storage is below 7 MiB, including
      // MCU padding and a spare block per row, with these component limits.
      for (let i = body + 6; i < end; i += 3) {
        const h = bytes[i + 1] >> 4, v = bytes[i + 1] & 15;
        need(!ids.has(bytes[i]) && h >= 1 && h <= 4 && v >= 1 && v <= 4 && bytes[i + 2] <= 3, 'Invalid JPEG sampling');
        ids.add(bytes[i]); blocks += h * v; maxH = Math.max(maxH, h); maxV = Math.max(maxV, v);
      }
      need(blocks <= 10 && (count !== 1 || blocks === 1), 'JPEG sampling outside the texture profile');
      frame = { width, height, ids, mcus: Math.ceil(width / (8 * maxH)) * Math.ceil(height / (8 * maxV)) };
    } else if (marker === 0xdb) {
      need(length > 2 && (length - 2) % 65 === 0, 'Invalid JPEG quantization segment');
      for (let i = body; i < end; i += 65) need(bytes[i] <= 3, 'Invalid baseline JPEG quantization table');
    } else if (marker === 0xc4) {
      need(body < end, 'Empty JPEG Huffman segment');
      for (let i = body; i < end;) {
        need(i + 17 <= end && [0, 1, 16, 17].includes(bytes[i]), 'Invalid JPEG Huffman table');
        let symbols = 0;
        for (let j = 1; j <= 16; j++) symbols += bytes[i + j];
        i += 17 + symbols;
        need(symbols > 0 && symbols <= 256 && i <= end, 'Invalid JPEG Huffman table length');
      }
    } else if (marker === 0xdd) {
      need(length === 4, 'Invalid JPEG restart segment');
      restartInterval = data.getUint16(body);
    } else if (marker === 0xda) {
      const count = bytes[body], selectors = new Set();
      need(frame && count === frame.ids.size && length === 6 + count * 2, 'JPEG requires one baseline scan of all components');
      for (let i = body + 1; i < end - 3; i += 2) {
        need(frame.ids.has(bytes[i]) && !selectors.has(bytes[i]) && [0, 1, 16, 17].includes(bytes[i + 1]), 'Invalid JPEG scan components');
        selectors.add(bytes[i]);
      }
      need(bytes[end - 3] === 0 && bytes[end - 2] === 63 && bytes[end - 1] === 0, 'Invalid baseline JPEG scan parameters');
      const expected = restartInterval ? Math.floor((frame.mcus - 1) / restartInterval) : 0;
      let restarts = 0;
      for (let i = end; i < bytes.length - 2; i++) {
        if (bytes[i] !== 0xff) continue;
        const start = i;
        while (bytes[i + 1] === 0xff) i++;
        const code = bytes[++i];
        if (code === 0 && i === start + 1) continue; // Entropy byte stuffing.
        if (code === 0xd9 && i === bytes.length - 1) break; // Fill before EOI.
        need(restarts < expected && code === 0xd0 + restarts % 8, 'Unexpected JPEG scan marker');
        restarts++;
      }
      need(end < bytes.length - 2 && restarts === expected, 'Incomplete JPEG scan');
      return frame;
    } else {
      need(marker >= 0xe0 && marker <= 0xef || marker === 0xfe, 'Unsupported JPEG marker (expected baseline JPEG)');
    }
  }
  throw new Error('JPEG has no complete baseline scan');
}

export async function decodeJpeg(bytes) {
  const { width, height, ids } = baselineFrame(bytes);
  // The standalone decoder is already pinned by the frontend npm lock.
  const { JpegImage, VerbosityLevel, getVerbosityLevel, setVerbosityLevel } =
    await import(new URL('../../../frontend/node_modules/pdfjs-dist/image_decoders/pdf.image_decoders.mjs', import.meta.url));
  const decoder = new JpegImage(), warn = console.warn, verbosity = getVerbosityLevel();
  let rgb;
  try {
    // PDF.js normally repairs incomplete PDF images. Fail on any such repair;
    // the warning hook and decoder are synchronous and restored before yielding.
    console.warn = message => { throw new Error(message); };
    setVerbosityLevel(VerbosityLevel.WARNINGS);
    decoder.parse(bytes);
    need(decoder.width === width && decoder.height === height && decoder.numComponents === ids.size, 'JPEG decode disagrees with frame');
    rgb = decoder.getData({ width, height, forceRGB: true });
    need(rgb.length === width * height * 3, 'Invalid JPEG RGB output');
  } catch (error) {
    throw new Error('Malformed embedded JPEG', { cause: error });
  } finally {
    console.warn = warn;
    setVerbosityLevel(verbosity);
  }
  // Preserve JPEG row order and RGB sample values. glTF supplies the sRGB
  // interpretation of the base colour and keeps its original UVs.
  const rgba = new Uint8Array(width * height * 4);
  for (let i = 0, o = 0; i < rgb.length; i += 3, o += 4) {
    rgba[o] = rgb[i]; rgba[o + 1] = rgb[i + 1]; rgba[o + 2] = rgb[i + 2]; rgba[o + 3] = 255;
  }
  return { width, height, rgba };
}
