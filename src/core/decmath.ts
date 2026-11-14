// Arithmetic on arbitrary-precision decimals (see decimal.ts for the Dec type). No engine, no UI.
//
//  * + − × mod and whole-number powers are EXACT: every digit of the answer is kept, however many there are.
//  * ÷ √ exp ln sin cos tanh and fractional powers have answers that can go on for ever, so they are worked out to a number of
//    significant digits you choose (the “Precision” setting, 50 by default, up to 1000) and rounded once, correctly, at the end.
//    A quotient that ends (1 ÷ 8 = 0.125) is exact and never padded.
//  * Nothing here rounds to a fixed number of decimal places. That only happens in the Number Formatter, when you ask for it.
//
// Results are plain exact decimals; packDec() decides whether one travels on a wire as a number or as a Dec.

import { MAX_DIGITS, canon, decFromValue, fromNumber, isZero, leadExp, parseDec, roundSignificant, setScale, toNumber, type Dec } from './decimal';
import { toNum } from './util';

export const DEFAULT_PRECISION = 50;
export const MAX_PRECISION = 1000;

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

function fromBig(v: bigint, scale: number): Dec {
  if (v === 0n) return ZERO;
  const neg = v < 0n;
  const digits = (neg ? -v : v).toString();
  if (digits.length > MAX_DIGITS) throw new DecError(`The result needs more than ${MAX_DIGITS} digits.`);
  return canon({ neg, digits, scale });
}

function align(a: Dec, b: Dec): { A: bigint; B: bigint; scale: number } {
  if (Math.abs(a.scale - b.scale) > MAX_DIGITS) throw new DecError(`The two numbers are too far apart in size to combine (more than ${MAX_DIGITS} digits between them).`);
  const scale = Math.max(a.scale, b.scale);
  return { A: big(a) * P10(scale - a.scale), B: big(b) * P10(scale - b.scale), scale };
}

export const neg = (d: Dec): Dec => (isZero(d) ? d : { ...d, neg: !d.neg });
export const abs = (d: Dec): Dec => (d.neg ? { ...d, neg: false } : d);

export function add(a: Dec, b: Dec): Dec {
  if (isZero(a)) return canon(b);
  if (isZero(b)) return canon(a);
  const { A, B, scale } = align(a, b);
  return fromBig(A + B, scale);
}
export const sub = (a: Dec, b: Dec): Dec => add(a, neg(b));

export function mul(a: Dec, b: Dec): Dec {
  if (isZero(a) || isZero(b)) return ZERO;
  if (a.digits.length + b.digits.length > MAX_DIGITS + 1) throw new DecError(`The product needs more than ${MAX_DIGITS} digits.`);
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
  // Same sign: the position of the leading digit decides most comparisons without shifting anything.
  const ea = leadExp(a), eb = leadExp(b);
  if (ea !== eb) return ea > eb ? m : -m;
  const { A, B } = align(a, b);
  return A === B ? 0 : A > B ? 1 : -1;
}

export const min = (a: Dec, b: Dec): Dec => (cmp(a, b) <= 0 ? a : b);
export const max = (a: Dec, b: Dec): Dec => (cmp(a, b) >= 0 ? a : b);
export const isInteger = (d: Dec): boolean => canon(d).scale <= 0;

/** a ÷ b to `prec` significant digits. Exact (and unpadded) when the quotient ends sooner. */
export function div(a: Dec, b: Dec, prec = DEFAULT_PRECISION): Dec {
  if (isZero(b)) throw new DecError('Division by zero.');
  if (isZero(a)) return ZERO;
  const A = BigInt(a.digits), B = BigInt(b.digits);
  const k = Math.max(0, prec + 3 + b.digits.length - a.digits.length);
  const num = A * P10(k);
  const q = num / B, r = num % B;
  let digits = q.toString(), scale = a.scale - b.scale + k;
  // A leftover remainder is remembered as one extra non-zero digit, so rounding never mistakes “just under” for an exact tie.
  if (r !== 0n) { digits += '1'; scale += 1; }
  return canon(roundSignificant({ neg: a.neg !== b.neg, digits, scale }, prec));
}

/** The remainder with the sign of b (JavaScript's ((a % b) + b) % b), exact. */
export function mod(a: Dec, b: Dec): Dec {
  if (isZero(b)) throw new DecError('Remainder of a division by zero.');
  const { A, B, scale } = align(a, b);
  return fromBig(((A % B) + B) % B, scale);
}

/** Whole-number rounding. `round` is JavaScript's Math.round (halves go up). */
export const floor = (d: Dec): Dec => canon(setScale(d, 0, 'down'));
export const ceil = (d: Dec): Dec => canon(setScale(d, 0, 'up'));
export const trunc = (d: Dec): Dec => canon(setScale(d, 0, 'zero'));
export const round = (d: Dec): Dec => floor(add(d, { neg: false, digits: '5', scale: 1 }));

