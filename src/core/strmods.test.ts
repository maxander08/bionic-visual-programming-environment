import { describe, expect, it, vi } from 'vitest';
import { Engine } from './engine';
import { addNode, connect, emptyGraph, flatten } from './graph';
import { CATEGORIES, MODULES, getDef } from './registry';
import type { Graph, Params } from './types';
import * as S from './strings';

const TYPES = MODULES.filter((m) => m.category === 'String Modifiers').map((m) => m.type);

/** A String module (id "src", the given text) feeding the module under test (id "n") on its String input, plus extra feeders. */
function run(type: string, params: Params, text: string, extra: [string, string, Params, string, string][] = []) {
  let g: Graph = addNode(emptyGraph(), 'string', 0, 0, { value: text }, undefined, 'src').graph;
  g = addNode(g, type, 300, 0, params, undefined, 'n').graph;
  const wire = (a: string, ap: string, b: string, bp: string) => { const r = connect(g, a, ap, b, bp); if (r.error) throw new Error(r.error); g = r.graph; };
  wire('src', 'out', 'n', type === 'str-format' ? 'a' : 'in');
  for (const [id, t, p, from, to] of extra) { g = addNode(g, t, 0, 100, p, undefined, id).graph; wire(id, from, 'n', to); }
  const e = new Engine(50);
  e.load(flatten(g));
  e.runFor(200);
  return e;
}
const out = (e: Engine, port = 'out') => e.nodes.get('n')!.outputs[port]?.v;
const failed = (e: Engine) => e.diagnostics().some((d) => d.nodeId === 'n' && d.level === 'error');
const go = (type: string, params: Params, text: string, port = 'out') => out(run(type, params, text), port);

