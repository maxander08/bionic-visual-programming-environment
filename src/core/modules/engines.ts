import type { ModuleDef, ParamDef, Params } from '../types';
import { compileExpr, isEquation, samplePlot, type EquationData } from '../equation';
import { CALC_MODES, SUB, analyze, rowText, type CalcMode, type CalcSpec } from '../calculus';
import { bol, inp, num, out, sel, txt } from './kit';

// The Engines section: modules that carry out a whole field of mathematics. They look like a Meter (a graph on the face, the
// latest number in the title row) and take their settings from the inspector or, one pin per setting, from signals.
//
// The Calculus Engine is open-ended. It holds any number of expressions (ƒ₁, ƒ₂, …) and any number of named parameters (a, b, c…);
// each expression, and each parameter's name and value, is a setting like any other and so has its own setting pin. The number of
// expressions and of parameters are themselves settings, changed with the + and − buttons on the module (or in the inspector).

/** The most expressions, and the most parameters, one Calculus Engine holds. */
export const CALC_MAX_ITEMS = 99;

const clampCount = (v: unknown, lo: number, hi: number, def: number) => {
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : def;
};
export const calcExprCount = (p: Params) => clampCount(p.fn, 1, CALC_MAX_ITEMS, 1);
export const calcParamCount = (p: Params) => clampCount(p.pn, 0, CALC_MAX_ITEMS, 0);
export const calcMode = (p: Params): CalcMode => (CALC_MODES.includes(p.mode as CalcMode) ? (p.mode as CalcMode) : 'derivative');

const POOL = 'abcdfghkmpqrsuvwyz'.split('');
/** The name a new parameter starts with: a, b, c, d, f … (never e, t, x or n, which mean something). */
export const defaultParamName = (k: number) => (k <= POOL.length ? POOL[k - 1] : `p${k}`);

const FN_DOC = 'Write it in x (and t, the simulation time in seconds, and the names of the parameters). Functions are the Equation node’s, plus sec, csc, cot and the factorial n!. Constants: pi, e, tau, phi. A leading “y =” is allowed.';

/**
 * Every setting of the engine, in the order of its pins. Settings of the other modes are kept (a value typed for one mode is still
 * there after a visit to another) but hidden, so they have neither an inspector row nor a setting pin. `all` lists every one, for the
 * documentation.
 */
