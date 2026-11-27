// Arbitrary-precision decimal numbers, as digit strings. No engine, no UI, no rounding unless asked for.
// (Arithmetic on them lives in decmath.ts; this file reads, writes and formats them.)
//
// A Dec is  ±digits × 10^(−scale):  "3.50" is { digits: "350", scale: 2 }, 1.5e3 is { digits: "15", scale: −2 }. Digits are kept
// exactly as given (trailing zeros included), so nothing is ever lost on the way in. Rounding happens only in the functions below
// that are called by the Number Formatter.
//
// There is no limit on how many digits a number has, or on how big or small it is, other than the memory of the machine.
//
// A number whose digits never end but repeat (1 ÷ 3 = 0.333…, 13 ÷ 9 = 1.444…, 1 ÷ 7 = 0.142857142857…) is held exactly too: it
// carries a `tail`, the fraction n/d (d coprime to 10, 0 < n < d, lowest terms) that makes up every digit after the first `scale`
// ones. The digits of a repetition are only worked out when the number is written, and they are written with an ellipsis after
// them: 1.44444…, 0.142857142857…. Text written that way reads back as the same exact number.

/** A double as the shortest text that reads back as exactly the same double. */
const shortest = (n: number): string => (Object.is(n, -0) ? '0' : String(n));

/** The endless part of a repeating decimal: every digit after the first `scale` ones is the expansion of n/d (0 < n < d, lowest terms, d coprime to 10), as whole numbers written in digits. */
export interface Tail { n: string; d: string }
export interface Dec { neg: boolean; digits: string; scale: number; tail?: Tail }

/**
 * The most digits one piece of text can hold in this browser (a JavaScript string is at most 2^29 − 24 characters long). It is the
 * only ceiling on how long a number may be: past it the machine has no memory left to write the number down.
 */
export const MEMORY_DIGITS = 2 ** 29 - 24;

export type DecRounding = 'nearest' | 'even' | 'up' | 'down' | 'zero' | 'away';
export type FormatMode = 'plain' | 'places' | 'digits' | 'sci' | 'eng';
export type ExpStyle = 'e' | 'x10';

export type DecParse = { ok: true; dec: Dec } | { ok: false; error: string };

const NUM_RE = /^([+\-\u2212])?(\d*)(?:\.(\d*))?(?:[eE]([+\-\u2212]?\d+))?$/;
const ZERO = (scale = 0): Dec => ({ neg: false, digits: '0', scale });
const P10 = (n: number): bigint => 10n ** BigInt(n);
const TOO_LONG = 'That number needs more memory than this browser can give it.';

/** The ellipsis that follows the repeating digits of a number that never ends: 1.44444... */
export const ELLIPSIS = '...';

export function gcdBig(x: bigint, y: bigint): bigint {
  while (y !== 0n) { const t = x % y; x = y; y = t; }
  return x;
}

/** Read a JS number as digits: its shortest text, which reads back as exactly the same double. */
export const fromNumber = (n: number): Dec => {
  const r = parseDec(shortest(n));
  return r.ok ? r.dec : ZERO();
};

/**
 * Read a decimal number from text such as 3.14, −0.5, .5, 1_000.25 or 6.022e23. Any number of digits is kept.
 * A number that repeats may be written with an ellipsis after the repeating digits (1.44444..., 0.142857142857…): it is read as that exact repeating number.
 */
