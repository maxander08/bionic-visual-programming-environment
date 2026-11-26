import { describe, expect, it } from 'vitest';
import { Engine } from './engine';
import { addNode, connect, emptyGraph, flatten, setParams } from './graph';
import { CATEGORIES, MODULES, PIN_SPACING, defaultParams, getDef, nodeSize, paramDefsOf, portPosition } from './registry';
import { compileExpr, isEquation } from './equation';
import { analyze, integral, limitAt, sumSeries, type CalcSpec } from './calculus';
import { bind, derivative, integrate, parseExpr, show, simplify, compile } from './calcexpr';
import { calcExprCount, calcParamCount } from './modules/engines';
import type { Graph, Params } from './types';

function build(spec: { nodes: [string, string, Params?][]; wires: [string, string, string, string][] }) {
  let g: Graph = emptyGraph();
  spec.nodes.forEach(([id, type, p], i) => (g = addNode(g, type, i * 300, 0, p ?? {}, undefined, id).graph));
  for (const [a, ap, b, bp] of spec.wires) {
    const r = connect(g, a, ap, b, bp);
    if (r.error) throw new Error(r.error);
    g = r.graph;
  }
  const e = new Engine(50);
  e.load(flatten(g, undefined));
  return { e, g };
}

const base: CalcSpec = {
  mode: 'derivative', exprs: ['x^3 - 3x'], params: [], show: 'both', xMin: -4, xMax: 4, samples: 200, t: 0, target: 1, at: 2, order: 1, wrt: 'x', tangent: false,
  lower: '0', upper: '1', method: 'adaptive', intervals: 100, to: '0', side: 'both', kind: 'sum', start: 1, terms: 100, infinite: true, center: 0, degree: 5, halfPeriod: Math.PI, harmonics: 5,
};
const run = (o: Partial<CalcSpec>) => analyze({ ...base, ...o });

describe('Engines in the library', () => {
  it('has its own section after the Actors, with the Calculus module in it', () => {
    expect(CATEGORIES).toContain('Engines');
    expect(CATEGORIES.indexOf('Engines')).toBe(CATEGORIES.indexOf('Actors') + 1);
    expect(MODULES.filter((m) => m.category === 'Engines').map((m) => m.type)).toEqual(['engine-calculus']);
    expect(MODULES.find((m) => m.type === 'engine-calculus')!.family).toBe('engine');
  });
  it('is a Meter-sized module with an Equation input and a graph output', () => {
    const d = getDef('engine-calculus')!;
    expect(d.size).toBe('square');
    expect(d.inputs[0]).toMatchObject({ id: 'eq', type: 'data', optional: true });
    expect(d.outputs.map((o) => o.id)).toEqual(['eq', 'value', 'values', 'report', 'result']);
    expect(d.outputs.map((o) => o.type)).toEqual(['data', 'num', 'data', 'text', 'text']);
  });
});

