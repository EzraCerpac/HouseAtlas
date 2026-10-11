import { ExactDecimal, isExactDecimal } from './decimal';

export type LosslessJson = null | boolean | string | ExactDecimal |
  LosslessJson[] | { [key: string]: LosslessJson };

/** Input shape for serialization, including existing readonly JSON trees. */
export type JsonForSerialization = null | boolean | string | number | ExactDecimal |
  readonly JsonForSerialization[] | { readonly [key: string]: JsonForSerialization };

/** Bounds apply to the complete input, including unknown nested properties. */
const MAX_JSON_TEXT_BYTES = 8 * 1024 * 1024;
export const JSON_LIMITS = Object.freeze({
  textBytes: MAX_JSON_TEXT_BYTES,
  depth: 128,
  // Every value node occupies at least one distinct byte in complete JSON text.
  // Thus a byte-limited document cannot exceed this derived node budget.
  nodes: MAX_JSON_TEXT_BYTES,
});

const isDigit = (code: number): boolean => code >= 48 && code <= 57;
const isSpace = (code: number): boolean => code === 32 || code === 9 || code === 10 || code === 13;

/** Parse complete JSON before any numeric token can be rounded by JSON.parse. */
export function parseLosslessJson(text: string): LosslessJson {
  if (typeof text !== 'string') throw new TypeError('JSON source must be a string');
  if (text.length > JSON_LIMITS.textBytes || new TextEncoder().encode(text).length > JSON_LIMITS.textBytes) {
    throw new RangeError('JSON text exceeds the processing limit');
  }
  let offset = 0;
  let nodes = 0;
  const fail = (): never => { throw new SyntaxError(`Invalid JSON at offset ${offset}`); };
  const peek = (): number => text.charCodeAt(offset);
  const whitespace = (): void => {
    while (offset < text.length && isSpace(peek())) offset++;
  };
  const string = (): string => {
    if (peek() !== 34) return fail();
    offset++;
    const chunks: string[] = [];
    let segment = offset;
    while (offset < text.length) {
      const code = peek();
      if (code === 34) {
        chunks.push(text.slice(segment, offset));
        offset++;
        return chunks.join('');
      }
      if (code < 32) return fail();
      if (code !== 92) { offset++; continue; }
      chunks.push(text.slice(segment, offset));
      offset++;
      if (offset >= text.length) return fail();
      const escape = peek();
      offset++;
      switch (escape) {
        case 34: chunks.push('"'); break;
        case 92: chunks.push('\\'); break;
        case 47: chunks.push('/'); break;
        case 98: chunks.push('\b'); break;
        case 102: chunks.push('\f'); break;
        case 110: chunks.push('\n'); break;
        case 114: chunks.push('\r'); break;
        case 116: chunks.push('\t'); break;
        case 117: {
          if (offset + 4 > text.length) return fail();
          const hex = text.slice(offset, offset + 4);
          if (!/^[0-9a-fA-F]{4}$/.test(hex)) return fail();
          chunks.push(String.fromCharCode(Number.parseInt(hex, 16)));
          offset += 4;
          break;
        }
        default: return fail();
      }
      segment = offset;
    }
    return fail();
  };
  const value = (depth: number): LosslessJson => {
    if (++nodes > JSON_LIMITS.nodes) throw new RangeError('JSON node count exceeds the processing limit');
    if (depth > JSON_LIMITS.depth) throw new RangeError('JSON nesting exceeds the processing limit');
    whitespace();
    const code = peek();
    if (code === 34) return string();
    if (code === 123) {
      offset++;
      const object: { [key: string]: LosslessJson } = {};
      whitespace();
      if (peek() === 125) { offset++; return object; }
      while (true) {
        const key = string();
        whitespace();
        if (peek() !== 58) return fail();
        offset++;
        const child = value(depth + 1);
        // Define even __proto__ as an own data property; duplicate keys are last-wins.
        Object.defineProperty(object, key, { value: child, writable: true, enumerable: true, configurable: true });
        whitespace();
        if (peek() === 125) { offset++; return object; }
        if (peek() !== 44) return fail();
        offset++;
        whitespace();
      }
    }
    if (code === 91) {
      offset++;
      const array: LosslessJson[] = [];
      whitespace();
      if (peek() === 93) { offset++; return array; }
      while (true) {
        array.push(value(depth + 1));
        whitespace();
        if (peek() === 93) { offset++; return array; }
        if (peek() !== 44) return fail();
        offset++;
      }
    }
    if (text.startsWith('true', offset)) { offset += 4; return true; }
    if (text.startsWith('false', offset)) { offset += 5; return false; }
    if (text.startsWith('null', offset)) { offset += 4; return null; }
    if (code === 45 || isDigit(code)) {
      const start = offset;
      while (offset < text.length) {
        const next = peek();
        if (isDigit(next) || next === 45 || next === 43 || next === 46 || next === 69 || next === 101) {
          offset++;
        } else break;
      }
      return ExactDecimal.parse(text.slice(start, offset));
    }
    return fail();
  };
  const result = value(0);
  whitespace();
  if (offset !== text.length) fail();
  return result;
}

