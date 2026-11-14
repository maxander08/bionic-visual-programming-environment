import type { ImageSig, PortType } from './types';
import { exactText, isDec, isZero, jsonText, packDec, parseDec, toNumber, toPlain } from './decimal';

export const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function hashStr(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export function crc32(str: string): number {
  let c: number;
  let crc = 0xffffffff;
  for (let i = 0; i < str.length; i++) {
    c = (crc ^ str.charCodeAt(i)) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? (c >>> 1) ^ 0xedb88320 : c >>> 1;
    crc = (crc >>> 8) ^ c;
  }
  return (crc ^ 0xffffffff) >>> 0;
}

export function isImage(v: unknown): v is ImageSig {
  return !!v && typeof v === 'object' && 'w' in (v as any) && 'h' in (v as any) && 'data' in (v as any);
}

export function toNum(v: unknown): number {
  if (typeof v === 'number') return v;
  if (isDec(v)) return toNumber(v);
  if (typeof v === 'boolean') return v ? 1 : 0;
  if (typeof v === 'string') {
    const t = v.trim();
    return t === '' ? NaN : Number(t);
  }
  return NaN;
}
export function toBool(v: unknown): boolean {
  if (isDec(v)) return !isZero(v);
  if (typeof v === 'string') return v !== '' && v !== 'false' && v !== '0';
  if (typeof v === 'number') return v !== 0 && !Number.isNaN(v);
  return !!v;
}

export function fmtNum(n: number, digits = 3): string {
  if (!Number.isFinite(n)) return String(n);
  const a = Math.abs(n);
  if (a !== 0 && (a >= 1e6 || a < 1e-4)) return n.toExponential(2);
  let s = n.toFixed(digits);
  if (s.includes('.')) s = s.replace(/0+$/, '').replace(/\.$/, '');
  return s === '-0' ? '0' : s;
}

/** A number as the shortest text that reads back as exactly the same number: no digit is dropped (unlike toText, which tidies for display). */
export const numText = (n: number): string => (Object.is(n, -0) ? '0' : String(n));

/** Text for passing data on: numbers keep every digit, everything else as toText. */
export const toExactText = (v: unknown): string => (typeof v === 'number' ? numText(v) : isDec(v) ? toPlain(v) : toText(v));

export function toText(v: unknown): string {
  if (v === undefined || v === null) return '';
  if (typeof v === 'string') return v;
  // A number is shown with every digit it has: nothing is rounded for display (rounding is the Number Formatter's job).
  if (typeof v === 'number') return Number.isFinite(v) ? exactText(v) : String(v);
  if (isDec(v)) return toPlain(v);
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  if (isImage(v)) return `image ${v.w}×${v.h}`;
  try {
    return jsonText(v);
  } catch {
    return String(v);
  }
}

/** Describe a value for compact readouts. */
export function describe(v: unknown): string {
  if (v === undefined) return '—';
  if (typeof v === 'string') return v === '' ? '""' : v;
  return toText(v);
}

export function typeOfValue(v: unknown): PortType {
  if (typeof v === 'number' || isDec(v)) return 'num';
  if (typeof v === 'boolean') return 'bool';
  if (typeof v === 'string') return 'text';
  if (isImage(v)) return 'image';
  return 'data';
}

/** Connection compatibility between port types. */
export function compatibility(from: PortType, to: PortType): { ok: boolean; coerce: boolean; reason?: string } {
  if (from === to) return { ok: true, coerce: false };
  if (from === 'any' || to === 'any') return { ok: true, coerce: false };
  const pair = `${from}>${to}`;
  const coerce = ['num>bool', 'bool>num', 'num>text', 'bool>text', 'data>text', 'text>data', 'num>data', 'bool>data', 'image>data'];
  if (coerce.includes(pair)) return { ok: true, coerce: true };
  return { ok: false, coerce: false, reason: `${from} signals cannot drive a ${to} input` };
}

/** Convert a value for a destination port type. Returns undefined when impossible. */
export function coerceTo(v: unknown, to: PortType): unknown {
  switch (to) {
    case 'any':
      return v;
    case 'num': {
      if (typeof v === 'number') return Number.isNaN(v) ? undefined : v;
      if (isDec(v)) return v;
      // Text keeps every digit it was written with: the number it names travels exactly, not as the nearest double.
      if (typeof v === 'string') {
        const r = parseDec(v);
        if (r.ok) return packDec(r.dec);
      }
      const n = toNum(v);
      return Number.isNaN(n) ? undefined : n;
    }
    case 'bool':
      return toBool(v);
    case 'text':
      return toExactText(v);
    case 'image':
      return isImage(v) ? v : undefined;
    case 'data':
      return v;
  }
}

export function makeImage(w: number, h: number, fn: (x: number, y: number) => [number, number, number]): ImageSig {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const [r, g, b] = fn(x, y);
      const i = (y * w + x) * 4;
      data[i] = r;
      data[i + 1] = g;
      data[i + 2] = b;
      data[i + 3] = 255;
    }
  return { w, h, data };
}

export function lumaOf(img: ImageSig): number[] {
  const out = new Array<number>(img.w * img.h);
  for (let i = 0; i < out.length; i++) {
    const p = i * 4;
    out[i] = (0.2126 * img.data[p] + 0.7152 * img.data[p + 1] + 0.0722 * img.data[p + 2]) / 255;
  }
  return out;
}

export function imageStats(img: ImageSig) {
  const l = lumaOf(img);
  const n = l.length || 1;
  let mean = 0;
  for (const v of l) mean += v;
  mean /= n;
  let varr = 0;
  for (const v of l) varr += (v - mean) ** 2;
  const contrast = Math.min(1, Math.sqrt(varr / n) * 2);
  let r = 0,
    g = 0,
    b = 0;
  for (let i = 0; i < n; i++) {
    r += img.data[i * 4];
    g += img.data[i * 4 + 1];
    b += img.data[i * 4 + 2];
  }
  r /= n;
  g /= n;
  b /= n;
  let edge = 0;
  for (let y = 0; y < img.h - 1; y++)
    for (let x = 0; x < img.w - 1; x++) {
      const i = y * img.w + x;
      edge += Math.abs(l[i] - l[i + 1]) + Math.abs(l[i] - l[i + img.w]);
    }
  edge = Math.min(1, (edge / n) * 4);
  return { mean, contrast, rgb: [r, g, b] as [number, number, number], edge };
}

export function hsvToRgb(h: number, s: number, v: number): [number, number, number] {
  h = ((h % 1) + 1) % 1;
  const i = Math.floor(h * 6);
  const f = h * 6 - i;
  const p = v * (1 - s);
  const q = v * (1 - f * s);
  const t = v * (1 - (1 - f) * s);
  const m = [
    [v, t, p],
    [q, v, p],
    [p, v, t],
    [p, q, v],
    [t, p, v],
    [v, p, q],
  ][i % 6];
  return [Math.round(m[0] * 255), Math.round(m[1] * 255), Math.round(m[2] * 255)];
}

export const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
export function noteName(freq: number): { name: string; cents: number } | null {
  if (!(freq > 20 && freq < 20000)) return null;
  const midi = 69 + 12 * Math.log2(freq / 440);
  const r = Math.round(midi);
  return { name: `${NOTE_NAMES[((r % 12) + 12) % 12]}${Math.floor(r / 12) - 1}`, cents: (midi - r) * 100 };
}

export function uid(prefix = 'n'): string {
  return `${prefix}${Math.random().toString(36).slice(2, 8)}`;
}