/** base ^ whole exponent, exact. */
function intPow(a: Dec, e: number): Dec {
  if (e === 0) return ONE;
  if (isZero(a)) return ZERO;
  if (a.digits.length * e > MAX_DIGITS * 2) throw new DecError(`The power needs more than ${MAX_DIGITS} digits.`);
  return fromBig(big(a) ** BigInt(e), a.scale * e);
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

/** Square root to `prec` significant digits (exact for perfect squares such as 2.25). */
export function sqrt(a: Dec, prec = DEFAULT_PRECISION): Dec {
  if (a.neg && !isZero(a)) throw new DecError('The square root of a negative number is not a real number.');
  if (isZero(a)) return ZERO;
  const m = Math.max(0, prec + 3 - Math.ceil(a.digits.length / 2));
  let N = BigInt(a.digits) * P10(2 * m);
  let s = a.scale + 2 * m;
  if ((((s % 2) + 2) % 2) === 1) { N *= 10n; s += 1; }
  const r = isqrt(N);
  let digits = r.toString(), scale = s / 2;
  if (r * r !== N) { digits += '1'; scale += 1; }
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

function ln2Fixed(W: number): bigint {
  const one = P10(W);
  const z = one / 3n, z2 = (z * z) / one;
  let term = z, sum = z, k = 1n;
  while (term !== 0n) { term = (term * z2) / one; k += 2n; sum += term / k; }
  return 2n * sum;
}

const EXP_LIMIT = 20000;

/** e^x to `prec` significant digits. */
export function exp(x: Dec, prec = DEFAULT_PRECISION): Dec {
  if (isZero(x)) return ONE;
  const xn = toNumber(x);
  if (!Number.isFinite(xn) || Math.abs(xn) > EXP_LIMIT) throw new DecError(`e^x is only worked out for x between −${EXP_LIMIT} and ${EXP_LIMIT}.`);
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

/** Natural logarithm to `prec` significant digits. */
export function ln(x: Dec, prec = DEFAULT_PRECISION): Dec {
  if (x.neg || isZero(x)) throw new DecError('The logarithm is only defined for numbers above zero.');
  const near = sub(x, ONE);
  const W = prec + 23 + (isZero(near) ? 0 : Math.max(0, -leadExp(near)));
  const m = Number('0.' + x.digits.slice(0, 15));
  const est = (leadExp(x) + 1) * Math.log2(10) + Math.log2(m);
  const j = Math.round(est);
  const y = j >= 0 ? div(x, fromBig(1n << BigInt(j), 0), W + 5) : mul(x, fromBig(1n << BigInt(-j), 0));
  const one = P10(W);
  const Y = toFixed(y, W);
  const z = ((Y - one) * one) / (Y + one), z2 = (z * z) / one;
  let term = z, sum = z, k = 1n;
  while (term !== 0n) { term = (term * z2) / one; k += 2n; sum += term / k; }
  const total = 2n * sum + BigInt(j) * ln2Fixed(W);
  return fromFixed(total, W, prec);
}

function sinCos(x: Dec, prec: number, wantSin: boolean): Dec {
  if (isZero(x)) return wantSin ? ZERO : ONE;
  const W = prec + 15 + Math.max(0, leadExp(x) + 1) + Math.max(0, -leadExp(x));
  if (W > 5000) throw new DecError('That angle needs more than 5000 digits of working precision.');
  const one = P10(W);
  const X = toFixed(x, W);
  const twoPi = 2n * piFixed(W);
  const q = floorDiv(2n * X + twoPi, 2n * twoPi);
  const R = X - q * twoPi;
  const R2 = (R * R) / one;
  let term = wantSin ? R : one, sum = term, n = 1n;
  for (;;) {
    const d = wantSin ? (2n * n) * (2n * n + 1n) : (2n * n - 1n) * (2n * n);
    term = -((term * R2) / one) / d;
    if (term === 0n) break;
    sum += term; n += 1n;
  }
  return fromFixed(sum, W, prec);
}
export const sin = (x: Dec, prec = DEFAULT_PRECISION): Dec => sinCos(x, prec, true);
export const cos = (x: Dec, prec = DEFAULT_PRECISION): Dec => sinCos(x, prec, false);

/** Hyperbolic tangent to `prec` significant digits. */
export function tanh(x: Dec, prec = DEFAULT_PRECISION): Dec {
  if (isZero(x)) return ZERO;
  const xn = toNumber(x);
  if (!Number.isFinite(xn) || Math.abs(xn) > EXP_LIMIT / 2) return x.neg ? { neg: true, digits: '1', scale: 0 } : ONE;
  const P = prec + 15 + Math.max(0, -leadExp(x));
  const e2 = exp(add(x, x), P);
  return div(sub(e2, ONE), add(e2, ONE), prec);
}

/** a ^ b. Whole exponents are exact (negative ones to `prec` digits); other exponents are worked out as e^(b·ln a) to `prec` digits. */
export function pow(a: Dec, b: Dec, prec = DEFAULT_PRECISION): Dec {
  if (isZero(b)) return ONE;
  if (isInteger(b)) {
    const e = toNumber(b);
    if (!Number.isFinite(e) || Math.abs(e) > MAX_DIGITS) throw new DecError('That exponent is too large.');
    if (e >= 0) return intPow(a, e);
    if (isZero(a)) throw new DecError('Zero cannot be raised to a negative power.');
    return div(ONE, intPow(a, -e), prec);
  }
  if (a.neg && !isZero(a)) throw new DecError('A negative number cannot be raised to a fractional power.');
  if (isZero(a)) {
    if (b.neg) throw new DecError('Zero cannot be raised to a negative power.');
    return ZERO;
  }
  const P = prec + 23 + Math.max(0, leadExp(b) + 1);
  return exp(mul(b, ln(a, P)), prec);
}
export { isZero } from './decimal';