/** Serialize exact nodes as JSON numbers while validating the whole tree. */
export function stringifyLosslessJson(input: JsonForSerialization): string {
  let nodes = 0;
  let bytes = 0;
  const active = new Set<object>();
  const account = (fragment: string): string => {
    if (fragment.length > JSON_LIMITS.textBytes - bytes) throw new RangeError('JSON text exceeds the processing limit');
    bytes += new TextEncoder().encode(fragment).length;
    if (bytes > JSON_LIMITS.textBytes) throw new RangeError('JSON text exceeds the processing limit');
    return fragment;
  };
  const write = (value: unknown, depth: number): string => {
    if (++nodes > JSON_LIMITS.nodes) throw new RangeError('JSON node count exceeds the processing limit');
    if (depth > JSON_LIMITS.depth) throw new RangeError('JSON nesting exceeds the processing limit');
    if (value === null) return account('null');
    if (isExactDecimal(value)) return account(value.token);
    if (typeof value === 'boolean') return account(value ? 'true' : 'false');
    if (typeof value === 'string') {
      if (value.length > JSON_LIMITS.textBytes - bytes) throw new RangeError('JSON text exceeds the processing limit');
      return account(JSON.stringify(value));
    }
    if (typeof value === 'number') {
      if (!Number.isFinite(value) || (Number.isInteger(value) && !Number.isSafeInteger(value))) {
        throw new TypeError('Finite safe numeric value required; use ExactDecimal for large integers');
      }
      const token = JSON.stringify(value);
      ExactDecimal.parse(token);
      return account(token);
    }
    if (typeof value !== 'object' || value === undefined) throw new TypeError('Invalid JSON value');
    const object = value as object;
    if (active.has(object)) throw new TypeError('Circular JSON value');
    active.add(object);
    try {
      if (Array.isArray(value)) {
        account('[');
        const members: string[] = [];
        for (let i = 0; i < value.length; i++) {
          const descriptor = Object.getOwnPropertyDescriptor(value, i);
          if (!descriptor) throw new TypeError('Sparse JSON array');
          if (!('value' in descriptor)) throw new TypeError('JSON accessors are unsupported');
          if (i > 0) account(',');
          members.push(write(descriptor.value, depth + 1));
        }
        account(']');
        return `[${members.join(',')}]`;
      }
      const prototype = Object.getPrototypeOf(value);
      if (prototype !== Object.prototype && prototype !== null) throw new TypeError('Plain JSON object required');
      account('{');
      const members: string[] = [];
      for (const key of Object.keys(value)) {
        const descriptor = Object.getOwnPropertyDescriptor(value, key);
        if (!descriptor || !('value' in descriptor)) throw new TypeError('JSON accessors are unsupported');
        if (members.length > 0) account(',');
        if (key.length > JSON_LIMITS.textBytes - bytes) throw new RangeError('JSON text exceeds the processing limit');
        const name = account(JSON.stringify(key));
        account(':');
        members.push(`${name}:${write(descriptor.value, depth + 1)}`);
      }
      account('}');
      return `{${members.join(',')}}`;
    } finally {
      active.delete(object);
    }
  };
  return write(input, 0);
}
