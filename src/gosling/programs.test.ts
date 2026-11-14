// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { Engine } from '../core/engine';
import { flatten } from '../core/graph';
import { useStore } from '../state/store';
import { respond } from './brain';
import { citiesIn, durationOf, timeOfDayOf } from './planner';
import { createProgram, disconnectNodes, layoutLayers, resolveType, verifyProgram } from './programs';
import { takeSnapshot } from './workspace';

beforeEach(() => {
  useStore.getState().newBlank();
});

/** Run the workspace's program headlessly and return the engine. */
function runGraph(ms = 3000) {
  const { graph, compounds } = useStore.getState().project;
  const e = new Engine(50);
  e.load(flatten(graph, compounds));
  e.run(Math.round(ms / 50));
  return e;
}
const nodesOf = (type: string) => Object.values(useStore.getState().project.graph.nodes).filter((n) => n.type === type);
const inputOf = (id: string, port = 'in') => runGraph().nodes.get(id)?.inputs[port]?.v;

describe('planner: plain-language requests become working programs', () => {
  const cases: { say: string; types: string[]; edges?: number; lone?: boolean; check?: (e: Engine) => void }[] = [
    {
      say: 'make a 90 second countdown with a light when it is done',
      types: ['timer', 'projector', 'light'],
      check: () => {
        expect(nodesOf('timer')[0].params.duration).toBe(90);
        expect(String(inputOf(nodesOf('projector')[0].id))).toMatch(/1:2\d|01:2\d/); // ~87 s left after 3 s
      },
    },
    { say: 'build a 5 minute timer program', types: ['timer', 'projector'], check: () => expect(nodesOf('timer')[0].params.duration).toBe(300) },
    { say: 'make a stopwatch', types: ['stopwatch', 'projector'], check: () => expect(String(inputOf(nodesOf('projector')[0].id))).toMatch(/0:0[23]/) },
    { say: 'create a world clock for Tokyo and London', types: ['clock', 'clock', 'projector', 'projector'], check: () => {
      expect(nodesOf('clock').map((n) => n.params.city)).toEqual(['Tokyo, Japan', 'London, United Kingdom']);
    } },
    { say: 'make an alarm at 6:45 pm every day', types: ['alarm', 'projector', 'light', 'audio'], check: () => {
      expect(nodesOf('alarm')[0].params.time).toBe('18:45');
      expect(nodesOf('alarm')[0].params.repeat).toBe('daily');
    } },
    { say: 'graph y = x^2 - 3', types: ['equation', 'meter'], check: () => expect(nodesOf('equation')[0].params.expr).toBe('x^2 - 3') },
    { say: 'plot sin(x)', types: ['equation', 'meter'], check: () => expect(nodesOf('equation')[0].params.expr).toBe('sin(x)') },
    { say: 'make a 2 Hz square wave', types: ['wave', 'meter'], check: () => {
      expect(nodesOf('wave')[0].params.shape).toBe('square');
      expect(nodesOf('wave')[0].params.freq).toBe(2);
    } },
    { say: 'build a traffic light', types: ['sequence', 'constant', 'constant', 'constant', 'compare', 'compare', 'compare', 'vital', 'vital', 'vital', 'projector'], edges: 10, check: () => {
      const e = runGraph(300);
      const lit = nodesOf('vital').filter((n) => e.nodes.get(n.id)?.inputs.in?.v === true);
      expect(lit).toHaveLength(1); // exactly one lamp is lit at a time
    } },
    { say: 'roll a die', types: ['random', 'projector'], check: () => {
      expect(nodesOf('random')[0].params).toMatchObject({ min: 1, max: 6, integer: true });
      const v = Number(inputOf(nodesOf('projector')[0].id));
      expect(v).toBeGreaterThanOrEqual(1);
      expect(v).toBeLessThanOrEqual(6);
    } },
    { say: 'make a random number between 10 and 20 every 2 seconds', types: ['random', 'projector'], check: () => expect(nodesOf('random')[0].params).toMatchObject({ min: 10, max: 20, rate: 0.5 }) },
    { say: 'make a program that counts every 2 seconds up to 5', types: ['pulse', 'counter', 'projector'], check: () => {
      expect(nodesOf('counter')[0].params.max).toBe(5);
      expect(Number(inputOf(nodesOf('projector')[0].id))).toBeGreaterThanOrEqual(1);
    } },
    { say: 'make a red blinking light every half second', types: ['pulse', 'light'], check: () => expect(nodesOf('light')[0].params.color).toBe('red') },
    { say: 'make a program that adds 3 and 4', types: ['constant', 'constant', 'add', 'projector'], check: () => expect(Number(inputOf(nodesOf('projector')[0].id))).toBe(7) },
    { say: 'build a program that multiplies 6 by 7', types: ['constant', 'constant', 'mul', 'projector'], check: () => expect(Number(inputOf(nodesOf('projector')[0].id))).toBe(42) },
    { say: 'make a calculator', types: ['constant', 'constant', 'add', 'sub', 'mul', 'div', 'projector', 'projector', 'projector', 'projector'] },
    { say: 'make a program to convert 100 celsius to fahrenheit', types: ['constant', 'mul', 'add', 'projector'], check: () => expect(Number(inputOf(nodesOf('projector')[0].id))).toBe(212) },
    { say: 'convert 212 fahrenheit to celsius', types: ['constant', 'sub', 'mul', 'div', 'projector'], check: () => expect(Number(inputOf(nodesOf('projector')[0].id))).toBeCloseTo(100, 6) },
    { say: 'create a program that cycles through red, green and blue every 2 seconds', types: ['sequence', 'projector'], check: () => expect(nodesOf('sequence')[0].params.values).toBe('red, green, blue') },
    { say: 'make a program that shows "Hello Nicque"', types: ['constant', 'projector'], check: () => expect(String(inputOf(nodesOf('projector')[0].id))).toBe('Hello Nicque') },
    { say: 'build a startle reflex', types: ['hearing', 'sense', 'fear', 'emotion', 'projector', 'vital', 'projector'] },
    { say: 'make a light that turns on when it gets loud', types: ['hearing', 'threshold', 'vital', 'meter'] },
    { say: 'play a 880 Hz tone', types: ['audio'], lone: true, check: () => expect(nodesOf('audio')[0].params.freq).toBe(880) },
  ];

  for (const c of cases) {
    it(`“${c.say}”`, () => {
      const r = respond(c.say);
      const snap = takeSnapshot();
      expect(r.actions?.length, r.text).toBe(1);
      expect(snap.nodes.map((n) => n.type).sort()).toEqual([...c.types].sort());
      if (c.edges !== undefined) expect(snap.edgeCount).toBe(c.edges);
      // nothing wrong with the wiring or the dry run
      const rep = verifyProgram();
      expect(rep.problems, rep.problems.join(' | ')).toEqual([]);
      // the program is started, and every module is connected
      expect(useStore.getState().run).toBe('running');
      if (!c.lone) expect(snap.unconnected).toEqual([]);
      c.check?.(runGraph());
    });
  }

  it('leaves plain module requests alone', () => {
    respond('add a timer');
    expect(takeSnapshot().nodeCount).toBe(1);
    expect(takeSnapshot().edgeCount).toBe(0);
    respond('add a timer set to 90 seconds and a projector, connected');
    expect(takeSnapshot().nodeCount).toBe(3);
  });

  it('adds next to existing work, and replaces on request', () => {
    respond('make a stopwatch');
    respond('make a 10 second countdown');
    expect(takeSnapshot().nodes.filter((n) => n.type === 'stopwatch')).toHaveLength(1);
    expect(takeSnapshot().nodes.filter((n) => n.type === 'timer')).toHaveLength(1);
    respond('make a new program with a 20 second countdown from scratch');
    expect(takeSnapshot().nodes.filter((n) => n.type === 'stopwatch')).toHaveLength(0);
    expect(takeSnapshot().nodes.filter((n) => n.type === 'timer')).toHaveLength(1);
  });

  it('is undoable in one step', () => {
    respond('build a traffic light');
    expect(takeSnapshot().nodeCount).toBe(11);
    useStore.getState().undo();
    expect(takeSnapshot().nodeCount).toBe(0);
  });
});

