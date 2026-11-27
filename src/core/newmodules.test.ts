import { describe, expect, it } from 'vitest';
import { Engine } from './engine';
import { addNode, connect, emptyGraph, flatten } from './graph';
import { getDef, portList } from './registry';
import { faceName } from './registry';
import type { Graph, Params } from './types';
import { DEFAULT_SYMBOLS, formatBased, parseBased } from './baseconv';
import { parseMatrix, parseVector, transpose } from './linalg';

function run(nodes: [string, string, Params?][], wires: [string, string, string, string][] = [], ms = 200) {
  let g: Graph = emptyGraph();
  nodes.forEach(([id, type, p], i) => (g = addNode(g, type, i * 300, 0, p ?? {}, undefined, id).graph));
  for (const [a, ap, b, bp] of wires) {
    const r = connect(g, a, ap, b, bp);
    if (r.error) throw new Error(r.error);
    g = r.graph;
  }
  const e = new Engine(50);
  e.load(flatten(g));
  e.runFor(ms);
  return e;
}
const out = (e: Engine, id: string, port: string) => e.nodes.get(id)!.outputs[port]?.v;
const conv = (value: string, from: number, to: number, precision = 12, symbols = DEFAULT_SYMBOLS) => {
  const r = parseBased(value, from, symbols);
  if (!r.ok) return r.error;
  const f = formatBased(r.value, to, symbols, precision);
  return f.ok ? f.value.text : f.error;
};

describe('Base converter maths', () => {
  it('converts whole numbers between bases 2 to 40', () => {
    expect(conv('255', 10, 16)).toBe('FF');
    expect(conv('ff', 16, 2)).toBe('11111111');
    expect(conv('-101101', 2, 10)).toBe('-45');
    expect(conv('39', 10, 40)).toBe('d');
    expect(conv('40', 10, 40)).toBe('10');
    expect(conv('Z', 36, 10)).toBe('35');
    expect(conv('a', 40, 10)).toBe('36');
    expect(conv('12345678901234567890123456789', 10, 36)).toBe('17384DV0Z83QK7482Z9');
    expect(conv('0', 10, 7)).toBe('0');
  });
  it('converts fractions with rounding', () => {
    expect(conv('0.5', 10, 2)).toBe('0.1');
    expect(conv('0.1', 10, 2, 8)).toBe('0.0001101');
    expect(conv('FF.8', 16, 10)).toBe('255.5');
    expect(conv('2.5', 10, 10, 0)).toBe('3');
  });
  it('writes tally marks in base 1', () => {
    expect(conv('5', 10, 1)).toBe('11111');
    expect(conv('11111', 1, 10)).toBe('5');
    expect(conv('0', 10, 1)).toBe('0');
    expect(conv('0', 1, 10)).toBe('0');
    expect(conv('12', 1, 10)).toContain('isn’t a digit');
  });
  it('reports digits that don’t exist', () => {
    expect(conv('102', 2, 10)).toContain('not a digit of base 2');
  });
});

describe('Base Converter actor', () => {
  it('converts through its settings and through its setting pins', () => {
    const e = run([['b', 'actor-baseconv', { value: '255', from: 10, to: 16 }]]);
    expect(out(e, 'b', 'text')).toBe('FF');
    expect(out(e, 'b', 'digits')).toBe(2);
    const d = getDef('actor-baseconv')!;
    for (const k of ['value', 'from', 'to', 'precision', 'symbols', 'details']) expect(d.inputs.some((p) => p.param === k)).toBe(true);
    const e2 = run([['n', 'constant', { value: 5 }], ['t', 'constant', { value: 2 }], ['b', 'actor-baseconv', { from: 10, to: 16 }]], [['n', 'out', 'b', 'in'], ['t', 'out', 'b', 'p:to']]);
    expect(out(e2, 'b', 'text')).toBe('101');
  });
  it('accepts custom symbols and rejects bad ones', () => {
    const e = run([['b', 'actor-baseconv', { value: 'xox', from: 2, to: 2, symbols: 'ox' }]]);
    expect(out(e, 'b', 'text')).toBe('xox');
    const bad = run([['b', 'actor-baseconv', { value: '5', from: 10, to: 16, symbols: 'ox' }]]);
    expect(bad.nodes.get('b')!.status.level).toBe('error');
  });
});

