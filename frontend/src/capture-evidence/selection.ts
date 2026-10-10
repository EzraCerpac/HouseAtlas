import { validateSelectionClaim, type BrowserSelectionClaim } from './types';

export const CAPTURE_MAX_BYTES = 10 * 1024 * 1024;
export const CAPTURE_TYPES = ['image/png', 'image/jpeg', 'application/pdf', 'text/plain'] as const;
export type SelectionMethod = BrowserSelectionClaim['selectionMethod'];
export interface EvidenceSelection {
  /** Original browser object; no app transform or metadata stripping. */
  readonly original: File;
  /** Same bytes; only an empty/generic/alias MIME label may be canonicalized. */
  readonly file: File;
  readonly capture: BrowserSelectionClaim;
}
export interface SelectionPolicy { readonly contentTypes: readonly string[]; readonly maximumBytes: number }

/** Client usability check. Media measures and validates actual bytes again. */
export async function selectEvidenceFile(original: File, method: SelectionMethod, policy: SelectionPolicy,
  signal: AbortSignal, selectedAt = new Date().toISOString()): Promise<EvidenceSelection> {
  signal.throwIfAborted();
  if (!original.name || Array.from(original.name).length > 255 || /[/\\\u0000-\u001f]/u.test(original.name))
    throw new Error('The filename must contain at most 255 characters, without path separators.');
  if (!original.size) throw new Error('Choose a file containing evidence.');
  if (original.size > Math.min(policy.maximumBytes, CAPTURE_MAX_BYTES))
    throw new Error('The file exceeds the displayed size limit.');
  const reported = original.type;
  const head = new Uint8Array(await original.slice(0, 32).arrayBuffer());
  signal.throwIfAborted();
  const ascii = (start: number, end: number) => String.fromCharCode(...head.slice(start, end));
  const container = ascii(4, 8) === 'ftyp';
  if (/heic|heif/i.test(reported) || /\.(heic|heif)$/i.test(original.name) || (container && /^(hei[cfxms]|mif1|msf1)$/i.test(ascii(8, 12))))
    throw new Error('HEIC/HEIF is not supported yet. Export a JPEG or PNG and select that file.');
  if (container) throw new Error('This file format is not supported. Export a JPEG, PNG, PDF or UTF-8 text file.');
  let type: string | undefined;
  if ([137, 80, 78, 71, 13, 10, 26, 10].every((byte, i) => head[i] === byte)) type = 'image/png';
  else if (head[0] === 255 && head[1] === 216 && head[2] === 255) type = 'image/jpeg';
  else if (ascii(0, 5) === '%PDF-') type = 'application/pdf';
  else if (reported === 'text/plain' || (!reported && /\.txt$/i.test(original.name))) type = 'text/plain';
  if (!type || !policy.contentTypes.includes(type) || !CAPTURE_TYPES.includes(type as typeof CAPTURE_TYPES[number]))
    throw new Error('Choose a supported JPEG, PNG, PDF or UTF-8 text file.');
  const alias = type === 'image/jpeg' && ['image/jpg', 'image/pjpeg'].includes(reported);
  if (reported && reported !== type && reported !== 'application/octet-stream' && !alias)
    throw new Error('The file contents do not match its reported format. Select an exported supported file.');
  if (type === 'text/plain') {
    try {
      const text = new TextDecoder('utf-8', { fatal: true }).decode(await original.arrayBuffer());
      if (text.includes('\0')) throw new Error();
    } catch { throw new Error('Text evidence must be UTF-8 without NUL characters.'); }
    signal.throwIfAborted();
  }
  const file = reported === type ? original : new File([original], original.name, { type, lastModified: original.lastModified });
  const capture: BrowserSelectionClaim = { schemaVersion: 1, selectionMethod: method, selectedAt,
    filename: original.name, reportedContentType: reported, byteOrigin: 'browser-returned-unmodified' };
  validateSelectionClaim(capture, original.name);
  return { original, file, capture };
}
