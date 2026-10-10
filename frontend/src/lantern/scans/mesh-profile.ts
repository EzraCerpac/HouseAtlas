import { ExactDecimal, isExactDecimal } from '../../numeric/decimal';

/** Local presentation proposal. This is not a native schema or admission grant. */
export const MESH_PROFILE = 'houseatlas.magicplan-authored-mesh.v1';
export const MESH_LIMITS = Object.freeze({
  bytes: 8 * 1024 * 1024, depth: 32, nodes: 750_000, stringLength: 4096,
  numberLength: 64, meshes: 512, vertices: 150_000, triangles: 50_000,
  chain: 64, transformNodes: 2048, readMs: 15_000, workMs: 10_000,
  renderCpuBytes: 32 * 1024 * 1024, gpuBytes: 16 * 1024 * 1024,
  canvasPixels: 1024 * 1024,
});
type Json = null | boolean | string | ExactDecimal | Json[] | { [key: string]: Json };
/** Tokens of usdcat's USDA serialization, not original USDC lexical tokens. */
export type MatrixTokens = readonly string[];
export interface MeshOperation {
  readonly name: 'xformOp:transform'; readonly type: 'matrix4d'; readonly matrixTokens: MatrixTokens;
}
export interface MeshNode {
  readonly path: string; readonly primType: 'Xform' | 'Scope' | 'Mesh'; readonly parentPath: string | null;
  readonly authoredOpOrder: readonly string[] | null; readonly rawOpOrderLiteral: string | null; readonly resetXformStack: boolean;
  readonly operations: readonly MeshOperation[]; readonly localMatrixTokens: MatrixTokens;
}
export interface SourceMesh {
  readonly sourceObjectId: string; readonly sourceName: string;
  readonly authoredOrientation: 'rightHanded' | 'leftHanded' | null;
  readonly resolvedOrientation: 'rightHanded' | 'leftHanded';
  readonly orientationQualification: 'authored' | 'USD schema default; not physically verified';
  readonly authoredDoubleSided: boolean | null;
  readonly positionsLocalTokens: readonly string[]; readonly triangleIndicesTokens: readonly string[];
  readonly faceVertexCounts: { readonly repeatedToken: '3'; readonly count: ExactDecimal };
  readonly vertexCount: ExactDecimal; readonly triangleCount: ExactDecimal;
  /** Mesh first, immediate ancestors thereafter; include identity ancestors. */
  readonly ancestorChain: readonly string[]; readonly appliedChain: readonly string[];
  readonly composedLocalToStageMatrixTokens: MatrixTokens;
}
export interface MeshProfile {
  readonly profile: typeof MESH_PROFILE;
  readonly source: { readonly fileName: string; readonly floorLabel: string; readonly originalSHA256: string; readonly originalBytes: ExactDecimal;
    readonly primaryLayerName: string; readonly primaryLayerSHA256: string; readonly primaryLayerBytes: ExactDecimal;
    readonly serializedUSDASHA256: string; readonly serializedUSDABytes: ExactDecimal };
  readonly converter: { readonly codeSHA256: string; readonly schemaSHA256: string; readonly profileSHA256: string;
    readonly usdcatExecutableSHA256: string; readonly usdcatVersion: string; readonly invocation: string };
  readonly authoredCoordinates: { readonly upAxis: 'X' | 'Y' | 'Z'; readonly metersPerUnitToken: string;
    readonly defaultPrim: string; readonly matrixConvention: string; readonly numericTokenProvenance: string };
  readonly qualification: { readonly physicalScale: 'unknown'; readonly floorAlignment: 'unknown';
    readonly stageToHouseTransform: null; readonly semanticRoomObjects: ExactDecimal };
  readonly nodes: readonly MeshNode[]; readonly meshes: readonly SourceMesh[];
  readonly counts: { readonly meshes: ExactDecimal; readonly vertices: ExactDecimal; readonly triangles: ExactDecimal; readonly nodes: ExactDecimal };
}
export interface ScanFloor {
  /** Opaque owner-provided selector; never interpreted as an asset key or URL. */
  readonly key: string; readonly exportLabel: string;
  readonly derivativeSHA256: string; readonly originalSHA256: string;
}
export interface ScanMeshDelivery {
  readonly viewKey: string; readonly floorKey: string;
  readonly bytes: Uint8Array;
}
/** Owner must bound streaming bytes before delivery, freshly authorize every read,
 * and invalidate on logout, scope/revision, availability or authorization change.
 * No tokens, storage keys, endpoint construction or persistent cache belong here.
 */
