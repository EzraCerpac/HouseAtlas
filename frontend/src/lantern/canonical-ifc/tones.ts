import type { OverlayTone } from './model';

/** Existing Lantern layer colors (tokens.css), keyed by overlay tone. */
export const TONE_COLOR: Record<OverlayTone, string> = {
  electrical: '#2F56E0',
  network: '#B97A00',
  water: '#0B8F83',
  belongings: '#9C3F8F',
  upkeep: '#D93D2E',
};

const channels = (hex: string) => [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16));
const hexOf = (rgb: readonly number[]) => `#${rgb.map(v => Math.round(v).toString(16).padStart(2, '0')).join('')}`;
function luminance(hex: string): number {
  const [r, g, b] = channels(hex).map(v => { const c = v / 255; return c <= .04045 ? c / 12.92 : ((c + .055) / 1.055) ** 2.4; });
  return .2126 * r! + .7152 * g! + .0722 * b!;
}
/** WCAG 2.2 contrast ratio. */
export function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi! + .05) / (lo! + .05);
}

/** Count-badge fill: the layer hue darkened toward black only as far as needed
 * for white 12px numerals to reach 4.6:1 (WCAG 1.4.3 needs 4.5:1). */
export function badgeFill(tone: OverlayTone): string {
  const base = channels(TONE_COLOR[tone]);
  for (let step = 0; step <= 20; step++) {
    const candidate = hexOf(base.map(v => v * (1 - step * .04)));
    if (contrast(candidate, '#FFFFFF') >= 4.6) return candidate;
  }
  return '#18233A';
}

/** Light room fill for rooms with records in the active overlay. */
export function toneTint(tone: OverlayTone): string {
  return hexOf(channels(TONE_COLOR[tone]).map(v => v * .26 + 255 * .74));
}