describe('open-ended setting pins', () => {
  const pinsOf = (p: Params) => getDef('engine-calculus', undefined, p)!.paramPins!.map((x) => x.param);
  it('starts with one expression and no parameters', () => {
    const p = defaultParams(getDef('engine-calculus')!);
    expect(calcExprCount(p)).toBe(1);
    expect(calcParamCount(p)).toBe(0);
    expect(pinsOf(p)).toContain('f1');
    expect(pinsOf(p)).not.toContain('f2');
  });
  it('gains a pin for every expression and two for every parameter, and loses them again', () => {
    let g = addNode(emptyGraph(), 'engine-calculus', 0, 0, {}, undefined, 'c').graph;
    g = setParams(g, 'c', { fn: 4, pn: 3 });
    const p = g.nodes.c.params;
    expect(p.fn).toBe(4);
    const pins = pinsOf(p);
    for (const k of [1, 2, 3, 4]) expect(pins).toContain(`f${k}`);
    for (const k of [1, 2, 3]) { expect(pins).toContain(`pn${k}`); expect(pins).toContain(`pv${k}`); }
    expect(pins).not.toContain('f5');
    expect(p.pn1).toBe('a');
    expect(p.pn2).toBe('b');
    g = setParams(g, 'c', { fn: 2, pn: 0 });
    const q = pinsOf(g.nodes.c.params);
    expect(q).toContain('f2');
    expect(q).not.toContain('f3');
    expect(q).not.toContain('pn1');
  });
  it('drops the wire of a pin that disappears', () => {
    let g = addNode(emptyGraph(), 'engine-calculus', 0, 0, { fn: 3 }, undefined, 'c').graph;
    g = addNode(g, 'constant', 0, -200, { kind: 'text', value: 'x^2' }, undefined, 'k').graph;
    const r = connect(g, 'k', 'out', 'c', 'p:f3');
    expect(r.error).toBeUndefined();
    expect(Object.keys(r.graph.edges)).toHaveLength(1);
    expect(Object.keys(setParams(r.graph, 'c', { fn: 2 }).edges)).toHaveLength(0);
  });
  it('every setting has a pin of its own, except the two that change the pin set; pins never crowd, however many', () => {
    for (const p of [{}, { fn: 7, pn: 5, mode: 'series', kind: 'taylor' }, { fn: 99, pn: 99, mode: 'integral' }] as Params[]) {
      const d = getDef('engine-calculus', undefined, p)!;
      const resolved = defaultParams(d, p);
      const defs = paramDefsOf(d, { ...resolved, ...p });
      for (const q of defs) {
        const pin = d.inputs.find((i) => i.id === `p:${q.key}`);
        if (q.hidden || q.pin === false) expect(pin, q.key).toBeUndefined();
        else { expect(pin, q.key).toBeDefined(); expect(pin!.param).toBe(q.key); expect(pin!.optional).toBe(true); }
      }
      const node = { id: 'n', type: 'engine-calculus', x: 0, y: 0, params: {} };
      const pts = d.inputs.map((i) => portPosition(node, d, i.id, 'in')!);
      const { w, h } = nodeSize(d);
      expect(w % 12).toBe(0);
      expect(h % 12).toBe(0);
      for (const side of ['top', 'left']) for (const a of pts) for (const b of pts) if (a !== b && a.side === side && b.side === side) expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeGreaterThanOrEqual(PIN_SPACING - 0.001);
    }
  });
  it('shows only the settings of the chosen analysis, and keeps the others', () => {
    const keys = (p: Params) => paramDefsOf(getDef('engine-calculus')!, p).filter((q) => !q.hidden).map((q) => q.key);
    expect(keys({ mode: 'derivative' })).toContain('order');
    expect(keys({ mode: 'derivative' })).not.toContain('lower');
    expect(keys({ mode: 'integral' })).toContain('lower');
    expect(keys({ mode: 'limit' })).toContain('side');
    expect(keys({ mode: 'series', kind: 'taylor' })).toContain('degree');
    expect(keys({ mode: 'series', kind: 'sum' })).not.toContain('degree');
    expect(keys({ mode: 'curve' })).not.toContain('show');
    let g = addNode(emptyGraph(), 'engine-calculus', 0, 0, { order: 3 }, undefined, 'c').graph;
    g = setParams(g, 'c', { mode: 'integral' });
    g = setParams(g, 'c', { mode: 'derivative' });
    expect(g.nodes.c.params.order).toBe(3);
  });
});

