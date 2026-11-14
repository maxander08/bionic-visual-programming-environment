// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { useStore } from '../state/store';
import { addModules, buildBlock, connectNodes, control, setNodeDisabled } from './actions';
import { respond } from './brain';
import { askModel, DEFAULT_LLM } from './llm';
import { takeSnapshot } from './workspace';

beforeEach(() => {
  useStore.getState().newBlank();
});

describe('Gosling: actions and edge-case guards', () => {
  it('batches multi-module additions into a single undoable edit and handles NaN count', () => {
    const r = addModules('switch', 3);
    expect(r.ok).toBe(true);
    expect(r.ids).toHaveLength(3);
    expect(Object.keys(useStore.getState().project.graph.nodes)).toHaveLength(3);
    useStore.getState().undo();
    expect(Object.keys(useStore.getState().project.graph.nodes)).toHaveLength(0);

    const nan = addModules('timer', Number.NaN);
    expect(nan.ok).toBe(true);
    expect(nan.ids).toHaveLength(1);
  });

  it('rejects empty buildBlock and invalid control actions cleanly', () => {
    expect(buildBlock({ nodes: [] }).ok).toBe(false);
    expect(control('bogus' as any).ok).toBe(false);
  });

  it('handles setNodeDisabled on missing node ids without throwing', () => {
    expect(setNodeDisabled(['does-not-exist'], true)).toMatchObject({ ok: false });
    const added = addModules('timer', 1);
    const id = added.ids![0];
    expect(setNodeDisabled([id, 'missing'], true)).toMatchObject({ ok: true });
    expect(useStore.getState().project.graph.nodes[id].disabled).toBe(true);
  });

  it('matches setting pins passed as p:<key> or by bare key/label', () => {
    const c = addModules('constant', 1).ids![0];
    const r = addModules('random', 1).ids![0];
    const res = connectNodes(c, r, undefined, 'p:min');
    expect(res.ok).toBe(true);
    const edges = Object.values(useStore.getState().project.graph.edges);
    expect(edges).toHaveLength(1);
    expect(edges[0].toPort).toBe('p:min');
  });
});

describe('Gosling: built-in brain intents', () => {
  it('builds wired chains and respects counts when wiring multiple modules', () => {
    const r1 = respond('add a timer set to 90 seconds and a projector, connected');
    expect(r1.actions?.length).toBe(1);
    const snap1 = takeSnapshot();
    expect(snap1.nodeCount).toBe(2);
    expect(snap1.edgeCount).toBe(1);
    expect(snap1.nodes.find((n) => n.type === 'timer')?.inst.params.duration).toBe(90);

    useStore.getState().newBlank();
    const r2 = respond('add 2 timers and a projector, connected');
    expect(r2.actions?.length).toBe(1);
    expect(takeSnapshot().nodes.filter((n) => n.type === 'timer')).toHaveLength(2);
    expect(takeSnapshot().nodes.filter((n) => n.type === 'projector')).toHaveLength(1);
  });

  it('connects setting pins written with id.p:key syntax', () => {
    addModules('constant', 1);
    addModules('timer', 1);
    const r = respond('connect constant-1 to timer-1.p:duration');
    expect(r.actions?.length).toBe(1);
    const edge = Object.values(useStore.getState().project.graph.edges)[0];
    expect(edge.toPort).toBe('p:duration');
  });

  it('renames the program with or without quotes, even when the name contains a node id', () => {
    // Place a node literally named "meter" to match the built-in template id pattern
    useStore.setState((s) => ({
      ...s,
      project: {
        ...s.project,
        graph: { ...s.project.graph, nodes: { meter: { id: 'meter', type: 'meter', x: 0, y: 0, params: {} } } },
      },
    }));
    expect(respond('rename program to Sound Meter').actions).toHaveLength(1);
    expect(useStore.getState().project.name).toBe('Sound Meter');

    expect(respond('rename the program to "Quoted Name"').actions).toHaveLength(1);
    expect(useStore.getState().project.name).toBe('Quoted Name');
  });

  it('evaluates chained x multiplication, square roots, and percentages accurately', () => {
    expect(respond('what is 2 x 3 x 4').text).toContain('**24**');
    expect(respond('what is square root of 16').text).toContain('**4**');
    expect(respond('what is 15% of 240').text).toContain('**36**');
  });

  it('uses a fresh snapshot when confirming clear-workspace', () => {
    addModules('timer', 1);
    const ask = respond('delete everything');
    expect(ask.pending).toBeTruthy();
    // Add another module before confirming
    addModules('projector', 1);
    expect(takeSnapshot().nodeCount).toBe(2);
    const done = respond('yes, clear it', ask.pending);
    expect(done.actions?.length).toBe(1);
    expect(takeSnapshot().nodeCount).toBe(0);
  });
});

describe('Gosling: workspace & LLM resilience', () => {
  it('tolerates unknown node types in takeSnapshot without throwing', () => {
    useStore.setState((s) => ({
      ...s,
      project: {
        ...s.project,
        graph: {
          nodes: { ghost: { id: 'ghost', type: 'nonexistent-type', x: 0, y: 0, params: {} } },
          edges: {},
        },
      },
    }));
    const snap = takeSnapshot();
    expect(snap.nodeCount).toBe(0);
  });

  it('validates endpoint URL and model name before calling fetch', async () => {
    await expect(askModel({ ...DEFAULT_LLM, enabled: true, baseUrl: 'javascript:alert(1)', apiKey: 'k' }, [])).rejects.toThrow(/Invalid endpoint URL/i);
    await expect(askModel({ ...DEFAULT_LLM, enabled: true, model: '   ', apiKey: 'k' }, [])).rejects.toThrow(/Model name is empty/i);
  });
});
