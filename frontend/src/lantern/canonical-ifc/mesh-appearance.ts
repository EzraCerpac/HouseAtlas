import { drawsFloor, sourceMeshColor, type DrawRules, type PreparedMesh } from './geometry';

/** Presentation inputs shared by every MeshLayer caller. Geometry never changes here. */
export interface AppearanceInput {
  readonly rules: DrawRules;
  readonly currentFloorId: string | null;
  readonly selectedOccurrenceId: string | null;
  /** Other occurrences of the selected logical room. */
  readonly contextOccurrenceIds: readonly string[];
  /** Occurrence token -> overlay tint (hex). */
  readonly tints: ReadonlyMap<string, string>;
  /** Mesh keys of a separate reference layer: drawn in a muted reference tone
   * behind the building so coincident surfaces never cover it. */
  readonly referenceKeys?: ReadonlySet<string> | undefined;
  /** Mesh keys left out of the drawing (presentation only; uploads are kept). */
  readonly hiddenKeys?: ReadonlySet<string> | undefined;
  /** Mesh keys of an explicit selection, drawn in the lantern tone. */
  readonly selectedKeys?: ReadonlySet<string> | undefined;
  /** Per-mesh display lift in metres (presentation only, such as exploded floors). */
  readonly lifts?: ReadonlyMap<string, number> | undefined;
  /** Per-mesh section height in the mesh's own source frame; overrides rules.clipY. */
  readonly clips?: ReadonlyMap<string, number | null> | undefined;
  /** Per-mesh dimming toward paper (0–1); replaces current-floor dimming when given. */
  readonly dims?: ReadonlyMap<string, number> | undefined;
  /** Faded, depth-tested and never-written cutaway: null fades the whole mesh,
   * a height fades only what lies above it. Drawn even when hidden by hiddenKeys. */
  readonly ghosts?: ReadonlyMap<string, number | null> | undefined;
  /** Opt in to explicit core glTF linear base colours. Selection/overlay and
   * cutaway presentation still take precedence; this alone enables no maps. */
  readonly sourceColors?: boolean | undefined;
  /** Unified-only admitted embedded PNG materials; all other callers opt out. */
  readonly sourceMaterials?: boolean | undefined;
  /** With sourceColors only: share (0–1) of a mesh's dimming applied to its
   * source colour, so context steps back while keeping its material hue.
   * Default 1, the full dimming of the fallback tones. */
  readonly sourceDim?: number | undefined;
  /** Share of the light every face keeps, 0–1; faces turned from the light get the rest by angle. */
  readonly ambient?: number | undefined;
  /** Opt-in architectural lighting of uncut back faces; other viewers retain cut tones. */
  readonly twoSided?: boolean | undefined;
  /** With twoSided only: faces turned from the light fall toward this tone (hex) instead of black. */
  readonly shade?: string | undefined;
  /** With twoSided only: unit direction toward the light in the model frame, replacing the fixed upper-left light. */
  readonly light?: readonly [number, number, number] | undefined;
  /** With twoSided and pitchKeys only: upward-sloping faces of those unbound,
   * unselected meshes (between flat tops and walls) take this tone (hex), lit
   * like walls. A presentation tone for the face's slope, never a material. */
  readonly pitch?: string | undefined;
  readonly pitchKeys?: ReadonlySet<string> | undefined;
  /** With twoSided only: unbound, unselected meshes drawn as quiet ground in
   * `site.tone`, the same at every slope with only a trace of shading, so they
   * stay behind the architecture. */
  readonly site?: { readonly keys: ReadonlySet<string>; readonly tone: string } | undefined;
  /** With twoSided only: opacity of the faded cutaway, 0–1, instead of the default. */
  readonly ghostAlpha?: number | undefined;
  /** With twoSided only: time-of-day lighting. `light` is then the sun, or the zenith once it has set. */
  readonly daylight?: SceneDaylight | undefined;
  /** With daylight only: meshes that roof the house over (structure, floors, roofs). At night a
   * face with one of them above it reads as indoors and takes the lamp light. Hiding or cutting
   * them away leaves the rooms beneath lit. */
  readonly shelterKeys?: ReadonlySet<string> | undefined;
  /** With daylight only: room volumes. When any is given, a face lights as indoors at night
   * only where its probe also stands within a room's footprint, so ground and walls under
   * an eave, a carport or a terrace edge stay dark. */
  readonly roomKeys?: ReadonlySet<string> | undefined;
  /** With daylight only: building glass, drawn see-through after the rest of the house, a
   * little reflective, letting the sun in by day and showing the lamp-lit room behind it at night. */
  readonly glazingKeys?: ReadonlySet<string> | undefined;
  /** With daylight only: lamp glass and bulbs, which glow at night and light what is near them. */
  readonly emitterKeys?: ReadonlySet<string> | undefined;
  /** With twoSided only: surroundings that fade into the stage with distance from the house. */
  readonly surroundings?: Surroundings | undefined;
  /** Colour overrides (hex); omitted entries keep the default tones. */
  readonly palette?: Partial<MeshPalette> | undefined;
}