describe('planner helpers', () => {
  it('reads durations, times and cities', () => {
    expect(durationOf('1 hour 30 minutes')).toBe(5400);
    expect(durationOf('2m30s')).toBe(150);
    expect(durationOf('500 ms')).toBe(0.5);
    expect(timeOfDayOf('at 7 am')).toBe('07:00');
    expect(timeOfDayOf('at 12 am')).toBe('00:00');
    expect(timeOfDayOf('at 19:05')).toBe('19:05');
    expect(citiesIn('show me the time in New York, Paris and Sydney')).toEqual(['New York City, United States', 'Paris, France', 'Sydney, Australia']);
    expect(citiesIn('make a clock that shows the time')).toEqual([]);
  });
});

describe('program builder', () => {
  it('resolves loose module names', () => {
    expect(resolveType('timer')?.type).toBe('timer');
    expect(resolveType('Projector')?.type).toBe('projector');
    expect(resolveType('screen')?.type).toBe('projector');
    expect(resolveType('nope-nope-nope')).toBeUndefined();
  });

  it('lays modules out top to bottom by data flow, without overlaps', () => {
    const pos = layoutLayers(
      [{ ref: 'a', w: 144, h: 84 }, { ref: 'b', w: 144, h: 84 }, { ref: 'c', w: 144, h: 84 }, { ref: 'd', w: 144, h: 84 }],
      [{ from: 'a', to: 'c' }, { from: 'b', to: 'c' }, { from: 'c', to: 'd' }],
    );
    expect(pos.a.y).toBe(pos.b.y);
    expect(pos.c.y).toBeGreaterThan(pos.a.y);
    expect(pos.d.y).toBeGreaterThan(pos.c.y);
    expect(pos.a.x).not.toBe(pos.b.x);
  });

  it('refuses unknown modules without touching the workspace', () => {
    const r = createProgram({ nodes: [{ ref: 'a', type: 'timer' }, { ref: 'b', type: 'flux-capacitor' }] });
    expect(r.ok).toBe(false);
    expect(takeSnapshot().nodeCount).toBe(0);
  });

  it('reports bad settings, impossible wires and idle inputs instead of pretending it worked', () => {
    const r = createProgram({
      nodes: [{ ref: 't', type: 'timer', settings: { duration: 'forever', sparkle: 1 } }, { ref: 'p', type: 'projector' }, { ref: 'x', type: 'add' }],
      wires: [{ from: 't', to: 'p', fromPin: 'nonsense' }],
    });
    expect(r.ok).toBe(true);
    expect(r.report?.ok).toBe(false);
    const text = r.report!.problems.join(' ');
    expect(text).toMatch(/sparkle/);
    expect(text).toMatch(/couldn't wire/);
    expect(text).toMatch(/isn't wired/);
  });

  it('flags a required input nobody feeds', () => {
    createProgram({ nodes: [{ ref: 'a', type: 'add' }, { ref: 'k', type: 'constant' }, { ref: 'p', type: 'projector' }], wires: [{ from: 'k', to: 'a', toPin: 'b' }, { from: 'a', to: 'p' }] });
    const rep = verifyProgram();
    expect(rep.problems.join(' ')).toMatch(/required input “A”/);
  });

  it('removes wires between two modules', () => {
    const r = createProgram({ nodes: [{ ref: 't', type: 'timer' }, { ref: 'p', type: 'projector' }], wires: [{ from: 't', to: 'p' }] });
    expect(takeSnapshot().edgeCount).toBe(1);
    expect(disconnectNodes(r.refs!.t, r.refs!.p).ok).toBe(true);
    expect(takeSnapshot().edgeCount).toBe(0);
    expect(disconnectNodes(r.refs!.t, r.refs!.p).ok).toBe(false);
  });

  it('answers “does it work?” with a real check', () => {
    createProgram({ nodes: [{ ref: 'a', type: 'add' }, { ref: 'p', type: 'projector' }], wires: [{ from: 'a', to: 'p' }] });
    const r = respond('check my program');
    expect(r.text).toMatch(/problem/i);
    expect(r.text).toMatch(/isn't wired|required input/);
  });
});

describe('language model tools', () => {
  it('builds a program through create_program, sees the report, and fixes it with verify_program', async () => {
    const { askModel, DEFAULT_LLM } = await import('./llm');
    const replies: any[] = [
      { choices: [{ message: { role: 'assistant', content: null, tool_calls: [{ id: 'c1', function: { name: 'create_program', arguments: JSON.stringify({
        name: 'Sum', nodes: [{ ref: 'a', type: 'constant', settings: { kind: 'number', value: '2' } }, { ref: 'b', type: 'constant', settings: { kind: 'number', value: '5' } }, { ref: 's', type: 'add' }, { ref: 'p', type: 'projector' }],
        wires: [{ from: 'a', to: 's', to_pin: 'a' }, { from: 's', to: 'p' }],
      }) } }] } }] },
      { choices: [{ message: { role: 'assistant', content: null, tool_calls: [{ id: 'c2', function: { name: 'connect', arguments: JSON.stringify({ from_id: 'constant-2', to_id: 'add-1', to_pin: 'b' }) } }, { id: 'c3', function: { name: 'verify_program', arguments: '{}' } }] } }] },
      { choices: [{ message: { role: 'assistant', content: 'Done: 2 plus 5 is shown on the projector.' } }] },
    ];
    const seen: any[] = [];
    const real = globalThis.fetch;
    globalThis.fetch = (async (_u: any, init: any) => { seen.push(JSON.parse(init.body)); return { ok: true, json: async () => replies.shift() } as Response; }) as typeof fetch;
    try {
      const r = await askModel({ ...DEFAULT_LLM, enabled: true, apiKey: 'k' }, [{ role: 'user', content: 'add 2 and 5' }]);
      expect(r.text).toMatch(/2 plus 5/);
      // the first tool result told the model what was wrong (the second constant was left unwired, so the sum was 2)
      const toolMsgs = seen[1].messages.filter((m: any) => m.role === 'tool').map((m: any) => JSON.parse(m.content));
      expect(toolMsgs[0].report.notes.join(' ')).toMatch(/constant-2.*isn't wired/);
      expect(toolMsgs[0].report.observed.join(' ')).toMatch(/projector-1. receives 2 after/);
      // after the fix the final check is clean and the program really computes 7
      const verify = JSON.parse(seen[2].messages.filter((m: any) => m.role === 'tool').pop().content);
      expect(verify.problems).toEqual([]);
      expect(Number(inputOf('projector-1'))).toBe(7);
      expect(seen[0].tools.map((t: any) => t.function.name)).toEqual(expect.arrayContaining(['create_program', 'verify_program', 'disconnect', 'move_modules']));
    } finally { globalThis.fetch = real; }
  });
});
