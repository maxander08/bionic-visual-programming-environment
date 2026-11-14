// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { useStore } from '../state/store';
import { engine } from '../runtime/session';
import { addModules, buildBlock, connectNodes, control, setNodeDisabled } from './actions';
import { respond } from './brain';
import { askModel, DEFAULT_LLM, runTool } from './llm';
import { durationOf, timeOfDayOf } from './planner';
import { layoutLayers } from './programs';
import { cleanForSpeech, loadVoices, speechLang, spokenSummary, voicesFor } from './voice';
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

  it('tolerates non-string pin hints in LLM tool calls without crashing', () => {
    const log: string[] = [];
    const out = JSON.parse(runTool('create_program', {
      nodes: [{ ref: 't', type: 'timer' }, { ref: 'p', type: 'projector' }],
      wires: [{ from: 't', to: 'p', from_pin: 123, to_pin: {} }],
      run: false,
    }, log));
    expect(out.ok).toBe(true);
    expect(layoutLayers([], [])).toEqual({});
  });
});

describe('Gosling: planner, replace-reset, and voice regressions', () => {
  it('parses word and fractional durations without confusing ordinal “a second”', () => {
    expect(durationOf('every half second')).toBe(0.5);
    expect(durationOf('for half a minute')).toBe(30);
    expect(durationOf('for an hour')).toBe(3600);
    expect(durationOf('2 and a half minutes')).toBe(150);
    expect(durationOf('five minutes')).toBe(300);
    expect(durationOf('Add a second curve')).toBeNull();
    expect(timeOfDayOf('at 13 pm')).toBeNull();
  });

  it('builds audio beeps on countdowns, preserves alarm city after time, and handles 0 Hz safely', () => {
    respond('make a 10 second countdown that beeps when it is done');
    const types = Object.values(useStore.getState().project.graph.nodes).map((n) => n.type).sort();
    expect(types).toEqual(['audio', 'projector', 'timer']);

    useStore.getState().newBlank();
    respond('make an alarm at 7 am in Tokyo');
    const alarm = Object.values(useStore.getState().project.graph.nodes).find((n) => n.type === 'alarm')!;
    expect(alarm.params).toMatchObject({ time: '07:00', city: 'Tokyo, Japan' });

    useStore.getState().newBlank();
    const blink0 = respond('make a blinking light at 0 hz');
    const pulse = Object.values(useStore.getState().project.graph.nodes).find((n) => n.type === 'pulse')!;
    expect(Number.isFinite(pulse.params.period as number)).toBe(true);
    expect(blink0.text).not.toContain('Infinity');

    useStore.getState().newBlank();
    respond('make a red blinking light every half second');
    expect(Object.values(useStore.getState().project.graph.nodes).find((n) => n.type === 'pulse')!.params.period).toBe(500);
  });

  it('handles celsius-only conversion, subtract-from order, sequence-through, sound %, and multi-module adds', () => {
    respond('make a program to convert 100 celsius');
    expect(Object.values(useStore.getState().project.graph.nodes).map((n) => n.type).sort()).toEqual(['add', 'constant', 'mul', 'projector']);

    useStore.getState().newBlank();
    respond('make a program that subtracts 3 from 10');
    const consts = Object.values(useStore.getState().project.graph.nodes).filter((n) => n.type === 'constant');
    expect(consts.map((c) => c.params.value)).toEqual(['10', '3']);

    useStore.getState().newBlank();
    respond('make a program of colors that cycles through red, green, and blue every 2 seconds');
    expect(Object.values(useStore.getState().project.graph.nodes).find((n) => n.type === 'sequence')!.params.values).toBe('red, green, blue');

    useStore.getState().newBlank();
    respond('make a light that turns on when sound is above 60%');
    expect(Object.values(useStore.getState().project.graph.nodes).find((n) => n.type === 'threshold')!.params.threshold).toBeCloseTo(0.6, 6);

    useStore.getState().newBlank();
    respond('add 2 constants and add 3 projectors');
    const nodes = Object.values(useStore.getState().project.graph.nodes);
    expect(nodes.filter((n) => n.type === 'constant')).toHaveLength(2);
    expect(nodes.filter((n) => n.type === 'projector')).toHaveLength(3);
    expect(nodes.filter((n) => n.type === 'constant')[0].params.value).not.toBe('3');
  });

  it('resets stale engine state when replacing a running program', () => {
    respond('make a 10 second countdown');
    engine.run(300); // 15s -> timer-1 finishes
    expect(engine.nodes.get('timer-1')?.outputs.done?.v).toBe(true);
    respond('make a new program with a 20 second countdown from scratch');
    expect(engine.nodes.get('timer-1')?.outputs.done?.v).not.toBe(true);
    expect(engine.nodes.get('timer-1')?.params.duration).toBe(20);
  });

  it('every planner follow-up suggestion chip executes cleanly offline', () => {
    const prompts = [
      'graph y = x^2',
      'build a traffic light',
      'make an alarm at 7:30',
      'make a stopwatch',
      'make a 90 second countdown',
      'create a world clock for Tokyo',
      'convert 25 celsius to fahrenheit',
      'make a calculator',
      'roll a die',
      'make a counter',
      'make a blinker',
      'make a sine wave',
      'play a 440 Hz tone',
      'make a loud light',
      'build a startle reflex',
      'create a program that cycles through red, green and blue',
      'make a program that shows "Hello"',
    ];
    for (const p of prompts) {
      useStore.getState().newBlank();
      const first = respond(p);
      expect(first.chips?.length, p).toBeGreaterThan(0);
      for (const chip of first.chips!) {
        const next = respond(chip);
        expect(next.text, `${p} -> ${chip}`).not.toMatch(/couldn't match|not sure (which module|what to build)/i);
      }
    }
  });

  it('cleans speech text, splits CJK summaries, maps speech languages, and recovers loadVoices', async () => {
    expect(cleanForSpeech('Check `timer-1` → **25°C** at 440 Hz.')).toBe('Check timer 1 to 25 degrees Celsius at 440 hertz.');
    expect(speechLang('zh-Hans')).toBe('zh-CN');
    expect(speechLang('zh-Hant')).toBe('zh-TW');
    const longZh = '这是一个测试句子。'.repeat(60);
    const sum = spokenSummary(longZh, { max: 80 });
    expect(sum.length).toBeLessThan(140);
    expect(sum).toContain('。');

    const fakeVoices = [
      { name: 'Alice', lang: 'en-US', localService: true, voiceURI: 'v-en', default: false },
      { name: 'Xiaoxiao Neural', lang: 'zh-CN', localService: false, voiceURI: 'v-zh', default: false },
    ] as SpeechSynthesisVoice[];
    expect(voicesFor(fakeVoices, 'zh-CN').map((v) => v.voiceURI)).toEqual(['v-zh']);

    let available: SpeechSynthesisVoice[] = [];
    const origSynth = (window as any).speechSynthesis;
    const origUtt = (window as any).SpeechSynthesisUtterance;
    (window as any).SpeechSynthesisUtterance = class {};
    (window as any).speechSynthesis = {
      getVoices: () => available,
      addEventListener: (_e: string, cb: () => void) => setTimeout(cb, 5),
      removeEventListener: () => {},
    };
    try {
      expect(await loadVoices()).toEqual([]);
      available = fakeVoices;
      expect(await loadVoices()).toHaveLength(2);
    } finally {
      (window as any).speechSynthesis = origSynth;
      (window as any).SpeechSynthesisUtterance = origUtt;
    }
  });
});