export function parseDec(input: string): DecParse {
  const t = input.trim().replace(/(?<=\d)_(?=\d)/g, '');
  if (/(?:\.\.\.|\u2026)$/.test(t)) return parseEndless(t, input);
  const m = NUM_RE.exec(t);
  if (!m || (!m[2] && !m[3])) return { ok: false, error: `“${input.trim().slice(0, 40)}” is not a number.` };
  const int = m[2] ?? '', frac = m[3] ?? '';
  const exp = m[4] ? Number(m[4].replace('\u2212', '-')) : 0;
  if (!Number.isFinite(exp) || Math.abs(exp) > MEMORY_DIGITS) return { ok: false, error: TOO_LONG };
  const digits = (int + frac).replace(/^0+/, '');
  const scale = frac.length - exp;
  const neg = m[1] === '-' || m[1] === '\u2212';
  if (digits === '') {
    const zeroScale = Math.max(0, scale);
    // Zero still needs "0." plus its zeroes when written out; reject it before returning the compact Dec.
    if (zeroScale + (zeroScale > 0 ? 2 : 1) > MEMORY_DIGITS) return { ok: false, error: TOO_LONG };
    return { ok: true, dec: ZERO(zeroScale) };
  }
  const plainLength = (neg ? 1 : 0) + (scale <= 0 ? digits.length - scale : digits.length > scale ? digits.length + 1 : scale + 2);
  if (plainLength > MEMORY_DIGITS) return { ok: false, error: TOO_LONG };
  return { ok: true, dec: { neg, digits, scale } };
}

/** For every length L, how long a stretch at the very end of `s` repeats with period L (the whole stretch, including the first block). */
function endRuns(s: ArrayLike<unknown>): number[] {
  const r = Array.from(s).reverse(), n = r.length;
  const z = new Array<number>(n).fill(0);
  for (let i = 1, l = 0, rr = 0; i < n; i++) {
    if (i < rr) z[i] = Math.min(rr - i, z[i - l]);
    while (i + z[i] < n && r[z[i]] === r[i + z[i]]) z[i]++;
    if (i + z[i] > rr) { l = i; rr = i + z[i]; }
  }
  return z.map((v, L) => (L === 0 ? 0 : L + v));
}

/**
 * Where the digits after the point start to repeat. The text ends in an ellipsis, so the digits written before it are the start of
 * the number: the block that repeats is the one the digits end with, repeating over the longest stretch (the shortest block on a tie).
 * Written by `toPlain` there are always at least two whole blocks and five digits of it, which this finds again every time.
 */
export function findRepeat(frac: ArrayLike<unknown>, minRun: number): { start: number; len: number } | null {
  const runs = endRuns(frac);
  let best: { start: number; len: number } | null = null, bestRun = 0;
  for (let L = 1; L * 2 <= frac.length; L++) {
    const run = runs[L];
    if (run >= Math.max(2 * L, minRun) && run > bestRun) { bestRun = run; best = { start: frac.length - run, len: L }; }
  }
  return best;
}

function parseEndless(t: string, input: string): DecParse {
  const bad: DecParse = { ok: false, error: `“${input.trim().slice(0, 40)}” is not a number.` };
  const m = /^([+\-\u2212])?(\d*)\.(\d+)(?:\.\.\.|\u2026)$/.exec(t);
  if (!m) return bad;
  const int = m[2], frac = m[3], neg = m[1] === '-' || m[1] === '\u2212';
  const hit = findRepeat(frac, 5) ?? findRepeat(frac, 2);
  if (!hit) return bad;
  const pre = frac.slice(0, hit.start), block = frac.slice(hit.start, hit.start + hit.len);
  if (pre.length + block.length + int.length > MEMORY_DIGITS) return { ok: false, error: TOO_LONG };
  const head = BigInt((int + pre) || '0'), B = BigInt(block), nines = P10(hit.len) - 1n;
  // (int.pre + 0.000…(block)) = (head × (10^L − 1) + block) / ((10^L − 1) × 10^|pre|)
  const dec = ratToDec((neg ? -1n : 1n) * (head * nines + B), nines * P10(pre.length));
  return { ok: true, dec };
}

/** A whole number written in another base (0xFF, 0b101, 0o77, any length) as the exact decimal it is. Null when the text is not written like that. */
export function parseRadixLiteral(text: string): Dec | null {
  const m = /^([+\-\u2212])?(0[xX][0-9a-fA-F]+|0[bB][01]+|0[oO][0-7]+)$/.exec(text.trim());
  if (!m) return null;
  const r = parseDec(BigInt(m[2]).toString());
  return r.ok ? (m[1] === '-' || m[1] === '\u2212' ? { ...r.dec, neg: !isZero(r.dec) } : r.dec) : null;
}

