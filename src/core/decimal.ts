// Arbitrary-precision decimal numbers, as digit strings. No engine, no UI, no rounding unless asked for.
// (Arithmetic on them lives in decmath.ts; this file reads, writes and formats them.)
//
// A Dec is  ±digits × 10^(−scale):  "3.50" is { digits: "350", scale: 2 }, 1.5e3 is { digits: "15", scale: −2 }. Digits are kept
// exactly as given (trailing zeros included), so nothing is ever lost on the way in. Rounding happens only in the functions below
// that are called by the Number Formatter.

/** A double as the shortest text that reads back as exactly the same double. */
const shortest = (n: number): string => (Object.is(n, -0) ? '0' : String(n));

export interface Dec { neg: boolean; digits: string; scale: number }

/** Largest power of ten accepted when reading a number (1e99999). */
export const MAX_EXP = 99999;
/** Longest run of digits one number may expand to. */
export const MAX_DIGITS = 100000;

export type DecRounding = 'nearest' | 'even' | 'up' | 'down' | 'zero' | 'away';
export type FormatMode = 'plain' | 'places' | 'digits' | 'sci' | 'eng';
export type ExpStyle = 'e' | 'x10';

export type DecParse = { ok: true; dec: Dec } | { ok: false; error: string };

const NUM_RE = /^([+\-\u2212])?(\d*)(?:\.(\d*))?(?:[eE]([+\-\u2212]?\d+))?$/;
const ZERO = (scale = 0): Dec => ({ neg: false, digits: '0', scale });

/** Read a JS number as digits: its shortest text, which reads back as exactly the same double. */
export const fromNumber = (n: number): Dec => {
  const r = parseDec(shortest(n));
  return r.ok ? r.dec : ZERO();
};

/** Read a decimal number from text such as 3.14, −0.5, .5, 1_000.25 or 6.022e23. Any number of digits is kept. */
export function parseDec(input: string): DecParse {
  const t = input.trim().replace(/(?<=\d)_(?=\d)/g, '');
  const m = NUM_RE.exec(t);
  if (!m || (!m[2] && !m[3])) return { ok: false, error: `“${input.trim().slice(0, 40)}” is not a number.` };
  const int = m[2] ?? '', frac = m[3] ?? '';
  const exp = m[4] ? Number(m[4].replace('\u2212', '-')) : 0;
  if (Math.abs(exp) > MAX_EXP) return { ok: false, error: `The exponent ${exp} is beyond ±${MAX_EXP}.` };
  const digits = (int + frac).replace(/^0+/, '');
  const scale = frac.length - exp;
  if (digits === '') return { ok: true, dec: ZERO(Math.max(0, scale)) };
  if (digits.length + Math.abs(scale) > MAX_DIGITS) return { ok: false, error: `That number needs more than ${MAX_DIGITS} digits.` };
  return { ok: true, dec: { neg: m[1] === '-' || m[1] === '\u2212', digits, scale } };
}

export const isZero = (d: Dec): boolean => d.digits === '0';

/** Every digit, no exponent: 1.5e3 is 1500, 2.50 stays 2.50. */
export function toPlain(d: Dec): string {
  const s = d.digits, sign = d.neg ? '-' : '';
  if (d.scale <= 0) return sign + (s === '0' ? '0' : s + '0'.repeat(-d.scale));
  if (s.length > d.scale) return sign + s.slice(0, s.length - d.scale) + '.' + s.slice(s.length - d.scale);
  return sign + '0.' + '0'.repeat(d.scale - s.length) + s;
}

/** The nearest double. Infinity when the value is beyond what a double can hold. */
export const toNumber = (d: Dec): number => Number(`${d.neg ? '-' : ''}${d.digits}e${-d.scale}`);

/** Position of the leading digit: 1234.5 → 3, 0.012 → −2. */
export const leadExp = (d: Dec): number => d.digits.length - 1 - d.scale;