describe('running in the graph', () => {
  it('draws the function and its derivative on a Meter, and reports the value', () => {
    const { e } = build({ nodes: [['c', 'engine-calculus', { mode: 'derivative', f1: 'x^2', at: 3 }], ['m', 'meter']], wires: [['c', 'eq', 'm', 'in']] });
    e.runFor(200);
    expect(e.out('c', 'value')).toBeCloseTo(6, 9);
    expect(e.out('c', 'values')).toEqual([6]);
    expect(e.out('c', 'result')).toBe('2*x');
    const eq = e.out('c', 'eq');
    expect(isEquation(eq)).toBe(true);
    expect((eq as { exprs: string[] }).exprs).toEqual(['x^2', '2*x']);
    expect(e.nodes.get('m')!.status.level).toBe('ok');
    expect((e.nodes.get('m')!.viewData as { plot?: { curves: unknown[] } }).plot?.curves).toHaveLength(2);
  });
  it('takes its expressions from an Equation node', () => {
    const { e } = build({ nodes: [['q', 'equation', { expr: 'sin(x); x^2', xMin: -3, xMax: 3 }], ['c', 'engine-calculus', { mode: 'derivative', at: 0 }], ['m', 'meter']], wires: [['q', 'eq', 'c', 'eq'], ['c', 'eq', 'm', 'in']] });
    e.runFor(200);
    expect(e.out('c', 'values')).toEqual([1, 0]);
    const eq = e.out('c', 'eq') as { exprs: string[]; xMin: number; xMax: number };
    expect(eq.exprs).toEqual(['sin(x)', 'cos(x)', 'x^2', '2*x']);
    expect([eq.xMin, eq.xMax]).toEqual([-3, 3]);
  });
  it('chains: the derivative of a derivative', () => {
    const { e } = build({ nodes: [['a', 'engine-calculus', { f1: 'x^4', show: 'result' }], ['b', 'engine-calculus', { show: 'result', at: 1 }]], wires: [['a', 'eq', 'b', 'eq']] });
    e.runFor(200);
    expect(e.out('b', 'result')).toBe('12*x^2');
    expect(e.out('b', 'value')).toBeCloseTo(12, 9);
  });
  it('uses several expressions and parameters, and a setting pin overrides a typed one', () => {
    const { e } = build({
      nodes: [['c', 'engine-calculus', { mode: 'integral', fn: 2, f1: 'a*x', f2: 'x^2', pn: 1, pv1: 2, lower: '0', upper: '3' }], ['v', 'constant', { value: '10' }]],
      wires: [['v', 'out', 'c', 'p:pv1']],
    });
    e.runFor(200);
    expect(e.out('c', 'values')).toEqual([45, 9].map((v) => expect.closeTo(v, 8)));
    expect(e.out('c', 'value')).toBeCloseTo(45, 8);
  });
  it('picks which expression feeds Value with the Output expression setting', () => {
    const { e } = build({ nodes: [['c', 'engine-calculus', { mode: 'limit', fn: 2, f1: 'x+1', f2: 'sin(x)/x', to: '0', target: 2 }]], wires: [] });
    e.runFor(200);
    expect(e.out('c', 'value')).toBeCloseTo(1, 9);
    expect(e.out('c', 'values')).toEqual([1, 1].map((v) => expect.closeTo(v, 9)));
  });
  it('reports an error that names the problem, and recovers when it is fixed', () => {
    const { e, g } = build({ nodes: [['c', 'engine-calculus', { f1: 'sin(' }]], wires: [] });
    e.runFor(100);
    expect(e.nodes.get('c')!.status.level).toBe('error');
    expect(e.out('c', 'value')).toBeUndefined();
    e.load(flatten(setParams(g, 'c', { f1: 'sin(x)' }), undefined));
    e.runFor(100);
    expect(e.nodes.get('c')!.status.level).toBe('ok');
  });
  it('sends no Value for a limit that does not exist, but still reports', () => {
    const { e } = build({ nodes: [['c', 'engine-calculus', { mode: 'limit', f1: 'abs(x)/x', to: '0' }]], wires: [] });
    e.runFor(100);
    expect(e.out('c', 'value')).toBeUndefined();
    expect(String(e.out('c', 'report'))).toMatch(/left/i);
  });
  it('every plotted result can be read by the Equation node’s parser', () => {
    for (const o of [{}, { mode: 'integral', f1: 'exp(-x^2)', lower: '-inf', upper: 'inf' }, { mode: 'series', kind: 'taylor', f1: 'cos(x)' }, { mode: 'series', kind: 'fourier', f1: 'x' }, { mode: 'derivative', f1: 'max(x,0)' }] as Params[]) {
      const { e } = build({ nodes: [['c', 'engine-calculus', o]], wires: [] });
      e.runFor(100);
      const eq = e.out('c', 'eq') as { exprs: string[] };
      for (const s of eq.exprs) expect(compileExpr(s).ok, s).toBe(true);
    }
  });
});