/** Is the number exactly zero? (A repeating number is never zero, even when its leading digit is 0.) */
export const isZero = (d: Dec): boolean => d.digits === '0' && !d.tail;

/** The whole number in plain digits, no point beyond what the scale asks for. */
function plainFixed(neg: boolean, s: string, scale: number): string {
  const sign = neg ? '-' : '';
  if (scale <= 0) return sign + (s === '0' ? '0' : s + '0'.repeat(-scale));
  if (s.length > scale) return sign + s.slice(0, s.length - scale) + '.' + s.slice(s.length - scale);
  return sign + '0.' + '0'.repeat(scale - s.length) + s;
}

/* ───── numbers that repeat ───── */

/** Longest search for the length of a repeating block (a block this long or longer is written as its first digits). */
const PERIOD_SEARCH = 4_000_000;
/** Digits written when the repeating block is too long to find (it is longer than PERIOD_SEARCH digits). */
const LONG_BLOCK_SHOWN = 10000;
const periodCache = new Map<string, number | null>();

/**
 * How many digits repeat in the expansion of a fraction with denominator d in base B (d and B share no factor): the smallest
 * p with B^p = 1 (mod d). Null if p is more than 4 million, which no screen could show anyway.
 */
export function periodOf(d: bigint, B: bigint = 10n): number | null {
  const key = `${B}/${d}`;
  const hit = periodCache.get(key);
  if (hit !== undefined) return hit;
  let found: number | null = null;
  if (d * B < 2n ** 53n) {
    const dn = Number(d), bn = Number(B);
    for (let i = 1, r = 1; i <= PERIOD_SEARCH; i++) { r = (r * bn) % dn; if (r === 1) { found = i; break; } }
  } else {
    for (let i = 1, r = 1n; i <= PERIOD_SEARCH; i++) { r = (r * B) % d; if (r === 1n) { found = i; break; } }
  }
  if (periodCache.size > 64) periodCache.clear();
  periodCache.set(key, found);
  return found;
}

/** The first m digits after the point of n/d (0 ≤ n < d), base 10. */
export function fracDigits(n: bigint, d: bigint, m: number): string {
  return m <= 0 ? '' : ((n * P10(m)) / d).toString().padStart(m, '0');
}

/** How many whole blocks of a repetition are written: at least two, and at least five digits (1.44444..., 0.142857142857...). */
export const shownRepeats = (period: number): number => Math.max(2, Math.ceil(5 / period));

/** The digits written for the endless part of a number: the repeating block over and over (plus `extra` more digits). */
function tailText(t: Tail, extra = 0): string {
  const n = BigInt(t.n), d = BigInt(t.d), L = periodOf(d);
  return fracDigits(n, d, L === null ? LONG_BLOCK_SHOWN : L * shownRepeats(L) + extra);
}

/** Position (from 1) after the point of the first non-zero digit of the endless part. */
function tailLead(t: Tail): number {
  const n = BigInt(t.n), d = BigInt(t.d);
  let p = d.toString().length - n.toString().length;
  if (n * P10(p) < d) p++;
  return p;
}

/** A number that repeats, worked out to m more digits as an ordinary number; `sticky` adds one last non-zero digit so that rounding never mistakes “just under” for an exact tie. */
function expand(d: Dec, m: number, sticky: boolean): Dec {
  const t = d.tail!;
  const frac = fracDigits(BigInt(t.n), BigInt(t.d), m) + (sticky ? '1' : '');
  const digits = strip(d.digits + frac);
  return digits === '0' ? ZERO(d.scale + frac.length) : { neg: d.neg, digits, scale: d.scale + frac.length };
}

