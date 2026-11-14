// Gosling's offline program planner. It understands what kind of program you describe ("a 5 minute countdown with a
// light when it's done", "graph y = x^2", "a traffic light") and answers with a complete, correctly wired ProgramSpec
// built from real modules and real settings. No network, no model: every plan here is also covered by tests that run
// the built program in the engine.
import { compileExpr } from '../core/equation';
import { allCities, findCity } from '../core/worldclock';
import { findModules } from './knowledge';
import type { ProgramSpec } from './programs';

export interface Plan {
  spec: ProgramSpec;
  /** One friendly sentence about what was built and how it behaves. */
  summary: string;
  chips?: string[];
  /** The plan should replace the workspace rather than sit next to what is there. */
  replace?: boolean;
}

// ---- reading numbers, times, places ----------------------------------------------------------------------------

const NUM = '-?\\d+(?:\\.\\d+)?';
const DUR_WORDS: Record<string, number> = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  fifteen: 15, twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60,
};
const unitSecs = (u: string) => (/^(ms|milli)/.test(u) ? 0.001 : /^h/.test(u) ? 3600 : /^m/.test(u) ? 60 : 1);

/** “90 seconds”, “5 minutes”, “1 hour 30 minutes”, “2m30s”, “1.5 h”, “half a second”, “an hour” → seconds. */
export function durationOf(text: string): number | null {
  let s = text.toLowerCase();
  let total = 0, any = false;
  const take = (re: RegExp, fn: (m: RegExpExecArray) => number) => {
    s = s.replace(re, (...args) => {
      const m = args.slice(0, -2) as unknown as RegExpExecArray;
      total += fn(m);
      any = true;
      return ' ';
    });
  };
  take(/(\d+(?:\.\d+)?)\s+and\s+a\s+half\s+(hours?|hrs?|minutes?|mins?|seconds?|secs?)(?![a-z])/g, (m) => (Number(m[1]) + 0.5) * unitSecs(m[2]));
  take(/\bhalf\s+(?:an?\s+)?(hours?|hrs?|minutes?|mins?|seconds?|secs?)(?![a-z])/g, (m) => 0.5 * unitSecs(m[1]));
  take(/\bquarter\s+(?:of\s+)?(?:an?\s+)?(hours?|hrs?|minutes?|mins?)(?![a-z])/g, (m) => 0.25 * unitSecs(m[1]));
  take(/(\d+(?:\.\d+)?)\s*(milliseconds?|millis|ms|seconds?|secs?|s|minutes?|mins?|m|hours?|hrs?|h)(?![a-z])/g, (m) => Number(m[1]) * unitSecs(m[2]));
  take(/\b(one|two|three|four|five|six|seven|eight|nine|ten|fifteen|twenty|thirty|forty|fifty|sixty)\s+(milliseconds?|millis|seconds?|secs?|minutes?|mins?|hours?|hrs?)(?![a-z])/g, (m) => (DUR_WORDS[m[1]] ?? 0) * unitSecs(m[2]));
  take(/\b(?:a|an)\s+(hours?|hrs?|minutes?|mins?)(?![a-z])/g, (m) => unitSecs(m[1]));
  return any ? total : null;
}

const pad = (n: number) => String(n).padStart(2, '0');

/** “7:30”, “7 am”, “6:45 pm”, “19:05”, “at noon” → "07:30" (24 h). */
export function timeOfDayOf(text: string): string | null {
  const t = text.toLowerCase();
  if (/\bnoon\b/.test(t)) return '12:00';
  if (/\bmidnight\b/.test(t)) return '00:00';
  const m = t.match(/\b(\d{1,2})(?::(\d{2}))?\s*(a\.?m\.?|p\.?m\.?)\b/) ?? t.match(/\b(\d{1,2}):(\d{2})\b()/);
  if (!m) return null;
  let h = Number(m[1]);
  const min = Number(m[2] ?? 0);
  const ap = m[3]?.[0];
  if (ap && (h < 1 || h > 12)) return null;
  if (ap === 'p' && h < 12) h += 12;
  if (ap === 'a' && h === 12) h = 0;
  if (h > 23 || min > 59) return null;
  return `${pad(h)}:${pad(min)}`;
}

const fold = (s: string) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const STOP = new Set(['the', 'a', 'an', 'time', 'clock', 'world', 'show', 'display', 'and', 'in', 'of', 'for', 'at', 'with', 'my', 'me', 'it', 'on', 'now', 'local', 'current', 'zone']);

