type Rgb = readonly [number, number, number];

/** The sky's light on the house for one hour: how much and what colour of light a face
 * gets from the whole dome by the way it faces, and the dome itself for glass to mirror. */
export interface SkyLight {
  /** Irradiance by face direction as nine spherical-harmonic RGB terms, constants folded
   * in (see `skyLight`): looking straight up it reads 1.1 in luminance, and a wall square to
   * the sun's side reads grey, so the hour's own sky tint still sets the overall colour and
   * only the differences by direction come from here. */
  readonly irradiance: readonly number[];
  /** The dome as glass mirrors it, linear, on the same scale: overhead, at the horizon,
   * the ground below, and the glow toward the sun near the horizon. */
  readonly zenith: Rgb;
  readonly horizon: Rgb;
  readonly ground: Rgb;
  readonly glow: Rgb;
  /** Horizontal unit direction toward the sun, set or not, in the model frame. */
  readonly glowToward: Rgb;
}

/** The ambient term as drawn before the sky had a direction: 0.7 looking down, 1.1 up, white. */
export const FLAT_SKY: SkyLight = Object.freeze({
  irradiance: Object.freeze([.9, .9, .9, .2, .2, .2, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]),
  zenith: [.3, .48, .78], horizon: [.78, .84, .9], ground: [.2, .2, .19], glow: [0, 0, 0], glowToward: [0, 0, -1],
} satisfies SkyLight);

/** Dome colours by sun altitude (degrees, highest first), linear, before normalising:
 * a blue zenith and pale horizon by day; a strong glow toward the sun as it sets while
 * the far sky stays blue; a fading afterglow; then a dim, even night blue. Ground is the
 * light the ground and surroundings throw back up. `chroma` is how much of the dome's
 * colour by direction is kept: little at midday, so the drawn palette holds, most of it
 * around sunset. */
type Dome = { readonly zenith: Rgb; readonly horizon: Rgb; readonly ground: Rgb; readonly glow: Rgb; readonly chroma: number };
const DOME: readonly (readonly [number, Dome])[] = [
  [25, { zenith: [.34, .52, .92], horizon: [.8, .86, .98], ground: [.42, .39, .33], glow: [.2, .16, .1], chroma: .3 }],
  [8, { zenith: [.42, .48, .66], horizon: [.6, .7, .92], ground: [.4, .34, .27], glow: [1.7, 1.05, .45], chroma: .7 }],
  [2, { zenith: [.26, .33, .6], horizon: [.5, .56, .82], ground: [.28, .23, .19], glow: [2.8, 1.3, .5], chroma: .75 }],
  [-2, { zenith: [.16, .2, .44], horizon: [.36, .36, .6], ground: [.16, .14, .14], glow: [1.8, .75, .5], chroma: .7 }],
  [-7, { zenith: [.08, .1, .26], horizon: [.16, .16, .3], ground: [.06, .06, .08], glow: [.4, .18, .2], chroma: .5 }],
  [-12, { zenith: [.05, .07, .16], horizon: [.07, .08, .14], ground: [.035, .04, .05], glow: [0, 0, 0], chroma: .4 }],
];
/** How tight the glow toward the sun is around it, and how fast it fades above the horizon. */
export const GLOW_SPREAD = 1.5, GLOW_HEIGHT = 3;
/** Share of the sky's colour by direction drawn, on top of each hour's own `chroma`. */
const SKY_CHROMA = .55;
/** Luminance looking straight up, the old sky term's top. */
const UP = 1.1;
/** Glass mirrors the horizon at about this luminance on average, as the fixed sky it replaces did. */
const GLASS_LEVEL = .84;
export const LUMA: Rgb = [.2126, .7152, .0722];
const luma = (c: Rgb) => c[0] * LUMA[0] + c[1] * LUMA[1] + c[2] * LUMA[2];

function domeAt(altitude: number): Dome {
  if (altitude >= DOME[0]![0]) return DOME[0]![1];
  for (let i = 1; i < DOME.length; i++) {
    const [high, a] = DOME[i - 1]!, [low, b] = DOME[i]!;
    if (altitude >= low) {
      const t = (high - altitude) / (high - low), lerp = (x: Rgb, y: Rgb) => x.map((v, c) => v + (y[c]! - v) * t) as unknown as Rgb;
      return { zenith: lerp(a.zenith, b.zenith), horizon: lerp(a.horizon, b.horizon), ground: lerp(a.ground, b.ground), glow: lerp(a.glow, b.glow),
        chroma: a.chroma + (b.chroma - a.chroma) * t };
    }
  }
  return DOME[DOME.length - 1]![1];
}

/** Cosine-lobe convolution per band (Ramamoorthi and Hanrahan) times each basis function's
 * constant, so the projected terms give irradiance with the constants already folded in. */
const FOLD = [Math.PI * .282095, 2 * Math.PI / 3 * .488603, 2 * Math.PI / 3 * .488603, 2 * Math.PI / 3 * .488603,
  Math.PI / 4 * 1.092548, Math.PI / 4 * 1.092548, Math.PI / 4 * .315392, Math.PI / 4 * 1.092548, Math.PI / 4 * .546274];
/** Sphere samples for the projection, by latitude and longitude rings: the dome is smooth, and
 * nine terms need no more. Directions and their weighted, folded basis are fixed, so a new hour
 * only evaluates the dome at each. */
