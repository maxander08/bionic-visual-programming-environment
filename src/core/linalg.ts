// Pure support for the Vector and Matrix modules of the Base Data section. No engine, no UI.
// A vector is a list of numbers; a matrix is a list of equally long rows of numbers, of any size (rows × columns).

import { isDec, toNumber } from './decimal';
import { numText } from './util';

/** Most numbers one vector or matrix may hold. */
export const MAX_CELLS = 10000;

export type Vec = number[];
export type Mat = number[][];

export type Res<T> = { ok: true; value: T } | { ok: false; error: string };

/** One value read as a number: numbers, exact decimals, true/false and numeric text. NaN when it is none of these. */
export function cellNumber(v: unknown): number {
  if (typeof v === 'number') return v;
  if (isDec(v)) return toNumber(v);
  if (typeof v === 'boolean') return v ? 1 : 0;
  if (typeof v === 'string' && v.trim() !== '') return Number(v.trim());
  return NaN;
}

const bad = (v: unknown) => `“${typeof v === 'string' ? v : JSON.stringify(v) ?? String(v)}” is not a number.`.slice(0, 120);

function numbers(list: unknown[]): Res<Vec> {
  const out: Vec = [];
  for (const x of list) {
    const n = cellNumber(x);
    if (!Number.isFinite(n)) return { ok: false, error: bad(x) };
    out.push(n + 0);
  }
  return { ok: true, value: out };
}

function jsonOf(text: string): unknown[] | undefined {
  const t = text.trim();
  if (!(t.startsWith('[') && t.endsWith(']'))) return undefined;
  try {
    const j = JSON.parse(t);
    return Array.isArray(j) ? j : undefined;
  } catch { return undefined; }
}

const pieces = (s: string) => s.split(/[\s,;]+/).filter((x) => x !== '');

/** A vector from text: 1, 2, 3 (commas, semicolons or spaces) or a JSON list [1, 2, 3]. */
export function parseVector(text: string): Res<Vec> {
  const j = jsonOf(text);
  return fromList(j ?? pieces(text));
}

function fromList(list: unknown[]): Res<Vec> {
  if (list.length > MAX_CELLS) return { ok: false, error: `A vector holds at most ${MAX_CELLS.toLocaleString('en')} numbers.` };
  if (list.some((x) => Array.isArray(x))) return { ok: false, error: 'A vector is a flat list of numbers: it cannot contain lists. Use a Matrix for rows.' };
  return numbers(list);
}

/** A vector from any signal: a list, text, a number (a vector of one) or true/false. */
export function toVector(v: unknown): Res<Vec> {
  if (Array.isArray(v)) return fromList(v);
  if (typeof v === 'string') return parseVector(v);
  const n = cellNumber(v);
  return Number.isFinite(n) ? { ok: true, value: [n + 0] } : { ok: false, error: bad(v) };
}

function fromRows(rows: unknown[]): Res<Mat> {
  // A flat list of numbers is a single row.
  const grid: unknown[][] = rows.some((r) => Array.isArray(r)) ? rows.map((r) => (Array.isArray(r) ? r : [r])) : rows.length ? [rows] : [];
  const out: Mat = [];
  let width = -1;
  let cells = 0;
  for (const r of grid) {
    if (width >= 0 && r.length !== width) return { ok: false, error: `Every row of a matrix needs the same number of columns: row 1 has ${width}, row ${out.length + 1} has ${r.length}.` };
    width = r.length;
    cells += r.length;
    if (cells > MAX_CELLS) return { ok: false, error: `A matrix holds at most ${MAX_CELLS.toLocaleString('en')} numbers.` };
    const n = numbers(r);
    if (!n.ok) return n;
    out.push(n.value);
  }
  return { ok: true, value: out };
}

/** A matrix from text: rows split by new lines or semicolons, columns by commas or spaces (1, 2; 3, 4), or JSON [[1, 2], [3, 4]]. */
export function parseMatrix(text: string): Res<Mat> {
  const j = jsonOf(text);
  if (j) return fromRows(j);
  const rows = text.split(/[\n;]+/).map((r) => r.trim()).filter((r) => r !== '').map((r) => r.split(/[\s,]+/).filter((x) => x !== ''));
  return fromRows(rows);
}

/** A matrix from any signal: a list of lists, a flat list (one row), text, or a number (a 1 × 1 matrix). */
export function toMatrix(v: unknown): Res<Mat> {
  if (Array.isArray(v)) return fromRows(v);
  if (typeof v === 'string') return parseMatrix(v);
  const n = cellNumber(v);
  return Number.isFinite(n) ? { ok: true, value: [[n + 0]] } : { ok: false, error: bad(v) };
}

/** Stable Euclidean norm: scale before squaring so finite large and small values keep their magnitude. */
export function magnitude(v: Vec): number {
  let scale = 0, sum = 0;
  for (const x of v) {
    const a = Math.abs(x);
    if (!Number.isFinite(a)) return a;
    if (a > scale) {
      const ratio = scale / a;
      sum = 1 + sum * ratio * ratio;
      scale = a;
    } else if (a > 0) {
      const ratio = a / scale;
      sum += ratio * ratio;
    }
  }
  return scale * Math.sqrt(sum);
}
export const transpose = (m: Mat): Mat => (m.length === 0 ? [] : m[0].map((_, c) => m.map((r) => r[c])));
export const dims = (m: Mat): { rows: number; cols: number } => ({ rows: m.length, cols: m.length ? m[0].length : 0 });

/** The entry at an index; a negative index counts from the end (-1 is the last). */
export function indexOf(len: number, index: number): number | undefined {
  const i = Math.trunc(index);
  const at = i < 0 ? len + i : i;
  return at >= 0 && at < len ? at : undefined;
}

export const fmtVector = (v: Vec): string => `[${v.map(numText).join(', ')}]`;
export const fmtMatrix = (m: Mat): string => `[${m.map(fmtVector).join(', ')}]`;
/** Short form for a node face: 2×3 [1 2 3; 4 5 6]. */
export const chipMatrix = (m: Mat): string => {
  const { rows, cols } = dims(m);
  return `${rows}×${cols} [${m.map((r) => r.map(numText).join(' ')).join('; ')}]`;
};
