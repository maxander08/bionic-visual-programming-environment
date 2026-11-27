// Arithmetic on arbitrary-precision decimals (see decimal.ts for the Dec type). No engine, no UI.
//
//  * + − × ÷ mod, whole-number powers (negative ones too), floor/ceil/round and comparisons are EXACT, whatever the numbers are:
//    every digit of the answer is kept, however many there are, and the only limit is the memory of the machine. A quotient that
//    ends (1 ÷ 8 = 0.125) is written out; one that goes on for ever by repeating (1 ÷ 3 = 0.333…, 13 ÷ 9 = 1.444…) is held exactly
//    as the repeating number it is, so 1 ÷ 3 × 3 is exactly 1. Square roots of exact squares (even 4/9) are exact too.
//  * √ exp ln sin cos tanh and fractional powers have answers that never repeat (√2), so they are worked out to a number of
//    significant digits you choose (the “Precision” setting, 50 by default, as many as you like) and rounded once, correctly, at the end.
//  * Nothing here rounds to a fixed number of decimal places. That only happens in the Number Formatter, when you ask for it.
//
// Results are plain exact decimals; packDec() decides whether one travels on a wire as a number or as a Dec.

import { MEMORY_DIGITS, approxDec, parseRadixLiteral, canon, decFromValue, decToRat, fromNumber, isZero, leadExp, parseDec, ratToDec, roundSignificant, setScale, toNumber, type Dec } from './decimal';
import { toNum } from './util';

export const DEFAULT_PRECISION = 50;
/** There is no ceiling on Precision: any number of digits can be asked for. */
export const MAX_PRECISION = Infinity;

/** A calculation that has no answer (÷ 0, √ of a negative) or whose answer is too long to hold. */
export class DecError extends Error {}

export const ZERO: Dec = { neg: false, digits: '0', scale: 0 };
export const ONE: Dec = { neg: false, digits: '1', scale: 0 };

/** A whole number as a Dec. */
export const fromInt = (n: number): Dec => {
  const r = parseDec(String(Math.trunc(n)));
  return r.ok ? r.dec : ZERO;
};

/** Read any signal value as an exact decimal: numbers by their shortest text, text with every digit it has, true/false as 1/0. Null when it is not a number. */
export function toDec(v: unknown): Dec | null {
  const r = decFromValue(v);
  if (r.ok) return r.dec;
  // Numbers written in another base (0xFF, 0b101, 0o77) are read exactly, whatever their length.
  if (typeof v === 'string') return parseRadixLiteral(v);
  const n = toNum(v);
  return Number.isFinite(n) ? fromNumber(n) : null;
}

/** Same, but a failure throws an error that says what was not a number. */
export function needDec(v: unknown, what = 'This'): Dec {
  const d = toDec(v);
  if (!d) throw new DecError(`${what} is not a number.`);
  return d;
}

const big = (d: Dec): bigint => (d.neg ? -BigInt(d.digits) : BigInt(d.digits));
const P10 = (n: number): bigint => 10n ** BigInt(n);

/** A whole number as a Dec. */
export const fromBigInt = (v: bigint): Dec => fromBig(v, 0);

function fromBig(v: bigint, scale: number): Dec {
  if (v === 0n) return ZERO;
  const neg = v < 0n;
  const digits = (neg ? -v : v).toString();
  return canon({ neg, digits, scale });
}

function align(a: Dec, b: Dec): { A: bigint; B: bigint; scale: number } {
  if (Math.abs(a.scale - b.scale) > MEMORY_DIGITS) throw new DecError('The two numbers are too far apart in size for your browser to hold the result in memory.');
  const scale = Math.max(a.scale, b.scale);
  return { A: big(a) * P10(scale - a.scale), B: big(b) * P10(scale - b.scale), scale };
}

export const neg = (d: Dec): Dec => (isZero(d) ? d : { ...d, neg: !d.neg });
export const abs = (d: Dec): Dec => (d.neg ? { ...d, neg: false } : d);

export function add(a: Dec, b: Dec): Dec {
  if (isZero(a)) return canon(b);
  if (isZero(b)) return canon(a);
  if (a.tail || b.tail) { const x = decToRat(a), y = decToRat(b); return ratToDec(x.n * y.d + y.n * x.d, x.d * y.d); }
  const { A, B, scale } = align(a, b);
  return fromBig(A + B, scale);
}
export const sub = (a: Dec, b: Dec): Dec => add(a, neg(b));

