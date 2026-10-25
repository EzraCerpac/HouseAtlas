import {
  BufferAttribute, BufferGeometry, CustomBlending, DataTexture, DoubleSide, FloatType, InterleavedBuffer, InterleavedBufferAttribute,
  LinearFilter, LinearMipmapLinearFilter, LinearSRGBColorSpace, Mesh, NearestFilter, NoColorSpace, NoToneMapping, NodeMaterial,
  OneFactor, OneMinusSrcAlphaFactor, OrthographicCamera, RepeatWrapping, RGBAFormat, Scene, SRGBColorSpace, UnsignedByteType, Vector2, Vector3, Vector4,
  WebGPUCoordinateSystem, WebGPURenderer, type Node,
} from 'three/webgpu';
import {
  attribute, clamp, cross, dot, float, Fn, int, ivec2, length, mat3, max, mix, normalize, pow, select, step, texture, textureLoad,
  uniform, varying, vec3, vec4, Discard, frontFacing, positionGeometry,
} from 'three/tsl';
import type { PreparedMesh, Projection } from './geometry';
import type { EmbeddedTexture } from './embedded-png-material';
import { MeshPass, STATE_FLOATS, STATE_TEXELS, writeAppearance, type AppearanceInput } from './mesh-appearance';

/** Meshes per state-table row: one row is exactly 128 × 8 RGBA texels. */
const ROW = 128;
type F = Node<'float'>; type V3 = Node<'vec3'>; type V4 = Node<'vec4'>; type B = Node<'bool'>;

/** One prepared mesh set on one canvas, drawn by three.js on WebGPU, or on
 * WebGL2 where the browser has no WebGPU adapter. Geometry is merged into a few
 * buffers, and every mesh's presentation lives in one state table, so a frame
 * is a handful of draws however many meshes there are. */
export interface MeshScene {
  readonly backend: 'webgpu' | 'webgl2';
  /** Draw one frame. `appearance` is null when only the camera moved since the last frame. */
  render(projection: Projection, appearance: AppearanceInput | null, width: number, height: number): void;
  dispose(): void;
}

