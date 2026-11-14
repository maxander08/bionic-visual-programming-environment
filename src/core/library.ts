// Example programs and built-in compound systems. Everything is generated through the real graph API.
import type { CompoundDef, Graph, Params, Project } from './types';
import { addNode, connect, emptyGraph } from './graph';
import { newProject } from './project';

class Builder {
  g: Graph = emptyGraph();
  constructor(public compounds: Record<string, CompoundDef> = {}) {}
  add(id: string, type: string, x: number, y: number, params: Params = {}) {
    const r = addNode(this.g, type, x, y, params, this.compounds, id);
    this.g = r.graph;
    return id;
  }
  wire(from: string, fp: string, to: string, tp: string) {
    const r = connect(this.g, from, fp, to, tp, this.compounds);
    if (r.error) throw new Error(`Library wiring ${from}.${fp} → ${to}.${tp}: ${r.error}`);
    this.g = r.graph;
  }
}

const portsOf = (_b: Builder, spec: { id: string; label: string; type: any; nodeId: string; port: string }[]) => spec;

export function builtinCompounds(): CompoundDef[] {
  const decision = (() => {
    const b = new Builder();
    b.add('pick', 'decision', 0, 0, { labels: 'A, B', hysteresis: 0.05, min: 0.05 });
    return {
      id: 'decision-circuit', name: 'Decision circuit', description: 'Chooses between two scored options with hysteresis so the choice does not flicker.', graph: b.g,
      inputs: portsOf(b, [{ id: 'a', label: 'Score A', type: 'num', nodeId: 'pick', port: 'a' }, { id: 'b', label: 'Score B', type: 'num', nodeId: 'pick', port: 'b' }]),
      outputs: portsOf(b, [{ id: 'label', label: 'Choice', type: 'text', nodeId: 'pick', port: 'label' }, { id: 'margin', label: 'Margin', type: 'num', nodeId: 'pick', port: 'margin' }]),
      exposed: [{ key: 'labels', label: 'Option names', nodeId: 'pick', param: 'labels' }, { key: 'hysteresis', label: 'Hysteresis', nodeId: 'pick', param: 'hysteresis' }],
    } as CompoundDef;
  })();
  const reward = (() => {
    const b = new Builder();
    b.add('r', 'reward', 0, 0, { gain: 1.5, costWeight: 0.6, learn: 0.25 });
    b.add('d', 'delay', 156, 0, { ms: 500 });
    b.wire('r', 'expected', 'd', 'in');
    b.wire('d', 'out', 'r', 'cost');
    return {
      id: 'reward-loop', name: 'Reward loop', description: 'A reward center whose learned expectation is fed back, after a delay, as effort cost, so sustained success becomes less rewarding.', graph: b.g,
      inputs: portsOf(b, [{ id: 'goal', label: 'Goal', type: 'num', nodeId: 'r', port: 'goal' }]),
      outputs: portsOf(b, [{ id: 'reward', label: 'Reward', type: 'num', nodeId: 'r', port: 'reward' }, { id: 'error', label: 'Error', type: 'num', nodeId: 'r', port: 'error' }]),
      exposed: [{ key: 'gain', label: 'Reward gain', nodeId: 'r', param: 'gain' }, { key: 'learn', label: 'Learning rate', nodeId: 'r', param: 'learn' }],
    } as CompoundDef;
  })();
  const sensory = (() => {
    const b = new Builder();
    b.add('s', 'sense', 0, 0, { feature: 'auto', decay: 10 });
    b.add('t', 'threshold', 156, 0, { threshold: 0.6, hysteresis: 0.1 });
    b.wire('s', 'level', 't', 'in');
    return {
      id: 'sensory-response', name: 'Sensory response', description: 'Auto-ranges a raw signal into 0–1 and raises a trigger when it becomes strong.', graph: b.g,
      inputs: portsOf(b, [{ id: 'in', label: 'Signal', type: 'any', nodeId: 's', port: 'in' }]),
      outputs: portsOf(b, [{ id: 'level', label: 'Level', type: 'num', nodeId: 's', port: 'level' }, { id: 'hit', label: 'Triggered', type: 'bool', nodeId: 't', port: 'over' }]),
      exposed: [{ key: 'threshold', label: 'Trigger level', nodeId: 't', param: 'threshold' }],
    } as CompoundDef;
  })();
  const machine = (() => {
    const b = new Builder();
    b.add('m', 'state', 0, 0, { states: 'off, on', transitions: 'off>on\non>off' });
    return {
      id: 'toggle-state-machine', name: 'Toggle state machine', description: 'A two-state machine that flips on every event.', graph: b.g,
      inputs: portsOf(b, [{ id: 'event', label: 'Event', type: 'any', nodeId: 'm', port: 'event' }]),
      outputs: portsOf(b, [{ id: 'state', label: 'State', type: 'text', nodeId: 'm', port: 'state' }, { id: 'index', label: 'Index', type: 'num', nodeId: 'm', port: 'index' }]),
      exposed: [{ key: 'states', label: 'States', nodeId: 'm', param: 'states' }, { key: 'transitions', label: 'Transitions', nodeId: 'm', param: 'transitions' }],
    } as CompoundDef;
  })();
  return [sensory, reward, decision, machine];
}