export function mul(a: Dec, b: Dec): Dec {
  if (isZero(a) || isZero(b)) return ZERO;
  if (a.tail || b.tail) { const x = decToRat(a), y = decToRat(b); return ratToDec(x.n * y.n, x.d * y.d); }
  return fromBig(big(a) * big(b), a.scale + b.scale);
}

/** −1, 0 or 1. */
export function cmp(a: Dec, b: Dec): number {
  const za = isZero(a), zb = isZero(b);
  if (za && zb) return 0;
  if (za) return b.neg ? 1 : -1;
  if (zb) return a.neg ? -1 : 1;
  if (a.neg !== b.neg) return a.neg ? -1 : 1;
  const m = a.neg ? -1 : 1;
  if (a.tail || b.tail) { const x = decToRat(a), y = decToRat(b), l = x.n * y.d, r = y.n * x.d; return l === r ? 0 : l > r ? 1 : -1; }
  // Same sign: the position of the leading digit decides most comparisons without shifting anything.
  const ea = leadExp(a), eb = leadExp(b);
  if (ea !== eb) return ea > eb ? m : -m;
  const { A, B } = align(a, b);
  return A === B ? 0 : A > B ? 1 : -1;
}

export const min = (a: Dec, b: Dec): Dec => (cmp(a, b) <= 0 ? a : b);
export const max = (a: Dec, b: Dec): Dec => (cmp(a, b) >= 0 ? a : b);
export const isInteger = (d: Dec): boolean => !d.tail && canon(d).scale <= 0;

/** a ÷ b rounded to `prec` significant digits (only for the functions that are worked out approximately, such as tanh). */
function divToPrec(a: Dec, b: Dec, prec: number): Dec {
  const A = BigInt(a.digits), B = BigInt(b.digits);
  const k = Math.max(0, prec + 3 + b.digits.length - a.digits.length);
  const num = A * P10(k);
  const q = num / B, r = num % B;
  let digits = q.toString(), scale = a.scale - b.scale + k;
  // A leftover remainder is remembered as one extra non-zero digit, so rounding never mistakes “just under” for an exact tie.
  if (r !== 0n) { digits += '1'; scale += 1; }
  return canon(roundSignificant({ neg: a.neg !== b.neg, digits, scale }, prec));
}

/**
 * a ÷ b, exactly. A quotient that ends (1 ÷ 8 = 0.125) has every one of its digits; one that never ends is a repeating number
 * (1 ÷ 3 = 0.333…, 13 ÷ 9 = 1.444…, 1 ÷ 7 = 0.142857142857…) and is held as exactly that, whatever the length of the repetition.
 * (`prec` is no longer needed: nothing is cut off.)
 */
export function div(a: Dec, b: Dec, _prec: number = DEFAULT_PRECISION): Dec {
  if (isZero(b)) throw new DecError('Division by zero.');
  if (isZero(a)) return ZERO;
  const x = decToRat(a), y = decToRat(b);
  return ratToDec(x.n * y.d, x.d * y.n);
}

/** The remainder with the sign of b (JavaScript's ((a % b) + b) % b), exact. */
export function mod(a: Dec, b: Dec): Dec {
  if (isZero(b)) throw new DecError('Can’t take a remainder when dividing by zero.');
  if (a.tail || b.tail) {
    const x = decToRat(a), y = decToRat(b);
    const P = x.n * y.d, Q = y.n * x.d;
    return ratToDec(((P % Q) + Q) % Q, x.d * y.d);
  }
  const { A, B, scale } = align(a, b);
  return fromBig(((A % B) + B) % B, scale);
}

/** Whole-number rounding. `round` is JavaScript's Math.round (halves go up). */
export const floor = (d: Dec): Dec => canon(setScale(d, 0, 'down'));
export const ceil = (d: Dec): Dec => canon(setScale(d, 0, 'up'));
export const trunc = (d: Dec): Dec => canon(setScale(d, 0, 'zero'));
export const round = (d: Dec): Dec => floor(add(d, { neg: false, digits: '5', scale: 1 }));

/** base ^ whole exponent, exact (a fraction or a repeating number raised to a power stays exact). */
function intPow(a: Dec, e: bigint): Dec {
  if (e === 0n) return ONE;
  if (isZero(a)) return ZERO;
  if (a.tail) { const r = decToRat(a); return ratToDec(r.n ** e, r.d ** e); }
  return fromBig(big(a) ** e, a.scale * Number(e));
}

