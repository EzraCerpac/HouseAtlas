/** Resolve a recorded reference without substituting another PDF page. */
export function resolveRecordedPdfPage(page: number, pageCount: number): number | null {
  if (!Number.isSafeInteger(page) || page <= 0
    || !Number.isSafeInteger(pageCount) || pageCount <= 0
    || page > pageCount) return null;
  return page;
}