describe('String Modifiers section', () => {
  it('is its own library section, right after the Node section, in a colour of its own', async () => {
    expect(CATEGORIES.indexOf('String Modifiers')).toBe(CATEGORIES.indexOf('Node') + 1);
    expect(TYPES.length).toBeGreaterThanOrEqual(20);
    expect(TYPES).toEqual(expect.arrayContaining(['str-add', 'str-mul', 'str-split', 'str-case']));
    for (const m of MODULES.filter((x) => x.category === 'String Modifiers')) {
      expect(m.family).toBe('strmod');
      expect(m.size).toBe('chip'); // the same one-row chip as the Node section
      expect(m.name.startsWith('String ')).toBe(true);
    }
    expect(new Set(MODULES.map((m) => m.type)).size).toBe(MODULES.length);
    vi.stubGlobal('requestAnimationFrame', () => 0); // the UI module starts the runtime session on import
    const { FAMILY_VAR } = await import('../ui/NodeView');
    vi.unstubAllGlobals();
    expect(FAMILY_VAR.strmod).toMatch(/^#[0-9a-f]{6}$/i);
    expect(Object.entries(FAMILY_VAR).filter(([k, v]) => k !== 'strmod' && v.toLowerCase() === FAMILY_VAR.strmod.toLowerCase())).toEqual([]);
  });
  it('gives every module a working default (no failure on a plain text)', () => {
    for (const t of TYPES) {
      const e = run(t, {}, t === 'str-ord' ? 'A' : 'Hello World');
      expect(failed(e), t).toBe(false);
      expect(getDef(t)!.outputs.length).toBeGreaterThan(0);
    }
  });
});

describe('String Adder and Multiplier', () => {
  it('adds strings like Python’s +', () => {
    expect(go('str-add', { add: '!' }, 'Hi')).toBe('Hi!');
    const e = run('str-add', { add: '-' }, 'a', [['b', 'string', { value: 'b' }, 'out', 'b']]);
    expect(out(e)).toBe('ab-');
    expect(go('str-add', { add: '\\n.' }, 'x')).toBe('x\n.');
  });
  it('multiplies strings like Python’s *', () => {
    expect(go('str-mul', { times: 3 }, 'ab')).toBe('ababab');
    expect(go('str-mul', { times: 0 }, 'ab')).toBe('');
    expect(go('str-mul', { times: -2 }, 'ab')).toBe('');
    const e = run('str-mul', { times: 9 }, 'ab', [['b', 'integer', { value: 2 }, 'out', 'b']]);
    expect(out(e)).toBe('abab');
    expect(failed(run('str-mul', { times: 1000000 }, 'abcdefghij'))).toBe(true);
    expect(S.repeat('', 1000000)).toBe('');
  });
});

describe('split, join, partition', () => {
  it('splits like Python', () => {
    expect(S.split('a,b,,c', ',', -1)).toEqual(['a', 'b', '', 'c']);
    expect(S.split('', ',', -1)).toEqual(['']);
    expect(S.split('  a  b c ', '', -1)).toEqual(['a', 'b', 'c']);
    expect(S.split('a,b,c,d', ',', 2)).toEqual(['a', 'b', 'c,d']);
    expect(S.split('a,b,c,d', ',', 2, true)).toEqual(['a,b', 'c', 'd']);
    expect(S.split('a b  c ', '', 1)).toEqual(['a', 'b  c ']);
    expect(S.split(' a b c', '', 1, true)).toEqual([' a b', 'c']);
    expect(S.split('a::b::c', '::', 1, true)).toEqual(['a::b', 'c']);
    expect(S.splitLines('a\nb\r\nc\n', false)).toEqual(['a', 'b', 'c']);
    expect(S.splitLines('a\nb\r\nc', true)).toEqual(['a\n', 'b\r\n', 'c']);
    expect(S.splitLines('', false)).toEqual([]);
  });
  it('sends the list and its count', () => {
    const e = run('str-split', { sep: ',', mode: 'split' }, 'x,y,z');
    expect(out(e)).toEqual(['x', 'y', 'z']);
    expect(out(e, 'count')).toBe(3);
    expect(go('str-split', { mode: 'splitlines' }, 'one\ntwo')).toEqual(['one', 'two']);
    expect(go('str-split', { mode: 'split', sep: '\\n' }, 'one\ntwo')).toEqual(['one', 'two']);
  });
  it('joins a list, a text or a single value', () => {
    let g: Graph = addNode(emptyGraph(), 'array', 0, 0, { items: '1, 2, 3' }, undefined, 'arr').graph;
    g = addNode(g, 'str-join', 300, 0, { sep: '-' }, undefined, 'n').graph;
    g = connect(g, 'arr', 'out', 'n', 'in').graph;
    const e = new Engine(50); e.load(flatten(g)); e.runFor(200);
    expect(out(e)).toBe('1-2-3');
    expect(go('str-join', { sep: '.' }, 'abc')).toBe('a.b.c');
  });
  it('partitions in three', () => {
    expect(S.partition('a=b=c', '=', false)).toEqual(['a', '=', 'b=c']);
    expect(S.partition('a=b=c', '=', true)).toEqual(['a=b', '=', 'c']);
    expect(S.partition('abc', '=', false)).toEqual(['abc', '', '']);
    expect(S.partition('abc', '=', true)).toEqual(['', '', 'abc']);
    expect(() => S.partition('abc', '', false)).toThrow('empty separator');
    const e = run('str-partition', { mode: 'partition', sep: '=' }, 'volume=7');
    expect([out(e, 'head'), out(e, 'sep'), out(e, 'tail')]).toEqual(['volume', '=', '7']);
    expect(failed(run('str-partition', { sep: '' }, 'abc'))).toBe(true);
  });
});

describe('case, strip, remove, replace, translate', () => {
  it('changes case like Python', () => {
    expect(S.changeCase("they're a TEST", 'title')).toBe("They'Re A Test");
    expect(S.changeCase('hELLO wORLD', 'capitalize')).toBe('Hello world');
    expect(S.changeCase('Hello', 'swapcase')).toBe('hELLO');
    expect(S.changeCase('Straße', 'casefold')).toBe('strasse');
    expect(S.changeCase('Straße', 'upper')).toBe('STRASSE');
    expect(go('str-case', { mode: 'upper' }, 'abc')).toBe('ABC');
  });
  it('strips, removes and replaces like Python', () => {
    expect(S.strip('  hi \n', '', 'both')).toBe('hi');
    expect(S.strip('  hi ', '', 'left')).toBe('hi ');
    expect(S.strip('  hi ', '', 'right')).toBe('  hi');
    expect(S.strip('xxhixyx', 'xy', 'both')).toBe('hi');
    expect(go('str-strip', { mode: 'strip', chars: '' }, '  pad  ')).toBe('pad');
    expect(S.removeAffix('test_file', 'test_', 'prefix')).toBe('file');
    expect(S.removeAffix('file.py', '.py', 'suffix')).toBe('file');
    expect(S.removeAffix('file', '.py', 'suffix')).toBe('file');
    expect(S.replace('banana', 'an', 'AN', -1)).toBe('bANANa');
    expect(S.replace('banana', 'an', 'AN', 1)).toBe('bANana');
    expect(S.replace('abc', '', '-', -1)).toBe('-a-b-c-');
    expect(S.replace('abc', '', '-', 2)).toBe('-a-bc');
    expect(S.replace('abc', 'b', '', -1)).toBe('ac');
    expect(go('str-replace', { old: ' ', new: '_', count: -1 }, 'a b c')).toBe('a_b_c');
  });
  it('translates single characters', () => {
    expect(S.translate('abc', 'ab', 'ba', '')).toBe('bac');
    expect(S.translate('hello', '', '', 'l')).toBe('heo');
    expect(() => S.translate('x', 'ab', 'c', '')).toThrow();
    expect(failed(run('str-translate', { from: 'ab', to: 'c' }, 'x'))).toBe(true);
  });
});

describe('find, count, tests', () => {
  it('finds like Python (positions in characters)', () => {
    expect(S.find('hello', 'l', undefined, undefined, false)).toBe(2);
    expect(S.find('hello', 'l', undefined, undefined, true)).toBe(3);
    expect(S.find('hello', 'z', undefined, undefined, false)).toBe(-1);
    expect(S.find('hello', 'l', 3, undefined, false)).toBe(3);
    expect(S.find('hello', 'l', -2, undefined, false)).toBe(3);
    expect(S.find('hello', 'h', 0, 0, false)).toBe(-1);
    expect(S.find('😀a', 'a', undefined, undefined, false)).toBe(1);
    expect(S.find('abc', '', undefined, undefined, true)).toBe(3);
    const e = run('str-find', { mode: 'find', sub: 'z' }, 'hello');
    expect(out(e, 'index')).toBe(-1);
    expect(out(e, 'found')).toBe(false);
    expect(failed(run('str-find', { mode: 'index', sub: 'z' }, 'hello'))).toBe(true);
    expect(out(run('str-find', { mode: 'rindex', sub: 'l' }, 'hello'), 'index')).toBe(3);
    expect(failed(run('str-find', { mode: 'find', sub: 'l', start: 'x' }, 'hello'))).toBe(true);
  });
  it('counts like Python', () => {
    expect(S.count('banana', 'a', undefined, undefined)).toBe(3);
    expect(S.count('aaa', 'aa', undefined, undefined)).toBe(1);
    expect(S.count('abc', '', undefined, undefined)).toBe(4);
    expect(S.count('banana', 'a', 2, undefined)).toBe(2);
    expect(go('str-count', { sub: 'l' }, 'hello')).toBe(2);
  });
  it('tests like Python’s is…() methods', () => {
    const T = S.TESTS;
    expect(T.isalpha('abc')).toBe(true); expect(T.isalpha('ab1')).toBe(false); expect(T.isalpha('')).toBe(false);
    expect(T.isdecimal('123')).toBe(true); expect(T.isdecimal('²')).toBe(false); expect(T.isdigit('²')).toBe(true); expect(T.isnumeric('½')).toBe(true); expect(T.isnumeric('五')).toBe(true);
    expect(T.isalnum('a1')).toBe(true); expect(T.isalnum('a 1')).toBe(false);
    expect(T.isspace(' \t\n')).toBe(true); expect(T.isspace('')).toBe(false);
    expect(T.isupper('ABC1')).toBe(true); expect(T.isupper('Abc')).toBe(false); expect(T.isupper('123')).toBe(false);
    expect(T.islower('abc1')).toBe(true); expect(T.islower('aBc')).toBe(false);
    expect(T.istitle('Hello World')).toBe(true); expect(T.istitle('Hello world')).toBe(false); expect(T.istitle('Hello World 1')).toBe(true);
    expect(T.isidentifier('_x1')).toBe(true); expect(T.isidentifier('1x')).toBe(false); expect(T.isidentifier('')).toBe(false);
    expect(T.isascii('abc')).toBe(true); expect(T.isascii('é')).toBe(false); expect(T.isascii('')).toBe(true);
    expect(T.isprintable('abc def')).toBe(true); expect(T.isprintable('a\nb')).toBe(false); expect(T.isprintable('')).toBe(true);
    expect(go('str-check', { mode: 'isdigit' }, '123')).toBe(true);
    expect(go('str-match', { mode: 'startswith', sub: 'he' }, 'hello')).toBe(true);
    expect(go('str-match', { mode: 'endswith', sub: 'he' }, 'hello')).toBe(false);
    expect(go('str-match', { mode: 'contains', sub: 'ell' }, 'hello')).toBe(true);
  });
});

describe('align, tabs, slice, index, reverse, length', () => {
  it('pads like Python', () => {
    expect(S.align('ab', 'center', 7, '*')).toBe('***ab**');
    expect(S.align('abc', 'center', 6, '*')).toBe('*abc**');
    expect(S.align('ab', 'ljust', 5, '.')).toBe('ab...');
    expect(S.align('ab', 'rjust', 5, '.')).toBe('...ab');
    expect(S.align('-42', 'zfill', 6, ' ')).toBe('-00042');
    expect(S.align('abcdef', 'center', 3, ' ')).toBe('abcdef');
    expect(() => S.align('a', 'center', 5, '')).toThrow();
    expect(() => S.align('a', 'center', 5, 'ab')).toThrow();
    expect(go('str-align', { mode: 'rjust', width: 4, fill: '0' }, '7')).toBe('0007');
  });
  it('expands tabs like Python', () => {
    expect(S.expandTabs('a\tb', 4)).toBe('a   b');
    expect(S.expandTabs('ab\tc\n\td', 4)).toBe('ab  c\n    d');
    expect(S.expandTabs('a\tb', 0)).toBe('ab');
  });
  it('slices like Python', () => {
    expect(S.slice('hello', 1, -1)).toBe('ell');
    expect(S.slice('hello', undefined, undefined, -1)).toBe('olleh');
    expect(S.slice('hello', undefined, undefined, 2)).toBe('hlo');
    expect(S.slice('hello', -3)).toBe('llo');
    expect(S.slice('hello', 10)).toBe('');
    expect(S.slice('hello', -100, 2)).toBe('he');
    expect(S.slice('hello', 3, 0, -1)).toBe('lle');
    expect(S.slice('hello', 1, undefined, -1)).toBe('eh');
    expect(S.slice('hello', -1, -4, -1)).toBe('oll');
    expect(() => S.slice('hello', 0, 1, 0)).toThrow();
    expect(go('str-slice', { start: '1', stop: '-1', step: '' }, 'hello')).toBe('ell');
    expect(failed(run('str-slice', { step: '0' }, 'hello'))).toBe(true);
  });
  it('indexes, reverses and measures like Python', () => {
    expect(S.charAt('hello', -1)).toBe('o');
    expect(() => S.charAt('hello', 5)).toThrow('string index out of range');
    expect(go('str-index', { index: 1 }, 'hello')).toBe('e');
    expect(failed(run('str-index', { index: 9 }, 'hello'))).toBe(true);
    expect(go('str-reverse', { unit: 'chars' }, 'abc😀')).toBe('😀cba');
    expect(go('str-reverse', { unit: 'words' }, 'one two  three')).toBe('three two one');
    expect(go('str-len', { unit: 'chars' }, 'a😀')).toBe(2);
    expect(go('str-len', { unit: 'bytes' }, 'é五')).toBe(5);
    expect(go('str-len', { unit: 'words' }, ' a b  c ')).toBe(3);
    expect(go('str-len', { unit: 'lines' }, 'a\nb\n')).toBe(2);
  });
});

describe('format, repr, ord and chr', () => {
  const A = (name: string, v: unknown) => ({ name, text: typeof v === 'string' ? v : String(v), num: typeof v === 'number' ? v : undefined, bool: typeof v === 'boolean' });
  it('formats like str.format', () => {
    expect(S.format('{} and {}', [A('a', 'x'), A('b', 'y')])).toBe('x and y');
    expect(S.format('{1}{0}{1}', [A('a', 'x'), A('b', 'y')])).toBe('yxy');
    expect(S.format('{a}-{b}', [A('a', 1), A('b', 2)])).toBe('1-2');
    expect(S.format('{{}} {}', [A('a', 'x')])).toBe('{} x');
    expect(S.format('{:>5}|{:<5}|{:^5}', [A('a', 'a'), A('b', 'b'), A('c', 'c')])).toBe('    a|b    |  c  ');
    expect(S.format('{:*^7}', [A('a', 'mid')])).toBe('**mid**');
    expect(S.format('{:.2f}', [A('a', 3.14159)])).toBe('3.14');
    expect(S.format('{:05d}', [A('a', 42)])).toBe('00042');
    expect(S.format('{:+d}', [A('a', 42)])).toBe('+42');
    expect(S.format('{:,}', [A('a', 1234567)])).toBe('1,234,567');
    expect(S.format('{:x} {:X} {:b} {:o}', [A('a', 255), A('b', 255), A('c', 5), A('d', 8)])).toBe('ff FF 101 10');
    expect(S.format('{:#x}', [A('a', 255)])).toBe('0xff');
    expect(S.format('{:.1%}', [A('a', 0.256)])).toBe('25.6%');
    expect(S.format('{:.1f} {:.1f} {:.0f} {:.0f} {:.2f}', [A('a', 0.25), A('b', 0.35), A('c', 0.5), A('d', 1.5), A('e', 2.675)])).toBe('0.2 0.3 0 2 2.67');
    expect(S.format('{:e}', [A('a', 12345.678)])).toBe('1.234568e+04');
    expect(S.format('{:8.3f}|', [A('a', 2.5)])).toBe('   2.500|');
    expect(S.format('{:.3}', [A('a', 'abcdef')])).toBe('abc');
    expect(S.format('{!r}', [A('a', "it's")])).toBe('"it\'s"');
    expect(S.format('{:{}}|', [A('a', 'x'), A('b', 4)])).toBe('x   |');
    expect(() => S.format('{} {}', [A('a', 'x')])).toThrow();
    expect(() => S.format('{', [A('a', 'x')])).toThrow();
    expect(() => S.format('{:d}', [A('a', 'x')])).toThrow();
    expect(() => S.format('{} {0}', [A('a', 'x')])).toThrow();
    expect(S.format('{c}', [undefined, undefined, A('c', 'z')])).toBe('z');
    expect(() => S.format('{b}', [A('a', 'x'), undefined])).toThrow();
  });
  it('runs the Formatter on connected values', () => {
    const e = run('str-format', { template: '{a}={b:.1f}' }, 'k', [['num', 'decimal', { value: 2.25 }, 'out', 'b']]);
    expect(out(e)).toBe('k=2.2');
    expect(failed(run('str-format', { template: '{} {}' }, 'k'))).toBe(true);
  });
  it('shows repr and ascii', () => {
    expect(S.repr("it's", false)).toBe('"it\'s"');
    expect(S.repr('a\nb\t\\', false)).toBe("'a\\nb\\t\\\\'");
    expect(S.repr('é五', false)).toBe("'é五'");
    expect(S.repr('é五😀', true)).toBe("'\\xe9\\u4e94\\U0001f600'");
    expect(S.repr('\x00', false)).toBe("'\\x00'");
    expect(go('str-repr', { mode: 'repr' }, 'a b')).toBe("'a b'");
  });
  it('converts with ord and chr', () => {
    expect(S.ord('A')).toBe(65);
    expect(S.ord('😀')).toBe(128512);
    expect(() => S.ord('ab')).toThrow();
    expect(() => S.ord('')).toThrow();
    expect(S.chr(65)).toBe('A');
    expect(S.chr(128512)).toBe('😀');
    expect(() => S.chr(-1)).toThrow();
    expect(() => S.chr(0x110000)).toThrow();
    expect(go('str-ord', { mode: 'ord' }, 'A')).toBe(65);
    expect(go('str-ord', { mode: 'chr' }, '66')).toBe('B');
    expect(failed(run('str-ord', { mode: 'ord' }, 'AB'))).toBe(true);
  });
});
