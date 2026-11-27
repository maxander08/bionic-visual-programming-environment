// Expression trees for the Calculus Engine: a safe parser (no eval / no Function), exact symbolic differentiation,
// a rule-based antiderivative, a simplifier and a printer whose output the Equation parser (equation.ts) can read back,
// so every result can be handed to a Meter as an ordinary equation. Pure logic, testable in Node.

export type Ast =
  | { k: 'num'; v: number }
  | { k: 'var'; n: string }
  | { k: 'neg'; a: Ast }
  | { k: 'bin'; op: '+' | '-' | '*' | '/' | '^'; a: Ast; b: Ast }
  | { k: 'fn'; f: string; a: Ast[] };

export const N = (v: number): Ast => ({ k: 'num', v });
export const V = (n: string): Ast => ({ k: 'var', n });
export const neg = (a: Ast): Ast => ({ k: 'neg', a });
export const bin = (op: '+' | '-' | '*' | '/' | '^', a: Ast, b: Ast): Ast => ({ k: 'bin', op, a, b });
export const F = (f: string, ...a: Ast[]): Ast => ({ k: 'fn', f, a });

// ---- functions and constants ---------------------------------------------------------------------------------------------

const LANCZOS = [676.5203681218851, -1259.1392167224028, 771.32342877765313, -176.61502916214059, 12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7];
function gamma(z: number): number {
  if (z < 0.5) return Math.PI / (Math.sin(Math.PI * z) * gamma(1 - z));
  z -= 1;
  let a = 0.99999999999980993;
  const t = z + 7.5;
  for (let i = 0; i < 8; i++) a += LANCZOS[i] / (z + i + 1);
  return Math.sqrt(2 * Math.PI) * Math.pow(t, z + 0.5) * Math.exp(-t) * a;
}
export function factorial(n: number): number {
  if (n < 0 && Number.isInteger(n)) return NaN;
  if (Number.isInteger(n)) { if (n > 170) return Infinity; let r = 1; for (let i = 2; i <= n; i++) r *= i; return r; }
  return gamma(n + 1);
}

/** [implementation, min args, max args]. Names and meanings follow the Equation node, so results can be plotted by a Meter. */
export const FN: Record<string, [(...a: number[]) => number, number, number]> = {
  abs: [Math.abs, 1, 1], sqrt: [Math.sqrt, 1, 1], cbrt: [Math.cbrt, 1, 1], square: [(a) => a * a, 1, 1],
  sin: [Math.sin, 1, 1], cos: [Math.cos, 1, 1], tan: [Math.tan, 1, 1], asin: [Math.asin, 1, 1], acos: [Math.acos, 1, 1], atan: [Math.atan, 1, 1], atan2: [Math.atan2, 2, 2],
  sinh: [Math.sinh, 1, 1], cosh: [Math.cosh, 1, 1], tanh: [Math.tanh, 1, 1],
  exp: [Math.exp, 1, 1], ln: [Math.log, 1, 1], log: [Math.log, 1, 1], log10: [Math.log10, 1, 1], log2: [Math.log2, 1, 1],
  floor: [Math.floor, 1, 1], ceil: [Math.ceil, 1, 1], round: [Math.round, 1, 1], trunc: [Math.trunc, 1, 1], sign: [Math.sign, 1, 1], fract: [(a) => a - Math.floor(a), 1, 1],
  min: [Math.min, 1, 99], max: [Math.max, 1, 99], pow: [Math.pow, 2, 2], mod: [(a, b) => ((a % b) + b) % b, 2, 2], hypot: [Math.hypot, 1, 99],
  clamp: [(a, lo, hi) => Math.min(Math.max(a, lo), hi), 3, 3], step: [(edge, a) => (a >= edge ? 1 : 0), 2, 2],
  saw: [(a) => 2 * (a - Math.floor(a)) - 1, 1, 1], tri: [(a) => 1 - 4 * Math.abs(a - Math.floor(a) - 0.5), 1, 1], sqr: [(a) => (a - Math.floor(a) < 0.5 ? 1 : -1), 1, 1],
  fact: [factorial, 1, 1],
};
const FN_ALIAS: Record<string, string> = { arcsin: 'asin', arccos: 'acos', arctan: 'atan', gamma: 'fact' };
const TRIG3 = ['sec', 'csc', 'cot'];
export const CALC_FUNCTION_NAMES = [...Object.keys(FN), ...TRIG3];
export const CONSTS: Record<string, number> = { pi: Math.PI, e: Math.E, tau: Math.PI * 2, phi: (1 + Math.sqrt(5)) / 2 };
/** Names a parameter may not take: they already mean something in an expression. */
export const RESERVED = new Set(['x', 't', ...Object.keys(CONSTS), ...Object.keys(FN), ...Object.keys(FN_ALIAS), ...TRIG3, 'inf', 'infinity']);