export async function createMeshScene(canvas: HTMLCanvasElement, meshes: readonly PreparedMesh[], useMaterials: boolean,
  onLost: (message: string) => void): Promise<MeshScene> {
  // Choose the backend here: WebGL2 is an expected fallback, not something for three.js to warn about.
  const webgpu = await navigator.gpu?.requestAdapter().then(adapter => adapter !== null, () => false) ?? false;
  const renderer = new WebGPURenderer({ canvas, antialias: true, alpha: true, forceWebGL: !webgpu });
  // Shaders write display values themselves: no tone mapping and no output
  // colour conversion, so three.js draws straight to the canvas without an
  // extra full-screen pass.
  renderer.outputColorSpace = LinearSRGBColorSpace; renderer.toneMapping = NoToneMapping;
  renderer.setClearColor(0x000000, 0); renderer.setPixelRatio(1);
  renderer.onDeviceLost = () => onLost('3D view closed by the browser. Reopen the viewer to retry.');
  const owned: { dispose(): void }[] = [];
  try { return await build(); } catch (error) {
    for (const item of owned) item.dispose();
    renderer.dispose(); throw error;
  }

  async function build(): Promise<MeshScene> {
    await renderer.init();
    // three.js runs its own requestAnimationFrame clock from init. This view draws
    // only on demand and uses no per-frame nodes, so the idle loop is stopped.
    (renderer as unknown as { _animation?: { stop(): void } })._animation?.stop();
    const backend = (renderer.backend as { isWebGPUBackend?: boolean }).isWebGPUBackend ? 'webgpu' : 'webgl2';

    const rows = Math.max(1, Math.ceil(meshes.length / ROW));
    const table = new Float32Array(rows * ROW * STATE_FLOATS);
    const state = new DataTexture(table, ROW * STATE_TEXELS, rows, RGBAFormat, FloatType);
    owned.push(state); state.magFilter = state.minFilter = NearestFilter; state.generateMipmaps = false; state.flipY = false; state.colorSpace = NoColorSpace;

    const u = {
      rot: uniform(new Vector4()), center: uniform(new Vector3()), frame: uniform(new Vector4()), viewport: uniform(new Vector2()),
      ambient: uniform(0), twoSided: uniform(0), light: uniform(new Vector3()), viewDir: uniform(new Vector3()), paper: uniform(new Vector3()),
      ghostAlpha: uniform(0), ghost: uniform(new Vector3()), ghostShade: uniform(new Vector3()),
    };
    const toUnitDepth = renderer.coordinateSystem === WebGPUCoordinateSystem;
    const meshId = attribute('meshIndex', 'float');
    const read = (id: F, texel: number): V4 => textureLoad(state, ivec2(int(id).mod(ROW).mul(STATE_TEXELS).add(texel), int(id).div(ROW)));

    /** The shared orthographic frame, exactly as plan, picking and labels use it. */
    const vertex = (visible: (s5: V4) => B) => Fn(() => {
      const id = meshId, s4 = read(id, 4), s5 = read(id, 5);
      const p = positionGeometry.sub(u.center), y = p.y.add(s4.w);
      const rx = p.x.mul(u.rot.x).sub(p.z.mul(u.rot.y)), rz = p.x.mul(u.rot.y).add(p.z.mul(u.rot.x));
      const sx = u.frame.y.add(u.frame.x.mul(rx)), sy = u.frame.z.add(u.frame.x.mul(rz.mul(u.rot.z).sub(y.mul(u.rot.w))));
      const d = rz.mul(u.rot.w).add(y.mul(u.rot.z));
      let z = clamp(d.negate().div(u.frame.w), -1, 1);
      if (toUnitDepth) z = z.mul(.5).add(.5);
      const clip = vec4(sx.div(u.viewport.x).mul(2).sub(1), float(1).sub(sy.div(u.viewport.y).mul(2)), z, 1);
      return select(visible(s5), clip, vec4(2, 2, 2, 1));
    })();

    const vId = varying(meshId).round(), vY = positionGeometry.y, vNormal = attribute('normal', 'vec3');
    const encode = (c: V3): V3 => mix(c.mul(12.92), pow(max(c, vec3(0)), vec3(1 / 2.4)).mul(1.055).sub(.055), step(vec3(.0031308), c));
    const display = (c: V3, useSource: F): V3 => select(useSource.greaterThan(.5), encode(c), c);
    const facing = (n: V3): V3 => select(u.twoSided.greaterThan(.5).and(frontFacing.not()), n.negate(), n);
    const lit = (n: V3): F => clamp(u.ambient.add(float(1).sub(u.ambient).mul(dot(n, u.light))), 0, 1);

    /** Architectural face tones: flat tops, pitched faces and lit walls. */
    const shaded = (s: readonly V4[], n: V3): V3 => {
      const [s0, s1, , s3, s4] = s as [V4, V4, V4, V4, V4], light = lit(n);
      return select(s0.w.greaterThan(.5),
        select(n.y.greaterThanEqual(.97), s0.xyz, mix(s4.xyz, select(n.y.greaterThan(.2), s3.xyz, s1.xyz), light)),
        select(n.y.greaterThan(.8), s0.xyz, mix(s4.xyz, s1.xyz, light)));
    };
    const cutFace = (useClip: F): B => frontFacing.not().and(u.twoSided.lessThan(.5).or(useClip.greaterThan(.5)));

    type Source = NonNullable<PreparedMesh['sourceMaterial']>;
    const opaque = (material?: { source: Source; maps: Partial<Record<'base' | 'normal' | 'metalRough', DataTexture>> }) => Fn(() => {
      const s = [0, 1, 2, 3, 4, 5, 6].map(t => read(vId, t)) as [V4, V4, V4, V4, V4, V4, V4];
      const [, s1, s2, s3, , , s6] = s;
      Discard(s2.w.greaterThan(.5).and(vY.greaterThan(s3.w)));
      const cut = cutFace(s2.w), n = facing(normalize(vNormal));
      const plain = display(shaded(s, n), s1.w);
      let color: V3 = plain;
      if (material) {
        const { source, maps } = material, on = s6.x.greaterThan(.5);
        if (!source.doubleSided) Discard(on.and(frontFacing.not()).and(cut.not()));
        const matUv = attribute('materialUv', 'vec2'), tangent = attribute('materialTangent', 'vec4');
        let N: V3 = normalize(attribute('shadingNormal', 'vec3'));
        if (maps.normal) {
          const T = normalize(tangent.xyz.sub(N.mul(dot(N, tangent.xyz)))), B = cross(N, T).mul(select(tangent.w.lessThan(0), -1, 1));
          N = normalize(mat3(T, B, N).mul(texture(maps.normal, matUv).rgb.mul(2).sub(1)));
        }
        N = select(frontFacing, N, N.negate());
        const [r, g, b] = source.baseColor;
        const base = vec3(r, g, b).mul(maps.base ? texture(maps.base, matUv).rgb : vec3(1));
        const mr = maps.metalRough ? texture(maps.metalRough, matUv).rgb : vec3(1);
        const metallic = float(source.metallic).mul(mr.b), roughness = max(.045, float(source.roughness).mul(mr.g));
        const L = normalize(u.light), V = normalize(u.viewDir), H = L.add(V).div(max(length(L.add(V)), .0001));
        const nl = max(dot(N, L), 0), nv = max(dot(N, V), .0001), nh = max(dot(N, H), 0), vh = max(dot(V, H), 0);
        const a = roughness.mul(roughness), a2 = a.mul(a), denom = nh.mul(nh).mul(a2.sub(1)).add(1);
        const D = a2.div(denom.mul(denom).mul(Math.PI)), k = roughness.add(1).mul(roughness.add(1)).div(8);
        const G = nv.div(nv.mul(float(1).sub(k)).add(k)).mul(nl.div(nl.mul(float(1).sub(k)).add(k)));
        const f0 = mix(vec3(.04), base, metallic), F = f0.add(float(1).sub(f0).mul(pow(float(1).sub(vh), 5)));
        const spec = D.mul(G).mul(F).div(max(nv.mul(nl).mul(4), .0001));
        const diffuse = float(1).sub(F).mul(float(1).sub(metallic)).mul(base).div(Math.PI);
        const light = base.mul(float(1).sub(metallic)).add(f0.mul(.12)).mul(u.ambient)
          .add(diffuse.add(spec).mul(nl).mul(Math.PI).mul(float(1).sub(u.ambient)));
        color = select(on, display(mix(max(light, vec3(0)), u.paper, s6.y), s1.w), plain);
      }
      return select(cut, vec4(display(s2.xyz, s1.w), 1), vec4(color, 1));
    })();

    /** Faded cutaway: one quiet veil, depth-tested and never written. */
    const veil = Fn(() => {
      const s5 = read(vId, 5);
      Discard(s5.z.greaterThan(.5).and(vY.lessThan(s5.w)));
      const n = facing(normalize(vNormal)), face = select(n.y.greaterThan(.8), u.ghost, mix(u.ghostShade, u.ghost, lit(n)));
      return vec4(face.mul(u.ghostAlpha), u.ghostAlpha);
    })();

    const visibleIn = (pass: MeshPass) => (s5: V4): B => s5.x.equal(pass);
    const make = (pass: MeshPass | 'ghost', textured?: Parameters<typeof opaque>[0]) => {
      const material = new NodeMaterial();
      material.side = DoubleSide; material.depthTest = true;
      if (pass === 'ghost') {
        material.vertexNode = vertex(s5 => s5.y.greaterThan(.5)); material.fragmentNode = veil;
        material.transparent = true; material.depthWrite = false;
        material.blending = CustomBlending; material.blendSrc = material.blendSrcAlpha = OneFactor;
        material.blendDst = material.blendDstAlpha = OneMinusSrcAlphaFactor;
      } else {
        material.vertexNode = vertex(visibleIn(pass)); material.fragmentNode = opaque(textured);
        if (pass !== MeshPass.Unbound) {
          const offset = pass === MeshPass.Bound ? -2 : 2;
          material.polygonOffset = true; material.polygonOffsetFactor = offset; material.polygonOffsetUnits = offset;
        }
      }
      return material;
    };

    // Merged geometry: unbound and bound meshes, each in source order; textured
    // meshes keep their own geometry for their extra attribute stream.
    const scene = new Scene(), camera = new OrthographicCamera();
    const textures = new Map<string, DataTexture>();
    const mapOf = (pin: EmbeddedTexture | undefined) => {
      if (!pin) return undefined;
      let map = textures.get(pin.key);
      if (!map) {
        map = new DataTexture(pin.image.rgba, pin.image.width, pin.image.height, RGBAFormat, UnsignedByteType);
        map.colorSpace = pin.colorRole === 'srgb' ? SRGBColorSpace : NoColorSpace; map.flipY = false;
        map.wrapS = map.wrapT = RepeatWrapping; map.magFilter = LinearFilter; map.minFilter = LinearMipmapLinearFilter; map.generateMipmaps = true;
        map.needsUpdate = true; textures.set(pin.key, map); owned.push(map);
      }
      return map;
    };
    const geometryOf = (members: readonly number[], extra?: Float32Array) => {
      let vertices = 0; for (const index of members) vertices += meshes[index]!.triangles * 3;
      const position = new Float32Array(vertices * 3), normal = new Int16Array(vertices * 4), id = new Float32Array(vertices);
      let at = 0;
      for (const index of members) {
        const source = meshes[index]!.vertices;
        for (let v = 0; v < source.length / 6; v++, at++) {
          position[at * 3] = source[v * 6]!; position[at * 3 + 1] = source[v * 6 + 1]!; position[at * 3 + 2] = source[v * 6 + 2]!;
          for (let axis = 0; axis < 3; axis++) normal[at * 4 + axis] = Math.round(Math.max(-1, Math.min(1, source[v * 6 + 3 + axis]!)) * 32767);
          id[at] = index;
        }
      }
      const geometry = new BufferGeometry();
      geometry.setAttribute('position', new BufferAttribute(position, 3));
      geometry.setAttribute('normal', new BufferAttribute(normal, 4, true));
      geometry.setAttribute('meshIndex', new BufferAttribute(id, 1));
      if (extra) {
        const stream = new InterleavedBuffer(extra, 9);
        geometry.setAttribute('materialUv', new InterleavedBufferAttribute(stream, 2, 0));
        geometry.setAttribute('shadingNormal', new InterleavedBufferAttribute(stream, 3, 2));
        geometry.setAttribute('materialTangent', new InterleavedBufferAttribute(stream, 4, 5));
      }
      owned.push(geometry);
      return geometry;
    };
    const shared = { reference: make(MeshPass.Reference), ghost: make('ghost') };
    owned.push(shared.reference, shared.ghost);
    const layers: { readonly pass: MeshPass | 'ghost'; readonly mesh: Mesh }[] = [];
    const add = (geometry: BufferGeometry, pass: MeshPass | 'ghost', material: NodeMaterial, order: number) => {
      const mesh = new Mesh(geometry, material); mesh.frustumCulled = false; mesh.matrixAutoUpdate = false; mesh.renderOrder = order;
      scene.add(mesh); layers.push({ pass, mesh });
    };
    const textured = (index: number) => useMaterials && meshes[index]!.sourceMaterial !== undefined && meshes[index]!.materialVertices !== undefined;
    const groups = [MeshPass.Unbound, MeshPass.Bound] as const;
    for (const pass of groups) {
      const members = meshes.flatMap((mesh, index) => (mesh.occurrenceId !== null) === (pass === MeshPass.Bound) && !textured(index) ? [index] : []);
      if (members.length === 0) continue;
      const geometry = geometryOf(members), material = make(pass); owned.push(material);
      add(geometry, MeshPass.Reference, shared.reference, 0); add(geometry, pass, material, pass); add(geometry, 'ghost', shared.ghost, 4);
    }
    meshes.forEach((mesh, index) => {
      if (!textured(index)) return;
      const source = mesh.sourceMaterial!, geometry = geometryOf([index], mesh.materialVertices!);
      const maps = { base: mapOf(source.baseColorTexture), normal: mapOf(source.normalTexture), metalRough: mapOf(source.metallicRoughnessTexture) };
      const pass = mesh.occurrenceId !== null ? MeshPass.Bound : MeshPass.Unbound;
      const material = make(pass, { source, maps: Object.fromEntries(Object.entries(maps).filter(([, map]) => map)) }); owned.push(material);
      add(geometry, MeshPass.Reference, shared.reference, 0); add(geometry, pass, material, pass); add(geometry, 'ghost', shared.ghost, 4);
    });

    let disposed = false;
    return {
      backend,
      render(q, appearance, width, height) {
        if (disposed) return;
        if (appearance) {
          const frame = writeAppearance(meshes, appearance, table); state.needsUpdate = true;
          u.paper.value.set(...frame.materialPaper); u.ambient.value = frame.ambient; u.twoSided.value = frame.twoSided ? 1 : 0;
          u.light.value.set(...frame.light);
          u.ghostAlpha.value = frame.ghostAlpha; u.ghost.value.set(...frame.ghostColor); u.ghostShade.value.set(...frame.ghostShade);
          for (const { pass, mesh } of layers) mesh.visible = pass === 'ghost' ? frame.ghosts : frame.passes.has(pass);
        }
        u.rot.value.set(q.ct, q.st, q.sf, q.cf); u.center.value.set(q.center[0], q.center[1], q.center[2]);
        u.frame.value.set(q.k, q.ox, q.oy, q.depthRadius); u.viewport.value.set(q.viewport.width, q.viewport.height);
        u.viewDir.value.set(q.st * q.cf, q.sf, q.ct * q.cf);
        if (canvas.width !== width || canvas.height !== height) renderer.setSize(width, height, false);
        renderer.render(scene, camera);
      },
      dispose() {
        if (disposed) return; disposed = true;
        for (const item of owned) item.dispose();
        renderer.dispose();
      },
    };
  }
}
