import { describe, expect, it } from 'vitest';
import { Engine } from './engine';
import { addNode, connect, createCompound, disconnect, emptyGraph, flatten, setParams } from './graph';
import { TEMPLATES, builtinCompounds } from './library';
import { MODULES, getDef } from './registry';
import { decodeShare, encodeShare, newProject, parseProjectJSON, serializeProject, validateProject } from './project';
import type { CompoundDef, Graph, Params } from './types';
import { compileExpr, isEquation, niceTicks, samplePlot, splitEquations } from './equation';

function build(spec: { nodes: [string, string, Params?][]; wires: [string, string, string, string][]; compounds?: Record<string, CompoundDef> }) {
  let g: Graph = emptyGraph();
  spec.nodes.forEach(([id, type, p], i) => (g = addNode(g, type, i * 156, 0, p ?? {}, spec.compounds, id).graph));
  for (const [a, ap, b, bp] of spec.wires) {
    const r = connect(g, a, ap, b, bp, spec.compounds);
    if (r.error) throw new Error(r.error);
    g = r.graph;
  }
  const e = new Engine(50);
  e.load(flatten(g, spec.compounds));
  return { e, g };
}

describe('registry', () => {
  it('every module has a unique type, documented ports and params', () => {
    const types = new Set<string>();
    for (const m of MODULES) {
      expect(types.has(m.type)).toBe(false);
      types.add(m.type);
      expect(m.doc.summary.length).toBeGreaterThan(5);
      [...m.inputs, ...m.outputs].forEach((p) => expect(p.doc.length).toBeGreaterThan(2));
      m.params.forEach((p) => expect(p.doc.length).toBeGreaterThan(2));
    }
  });
  it('creates modules with default and clamped parameters', () => {
    const g = addNode(emptyGraph(), 'threshold', 3, 5, { threshold: 1e9, mode: 'bogus' }).graph;
    const n = Object.values(g.nodes)[0];
    expect(n.params.threshold).toBe(1e6);
    expect(n.params.mode).toBe('above');
    expect(n.x % 12).toBe(0);
  });
});

describe('connections', () => {
  it('rejects incompatible port types and unknown ports', () => {
    let g = addNode(emptyGraph(), 'info', 0, 0, {}, undefined, 'i').graph;
    g = addNode(g, 'threshold', 0, 100, {}, undefined, 't').graph;
    const bad = connect(g, 'i', 'text', 't', 'in');
    expect(bad.error).toMatch(/text/);
    expect(connect(g, 'i', 'nope', 't', 'in').error).toBeTruthy();
    expect(connect(g, 'i', 'number', 't', 'in').error).toBeUndefined();
  });
  it('lets an input have one driver and removes connections cleanly', () => {
    let g = addNode(emptyGraph(), 'constant', 0, 0, {}, undefined, 'a').graph;
    g = addNode(g, 'constant', 0, 0, {}, undefined, 'b').graph;
    g = addNode(g, 'add', 0, 0, {}, undefined, 'c').graph;
    g = connect(g, 'a', 'out', 'c', 'a').graph;
    const r = connect(g, 'b', 'out', 'c', 'a');
    expect(r.replaced).toBeTruthy();
    expect(Object.keys(r.graph.edges)).toHaveLength(1);
    expect(Object.keys(disconnect(r.graph, r.edge!.id).edges)).toHaveLength(0);
  });
});