/** An integer exponent small enough to produce a finite exact result; null means it needs more than safe-number-sized work. */
function smallInteger(b: Dec): bigint | null {
  const c = canon(b);
  if (c.scale > 0) return null;
  const zeros = -c.scale;
  if (c.digits.length + zeros > 16) return null;
  const magnitude = BigInt(c.digits) * (zeros ? P10(zeros) : 1n);
  if (magnitude > BigInt(Number.MAX_SAFE_INTEGER)) return null;
  return c.neg ? -magnitude : magnitude;
}

/** The parity of any exact integer, without converting its magnitude to a floating-point number. */
function oddInteger(b: Dec): boolean {
  const c = canon(b);
  return c.scale === 0 && BigInt(c.digits[c.digits.length - 1]) % 2n === 1n;
}

function isqrt(n: bigint): bigint {
  if (n < 2n) return n;
  let x = 1n << BigInt(((n.toString(16).length * 4) + 1) >> 1);
  for (;;) {
    const y = (x + n / x) >> 1n;
    if (y >= x) return x;
    x = y;
  }
}

/** Square root to `prec` significant digits. Exact (and unpadded) whenever the root ends or repeats: 2.25 → 1.5, 4/9 → 0.666… */
export function sqrt(a: Dec, prec = DEFAULT_PRECISION): Dec {
  if (a.neg && !isZero(a)) throw new DecError('The square root of a negative number isn’t a real number.');
  if (isZero(a)) return ZERO;
  if (a.tail) {
    const r = decToRat(a), sn = isqrt(r.n), sd = isqrt(r.d);
    if (sn * sn === r.n && sd * sd === r.d) return ratToDec(sn, sd);
    a = approxDec(a, prec + 10);
  }
  const m = Math.max(0, prec + 3 - Math.ceil(a.digits.length / 2));
  let N = BigInt(a.digits) * P10(2 * m);
  let s = a.scale + 2 * m;
  if ((((s % 2) + 2) % 2) === 1) { N *= 10n; s += 1; }
  const r = isqrt(N);
  let digits = r.toString(), scale = s / 2;
  if (r * r === N) return canon({ neg: false, digits, scale });
  digits += '1'; scale += 1;
  return canon(roundSignificant({ neg: false, digits, scale }, prec));
}

/* ───── fixed-point helpers: a value is an integer v meaning v × 10^−W ───── */

const toFixed = (d: Dec, W: number): bigint => {
  const shift = W - d.scale;
  const v = big(d);
  return shift >= 0 ? v * P10(shift) : v / P10(-shift);
};
const fromFixed = (v: bigint, W: number, prec: number): Dec => canon(roundSignificant(fromBig(v, W), prec));
const babs = (v: bigint): bigint => (v < 0n ? -v : v);
const floorDiv = (a: bigint, b: bigint): bigint => {
  const q = a / b;
  return a % b !== 0n && (a < 0n) !== (b < 0n) ? q - 1n : q;
};

const piCache = new Map<number, bigint>();
/** π × 10^W (Machin's formula). */
function piFixed(W: number): bigint {
  const hit = piCache.get(W);
  if (hit !== undefined) return hit;
  const one = P10(W);
  const atanInv = (n: bigint): bigint => {
    const n2 = n * n;
    let term = one / n, sum = term, k = 1n, sign = -1n;
    while (term !== 0n) {
      term /= n2; k += 2n;
      sum += sign * (term / k);
      sign = -sign;
    }
    return sum;
  };
  const pi = 16n * atanInv(5n) - 4n * atanInv(239n);
  if (piCache.size > 8) piCache.clear();
  piCache.set(W, pi);
  return pi;
}

const ln2Cache = new Map<number, bigint>();
const ln10Cache = new Map<number, bigint>();
function atanhInvFixed(n: bigint, W: number): bigint {
  const one = P10(W);
  const n2 = n * n;
  let term = one / n, sum = term, k = 1n;
  while (term !== 0n) { term /= n2; k += 2n; sum += term / k; }
  return sum;
}
function ln2Fixed(W: number): bigint {
  const hit = ln2Cache.get(W);
  if (hit !== undefined) return hit;
  const v = 2n * atanhInvFixed(3n, W);
  if (ln2Cache.size > 8) ln2Cache.clear();
  ln2Cache.set(W, v);
  return v;
}
function ln10Fixed(W: number): bigint {
  const hit = ln10Cache.get(W);
  if (hit !== undefined) return hit;
  // 10 = 8 × (5/4), and ln(5/4) = 2·atanh(1/9).
  const v = 3n * ln2Fixed(W) + 2n * atanhInvFixed(9n, W);
  if (ln10Cache.size > 8) ln10Cache.clear();
  ln10Cache.set(W, v);
  return v;
}

