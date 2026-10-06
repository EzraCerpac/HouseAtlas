import { inflateSync, deflateSync } from 'node:zlib';
import { MAX_BYTES, deny } from './bytes.mjs';

const signature = Buffer.from([137,80,78,71,13,10,26,10]);
export function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) { crc ^= byte; for (let n = 0; n < 8; n++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0); }
  return (crc ^ 0xffffffff) >>> 0;
}
export function pngChunk(type, bytes) {
  const data = Buffer.from(bytes), name = Buffer.from(type), result = Buffer.alloc(data.length + 12);
  result.writeUInt32BE(data.length); name.copy(result, 4); data.copy(result, 8);
  result.writeUInt32BE(crc32(Buffer.concat([name, data])), data.length + 8); return result;
}
function paeth(a,b,c) { const p = a+b-c, x = Math.abs(p-a), y = Math.abs(p-b), z = Math.abs(p-c); return x <= y && x <= z ? a : y <= z ? b : c; }

// Deliberately bounded subset: static, noninterlaced 8-bit RGB/RGBA PNG.
// Decode all filters, then emit only IHDR/IDAT/IEND with fresh CRCs and no metadata.
export function renderPng(input, { maxPixels = 25000000, check = () => {} } = {}) {
  const bytes = Buffer.from(input);
  if (bytes.length > MAX_BYTES || !bytes.subarray(0,8).equals(signature)) deny(415);
  let offset = 8, header, state = 0, ended = false, palette = false; const compressed = [];
  while (offset < bytes.length) {
    check(); if (offset + 12 > bytes.length) deny(415);
    const length = bytes.readUInt32BE(offset), end = offset + length + 12;
    if (end > bytes.length) deny(415);
    const name = bytes.subarray(offset+4,offset+8), type = name.toString('latin1'), data = bytes.subarray(offset+8,end-4);
    if (!/^[A-Za-z]{4}$/.test(type) || (name[2] & 32) || crc32(bytes.subarray(offset+4,end-4)) !== bytes.readUInt32BE(end-4)) deny(415);
    if (!header && type !== 'IHDR') deny(415);
    if (type === 'IHDR') {
      if (header || length !== 13) deny(415); header = Buffer.from(data);
      const width = header.readUInt32BE(0), height = header.readUInt32BE(4);
      if (!width || !height || width > 0x7fffffff || height > 0x7fffffff || width*height > maxPixels) deny(413);
      if (header[8] !== 8 || ![2,6].includes(header[9]) || header[10] || header[11] || header[12]) deny(415);
    } else if (type === 'IDAT') {
      if (state === 2) deny(415); state = 1; compressed.push(data);
    } else if (type === 'IEND') {
      if (!compressed.length || length || end !== bytes.length) deny(415); ended = true;
    } else {
      if (state === 1) state = 2;
      if (['acTL','fcTL','fdAT','tRNS'].includes(type)) deny(415);
      if (type === 'PLTE') { if (palette || state || !length || length > 768 || length%3) deny(415); palette = true; }
      else if (!(name[0] & 32)) deny(415);
    }
    offset = end;
  }
  if (!ended) deny(415);
  const width = header.readUInt32BE(0), height = header.readUInt32BE(4), bpp = header[9] === 6 ? 4 : 3;
  const stride = width*bpp, size = height*(stride+1);
  let raw; try { raw = inflateSync(Buffer.concat(compressed), { maxOutputLength: size }); } catch { deny(415); }
  check(); if (raw.length !== size) deny(415);
  const scanlines = Buffer.alloc(size);
  for (let y = 0; y < height; y++) {
    check(); const filter = raw[y*(stride+1)]; if (filter > 4) deny(415);
    for (let x = 0; x < stride; x++) {
      if ((x & 65535) === 0) check();
      const at = y*(stride+1)+1+x, a = x >= bpp ? scanlines[at-bpp] : 0, b = y ? scanlines[at-stride-1] : 0, c = y && x >= bpp ? scanlines[at-stride-1-bpp] : 0;
      const add = [0,a,b,Math.floor((a+b)/2),paeth(a,b,c)][filter];
      scanlines[at] = (raw[y*(stride+1)+1+x]+add) & 255;
    }
  }
  let encoded; try { encoded = deflateSync(scanlines, { level: 6, maxOutputLength: MAX_BYTES }); } catch { deny(413); } check();
  const output = Buffer.concat([signature,pngChunk('IHDR',header),pngChunk('IDAT',encoded),pngChunk('IEND',Buffer.alloc(0))]);
  if (output.length > MAX_BYTES) deny(413); return output;
}

export function validateContent(bytes, contentType, options = {}) {
  if (!(bytes instanceof Uint8Array) || bytes.length > MAX_BYTES) deny(413);
  if (contentType === 'image/png') return renderPng(bytes, options);
  if (contentType === 'application/pdf') {
    const data = Buffer.from(bytes);
    if (!/^%PDF-(?:1\.[0-7]|2\.0)[\r\n]/.test(data.subarray(0,12).toString('latin1')) || !/%%EOF[\t\n\f\r ]*$/.test(data.subarray(-1024).toString('latin1'))) deny(415);
    return null; // Untrusted original download only; no PDF execution/renderer.
  }
  if (contentType === 'text/plain') {
    try { const text = new TextDecoder('utf-8',{fatal:true}).decode(bytes); if (text.includes('\0')) deny(415); } catch { deny(415); }
    return null;
  }
  deny(415); // JPEG/WebP/GIF/SVG/HTML and other PNG variants need a reviewed renderer.
}