/** The number as an ordinary one with at least `sig` significant digits: a repeating number is cut after enough digits (for the functions that can only be worked out approximately, such as √ and sin). */
export function approxDec(d: Dec, sig: number): Dec {
  if (!d.tail) return d;
  const lead = d.digits === '0' ? 0 : d.digits.length;
  return expand(d, lead === 0 ? tailLead(d.tail) + sig : Math.max(1, sig - lead), false);
}

/** A repeating number written out: all its digits up to and including the blocks that are shown (see shownRepeats), without the ellipsis. */
function written(d: Dec, extra = 0): Dec {
  const t = tailText(d.tail!, extra);
  return { neg: d.neg, digits: strip(d.digits + t), scale: d.scale + t.length };
}

/** The exact value as a fraction: a numerator with the sign, and a denominator above zero. */
export function decToRat(d: Dec): { n: bigint; d: bigint } {
  const head = BigInt(d.digits), sign = d.neg ? -1n : 1n;
  if (d.tail) { const td = BigInt(d.tail.d); return { n: sign * (head * td + BigInt(d.tail.n)), d: td * P10(d.scale) }; }
  return d.scale >= 0 ? { n: sign * head, d: P10(d.scale) } : { n: sign * head * P10(-d.scale), d: 1n };
}

/**
 * A fraction as the exact number: every digit when it ends (1/8 is 0.125), and the number that repeats when it does not (1/3 is 0.333…,
 * 13/9 is 1.444…). Nothing is rounded and no digits are worked out beyond the first non-repeating ones.
 */
export function ratToDec(num: bigint, den: bigint): Dec {
  if (den < 0n) { num = -num; den = -den; }
  if (num === 0n) return ZERO();
  const neg = num < 0n;
  if (neg) num = -num;
  const g = gcdBig(num, den);
  if (g > 1n) { num /= g; den /= g; }
  // The factors 2 and 5 of the denominator decide how many digits come before the repetition starts.
  let r = den, a2 = 0, a5 = 0;
  while ((r & 0x3fffffffn) === 0n) { r >>= 30n; a2 += 30; }
  while ((r & 1n) === 0n) { r >>= 1n; a2++; }
  while (r % 1220703125n === 0n) { r /= 1220703125n; a5 += 13; }
  while (r % 5n === 0n) { r /= 5n; a5++; }
  const k = Math.max(a2, a5);
  const N = num * 2n ** BigInt(k - a2) * 5n ** BigInt(k - a5);
  if (r === 1n) return canon({ neg, digits: N.toString(), scale: k });
  return { neg, digits: (N / r).toString(), scale: k, tail: { n: (N % r).toString(), d: r.toString() } };
}

/** Every digit, no exponent: 1.5e3 is 1500, 2.50 stays 2.50. A number that repeats ends in the ellipsis: 1.44444... */
export function toPlain(d: Dec): string {
  if (!d.tail) return plainFixed(d.neg, d.digits, d.scale);
  const head = plainFixed(d.neg, d.digits, d.scale);
  return head + (d.scale === 0 ? '.' : '') + tailText(d.tail) + ELLIPSIS;
}

/** The nearest double. Infinity when the value is beyond what a double can hold. */
export const toNumber = (d: Dec): number => {
  if (d.tail) { const e = expand(d, tailLead(d.tail) + 25, false); return Number(`${e.neg ? '-' : ''}${e.digits}e${-e.scale}`); }
  return Number(`${d.neg ? '-' : ''}${d.digits}e${-d.scale}`);
};

/** Position of the leading digit: 1234.5 → 3, 0.012 → −2. */
export const leadExp = (d: Dec): number => (d.tail && d.digits === '0' ? -(d.scale + tailLead(d.tail)) : d.digits.length - 1 - d.scale);

/** Is this value an exact decimal travelling on a wire (as opposed to a plain double)? */
export const isDec = (v: unknown): v is Dec =>
  typeof v === 'object' && v !== null && typeof (v as Dec).digits === 'string' && typeof (v as Dec).scale === 'number' && typeof (v as Dec).neg === 'boolean';

