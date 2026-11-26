// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { addNode, connect, emptyGraph, flatten } from '../core/graph';
import { getDef } from '../core/registry';
import type { Graph } from '../core/types';
import { engine } from '../runtime/session';
import { useStore } from '../state/store';
import { NodeView } from './NodeView';
import { CalculusPanel } from './EnginePanel';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
(globalThis as any).ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };

function start(graph: Graph) {
  engine.load(flatten(graph));
  engine.reset();
  engine.step();
}

function mount(node: () => Graph['nodes'][string]) {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  return {
    host,
    render: () => act(async () => {
      const n = { ...node() };
      root.render(<NodeView node={n} def={getDef('engine-calculus', undefined, n.params)!} selected={false} conn="" prefix="" ro={false} />);
    }),
    renderPanel: () => act(async () => { root.render(<CalculusPanel node={node()} />); }),
    unmount: () => act(async () => { root.unmount(); host.remove(); }),
  };
}

describe('Calculus Engine face', () => {
  it('looks like a Meter: a title, the latest number beside it and a graph', async () => {
    let graph = addNode(emptyGraph(), 'engine-calculus', 0, 0, { f1: 'x^2', at: 3 }, undefined, 'c').graph;
    graph = addNode(graph, 'meter', 300, 0, {}, undefined, 'm').graph;
    graph = connect(graph, 'c', 'eq', 'm', 'in').graph;
    start(graph);
    const r = mount(() => graph.nodes.c);
    await r.render();
    try {
      expect(r.host.querySelector('.node-title .t')?.textContent).toBe('Calculus');
      expect(r.host.querySelector('.node-title .meter-num')?.textContent).toBe('ƒ′ 6');
      expect(r.host.querySelectorAll('.meter-wrap svg.eqplot path').length).toBeGreaterThanOrEqual(2);
      expect(r.host.querySelector('.meter-wrap .expand')).not.toBeNull();
      expect(r.host.querySelector('.node')?.classList.contains('f-engine')).toBe(true);
    } finally { await r.unmount(); }
  });

  it('has + and − buttons that add and remove expressions and parameters, each with its pins', async () => {
    useStore.getState().newBlank();
    await act(async () => { useStore.getState().addNodeAt('engine-calculus', 0, 0); });
    const nodeId = Object.keys(useStore.getState().project.graph.nodes).find((k) => useStore.getState().project.graph.nodes[k].type === 'engine-calculus')!;
    const node = () => useStore.getState().project.graph.nodes[nodeId];
    const pins = () => getDef('engine-calculus', undefined, node().params)!.paramPins!.map((p) => p.param);
    const r = mount(node);
    await r.render();
    try {
      const groups = () => [...r.host.querySelectorAll<HTMLElement>('.eng-step')];
      const press = async (group: number, which: 0 | 1) => { await act(async () => { groups()[group].querySelectorAll<HTMLButtonElement>('.eng-b')[which].click(); }); await r.render(); };
      expect(groups().map((g) => g.querySelector('.eng-n')?.textContent)).toEqual(['1', '0']);
      expect(groups()[0].querySelectorAll<HTMLButtonElement>('.eng-b')[0].disabled).toBe(true); // at least one expression
      expect(groups()[1].querySelectorAll<HTMLButtonElement>('.eng-b')[0].disabled).toBe(true); // no parameter to remove
      await press(0, 1);
      await press(0, 1);
      expect(node().params.fn).toBe(3);
      expect(pins()).toEqual(expect.arrayContaining(['f1', 'f2', 'f3']));
      await press(1, 1);
      await press(1, 1);
      expect(node().params.pn).toBe(2);
      expect(pins()).toEqual(expect.arrayContaining(['pn1', 'pv1', 'pn2', 'pv2']));
      expect(groups().map((g) => g.querySelector('.eng-n')?.textContent)).toEqual(['3', '2']);
      await press(0, 0);
      await press(1, 0);
      expect(node().params.fn).toBe(2);
      expect(node().params.pn).toBe(1);
      expect(pins()).not.toContain('f3');
      expect(pins()).not.toContain('pn2');
    } finally { await r.unmount(); }
  });

  it('lists the analysis in the inspector', async () => {
    const graph = addNode(emptyGraph(), 'engine-calculus', 0, 0, { mode: 'curve', f1: 'x^3 - 3x' }, undefined, 'c').graph;
    start(graph);
    const r = mount(() => graph.nodes.c);
    await r.renderPanel();
    try {
      const text = r.host.textContent ?? '';
      expect(text).toContain('x-intercepts');
      expect(text).toContain('Local maxima');
      expect(text).toContain('(-1, 2)');
    } finally { await r.unmount(); }
  });
});
