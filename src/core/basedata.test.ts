import { describe, expect, it, vi } from 'vitest';
import { Engine } from './engine';
import { addNode, connect, emptyGraph, flatten } from './graph';
import { MODULES, PIN_SPACING, defaultParams, getDef, nodeSize, paramDefsOf, portPosition } from './registry';
import { SIZES, type Graph, type Params } from './types';
import { GUIDE } from '../ui/docs/nodeGuide';
import * as bd from './basedata';

const TYPES = ['integer', 'decimal', 'string', 'character', 'boolean', 'array'];

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
const status = (e: Engine, id: string) => e.nodes.get(id)!.status;

describe('Base Data section', () => {
  it('has the six basic data types in a category and family of its own', () => {
    const list = MODULES.filter((m) => m.category === 'Base Data');
    expect(list.map((m) => m.type)).toEqual(TYPES);
    for (const m of list) { expect(m.family).toBe('data'); expect(m.source).toBe(true); }
  });

  it('looks like the yellow utility chips, with a colour of its own', async () => {
    vi.stubGlobal('requestAnimationFrame', () => 0); // the UI module starts the runtime session on import
    const { FAMILY_VAR } = await import('../ui/NodeView');
    vi.unstubAllGlobals();
    const yellow = MODULES.find((m) => m.type === 'constant')!;
    for (const t of TYPES) {
      const m = MODULES.find((x) => x.type === t)!;
      expect(m.size).toBe(yellow.size);
      expect(typeof m.chip).toBe('function');
    }
    const used = new Set(Object.entries(FAMILY_VAR).filter(([k]) => k !== 'data').map(([, v]) => v.toLowerCase()));
    expect(FAMILY_VAR.data).toMatch(/^#[0-9a-f]{6}$/i);
    expect(used.has(FAMILY_VAR.data.toLowerCase())).toBe(false);
    expect(FAMILY_VAR.data).not.toBe(FAMILY_VAR.node);
  });

  it('every setting has a setting pin on the top edge, and the node keeps its one-row chip size', () => {
    for (const t of TYPES) {
      const m = MODULES.find((x) => x.type === t)!;
      const d = getDef(t, undefined, defaultParams(m))!;
      const defs = paramDefsOf(m, defaultParams(m));
      expect(d.paramPins).toHaveLength(defs.length);
      for (const p of defs) {
        const pin = d.inputs.find((q) => q.id === `p:${p.key}`)!;
        expect(pin, `${t}.${p.key}`).toBeDefined();
        expect(pin.side).toBe('top');
        expect(pin.optional).toBe(true);
      }
      expect(nodeSize(d)).toEqual(SIZES.chip);
      // pins keep their distance
      const node = { id: 'n', type: t, x: 0, y: 0, params: {} };
      const xs = d.inputs.filter((p) => p.side === 'top').map((p) => portPosition(node, d, p.id, 'in')!.x).sort((a, b) => a - b);
      for (let i = 1; i < xs.length; i++) expect(xs[i] - xs[i - 1]).toBeGreaterThanOrEqual(PIN_SPACING);
      const bottom = d.outputs.map((p) => portPosition(node, d, p.id, 'out')!.x).sort((a, b) => a - b);
      for (let i = 1; i < bottom.length; i++) expect(bottom[i] - bottom[i - 1]).toBeGreaterThanOrEqual(PIN_SPACING);
    }
  });

  it('is documented: a guide for each, whose references all exist', () => {
    const types = new Set(MODULES.map((m) => m.type));
    for (const t of TYPES) {
      const g = GUIDE[t];
      expect(g, t).toBeDefined();
      for (const x of [...(g.up ?? []), ...(g.down ?? [])]) expect(types.has(x), `${t} → ${x}`).toBe(true);
      const text = [...g.steps, ...(g.tips ?? []), ...(g.pitfalls ?? [])].join(' ');
      for (const m of text.matchAll(/\[\[n:([\w-]+)\]\]/g)) expect(types.has(m[1]), `${t} [[n:${m[1]}]]`).toBe(true);
      const m = MODULES.find((x) => x.type === t)!;
      for (const key of Object.keys(g.settings ?? {})) expect(m.params.some((p) => p.key === key), `${t}.${key}`).toBe(true);
      for (const key of Object.keys(g.options ?? {})) expect(m.params.some((p) => p.key === key), `${t} options ${key}`).toBe(true);
    }
  });
});

describe('Integer', () => {
  it('emits its value, as text in the chosen base', () => {
    const e = build([['i', 'integer', { value: 255, base: 'hex' }]]);
    expect(e.out('i', 'out')).toBe(255);
    expect(e.out('i', 'text')).toBe('0xFF');
    expect(e.nodes.get('i')!.viewData.chip).toBe('0xFF');
  });
  it('makes whatever arrives whole, by the chosen rounding', () => {
    const run = (rounding: string, v: string) => build([['c', 'constant', { value: v }], ['i', 'integer', { rounding }]], [['c', 'out', 'i', 'in']]).out('i', 'out');
    expect(run('trunc', '-2.7')).toBe(-2);
    expect(run('round', '2.5')).toBe(3);
    expect(run('floor', '-2.1')).toBe(-3);
    expect(run('ceil', '2.1')).toBe(3);
  });
  it('reads true as 1 and text such as 0x1F as a number; rejects what is not a number', () => {
    expect(build([['c', 'constant', { kind: 'bool', value: 'true' }], ['i', 'integer']], [['c', 'out', 'i', 'in']]).out('i', 'out')).toBe(1);
    expect(build([['c', 'constant', { kind: 'text', value: '0x1F' }], ['i', 'integer']], [['c', 'out', 'i', 'in']]).out('i', 'out')).toBe(31);
    const e = build([['c', 'constant', { kind: 'text', value: 'abc' }], ['i', 'integer']], [['c', 'out', 'i', 'in']]);
    expect(status(e, 'i').level).toBe('error');
  });
  it('holds out-of-range values at the 32-bit limit with a warning', () => {
    const e = build([['c', 'constant', { value: '1e12' }], ['i', 'integer']], [['c', 'out', 'i', 'in']]);
    expect(e.out('i', 'out')).toBe(2147483647);
    expect(status(e, 'i').level).toBe('warn');
  });
  it('its Value and Base settings can be driven through their pins', () => {
    const e = build([['c', 'constant', { value: '3.9' }], ['b', 'constant', { kind: 'text', value: 'bin' }], ['i', 'integer', { value: 1 }]], [['c', 'out', 'i', 'p:value'], ['b', 'out', 'i', 'p:base']]);
    expect(e.out('i', 'out')).toBe(3);
    expect(e.out('i', 'text')).toBe('0b11');
  });
  it('formats', () => {
    expect(bd.fmtInt(-10, 'oct')).toBe('-0o12');
    expect(bd.fmtInt(5, 'bin')).toBe('0b101');
    expect(bd.roundInt(-0.2, 'round')).toBe(0);
    expect(Object.is(bd.roundInt(-0.2, 'trunc'), 0)).toBe(true);
  });
});

describe('Decimal', () => {
  const PI = '3.14159265358979323846264338327950288419716939937510';
  it('never rounds: every typed digit comes out on Text, even beyond a double', () => {
    const e = build([['d', 'decimal', { value: PI }]]);
    expect(e.out('d', 'text')).toBe(PI);
    expect(e.out('d', 'out')).toBe(Math.PI);
  });
  it('keeps trailing zeros and expands exponents', () => {
    expect(build([['d', 'decimal', { value: '3.500' }]]).out('d', 'text')).toBe('3.500');
    expect(build([['d', 'decimal', { value: '6.022e23' }]]).out('d', 'text')).toBe('602200000000000000000000');
    expect(build([['d', 'decimal', { value: '-1.5e-7' }]]).out('d', 'text')).toBe('-0.00000015');
    expect(build([['d', 'decimal', { value: '.5' }]]).out('d', 'text')).toBe('0.5');
  });
  it('hands text to the next Decimal without losing a digit', () => {
    const e = build([['a', 'decimal', { value: PI }], ['b', 'decimal']], [['a', 'text', 'b', 'in']]);
    expect(e.out('b', 'text')).toBe(PI);
  });
  it('no longer has places or notation: those moved to the Number Formatter', () => {
    expect(paramDefsOf(getDef('decimal')!, {}).map((p) => p.key)).toEqual(['value']);
  });
  it('reads a number from an old program (value saved as a number) without rounding it', () => {
    const e = build([['d', 'decimal', { value: 0.1 + 0.2, places: 2, notation: 'fixed' }]]);
    expect(e.out('d', 'text')).toBe('0.30000000000000004');
  });
  it('a number arriving on the Input is read by its shortest exact text', () => {
    const e = build([['c', 'constant', { value: 0.1 + 0.2 }], ['d', 'decimal']], [['c', 'out', 'd', 'in']]);
    expect(e.out('d', 'text')).toBe('0.30000000000000004');
    expect(e.out('d', 'out')).toBe(0.1 + 0.2);
  });
  it('a number sent to the Value setting pin keeps every digit', () => {
    const e = build([['c', 'constant', { value: 1 / 3 }], ['d', 'decimal', { value: '1' }]], [['c', 'out', 'd', 'p:value']]);
    expect(e.out('d', 'text')).toBe('0.3333333333333333');
  });
  it('rejects text that is not a number', () => {
    const e = build([['c', 'constant', { kind: 'text', value: '1,5' }], ['d', 'decimal']], [['c', 'out', 'd', 'in']]);
    expect(status(e, 'd').level).toBe('error');
    expect(status(build([['d', 'decimal', { value: 'abc' }]]), 'd').level).toBe('error');
  });
  it('holds a number beyond a double on Text and warns on the Decimal pin', () => {
    const e = build([['d', 'decimal', { value: '1e400' }]]);
    expect(e.out('d', 'out')).toBeUndefined();
    expect(e.out('d', 'text')).toBe('1' + '0'.repeat(400));
    expect(status(e, 'd').level).toBe('warn');
  });
});

describe('String', () => {
  it('applies case and trim, and counts characters like a person', () => {
    const e = build([['s', 'string', { value: '  hello world 😀 ', trim: true, case: 'title' }]]);
    expect(e.out('s', 'out')).toBe('Hello World 😀');
    expect(e.out('s', 'length')).toBe(13);
  });
  it('turns any signal into text', () => {
    const e = build([['c', 'constant', { value: '2.5' }], ['s', 'string']], [['c', 'out', 's', 'in']]);
    expect(e.out('s', 'out')).toBe('2.5');
    expect(build([['c', 'constant', { kind: 'bool', value: 'true' }], ['s', 'string']], [['c', 'out', 's', 'in']]).out('s', 'out')).toBe('true');
  });
  it('shows its text in quotes', () => {
    expect(bd.quote('a "b"\n')).toBe('"a \\"b\\"\\n"');
  });
});

describe('Character', () => {
  it('emits one character and its code point', () => {
    const e = build([['c', 'character', { value: 'a', case: 'upper' }]]);
    expect(e.out('c', 'out')).toBe('A');
    expect(e.out('c', 'code')).toBe(65);
    expect(e.nodes.get('c')!.viewData.chip).toBe("'A' · U+0041");
  });
  it('handles characters outside the basic plane as one character', () => {
    const e = build([['c', 'character', { value: '😀' }]]);
    expect(e.out('c', 'out')).toBe('😀');
    expect(e.out('c', 'code')).toBe(0x1f600);
    expect(status(e, 'c').level).toBe('ok');
  });
  it('warns when more than one character is typed, errors when none', () => {
    expect(status(build([['c', 'character', { value: 'ab' }]]), 'c').level).toBe('warn');
    expect(status(build([['c', 'character', { value: '' }]]), 'c').level).toBe('error');
  });
  it('takes the first character of text, or reads a number as a code point', () => {
    const t = build([['c', 'constant', { kind: 'text', value: 'zebra' }], ['h', 'character']], [['c', 'out', 'h', 'in']]);
    expect(t.out('h', 'out')).toBe('z');
    const n = build([['c', 'constant', { value: '66' }], ['h', 'character', { numbers: 'code' }]], [['c', 'out', 'h', 'in']]);
    expect(n.out('h', 'out')).toBe('B');
    const asText = build([['c', 'constant', { value: '66' }], ['h', 'character']], [['c', 'out', 'h', 'in']]);
    expect(asText.out('h', 'out')).toBe('6');
    const bad = build([['c', 'constant', { value: '-1' }], ['h', 'character', { numbers: 'code' }]], [['c', 'out', 'h', 'in']]);
    expect(status(bad, 'h').level).toBe('error');
  });
  it('never lets a capital grow past one character', () => {
    expect(bd.caseChar('ß', 'upper')).toBe('ß');
    expect(bd.caseChar('é', 'upper')).toBe('É');
  });
});

describe('Boolean', () => {
  it('emits the value, its opposite and the words', () => {
    const e = build([['b', 'boolean', { value: true, words: 'yn' }]]);
    expect(e.out('b', 'out')).toBe(true);
    expect(e.out('b', 'not')).toBe(false);
    expect(e.out('b', 'text')).toBe('yes');
  });
  it('reads words as a person means them', () => {
    for (const [v, want] of [['off', false], ['no', false], ['0', false], ['', false], ['yes', true], ['hello', true]] as const) expect(bd.readBool(v)).toBe(want);
    expect(bd.readBool(0)).toBe(false);
    expect(bd.readBool([])).toBe(false);
    expect(bd.readBool([0])).toBe(true);
    const e = build([['c', 'constant', { kind: 'text', value: 'off' }], ['b', 'boolean']], [['c', 'out', 'b', 'in']]);
    expect(e.out('b', 'out')).toBe(false);
    expect(e.out('b', 'not')).toBe(true);
  });
  it('its Value can be driven through its pin', () => {
    const e = build([['c', 'constant', { kind: 'bool', value: 'false' }], ['b', 'boolean', { value: true }]], [['c', 'out', 'b', 'p:value']]);
    expect(e.out('b', 'out')).toBe(false);
  });
});

describe('Array', () => {
  it('splits its items, and reads the length and the item at the index', () => {
    const e = build([['a', 'array', { items: '1, 2, hello, true', index: 2 }]]);
    expect(e.out('a', 'out')).toEqual([1, 2, 'hello', true]);
    expect(e.out('a', 'length')).toBe(4);
    expect(e.out('a', 'item')).toBe('hello');
    expect(e.nodes.get('a')!.viewData.chip).toBe('[1, 2, "hello", true]');
  });
  it('counts negative indexes from the end, and warns outside the list', () => {
    expect(build([['a', 'array', { index: -1 }]]).out('a', 'item')).toBe(3);
    const e = build([['a', 'array', { index: 9 }]]);
    expect(e.out('a', 'item')).toBeUndefined();
    expect(status(e, 'a').level).toBe('warn');
    expect(e.out('a', 'length')).toBe(3);
  });
  it('reads a JSON list, a custom separator, characters, and the Items as setting', () => {
    expect(build([['a', 'array', { items: '[1, "a,b", true]' }]]).out('a', 'out')).toEqual([1, 'a,b', true]);
    expect(build([['a', 'array', { items: 'x;y;z', separator: ';' }]]).out('a', 'out')).toEqual(['x', 'y', 'z']);
    expect(build([['a', 'array', { items: 'abc', separator: '' }]]).out('a', 'out')).toEqual(['a', 'b', 'c']);
    expect(build([['a', 'array', { items: '1, 2', as: 'text' }]]).out('a', 'out')).toEqual(['1', '2']);
    expect(status(build([['a', 'array', { items: '1, x', as: 'number' }]]), 'a').level).toBe('error');
  });
  it('takes text, lists and single values on its Input', () => {
    const fromText = build([['c', 'constant', { kind: 'text', value: '4 5 6' }], ['a', 'array', { separator: ' ' }]], [['c', 'out', 'a', 'in']]);
    expect(fromText.out('a', 'out')).toEqual([4, 5, 6]);
    const single = build([['c', 'constant', { value: '7' }], ['a', 'array']], [['c', 'out', 'a', 'in']]);
    expect(single.out('a', 'out')).toEqual([7]);
    const chain = build([['a', 'array', { items: '9, 8, 7' }], ['b', 'array', { index: 1 }]], [['a', 'out', 'b', 'in']]);
    expect(chain.out('b', 'out')).toEqual([9, 8, 7]);
    expect(chain.out('b', 'item')).toBe(8);
  });
  it('the Index can be driven through its setting pin', () => {
    const e = build([['c', 'constant', { value: '1' }], ['a', 'array', { items: 'a, b, c', index: 0 }]], [['c', 'out', 'a', 'p:index']]);
    expect(e.out('a', 'item')).toBe('b');
  });
  it('an empty list is fine and warns only about the missing item', () => {
    const e = build([['a', 'array', { items: '' }]]);
    expect(e.out('a', 'out')).toEqual([]);
    expect(e.out('a', 'length')).toBe(0);
  });
});

describe('types connect to the rest of the program', () => {
  it('Integer feeds an Adder; String feeds a String; Array length feeds Compare', () => {
    const e = build(
      [['i', 'integer', { value: 4 }], ['d', 'decimal', { value: 1.5 }], ['add', 'add'], ['a', 'array', { items: '1,2,3' }], ['cmp', 'compare']],
      [['i', 'out', 'add', 'a'], ['d', 'out', 'add', 'b'], ['a', 'length', 'cmp', 'a']],
    );
    expect(e.out('add', 'out')).toBe(5.5);
  });
  it('a list can be sent to a text input and a Boolean to a number input', () => {
    let g = emptyGraph();
    g = addNode(g, 'array', 0, 0, {}, undefined, 'a').graph;
    g = addNode(g, 'boolean', 0, 0, {}, undefined, 'b').graph;
    g = addNode(g, 'integer', 0, 0, {}, undefined, 'i').graph;
    g = addNode(g, 'projector', 0, 0, {}, undefined, 'p').graph;
    expect(connect(g, 'b', 'out', 'i', 'p:value').error).toBeUndefined();
    expect(connect(g, 'a', 'out', 'p', 'text').error ?? '').not.toMatch(/cannot drive/);
  });
});