describe('symbolic engine', () => {
  const vs = new Set(['x', 't', 'a']);
  const d = (s: string, o = 1) => show(derivative(parseExpr(s, vs), 'x', o));
  const num = (s: string, x: number, o = 1) => compile(bind(derivative(parseExpr(s, vs), 'x', o), { a: 2 }))({ x, t: 0 });
  it('differentiates exactly', () => {
    expect(d('x^3 - 3x')).toBe('3*x^2 - 3');
    expect(d('x^3 - 3x', 2)).toBe('6*x');
    expect(d('sin(x)*cos(x)')).toBe('cos(x)^2 - sin(x)^2');
    expect(d('ln(x)/x')).toBe('(1 - ln(x))/x^2');
    expect(d('2^x')).toMatch(/2\^x/);
    expect(d('a x^2')).toBe('2*a*x');
  });
  it('agrees with finite differences', () => {
    for (const [s, x] of [['x^x', 1.7], ['atan(x)*exp(-x)', 0.4], ['sqrt(1+x^2)', 2], ['tanh(a*x)', 0.3], ['x/(1+x^2)', -1.2], ['abs(x)^3', 0.9]] as [string, number][]) {
      const f = compile(bind(parseExpr(s, vs), { a: 2 }));
      const h = 1e-6;
      expect(num(s, x)).toBeCloseTo((f({ x: x + h, t: 0 }) - f({ x: x - h, t: 0 })) / (2 * h), 5);
    }
  });
  it('integrates the elementary shapes in closed form, and every answer differentiates back', () => {
    for (const s of ['x^2', '3x - 5', 'sin(2x)', 'exp(3x)', '1/x', '1/(1+x^2)', 'x*exp(x)', 'x^2*sin(x)', 'sqrt(x)', 'cos(x)+x^-2', 'atan(x)', 'ln(x)']) {
      const F = integrate(parseExpr(s, vs), 'x');
      expect(F, s).not.toBeNull();
      const f = compile(parseExpr(s, vs)), back = compile(derivative(F!, 'x', 1));
      expect(back({ x: 1.3, t: 0 }), s).toBeCloseTo(f({ x: 1.3, t: 0 }), 8);
    }
    expect(integrate(parseExpr('exp(-x^2)', vs), 'x')).toBeNull();
  });
  it('simplifies and reads implicit products', () => {
    expect(show(simplify(parseExpr('0*x + 1*x^1 + x*x', vs)))).toBe('x + x^2');
    expect(show(parseExpr('2x(x+1)', vs))).toBe('2*x*(x + 1)');
    expect(show(parseExpr('ax^2', vs))).toBe('a*x^2');
  });
});

