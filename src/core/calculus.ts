// The Calculus Engine's mathematics: derivatives (exact, symbolic), integrals (closed form where one is known, adaptive
// Gauss–Kronrod otherwise, improper bounds included), limits (two-sided, one-sided, at infinity), series (sums with
// convergence tests, Taylor and Fourier) and curve analysis (intercepts, extrema, inflections, asymptotes, intervals).
// Pure logic, no browser objects: `analyze` takes the module's settings and returns everything the module emits.
import {
  N, RESERVED, V, bin, neg, bind, compile, derivative, dep, diff, fmtConst, integrate, parseExpr, show, simplify, size, stripName,
  type Ast, type Env,
} from './calcexpr';
import { tr } from '../i18n';

export type Fn = (x: number) => number;
export type CalcMode = 'derivative' | 'integral' | 'limit' | 'series' | 'curve';
export const CALC_MODES: CalcMode[] = ['derivative', 'integral', 'limit', 'series', 'curve'];

// ---- numeric tools ---------------------------------------------------------------------------------------------------------

/** First derivative by Ridders' extrapolation of central differences. */
export function ridders(f: Fn, x: number, h0 = 0.1 * Math.max(1, Math.abs(x))): number {
  const NT = 10, CON = 1.4, CON2 = CON * CON, SAFE = 2;
  const a: number[][] = Array.from({ length: NT }, () => new Array<number>(NT).fill(0));
  let h = h0, best = NaN, err = Infinity;
  a[0][0] = (f(x + h) - f(x - h)) / (2 * h);
  if (!Number.isFinite(a[0][0])) return NaN;
  best = a[0][0];
  for (let i = 1; i < NT; i++) {
    h /= CON;
    a[0][i] = (f(x + h) - f(x - h)) / (2 * h);
    let fac = CON2;
    for (let j = 1; j <= i; j++) {
      a[j][i] = (a[j - 1][i] * fac - a[j - 1][i - 1]) / (fac - 1);
      fac *= CON2;
      const e = Math.max(Math.abs(a[j][i] - a[j - 1][i]), Math.abs(a[j][i] - a[j - 1][i - 1]));
      if (e <= err) { err = e; best = a[j][i]; }
    }
    if (Math.abs(a[i][i] - a[i - 1][i - 1]) >= SAFE * err) break;
  }
  return best;
}
/** n-th derivative by nesting Ridders' method. Reliable to about the fourth order. */
export function numDeriv(f: Fn, x: number, order: number): number {
  if (order <= 1) return ridders(f, x);
  return ridders((u) => numDeriv(f, u, order - 1), x, 0.05 * Math.max(1, Math.abs(x)));
}

const XGK = [0.991455371120812639206854697526329, 0.949107912342758524526189684047851, 0.864864423359769072789712788640926, 0.741531185599394439863864773280788, 0.58608723546769113029414483825873, 0.405845151377397166906606412076961, 0.207784955007898467600689403773245, 0];
const WGK = [0.02293532201052922496373200805897, 0.063092092629978553290700663189204, 0.104790010322250183839876322541518, 0.140653259715525918745189590510238, 0.169004726639267902826583426598550, 0.190350578064785409913256402421014, 0.204432940075298892414161999234649, 0.209482141084727828012999174891714];
const WG = [0.129484966168869693270611432679082, 0.27970539148927666790146777142378, 0.381830050505118944950369775488975, 0.417959183673469387755102040816327];

function gk15(f: Fn, a: number, b: number): { i: number; err: number } {
  const c = (a + b) / 2, h = (b - a) / 2, fc = f(c);
  let k = fc * WGK[7], g = fc * WG[3];
  for (let j = 0; j < 7; j++) {
    const dx = h * XGK[j], s = f(c - dx) + f(c + dx);
    k += WGK[j] * s;
    if (j % 2 === 1) g += WG[(j - 1) / 2] * s;
  }
  return { i: k * h, err: Math.abs((k - g) * h) };
}

export interface Quad { value: number; ok: boolean }

/** Adaptive Gauss–Kronrod over a finite interval: the worst piece is split until the estimated error is small. */
function adaptive(f: Fn, a: number, b: number, tol = 1e-11): Quad {
  if (a === b) return { value: 0, ok: true };
  const parts = 8;
  let segs = Array.from({ length: parts }, (_, i) => {
    const lo = a + ((b - a) * i) / parts, hi = a + ((b - a) * (i + 1)) / parts;
    return { lo, hi, ...gk15(f, lo, hi) };
  });
  for (let it = 0; it < 600; it++) {
    const total = segs.reduce((s, q) => s + q.i, 0), err = segs.reduce((s, q) => s + q.err, 0);
    if (!Number.isFinite(total) || !Number.isFinite(err)) return { value: NaN, ok: false };
    if (err <= tol * Math.max(1, Math.abs(total))) return { value: total, ok: true };
    let w = 0;
    for (let i = 1; i < segs.length; i++) if (segs[i].err > segs[w].err) w = i;
    const s = segs[w], mid = (s.lo + s.hi) / 2;
    if (mid === s.lo || mid === s.hi) break;
    segs = [...segs.slice(0, w), { lo: s.lo, hi: mid, ...gk15(f, s.lo, mid) }, { lo: mid, hi: s.hi, ...gk15(f, mid, s.hi) }, ...segs.slice(w + 1)];
  }
  const total = segs.reduce((s, q) => s + q.i, 0), err = segs.reduce((s, q) => s + q.err, 0);
  return { value: total, ok: Number.isFinite(total) && err <= 1e-6 * Math.max(1, Math.abs(total)) };
}

export type QuadMethod = 'adaptive' | 'simpson' | 'trapezoid' | 'midpoint';