/** e^x has about 0.4343 × x digits before (or, for negative x, zeros after) the point: past what a string can hold there is no memory for it. */
const expTooBig = (xn: number): boolean => !Number.isFinite(xn) || Math.abs(xn) * 0.4343 > MEMORY_DIGITS;

/** e^x to `prec` significant digits. */
export function exp(x: Dec, prec = DEFAULT_PRECISION): Dec {
  if (isZero(x)) return ONE;
  x = approxDec(x, prec + 30);
  const xn = toNumber(x);
  if (expTooBig(xn)) throw new DecError('e^x of that number has too many digits for your browser to hold in memory.');
  const k = Math.max(0, Math.ceil(Math.log2(Math.abs(xn))) + 1);
  const W = prec + 15 + Math.ceil(k * 0.31) + Math.ceil(Math.abs(xn) * 0.4343);
  const one = P10(W);
  const X = toFixed(x, W);
  let kk = 0;
  const half = one / 2n;
  while ((babs(X) >> BigInt(kk)) > half) kk++;
  const R = X / (1n << BigInt(kk));
  let term = one, sum = one, n = 1n;
  for (;;) {
    term = (term * R) / one / n;
    if (term === 0n) break;
    sum += term; n += 1n;
  }
  for (let i = 0; i < kk; i++) sum = (sum * sum) / one;
  return fromFixed(sum, W, prec);
}

const HALF_DEC: Dec = { neg: false, digits: '5', scale: 1 };
const TWO_DEC: Dec = { neg: false, digits: '2', scale: 0 };

/** Natural logarithm to `prec` significant digits. */
export function ln(x: Dec, prec = DEFAULT_PRECISION): Dec {
  if (x.neg || isZero(x)) throw new DecError('The logarithm is only defined for numbers above zero.');
  // Keep x − 1 exact before approximating x: a tiny repeating tail can decide every significant digit of ln(x).
  const near = sub(x, ONE);
  if (isZero(near)) return ZERO;
  // Very close to 1: ln(1 + t) = t − t²/2 + …, strictly less than t for all t ≠ 0.
  const ne = leadExp(near);
  if (ne < 0 && -2 * ne > prec + 10) {
    const eps: Dec = { neg: false, digits: '1', scale: -ne + prec + 5 };
    return canon(roundSignificant(sub(near, eps), prec));
  }
  x = approxDec(x, prec + 30);
  const inUnit = cmp(x, HALF_DEC) >= 0 && cmp(x, TWO_DEC) <= 0;
  const W = prec + 29 + (inUnit ? Math.max(0, -ne) : 0);
  const one = P10(W);
  let e = 0, j = 0, Y: bigint;
  if (inUnit) {
    Y = toFixed(x, W);
  } else {
    e = leadExp(x);
    const m: Dec = { neg: false, digits: x.digits, scale: x.digits.length - 1 }; // m ∈ [1, 10)
    const mn = Number(m.digits[0] + '.' + m.digits.slice(1, 5));
    j = mn < 1.4 ? 0 : mn < 2.8 ? 1 : mn < 5.6 ? 2 : 3;
    Y = toFixed(m, W) >> BigInt(j);
  }
  const z = ((Y - one) * one) / (Y + one), z2 = (z * z) / one;
  let term = z, sum = z, k = 1n;
  while (term !== 0n) { term = (term * z2) / one; k += 2n; sum += term / k; }
  const total = 2n * sum + (j ? BigInt(j) * ln2Fixed(W) : 0n) + (e ? BigInt(e) * ln10Fixed(W) : 0n);
  return fromFixed(total, W, prec);
}