// ---- parsing --------------------------------------------------------------------------------------------------------------

type Tok = { k: 'num'; v: number } | { k: 'id'; v: string } | { k: 'op'; v: string } | { k: 'end' };

function tokenize(src: string): Tok[] {
  const out: Tok[] = [];
  let i = 0;
  while (i < src.length) {
    const ch = src[i];
    if (/\s/.test(ch)) { i++; continue; }
    const rest = src.slice(i);
    const num = /^(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/.exec(rest);
    if (num) { out.push({ k: 'num', v: Number(num[0]) }); i += num[0].length; continue; }
    const id = /^[A-Za-z_\u03c0\u03c4][A-Za-z0-9_]*/.exec(rest);
    if (id) { out.push({ k: 'id', v: id[0] }); i += id[0].length; continue; }
    if ('+-*/^%(),!'.includes(ch)) { out.push({ k: 'op', v: ch }); i++; continue; }
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

const GREEK: Record<string, string> = { '\u03c0': 'pi', '\u03c4': 'tau' };

/** Strip a leading "y =", "f(x) =" or "f1(x) =" so expressions can be typed the way they are written. */
export const stripName = (line: string): string => line.replace(/\/\/.*$/, '').replace(/^\s*(?:y|[fgh]\d*\s*\(\s*x\s*\))\s*=(?!=)/i, '').trim();

/** Parse an expression. `vars` are the names that stand for a number: x, t and every parameter. */
export function parseExpr(source: string, vars: ReadonlySet<string>): Ast {
  const text = stripName(source);
  if (text === '') throw new Error('The expression is empty.');
  const toks = tokenize(text);
  let p = 0;
  const peek = () => toks[p];
  const isOp = (v: string) => toks[p].k === 'op' && (toks[p] as { v: string }).v === v;
  const describe = (t: Tok) => (t.k === 'end' ? ' but the expression ended' : ` but found “${t.v}”`);
  const expectOp = (v: string) => { if (!isOp(v)) throw new Error(`Expected “${v}”${describe(peek())}.`); p++; };
  const startsOperand = () => { const t = peek(); return t.k === 'num' || t.k === 'id' || (t.k === 'op' && t.v === '('); };

  const parseSum = (): Ast => {
    let l = parseTerm();
    while (isOp('+') || isOp('-')) { const plus = isOp('+'); p++; l = bin(plus ? '+' : '-', l, parseTerm()); }
    return l;
  };
  const parseTerm = (): Ast => {
    let l = parseUnary();
    for (;;) {
      if (isOp('*')) { p++; l = bin('*', l, parseUnary()); }
      else if (isOp('/')) { p++; l = bin('/', l, parseUnary()); }
      else if (isOp('%')) { p++; l = F('mod', l, parseUnary()); }
      else if (startsOperand()) l = bin('*', l, parseUnary());
      else return l;
    }
  };
  const parseUnary = (): Ast => {
    if (isOp('-')) { p++; return neg(parseUnary()); }
    if (isOp('+')) { p++; return parseUnary(); }
    return parsePow();
  };
  const parsePow = (): Ast => {
    let base = parsePrimary();
    while (isOp('!')) { p++; base = F('fact', base); }
    if (isOp('^')) { p++; return bin('^', base, parseUnary()); }
    return base;
  };
  const parsePrimary = (): Ast => {
    const t = peek();
    if (t.k === 'num') { p++; return N(t.v); }
    if (t.k === 'op' && t.v === '(') { p++; const e = parseSum(); expectOp(')'); return e; }
    if (t.k === 'id') {
      p++;
      const raw = GREEK[t.v] ?? t.v;
      let name = raw.toLowerCase();
      name = FN_ALIAS[name] ?? name;
      const isFn = !!FN[name] || TRIG3.includes(name);
      if (isOp('(') && isFn) {
        p++;
        const args: Ast[] = [];
        if (!isOp(')')) { args.push(parseSum()); while (isOp(',')) { p++; args.push(parseSum()); } }
        expectOp(')');
        if (TRIG3.includes(name)) {
          if (args.length !== 1) throw new Error(`${name}() takes 1 argument(s), got ${args.length}.`);
          return name === 'sec' ? bin('/', N(1), F('cos', args[0])) : name === 'csc' ? bin('/', N(1), F('sin', args[0])) : bin('/', F('cos', args[0]), F('sin', args[0]));
        }
        const [, lo, hi] = FN[name];
        if (args.length < lo || args.length > hi) {
          const want = lo === hi ? String(lo) : hi > 50 ? `${lo}+` : `${lo}–${hi}`;
          throw new Error(`${name}() takes ${want} argument(s), got ${args.length}.`);
        }
        return F(name, ...args);
      }
      if (vars.has(raw)) return V(raw);
      if ((name === 'x' || name === 't') && vars.has(name)) return V(name);
      if (name in CONSTS) return N(CONSTS[name]);
      if (isFn) throw new Error(`“${t.v}” is a function: write ${t.v}(…).`);
      // Juxtaposed single-letter names are a product: ax is a·x, abx is a·b·x.
      const letters = [...raw];
      if (letters.length > 1 && letters.every((ch) => vars.has(ch))) {
        const head = letters.slice(0, -1).map(V).reduce((a, b) => bin('*', a, b));
        const last = V(letters[letters.length - 1]);
        if (isOp('^')) { p++; return bin('*', head, bin('^', last, parseUnary())); }
        return bin('*', head, last);
      }
      throw new Error(`Unknown name “${t.v}”. Use x, t, a parameter, a constant (${Object.keys(CONSTS).join(', ')}) or a function.`);
    }
    throw new Error(t.k === 'end' ? 'The expression ends too early.' : `Unexpected “${t.v}”.`);
  };

  const ast = parseSum();
  const rest = peek();
  if (rest.k !== 'end') throw new Error(`Unexpected “${rest.v}”.`);
  return ast;
}

// ---- structure helpers -----------------------------------------------------------------------------------------------------

export const isNum = (a: Ast): a is { k: 'num'; v: number } => a.k === 'num';
export function dep(a: Ast, v: string): boolean {
  switch (a.k) {
    case 'num': return false;
    case 'var': return a.n === v;
    case 'neg': return dep(a.a, v);
    case 'bin': return dep(a.a, v) || dep(a.b, v);
    case 'fn': return a.a.some((x) => dep(x, v));
  }
}
export function varsOf(a: Ast, into = new Set<string>()): Set<string> {
  switch (a.k) {
    case 'var': into.add(a.n); break;
    case 'neg': varsOf(a.a, into); break;
    case 'bin': varsOf(a.a, into); varsOf(a.b, into); break;
    case 'fn': a.a.forEach((x) => varsOf(x, into)); break;
  }
  return into;
}
export function size(a: Ast): number {
  switch (a.k) {
    case 'num': case 'var': return 1;
    case 'neg': return 1 + size(a.a);
    case 'bin': return 1 + size(a.a) + size(a.b);
    case 'fn': return 1 + a.a.reduce((s, x) => s + size(x), 0);
  }
}
/** Replace names by numbers. */
export function bind(a: Ast, consts: Record<string, number>): Ast {
  switch (a.k) {
    case 'num': return a;
    case 'var': return a.n in consts ? N(consts[a.n]) : a;
    case 'neg': return neg(bind(a.a, consts));
    case 'bin': return bin(a.op, bind(a.a, consts), bind(a.b, consts));
    case 'fn': return F(a.f, ...a.a.map((x) => bind(x, consts)));
  }
}

const clean = (v: number) => (Number.isFinite(v) ? Number(v.toPrecision(15)) : v);

// ---- printing ---------------------------------------------------------------------------------------------------------------

export function fmtConst(v: number): string {
  if (Object.is(v, -0)) return '0';
  return String(Number(v.toPrecision(12)));
}

/** Precedence: + − 1, * / 2, unary minus 2.5, ^ 4, atoms 5. */
function pr(a: Ast, ctx: number): string {
  let p = 5, s = '';
  switch (a.k) {
    case 'num': s = fmtConst(a.v); if (a.v < 0) p = 2.5; break;
    case 'var': s = a.n; break;
    case 'neg': p = 2.5; s = '-' + pr(a.a, 3); break;
    case 'fn': s = `${a.f}(${a.a.map((x) => pr(x, 0)).join(', ')})`; break;
    case 'bin':
      switch (a.op) {
        case '+': p = 1; s = `${pr(a.a, 1)} + ${pr(a.b, 1)}`; break;
        case '-': p = 1; s = `${pr(a.a, 1)} - ${pr(a.b, 2)}`; break;
        case '*': p = 2; s = `${pr(a.a, 2)}*${pr(a.b, 3)}`; break;
        case '/': p = 2; s = `${pr(a.a, 2)}/${pr(a.b, 3)}`; break;
        case '^': p = 4; s = `${pr(a.a, 4.5)}^${pr(a.b, 4)}`; break;
      }
  }
  return p < ctx ? `(${s})` : s;
}
export const show = (a: Ast): string => pr(a, 0);

// ---- simplification ---------------------------------------------------------------------------------------------------------

const same = (a: Ast, b: Ast) => show(a) === show(b);

function simp(a: Ast): Ast {
  switch (a.k) {
    case 'num': case 'var': return a;
    case 'neg': {
      const x = simp(a.a);
      if (isNum(x)) return N(-x.v);
      if (x.k === 'neg') return x.a;
      return neg(x);
    }
    case 'fn': {
      const args = a.a.map(simp);
      if (args.every(isNum)) {
        const v = FN[a.f][0](...args.map((x) => (x as { v: number }).v));
        if (Number.isFinite(v)) return N(clean(v));
      }
      return F(a.f, ...args);
    }
    case 'bin': {
      const x = simp(a.a), y = simp(a.b);
      switch (a.op) {
        case '+':
          if (isNum(x) && x.v === 0) return y;
          if (isNum(y) && y.v === 0) return x;
          if (isNum(x) && isNum(y)) return N(clean(x.v + y.v));
          if (y.k === 'neg') return simp(bin('-', x, y.a));
          if (x.k === 'neg') return simp(bin('-', y, x.a));
          if (isNum(y) && y.v < 0) return bin('-', x, N(-y.v));
          if (y.k === 'bin' && y.op === '*' && isNum(y.a) && y.a.v < 0) return bin('-', x, bin('*', N(-y.a.v), y.b));
          if (same(x, y)) return simp(bin('*', N(2), x));
          return bin('+', x, y);
        case '-':
          if (isNum(y) && y.v === 0) return x;
          if (isNum(x) && x.v === 0) return simp(neg(y));
          if (isNum(x) && isNum(y)) return N(clean(x.v - y.v));
          if (y.k === 'neg') return bin('+', x, y.a);
          if (isNum(y) && y.v < 0) return bin('+', x, N(-y.v));
          if (same(x, y)) return N(0);
          return bin('-', x, y);
        case '*':
          if ((isNum(x) && x.v === 0) || (isNum(y) && y.v === 0)) return N(0);
          if (isNum(x) && x.v === 1) return y;
          if (isNum(y) && y.v === 1) return x;
          if (isNum(x) && x.v === -1) return simp(neg(y));
          if (isNum(y) && y.v === -1) return simp(neg(x));
          if (isNum(x) && isNum(y)) return N(clean(x.v * y.v));
          if (x.k === 'neg') return simp(neg(bin('*', x.a, y)));
          if (y.k === 'neg') return simp(neg(bin('*', x, y.a)));
          if (isNum(y)) return simp(bin('*', y, x));
          if (isNum(x) && y.k === 'bin' && y.op === '*' && isNum(y.a)) return simp(bin('*', N(clean(x.v * y.a.v)), y.b));
          if (y.k === 'bin' && y.op === '/' && isNum(y.a) && y.a.v === 1 && !isNum(x)) return simp(bin('/', x, y.b));
          if (x.k === 'bin' && x.op === '/' && same(x.b, y)) return x.a;
          if (y.k === 'bin' && y.op === '/' && same(y.b, x)) return y.a;
          if (y.k === 'bin' && y.op === '*') return simp(bin('*', bin('*', x, y.a), y.b));
          if (same(x, y)) return bin('^', x, N(2));
          if (x.k === 'bin' && x.op === '^' && isNum(x.b) && same(x.a, y)) return simp(bin('^', y, N(clean(x.b.v + 1))));
          if (y.k === 'bin' && y.op === '^' && isNum(y.b) && same(y.a, x)) return simp(bin('^', x, N(clean(y.b.v + 1))));
          return bin('*', x, y);
        case '/':
          if (isNum(y) && y.v === 1) return x;
          if (isNum(x) && x.v === 0 && !(isNum(y) && y.v === 0)) return N(0);
          if (isNum(x) && isNum(y) && y.v !== 0) return N(clean(x.v / y.v));
          if (x.k === 'neg') return simp(neg(bin('/', x.a, y)));
          if (y.k === 'neg') return simp(neg(bin('/', x, y.a)));
          if (isNum(y) && y.v !== 0 && x.k === 'bin' && x.op === '*' && isNum(x.a)) return simp(bin('*', N(clean(x.a.v / y.v)), x.b));
          if (x.k === 'bin' && x.op === '*' && isNum(x.a) && y.k === 'bin' && y.op === '*' && isNum(y.a) && y.a.v !== 0) return simp(bin('*', N(clean(x.a.v / y.a.v)), bin('/', x.b, y.b)));
          if (!isNum(x) && same(x, y)) return N(1);
          return bin('/', x, y);
        case '^':
          if (isNum(y) && y.v === 0) return N(1);
          if (isNum(y) && y.v === 1) return x;
          if (isNum(x) && x.v === 1) return N(1);
          if (isNum(x) && isNum(y)) { const v = Math.pow(x.v, y.v); if (Number.isFinite(v)) return N(clean(v)); }
          return bin('^', x, y);
      }
      return a;
    }
  }
}
export function simplify(a: Ast): Ast {
  let cur = a;
  for (let i = 0; i < 4; i++) {
    const nxt = simp(cur);
    if (same(nxt, cur)) return nxt;
    cur = nxt;
  }
  return cur;
}

// ---- evaluation -------------------------------------------------------------------------------------------------------------

export type Env = Record<string, number>;
export function compile(a: Ast): (e: Env) => number {
  switch (a.k) {
    case 'num': { const v = a.v; return () => v; }
    case 'var': { const n = a.n; return (e) => (n in e ? e[n] : NaN); }
    case 'neg': { const f = compile(a.a); return (e) => -f(e); }
    case 'bin': {
      const f = compile(a.a), g = compile(a.b);
      switch (a.op) {
        case '+': return (e) => f(e) + g(e);
        case '-': return (e) => f(e) - g(e);
        case '*': return (e) => f(e) * g(e);
        case '/': return (e) => f(e) / g(e);
        case '^': return (e) => Math.pow(f(e), g(e));
      }
      return () => NaN;
    }
    case 'fn': {
      const impl = FN[a.f][0], args = a.a.map(compile);
      if (args.length === 1) { const [f] = args; return (e) => impl(f(e)); }
      return (e) => impl(...args.map((f) => f(e)));
    }
  }
}

// ---- differentiation --------------------------------------------------------------------------------------------------------

const two = N(2);
/** Exact derivative with respect to v. Throws when a function has no closed-form derivative (min, max, clamp, n!…). */
export function diff(a: Ast, v: string): Ast {
  if (!dep(a, v)) return N(0);
  switch (a.k) {
    case 'num': return N(0);
    case 'var': return N(1);
    case 'neg': return neg(diff(a.a, v));
    case 'bin': {
      const da = diff(a.a, v), db = diff(a.b, v);
      switch (a.op) {
        case '+': return bin('+', da, db);
        case '-': return bin('-', da, db);
        case '*': return bin('+', bin('*', da, a.b), bin('*', a.a, db));
        case '/': return bin('/', bin('-', bin('*', da, a.b), bin('*', a.a, db)), bin('^', a.b, two));
        case '^': {
          if (!dep(a.b, v)) return bin('*', bin('*', a.b, bin('^', a.a, bin('-', a.b, N(1)))), da);
          if (!dep(a.a, v)) return bin('*', bin('*', a, F('ln', a.a)), db);
          return bin('*', a, bin('+', bin('*', db, F('ln', a.a)), bin('/', bin('*', a.b, da), a.a)));
        }
      }
      break;
    }
    case 'fn': {
      const [u] = a.a, du = () => diff(u, v);
      const chain = (outer: Ast) => bin('*', outer, du());
      switch (a.f) {
        case 'sin': return chain(F('cos', u));
        case 'cos': return chain(neg(F('sin', u)));
        case 'tan': return bin('/', du(), bin('^', F('cos', u), two));
        case 'asin': return bin('/', du(), F('sqrt', bin('-', N(1), bin('^', u, two))));
        case 'acos': return neg(bin('/', du(), F('sqrt', bin('-', N(1), bin('^', u, two)))));
        case 'atan': return bin('/', du(), bin('+', N(1), bin('^', u, two)));
        case 'sinh': return chain(F('cosh', u));
        case 'cosh': return chain(F('sinh', u));
        case 'tanh': return chain(bin('-', N(1), bin('^', F('tanh', u), two)));
        case 'exp': return chain(a);
        case 'ln': case 'log': return bin('/', du(), u);
        case 'log10': return bin('/', du(), bin('*', u, N(Math.LN10)));
        case 'log2': return bin('/', du(), bin('*', u, N(Math.LN2)));
        case 'sqrt': return bin('/', du(), bin('*', two, a));
        case 'cbrt': return bin('/', du(), bin('*', N(3), bin('^', a, two)));
        case 'square': return chain(bin('*', two, u));
        case 'abs': return chain(F('sign', u));
        case 'fract': return du();
        case 'saw': return bin('*', two, du());
        case 'floor': case 'ceil': case 'round': case 'trunc': case 'sign': case 'sqr': case 'step': return N(0);
        case 'pow': return diff(bin('^', a.a[0], a.a[1]), v);
        case 'mod': if (!dep(a.a[1], v)) return diff(a.a[0], v); break;
        case 'hypot': return diff(F('sqrt', a.a.map((x) => bin('^', x, two)).reduce((p, q) => bin('+', p, q))), v);
        case 'atan2': { const [y, x] = a.a; return bin('/', bin('-', bin('*', x, diff(y, v)), bin('*', y, diff(x, v))), bin('+', bin('^', x, two), bin('^', y, two))); }
      }
      throw new Error(`${a.f}() has no closed-form derivative here.`);
    }
  }
  throw new Error('Can’t differentiate this expression.');
}

/** The n-th derivative, simplified at every step. Throws when the expression swells beyond `limit` nodes. */
export function derivative(a: Ast, v: string, order: number, limit = 6000): Ast {
  let cur = simplify(a);
  for (let i = 0; i < order; i++) {
    cur = simplify(diff(cur, v));
    if (size(cur) > limit) throw new Error('The derivative grows too large to write out.');
  }
  return cur;
}

// ---- antiderivatives --------------------------------------------------------------------------------------------------------

/** If arg is m·v + c with m and c free of v, returns them. */
function linear(arg: Ast, v: string): { m: Ast; c: Ast } | null {
  try {
    const m = simplify(diff(arg, v));
    if (dep(m, v)) return null;
    const c = simplify(bin('-', arg, bin('*', m, V(v))));
    return dep(c, v) ? null : { m, c };
  } catch { return null; }
}
const over = (a: Ast, m: Ast) => (isNum(m) && m.v === 1 ? a : bin('/', a, m));

/** p, p′, p″ … up to the last non-zero derivative, or null when p is not a polynomial in v. */
function polyDerivs(p: Ast, v: string): Ast[] | null {
  const out: Ast[] = [p];
  let cur = p;
  for (let i = 0; i < 10; i++) {
    cur = simplify(diff(cur, v));
    if (isNum(cur) && cur.v === 0) return out;
    out.push(cur);
  }
  return null;
}

/** A closed-form antiderivative (without the constant) for the elementary shapes it knows, or null. */
export function integrate(a0: Ast, v: string, depth = 0): Ast | null {
  const a = simplify(a0);
  if (depth > 12) return null;
  if (!dep(a, v)) return simplify(bin('*', a, V(v)));
  const rec = (x: Ast) => integrate(x, v, depth + 1);
  switch (a.k) {
    case 'num': return null;
    case 'var': return bin('/', bin('^', a, two), two);
    case 'neg': { const r = rec(a.a); return r && neg(r); }
    case 'bin': {
      const { op, a: l, b: r } = a;
      if (op === '+' || op === '-') { const x = rec(l), y = rec(r); return x && y ? bin(op, x, y) : null; }
      if (op === '*') {
        if (!dep(l, v)) { const y = rec(r); return y && bin('*', l, y); }
        if (!dep(r, v)) { const x = rec(l); return x && bin('*', r, x); }
        // polynomial × exp / sin / cos of a linear argument: integrate by parts until the polynomial is used up.
        for (const [p, g] of [[l, r], [r, l]] as [Ast, Ast][]) {
          if (g.k !== 'fn' || !['exp', 'sin', 'cos', 'sinh', 'cosh'].includes(g.f) || !linear(g.a[0], v)) continue;
          const ds = polyDerivs(p, v);
          if (!ds) continue;
          let G: Ast | null = g, total: Ast | null = null;
          for (let k = 0; k < ds.length && G; k++) {
            G = integrate(G, v, depth + 1);
            if (!G) break;
            const term = bin('*', ds[k], G);
            total = total ? bin(k % 2 === 1 ? '-' : '+', total, term) : term;
          }
          if (total && G) return total;
        }
        return null;
      }
      if (op === '/') {
        if (!dep(r, v)) { const x = rec(l); return x && bin('/', x, r); }
        if (!dep(l, v)) {
          const lin = linear(r, v);
          if (lin) return bin('*', l, over(F('ln', F('abs', r)), lin.m));
          // c / (k + u²) with u linear: an arctangent.
          if (r.k === 'bin' && r.op === '+' && isNum(r.a) && r.a.v > 0 && r.b.k === 'bin' && r.b.op === '^' && isNum(r.b.b) && r.b.b.v === 2) {
            const li = linear(r.b.a, v);
            if (li) { const s = Math.sqrt(r.a.v); return bin('*', bin('/', l, N(s)), over(F('atan', bin('/', r.b.a, N(s))), li.m)); }
          }
          if (r.k === 'bin' && r.op === '^') return rec(bin('*', l, bin('^', r.a, neg(r.b))));
          return null;
        }
        return null;
      }
      // power
      if (!dep(r, v)) {
        const lin = linear(l, v);
        if (!lin || !isNum(r)) return null;
        if (r.v === -1) return over(F('ln', F('abs', l)), lin.m);
        return over(bin('/', bin('^', l, N(r.v + 1)), N(r.v + 1)), lin.m);
      }
      if (!dep(l, v)) {
        const lin = linear(r, v);
        if (!lin) return null;
        if (isNum(l) && l.v <= 0) return null;
        return over(bin('/', a, F('ln', l)), lin.m);
      }
      return null;
    }
    case 'fn': {
      const u = a.a[0];
      const lin = a.a.length === 1 ? linear(u, v) : null;
      if (!lin) return null;
      const m = lin.m;
      switch (a.f) {
        case 'sin': return over(neg(F('cos', u)), m);
        case 'cos': return over(F('sin', u), m);
        case 'tan': return over(neg(F('ln', F('abs', F('cos', u)))), m);
        case 'exp': return over(a, m);
        case 'sinh': return over(F('cosh', u), m);
        case 'cosh': return over(F('sinh', u), m);
        case 'tanh': return over(F('ln', F('cosh', u)), m);
        case 'sqrt': return over(bin('*', N(2 / 3), bin('^', u, N(1.5))), m);
        case 'cbrt': return over(bin('*', N(3 / 4), bin('^', u, N(4 / 3))), m);
        case 'square': return over(bin('/', bin('^', u, N(3)), N(3)), m);
        case 'ln': case 'log': return over(bin('-', bin('*', u, F('ln', u)), u), m);
        case 'log10': return over(bin('/', bin('-', bin('*', u, F('ln', u)), u), N(Math.LN10)), m);
        case 'log2': return over(bin('/', bin('-', bin('*', u, F('ln', u)), u), N(Math.LN2)), m);
        case 'atan': return over(bin('-', bin('*', u, F('atan', u)), bin('/', F('ln', bin('+', N(1), bin('^', u, two))), two)), m);
        case 'asin': return over(bin('+', bin('*', u, F('asin', u)), F('sqrt', bin('-', N(1), bin('^', u, two)))), m);
        case 'acos': return over(bin('-', bin('*', u, F('acos', u)), F('sqrt', bin('-', N(1), bin('^', u, two)))), m);
        case 'abs': return over(bin('/', bin('*', u, F('abs', u)), two), m);
      }
      return null;
    }
  }
  return null;
}