/** The one spelling of a value: no trailing zeros in the digits (1500 is 15 × 10², 2.50 is 25 × 10⁻¹), zero is never negative. A repeating number is already in its one spelling. */
export function canon(d: Dec): Dec {
  if (d.tail) return d;
  if (isZero(d)) return { neg: false, digits: '0', scale: 0 };
  const t = cutZeros(d.digits);
  return t.length === d.digits.length ? d : { neg: d.neg, digits: t, scale: d.scale - (d.digits.length - t.length) };
}

/** Do two decimals hold the same value, whatever their trailing zeros? */
export function sameDec(a: Dec, b: Dec): boolean {
  const x = canon(a), y = canon(b);
  return x.neg === y.neg && x.digits === y.digits && x.scale === y.scale && x.tail?.n === y.tail?.n && x.tail?.d === y.tail?.d;
}

/**
 * Put an exact value on a wire. When a double holds it exactly (its shortest text reads back as the same digits: 0.5, 42, 0.3)
 * it travels as a plain number, so everything that only knows numbers keeps working. When it needs more digits than a double has
 * (3.14159265358979323846, 1e400) or never ends (1/3) it travels as the exact Dec itself.
 */
export function packDec(d: Dec): number | Dec {
  const c = canon(d);
  if (c.tail) return c;
  const n = toNumber(c);
  if (Number.isFinite(n) && (n !== 0 || isZero(c)) && sameDec(fromNumber(n), c)) return n + 0;
  return c;
}

/** Two signal values that mean the same thing: identical, or exact decimals with the same digits. */
export const sameValue = (a: unknown, b: unknown): boolean => a === b || (isDec(a) && isDec(b) && sameDec(a, b));

/** Every digit of a number or exact decimal, written out in full with no exponent: 0.1 + 0.2 reads 0.3, 3.14159265358979323846 keeps all 21 digits. */
export const exactText = (v: number | Dec): string => toPlain(typeof v === 'number' ? fromNumber(v) : v);

/**
 * JSON text that keeps exact decimals whole: they are written as plain numbers with every digit (a number that repeats, which JSON has no way to write, as its text with the ellipsis). A value JSON cannot write
 * (undefined) is shown as String(v).
 */
export function jsonText(v: unknown, space?: number): string {
  const MARK = '\uE000dec:';
  const text = JSON.stringify(v, (_k, x) => (isDec(x) ? (x.tail ? toPlain(x) : MARK + toPlain(x)) : x), space);
  return text === undefined ? String(v) : text.replace(new RegExp(`"${MARK}([^"]*)"`, 'g'), '$1');
}

/** Read JSON without losing digits: numbers with more digits than a double holds become exact decimals (where the browser exposes the source text). */
export function parseJsonExact(text: string): unknown {
  return JSON.parse(text, function (this: unknown, _k: string, v: unknown, ctx?: { source?: string }) {
    if (typeof v === 'number' && ctx?.source) {
      const r = parseDec(ctx.source);
      if (r.ok) return packDec(r.dec);
    }
    return v;
  } as (this: unknown, key: string, value: unknown) => unknown);
}

const strip = (s: string): string => {
  let i = 0;
  while (i < s.length && s.charCodeAt(i) === 48) i++;
  return i === s.length ? '0' : s.slice(i);
};
/** The text without its trailing zeros (a plain scan: a long run of zeros inside a number must not make a regular expression take for ever). */
const cutZeros = (s: string): string => {
  let end = s.length;
  while (end > 0 && s.charCodeAt(end - 1) === 48) end--;
  return s.slice(0, end);
};

function increment(s: string): string {
  const a = s.split('');
  let i = a.length - 1;
  while (i >= 0) {
    if (a[i] === '9') { a[i] = '0'; i--; } else { a[i] = String(Number(a[i]) + 1); return a.join(''); }
  }
  return '1' + a.join('');
}

