// Pure support for the Base Data section: Integer, Decimal, String, Character, Boolean and Array. No engine, no UI.

import { numText } from './util';
import { isDec, isZero, jsonText, packDec, parseDec, parseJsonExact, parseRadixLiteral, toPlain, type Dec } from './decimal';
import * as D from './decmath';

/** A number read from text with every digit it has (a number when a double holds it exactly, an exact decimal when it takes more). Undefined when the text is not a number. */
export function readNumber(s: string): number | import('./decimal').Dec | undefined {
  const r = parseDec(s);
  if (r.ok) return packDec(r.dec);
  // Numbers written in another base (0x1F, 0b101, 0o77) are read exactly, whatever their length.
  const lit = parseRadixLiteral(s);
  return lit ? packDec(lit) : undefined;
}

/* ───── Integer ───── */

// There is no largest or smallest Integer: it has as many digits as the memory of the machine allows.

export type Rounding = 'trunc' | 'round' | 'floor' | 'ceil';
export type IntBase = 'dec' | 'bin' | 'oct' | 'hex';

/** Make a whole number out of x. Negative zero becomes plain zero. */
export function roundInt(x: number, how: Rounding | string): number {
  const r = how === 'round' ? Math.round(x) : how === 'floor' ? Math.floor(x) : how === 'ceil' ? Math.ceil(x) : Math.trunc(x);
  return r + 0;
}

/** Make a whole number out of any exact number, of any size, with no digit lost: 123456789012345678901234567890.5 rounded is …891. */
export function wholeNumber(d: Dec, how: Rounding | string): Dec {
  return how === 'round' ? D.round(d) : how === 'floor' ? D.floor(d) : how === 'ceil' ? D.ceil(d) : D.trunc(d);
}

/** The whole number held by an exact decimal (any fraction is dropped). */
export function bigIntOf(d: Dec): bigint {
  const w = D.trunc(d);
  const v = BigInt(w.digits) * (w.scale < 0 ? 10n ** BigInt(-w.scale) : 1n);
  return w.neg ? -v : v;
}

const BASES: Record<IntBase, { radix: number; prefix: string }> = {
  dec: { radix: 10, prefix: '' }, bin: { radix: 2, prefix: '0b' }, oct: { radix: 8, prefix: '0o' }, hex: { radix: 16, prefix: '0x' },
};

/** A whole number written out in full in the base: 255 is 255, 0xFF, 0o377 or 0b11111111, however large it is. */
export function fmtInt(x: number | bigint | Dec, base: IntBase | string = 'dec'): string {
  const b = BASES[base as IntBase] ?? BASES.dec;
  const v = typeof x === 'bigint' ? x : typeof x === 'number' ? (Number.isFinite(x) ? BigInt(Math.trunc(x)) : 0n) : bigIntOf(x);
  const digits = (v < 0n ? -v : v).toString(b.radix);
  return (v < 0n ? '-' : '') + b.prefix + (b.radix === 16 ? digits.toUpperCase() : digits);
}

/* ───── Decimal ───── */
// A Decimal keeps whatever digits it is given: see decimal.ts. Rounding and notation belong to the Number Formatter actor.

/* ───── String and Character ───── */

export type CaseMode = 'keep' | 'upper' | 'lower' | 'title';

export function applyCase(s: string, how: CaseMode | string): string {
  switch (how) {
    case 'upper': return s.toUpperCase();
    case 'lower': return s.toLowerCase();
    case 'title': return s.replace(/(^|\s)(\p{L})/gu, (_m, a: string, b: string) => a + b.toUpperCase());
    default: return s;
  }
}

/** Characters as a person counts them: one per Unicode code point, so an emoji is one, not two. */
export const chars = (s: string): string[] => Array.from(s);

/** Upper/lower-case a single character without letting it grow (ß in capitals is SS: keep ß then). */
export function caseChar(ch: string, how: CaseMode | string): string {
  const r = applyCase(ch, how);
  return chars(r).length === 1 ? r : ch;
}