function sinCos(x: Dec, prec: number, wantSin: boolean): Dec {
  if (isZero(x)) return wantSin ? ZERO : ONE;
  const exact = x;
  const e = leadExp(exact);
  // Very small |x|: |x²/2| and |x³/6| lie far past the kept digits, so no π reduction or giant fixed-point is needed.
  if (e < 0 && -2 * e > prec + 10) {
    if (!wantSin) return ONE;
    const tiny = approxDec(exact, prec + 30);
    // |sin(x)| < |x| for all x ≠ 0; a tiny nudge toward zero breaks any exact tie at digit `prec` in the true direction.
    const eps: Dec = { neg: exact.neg, digits: '1', scale: -e + prec + 5 };
    return canon(roundSignificant(sub(tiny, eps), prec));
  }
  const needReduce = e >= 0; // |x| < 1 is already well inside (−π, π).
  let W = prec + 15 + Math.max(0, e + 1) + Math.max(0, -e);
  for (let attempt = 0; attempt < 12; attempt++) {
    const one = P10(W);
    // Range reduction magnifies the input-precision requirement: retain enough fractional digits of an exact tail for this W,
    // then increase that precision again whenever cancellation makes us retry with a larger W.
    const input = approxDec(exact, needReduce ? W + Math.max(0, e + 1) + 8 : prec + 30);
    const X = toFixed(input, W);
    let R = X;
    if (needReduce) {
      const twoPi = 2n * piFixed(W);
      const q = floorDiv(2n * X + twoPi, 2n * twoPi);
      R = X - q * twoPi;
    }
    const R2 = (R * R) / one;
    let term = wantSin ? R : one, sum = term, n = 1n;
    for (;;) {
      const d = wantSin ? (2n * n) * (2n * n + 1n) : (2n * n - 1n) * (2n * n);
      term = -((term * R2) / one) / d;
      if (term === 0n) break;
      sum += term; n += 1n;
    }
    const mag = babs(sum);
    const sigDigits = mag === 0n ? 0 : mag.toString().length;
    // Near a multiple of π/2, cancellation can leave fewer than `prec + 8` digits: retry with extra working precision.
    if (sigDigits >= prec + 8 || !needReduce) return fromFixed(sum, W, prec);
    W += (W - sigDigits) + 16;
  }
  throw new DecError('Couldn’t work out the sine or cosine of that angle. It’s too close to a multiple of π/2 for any working precision.');
}
export const sin = (x: Dec, prec = DEFAULT_PRECISION): Dec => sinCos(x, prec, true);
export const cos = (x: Dec, prec = DEFAULT_PRECISION): Dec => sinCos(x, prec, false);

/** Hyperbolic tangent to `prec` significant digits. */
export function tanh(x: Dec, prec = DEFAULT_PRECISION): Dec {
  if (isZero(x)) return ZERO;
  x = approxDec(x, prec + 30);
  const e = leadExp(x);
  if (e < 0 && -2 * e > prec + 10) {
    // |tanh(x)| < |x| for all x ≠ 0, with |tanh(x) − x| ≈ |x|³/3.
    const eps: Dec = { neg: x.neg, digits: '1', scale: -e + prec + 5 };
    return canon(roundSignificant(sub(x, eps), prec));
  }
  const xn = toNumber(x);
  if (!Number.isFinite(xn) || Math.abs(xn) > (prec + 12) * 1.16) return x.neg ? { neg: true, digits: '1', scale: 0 } : ONE;
  const P = prec + 15 + Math.max(0, -e);
  const e2 = exp(add(x, x), P);
  return divToPrec(sub(e2, ONE), add(e2, ONE), prec);
}

/** a ^ b. Whole exponents are exact (negative ones too, as a fraction or repeating number); other exponents are worked out as e^(b·ln a) to `prec` digits. */
export function pow(a: Dec, b: Dec, prec = DEFAULT_PRECISION): Dec {
  if (isZero(b)) return ONE;
  if (isInteger(b)) {
    // ±1 stay exact for arbitrarily large integer exponents; determine the sign from the exact decimal digits, not a double.
    if (cmp(abs(a), ONE) === 0) return a.neg && oddInteger(b) ? { neg: true, digits: '1', scale: 0 } : ONE;
    const e = smallInteger(b);
    if (e === null) throw new DecError('That exponent is too large for your browser to handle.');
    if (e >= 0n) return intPow(a, e);
    if (isZero(a)) throw new DecError('Zero can’t be raised to a negative power.');
    return div(ONE, intPow(a, -e), prec);
  }
  if (a.neg && !isZero(a)) throw new DecError('A negative number can’t be raised to a fractional power.');
  if (isZero(a)) {
    if (b.neg) throw new DecError('Zero can’t be raised to a negative power.');
    return ZERO;
  }
  const P = prec + 23 + Math.max(0, leadExp(b) + 1);
  return exp(mul(approxDec(b, P), ln(a, P)), prec);
}
export { isZero, toNumber } from './decimal';