describe('signal propagation and basic modules', () => {
  it('propagates through a chain in one tick', () => {
    const { e } = build({ nodes: [['c', 'constant', { value: '4' }], ['m', 'mul', { factor: 3 }], ['p', 'add', { offset: 1 }]], wires: [['c', 'out', 'm', 'a'], ['m', 'out', 'p', 'a']] });
    e.step();
    expect(e.out('p', 'out')).toBe(13);
  });
  it('remaps with Plastic Nerve', () => {
    const { e } = build({ nodes: [['c', 'constant', { value: '0.25' }], ['p', 'plastic', { outMax: 100 }]], wires: [['c', 'out', 'p', 'in']] });
    e.step();
    expect(e.out('p', 'out')).toBe(25);
  });
  it('applies threshold hysteresis', () => {
    const { e } = build({ nodes: [['i', 'info', { text: '0.55' }], ['t', 'threshold', { threshold: 0.5, hysteresis: 0.1 }]], wires: [['i', 'number', 't', 'in']] });
    e.step();
    expect(e.out('t', 'over')).toBe(true);
    e.command('i', 'x');
    e.nodes.get('i')!.params = { text: '0.45' };
    e.inject('i', {});
    e.step();
    expect(e.out('t', 'over')).toBe(true); // within hysteresis
    e.nodes.get('i')!.params = { text: '0.39' };
    e.inject('i', {});
    e.step();
    expect(e.out('t', 'over')).toBe(false);
  });
  it('keeps a module idle while a required input is missing', () => {
    const { e } = build({ nodes: [['m', 'mul']], wires: [] });
    e.run(3);
    expect(e.out('m', 'out')).toBeUndefined();
    expect(e.missingInputs('m')).toEqual(['A']);
  });
  it('coerces number to boolean across a connection', () => {
    const { e } = build({ nodes: [['c', 'constant', { value: '3' }], ['v', 'invert']], wires: [] });
    e.step();
    expect(e.out('c', 'out')).toBe(3);
  });
  it('propagates errors downstream', () => {
    const { e } = build({ nodes: [['c', 'constant', { value: '-4' }], ['s', 'math', { fn: 'sqrt' }], ['a', 'add']], wires: [['c', 'out', 's', 'a'], ['s', 'out', 'a', 'a']] });
    e.run(2);
    expect(e.nodes.get('s')!.status.level).toBe('error');
    expect(e.out('a', 'out')).toBeUndefined();
    expect(e.diagnostics().some((d) => d.nodeId === 'a' && d.level === 'warn')).toBe(true);
  });
});

