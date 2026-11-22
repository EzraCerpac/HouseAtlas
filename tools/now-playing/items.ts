// Streaming parser for shairport-sync metadata pipe items:
//   <item><type>hex</type><code>hex</code><length>n</length>
//   [\n<data encoding="base64">\n…</data>]</item>\n
// Chunks may split anywhere. Malformed, truncated or oversize items are
// dropped without throwing; the parser resynchronises on the next <item>.
// An oversize declaration is reported only for a picture (ssnc PICT), the one
// code whose absence matters; any other oversize item is dropped silently.
export const MAX_DATA_BYTES = 256 * 1024;
export type Item = { type: string; code: string; data: Buffer; oversize: boolean };

const HEADER = /^<item><type>([0-9a-f]{1,8})<\/type><code>([0-9a-f]{1,8})<\/code><length>(\d{1,9})<\/length>/;
const BODY = /^\s*<data encoding="base64">([\s\S]*)<\/data>\s*$/;
const BASE64 = /^[A-Za-z0-9+/]*={0,2}$/;
const maxBody = (length: number) => Math.ceil(length / 3) * 4 * 1.1 + 512; // whole <data> element, same for split and whole frames
const fourCC = (hex: string) => (hex.length === 8 ? Buffer.from(hex, 'hex').toString('latin1') : '');

export class ItemParser {
  private buf = '';
  private skipping = false;
  reset() { this.buf = ''; this.skipping = false; }
  feed(chunk: Buffer | string): Item[] {
    // Everything on the pipe is ASCII; latin1 keeps split multibyte input harmless.
    this.buf += typeof chunk === 'string' ? chunk : chunk.toString('latin1');
    const out: Item[] = [];
    for (;;) {
      const b = this.buf;
      if (this.skipping) {
        const end = b.indexOf('</item>'), next = b.indexOf('<item>');
        if (next >= 0 && (end < 0 || next < end)) { this.buf = b.slice(next); this.skipping = false; }
        else if (end >= 0) { this.buf = b.slice(end + 7); this.skipping = false; }
        else { this.buf = b.slice(-6); return out; }
        continue;
      }
      const start = b.indexOf('<item>');
      if (start < 0) { this.buf = b.slice(-5); return out; }
      if (start > 0) { this.buf = b.slice(start); continue; }
      const head = HEADER.exec(b);
      if (!head) {
        const next = b.indexOf('<item>', 1);
        if (next > 0) this.buf = b.slice(next);
        else if (b.length >= 96) this.buf = b.slice(6);
        else return out;
        continue;
      }
      const length = Number(head[3]), h = head[0].length;
      if (length > MAX_DATA_BYTES) {
        if (fourCC(head[1]!) === 'ssnc' && fourCC(head[2]!) === 'PICT') out.push({ type: 'ssnc', code: 'PICT', data: Buffer.alloc(0), oversize: true });
        this.buf = b.slice(h); this.skipping = true; continue;
      }
      const end = b.indexOf('</item>', h), next = b.indexOf('<item>', h);
      if (next >= 0 && (end < 0 || next < end)) { this.buf = b.slice(next); continue; } // truncated item
      if (end < 0) {
        if (b.length - h > maxBody(length) + 7) { this.buf = b.slice(h); this.skipping = true; continue; }
        return out;
      }
      if (end - h > maxBody(length)) { this.buf = b.slice(end + 7); continue; }
      const body = b.slice(h, end);
      this.buf = b.slice(end + 7);
      const type = fourCC(head[1]!), code = fourCC(head[2]!);
      if (!type || !code) continue;
      if (length === 0) { if (/^\s*$/.test(body)) out.push({ type, code, data: Buffer.alloc(0), oversize: false }); continue; }
      const data = BODY.exec(body)?.[1]?.replace(/\s+/g, '');
      if (data === undefined || data.length % 4 !== 0 || !BASE64.test(data)) continue;
      const bytes = Buffer.from(data, 'base64');
      if (bytes.length === length) out.push({ type, code, data: bytes, oversize: false });
    }
  }
}
