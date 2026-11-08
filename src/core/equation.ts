// Equation support: a small, safe (no eval / no Function) expression parser, plus the data model and
// sampler used by the Equation node and the Meter's graph view. Pure logic, testable in Node.

// ---- evaluation -----------------------------------------------------------------------------------------------

export interface Vars {
  x: number;
  t: number;
}
export type EvalFn = (v: Vars) => number;

export type Compiled = { ok: true; fn: EvalFn; usesX: boolean; usesT: boolean; text: string } | { ok: false; error: string };

const CONSTS: Record<string, number> = { pi: Math.PI, e: Math.E, tau: Math.PI * 2, phi: (1 + Math.sqrt(5)) / 2 };

/** [implementation, min args, max args]. The first block mirrors the Math node so both agree on semantics. */
const FUNCS: Record<string, [(...a: number[]) => number, number, number]> = {
  abs: [Math.abs, 1, 1],
  sqrt: [Math.sqrt, 1, 1],
  square: [(a) => a * a, 1, 1],
  sin: [Math.sin, 1, 1],
  cos: [Math.cos, 1, 1],
  tanh: [Math.tanh, 1, 1],
  exp: [Math.exp, 1, 1],
  log: [Math.log, 1, 1],
  floor: [Math.floor, 1, 1],
  round: [Math.round, 1, 1],
  ceil: [Math.ceil, 1, 1],
  min: [Math.min, 1, 99],
  max: [Math.max, 1, 99],
  pow: [Math.pow, 2, 2],
  mod: [(a, b) => ((a % b) + b) % b, 2, 2],
  // Extras
  tan: [Math.tan, 1, 1],
  asin: [Math.asin, 1, 1],
  acos: [Math.acos, 1, 1],
  atan: [Math.atan, 1, 1],
  atan2: [Math.atan2, 2, 2],
  sinh: [Math.sinh, 1, 1],
  cosh: [Math.cosh, 1, 1],
  ln: [Math.log, 1, 1],
  log10: [Math.log10, 1, 1],
  log2: [Math.log2, 1, 1],
  cbrt: [Math.cbrt, 1, 1],
  sign: [Math.sign, 1, 1],
  trunc: [Math.trunc, 1, 1],
  fract: [(a) => a - Math.floor(a), 1, 1],
  hypot: [Math.hypot, 1, 99],
  clamp: [(a, lo, hi) => Math.min(Math.max(a, lo), hi), 3, 3],
  step: [(edge, a) => (a >= edge ? 1 : 0), 2, 2],
  saw: [(a) => 2 * (a - Math.floor(a)) - 1, 1, 1],
  tri: [(a) => 1 - 4 * Math.abs(a - Math.floor(a) - 0.5), 1, 1],
  sqr: [(a) => (a - Math.floor(a) < 0.5 ? 1 : -1), 1, 1],
};
export const FUNCTION_NAMES = Object.keys(FUNCS);
export const CONSTANT_NAMES = Object.keys(CONSTS);

type Tok = { k: 'num'; v: number } | { k: 'id'; v: string } | { k: 'op'; v: string } | { k: 'end' };

