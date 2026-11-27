// Pure support for the Base Converter actor: write any number in any base from 1 to 40. No engine, no UI.
// Every step works on whole numbers of any size (BigInt), so nothing is lost to the 15 digits of a double. There is no limit on how
// many digits a number has, before or after the point, other than the memory of the machine.
//
// A fraction that does not end in the base it is written in repeats instead (0.1 in base 2 is 0.0001100110011…, 1/3 in base 10 is
// 0.333…). It is held exactly, and written with its repeating digits followed by an ellipsis: 0.00011001100110011...

import { ELLIPSIS, findRepeat, gcdBig, periodOf, shownRepeats } from './decimal';

export const MIN_BASE = 1;
export const MAX_BASE = 40;
/** The 40 default symbols: 0-9, A-Z (the usual digits up to base 36), then a, b, c and d for bases 37 to 40. */
export const DEFAULT_SYMBOLS = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcd';
/** Digits written when the repeating block of a fraction is longer than anyone could read (more than 4 million digits). */
const LONG_BLOCK_SHOWN = 10000;

export type Res<T> = { ok: true; value: T } | { ok: false; error: string };

/** A number as a fraction of two whole numbers: exact, whatever its digits. */
export interface Ratio { neg: boolean; n: bigint; d: bigint }

const RESERVED = new Set(['-', '+', '.', '_', ' ', '\t', '\n', '\r']);
const MEMORY = 'This number needs more memory than this browser can give it.';

/** Check that the symbols can write both bases. Base 1 needs two (a zero and a tally mark), base b needs b. */
export function checkSymbols(symbols: string, need: number): string | undefined {
  const list = Array.from(symbols);
  if (list.length < need) return `Symbols needs at least ${need} characters, one for each digit of the larger base: it has ${list.length}.`;
  const used = list.slice(0, need);
  const seen = new Set<string>();
  for (const s of used) {
    if (RESERVED.has(s) || /\s/u.test(s)) return `The symbol “${s.trim() === '' ? 'space' : s}” cannot be a digit, because it is used for the sign, the point or spacing. Choose another one.`;
    if (seen.has(s)) return `The symbol “${s}” appears twice among the first ${need}: every digit needs its own symbol.`;
    seen.add(s);
  }
  return undefined;
}

/* ───── whole numbers ⇄ digits, fast for any length ───── */

/** The value of digits written in base B (divide and conquer, so a million digits is not a million long multiplications). */
function fromDigits(vals: number[], B: bigint, lo = 0, hi = vals.length): bigint {
  const len = hi - lo;
  if (len <= 24) { let n = 0n; for (let i = lo; i < hi; i++) n = n * B + BigInt(vals[i]); return n; }
  const half = len >> 1;
  return fromDigits(vals, B, lo, hi - half) * B ** BigInt(half) + fromDigits(vals, B, hi - half, hi);
}

/** The digits of v in base B as symbols, at least `width` of them (zero symbols in front). */
function toDigits(v: bigint, base: number, syms: string[], width = 0): string[] {
  const B = BigInt(base);
  let out: string[];
  if (base <= 36) {
    out = v.toString(base).split('').map((ch) => syms[parseInt(ch, 36)]);
  } else {
    const conv = (x: bigint, w: number): string[] => {
      if (x < B ** 24n) { const a: string[] = []; while (x > 0n) { a.push(syms[Number(x % B)]); x /= B; } while (a.length < w) a.push(syms[0]); return a.reverse(); }
      const half = w > 0 ? Math.ceil(w / 2) : Math.ceil((x.toString(16).length * 4) / Math.log2(base) / 2);
      const P = B ** BigInt(half);
      return conv(x / P, w > 0 ? w - half : 0).concat(conv(x % P, half));
    };
    out = v === 0n ? [syms[0]] : conv(v, 0);
  }
  if (out.length < width) out = new Array<string>(width - out.length).fill(syms[0]).concat(out);
  return out;
}