describe('state, memory, reward, timing', () => {
  it('Memory traces values and forgets', () => {
    const { e } = build({ nodes: [['c', 'constant', { value: '10' }], ['m', 'memory', { remember: 1 }]], wires: [['c', 'out', 'm', 'in']] });
    e.step();
    expect(e.out('m', 'recall')).toBe(10);
    const h = build({ nodes: [['c', 'constant', { value: '1' }], ['m', 'memory', { remember: 0.5 }]], wires: [['c', 'out', 'm', 'in']] });
    h.e.step();
    expect(h.e.out('m', 'recall')).toBe(0.5);
  });
  it('Reward = gain·goal − costWeight·cost and learns expectation', () => {
    const { e } = build({ nodes: [['g', 'constant', { value: '0.5' }], ['k', 'constant', { value: '0.2' }], ['r', 'reward', { gain: 2, costWeight: 0.5, learn: 0.5 }]], wires: [['g', 'out', 'r', 'goal'], ['k', 'out', 'r', 'cost']] });
    e.step();
    expect(e.out('r', 'reward')).toBeCloseTo(0.9, 6);
    expect(e.out('r', 'error')).toBeCloseTo(0.9, 6);
    expect(e.out('r', 'expected')).toBeCloseTo(0.45, 6);
  });
  it('Delay shifts values by the configured time', () => {
    const { e } = build({ nodes: [['c', 'constant', { value: '7' }], ['d', 'delay', { ms: 200 }]], wires: [['c', 'out', 'd', 'in']] });
    e.step();
    expect(e.out('d', 'out')).toBeUndefined();
    e.run(2);
    expect(e.out('d', 'out')).toBeUndefined();
    e.run(2);
    expect(e.out('d', 'out')).toBe(7);
  });
  it('Counter counts pulses and State follows events', () => {
    const { e } = build({ nodes: [['p', 'pulse', { period: 100, width: 50 }], ['c', 'counter', { max: 99 }], ['s', 'state']], wires: [['p', 'out', 'c', 'inc'], ['p', 'out', 's', 'event']] });
    e.runFor(450);
    expect(e.out('c', 'out')).toBeGreaterThanOrEqual(3);
    expect(['idle', 'active', 'done']).toContain(e.out('s', 'state'));
    expect(e.out('s', 'state')).not.toBe('idle');
  });
  it('Firing Rate Control limits emissions', () => {
    const { e } = build({ nodes: [['r', 'random', { rate: 20, seed: 3 }], ['f', 'firing', { rate: 2 }], ['c', 'counter', { max: 9999 }]], wires: [['f', 'out', 'c', 'inc'], ['r', 'out', 'f', 'in']] });
    e.runFor(2000);
    const n = e.out('c', 'out') as number;
    expect(n).toBeGreaterThan(2);
    expect(n).toBeLessThanOrEqual(5);
  });
  it('Envelope follows attack and release', () => {
    const { e } = build({ nodes: [['sw', 'switch', { on: true }], ['v', 'envelope', { attack: 100, decay: 100, sustain: 0.5, release: 200 }]], wires: [['sw', 'on', 'v', 'gate']] });
    e.runFor(150);
    expect(e.out('v', 'out') as number).toBeGreaterThan(0.8);
    e.runFor(400);
    expect(e.out('v', 'out')).toBeCloseTo(0.5, 2);
    e.nodes.get('sw')!.params = { on: false };
    e.inject('sw', {});
    e.runFor(300);
    expect(e.out('v', 'out')).toBe(0);
  });
  it('Hyponerve emits only on rule match; Nap enforces a refractory period', () => {
    const { e } = build({ nodes: [['s', 'sequence', { values: '1, 1, 2', auto: 100 }], ['h', 'hyponerve', { rule: 'change' }], ['c', 'counter', { max: 99 }]], wires: [['s', 'out', 'h', 'in'], ['h', 'out', 'c', 'inc']] });
    e.runFor(1000);
    expect(e.out('c', 'out')).toBeGreaterThan(0);
    const n = build({ nodes: [['p', 'pulse', { period: 100, width: 50 }], ['n', 'nap', { duration: 350 }], ['c', 'counter', { max: 99 }]], wires: [['p', 'out', 'n', 'in'], ['n', 'out', 'c', 'inc']] });
    n.e.runFor(1000);
    const cnt = n.e.out('c', 'out') as number;
    expect(cnt).toBeGreaterThanOrEqual(2);
    expect(cnt).toBeLessThanOrEqual(3);
  });
  it('Hypernerve resolves by priority and override', () => {
    const { e } = build({ nodes: [['a', 'constant', { value: '1' }], ['c', 'constant', { value: '9' }], ['h', 'hypernerve', { policy: 'override' }]], wires: [['a', 'out', 'h', 'a'], ['c', 'out', 'h', 'c']] });
    e.step();
    expect(e.out('h', 'out')).toBe(9);
    expect(e.out('h', 'winner')).toBe('c');
  });
});

