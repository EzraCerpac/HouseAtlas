import {
  BackSide, Box3, BufferAttribute, BufferGeometry, type Camera, CustomBlending, DataTexture, DepthTexture, DoubleSide, FloatType, InterleavedBuffer, InterleavedBufferAttribute,
  FrontSide, LessEqualCompare, LinearFilter, LinearMipmapLinearFilter, LinearSRGBColorSpace, Matrix4, Mesh, NearestFilter, NoColorSpace, NoToneMapping, NodeMaterial,
  OneFactor, OneMinusSrcAlphaFactor, OrthographicCamera, RenderPipeline, RenderTarget, RepeatWrapping, RGBAFormat, Scene, Sphere, SRGBColorSpace, UnsignedByteType, Vector3,
  Vector2, Vector4, WebGPUCoordinateSystem, WebGPURenderer, type Node,
} from 'three/webgpu';
import {
  abs, attribute, cameraProjectionMatrix, cameraViewMatrix, clamp, cross, dot, float, Fn, int, ivec2, length, Loop, mat3, max, mix, normalize, pow, select, smoothstep, step,
  texture, textureLoad, uniform, uniformArray, varying, vec2, vec3, vec4, Discard, frontFacing, interleavedGradientNoise, pass, positionGeometry, screenCoordinate, screenUV, vogelDiskSample,
} from 'three/tsl';
import { ao } from 'three/addons/tsl/display/GTAONode.js';
import { denoise } from 'three/addons/tsl/display/DenoiseNode.js';
import { occlusionHistory } from './occlusion-history';
import { prepareEffectPipelines } from './prepare-effect-pipelines';
import type { PreparedMesh, Projection } from './geometry';
import type { EmbeddedTexture } from './embedded-png-material';
import { GLOW_HEIGHT, GLOW_SPREAD, LUMA } from './sky-light';
import { GLASS_CLEAR, GLASS_FROSTED, GLOW_STOPS, MAX_LAMPS, MeshPass, STATE_FLOATS, STATE_TEXELS, writeAppearance, type AppearanceInput } from './mesh-appearance';

/** Meshes per state-table row: one row is exactly 128 × STATE_TEXELS RGBA texels. */
const ROW = 128;
type F = Node<'float'>; type V3 = Node<'vec3'>; type V4 = Node<'vec4'>; type B = Node<'bool'>;

/** One prepared mesh set on one canvas, drawn by three.js on WebGPU, or on
 * WebGL2 where the browser has no WebGPU adapter. Geometry is merged into a few
 * buffers, and every mesh's presentation lives in one state table, so a frame
 * is a handful of draws however many meshes there are. */
export interface MeshScene {
  readonly backend: 'webgpu' | 'webgl2';
  /** Draw one frame. `appearance` is null when only the camera moved since the last frame.
   * `occlusion` (0 to 1) blends in contact shading; 0 skips its passes entirely.
   * Returns true while another frame of the same view would still refine the contact shading. */
  render(projection: Projection, appearance: AppearanceInput | null, width: number, height: number, occlusion: number): boolean;
  /** For the speed check (render-probe.ts): resolves once the GPU has finished every frame drawn so far. */
  finished(): Promise<void>;
  /** For the speed check: draws only this share of each layer's triangles, 1 for the whole model,
   * and returns the vertices the next frame without contact shading draws. */
  share(fraction: number): number;
  dispose(): void;
}

/** Shadow map edge in texels, receiver offset along the face normal in metres, and filter radius in texels. */
const SUN_MAP = 2048, SUN_OFFSET = .04, SUN_SOFTNESS = 2.5, SUN_TAPS = 5;
/** Contact shading: reach in metres and how dark a fully enclosed corner gets.
 * Eight samples march three steps per direction, so the first step lands a
 * pixel or more out; more steps start inside one depth texel and read flat
 * walls as speckled self-occlusion. The reach is also capped on screen at
 * about what it spans in the whole-house view: close up, nine samples spread
 * over hundreds of pixels read as grain and a smoky haze across whole floors,
 * while contact shading belongs in the corners.
 * A still view averages OCCLUSION_FRAMES differently rotated estimates. */
const OCCLUSION_RADIUS = .8, OCCLUSION_REACH_PX = 40, OCCLUSION_SAMPLES = 8, OCCLUSION_STRENGTH = .6, OCCLUSION_FRAMES = 16;
/** At night a face is indoors when the point this far out along its normal, in metres,
 * still has the house above it: inner wall faces and floors pass, outer walls under
 * the eaves do not. */
const INDOOR_REACH = 1;
/** The point also sits this much higher, in metres, so a slab, lower roof or eave
 * just outside a wall, close above or below that point, never counts as a ceiling. */
const INDOOR_HEADROOM = .5;
/** A night face is lit as indoors only when the point this far off it along its normal,
 * in metres, also lies inside a room volume: floors and inner walls pass, while ledges,
 * trims, bay roofs and the ground at a wall's foot do not. */
const ROOM_REACH = .3;
/** Room volumes at least this tall at the median, in metres, are taken as they are;
 * flatter pick proxies stand for a room this high above them. */
const ROOM_VOLUME = .5, ROOM_STOREY = 2.6;
/** Margin, in metres, around the rooms in their own map, which covers only them so its
 * texels stay a few centimetres across. */
const ROOM_PAD = 1;
/** Deepest point tested in the room map; the cleared map reads 1, so a point below every room stays outside one only where there is none. */
const ROOM_FAR = .999;
/** Share of the difference from full tone that selection and overlay tints keep at any hour. */
const KEEP_TONE = .75;
/** How quickly a face turned to the sun takes the sun's colour instead of the sky's. */
const SUN_TINT_GAIN = 2.5;
/** After dusk: a lamp's own glass glows in its colour taken this far toward white, as a
 * lit shade looks paler than the light it throws; that light has an inverse-square-like
 * scale of POOL_RADIUS and is gone by POOL_REACH. The finite omni tail fades
 * from 5 to 10 m, retaining nearby light and the existing fixed shader work. */
const GLOW_WHITEN = .6, POOL_RADIUS = 1.2, POOL_REACH = 10;
/** An aimed lamp's beam instead: full inside BEAM_CORE (a cosine, about 20°) of its
 * aim, gone past BEAM_EDGE (about 42°), and carried further. */
const BEAM_CORE = .94, BEAM_EDGE = .74, BEAM_RADIUS = 3, BEAM_REACH = 10;
/** Glass reflects the hour's sky dome (sky-light.ts) and the sun's glint, sharp on clear
 * glass and spread on frosted. */
const GLINT_SHARP = 600, GLINT_SPREAD = 24, GLINT_GAIN = 3;
/** Glass seen near head-on still mirrors this much of the sky, as a window does whose
 * room is darker than the day outside; and soft diagonal streaks, this strong and
 * this many metres apart, break up the mirror the way the surroundings would. */
const GLASS_SHEEN = .14, STREAK = .1, STREAK_SPACING = 2.4;
/** After dusk: the warm haze lit room light leaves on the glass in front of it, linear;
 * the room itself shows through. */