/** Surroundings fade into the stage behind the canvas with distance from a box around the
 * house: whole up to `near` metres outside it, the stage's own colour by `far`. A face
 * takes the fade of the ground it is seen against, the point at height `ground` on its line
 * of sight, so nothing ever stands out hazier than what lies behind it. Meshes that only
 * cover ground past `far` from every view are not drawn at all. */
export interface Surroundings {
  readonly keys: ReadonlySet<string>;
  /** Centre and half extent, in x and z, of the box the distance is taken from. */
  readonly center: readonly [number, number];
  readonly half: readonly [number, number];
  readonly near: number;
  readonly far: number;
  readonly ground: number;
  /** The furthest a face can be seen across the ground from its own place, per metre it
   * stands above `ground`: the cotangent of the lowest camera pitch. */
  readonly lean: number;
  readonly backdrop: Backdrop;
}

/** The stage the canvas lies on, as its stylesheet paints it: a gradient (hex) from `top` to
 * `bottom` down the canvas, under a `glow` that is whole at `glowAt` and fades along a CSS
 * radial ellipse with radii `glowRadii` to GLOW_STOPS. Positions are fractions of the canvas
 * from its top left. */
export interface Backdrop {
  readonly top: string; readonly bottom: string; readonly glow: string;
  readonly glowAt: readonly [number, number]; readonly glowRadii: readonly [number, number];
}
/** The glow's colour stops along the ellipse: whole at its centre, `alpha` at `at`, gone at the last. */
export const GLOW_STOPS = [{ at: 0, alpha: 1 }, { at: .42, alpha: .6 }, { at: .78, alpha: 0 }] as const;

/** Lighting for one moment of the day. Every colour is a multiplier on the drawn tone. */
export interface SceneDaylight {
  /** Share of direct sunlight, 0–1; 0 leaves only the sky. */
  readonly direct: number;
  /** The sun has set: `light` points to the zenith, and its shadow map tells indoors from out. */
  readonly night: boolean;
  /** How far the lamps are on indoors, 0–1; only after sunset. */
  readonly lamp: number;
  /** Colours of the sky light, of direct sun on the faces it reaches, and of lamp light indoors. */
  readonly tint: readonly [number, number, number];
  readonly sunTint: readonly [number, number, number];
  readonly lampTint: readonly [number, number, number];
}

export interface MeshPalette {
  readonly paper: string; readonly wall: string; readonly top: string; readonly cut: string;
  readonly room: string; readonly selected: string; readonly context: string; readonly ghost: string;
}
export const DEFAULT_MESH_PALETTE: MeshPalette = Object.freeze({
  paper: '#ECEEE9', wall: '#FBF9F4', top: '#EEE5D2', cut: '#2B3650', room: '#F4E8CC', selected: '#FFD25E', context: '#FCE7A6', ghost: '#FBF9F4',
});
const GHOST_ALPHA = .14, DEFAULT_AMBIENT = .6;

