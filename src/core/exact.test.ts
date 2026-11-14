import { describe, expect, it } from 'vitest';
import { Engine } from './engine';
import { addNode, connect, emptyGraph, flatten } from './graph';
import type { Graph, Params } from './types';
import { toText } from './util';
import { isDec, jsonText, packDec, parseDec, parseJsonExact, toPlain, type Dec } from './decimal';
import * as M from './decmath';
import { projectView } from './modules/behavior';
import { parseItems } from './basedata';
import { resolveParams, getDef } from './registry';

const D = (s: string): Dec => { const r = parseDec(s); if (!r.ok) throw new Error(r.error); return r.dec; };
const P = (d: Dec) => toPlain(d);

function build(nodes: [string, string, Params?][], wires: [string, string, string, string][] = []) {
  let g: Graph = emptyGraph();
  nodes.forEach(([id, type, p], i) => (g = addNode(g, type, i * 300, 0, p ?? {}, undefined, id).graph));
  for (const [a, ap, b, bp] of wires) {
    const r = connect(g, a, ap, b, bp);
    if (r.error) throw new Error(r.error);
    g = r.graph;
  }
  const e = new Engine(50);
  e.load(flatten(g));
  e.runFor(300);
  return e;
}
const val = (e: Engine, id: string, port: string) => toText(e.out(id, port));
const status = (e: Engine, id: string) => e.nodes.get(id)!.status;

describe('exact decimal arithmetic', () => {
  it('adds exactly and divides to a chosen number of digits', () => {
    expect(P(M.add(D('3'), D('0.14159265')))).toBe('3.14159265');
    expect(P(M.add(D('0.1'), D('0.2')))).toBe('0.3');
    expect(P(M.sub(D('1'), D('0.9')))).toBe('0.1');
    expect(P(M.mul(D('1.1'), D('1.1')))).toBe('1.21');
    expect(P(M.div(D('1'), D('8')))).toBe('0.125');
    expect(P(M.div(D('1'), D('3'), 30))).toBe('0.' + '3'.repeat(30));
    expect(P(M.div(D('2'), D('3'), 5))).toBe('0.66667');
    expect(() => M.div(D('1'), D('0'))).toThrow(/zero/i);
  });
  it('handles numbers far beyond a double on both ends', () => {
    const big = '123456789012345678901234567890.123456789012345678901234567890';
    expect(P(M.add(D(big), D('0.000000000000000000000000000001')))).toBe('123456789012345678901234567890.123456789012345678901234567891');
    expect(P(M.mul(D('1e200'), D('1e200')))).toBe('1' + '0'.repeat(400));
    expect(M.cmp(D('1.0000000000000000000000001'), D('1'))).toBe(1);
  });
  it('works square roots, powers and transcendental functions to the digits asked for', () => {
    expect(P(M.sqrt(D('2'), 40))).toBe('1.41421356237309504880168872420969807857');
    expect(P(M.sqrt(D('2.25')))).toBe('1.5');
    expect(P(M.pow(D('2'), D('100')))).toBe('1267650600228229401496703205376');
    expect(P(M.pow(D('2'), D('-3')))).toBe('0.125');
    expect(P(M.exp(D('1'), 40))).toBe('2.718281828459045235360287471352662497757');
    expect(P(M.ln(D('2'), 40))).toBe('0.6931471805599453094172321214581765680755');
    expect(P(M.sin(D('1'), 30))).toBe('0.84147098480789650665250232163');
    expect(P(M.cos(D('1'), 30))).toBe('0.540302305868139717400936607443');
    expect(P(M.tanh(D('0.5'), 30))).toBe('0.462117157260009758502318483644');
    expect(M.sin(D('0'))).toEqual(M.ZERO);
  });
  it('rounds to whole numbers like Math does', () => {
    expect(P(M.round(D('2.5')))).toBe('3');
    expect(P(M.round(D('-2.5')))).toBe('-2');
    expect(P(M.floor(D('-0.1')))).toBe('-1');
    expect(P(M.mod(D('-5.5'), D('2')))).toBe('0.5');
  });
  it('only a value a double cannot hold travels as an exact decimal', () => {
    expect(packDec(D('0.3'))).toBe(0.3);
    expect(packDec(D('42.00'))).toBe(42);
    expect(isDec(packDec(D('3.14159265358979323846')))).toBe(true);
    expect(isDec(packDec(D('1e400')))).toBe(true);
  });
  it('writes and reads JSON without losing digits', () => {
    const v = [packDec(D('3.14159265358979323846')), 1.5, 'x'];
    expect(jsonText(v)).toBe('[3.14159265358979323846,1.5,"x"]');
    const back = parseJsonExact('[3.14159265358979323846, 2]') as unknown[];
    if (typeof (back[0]) !== 'number') expect(toPlain(back[0] as Dec)).toBe('3.14159265358979323846');
  });
  it('reads list items with every digit', () => {
    const r = parseItems('3.14159265358979323846, 2', ',', 'number');
    expect(r.ok && toText(r.items[0])).toBe('3.14159265358979323846');
  });
});