describe('feedback, cycles, scheduling', () => {
  it('allows feedback through a delaying module and defers the closing edge', () => {
    const t = TEMPLATES.find((x) => x.id === 'thermostat')!.build();
    const e = new Engine(50);
    e.load(flatten(t.graph, t.compounds));
    expect(e.edges.some((x) => x.deferred)).toBe(true);
    expect(e.diagnostics().filter((d) => d.level === 'error')).toHaveLength(0);
    e.runFor(20000);
    const temp = e.out('plant', 'out') as number;
    expect(temp).toBeGreaterThan(0.5);
    expect(temp).toBeLessThan(0.8);
  });
  it('blocks and reports unbounded cycles', () => {
    const { e } = build({ nodes: [['c', 'constant', { value: '1' }], ['a', 'add'], ['b', 'mul']], wires: [['c', 'out', 'a', 'a'], ['a', 'out', 'b', 'a'], ['b', 'out', 'a', 'b']] });
    expect(e.edges.some((x) => x.blocked)).toBe(true);
    expect(e.diagnostics().some((d) => d.level === 'error' && /Unbounded cycle/.test(d.message))).toBe(true);
    e.run(10);
    expect(e.stats.evalsLastTick).toBeLessThan(10);
  });
  it('is deterministic for the same seed and independent of wall clock', () => {
    const run = () => {
      const { e } = build({ nodes: [['r', 'random', { seed: 11, rate: 10 }]], wires: [] });
      const seen: unknown[] = [];
      for (let i = 0; i < 20; i++) { e.step(); seen.push(e.out('r', 'out')); }
      return seen;
    };
    expect(run()).toEqual(run());
  });
  it('re-evaluates only what changed', () => {
    const { e } = build({ nodes: [['c', 'constant', { value: '1' }], ['a', 'add'], ['m', 'mul']], wires: [['c', 'out', 'a', 'a'], ['a', 'out', 'm', 'a']] });
    e.step();
    expect(e.stats.evalsLastTick).toBe(3);
    e.step();
    expect(e.stats.evalsLastTick).toBe(0);
  });
  it('edge delay and weight shape the connection', () => {
    let { g } = build({ nodes: [['c', 'constant', { value: '1' }], ['m', 'mul']], wires: [['c', 'out', 'm', 'a']] });
    const id = Object.keys(g.edges)[0];
    g = { ...g, edges: { ...g.edges, [id]: { ...g.edges[id], delay: 100, weight: 0.5 } } };
    const e = new Engine(50);
    e.load(flatten(g));
    e.step();
    expect(e.out('m', 'out')).toBeUndefined();
    e.run(2);
    expect(e.out('m', 'out')).toBe(1);
    expect(e.outSig('c', 'out')!.s).toBe(1);
    expect(e.nodes.get('m')!.inputs.a!.s).toBe(0.5);
  });
});

describe('compounds', () => {
  it('creates a compound from a selection and executes identically', () => {
    let { g } = build({ nodes: [['c', 'constant', { value: '2' }], ['m', 'mul', { factor: 5 }], ['a', 'add', { offset: 1 }]], wires: [['c', 'out', 'm', 'a'], ['m', 'out', 'a', 'a']] });
    const r = createCompound(g, ['m'], 'Scale', {});
    if ('error' in r) throw new Error(r.error);
    expect(r.def.inputs).toHaveLength(1);
    expect(r.def.outputs).toHaveLength(1);
    g = r.graph;
    const comps = { [r.def.id]: r.def };
    expect(g.nodes[r.nodeId].type).toBe('compound');
    const e = new Engine(50);
    e.load(flatten(g, comps));
    e.step();
    expect(e.out('a', 'out')).toBe(11);
    expect(getDef('compound', comps, { def: r.def.id })!.inputs).toHaveLength(1);
  });
  it('built-in compounds run inside templates', () => {
    const t = TEMPLATES.find((x) => x.id === 'apparatus')!.build();
    const e = new Engine(50);
    e.load(flatten(t.graph, t.compounds));
    e.runFor(3500);
    expect(['off', 'on']).toContain(e.out('tog/m', 'state'));
    expect(['A', 'B']).toContain(e.out('dec/pick', 'label'));
    expect(builtinCompounds().length).toBe(4);
  });
  it('exposed parameters override inner settings', () => {
    const t = TEMPLATES.find((x) => x.id === 'apparatus')!.build();
    let g = setParams(t.graph, 'dec', { labels: 'Left, Right' }, t.compounds);
    const e = new Engine(50);
    e.load(flatten(g, t.compounds));
    e.runFor(2500);
    expect(['Left', 'Right']).toContain(e.out('dec/pick', 'label'));
  });
});