type Rgb = [number, number, number];
const rgb = (hex: string): Rgb => [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255) as Rgb;
export const linearRgb = (color: Rgb): Rgb => color.map(value => value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4) as Rgb;
const mix = (a: Rgb, b: Rgb, t: number) => a.map((v, i) => v + (b[i]! - v) * t) as Rgb;
const clamp01 = (value: number) => Math.min(1, Math.max(0, value));
const REFERENCE = rgb('#C3CED6'), REFERENCE_TOP = rgb('#D7DFE4');
const unit = (x: number, y: number, z: number): Rgb => { const l = Math.hypot(x, y, z); return [x / l, y / l, z / l]; };
const FIXED_LIGHT = unit(-.45, .8, .55);
const tones = (palette: Partial<MeshPalette> | undefined) => {
  const own = { ...DEFAULT_MESH_PALETTE, ...palette };
  return { PAPER: rgb(own.paper), WALL: rgb(own.wall), TOP: rgb(own.top), CUT: rgb(own.cut), ROOM: rgb(own.room),
    LANTERN: rgb(own.selected), CONTEXT: rgb(own.context), GHOST: rgb(own.ghost) };
};

/** Which pass draws a mesh. The reference layer sits behind, bound rooms in front,
 * and glass over everything solid. */
export const MeshPass = Object.freeze({ None: 0, Reference: 1, Unbound: 2, Bound: 3, Glass: 4 } as const);
export type MeshPass = typeof MeshPass[keyof typeof MeshPass];

/** Texels (RGBA float) per mesh in the state table read by the shaders. */
export const STATE_TEXELS = 9;
/** Floats per mesh in the state table. Layout, by texel:
 * 0 top.rgb, usePitch · 1 base.rgb, useSourceColor · 2 cut.rgb, useClip · 3 pitch.rgb, clipY
 * 4 shade.rgb, lift · 5 pass, ghost, ghostUseFloor, ghostFloorY · 6 useMaterial, materialDim, room, glassOpacity
 * 7 shelter, keepTone, glassFrost, emitter · 8 lampColor.rgb, fades */
export const STATE_FLOATS = STATE_TEXELS * 4;

/** Emitters that light their surroundings in one frame, and how close two must be to count as one. */
export const MAX_LAMPS = 16;
const LAMP_MERGE = .75;
/** The colour of a lamp whose material states none, linear: a warm bulb. */
export const LAMP_COLOR: Rgb = [1, .72, .42];
/** Glass: how much of what lies behind a pane it covers when its material states no
 * alpha below 1, and the most any pane covers, so the room behind always shows. */
const GLASS_OPACITY = .1, GLASS_OPACITY_MAX = .85;
/** A pane is clear up to this source roughness and fully frosted by GLASS_FROSTED:
 * exporters often leave half roughness on clear glass. */
export const GLASS_CLEAR = .5, GLASS_FROSTED = .9;
/** Beams merge only when their directions are this close (a cosine). */
const AIM_MERGE = .8;
export interface Lamp { readonly at: Rgb; readonly aim: Rgb | null; readonly color: Rgb }

/** Uniform values shared by every mesh in a frame. */
export interface FrameAppearance {
  readonly ambient: number;
  readonly twoSided: boolean;
  readonly light: Rgb;
  /** Linear paper tone that dimmed source materials fall toward. */
  readonly materialPaper: Rgb;
  readonly ghostAlpha: number;
  readonly ghostColor: Rgb;
  readonly ghostShade: Rgb;
  readonly direct: number;
  readonly night: boolean;
  readonly lamp: number;
  readonly tint: Rgb;
  readonly sunTint: Rgb;
  readonly lampTint: Rgb;
  /** Up to MAX_LAMPS shown emitters, merged when close and aimed alike, as lifted
   * points that light their surroundings, or a cone along `aim`, in their colour. */
  readonly lamps: readonly Lamp[];
  /** Whether any mesh is a room volume, so indoors also needs a room's footprint. */
  readonly rooms: boolean;
  /** Passes with at least one mesh this frame; empty passes are skipped. */
  readonly passes: ReadonlySet<MeshPass>;
  readonly ghosts: boolean;
  /** The fade of the surroundings, when any mesh fades, with the backdrop's colours as display values. */
  readonly fade: (Omit<Surroundings, 'keys' | 'lean' | 'backdrop'> & {
    readonly backdrop: { readonly top: Rgb; readonly bottom: Rgb; readonly glow: Rgb; readonly glowAt: readonly [number, number]; readonly glowRadii: readonly [number, number] };
  }) | null;
}

/** Write every mesh's presentation into `out` (STATE_FLOATS per mesh, in mesh
 * order) and return the frame-wide values. Pure: the same inputs always give the
 * same table, so callers upload only when it changed. */
