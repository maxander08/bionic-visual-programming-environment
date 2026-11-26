import { describe, expect, it } from 'vitest';
import { Engine } from './engine';
import { addNode, connect, emptyGraph, flatten, sanitizeGraph, setParams } from './graph';
import { cmykToRgb, parseHex, rgbToCmyk, rgbToHex } from './colorspaces';
import { nearestPantone, pantoneToRgb } from './pantone';
import { getDef, resolveParams } from './registry';
import type { Graph, Params } from './types';

function runColor(params: Params) {
  let graph: Graph = emptyGraph();
  graph = addNode(graph, 'color', 0, 0, params, undefined, 'color').graph;
  const engine = new Engine(50);
  engine.load(flatten(graph));
  engine.runFor(100);
  return engine.nodes.get('color')!;
}

describe('color-space conversions', () => {
  it('converts CMYK percentages to screen RGB and clamps out-of-range inks', () => {
    expect(cmykToRgb(100, 60, 0, 0)).toEqual([0, 102, 255]);
    expect(cmykToRgb(0, 0, 0, 100)).toEqual([0, 0, 0]);
    expect(cmykToRgb(-10, 0, 0, 0)).toEqual([255, 255, 255]);
    expect(cmykToRgb(0, 0, 0, 120)).toEqual([0, 0, 0]);
  });

  it('converts RGB to CMYK and emits normalized hex', () => {
    expect(rgbToCmyk([0, 0, 0])).toEqual([0, 0, 0, 100]);
    expect(rgbToCmyk([0, 102, 255])).toEqual([100, 60, 0, 0]);
    expect(rgbToHex([10, 122, 255])).toBe('#0a7aff');
    expect(rgbToHex([-1, 256, 4])).toBe('#00ff04');
  });

  it('parses short, full and alpha hex forms while ignoring opacity', () => {
    expect(parseHex('#0af')).toEqual([0, 170, 255]);
    expect(parseHex('#0a7aff')).toEqual([10, 122, 255]);
    expect(parseHex('#0a7affcc')).toEqual([10, 122, 255]);
    expect(parseHex('0xabc')).toEqual([170, 187, 204]);
    expect(parseHex('not-a-color')).toBeNull();
  });
});

describe('Pantone color lookup', () => {
  it('accepts coated codes, PMS wording, TCX codes and names', () => {
    expect(pantoneToRgb('485 C')).toEqual({ rgb: [218, 41, 28], name: 'PANTONE 485 C' });
    expect(pantoneToRgb('PMS 485')?.rgb).toEqual([218, 41, 28]);
    expect(pantoneToRgb('19-4052 TCX')).toEqual({ rgb: [15, 76, 129], name: 'PANTONE 19-4052 TCX Classic Blue' });
    expect(pantoneToRgb('Classic Blue')).toEqual({ rgb: [15, 76, 129], name: 'PANTONE 19-4052 TCX Classic Blue' });
    expect(pantoneToRgb('unknown swatch')).toBeNull();
  });

  it('finds the nearest swatch by perceptual color distance', () => {
    expect(nearestPantone([15, 76, 129])).toBe('PANTONE 19-4052 TCX Classic Blue');
  });
});