/** Is this value an exact decimal travelling on a wire (as opposed to a plain double)? */
export const isDec = (v: unknown): v is Dec =>
  typeof v === 'object' && v !== null && typeof (v as Dec).digits === 'string' && typeof (v as Dec).scale === 'number' && typeof (v as Dec).neg === 'boolean';

/** The one spelling of a value: no trailing zeros in the digits (1500 is 15 × 10², 2.50 is 25 × 10⁻¹), zero is never negative. */
export function canon(d: Dec): Dec {
  if (isZero(d)) return { neg: false, digits: '0', scale: 0 };
  const t = d.digits.replace(/0+$/, '');
  return t.length === d.digits.length ? d : { neg: d.neg, digits: t, scale: d.scale - (d.digits.length - t.length) };
}

/** Do two decimals hold the same value, whatever their trailing zeros? */
export function sameDec(a: Dec, b: Dec): boolean {
  const x = canon(a), y = canon(b);
  return x.neg === y.neg && x.digits === y.digits && x.scale === y.scale;
}

/**
 * Put an exact value on a wire. When a double holds it exactly (its shortest text reads back as the same digits: 0.5, 42, 0.3)
 * it travels as a plain number, so everything that only knows numbers keeps working. When it needs more digits than a double has
 * (3.14159265358979323846, 1e400) it travels as the exact Dec itself.
 */
export function packDec(d: Dec): number | Dec {
  const c = canon(d);
  const n = toNumber(c);
  if (Number.isFinite(n) && (n !== 0 || isZero(c)) && sameDec(fromNumber(n), c)) return n + 0;
  return c;
}

/** Two signal values that mean the same thing: identical, or exact decimals with the same digits. */
export const sameValue = (a: unknown, b: unknown): boolean => a === b || (isDec(a) && isDec(b) && sameDec(a, b));

/** Every digit of a number or exact decimal, written out in full with no exponent: 0.1 + 0.2 reads 0.3, 3.14159265358979323846 keeps all 21 digits. */
export const exactText = (v: number | Dec): string => toPlain(typeof v === 'number' ? fromNumber(v) : v);

/**
 * JSON text that keeps exact decimals whole: they are written as plain numbers with every digit. A value JSON cannot write
 * (undefined) is shown as String(v).
 */
export function jsonText(v: unknown, space?: number): string {
  const MARK = '\uE000dec:';
  const text = JSON.stringify(v, (_k, x) => (isDec(x) ? MARK + toPlain(x) : x), space);
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

const strip = (s: string): string => s.replace(/^0+/, '') || '0';

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

const trimFrac = (s: string): string => (s.includes('.') ? s.replace(/0+$/, '').replace(/\.$/, '') : s);

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
  let rounded = d;
  if (o.mode === 'places') rounded = setScale(d, n, o.rounding);
  else if (o.mode !== 'plain' && n > 0) rounded = roundSignificant(d, n, o.rounding);

  // The scientific form is always worked out: it feeds the Mantissa and Exponent outputs even when the text is plain.
  const sciStep: 1 | 3 = o.mode === 'eng' ? 3 : 1;
  const sciN = o.mode === 'sci' || o.mode === 'eng' ? n : 0;
  const parts = sciParts(rounded, sciStep, sciN, o.mode === 'sci' || o.mode === 'eng' ? keepZeros : false);
  const mantissa = o.trim ? trimFrac(parts.mantissa) : parts.mantissa;

  let text: string;
  if (o.mode === 'sci' || o.mode === 'eng') {
    text = mantissa + expText(parts.exponent, o.style);
  } else {
    let r = rounded;
    // Significant digits are shown in full: 3 digits of 1.2 reads 1.20.
    if (o.mode === 'digits' && n > 0 && !isZero(r) && r.digits.length < n) r = setScale(r, r.scale + (n - r.digits.length));
    if (o.mode === 'digits' && n > 0 && isZero(r)) r = ZERO(Math.max(0, n - 1));
    text = toPlain(r);
    if (o.trim) text = trimFrac(text);
    if (text === '-0') text = '0';
  }
  return { text, rounded, mantissa, exponent: parts.exponent };
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
