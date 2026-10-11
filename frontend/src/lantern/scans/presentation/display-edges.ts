const INPUT_FLOATS_PER_TRIANGLE = 18;
const FLOATS_PER_VERTEX = 6;
const MAX_TRIANGLES = 20_000;
const MAX_EDGE_ENTRIES = 20_000;
const MAX_OUTPUT_FLOATS = 120_000;
const MAX_WORK_MS = 2_000;
const CREASE_DOT_LIMIT = 0.985;
const YIELD_EVERY_TRIANGLES = 128;
const YIELD_EVERY_EDGES = 256;

type Vec3 = readonly [number, number, number];

interface EdgeRecord {
  readonly a: Vec3;
  readonly b: Vec3;
  readonly firstNormal: Vec3;
  count: number;
  crease: boolean;
}

function abortError(): Error {
  const error = new Error('Display edge extraction aborted.');
  error.name = 'AbortError';
  return error;
}

function checkAbort(signal: AbortSignal): void {
  if (signal.aborted) throw abortError();
}

function yieldToMain(signal: AbortSignal): Promise<void> {
  checkAbort(signal);
  if (typeof MessageChannel !== 'undefined') {
    return new Promise<void>((resolve, reject) => {
      const channel = new MessageChannel();
      const finish = (callback: () => void) => {
        signal.removeEventListener('abort', onAbort);
        channel.port1.onmessage = null;
        channel.port1.close();
        channel.port2.close();
        callback();
      };
      const onAbort = () => finish(() => reject(abortError()));
      signal.addEventListener('abort', onAbort, { once: true });
      channel.port1.onmessage = () => finish(resolve);
      channel.port2.postMessage(0);
    });
  }

  return new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => finish(resolve), 0);
    const onAbort = () => finish(() => reject(abortError()));
    const finish = (callback: () => void) => {
      clearTimeout(timer);
      signal.removeEventListener('abort', onAbort);
      callback();
    };
    signal.addEventListener('abort', onAbort, { once: true });
  });
}

function unit(x: number, y: number, z: number, label: string): Vec3 {
  if (![x, y, z].every(Number.isFinite)) throw new Error(`${label} is not finite.`);
  const scale = Math.max(Math.abs(x), Math.abs(y), Math.abs(z));
  if (scale === 0) throw new Error(`${label} is degenerate.`);
  const sx = x / scale;
  const sy = y / scale;
  const sz = z / scale;
  const length = Math.hypot(sx, sy, sz);
  if (!Number.isFinite(length) || length === 0) throw new Error(`${label} is degenerate.`);
  return [sx / length, sy / length, sz / length];
}

function dotAbs(a: Vec3, b: Vec3): number {
  return Math.abs(a[0] * b[0] + a[1] * b[1] + a[2] * b[2]);
}

function pointKey(point: Vec3): string {
  // Float32 values are already represented exactly as JS numbers here; string
  // conversion gives equal coordinates one deterministic key for edge joins.
  return `${point[0]},${point[1]},${point[2]}`;
}

function faceNormal(vertices: Float32Array, offset: number): Vec3 {
  const n0 = unit(vertices[offset + 3]!, vertices[offset + 4]!, vertices[offset + 5]!, 'Vertex normal');
  const n1 = unit(vertices[offset + 9]!, vertices[offset + 10]!, vertices[offset + 11]!, 'Vertex normal');
  const n2 = unit(vertices[offset + 15]!, vertices[offset + 16]!, vertices[offset + 17]!, 'Vertex normal');
  return unit(n0[0] + n1[0] + n2[0], n0[1] + n1[1] + n2[1], n0[2] + n1[2] + n2[2], 'Triangle normal');
}