export const codePointOf = (ch: string): number => ch.codePointAt(0) ?? 0;
export const fmtCodePoint = (cp: number): string => `U+${cp.toString(16).toUpperCase().padStart(4, '0')}`;
export const validCodePoint = (n: number): boolean => Number.isInteger(n) && n >= 0 && n <= 0x10ffff && !(n >= 0xd800 && n <= 0xdfff);

/** Show a string with visible quotes and escapes for the node face. */
export const quote = (s: string): string => `"${s.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n').replace(/\t/g, '\\t')}"`;

/* ───── Boolean ───── */

export type Words = 'tf' | 'yn' | 'oo' | 'bit';
const WORDS: Record<Words, [string, string]> = { tf: ['true', 'false'], yn: ['yes', 'no'], oo: ['on', 'off'], bit: ['1', '0'] };
export const wordsFor = (w: Words | string, v: boolean): string => (WORDS[w as Words] ?? WORDS.tf)[v ? 0 : 1];

const FALSY = new Set(['', 'false', 'f', 'no', 'n', 'off', '0', 'null', 'undefined', 'nan']);
/** Read any signal as true or false. Words such as no and off count as false, as a person would mean them. */
export function readBool(v: unknown): boolean {
  if (typeof v === 'string') return !FALSY.has(v.trim().toLowerCase());
  if (typeof v === 'number') return v !== 0 && !Number.isNaN(v);
  if (isDec(v)) return !isZero(v);
  if (Array.isArray(v)) return v.length > 0;
  return !!v;
}

/* ───── Array / List ───── */

export type ItemsAs = 'auto' | 'text' | 'number';
export const MAX_ITEMS = 10000;

export type Parsed = { ok: true; items: unknown[] } | { ok: false; error: string };

/**
 * Turn text into a list. Text that is a JSON array ([1, "a", true]) is read as one. Anything else is split on the
 * separator (every character when the separator is empty); each piece is trimmed and empty pieces are dropped.
 */
export function parseItems(text: string, separator: string, as: ItemsAs | string = 'auto'): Parsed {
  const t = text.trim();
  if (t === '') return { ok: true, items: [] };
  if (t.startsWith('[') && t.endsWith(']')) {
    try {
      const j = parseJsonExact(t);
      if (Array.isArray(j)) return { ok: true, items: j };
    } catch { /* not JSON: fall through and split it as plain text */ }
  }
  const parts = (separator === '' ? chars(text) : text.split(separator)).map((s) => s.trim()).filter((s) => s !== '');
  const items: unknown[] = [];
  for (const s of parts) {
    if (as === 'text') items.push(s);
    else if (as === 'number') {
      const n = readNumber(s);
      if (n === undefined) return { ok: false, error: `“${s}” isn’t a number. Items as “Numbers” needs every item to be one.` };
      items.push(n);
    } else if (s === 'true') items.push(true);
    else if (s === 'false') items.push(false);
    else { const n = readNumber(s); items.push(n === undefined ? s : n); }
  }
  return { ok: true, items };
}

export function fmtItem(v: unknown): string {
  if (typeof v === 'string') return quote(v);
  if (typeof v === 'number') return numText(v);
  if (isDec(v)) return toPlain(v);
  if (typeof v === 'boolean' || v === null || v === undefined) return String(v);
  try { return jsonText(v); } catch { return String(v); }
}

export const fmtList = (items: unknown[]): string => `[${items.map(fmtItem).join(', ')}]`;

/** The item at an index; negative indexes count from the end (-1 is the last). */
export function itemAt(items: unknown[], index: number): { ok: true; value: unknown } | { ok: false } {
  const i = Math.trunc(index);
  const at = i < 0 ? items.length + i : i;
  return at >= 0 && at < items.length ? { ok: true, value: items[at] } : { ok: false };
}