describe('Color module', () => {
  it('keeps only the selected model’s settings as setting pins, plus the Color model pin', () => {
    const pins = (model: string) => getDef('color', undefined, { model })!.paramPins!.map((p) => p.param);
    expect(pins('hsv')).toEqual(['model', 'h', 's', 'v']);
    expect(pins('cmyk')).toEqual(['model', 'c', 'm', 'y', 'k']);
    expect(pins('pantone')).toEqual(['model', 'pantone']);
    expect(pins('hex')).toEqual(['model', 'hex']);
  });

  it('puts the model’s settings on the north edge and the Color model on the west edge', () => {
    const sides = (model: string) => {
      const d = getDef('color', undefined, { model })!;
      const on = (s: string) => d.inputs.filter((p) => p.side === s).map((p) => p.param);
      return { top: on('top'), left: on('left'), others: d.inputs.length - on('top').length - on('left').length };
    };
    expect(sides('hsv')).toEqual({ top: ['h', 's', 'v'], left: ['model'], others: 0 });
    expect(sides('cmyk')).toEqual({ top: ['c', 'm', 'y', 'k'], left: ['model'], others: 0 });
    expect(sides('pantone')).toEqual({ top: ['pantone'], left: ['model'], others: 0 });
    expect(sides('hex')).toEqual({ top: ['hex'], left: ['model'], others: 0 });
  });

  it('can be driven from the Color model pin and the model’s setting pins', () => {
    let graph: Graph = emptyGraph();
    graph = addNode(graph, 'color', 0, 0, { model: 'hsv' }, undefined, 'color').graph;
    graph = addNode(graph, 'constant', 0, 200, { kind: 'text', value: 'hex' }, undefined, 'm').graph;
    graph = addNode(graph, 'constant', 0, 300, { value: 0 }, undefined, 'h').graph;
    graph = connect(graph, 'm', 'out', 'color', 'p:model').graph;
    graph = connect(graph, 'h', 'out', 'color', 'p:h').graph;
    const engine = new Engine(50);
    engine.load(flatten(graph));
    engine.runFor(200);
    expect(engine.nodes.get('color')!.viewData).toMatchObject({ model: 'hex', hex: '#0066ff' });
    graph = setParams(graph, 'm', { kind: 'text', value: 'hsv' });
    const e2 = new Engine(50);
    e2.load(flatten(graph));
    e2.runFor(200);
    expect(e2.nodes.get('color')!.outputs.css?.v).toBe('#ff0000');
  });

  it('keeps wires saved to the old H, S and V pins', () => {
    const raw = {
      nodes: { c: { id: 'c', type: 'color', x: 0, y: 0, params: {} }, k: { id: 'k', type: 'constant', x: 0, y: 100, params: { value: 0.5 } } },
      edges: { e1: { id: 'e1', from: 'k', fromPort: 'out', to: 'c', toPort: 'h', weight: 1, delay: 0, enabled: true } },
    } as unknown as Graph;
    const { graph, problems } = sanitizeGraph(raw, {});
    expect(problems).toEqual([]);
    expect(graph.edges.e1.toPort).toBe('p:h');
  });

  it('retains each model’s settings when the selected model changes', () => {
    const def = getDef('color')!;
    const cmyk = resolveParams(def, {
      model: 'cmyk', c: 21, m: 32, y: 43, k: 54, pantone: '485 C', hex: '#0a7aff',
    });
    const hex = resolveParams(def, { ...cmyk, model: 'hex' });
    expect(hex).toMatchObject({ model: 'hex', c: 21, m: 32, y: 43, k: 54, pantone: '485 C', hex: '#0a7aff' });
  });

  it('emits the requested Pantone color and the corresponding screen swatch', () => {
    const node = runColor({ model: 'pantone', pantone: '485 C' });
    expect(node.status.level).toBe('ok');
    expect(node.outputs.css?.v).toBe('#da291c');
    expect(node.outputs.pantone?.v).toBe('PANTONE 485 C');
    expect(node.outputs.c?.v).toBeCloseTo(0);
    expect(node.viewData).toMatchObject({ model: 'pantone', rgb: [218, 41, 28], hex: '#da291c' });
  });

  it('supports hex and CMYK input, and reports invalid values', () => {
    const hex = runColor({ model: 'hex', hex: '#0a7aff' });
    expect(hex.outputs.css?.v).toBe('#0a7aff');
    const swatch = hex.outputs.image?.v as { w: number; h: number; data: Uint8ClampedArray };
    expect(swatch).toMatchObject({ w: 8, h: 8 });
    expect([...swatch.data.slice(0, 4)]).toEqual([10, 122, 255, 255]);
    expect(hex.outputs.pantone?.v).toBeTruthy();

    const cmyk = runColor({ model: 'cmyk', c: 100, m: 60, y: 0, k: 0 });
    expect(cmyk.outputs.css?.v).toBe('#0066ff');
    expect(cmyk.outputs.c?.v).toBe(100);

    const bad = runColor({ model: 'pantone', pantone: 'not a swatch' });
    expect(bad.status.level).toBe('error');
    expect(bad.status.message).toContain('not a Pantone color');
  });
});