/** ∫ f from lo to hi. Bounds may be ±Infinity (improper integrals use a change of variable, so they always use the adaptive rule). */
export function integral(f: Fn, lo: number, hi: number, method: QuadMethod = 'adaptive', n = 100): Quad {
  if (Number.isNaN(lo) || Number.isNaN(hi)) return { value: NaN, ok: false };
  if (lo === hi) return { value: 0, ok: true };
  if (lo > hi) { const r = integral(f, hi, lo, method, n); return { value: -r.value, ok: r.ok }; }
  if (lo === -Infinity && hi === Infinity) return adaptive(((t: number) => { const x = t / (1 - t * t), d = (1 + t * t) / ((1 - t * t) * (1 - t * t)); const v = f(x) * d; return Number.isNaN(v) && Math.abs(x) > 1e100 ? 0 : v; }), -1, 1);
  if (hi === Infinity) return adaptive((t) => { const x = lo + t / (1 - t), v = f(x) / ((1 - t) * (1 - t)); return Number.isNaN(v) && x > 1e100 ? 0 : v; }, 0, 1);
  if (lo === -Infinity) return adaptive((t) => { const x = hi - t / (1 - t), v = f(x) / ((1 - t) * (1 - t)); return Number.isNaN(v) && x < -1e100 ? 0 : v; }, 0, 1);
  const m = Math.max(2, Math.round(n));
  switch (method) {
    case 'trapezoid': { const h = (hi - lo) / m; let s = (f(lo) + f(hi)) / 2; for (let i = 1; i < m; i++) s += f(lo + i * h); return { value: s * h, ok: Number.isFinite(s) }; }
    case 'midpoint': { const h = (hi - lo) / m; let s = 0; for (let i = 0; i < m; i++) s += f(lo + (i + 0.5) * h); return { value: s * h, ok: Number.isFinite(s) }; }
    case 'simpson': {
      const k = m % 2 === 0 ? m : m + 1, h = (hi - lo) / k;
      let s = f(lo) + f(hi);
      for (let i = 1; i < k; i++) s += f(lo + i * h) * (i % 2 === 1 ? 4 : 2);
      return { value: (s * h) / 3, ok: Number.isFinite(s) };
    }
    default: return adaptive(f, lo, hi);
  }
}

// ---- limits ----------------------------------------------------------------------------------------------------------------

export type Limit = { k: 'value'; v: number } | { k: 'inf'; s: 1 | -1 } | { k: 'dne' };

const snap = (v: number) => { const r = Math.round(v); return Math.abs(v - r) < 1e-9 * Math.max(1, Math.abs(v)) ? r : Number(v.toPrecision(12)); };

/** Does a sequence sampled at ever more extreme points run off to ±∞ (rather than settle)? */
function runsAway(v: number[]): 1 | -1 | 0 {
  if (v.some((z) => !Number.isFinite(z))) return 0;
  const m = v.length - 1, a = v.map(Math.abs), sgn = Math.sign(v[m]);
  if (sgn === 0 || !v.every((z) => Math.sign(z) === sgn)) return 0;
  if (!a.every((z, i) => i === 0 || z >= a[i - 1])) return 0;
  const first = a[1] - a[0], last = a[m] - a[m - 1];
  if (a[m] > 1e6 || (last >= 0.9 * first && a[m] - a[0] > 5)) return sgn as 1 | -1;
  return 0;
}

function neville(hs: number[], ys: number[]): number {
  const p = ys.slice();
  for (let m = 1; m < hs.length; m++) for (let i = 0; i < hs.length - m; i++) p[i] = (hs[i + m] * p[i] - hs[i] * p[i + 1]) / (hs[i + m] - hs[i]);
  return p[0];
}

function limitSide(f: Fn, a: number, dir: 1 | -1): Limit {
  const g = (h: number) => f(a + dir * h);
  const probe = [1e-2, 1e-4, 1e-6, 1e-8, 1e-10].map(g);
  const away = runsAway(probe);
  if (away) return { k: 'inf', s: away };
  const hs = Array.from({ length: 8 }, (_, k) => 0.05 / 2 ** k), ys = hs.map(g);
  if (ys.some((y) => !Number.isFinite(y))) return { k: 'dne' };
  const L = neville(hs, ys);
  const near = g(1e-4);
  const tol = 1e-4 * Math.max(1, Math.abs(L));
  if (Number.isFinite(L) && Math.abs(L - near) <= tol) return { k: 'value', v: snap(L) };
  const d1 = g(1e-3), d2 = near, d3 = g(1e-5);
  if (Math.abs(d3 - d2) < 1e-3 * Math.max(1, Math.abs(d3)) && Math.abs(d3 - d2) < Math.abs(d2 - d1)) return { k: 'value', v: snap((10 * d3 - d2) / 9) };
  return { k: 'dne' };
}

function limitInf(f: Fn, s: 1 | -1, reach = [1e3, 1e4, 1e5, 1e6, 1e7, 1e8]): Limit {
  const xs = reach.map((x) => x * s), v = xs.map(f);
  const away = runsAway(v);
  if (away) return { k: 'inf', s: away };
  if (v.some((z) => !Number.isFinite(z))) return { k: 'dne' };
  const d = v.slice(1).map((z, i) => z - v[i]);
  const last = d[d.length - 1], prev = d[d.length - 2];
  const scale = Math.max(1, Math.abs(v[v.length - 1]));
  if (Math.abs(last) <= 1e-9 * scale) return { k: 'value', v: snap(v[v.length - 1]) };
  const r = prev === 0 ? 0 : last / prev;
  if (r >= 0 && r < 0.8 && Math.abs(last) < 1e-2 * scale) return { k: 'value', v: snap(v[v.length - 1] + (last * r) / (1 - r)) };
  return { k: 'dne' };
}

/** The limit of f at `to` (a number or ±Infinity). dir is the side to approach from at a finite point; 0 means both. */
export function limitAt(f: Fn, to: number, dir: -1 | 0 | 1): { both: Limit; left?: Limit; right?: Limit } {
  if (to === Infinity) { const l = limitInf(f, 1); return { both: l }; }
  if (to === -Infinity) { const l = limitInf(f, -1); return { both: l }; }
  const left = limitSide(f, to, -1), right = limitSide(f, to, 1);
  const eq = (a: Limit, b: Limit) => a.k === b.k && (a.k === 'inf' ? a.s === (b as { s: number }).s : a.k === 'value' ? Math.abs(a.v - (b as { v: number }).v) <= 1e-6 * Math.max(1, Math.abs(a.v)) : false);
  const both: Limit = dir === -1 ? left : dir === 1 ? right : eq(left, right) ? left : { k: 'dne' };
  return { both, left, right };
}

// ---- series ----------------------------------------------------------------------------------------------------------------

export interface SumResult {
  value: number;
  partial: number;
  verdict: 'converges' | 'diverges' | 'unknown' | 'partial' | 'undefined';
  /** English key of the test that decided it. */
  test: string;
  ratio?: number;
}

