// Tiny glyphs drawn inside model pins. Paths live in a 10 x 10 box.
export const GLYPH = {
  item: 'M5 1.6 8.4 3.4v3.4L5 8.6 1.6 6.8V3.4Z M1.6 3.4 5 5.2 8.4 3.4 M5 5.2v3.4',
  container: 'M2 2.5h6v5H2Z M2 5h6 M4.3 3.7h1.4 M4.3 6.3h1.4',
  outlet: 'M3.6 4.2v1.6 M6.4 4.2v1.6',
  panel: 'M5.9 1.4 2.9 5.6h2.3L4.1 8.6 7.1 4.4H4.8Z',
  valve: 'M2.2 3.4h5.6 M5 3.4v3.8 M3.2 7.2h3.6',
  device: 'M2.4 4.4a3.7 3.7 0 0 1 5.2 0 M3.6 5.8a1.9 1.9 0 0 1 2.8 0 M5 7.4v.1',
  task: 'M5 2.2v3.8 M5 7.6v.1',
  taskSoon: 'M5 2.4v2.8l1.8 1.2',
} as const;

export type GlyphName = keyof typeof GLYPH;

export const FILLED_GLYPHS: GlyphName[] = ['panel'];
