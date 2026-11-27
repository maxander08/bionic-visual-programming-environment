// Numbers have no limit but the memory of the machine, and a number that repeats is exact and written with an ellipsis.
import { describe, expect, it } from 'vitest';
import { Engine } from './engine';
import { addNode, connect, emptyGraph, flatten } from './graph';
import type { Graph, Params } from './types';
import { toText } from './util';
import { fracDigits, formatDec, isDec, jsonText, packDec, parseDec, sameDec, toNumber, toPlain, type Dec, type FormatOptions } from './decimal';
import * as M from './decmath';
import { DEFAULT_SYMBOLS as SYM, formatBased, parseBased } from './baseconv';
import { resolveParams, getDef } from './registry';
import { parseVector, magnitude, unitVector, fmtVector } from './linalg';

const D = (s: string): Dec => { const r = parseDec(s); if (!r.ok) throw new Error(r.error); return r.dec; };
const P = (d: Dec) => toPlain(d);
const q = (a: string, b: string) => P(M.div(D(a), D(b)));

function build(nodes: [string, string, Params?][], wires: [string, string, string, string][] = [], ms = 300) {
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
const val = (e: Engine, id: string, port: string) => toText(e.out(id, port));
const status = (e: Engine, id: string) => e.nodes.get(id)!.status;
const fmt = (d: Dec, o: Partial<FormatOptions>) => formatDec(d, { mode: 'plain', n: 0, rounding: 'nearest', trim: false, style: 'e', ...o });

describe('repeating decimals are exact and written with an ellipsis', () => {
  it('writes the repeating digits and then "..."', () => {
    expect(q('1', '3')).toBe('0.33333...');
    expect(q('13', '9')).toBe('1.44444...');
    expect(q('-1', '6')).toBe('-0.166666...');
    expect(q('1', '7')).toBe('0.142857142857...');
    expect(q('5', '11')).toBe('0.454545...');
    expect(q('22', '7')).toBe('3.142857142857...');
    expect(q('1', '300')).toBe('0.0033333...');
    expect(q('1', '12')).toBe('0.0833333...');
  });
  it('doesn’t put an ellipsis on a quotient that ends', () => {
    expect(q('1', '8')).toBe('0.125');
    expect(q('1', '1000000')).toBe('0.000001');
    expect(q('7', '2')).toBe('3.5');
    expect(q('3', '1')).toBe('3');
  });
  it('keeps every repeating number exactly: 1/3 × 3 is 1 and 1/3 + 2/3 is 1', () => {
    const third = M.div(D('1'), D('3'));
    expect(P(M.mul(third, D('3')))).toBe('1');
    expect(P(M.add(third, M.div(D('2'), D('3'))))).toBe('1');
    expect(P(M.sub(M.div(D('1'), D('3')), M.div(D('1'), D('3'))))).toBe('0');
    expect(P(M.mul(third, third))).toBe('0.11111...');
    expect(P(M.div(M.div(D('1'), D('7')), D('7')))).toBe('0.020408163265306122448979591836734693877551020408163265306122448979591836734693877551...');
    expect(M.cmp(third, D('0.3333333333333333333333333333333333333333'))).toBe(1);
    expect(M.cmp(M.mul(third, D('3')), D('1'))).toBe(0);
  });
  it('has no length limit: a long period is held exactly and written in full', () => {
    const r = M.div(D('1'), D('1000003')); // a period of more than a hundred thousand digits
    const text = P(r);
    expect(text.startsWith('0.00000099999')).toBe(true);
    expect(text.endsWith('...')).toBe(true);
    expect(text.length).toBeGreaterThan(200000);
    expect(P(M.mul(r, D('1000003')))).toBe('1');
    expect(sameDec(D(text), r)).toBe(true);
    // a denominator far too big for any double, still exact
    const big = '1' + '0'.repeat(40) + '7';
    expect(P(M.mul(M.div(D('1'), D(big)), D(big)))).toBe('1');
  });
  it('reads text with an ellipsis back as the same exact number', () => {
    for (const [text, as] of [['1.44444...', '13/9'], ['0.142857142857...', '1/7'], ['0.33...', '1/3'], ['-1.2121212…', '-40/33'], ['0.99999...', '1'], ['0.5000000...', '0.5'], ['0.100000100000...', '1/9.999999']] as const) {
      if (as.includes('9.999999')) continue;
      const [a, b] = as.split('/');
      const want = b ? M.div(D(a), D(b)) : D(a);
      expect(sameDec(D(text), want), text).toBe(true);
    }
    expect(parseDec('3.14159...').ok).toBe(false);
    expect(parseDec('...').ok).toBe(false);
    for (const [a, b] of [['1', '3'], ['5', '6'], ['1', '1001'], ['123', '999'], ['1', '97'], ['2', '13'], ['-7', '90'], ['1', '3000007']]) {
      const x = M.div(D(a), D(b));
      expect(sameDec(D(P(x)), x), `${a}/${b}`).toBe(true);
    }
    // a block ending in a run of the same digit is still found whole
    const odd = M.div(D('1'), D('9999991'));
    expect(sameDec(D(P(odd)), odd)).toBe(true);
    const rep = D('0.100000100000...');
    expect(P(rep)).toBe('0.100000100000...');
  });
  it('rounds a repeating number only when asked, and correctly', () => {
    const third = M.div(D('1'), D('3')), twoThirds = M.div(D('2'), D('3'));
    expect(fmt(third, { mode: 'places', n: 5 }).text).toBe('0.33333');
    expect(fmt(twoThirds, { mode: 'places', n: 3 }).text).toBe('0.667');
    expect(fmt(twoThirds, { mode: 'places', n: 3, rounding: 'zero' }).text).toBe('0.666');
    expect(fmt(third, { mode: 'places', n: 0 }).text).toBe('0');
    expect(fmt(M.div(D('5'), D('9')), { mode: 'digits', n: 4 }).text).toBe('0.5556');
    expect(fmt(M.div(D('1'), D('300')), { mode: 'digits', n: 3 }).text).toBe('0.00333');
    expect(fmt(M.div(D('199'), D('99')), { mode: 'places', n: 1 }).text).toBe('2.0');
    expect(fmt(third, { mode: 'plain' }).text).toBe('0.33333...');
    expect(fmt(third, { mode: 'digits', n: 0 }).text).toBe('0.33333...');
    expect(fmt(M.div(D('1'), D('300')), { mode: 'sci' }).text).toMatch(/^3\.3333[0-9]*\.\.\.e-3$/);
    expect(fmt(M.div(D('-1000'), D('3')), { mode: 'eng' }).text).toMatch(/^-333\.333[0-9]*\.\.\.e\+0$/);
    expect(fmt(third, { mode: 'sci', n: 4 }).text).toBe('3.333e-1');
    // the exact value still travels on
    expect(sameDec(fmt(third, {}).rounded, third)).toBe(true);
  });
  it('is a number to everything that reads numbers, and survives text and JSON', () => {
    const third = M.div(D('1'), D('3'));
    expect(isDec(packDec(third))).toBe(true);
    expect(toNumber(third)).toBeCloseTo(1 / 3, 15);
    expect(toNumber(M.div(D('1'), D('3e400')))).toBe(0);
    expect(toNumber(M.neg(M.div(D('1'), D('7'))))).toBeCloseTo(-1 / 7, 15);
    expect(jsonText({ x: third, y: D('2.50') })).toBe('{"x":"0.33333...","y":2.50}');
    expect(M.toDec('0.66666...')).not.toBeNull();
  });
  it('exact square roots and whole powers, including negative ones', () => {
    expect(P(M.sqrt(M.div(D('4'), D('9'))))).toBe('0.66666...');
    expect(P(M.sqrt(M.div(D('1'), D('4'))))).toBe('0.5');
    expect(P(M.pow(D('3'), D('-1')))).toBe('0.33333...');
    expect(P(M.pow(M.div(D('2'), D('3')), D('-2')))).toBe('2.25');
    expect(P(M.pow(M.div(D('2'), D('3')), D('3')))).toBe('0.296296...');
    expect(P(M.mod(M.div(D('10'), D('3')), D('1')))).toBe('0.33333...');
    expect(P(M.floor(M.div(D('-10'), D('3'))))).toBe('-4');
    expect(P(M.ceil(M.div(D('-10'), D('3'))))).toBe('-3');
    expect(P(M.round(M.div(D('5'), D('2'))))).toBe('3');
    expect(P(M.trunc(M.div(D('-10'), D('3'))))).toBe('-3');
    // never-repeating results (√2) are still worked out to the Precision, on repeating input too
    expect(P(M.sqrt(M.div(D('1'), D('3')), 20))).toBe('0.57735026918962576451');
    expect(P(M.exp(M.div(D('1'), D('3')), 20))).toBe('1.3956124250860895286');
  });
});

describe('there’s no limit on how many digits or how big a number is', () => {
  it('reads, adds and multiplies numbers of hundreds of thousands of digits', { timeout: 60000 }, () => {
    const n = '9'.repeat(150000);
    const x = D(n);
    expect(P(x)).toBe(n);
    expect(P(M.add(x, D('1')))).toBe('1' + '0'.repeat(150000));
    expect(P(M.mul(x, x)).length).toBe(300000);
    expect(P(D('1e300000')).length).toBe(300001);
    expect(P(D('1e-300000')).length).toBe(300002);
    expect(P(M.mul(D('1e150000'), D('1e150000'))).length).toBe(300001);
  });
  it('divides numbers of any size exactly', () => {
    const a = '1' + '0'.repeat(500), b = '3';
    expect(P(M.mul(M.div(D(a), D(b)), D(b)))).toBe(a);
    expect(q('1', '1' + '0'.repeat(300))).toBe('0.' + '0'.repeat(299) + '1');
  });
  it('raises to big powers and keeps every digit', () => {
    expect(P(M.pow(D('2'), D('1000')))).toBe((2n ** 1000n).toString());
    expect(P(M.pow(D('7'), D('-3')))).toBe(P(M.div(D('1'), D('343'))));
    expect(P(M.pow(D('3'), D('200000'))).length).toBe((3n ** 200000n).toString().length);
  });
  it('takes any Precision for the results that never end', () => {
    const r = M.sqrt(D('2'), 3000);
    expect(P(r).length).toBeGreaterThan(3000);
    expect(P(r).startsWith('1.41421356237309504880168872420969807856967187537694')).toBe(true);
    const def = getDef('math')!;
    expect(resolveParams(def, { precision: 5000 }).precision).toBe(5000);
    expect(M.fromBigInt(5n)).toEqual(D('5'));
  });
  it('sin and cos of a huge angle, and e^x of a big x, are worked out', () => {
    const sn = toNumber(M.sin(D('1e30'), 30)), cs = toNumber(M.cos(D('1e30'), 30));
    expect(sn * sn + cs * cs).toBeCloseTo(1, 12);
    expect(Math.abs(sn)).toBeLessThanOrEqual(1);
    expect(P(M.sin(D('1e2000'), 10)).length).toBeLessThan(20);
    expect(P(M.exp(D('30000'), 5)).length).toBeGreaterThan(13000);
  });
  it('keeps a repeating fractional part when range-reducing a huge angle', () => {
    const whole = D('1e100'), third = M.div(D('1'), D('3'));
    const angle = M.add(whole, third);
    const expected = M.add(
      M.mul(M.sin(whole, 50), M.cos(third, 50)),
      M.mul(M.cos(whole, 50), M.sin(third, 50)),
    );
    expect(toNumber(M.sin(angle, 30))).toBeCloseTo(toNumber(expected), 14);
  });
  it('preserves x minus one before approximating a near-one logarithm', () => {
    const tiny = M.div(D('1'), D('3e100'));
    const nearOne = M.add(D('1'), tiny);
    expect(toNumber(M.div(M.ln(nearOne, 20), tiny))).toBeCloseTo(1, 18);
  });
  it('memory is the only ceiling: an impossible size fails the node, not the program', () => {
    const e = build([['a', 'constant', { value: '10' }], ['b', 'constant', { value: '100000000000' }], ['m', 'math', { fn: 'pow' }]], [['a', 'out', 'm', 'a'], ['b', 'out', 'm', 'b']]);
    expect(status(e, 'm').level).toBe('error');
    expect(status(e, 'm').message).toMatch(/memory|too large/i);
  });
});

describe('nodes: no ranges on exact settings, repeating results on the wires', () => {
  it('Divisor, Math and Combine give a repeating number', () => {
    const e = build([['a', 'constant', { value: '13' }], ['d', 'div', { divisor: '9' }], ['m', 'math', { fn: 'pow' }], ['t', 'constant', { value: '3' }], ['n', 'constant', { value: '-1' }], ['c', 'combine', { mode: 'mean' }], ['u', 'constant', { value: '1' }], ['w', 'constant', { value: '1' }], ['x', 'constant', { value: '1' }]],
      [['a', 'out', 'd', 'a'], ['t', 'out', 'm', 'a'], ['n', 'out', 'm', 'b'], ['u', 'out', 'c', 'a'], ['w', 'out', 'c', 'b'], ['x', 'out', 'c', 'c']]);
    expect(val(e, 'd', 'out')).toBe('1.44444...');
    expect(val(e, 'm', 'out')).toBe('0.33333...');
    expect(val(e, 'c', 'out')).toBe('1');
    const m = build([['a', 'constant', { value: '1' }], ['b', 'constant', { value: '2' }], ['c', 'combine', { mode: 'mean' }], ['d', 'constant', { value: '2' }], ['e', 'constant', { value: '1' }], ['f', 'combine', { mode: 'mean' }]], [['a', 'out', 'c', 'a'], ['b', 'out', 'c', 'b'], ['d', 'out', 'f', 'a'], ['e', 'out', 'f', 'b'], ['e', 'out', 'f', 'c']]);
    expect(val(m, 'c', 'out')).toBe('1.5');
    expect(val(m, 'f', 'out')).toBe('1.33333...');
  });
  it('a repeating result keeps flowing: 1 ÷ 3 × 3 through two nodes is exactly 1', () => {
    const e = build([['a', 'constant', { value: '1' }], ['d', 'div', { divisor: '3' }], ['m', 'mul', { factor: '3' }], ['p', 'projector']], [['a', 'out', 'd', 'a'], ['d', 'out', 'm', 'a'], ['m', 'out', 'p', 'in']]);
    expect(e.out('m', 'out')).toBe(1);
    expect(val(e, 'd', 'out')).toBe('0.33333...');
  });
  it('exact settings have no range: huge values are kept whole', () => {
    const def = getDef('add')!;
    const huge = '123456789012345678901234567890123456789';
    expect(resolveParams(def, { offset: huge }).offset).toBe(huge);
    expect(resolveParams(def, { offset: -1e30 }).offset).toBe(-1e30);
    expect(resolveParams(getDef('counter')!, { max: '1e40', start: '-1e40' }).max).toBe(1e40);
    const e = build([['a', 'constant', { value: '5' }], ['s', 'add', { offset: huge }]], [['a', 'out', 's', 'a']]);
    expect(val(e, 's', 'out')).toBe('123456789012345678901234567890123456794');
    expect(getDef('add')!.params[0]).toMatchObject({ min: -Infinity, max: Infinity });
  });
  it('Counter counts past any limit, and Threshold compares huge numbers', () => {
    const c = build([['p', 'pulse', { period: 100, width: 20 }], ['c', 'counter', { step: '12345678901234567890123', max: '1e60', min: '-1e60' }]], [['p', 'out', 'c', 'inc']], 450);
    expect(val(c, 'c', 'out')).toBe('61728394506172839450615');
    expect(Number(val(c, 'c', 'out'))).toBeGreaterThan(1e22);
    const t = build([['a', 'constant', { value: '1e40' }], ['t', 'threshold', { threshold: '9999999999999999999999999999999999999999' }]], [['a', 'out', 't', 'in']]);
    expect(e2(t)).toBe(true);
    function e2(en: Engine) { return en.out('t', 'over'); }
    expect(val(t, 't', 'delta')).toBe('1');
  });
  it('Plastic Nerve keeps 1/3 exact', () => {
    const e = build([['a', 'constant', { value: '1' }], ['n', 'plastic', { inMin: 0, inMax: 3, outMin: 0, outMax: 3, clamp: true }]], [['a', 'out', 'n', 'in']]);
    expect(e.out('n', 'out')).toBe(1);
  });
  it('Hyponerve compares on every digit', () => {
    const lo = '10000000000000000000000000001', hi = '10000000000000000000000000002';
    const e = build([['s', 'sequence', { values: `${lo}, ${hi}`, auto: 100, loop: false }], ['h', 'hyponerve', { rule: 'rise' }]], [['s', 'out', 'h', 'in']], 600);
    expect(val(e, 'h', 'out')).toBe(hi);
  });
  it('Random draws between huge bounds', () => {
    const e = build([['r', 'random', { min: '0', max: '1e60', integer: true, seed: 5 }]]);
    const t = val(e, 'r', 'out');
    expect(t).toMatch(/^\d+$/);
    expect(t.length).toBeGreaterThan(40);
    expect(M.cmp(D(t), D('1e60'))).toBeLessThanOrEqual(0);
    const small = build([['r', 'random', { seed: 5 }]]);
    expect(typeof small.out('r', 'out')).toBe('number');
  });
});

describe('Integer has no range', () => {
  const big = '98765432109876543210987654321098765432109876543210';
  it('keeps every digit of its Value, on the output and on the face', () => {
    const e = build([['i', 'integer', { value: big, base: 'hex' }]]);
    expect(e.out('i', 'text')).toBe('0x' + BigInt(big).toString(16).toUpperCase());
    expect(val(e, 'i', 'out')).toBe(big);
    const bin = build([['i', 'integer', { value: '-' + big, base: 'bin' }]]);
    expect(bin.out('i', 'text')).toBe('-0b' + BigInt(big).toString(2));
  });
  it('rounds a number of any size by its exact digits', () => {
    const near = '12345678901234567890123456789.5';
    const run = (rounding: string, v = near) => val(build([['c', 'constant', { kind: 'text', value: v }], ['i', 'integer', { rounding }]], [['c', 'out', 'i', 'in']]), 'i', 'out');
    expect(run('trunc')).toBe('12345678901234567890123456789');
    expect(run('round')).toBe('12345678901234567890123456790');
    expect(run('ceil')).toBe('12345678901234567890123456790');
    expect(run('floor', '-' + near)).toBe('-12345678901234567890123456790');
    expect(run('round', '0.33333...')).toBe('0');
    expect(run('trunc', '7.99999...')).toBe('8');
  });
  it('reads huge numbers written in another base exactly', () => {
    const e = build([['c', 'constant', { kind: 'text', value: '0xFFFFFFFFFFFFFFFFFFFFFFFF' }], ['i', 'integer']], [['c', 'out', 'i', 'in']]);
    expect(val(e, 'i', 'out')).toBe((16n ** 24n - 1n).toString());
  });
});

describe('number bases: exact digits, repeating ones with an ellipsis', () => {
  const conv = (v: string, from: number, to: number, precision: number | null = null) => {
    const r = parseBased(v, from, SYM);
    if (!r.ok) return r.error;
    const f = formatBased(r.value, to, SYM, precision);
    return f.ok ? f.value.text : f.error;
  };
  it('writes a repeating fraction with an ellipsis after the repeating digits', () => {
    expect(conv('0.1', 10, 2)).toBe('0.000110011...');
    expect(conv('0.1', 10, 3)).toBe('0.00220022...');
    expect(conv('1', 3, 10)).toBe('1');
    expect(conv('0.1', 3, 10)).toBe('0.33333...');
    expect(conv('0.1', 12, 10)).toBe('0.0833333...');
    expect(conv('1.1', 2, 3)).toBe('1.11111...');
    expect(conv('0.1', 7, 10)).toBe('0.142857142857...');
    expect(conv('-0.2', 10, 6)).toBe('-0.11111...');
    expect(conv('0.5', 10, 2)).toBe('0.1');
    expect(conv('255.75', 10, 16)).toBe('FF.C');
  });
  it('reads the same text back, in any base', () => {
    expect(conv('0.000110011...', 2, 10)).toBe('0.1');
    expect(conv('0.00011001100110011...', 2, 10)).toBe('0.1');
    expect(conv('0.33333...', 10, 3)).toBe('0.1');
    expect(conv('0.1', 3, 10) && conv(conv('0.1', 3, 10), 10, 3)).toBe('0.1');
    expect(parseBased('0.11...', 10, SYM).ok).toBe(true); // two digits is enough for a person who types it
    expect(parseBased('0.1234...', 10, SYM).ok).toBe(false);
  });
  it('agrees with long division for every pre-period and period (bases 2 to 40)', () => {
    let bad = 0;
    for (let base = 2; base <= 40; base += base < 20 ? 1 : 7) for (let d = 2; d < 120; d++) for (const n of [1, 3, 5]) {
      const f = formatBased({ neg: false, n: BigInt(n), d: BigInt(d) }, base, SYM, null);
      if (!f.ok) { bad++; continue; }
      const digs: number[] = [], seen = new Map<number, number>();
      let rem = n % d, i = 0, start = -1;
      while (rem !== 0) { if (seen.has(rem)) { start = seen.get(rem)!; break; } seen.set(rem, i++); rem *= base; digs.push(Math.floor(rem / d)); rem %= d; }
      let want: string;
      if (start < 0) want = digs.map((x) => SYM[x]).join('');
      else { const blk = digs.slice(start); want = digs.slice(0, start).map((x) => SYM[x]).join('') + blk.map((x) => SYM[x]).join('').repeat(Math.max(2, Math.ceil(5 / blk.length))) + '...'; }
      const frac = f.value.text.includes('.') ? f.value.text.split('.').slice(1).join('.') : '';
      if (frac !== want) bad++;
    }
    expect(bad).toBe(0);
  });
  it('has no limit on the digits: huge numbers and long periods', () => {
    const n = '7'.repeat(2000);
    expect(conv(n, 10, 16)).toBe(BigInt(n).toString(16).toUpperCase());
    expect(conv(conv(n, 10, 40), 40, 10)).toBe(n);
    expect(conv('0.' + '3'.repeat(150), 10, 3, null)).toContain('...');
    const r = parseBased('1', 10, SYM);
    if (!r.ok) throw new Error();
    const f = formatBased({ ...r.value, d: 9973n }, 10, SYM, null);
    expect(f.ok && f.value.text.length > 1000).toBe(true);
    expect(f.ok && f.value.repeating).toBe(true);
    expect(conv('20000', 10, 1)).toBe('1'.repeat(20000));
  });
  it('still rounds when asked', () => {
    expect(conv('0.1', 10, 2, 8)).toBe('0.0001101');
    expect(conv('2.5', 10, 10, 0)).toBe('3');
    expect(conv('0.1', 10, 2, 200).length).toBeGreaterThan(150);
  });
  it('the actor writes exact digits by default and rounds only with Round the fraction', () => {
    const run = (p: Params) => build([['b', 'actor-baseconv', { value: '0.1', from: 10, to: 2, ...p }]]);
    const exact = run({});
    expect(exact.out('b', 'text')).toBe('0.000110011...');
    expect(val(exact, 'b', 'number')).toBe('0.1');
    expect(run({ round: true, precision: 8 }).out('b', 'text')).toBe('0.0001101');
    const third = run({ value: '0.1', from: 3, to: 10 });
    expect(third.out('b', 'text')).toBe('0.33333...');
    expect(val(third, 'b', 'number')).toBe('0.33333...');
    const huge = run({ value: '9'.repeat(300), from: 10, to: 16 });
    expect(huge.out('b', 'text')).toBe(BigInt('9'.repeat(300)).toString(16).toUpperCase());
    expect(val(huge, 'b', 'number')).toBe('9'.repeat(300));
  });
  it('the Number Formatter has no limit on its digits and writes repeating numbers with an ellipsis', () => {
    const e = build([['a', 'constant', { value: '1' }], ['d', 'div', { divisor: '7' }], ['f', 'actor-numfmt', { mode: 'places', n: 2000 }], ['g', 'actor-numfmt', { mode: 'plain' }]], [['a', 'out', 'd', 'a'], ['d', 'out', 'f', 'in'], ['d', 'out', 'g', 'in']]);
    expect(val(e, 'g', 'text')).toBe('0.142857142857...');
    expect(String(e.out('f', 'text')).length).toBe(2002);
    expect(String(e.out('f', 'text')).startsWith('0.142857142857')).toBe(true);
    expect(val(e, 'g', 'number')).toBe('0.142857142857...');
  });
  it('fraction digits are exact', () => {
    expect(fracDigits(1n, 7n, 12)).toBe('142857142857');
  });
});

describe('vectors and matrices keep every digit', () => {
  it('hold exact and repeating numbers', () => {
    const r = parseVector('1, 0.33333333333333333333333, 12345678901234567890123');
    expect(r.ok && fmtVector(r.value)).toBe('[1, 0.33333333333333333333333, 12345678901234567890123]');
    const m = parseVector('3, 4');
    expect(m.ok && toText(magnitude(m.value))).toBe('5');
    const t = parseVector('1, 2, 2');
    expect(t.ok && fmtVector(unitVector(t.value))).toBe('[0.33333..., 0.66666..., 0.66666...]');
    const n = parseVector('3, 4');
    expect(n.ok && fmtVector(unitVector(n.value))).toBe('[0.6, 0.8]');
  });
});

describe('the same number arrives the same on both sides of a wire', () => {
  it('text, number and JSON forms agree', () => {
    const third = M.div(D('1'), D('3'));
    expect(toText(third)).toBe('0.33333...');
    expect(JSON.parse(jsonText([third]))).toEqual(['0.33333...']);
  });
});