describe('templates', () => {
  for (const t of TEMPLATES)
    it(`template “${t.name}” builds and runs without errors`, () => {
      const p = t.build();
      expect(Object.keys(p.graph.nodes).length).toBeGreaterThan(3);
      expect(Object.keys(p.graph.edges).length).toBeGreaterThan(2);
      const e = new Engine(50);
      e.load(flatten(p.graph, p.compounds));
      e.runFor(6000);
      expect(e.diagnostics().filter((d) => d.level === 'error')).toEqual([]);
      const idle = [...e.nodes.values()].filter((n) => n.def.outputs.length === 0 && n.def.inputs.length > 0 && n.evals === 0);
      expect(idle.map((n) => n.id)).toEqual([]);
    });
  it('ML packages: unavailable package reports an error instead of faking output', () => {
    const { e } = build({ nodes: [['v', 'vision'], ['k', 'knowledge', { package: 'image-mobilenet' }]], wires: [['v', 'image', 'k', 'in']] });
    e.run(3);
    expect(e.nodes.get('k')!.status.level).toBe('error');
    expect(e.out('k', 'label')).toBeUndefined();
  });
  it('ML packages: numeric centroid and anomaly detector', () => {
    const { e } = build({ nodes: [['c', 'constant', { value: '0.8' }], ['k', 'knowledge', { package: 'numeric-centroid' }]], wires: [['c', 'out', 'k', 'in']] });
    e.step();
    expect(e.out('k', 'label')).toBe('high');
  });
});

describe('projects and sharing', () => {
  const sample = () => TEMPLATES.find((x) => x.id === 'apparatus')!.build();
  it('round-trips through JSON', () => {
    const p = sample();
    const back = parseProjectJSON(serializeProject(p));
    expect(back.error).toBeUndefined();
    expect(back.project!.graph).toEqual(p.graph);
    expect(Object.keys(back.project!.compounds)).toEqual(Object.keys(p.compounds));
  });
  it('rejects malformed imports with helpful errors and drops invalid parts', () => {
    expect(parseProjectJSON('not json').error).toMatch(/JSON/);
    expect(validateProject({ format: 'other' }).error).toMatch(/not a Neural Studio/);
    expect(validateProject({ format: 'neural-studio', version: 99, graph: { nodes: {}, edges: {} } }).error).toMatch(/Unsupported/);
    const r = validateProject({ format: 'neural-studio', version: 1, name: 'x'.repeat(500), graph: { nodes: { a: { id: 'a', type: 'bogus', x: 0, y: 0, params: {} }, b: { id: 'b', type: 'constant', x: 1e12, y: 'q', params: { value: 3 } } }, edges: { e: { id: 'e', from: 'a', fromPort: 'out', to: 'b', toPort: 'in' } } } });
    expect(r.project!.name.length).toBe(80);
    expect(Object.keys(r.project!.graph.nodes)).toEqual(['b']);
    expect(r.problems.length).toBeGreaterThan(0);
  });
  it('encodes and decodes share codes', () => {
    const p = sample();
    p.name = 'Länge ✓ name';
    const code = encodeShare(p);
    expect(code.startsWith('NS1.')).toBe(true);
    expect(code.length).toBeLessThan(JSON.stringify(p).length);
    const d = decodeShare(code);
    expect(d.error).toBeUndefined();
    expect(d.project!.name).toBe(p.name);
    expect(d.project!.graph.nodes).toEqual(p.graph.nodes);
    expect(d.project!.graph.edges).toEqual(p.graph.edges);
    expect(d.project!.compounds['decision-circuit'].inputs).toHaveLength(2);
  });
  it('detects corrupted or invalid share codes', () => {
    const code = encodeShare(newProject('x'));
    expect(decodeShare('hello').error).toMatch(/NS1/);
    const parts = code.split('.');
    expect(decodeShare(`${parts[0]}.${parts[1].slice(0, -3)}A.${parts[2]}`).error).toMatch(/Checksum/);
    expect(decodeShare(`NS2.${parts[1]}.${parts[2]}`).error).toMatch(/version/);
    expect(decodeShare(code.replace(/\./g, ' . ')).error).toBeUndefined();
  });
  it('handles long unbroken names and ids', () => {
    const p = newProject('W'.repeat(300));
    expect(parseProjectJSON(serializeProject(p)).project!.name.length).toBe(80);
  });
});