export function sumSeries(term: Fn, n0: number, count: number, infinite: boolean): SumResult {
  const N_ = Math.max(2, Math.round(count));
  const a: number[] = [], S: number[] = [];
  let s = 0, c = 0;
  for (let i = 0; i < N_; i++) {
    const t = term(n0 + i);
    if (!Number.isFinite(t)) return { value: NaN, partial: NaN, verdict: 'undefined', test: 'The terms are not defined for every n.' };
    const y = t - c, u = s + y;
    c = u - s - y;
    s = u;
    a.push(t);
    S.push(s);
  }
  const partial = S[N_ - 1];
  if (!infinite) return { value: partial, partial, verdict: 'partial', test: 'Finite sum of the first terms.' };
  const last = Math.abs(a[N_ - 1]), half = Math.abs(a[Math.floor(N_ / 2)]);
  if (a.slice(-8).every((t) => Math.abs(t) < 1e-300)) return { value: partial, partial, verdict: 'converges', test: 'The terms become exactly zero.' };
  if (last > 1e-3 && last >= 0.9 * half) return { value: partial, partial, verdict: 'diverges', test: 'Divergence test: the terms do not approach 0.' };
  const rs: number[] = [];
  for (let i = N_ - 6; i < N_ - 1; i++) if (a[i] !== 0 && i >= 0) rs.push(Math.abs(a[i + 1] / a[i]));
  rs.sort((p, q) => p - q);
  const ratio = rs.length ? rs[Math.floor(rs.length / 2)] : NaN;
  const tail = a.slice(-6);
  const alternating = tail.every((t, i) => i === 0 || (Math.sign(t) !== 0 && Math.sign(t) === -Math.sign(tail[i - 1]))) && tail.every((t, i) => i === 0 || Math.abs(t) <= Math.abs(tail[i - 1]) * 1.0000001);
  const aitken = (): number => {
    const [p, q, r] = [S[N_ - 3], S[N_ - 2], S[N_ - 1]];
    const den = r - 2 * q + p;
    return den === 0 ? r : r - ((r - q) * (r - q)) / den;
  };
  if (Number.isFinite(ratio) && ratio < 0.97) return { value: aitken(), partial, verdict: 'converges', test: 'Ratio test: the ratio of consecutive terms stays below 1.', ratio };
  if (Number.isFinite(ratio) && ratio > 1.03) return { value: partial, partial, verdict: 'diverges', test: 'Ratio test: the ratio of consecutive terms stays above 1.', ratio };
  if (alternating) {
    let w = S.slice(-6);
    while (w.length > 1) w = w.slice(1).map((v, i) => (v + w[i]) / 2);
    return { value: w[0], partial, verdict: 'converges', test: 'Alternating series test: the terms alternate in sign and shrink to 0.', ratio };
  }
  const q = N_ >= 8 ? (S[N_ - 1] - S[Math.floor(N_ / 2) - 1]) / (S[Math.floor(N_ / 2) - 1] - S[Math.floor(N_ / 4) - 1]) : NaN;
  if (Number.isFinite(q) && q > 0.85) return { value: partial, partial, verdict: 'diverges', test: 'The partial sums keep growing as fast as a harmonic series.', ratio };
  if (Number.isFinite(q) && q < 0.75 && a.slice(-8).every((t) => t > 0)) {
    const tailInt = integral((x) => term(x), n0 + N_ - 0.5, Infinity);
    return { value: tailInt.ok ? partial + tailInt.value : aitken(), partial, verdict: 'converges', test: 'Comparison with a p-series (integral test): the tail shrinks like a power of n.', ratio };
  }
  if (Number.isFinite(q) && q < 0.75) return { value: aitken(), partial, verdict: 'converges', test: 'The increments of the partial sums shrink steadily.', ratio };
  return { value: partial, partial, verdict: 'unknown', test: 'No test settled it: the partial sum is shown.', ratio };
}

/** The simplest fraction p/q (q ≤ 10⁵) equal to v within 1e-11, or null. */
function fraction(v: number): [number, number] | null {
  if (!Number.isFinite(v)) return null;
  if (Number.isInteger(v)) return [v, 1];
  const sgn = Math.sign(v);
  let x = Math.abs(v), h1 = 1, h0 = 0, k1 = 0, k0 = 1;
  for (let i = 0; i < 24; i++) {
    const a = Math.floor(x), h2 = a * h1 + h0, k2 = a * k1 + k0;
    h0 = h1; h1 = h2; k0 = k1; k1 = k2;
    if (k1 > 1e5) return null;
    if (Math.abs(Math.abs(v) - h1 / k1) < 1e-11 * Math.max(1, Math.abs(v))) return [sgn * h1, k1];
    const fr = x - a;
    if (fr < 1e-12) return null;
    x = 1 / fr;
  }
  return null;
}
const coefAst = (v: number): Ast => { const f = fraction(v); return f && f[1] !== 1 ? bin('/', N(f[0]), N(f[1])) : N(v); };
const coefText = (v: number): string => show(coefAst(v));

// ---- curve analysis --------------------------------------------------------------------------------------------------------

const fmtN = (v: number): string => (Number.isNaN(v) ? 'undefined' : v === Infinity ? '∞' : v === -Infinity ? '-∞' : String(Number(v.toPrecision(7))));

function bisect(f: Fn, lo: number, hi: number, flo: number): number {
  for (let i = 0; i < 80; i++) {
    const mid = (lo + hi) / 2, fm = f(mid);
    if (!Number.isFinite(fm)) return mid;
    if (Math.sign(fm) === Math.sign(flo) && fm !== 0) { lo = mid; flo = fm; } else hi = mid;
    if (hi - lo < 1e-13 * Math.max(1, Math.abs(lo))) break;
  }
  return (lo + hi) / 2;
}
const dedupe = (xs: number[], tol: number) => xs.sort((p, q) => p - q).filter((x, i, a) => i === 0 || x - a[i - 1] > tol);
const list = (xs: number[]) => (xs.length ? xs.map(fmtN).join(', ') : '—');
const pts = (xs: number[], f: Fn) => (xs.length ? xs.map((x) => `(${fmtN(x)}, ${fmtN(f(x))})`).join(', ') : '—');
/** Intervals of [lo, hi] between the cut points on which sign(x) is `want` and the function is defined. Neighbours join unless a break lies between them. */
const spans = (cuts: number[], lo: number, hi: number, sign: Fn, want: 1 | -1, f: Fn, breaks: number[]) => {
  const edges = [lo, ...cuts.filter((c) => c > lo && c < hi), hi], out: [number, number][] = [];
  for (let i = 0; i < edges.length - 1; i++) {
    const m = (edges[i] + edges[i + 1]) / 2;
    if (Math.sign(sign(m)) !== want || !Number.isFinite(f(m))) continue;
    const prev = out[out.length - 1];
    if (prev && prev[1] === edges[i] && !breaks.includes(edges[i])) prev[1] = edges[i + 1];
    else out.push([edges[i], edges[i + 1]]);
  }
  return out.length ? out.map(([p, q]) => `[${fmtN(p)}, ${fmtN(q)}]`).join(' ∪ ') : '—';
};