function requireNonDegenerate(a: Vec3, b: Vec3, c: Vec3): void {
  const scale = Math.max(...a.map(Math.abs), ...b.map(Math.abs), ...c.map(Math.abs));
  if (!Number.isFinite(scale) || scale === 0) throw new Error('Degenerate triangle.');
  const ax = a[0] / scale;
  const ay = a[1] / scale;
  const az = a[2] / scale;
  const ux = b[0] / scale - ax;
  const uy = b[1] / scale - ay;
  const uz = b[2] / scale - az;
  const vx = c[0] / scale - ax;
  const vy = c[1] / scale - ay;
  const vz = c[2] / scale - az;
  const area = Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx);
  if (!Number.isFinite(area) || area === 0) throw new Error('Degenerate triangle.');
}

/**
 * Extract only actual mesh boundaries and visible creases for a cosmetic line
 * pass. Input is the prepared per-triangle position/normal buffer; no walls,
 * room outlines, or synthetic geometry are added.
 */
export async function displayEdges(vertices: Float32Array, signal: AbortSignal): Promise<Float32Array> {
  checkAbort(signal);
  if (!(vertices instanceof Float32Array)) throw new Error('Display mesh must be a Float32Array.');
  if (vertices.length === 0 || vertices.length % INPUT_FLOATS_PER_TRIANGLE !== 0) {
    throw new Error('Display mesh has an invalid triangle stride.');
  }

  const triangleCount = vertices.length / INPUT_FLOATS_PER_TRIANGLE;
  if (triangleCount > MAX_TRIANGLES) throw new Error('Display mesh exceeds the triangle work bound.');
  const startedAt = typeof performance !== 'undefined' ? performance.now() : Date.now();
  const edges = new Map<string, EdgeRecord>();
  const checkBudget = () => {
    checkAbort(signal);
    const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
    if (now - startedAt > MAX_WORK_MS) throw new Error('Display edge work budget exceeded.');
  };

  for (let triangle = 0; triangle < triangleCount; triangle++) {
    if (triangle % YIELD_EVERY_TRIANGLES === 0) {
      checkBudget();
      await yieldToMain(signal);
    }
    const base = triangle * INPUT_FLOATS_PER_TRIANGLE;
    const points: Vec3[] = [0, 1, 2].map((corner) => {
      const offset = base + corner * FLOATS_PER_VERTEX;
      const point: Vec3 = [vertices[offset]!, vertices[offset + 1]!, vertices[offset + 2]!];
      if (!point.every(Number.isFinite)) throw new Error('Display mesh has a non-finite position.');
      return point;
    });
    requireNonDegenerate(points[0]!, points[1]!, points[2]!);
    const normal = faceNormal(vertices, base);

    for (let side = 0; side < 3; side++) {
      const a = points[side]!;
      const b = points[(side + 1) % 3]!;
      const aKey = pointKey(a);
      const bKey = pointKey(b);
      if (aKey === bKey) throw new Error('Display mesh has a zero-length edge.');
      const edgeKey = aKey < bKey ? `${aKey}|${bKey}` : `${bKey}|${aKey}`;
      const existing = edges.get(edgeKey);
      if (!existing) {
        if (edges.size >= MAX_EDGE_ENTRIES) throw new Error('Display mesh exceeds the edge-map bound.');
        edges.set(edgeKey, { a, b, firstNormal: normal, count: 1, crease: false });
      } else {
        existing.count++;
        if (dotAbs(existing.firstNormal, normal) < CREASE_DOT_LIMIT) existing.crease = true;
      }
    }
  }

  const outputValues: number[] = [];
  let visited = 0;
  for (const edge of edges.values()) {
    if (visited++ % YIELD_EVERY_EDGES === 0) {
      checkBudget();
      await yieldToMain(signal);
    }
    if (edge.count !== 1 && !edge.crease) continue;
    outputValues.push(...edge.a, ...edge.b);
    if (outputValues.length > MAX_OUTPUT_FLOATS) throw new Error('Display edge output exceeds its size bound.');
  }

  checkBudget();
  const result = new Float32Array(outputValues);
  if (result.length > MAX_OUTPUT_FLOATS || !result.every(Number.isFinite)) {
    throw new Error('Display edge output is invalid.');
  }
  checkAbort(signal);
  return result;
}