export function writeAppearance(meshes: readonly PreparedMesh[], p: AppearanceInput, out: Float32Array): FrameAppearance {
  const { PAPER, WALL, TOP, CUT, ROOM, LANTERN, CONTEXT, GHOST } = tones(p.palette);
  // Black shade is the plain lit tone (base × light); a shade tone is Atlas lighting only.
  const SHADE: Rgb = p.twoSided && p.shade ? rgb(p.shade) : [0, 0, 0];
  const PITCH = p.twoSided && p.pitch ? rgb(p.pitch) : null;
  const SITE = p.twoSided && p.site ? rgb(p.site.tone) : null;
  const SOURCE_DIM = clamp01(p.sourceDim ?? 1);
  const DAY = p.twoSided && p.daylight ? p.daylight : null;
  const passes = new Set<MeshPass>(); let ghosts = false, rooms = false;
  type Gathered = { at: Rgb; aim: Rgb | null; color: Rgb; count: number };
  const lamps: Gathered[] = [];
  // Gathered lamps by the LAMP_MERGE cell of their centre, so the cells next to an
  // emitter's hold every lamp in reach.
  const cells = new Map<number, Gathered[]>(), cell = (value: number) => Math.floor(value / LAMP_MERGE);
  // One number per cell: distinct within ±90 km of the origin at a LAMP_MERGE cell size.
  const cellKey = (x: number, y: number, z: number) => (x * 2 ** 18 + y) * 2 ** 18 + z;
  const home = (at: Rgb) => cellKey(cell(at[0]), cell(at[1]), cell(at[2]));
  const LIT = DAY !== null && DAY.lamp > 0;
  const AROUND = p.twoSided && p.surroundings && p.surroundings.far > p.surroundings.near ? p.surroundings : null;
  let fades = false;
  meshes.forEach((mesh, index) => {
    const o = index * STATE_FLOATS, key = mesh.meshKey;
    const kind: MeshPass = p.referenceKeys?.has(key) ? MeshPass.Reference : mesh.occurrenceId !== null ? MeshPass.Bound : MeshPass.Unbound;
    const floor = drawsFloor(p.rules, mesh.floorId);
    const selected = p.selectedKeys?.has(key) ?? false;
    // Selection and overlay tints keep most of their strength in any light.
    const keep = selected || mesh.occurrenceId !== null && kind !== MeshPass.Reference && (mesh.occurrenceId === p.selectedOccurrenceId
      || p.contextOccurrenceIds.includes(mesh.occurrenceId) || p.tints.has(mesh.occurrenceId));
    // Building glass is see-through, unless it is picked out: then it keeps the solid pick tone.
    const glass = DAY !== null && p.glazingKeys?.has(key) === true && kind !== MeshPass.Reference && !keep;
    const fade = AROUND !== null && AROUND.keys.has(key);
    // Surroundings wholly past the fade are not drawn: no fragments, no shadow, no contact shading.
    const gone = fade && beyond(mesh.bounds, AROUND);
    const pass: MeshPass = floor && !gone && !p.hiddenKeys?.has(key) ? glass ? MeshPass.Glass : kind : MeshPass.None;
    if (fade && pass !== MeshPass.None) fades = true;
    if (pass !== MeshPass.None) passes.add(pass);
    const dim = p.dims ? p.dims.get(key) ?? 0 : mesh.floorId !== p.currentFloorId ? .55 : 0;
    const clip = p.clips?.has(key) ? p.clips.get(key) ?? null : p.rules.clipY;
    const source = sourceMeshColor(mesh, { enabled: p.sourceColors, selected, reference: kind === MeshPass.Reference,
      selectedOccurrenceId: p.selectedOccurrenceId, contextOccurrenceIds: p.contextOccurrenceIds, tints: p.tints });
    let top: Rgb, base: Rgb, cut: Rgb, pitch: Rgb | null = null, shade = SHADE;
    if (selected) { top = LANTERN; base = LANTERN; cut = mix(LANTERN, CUT, .18); }
    else if (kind === MeshPass.Reference) { top = REFERENCE_TOP; base = REFERENCE; cut = mix(REFERENCE, CUT, .3); }
    else if (source) {
      // Lighting and dimming stay linear; the shader encodes once at
      // output. Authored grass/glazing/roof colours precede fallback
      // site and pitch tones, without changing any geometry or picks.
      // An opt-in share keeps dimmed context in its own hue.
      top = mix([source[0], source[1], source[2]], linearRgb(PAPER), dim * SOURCE_DIM);
      base = top; cut = mix(top, linearRgb(CUT), .18); shade = [0, 0, 0];
    } else if (mesh.occurrenceId !== null) {
      const tint = mesh.occurrenceId === p.selectedOccurrenceId ? LANTERN : p.contextOccurrenceIds.includes(mesh.occurrenceId) ? CONTEXT
        : p.tints.has(mesh.occurrenceId) ? rgb(p.tints.get(mesh.occurrenceId)!) : ROOM;
      top = mesh.occurrenceId === p.selectedOccurrenceId ? tint : mix(tint, PAPER, dim);
      base = top; cut = mix(top, CUT, .18);
      // With a pitch tone, a room's own faces fall toward a deeper shade of its tint, never a drab one.
      if (PITCH) shade = mix(SHADE, base, .45);
    } else if (SITE && p.site!.keys.has(key)) {
      // Ground: one tone at every slope, barely shaded, so terrain never reads as mass.
      top = mix(SITE, PAPER, dim * .25); base = top; pitch = top; cut = mix(top, CUT, .25); shade = mix(SHADE, top, .82);
    } else {
      top = mix(TOP, PAPER, dim); base = mix(WALL, PAPER, dim); cut = mix(CUT, PAPER, dim * .8);
      if (PITCH && p.pitchKeys?.has(key)) pitch = mix(PITCH, PAPER, dim);
    }
    const ghost = p.ghosts?.has(key) === true && floor, above = ghost ? p.ghosts!.get(key) ?? null : null;
    if (ghost) ghosts = true;
    const put = (texel: number, color: Readonly<Rgb>, w: number) => {
      const at = o + texel * 4; out[at] = color[0]; out[at + 1] = color[1]; out[at + 2] = color[2]; out[at + 3] = w;
    };
    put(0, top, pitch ? 1 : 0); put(1, base, source ? 1 : 0); put(2, cut, clip === null ? 0 : 1); put(3, pitch ?? base, clip ?? 0);
    put(4, shade, p.lifts?.get(key) ?? 0);
    out[o + 20] = pass; out[o + 21] = ghost ? 1 : 0; out[o + 22] = above === null ? 0 : 1; out[o + 23] = above ?? 0;
    out[o + 24] = source && p.sourceMaterials && mesh.sourceMaterial ? 1 : 0; out[o + 25] = clamp01(dim * SOURCE_DIM);
    const room = DAY !== null && p.roomKeys?.has(key) === true; out[o + 26] = room ? 1 : 0; if (room) rooms = true;
    // Glass: the material's alpha is how much the pane covers; its roughness how frosted it is.
    const alpha = mesh.sourceBaseColor?.[3] ?? 1, roughness = mesh.sourceRoughness ?? 0;
    out[o + 27] = glass ? Math.min(GLASS_OPACITY_MAX, alpha < 1 ? alpha : GLASS_OPACITY) : 0;
    const frost = glass ? clamp01((roughness - GLASS_CLEAR) / (GLASS_FROSTED - GLASS_CLEAR)) : 0;
    out[o + 28] = DAY && p.shelterKeys?.has(key) ? 1 : 0; out[o + 29] = DAY && keep ? 1 : 0;
    const emitter = DAY !== null && p.emitterKeys?.has(key) === true;
    out[o + 30] = frost; out[o + 31] = emitter ? 1 : 0;
    const color: Readonly<Rgb> = mesh.sourceGlow ?? LAMP_COLOR; put(8, emitter ? color : [0, 0, 0], fade ? 1 : 0);
    // A lamp cut away whole by the section stays dark, so it never takes a visible lamp's place.
    if (LIT && emitter && pass !== MeshPass.None && (clip === null || mesh.bounds.min[1] <= clip)) {
      const { min, max } = mesh.bounds, lift = p.lifts?.get(key) ?? 0;
      const at: Rgb = [(min[0] + max[0]) / 2, (min[1] + max[1]) / 2 + lift, (min[2] + max[2]) / 2];
      const aim = mesh.aim ?? null, [cx, cy, cz] = at.map(cell) as unknown as Rgb;
      const alike = (lamp: Gathered) => Math.hypot(lamp.at[0] - at[0], lamp.at[1] - at[1], lamp.at[2] - at[2]) < LAMP_MERGE
        && (lamp.aim === null ? aim === null : aim !== null && lamp.aim[0] * aim[0] + lamp.aim[1] * aim[1] + lamp.aim[2] * aim[2] >= AIM_MERGE);
      let near: Gathered | undefined;
      for (let dx = -1; dx <= 1 && !near; dx++) for (let dy = -1; dy <= 1 && !near; dy++) for (let dz = -1; dz <= 1 && !near; dz++)
        near = cells.get(cellKey(cx + dx, cy + dy, cz + dz))?.find(alike);
      if (near) {
        const was = cells.get(home(near.at))!; was.splice(was.indexOf(near), 1);
        near.at = near.at.map((value, axis) => (value * near.count + at[axis]!) / (near.count + 1)) as unknown as Rgb;
        if (near.aim && aim) {
          const sum = near.aim.map((value, axis) => value * near.count + aim[axis]!), length = Math.hypot(...sum);
          near.aim = sum.map(value => value / length) as unknown as Rgb;
        }
        near.color = near.color.map((value, channel) => (value * near.count + color[channel]!) / (near.count + 1)) as unknown as Rgb;
        near.count++;
      }
      const lamp = near ?? { at, aim: aim && [...aim] as Rgb, color: [...color] as Rgb, count: 1 }, now = home(lamp.at);
      if (!near) lamps.push(lamp);
      const held = cells.get(now); if (held) held.push(lamp); else cells.set(now, [lamp]);
    }
  });
  // An opt-in ghost opacity also keeps the ghost nearly flat, so stacked faded floors stay one quiet veil.
  const quiet = p.twoSided === true && p.ghostAlpha !== undefined;
  return {
    ambient: clamp01(p.ambient ?? DEFAULT_AMBIENT), twoSided: p.twoSided === true,
    light: p.twoSided && p.light ? [...p.light] as Rgb : FIXED_LIGHT, materialPaper: linearRgb(PAPER),
    ghostAlpha: quiet ? clamp01(p.ghostAlpha!) : GHOST_ALPHA, ghostColor: GHOST, ghostShade: quiet ? mix(SHADE, GHOST, .8) : SHADE,
    direct: DAY ? clamp01(DAY.direct) : 1, night: DAY?.night === true, lamp: DAY ? clamp01(DAY.lamp) : 0,
    tint: DAY ? [...DAY.tint] as Rgb : [1, 1, 1], sunTint: DAY ? [...DAY.sunTint] as Rgb : [1, 1, 1], lampTint: DAY ? [...DAY.lampTint] as Rgb : [1, 1, 1],
    lamps: lamps.sort((a, b) => b.count - a.count).slice(0, MAX_LAMPS).map(({ at, aim, color }) => ({ at, aim, color })),
    rooms, passes, ghosts,
    fade: fades && AROUND ? { center: [...AROUND.center], half: [...AROUND.half], near: AROUND.near, far: AROUND.far, ground: AROUND.ground, backdrop: {
      top: rgb(AROUND.backdrop.top), bottom: rgb(AROUND.backdrop.bottom), glow: rgb(AROUND.backdrop.glow),
      glowAt: [...AROUND.backdrop.glowAt], glowRadii: [...AROUND.backdrop.glowRadii] } } : null,
  };
}

/** Whether bounds are seen only against ground past the far edge of the fade, from any view. */
function beyond(bounds: PreparedMesh['bounds'], around: Surroundings): boolean {
  const gap = [0, 2].map((axis, at) => Math.max(0,
    Math.abs((bounds.min[axis]! + bounds.max[axis]!) / 2 - around.center[at]!) - (bounds.max[axis]! - bounds.min[axis]!) / 2 - around.half[at]!));
  const lean = Math.max(0, bounds.max[1] - around.ground, around.ground - bounds.min[1]) * around.lean;
  return Math.hypot(gap[0]!, gap[1]!) - lean >= around.far;
}
