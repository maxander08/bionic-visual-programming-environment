import { describe, expect, it } from 'vitest';
import { Engine } from './engine';
import { addNode, connect, emptyGraph, flatten } from './graph';
import { CATEGORIES, MODULES, PIN_SPACING, defaultParams, getDef, nodeSize, paramDefsOf, portPosition, resolveParams } from './registry';
import { GROUPS, PREFIXES, QUANTITIES, UNITS, UNIT_BY_SYM, autoPrefix, fmtQuantity, fromBase, parseQuantity, readUnit, toBase } from './quantities';
import type { Graph, Params } from './types';

const SPEC_UNITS = 'm kg s A K mol cd rad sr Hz N Pa J W C V F Ω S Wb T H °C lm lx Bq Gy Sv kat min h d a t L eV u Da au pc Å bar atm cal dyn erg G Mx Oe St P Gal Ci R rem Torr mmHg kn mph rpm'.split(' ');
const SPEC_PREFIXES = 'q r y z a f p n μ m c d da h k M G T P E Z Y R Q'.split(' ');

/** Equal to 11 significant digits. */
const near = (a: number, b: number) => Math.abs(a - b) <= 1e-11 * Math.max(Math.abs(a), Math.abs(b));

const qmods = MODULES.filter((m) => m.category === 'Quantities');