/** Give a number exactly `target` digits after the point (negative: that many zeros before it), padding or rounding as needed. */
export function setScale(d: Dec, target: number, mode: DecRounding = 'nearest'): Dec {
  // The digits of a repeating number never stop, so one more than asked for (and a last non-zero one) tell which way to round.
  if (d.tail) return setScale(expand(d, Math.max(0, target - d.scale) + 1, true), target, mode);
  if (target === d.scale) return d;
  if (isZero(d)) return ZERO(target);
  if (target > d.scale) return { ...d, digits: d.digits + '0'.repeat(target - d.scale), scale: target };
  const drop = d.scale - target;
  const ds = d.digits.padStart(drop, '0');
  const kept = ds.slice(0, ds.length - drop), rest = ds.slice(ds.length - drop);
  const any = /[1-9]/.test(rest);
  const above = rest[0] > '5' || (rest[0] === '5' && /[1-9]/.test(rest.slice(1)));
  const tie = rest[0] === '5' && !/[1-9]/.test(rest.slice(1));
  const odd = kept !== '' && Number(kept[kept.length - 1]) % 2 === 1;
  let up: boolean;
  switch (mode) {
    case 'even': up = above || (tie && odd); break;
    case 'up': up = any && !d.neg; break;
    case 'down': up = any && d.neg; break;
    case 'zero': up = false; break;
    case 'away': up = any; break;
    default: up = above || tie; // half away from zero
  }
  const base = kept === '' ? '0' : kept;
  const digits = strip(up ? increment(base) : base);
  return digits === '0' ? ZERO(Math.max(0, target)) : { neg: d.neg, digits, scale: target };
}

/** Round to `n` significant digits (n ≥ 1). Fewer digits than that are left alone. */
export function roundSignificant(d: Dec, n: number, mode: DecRounding = 'nearest'): Dec {
  if (d.tail && n >= 1) {
    const lead = d.digits === '0' ? 0 : d.digits.length;
    return roundSignificant(expand(d, lead === 0 ? tailLead(d.tail) + n : Math.max(0, n - lead) + 1, true), n, mode);
  }
  if (isZero(d) || n < 1 || d.digits.length <= n) return d;
  const r = setScale(d, d.scale - (d.digits.length - n), mode);
  // 999 → 1000 grows by one digit; the extra one is always a zero.
  return r.digits.length > n ? { ...r, digits: r.digits.slice(0, n), scale: r.scale - 1 } : r;
}

export interface FormatOptions {
  mode: FormatMode;
  /** Decimal places (places) or significant digits (digits, sci, eng). 0 means “keep every digit” except for places. */
  n: number;
  rounding: DecRounding;
  /** Drop trailing zeros after the point / in the mantissa. */
  trim: boolean;
  style: ExpStyle;
}

export interface Formatted {
  text: string;
  /** The value after rounding, exact. */
  rounded: Dec;
  /** Mantissa text and power of ten of the scientific or engineering form; set in every mode (plain modes use scientific). */
  mantissa: string;
  exponent: number;
}

const SUP: Record<string, string> = { '-': '⁻', '0': '⁰', '1': '¹', '2': '²', '3': '³', '4': '⁴', '5': '⁵', '6': '⁶', '7': '⁷', '8': '⁸', '9': '⁹' };
export const expText = (e: number, style: ExpStyle): string =>
  style === 'x10' ? ` × 10${String(e).split('').map((ch) => SUP[ch]).join('')}` : `e${e < 0 ? '-' : '+'}${Math.abs(e)}`;

const trimFrac = (s: string): string => (s.includes('.') ? cutZeros(s).replace(/\.$/, '') : s);