function calculusParams(p: Params, all = false): ParamDef[] {
  const mode = calcMode(p);
  const kind = ['sum', 'taylor', 'fourier'].includes(String(p.kind)) ? String(p.kind) : 'sum';
  const nf = calcExprCount(p), np = calcParamCount(p);
  const when = (on: boolean, d: ParamDef): ParamDef => (all || on ? d : { ...d, hidden: true });
  const m = (...modes: CalcMode[]) => modes.includes(mode);
  const list: ParamDef[] = [
    sel('mode', 'Analysis', 'derivative', [['derivative', 'Derivative'], ['integral', 'Integral'], ['limit', 'Function limit'], ['series', 'Series'], ['curve', 'Curve analysis']],
      'What to work out: a derivative, an integral, a limit, a series (a sum, a Taylor series or a Fourier series) or a full curve analysis. Each choice has its own settings; the settings of the others are kept but hidden.'),
    { ...num('fn', 'Expressions', 1, 1, CALC_MAX_ITEMS, 1, 'How many expressions the module holds, from 1 to 99. Each has its own pin (ƒ₁, ƒ₂ …). Change it with the + and − buttons on the module, or type a number here. Removing an expression drops its pin and its text.'), pin: false },
  ];
  for (let k = 1; k <= nf; k++) {
    list.push(txt(`f${k}`, `ƒ${SUB(k)}(x)`, k === 1 ? 'x^3 - 3x' : '', `Expression ƒ${SUB(k)}. ${FN_DOC} An empty expression is skipped.`, { maxLength: 400, placeholder: 'y = sin(x)' }));
  }
  list.push({ ...num('pn', 'Parameters', 0, 0, CALC_MAX_ITEMS, 1, 'How many named parameters the module holds, from 0 to 99. A parameter is a number with a name (a, b, c …) that every expression can use, and that a signal can change while the program runs. Change it with the “p” buttons on the module, or type a number here. Removing a parameter drops its pins.'), pin: false });
  for (let k = 1; k <= np; k++) {
    list.push(txt(`pn${k}`, `Name of parameter ${k}`, defaultParamName(k), `The name of parameter ${k}: letters, digits and _, starting with a letter. Use it in the expressions, for example a*x^2. Names such as x, t, pi or sin are taken.`, { maxLength: 20 }));
    list.push(num(`pv${k}`, `Value of parameter ${k}`, 1, -1e9, 1e9, 0.1, `The number parameter ${k} stands for in every expression.`));
  }
  list.push(
    when(m('derivative', 'integral', 'series'), sel('show', 'Draw', 'both', [['both', 'Function and result'], ['result', 'Result only'], ['function', 'Function only']],
      'What goes on the graph: the function and its result, only the result, or only the function. Choose “Result only” when another Calculus Engine or a Meter should work on the result alone.')),
    num('xMin', 'x min', -4, -1e6, 1e6, 0.1, 'Left edge of the graph, and the stretch of x the curve analysis looks at. While an Equation is connected, its range is used instead.'),
    num('xMax', 'x max', 4, -1e6, 1e6, 0.1, 'Right edge of the graph. Must be greater than x min. While an Equation is connected, its range is used instead.'),
    bol('yAuto', 'Auto y range', true, 'Fit the vertical range to the curves (ignoring asymptotes). Off: use y min and y max.'),
    num('yMin', 'y min', -10, -1e6, 1e6, 0.1, 'Bottom edge of the graph when Auto y range is off.'),
    num('yMax', 'y max', 10, -1e6, 1e6, 0.1, 'Top edge of the graph when Auto y range is off.'),
    num('samples', 'Samples', 200, 20, 2000, 10, 'Points computed per curve. More points draw sharper curves.'),
    num('target', 'Output expression', 1, 1, CALC_MAX_ITEMS, 1, 'The number of the expression whose result goes to the Value output (1 is ƒ₁). The Values output lists the results of all of them.'),
    when(m('derivative') || (m('series') && kind !== 'sum') || m('curve'), num('at', 'Point x', 0, -1e6, 1e6, 0.1, 'The x at which the result is evaluated: the value of the derivative, of the curve, or of the Taylor or Fourier series.')),
    // derivative
    when(m('derivative'), num('order', 'Order', 1, 1, 10, 1, 'Which derivative: 1 is the first derivative, 2 the second, and so on up to the tenth.')),
    when(m('derivative'), txt('wrt', 'Differentiate by', 'x', 'The variable to differentiate with respect to: x, t, or the name of a parameter (a partial derivative).', { maxLength: 20 })),
    when(m('derivative'), bol('tangent', 'Tangent line', false, 'Also draw the tangent line to each function at the point x.')),
    // integral
    when(m('integral'), txt('lower', 'Lower bound', '0', 'The lower bound: a number, an expression of the parameters such as pi/2, or -inf for an improper integral.', { maxLength: 40 })),
    when(m('integral'), txt('upper', 'Upper bound', '1', 'The upper bound: a number, an expression of the parameters such as pi/2, or inf for an improper integral.', { maxLength: 40 })),
    when(m('integral'), sel('method', 'Method', 'adaptive', [['adaptive', 'Adaptive (Gauss–Kronrod)'], ['simpson', 'Simpson’s rule'], ['trapezoid', 'Trapezoid rule'], ['midpoint', 'Midpoint rule']],
      'How the definite integral is computed. The adaptive rule is the most accurate and handles improper integrals; the others are the classic fixed-step rules and use the number of intervals below.')),
    when(m('integral'), num('intervals', 'Intervals', 100, 2, 100000, 1, 'How many equal steps the Simpson, trapezoid and midpoint rules use. Ignored by the adaptive rule.')),
    // limit
    when(m('limit'), txt('to', 'x approaches', '0', 'The point x approaches: a number, an expression of the parameters, or inf / -inf for a limit at infinity.', { maxLength: 40 })),
    when(m('limit'), sel('side', 'Side', 'both', [['both', 'Both sides'], ['left', 'From the left'], ['right', 'From the right']], 'Which side to approach from. Both sides must agree for a two-sided limit to exist.')),
    // series
    when(m('series'), sel('kind', 'Series', 'sum', [['sum', 'Sum of terms'], ['taylor', 'Taylor series'], ['fourier', 'Fourier series']],
      'A sum of terms Σ ƒ(n) written in n, the Taylor polynomial of the function about a point, or its Fourier series on a symmetric interval.')),
    when(m('series') && kind === 'sum', num('start', 'First n', 1, -1e6, 1e6, 1, 'The first value of n in the sum. The expression is the general term, written in n.')),
    when(m('series') && kind === 'sum', num('terms', 'Terms', 100, 2, 20000, 1, 'How many terms are added. An infinite series is also estimated beyond them.')),
    when(m('series') && kind === 'sum', bol('infinite', 'Infinite series', true, 'Treat the sum as infinite: test whether it converges and estimate its value. Off: add exactly the terms given.')),
    when(m('series') && kind === 'taylor', num('center', 'Centre a', 0, -1e6, 1e6, 0.1, 'The point the Taylor polynomial is built around (a = 0 gives a Maclaurin series).')),
    when(m('series') && kind === 'taylor', num('degree', 'Degree', 5, 0, 16, 1, 'The highest power of the Taylor polynomial.')),
    when(m('series') && kind === 'fourier', num('halfPeriod', 'Half period L', Math.PI, 0.001, 1e6, 0.1, 'The Fourier series is built on the interval from −L to L and repeats with period 2L.')),
    when(m('series') && kind === 'fourier', num('harmonics', 'Harmonics', 5, 1, 60, 1, 'How many sine and cosine pairs the Fourier series has.')),
  );
  return list;
}

