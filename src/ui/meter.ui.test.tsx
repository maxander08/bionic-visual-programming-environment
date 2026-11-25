// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { addNode, connect, disconnect, emptyGraph, flatten, setParams } from '../core/graph';
import { defaultParams, getDef } from '../core/registry';
import type { Graph } from '../core/types';
import { trIn } from '../i18n';
import { engine } from '../runtime/session';
import { NodeView } from './NodeView';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

function wire(graph: Graph, from: string, fromPort: string, to: string, toPort: string) {
  const result = connect(graph, from, fromPort, to, toPort);
  expect(result.error).toBeUndefined();
  return result;
}

function start(graph: Graph) {
  engine.load(flatten(graph));
  engine.reset();
  engine.step();
}

function update(graph: Graph) {
  engine.load(flatten(graph));
  engine.step();
}

function meterView() {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  return {
    host,
    render: (graph: Graph) => act(async () => {
      // A fresh node prop also exercises the view after engine-driven setting changes.
      const node = { ...graph.nodes.m };
      root.render(<NodeView node={node} def={getDef('meter', undefined, node.params)!} selected={false} conn="" prefix="" ro={false} />);
    }),
    unmount: () => act(async () => { root.unmount(); host.remove(); }),
  };
}

describe('Meter number display', () => {
  it('exposes a default-on boolean setting with a setting pin', () => {
    const def = getDef('meter')!;
    expect(defaultParams(def).showNumber).toBe(true);
    expect(def.inputs.find((p) => p.id === 'p:showNumber')).toMatchObject({ param: 'showNumber', type: 'bool', optional: true });
  });

  it('shows zero and exact numeric text in the title, and the setting hides and restores it', async () => {
    let graph = addNode(emptyGraph(), 'constant', 0, 0, { value: '0' }, undefined, 'c').graph;
    graph = addNode(graph, 'meter', 200, 0, {}, undefined, 'm').graph;
    graph = wire(graph, 'c', 'out', 'm', 'in').graph;
    start(graph);
    const r = meterView();
    await r.render(graph);
    try {
      const number = () => r.host.querySelector<HTMLElement>('.node-title .meter-num');
      expect(number()?.textContent).toBe('0');
      expect(r.host.querySelector('.node-body .meter-num')).toBeNull();
      expect(r.host.querySelector('.meter-wrap svg')).not.toBeNull();

      const exact = '12345678901234567890.123456789';
      graph = setParams(graph, 'c', { value: exact });
      update(graph);
      await r.render(graph);
      expect(number()?.textContent).toBe(exact);
      expect(number()?.getAttribute('title')).toBe(exact);

      graph = setParams(graph, 'm', { showNumber: false });
      update(graph);
      await r.render(graph);
      expect(number()).toBeNull();
      expect(r.host.querySelector('.meter-wrap svg')).not.toBeNull();

      graph = setParams(graph, 'm', { showNumber: true });
      update(graph);
      await r.render(graph);
      expect(number()?.textContent).toBe(exact);
    } finally {
      await r.unmount();
    }
  });

  it('lets a setting pin override the inspector and restores the stored choice on disconnect', async () => {
    let graph = addNode(emptyGraph(), 'constant', 0, 0, { value: '7' }, undefined, 'c').graph;
    graph = addNode(graph, 'constant', 0, 100, { kind: 'bool', value: 'true' }, undefined, 'toggle').graph;
    graph = addNode(graph, 'meter', 200, 0, { showNumber: false }, undefined, 'm').graph;
    graph = wire(graph, 'c', 'out', 'm', 'in').graph;
    const link = wire(graph, 'toggle', 'out', 'm', 'p:showNumber');
    graph = link.graph;
    start(graph);
    const r = meterView();
    await r.render(graph);
    try {
      expect(graph.nodes.m.params.showNumber).toBe(false);
      expect(engine.nodes.get('m')!.live.showNumber).toBe(true);
      expect(r.host.querySelector('.node-title .meter-num')?.textContent).toBe('7');

      graph = setParams(graph, 'toggle', { value: 'false' });
      update(graph);
      await r.render(graph);
      expect(engine.nodes.get('m')!.live.showNumber).toBe(false);
      expect(r.host.querySelector('.node-title .meter-num')).toBeNull();

      graph = disconnect(graph, link.edge!.id);
      update(graph);
      await r.render(graph);
      expect(engine.nodes.get('m')!.driven).toBe(false);
      expect(r.host.querySelector('.node-title .meter-num')).toBeNull();

      graph = setParams(graph, 'm', { showNumber: true });
      update(graph);
      await r.render(graph);
      expect(r.host.querySelector('.node-title .meter-num')?.textContent).toBe('7');
    } finally {
      await r.unmount();
    }
  });

  it('keeps equation plots free of a numeric title readout', async () => {
    let graph = addNode(emptyGraph(), 'equation', 0, 0, { expr: 'sin(x)' }, undefined, 'q').graph;
    graph = addNode(graph, 'meter', 200, 0, {}, undefined, 'm').graph;
    graph = wire(graph, 'q', 'eq', 'm', 'in').graph;
    start(graph);
    const r = meterView();
    await r.render(graph);
    try {
      expect(engine.nodes.get('m')!.viewData.plot).toBeDefined();
      expect(r.host.querySelector('.eqplot')).not.toBeNull();
      expect(r.host.querySelector('.meter-num')).toBeNull();
      expect(r.host.querySelector('button[aria-label="Open graph full size"]')).not.toBeNull();
    } finally {
      await r.unmount();
    }
  });

  it('defaults legacy projects without the setting to showing the number', async () => {
    let graph = addNode(emptyGraph(), 'constant', 0, 0, { value: '42' }, undefined, 'c').graph;
    graph = addNode(graph, 'meter', 200, 0, {}, undefined, 'm').graph;
    const params = { ...graph.nodes.m.params };
    delete params.showNumber;
    graph = { ...graph, nodes: { ...graph.nodes, m: { ...graph.nodes.m, params } } };
    graph = wire(graph, 'c', 'out', 'm', 'in').graph;
    start(graph);
    const r = meterView();
    await r.render(graph);
    try {
      expect(engine.nodes.get('m')!.params.showNumber).toBe(true);
      expect(r.host.querySelector('.node-title .meter-num')?.textContent).toBe('42');
    } finally {
      await r.unmount();
    }
  });

  describe('auto-scaled plot of an unchanging value', () => {
    const MAX = '1.7976931348623157e308';
    // [name, first text, second text]: different text for the same number, so the Meter records two equal samples.
    const TAIL = '.00000000000000000001';
    const flat: Array<[string, string, string]> = [
      ['small', '7', '7' + TAIL],
      ['1e15', '1000000000000000', '1000000000000000' + TAIL],
      ['2^53', '9007199254740992', '9007199254740992' + TAIL],
      ['1e16', '10000000000000000', '10000000000000000' + TAIL],
      ['1e20', '100000000000000000000', '100000000000000000000' + TAIL],
      ['negative 2^53', '-9007199254740992', '-9007199254740992' + TAIL],
      ['negative 1e20', '-100000000000000000000', '-100000000000000000000' + TAIL],
      ['negative 1e300', '-1' + '0'.repeat(300), '-1' + '0'.repeat(300) + TAIL],
      ['1e300', '1' + '0'.repeat(300), '1' + '0'.repeat(300) + TAIL],
      ['max double', MAX, '1.79769313486231570000000001e308'],
      ['negative max double', '-' + MAX, '-1.79769313486231570000000001e308'],
    ];

    async function pointsFor(first: string, second: string, auto = true) {
      let graph = addNode(emptyGraph(), 'constant', 0, 0, { value: first }, undefined, 'c').graph;
      graph = addNode(graph, 'meter', 200, 0, { auto }, undefined, 'm').graph;
      graph = wire(graph, 'c', 'out', 'm', 'in').graph;
      start(graph);
      graph = setParams(graph, 'c', { value: second });
      update(graph);
      const hist = engine.nodes.get('m')!.viewData.hist as number[];
      const r = meterView();
      await r.render(graph);
      try {
        const poly = r.host.querySelector('.meter-wrap polyline');
        return { hist, points: poly?.getAttribute('points') ?? null, hasPlot: poly !== null };
      } finally {
        await r.unmount();
      }
    }

    it.each(flat)('draws a finite, centred flat line for %s', async (_name, first, second) => {
      const { hist, points } = await pointsFor(first, second);
      expect(hist).toHaveLength(2);
      expect(hist[0]).toBe(hist[1]);
      expect(points).not.toBeNull();
      expect(points).not.toMatch(/NaN|Infinity/);
      const ys = points!.split(' ').map((p) => Number(p.split(',')[1]));
      expect(ys).toHaveLength(2);
      // Same position the plot has always used for a flat signal: half way up the plot area.
      expect(ys).toEqual([20, 20]);
    });

    it('fixes the reported exact value and survives toggling auto scale', async () => {
      const first = '12345678901234567890.123456789';
      const second = '12345678901234567890.123456788';
      let graph = addNode(emptyGraph(), 'constant', 0, 0, { value: first }, undefined, 'c').graph;
      graph = addNode(graph, 'meter', 200, 0, { auto: true }, undefined, 'm').graph;
      graph = wire(graph, 'c', 'out', 'm', 'in').graph;
      start(graph);
      graph = setParams(graph, 'c', { value: second });
      update(graph);
      expect(engine.nodes.get('m')!.viewData.hist).toEqual([Number(first), Number(first)]);
      const r = meterView();
      const coords = () => r.host.querySelector('.meter-wrap polyline')!.getAttribute('points')!
        .split(' ').map((p) => p.split(',').map(Number));
      try {
        await r.render(graph);
        expect(coords()).toEqual([[0, 20], [100, 20]]);
        expect(r.host.querySelector('.node-title .meter-num')?.textContent).toBe(second);
        graph = setParams(graph, 'm', { auto: false });
        await r.render(graph);
        expect(coords()).toEqual([[0, 4], [100, 4]]);
        graph = setParams(graph, 'm', { auto: true });
        await r.render(graph);
        expect(coords()).toEqual([[0, 20], [100, 20]]);
        expect(coords().flat().every(Number.isFinite)).toBe(true);
      } finally {
        await r.unmount();
      }
    });

    it.each([
      ['mixed signs', ['-3', '3', '0'], [36, 4, 20]],
      ['small values', ['1e-8', '3e-8', '2e-8'], [36, 4, 20]],
      ['large negative values', ['-1e300', '-2e300', '-1.5e300'], [4, 36, 20]],
    ])('keeps changed %s proportional with finite coordinates', async (_name, values, expected) => {
      let graph = addNode(emptyGraph(), 'constant', 0, 0, { value: values[0] }, undefined, 'c').graph;
      graph = addNode(graph, 'meter', 200, 0, { auto: true }, undefined, 'm').graph;
      graph = wire(graph, 'c', 'out', 'm', 'in').graph;
      start(graph);
      for (const value of values.slice(1)) {
        graph = setParams(graph, 'c', { value });
        update(graph);
      }
      expect(engine.nodes.get('m')!.viewData.hist).toEqual(values.map(Number));
      const r = meterView();
      try {
        await r.render(graph);
        const points = r.host.querySelector('.meter-wrap polyline')!.getAttribute('points')!;
        const coords = points.split(' ').map((p) => p.split(',').map(Number));
        expect(coords).toHaveLength(expected.length);
        coords.forEach(([x, y], i) => {
          expect(Number.isFinite(x) && Number.isFinite(y)).toBe(true);
          expect(x).toBeCloseTo(i / (expected.length - 1) * 100, 10);
          expect(y).toBeCloseTo(expected[i], 10);
        });
      } finally {
        await r.unmount();
      }
    });

    it('preserves clamping to 0–1 when auto scale is disabled', async () => {
      const values = ['-1', '0', '0.5', '1', '2'];
      let graph = addNode(emptyGraph(), 'constant', 0, 0, { value: values[0] }, undefined, 'c').graph;
      graph = addNode(graph, 'meter', 200, 0, { auto: false }, undefined, 'm').graph;
      graph = wire(graph, 'c', 'out', 'm', 'in').graph;
      start(graph);
      for (const value of values.slice(1)) {
        graph = setParams(graph, 'c', { value });
        update(graph);
      }
      expect(engine.nodes.get('m')!.viewData.hist).toEqual(values.map(Number));
      const r = meterView();
      try {
        await r.render(graph);
        const points = r.host.querySelector('.meter-wrap polyline')!.getAttribute('points')!;
        const coords = points.split(' ').map((p) => p.split(',').map(Number));
        expect(coords.flat().every(Number.isFinite)).toBe(true);
        expect(coords.map(([, y]) => y)).toEqual([36, 36, 20, 4, 4]);
      } finally {
        await r.unmount();
      }
    });

    it('scales opposite extreme signs without overflowing the range', async () => {
      const { hist, points } = await pointsFor('-1e308', '1e308');
      expect(hist).toEqual([-1e308, 1e308]);
      expect(points).not.toMatch(/NaN|Infinity/);
      expect(points!.split(' ').map((p) => Number(p.split(',')[1]))).toEqual([36, 4]);
    });

    it('still draws a flat line with Auto scale off', async () => {
      const { points } = await pointsFor('100000000000000000000', '100000000000000000000' + TAIL, false);
      expect(points).not.toMatch(/NaN|Infinity/);
    });

    it('still scales a large signal that does change', async () => {
      let graph = addNode(emptyGraph(), 'constant', 0, 0, { value: '1e20' }, undefined, 'c').graph;
      graph = addNode(graph, 'meter', 200, 0, {}, undefined, 'm').graph;
      graph = wire(graph, 'c', 'out', 'm', 'in').graph;
      start(graph);
      graph = setParams(graph, 'c', { value: '2e20' });
      update(graph);
      graph = setParams(graph, 'c', { value: '1.5e20' });
      update(graph);
      const r = meterView();
      await r.render(graph);
      try {
        const pts = r.host.querySelector('.meter-wrap polyline')!.getAttribute('points')!;
        expect(pts).not.toMatch(/NaN|Infinity/);
        expect(pts.split(' ').map((p) => Number(p.split(',')[1]))).toEqual([36, 4, 20]);
      } finally {
        await r.unmount();
      }
    });
  });

  it.each(['zh-Hans', 'zh-Hant'] as const)('translates the new setting in %s', (lang) => {
    expect(trIn(lang, 'Show number')).not.toBe('Show number');
    const doc = 'Show the latest value as a number at the top of the node, level with the name (numeric signals only).';
    expect(trIn(lang, doc)).not.toBe(doc);
  });
});
