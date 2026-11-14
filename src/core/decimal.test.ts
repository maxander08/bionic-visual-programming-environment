import { describe, expect, it } from 'vitest';
import { Engine } from './engine';
import { addNode, connect, emptyGraph, flatten } from './graph';
import { getDef, paramDefsOf } from './registry';
import type { Graph, Params } from './types';
import { TEMPLATES } from './library';
import { toText } from './util';
import { formatDec, formatText, parseDec, setScale, toNumber, toPlain, type FormatOptions } from './decimal';

const D = (s: string) => { const r = parseDec(s); if (!r.ok) throw new Error(r.error); return r.dec; };
const opt = (o: Partial<FormatOptions>): FormatOptions => ({ mode: 'places', n: 2, rounding: 'nearest', trim: false, style: 'e', ...o });
const fmt = (s: string, o: Partial<FormatOptions>) => formatDec(D(s), opt(o)).text;

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
  e.runFor(200);
  return e;
}

describe('arbitrary-precision decimals', () => {
  it('reads and writes any number of digits exactly', () => {
    const big = '123456789012345678901234567890.123456789012345678901234567890';
    expect(toPlain(D(big))).toBe(big);
    expect(toPlain(D('+007.50'))).toBe('7.50');
    expect(toPlain(D('−0.5'))).toBe('-0.5');
    expect(toPlain(D('1_000.5'))).toBe('1000.5');
    expect(toPlain(D('-0.000'))).toBe('0.000');
    expect(toPlain(D('1e3'))).toBe('1000');
    expect(toPlain(D('12.5E-3'))).toBe('0.0125');
  });
  it('refuses what is not a number', () => {
    for (const bad of ['', '.', 'abc', '1,5', '1e', '--1', '1.2.3', 'Infinity', 'NaN', '1e100000']) expect(parseDec(bad).ok, bad).toBe(false);
  });
  it('converts to the nearest double', () => {
    expect(toNumber(D('3.5'))).toBe(3.5);
    expect(toNumber(D('-1e-3'))).toBe(-0.001);
    expect(toNumber(D('1e400'))).toBe(Infinity);
  });
  it('sets the scale with every rounding rule', () => {
    const r = (s: string, to: number, m: any) => toPlain(setScale(D(s), to, m));
    expect(r('2.5', 0, 'nearest')).toBe('3'); expect(r('-2.5', 0, 'nearest')).toBe('-3');
    expect(r('2.5', 0, 'even')).toBe('2'); expect(r('3.5', 0, 'even')).toBe('4'); expect(r('2.51', 0, 'even')).toBe('3');
    expect(r('2.1', 0, 'up')).toBe('3'); expect(r('-2.9', 0, 'up')).toBe('-2');
    expect(r('2.9', 0, 'down')).toBe('2'); expect(r('-2.1', 0, 'down')).toBe('-3');
    expect(r('2.9', 0, 'zero')).toBe('2'); expect(r('-2.9', 0, 'zero')).toBe('-2');
    expect(r('2.1', 0, 'away')).toBe('3'); expect(r('-2.1', 0, 'away')).toBe('-3');
    expect(r('9.995', 2, 'nearest')).toBe('10.00');
    expect(r('0.004', 2, 'nearest')).toBe('0.00'); expect(r('-0.004', 2, 'nearest')).toBe('0.00');
    expect(r('0.0001', 2, 'up')).toBe('0.01'); expect(r('-0.0001', 2, 'down')).toBe('-0.01');
    expect(r('0.5', 3, 'nearest')).toBe('0.500');
    expect(r('1234', -2, 'nearest')).toBe('1200');
    expect(r('0.00000001', 2, 'nearest')).toBe('0.00');
  });
});