function tokenize(src: string): Tok[] {
  const out: Tok[] = [];
  let i = 0;
  while (i < src.length) {
    const ch = src[i];
    if (/\s/.test(ch)) { i++; continue; }
    const rest = src.slice(i);
    const num = /^(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/.exec(rest);
    if (num) {
      out.push({ k: 'num', v: Number(num[0]) });
      i += num[0].length;
      continue;
    }
    const id = /^[A-Za-z_\u03c0\u03c4][A-Za-z0-9_]*/.exec(rest);
    if (id) {
      out.push({ k: 'id', v: id[0] });
      i += id[0].length;
      continue;
    }
    if ('+-*/^%(),'.includes(ch)) { out.push({ k: 'op', v: ch }); i++; continue; }
    if (ch === '\u00d7' || ch === '\u00b7') { out.push({ k: 'op', v: '*' }); i++; continue; }
    if (ch === '\u00f7') { out.push({ k: 'op', v: '/' }); i++; continue; }
    if (ch === '\u2212') { out.push({ k: 'op', v: '-' }); i++; continue; }
    if (ch === '\u00b2') { out.push({ k: 'op', v: '^' }, { k: 'num', v: 2 }); i++; continue; }
    if (ch === '\u00b3') { out.push({ k: 'op', v: '^' }, { k: 'num', v: 3 }); i++; continue; }
    throw new Error(`Unexpected character “${ch}”.`);
  }
  out.push({ k: 'end' });
  return out;
}

const ALIASES: Record<string, string> = { '\u03c0': 'pi', '\u03c4': 'tau' };

/** Strip a leading "y =" / "f(x) =" so people can type equations the way they write them. */
export function stripLhs(line: string): string {
  return line.replace(/^\s*(?:y|f\s*\(\s*x\s*\)|f\s*\(\s*x\s*,\s*t\s*\))\s*=(?!=)/i, '').trim();
}

/** An equation block holds one or more equations, separated by new lines or semicolons. Blank lines and // comments are ignored. */
export function splitEquations(text: string): string[] {
  return text
    .split(/[\n;]/)
    .map((l) => l.replace(/\/\/.*$/, '').trim())
    .filter((l) => l !== '');
}

export function compileExpr(source: string): Compiled {
  const text = stripLhs(source);
  if (text === '') return { ok: false, error: 'The equation is empty.' };
  let usesX = false, usesT = false;
  try {
    const toks = tokenize(text);
    let p = 0;
    const peek = () => toks[p];
    const isOp = (v: string) => toks[p].k === 'op' && (toks[p] as { v: string }).v === v;
    const describeTok = (t: Tok) => (t.k === 'end' ? ' but the equation ended' : ` but found “${t.v}”`);
    const expectOp = (v: string) => {
      if (!isOp(v)) throw new Error(`Expected “${v}”${describeTok(peek())}.`);
      p++;
    };
    const startsOperand = () => {
      const t = peek();
      return t.k === 'num' || t.k === 'id' || (t.k === 'op' && t.v === '(');
    };

    const parseSum = (): EvalFn => {
      let l = parseTerm();
      while (isOp('+') || isOp('-')) {
        const plus = isOp('+');
        p++;
        const a = l, b = parseTerm();
        l = plus ? (v) => a(v) + b(v) : (v) => a(v) - b(v);
      }
      return l;
    };
    // Terms: explicit * / % and implicit multiplication (2x, 3sin(x), (x+1)(x-1)).
    const parseTerm = (): EvalFn => {
      let l = parseUnary();
      for (;;) {
        const a = l;
        if (isOp('*')) { p++; const b = parseUnary(); l = (v) => a(v) * b(v); }
        else if (isOp('/')) { p++; const b = parseUnary(); l = (v) => a(v) / b(v); }
        else if (isOp('%')) { p++; const b = parseUnary(); l = (v) => ((a(v) % b(v)) + b(v)) % b(v); }
        else if (startsOperand()) { const b = parseUnary(); l = (v) => a(v) * b(v); }
        else return l;
      }
    };
    const parseUnary = (): EvalFn => {
      if (isOp('-')) { p++; const a = parseUnary(); return (v) => -a(v); }
      if (isOp('+')) { p++; return parseUnary(); }
      return parsePow();
    };
    const parsePow = (): EvalFn => {
      const base = parsePrimary();
      if (isOp('^')) {
        p++;
        const ex = parseUnary(); // right-associative, and allows 2^-x
        return (v) => Math.pow(base(v), ex(v));
      }
      return base;
    };
    const parsePrimary = (): EvalFn => {
      const t = peek();
      if (t.k === 'num') { p++; const c = t.v; return () => c; }
      if (t.k === 'op' && t.v === '(') {
        p++;
        const e = parseSum();
        expectOp(')');
        return e;
      }
      if (t.k === 'id') {
        p++;
        const name = ALIASES[t.v] ?? t.v;
        const lname = name.toLowerCase();
        if (isOp('(') && FUNCS[lname]) {
          p++;
          const args: EvalFn[] = [];
          if (!isOp(')')) {
            args.push(parseSum());
            while (isOp(',')) { p++; args.push(parseSum()); }
          }
          expectOp(')');
          const [impl, lo, hi] = FUNCS[lname];
          if (args.length < lo || args.length > hi) {
            const want = lo === hi ? String(lo) : hi > 50 ? `${lo} or more` : `${lo}–${hi}`;
            throw new Error(`${lname}() takes ${want} argument${hi === 1 ? '' : 's'}, got ${args.length}.`);
          }
          if (args.length === 1) { const [a] = args; return (v) => impl(a(v)); }
          return (v) => impl(...args.map((f) => f(v)));
        }
        if (lname === 'x') { usesX = true; return (v) => v.x; }
        if (lname === 't') { usesT = true; return (v) => v.t; }
        if (lname in CONSTS) { const c = CONSTS[lname]; return () => c; }
        if (FUNCS[lname]) throw new Error(`“${name}” is a function: write ${name}(…).`);
        throw new Error(`Unknown name “${t.v}”. Use x, t, a constant (${CONSTANT_NAMES.join(', ')}) or a function.`);
      }
      throw new Error(t.k === 'end' ? 'The equation ends too early.' : `Unexpected “${t.v}”.`);
    };

    const fn = parseSum();
    const rest = peek();
    if (rest.k !== 'end') throw new Error(`Unexpected “${rest.v}”.`);
    return { ok: true, fn, usesX, usesT, text };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

// ---- equation data ---------------------------------------------------------------------------------------------

/** The value an Equation node emits. Plain JSON-compatible data, so it can be stored, shared and inspected. */
export interface EquationData {
  kind: 'equation';
  /** One expression per curve, exactly as typed (a leading "y =" is allowed). */
  exprs: string[];
  xMin: number;
  xMax: number;
  /** Fixed y range, used when yAuto is false. */
  yMin: number;
  yMax: number;
  yAuto: boolean;
  samples: number;
  /** Simulation time in seconds, for equations that use t. */
  t: number;
}

export function isEquation(v: unknown): v is EquationData {
  return !!v && typeof v === 'object' && (v as { kind?: unknown }).kind === 'equation' && Array.isArray((v as { exprs?: unknown }).exprs);
}

export interface Curve {
  expr: string;
  /** y at each sample; null where the function is undefined (gaps in the line). */
  ys: (number | null)[];
}
export interface Plot {
  xMin: number;
  xMax: number;
  yMin: number;
  yMax: number;
  curves: Curve[];
  t: number;
  usesT: boolean;
}

/** Sample every curve and choose a y range. Returns an error message instead when anything cannot be plotted. */
export function samplePlot(eq: EquationData): { ok: true; plot: Plot } | { ok: false; error: string } {
  if (!(eq.xMax > eq.xMin)) return { ok: false, error: 'x max must be greater than x min.' };
  if (!eq.exprs.length) return { ok: false, error: 'The equation is empty.' };
  const n = Math.max(2, Math.min(4000, Math.round(eq.samples) || 200));
  const curves: Curve[] = [];
  let usesT = false;
  for (const expr of eq.exprs) {
    const c = compileExpr(expr);
    if (!c.ok) return { ok: false, error: `“${expr}”: ${c.error}` };
    usesT ||= c.usesT;
    const ys: (number | null)[] = [];
    for (let i = 0; i < n; i++) {
      const y = c.fn({ x: eq.xMin + ((eq.xMax - eq.xMin) * i) / (n - 1), t: eq.t });
      ys.push(Number.isFinite(y) ? y : null);
    }
    curves.push({ expr, ys });
  }
  let yMin = eq.yMin, yMax = eq.yMax;
  if (eq.yAuto || !(yMax > yMin)) {
    const all: number[] = [];
    for (const c of curves) for (const y of c.ys) if (y !== null) all.push(y);
    if (!all.length) { yMin = -1; yMax = 1; }
    else {
      all.sort((a, b) => a - b);
      const q = (f: number) => all[Math.min(all.length - 1, Math.max(0, Math.round(f * (all.length - 1))))];
      const lo = all[0], hi = all[all.length - 1];
      // Robust against asymptotes (tan, 1/x): the extreme 2 % tails only count when they are of a similar magnitude.
      const p2 = q(0.02), p98 = q(0.98), span = Math.max(p98 - p2, 1e-9);
      yMin = Math.max(lo, p2 - span);
      yMax = Math.min(hi, p98 + span);
      if (yMax - yMin < 1e-9) { yMin -= 0.5; yMax += 0.5; }
      const pad = (yMax - yMin) * 0.06;
      yMin -= pad;
      yMax += pad;
    }
  }
  return { ok: true, plot: { xMin: eq.xMin, xMax: eq.xMax, yMin, yMax, curves, t: eq.t, usesT } };
}

/** "Nice" tick positions (1/2/5 × 10ⁿ) inside [lo, hi]. */
export function niceTicks(lo: number, hi: number, target = 5): number[] {
  const span = hi - lo;
  if (!(span > 0) || !Number.isFinite(span)) return [];
  const raw = span / target;
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const f = raw / mag;
  const step = (f < 1.5 ? 1 : f < 3.5 ? 2 : f < 7.5 ? 5 : 10) * mag;
  const out: number[] = [];
  for (let v = Math.ceil(lo / step) * step; v <= hi + step * 1e-9; v += step) out.push(Math.abs(v) < step * 1e-9 ? 0 : Number(v.toPrecision(12)));
  return out;
}
