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
  /** Colour overrides (hex); omitted entries keep the default tones. */
  readonly palette?: Partial<MeshPalette> | undefined;
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

/** Which pass draws a mesh. The reference layer sits behind, bound rooms in front. */
export const MeshPass = Object.freeze({ None: 0, Reference: 1, Unbound: 2, Bound: 3 } as const);
export type MeshPass = typeof MeshPass[keyof typeof MeshPass];

/** Texels (RGBA float) per mesh in the state table read by the shaders. */
export const STATE_TEXELS = 8;
/** Floats per mesh in the state table. Layout, by texel:
 * 0 top.rgb, usePitch · 1 base.rgb, useSourceColor · 2 cut.rgb, useClip · 3 pitch.rgb, clipY
 * 4 shade.rgb, lift · 5 pass, ghost, ghostUseFloor, ghostFloorY · 6 useMaterial, materialDim · 7 unused */
export const STATE_FLOATS = STATE_TEXELS * 4;

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
  /** Passes with at least one mesh this frame; empty passes are skipped. */
  readonly passes: ReadonlySet<MeshPass>;
  readonly ghosts: boolean;
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
  const passes = new Set<MeshPass>(); let ghosts = false;
  meshes.forEach((mesh, index) => {
    const o = index * STATE_FLOATS, key = mesh.meshKey;
    const kind: MeshPass = p.referenceKeys?.has(key) ? MeshPass.Reference : mesh.occurrenceId !== null ? MeshPass.Bound : MeshPass.Unbound;
    const floor = drawsFloor(p.rules, mesh.floorId);
    const pass: MeshPass = floor && !p.hiddenKeys?.has(key) ? kind : MeshPass.None;
    if (pass !== MeshPass.None) passes.add(pass);
    const dim = p.dims ? p.dims.get(key) ?? 0 : mesh.floorId !== p.currentFloorId ? .55 : 0;
    const clip = p.clips?.has(key) ? p.clips.get(key) ?? null : p.rules.clipY;
    const selected = p.selectedKeys?.has(key) ?? false;
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
    const put = (texel: number, color: Rgb, w: number) => {
      const at = o + texel * 4; out[at] = color[0]; out[at + 1] = color[1]; out[at + 2] = color[2]; out[at + 3] = w;
    };
    put(0, top, pitch ? 1 : 0); put(1, base, source ? 1 : 0); put(2, cut, clip === null ? 0 : 1); put(3, pitch ?? base, clip ?? 0);
    put(4, shade, p.lifts?.get(key) ?? 0);
    out[o + 20] = pass; out[o + 21] = ghost ? 1 : 0; out[o + 22] = above === null ? 0 : 1; out[o + 23] = above ?? 0;
    out[o + 24] = source && p.sourceMaterials && mesh.sourceMaterial ? 1 : 0; out[o + 25] = clamp01(dim * SOURCE_DIM);
  });
  // An opt-in ghost opacity also keeps the ghost nearly flat, so stacked faded floors stay one quiet veil.
  const quiet = p.twoSided === true && p.ghostAlpha !== undefined;
  return {
    ambient: clamp01(p.ambient ?? DEFAULT_AMBIENT), twoSided: p.twoSided === true,
    light: p.twoSided && p.light ? [...p.light] as Rgb : FIXED_LIGHT, materialPaper: linearRgb(PAPER),
    ghostAlpha: quiet ? clamp01(p.ghostAlpha!) : GHOST_ALPHA, ghostColor: GHOST, ghostShade: quiet ? mix(SHADE, GHOST, .8) : SHADE,
    passes, ghosts,
  };
}