// ---- the engine ------------------------------------------------------------------------------------------------------------

export interface CalcParam { name: string; value: number }
export interface CalcSpec {
  mode: CalcMode;
  exprs: string[];
  params: CalcParam[];
  /** 'both' draws the function and its result, 'result' only the result, 'function' only the function. */
  show: 'both' | 'result' | 'function';
  xMin: number;
  xMax: number;
  samples: number;
  /** Simulation time in seconds, for expressions that use t. */
  t: number;
  /** 1-based number of the expression whose result goes to the Value output. */
  target: number;
  at: number;
  order: number;
  wrt: string;
  tangent: boolean;
  lower: string;
  upper: string;
  method: QuadMethod;
  intervals: number;
  to: string;
  side: 'both' | 'left' | 'right';
  kind: 'sum' | 'taylor' | 'fourier';
  start: number;
  terms: number;
  infinite: boolean;
  center: number;
  degree: number;
  halfPeriod: number;
  harmonics: number;
}

/** One line of the analysis. `k` and (when `t`) `v` are English interface text; `h` is a heading made of the user's own expression. */
export interface Row { h?: string; k?: string; v?: string; t?: boolean }

export interface CalcResult {
  error?: string;
  /** Expressions to plot: the functions and their results, in order. */
  curves: string[];
  /** The result for each expression, null where there is none (for example a limit that does not exist). */
  values: (number | null)[];
  value: number | null;
  /** The result written as an expression, one per expression (derivative, antiderivative, polynomial…). Empty text where there is none. */
  exprs: string[];
  rows: Row[];
  usesT: boolean;
  /** A few characters for the node's title row. */
  short: string;
}

export const SUP = (n: number) => String(n).replace(/\d/g, (d) => '⁰¹²³⁴⁵⁶⁷⁸⁹'[Number(d)]);
export const SUB = (n: number) => String(n).replace(/\d/g, (d) => '₀₁₂₃₄₅₆₇₈₉'[Number(d)]);
const clampInt = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, Math.round(Number.isFinite(v) ? v : lo)));

/** A continuous piecewise-linear function through (xs[i], ys[i]), written with clamp() so a Meter can draw it. */
export function piecewiseExpr(xs: number[], ys: number[]): string {
  let s = fmtConst(ys[0]);
  for (let i = 0; i < xs.length - 1; i++) {
    const slope = (ys[i + 1] - ys[i]) / (xs[i + 1] - xs[i]);
    if (!Number.isFinite(slope) || slope === 0) continue;
    const arg = xs[i] < 0 ? `x + ${fmtConst(-xs[i])}` : xs[i] === 0 ? 'x' : `x - ${fmtConst(xs[i])}`;
    s += `${slope < 0 ? ' - ' : ' + '}${fmtConst(Math.abs(slope))}*clamp(${arg}, 0, ${fmtConst(xs[i + 1] - xs[i])})`;
  }
  return s;
}

const KNOTS = 160;
/** Round a computed coefficient to 7 significant digits and drop numerical dust. */
const tidy = (v: number) => (Math.abs(v) < 1e-9 ? 0 : Number(v.toPrecision(7)));

export function analyze(spec: CalcSpec): CalcResult {
  try { return run(spec); } catch (err) {
    return { error: err instanceof Error ? err.message : String(err), curves: [], values: [], value: null, exprs: [], rows: [], usesT: false, short: '' };
  }
}

interface Item { i: number; src: string; ast: Ast; bound: Ast; f: Fn }

