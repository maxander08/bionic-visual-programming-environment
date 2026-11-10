import { addNode, connect, emptyGraph } from '../../core/graph';
import { newProject } from '../../core/project';
import type { Template } from '../../core/library';
import type { Graph, Params, Project } from '../../core/types';

export interface RecipeNode { id: string; type: string; x: number; y: number; params?: Params }
export interface Recipe {
  id: string;
  title: string;
  level: 'Beginner' | 'Intermediate';
  summary: string;
  nodes: RecipeNode[];
  /** [from node, output port, to node, input port] */
  wires: [string, string, string, string][];
  /** Why each part is there. */
  steps: string[];
  expect: string;
  tweak: string[];
  tags: string;
}

const C = 192, R = 156;
const at = (col: number, row: number) => ({ x: col * C, y: row * R });

export const RECIPES: Recipe[] = [
  {
    id: 'loud-light', title: 'Light up when it gets loud', level: 'Beginner',
    summary: 'Hearing → Threshold → Vital, with hysteresis so the light does not flicker.',
    tags: 'sound loudness threshold indicator hysteresis trigger',
    nodes: [
      { id: 'ear', type: 'hearing', ...at(0, 0) },
      { id: 'limit', type: 'threshold', ...at(0, 1), params: { threshold: 0.6, hysteresis: 0.1 } },
      { id: 'led', type: 'vital', ...at(0, 2), params: { color: 'cyan' } },
      { id: 'scope', type: 'meter', ...at(1, 1) },
    ],
    wires: [['ear', 'level', 'limit', 'in'], ['limit', 'over', 'led', 'in'], ['ear', 'level', 'scope', 'in']],
    steps: ['**Hearing** produces a loudness level between 0 and 1 (a simulated melody until you pick the microphone).', '**Threshold** turns the level into true/false at 0.6. Hysteresis 0.1 means it only turns off again below 0.5.', '**Vital** shows the true/false as a filled or hollow dot.', '**Meter** plots the raw level so you can see why the light changes.'],
    expect: 'The meter swells and falls once a second. The dot fills while the level is above 0.6.',
    tweak: ['Set Hysteresis to 0 and watch for flicker near the limit.', 'Change Threshold’s **Condition** to *below* to light up when it is quiet.', 'Switch Hearing’s **Source** to the microphone.'],
  },
  {
    id: 'smooth-signal', title: 'Smooth a jittery signal', level: 'Beginner',
    summary: 'Compare a noisy random signal with the same signal through a low-pass filter.',
    tags: 'smooth filter noise lowpass inductor jitter',
    nodes: [
      { id: 'noise', type: 'random', ...at(0, 0), params: { rate: 8, seed: 3 } },
      { id: 'smooth', type: 'inductor', ...at(0, 1), params: { tau: 800 } },
      { id: 'raw', type: 'meter', ...at(2, 0) },
      { id: 'soft', type: 'meter', ...at(2, 1) },
    ],
    wires: [['noise', 'out', 'smooth', 'in'], ['noise', 'out', 'raw', 'in'], ['smooth', 'out', 'soft', 'in']],
    steps: ['**Random** draws a new number 8 times a second, repeatably (Seed 3).', '**Smooth** follows it with an 800 ms time constant.', 'Two **Meters** let you compare before and after.'],
    expect: 'The first meter jumps around; the second drifts gently toward the same values.',
    tweak: ['Try Time constant 200 ms (light) and 3000 ms (heavy).', 'Change the Seed for a different sequence.'],
  },
  {
    id: 'count-pulses', title: 'Count pulses and show the total', level: 'Beginner',
    summary: 'A clock feeds a counter that wraps around, shown on a Projector.',
    tags: 'count clock pulse counter wrap projector timer',
    nodes: [
      { id: 'clock', type: 'pulse', ...at(0, 0), params: { period: 800, width: 100 } },
      { id: 'count', type: 'counter', ...at(0, 1), params: { start: 0, step: 1, min: 0, max: 9, wrap: true } },
      { id: 'show', type: 'projector', ...at(0, 2), params: { format: 'int' } },
    ],
    wires: [['clock', 'out', 'count', 'inc'], ['count', 'out', 'show', 'in']],
    steps: ['**Pulse** emits a true pulse every 800 ms.', '**Counter** adds 1 for every pulse. With **Wrap around** on and Maximum 9, it counts 0…9 then returns to 0.', '**Projector** shows the number as a whole number.'],
    expect: 'The projector counts up once every 0.8 seconds and loops after 9.',
    tweak: ['Turn Wrap around off to see it stop at 9.', 'Set Step to −1 to count down.', 'Connect a [[n:switch]] to Reset.'],
  },
  {
    id: 'startle', title: 'A startle response with mood', level: 'Intermediate',
    summary: 'Loudness raises fear; fear sets off an alarm and colours a mood word.',
    tags: 'fear emotion mood startle alarm threat',
    nodes: [
      { id: 'ear', type: 'hearing', ...at(0, 0) },
      { id: 'fear', type: 'fear', ...at(0, 1), params: { floor: 0.5, sensitivity: 1.6, rise: 200, decay: 4000 } },
      { id: 'alarm', type: 'vital', ...at(0, 3), params: { color: 'red' } },
      { id: 'mood', type: 'emotion', ...at(1, 1) },
      { id: 'word', type: 'text', ...at(1, 3) },
    ],
    wires: [['ear', 'level', 'fear', 'threat'], ['fear', 'alarm', 'alarm', 'in'], ['fear', 'fear', 'mood', 'fear'], ['mood', 'mood', 'word', 'in']],
    steps: ['**Hearing** level is the threat (0–1).', '**Fear** ignores threat below 0.5 (Threat floor), builds in about 200 ms and fades over 4 seconds.', '**Alarm** raises a flag when fear exceeds its Alarm level.', '**Emotion** turns fear into a mood word shown by **Text**.'],
    expect: 'Each loud swell makes the fear rise fast and fade slowly; the alarm dot lights and the mood word changes.',
    tweak: ['Lengthen Decay time to 15 000 ms for lingering anxiety.', 'Connect a Reward into Emotion to balance fear with a positive drive.'],
  },
  {
    id: 'metronome', title: 'A ticking metronome', level: 'Intermediate',
    summary: 'A pulse triggers an envelope that shapes a tone’s loudness into short blips.',
    tags: 'audio sound envelope pulse metronome beep tone adsr',
    nodes: [
      { id: 'beat', type: 'pulse', ...at(0, 0), params: { period: 500, width: 100 } },
      { id: 'shape', type: 'envelope', ...at(0, 1), params: { attack: 5, decay: 150, sustain: 0, release: 50, peak: 1 } },
      { id: 'tone', type: 'audio', ...at(0, 3), params: { wave: 'sine', freq: 440, volume: 0.12 } },
    ],
    wires: [['beat', 'out', 'shape', 'gate'], ['shape', 'out', 'tone', 'amp']],
    steps: ['**Pulse** fires twice a second.', '**Envelope** opens on each pulse: a 5 ms attack, then a quick 150 ms fall to silence (Sustain 0).', '**Audio** plays a 440 Hz tone whose amplitude follows the envelope.'],
    expect: 'After pressing Run you hear a short blip every half second. Sound is blocked until you press Run.',
    tweak: ['Change Waveform to *square* for a harsher click.', 'Set the pulse Period to 250 ms for double time.', 'Set Decay to 400 ms for a softer pluck.'],
  },
  {
    id: 'decide', title: 'Choose between sound and light', level: 'Intermediate',
    summary: 'A decision node picks whichever of two scores is higher, with hysteresis.',
    tags: 'decision choose compare options argmax',
    nodes: [
      { id: 'ear', type: 'hearing', ...at(0, 0) },
      { id: 'cam', type: 'vision', ...at(1, 0) },
      { id: 'pick', type: 'decision', ...at(0, 2), params: { labels: 'Sound, Light', hysteresis: 0.08 } },
      { id: 'out', type: 'text', x: 0, y: 492 },
    ],
    wires: [['ear', 'level', 'pick', 'a'], ['cam', 'luma', 'pick', 'b'], ['pick', 'label', 'out', 'in']],
    steps: ['**Hearing** level scores option A (Sound).', '**Vision** brightness scores option B (Light).', '**Decision** picks the higher score. Hysteresis 0.08 stops it flipping when scores are close.', '**Text** shows the winning label.'],
    expect: 'The text switches between “Sound” and “Light” as the loudness swell passes the scene brightness.',
    tweak: ['Raise Hysteresis to make it more reluctant to switch.', 'Add a third option on C and extend Labels.', 'Switch Policy to *epsilon-greedy* to add exploration.'],
  },
  {
    id: 'gate-switch', title: 'Gate a signal with a switch', level: 'Beginner',
    summary: 'A Switch opens and closes a Gate that sits in front of a Meter.',
    tags: 'relay gate switch pass block control',
    nodes: [
      { id: 'sw', type: 'switch', ...at(0, 0), params: { on: true } },
      { id: 'osc', type: 'wave', ...at(1, 0), params: { shape: 'sine', freq: 0.5 } },
      { id: 'gate', type: 'relay', ...at(0, 2) },
      { id: 'scope', type: 'meter', ...at(0, 3) },
    ],
    wires: [['sw', 'on', 'gate', 'open'], ['osc', 'out', 'gate', 'in'], ['gate', 'out', 'scope', 'in']],
    steps: ['**Switch** is the manual on/off control. Click its inner pad while running.', '**Wave** produces a slow sine.', '**Gate** passes the wave only while Open is true.', '**Meter** plots whatever gets through.'],
    expect: 'The meter draws the sine while the switch is on, and flat-lines (keeping the last value) when you turn it off.',
    tweak: ['Turn on Invert control to flip the logic.', 'Replace the switch with a [[n:threshold]] to gate automatically.'],
  },
  {
    id: 'state-machine', title: 'A three-step state machine', level: 'Intermediate',
    summary: 'A clock sends a named event that walks a machine through idle → active → done.',
    tags: 'state machine event transitions fsm sequence steps',
    nodes: [
      { id: 'clock', type: 'pulse', ...at(0, 0), params: { period: 1500, width: 100 } },
      { id: 'next', type: 'event', ...at(0, 1), params: { name: 'next' } },
      { id: 'fsm', type: 'state', ...at(0, 2), params: { states: 'idle, active, done', transitions: 'idle:next>active\nactive:next>done\ndone:next>idle' } },
      { id: 'label', type: 'text', ...at(1, 2) },
    ],
    wires: [['clock', 'out', 'next', 'trigger'], ['next', 'event', 'fsm', 'event'], ['fsm', 'state', 'label', 'in']],
    steps: ['**Pulse** fires every 1.5 s.', '**Send Event** turns each pulse into the named event `next`.', '**State** moves one step on every `next`, following the lines in Transitions.', '**Text** shows the current state.'],
    expect: 'The text cycles idle → active → done → idle every 1.5 seconds.',
    tweak: ['Add `*:fault>idle` to the end of Transitions and send a second event named `fault`.', 'Replace the pulse with a [[n:keys]] sensor so a key press advances the machine.'],
  },
  {
    id: 'remap-pitch', title: 'Sweep a pitch with a remapped wave', level: 'Beginner',
    summary: 'A slow triangle wave is remapped from −1…1 into 220…880 Hz and drives an Audio tone.',
    tags: 'plastic remap range audio pitch sweep wave scale',
    nodes: [
      { id: 'osc', type: 'wave', ...at(0, 0), params: { shape: 'triangle', freq: 0.25, amp: 1 } },
      { id: 'map', type: 'plastic', ...at(0, 1), params: { inMin: -1, inMax: 1, outMin: 220, outMax: 880 } },
      { id: 'tone', type: 'audio', ...at(0, 3), params: { volume: 0.1 } },
      { id: 'hz', type: 'projector', ...at(1, 1), params: { format: 'int' } },
    ],
    wires: [['osc', 'out', 'map', 'in'], ['map', 'out', 'tone', 'freq'], ['map', 'out', 'hz', 'in']],
    steps: ['**Wave** swings between −1 and 1 every 4 seconds.', '**Plastic Nerve** maps −1…1 onto 220…880 Hz. It is the glue between a signal’s range and a setting’s range.', '**Audio** plays the tone; **Projector** shows the frequency.'],
    expect: 'After pressing Run, you hear a tone rising and falling between 220 and 880 Hz.',
    tweak: ['Change Curve to *ease-in* to bunch the sweep toward the low pitches.', 'Swap the Wave for a [[n:touch]] pad’s X output to play it by hand.'],
  },
  {
    id: 'breathing-clock', title: 'A clock that breathes', level: 'Intermediate',
    summary: 'Drive Pulse’s Period setting from a slow wave through a setting pin.',
    tags: 'setting pin modulate drive override period pulse wave plastic parameter',
    nodes: [
      { id: 'slow', type: 'wave', ...at(0, 0), params: { shape: 'sine', freq: 0.1, amp: 1 } },
      { id: 'map', type: 'plastic', ...at(0, 1), params: { inMin: -1, inMax: 1, outMin: 250, outMax: 1200 } },
      { id: 'clock', type: 'pulse', ...at(0, 3), params: { period: 1000, width: 100 } },
      { id: 'total', type: 'projector', ...at(1, 3), params: { format: 'int' } },
    ],
    wires: [['slow', 'out', 'map', 'in'], ['map', 'out', 'clock', 'p:period'], ['clock', 'count', 'total', 'in']],
    steps: ['**Wave** sweeps −1…1 every 10 seconds.', '**Plastic Nerve** remaps it to 250…1200 ms, a valid range for Pulse’s Period.', 'The remapped signal is wired to Pulse’s **Period setting pin** (left edge). While it is connected, it replaces the inspector value.', '**Projector** shows how many pulses have fired.'],
    expect: 'The pulses speed up and slow down smoothly. Select Pulse and you will see its Period greyed out because a wire is driving it.',
    tweak: ['Disconnect the wire and the inspector’s Period (1000 ms) returns.', 'Try driving Width the same way.'],
  },
  {
    id: 'equation-wave', title: 'Graph an animated equation', level: 'Beginner',
    summary: 'An Equation node feeds a Meter, which plots a wave travelling in simulation time.',
    tags: 'equation graph plot meter math function t time',
    nodes: [
      { id: 'eq', type: 'equation', ...at(0, 0), params: { expr: 'sin(x - 2t)', xMin: -10, xMax: 10 } },
      { id: 'plot', type: 'meter', ...at(0, 1) },
    ],
    wires: [['eq', 'eq', 'plot', 'in']],
    steps: ['**Equation** stores `sin(x - 2t)`. `t` is simulation time in seconds, so the graph moves.', '**Meter** draws the equation across x from −10 to 10 when it receives the Equation output.'],
    expect: 'A sine wave slides across the graph. Click the expand icon on the Meter for a labelled full-size view.',
    tweak: ['Try `sin(x); cos(x)` to graph two curves.', 'Try `exp(-x^2/4) * cos(3x - 4t)` for a travelling wave packet.'],
  },
  {
    id: 'sentiment', title: 'Read the sentiment of some text', level: 'Beginner',
    summary: 'Info text feeds a Knowledge node running the sentiment package.',
    tags: 'knowledge sentiment text lexicon classify package',
    nodes: [
      { id: 'said', type: 'info', ...at(0, 0), params: { text: 'I love how wonderful this is' } },
      { id: 'read', type: 'knowledge', ...at(0, 1), params: { package: 'text-sentiment' } },
      { id: 'verdict', type: 'text', ...at(0, 3) },
      { id: 'strength', type: 'projector', ...at(1, 3), params: { format: 'percent' } },
    ],
    wires: [['said', 'text', 'read', 'in'], ['read', 'label', 'verdict', 'in'], ['read', 'score', 'strength', 'in']],
    steps: ['**Info** holds some text you can edit in the inspector.', '**Knowledge** with the *Text sentiment* package scores words against a small lexicon.', '**Text** shows the label; **Projector** shows the score as a percentage.'],
    expect: 'The label reads positive. Edit the Info text to “this is terrible and sad” and it flips.',
    tweak: ['Chain Info into several Knowledge nodes with different packages.', 'Remember it is a word list, not a language model: sarcasm will fool it.'],
  },
];

export const RECIPE_BY_ID = new Map(RECIPES.map((r) => [r.id, r]));

/** Build a real project through the same graph API the editor uses. Throws if a wire is invalid. */
export function buildRecipe(r: Recipe): Project {
  let g: Graph = emptyGraph();
  for (const n of r.nodes) g = addNode(g, n.type, n.x, n.y, n.params ?? {}, undefined, n.id).graph;
  for (const [a, ap, b, bp] of r.wires) {
    const res = connect(g, a, ap, b, bp);
    if (res.error) throw new Error(`Recipe “${r.id}”: ${a}.${ap} → ${b}.${bp}: ${res.error}`);
    g = res.graph;
  }
  const p = newProject(r.title);
  p.description = r.summary;
  p.graph = g;
  return p;
}

export function recipeTemplate(r: Recipe): Template {
  return { id: `recipe-${r.id}`, name: r.title, summary: r.summary, expect: r.expect, build: () => buildRecipe(r) };
}