describe('nodes keep every digit', () => {
  it('Decimal 3 + Decimal 0.14159265 → Adder is 3.14159265, not 3.1416', () => {
    const e = build([['a', 'decimal', { value: '3' }], ['b', 'decimal', { value: '0.14159265' }], ['s', 'add']], [['a', 'out', 's', 'a'], ['b', 'out', 's', 'b']]);
    expect(val(e, 's', 'out')).toBe('3.14159265');
    expect(e.out('s', 'out')).toBe(3.14159265);
  });
  it('adds numbers longer than a double holds', () => {
    const e = build([['a', 'decimal', { value: '3' }], ['b', 'decimal', { value: '0.14159265358979323846264338327950288' }], ['s', 'add']], [['a', 'out', 's', 'a'], ['b', 'out', 's', 'b']]);
    expect(val(e, 's', 'out')).toBe('3.14159265358979323846264338327950288');
  });
  it('the Adder offset keeps every digit typed into it', () => {
    const e = build([['a', 'constant', { value: '1' }], ['s', 'add', { offset: '0.00000000000000000000000001' }]], [['a', 'out', 's', 'a']]);
    expect(val(e, 's', 'out')).toBe('1.00000000000000000000000001');
  });
  it('0.1 + 0.2 is 0.3 and 0.1 added ten times is 1', () => {
    const e = build([['a', 'constant', { value: '0.1' }], ['b', 'constant', { value: '0.2' }], ['s', 'add']], [['a', 'out', 's', 'a'], ['b', 'out', 's', 'b']]);
    expect(e.out('s', 'out')).toBe(0.3);
    const c = build([['a', 'constant', { value: '0.1' }], ['s', 'add'], ['m', 'mul', { factor: '3' }]], [['a', 'out', 's', 'a'], ['s', 'out', 'm', 'a']]);
    expect(e.out('s', 'out')).toBe(0.3);
    expect(val(c, 'm', 'out')).toBe('0.3');
  });
  it('Subtractor and Multiplier are exact', () => {
    const e = build([['a', 'constant', { value: '1.1' }], ['s', 'sub', { offset: '0.0000000000000000001' }], ['m', 'mul', { factor: '1.1' }]], [['a', 'out', 's', 'a'], ['a', 'out', 'm', 'a']]);
    expect(val(e, 's', 'out')).toBe('1.0999999999999999999');
    expect(val(e, 'm', 'out')).toBe('1.21');
  });
  it('Divisor works to its Precision setting and is exact when the quotient ends', () => {
    const e = build([['a', 'constant', { value: '1' }], ['d', 'div', { divisor: '3', precision: 25 }], ['h', 'div', { divisor: '8' }]], [['a', 'out', 'd', 'a'], ['a', 'out', 'h', 'a']]);
    expect(val(e, 'd', 'out')).toBe('0.' + '3'.repeat(25));
    expect(val(e, 'h', 'out')).toBe('0.125');
  });
  it('Divisor still reports division by zero', () => {
    const e = build([['a', 'constant', { value: '1' }], ['d', 'div', { divisor: '0' }]], [['a', 'out', 'd', 'a']]);
    expect(status(e, 'd').level).toBe('error');
    expect(status(e, 'd').message).toMatch(/Division by zero/);
  });
  it('Math: exact abs/floor, √ and sin to the chosen precision, errors named', () => {
    const run = (fn: string, v: string, precision = 30) => build([['a', 'constant', { value: v }], ['m', 'math', { fn, precision }]], [['a', 'out', 'm', 'a']]);
    expect(val(run('sqrt', '2'), 'm', 'out')).toBe('1.41421356237309504880168872421');
    expect(val(run('sin', '1'), 'm', 'out')).toBe('0.84147098480789650665250232163');
    expect(val(run('square', '1.00000000000000000001'), 'm', 'out')).toBe('1.0000000000000000000200000000000000000001');
    expect(status(run('sqrt', '-1'), 'm').level).toBe('error');
    expect(status(run('log', '0'), 'm').level).toBe('error');
  });
  it('Combine sums and averages exactly', () => {
    const e = build([['a', 'constant', { value: '0.1' }], ['b', 'constant', { value: '0.2' }], ['c', 'constant', { value: '0.3' }], ['s', 'combine', { mode: 'sum' }], ['m', 'combine', { mode: 'mean' }]],
      [['a', 'out', 's', 'a'], ['b', 'out', 's', 'b'], ['c', 'out', 's', 'c'], ['a', 'out', 'm', 'a'], ['b', 'out', 'm', 'b'], ['c', 'out', 'm', 'c']]);
    expect(e.out('s', 'out')).toBe(0.6);
    expect(e.out('m', 'out')).toBe(0.2);
  });
  it('Counter steps without drift', () => {
    const e = build([['p', 'pulse', { period: 100, width: 20, max: 10 }], ['c', 'counter', { step: '0.1', max: 100 }]], [['p', 'out', 'c', 'inc']]);
    e.runFor(2000);
    expect(e.out('c', 'out')).toBe(1);
  });
  it('Compare tells apart numbers that differ only in a far digit', () => {
    const run = (b: string, op: string) => build([['a', 'constant', { value: '1' }], ['b', 'decimal', { value: b }], ['c', 'compare', { op }]], [['a', 'out', 'c', 'a'], ['b', 'out', 'c', 'b']]);
    expect(e0(run('1.0000000000000000000001', '==')).out('c', 'out')).toBe(false);
    expect(run('1.0000000000000000000001', '<').out('c', 'out')).toBe(true);
    expect(run('1', '==').out('c', 'out')).toBe(true);
    function e0(e: Engine) { return e; }
  });
  it('Threshold delta and Plastic Nerve are exact', () => {
    const e = build([['a', 'constant', { value: '0.30000000000000000001' }], ['t', 'threshold', { threshold: '0.3' }], ['p', 'plastic', { inMin: '0', inMax: '1', outMin: '0', outMax: '100' }]], [['a', 'out', 't', 'in'], ['a', 'out', 'p', 'in']]);
    expect(val(e, 't', 'delta')).toBe('0.00000000000000000001');
    expect(val(e, 'p', 'out')).toBe('30.000000000000000001');
  });
  it('the Inverter and Integer keep working on exact values', () => {
    const e = build([['a', 'decimal', { value: '0.30000000000000000001' }], ['i', 'invert', { mode: 'complement' }], ['n', 'integer', { rounding: 'trunc' }]], [['a', 'out', 'i', 'in'], ['a', 'out', 'n', 'in']]);
    expect(val(e, 'i', 'out')).toBe('0.69999999999999999999');
    expect(e.out('n', 'out')).toBe(0);
  });
  it('setting pins carry exact values too', () => {
    const e = build([['a', 'constant', { value: '1' }], ['o', 'decimal', { value: '0.00000000000000000000000000007' }], ['s', 'add']], [['a', 'out', 's', 'a'], ['o', 'out', 's', 'p:offset']]);
    expect(val(e, 's', 'out')).toBe('1.00000000000000000000000000007');
  });
  it('the Projector shows every digit, and rounds only when you pick a format', () => {
    const v = packDec(D('3.14159265358979323846'));
    expect(projectView(v)).toMatchObject({ kind: 'number', text: '3.14159265358979323846' });
    expect(projectView(v, 'fixed2')).toMatchObject({ text: '3.14' });
    expect(projectView(0.1 + 0.2)).toMatchObject({ text: '0.30000000000000004' });
    expect(projectView(1234.56789)).toMatchObject({ text: '1234.56789' });
  });
  it('a whole program chain keeps all digits to the Projector', () => {
    const e = build([['a', 'decimal', { value: '3' }], ['b', 'decimal', { value: '0.14159265358979323846' }], ['s', 'add'], ['p', 'projector']], [['a', 'out', 's', 'a'], ['b', 'out', 's', 'b'], ['s', 'out', 'p', 'in']]);
    expect(e.nodes.get('p')!.viewData).toMatchObject({ text: '3.14159265358979323846' });
  });
  it('settings keep their digits when saved and reloaded', () => {
    const def = getDef('add')!;
    expect(resolveParams(def, { offset: '0.123456789012345678901234567890' }).offset).toBe('0.12345678901234567890123456789');
    expect(resolveParams(def, { offset: 0.5 }).offset).toBe(0.5);
    expect(resolveParams(def, { offset: '1e99' }).offset).toBe(1e6);
    expect(resolveParams(def, { offset: 'abc' }).offset).toBe(0);
  });
});
