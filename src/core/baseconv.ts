// Pure support for the Base Converter actor: write any number in any base from 1 to 40. No engine, no UI.
// Every step works on whole numbers of any size (BigInt), so nothing is lost to the 15 digits of a double.

export const MIN_BASE = 1;
export const MAX_BASE = 40;
/** The 40 default symbols: 0-9, A-Z (the usual digits up to base 36), then a, b, c and d for bases 37 to 40. */
export const DEFAULT_SYMBOLS = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcd';
export const MAX_FRACTION_DIGITS = 100;
/** Longest tally (base 1) that is written out. */
export const MAX_TALLY = 10000;

export type Res<T> = { ok: true; value: T } | { ok: false; error: string };

/** A number as a fraction of two whole numbers: exact, whatever its digits. */
export interface Ratio { neg: boolean; n: bigint; d: bigint }

const RESERVED = new Set(['-', '+', '.', '_', ' ', '\t', '\n', '\r']);

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

/** Read digits written in `base` into an exact fraction. */
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
    if (marks.length > MAX_TALLY) return { ok: false, error: `A tally of more than ${MAX_TALLY.toLocaleString('en')} marks is not supported.` };
    return { ok: true, value: { neg, n: BigInt(marks.length), d: 1n } };
  }

  const digits = syms.slice(0, base);
  const index = new Map<string, number>(digits.map((ch, i) => [ch, i]));
  const swapCase = (ch: string) => (ch === ch.toUpperCase() ? ch.toLowerCase() : ch.toUpperCase());
  // Above base 36, uppercase and lowercase symbols can represent different values.
  const digit = (ch: string): number | undefined => index.get(ch) ?? (base <= 36 ? index.get(swapCase(ch)) : undefined);
  const parts = s.split('.');
  if (parts.length > 2) return { ok: false, error: 'A number has only one decimal point.' };
  const [whole, frac = ''] = parts;
  if (whole === '' && frac === '') return { ok: false, error: 'A point needs digits next to it.' };
  const B = BigInt(base);
  let n = 0n;
  for (const ch of Array.from(whole)) {
    const v = digit(ch);
    if (v === undefined) return { ok: false, error: `“${ch}” is not a digit of base ${base}. The digits are ${digits.join(' ')}.` };
    n = n * B + BigInt(v);
  }
  let f = 0n;
  const fracChars = Array.from(frac);
  for (const ch of fracChars) {
    const v = digit(ch);
    if (v === undefined) return { ok: false, error: `“${ch}” is not a digit of base ${base}. The digits are ${digits.join(' ')}.` };
    f = f * B + BigInt(v);
  }
  const d = B ** BigInt(fracChars.length);
  return { ok: true, value: { neg, n: n * d + f, d } };
}

function toDigits(v: bigint, base: bigint, syms: string[]): string[] {
  if (v === 0n) return [syms[0]];
  const out: string[] = [];
  while (v > 0n) { out.push(syms[Number(v % base)]); v /= base; }
  return out.reverse();
}

export interface Based { text: string; /** True when the number could not be written exactly in this many digits and was rounded. */ rounded: boolean }

/**
 * Write a number in `base`. Digits after the point are rounded to the nearest at `precision` places and trailing zeros
 * are dropped. Base 1 is a tally of marks: whole numbers only.
 */
export function formatBased(r: Ratio, base: number, symbols: string, precision: number): Res<Based> {
  const syms = Array.from(symbols);
  if (base === 1) {
    const v = (r.n * 2n + r.d) / (2n * r.d);
    if (v > BigInt(MAX_TALLY)) return { ok: false, error: `Written in base 1 this number needs more than ${MAX_TALLY.toLocaleString('en')} marks, which is not supported.` };
    return { ok: true, value: { text: v === 0n ? syms[0] : (r.neg ? '-' : '') + syms[1].repeat(Number(v)), rounded: r.n % r.d !== 0n } };
  }
  const B = BigInt(base);
  const p = Math.max(0, Math.min(MAX_FRACTION_DIGITS, Math.trunc(precision)));
  const scale = B ** BigInt(p);
  const scaled = (r.n * scale * 2n + r.d) / (2n * r.d);
  const rounded = (r.n * scale) % r.d !== 0n;
  let digits = toDigits(scaled, B, syms);
  while (digits.length < p + 1) digits.unshift(syms[0]);
  const whole = digits.slice(0, digits.length - p).join('');
  let frac = digits.slice(digits.length - p);
  while (frac.length && frac[frac.length - 1] === syms[0]) frac = frac.slice(0, -1);
  const sign = r.neg && scaled !== 0n ? '-' : '';
  return { ok: true, value: { text: sign + whole + (frac.length ? '.' + frac.join('') : ''), rounded } };
}

/** The digits of a number written as text, whatever it is made of (the sign and the point are not digits). */
export const countDigits = (text: string): number => Array.from(text).filter((ch) => ch !== '-' && ch !== '.').length;