export interface Template {
  id: string;
  name: string;
  summary: string;
  expect: string;
  build: () => Project;
}

function make(name: string, description: string, fn: (b: Builder) => void, useCompounds: string[] = []): Project {
  const compounds: Record<string, CompoundDef> = {};
  for (const c of builtinCompounds()) if (useCompounds.includes(c.id)) compounds[c.id] = c;
  const b = new Builder(compounds);
  fn(b);
  const p = newProject(name);
  p.description = description;
  p.graph = b.g;
  p.compounds = compounds;
  return p;
}

export const TEMPLATES: Template[] = [
  {
    id: 'sensory-response', name: 'Sensory input and response',
    summary: 'A simulated voice rises and falls in loudness while stepping through a melody.',
    expect: 'The meter follows loudness, the Knowledge nucleus names the current note, and the indicator fills while loudness is high.',
    build: () => make('Sensory response', 'Hearing → Sense → indicator, plus note naming.', (b) => {
      b.add('ear', 'hearing', 0, 0);
      b.add('sense', 'sense', 0, 96, { feature: 'raw', onset: 0.6 });
      b.add('meter', 'meter', 0, 240);
      b.add('notes', 'knowledge', 156, 96, { package: 'audio-note' });
      b.add('show', 'projector', 156, 240);
      b.add('led', 'vital', 312, 96, { color: 'cyan' });
      b.wire('ear', 'level', 'sense', 'in'); b.wire('sense', 'level', 'meter', 'in');
      b.wire('ear', 'pitch', 'notes', 'in'); b.wire('notes', 'label', 'show', 'in');
      b.wire('sense', 'onset', 'led', 'in');
    }),
  },
  {
    id: 'reward-loop', name: 'Reward-based decision loop',
    summary: 'Random outcomes drive a Reward center whose expectation feeds back as effort cost.',
    expect: 'Reward and prediction error fluctuate; as the expectation grows, the delayed cost pulls rewards down, so the error settles instead of growing.',
    build: () => make('Reward loop', 'Feedback through Delay keeps the reward expectation bounded.', (b) => {
      b.add('out', 'random', 0, 0, { min: 0, max: 1, rate: 1, seed: 7 });
      b.add('rew', 'reward', 0, 48, { gain: 1.5, costWeight: 0.6, learn: 0.25 });
      b.add('lag', 'delay', 156, 48, { ms: 500 });
      b.add('m1', 'meter', 0, 240);
      b.add('m2', 'meter', 156, 96);
      b.wire('out', 'out', 'rew', 'goal'); b.wire('rew', 'expected', 'lag', 'in'); b.wire('lag', 'out', 'rew', 'cost');
      b.wire('rew', 'reward', 'm1', 'in'); b.wire('rew', 'error', 'm2', 'in');
    }),
  },
  {
    id: 'threshold', name: 'Threshold-triggered behavior',
    summary: 'A slow wave crosses a threshold with hysteresis and triggers a counter.',
    expect: 'Each time the wave rises above 0.7 the indicator lights and the counter increases by one.',
    build: () => make('Threshold trigger', 'Wave → Threshold → Counter and indicator.', (b) => {
      b.add('wave', 'wave', 0, 0, { shape: 'sine', freq: 0.4, amp: 0.5, offset: 0.5 });
      b.add('thr', 'threshold', 0, 48, { threshold: 0.7, hysteresis: 0.15 });
      b.add('led', 'vital', 0, 96, { color: 'yellow' });
      b.add('cnt', 'counter', 156, 48, { max: 99 });
      b.add('show', 'projector', 156, 96);
      b.add('scope', 'meter', 312, 96);
      b.wire('wave', 'out', 'thr', 'in'); b.wire('thr', 'over', 'led', 'in'); b.wire('thr', 'over', 'cnt', 'inc');
      b.wire('cnt', 'out', 'show', 'in'); b.wire('wave', 'out', 'scope', 'in');
    }),
  },
  {
    id: 'equation-graphs', name: 'Equation graphs',
    summary: 'Equation nodes store formulas; Meters draw their graphs on gray axes.',
    expect: 'The first Meter shows a decaying cosine, the second shows sin(x) and cos(x) together, and the third shows a wave travelling to the right as time passes. The Projector reads y(x) of the animated equation at x = 1.',
    build: () => make('Equation graphs', 'Equation → Meter: any formula, drawn as a graph.', (b) => {
      b.add('damped', 'equation', 0, 0, { expr: 'y = exp(-x^2/16) * cos(3x)', xMin: -8, xMax: 8 });
      b.add('pair', 'equation', 0, 156, { expr: 'sin(x)\ncos(x)', xMin: -6.2832, xMax: 6.2832 });
      b.add('wave', 'equation', 0, 312, { expr: 'sin(x - 2t) / (1 + abs(x) / 6)', xMin: -10, xMax: 10, yAuto: false, yMin: -1.2, yMax: 1.2, x: 1 });
      b.add('g1', 'meter', 192, 0);
      b.add('g2', 'meter', 192, 156);
      b.add('g3', 'meter', 192, 312);
      b.add('val', 'projector', 360, 312, { format: 'fixed2' });
      b.wire('damped', 'eq', 'g1', 'in'); b.wire('pair', 'eq', 'g2', 'in'); b.wire('wave', 'eq', 'g3', 'in'); b.wire('wave', 'y', 'val', 'in');
    }),
  },
  {
    id: 'memory-state', name: 'Memory and state tracking',
    summary: 'A sequence of numbers feeds a Memory trace while a clock steps a three-state machine.',
    expect: 'The memory trace follows the sequence with lag; the state machine cycles idle → active → done on every pulse.',
    build: () => make('Memory and state', 'Memory trace and state machine side by side.', (b) => {
      b.add('seq', 'sequence', 0, 0, { values: '3, 8, 5, 9, 2', auto: 700 });
      b.add('mem', 'memory', 0, 48, { remember: 0.5 });
      b.add('rec', 'projector', 0, 192);
      b.add('raw', 'projector', 156, 48);
      b.add('clk', 'pulse', 312, 0, { period: 1400, width: 100 });
      b.add('fsm', 'state', 312, 48);
      b.add('st', 'projector', 312, 192);
      b.wire('seq', 'out', 'mem', 'in'); b.wire('mem', 'recall', 'rec', 'in'); b.wire('seq', 'out', 'raw', 'in');
      b.wire('clk', 'out', 'fsm', 'event'); b.wire('fsm', 'state', 'st', 'in');
    }),
  },
  {
    id: 'image-pipeline', name: 'Basic image-processing pipeline',
    summary: 'A simulated camera scene is displayed, named by color, and measured for brightness.',
    expect: 'The image display shows a moving bright disc, COLOR names the average colour, and the brightness meter plots a rescaled 0–100 reading.',
    build: () => make('Image pipeline', 'Vision → Image, Color classifier, Sense brightness → Plastic Nerve.', (b) => {
      b.add('eye', 'vision', 0, 0, { rate: 8 });
      b.add('pic', 'image', 0, 96);
      b.add('hue', 'knowledge', 156, 96, { package: 'image-color' });
      b.add('name', 'projector', 156, 240);
      b.add('lum', 'sense', 312, 96, { feature: 'brightness' });
      b.add('pct', 'plastic', 312, 240, { outMax: 100 });
      b.add('plot', 'meter', 312, 288);
      b.wire('eye', 'image', 'pic', 'in'); b.wire('eye', 'image', 'hue', 'in'); b.wire('hue', 'label', 'name', 'in');
      b.wire('eye', 'image', 'lum', 'in'); b.wire('lum', 'level', 'pct', 'in'); b.wire('pct', 'out', 'plot', 'in');
    }),
  },
  {
    id: 'thermostat', name: 'Feedback-controlled behavior',
    summary: 'A thermostat: a heater switches on below 0.6 and off above 0.7, warming a slow “temperature”.',
    expect: 'The temperature meter oscillates between roughly 0.6 and 0.7 while the indicator toggles. The loop is legal because Smooth (an Inductor) stabilises it.',
    build: () => make('Thermostat feedback', 'Closed loop through a Smooth module.', (b) => {
      b.add('zero', 'constant', 0, 0, { value: '0' });
      b.add('mix', 'combine', 0, 48, { mode: 'sum' });
      b.add('plant', 'inductor', 0, 96, { tau: 1200 });
      b.add('ctl', 'threshold', 0, 144, { threshold: 0.6, hysteresis: 0.1, mode: 'below' });
      b.add('temp', 'meter', 156, 96, { window: 120 });
      b.add('heater', 'vital', 156, 240, { color: 'red' });
      b.wire('zero', 'out', 'mix', 'b'); b.wire('mix', 'out', 'plant', 'in'); b.wire('plant', 'out', 'ctl', 'in');
      b.wire('ctl', 'over', 'mix', 'a'); b.wire('plant', 'out', 'temp', 'in'); b.wire('ctl', 'over', 'heater', 'in');
    }),
  },
  {
    id: 'apparatus', name: 'Compound systems',
    summary: 'A reusable toggle state machine and a decision circuit, each packaged as a compound.',
    expect: 'Every second the toggle flips between off and on; the decision circuit picks whichever random score is higher.',
    build: () => make('Compound systems', 'Compounds reused as ordinary modules.', (b) => {
      b.add('clk', 'pulse', 0, 0, { period: 1000, width: 100 });
      b.add('tog', 'compound', 0, 48, { def: 'toggle-state-machine' });
      b.add('s1', 'projector', 0, 192);
      b.add('ra', 'random', 156, 0, { seed: 3, rate: 1 });
      b.add('rb', 'random', 312, 0, { seed: 4, rate: 1 });
      b.add('dec', 'compound', 156, 48, { def: 'decision-circuit' });
      b.add('s2', 'projector', 156, 192);
      b.wire('clk', 'out', 'tog', 'event'); b.wire('tog', 'state', 's1', 'in');
      b.wire('ra', 'out', 'dec', 'a'); b.wire('rb', 'out', 'dec', 'b'); b.wire('dec', 'label', 's2', 'in');
    }, ['toggle-state-machine', 'decision-circuit']),
  },
  {
    id: 'unit-conversion', name: 'Unit conversion',
    summary: 'Two Unit Converters: a marathon written in miles becomes kilometres, and 100 °C becomes °F.',
    expect: 'The first Projector shows 42.1648128km and the second 212°F. Change a unit in the inspector, or send text such as 5280ft into the Quantity pin.',
    build: () => make('Unit conversion', 'Unit Converters turn a quantity into another unit of the same kind.', (b) => {
      b.add('dist', 'constant', 0, 0, { kind: 'text', value: '26.2mi' });
      b.add('km', 'actor-unitconv', 0, 48, { group: 'length', from: 'm', to: 'm', toPrefix: 'k' });
      b.add('p1', 'projector', 0, 288);
      b.add('deg', 'constant', 168, 0, { value: '100' });
      b.add('tf', 'actor-unitconv', 168, 48, { group: 'temperature', from: '°C', to: '°F' });
      b.add('p2', 'projector', 168, 288);
      b.wire('dist', 'out', 'km', 'in'); b.wire('km', 'quantity', 'p1', 'in');
      b.wire('deg', 'out', 'tf', 'in'); b.wire('tf', 'quantity', 'p2', 'in');
    }),
  },
  {
    id: 'file-conversion', name: 'File conversion and Projector',
    summary: 'A picture goes through a File Converter to become a PDF, and the Projector shows the result.',
    expect: 'Drop a picture on the Image node and press Run. The converter says “Converting…” and then shows the PDF’s name and size; the Projector shows it, and its expand icon opens it in a full-size window.',
    build: () => make('File conversion', 'Image → File Converter (PDF) → Projector.', (b) => {
      b.add('img', 'file-image', 0, 0);
      b.add('cv', 'actor-fileconv', 0, 168, { from: 'image', to: 'pdf', format: 'pdf' });
      b.add('show', 'projector', 0, 408);
      b.wire('img', 'file', 'cv', 'file'); b.wire('cv', 'file', 'show', 'in');
    }),
  },
  {
    id: 'number-formatting', name: 'Exact decimals and Number Formatter',
    summary: 'A Decimal keeps 35 digits of π untouched; three Number Formatters round it to 10 places, to 5 significant digits, and write it in engineering notation.',
    expect: 'The Projectors show 3.1415926536, 3.1416 and 3.14159265358979323846264338327950288e+0. The Decimal itself never rounds: only the Number Formatters do.',
    build: () => make('Exact decimals and Number Formatter', 'Decimal Text → Number Formatter → Projector. Wire Text, not the Decimal pin, so every digit reaches the formatter.', (b) => {
      b.add('pi', 'decimal', 156, 0, { value: '3.14159265358979323846264338327950288' });
      b.add('f1', 'actor-numfmt', 0, 120, { mode: 'places', n: 10 });
      b.add('f2', 'actor-numfmt', 156, 120, { mode: 'digits', n: 5 });
      b.add('f3', 'actor-numfmt', 312, 120, { mode: 'eng', n: 0 });
      b.add('p1', 'projector', 0, 360);
      b.add('p2', 'projector', 156, 360);
      b.add('p3', 'projector', 312, 360);
      for (const [f, p] of [['f1', 'p1'], ['f2', 'p2'], ['f3', 'p3']]) { b.wire('pi', 'text', f, 'in'); b.wire(f, 'text', p, 'in'); }
    }),
  },
];