/** Mantissa and exponent of a number written with a power of ten that is a multiple of `step` (1 scientific, 3 engineering). */
function sciParts(d: Dec, step: 1 | 3, n: number, keepZeros: boolean): { mantissa: string; exponent: number } {
  if (isZero(d)) {
    const pad = keepZeros && n > 1 ? '.' + '0'.repeat(n - 1) : '';
    return { mantissa: '0' + pad, exponent: 0 };
  }
  const e = leadExp(d);
  const exponent = step === 1 ? e : Math.floor(e / 3) * 3;
  const intLen = e - exponent + 1;
  const ds = d.digits.padEnd(keepZeros ? Math.max(n, intLen) : intLen, '0');
  const int = ds.slice(0, intLen), frac = ds.slice(intLen);
  return { mantissa: (d.neg ? '-' : '') + int + (frac ? '.' + frac : ''), exponent };
}

export function formatDec(d: Dec, o: FormatOptions): Formatted {
  const n = Math.max(0, Math.round(o.n));
  const keepZeros = !o.trim;
  // A number that never ends is written with its repeating digits and an ellipsis after them (1.44444...), unless a rounding is asked for.
  const endless = !!d.tail && (o.mode === 'plain' || (o.mode !== 'places' && n === 0));
  const sci = o.mode === 'sci' || o.mode === 'eng';
  let rounded = d;
  if (endless) rounded = written(d, sci ? (periodOf(BigInt(d.tail!.d)) ?? 0) + 3 : 0);
  else if (o.mode === 'places') rounded = setScale(d, n, o.rounding);
  else if (o.mode !== 'plain' && n > 0) rounded = roundSignificant(d, n, o.rounding);

  // The scientific form is always worked out: it feeds the Mantissa and Exponent outputs even when the text is plain.
  const sciStep: 1 | 3 = o.mode === 'eng' ? 3 : 1;
  const sciN = sci ? n : 0;
  const parts = sciParts(rounded, sciStep, sciN, sci ? keepZeros : false);
  const mantissa = (o.trim && !endless ? trimFrac(parts.mantissa) : parts.mantissa) + (endless ? ELLIPSIS : '');

  let text: string;
  if (sci) {
    text = mantissa + expText(parts.exponent, o.style);
  } else {
    let r = rounded;
    // Significant digits are shown in full: 3 digits of 1.2 reads 1.20.
    if (o.mode === 'digits' && n > 0 && !isZero(r) && r.digits.length < n) r = setScale(r, r.scale + (n - r.digits.length));
    if (o.mode === 'digits' && n > 0 && isZero(r)) r = ZERO(Math.max(0, n - 1));
    text = toPlain(r);
    if (o.trim && !endless) text = trimFrac(text);
    if (text === '-0') text = '0';
    if (endless) text += ELLIPSIS;
  }
  return { text, rounded: endless ? d : rounded, mantissa, exponent: parts.exponent };
}

/** Read whatever arrives on a pin as exact digits: text keeps every digit, a number is read by its shortest text. */
export function decFromValue(v: unknown): DecParse {
  if (isDec(v)) return { ok: true, dec: v };
  if (typeof v === 'number') return Number.isFinite(v) ? { ok: true, dec: fromNumber(v) } : { ok: false, error: `${String(v)} is not a number.` };
  if (typeof v === 'boolean') return { ok: true, dec: fromNumber(v ? 1 : 0) };
  if (typeof v === 'string') return parseDec(v);
  return { ok: false, error: 'This kind of signal is not a number.' };
}

/** The formatting choices held in a Number Formatter's settings. */
export const formatOptionsOf = (p: Record<string, unknown>): FormatOptions => ({
  mode: (['plain', 'places', 'digits', 'sci', 'eng'] as const).find((m) => m === p.mode) ?? 'places',
  n: Number.isFinite(Number(p.n)) ? Number(p.n) : 2,
  rounding: (['nearest', 'even', 'up', 'down', 'zero', 'away'] as const).find((m) => m === p.rounding) ?? 'nearest',
  trim: !!p.trim,
  style: p.style === 'x10' ? 'x10' : 'e',
});

/** Format a value given as text with a Number Formatter's settings. Null when the text is not a number. */
export function formatText(value: string, p: Record<string, unknown>): Formatted | null {
  const r = parseDec(value);
  return r.ok ? formatDec(r.dec, formatOptionsOf(p)) : null;
}