export interface ScanMeshReadPort {
  isCurrent(viewKey: string): boolean;
  subscribeInvalidation(viewKey: string, invalidate: () => void): () => void;
  read(viewKey: string, floor: ScanFloor, signal: AbortSignal): Promise<ScanMeshDelivery>;
}

function requireValue(condition: unknown, message: string): asserts condition {
  if (!condition) throw new TypeError(message);
}
function object(value: Json, keys: readonly string[]): Record<string, Json> {
  requireValue(value !== null && typeof value === 'object' && !Array.isArray(value) && !isExactDecimal(value), 'Expected mesh object');
  const record = value as Record<string, Json>;
  requireValue(Object.keys(record).length === keys.length && keys.every(key => Object.hasOwn(record, key)), 'Unsupported mesh fields');
  return record;
}
function text(value: Json | undefined, maximum: number = MESH_LIMITS.stringLength): string {
  requireValue(typeof value === 'string' && value.length > 0 && value.length <= maximum, 'Expected bounded source text'); return value;
}
function digest(value: Json | undefined): string {
  const token = text(value); requireValue(/^[a-f0-9]{64}$/.test(token), 'Expected SHA256'); return token;
}
function array(value: Json | undefined, maximum: number): Json[] {
  requireValue(Array.isArray(value) && value.length <= maximum, 'Mesh array exceeds profile'); return value;
}
function numeric(value: Json | undefined): ExactDecimal {
  requireValue(isExactDecimal(value), 'Expected preserved numeric token');
  // A renderer cannot represent arbitrary exact decimals. Reject overflow and
  // underflow rather than silently substituting Infinity or zero.
  const display = Number(value.token);
  requireValue(Number.isFinite(display) && (display !== 0 || value.isZero), 'Coordinate cannot be displayed');
  return value;
}
function sourceNumeric(value: Json | undefined): string {
  const token = text(value); requireValue(token.length <= MESH_LIMITS.numberLength, 'Source numeric token limit exceeded');
  const exact = usdDecimal(token);
  requireValue(exact.compare(ExactDecimal.parse('-1e12')) >= 0 && exact.compare(ExactDecimal.parse('1e12')) <= 0, 'Source numeric magnitude exceeds profile');
  return token;
}
function sourceInteger(value: Json | undefined, maximum: number): number {
  const token = text(value, 12); requireValue(/^[-+]?\d+$/.test(token), 'Invalid source index token');
  return integer(usdDecimal(token), maximum);
}
function integer(value: Json | undefined, maximum: number): number {
  const exact = numeric(value), whole = exact.toSafeInteger();
  requireValue(whole !== undefined && whole >= 0 && whole <= maximum, 'Invalid bounded mesh integer'); return whole;
}
function numbers(value: Json | undefined, length: number): string[] {
  const entries = array(value, length); requireValue(entries.length === length, 'Invalid mesh dimensions');
  return entries.map(sourceNumeric);
}
function prim(value: Json | undefined): string {
  const path = text(value);
  requireValue(/^\/[A-Za-z_0-9]+(?:\/[A-Za-z_0-9]+)*$/.test(path), 'Unsupported prim path'); return path;
}
/** Validate USDA syntax through an exact canonical representation, retaining the
 * source token untouched. USDA permits +1, .5, 1. and leading integer zeros. */
