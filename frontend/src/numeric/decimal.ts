/** Exact, immutable JSON decimal. Its source token is retained for wire output. */
const decimalBrand = Symbol('HouseAtlas exact JSON decimal');

export const MAX_NUMBER_TOKEN_BYTES = 4096;
const MAX_DECIMAL_MAGNITUDE = 4096;

export class ExactDecimal {
  private readonly [decimalBrand] = true;
  readonly token: string;
  private readonly negative: boolean;
  private readonly digits: string;
  private readonly shift: number;

  private constructor(
    token: string,
    negative: boolean,
    /** Significant coefficient digits, or "0". */
    digits: string,
    /** Power of ten applied to the coefficient. */
    shift: number,
  ) {
    this.token = token;
    this.negative = negative;
    this.digits = digits;
    this.shift = shift;
    Object.freeze(this);
  }

  static parse(token: string): ExactDecimal {
    if (typeof token !== 'string' || token.length > MAX_NUMBER_TOKEN_BYTES) {
      throw new RangeError('Numeric token exceeds the 4096-byte processing limit');
    }
    // JSON numeric grammar is ASCII, so code-unit and byte limits coincide.
    const match = /^(-?)(0|[1-9][0-9]*)(?:\.([0-9]+))?(?:[eE]([+-]?)([0-9]+))?$/.exec(token);
    if (!match) throw new SyntaxError('Invalid JSON numeric token');

    const fraction = match[3] ?? '';
    const exponentDigits = match[5] ?? '0';
    // Accumulate only values inside the native envelope; no floating arithmetic.
    let exponent = 0;
    for (let i = 0; i < exponentDigits.length; i++) {
      exponent = exponent * 10 + (exponentDigits.charCodeAt(i) - 48);
      if (exponent > MAX_DECIMAL_MAGNITUDE) {
        throw new RangeError('Numeric exponent exceeds the 4096 processing limit');
      }
    }
    if (match[4] === '-') exponent = -exponent;
    const shift = exponent - fraction.length;
    if (Math.abs(shift) > MAX_DECIMAL_MAGNITUDE) {
      throw new RangeError('Numeric decimal shift exceeds the 4096 processing limit');
    }
    const digits = (match[2] + fraction).replace(/^0+/, '') || '0';
    return new ExactDecimal(token, match[1] === '-', digits, shift);
  }

  get isZero(): boolean {
    return this.digits === '0';
  }

  get isInteger(): boolean {
    if (this.isZero || this.shift >= 0) return true;
    const count = -this.shift;
    return count <= this.digits.length && this.digits.endsWith('0'.repeat(count));
  }

  /** Mathematical order. Positive and negative zero compare equal. */
  compare(other: ExactDecimal): -1 | 0 | 1 {
    if (!isExactDecimal(other)) throw new TypeError('Expected an exact decimal');
    if (this.isZero) return other.isZero ? 0 : other.negative ? 1 : -1;
    if (other.isZero) return this.negative ? -1 : 1;
    if (this.negative !== other.negative) return this.negative ? -1 : 1;

    const leftSize = this.digits.length + this.shift;
    const rightSize = other.digits.length + other.shift;
    let magnitude: -1 | 0 | 1 = 0;
    if (leftSize !== rightSize) {
      magnitude = leftSize < rightSize ? -1 : 1;
    } else {
      // Equal decimal order: compare coefficient digits with virtual zero padding.
      // At most 4096 significant positions are visited; no exponent expansion.
      const length = Math.max(this.digits.length, other.digits.length);
      for (let i = 0; i < length; i++) {
        const left = i < this.digits.length ? this.digits.charCodeAt(i) : 48;
        const right = i < other.digits.length ? other.digits.charCodeAt(i) : 48;
        if (left !== right) {
          magnitude = left < right ? -1 : 1;
          break;
        }
      }
    }
    return this.negative ? (magnitude === 1 ? -1 : magnitude === -1 ? 1 : 0) : magnitude;
  }

  /** Explicit conversion for bounded control fields; never rounds through f64. */
  toSafeInteger(): number | undefined {
    if (!this.isInteger) return undefined;
    if (this.isZero) return 0;
    const whole = this.shift < 0
      ? this.digits.slice(0, this.digits.length + this.shift)
      : this.digits + '0'.repeat(this.shift);
    const limit = '9007199254740991';
    if (whole.length > limit.length || (whole.length === limit.length && whole > limit)) {
      return undefined;
    }
    // The preceding decimal comparison proves this integer has an exact Number value.
    const value = Number(whole);
    return this.negative ? -value : value;
  }

  toString(): string {
    return this.token;
  }

  /** Prevent ordinary JSON.stringify from silently turning this node into an object. */
  toJSON(): never {
    throw new TypeError('Use stringifyLosslessJson for exact decimal nodes');
  }
}

export function isExactDecimal(value: unknown): value is ExactDecimal {
  return typeof value === 'object' && value !== null &&
    (value as ExactDecimal)[decimalBrand] === true;
}