describe('Number Formatter formats', () => {
  const PI = '3.14159265358979323846264338327950288';
  it('rounds to n decimal places on the full value, past double precision', () => {
    expect(fmt(PI, { n: 30 })).toBe('3.141592653589793238462643383280');
    expect(fmt(PI, { n: 2 })).toBe('3.14');
    expect(fmt(PI, { n: 0 })).toBe('3');
    expect(fmt('0.1', { n: 5 })).toBe('0.10000');
    expect(fmt('0.1', { n: 5, trim: true })).toBe('0.1');
    expect(fmt('2.50', { n: 0, rounding: 'even' })).toBe('2');
    expect(fmt('1e-9', { n: 3 })).toBe('0.000');
  });
  it('rounds to n significant digits', () => {
    expect(fmt('31415.9', { mode: 'digits', n: 3 })).toBe('31400');
    expect(fmt('0.00123456', { mode: 'digits', n: 3 })).toBe('0.00123');
    expect(fmt('9.99', { mode: 'digits', n: 2 })).toBe('10');
    expect(fmt('1.2', { mode: 'digits', n: 4 })).toBe('1.200');
    expect(fmt('1.2', { mode: 'digits', n: 4, trim: true })).toBe('1.2');
    expect(fmt('123456', { mode: 'digits', n: 0 })).toBe('123456');
    expect(fmt('-0.0456', { mode: 'digits', n: 1 })).toBe('-0.05');
  });
  it('writes scientific notation', () => {
    expect(fmt('31415.9', { mode: 'sci', n: 3 })).toBe('3.14e+4');
    expect(fmt('31415.9', { mode: 'sci', n: 0 })).toBe('3.14159e+4');
    expect(fmt('0.00012', { mode: 'sci', n: 5 })).toBe('1.2000e-4');
    expect(fmt('0.00012', { mode: 'sci', n: 5, trim: true })).toBe('1.2e-4');
    expect(fmt('999.9', { mode: 'sci', n: 2 })).toBe('1.0e+3');
    expect(fmt('-6.022e23', { mode: 'sci', n: 0 })).toBe('-6.022e+23');
    expect(fmt('0', { mode: 'sci', n: 3 })).toBe('0.00e+0');
    expect(fmt('31415.9', { mode: 'sci', n: 3, style: 'x10' })).toBe('3.14 × 10⁴');
    expect(fmt('0.00012', { mode: 'sci', n: 2, style: 'x10' })).toBe('1.2 × 10⁻⁴');
  });
  it('writes engineering notation with an exponent that is a multiple of 3', () => {
    expect(fmt('31415.9', { mode: 'eng', n: 0 })).toBe('31.4159e+3');
    expect(fmt('31415.9', { mode: 'eng', n: 3 })).toBe('31.4e+3');
    expect(fmt('123456', { mode: 'eng', n: 2 })).toBe('120e+3');
    expect(fmt('1234567', { mode: 'eng', n: 2 })).toBe('1.2e+6');
    expect(fmt('0.0000472', { mode: 'eng', n: 0 })).toBe('47.2e-6');
    expect(fmt('0.5', { mode: 'eng', n: 0 })).toBe('500e-3');
    expect(fmt('999.9', { mode: 'eng', n: 3 })).toBe('1.00e+3');
    expect(fmt('7', { mode: 'eng', n: 3, style: 'x10' })).toBe('7.00 × 10⁰');
  });
  it('exact mode rewrites without dropping anything', () => {
    expect(fmt('1.5e3', { mode: 'plain' })).toBe('1500');
    expect(fmt('0.123456789012345678901234567890', { mode: 'plain' })).toBe('0.123456789012345678901234567890');
    expect(fmt('2.50', { mode: 'plain', trim: true })).toBe('2.5');
  });
  it('reports mantissa and exponent', () => {
    const f = formatDec(D('31415.9'), opt({ mode: 'eng', n: 0 }));
    expect([f.mantissa, f.exponent]).toEqual(['31.4159', 3]);
    const g = formatDec(D('31415.9'), opt({ mode: 'places', n: 1 }));
    expect([g.mantissa, g.exponent]).toEqual(['3.14159', 4]);
    expect(formatText('abc', {})).toBeNull();
  });
});

