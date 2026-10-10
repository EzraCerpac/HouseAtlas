/** Browser labels only. A camera request may fall back to a picker; the browser
 * may transform bytes before returning File. This asserts no device-original proof. */
export interface BrowserSelectionClaim {
  readonly schemaVersion: 1;
  readonly selectionMethod: 'camera-request' | 'photo-picker' | 'file-picker';
  readonly selectedAt: string;
  readonly filename: string;
  readonly reportedContentType: string;
  readonly byteOrigin: 'browser-returned-unmodified';
}
export function validateSelectionClaim(value: BrowserSelectionClaim, filename: string): void {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      Object.keys(value).length !== 6 || value.schemaVersion !== 1 ||
      !['camera-request', 'photo-picker', 'file-picker'].includes(value.selectionMethod) ||
      value.filename !== filename || typeof value.selectedAt !== 'string' || value.selectedAt.length > 64 ||
      !Number.isFinite(Date.parse(value.selectedAt)) ||
      typeof value.reportedContentType !== 'string' || Array.from(value.reportedContentType).length > 255 ||
      /[\u0000-\u001f\u007f-\u009f]/u.test(value.reportedContentType) ||
      value.byteOrigin !== 'browser-returned-unmodified')
    throw new TypeError('Browser selection claim is incompatible');
}