function usdDecimal(token: string): ExactDecimal {
  const match = /^([-+]?)(\d+\.?\d*|\.\d+)(?:[eE]([-+]?\d+))?$/.exec(token);
  requireValue(match && token.length <= MESH_LIMITS.numberLength, 'Invalid USDA numeric token');
  const exponent = Number(match[3] ?? '0'); requireValue(Math.abs(exponent) <= 100, 'Source exponent exceeds profile');
  const [whole = '', fraction] = match[2]!.split('.');
  const canonical = `${match[1] === '-' ? '-' : ''}${whole.replace(/^0+/, '') || '0'}${fraction === undefined ? '' : `.${fraction || '0'}`}e${exponent}`;
  return ExactDecimal.parse(canonical);
}
type Rational = { readonly coefficient: bigint; readonly shift: number };
const zero: Rational = { coefficient: 0n, shift: 0 };
function rational(token: string): Rational {
  const canonical = usdDecimal(token).token, match = /^(-?)(\d+)(?:\.(\d+))?e(-?\d+)$/.exec(canonical)!;
  const fraction = match[3] ?? '';
  return reduce({ coefficient: BigInt(`${match[1]}${match[2]}${fraction}`), shift: Number(match[4]) - fraction.length });
}
function reduce(value: Rational): Rational {
  let { coefficient, shift } = value;
  if (coefficient === 0n) return zero;
  while (coefficient % 10n === 0n) { coefficient /= 10n; shift++; }
  requireValue(Math.abs(shift) <= 8192 && coefficient.toString().length <= 8192, 'Exact matrix work limit exceeded');
  return { coefficient, shift };
}
function add(a: Rational, b: Rational): Rational {
  if (a.coefficient === 0n) return b; if (b.coefficient === 0n) return a;
  const shift = Math.min(a.shift, b.shift), left = a.shift - shift, right = b.shift - shift;
  requireValue(left <= 8192 && right <= 8192, 'Exact matrix work limit exceeded');
  return reduce({ coefficient: a.coefficient * 10n ** BigInt(left) + b.coefficient * 10n ** BigInt(right), shift });
}
function multiply(a: readonly Rational[], b: readonly Rational[]): Rational[] {
  const out = Array<Rational>(16).fill(zero);
  for (let r = 0; r < 4; r++) for (let c = 0; c < 4; c++) for (let k = 0; k < 4; k++) {
    const left = a[r * 4 + k]!, right = b[k * 4 + c]!;
    out[r * 4 + c] = add(out[r * 4 + c]!, reduce({ coefficient: left.coefficient * right.coefficient, shift: left.shift + right.shift }));
  }
  return out;
}
const identity = (): Rational[] => ['1', '0', '0', '0', '0', '1', '0', '0', '0', '0', '1', '0', '0', '0', '0', '1'].map(rational);
const equalMatrix = (a: readonly Rational[], b: readonly Rational[]): boolean => a.every((value, i) => value.coefficient === b[i]!.coefficient && value.shift === b[i]!.shift);
function affine(value: Json | undefined): string[] {
  const matrix = numbers(value, 16);
  requireValue(usdDecimal(matrix[3]!).isZero && usdDecimal(matrix[7]!).isZero && usdDecimal(matrix[11]!).isZero
    && usdDecimal(matrix[15]!).compare(ExactDecimal.parse('1')) === 0, 'Only affine row-vector transforms supported');
  return matrix;
}

/** Duplicate-rejecting bounded decoder. Numeric tokens enter ExactDecimal before
 * any Number conversion. Cooperative yields bound work intervals, not JS heap.
 * Byte/node/string/depth caps are not a guarantee of a 32 MiB object heap.
 */