const GLASS_HAZE = [.05, .03, .012] as const;
/** Merged vertices per GPU buffer set (18 MiB across the three streams), cut at
 * a triangle boundary: the Light model stays a few draws, and no single upload
 * of the Full model holds up a frame. */
const PIECE_VERTICES = 3 * 2 ** 18;
/** Buffer bytes of one full piece: position, normal and mesh index streams. */
const PIECE_BYTES = PIECE_VERTICES * (12 + 8 + 4);
/** Building a scene works in slices of about this long, with a frame drawn
 * between slices, so the page keeps moving while a large model is prepared. */
const SLICE_MS = 6;

/** Resolves just after the next frame is drawn, or at once while the page is
 * hidden and draws nothing. A message task, unlike a timer, is never throttled. */
const afterNextFrame = () => new Promise<void>(resolve => {
  const run = () => { const channel = new MessageChannel(); channel.port1.onmessage = () => { channel.port1.close(); resolve(); }; channel.port2.postMessage(null); };
  if (document.hidden) run(); else requestAnimationFrame(run);
});

/** Work between frames: `due()` once a slice is spent, then `next()` lets a frame draw first. */
function frameSlices(signal: AbortSignal | undefined) {
  let start = performance.now();
  return {
    due: () => performance.now() - start > SLICE_MS,
    async next() { await afterNextFrame(); signal?.throwIfAborted(); start = performance.now(); },
  };
}

/** Builds the scene in frame-sized slices: geometry merges, uploads and
 * pipeline compiles are spread over frames before it resolves, so the first
 * render() does no bulk work. `signal` abandons a build that is no longer wanted. */