function run(spec: CalcSpec): CalcResult {
  const consts: Record<string, number> = {};
  const names = new Set<string>(['x', 't']);
  for (const p of spec.params) {
    const name = p.name.trim();
    if (!name) throw new Error('A parameter has no name.');
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name) || RESERVED.has(name.toLowerCase())) throw new Error(`The parameter name “${name}” cannot be used: write letters, digits and _, starting with a letter, and not a name that already means something (x, t, pi, sin…).`);
    if (name in consts) throw new Error(`Two parameters are called “${name}”.`);
    consts[name] = p.value;
    names.add(name);
  }
  const wrt = spec.wrt.trim() || 'x';
  if (spec.mode === 'derivative' && !names.has(wrt)) throw new Error(`“${wrt}” is not a variable of the expression: differentiate with respect to x, t or the name of a parameter.`);
  const sumMode = spec.mode === 'series' && spec.kind === 'sum';
  const scope = new Set(names);
  const bindConsts = { ...consts };
  if (sumMode) { scope.add('n'); delete bindConsts.n; }
  const env: Env = { x: 0, t: spec.t };
  const mk = (ast: Ast): Fn => { const c = compile(ast); return (x) => { env.x = x; env.n = x; return c(env); }; };

  const items: Item[] = [];
  spec.exprs.forEach((src, i) => {
    if (stripName(src) === '') return;
    let ast: Ast;
    try { ast = parseExpr(src, scope); } catch (e) { throw new Error(`“${src.trim()}”: ${tr(e instanceof Error ? e.message : String(e))}`); }
    const bound = simplify(bind(ast, bindConsts));
    items.push({ i, src, ast, bound, f: mk(bound) });
  });
  if (!items.length) throw new Error('Enter an expression, or connect an Equation.');
  const usesT = items.some((it) => dep(it.ast, 't'));

  const xMin = spec.xMin, xMax = spec.xMax;
  if (!(xMax > xMin)) throw new Error('x max must be greater than x min.');
  const evalText = (text: string): number => {
    const s = text.trim().toLowerCase().replace(/\s+/g, '');
    if (/^\+?(inf|infinity|∞)$/.test(s)) return Infinity;
    if (/^(-|−)(inf|infinity|∞)$/.test(s)) return -Infinity;
    let v = NaN;
    try { v = compile(simplify(bind(parseExpr(text, new Set(names)), bindConsts)))({ ...env, t: spec.t }); } catch (e) { throw new Error(`The value “${text.trim()}” cannot be used as a bound or limit point: ${tr(e instanceof Error ? e.message : String(e))}`); }
    if (Number.isNaN(v)) throw new Error(`The value “${text.trim()}” is not a number.`);
    return v;
  };
  const name = (it: Item) => `ƒ${SUB(it.i + 1)}`;
  const shown = (it: Item) => show(it.bound);

  const curves: string[] = [];
  const values: (number | null)[] = [];
  const exprs: string[] = [];
  const rows: Row[] = [];
  const addFn = (it: Item, ...res: string[]) => {
    if (spec.show !== 'result') curves.push(shown(it));
    if (spec.show !== 'function') curves.push(...res.filter(Boolean));
  };
  const heading = (it: Item) => rows.push({ h: `${name(it)}(x) = ${shown(it)}` });
  const fin = (v: number): number | null => (Number.isFinite(v) ? v : null);
  let symbol = 'ƒ';

  switch (spec.mode) {
    // ---- derivative ----
    case 'derivative': {
      const order = clampInt(spec.order, 1, 10);
      symbol = `ƒ${order === 1 ? '′' : order === 2 ? '″' : order === 3 ? '‴' : `⁽${SUP(order)}⁾`}`;
      for (const it of items) {
        heading(it);
        let text = '', dFn: Fn, d1Fn: Fn, symbolic = true;
        try {
          const d = simplify(bind(derivative(it.ast, wrt, order), bindConsts));
          text = show(d);
          dFn = mk(d);
          d1Fn = order === 1 ? dFn : mk(simplify(bind(derivative(it.ast, wrt, 1), bindConsts)));
        } catch (e) {
          if (wrt !== 'x') throw e;
          if (order > 4) throw new Error('This expression has no closed-form derivative, and a numerical one is only reliable up to the fourth order.');
          symbolic = false;
          dFn = (x) => numDeriv(it.f, x, order);
          d1Fn = (x) => numDeriv(it.f, x, 1);
        }
        const v = dFn(spec.at);
        let curve = text;
        if (!symbolic) {
          const xs = Array.from({ length: KNOTS + 1 }, (_, k) => xMin + ((xMax - xMin) * k) / KNOTS);
          let prev = 0;
          const ys = xs.map((x) => { const y = dFn(x); if (Number.isFinite(y)) prev = y; return prev; });
          curve = piecewiseExpr(xs, ys);
        }
        const extra: string[] = [];
        if (spec.tangent) {
          const y0 = it.f(spec.at), m = d1Fn(spec.at);
          if (Number.isFinite(y0) && Number.isFinite(m)) {
            const line = simplify(bin('+', N(y0), bin('*', N(m), bin('-', V('x'), N(spec.at)))));
            extra.push(show(line));
            rows.push({ k: 'Tangent line', v: `y = ${show(line)}` });
          }
        }
        rows.push({ k: order === 1 ? 'Derivative' : 'Derivative of higher order', v: symbolic ? text : '(numerical)', t: !symbolic });
        if (order > 1) rows.push({ k: 'Order', v: String(order) });
        rows.push({ k: 'Value at the point', v: `x = ${fmtN(spec.at)}: ${fmtN(v)}` });
        rows.push({ k: 'Method', v: symbolic ? 'Exact, symbolic' : 'Numerical (no closed form)', t: true });
        addFn(it, curve, ...extra);
        values.push(fin(v));
        exprs.push(symbolic ? text : '');
      }
      break;
    }
    // ---- integral ----
    case 'integral': {
      symbol = '∫';
      const lo = evalText(spec.lower), hi = evalText(spec.upper);
      for (const it of items) {
        heading(it);
        const sym = integrate(it.bound, 'x');
        let curve = '', text = '';
        if (sym) {
          let G = simplify(sym);
          if (Number.isFinite(lo)) {
            const c = mk(G)(lo);
            if (Number.isFinite(c)) G = simplify(bin('-', G, N(c)));
          }
          text = show(G);
          curve = text;
        } else {
          const xs = Array.from({ length: KNOTS + 1 }, (_, k) => xMin + ((xMax - xMin) * k) / KNOTS);
          let acc = integral(it.f, lo, xs[0], 'adaptive').value;
          if (!Number.isFinite(acc)) acc = 0;
          const ys = [acc];
          for (let k = 1; k < xs.length; k++) { const q = gk15(it.f, xs[k - 1], xs[k]).i; acc += Number.isFinite(q) ? q : 0; ys.push(acc); }
          curve = piecewiseExpr(xs, ys);
        }
        const q = integral(it.f, lo, hi, spec.method, spec.intervals);
        const area = integral((x) => Math.abs(it.f(x)), lo, hi, spec.method, spec.intervals);
        rows.push({ k: 'Antiderivative', v: sym ? `${text} + C` : '(no closed form: computed numerically)', t: !sym });
        if (q.ok) {
          rows.push({ k: 'Definite integral', v: fmtN(q.value) });
          if (area.ok) rows.push({ k: 'Area between the curve and the x-axis', v: fmtN(area.value) });
          if (Number.isFinite(lo) && Number.isFinite(hi) && hi !== lo) rows.push({ k: 'Mean value', v: fmtN(q.value / (hi - lo)) });
          if (!Number.isFinite(lo) || !Number.isFinite(hi)) rows.push({ k: 'Improper integral', v: 'Converges', t: true });
        } else rows.push({ k: 'Definite integral', v: Number.isFinite(lo) && Number.isFinite(hi) ? 'Undefined or too irregular to evaluate' : 'Diverges', t: true });
        rows.push({ k: 'Bounds', v: `${fmtN(lo)} … ${fmtN(hi)}` });
        rows.push({ k: 'Method', v: !Number.isFinite(lo) || !Number.isFinite(hi) ? 'Adaptive Gauss–Kronrod' : ({ adaptive: 'Adaptive Gauss–Kronrod', simpson: 'Simpson’s rule', trapezoid: 'Trapezoid rule', midpoint: 'Midpoint rule' } as Record<string, string>)[spec.method], t: true });
        addFn(it, curve);
        values.push(q.ok ? fin(q.value) : null);
        exprs.push(text);
      }
      break;
    }
    // ---- limit ----
    case 'limit': {
      symbol = 'ƒ→';
      const to = evalText(spec.to);
      const dir = spec.side === 'left' ? -1 : spec.side === 'right' ? 1 : 0;
      const word = (l: Limit) => (l.k === 'value' ? fmtN(l.v) : l.k === 'inf' ? (l.s > 0 ? '∞' : '-∞') : 'Does not exist');
      for (const it of items) {
        heading(it);
        const r = limitAt(it.f, to, dir);
        const L = r.both;
        rows.push({ k: 'Approaching', v: `x → ${fmtN(to)}${Number.isFinite(to) && dir !== 0 ? (dir < 0 ? '⁻' : '⁺') : ''}` });
        rows.push({ k: 'Limit value', v: L.k === 'dne' ? 'Does not exist' : word(L), t: L.k === 'dne' });
        if (Number.isFinite(to) && dir === 0 && L.k === 'dne' && r.left && r.right) {
          rows.push({ k: 'From the left', v: word(r.left), t: r.left.k === 'dne' });
          rows.push({ k: 'From the right', v: word(r.right!), t: r.right!.k === 'dne' });
        }
        const v = L.k === 'value' ? L.v : null;
        if (L.k === 'value' && Number.isFinite(to)) {
          const at = it.f(to);
          rows.push({ k: 'Continuous there', v: Number.isFinite(at) && Math.abs(at - L.v) <= 1e-9 * Math.max(1, Math.abs(L.v)) ? 'Yes' : 'No', t: true });
        }
        addFn(it, v !== null ? fmtConst(v) : '');
        values.push(v);
        exprs.push(v !== null ? fmtConst(v) : L.k === 'inf' ? (L.s > 0 ? 'inf' : '-inf') : '');
      }
      break;
    }
    // ---- series ----
    case 'series': {
      symbol = 'Σ';
      for (const it of items) {
        heading(it);
        if (spec.kind === 'sum') {
          const n0 = Math.round(spec.start), cnt = clampInt(spec.terms, 2, 20000);
          const r = sumSeries(it.f, n0, cnt, spec.infinite);
          rows.push({ k: 'Series', v: `Σ ${shown(it)}, n = ${n0} … ${spec.infinite ? '∞' : n0 + cnt - 1}` });
          if (r.verdict === 'undefined') throw new Error(`The terms of ${name(it)} are not defined for every n.`);
          rows.push({ k: 'Convergence', v: r.verdict === 'converges' ? 'Converges' : r.verdict === 'diverges' ? 'Diverges' : r.verdict === 'partial' ? 'Finite sum' : 'Undecided', t: true });
          rows.push({ k: 'Test used', v: r.test, t: true });
          if (r.verdict === 'converges' || r.verdict === 'partial') rows.push({ k: 'Sum', v: fmtN(r.value) });
          if (spec.infinite) rows.push({ k: 'Partial sum of the terms shown', v: `S${SUB(cnt)} = ${fmtN(r.partial)}` });
          addFn(it);
          const v = r.verdict === 'diverges' ? null : fin(r.value);
          values.push(v);
          exprs.push('');
        } else if (spec.kind === 'taylor') {
          const a = spec.center, deg = clampInt(spec.degree, 0, 16);
          const coefs: number[] = [];
          let d: Ast = it.ast, fact = 1, note = '';
          for (let k = 0; k <= deg; k++) {
            if (k > 0) {
              try { d = simplify(diff(d, 'x')); } catch (e) { throw new Error(tr(e instanceof Error ? e.message : String(e))); }
              fact *= k;
              if (size(d) > 20000) { note = String(k - 1); break; }
            }
            const c = mk(simplify(bind(d, bindConsts)))(a) / fact;
            if (!Number.isFinite(c)) { if (k === 0) throw new Error(`${name(it)} is not defined at x = ${fmtN(a)}.`); note = String(k - 1); break; }
            coefs.push(Math.abs(c) < 1e-14 ? 0 : c);
          }
          const shift: Ast = a === 0 ? V('x') : bin('-', V('x'), N(a));
          let poly: Ast | null = null;
          coefs.forEach((c, k) => {
            if (c === 0) return;
            const mag = coefAst(Math.abs(c));
            const pw: Ast | null = k === 0 ? null : k === 1 ? shift : bin('^', shift, N(k));
            let term: Ast;
            if (!pw) term = mag;
            else if (mag.k === 'num') term = mag.v === 1 ? pw : bin('*', mag, pw);
            else { const m = mag as { k: 'bin'; a: Ast; b: Ast }; term = bin('/', (m.a as { v: number }).v === 1 ? pw : bin('*', m.a, pw), m.b); }
            poly = poly ? bin(c < 0 ? '-' : '+', poly, term) : c < 0 ? neg(term) : term;
          });
          const polyAst: Ast = poly ?? N(0);
          const text = show(polyAst);
          const nz = coefs.map((c, k) => [c, k] as const).filter(([c]) => c !== 0);
          rows.push({ k: 'Taylor polynomial', v: text });
          rows.push({ k: 'Centre', v: `x = ${fmtN(a)}` });
          rows.push({ k: 'Degree', v: String(coefs.length - 1) });
          rows.push({ k: 'Coefficients', v: coefs.map(coefText).join(', ') });
          if (nz.length >= 2) {
            const [c2, k2] = nz[nz.length - 1], [c1, k1] = nz[nz.length - 2];
            const rr = Math.pow(Math.abs(c1 / c2), 1 / (k2 - k1));
            if (Number.isFinite(rr) && rr > 0) rows.push({ k: 'Radius of convergence (estimate)', v: fmtN(rr) });
          }
          if (note) rows.push({ k: 'Highest degree reached', v: note });
          const v = mk(polyAst)(spec.at);
          rows.push({ k: 'Polynomial at the point', v: `x = ${fmtN(spec.at)}: ${fmtN(v)}` });
          addFn(it, text);
          values.push(fin(v));
          exprs.push(text);
        } else {
          const L = Math.max(1e-6, Math.abs(spec.halfPeriod)), H = clampInt(spec.harmonics, 1, 60), M = 8192;
          const ys = new Array<number>(M);
          for (let j = 0; j < M; j++) { ys[j] = it.f(-L + ((j + 0.5) * 2 * L) / M); if (!Number.isFinite(ys[j])) ys[j] = 0; }
          const coef = (fn: (j: number) => number) => { let s = 0; for (let j = 0; j < M; j++) s += ys[j] * fn(j); return (s * 2) / M; };
          const a0 = coef(() => 1);
          let poly: Ast | null = null;
          const add = (c: number, term: Ast | null) => {
            if (c === 0) return;
            const t: Ast = term ? (Math.abs(c) === 1 ? term : bin('*', N(Math.abs(c)), term)) : N(Math.abs(c));
            poly = poly ? bin(c < 0 ? '-' : '+', poly, t) : c < 0 ? neg(t) : t;
          };
          add(tidy(a0 / 2), null);
          const parts: string[] = [`a₀ = ${fmtN(tidy(a0))}`];
          for (let k = 1; k <= H; k++) {
            const w = (k * Math.PI) / L;
            const ak = coef((j) => Math.cos(w * (-L + ((j + 0.5) * 2 * L) / M))), bk = coef((j) => Math.sin(w * (-L + ((j + 0.5) * 2 * L) / M)));
            const wr = Number(w.toPrecision(12));
            const arg = wr === 1 ? V('x') : bin('*', N(wr), V('x'));
            add(tidy(ak), { k: 'fn', f: 'cos', a: [arg] });
            add(tidy(bk), { k: 'fn', f: 'sin', a: [arg] });
            if (k <= 4) parts.push(`a${SUB(k)} = ${fmtN(tidy(ak))}, b${SUB(k)} = ${fmtN(tidy(bk))}`);
          }
          const polyAst: Ast = poly ?? N(0);
          const text = show(polyAst);
          rows.push({ k: 'Fourier series', v: text });
          rows.push({ k: 'Interval', v: `[${fmtN(-L)}, ${fmtN(L)}]` });
          rows.push({ k: 'Harmonics', v: String(H) });
          rows.push({ k: 'First coefficients', v: parts.join(' · ') });
          const v = mk(polyAst)(spec.at);
          rows.push({ k: 'Series at the point', v: `x = ${fmtN(spec.at)}: ${fmtN(v)}` });
          addFn(it, text);
          values.push(fin(v));
          exprs.push(text);
        }
      }
      break;
    }
    // ---- curve analysis ----
    case 'curve': {
      symbol = 'ƒ';
      const ns = Math.max(600, Math.min(2000, Math.round(spec.samples) * 3));
      for (const it of items) {
        heading(it);
        const f = it.f;
        let d1: Fn, d2: Fn;
        try { d1 = mk(simplify(derivative(it.bound, 'x', 1))); d2 = mk(simplify(derivative(it.bound, 'x', 2))); } catch { d1 = (x) => numDeriv(f, x, 1); d2 = (x) => numDeriv(f, x, 2); }
        const xs = Array.from({ length: ns + 1 }, (_, k) => xMin + ((xMax - xMin) * k) / ns), ys = xs.map(f);
        const tol = (xMax - xMin) / ns;
        // domain
        const gaps: string[] = [];
        for (let k = 0; k < xs.length; k++) if (!Number.isFinite(ys[k])) { const s = k; while (k + 1 < xs.length && !Number.isFinite(ys[k + 1])) k++; gaps.push(`[${fmtN(xs[s])}, ${fmtN(xs[k])}]`); }
        rows.push({ k: 'Not defined on', v: gaps.length ? gaps.slice(0, 6).join(', ') + (gaps.length > 6 ? ' …' : '') : '—' });
        // symmetry
        const probe = xs.filter((x) => x > 0 && x <= Math.min(xMax, -xMin)), pairs = probe.filter((_, k) => k % 7 === 0).map((x) => [f(x), f(-x)]).filter(([p, q]) => Number.isFinite(p) && Number.isFinite(q));
        const sc = Math.max(1, ...pairs.map(([p]) => Math.abs(p)));
        const even = pairs.length > 3 && pairs.every(([p, q]) => Math.abs(p - q) < 1e-9 * sc), odd = pairs.length > 3 && pairs.every(([p, q]) => Math.abs(p + q) < 1e-9 * sc);
        rows.push({ k: 'Symmetry', v: even && odd ? 'Zero function' : even ? 'Even (mirror in the y-axis)' : odd ? 'Odd (turns into itself about the origin)' : 'None found', t: true });
        if (xMin <= 0 && xMax >= 0) { const y0 = f(0); if (Number.isFinite(y0)) rows.push({ k: 'y-intercept', v: fmtN(y0) }); }
        // zeros
        const scale = Math.max(1e-9, ...ys.filter(Number.isFinite).map(Math.abs).sort((p, q) => p - q).slice(0, Math.max(1, Math.floor(ys.length * 0.9))).slice(-1));
        const roots: number[] = [], poles: number[] = [];
        for (let k = 0; k < ns; k++) {
          const p = ys[k], q = ys[k + 1];
          if (!Number.isFinite(p) || !Number.isFinite(q)) continue;
          if (p === 0) roots.push(xs[k]);
          else if (Math.sign(p) !== Math.sign(q) && q !== 0) {
            const r = bisect(f, xs[k], xs[k + 1], p), fr = Math.abs(f(r));
            if (fr < 1e-6 * scale + 1e-9) roots.push(r); else if (fr > 1e3 * scale) poles.push(r);
          }
        }
        if (Number.isFinite(ys[ns]) && ys[ns] === 0) roots.push(xs[ns]);
        const zeros = dedupe(roots, tol * 2);
        rows.push({ k: 'x-intercepts', v: list(zeros) });
        // vertical asymptotes: poles seen as sign flips (above), ends of the domain where the value runs away, and sharp peaks
        for (let k = 0; k < ns; k++) {
          const p = ys[k], q = ys[k + 1];
          if (Number.isFinite(p) !== Number.isFinite(q)) {
            let good = Number.isFinite(p) ? xs[k] : xs[k + 1], bad = Number.isFinite(p) ? xs[k + 1] : xs[k];
            for (let i = 0; i < 60; i++) { const mid = (good + bad) / 2; if (Number.isFinite(f(mid))) good = mid; else bad = mid; }
            const run = limitSide(f, good, good < bad ? -1 : 1);
            if (run.k === 'inf') poles.push(good);
          }
          if (k > 0 && Number.isFinite(p) && Number.isFinite(ys[k - 1]) && Number.isFinite(q)) {
            const a = Math.abs(p);
            if (a > 50 * scale && a >= Math.abs(ys[k - 1]) && a >= Math.abs(q)) {
              let lo = xs[k - 1], hi = xs[k + 1];
              for (let i = 0; i < 100; i++) { const m1 = lo + (hi - lo) / 3, m2 = hi - (hi - lo) / 3; if (!(Math.abs(f(m1)) < Math.abs(f(m2)))) hi = m2; else lo = m1; }
              const r = (lo + hi) / 2;
              if (!Number.isFinite(f(r)) || Math.abs(f(r)) > 1e4 * scale) poles.push(r);
            }
          }
        }
        const vas = dedupe(poles.map((x) => (Math.abs(x) < 1e-9 * (xMax - xMin) ? 0 : Number(x.toPrecision(8)))), tol * 2);
        rows.push({ k: 'Vertical asymptotes', v: vas.length ? vas.map((x) => `x = ${fmtN(x)}`).join(', ') : '—' });
        // horizontal and slant asymptotes
        const hz: string[] = [], slant: string[] = [];
        for (const s of [1, -1] as const) {
          const L = limitInf(f, s);
          if (L.k === 'value') hz.push(`y = ${fmtN(L.v)} (x → ${s > 0 ? '∞' : '-∞'})`);
          else if (L.k === 'inf') {
            const m = limitInf((x) => f(x) / x, s, [1e2, 1e3, 1e4, 1e5, 1e6]);
            if (m.k === 'value' && Math.abs(m.v) > 1e-9) {
              const c = limitInf((x) => f(x) - m.v * x, s, [1e2, 1e3, 1e4, 1e5, 1e6]);
              if (c.k === 'value') slant.push(`y = ${show(simplify(bin('+', bin('*', N(m.v), V('x')), N(Math.abs(c.v) < 1e-6 ? 0 : c.v))))} (x → ${s > 0 ? '∞' : '-∞'})`);
            }
          }
        }
        rows.push({ k: 'Horizontal asymptotes', v: hz.length ? hz.join(', ') : '—' });
        rows.push({ k: 'Slant asymptotes', v: slant.length ? slant.join(', ') : '—' });
        // critical points
        const crit: number[] = [];
        const dys = xs.map(d1);
        for (let k = 0; k < ns; k++) {
          const p = dys[k], q = dys[k + 1];
          if (!Number.isFinite(p) || !Number.isFinite(q) || !Number.isFinite(ys[k]) || !Number.isFinite(ys[k + 1])) continue;
          if (p === 0) crit.push(xs[k]);
          else if (Math.sign(p) !== Math.sign(q) && q !== 0) {
            const r = bisect(d1, xs[k], xs[k + 1], p);
            // a jump of the slope across a pole is not a critical point
            if (Number.isFinite(f(r)) && !vas.some((v) => Math.abs(v - r) < tol * 3)) crit.push(r);
          }
        }
        const cps = dedupe(crit, tol * 2);
        const maxs: number[] = [], mins: number[] = [];
        for (const c of cps) {
          const dlt = Math.max(1e-6, tol * 0.25), a = f(c - dlt), b = f(c + dlt), m = f(c);
          if (a > m && b > m) mins.push(c); else if (a < m && b < m) maxs.push(c);
        }
        rows.push({ k: 'Local maxima', v: pts(maxs, f) });
        rows.push({ k: 'Local minima', v: pts(mins, f) });
        // inflection points
        const infl: number[] = [];
        const d2s = xs.map(d2);
        for (let k = 0; k < ns; k++) {
          const p = d2s[k], q = d2s[k + 1];
          if (!Number.isFinite(p) || !Number.isFinite(q) || !Number.isFinite(ys[k]) || !Number.isFinite(ys[k + 1])) continue;
          if (p === 0 && k > 0 && Math.sign(d2s[k - 1]) * Math.sign(q) < 0) infl.push(xs[k]);
          else if (Math.sign(p) !== Math.sign(q) && p !== 0 && q !== 0) { const r = bisect(d2, xs[k], xs[k + 1], p); if (Number.isFinite(f(r)) && !vas.some((v) => Math.abs(v - r) < tol * 3)) infl.push(r); }
        }
        const ips = dedupe(infl, tol * 2);
        rows.push({ k: 'Inflection points', v: pts(ips, f) });
        const cutsInc = dedupe([...cps, ...vas], tol), cutsCon = dedupe([...ips, ...vas], tol);
        rows.push({ k: 'Increasing on', v: spans(cutsInc, xMin, xMax, d1, 1, f, vas) });
        rows.push({ k: 'Decreasing on', v: spans(cutsInc, xMin, xMax, d1, -1, f, vas) });
        rows.push({ k: 'Concave up on', v: spans(cutsCon, xMin, xMax, d2, 1, f, vas) });
        rows.push({ k: 'Concave down on', v: spans(cutsCon, xMin, xMax, d2, -1, f, vas) });
        // global behaviour over the window
        const fy = ys.map((y, k) => [y, xs[k]] as const).filter(([y]) => Number.isFinite(y) && Math.abs(y) < 1e6 * scale);
        if (fy.length && vas.length === 0) {
          const hi = fy.reduce((p, q) => (q[0] > p[0] ? q : p)), lo = fy.reduce((p, q) => (q[0] < p[0] ? q : p));
          rows.push({ k: 'Highest value in the window', v: `${fmtN(hi[0])} at x = ${fmtN(hi[1])}` });
          rows.push({ k: 'Lowest value in the window', v: `${fmtN(lo[0])} at x = ${fmtN(lo[1])}` });
        }
        if (vas.length === 0 && gaps.length === 0) {
          const area = integral(f, xMin, xMax), mag = integral((x) => Math.abs(f(x)), xMin, xMax), arc = integral((x) => Math.sqrt(1 + d1(x) * d1(x)), xMin, xMax);
          if (area.ok) rows.push({ k: 'Integral over the window', v: fmtN(area.value) });
          if (mag.ok) rows.push({ k: 'Area over the window', v: fmtN(mag.value) });
          if (arc.ok) rows.push({ k: 'Arc length over the window', v: fmtN(arc.value) });
        }
        const v = f(spec.at);
        rows.push({ k: 'Value at the point', v: `x = ${fmtN(spec.at)}: ${fmtN(v)}` });
        curves.push(shown(it));
        values.push(fin(v));
        exprs.push('');
      }
      break;
    }
  }

  const ti = Math.max(0, Math.min(items.length - 1, Math.round(spec.target) - 1));
  const value = values[ti] ?? null;
  return { curves, values, value, exprs, rows, usesT, short: value !== null ? `${symbol} ${fmtN(value)}` : symbol };
}

/** Translate a row of the analysis into the interface language. */
export function rowText(r: Row): { label: string; value: string } {
  if (r.h !== undefined) return { label: '', value: r.h };
  return { label: tr(r.k ?? ''), value: r.t ? tr(r.v ?? '') : (r.v ?? '') };
}