function run(nodes: [string, string, Params?][], wires: [string, string, string, string][] = [], ms = 300) {
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

describe('quantities: the table', () => {
  it('has all 24 SI prefixes, in the requested spelling', () => {
    expect(PREFIXES.map((p) => p.sym).sort()).toEqual([...SPEC_PREFIXES].sort());
    expect(PREFIXES).toHaveLength(24);
  });

  it('every requested unit is reachable: as a unit, or (kg) as the prefix k on the gram', () => {
    for (const s of SPEC_UNITS) {
      if (s === 'kg') { expect(UNIT_BY_SYM.has('g')).toBe(true); continue; }
      expect(UNIT_BY_SYM.has(s), s).toBe(true);
      expect(qmods.some((m) => paramDefsOf(m, {}).some((p) => p.key === 'unit' && p.kind === 'select' && p.options.some((o) => o.value === s))), `no module offers ${s}`).toBe(true);
    }
  });

  it('every unit belongs to a known group and every group has a module', () => {
    const ids = new Set(GROUPS.map((g) => g.id));
    for (const u of UNITS) expect(ids.has(u.group), u.sym).toBe(true);
    for (const g of GROUPS) expect(QUANTITIES.some((q) => q.group === g.id), g.id).toBe(true);
    for (const q of QUANTITIES) for (const s of q.units) expect(UNIT_BY_SYM.get(s)!.group, `${q.id}/${s}`).toBe(q.group);
  });
});

describe('quantities: prefixes and conversion', () => {
  it('every unit of every module takes every prefix and reads back as the same quantity', () => {
    for (const q of QUANTITIES) for (const s of q.units) for (const p of PREFIXES) {
      const text = fmtQuantity(2.5, p.sym, s);
      const r = parseQuantity(text, q.group);
      expect(r.ok, text).toBe(true);
      if (!r.ok || !r.q) continue;
      expect([r.q.prefix, r.q.unit, r.q.amount], text).toEqual([p.sym, s, 2.5]);
      expect(r.q.base, text).toBeCloseTo(toBase(2.5, p.sym, s), 0);
      // the Celsius scale sits 273.15 above zero, so a tiny prefixed amount cannot survive the trip through kelvin
      if (!UNIT_BY_SYM.get(s)!.offset) expect(near(fromBase(r.q.base, p.sym, s), 2.5)).toBe(true);
    }
  });

  it('knows the powers of ten', () => {
    expect(toBase(1, 'k', 'm')).toBe(1000);
    expect(toBase(1, 'μ', 'm')).toBeCloseTo(1e-6, 20);
    expect(toBase(1, 'Q', 'm')).toBe(1e30);
    expect(toBase(1, 'q', 'm')).toBe(1e-30);
    expect(toBase(1, 'da', 'm')).toBe(10);
    expect(toBase(1, 'k', 'g')).toBeCloseTo(1, 12); // kilogram is the SI base unit of mass
  });

  it('converts between units', () => {
    expect(fromBase(toBase(1, '', 'h'), '', 'min')).toBeCloseTo(60, 9);
    expect(fromBase(toBase(1, '', 'atm'), '', 'Torr')).toBeCloseTo(760, 9);
    expect(fromBase(toBase(1, '', 'bar'), 'k', 'Pa')).toBeCloseTo(100, 9);
    expect(fromBase(toBase(25, '', '°C'), '', 'K')).toBeCloseTo(298.15, 9);
    expect(fromBase(toBase(300, '', 'K'), '', '°C')).toBeCloseTo(26.85, 9);
    expect(fromBase(toBase(1, '', 'mph'), '', 'kn')).toBeCloseTo(0.868976, 6);
    expect(fromBase(toBase(1, '', 'rpm'), '', 'Hz')).toBeCloseTo(1 / 60, 12);
    expect(fromBase(toBase(1, '', 'pc'), '', 'au')).toBeCloseTo(206264.806, 2);
  });

  it('auto picks the step of 1000 that keeps the amount between 1 and 999', () => {
    expect(autoPrefix(1500)).toBe('k');
    expect(autoPrefix(0.0000012)).toBe('μ');
    expect(autoPrefix(999)).toBe('');
    expect(autoPrefix(1000)).toBe('k');
    expect(autoPrefix(0)).toBe('');
    expect(autoPrefix(2e31)).toBe('Q');
    expect(autoPrefix(3e-33)).toBe('q');
  });
});

describe('quantities: reading <amount><unit>', () => {
  it('reads amounts, exponents, spaces and look-alike symbols', () => {
    expect(parseQuantity('2.5km')).toMatchObject({ ok: true, q: { amount: 2.5, prefix: 'k', unit: 'm' } });
    expect(parseQuantity('  -3 mmHg ')).toMatchObject({ ok: true, q: { amount: -3, prefix: '', unit: 'mmHg' } });
    expect(parseQuantity('1e3m')).toMatchObject({ ok: true, q: { amount: 1000, unit: 'm' } });
    expect(parseQuantity('5eV')).toMatchObject({ ok: true, q: { amount: 5, unit: 'eV' } });
    expect(parseQuantity('5Em')).toMatchObject({ ok: true, q: { amount: 5, prefix: 'E', unit: 'm' } });
    expect(parseQuantity('4.7µF')).toMatchObject({ ok: true, q: { prefix: 'μ', unit: 'F' } });
    expect(parseQuantity('10\u2126')).toMatchObject({ ok: true, q: { unit: 'Ω' } });
    expect(parseQuantity('1\u212b')).toMatchObject({ ok: true, q: { unit: 'Å' } });
    expect(parseQuantity('21.5°C')).toMatchObject({ ok: true, q: { unit: '°C', base: 294.65 } });
    expect(parseQuantity('7')).toEqual({ ok: true, amount: 7 });
  });
  it('rejects what is not a quantity', () => {
    expect(parseQuantity('km5').ok).toBe(false);
    expect(parseQuantity('5 parsnips').ok).toBe(false);
    expect(parseQuantity('1e999m').ok).toBe(false);
    expect(parseQuantity('').ok).toBe(false);
  });
  it('settles ambiguous spellings by the reading module, then by the shorter prefix', () => {
    expect(readUnit('cd').length).toBeGreaterThan(1); // candela, or centi + day
    expect(parseQuantity('5cd', 'luminous')).toMatchObject({ q: { prefix: '', unit: 'cd' } });
    expect(parseQuantity('5cd', 'time')).toMatchObject({ q: { prefix: 'c', unit: 'd' } });
    expect(parseQuantity('5au')).toMatchObject({ q: { prefix: '', unit: 'au' } });
    expect(parseQuantity('5Pa', 'pressure')).toMatchObject({ q: { prefix: '', unit: 'Pa' } });
  });
});

describe('quantities: the section', () => {
  it('is a library section called Quantities, with one module per kind of quantity', () => {
    expect(CATEGORIES).toContain('Quantities');
    expect(qmods).toHaveLength(QUANTITIES.length);
    for (const n of ['Time', 'Length', 'Pressure', 'Mass', 'Temperature']) expect(qmods.some((m) => m.name === n), n).toBe(true);
    expect(new Set(qmods.map((m) => m.type)).size).toBe(qmods.length);
  });

  it('every module has Amount, Prefix and Unit setting pins that offer all 24 prefixes', () => {
    for (const m of qmods) {
      const d = getDef(m.type, undefined, defaultParams(m))!;
      expect(d.paramPins!.map((p) => p.param), m.type).toEqual(['amount', 'prefix', 'unit']);
      expect(d.paramPins!.map((p) => p.type)).toEqual(['num', 'text', 'text']);
      const prefix = paramDefsOf(m, {}).find((p) => p.key === 'prefix')!;
      expect(prefix.kind === 'select' && SPEC_PREFIXES.every((s) => prefix.options.some((o) => o.value === s))).toBe(true);
    }
  });

  it('pins keep their spacing: one row of three setting pins, never closer than the minimum', () => {
    for (const m of qmods) {
      const d = getDef(m.type, undefined, defaultParams(m))!;
      const node = { id: 'n', type: m.type, x: 0, y: 0, params: {} };
      const { w, h } = nodeSize(d);
      expect(w % 12).toBe(0);
      expect(h % 12).toBe(0);
      const pts = [...d.inputs.map((p) => portPosition(node, d, p.id, 'in')!), ...d.outputs.map((p) => portPosition(node, d, p.id, 'out')!)];
      for (const a of pts) for (const b of pts) if (a !== b && a.side === b.side) expect(Math.hypot(a.x - b.x, a.y - b.y), `${m.type} ${a.side}`).toBeGreaterThanOrEqual(PIN_SPACING);
      const left = pts.filter((p) => p.side === 'left');
      expect(left).toHaveLength(3);
      expect(h).toBeGreaterThanOrEqual((3 + 1) * PIN_SPACING);
    }
  });
});

describe('quantities: running', () => {
  it('emits <amount><unit>, the amount, the unit and the SI value', () => {
    const e = run([['q', 'qty-length', { amount: 2.5, prefix: 'k', unit: 'm' }]]);
    expect(e.out('q', 'quantity')).toBe('2.5km');
    expect(e.out('q', 'amount')).toBe(2.5);
    expect(e.out('q', 'unit')).toBe('km');
    expect(e.out('q', 'base')).toBe(2500);
  });

  it('starts out as 1 kg for Mass and 1 rpm for Rotational speed', () => {
    const e = run([['m', 'qty-mass'], ['r', 'qty-rotation']]);
    expect(e.out('m', 'quantity')).toBe('1kg');
    expect(e.out('m', 'base')).toBe(1);
    expect(e.out('r', 'quantity')).toBe('1rpm');
  });

  it('every module runs with every prefix and unit, and the SI value follows', () => {
    for (const q of QUANTITIES) for (const s of q.units) for (const p of PREFIXES) {
      const params: Params = { amount: 3, prefix: p.sym, unit: s };
      const e = run([['q', `qty-${q.id}`, params]], [], 60);
      expect(e.out('q', 'quantity'), `${q.id} ${p.sym}${s}`).toBe(`3${p.sym}${s}`);
      expect(near(e.out('q', 'base') as number, toBase(3, p.sym, s)), `${q.id} ${p.sym}${s} base`).toBe(true);
    }
  });

  it('converts a quantity arriving on the Quantity pin into its own unit and prefix', () => {
    const e = run([['src', 'qty-length', { amount: 1.5, prefix: 'k', unit: 'm' }], ['dst', 'qty-length', { prefix: 'c', unit: 'm' }]], [['src', 'quantity', 'dst', 'in']]);
    expect(e.out('dst', 'quantity')).toBe('150000cm');
    const t = run([['c', 'constant', { kind: 'text', value: '90min' }], ['h', 'qty-time', { unit: 'h' }]], [['c', 'out', 'h', 'in']]);
    expect(t.out('h', 'quantity')).toBe('1.5h');
    const k = run([['c', 'constant', { kind: 'text', value: '25°C' }], ['k', 'qty-temperature', { unit: 'K' }]], [['c', 'out', 'k', 'in']]);
    expect(k.out('k', 'quantity')).toBe('298.15K');
  });

  it('takes a plain number as an amount in its own unit', () => {
    const e = run([['n', 'constant', { value: '42' }], ['p', 'qty-pressure', { prefix: 'k', unit: 'Pa' }]], [['n', 'out', 'p', 'in']]);
    expect(e.out('p', 'quantity')).toBe('42kPa');
    expect(e.out('p', 'base')).toBe(42000);
  });

  it('keeps the amount exactly as typed, even on the Celsius scale with a tiny prefix', () => {
    const e = run([['q', 'qty-temperature', { amount: 2.5, prefix: 'n', unit: '°C' }]]);
    expect(e.out('q', 'quantity')).toBe('2.5n°C');
    expect(e.out('q', 'amount')).toBe(2.5);
  });

  it('auto picks the prefix', () => {
    expect(run([['q', 'qty-time', { amount: 0.0000025, prefix: 'auto', unit: 's' }]]).out('q', 'quantity')).toBe('2.5μs');
    expect(run([['q', 'qty-length', { amount: 1500, prefix: 'auto', unit: 'm' }]]).out('q', 'quantity')).toBe('1.5km');
    expect(run([['q', 'qty-mass', { amount: 0.5, prefix: 'auto', unit: 'g' }]]).out('q', 'quantity')).toBe('500mg');
  });

  it('setting pins drive Amount, Prefix and Unit', () => {
    const e = run(
      [['a', 'constant', { value: '7' }], ['p', 'constant', { kind: 'text', value: 'M' }], ['u', 'constant', { kind: 'text', value: 'Hz' }], ['f', 'qty-frequency']],
      [['a', 'out', 'f', 'p:amount'], ['p', 'out', 'f', 'p:prefix'], ['u', 'out', 'f', 'p:unit']],
    );
    expect(e.out('f', 'quantity')).toBe('7MHz');
    expect(e.out('f', 'base')).toBe(7e6);
  });

  it('refuses a unit of another quantity and text that is not a quantity, with a message', () => {
    const wrong = run([['c', 'constant', { kind: 'text', value: '5kg' }], ['t', 'qty-time']], [['c', 'out', 't', 'in']]);
    expect(wrong.nodes.get('t')!.status.level).toBe('error');
    expect(wrong.nodes.get('t')!.status.message).toMatch(/mass/);
    expect(wrong.out('t', 'quantity')).toBeUndefined();
    const junk = run([['c', 'constant', { kind: 'text', value: 'km5' }], ['l', 'qty-length']], [['c', 'out', 'l', 'in']]);
    expect(junk.nodes.get('l')!.status.level).toBe('error');
  });

  it('falls back to the default for a prefix or unit it does not know', () => {
    const d = getDef('qty-length', undefined, {})!;
    const r = resolveParams(d, { amount: 1, prefix: 'x', unit: 'furlong' });
    expect(r).toMatchObject({ prefix: 'none', unit: 'm' });
  });
});
