import { describe, expect, it } from 'vitest';
import { toNum } from './util';
import { checkSymbols, DEFAULT_SYMBOLS, parseBased } from './baseconv';
import { Engine } from './engine';
import { addNode, connect, emptyGraph, flatten, setParams } from './graph';
import { magnitude } from './linalg';
import { trIn } from '../i18n';

const vectorRun = (items: string) => {
  const graph = addNode(emptyGraph(), 'vector', 0, 0, { items, normalize: true }, undefined, 'v').graph;
  const engine = new Engine(50);
  engine.load(flatten(graph));
  engine.runFor(200);
  return engine;
};

describe('new module edge cases', () => {
  it('keeps base 37–40 case-sensitive while accepting either case through base 36', () => {
    expect(parseBased('ff', 16, DEFAULT_SYMBOLS).ok).toBe(true);
    expect(parseBased('a', 37, DEFAULT_SYMBOLS)).toEqual({ ok: true, value: { neg: false, n: 36n, d: 1n } });
    expect(parseBased('b', 37, DEFAULT_SYMBOLS).ok).toBe(false);
    expect(parseBased('e', 40, DEFAULT_SYMBOLS).ok).toBe(false);
  });

  it('rejects Unicode whitespace as a digit symbol', () => {
    expect(checkSymbols('0\u00a0', 2)).toBeDefined();
    expect(checkSymbols('0\u2009', 2)).toBeDefined();
  });

  it('accepts U+2026 when it is a custom base digit', () => {
    expect(parseBased('…', 2, '0…')).toEqual({ ok: true, value: { neg: false, n: 1n, d: 1n } });
  });

  it('computes magnitudes without premature overflow or underflow', () => {
    expect(toNum(magnitude([1e200, 1e200])) / 1e200).toBeCloseTo(Math.SQRT2, 12);
    expect(toNum(magnitude([1e-200, 1e-200])) / 1e-200).toBeCloseTo(Math.SQRT2, 12);
  });

  it('normalizes very large and very small vectors without losing their direction', () => {
    for (const items of ['1e200, 1e200', '1e-200, 1e-200', '1.7e308, 1.7e308']) {
      const engine = vectorRun(items);
      const values = (engine.out('v', 'out') as unknown[]).map(toNum);
      expect(values[0], items).toBeCloseTo(Math.SQRT1_2, 12);
      expect(values[1], items).toBeCloseTo(Math.SQRT1_2, 12);
      expect(toNum(engine.out('v', 'magnitude')), items).toBeCloseTo(1, 12);
      expect(engine.nodes.get('v')!.status.level, items).toBe('ok');
    }
  });

  it.each([
    { type: 'vector', initial: { items: '3, 4', index: 0 }, invalid: { index: 4 }, valid: { index: 1 }, empty: { items: '' }, first: 3, second: 4 },
    { type: 'matrix', initial: { values: '1, 2; 3, 4', row: 0, col: 0 }, invalid: { row: 4 }, valid: { row: 1 }, empty: { values: '' }, first: 1, second: 3 },
  ])('$type clears its Item output and downstream signal when the selected entry disappears', ({ type, initial, invalid, valid, empty, first, second }) => {
    let graph = addNode(emptyGraph(), type, 0, 0, initial, undefined, 'source').graph;
    graph = addNode(graph, 'projector', 300, 0, {}, undefined, 'sink').graph;
    const connection = connect(graph, 'source', 'item', 'sink', 'in');
    expect(connection.error).toBeUndefined();
    graph = connection.graph;
    const engine = new Engine(50);
    const update = (patch: Record<string, unknown>) => {
      graph = setParams(graph, 'source', patch);
      engine.load(flatten(graph));
      engine.runFor(100);
    };
    engine.load(flatten(graph));
    engine.runFor(100);
    expect(engine.out('source', 'item')).toBe(first);
    expect(engine.nodes.get('sink')!.inputs.in?.v).toBe(first);
    update(invalid);
    expect(engine.nodes.get('source')!.status.level).toBe('warn');
    expect(engine.out('source', 'item')).toBeUndefined();
    expect(engine.nodes.get('sink')!.inputs.in).toBeUndefined();
    update(valid);
    expect(engine.out('source', 'item')).toBe(second);
    expect(engine.nodes.get('sink')!.inputs.in?.v).toBe(second);
    update(empty);
    expect(engine.nodes.get('source')!.status.level).toBe('warn');
    expect(engine.out('source', 'item')).toBeUndefined();
    expect(engine.nodes.get('sink')!.inputs.in).toBeUndefined();
  });

  it.each(['zh-Hans', 'zh-Hant'] as const)('translates new labels and validation messages in %s', (lang) => {
    for (const text of ['Vector', 'Vct', 'Matrix', 'Mtx', 'Base Converter', 'Normalize', 'Transpose', 'Pause / Resume', 'Start / Stop', 'Test ring']) {
      expect(trIn(lang, text), text).not.toBe(text);
    }
    const error = '“2” is not a digit of base 2. The digits are 0 1.';
    expect(trIn(lang, error)).not.toBe(error);
  });
});
