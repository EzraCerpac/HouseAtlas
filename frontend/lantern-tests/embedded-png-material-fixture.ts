/** Public, generated RGB samples only; no model, native data or transport. */
const table = Uint32Array.from({ length: 256 }, (_, n) => { let c = n; for (let i = 0; i < 8; i++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
function chunk(type: string, data: Uint8Array<ArrayBuffer>) {
  const out = new Uint8Array(data.length + 12), view = new DataView(out.buffer); view.setUint32(0, data.length);
  out.set(new TextEncoder().encode(type), 4); out.set(data, 8); let crc = 0xffffffff;
  for (let i = 4; i < out.length - 4; i++) crc = table[(crc ^ out[i]!) & 255]! ^ (crc >>> 8);
  view.setUint32(out.length - 4, (crc ^ 0xffffffff) >>> 0); return out;
}
const paeth = (a: number, b: number, c: number) => { const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c); return pa <= pb && pa <= pc ? a : pb <= pc ? b : c; };
export async function generatedRgbPng(width: number, height: number, interlace = false, filter = 0, role = 0, splitIdat = false) {
  const rgba = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const at = (y * width + x) * 4;
    const rgb = role === 1 ? [128, 128, 255] : role === 2 ? [240, 64, 128] : [x % 2 ? 200 : 20, y % 2 ? 170 : 30, 90];
    rgba.set([...rgb, 255], at);
  }
  const passes = interlace ? [[0, 0, 8, 8], [4, 0, 8, 8], [0, 4, 4, 8], [2, 0, 4, 4], [0, 2, 2, 4], [1, 0, 2, 2], [0, 1, 1, 2]] : [[0, 0, 1, 1]];
  const bytes: number[] = [];
  for (const [sx, sy, dx, dy] of passes) {
    const pw = Math.max(0, Math.ceil((width - sx!) / dx!)), ph = Math.max(0, Math.ceil((height - sy!) / dy!));
    if (!pw || !ph) continue; let previous = new Uint8Array(pw * 3);
    for (let y = 0; y < ph; y++) {
      const current = new Uint8Array(pw * 3);
      for (let x = 0; x < pw; x++) for (let c = 0; c < 3; c++) current[x * 3 + c] = rgba[((sy! + y * dy!) * width + sx! + x * dx!) * 4 + c]!;
      bytes.push(filter);
      for (let x = 0; x < current.length; x++) { const a = x < 3 ? 0 : current[x - 3]!, b = previous[x]!, c = x < 3 ? 0 : previous[x - 3]!;
        const predictor = filter === 0 ? 0 : filter === 1 ? a : filter === 2 ? b : filter === 3 ? Math.floor((a + b) / 2) : paeth(a, b, c);
        bytes.push((current[x]! - predictor) & 255); }
      previous = current;
    }
  }
  const compressed = await new Response(new ReadableStream<BufferSource>({ start(controller) { controller.enqueue(Uint8Array.from(bytes)); controller.close(); } }).pipeThrough(new CompressionStream('deflate'))).arrayBuffer();
  const header = new Uint8Array(13), hv = new DataView(header.buffer); hv.setUint32(0, width); hv.setUint32(4, height); header[8] = 8; header[9] = 2; header[12] = interlace ? 1 : 0;
  const chunks = [new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', header)], data = new Uint8Array(compressed);
  const step = splitIdat ? 7 : data.length; for (let at = 0; at < data.length; at += step) chunks.push(chunk('IDAT', data.slice(at, at + step)));
  chunks.push(chunk('IEND', new Uint8Array()));
  const png = new Uint8Array(chunks.reduce((n, c) => n + c.length, 0)); let offset = 0; for (const c of chunks) { png.set(c, offset); offset += c.length; }
  return { png, rgba };
}

export async function generatedMaterialGlb(size = 3, sharedImages = false) {
  const unique = sharedImages ? await generatedRgbPng(size, size === 3 ? 5 : size) : null;
  const images = unique ? [unique, unique, unique] : await Promise.all([0, 1, 2].map(role => generatedRgbPng(size, size === 3 ? 5 : size, role === 1, role + 1, role)));
  const pieces: Uint8Array<ArrayBuffer>[] = [], views: { buffer: number; byteOffset: number; byteLength: number }[] = []; let length = 0;
  const add = (bytes: Uint8Array<ArrayBuffer>) => { const padding = (4 - length % 4) % 4; if (padding) { pieces.push(new Uint8Array(padding)); length += padding; }
    const id = views.length; views.push({ buffer: 0, byteOffset: length, byteLength: bytes.length }); pieces.push(bytes); length += bytes.length; return id; };
  const positions = add(new Uint8Array(new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]).buffer));
  const normals = add(new Uint8Array(new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1]).buffer));
  const uv = add(new Uint8Array(new Float32Array([0, 0, 1, 0, 0, 1]).buffer));
  const tangents = add(new Uint8Array(new Float32Array([1, 0, 0, 1, 1, 0, 0, 1, 1, 0, 0, 1]).buffer));
  const indices = add(new Uint8Array(new Uint16Array([0, 1, 2]).buffer));
  const imageViews = images.map(image => add(image.png));
  const json = { asset: { version: '2.0', generator: 'HouseAtlas generated RGB8 frontend fixture' }, buffers: [{ byteLength: length }], bufferViews: views,
    accessors: [{ bufferView: positions, componentType: 5126, count: 3, type: 'VEC3', min: [0, 0, 0], max: [1, 1, 0] },
      { bufferView: normals, componentType: 5126, count: 3, type: 'VEC3' }, { bufferView: uv, componentType: 5126, count: 3, type: 'VEC2' },
      { bufferView: tangents, componentType: 5126, count: 3, type: 'VEC4' }, { bufferView: indices, componentType: 5123, count: 3, type: 'SCALAR' }],
    images: imageViews.map(bufferView => ({ bufferView, mimeType: 'image/png' })), textures: [0, 1, 2].map(source => ({ source, sampler: 0 })),
    samplers: [{ magFilter: 9729, minFilter: 9987 }],
    materials: [{ alphaMode: 'OPAQUE', doubleSided: true, pbrMetallicRoughness: { baseColorFactor: [.8, .6, .4, 1], metallicFactor: .3, roughnessFactor: .7,
      baseColorTexture: { index: 0 }, metallicRoughnessTexture: { index: 2 } }, normalTexture: { index: 1, scale: 1 } },
      { alphaMode: 'BLEND', pbrMetallicRoughness: { baseColorFactor: [.2, .4, .6, .25] } }],
    meshes: [{ primitives: [0, 1].map(material => ({ attributes: { POSITION: 0, NORMAL: 1, TEXCOORD_0: 2, TANGENT: 3 }, indices: 4, material })) }],
    nodes: [{ mesh: 0 }, { mesh: 0, translation: [4, 0, 0], scale: [2, 3, -1] }], scenes: [{ nodes: [0, 1] }], scene: 0 };
  const text = new TextEncoder().encode(JSON.stringify(json)), paddedJson = (text.length + 3) & ~3, paddedBin = (length + 3) & ~3;
  const bytes = new Uint8Array(28 + paddedJson + paddedBin), view = new DataView(bytes.buffer);
  view.setUint32(0, 0x46546c67, true); view.setUint32(4, 2, true); view.setUint32(8, bytes.length, true); view.setUint32(12, paddedJson, true); view.setUint32(16, 0x4e4f534a, true);
  bytes.set(text, 20); bytes.fill(32, 20 + text.length, 20 + paddedJson); view.setUint32(20 + paddedJson, paddedBin, true); view.setUint32(24 + paddedJson, 0x004e4942, true);
  let offset = 28 + paddedJson; for (const piece of pieces) { bytes.set(piece, offset); offset += piece.length; }
  return { bytes, images, json };
}