export async function createMeshScene(canvas: HTMLCanvasElement, meshes: readonly PreparedMesh[], useMaterials: boolean,
  onLost: (message: string) => void, signal?: AbortSignal): Promise<MeshScene> {
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
    signal?.throwIfAborted();
    const slice = frameSlices(signal);
    // three.js runs its own requestAnimationFrame clock from init, which also
    // advances its node frame. This view draws only on demand, so the idle loop
    // is stopped and render() advances the frame itself.
    const internals = renderer as unknown as { _animation?: { stop(): void }; _nodes: { nodeFrame: { update(): void } } };
    internals._animation?.stop();
    const backend = (renderer.backend as { isWebGPUBackend?: boolean }).isWebGPUBackend ? 'webgpu' : 'webgl2';

    const rows = Math.max(1, Math.ceil(meshes.length / ROW));
    const table = new Float32Array(rows * ROW * STATE_FLOATS);
    const state = new DataTexture(table, ROW * STATE_TEXELS, rows, RGBAFormat, FloatType);
    owned.push(state); state.magFilter = state.minFilter = NearestFilter; state.generateMipmaps = false; state.flipY = false; state.colorSpace = NoColorSpace;

    const u = {
      ambient: uniform(0), twoSided: uniform(0), light: uniform(new Vector3()), viewDir: uniform(new Vector3()), paper: uniform(new Vector3()),
      ghostAlpha: uniform(0), ghost: uniform(new Vector3()), ghostShade: uniform(new Vector3()),
      direct: uniform(1), night: uniform(0), lamp: uniform(0), rooms: uniform(0), roomRaise: uniform(0),
      tint: uniform(new Vector3(1, 1, 1)), sunTint: uniform(new Vector3(1, 1, 1)), lampTint: uniform(new Vector3(1, 1, 1)),
      lamps: uniformArray(Array.from({ length: MAX_LAMPS }, () => new Vector4()), 'vec4'),
      lampAims: uniformArray(Array.from({ length: MAX_LAMPS }, () => new Vector4()), 'vec4'),
      lampColors: uniformArray(Array.from({ length: MAX_LAMPS }, () => new Vector4()), 'vec4'),
      // The hour's sky in one array: nine irradiance terms, then zenith, horizon, ground, glow and its direction.
      sky: uniformArray(Array.from({ length: 14 }, () => new Vector4()), 'vec4'),
      fadeCenter: uniform(new Vector2()), fadeHalf: uniform(new Vector2()), fadeNear: uniform(0), fadeFar: uniform(1), fadeGround: uniform(0),
      stageTop: uniform(new Vector3()), stageBottom: uniform(new Vector3()), stageGlow: uniform(new Vector3()),
      glowAt: uniform(new Vector2()), glowRadii: uniform(new Vector2(1, 1)),
    };
    const toUnitDepth = renderer.coordinateSystem === WebGPUCoordinateSystem;
    const meshId = attribute('meshIndex', 'float');
    const read = (id: F, texel: number): V4 => textureLoad(state, ivec2(int(id).mod(ROW).mul(STATE_TEXELS).add(texel), int(id).div(ROW)));

    /** Lifted world position through the camera, which holds the shared
     * orthographic frame exactly as plan, picking and labels use it. Depth is
     * clamped rather than clipped, so a lifted floor never leaves the view. */
    const vertex = (visible: (s5: V4, s7: V4, s6: V4) => B, lifted = true) => Fn(() => {
      const s4 = read(meshId, 4), s5 = read(meshId, 5), s6 = read(meshId, 6), s7 = read(meshId, 7);
      const clip = cameraProjectionMatrix.mul(cameraViewMatrix).mul(vec4(lifted ? positionGeometry.add(vec3(0, s4.w, 0)) : positionGeometry, 1));
      return select(visible(s5, s7, s6), vec4(clip.xy, clamp(clip.z, toUnitDepth ? 0 : -1, 1), clip.w), vec4(2, 2, 2, 1));
    })();

    const vId = varying(meshId).round(), vY = positionGeometry.y, vNormal = attribute('normal', 'vec3');

    // Sun shadows: one depth map seen from the sun. The sun is fixed to the house,
    // so the map is redrawn only when the scene changes, never while the camera turns.
    // After sunset the same map is drawn from straight above, from every mesh that
    // roofs the house over, whether shown or not, and tells indoors from out.
    const sun = new OrthographicCamera(), sunMatrix = uniform(new Matrix4());
    sun.coordinateSystem = renderer.coordinateSystem;
    const sunTarget = new RenderTarget(SUN_MAP, SUN_MAP), sunDepth = sunTarget.depthTexture = new DepthTexture(SUN_MAP, SUN_MAP);
    // A comparison sampler with linear filtering: each tap is a bilinear 2 × 2 test in hardware.
    sunDepth.type = FloatType; sunDepth.compareFunction = LessEqualCompare; sunDepth.minFilter = sunDepth.magFilter = LinearFilter;
    // Room volumes from straight above, fitted to the rooms alone: at night only a face
    // just inside one is indoors. Read as a hard edge, so no rim leaks past a wall.
    const roomView = new OrthographicCamera(), roomMatrix = uniform(new Matrix4());
    roomView.coordinateSystem = renderer.coordinateSystem;
    const roomTarget = new RenderTarget(SUN_MAP, SUN_MAP), roomDepth = roomTarget.depthTexture = new DepthTexture(SUN_MAP, SUN_MAP);
    roomDepth.type = FloatType; roomDepth.compareFunction = LessEqualCompare; roomDepth.minFilter = roomDepth.magFilter = NearestFilter;
    owned.push(sunTarget, roomTarget);
    /** Fraction of the light reaching the point: a few hardware-filtered taps on a disc turned per pixel, as three.js does. */
    const sunShadow = (world: V3): F => {
      const clip = sunMatrix.mul(vec4(world.add(normalize(vNormal).mul(SUN_OFFSET)), 1));
      // Render-target rows run top-down on both backends.
      const at = vec2(clip.x.mul(.5).add(.5), float(.5).sub(clip.y.mul(.5)));
      const depth = toUnitDepth ? clip.z : clip.z.mul(.5).add(.5);
      const turn = interleavedGradientNoise(screenCoordinate.xy).mul(2 * Math.PI);
      let sum: F = float(0);
      for (let i = 0; i < SUN_TAPS; i++) sum = sum.add(texture(sunDepth, at.add(vogelDiskSample(int(i), int(SUN_TAPS), turn).mul(SUN_SOFTNESS / SUN_MAP))).compare(depth).x);
      return sum.div(SUN_TAPS);
    };
    const encode = (c: V3): V3 => mix(c.mul(12.92), pow(max(c, vec3(0)), vec3(1 / 2.4)).mul(1.055).sub(.055), step(vec3(.0031308), c));
    const display = (c: V3, useSource: F): V3 => select(useSource.greaterThan(.5), encode(c), c);
    const facing = (n: V3): V3 => select(u.twoSided.greaterThan(.5).and(frontFacing.not()), n.negate(), n);
    /** The sky's light on a face by the way it faces, from nine spherical-harmonic terms set per
     * hour: brighter looking up, toward the low sun warmer, away from it bluer. Its luminance
     * sets how lit the face reads and its colour, grey on a wall square to the sun's side, tints the hour's light. */
    const skyTerm = (k: number): V3 => (u.sky.element(k) as unknown as V4).xyz;
    // One variable per normal node, so lit() and graded() share the nine terms in a pixel.
    const irradiances = new WeakMap<V3, V3>();
    const irradiance = (n: V3): V3 => {
      let e = irradiances.get(n);
      if (!e) { e = evaluate(n).toVar(); irradiances.set(n, e); }
      return e;
    };
    const evaluate = (n: V3): V3 => skyTerm(0).add(skyTerm(1).mul(n.y)).add(skyTerm(2).mul(n.z)).add(skyTerm(3).mul(n.x))
      .add(skyTerm(4).mul(n.x.mul(n.y))).add(skyTerm(5).mul(n.y.mul(n.z))).add(skyTerm(6).mul(n.z.mul(n.z).mul(3).sub(1)))
      .add(skyTerm(7).mul(n.x.mul(n.z))).add(skyTerm(8).mul(n.x.mul(n.x).sub(n.y.mul(n.y))));
    const sky = (n: V3): F => dot(irradiance(n), vec3(LUMA[0], LUMA[1], LUMA[2]));
    /** The sky's colour on a face at unit luminance. */
    const skyColor = (n: V3): V3 => { const e = irradiance(n); return e.div(max(dot(e, vec3(LUMA[0], LUMA[1], LUMA[2])), .05)); };
    const night = u.night.greaterThan(.5);
    // By day the lit, lifted point is tested; at night the unlifted point a reach out along the face and a headroom up.
    const lifted = varying(positionGeometry.add(vec3(0, read(meshId, 4).w, 0)));
    const probe = select(night, varying(positionGeometry).add(facing(normalize(vNormal)).mul(INDOOR_REACH)).add(vec3(0, INDOOR_HEADROOM, 0)), lifted);
    // One variable, so the taps run once per pixel however many terms read the result.
    const outdoors = sunShadow(probe).toVar('outdoors');
    /** 1 inside a room: below the top of the highest room volume there (a flat pick
     * proxy reaching a storey up). */
    const inRoom = (world: V3): F => {
      const clip = roomMatrix.mul(vec4(world.sub(vec3(0, u.roomRaise, 0)), 1)), depth = toUnitDepth ? clip.z : clip.z.mul(.5).add(.5);
      const at = vec2(clip.x.mul(.5).add(.5), float(.5).sub(clip.y.mul(.5)));
      return float(1).sub(texture(roomDepth, at).compare(clamp(depth, 0, ROOM_FAR)).x);
    };
    const roomPoint = varying(positionGeometry).add(facing(normalize(vNormal)).mul(ROOM_REACH));
    const roofed = float(1).sub(outdoors).mul(select(u.rooms.greaterThan(.5), inRoom(roomPoint), float(1)));
    const sunlit = select(night, float(1), outdoors), indoor = select(night, roofed, float(0));
    const lit = (n: V3): F => {
      const facingSun = dot(n, u.light);
      return clamp(u.ambient.mul(sky(n)).add(float(1).sub(u.ambient).mul(u.direct).mul(facingSun).mul(select(facingSun.greaterThan(0), sunlit, 1))), 0, 1);
    };
    /** Flat tops keep their tone and darken towards the shade tone in shadow. */
    const top = (tone: V3, shade: V3): V3 => mix(tone, shade, float(1).sub(sunlit).mul(u.direct).mul(.45));
    /** The hour's light on a drawn tone: sky colour, sun colour as far as the sun
     * reaches the face, lamp light indoors after dusk, and selection and overlay
     * tints held near full strength. */
    const graded = (c: V3, n: V3, s7: V4): V3 => {
      const sun = float(1).sub(u.ambient).mul(u.direct).mul(max(dot(n, u.light), 0)).mul(sunlit).mul(SUN_TINT_GAIN);
      const light = mix(mix(u.tint.mul(skyColor(n)), u.sunTint, clamp(sun, 0, 1)), u.lampTint, u.lamp.mul(indoor));
      return clamp(c.mul(mix(light, vec3(1), s7.y.mul(KEEP_TONE))), 0, 1);
    };

    /** After dusk, the light the lamps throw on a face, each in its colour: by distance, a
     * little more where it faces them, and for an aimed lamp only inside its beam. Unlit lamp slots have no
     * strength; the loop is a plain fixed one, since an If around it or a uniform bound
     * drops every tone in the WebGL2 backend. */
    const pool = (n: V3): V3 => {
      const sum = vec3(0).toVar('pool');
      Loop(MAX_LAMPS, ({ i }) => {
        const lamp = u.lamps.element(i) as unknown as V4, aim = u.lampAims.element(i) as unknown as V4, color = u.lampColors.element(i) as unknown as V4;
        const toward = lamp.xyz.sub(lifted), distance = length(toward), unit = toward.div(max(distance, .001));
        const radius = mix(float(POOL_RADIUS), float(BEAM_RADIUS), aim.w), reach = mix(float(POOL_REACH), float(BEAM_REACH), aim.w);
        const beam = mix(float(1), smoothstep(BEAM_EDGE, BEAM_CORE, dot(unit.negate(), aim.xyz)), aim.w);
        const fall = lamp.w.div(distance.mul(distance).div(radius.mul(radius)).add(1)).mul(float(1).sub(smoothstep(reach.div(2), reach, distance)));
        sum.addAssign(color.xyz.mul(fall.mul(beam).mul(max(dot(n, unit), 0).mul(.7).add(.3))));
      });
      return sum;
    };
    /** The night additions to a graded tone: thrown lamp light and glowing lamps, whose
     * colour is texel 8. A kept tone (selection, highlight) is never replaced by glow. */
    const lamplit = (graded: V3, tone: V3, n: V3, s7: V4): V3 => {
      const thrown = graded.add(tone.mul(pool(n)).mul(u.lamp)), glow = u.lamp.mul(float(1).sub(s7.y));
      return clamp(mix(thrown, mix(read(vId, 8).xyz, vec3(1), GLOW_WHITEN), glow.mul(s7.w)), 0, 1);
    };

    /** Architectural face tones: flat tops, pitched faces and lit walls. */
    const shaded = (s: readonly V4[], n: V3): V3 => {
      const [s0, s1, , s3, s4] = s as [V4, V4, V4, V4, V4], light = lit(n);
      return select(s0.w.greaterThan(.5),
        select(n.y.greaterThanEqual(.97), top(s0.xyz, s4.xyz), mix(s4.xyz, select(n.y.greaterThan(.2), s3.xyz, s1.xyz), light)),
        select(n.y.greaterThan(.8), top(s0.xyz, s4.xyz), mix(s4.xyz, s1.xyz, light)));
    };
    /** How far a surrounding face has faded into the stage (0 for every other mesh), by the
     * ground it is seen against: not at all up to the near edge of the fade past the house's
     * box, wholly by its far edge. Every face at one pixel shares that ground, so a fading
     * tree is never hazier than the lawn behind it. */
    const fade = Fn(() => {
      const V = normalize(u.viewDir), seen = positionGeometry.xz.add(V.xz.mul(u.fadeGround.sub(positionGeometry.y).div(max(V.y, .01))));
      const gap = length(max(abs(seen.sub(u.fadeCenter)).sub(u.fadeHalf), vec2(0)));
      return smoothstep(u.fadeNear, u.fadeFar, gap).mul(read(vId, 8).w);
    })().toVar('fade');
    /** The stage's colour under this pixel, as the stylesheet paints it behind the canvas. */
    const stage = Fn(() => {
      const base = mix(u.stageTop, u.stageBottom, screenUV.y);
      const out = length(screenUV.sub(u.glowAt).div(u.glowRadii));
      const [a, b, c] = GLOW_STOPS;
      const glow = select(out.lessThan(b.at), mix(float(a.alpha), float(b.alpha), out.div(b.at)), mix(float(b.alpha), float(c.alpha), clamp(out.sub(b.at).div(c.at - b.at), 0, 1)));
      return mix(base, u.stageGlow, glow);
    });
    /** A display colour taken into the stage as far as its face has faded; what has faded
     * away entirely is left out, so it writes no depth and casts no contact shading. */
    const hazed = (color: V3): V3 => { Discard(fade.greaterThanEqual(254 / 255)); return mix(color, stage(), fade); };
    const cutFace = (useClip: F): B => frontFacing.not().and(u.twoSided.lessThan(.5).or(useClip.greaterThan(.5)));

    type Source = NonNullable<PreparedMesh['sourceMaterial']>;
    const opaque = (material?: { source: Source; maps: Partial<Record<'base' | 'normal' | 'metalRough', DataTexture>> }) => Fn(() => {
      const s = [0, 1, 2, 3, 4, 5, 6, 7].map(t => read(vId, t)) as [V4, V4, V4, V4, V4, V4, V4, V4];
      const [, s1, s2, s3, , , s6, s7] = s;
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
        const light = base.mul(float(1).sub(metallic)).add(f0.mul(.12)).mul(u.ambient).mul(sky(N))
          .add(diffuse.add(spec).mul(nl).mul(Math.PI).mul(float(1).sub(u.ambient)).mul(u.direct).mul(sunlit));
        color = select(on, display(mix(max(light, vec3(0)), u.paper, s6.y), s1.w), plain);
      }
      const tone = select(cut, display(s2.xyz, s1.w), color);
      return vec4(hazed(lamplit(graded(tone, n, s7), tone, n, s7)), 1);
    })();

    /** Faded cutaway: one quiet veil, depth-tested and never written. */
    const veil = Fn(() => {
      const s5 = read(vId, 5);
      Discard(s5.z.greaterThan(.5).and(vY.lessThan(s5.w)));
      const n = facing(normalize(vNormal)), face = select(n.y.greaterThan(.8), u.ghost, mix(u.ghostShade, u.ghost, lit(n)));
      return vec4(face.mul(u.tint).mul(u.ghostAlpha), u.ghostAlpha);
    })();

    /** Building glass, over the finished solid house: it covers what lies behind by its
     * opacity, and reflects the hour's sky by Fresnel, barely head-on and nearly all at
     * a grazing angle, with the sun's glint. Colours are linear until the output, which
     * is premultiplied. */
    const glass = (material?: Parameters<typeof opaque>[0] & { roughness: number }) => Fn(() => {
      const s1 = read(vId, 1), s2 = read(vId, 2), s3 = read(vId, 3), s6 = read(vId, 6), s7 = read(vId, 7);
      Discard(s2.w.greaterThan(.5).and(vY.greaterThan(s3.w)));
      // Both sides of a pane are glass: shade the side turned to the viewer.
      const V = normalize(u.viewDir);
      let raw: V3 = normalize(vNormal), opacity: F = s6.w, frost: F = s7.z;
      // The same appearance switch as the opaque source-material pass: turning
      // materials off keeps the source colour and flat geometric normal.
      let tint: V3 = select(s1.w.greaterThan(.5), s1.xyz, pow(s1.xyz, vec3(2.2)));
      if (material) {
        const { source, maps } = material, on = s6.x.greaterThan(.5), matUv = attribute('materialUv', 'vec2');
        let N: V3 = normalize(attribute('shadingNormal', 'vec3'));
        if (maps.normal) {
          const tangent = attribute('materialTangent', 'vec4');
          const T = normalize(tangent.xyz.sub(N.mul(dot(N, tangent.xyz)))), B = cross(N, T).mul(select(tangent.w.lessThan(0), -1, 1));
          N = normalize(mat3(T, B, N).mul(texture(maps.normal, matUv).rgb.mul(2).sub(1)));
        }
        raw = select(on, N, raw);
        const sample = maps.base ? texture(maps.base, matUv) : vec4(1);
        const [r, g, b] = source.baseColor;
        tint = select(on, mix(vec3(r, g, b).mul(sample.rgb), u.paper, s6.y), tint);
        opacity = select(on, opacity.mul(sample.a), opacity);
        // Frost uses only the explicitly stated core factor, never the
        // normalized PBR default of 1 supplied by material admission.
        const roughness = float(material.roughness).mul(maps.metalRough ? texture(maps.metalRough, matUv).g : float(1));
        frost = select(on, clamp(roughness.sub(GLASS_CLEAR).div(GLASS_FROSTED - GLASS_CLEAR), 0, 1), frost);
      }
      const N = select(dot(raw, V).lessThan(0), raw.negate(), raw), head = clamp(dot(N, V), 0, 1);
      // Schlick's Fresnel for glass (4% head-on); frosted glass scatters it to a sheen.
      const along = positionGeometry.x.sub(positionGeometry.z).add(positionGeometry.y.mul(1.6)).div(STREAK_SPACING).mul(2 * Math.PI);
      const streak = smoothstep(.55, 1, along.sin()).mul(STREAK);
      const fresnel = float(GLASS_SHEEN).add(streak).add(float(1 - GLASS_SHEEN).mul(pow(float(1).sub(head), 5))).mul(mix(float(1), float(.4), frost));
      const R = N.mul(head.mul(2)).sub(V);
      // The hour's dome, with its glow low toward the sun.
      const across = max(length(vec2(R.x, R.z)), .001);
      const toward = pow(max(dot(vec2(R.x, R.z).div(across), vec2(skyTerm(13).x, skyTerm(13).z)), 0), GLOW_SPREAD).mul(pow(float(1).sub(clamp(R.y, 0, 1)), GLOW_HEIGHT));
      const sky = mix(mix(skyTerm(11), skyTerm(10), smoothstep(-.25, 0, R.y)), skyTerm(9), smoothstep(0, .7, R.y)).add(skyTerm(12).mul(toward).mul(smoothstep(-.05, 0, R.y)));
      const glint = pow(max(dot(R, normalize(u.light)), 0), mix(float(GLINT_SHARP), float(GLINT_SPREAD), frost))
        .mul(u.direct).mul(sunlit).mul(GLINT_GAIN);
      const reflected = sky.mul(u.tint).mul(mix(float(.25), float(1), max(u.direct, float(1).sub(u.lamp)))).add(u.sunTint.mul(glint));
      // The pane's own tint, lit like a wall; source colours are linear, palette tones roughly sRGB.
      const body = tint.mul(lit(N)).mul(u.tint);
      const cover = mix(opacity, max(opacity, .85), frost);
      const alpha = clamp(fresnel.add(float(1).sub(fresnel).mul(cover)), 0, 1);
      const color = fresnel.mul(reflected).add(float(1).sub(fresnel).mul(cover).mul(body)).div(max(alpha, .001));
      const haze = vec3(...GLASS_HAZE).mul(u.lamp).mul(float(1).sub(fresnel));
      // Surrounding glass fades by its cover: the stage it fades into shows through the canvas.
      Discard(fade.greaterThanEqual(254 / 255));
      return vec4(encode(clamp(color, 0, 1)).mul(alpha).add(encode(haze)), alpha).mul(float(1).sub(fade));
    })();

    const visibleIn = (pass: MeshPass) => (s5: V4): B => s5.x.equal(pass);
    const make = (pass: MeshPass | 'ghost', textured?: Parameters<typeof opaque>[0] & { roughness?: number }) => {
      const material = new NodeMaterial();
      material.side = DoubleSide; material.depthTest = true;
      if (pass === MeshPass.Glass) {
        material.vertexNode = vertex(visibleIn(pass)); material.outputNode = glass(textured ? { ...textured, roughness: textured.roughness ?? 0 } : undefined);
        material.transparent = true; material.depthWrite = false;
        material.blending = CustomBlending; material.blendSrc = material.blendSrcAlpha = OneFactor;
        material.blendDst = material.blendDstAlpha = OneMinusSrcAlphaFactor;
      } else if (pass === 'ghost') {
        material.vertexNode = vertex(s5 => s5.y.greaterThan(.5)); material.outputNode = veil;
        material.transparent = true; material.depthWrite = false;
        material.blending = CustomBlending; material.blendSrc = material.blendSrcAlpha = OneFactor;
        material.blendDst = material.blendDstAlpha = OneMinusSrcAlphaFactor;
      } else {
        material.vertexNode = vertex(visibleIn(pass)); material.outputNode = opaque(textured);
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
    // Matrices built here must already match the backend's depth range.
    camera.coordinateSystem = renderer.coordinateSystem;
    // The occlusion pass sees the scene through its own copy of the camera.
    const solidCamera = new OrthographicCamera();
    const basis = new Matrix4();
    /** Places the camera so its view and projection reproduce `projection` exactly:
     * x to screen right, y to screen up, z toward the viewer, one unit = k pixels. */
    // Mesh bounds, for the depth slab and the sun's view; lifts are added per frame.
    const low = new Vector3(Infinity, Infinity, Infinity), high = new Vector3(-Infinity, -Infinity, -Infinity);
    for (const mesh of meshes) { low.min(new Vector3(...mesh.bounds.min)); high.max(new Vector3(...mesh.bounds.max)); }
    const frame = ({ ct, st, sf, cf, k, ox, oy, center, depthRadius, viewport }: Projection) => {
      // The depth slab holds every mesh, not only the framed buildings: the site and its
      // context beyond them would otherwise clamp to one far depth and overdraw each other.
      let r = depthRadius;
      for (let c = 0; c < 8; c++) {
        const reach = Math.hypot((c & 1 ? high.x : low.x) - center[0], (c & 2 ? high.y : low.y) - center[1], (c & 4 ? high.z : low.z) - center[2]);
        if (Number.isFinite(reach)) r = Math.max(r, reach * 1.05);
      }
      camera.left = -ox / k; camera.right = (viewport.width - ox) / k; camera.top = oy / k; camera.bottom = (oy - viewport.height) / k;
      // Far away along the view axis: view rays are parallel to within 1%, which
      // screen-space occlusion assumes. The distance follows the framed buildings, not
      // the wider slab, so their view depth keeps its float precision on the GPU.
      const away = 100 * depthRadius;
      camera.near = away - r; camera.far = away + r; camera.updateProjectionMatrix();
      basis.set(ct, -st * sf, st * cf, 0, 0, cf, sf, 0, -st, -ct * sf, ct * cf, 0, 0, 0, 0, 1);
      camera.quaternion.setFromRotationMatrix(basis);
      camera.position.set(center[0] + st * cf * away, center[1] + sf * away, center[2] + ct * cf * away);
      camera.updateMatrixWorld(true);
      solidCamera.copy(camera);
    };
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
    /** Merged vertex streams for `members` in source order, cut into pieces of
     * at most `limit` vertices; each piece is one geometry and one GPU upload. */
    const geometriesOf = async (members: readonly number[], limit = PIECE_VERTICES, extra?: Float32Array) => {
      let left = 0; for (const index of members) left += meshes[index]!.triangles * 3;
      // The sphere three.js would otherwise compute on the first frame by walking
      // every vertex: its centre is the box centre of the members' exact bounds,
      // which orders the draws as one merged geometry did, and pieces of one
      // merge keep source order. Only the centre is read (no culling, no rays).
      const box = new Box3(), corner = new Vector3();
      for (const index of members) if (meshes[index]!.triangles > 0) {
        const { min, max } = meshes[index]!.bounds; box.expandByPoint(corner.set(...min)); box.expandByPoint(corner.set(...max));
      }
      const sphere = new Sphere(box.getCenter(new Vector3()), box.getSize(corner).length() / 2);
      const pieces: BufferGeometry[] = [];
      let position = new Float32Array(0), normal = new Int16Array(0), id = new Float32Array(0), at = 0, work = 0;
      const open = () => {
        const size = Math.min(limit, left);
        position = new Float32Array(size * 3); normal = new Int16Array(size * 4); id = new Float32Array(size); at = 0;
        const geometry = new BufferGeometry();
        geometry.setAttribute('position', new BufferAttribute(position, 3));
        geometry.setAttribute('normal', new BufferAttribute(normal, 4, true));
        geometry.setAttribute('meshIndex', new BufferAttribute(id, 1));
        geometry.boundingSphere = sphere.clone();
        owned.push(geometry); pieces.push(geometry);
      };
      for (const index of members) {
        const source = meshes[index]!.vertices;
        for (let v = 0; v < source.length / 6; v++, at++, left--) {
          if (at === id.length) open();
          position[at * 3] = source[v * 6]!; position[at * 3 + 1] = source[v * 6 + 1]!; position[at * 3 + 2] = source[v * 6 + 2]!;
          for (let axis = 0; axis < 3; axis++) normal[at * 4 + axis] = Math.round(Math.max(-1, Math.min(1, source[v * 6 + 3 + axis]!)) * 32767);
          id[at] = index;
          if (++work === 0x4000) { work = 0; if (slice.due()) await slice.next(); }
        }
      }
      if (extra && pieces[0]) {
        const stream = new InterleavedBuffer(extra, 9);
        pieces[0].setAttribute('materialUv', new InterleavedBufferAttribute(stream, 2, 0));
        pieces[0].setAttribute('shadingNormal', new InterleavedBufferAttribute(stream, 3, 2));
        pieces[0].setAttribute('materialTangent', new InterleavedBufferAttribute(stream, 4, 5));
      }
      return pieces;
    };
    const shared = { reference: make(MeshPass.Reference), ghost: make('ghost'), glass: make(MeshPass.Glass) };
    // Solid geometry: every drawn, uncut face once, coloured by its view-space normal.
    // The sun's depth map and the occlusion pass both draw this scene.
    const solidScene = new Scene(), solid = new NodeMaterial();
    solid.side = DoubleSide; owned.push(solid);
    // Shelter geometry: the house as built, unlifted and uncut, for the night map.
    const shelterScene = new Scene(), shelter = new NodeMaterial();
    shelter.side = DoubleSide; owned.push(shelter);
    shelter.vertexNode = vertex((_, s7) => s7.x.greaterThan(.5), false);
    shelter.outputNode = vec4(1);
    // Room volumes, unlifted and uncut, for the footprint map.
    const roomScene = new Scene(), roomVolume = new NodeMaterial();
    roomVolume.side = DoubleSide; owned.push(roomVolume);
    roomVolume.vertexNode = vertex((_, __, s6) => s6.z.greaterThan(.5), false);
    roomVolume.outputNode = vec4(1);
    // Glass lets the sun in and casts no contact shading.
    solid.vertexNode = vertex(s5 => s5.x.greaterThan(MeshPass.None).and(s5.x.lessThan(MeshPass.Glass)));
    solid.outputNode = Fn(() => {
      const s2 = read(vId, 2), s3 = read(vId, 3);
      Discard(s2.w.greaterThan(.5).and(vY.greaterThan(s3.w)));
      // Alpha: how much contact shading the face takes, none once it has faded into the stage.
      // The fade follows the view, so it never removes a face here: the sun's map stays one view.
      return vec4(normalize(cameraViewMatrix.mul(vec4(facing(normalize(vNormal)), 0)).xyz), float(1).sub(fade));
    })();
    owned.push(shared.reference, shared.ghost, shared.glass);
    const layers: { readonly pass: MeshPass | 'ghost'; readonly mesh: Mesh }[] = [];
    const add = (geometry: BufferGeometry, pass: MeshPass | 'ghost', material: NodeMaterial, order: number) => {
      const mesh = new Mesh(geometry, material); mesh.frustumCulled = false; mesh.matrixAutoUpdate = false; mesh.renderOrder = order;
      scene.add(mesh); layers.push({ pass, mesh });
      if (pass === MeshPass.Reference) {
        const body = new Mesh(geometry, solid); body.frustumCulled = false; body.matrixAutoUpdate = false; solidScene.add(body);
        const roof = new Mesh(geometry, shelter); roof.frustumCulled = false; roof.matrixAutoUpdate = false; shelterScene.add(roof);
        const room = new Mesh(geometry, roomVolume); room.frustumCulled = false; room.matrixAutoUpdate = false; roomScene.add(room);
      }
    };
    const textured = (index: number) => useMaterials && meshes[index]!.sourceMaterial !== undefined && meshes[index]!.materialVertices !== undefined;
    // Keep each glass primitive independently sortable, including its display
    // lift. Merging panes fixes their order even when the camera turns around.
    // Three.js sorts these objects far-to-near at the common glass renderOrder.
    // As with ordinary object transparency, intersecting surfaces or multiple
    // disconnected panes authored inside one primitive still need subdivision.
    const glazed = (index: number) => meshes[index]!.sourceNight === 'glazing';
    const glassBounds: { geometry: BufferGeometry; index: number; y: number }[] = [];
    const addGlass = (geometry: BufferGeometry, index: number, material = shared.glass) => {
      add(geometry, MeshPass.Glass, material, 3.5);
      glassBounds.push({ geometry, index, y: geometry.boundingSphere!.center.y });
    };
    const groups = [MeshPass.Unbound, MeshPass.Bound] as const;
    for (const pass of groups) {
      const members = meshes.flatMap((mesh, index) => (mesh.occurrenceId !== null) === (pass === MeshPass.Bound) && !textured(index) ? [index] : []);
      if (members.length === 0) continue;
      const material = make(pass); owned.push(material);
      for (const glassy of [false, true]) {
        const part = members.filter(index => glazed(index) === glassy);
        const batches = glassy ? part.map(index => [index]) : part.length ? [part] : [];
        for (const members of batches) for (const geometry of await geometriesOf(members)) {
          add(geometry, MeshPass.Reference, shared.reference, 0); add(geometry, pass, material, pass); add(geometry, 'ghost', shared.ghost, 4);
          if (glassy) addGlass(geometry, members[0]!);
          if (slice.due()) await slice.next();
        }
      }
    }
    for (const [index, mesh] of meshes.entries()) {
      if (!textured(index)) continue;
      // The extra attribute stream follows the mesh's own vertices, so a textured mesh stays one piece.
      const source = mesh.sourceMaterial!, [geometry] = await geometriesOf([index], Infinity, mesh.materialVertices!);
      if (!geometry) continue;
      const maps = Object.fromEntries(Object.entries({ base: mapOf(source.baseColorTexture), normal: mapOf(source.normalTexture), metalRough: mapOf(source.metallicRoughnessTexture) }).filter(([, map]) => map));
      const pass = mesh.occurrenceId !== null ? MeshPass.Bound : MeshPass.Unbound;
      const material = make(pass, { source, maps }); owned.push(material);
      add(geometry, MeshPass.Reference, shared.reference, 0); add(geometry, pass, material, pass); add(geometry, 'ghost', shared.ghost, 4);
      if (glazed(index)) {
        const glassMaterial = make(MeshPass.Glass, { source, maps, roughness: mesh.sourceRoughness ?? 0 }); owned.push(glassMaterial);
        addGlass(geometry, index, glassMaterial);
      }
    }

    const corner = new Vector3();
    /** Fits the room map to the flagged room volumes and says how far above a flat one its room reaches. */
    const fitRooms = () => {
      const min = new Vector3(Infinity, Infinity, Infinity), max = new Vector3(-Infinity, -Infinity, -Infinity), heights: number[] = [];
      for (const [i, mesh] of meshes.entries()) if (table[i * STATE_FLOATS + 26]! > .5) {
        min.min(new Vector3(...mesh.bounds.min)); max.max(new Vector3(...mesh.bounds.max)); heights.push(mesh.bounds.max[1] - mesh.bounds.min[1]);
      }
      heights.sort((a, b) => a - b);
      u.roomRaise.value = (heights[heights.length >> 1] ?? 0) >= ROOM_VOLUME ? 0 : ROOM_STOREY;
      const centre = new Vector3().addVectors(min, max).multiplyScalar(.5), half = Math.max(max.x - min.x, max.z - min.z) / 2 + ROOM_PAD;
      roomView.position.set(centre.x, max.y + 1, centre.z); roomView.up.set(0, 0, -1); roomView.lookAt(centre.x, min.y, centre.z);
      roomView.left = -half; roomView.right = half; roomView.top = half; roomView.bottom = -half;
      roomView.near = .5; roomView.far = max.y - min.y + 1.5; roomView.updateMatrixWorld(true); roomView.updateProjectionMatrix();
      roomMatrix.value.multiplyMatrices(roomView.projectionMatrix, roomView.matrixWorldInverse);
    };
    const drawSun = () => {
      // At night the map reaches past the house by more than a probe, so a probe
      // beside an outer wall never reads the clamped edge of a roof.
      const dark = u.night.value > .5, pad = dark ? INDOOR_REACH + INDOOR_HEADROOM + .5 : 0;
      let lift = 0; if (!dark) for (let i = 0; i < meshes.length; i++) lift = Math.max(lift, table[i * STATE_FLOATS + 19]!);
      const centre = new Vector3().addVectors(low, high).multiplyScalar(.5), toward = u.light.value.clone().normalize();
      const reach = Math.max(1, low.distanceTo(high) + lift);
      sun.position.copy(centre).addScaledVector(toward, reach); sun.up.set(0, Math.abs(toward.y) > .99 ? 0 : 1, Math.abs(toward.y) > .99 ? 1 : 0);
      sun.lookAt(centre); sun.updateMatrixWorld(true);
      const min = new Vector3(Infinity, Infinity, Infinity), max = new Vector3(-Infinity, -Infinity, -Infinity);
      for (let c = 0; c < 8; c++) {
        corner.set(c & 1 ? high.x + pad : low.x - pad, c & 2 ? high.y + lift + pad : low.y - pad, c & 4 ? high.z + pad : low.z - pad).applyMatrix4(sun.matrixWorldInverse);
        min.min(corner); max.max(corner);
      }
      sun.left = min.x; sun.right = max.x; sun.bottom = min.y; sun.top = max.y; sun.near = -max.z - .1; sun.far = -min.z + .1;
      sun.updateProjectionMatrix(); sunMatrix.value.multiplyMatrices(sun.projectionMatrix, sun.matrixWorldInverse);
      renderer.setRenderTarget(sunTarget); renderer.render(dark ? shelterScene : solidScene, sun);
      if (dark && u.rooms.value > .5) { fitRooms(); renderer.setRenderTarget(roomTarget); renderer.render(roomScene, roomView); }
      renderer.setRenderTarget(null);
    };

    // Contact shading (GTAO): a depth-and-normal pass without multisampling feeds
    // it (GTAO cannot read multisampled depth on WebGPU), then the antialiased
    // colour pass is darkened in corners on its way to the canvas.
    const geometryPass = pass(solidScene, solidCamera, { samples: 0 }), colorPass = pass(scene, camera);
    const depth = geometryPass.getTextureNode('depth'), normal = geometryPass.getTextureNode('output');
    const occlusion = ao(depth, normal, solidCamera);
    occlusion.samples.value = OCCLUSION_SAMPLES; occlusion.useTemporalFiltering = true;
    const history = occlusionHistory(occlusion.getTextureNode(), OCCLUSION_FRAMES);
    const smooth = denoise(history.getTextureNode(), depth, normal, solidCamera) as unknown as V4;
    const strength = uniform(0), color = colorPass.getTextureNode('output');
    const shade = select(depth.r.lessThan(1), mix(float(1), smooth.r, strength.mul(OCCLUSION_STRENGTH).mul(normal.a)), 1);
    const pipeline = new RenderPipeline(renderer, vec4(color.rgb.mul(shade), color.a));
    pipeline.outputColorTransform = false;
    // Contact shading depends on the solid house and the camera, never on the hour: a new
    // hour over an unchanged house and view redraws only the colour pass and lays the
    // shading already averaged over it. Plain textures, so none of the passes that wrote
    // them run again.
    const keptDepth = texture(geometryPass.renderTarget.depthTexture!), keptNormal = texture(geometryPass.renderTarget.texture);
    const kept = texture(history.getTextureNode().value);
    const keptSmooth = denoise(kept, keptDepth, keptNormal, solidCamera) as unknown as V4;
    const keptShade = select(keptDepth.r.lessThan(1), mix(float(1), keptSmooth.r, strength.mul(OCCLUSION_STRENGTH).mul(keptNormal.a)), 1);
    const relit = new RenderPipeline(renderer, vec4(color.rgb.mul(keptShade), color.a));
    relit.outputColorTransform = false;
    owned.push(geometryPass, colorPass, occlusion, history, pipeline, relit);

    // Upload every piece and compile every pipeline ahead of the first frame,
    // at most a piece's worth of buffers per frame, so a large model never
    // moves all its buffers, or waits on its shaders, inside one frame, and
    // many small textured meshes share frames. The canvas and the sun's map
    // are separate targets, each with its own pipelines; the night map's
    // shelter pipelines are compiled too, so the first frame after dusk waits on none.
    const uploaded = new Set<BufferGeometry>();
    let pending = 0;
    /** Compiles `body` as `target` will draw it. three.js draws a two-sided see-through
     * material as its back faces, then its front faces, each with its own shader, while
     * compileAsync prepares only the two-sided one. Each side is compiled here on its own
     * stand-in object, as the frame draws each side as its own render object. */
    const compile = async (body: Mesh, view: Camera, within: Scene, target: RenderTarget | null) => {
      const material = body.material as NodeMaterial;
      const sides = material.transparent && material.side === DoubleSide && !material.forceSinglePass ? [BackSide, FrontSide] as const : null;
      renderer.setRenderTarget(target);
      try {
        if (!sides) await renderer.compileAsync(body, view, within);
        else for (const side of sides) {
          const stand = new Mesh(body.geometry, material);
          stand.frustumCulled = body.frustumCulled; stand.matrixAutoUpdate = stand.matrixWorldAutoUpdate = false;
          stand.matrixWorld.copy(body.matrixWorld);
          material.side = side;
          try { await renderer.compileAsync(stand, view, within); } finally { material.side = DoubleSide; }
        }
      } finally { renderer.setRenderTarget(null); }
      signal?.throwIfAborted();
    };
    for (const { mesh } of layers) {
      await compile(mesh, camera, scene, null);
      if (!uploaded.has(mesh.geometry)) {
        uploaded.add(mesh.geometry);
        // Interleaved attributes share one array; count it once.
        for (const array of new Set(Object.values(mesh.geometry.attributes).map(attribute => attribute.array))) pending += array.byteLength;
      }
      if (pending >= PIECE_BYTES || slice.due()) { pending = 0; await slice.next(); }
    }
    // The contact shading passes draw the same objects into targets of their own, so they
    // need pipelines of their own too; without them the first shaded frame, once the view
    // settles, compiles them all at once. The colour pass takes the canvas's samples when
    // its pipeline is set up; it is given them here first.
    colorPass.renderTarget.samples = renderer.samples;
    for (const [within, view, target] of [[solidScene, sun, sunTarget], [shelterScene, sun, sunTarget], [roomScene, roomView, roomTarget],
      [scene, camera, colorPass.renderTarget], [solidScene, solidCamera, geometryPass.renderTarget]] as const) for (const body of within.children) {
      await compile(body as Mesh, view, within, target); if (slice.due()) await slice.next();
    }

    await prepareEffectPipelines(renderer, { pipeline, relit, occlusion, history, passes: [geometryPass, colorPass] }, () => slice.next(), signal);

    // The view the contact shading history belongs to; any change starts it over.
    let disposed = false, sunStale = true, averaged: Projection | null = null;
    // The table as last uploaded; NaN never compares equal, so the first write uploads.
    const drawnTable = new Float32Array(table.length).fill(NaN);
    return {
      backend,
      render(q, appearance, width, height, shading) {
        if (disposed) return false;
        // Whether only uniforms changed: a new hour leaves the table, by night the sun's map,
        // and always the contact shading as they were.
        let relight = false;
        if (appearance) {
          const frame = writeAppearance(meshes, appearance, table);
          let changed = false;
          for (let i = 0; i < table.length; i++) if (table[i] !== drawnTable[i]) { changed = true; break; }
          if (changed) { drawnTable.set(table); state.needsUpdate = true; } else relight = true;
          const [lx, ly, lz] = frame.light, night = frame.night ? 1 : 0, rooms = frame.rooms ? 1 : 0;
          if (changed || night !== u.night.value || rooms !== u.rooms.value || lx !== u.light.value.x || ly !== u.light.value.y || lz !== u.light.value.z) sunStale = true;
          u.paper.value.set(...frame.materialPaper); u.ambient.value = frame.ambient; u.twoSided.value = frame.twoSided ? 1 : 0;
          u.light.value.set(...frame.light);
          u.ghostAlpha.value = frame.ghostAlpha; u.ghost.value.set(...frame.ghostColor); u.ghostShade.value.set(...frame.ghostShade);
          u.direct.value = frame.direct; u.night.value = frame.night ? 1 : 0; u.lamp.value = frame.lamp; u.rooms.value = frame.rooms ? 1 : 0;
          u.tint.value.set(...frame.tint); u.sunTint.value.set(...frame.sunTint); u.lampTint.value.set(...frame.lampTint);
          const { sky } = frame;
          const dome = [sky.zenith, sky.horizon, sky.ground, sky.glow, sky.glowToward];
          (u.sky.array as Vector4[]).forEach((slot, k) => slot.set(...(k < 9 ? sky.irradiance.slice(k * 3, k * 3 + 3) as [number, number, number] : dome[k - 9]!), 0));
          (u.lamps.array as Vector4[]).forEach((point, at) => { const lamp = frame.lamps[at];
            point.set(lamp?.at[0] ?? 0, lamp?.at[1] ?? 0, lamp?.at[2] ?? 0, lamp ? frame.lamp : 0); });
          (u.lampAims.array as Vector4[]).forEach((aim, at) => { const toward = frame.lamps[at]?.aim;
            aim.set(toward?.[0] ?? 0, toward?.[1] ?? 0, toward?.[2] ?? 0, toward ? 1 : 0); });
          (u.lampColors.array as Vector4[]).forEach((color, at) => color.set(...frame.lamps[at]?.color ?? [0, 0, 0], 0));
          if (frame.fade) {
            const { center, half, near, far, ground, backdrop } = frame.fade;
            u.fadeCenter.value.set(...center); u.fadeHalf.value.set(...half); u.fadeNear.value = near; u.fadeFar.value = far; u.fadeGround.value = ground;
            u.stageTop.value.set(...backdrop.top); u.stageBottom.value.set(...backdrop.bottom); u.stageGlow.value.set(...backdrop.glow);
            u.glowAt.value.set(...backdrop.glowAt); u.glowRadii.value.set(...backdrop.glowRadii);
          }
          for (const { geometry, index, y } of glassBounds) geometry.boundingSphere!.center.y = y + table[index * STATE_FLOATS + 19]!;
          for (const { pass, mesh } of layers) mesh.visible = pass === 'ghost' ? frame.ghosts : frame.passes.has(pass);
        }
        frame(q); u.viewDir.value.set(q.st * q.cf, q.sf, q.ct * q.cf);
        if (canvas.width !== width || canvas.height !== height) { renderer.setSize(width, height, false); averaged = null; }
        if (sunStale) { drawSun(); sunStale = false; }
        if (appearance && !relight) averaged = null;
        if (shading <= 0) { averaged = null; renderer.render(scene, camera); return false; }
        if (relight && averaged === q && history.count > 0) {
          strength.value = Math.min(1, shading); kept.value = history.getTextureNode().value;
          internals._nodes.nodeFrame.update();
          relit.render();
          // Refining resumes only once the house or the view changes again; resuming here
          // would draw the whole contact shading between the moves of a scrub.
          return false;
        }
        if (averaged !== q) { averaged = q; history.count = 0; }
        // Reach: OCCLUSION_RADIUS metres, at most OCCLUSION_REACH_PX layout pixels (k is pixels per metre).
        occlusion.radius.value = Math.min(OCCLUSION_RADIUS, OCCLUSION_REACH_PX / q.k);
        strength.value = Math.min(1, shading);
        // Post-processing passes redraw once per three.js frame.
        internals._nodes.nodeFrame.update();
        pipeline.render();
        return history.settling;
      },
      async finished() {
        const device = (renderer.backend as { device?: { queue: { onSubmittedWorkDone(): Promise<void> } } }).device;
        if (device) { await device.queue.onSubmittedWorkDone(); return; }
        // WebGL2: reading one pixel back waits for every command before it.
        const gl = (renderer.backend as { gl?: WebGL2RenderingContext }).gl;
        gl?.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(4));
      },
      share(fraction) {
        let vertices = 0;
        for (const { mesh } of layers) {
          const count = mesh.geometry.getAttribute('position').count, kept = fraction >= 1 ? Infinity : 3 * Math.floor(count * fraction / 3);
          mesh.geometry.setDrawRange(0, kept);
          if (mesh.visible) vertices += Math.min(count, kept);
        }
        return vertices;
      },
      dispose() {
        if (disposed) return; disposed = true;
        for (const item of owned) item.dispose();
        renderer.dispose();
      },
    };
  }
}
