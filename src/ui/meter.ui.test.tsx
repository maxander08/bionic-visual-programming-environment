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

  it.each(['zh-Hans', 'zh-Hant'] as const)('translates the new setting in %s', (lang) => {
    expect(trIn(lang, 'Show number')).not.toBe('Show number');
    const doc = 'Show the latest value as a number at the top of the node, level with the name (numeric signals only).';
    expect(trIn(lang, doc)).not.toBe(doc);
  });
});