async function decode(bytes: Uint8Array, signal: AbortSignal, started: number): Promise<Json> {
  requireValue(bytes.byteLength <= MESH_LIMITS.bytes, 'Mesh byte limit exceeded');
  const source = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  let offset = 0, nodes = 0;
  const checkpoint = async (): Promise<void> => {
    signal.throwIfAborted();
    requireValue(performance.now() - started <= MESH_LIMITS.workMs, 'Mesh work budget exceeded');
    if (nodes % 2048 === 0) { await new Promise<void>(resolve => setTimeout(resolve, 0)); signal.throwIfAborted(); }
  };
  const space = (): void => { while (/\s/.test(source[offset] ?? '') && offset < source.length) {
    requireValue(' \r\n\t'.includes(source[offset]!), 'Invalid JSON whitespace'); offset++;
  } };
  const string = (): string => {
    requireValue(source[offset] === '"', 'Expected JSON string'); const start = offset++;
    let escaped = false;
    while (offset < source.length) {
      const character = source[offset++]!;
      requireValue(offset - start <= MESH_LIMITS.stringLength * 6 + 2, 'Source string limit exceeded');
      if (!escaped && character === '"') {
        // JSON.parse handles only this bounded string token; never the mesh graph.
        const result: unknown = JSON.parse(source.slice(start, offset));
        requireValue(typeof result === 'string' && result.length <= MESH_LIMITS.stringLength, 'Source string limit exceeded'); return result;
      }
      if (!escaped && character === '\\') escaped = true; else escaped = false;
    }
    throw new SyntaxError('Unterminated source string');
  };
  const value = async (depth: number): Promise<Json> => {
    requireValue(depth <= MESH_LIMITS.depth && ++nodes <= MESH_LIMITS.nodes, 'Mesh structure limit exceeded');
    await checkpoint(); space(); const character = source[offset];
    if (character === '"') return string();
    if (character === '{') {
      offset++; space(); const record: Record<string, Json> = Object.create(null) as Record<string, Json>;
      if (source[offset] === '}') { offset++; return record; }
      while (true) {
        const key = string(); requireValue(!Object.hasOwn(record, key), 'Duplicate mesh field'); space();
        requireValue(source[offset++] === ':', 'Expected JSON colon'); record[key] = await value(depth + 1); space();
        const end = source[offset++]; if (end === '}') return record;
        requireValue(end === ',', 'Expected JSON comma'); space();
      }
    }
    if (character === '[') {
      offset++; space(); const entries: Json[] = [];
      if (source[offset] === ']') { offset++; return entries; }
      while (true) {
        entries.push(await value(depth + 1)); space(); const end = source[offset++];
        if (end === ']') return entries; requireValue(end === ',', 'Expected JSON comma');
      }
    }
    for (const [token, result] of [['true', true], ['false', false], ['null', null]] as const) {
      if (source.startsWith(token, offset)) { offset += token.length; return result; }
    }
    const start = offset;
    while (offset < source.length && /[0-9.eE+\-]/.test(source[offset]!)) {
      requireValue(offset - start < MESH_LIMITS.numberLength, 'Numeric token limit exceeded'); offset++;
    }
    requireValue(offset > start, 'Invalid JSON value'); return ExactDecimal.parse(source.slice(start, offset));
  };
  const result = await value(0); space(); requireValue(offset === source.length, 'Trailing mesh data'); return result;
}

function freeze(value: Json): void {
  if (value === null || typeof value !== 'object' || isExactDecimal(value)) return;
  if (Array.isArray(value)) { for (const child of value) freeze(child); }
  else { for (const child of Object.values(value)) freeze(child); }
  Object.freeze(value);
}

/** Stop awaiting an owner read promptly even when its transport is slow. The
 * owner remains responsible for actually releasing its transport on abort. */
function abortable<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const stop = (): void => {
      signal.removeEventListener('abort', stop);
      reject(signal.reason ?? new DOMException('Scan read aborted', 'AbortError'));
    };
    signal.addEventListener('abort', stop, { once: true });
    promise.then(value => { signal.removeEventListener('abort', stop); resolve(value); },
      error => { signal.removeEventListener('abort', stop); reject(error); });
    if (signal.aborted) stop();
  });
}

