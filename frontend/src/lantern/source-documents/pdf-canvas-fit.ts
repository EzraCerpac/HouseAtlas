/** Canvas budget, independent of the compressed file size: page geometry,
 * UserUnit, zoom and pixel ratio can otherwise request any allocation. */
export const SOURCE_PDF_CANVAS = Object.freeze({ maxSide: 8192, maxPixels: 16_777_216 });

type Fit = { readonly cssScale: number; readonly ratio: number; readonly width: number; readonly height: number; readonly reduced: boolean };
/** Fits one page into the canvas budget, dropping pixel ratio before display
 * size. Null when the page has no finite positive size or cannot fit at all. */
export function fitPdfCanvas(baseWidth: number, baseHeight: number, scale: number, pixelRatio: number): Fit | null {
  if (!(Number.isFinite(baseWidth) && Number.isFinite(baseHeight) && baseWidth > 0 && baseHeight > 0
    && Number.isFinite(scale) && scale > 0 && Number.isFinite(pixelRatio) && pixelRatio > 0)) return null;
  const { maxSide, maxPixels } = SOURCE_PDF_CANVAS;
  const cap = Math.min(maxSide / baseWidth, maxSide / baseHeight, Math.sqrt(maxPixels / baseWidth / baseHeight));
  const device = Math.min(scale * pixelRatio, cap), cssScale = Math.min(scale, device);
  const width = Math.floor(baseWidth * device), height = Math.floor(baseHeight * device);
  if (!(width >= 1 && height >= 1 && width <= maxSide && height <= maxSide && width * height <= maxPixels)) return null;
  return { cssScale, ratio: device / cssScale, width, height, reduced: device < scale * pixelRatio };
}