describe('Number Formatter actor', () => {
  const PI = '3.14159265358979323846264338327950288';
  it('is in the Actors section with a pin for every setting', () => {
    const d = getDef('actor-numfmt')!;
    expect(d.category).toBe('Actors');
    const keys = paramDefsOf(d, {}).map((p) => p.key);
    expect(keys).toEqual(['value', 'mode', 'n', 'rounding', 'trim', 'style']);
    expect(d.paramPins!.map((p) => p.param)).toEqual(keys);
  });
  it('formats its Value setting', () => {
    const e = build([['f', 'actor-numfmt', { value: PI, mode: 'places', n: 10 }]]);
    expect(e.out('f', 'text')).toBe('3.1415926536');
    expect(e.out('f', 'number')).toBe(3.1415926536);
  });
  it('rounds the exact Text of a Decimal, not its double', () => {
    // 0.1234567890123456789012 as a double is 0.12345678901234568, so rounding that to 20 places would be wrong.
    const e = build([['d', 'decimal', { value: '0.1234567890123456789012' }], ['f', 'actor-numfmt', { mode: 'places', n: 20 }]], [['d', 'text', 'f', 'in']]);
    expect(e.out('f', 'text')).toBe('0.12345678901234567890');
  });
  it('reads a plain number by its shortest exact text', () => {
    const e = build([['c', 'constant', { value: 1234.56789 }], ['f', 'actor-numfmt', { mode: 'sci', n: 3 }]], [['c', 'out', 'f', 'in']]);
    expect(e.out('f', 'text')).toBe('1.23e+3');
    expect(e.out('f', 'mantissa')).toBe(1.23);
    expect(e.out('f', 'exponent')).toBe(3);
    expect(e.out('f', 'number')).toBe(1230);
  });
  it('follows signals on its setting pins', () => {
    const e = build([['c', 'constant', { value: 4 }], ['f', 'actor-numfmt', { value: '3.14159265', mode: 'places', n: 1 }]], [['c', 'out', 'f', 'p:n']]);
    expect(e.out('f', 'text')).toBe('3.1416');
  });
  it('raises an error for text that is not a number', () => {
    const e = build([['c', 'constant', { kind: 'text', value: '1,5' }], ['f', 'actor-numfmt']], [['c', 'out', 'f', 'in']]);
    expect(e.nodes.get('f')!.status.level).toBe('error');
  });
  it('emits Formatted and Number with every digit, even beyond a double', () => {
    const e = build([['f', 'actor-numfmt', { value: '1e400', mode: 'sci', n: 3 }]]);
    expect(e.out('f', 'text')).toBe('1.00e+400');
    expect(toText(e.out('f', 'number'))).toBe('1' + '0'.repeat(400));
    expect(e.nodes.get('f')!.status.level).toBe('ok');
  });
  it('hands the rounded value on exactly (10 places of π keeps all 10)', () => {
    const e = build([['f', 'actor-numfmt', { value: '3.14159265358979323846', mode: 'places', n: 15 }]]);
    expect(toText(e.out('f', 'number'))).toBe('3.141592653589793');
    const g = build([['f', 'actor-numfmt', { value: '3.14159265358979323846', mode: 'places', n: 18 }]]);
    expect(toText(g.out('f', 'number'))).toBe('3.141592653589793238');
  });
});

describe('example program', () => {
  it('rounds the exact Text of a 35-digit π three ways', () => {
    const t = TEMPLATES.find((x) => x.id === 'number-formatting')!.build();
    const e = new Engine(50);
    e.load(flatten(t.graph, t.compounds));
    e.runFor(300);
    expect(e.out('f1', 'text')).toBe('3.1415926536');
    expect(e.out('f2', 'text')).toBe('3.1416');
    expect(e.out('f3', 'text')).toBe('3.14159265358979323846264338327950288e+0');
    for (const n of e.nodes.values()) expect(n.status.level, n.id).toBe('ok');
  });
});