export async function parseMeshProfile(bytes: Uint8Array, signal: AbortSignal): Promise<MeshProfile> {
  const started = performance.now(), decoded = await decode(bytes, signal, started);
  const checkpoint = async (): Promise<void> => {
    signal.throwIfAborted(); requireValue(performance.now() - started <= MESH_LIMITS.workMs, 'Mesh work budget exceeded');
    await new Promise<void>(resolve => setTimeout(resolve, 0)); signal.throwIfAborted();
  };
  const root = object(decoded, ['profile', 'source', 'converter', 'authoredCoordinates', 'qualification', 'nodes', 'meshes', 'counts']);
  requireValue(root.profile === MESH_PROFILE, 'Unsupported mesh profile');
  const source = object(root.source!, ['fileName', 'floorLabel', 'originalSHA256', 'originalBytes', 'primaryLayerName', 'primaryLayerSHA256', 'primaryLayerBytes', 'serializedUSDASHA256', 'serializedUSDABytes']);
  for (const field of ['fileName', 'floorLabel', 'primaryLayerName']) text(source[field], 256);
  for (const field of ['originalSHA256', 'primaryLayerSHA256', 'serializedUSDASHA256']) digest(source[field]);
  requireValue(integer(source.originalBytes, 10 * 1024 * 1024) > 0, 'Invalid original byte count');
  for (const field of ['primaryLayerBytes', 'serializedUSDABytes']) requireValue(integer(source[field], 32 * 1024 * 1024) > 0, 'Invalid layer byte count');
  const converter = object(root.converter!, ['codeSHA256', 'schemaSHA256', 'profileSHA256', 'usdcatExecutableSHA256', 'usdcatVersion', 'invocation']);
  for (const field of ['codeSHA256', 'schemaSHA256', 'profileSHA256', 'usdcatExecutableSHA256']) digest(converter[field]);
  text(converter.usdcatVersion, 1024);
  requireValue(converter.invocation === 'usdcat local-primary.usdc -o serialized.usda; no flatten, composition or network', 'Unsupported conversion profile');
  const coordinates = object(root.authoredCoordinates!, ['upAxis', 'metersPerUnitToken', 'defaultPrim', 'matrixConvention', 'numericTokenProvenance']);
  requireValue(['X', 'Y', 'Z'].includes(coordinates.upAxis as string), 'Unsupported declared up axis');
  requireValue(usdDecimal(sourceNumeric(coordinates.metersPerUnitToken)).compare(ExactDecimal.parse('0')) > 0, 'Invalid declared units');
  text(coordinates.defaultPrim, 512);
  requireValue(coordinates.matrixConvention === 'row-major storage; row vector p_local * M_mesh * M_parent * ...'
    && coordinates.numericTokenProvenance === 'exact tokens from usdcat USDA serialization; original USDC has binary values, not text lexemes', 'Unsupported coordinate convention');
  const qualification = object(root.qualification!, ['physicalScale', 'floorAlignment', 'stageToHouseTransform', 'semanticRoomObjects']);
  requireValue(qualification.physicalScale === 'unknown' && qualification.floorAlignment === 'unknown'
    && qualification.stageToHouseTransform === null && integer(qualification.semanticRoomObjects, 0) === 0, 'Unsupported physical qualification');
  const counts = object(root.counts!, ['meshes', 'vertices', 'triangles', 'nodes']);
  const declared = { meshes: integer(counts.meshes, MESH_LIMITS.meshes), vertices: integer(counts.vertices, MESH_LIMITS.vertices),
    triangles: integer(counts.triangles, MESH_LIMITS.triangles), nodes: integer(counts.nodes, MESH_LIMITS.transformNodes) };
  const nodeTable = new Map<string, { parent: string | null; reset: boolean; primType: string; matrix: Rational[] }>();
  const rawNodes = array(root.nodes, MESH_LIMITS.transformNodes); requireValue(rawNodes.length > 0, 'Missing shared ancestor nodes');
  for (const rawNode of rawNodes) {
    await checkpoint();
    const node = object(rawNode, ['path', 'primType', 'parentPath', 'authoredOpOrder', 'rawOpOrderLiteral', 'resetXformStack', 'operations', 'localMatrixTokens']);
    const path = prim(node.path), parent = node.parentPath === null ? null : prim(node.parentPath);
    requireValue(!nodeTable.has(path) && parent === (path.lastIndexOf('/') === 0 ? null : path.slice(0, path.lastIndexOf('/'))), 'Invalid shared ancestor node');
    requireValue(['Xform', 'Scope', 'Mesh'].includes(node.primType as string) && typeof node.resetXformStack === 'boolean', 'Unsupported authored node');
    const order = node.authoredOpOrder === null ? null : array(node.authoredOpOrder, 2).map(value => text(value));
    const reset = order?.[0] === '!resetXformStack!';
    const ordered = reset ? order!.slice(1) : (order ?? []);
    requireValue(reset === node.resetXformStack && (ordered.length === 0 || (ordered.length === 1 && ordered[0] === 'xformOp:transform')), 'Unsupported authored operation order');
    if (order === null) requireValue(node.rawOpOrderLiteral === null, 'Unexpected raw operation order');
    else {
      const literal = text(node.rawOpOrderLiteral, 256);
      const rawOrder: unknown = JSON.parse(literal);
      requireValue(Array.isArray(rawOrder) && rawOrder.length === order.length && rawOrder.every((value, i) => value === order[i]), 'Raw operation order disagrees');
    }
    const operations = array(node.operations, 1); requireValue(operations.length === ordered.length, 'Missing or unlisted authored operation');
    let local = identity();
    if (operations.length === 1) {
      const operation = object(operations[0]!, ['name', 'type', 'matrixTokens']);
      requireValue(operation.name === 'xformOp:transform' && operation.type === 'matrix4d', 'Unsupported transform operation');
      local = affine(operation.matrixTokens).map(rational);
    }
    requireValue(node.primType !== 'Scope' || (order === null && operations.length === 0), 'Unsupported Scope properties');
    requireValue(equalMatrix(affine(node.localMatrixTokens).map(rational), local), 'Local matrix disagrees with authored operation');
    nodeTable.set(path, { parent, reset: node.resetXformStack, primType: node.primType as string, matrix: local });
  }
  const usedNodes = new Set<string>(), ids = new Set<string>(); let vertices = 0, triangles = 0;
  const meshes = array(root.meshes, MESH_LIMITS.meshes); requireValue(meshes.length > 0, 'No source meshes');
  for (const rawMesh of meshes) {
    await checkpoint();
    const mesh = object(rawMesh, ['sourceObjectId', 'sourceName', 'positionsLocalTokens', 'triangleIndicesTokens', 'faceVertexCounts', 'ancestorChain', 'appliedChain', 'composedLocalToStageMatrixTokens', 'authoredOrientation', 'resolvedOrientation', 'orientationQualification', 'authoredDoubleSided', 'vertexCount', 'triangleCount']);
    const id = prim(mesh.sourceObjectId); requireValue(!ids.has(id) && nodeTable.get(id)?.primType === 'Mesh', 'Missing or duplicate source mesh node'); ids.add(id); text(mesh.sourceName, 256);
    requireValue(['rightHanded', 'leftHanded', null].includes(mesh.authoredOrientation as string | null)
      && ['rightHanded', 'leftHanded'].includes(mesh.resolvedOrientation as string)
      && (mesh.authoredDoubleSided === null || typeof mesh.authoredDoubleSided === 'boolean'), 'Unsupported source orientation');
    requireValue(mesh.authoredOrientation === null
      ? mesh.resolvedOrientation === 'rightHanded' && mesh.orientationQualification === 'USD schema default; not physically verified'
      : mesh.resolvedOrientation === mesh.authoredOrientation && mesh.orientationQualification === 'authored', 'Orientation qualification disagrees');
    const positions = array(mesh.positionsLocalTokens, MESH_LIMITS.vertices * 3), indices = array(mesh.triangleIndicesTokens, MESH_LIMITS.triangles * 3);
    const vertexCount = integer(mesh.vertexCount, MESH_LIMITS.vertices), triangleCount = integer(mesh.triangleCount, MESH_LIMITS.triangles);
    requireValue(vertexCount > 0 && triangleCount > 0 && positions.length === vertexCount * 3 && indices.length === triangleCount * 3, 'Invalid triangle mesh counts');
    const faces = object(mesh.faceVertexCounts!, ['repeatedToken', 'count']);
    requireValue(faces.repeatedToken === '3' && integer(faces.count, MESH_LIMITS.triangles) === triangleCount, 'Unsupported face counts');
    vertices += vertexCount; triangles += triangleCount;
    requireValue(vertices <= MESH_LIMITS.vertices && triangles <= MESH_LIMITS.triangles, 'Mesh totals exceed profile');
    for (let i = 0; i < positions.length; i++) { sourceNumeric(positions[i]); if (i % 4096 === 0) await checkpoint(); }
    for (let i = 0; i < indices.length; i++) { sourceInteger(indices[i], vertexCount - 1); if (i % 4096 === 0) await checkpoint(); }
    const chain = array(mesh.ancestorChain, MESH_LIMITS.chain); requireValue(chain.length > 0, 'Missing complete authored chain');
    const applied = array(mesh.appliedChain, MESH_LIMITS.chain).map(value => prim(value));
    let expectedPath: string | null = id, composed = identity(), inherits = true; const expectedApplied: string[] = [];
    for (const rawPath of chain) {
      const path = prim(rawPath), node = nodeTable.get(path);
      requireValue(node && path === expectedPath, 'Incomplete ordered ancestor chain');
      usedNodes.add(path); expectedPath = node.parent;
      if (inherits) { expectedApplied.push(path); composed = multiply(composed, node.matrix); }
      if (node.reset) inherits = false;
    }
    requireValue(expectedPath === null && applied.length === expectedApplied.length && applied.every((path, i) => path === expectedApplied[i]), 'Incorrect complete/applied ancestor chain');
    requireValue(equalMatrix(affine(mesh.composedLocalToStageMatrixTokens).map(rational), composed), 'Composed matrix disagrees with exact authored chain');
  }
  requireValue(usedNodes.size === nodeTable.size && [...nodeTable].every(([path, node]) => node.primType !== 'Mesh' || ids.has(path)), 'Unreferenced source nodes');
  requireValue(declared.meshes === meshes.length && declared.nodes === nodeTable.size && declared.vertices === vertices && declared.triangles === triangles, 'Aggregate mesh counts disagree');
  await checkpoint(); freeze(decoded); return decoded as unknown as MeshProfile;
}