const ROWS = 16, COLUMNS = 32, SAMPLES = ROWS * COLUMNS;
const DIRECTIONS = new Float64Array(SAMPLES * 3), WEIGHTS = new Float64Array(SAMPLES * 9);
for (let r = 0, i = 0; r < ROWS; r++) {
  const theta = (r + .5) / ROWS * Math.PI, ring = Math.sin(theta) * (Math.PI / ROWS) * (2 * Math.PI / COLUMNS);
  for (let c = 0; c < COLUMNS; c++, i++) {
    const phi = (c + .5) / COLUMNS * 2 * Math.PI;
    const x = Math.sin(theta) * Math.cos(phi), y = Math.cos(theta), z = Math.sin(theta) * Math.sin(phi);
    DIRECTIONS.set([x, y, z], i * 3);
    // Real spherical harmonics up to order 2, constants aside (they are in FOLD).
    const basis = [.282095, .488603 * y, .488603 * z, .488603 * x, 1.092548 * x * y, 1.092548 * y * z, .315392 * (3 * z * z - 1), 1.092548 * x * z, .546274 * (x * x - y * y)];
    for (let k = 0; k < 9; k++) WEIGHTS[i * 9 + k] = basis[k]! * ring * FOLD[k]!;
  }
}

/** Irradiance at unit direction n from terms with the constants folded in. */
function irradianceAt(terms: readonly Rgb[], [x, y, z]: Rgb): Rgb {
  const f = [1, y, z, x, x * y, y * z, 3 * z * z - 1, x * z, x * x - y * y];
  return [0, 1, 2].map(ch => terms.reduce((sum, t, k) => sum + t[ch]! * f[k]!, 0)) as unknown as Rgb;
}

/** The sky for a sun altitude (degrees) and direction toward the sun in the model frame,
 * which may point below the horizon. Projects the dome onto nine terms on the CPU, 512
 * samples per new hour, so a face evaluates its whole sky light in nine
 * multiply-adds. Terms are stored with the basis constants folded in:
 * E(n) = t0 + t1·y + t2·z + t3·x + t4·xy + t5·yz + t6·(3z² − 1) + t7·xz + t8·(x² − y²). */
export function skyLight(altitude: number, toward: Rgb): SkyLight {
  const dome = domeAt(altitude);
  const across = Math.hypot(toward[0], toward[2]);
  const flat: Rgb = across > 1e-6 ? [toward[0] / across, 0, toward[2] / across] : [0, 0, -1];
  const sums = new Float64Array(27), { zenith, horizon, ground, glow } = dome;
  for (let i = 0; i < SAMPLES; i++) {
    // The dome in this direction: horizon to zenith above, the glow low toward the sun, the ground below.
    const x = DIRECTIONS[i * 3]!, y = DIRECTIONS[i * 3 + 1]!, z = DIRECTIONS[i * 3 + 2]!;
    let r = ground[0], g = ground[1], b = ground[2];
    if (y >= 0) {
      const up = Math.sqrt(y), facing = Math.max(0, (x * flat[0] + z * flat[2]) / (Math.hypot(x, z) || 1)) ** GLOW_SPREAD * (1 - y) ** GLOW_HEIGHT;
      r = horizon[0] + (zenith[0] - horizon[0]) * up + glow[0] * facing;
      g = horizon[1] + (zenith[1] - horizon[1]) * up + glow[1] * facing;
      b = horizon[2] + (zenith[2] - horizon[2]) * up + glow[2] * facing;
    }
    for (let k = 0; k < 9; k++) { const w = WEIGHTS[i * 9 + k]!; sums[k * 3]! += r * w; sums[k * 3 + 1]! += g * w; sums[k * 3 + 2]! += b * w; }
  }
  const terms = Array.from({ length: 9 }, (_, k) => [sums[k * 3]!, sums[k * 3 + 1]!, sums[k * 3 + 2]!] as const);
  // A wall square to the sun's side reads grey, so the hour's tint keeps the overall colour
  // and only the differences by direction come from here: warm toward the sun, blue away.
  const side = irradianceAt(terms, [-flat[2], 0, flat[0]]), grey = luma(side);
  const balance = side.map(v => grey / Math.max(v, 1e-6)) as unknown as Rgb;
  const keep = (c: Rgb): Rgb => { const y = luma(c); return c.map(v => y + (v - y) * dome.chroma * SKY_CHROMA) as unknown as Rgb; };
  const balanced = terms.map(t => keep(t.map((v, ch) => v * balance[ch]!) as unknown as Rgb));
  const up = luma(irradianceAt(balanced, [0, 1, 0]));
  const scale = UP / Math.max(up, 1e-6);
  const glass = GLASS_LEVEL / Math.max(luma(dome.horizon.map((v, ch) => v * balance[ch]!) as unknown as Rgb), 1e-6);
  const mirror = (c: Rgb) => c.map((v, ch) => v * balance[ch]! * glass) as unknown as Rgb;
  return {
    irradiance: balanced.flatMap(t => t.map(v => v * scale)),
    zenith: mirror(dome.zenith), horizon: mirror(dome.horizon), ground: mirror(dome.ground), glow: mirror(dome.glow), glowToward: flat,
  };
}