/** Everything the analysis needs, read from the settings in effect. */
function specOf(c: { str(k: string): string; num(k: string): number; bool(k: string): boolean; params: Params }, eq: EquationData | undefined, pinned: (k: string) => boolean): CalcSpec {
  const p = c.params;
  const nf = calcExprCount(p), np = calcParamCount(p);
  const exprs = eq ? eq.exprs.slice() : Array.from({ length: nf }, (_, k) => c.str(`f${k + 1}`));
  const params = Array.from({ length: np }, (_, k) => ({ name: c.str(`pn${k + 1}`), value: c.num(`pv${k + 1}`) }));
  // An Equation that is connected supplies the expressions and the plot range, unless a setting pin is driving that setting.
  const win = (key: 'xMin' | 'xMax' | 'yMin' | 'yMax' | 'yAuto' | 'samples') => (eq && !pinned(key) ? eq[key] : undefined);
  return {
    mode: calcMode(p), exprs, params,
    show: c.str('show') as CalcSpec['show'],
    xMin: (win('xMin') as number | undefined) ?? c.num('xMin'), xMax: (win('xMax') as number | undefined) ?? c.num('xMax'),
    samples: (win('samples') as number | undefined) ?? c.num('samples'),
    t: 0, target: c.num('target'), at: c.num('at'), order: c.num('order'), wrt: c.str('wrt'), tangent: c.bool('tangent'),
    lower: c.str('lower'), upper: c.str('upper'), method: c.str('method') as CalcSpec['method'], intervals: c.num('intervals'),
    to: c.str('to'), side: c.str('side') as CalcSpec['side'],
    kind: c.str('kind') as CalcSpec['kind'], start: c.num('start'), terms: c.num('terms'), infinite: c.bool('infinite'),
    center: c.num('center'), degree: c.num('degree'), halfPeriod: c.num('halfPeriod'), harmonics: c.num('harmonics'),
  };
}