/** Cities named in a sentence, in order (exact names only, so ordinary words are never mistaken for places). */
export function citiesIn(text: string): string[] {
  const words = text.replace(/[^\p{L}\p{N}\s.'-]/gu, ' ').split(/\s+/).filter(Boolean);
  const names = new Set(allCities().map((c) => fold(c.name)));
  const found: { at: number; name: string }[] = [];
  const used = new Array(words.length).fill(false);
  for (let n = 3; n >= 1; n--) {
    for (let i = 0; i + n <= words.length; i++) {
      if (used.slice(i, i + n).some(Boolean)) continue;
      const phrase = words.slice(i, i + n).join(' ');
      const f = fold(phrase);
      if (!f || (n === 1 && (STOP.has(f) || f.length < 3))) continue;
      const c = findCity(phrase);
      if (!c) continue;
      const exact = names.has(f) || (f.length >= 5 && fold(c.name).startsWith(f));
      if (!exact) continue;
      for (let j = i; j < i + n; j++) used[j] = true;
      found.push({ at: i, name: c.label });
    }
  }
  return [...new Map(found.sort((a, b) => a.at - b.at).map((f) => [f.name, f])).values()].map((f) => f.name).slice(0, 4);
}

const quoted = (raw: string) => raw.match(/[\"“”‘’']([^\"“”‘’']{1,120})[\"“”‘’']/)?.[1];
const numAfter = (t: string, re: string): number | null => {
  const m = t.match(new RegExp(`${re}\\s*(?:of|to|=|at|is|:)?\\s*(${NUM})`));
  return m ? Number(m[1]) : null;
};
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

type Flags = { light: boolean; sound: boolean; notify: boolean; plot: boolean; indicator: boolean };
function flagsOf(q: string): Flags {
  return {
    light: /\b(lights?|lamps?|leds?|bulbs?|flash\w*)\b/.test(q),
    sound: /\b(beep\w*|buzz\w*|sounds?|ring\w*|tones?|chime\w*|sirens?|speakers?|audio|alarm sound)\b/.test(q),
    notify: /\b(notif\w*|alert me|pop ?up|remind\w*)\b/.test(q),
    plot: /\b(graph\w*|plot\w*|chart\w*|meter|scope|trace)\b/.test(q),
    indicator: /\b(indicator|dot|vital|status)\b/.test(q),
  };
}

type Node = ProgramSpec['nodes'][number];
type Wire = NonNullable<ProgramSpec['wires']>[number];

// ---- archetypes ------------------------------------------------------------------------------------------------

interface Archetype { id: string; test(q: string, raw: string): boolean; build(q: string, raw: string): Plan | null }

const fmtSecs = (s: number) => {
  if (s >= 3600 && s % 3600 === 0) return `${s / 3600} hour${s === 3600 ? '' : 's'}`;
  if (s >= 60 && s % 60 === 0) return `${s / 60} minute${s === 60 ? '' : 's'}`;
  if (s >= 180) return `${Math.floor(s / 60)} min ${Math.round(s % 60)} s`;
  return `${s} second${s === 1 ? '' : 's'}`;
};

/** “90 seconds” → “90-second”, for use before a noun. */
const adj = (s: number) => fmtSecs(s).replace(/^(\d+(?:\.\d+)?) ([a-z]+?)s?$/, '$1-$2');

const ARCHETYPES: Archetype[] = [
  // ---------------------------------------------------------------------------------------------------- equations
  {
    id: 'equation',
    test: (q, raw) => /\b(graph|plot|draw|chart)\b/.test(q) && !!exprOf(raw),
    build: (_q, raw) => {
      const expr = exprOf(raw)!;
      const trig = /\b(sin|cos|tan)\b/.test(expr);
      const nodes: Node[] = [
        { ref: 'eq', type: 'equation', settings: { expr, ...(trig ? { xMin: -6.3, xMax: 6.3 } : {}) } },
        { ref: 'plot', type: 'meter' },
      ];
      return { spec: { name: `Graph of ${expr}`, description: `Plots y = ${expr}.`, nodes, wires: [{ from: 'eq', fromPin: 'eq', to: 'plot' }] }, summary: `I've set up an **Equation** with \`y = ${expr}\` feeding a **Meter**, which draws the curve. Edit the formula in the inspector and the graph redraws.`, chips: ['Graph y = cos(x)', 'Check my program', 'Undo that'] };
    },
  },
  // ------------------------------------------------------------------------------------------------------ traffic light
  {
    id: 'traffic',
    test: (q) => /\btraffic (light|signal|lights)\b|\bstop ?light\b/.test(q),
    build: () => {
      const nodes: Node[] = [
        { ref: 'seq', type: 'sequence', settings: { values: 'green, yellow, red', loop: true, auto: 2500 } },
        { ref: 'cg', type: 'constant', settings: { kind: 'text', value: 'green' } },
        { ref: 'cy', type: 'constant', settings: { kind: 'text', value: 'yellow' } },
        { ref: 'cr', type: 'constant', settings: { kind: 'text', value: 'red' } },
        { ref: 'eg', type: 'compare', settings: { op: '==' } },
        { ref: 'ey', type: 'compare', settings: { op: '==' } },
        { ref: 'er', type: 'compare', settings: { op: '==' } },
        { ref: 'lr', type: 'vital', settings: { color: 'red' } },
        { ref: 'ly', type: 'vital', settings: { color: 'yellow' } },
        { ref: 'lg', type: 'vital', settings: { color: 'green' } },
        { ref: 'now', type: 'projector' },
      ];
      const wires: Wire[] = [
        { from: 'seq', fromPin: 'out', to: 'eg', toPin: 'a' }, { from: 'cg', to: 'eg', toPin: 'b' },
        { from: 'seq', fromPin: 'out', to: 'ey', toPin: 'a' }, { from: 'cy', to: 'ey', toPin: 'b' },
        { from: 'seq', fromPin: 'out', to: 'er', toPin: 'a' }, { from: 'cr', to: 'er', toPin: 'b' },
        { from: 'er', to: 'lr' }, { from: 'ey', to: 'ly' }, { from: 'eg', to: 'lg' },
        { from: 'seq', fromPin: 'out', to: 'now' },
      ];
      return { spec: { name: 'Traffic light', description: 'A sequencer steps green → yellow → red; comparators switch the matching lamp on.', nodes, wires }, summary: 'I built a **traffic light**: a **Sequence** steps green → yellow → red every 2.5 s, three **Compare** modules check which colour is current, and three coloured **Vital** lamps light up accordingly. A Projector names the current colour.', chips: ['Set sequence auto to 1000', 'Check my program', 'Pause'] };
    },
  },
  // ----------------------------------------------------------------------------------------------------- alarm clock
  {
    id: 'alarm',
    test: (q) => /\balarm\b/.test(q) && !/\b(fear|alarm level)\b/.test(q),
    build: (q, raw) => {
      const time = timeOfDayOf(raw) ?? '07:30';
      const city = citiesIn(raw.replace(/\b(?:at|by)\s+\d{1,2}(?::\d{2})?\s*(?:a\.?m\.?|p\.?m\.?)?\b/gi, ''))[0];
      const repeat = /\bweekdays?\b/.test(q) ? 'weekdays' : /\bweekends?\b/.test(q) ? 'weekends' : /\b(daily|every day|each day|everyday)\b/.test(q) ? 'daily' : 'once';
      const f = flagsOf(q);
      const nodes: Node[] = [
        { ref: 'alarm', type: 'alarm', settings: { time, repeat, ...(city ? { city } : {}), ring: 30 } },
        { ref: 'left', type: 'projector' },
        { ref: 'lamp', type: f.indicator ? 'vital' : 'light', settings: { color: 'yellow' } },
        { ref: 'tone', type: 'audio', settings: { wave: 'square', freq: 880, volume: 0.25 } },
      ];
      const wires: Wire[] = [{ from: 'alarm', fromPin: 'countdown', to: 'left' }, { from: 'alarm', fromPin: 'ringing', to: 'lamp' }, { from: 'alarm', fromPin: 'ringing', to: 'tone', toPin: 'amp' }];
      if (f.notify) { nodes.push({ ref: 'note', type: 'notify', settings: { title: 'Alarm', body: `It is ${time}.` } }); wires.push({ from: 'alarm', fromPin: 'ringing', to: 'note' }); }
      return { spec: { name: `Alarm ${time}`, description: `Rings at ${time}.`, nodes, wires }, summary: `I built an **alarm** for **${time}**${city ? ` in ${city}` : ''}${repeat === 'once' ? '' : `, repeating ${repeat}`}. It shows the time left, lights a ${f.indicator ? 'dot' : 'lamp'} and plays a tone while ringing${f.notify ? ', and sends a notification' : ''}. The tone needs a click on the page first, because browsers block sound until you interact.`, chips: ['Set alarm time to 08:00', 'Check my program', 'Pause'] };
    },
  },
  // ------------------------------------------------------------------------------------------------------- stopwatch
  {
    id: 'stopwatch',
    test: (q) => /\bstop ?watch\b/.test(q),
    build: (q) => {
      const limit = durationOf(q);
      const f = flagsOf(q);
      const nodes: Node[] = [{ ref: 'sw', type: 'stopwatch', settings: { autostart: true, ...(limit ? { limit } : {}) } }, { ref: 'show', type: 'projector' }];
      const wires: Wire[] = [{ from: 'sw', fromPin: 'time', to: 'show' }];
      if (f.plot) { nodes.push({ ref: 'plot', type: 'meter' }); wires.push({ from: 'sw', fromPin: 'elapsed', to: 'plot' }); }
      return { spec: { name: 'Stopwatch', description: 'Counts up while the program runs.', nodes, wires }, summary: `I built a **stopwatch**: it starts counting when you press Run and shows the elapsed time on a **Projector**${limit ? `, stopping by itself at ${fmtSecs(limit)}` : ''}.`, chips: ['Add a switch', 'Check my program', 'Pause'] };
    },
  },
  // ------------------------------------------------------------------------------------------------------ countdown
  {
    id: 'countdown',
    test: (q) => /\b(counts? ?downs?|timer|egg timer|kitchen timer)\b/.test(q) && !/\bstop ?watch\b/.test(q),
    build: (q) => {
      const dur = durationOf(q);
      const secs = dur !== null && dur > 0 ? Math.min(359999, Math.max(0.1, dur)) : 60;
      const f = flagsOf(q);
      const repeat = /\b(repeat\w*|loop\w*|over and over|again and again|forever|every time)\b/.test(q);
      const nodes: Node[] = [{ ref: 'timer', type: 'timer', settings: { duration: secs, autostart: true, repeat } }, { ref: 'show', type: 'projector' }];
      const wires: Wire[] = [{ from: 'timer', fromPin: 'time', to: 'show' }];
      const when = /\b(done|finish\w*|ends?|ended|zero|expires?|time s up|rings?|over|complete\w*)\b/.test(q) || f.light || f.indicator || f.notify || f.sound;
      const extras: string[] = [];
      if (f.light || (when && !f.indicator && !f.notify && !f.sound)) { nodes.push({ ref: 'lamp', type: 'light', settings: { color: 'green' } }); wires.push({ from: 'timer', fromPin: 'done', to: 'lamp' }); extras.push('a **Light** that turns on when it reaches zero'); }
      if (f.sound) { nodes.push({ ref: 'tone', type: 'audio', settings: { wave: 'square', freq: 880, volume: 0.25 } }); wires.push({ from: 'timer', fromPin: 'done', to: 'tone', toPin: 'amp' }); extras.push('an **Audio** tone when it finishes'); }
      if (f.indicator) { nodes.push({ ref: 'dot', type: 'vital', settings: { color: 'green' } }); wires.push({ from: 'timer', fromPin: 'done', to: 'dot' }); extras.push('a **Vital** dot for “done”'); }
      if (f.notify) { nodes.push({ ref: 'note', type: 'notify', settings: { title: 'Timer finished', body: `Your ${fmtSecs(secs)} timer is done.` } }); wires.push({ from: 'timer', fromPin: 'done', to: 'note' }); extras.push('a **Notify** that sends a notification'); }
      if (f.plot) { nodes.push({ ref: 'bar', type: 'meter' }); wires.push({ from: 'timer', fromPin: 'progress', to: 'bar' }); extras.push('a **Meter** plotting the progress'); }
      if (dur === null || dur <= 0) extras.push('(no length given, so I used 60 seconds)');
      return { spec: { name: `${cap(adj(secs))} countdown`, description: `Counts down from ${fmtSecs(secs)}.`, nodes, wires }, summary: `I built a **${adj(secs)} countdown**: a **Timer** starts when you press Run${repeat ? ' and restarts every time it finishes' : ''}, and a **Projector** shows the time left${extras.length ? `, with ${extras.join(', ')}` : ''}.`, chips: ['Set timer duration to 2 minutes', 'Check my program', 'Pause'] };
    },
  },
  // ----------------------------------------------------------------------------------------------------- world clock
  {
    id: 'clock',
    test: (q) => /\b(clock|what time|time zones?|local time|time in)\b/.test(q) && !/\b(alarm|stop ?watch|countdown|timer)\b/.test(q),
    build: (q, raw) => {
      const cities = citiesIn(raw);
      const hour12 = /\b(12 ?-?h(our)?|am pm|am\/pm)\b/.test(q);
      const list = cities.length ? cities : [''];
      const nodes: Node[] = [];
      const wires: Wire[] = [];
      list.forEach((c, i) => {
        nodes.push({ ref: `clock${i}`, type: 'clock', settings: { ...(c ? { city: c } : {}), format: hour12 ? '12h' : '24h', seconds: true } }, { ref: `show${i}`, type: 'projector' });
        wires.push({ from: `clock${i}`, fromPin: 'time', to: `show${i}` });
      });
      return { spec: { name: cities.length ? `Clock: ${cities.map((c) => c.split(',')[0]).join(', ')}` : 'Clock', description: 'Live clocks.', nodes, wires }, summary: `I built ${list.length > 1 ? `${list.length} **World Clocks**` : 'a **World Clock**'}${cities.length ? ` for ${cities.join('; ')}` : ' for this device’s time zone'}, each with its own **Projector**.`, chips: ['Add a World Clock', 'Check my program', 'Pause'] };
    },
  },
  // ------------------------------------------------------------------------------------------------- unit conversion
  {
    id: 'temperature',
    test: (q) => /\b(celsius|fahrenheit|centigrade)\b/.test(q) && /\b(convert\w*|to|into|calculator)\b/.test(q),
    build: (q, raw) => {
      const toF = /\b(celsius|centigrade)\b.*\b(to|into)\b.*\bfahrenheit\b/.test(q) || /\bto fahrenheit\b/.test(q) || /\bc to f\b/.test(q) || (/\b(celsius|centigrade)\b/.test(q) && !/\bfahrenheit\b/.test(q));
      const value = raw.match(new RegExp(NUM))?.[0] ?? '25';
      const nodes: Node[] = [{ ref: 'in', type: 'constant', settings: { kind: 'number', value } }];
      const wires: Wire[] = [];
      if (toF) {
        nodes.push({ ref: 'x', type: 'mul', settings: { factor: 1.8 } }, { ref: 'p', type: 'add', settings: { offset: 32 } }, { ref: 'out', type: 'projector' });
        wires.push({ from: 'in', to: 'x', toPin: 'a' }, { from: 'x', to: 'p', toPin: 'a' }, { from: 'p', to: 'out' });
      } else {
        nodes.push({ ref: 'm', type: 'sub', settings: { offset: 32 } }, { ref: 'x', type: 'mul', settings: { factor: 5 } }, { ref: 'd', type: 'div', settings: { divisor: 9 } }, { ref: 'out', type: 'projector' });
        wires.push({ from: 'in', to: 'm', toPin: 'a' }, { from: 'm', to: 'x', toPin: 'a' }, { from: 'x', to: 'd', toPin: 'a' }, { from: 'd', to: 'out' });
      }
      return { spec: { name: toF ? '°C → °F' : '°F → °C', description: toF ? 'F = C × 1.8 + 32' : 'C = (F − 32) × 5 ÷ 9', nodes, wires }, summary: `I built a **${toF ? '°C → °F' : '°F → °C'}** converter for **${value}**: ${toF ? 'a Multiplier (× 1.8) then an Adder (+ 32)' : 'a Subtractor (− 32), a Multiplier (× 5) and a Divisor (÷ 9)'}. Change the **Constant**'s value to convert something else.`, chips: ['Set constant value to 100', 'Check my program', 'Pause'] };
    },
  },
  // -------------------------------------------------------------------------------------------------------- calculator
  {
    id: 'calculator',
    test: (q, raw) => {
      if (/\b(celsius|fahrenheit|graph|plot|timer|count ?down)\b/.test(q)) return false;
      if (/\b(calculator|arithmetic)\b/.test(q)) return true;
      if (!hasOp(q) || (raw.match(new RegExp(NUM, 'g'))?.length ?? 0) < 2) return false;
      // Don't hijack multi-module creation like “add 2 constants and add 3 projectors”
      const mods = findModules(q).filter((m) => !['add', 'sub', 'mul', 'div'].includes(m.def.type));
      return mods.length < 2;
    },
    build: (q, raw) => {
      const ns = (raw.match(new RegExp(NUM, 'g')) ?? []).map(Number);
      const op = opOf(q);
      if (!op || ns.length < 2) {
        const [a, b] = ns.length >= 2 ? ns : [12, 4];
        const nodes: Node[] = [
          { ref: 'a', type: 'constant', settings: { kind: 'number', value: String(a) } }, { ref: 'b', type: 'constant', settings: { kind: 'number', value: String(b) } },
          { ref: 'add', type: 'add' }, { ref: 'sub', type: 'sub' }, { ref: 'mul', type: 'mul' }, { ref: 'div', type: 'div' },
          { ref: 'p1', type: 'projector' }, { ref: 'p2', type: 'projector' }, { ref: 'p3', type: 'projector' }, { ref: 'p4', type: 'projector' },
        ];
        const wires: Wire[] = [];
        for (const o of ['add', 'sub', 'mul', 'div']) wires.push({ from: 'a', to: o, toPin: 'a' }, { from: 'b', to: o, toPin: 'b' });
        wires.push({ from: 'add', to: 'p1' }, { from: 'sub', to: 'p2' }, { from: 'mul', to: 'p3' }, { from: 'div', to: 'p4' });
        return { spec: { name: 'Calculator', description: `Two numbers (${a} and ${b}) through add, subtract, multiply and divide.`, nodes, wires }, summary: `I built a **calculator** for **${a}** and **${b}**: two **Constants** feed an Adder, Subtractor, Multiplier and Divisor, each with its own **Projector**. Change the constants to calculate something else.`, chips: ['Set constant value to 7', 'Check my program', 'Pause'] };
      }
      let [a, b] = ns;
      if (op.type === 'sub' && new RegExp(`\\bsubtract\\w*\\s+${NUM}\\s+from\\s+${NUM}`, 'i').test(raw)) [a, b] = [b, a];
      const nodes: Node[] = [
        { ref: 'a', type: 'constant', settings: { kind: 'number', value: String(a) } }, { ref: 'b', type: 'constant', settings: { kind: 'number', value: String(b) } },
        { ref: 'op', type: op.type }, { ref: 'out', type: 'projector' },
      ];
      const wires: Wire[] = [{ from: 'a', to: 'op', toPin: 'a' }, { from: 'b', to: 'op', toPin: 'b' }, { from: 'op', to: 'out' }];
      return { spec: { name: `${a} ${op.sign} ${b}`, description: `${a} ${op.sign} ${b}`, nodes, wires }, summary: `I built **${a} ${op.sign} ${b}**: two **Constants** into a **${op.name}**, shown on a **Projector**.`, chips: ['Check my program', 'Pause', 'Undo that'] };
    },
  },
  // ------------------------------------------------------------------------------------------------ random / dice
  {
    id: 'random',
    test: (q) => /\b(random|dice|die|d6|d20|roll(ing)?|coin (flip|toss)|flip a coin|lottery)\b/.test(q),
    build: (q, raw) => {
      const coin = /\bcoin\b/.test(q);
      const d = q.match(/\bd(\d{1,3})\b/);
      const between = raw.toLowerCase().match(new RegExp(`(?:between|from)\\s*(${NUM})\\s*(?:and|to|-|–)\\s*(${NUM})`));
      const dice = /\b(dice|die|roll)\b/.test(q);
      let min = 0, max = 1, integer = false;
      if (coin) { min = 0; max = 1; integer = true; }
      else if (d) { min = 1; max = Number(d[1]); integer = true; }
      else if (between) { min = Math.min(Number(between[1]), Number(between[2])); max = Math.max(Number(between[1]), Number(between[2])); integer = /\b(whole|integer|dice|die|roll)\b/.test(q) || (Number.isInteger(min) && Number.isInteger(max) && !/\b(decimal|float|fraction)\b/.test(q)); }
      else if (dice) { min = 1; max = 6; integer = true; }
      const every = durationOf(q);
      const rate = every && every > 0 ? Math.min(30, Math.max(0.1, 1 / every)) : dice || coin ? 0.5 : 1;
      const f = flagsOf(q);
      const nodes: Node[] = [{ ref: 'rng', type: 'random', settings: { min, max, rate, integer, seed: Math.floor(Math.random() * 9000) + 1 } }, { ref: 'show', type: 'projector' }];
      const wires: Wire[] = [{ from: 'rng', to: 'show' }];
      if (f.plot) { nodes.push({ ref: 'plot', type: 'meter' }); wires.push({ from: 'rng', to: 'plot' }); }
      const what = coin ? 'coin flipper (0 / 1)' : d ? `d${max} die` : dice ? 'six-sided die' : `random ${integer ? 'whole ' : ''}number between ${min} and ${max}`;
      return { spec: { name: cap(what.replace(/ \(.*\)/, '')), description: `A new value ${rate >= 1 ? `${rate} times` : `every ${Math.round(1 / rate)} s`} per second.`, nodes, wires }, summary: `I built a **${what}**: a **Random** module draws a new value ${rate >= 1 ? `${rate}× per second` : `every ${Math.round(1 / rate)} seconds`} and a **Projector** shows it${f.plot ? ', with a **Meter** plotting the history' : ''}. Change the Seed for a different sequence.`, chips: ['Set random rate to 2', 'Check my program', 'Pause'] };
    },
  },
  // ---------------------------------------------------------------------------------------------------------- counter
  {
    id: 'counter',
    test: (q) => /\bcount(er|ing|s)?\b|\btally\b/.test(q) && !/\b(counts? ?down|timer)\b/.test(q),
    build: (q) => {
      const dur = durationOf(q);
      const period = Math.min(600000, Math.max(20, Math.round((dur !== null && dur > 0 ? dur : 1) * 1000)));
      const lim = q.match(/\b(?:from|to|up to|until|max(?:imum)?|0 to)\s*(\d+)\b/);
      const max = lim ? Number(lim[1]) : 9;
      const wrap = !/\bno wrap\b/.test(q);
      const nodes: Node[] = [
        { ref: 'clk', type: 'pulse', settings: { period, width: Math.min(50, Math.max(1, Math.round(period / 2))) } },
        { ref: 'cnt', type: 'counter', settings: { start: 0, step: 1, min: 0, max, wrap } },
        { ref: 'show', type: 'projector', settings: { format: 'int' } },
      ];
      const wires: Wire[] = [{ from: 'clk', fromPin: 'out', to: 'cnt', toPin: 'inc' }, { from: 'cnt', to: 'show' }];
      return { spec: { name: 'Counter', description: `Counts up every ${period / 1000} s.`, nodes, wires }, summary: `I built a **counter**: a **Pulse** ticks every ${period / 1000} s, a **Counter** adds one each time (0 to ${max}${wrap ? ', then back to 0' : ''}) and a **Projector** shows the number.`, chips: ['Set pulse period to 500', 'Check my program', 'Pause'] };
    },
  },
  // -------------------------------------------------------------------------------------------------- blink / pulse
  {
    id: 'blink',
    test: (q) => /\b(blink\w*|flash(ing|es)?|flicker\w*|strobe|heartbeat|metronome|pulsing|pulse)\b/.test(q),
    build: (q) => {
      const every = durationOf(q);
      const hzMatch = q.match(/(\d+(?:\.\d+)?)\s*(?:hz|hertz)/);
      const hzVal = hzMatch ? Number(hzMatch[1]) : 0;
      const rawPeriod = hzVal > 0 ? 1000 / hzVal : every && every > 0 ? every * 1000 : 1000;
      const period = Math.min(600000, Math.max(20, Math.round(rawPeriod)));
      const color = (['red', 'green', 'cyan', 'yellow', 'white'] as const).find((c) => new RegExp(`\\b${c}\\b`).test(q)) ?? 'cyan';
      const dot = /\b(dot|indicator|vital)\b/.test(q);
      const nodes: Node[] = [{ ref: 'clk', type: 'pulse', settings: { period, width: Math.max(1, Math.round(period / 2)) } }, { ref: 'lamp', type: dot ? 'vital' : 'light', settings: { color } }];
      return { spec: { name: 'Blinker', description: `Blinks every ${period} ms.`, nodes, wires: [{ from: 'clk', fromPin: 'out', to: 'lamp' }] }, summary: `I built a **${color} blinker**: a **Pulse** fires every ${period} ms (half on, half off) and drives a ${dot ? '**Vital** dot' : '**Light**'}.`, chips: ['Set pulse period to 250', 'Check my program', 'Pause'] };
    },
  },
  // ----------------------------------------------------------------------------------------------------------- wave
  {
    id: 'wave',
    test: (q) => /\b(sine|sin|square|triangle|saw|sawtooth)\s*(wave|signal|oscillat\w*)\b|\b(waveform|oscillator|lfo|signal generator)\b|\bwave\b/.test(q) && !/\btone\b/.test(q),
    build: (q) => {
      const shape = /square/.test(q) ? 'square' : /triangle/.test(q) ? 'triangle' : /saw/.test(q) ? 'saw' : 'sine';
      const rawHz = numAfter(q, '(?:freq(?:uency)?|at)') ?? (q.match(/(\d+(?:\.\d+)?)\s*(?:hz|hertz)/) ? Number(q.match(/(\d+(?:\.\d+)?)\s*(?:hz|hertz)/)![1]) : 1);
      const hz = Math.min(2000, Math.max(0.01, rawHz));
      const amp = Math.min(1000, Math.max(0, numAfter(q, 'amp(?:litude)?') ?? 1));
      const f = flagsOf(q);
      const nodes: Node[] = [{ ref: 'wave', type: 'wave', settings: { shape, freq: hz, amp } }, { ref: 'scope', type: 'meter', settings: { window: 200 } }];
      const wires: Wire[] = [{ from: 'wave', to: 'scope' }];
      if (/\b(number|value|readout|display|show)\b/.test(q) && !f.plot) { nodes.push({ ref: 'show', type: 'projector' }); wires.push({ from: 'wave', to: 'show' }); }
      return { spec: { name: `${cap(shape)} wave`, description: `${hz} Hz ${shape} wave, amplitude ${amp}.`, nodes, wires }, summary: `I built a **${hz} Hz ${shape} wave** (amplitude ${amp}): a **Wave** module feeding a **Meter** that plots it live.`, chips: ['Set wave freq to 3', 'Check my program', 'Pause'] };
    },
  },
  // ------------------------------------------------------------------------------------------------------- tone
  {
    id: 'tone',
    test: (q) => /\b(tone|beep|buzzer|siren|play (a )?(note|sound))\b/.test(q),
    build: (q) => {
      const freq = Math.min(8000, Math.max(20, Number(q.match(/(\d+(?:\.\d+)?)\s*(?:hz|hertz)/)?.[1] ?? (/\bmiddle c\b/.test(q) ? 261.6 : /\ba440\b|\bconcert a\b/.test(q) ? 440 : 440))));
      const wave = /square/.test(q) ? 'square' : /triangle/.test(q) ? 'triangle' : /saw/.test(q) ? 'sawtooth' : 'sine';
      return { spec: { name: `${freq} Hz tone`, nodes: [{ ref: 'tone', type: 'audio', settings: { wave, freq, volume: 0.3 } }] }, summary: `I added an **Audio** module playing a **${freq} Hz ${wave}** tone at 30% volume. Browsers only allow sound after you click something, so press Run first. Say “stop” when you've heard enough.`, chips: ['Set audio freq to 880', 'Stop'] };
    },
  },
  // ----------------------------------------------------------------------------------------- sensors with a trigger
  {
    id: 'sound-trigger',
    test: (q) => /\b(loud|noisy|noise|clap|sound|volume|microphone|mic|hearing)\b/.test(q) && /\b(light|lamp|led|indicator|dot|alert|alarm|trigger|react\w*|respond\w*|when)\b/.test(q) && !/\b(fear|scared|afraid|startle|emotion|mood|play (a )?sound|alarm sound)\b/.test(q),
    build: (q, raw) => {
      const mic = /\b(mic|microphone|real|my voice|live)\b/.test(q);
      const pct = raw.match(new RegExp(`(?:threshold|above|over|than|level)\\s*(?:of|to|=|at|is|:)?\\s*(${NUM})\\s*%`, 'i'));
      const rawLimit = pct ? Number(pct[1]) / 100 : (numAfter(q, '(?:threshold|above|over|than|level)') ?? 0.6);
      const limit = Math.min(1, Math.max(0, rawLimit));
      const nodes: Node[] = [
        { ref: 'ear', type: 'hearing', settings: { source: mic ? 'mic' : 'sim' } },
        { ref: 'limit', type: 'threshold', settings: { threshold: limit, hysteresis: 0.1 } },
        { ref: 'led', type: 'vital', settings: { color: 'cyan' } },
        { ref: 'scope', type: 'meter' },
      ];
      const wires: Wire[] = [{ from: 'ear', fromPin: 'level', to: 'limit' }, { from: 'limit', fromPin: 'over', to: 'led' }, { from: 'ear', fromPin: 'level', to: 'scope' }];
      return { spec: { name: 'Loud-sound light', nodes, wires }, summary: `I built a **loudness trigger**: **Hearing** (${mic ? 'your microphone' : 'a simulated melody'}) → **Threshold** at ${limit} with a little hysteresis → a **Vital** dot, plus a **Meter** of the level. ${mic ? 'Your browser will ask for microphone permission when you run it.' : 'Switch Hearing’s Source to the microphone to use real sound.'}`, chips: ['Set hearing source to mic', 'Check my program', 'Pause'] };
    },
  },
  // ------------------------------------------------------------------------------------------ bionic reflex
  {
    id: 'reflex',
    test: (q) => /\b(fear|scared|afraid|startle|reflex|nervous|emotion|emotional|mood|bionic|nervous system)\b/.test(q),
    build: () => {
      const nodes: Node[] = [
        { ref: 'ear', type: 'hearing' },
        { ref: 'sense', type: 'sense', settings: { feature: 'auto' } },
        { ref: 'fear', type: 'fear', settings: { sensitivity: 1.5 } },
        { ref: 'mood', type: 'emotion', settings: { style: 'emoji' } },
        { ref: 'level', type: 'projector' },
        { ref: 'alarm', type: 'vital', settings: { color: 'red' } },
        { ref: 'face', type: 'projector' },
      ];
      const wires: Wire[] = [
        { from: 'ear', fromPin: 'level', to: 'sense' }, { from: 'sense', fromPin: 'level', to: 'fear', toPin: 'threat' },
        { from: 'fear', fromPin: 'fear', to: 'level' }, { from: 'fear', fromPin: 'alarm', to: 'alarm' },
        { from: 'fear', fromPin: 'fear', to: 'mood', toPin: 'fear' }, { from: 'mood', fromPin: 'mood', to: 'face' },
      ];
      return { spec: { name: 'Startle reflex', description: 'Sound → sense → fear → mood.', nodes, wires }, summary: 'I built a small **nervous system**: **Hearing** → **Sense** (normalises the signal) → **Fear** (rises fast, fades slowly) → a red **Vital** alarm dot, a level readout, and an **Emotion** module that turns fear into a mood face.', chips: ['Set hearing source to mic', 'Check my program', 'Pause'] };
    },
  },
  // --------------------------------------------------------------------------------------------------- sequences
  {
    id: 'sequence',
    test: (q) => /\b(cycles?|rotates?|steps?|loops?|iterates?|goes|go) through\b|\bsequence of\b|\bslideshow\b|\bcarousel\b/.test(q),
    build: (q, raw) => {
      const stripped = /\bthrough\b/i.test(raw)
        ? raw.replace(/^.*?\bthrough\b\s*/i, '')
        : /\bsequence of\b/i.test(raw)
          ? raw.replace(/^.*?\bsequence of\b\s*/i, '')
          : raw.replace(/^.*?\bof\b\s*/i, '');
      const afterThrough = stripped.replace(/\bevery\b.*$/i, '').replace(/[.!?]+$/, '');
      const items = afterThrough.split(/\s*(?:,|;|\band\b|\bthen\b)\s*/i).map((s) => s.trim().replace(/^["“”']|["“”']$/g, '')).filter(Boolean).slice(0, 12);
      if (items.length < 2) return null;
      const everyClause = raw.match(/\bevery\b.*$/i)?.[0] ?? q;
      const dur = durationOf(everyClause);
      const ms = Math.max(100, Math.round((dur !== null && dur > 0 ? dur : 1) * 1000));
      const nodes: Node[] = [{ ref: 'seq', type: 'sequence', settings: { values: items.join(', '), loop: true, auto: ms } }, { ref: 'show', type: 'projector' }];
      return { spec: { name: 'Sequence', description: `Steps through ${items.join(', ')}.`, nodes, wires: [{ from: 'seq', fromPin: 'out', to: 'show' }] }, summary: `I built a **sequence** that steps through **${items.join(' → ')}** every ${ms / 1000} s and loops, shown on a **Projector**.`, chips: ['Set sequence auto to 2000', 'Check my program', 'Pause'] };
    },
  },
  // ------------------------------------------------------------------------------------------------- show some text
  {
    id: 'text',
    test: (q, raw) => /\b(shows?|displays?|prints?|says?|writes?|greets?)\b/.test(q) && !!quoted(raw),
    build: (_q, raw) => {
      const text = quoted(raw)!;
      return { spec: { name: text.slice(0, 40), nodes: [{ ref: 'msg', type: 'constant', settings: { kind: 'text', value: text } }, { ref: 'show', type: 'projector' }], wires: [{ from: 'msg', to: 'show' }] }, summary: `I built a display for “${text}”: a text **Constant** into a **Projector**.`, chips: ['Set constant value to "Hi!"', 'Check my program', 'Pause'] };
    },
  },
];

// ---- helpers used by the archetypes ----------------------------------------------------------------------------

const OPS = [
  { re: /\b(add|adds|adding|sum|plus|added)\b|\+/, type: 'add', name: 'Adder', sign: '+' },
  { re: /\b(subtract\w*|minus|difference)\b|(?<=\d)\s*[-−]\s*(?=\d)/, type: 'sub', name: 'Subtractor', sign: '−' },
  { re: /\b(multipl\w+|times|product)\b|\*|×|(?<=\d)\s*x\s*(?=\d)/, type: 'mul', name: 'Multiplier', sign: '×' },
  { re: /\b(divid\w+|over|quotient)\b|÷|(?<=\d)\s*\/\s*(?=\d)/, type: 'div', name: 'Divisor', sign: '÷' },
];
const hasOp = (q: string) => OPS.some((o) => o.re.test(q));
const opOf = (q: string) => OPS.find((o) => o.re.test(q));

/** The formula in “graph y = x^2 + 1”, “plot sin(x)”, “draw 2x - 3”. Null when it isn't a valid formula in x or t. */
function exprOf(raw: string): string | null {
  const eq = raw.match(/\by\s*=\s*([^,;?!]+?)\s*$|\by\s*=\s*([^,;?!]+)/i);
  let cand = (eq?.[1] ?? eq?.[2] ?? '').trim();
  if (!cand) {
    const m = raw.match(/\b(?:graph|plot|draw|chart)\s+(?:me\s+)?(?:the\s+|a\s+)?(?:function|equation|formula|curve|parabola\s+)?\s*(?:of\s+)?([^,;?!]+?)\s*$/i);
    cand = (m?.[1] ?? '').trim();
  }
  cand = cand.replace(/^(?:f\(x\)|y)\s*=\s*/i, '').replace(/\b(please|for me|on a meter|on a graph|as a graph)\b.*$/i, '').replace(/\.$/, '').trim();
  if (!cand || cand.length > 120) return null;
  if (!/\b[xt]\b|\d[xt]\b|[xt]\s*[\^*+\-/)]|[(^*+\-/]\s*[xt]\b/.test(cand) && !/^[xt]$/.test(cand)) return null;
  const c = compileExpr(cand);
  return c.ok ? cand : null;
}

// ---- entry point -----------------------------------------------------------------------------------------------

const BUILD_VERB = /^(create|make|build|program|design|generate|give me|i need|i want|i d like|i would like|write|code|construct|show me|set up|setup|let s make|can you make|draw|plot|graph|simulate|prototype|put together|roll|flip|toss|play|convert|blink|flash|cycle|beep|show|display)\b/;
const NOUNISH = /\b(program|app|circuit|system|machine|demo|simulation|project|widget|gadget|contraption)\b/;

/**
 * Is this a request to build a whole working program? Returns the plan, or null when the sentence is something else
 * (a question, an edit, “add a timer”, …) and should go to the other intents.
 */
export function planProgram(raw: string, q0: string): Plan | null {
  const q = q0.replace(/^(?:(?:also|and then|and|then|now|next|plus|oh and|okay|ok|so|please)\s+)+/, '');
  const wantsBuild = BUILD_VERB.test(q) || NOUNISH.test(q) || /\bfor me\b/.test(q);
  if (!wantsBuild) return null;
  // “add a timer”, “create 2 projectors”: plain module requests stay with the module intent
  if (/^(add|create|place|put|drop|insert|spawn|new)\s+(a |an |one |another |some |\d+ )?[a-z ]{2,24}$/.test(q) && !NOUNISH.test(q) && !/\b(timer|countdown|stopwatch|clock|alarm)\b.*\d/.test(q)) {
    const hasKind = ARCHETYPES.some((a) => a.id !== 'text' && a.test(q, raw));
    if (!hasKind) return null;
    if (!/\b(count ?down|stop ?watch|traffic|calculator|converter|dice|alarm clock|world clock|blinker|blinking|sine wave|square wave|triangle wave|sequence|nervous system)\b/.test(q)) return null;
  }
  for (const a of ARCHETYPES) {
    if (!a.test(q, raw)) continue;
    const plan = a.build(q, raw);
    if (!plan) continue;
    if (/\b(new|fresh|blank|from scratch|start over|replace|instead|clear)\b/.test(q) && /\b(program|workspace|canvas|project|scratch|start over|clear|replace)\b/.test(q)) plan.replace = true;
    return plan;
  }
  return null;
}

export const _plannerInternal = { ARCHETYPES, exprOf, durationOf, timeOfDayOf, citiesIn };