describe('numerical results', () => {
  it('integrates proper and improper integrals', () => {
    expect(integral(Math.sin, 0, Math.PI).value).toBeCloseTo(2, 10);
    expect(integral((x) => Math.exp(-x * x), -Infinity, Infinity).value).toBeCloseTo(Math.sqrt(Math.PI), 9);
    expect(integral((x) => 1 / (x * x), 1, Infinity).value).toBeCloseTo(1, 9);
    expect(integral((x) => 1 / Math.sqrt(x), 0, 1).value).toBeCloseTo(2, 6);
    expect(integral((x) => 1 / x, 0, 1).ok).toBe(false);
    expect(integral((x) => x * x, 0, 3, 'simpson', 100).value).toBeCloseTo(9, 10);
    expect(integral((x) => x * x, 0, 3, 'trapezoid', 1000).value).toBeCloseTo(9, 3);
    expect(integral((x) => x * x, 3, 0).value).toBeCloseTo(-9, 10);
  });
  it('finds limits, one-sided limits, infinite limits and limits that do not exist', () => {
    expect(limitAt((x) => Math.sin(x) / x, 0, 0).both).toEqual({ k: 'value', v: 1 });
    expect(limitAt((x) => (x * x - 1) / (x - 1), 1, 0).both).toEqual({ k: 'value', v: 2 });
    expect(limitAt((x) => Math.abs(x) / x, 0, 0).both.k).toBe('dne');
    expect(limitAt((x) => Math.abs(x) / x, 0, 1).both).toEqual({ k: 'value', v: 1 });
    expect(limitAt((x) => 1 / (x * x), 0, 0).both).toEqual({ k: 'inf', s: 1 });
    expect(limitAt((x) => 1 / x, 0, -1).both).toEqual({ k: 'inf', s: -1 });
    expect(limitAt((x) => Math.pow(1 + 1 / x, x), Infinity, 0).both).toMatchObject({ k: 'value' });
    expect((limitAt((x) => Math.pow(1 + 1 / x, x), Infinity, 0).both as { v: number }).v).toBeCloseTo(Math.E, 6);
    expect(limitAt(Math.sin, Infinity, 0).both.k).toBe('dne');
    expect(limitAt((x) => (3 * x * x + 1) / (x * x - 4), -Infinity, 0).both).toEqual({ k: 'value', v: 3 });
    expect(limitAt(Math.log, 0, 1).both).toEqual({ k: 'inf', s: -1 });
  });
  it('sums series and says whether they converge', () => {
    const basel = sumSeries((n) => 1 / (n * n), 1, 100, true);
    expect(basel.verdict).toBe('converges');
    expect(basel.value).toBeCloseTo(Math.PI ** 2 / 6, 6);
    expect(sumSeries((n) => Math.pow(0.5, n), 0, 100, true).value).toBeCloseTo(2, 10);
    const alt = sumSeries((n) => Math.pow(-1, n + 1) / n, 1, 200, true);
    expect(alt.verdict).toBe('converges');
    expect(alt.value).toBeCloseTo(Math.LN2, 6);
    expect(sumSeries((n) => 1 / n, 1, 100, true).verdict).toBe('diverges');
    expect(sumSeries((n) => n / (n + 1), 1, 100, true).verdict).toBe('diverges');
    expect(sumSeries((n) => n, 1, 10, false)).toMatchObject({ value: 55, verdict: 'partial' });
  });
});