const calculus: ModuleDef = {
  type: 'engine-calculus', name: 'Calculus', caption: 'Calculus Engine', category: 'Engines', family: 'engine', glyph: 'f′', size: 'square', source: true,
  keywords: 'calculus derivative differentiate slope tangent integral antiderivative area limit series sum taylor maclaurin fourier convergence curve analysis extrema maxima minima inflection asymptote roots equation expression parameter math engine',
  inputs: [inp('eq', 'Equation', 'data', 'An Equation: the Equation output of an Equation node, or of another Calculus Engine. While it is connected, its expressions and its x and y range replace the ones set here.', 'top', true)],
  outputs: [
    out('eq', 'Equation', 'data', 'The functions and their results as an Equation (the expressions, the plot range and the time). Connect it to a Meter to draw the graph, or to another Calculus Engine to work on it again.', 'bottom'),
    out('value', 'Value', 'num', 'The number the analysis finds for the Output expression: the derivative at the point, the definite integral, the limit, the sum or the series’ value, or the curve’s value at the point. Nothing is sent when there is no such number (a limit that does not exist, a series that diverges).', 'right'),
    out('values', 'Values', 'data', 'The same number for every expression, as a list in the order of the expressions. An expression with no such number gives null.', 'right'),
    out('report', 'Report', 'text', 'The whole analysis written out in lines: the result for every expression, including what the curve analysis finds (intercepts, extrema, inflection points, asymptotes, intervals).', 'right'),
    out('result', 'Result', 'text', 'The result of each expression written as an expression, one per line: the derivative, the antiderivative, the Taylor or Fourier polynomial, or the limit.', 'right'),
  ],
  params: calculusParams({}, true),
  dynamicParams: (p) => calculusParams(p),
  run(c) {
    const raw = c.has('eq') ? c.get('eq') : undefined;
    if (c.has('eq') && !isEquation(raw)) { c.view({}); return c.fail('The Equation pin needs an Equation: connect the Equation output of an Equation node or of another Calculus Engine.'); }
    const eq = raw as EquationData | undefined;
    const spec = specOf(c, eq, (k) => c.has('p:' + k));
    spec.t = eq ? eq.t : c.time / 1000;
    const r = analyze(spec);
    if (r.error) { c.view({}); return c.fail(r.error); }
    // The Meter reads equations with the Equation node's parser, which has no n! and no parameters: results it cannot read stay off the graph.
    const sumMode = spec.mode === 'series' && spec.kind === 'sum';
    const drawn = r.curves.map((s) => (sumMode ? s.replace(/\bn\b/g, 'x') : s)).filter((s) => compileExpr(s).ok);
    if (drawn.length < r.curves.length) c.warn('Some results cannot be drawn on a graph; they are still in the Report and Result outputs.');
    const yAuto = eq && !c.has('p:yAuto') ? eq.yAuto : c.bool('yAuto');
    const data: EquationData | undefined = drawn.length ? {
      kind: 'equation', exprs: drawn, xMin: spec.xMin, xMax: spec.xMax,
      yMin: eq && !c.has('p:yMin') ? eq.yMin : c.num('yMin'), yMax: eq && !c.has('p:yMax') ? eq.yMax : c.num('yMax'), yAuto,
      samples: spec.samples, t: spec.t,
    } : undefined;
    const plot = data ? samplePlot(data) : undefined;
    c.emit('eq', data);
    c.emit('value', r.value ?? undefined);
    c.emit('values', r.values);
    c.emit('report', r.rows.map((row) => { const t = rowText(row); return t.label ? `${t.label}: ${t.value}` : t.value; }).join('\n'));
    c.emit('result', r.exprs.filter(Boolean).join('\n') || undefined);
    c.view({ plot: plot && plot.ok ? plot.plot : undefined, short: r.short, rows: r.rows, mode: spec.mode, count: r.values.length });
    if (r.usesT) c.wake(c.tickMs);
  },
  doc: {
    summary: 'All of calculus in one module: derivatives, integrals, limits, series and curve analysis, on as many expressions and with as many parameters as you like.',
    runtime: 'The module holds a list of expressions (ƒ₁, ƒ₂ …) and a list of named parameters (a, b, c …). Both lists are open-ended: the + and − buttons that appear on the module when it is hovered or selected add and remove an expression (the ƒ buttons) or a parameter (the p buttons), and every expression, parameter name and parameter value is a setting with its own setting pin, like every other setting. The Analysis setting chooses the topic. Derivative: exact symbolic derivatives of any order, with respect to x, t or a parameter, with the value at a point and an optional tangent line. Integral: a closed-form antiderivative where one is known, and the definite integral by adaptive Gauss–Kronrod (improper bounds included) or by Simpson, trapezoid or midpoint steps. Limit: two-sided and one-sided limits at a point or at infinity, saying so when the limit is infinite or does not exist. Series: a sum of terms with its convergence test and estimated value, the Taylor polynomial about any point, or the Fourier series on −L…L. Curve analysis: domain gaps, symmetry, intercepts, local maxima and minima, inflection points, vertical, horizontal and slant asymptotes, intervals of increase and of concavity, and the area and arc length over the window. The face is a graph like a Meter’s, with the latest number in the title row; the Equation output carries the functions and their results, so a Meter draws them. An Equation connected to the Equation pin replaces the typed expressions and the plot range. Expressions that use t are recomputed every tick.',
    errors: [
      'An expression that cannot be parsed raises an error that names the problem.',
      'A parameter whose name is empty, repeated or already taken (x, t, pi, sin…) raises an error.',
      'A bound or limit point that is not a number raises an error.',
      'A function with no closed-form derivative (min, max, clamp, n!) is differentiated numerically, up to the fourth order.',
      'A limit that does not exist, a series that diverges or an integral that does not converge sends nothing to Value and says so in the Report.',
    ],
    examples: ['x^3 - 3x with Curve analysis: roots at 0 and ±√3, a maximum at −1, a minimum at 1, an inflection point at 0.', 'sin(x)/x with Limit, x approaches 0: the limit is 1.', '1/n^2 with Series, Sum of terms: converges to π²/6.', 'a*exp(-b*x) with two parameters and Integral from 0 to inf: a/b.', 'An Equation node wired to the Equation pin and the Equation output wired to a Meter: the derivative drawn beside the function.'],
  },
};

export const engines: ModuleDef[] = [calculus];
