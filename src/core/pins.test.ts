import { describe, expect, it } from 'vitest';
import { Engine } from './engine';
import { addNode, connect, createCompound, emptyGraph, flatten, setParams } from './graph';
import { builtinCompounds } from './library';
import { MODULES, PIN_SPACING, compoundModuleDef, defaultParams, getDef, nodeSize, paramDefsOf, portPosition } from './registry';
import { SIZES, type CompoundDef, type Graph, type Params } from './types';

function build(spec: { nodes: [string, string, Params?][]; wires: [string, string, string, string][]; compounds?: Record<string, CompoundDef> }) {
  let g: Graph = emptyGraph();
  spec.nodes.forEach(([id, type, p], i) => (g = addNode(g, type, i * 300, 0, p ?? {}, spec.compounds, id).graph));
  for (const [a, ap, b, bp] of spec.wires) {
    const r = connect(g, a, ap, b, bp, spec.compounds);
    if (r.error) throw new Error(r.error);
    g = r.graph;
  }
  const e = new Engine(50);
  e.load(flatten(g, spec.compounds));
  return { e, g };
}

describe('setting pins', () => {
  it('every setting of every module has a pin of the matching data type', () => {
    const kindType = { number: 'num', bool: 'bool', text: 'text', select: 'text' } as const;
    for (const m of MODULES) {
      const d = getDef(m.type, undefined, defaultParams(m))!;
      for (const p of paramDefsOf(m, defaultParams(m))) {
        const pin = d.inputs.find((q) => q.id === `p:${p.key}`);
        if (p.kind === 'action' || p.hidden || p.pin === false) { expect(pin, `${m.type}.${p.key}`).toBeUndefined(); continue; }
        expect(pin, `${m.type}.${p.key}`).toBeDefined();
        expect(pin!.type).toBe(kindType[p.kind]);
        expect(pin!.optional).toBe(true);
        expect(pin!.param).toBe(p.key);
        expect(pin!.label).toBe(p.label);
      }
      // original pins are untouched and keep their order
      expect(d.inputs.slice(0, m.inputs.length)).toEqual(m.inputs);
    }
  });

  it('the raw module list (used by the library sidebar) is unchanged', () => {
    const random = MODULES.find((m) => m.type === 'random')!;
    expect(random.inputs).toHaveLength(0);
    expect(random.dim).toBeUndefined();
    expect(nodeSize(random)).toEqual(SIZES.chip);
  });

  it('pins on one edge are never closer than the minimum spacing, and are all unique', () => {
    for (const m of MODULES) {
      const d = getDef(m.type, undefined, defaultParams(m))!;
      const node = { id: 'n', type: m.type, x: 0, y: 0, params: {} };
      const seen = new Set<string>();
      const pts: { x: number; y: number; side: string }[] = [];
      for (const p of d.inputs) {
        const q = portPosition(node, d, p.id, 'in')!;
        pts.push(q);
        const k = `${q.x},${q.y}`;
        expect(seen.has(k), `${m.type} overlapping pin ${p.id}`).toBe(false);
        seen.add(k);
      }
      for (const side of ['top', 'left'])
        for (const a of pts) for (const b of pts) if (a !== b && a.side === side && b.side === side)
          expect(Math.hypot(a.x - b.x, a.y - b.y), `${m.type} ${side}`).toBeGreaterThanOrEqual(PIN_SPACING - 0.001);
    }
  });

  it('nodes only grow when they need to, in whole grid steps, and chips stay chips where they can', () => {
    const rnd = getDef('random')!;
    expect(rnd.paramPins).toHaveLength(5);
    expect(nodeSize(rnd)).toEqual({ w: 144, h: 36 });
    for (const m of MODULES) {
      const s = nodeSize(getDef(m.type, undefined, defaultParams(m))!);
      expect(s.w % 12).toBe(0);
      expect(s.h % 12).toBe(0);
      expect(s.w).toBeGreaterThanOrEqual(SIZES[m.size].w);
      expect(s.h).toBeGreaterThanOrEqual(SIZES[m.size].h);
    }
  });

  it('a Random module is driven by Minimum / Maximum / Rate pins', () => {
    const { e } = build({
      nodes: [['lo', 'constant', { value: '100' }], ['hi', 'constant', { value: '101' }], ['rate', 'constant', { value: '10' }], ['r', 'random', { rate: 1 }]],
      wires: [['lo', 'out', 'r', 'p:min'], ['hi', 'out', 'r', 'p:max'], ['rate', 'out', 'r', 'p:rate']],
    });
    e.runFor(1000);
    const v = e.out('r', 'out') as number;
    expect(v).toBeGreaterThanOrEqual(100);
    expect(v).toBeLessThanOrEqual(101);
    const rt = e.nodes.get('r')!;
    expect(rt.driven).toBe(true);
    expect(rt.live.rate).toBe(10);
    expect(rt.params.rate).toBe(1); // the inspector value is untouched
    expect(rt.evals).toBeGreaterThan(8); // ~10 Hz instead of 1 Hz
  });

  it('a bool setting pin drives a switch and a select pin drives a choice', () => {
    const { e } = build({
      nodes: [['sw', 'switch', { on: false }], ['b', 'constant', { kind: 'bool', value: 'true' }], ['x', 'constant', { value: '9' }], ['m', 'math', { fn: 'abs' }], ['fn', 'constant', { kind: 'text', value: 'square' }], ['neg', 'constant', { value: '-3' }]],
      wires: [['b', 'out', 'sw', 'p:on'], ['neg', 'out', 'm', 'a'], ['fn', 'out', 'm', 'p:fn']],
    });
    e.runFor(200);
    expect(e.out('sw', 'on')).toBe(true);
    expect(e.out('m', 'out')).toBe(9); // square(-3), not abs(-3)
  });

  it('disconnecting a pin restores the inspector value', () => {
    const { e, g } = build({ nodes: [['c', 'constant', { value: '5' }], ['a', 'add', { offset: 1 }], ['k', 'constant', { value: '2' }]], wires: [['k', 'out', 'a', 'a'], ['c', 'out', 'a', 'p:offset']] });
    e.runFor(100);
    expect(e.out('a', 'out')).toBe(7);
    const g2 = { ...g, edges: Object.fromEntries(Object.entries(g.edges).filter(([, x]) => x.toPort !== 'p:offset')) };
    e.load(flatten(g2));
    e.runFor(100);
    expect(e.out('a', 'out')).toBe(3);
    expect(e.nodes.get('a')!.driven).toBe(false);
  });

  it('pin values are clamped to the setting range and numbers cannot be driven by text', () => {
    const { e } = build({ nodes: [['c', 'constant', { value: '99999' }], ['i', 'invert'], ['t', 'threshold'], ['k', 'constant', { value: '1' }]], wires: [['c', 'out', 't', 'p:hysteresis'], ['k', 'out', 't', 'in']] });
    e.runFor(100);
    expect(e.nodes.get('t')!.live.hysteresis).toBe(99999);
    let g = emptyGraph();
    g = addNode(g, 'info', 0, 0, { text: 'hi' }, undefined, 'i').graph;
    g = addNode(g, 'random', 0, 100, {}, undefined, 'r').graph;
    expect(connect(g, 'i', 'text', 'r', 'p:min').error).toMatch(/text/);
    expect(connect(g, 'i', 'number', 'r', 'p:min').error).toBeUndefined();
  });

  it('a setting pin does not look like a data event (Delay does not re-send, Counter does not count)', () => {
    const { e } = build({
      nodes: [['k', 'constant', { value: '1' }], ['ms', 'constant', { value: '100' }], ['d', 'delay', { ms: 500 }], ['cnt', 'counter'], ['step', 'constant', { value: '5' }]],
      wires: [['k', 'out', 'd', 'in'], ['ms', 'out', 'd', 'p:ms'], ['step', 'out', 'cnt', 'p:step']],
    });
    e.runFor(1500);
    expect(e.out('d', 'out')).toBe(1);
    expect(e.out('cnt', 'out')).toBe(0);
  });

  it('pins do not keep source modules from starting and do not count as signal strength', () => {
    const { e } = build({ nodes: [['r', 'random'], ['c', 'constant', { value: '3' }]], wires: [] });
    e.runFor(200);
    expect(e.out('r', 'out')).toBeDefined();
    expect(e.nodes.get('r')!.ctx.strength).toBe(1);
    const w = build({ nodes: [['c', 'constant', { value: '3' }], ['r', 'random']], wires: [['c', 'out', 'r', 'p:min']] });
    w.e.runFor(200);
    expect(w.e.nodes.get('r')!.ctx.strength).toBe(1);
  });

  it('a driven seed re-seeds the generator', () => {
    const run = (seed: string) => {
      const { e } = build({ nodes: [['s', 'constant', { value: seed }], ['r', 'random']], wires: [['s', 'out', 'r', 'p:seed']] });
      e.runFor(100);
      return e.out('r', 'out');
    };
    expect(run('7')).toBe(run('7'));
    expect(run('7')).not.toBe(run('8'));
  });

  it('dynamic settings: package pins follow the package, and stale connections are pruned', () => {
    let g = addNode(emptyGraph(), 'imagination', 0, 0, { package: 'trend' }, undefined, 'i').graph;
    expect(getDef('imagination', undefined, g.nodes.i.params)!.inputs.some((p) => p.id === 'p:window')).toBe(true);
    expect(getDef('imagination', undefined, g.nodes.i.params)!.inputs.some((p) => p.id === 'p:package')).toBe(false);
    g = addNode(g, 'constant', 0, 200, {}, undefined, 'c').graph;
    g = connect(g, 'c', 'out', 'i', 'p:window').graph;
    expect(Object.keys(g.edges)).toHaveLength(1);
    g = setParams(g, 'i', { package: 'dream' });
    expect(Object.keys(g.edges)).toHaveLength(0);
  });

  it('compounds expose their exposed settings as pins that reach the inner module', () => {
    const cd = builtinCompounds().find((c) => c.exposed.length > 0)!;
    const md = compoundModuleDef(cd);
    const first = cd.exposed[0];
    expect(md.inputs.some((p) => p.id === `p:${first.key}`)).toBe(true);
    const g0 = addNode(emptyGraph(), 'compound', 0, 0, { def: cd.id }, { [cd.id]: cd }, 'cmp').graph;
    const g1 = addNode(g0, 'constant', 0, 200, { value: '0.123' }, { [cd.id]: cd }, 'k').graph;
    const pin = md.inputs.find((p) => p.id === `p:${first.key}`)!;
    if (pin.type === 'num') {
      const r = connect(g1, 'k', 'out', 'cmp', pin.id, { [cd.id]: cd });
      expect(r.error).toBeUndefined();
      const flat = flatten(r.graph, { [cd.id]: cd });
      const e = flat.edges.find((x) => x.toPort === `p:${first.param}`);
      expect(e).toBeDefined();
      expect(e!.to).toBe(`cmp/${first.nodeId}`);
    }
  });

  it('grouping modules that have settings wired from outside works', () => {
    let g = addNode(emptyGraph(), 'constant', 0, 0, { value: '2' }, undefined, 'k').graph;
    g = addNode(g, 'random', 0, 100, {}, undefined, 'r').graph;
    g = connect(g, 'k', 'out', 'r', 'p:max').graph;
    const res = createCompound(g, ['r'], 'Rnd', {});
    expect('error' in res).toBe(false);
  });
});