describe('analyses', () => {
  it('derivative: symbolic, with the value, the tangent and a partial derivative', () => {
    const r = run({ tangent: true });
    expect(r.value).toBe(9);
    expect(r.exprs).toEqual(['3*x^2 - 3']);
    expect(r.curves).toEqual(['x^3 - 3*x', '3*x^2 - 3', '2 + 9*(x - 2)']);
    const partial = run({ exprs: ['a x^2 + sin(a)'], params: [{ name: 'a', value: 2 }], wrt: 'a', at: 3 });
    expect(partial.value).toBeCloseTo(9 + Math.cos(2), 10);
  });
  it('derivative: falls back to a numerical derivative with a note when there is no closed form', () => {
    const r = run({ exprs: ['max(x, 0)'], at: 2 });
    expect(r.value).toBeCloseTo(1, 6);
    expect(r.exprs).toEqual(['']);
    expect(r.rows.some((x) => x.k === 'Method' && /Numerical/.test(x.v ?? ''))).toBe(true);
  });
  it('integral: antiderivative, definite value, area and mean', () => {
    const r = run({ mode: 'integral', exprs: ['x^2 - 1'], lower: '0', upper: '3' });
    expect(r.value).toBeCloseTo(6, 10);
    expect(r.exprs[0]).toBe('x^3/3 - x');
    expect(r.rows.find((x) => x.k === 'Mean value')?.v).toBe('2');
    expect(run({ mode: 'integral', exprs: ['1/x^2'], lower: '1', upper: 'inf' }).value).toBeCloseTo(1, 9);
    expect(run({ mode: 'integral', exprs: ['sin(a x)'], params: [{ name: 'a', value: 2 }], lower: '0', upper: 'pi/2' }).value).toBeCloseTo(1, 10);
  });
  it('limit: reads bounds with infinity and constants', () => {
    expect(run({ mode: 'limit', exprs: ['(1 - cos(x))/x^2'], to: '0' }).value).toBeCloseTo(0.5, 6);
    expect(run({ mode: 'limit', exprs: ['(2x+1)/(x-3)'], to: 'inf' }).value).toBe(2);
    expect(run({ mode: 'limit', exprs: ['sin(x)/(x - pi)'], to: 'pi' }).value).toBeCloseTo(-1, 6);
    expect(run({ mode: 'limit', exprs: ['1/x'], to: '0' }).value).toBeNull();
  });
  it('series: Taylor and Fourier', () => {
    const t = run({ mode: 'series', kind: 'taylor', exprs: ['exp(x)'], degree: 4, at: 1 });
    expect(t.exprs[0]).toBe('1 + x + x^2/2 + x^3/6 + x^4/24');
    expect(t.value).toBeCloseTo(1 + 1 + 0.5 + 1 / 6 + 1 / 24, 10);
    const f = run({ mode: 'series', kind: 'fourier', exprs: ['x'], harmonics: 30, at: 1 });
    expect(f.value).toBeCloseTo(1, 1);
    expect(run({ mode: 'series', kind: 'taylor', exprs: ['ln(x)'], center: 0 }).error).toMatch(/not defined at x/);
  });
  it('curve analysis: intercepts, extrema, inflection and asymptotes', () => {
    const r = run({ mode: 'curve', exprs: ['x^3 - 3x'], at: 0 });
    const row = (k: string) => r.rows.find((x) => x.k === k)?.v;
    expect(row('x-intercepts')).toBe('-1.732051, 0, 1.732051');
    expect(row('Local maxima')).toBe('(-1, 2)');
    expect(row('Local minima')).toBe('(1, -2)');
    expect(row('Inflection points')).toBe('(0, 0)');
    expect(row('Increasing on')).toBe('[-4, -1] ∪ [1, 4]');
    expect(row('Symmetry')).toMatch(/Odd/);
    const a = run({ mode: 'curve', exprs: ['(x^2 + 1)/x'], xMin: -6, xMax: 6 });
    expect(a.rows.find((x) => x.k === 'Vertical asymptotes')?.v).toBe('x = 0');
    expect(a.rows.find((x) => x.k === 'Slant asymptotes')?.v).toBe('y = x (x → ∞), y = x (x → -∞)');
    expect(run({ mode: 'curve', exprs: ['1/(x-1)'] }).rows.find((x) => x.k === 'Vertical asymptotes')?.v).toBe('x = 1');
    expect(run({ mode: 'curve', exprs: ['exp(-x^2)'] }).rows.find((x) => x.k === 'Horizontal asymptotes')?.v).toContain('y = 0');
  });
  it('rejects bad parameters and bad bounds', () => {
    expect(run({ params: [{ name: 'sin', value: 1 }] }).error).toMatch(/cannot be used/);
    expect(run({ params: [{ name: 'a', value: 1 }, { name: 'a', value: 2 }] }).error).toMatch(/Two parameters/);
    expect(run({ params: [{ name: '', value: 1 }] }).error).toMatch(/no name/);
    expect(run({ mode: 'integral', upper: 'foo' }).error).toMatch(/cannot be used as a bound/);
    expect(run({ exprs: ['x +'] }).error).toMatch(/ends too early/);
    expect(run({ exprs: ['   ', ''] }).error).toMatch(/Enter an expression/);
    expect(run({ xMin: 3, xMax: 1 }).error).toMatch(/x max/);
  });
});