export async function readScanMesh(port: ScanMeshReadPort, viewKey: string, floor: ScanFloor, signal: AbortSignal): Promise<MeshProfile> {
  const controller = new AbortController();
  const abort = (): void => controller.abort();
  signal.throwIfAborted(); signal.addEventListener('abort', abort, { once: true });
  const deadline = setTimeout(abort, MESH_LIMITS.readMs);
  let unsubscribe: (() => void) | undefined;
  const current = (): void => { controller.signal.throwIfAborted(); requireValue(port.isCurrent(viewKey), 'Scan authorization is no longer current'); };
  try {
    unsubscribe = port.subscribeInvalidation(viewKey, abort); current();
    requireValue(/^[a-f0-9]{64}$/.test(floor.derivativeSHA256) && /^[a-f0-9]{64}$/.test(floor.originalSHA256), 'Missing owner-provided lineage');
    const delivery = await abortable(port.read(viewKey, floor, controller.signal), controller.signal); current();
    requireValue(delivery.viewKey === viewKey && delivery.floorKey === floor.key && delivery.bytes.byteLength <= MESH_LIMITS.bytes, 'Unexpected mesh delivery');
    // Own the bounded active-view bytes; a port must not mutate a handed-off buffer.
    const bytes = new Uint8Array(delivery.bytes);
    const sha = await crypto.subtle.digest('SHA-256', bytes); current();
    const hash = Array.from(new Uint8Array(sha), byte => byte.toString(16).padStart(2, '0')).join('');
    requireValue(hash === floor.derivativeSHA256, 'Mesh derivative digest mismatch');
    const profile = await parseMeshProfile(bytes, controller.signal); current();
    requireValue(profile.source.originalSHA256 === floor.originalSHA256 && profile.source.floorLabel === floor.exportLabel, 'Mesh source lineage mismatch');
    return profile;
  } finally { clearTimeout(deadline); signal.removeEventListener('abort', abort); unsubscribe?.(); controller.abort(); }
}