describe('Vector and Matrix', () => {
  it('parse text of any size', () => {
    expect(parseVector('1, 2 3;4')).toEqual({ ok: true, value: [1, 2, 3, 4] });
    expect(parseVector('[1, 2]')).toEqual({ ok: true, value: [1, 2] });
    expect(parseVector('1, x').ok).toBe(false);
    expect(parseMatrix('1, 2, 3; 4, 5, 6')).toEqual({ ok: true, value: [[1, 2, 3], [4, 5, 6]] });
    expect(parseMatrix('[[1],[2],[3]]')).toEqual({ ok: true, value: [[1], [2], [3]] });
    expect(parseMatrix('1, 2; 3').ok).toBe(false);
    expect(transpose([[1, 2, 3], [4, 5, 6]])).toEqual([[1, 4], [2, 5], [3, 6]]);
  });
  it('Vector sends out its list, size, magnitude and item', () => {
    const e = run([['v', 'vector', { items: '3, 4', index: -1 }]]);
    expect(out(e, 'v', 'out')).toEqual([3, 4]);
    expect(out(e, 'v', 'length')).toBe(2);
    expect(out(e, 'v', 'magnitude')).toBe(5);
    expect(out(e, 'v', 'item')).toBe(4);
    const n = run([['v', 'vector', { items: '3, 4', normalize: true }]]);
    expect(out(n, 'v', 'out')).toEqual([0.6, 0.8]);
  });
  it('Matrix sends out its rows, size and item, and can be transposed', () => {
    const e = run([['m', 'matrix', { values: '1, 2, 3; 4, 5, 6', row: 1, col: 2 }]]);
    expect(out(e, 'm', 'rows')).toBe(2);
    expect(out(e, 'm', 'cols')).toBe(3);
    expect(out(e, 'm', 'item')).toBe(6);
    const t = run([['m', 'matrix', { values: '1, 2, 3; 4, 5, 6', transpose: true }]]);
    expect(out(t, 'm', 'out')).toEqual([[1, 4], [2, 5], [3, 6]]);
  });
  it('take a list from the Array module', () => {
    const e = run([['a', 'array', { items: '1, 2, 3' }], ['v', 'vector', {}]], [['a', 'out', 'v', 'in']]);
    expect(out(e, 'v', 'length')).toBe(3);
  });
});

describe('Timekeeping action pins', () => {
  it('every action of Timer, Stopwatch and Alarm can be triggered from a pin', () => {
    expect(getDef('timer')!.inputs.map((p) => p.id)).toEqual(expect.arrayContaining(['start', 'toggle', 'reset']));
    expect(getDef('stopwatch')!.inputs.map((p) => p.id)).toEqual(expect.arrayContaining(['toggle', 'lap', 'reset']));
    expect(getDef('alarm')!.inputs.map((p) => p.id)).toEqual(expect.arrayContaining(['test', 'snooze', 'dismiss']));
  });
  it('the Pause / Resume pin holds and releases the Timer', () => {
    let g: Graph = emptyGraph();
    g = addNode(g, 'constant', 0, 0, { value: 1 }, undefined, 'k').graph;
    g = addNode(g, 'timer', 300, 0, { duration: 60 }, undefined, 't').graph;
    g = connect(g, 'k', 'out', 't', 'toggle').graph;
    const e = new Engine(50);
    e.load(flatten(g));
    e.runFor(500);
    expect(out(e, 't', 'running')).toBe(false);
  });
  it('the Start / Stop pin stops a running Stopwatch', () => {
    let g: Graph = emptyGraph();
    g = addNode(g, 'constant', 0, 0, { value: 1 }, undefined, 'k').graph;
    g = addNode(g, 'stopwatch', 300, 0, {}, undefined, 's').graph;
    g = connect(g, 'k', 'out', 's', 'toggle').graph;
    const e = new Engine(50);
    e.load(flatten(g));
    e.runFor(500);
    expect(out(e, 's', 'running')).toBe(false);
  });
  it('the Test ring pin rings the Alarm', () => {
    let g: Graph = emptyGraph();
    g = addNode(g, 'constant', 0, 0, { value: 1 }, undefined, 'k').graph;
    g = addNode(g, 'alarm', 300, 0, { time: '03:00' }, undefined, 'a').graph;
    g = connect(g, 'k', 'out', 'a', 'test').graph;
    const e = new Engine(50);
    e.load(flatten(g));
    e.runFor(300);
    expect(out(e, 'a', 'ringing')).toBe(true);
  });
});

describe('Shorter module titles', () => {
  it('only change what is drawn on the module, not the module name', () => {
    const want: Record<string, [string, string]> = {
      'actor-numfmt': ['Number Formatter', 'Formatter'], 'qty-kinematic': ['Kinematic viscosity', 'Kin. viscosity'], 'qty-dynamic': ['Dynamic viscosity', 'Dyn. viscosity'],
      'qty-field': ['Magnetic field strength', 'Magnetic field'], 'qty-catalytic': ['Catalytic activity', 'Cat. activity'], 'qty-density': ['Magnetic flux density', 'Flux density'],
      'qty-rotation': ['Rotational speed', 'Rotation speed'], 'qty-luminous': ['Luminous intensity', 'Intensity'], 'qty-substance': ['Amount of substance', 'Sub. amount'], 'qty-current': ['Electric current', 'Current'],
    };
    for (const [type, [name, short]] of Object.entries(want)) {
      const d = getDef(type)!;
      expect(d.name).toBe(name);
      expect(faceName(d)).toBe(short);
    }
  });
  it('every pin has a name to show', () => {
    for (const t of ['timer', 'vector', 'matrix', 'actor-baseconv']) {
      const d = getDef(t)!;
      for (const p of [...portList(d, 'in'), ...portList(d, 'out')]) expect(p.label || p.param || p.id).toBeTruthy();
    }
  });
});