/** Read digits written in `base` into an exact fraction. A trailing ellipsis (0.0001100110011...) means the digits it ends with repeat for ever. */
export function parseBased(text: string, base: number, symbols: string): Res<Ratio> {
  const syms = Array.from(symbols);
  let s = text.trim().replace(/[\s_]/g, '');
  if (s === '') return { ok: false, error: 'There is no number to convert.' };
  let neg = false;
  if (s[0] === '-' || s[0] === '+') { neg = s[0] === '-'; s = s.slice(1); }
  if (s === '') return { ok: false, error: 'A sign needs digits after it.' };

  if (base === 1) {
    if (s.includes('.')) return { ok: false, error: 'Base 1 (tally marks) writes whole numbers only: there is no decimal point.' };
    const zero = syms[0], mark = syms[1];
    if (s === zero) return { ok: true, value: { neg: false, n: 0n, d: 1n } };
    const marks = Array.from(s);
    const wrong = marks.find((ch) => ch !== mark);
    if (wrong !== undefined) return { ok: false, error: `“${wrong}” is not a digit of base 1: write the number as that many “${mark}” marks, or “${zero}” for zero.` };
    return { ok: true, value: { neg, n: BigInt(marks.length), d: 1n } };
  }

  const digits = syms.slice(0, base);
  // A custom U+2026 digit is a digit, not the repeating-tail marker. The ASCII three-dot marker remains unambiguous.
  const endless = s.endsWith('...') || (s.endsWith('\u2026') && !digits.includes('\u2026'));
  if (endless) s = s.endsWith('...') ? s.slice(0, -3) : s.slice(0, -1);
  const index = new Map<string, number>(digits.map((ch, i) => [ch, i]));
  const swapCase = (ch: string) => (ch === ch.toUpperCase() ? ch.toLowerCase() : ch.toUpperCase());
  // Above base 36, uppercase and lowercase symbols can represent different values.
  const digit = (ch: string): number | undefined => index.get(ch) ?? (base <= 36 ? index.get(swapCase(ch)) : undefined);
  const parts = s.split('.');
  if (parts.length > 2) return { ok: false, error: 'A number has only one decimal point.' };
  const [whole, frac = ''] = parts;
  if (whole === '' && frac === '') return { ok: false, error: 'A point needs digits next to it.' };
  const B = BigInt(base);
  const read = (str: string): { vals: number[] } | { error: string } => {
    const vals: number[] = [];
    for (const ch of Array.from(str)) {
      const v = digit(ch);
      if (v === undefined) return { error: `“${ch}” is not a digit of base ${base}. The digits are ${digits.join(' ')}.` };
      vals.push(v);
    }
    return { vals };
  };
  const w = read(whole), f = read(frac);
  if ('error' in w) return { ok: false, error: w.error };
  if ('error' in f) return { ok: false, error: f.error };

  if (endless) {
    // The digits before the ellipsis are the start of the number; the ones they end with repeat.
    const hit = parts.length === 2 && frac !== '' ? (findRepeat(f.vals, 5) ?? findRepeat(f.vals, 2)) : null;
    if (!hit) return { ok: false, error: 'An ellipsis (...) must follow digits that repeat after the point, such as 0.333...' };
    const pre = f.vals.slice(0, hit.start), block = f.vals.slice(hit.start, hit.start + hit.len);
    const head = fromDigits(w.vals.concat(pre), B), blk = fromDigits(block, B), nines = B ** BigInt(hit.len) - 1n;
    return { ok: true, value: { neg, n: head * nines + blk, d: nines * B ** BigInt(pre.length) } };
  }

  const n = fromDigits(w.vals, B), fr = fromDigits(f.vals, B);
  const d = B ** BigInt(f.vals.length);
  return { ok: true, value: { neg, n: n * d + fr, d } };
}

export interface Based {
  text: string;
  /** True when the number could not be written exactly in this many digits and was rounded. */
  rounded: boolean;
  /** True when the fraction never ends but repeats: the text ends in an ellipsis after the repeating digits. */
  repeating?: boolean;
}

/**
 * Write a number in `base`. By default (`precision` null) every digit is written: a fraction that ends is written in full, and one
 * that repeats is written with its repeating digits followed by an ellipsis (0.00011001100110011...). Give a `precision` and the
 * fraction is rounded to the nearest at that many places instead, with zeros at the end dropped. Base 1 is a tally of marks: whole numbers only.
 */
export function formatBased(r: Ratio, base: number, symbols: string, precision: number | null = null): Res<Based> {
  const syms = Array.from(symbols);
  try {
    if (base === 1) {
      const v = (r.n * 2n + r.d) / (2n * r.d);
      return { ok: true, value: { text: v === 0n ? syms[0] : (r.neg ? '-' : '') + syms[1].repeat(Number(v)), rounded: r.n % r.d !== 0n } };
    }
    const B = BigInt(base);
    if (precision !== null) {
      const p = Math.max(0, Math.trunc(precision));
      const scale = B ** BigInt(p);
      const scaled = (r.n * scale * 2n + r.d) / (2n * r.d);
      const rounded = (r.n * scale) % r.d !== 0n;
      const digits = toDigits(scaled, base, syms, p + 1);
      const whole = digits.slice(0, digits.length - p).join('');
      let frac = digits.slice(digits.length - p);
      while (frac.length && frac[frac.length - 1] === syms[0]) frac = frac.slice(0, -1);
      const sign = r.neg && scaled !== 0n ? '-' : '';
      return { ok: true, value: { text: sign + whole + (frac.length ? '.' + frac.join('') : ''), rounded } };
    }

    const g = gcdBig(r.n, r.d) || 1n;
    const n = r.n / g, d = r.d / g;
    const sign = r.neg && n !== 0n ? '-' : '';
    const whole = toDigits(n / d, base, syms).join(''), rem = n % d;
    if (rem === 0n) return { ok: true, value: { text: sign + whole, rounded: false } };

    // d = (a part made only of the base's own prime factors) × q, with q sharing none with the base. The first k digits after the
    // point come before any repetition; if q is 1 the fraction ends there, otherwise the repetition starts and its length is the
    // number of powers of the base it takes to reach 1 modulo q.
    let q = d, k = 0;
    for (let x = gcdBig(q, B); x > 1n; x = gcdBig(q, B)) { q /= x; k++; }
    const m = rem * (B ** BigInt(k) / (d / q));
    if (q === 1n) return { ok: true, value: { text: sign + whole + '.' + toDigits(m, base, syms, k).join(''), rounded: false } };
    const pre = k === 0 ? '' : toDigits(m / q, base, syms, k).join('');
    const tn = m % q, L = periodOf(q, B);
    const shown = L === null ? LONG_BLOCK_SHOWN : L * shownRepeats(L);
    const tail = toDigits((tn * B ** BigInt(shown)) / q, base, syms, shown).join('');
    return { ok: true, value: { text: sign + whole + '.' + pre + tail + ELLIPSIS, rounded: false, repeating: true } };
  } catch (e) {
    if (e instanceof RangeError) return { ok: false, error: MEMORY };
    throw e;
  }
}

/** The digits of a number written as text, whatever it is made of (the sign and the point are not digits). */
export const countDigits = (text: string): number => Array.from(text).filter((ch) => ch !== '-' && ch !== '.').length;