export interface RenderMesh {
  readonly sourceObjectId: string; readonly sourceName: string;
  readonly vertices: Float32Array; readonly lines: Float32Array; readonly triangles: number;
}
export interface RenderScene { readonly meshes: readonly RenderMesh[]; readonly bytes: number; }

/** Only render buffers are rounded, centered and fitted. No authored tokens or
 * physical transforms are rewritten. GPU accounting excludes driver overhead.
 */
export async function prepareMeshRender(profile: MeshProfile, signal: AbortSignal): Promise<RenderScene> {
  const started = performance.now();
  const triangles = profile.meshes.reduce((sum, mesh) => sum + mesh.triangleIndicesTokens.length / 3, 0);
  const bytes = triangles * 36 * Float32Array.BYTES_PER_ELEMENT;
  requireValue(bytes <= MESH_LIMITS.renderCpuBytes && bytes <= MESH_LIMITS.gpuBytes, 'Render buffer limit exceeded');
  const minimum = [Infinity, Infinity, Infinity], maximum = [-Infinity, -Infinity, -Infinity];
  for (const mesh of profile.meshes) {
    const matrix = mesh.composedLocalToStageMatrixTokens.map(Number);
    for (let vertex = 0; vertex < mesh.positionsLocalTokens.length; vertex += 3) {
      if (vertex % 6144 === 0) {
        signal.throwIfAborted(); await new Promise<void>(resolve => setTimeout(resolve, 0));
        requireValue(performance.now() - started <= MESH_LIMITS.workMs, 'Render work budget exceeded');
      }
      const local = [0, 1, 2].map(axis => Number(mesh.positionsLocalTokens[vertex + axis]!));
      for (let axis = 0; axis < 3; axis++) {
        const value = local[0]! * matrix[axis]! + local[1]! * matrix[4 + axis]! + local[2]! * matrix[8 + axis]! + matrix[12 + axis]!;
        requireValue(Number.isFinite(value), 'Stage coordinate overflow');
        minimum[axis] = Math.min(minimum[axis]!, value); maximum[axis] = Math.max(maximum[axis]!, value);
      }
    }
  }
  const center = minimum.map((value, i) => value / 2 + maximum[i]! / 2);
  const radius = Math.hypot(...maximum.map((value, i) => value - minimum[i]!)) / 2;
  requireValue(Number.isFinite(radius) && radius > 0, 'Source bounds cannot be fitted');
  const meshes: RenderMesh[] = [];
  for (const mesh of profile.meshes) {
    const count = mesh.triangleIndicesTokens.length / 3, vertices = new Float32Array(count * 18), lines = new Float32Array(count * 18);
    const matrix = mesh.composedLocalToStageMatrixTokens.map(Number);
    const point = (index: string): number[] => {
      const vertex = usdDecimal(index).toSafeInteger()! * 3, local = [0, 1, 2].map(axis => Number(mesh.positionsLocalTokens[vertex + axis]!));
      const result = [0, 1, 2].map(axis => (local[0]! * matrix[axis]! + local[1]! * matrix[4 + axis]! + local[2]! * matrix[8 + axis]! + matrix[12 + axis]! - center[axis]!) / radius);
      requireValue(result.every(Number.isFinite), 'Render coordinate overflow');
      // Proper rotation into the Y-up display basis; never a house registration.
      return profile.authoredCoordinates.upAxis === 'Z' ? [result[0]!, result[2]!, -result[1]!]
        : profile.authoredCoordinates.upAxis === 'X' ? [-result[1]!, result[0]!, result[2]!] : result;
    };
    for (let triangle = 0; triangle < count; triangle++) {
      if (triangle % 1024 === 0) {
        signal.throwIfAborted(); await new Promise<void>(resolve => setTimeout(resolve, 0));
        requireValue(performance.now() - started <= MESH_LIMITS.workMs, 'Render work budget exceeded');
      }
      const p = [0, 1, 2].map(corner => point(mesh.triangleIndicesTokens[triangle * 3 + corner]!));
      const a = p[1]!.map((value, i) => value - p[0]![i]!), b = p[2]!.map((value, i) => value - p[0]![i]!);
      const normal = [a[1]! * b[2]! - a[2]! * b[1]!, a[2]! * b[0]! - a[0]! * b[2]!, a[0]! * b[1]! - a[1]! * b[0]!];
      const length = Math.hypot(...normal); requireValue(length > 0 && Number.isFinite(length), 'Degenerate rendered triangle');
      for (let corner = 0; corner < 3; corner++) {
        vertices.set(p[corner]!, triangle * 18 + corner * 6);
        vertices.set(normal.map(value => value / length), triangle * 18 + corner * 6 + 3);
        lines.set(p[corner]!, triangle * 18 + corner * 6);
        lines.set(p[(corner + 1) % 3]!, triangle * 18 + corner * 6 + 3);
      }
    }
    requireValue(vertices.every(Number.isFinite) && lines.every(Number.isFinite), 'Float32 render overflow');
    meshes.push({ sourceObjectId: mesh.sourceObjectId, sourceName: mesh.sourceName, vertices, lines, triangles: count });
  }
  signal.throwIfAborted(); return { meshes, bytes };
}