describe('equations', () => {
  const ev = (src: string, x = 0, t = 0) => {
    const c = compileExpr(src);
    if (!c.ok) throw new Error(c.error);
    return c.fn({ x, t });
  };
  it('evaluates operators with correct precedence and associativity', () => {
    expect(ev('1 + 2 * 3')).toBe(7);
    expect(ev('(1 + 2) * 3')).toBe(9);
    expect(ev('2 ^ 3 ^ 2')).toBe(512);
    expect(ev('-x^2', 3)).toBe(-9);
    expect(ev('2^-1')).toBe(0.5);
    expect(ev('10 % 4')).toBe(2);
    expect(ev('8 / 4 / 2')).toBe(1);
  });
  it('supports functions, constants, variables and implicit multiplication', () => {
    expect(ev('sin(pi/2)')).toBeCloseTo(1);
    expect(ev('y = x^2 - 3x + 1', 2)).toBe(-1);
    expect(ev('f(x) = 2x')).toBe(0);
    expect(ev('3sin(x)', Math.PI / 2)).toBeCloseTo(3);
    expect(ev('(x+1)(x-1)', 3)).toBe(8);
    expect(ev('max(x, 2, 5) + min(4, 9)', 1)).toBe(9);
    expect(ev('mod(-1, 5)')).toBe(4);
    expect(ev('sin(x - 2t)', 0, Math.PI / 4)).toBeCloseTo(-1);
    expect(ev('x²', 4)).toBe(16);
    expect(ev('e^1')).toBeCloseTo(Math.E);
  });
  it('agrees with the Math node for every function it offers', () => {
    for (const fn of ['abs', 'sqrt', 'sin', 'cos', 'tanh', 'exp', 'log', 'floor', 'round', 'ceil']) expect(ev(`${fn}(x)`, 2.5)).toBe((Math as any)[fn](2.5));
    expect(ev('square(x)', 3)).toBe(9);
    expect(ev('pow(2, 10)')).toBe(1024);
  });
  it('reports readable errors and never executes code', () => {
    const msg = (s: string) => { const c = compileExpr(s); return c.ok ? '' : c.error; };
    expect(msg('')).toMatch(/empty/);
    expect(msg('sin(')).toMatch(/too early/);
    expect(msg('(1 + 2')).toMatch(/Expected “\)”/);
    expect(msg('2 +')).toMatch(/too early/);
    expect(msg('foo(x)')).toMatch(/Unknown name/);
    expect(msg('sin')).toMatch(/function/);
    expect(msg('pow(1)')).toMatch(/2 arguments/);
    expect(msg('x $ 2')).toMatch(/character/);
    expect(msg('constructor.constructor("return 1")()')).not.toBe('');
    expect(msg('x; process')).not.toBe('');
  });
  it('splits several equations and ignores comments', () => {
    expect(splitEquations('sin(x)\n// note\ncos(x); y = x')).toEqual(['sin(x)', 'cos(x)', 'y = x']);
  });
  it('samples a plot, leaving gaps where undefined and ignoring asymptotes in auto range', () => {
    const base = { kind: 'equation' as const, xMin: -1, xMax: 1, yMin: -1, yMax: 1, yAuto: true, samples: 101, t: 0 };
    const r = samplePlot({ ...base, exprs: ['sqrt(x)'] });
    expect(r.ok && r.plot.curves[0].ys[0]).toBeNull();
    expect(r.ok && r.plot.curves[0].ys[100]).toBe(1);
    const s = samplePlot({ ...base, xMin: -6.2832, xMax: 6.2832, exprs: ['sin(x)'] });
    expect(s.ok && s.plot.yMin).toBeLessThan(-1);
    expect(s.ok && s.plot.yMax).toBeGreaterThan(1);
    const tn = samplePlot({ ...base, xMin: -4, xMax: 4, exprs: ['tan(x)'] });
    expect(tn.ok && tn.plot.yMax).toBeLessThan(100);
    expect(samplePlot({ ...base, xMax: -2, exprs: ['x'] }).ok).toBe(false);
    expect(samplePlot({ ...base, exprs: ['x +'] }).ok).toBe(false);
  });
  it('picks nice ticks', () => {
    expect(niceTicks(-10, 10, 4)).toEqual([-10, -5, 0, 5, 10]);
    expect(niceTicks(0, 1, 5)).toEqual([0, 0.2, 0.4, 0.6, 0.8, 1]);
  });
  it('Equation node stores equation data and evaluates y(x)', () => {
    const { e } = build({ nodes: [['q', 'equation', { expr: 'y = x^2 + 1', x: 3 }]], wires: [] });
    e.step();
    const v = e.out('q', 'eq');
    expect(isEquation(v)).toBe(true);
    expect((v as any).exprs).toEqual(['y = x^2 + 1']);
    expect(e.out('q', 'y')).toBe(10);
    expect(e.nodes.get('q')!.status.level).toBe('ok');
  });
  it('Equation node takes x from its input', () => {
    const { e } = build({ nodes: [['c', 'constant', { value: '2' }], ['q', 'equation', { expr: 'sin(pi * x / 4)' }]], wires: [['c', 'out', 'q', 'x']] });
    e.step();
    expect(e.out('q', 'y')).toBe(1);
  });
  it('Equation node reports syntax errors by name', () => {
    const { e } = build({ nodes: [['q', 'equation', { expr: 'sin(x' }]], wires: [] });
    e.step();
    expect(e.nodes.get('q')!.status.level).toBe('error');
    expect(e.nodes.get('q')!.status.message).toMatch(/too early|Expected/);
    expect(e.out('q', 'eq')).toBeUndefined();
  });
  it('Meter graphs a routed Equation and still plots plain numbers', () => {
    const { e } = build({ nodes: [['q', 'equation', { expr: 'sin(x); cos(x)' }], ['m', 'meter']], wires: [['q', 'eq', 'm', 'in']] });
    e.step();
    const plot = (e.nodes.get('m')!.viewData as any).plot;
    expect(plot.curves).toHaveLength(2);
    expect(plot.curves[0].ys.length).toBe(200);
    expect(e.nodes.get('m')!.status.level).toBe('ok');
    const n = build({ nodes: [['c', 'constant', { value: '3' }], ['m', 'meter']], wires: [['c', 'out', 'm', 'in']] });
    n.e.step();
    expect((n.e.nodes.get('m')!.viewData as any).last).toBe(3);
  });
  it('equations using t animate with simulation time', () => {
    const { e } = build({ nodes: [['q', 'equation', { expr: 'sin(x - t)' }], ['m', 'meter']], wires: [['q', 'eq', 'm', 'in']] });
    e.runFor(1000);
    expect((e.nodes.get('m')!.viewData as any).plot.t).toBeGreaterThan(0.5);
  });
  it('Meter reports an unparsable equation instead of drawing', () => {
    const { e } = build({ nodes: [['q', 'equation', { expr: 'x', xMin: 5, xMax: 1 }], ['m', 'meter']], wires: [['q', 'eq', 'm', 'in']] });
    e.step();
    expect(e.nodes.get('q')!.status.level).toBe('error');
  });
});
