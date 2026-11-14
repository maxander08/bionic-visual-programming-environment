// Gosling's built-in brain. It runs entirely in the browser: it reads the sentence, works out what you want, looks at the
// live workspace through workspace.ts, and acts through actions.ts. No network, no account.
import { useStore } from '../state/store';
import { MODULES, getDef, nodeSize } from '../core/registry';
import type { ModuleDef } from '../core/types';
import { compileExpr } from '../core/equation';
import { RECIPES } from '../ui/docs/recipes';
import { ARTICLE_BY_ID } from '../ui/docs/content';
import { plain } from '../ui/docs/markup';
import type { Route } from '../ui/docs/types';
import {
  addModules, addRecipe, buildBlock, connectNodes, control, focusNodes, removeModules, renameProgram, setNodeDisabled, setSettings,
  type BuildSpec,
} from './actions';
import {
  coerceParam, describeModule, describePins, docSearch, findCategory, findModules, findParam, findRecipe, modulesIn, norm, settingsOf, singular,
  describeParam, type ModuleMention,
} from './knowledge';
import { createProgram, reportText, verifyProgram } from './programs';
import { planProgram } from './planner';
import {
  countText, diagnosticsText, fmtValue, nodeText, overviewText, runStateText, takeSnapshot, timersText, TIMING_TYPES, type NodeInfo, type Snapshot,
} from './workspace';

export interface Reply {
  text: string;
  /** Things Gosling actually did to the workspace. */
  actions?: string[];
  chips?: string[];
  docs?: { label: string; route: Route }[];
  pending?: Pending;
}
export interface Pending { prompt: string; run: () => Reply }

// ---- small helpers ---------------------------------------------------------------------------------------------

const WORDS: Record<string, number> = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, fifteen: 15, twenty: 20, couple: 2, few: 3, pair: 2, dozen: 12 };
const toCount = (t?: string): number | null => {
  if (!t) return null;
  if (/^\d+$/.test(t)) return Math.min(50, Number(t));
  return WORDS[t] ?? null;
};
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const pick = <T,>(a: T[]): T => a[Math.floor(Math.random() * a.length)];
const list = (a: string[]) => (a.length <= 1 ? a.join('') : `${a.slice(0, -1).join(', ')} and ${a[a.length - 1]}`);
const typeName = (t: string) => MODULES.find((m) => m.type === t)?.name ?? t;

const POLITE = /^(?:(?:(?:hey|hi|hello) gosling|ok|okay|so|and|then|now|gosling|please|pls|can you|could you|would you|will you|would you mind|do me a favou?r and|i d like you to|i want you to|i need you to|go ahead and|just|kindly|lets|let s|let us)\s+)+/;
const clean = (q: string) => q.replace(POLITE, '').replace(/\s+(please|pls|thanks|thank you|for me)$/g, '').trim();

/** Ids of every workspace node mentioned in the text, in order of appearance. */
function mentionedIds(q: string, snap: Snapshot): string[] {
  const hits: { id: string; at: number }[] = [];
  for (const n of snap.nodes) {
    const m = new RegExp(`(^|[^a-z0-9])${esc(n.id).replace(/-/g, '[- ]')}($|[^a-z0-9])`, 'i').exec(q);
    if (m) hits.push({ id: n.id, at: m.index });
  }
  return hits.sort((a, b) => a.at - b.at).map((h) => h.id);
}

const idsOfType = (snap: Snapshot, type: string) => snap.nodes.filter((n) => n.type === type).map((n) => n.id);

type Target = { ids: string[]; label: string };
/** What the user is pointing at: an id, “the selected module”, or a kind of module that exists in the workspace. */
function resolveTargets(q: string, snap: Snapshot, mentions: ModuleMention[]): Target | null {
  const ids = mentionedIds(q, snap);
  if (ids.length) return { ids, label: ids.join(', ') };
  if (/\b(selected|selection|this one|these|this (module|node)|that one)\b/.test(q) && snap.selection.length) return { ids: snap.selection, label: snap.selection.join(', ') };
  for (const m of mentions) {
    const have = idsOfType(snap, m.def.type);
    if (have.length) {
      const all = /\b(all|every|each)\b/.test(q) || have.length === 1;
      const sel = have.filter((i) => snap.selection.includes(i));
      return { ids: all ? have : sel.length ? sel : [have[have.length - 1]], label: all ? `all ${m.def.name} modules` : sel.length ? sel.join(', ') : have[have.length - 1] };
    }
  }
  return null;
}

const PRIMARY: Record<string, string> = { timer: 'duration', constant: 'value', alarm: 'time', pulse: 'period', switch: 'on', comment: 'text', by: 'author', integer: 'value', decimal: 'value', string: 'value', stopwatch: 'limit' };

const TIME_RE = /(\d+(?:\.\d+)?)\s*(ms|milliseconds?|s|secs?|seconds?|m|mins?|minutes?|h|hrs?|hours?)\b/g;
function durationSeconds(text: string): number | null {
  let total = 0, any = false;
  for (const m of text.matchAll(TIME_RE)) {
    const n = Number(m[1]);
    const u = m[2];
    total += /^ms|^milli/.test(u) ? n / 1000 : /^h/.test(u) ? n * 3600 : /^m/.test(u) ? n * 60 : n;
    any = true;
  }
  return any ? total : null;
}

/** Read “duration 30 seconds”, “with repeat”, “format percent”, a quoted text… for one module out of a stretch of words. */
function parseSettings(def: ModuleDef, text: string, raw: string): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const t = ' ' + norm(text) + ' ';
  const params = settingsOf(def).filter((p) => p.kind !== 'action');
  const quoted = raw.match(/["“'‘]([^"”’]+)["”’]/);
  if (quoted) {
    const tp = params.find((p) => p.kind === 'text' && /text|value|note|content|message|title|label|author/i.test(p.key)) ?? params.find((p) => p.kind === 'text');
    if (tp) out[tp.key] = quoted[1];
  }
  const dur = params.find((p) => p.kind === 'number' && p.unit === 's' && p.key === 'duration');
  const secs = durationSeconds(t);
  if (dur && secs !== null) out[dur.key] = secs;
  const byLen = [...params].sort((a, b) => b.label.length - a.label.length);
  for (const p of byLen) {
    if (p.key in out) continue;
    for (const name of new Set([norm(p.label), norm(p.key)])) {
      if (name.length < 3) continue;
      const m = new RegExp(`\\s(without |no )?${esc(name)}s?(?:\\s*(?:to|=|of|as|:|at|is|be|on|equals)\\s*|\\s+)?([^,;]*?)(?=\\s+(?:and|with|then|also|plus)\\s+|[,;]|\\s*$)`).exec(t);
      if (!m) continue;
      const val = m[2].trim();
      if (p.kind === 'bool') {
        out[p.key] = m[1] ? false : val ? (coerceParam(p, val.split(' ')[0]).ok ? (coerceParam(p, val.split(' ')[0]) as { value: unknown }).value : true) : true;
      } else if (val) {
        const c = coerceParam(p, p.kind === 'number' ? val.match(/-?\d*\.?\d+\s*[a-z]*/)?.[0] ?? val : p.kind === 'select' ? val : (raw.match(new RegExp(`${esc(name)}\\s*(?:to|=|of|as|:|at|is)?\\s*([^,;]+)`, 'i'))?.[1] ?? val).trim());
        if (c.ok) out[p.key] = c.value;
      }
      break;
    }
  }
  // “a timer of 30 seconds”, “a constant of 7”, “a switch on”
  if (!Object.keys(out).length) {
    const key = PRIMARY[def.type];
    const p = key ? findParam(def, key) : undefined;
    if (p) {
      const num = t.match(/(?:^|\s)(?:of|to|=|at|is|with|for)?\s*(-?\d*\.?\d+)\b/);
      if (p.kind === 'number' && num) out[p.key] = Number(num[1]);
      else if (p.kind === 'bool') { if (/\b(on|true|yes)\b/.test(t)) out[p.key] = true; else if (/\b(off|false|no)\b/.test(t)) out[p.key] = false; }
      else if (p.kind === 'text' && num) out[p.key] = num[1];
    }
  }
  return out;
}

// ---- canned knowledge ------------------------------------------------------------------------------------------

const JOKES = [
  'Why do Java developers wear glasses? Because they don’t C#. (James Gosling has heard it. Many times.)',
  'A node walks into a bar. The bar says, “we don’t serve your type.” The node says, “that’s fine, I’ll convert.”',
  'I would tell you a joke about UDP, but you might not get it.',
  'There are 10 kinds of people: those who understand binary and those who don’t.',
  'Why did the signal cross the wire? To get to the other pin.',
  '“Write once, run anywhere.” We wrote it once. We ran it everywhere. We debugged it everywhere too.',
];

interface Faq { re: RegExp; a: string; chips?: string[] }
const FAQ: Faq[] = [
  { re: /\b(who is|who was|tell me about|about) (james )?gosling\b|\bwho is james\b|\bjames gosling\b|\bwho named you\b|\bwhy (are you )?(called|named) gosling\b|\bwhy gosling\b/, a: '**James Gosling** is the Canadian computer scientist who created **Java** at Sun Microsystems in the early 1990s (it began as the “Oak” project in 1991 and shipped in 1995). He is known as “the father of Java”, and built on the idea that you write a program once and run it anywhere. I’m named after him because a good copilot should be dependable, portable and not afraid of a big graph of wires.' },
  { re: /\bwhat is java\b|\btell me about java\b|\bjava\b.*\b(language|programming)\b/, a: '**Java** is a general-purpose, object-oriented programming language created by James Gosling and released by Sun Microsystems in 1995. Source code compiles to bytecode that runs on the Java Virtual Machine, so the same program runs on many kinds of computers. It is widely used for servers, Android apps and large business systems. (Not to be confused with JavaScript, which is a different language.)' },
  { re: /\bwhat is javascript\b|\bjavascript\b.*\b(vs|versus|difference)\b|\bjs vs java\b/, a: '**JavaScript** is the programming language of the web. It was created by Brendan Eich in 1995 and runs in every browser: this very site, including me, is written in TypeScript (JavaScript with types). It has nothing to do with Java other than half of its name.' },
  { re: /\bwhat is (a )?(node graph|node based|visual programming|node editor|dataflow)\b|\bvisual programming\b.*\bwhat\b/, a: '**Visual (node-based) programming** means building a program by placing boxes (nodes or modules) on a canvas and connecting them with wires, instead of typing lines of code. Data flows along the wires from one box to the next. That is exactly how Nicque works: sensors produce signals, nuclei process them, and behaviors display or act on them.' },
  { re: /\bwhat is (a )?(variable)\b/, a: 'A **variable** is a named place that stores a value, such as `score = 10`. In Nicque the closest thing is a Base Data module (Integer, Decimal, String, Boolean…) or a Register, which holds one value and passes it on.' },
  { re: /\bwhat is (a )?(function)\b/, a: 'A **function** is a reusable piece of logic that takes inputs and gives back an output. In Nicque, every module is one, and you can wrap a group of modules into a reusable Apparatus (compound) with Ctrl/⌘+G.' },
  { re: /\bwhat is (a )?(loop|feedback loop)\b/, a: 'A **loop** repeats something. In Nicque you make one by wiring an output back into an earlier input, which is only legal through a module that holds state or time (Delay, Register, Timer, State…). Otherwise the editor reports an unbounded cycle instead of spinning forever.' },
  { re: /\bwhat is (an? )?(api)\b/, a: 'An **API** (application programming interface) is a defined way for one piece of software to ask another to do something, like a menu a program can order from. This site has no server API: everything runs in your browser.' },
  { re: /\bwhat is (an? )?(algorithm)\b/, a: 'An **algorithm** is a precise, step-by-step method for solving a problem, like a recipe a computer can follow. A wired Nicque program is one too: the order of the wires is the order of the steps.' },
  { re: /\bwhat is (a )?(bug|debugging)\b/, a: 'A **bug** is a mistake that makes a program do something unintended; **debugging** is finding and fixing it. In Nicque: press Step (.) to advance one tick at a time, check module status markers, and ask me “any problems?” — I will list errors, warnings and modules that are waiting for a signal.' },
  { re: /\bwhat is (an? )?(compiler)\b/, a: 'A **compiler** translates source code into something a machine can run. Java compiles to bytecode; this site is compiled by Vite into a single HTML file.' },
  { re: /\bwhat is (an? )?(ai|artificial intelligence|llm|language model)\b/, a: '**AI** is software that performs tasks that normally need human judgement, like recognising speech or writing text. A **language model (LLM)** is an AI trained on huge amounts of text to predict and produce language. I am a lighter kind of assistant: out of the box I use rules and a live view of your workspace. If you connect a language model in my settings (the gear in this panel), I can use it to answer open questions.' },
  { re: /\bwhat is react\b/, a: '**React** is a JavaScript library for building user interfaces out of components. Nicque’s editor is built with React, Vite, Tailwind CSS and Zustand.' },
  { re: /\bwhat is python\b/, a: '**Python** is a popular, readable programming language created by Guido van Rossum, widely used for scripting, data science and AI.' },
  { re: /\bhello world\b/, a: '`Hello, world!` is the traditional first program. In Nicque: add a **Constant** with Kind = Text and Value = Hello, world!, wire it to a **Projector**, and press Run. Say “build hello world” and I’ll do it.' },
  { re: /\bmeaning of life\b/, a: '42. (Though in Nicque, a Constant set to 42 wired to a Projector says it louder.)' },
];

const IDENTITY = /\b(who are you|what are you|your name|introduce yourself|are you (an? )?(ai|bot|robot|human|real)|who (made|built|created) you)\b/;
const HELP = /^(help|what can you do|what do you do|how can you help|what can i ask|commands|capabilities|what can i say|how do i use you|how do you work)\b/;

const HELP_TEXT = `I'm **Gosling**, your copilot in Nicque. I can see your workspace live and I can build in it.
**Ask me about the workspace**
- “Give me an overview” · “what's running?” · “what timers are running?”
- “How many Projector nodes are there?” · “any problems?” · “what's selected?”
- “What is Timer-1 showing?” · “what is connected to projector-1?”
**Ask me about Nicque**
- “What does the Threshold module do?” · “settings of Timer” · “pins of Hearing”
- “How do I connect modules?” · “keyboard shortcuts” · “which module should I use for…”
**Tell me to build**
- “Add a timer set to 90 seconds and a projector, connected”
- “Create 3 switches” · “connect timer-1 to projector-1” · “set timer-1 duration to 30 seconds”
- “Build the loud light recipe” · “delete all projectors” · “run” / “pause” / “stop”
I also do quick maths, and I'll tell a joke if you insist.`;

// ---- individual intents ----------------------------------------------------------------------------------------

function runControl(q: string): Reply | null {
  const m = q.match(/^(run|start|play|go|launch|resume|continue|pause|hold|freeze|stop|halt|reset|step|tick|advance|press (?:run|play|pause|stop|step))( the| my| this)?( program| simulation| sim| workspace| project| it| everything| engine| one tick| a tick| once| forward)?( now)?$/);
  if (!m) return null;
  const w = m[1].replace('press ', '');
  const action = /^(run|start|play|go|launch|resume|continue)$/.test(w) ? 'run' : /^(pause|hold|freeze)$/.test(w) ? 'pause' : /^(step|tick|advance)$/.test(w) ? 'step' : 'stop';
  const r = control(action);
  const s = takeSnapshot();
  return { text: r.message + (action === 'run' && s.nodeCount === 0 ? ' (The workspace is empty, though, so there is nothing to see yet.)' : ''), actions: r.ok ? [r.message] : undefined, chips: action === 'run' ? ['What timers are running?', 'Any problems?', 'Pause'] : ['Overview'] };
}

function removeIntent(q: string, snap: Snapshot, mentions: ModuleMention[]): Reply | null {
  if (!/^(delete|remove|erase|trash|destroy|get rid of|clear|wipe|discard|take out|take away)\b/.test(q)) return null;
  if (/\b(everything|all (of )?(it|the (modules|nodes))|the (whole )?(workspace|canvas|program)|all modules|all nodes|all my (modules|nodes)|the workspace)\b/.test(q) && !mentions.length) {
    if (!snap.nodeCount) return { text: 'The workspace is already empty.' };
    return { text: `That would remove all ${snap.nodeCount} modules and ${snap.edgeCount} connections. Do it?`, chips: ['Yes, clear it', 'No, keep it'], pending: { prompt: 'clear', run: () => { const cur = takeSnapshot(); const r = removeModules(cur.nodes.map((n) => n.id)); return { text: r.message, actions: r.ok ? [r.message] : undefined }; } } };
  }
  if (/\b(wire|wires|connection|connections|link|links)\b/.test(q) && !mentions.length && !mentionedIds(q, snap).length) {
    return { text: 'To remove a connection, click the wire and press Delete. I can also rebuild a link: wiring an input to a new source replaces the old one.' };
  }
  const t = resolveTargets(q, snap, mentions);
  if (!t) return { text: mentions.length ? `There are no ${mentions[0].def.name} modules in the workspace to remove.` : 'Tell me what to remove: a module id like `timer-1`, “all projectors”, or “the selected module”.' };
  const exact = !!mentionedIds(q, snap).length || /\b(all|every|each|selected)\b/.test(q) || t.ids.length === 1;
  const ids = exact ? t.ids : t.ids.slice(-1);
  const r = removeModules(ids);
  return { text: r.message, actions: [r.message], chips: ['Overview'] };
}

function enableIntent(q: string, snap: Snapshot, mentions: ModuleMention[]): Reply | null {
  const m = q.match(/^(disable|enable|mute|unmute|deactivate|activate)\b/);
  if (!m) return null;
  const t = resolveTargets(q, snap, mentions);
  if (!t) return { text: 'Which module? Give me an id like `timer-1`, or select it first.' };
  const off = /^(disable|mute|deactivate)$/.test(m[1]);
  const r = setNodeDisabled(t.ids, off);
  return { text: r.message, actions: [r.message] };
}

function connectIntent(raw: string, q: string, snap: Snapshot, mentions: ModuleMention[]): Reply | null {
  const m = q.match(/^(connect|wire|link|hook|attach|pipe|join|route|feed|send)\b/);
  if (!m) return null;
  if (/^(wire|connect)\s*$/.test(q)) return { text: 'Connect what to what? For example: “connect timer-1 to projector-1”.' };
  // the two ends: ids first (scan raw so `timer-1.p:duration` keeps its colon), otherwise kinds of module present in the workspace
  type End = { id: string; at: number; port?: string };
  const ends: End[] = [];
  const src = raw.toLowerCase();
  const re = snap.nodes.length ? new RegExp(`(^|[^a-z0-9])(${snap.nodes.map((n) => esc(n.id).replace(/-/g, '[- ]')).sort((a, b) => b.length - a.length).join('|')})(?:\\.([a-z0-9:_-]+))?(?=$|[^a-z0-9])`, 'gi') : null;
  if (re) for (const x of src.matchAll(re)) { const found = snap.nodes.find((n) => new RegExp(`^${esc(n.id).replace(/-/g, '[- ]')}$`, 'i').test(x[2])); if (found) ends.push({ id: found.id, at: x.index!, port: x[3] }); }
  if (ends.length < 2) {
    const toks = q.split(' ');
    for (const mm of mentions) {
      const have = idsOfType(snap, mm.def.type);
      if (!have.length) continue;
      const pos = toks.slice(0, mm.start).join(' ').length;
      if (ends.some((e) => snap.nodes.find((n) => n.id === e.id)?.type === mm.def.type && Math.abs(e.at - pos) < 2)) continue;
      // when two of one kind exist, prefer the one that is not wired yet
      const free = have.filter((i) => !ends.some((e) => e.id === i));
      const sel = free.filter((i) => snap.selection.includes(i));
      ends.push({ id: sel[0] ?? free[free.length - 1] ?? have[0], at: pos });
    }
    ends.sort((a, b) => a.at - b.at);
  }
  if (ends.length < 2) {
    if (mentions.length >= 2 && ends.length < 2) return { text: `I couldn't find both of those in the workspace yet. ${mentions.map((x) => x.def.name).join(' and ')}: I can add them and wire them for you. Say “add a ${mentions[0].def.name.toLowerCase()} and a ${mentions[1].def.name.toLowerCase()}, connected”.` };
    return { text: 'Tell me the two ends, for example “connect timer-1 to projector-1”. You can name pins too: “connect timer-1.done to light-1”.' };
  }
  const a = ends[0], b = ends[1];
  const A = snap.nodes.find((n) => n.id === a.id)!, B = snap.nodes.find((n) => n.id === b.id)!;
  // pin names: `id.pin` syntax, or the label of one of the pins written as a word
  const hint = (n: NodeInfo, dir: 'in' | 'out', given?: string) => {
    if (given) return given;
    const pins = dir === 'out' ? n.def.outputs : n.def.inputs.filter((p) => !p.param);
    const words = (' ' + q + ' ');
    return pins.find((p) => p.label.length >= 3 && new RegExp(`[^a-z0-9]${esc(p.label.toLowerCase())}( |$)`).test(words) && !n.name.toLowerCase().includes(p.label.toLowerCase()))?.id;
  };
  const r = connectNodes(A.id, B.id, hint(A, 'out', a.port), hint(B, 'in', b.port));
  return { text: r.message, actions: r.ok ? [r.message] : undefined, chips: r.ok ? ['Run', `What is ${B.id} showing?`] : undefined };
}

function settingIntent(raw: string, q: string, snap: Snapshot, mentions: ModuleMention[]): Reply | null {
  const rn = q.match(/^(?:rename|call|name|title|retitle)\s+(?:the |this |my )?(?:program|project|workspace|file)\b/);
  if (rn) {
    const quoted = raw.match(/["“]([^"”]+)["”]/);
    const name = (quoted?.[1] ?? raw.replace(/^.*?\b(?:program|project|workspace|file)\b\s*(?:(?:to|as|called|named)\b\s*)?/i, '')).trim();
    if (!name) return { text: 'What should I call it?' };
    const r = renameProgram(name);
    return { text: r.message, actions: [r.message] };
  }
  const explicit = mentionedIds(q, snap).length > 0;
  const verb = q.match(/^(set|change|update|adjust|configure|alter|modify|turn|switch|tune|make|put|increase|decrease|raise|lower)\b/);
  if (!verb) return null;
  if (verb[1] === 'make' && !explicit && !/^make (the|my|this|that|all|every|each|selected)\b/.test(q)) return null;
  if (/^set up\b/.test(q)) return null;
  if (verb[1] === 'put' && !explicit && !/^put (the|my|this|that|all|every|each|selected)\b/.test(q)) return null;
  const t = resolveTargets(q, snap, mentions);
  if (!t) return null;
  const nodes = t.ids.map((i) => snap.nodes.find((n) => n.id === i)!).filter(Boolean);
  if (!nodes.length) return null;
  const results: string[] = [];
  const notes: string[] = [];
  const idPat = new RegExp(`(^|[^a-z0-9])(${nodes.map((n) => esc(n.id).replace(/-/g, '[- ]')).join('|')})(?=$|[^a-z0-9])`, 'gi');
  const tail = ' ' + q.replace(idPat, ' ').replace(/^(set|change|update|adjust|configure|alter|modify|turn|switch|tune|make|put)\s+(the |all |every |each |selected )?/, '') + ' ';
  for (const n of nodes) {
    const found = parseSettings(n.def, tail, raw.replace(idPat, ' '));
    // “increase / decrease”
    if (!Object.keys(found).length) {
      const num = tail.match(/(-?\d*\.?\d+)/);
      const key = PRIMARY[n.type];
      const p = key ? findParam(n.def, key, n.inst.params) : undefined;
      if (p?.kind === 'number' && num && /\b(to|=|at)\b/.test(tail)) found[p.key] = Number(num[1]);
    }
    if (!Object.keys(found).length) { notes.push(`I couldn't tell which setting of ${n.name} \`${n.id}\` to change.`); continue; }
    const r = setSettings(n.id, found);
    (r.ok ? results : notes).push(r.message);
  }
  if (!results.length) {
    const n = nodes[0];
    const names = settingsOf(n.def).filter((p) => p.kind !== 'action').map((p) => p.label);
    return { text: `${notes[0] ?? 'I could not change that.'} ${n.name} has these settings: ${names.join(', ')}. Try “set ${n.id} ${names[0]?.toLowerCase()} to …”.` };
  }
  return { text: results.join('\n') + (notes.length ? '\n' + notes.join(' ') : ''), actions: results };
}

const COMBO_WORDS = /\b(connected|wired|linked|hooked up|joined|together|show(s|ing)? (it|the \w+)|display(s|ing)? (it|the \w+)|feeding|feeds|into|that (shows|displays|feeds)|and display it|and show it|with (a |an )?(display|projector|screen)|on (a |an |the )?(projector|screen|display|meter))\b/;

/** “make a 5 minute countdown with a light”, “graph y = x^2”, “a traffic light”: whole programs, built wired, checked and run. */
function planIntent(raw: string, q: string, mentions: ModuleMention[]): Reply | null {
  if (mentions.length >= 2 && COMBO_WORDS.test(q)) return null; // “add a timer and a projector, connected” is a plain wiring request
  const plan = planProgram(raw, q);
  if (!plan) return null;
  const r = createProgram(plan.spec, { replace: plan.replace, run: true });
  if (!r.ok) return { text: `I planned that but couldn't build it: ${r.message}` };
  const bad = r.report && !r.report.ok;
  const seen = r.report?.observed.length ? ` Checked with a dry run: ${r.report.observed.slice(0, 2).join('; ')}.` : '';
  return {
    text: `${plan.summary} ${bad ? `My check found something to fix: ${reportText(r.report!)}` : `It's running now.${seen}`}`,
    actions: [r.message],
    chips: plan.chips ?? ['Run', 'Undo that'],
  };
}

/** “check my program”, “does it work?”, “why is nothing showing”: wiring checks plus a dry run. */
function checkIntent(q: string, snap: Snapshot): Reply | null {
  if (!/\b(check|verify|validate|test|debug|diagnose|does (it|this|that) work|is (it|this) (working|wired|right|correct)|will (it|this) work|why (is|isn t|doesn t|does|are|aren t)\b.*\b(nothing|working|blank|empty|idle|showing|happening))\b/.test(q)) return null;
  if (/\b(how (do|to|can)|what is|explain)\b/.test(q)) return null;
  if (!snap.nodeCount) return { text: 'The workspace is empty, so there is nothing to check yet. Tell me what to build, for example “make a 2 minute countdown”.' };
  const r = verifyProgram();
  return {
    text: r.ok
      ? `I checked ${snap.nodeCount} modules and ${snap.edgeCount} wires and ran a 3 second dry run. **No problems found.**${r.observed.length ? ` ${r.observed.slice(0, 3).join('; ')}.` : ''}${r.notes.length ? ` Worth a look: ${r.notes.slice(0, 3).join(' ')}` : ''}`
      : `I checked it and found ${r.problems.length} problem${r.problems.length === 1 ? '' : 's'}:\n${r.problems.slice(0, 6).map((p) => `- ${p}`).join('\n')}${r.observed.length ? `\nDry run: ${r.observed.slice(0, 3).join('; ')}.` : ''}`,
    chips: r.ok ? ['Overview', snap.run === 'running' ? 'Pause' : 'Run'] : ['Connect them', 'Overview'],
  };
}

function createIntent(raw: string, q: string, mentions: ModuleMention[]): Reply | null {
  const verb = q.match(/^(create|make|place|put|drop|spawn|insert|build|setup|give me|i need|i want|i d like|i would like|new|get me|bring|summon|generate|throw|load)\b/);
  const noun = q.match(/^(a|an|some|another|one|two|three|\d+)\s/);
  if (!verb && !noun) return null;
  if (!verb && noun && !mentions.length) return null;
  const strong = !!verb && /^(create|make|place|put|drop|spawn|insert|build|setup|summon|generate|throw)$/.test(verb[1]);
  if (!strong && !mentions.length && !/\b(recipe|example|hello world)\b/.test(q)) return null;
  const body = q.replace(verb?.[0] ?? '', '').trim();

  // “hello world”
  if (/\bhello,? world\b/.test(q)) {
    const r = buildBlock({ nodes: [{ ref: 'c', type: 'constant', params: { kind: 'text', value: 'Hello, world!' } }, { ref: 'p', type: 'projector' }], wires: [{ from: 'c', to: 'p' }] }, 'Hello, world');
    return { text: r.message + ' Press Run to see it.', actions: [r.message], chips: ['Run'] };
  }

  // recipes from the Cookbook
  const wantsRecipe = /\b(recipe|cookbook|example)\b/.test(q);
  const recipe = findRecipe(body.replace(/\b(the|a|an|recipe|example|cookbook|please)\b/g, ''));
  if (recipe && (wantsRecipe || !mentions.length)) {
    const r = addRecipe(recipe.id);
    return { text: `${r.message} ${recipe.expect}`, actions: [r.message], chips: ['Run', `Explain the ${recipe.title} recipe`], docs: [{ label: `Open recipe: ${recipe.title}`, route: { k: 'recipe', id: recipe.id } }] };
  }
  if (wantsRecipe && !recipe) return { text: `Which recipe? The Cookbook has: ${RECIPES.map((r) => r.title).join('; ')}.`, chips: RECIPES.slice(0, 3).map((r) => `Build ${r.title}`) };

  // which modules, how many, with what settings
  const made = mentions;
  if (!made.length) {
    const hits = docSearch(body, 5).filter((h) => h.entry.kind === 'Node' || h.entry.kind === 'Goal');
    if (hits.length) {
      const nodes = hits.filter((h) => h.entry.kind === 'Node').slice(0, 4);
      return { text: `I'm not sure which module you mean by “${body}”. Closest matches: ${nodes.map((h) => `**${h.entry.title}**`).join(', ') || hits.map((h) => h.entry.title).join(', ')}. Tell me which one, e.g. “add a ${(nodes[0]?.entry.title ?? 'timer').toLowerCase()}”.`, chips: nodes.slice(0, 3).map((h) => `Add a ${h.entry.title}`) };
    }
    return { text: `I'm not sure what to build from that. I can add modules (“add a timer”, “create 2 projectors”), or build whole working programs: “make a 5 minute countdown with a light”, “world clock for Tokyo and London”, “graph y = x^2”, “a traffic light”, “roll a die”, “alarm at 7:30”, “celsius to fahrenheit”. For anything more open-ended, connect a language model in my settings and I can design any program for you.`, chips: ['Add a timer', 'List the sensors', 'What modules are there?'] };
  }

  const toks = q.split(' ');
  const specs = made.map((m, i) => {
    const before = toks[m.start - 1], before2 = toks[m.start - 2];
    let count = toCount(before) ?? (before && ['of', 'more', 'extra', 'new'].includes(before) ? toCount(before2) : null) ?? 1;
    if (before && /^\d+x$/.test(before)) count = Number(before.slice(0, -1));
    const segStart = toks.slice(0, m.end).join(' ').length;
    let nextEndIdx = made[i + 1] ? made[i + 1].start : toks.length;
    if (made[i + 1]) {
      const nb = toks[nextEndIdx - 1];
      if (nb && (toCount(nb) !== null || /^\d+x$/.test(nb))) nextEndIdx--;
      else if (nb && ['of', 'more', 'extra', 'new'].includes(nb) && toCount(toks[nextEndIdx - 2]) !== null) nextEndIdx -= 2;
    }
    const nextStart = nextEndIdx < toks.length ? toks.slice(0, Math.max(m.end, nextEndIdx)).join(' ').length : q.length;
    const seg = q.slice(segStart, nextStart).replace(/\b(and|then|plus|add|create|with a|with an|with)\s*$/g, '');
    return { def: m.def, count, params: parseSettings(m.def, seg, raw) };
  });

  const wired = specs.length >= 2 && COMBO_WORDS.test(q);
  if (wired) {
    const nodes: BuildSpec['nodes'] = [];
    const stages: string[][] = [];
    let colX = 0;
    for (let i = 0; i < specs.length; i++) {
      const s = specs[i];
      const cnt = Math.max(1, Math.min(10, s.count));
      const d = getDef(s.def.type, undefined, s.params);
      const sz = d ? nodeSize(d) : { w: 168, h: 120 };
      const refs: string[] = [];
      for (let k = 0; k < cnt && nodes.length < 20; k++) {
        const ref = `n${i}_${k}`;
        refs.push(ref);
        nodes.push({ ref, type: s.def.type, params: s.params, dx: colX, dy: k * (sz.h + 28) });
      }
      stages.push(refs);
      colX += sz.w + 72;
    }
    const wires: NonNullable<BuildSpec['wires']> = [];
    for (let i = 0; i + 1 < stages.length; i++) {
      const froms = stages[i], tos = stages[i + 1];
      const n = Math.max(froms.length, tos.length);
      for (let k = 0; k < n; k++) wires.push({ from: froms[Math.min(k, froms.length - 1)], to: tos[Math.min(k, tos.length - 1)] });
    }
    const r = buildBlock({ nodes, wires }, specs.map((s) => (s.count > 1 ? `${s.count}× ${s.def.name}` : s.def.name)).join(' + '));
    return { text: r.message + ' Press Run to see it work.', actions: [r.message], chips: ['Run', 'Overview', 'Undo that'] };
  }
  const acts: string[] = [];
  const failed: string[] = [];
  for (const s of specs) {
    const r = addModules(s.def.type, s.count, s.params);
    (r.ok ? acts : failed).push(r.message);
  }
  const total = specs.reduce((a, s) => a + s.count, 0);
  const lead = acts.length ? pick(['Done.', 'Added.', 'There you go.', 'On the workspace.']) : '';
  const tips = specs.length === 1 && specs[0].def.outputs.length ? `Its outputs: ${specs[0].def.outputs.slice(0, 5).map((p) => p.label).join(', ')}.` : '';
  const chips = specs.length === 1 ? [`What does ${specs[0].def.name} do?`, `Settings of ${specs[0].def.name}`, 'Run'] : ['Connect them', 'Run'];
  return { text: [lead, ...acts, ...failed, total > 1 && specs.length > 1 ? 'Say “connect them” if you want them wired up.' : tips].filter(Boolean).join('\n'), actions: acts, chips };
}

function connectThem(q: string, snap: Snapshot): Reply | null {
  if (!/^(connect|wire|link|hook up) (them|these|those|it up)( together| up)?$/.test(q)) return null;
  const ids = snap.selection.length >= 2 ? snap.selection : snap.nodes.slice(-2).map((n) => n.id);
  if (ids.length < 2) return { text: 'I need at least two modules to connect.' };
  const sorted = snap.nodes.filter((n) => ids.includes(n.id));
  const msgs: string[] = [];
  const acts: string[] = [];
  for (let i = 0; i + 1 < sorted.length; i++) { const r = connectNodes(sorted[i].id, sorted[i + 1].id); msgs.push(r.message); if (r.ok) acts.push(r.message); }
  return { text: msgs.join('\n'), actions: acts.length ? acts : undefined };
}

// ---- queries ---------------------------------------------------------------------------------------------------

function nodesLine(_snap: Snapshot, ids: string[]): string {
  return ids.map((id) => `\`${id}\``).join(', ');
}

function countIntent(q: string, snap: Snapshot, mentions: ModuleMention[]): Reply | null {
  const asks = /\b(how many|how much|count|number of|do i have|are there any|is there an?|is there any|any|list|which|what .* (do i have|are there|are in|are on)|show me (all )?(the |my )?)\b/.test(q);
  if (!asks) return null;
  const cat = findCategory(q);
  if (/\b(connection|wire|edge|link)s?\b/.test(q) && /\b(how many|count|number)\b/.test(q)) {
    return { text: `There ${snap.edgeCount === 1 ? 'is' : 'are'} **${snap.edgeCount}** connection${snap.edgeCount === 1 ? '' : 's'} between ${countText(snap.nodeCount, 'module')}.` };
  }
  if (/\b(compound|apparatus|apparatuses|group)s?\b/.test(q) && /\bhow many|count|number\b/.test(q)) {
    return { text: snap.compounds.length ? `${countText(snap.compounds.length, 'compound')}: ${snap.compounds.map((c) => `${c.name} (${c.inner} inner modules)`).join(', ')}.` : 'There are no compounds (Apparatus) in the workspace.' };
  }
  if (/\b(disabled|muted|switched off)\b/.test(q)) return { text: snap.disabled.length ? `${countText(snap.disabled.length, 'module')} disabled: ${nodesLine(snap, snap.disabled)}.` : 'No modules are disabled.' };
  if (/\b(unconnected|not connected|disconnected|orphan|loose|unwired|not wired|isolated)\b/.test(q)) return { text: snap.unconnected.length ? `${countText(snap.unconnected.length, 'module')} not wired to anything: ${nodesLine(snap, snap.unconnected)}.` : 'Every module is connected to something.' };
  if (/\b(timer|stopwatch|alarm|clock|timekeeping)s?\b/.test(q) && /\b(running|active|going|ticking|counting|live)\b/.test(q)) return { text: timersText(snap), chips: ['Overview'] };
  const m = mentions.find((x) => x.def.type) && mentions[0];
  const generic = /\b(modules?|nodes?|things|items|components|blocks)\b/.test(q) && !m && !cat;
  if (m) {
    const ids = idsOfType(snap, m.def.type);
    const n = ids.length;
    if (!/\b(how many|count|number|do i have|any|list|which|is there|are there|show)\b/.test(q)) return null;
    let text = `There ${n === 1 ? 'is' : 'are'} **${n}** ${m.def.name} module${n === 1 ? '' : 's'} in the workspace${n ? `: ${nodesLine(snap, ids)}` : ''}.`;
    if (m.def.type === 'projector' && n) text += ` ${snap.run === 'stopped' ? 'The program is stopped, so they are blank.' : snap.projectors.map((p) => `\`${p.id}\` shows ${p.showing}${p.source ? ` (from ${p.source})` : ' (nothing wired in)'}`).join('; ') + '.'}`;
    if (TIMING_TYPES.includes(m.def.type) && n) text += '\n' + snap.timers.filter((t) => t.type === m.def.type).map((t) => `- \`${t.id}\` is ${t.state}: ${t.detail}`).join('\n');
    if (!n) text += ` Want me to add one?`;
    return { text, chips: n ? [`Describe ${ids[0]}`, 'Overview'] : [`Add a ${m.def.name}`] };
  }
  if (cat) {
    const mods = new Set(modulesIn(cat).map((x) => x.type));
    const here = snap.nodes.filter((n) => mods.has(n.type));
    if (!/\b(do i have|i have|in my|in the workspace|on the workspace|on my|on the canvas|how many|count|number of|currently|are in|are on)\b/.test(q)) return null; // a library question, not the workspace
    return { text: `You have **${here.length}** ${cat} module${here.length === 1 ? '' : 's'}${here.length ? `: ${list(here.map((n) => `${n.name} \`${n.id}\``))}` : ''}.` };
  }
  if (generic && /\bhow many|count|number of\b/.test(q)) {
    return { text: `**${snap.nodeCount}** module${snap.nodeCount === 1 ? '' : 's'} and ${countText(snap.edgeCount, 'connection')} on the workspace${snap.byType.length ? `: ${snap.byType.map((b) => `${b.ids.length}× ${b.name}`).join(', ')}` : ''}.` };
  }
  return null;
}

function liveIntent(q: string, snap: Snapshot, mentions: ModuleMention[]): Reply | null {
  const live = /\b(my|the|this|current|right now|now|workspace|program|project|canvas|here|on screen)\b/.test(q) || /\b(running|active|going|ticking)\b/.test(q);
  // overview
  if (/\bshow me\b.*\b(workspace|canvas|everything|what i have)\b/.test(q) || /\b(overview|summary|summari[sz]e|status report|big picture|state of|tell me everything|what do i have|what s (in|on) (my|the|this)|what is (in|on) (my|the|this)|what s going on|what is going on|what s happening|what is happening|describe (my|the|this) (workspace|program|project|canvas)|inventory|snapshot|full report|brief me|catch me up|what have i built|what did i build)\b/.test(q) || /^(status|report|workspace|what s up|whats up|how s it going|how is it going)$/.test(q)) {
    return { text: overviewText(snap), chips: ['What timers are running?', 'Any problems?', snap.run === 'running' ? 'Pause' : 'Run'] };
  }
  // timers
  if (/\b(timers?|stopwatch(es)?|alarms?|countdowns?|clocks?|timekeeping|time keeping)\b/.test(q) && (live || /\b(how much|left|remaining|ringing|status|list|which|what)\b/.test(q)) && !/^(what is|what s|what does|explain|describe|how does|how do)\b.*\b(a|an)\b/.test(q) && !/\b(add|create|make)\b/.test(q)) {
    if (/\b(timer|stopwatch|alarm|clock|countdown)\b/.test(q) && /\b(what is|what s|what does|how does|how do i|explain)\b/.test(q) && !live) return null;
    return { text: timersText(snap), chips: snap.timers.length ? ['Overview', snap.run === 'running' ? 'Pause' : 'Run'] : ['Add a timer'] };
  }
  // what is running
  if (/\b(what s|what is|is|are|which|anything|any)\b.*\b(running|executing|active|happening|going on|working|live|alive)\b/.test(q) || /^(is it|is anything|is this) (running|on)\b/.test(q)) {
    const lines = [runStateText(snap)];
    if (snap.run !== 'stopped') {
      const active = snap.nodes.filter((n) => n.evals > 0 && !n.disabled);
      lines.push(`${countText(active.length, 'module')} of ${snap.nodeCount} ${active.length === 1 ? 'has' : 'have'} produced output so far; ${snap.evalsLastTick} ran on the last tick and the engine has ${countText(snap.pendingTimers, 'scheduled wake-up')} queued.`);
      const idle = snap.nodes.filter((n) => n.missing.length);
      if (idle.length) lines.push(`Waiting for input: ${idle.map((n) => `${n.name} \`${n.id}\``).join(', ')}.`);
      if (snap.timers.length) lines.push(timersText(snap));
      const sensors = snap.nodes.filter((n) => n.category === 'Sensor');
      if (sensors.length) lines.push(`Sensors: ${sensors.map((n) => `${n.name} \`${n.id}\` (${n.settings.find((s) => s.key === 'source')?.value ?? 'on'})`).join(', ')}.`);
    } else if (snap.nodeCount) lines.push(`${countText(snap.nodeCount, 'module')} ${snap.nodeCount === 1 ? 'is' : 'are'} on the workspace, ready to go.`);
    return { text: lines.join('\n'), chips: [snap.run === 'running' ? 'Pause' : 'Run', 'Overview'] };
  }
  // problems
  if (/\b(error|errors|warning|warnings|problem|problems|issue|issues|wrong|broken|diagnos\w*|bug|bugs|not working|doesn t work|isn t working|fail\w*|health|stuck|idle|why)\b/.test(q) && (live || /\b(any|are there|check|list|what)\b/.test(q)) && !/^(what is|what s a|what are) (an? )?(error|bug|warning)\b/.test(q)) {
    const ids = mentionedIds(q, snap);
    if (ids.length) {
      const n = snap.nodes.find((x) => x.id === ids[0])!;
      return { text: nodeText(n, snap) + (n.status || n.missing.length ? '' : '\nNothing looks wrong with it.') };
    }
    return { text: diagnosticsText(snap), chips: ['Overview'] };
  }
  // selection
  if (/\b(selected|selection|what am i (looking at|pointing at)|this module|this node|current(ly)? selected)\b/.test(q) && !/\b(delete|remove|disable|enable|set|change)\b/.test(q)) {
    if (!snap.selection.length) return { text: 'Nothing is selected. Click a module on the canvas and ask again.' };
    const nodes = snap.selection.map((id) => snap.nodes.find((n) => n.id === id)).filter(Boolean) as NodeInfo[];
    return { text: nodes.length === 1 ? nodeText(nodes[0], snap) : `${nodes.length} modules are selected: ${nodes.map((n) => `${n.name} \`${n.id}\``).join(', ')}.`, docs: nodes.length === 1 ? [{ label: `Docs: ${nodes[0].name}`, route: { k: 'node', type: nodes[0].type } }] : undefined };
  }
  // where
  const where = q.match(/\bwhere (is|s|are)\b/);
  if (where) {
    const t = resolveTargets(q, snap, mentions);
    if (t) { focusNodes(t.ids); return { text: `I've selected and centred ${t.label}. ${t.ids.map((i) => { const n = snap.nodes.find((x) => x.id === i)!; return `\`${i}\` is at (${Math.round(n.x)}, ${Math.round(n.y)})`; }).join('; ')}.` }; }
  }
  // projector / output values
  if (/\b(showing|display(ed|ing)?|reading|shows|outputting|output|value|values|emitting|saying)\b/.test(q) && (mentionedIds(q, snap).length || mentions.length)) {
    const t = resolveTargets(q, snap, mentions);
    if (t) {
      if (snap.run === 'stopped') return { text: 'The program is stopped, so nothing has a value yet. Press Run and ask again.', chips: ['Run'] };
      const lines = t.ids.slice(0, 8).map((id) => {
        const n = snap.nodes.find((x) => x.id === id)!;
        const p = snap.projectors.find((x) => x.id === id);
        if (p) return `- \`${id}\` is showing ${p.showing}${p.source ? ` (from ${p.source})` : ' (nothing is wired into it)'}`;
        const vals = n.outputs.filter((o) => o.value !== '—').slice(0, 5);
        return `- ${n.name} \`${id}\`: ${vals.length ? vals.map((o) => `${o.label} = ${o.value}`).join(', ') : 'no output yet'}`;
      });
      return { text: lines.join('\n') };
    }
  }
  // connections
  if (/\b(connected|wired|linked|hooked|feeds?|feeding|fed|connections?|wiring|wires)\b/.test(q) && /\b(what|which|how|show|list|who|tell)\b/.test(q)) {
    const t = resolveTargets(q, snap, mentions);
    if (t) return { text: t.ids.slice(0, 5).map((id) => { const n = snap.nodes.find((x) => x.id === id)!; return nodeText(n, snap).split('\n').filter((l) => /Fed by|Sends to/.test(l)).join('\n') || `${n.name} \`${id}\``; }).map((x, i) => `**${t.ids[i]}**\n${x}`).join('\n') };
    return { text: snap.edgeCount ? `There are ${snap.edgeCount} connections:\n${snap.nodes.flatMap((n) => n.sendsTo.map((s) => `- \`${n.id}\`.${s.label} → ${s.to.label}`)).slice(0, 25).join('\n')}` : 'Nothing is connected yet.' };
  }
  // a specific module on the canvas
  const ids = mentionedIds(q, snap);
  if (ids.length && /\b(what|tell|describe|about|explain|status|info|show|how|is|doing)\b/.test(q)) {
    return { text: ids.slice(0, 3).map((id) => nodeText(snap.nodes.find((n) => n.id === id)!, snap)).join('\n\n') };
  }
  // tick/time/speed
  if (/\b(tick|simulation time|sim time|elapsed|how long|uptime|speed|tick rate)\b/.test(q) && /\b(program|simulation|it|has|been|current|what|how)\b/.test(q) && !/\bhow (do|to|can)\b/.test(q)) {
    return { text: `${runStateText(snap)} Speed is ×${snap.speed}.` };
  }
  // saved / language / history
  if (/\b(saved|autosave|save state)\b/.test(q) && /\b(is|did|has|am)\b/.test(q)) return { text: snap.saveState === 'saved' ? 'Your work is saved in this browser.' : snap.saveState === 'unsaved' ? 'There are unsaved changes; autosave will catch up in a moment (or press Ctrl/⌘+S).' : 'This browser blocks storage, so changes are kept for this session only. Use File → Export program file to keep your work.' };
  if (/\b(undo|redo) (history|steps)\b/.test(q)) return { text: `${snap.history.undo} step(s) can be undone and ${snap.history.redo} redone.` };
  return null;
}

function undoIntent(q: string): Reply | null {
  const m = q.match(/^(undo|redo)( that| it| the last( change| step| action)?| last| the last one)?$/);
  if (!m) return null;
  const st = useStore.getState();
  if (m[1] === 'undo') { if (!st.past.length) return { text: 'There is nothing to undo.' }; st.undo(); return { text: 'Undone.', actions: ['Undid the last change.'], chips: ['Redo', 'Overview'] }; }
  if (!st.future.length) return { text: 'There is nothing to redo.' };
  st.redo();
  return { text: 'Redone.', actions: ['Redid the change.'] };
}

// ---- site knowledge --------------------------------------------------------------------------------------------

const SHORTCUTS = `**Keyboard shortcuts**
- Space: run / pause · . (period): step one tick · Esc: stop (or clear selection)
- Ctrl/⌘+Z / Shift+Z: undo / redo · Ctrl/⌘+S: save in browser
- Ctrl/⌘+D: duplicate · Ctrl/⌘+A: select all · Ctrl/⌘+G: group into a compound
- Delete / Backspace: remove selection · f: fit view · Shift+F: focus selection
- / : jump to the library search`;

const HOWTO: [RegExp, string, string[]?, Route?][] = [
  [/\b(connect|wire|link)\b.*\b(modules?|nodes?|pins?|ports?)\b|\bhow (do i|to|can i) (connect|wire)/, 'Drag from an **output pin** (bottom or right edge of a module) to a compatible **input pin** (top or left). While you drag, compatible pins light up and incompatible ones dim with a reason. An input accepts one source: wiring a new one replaces the old. Or just tell me: “connect timer-1 to projector-1”.', ['Connect two modules'], { k: 'article', id: 'connections' }],
  [/\b(add|place|create|insert)\b.*\b(modules?|nodes?)\b|\bhow (do i|to|can i) (add|place|create) (a |an )?(module|node)/, 'Open the library on the left and drag a module onto the workspace, or focus one and press Enter. Or ask me: “add a timer and a projector”. New modules appear near the centre of your view.', undefined, { k: 'article', id: 'first-program' }],
  [/\b(run|start|play)\b.*\b(program|simulation)\b|\bhow (do i|to|can i) (run|start)\b/, 'Press **Run** in the toolbar or hit **Space**. Space again pauses, **.** steps one tick, **Esc** stops and resets. I can do any of those: say “run”, “pause” or “stop”.', ['Run'], { k: 'article', id: 'execution' }],
  [/\b(save|saving)\b|\bautosave\b|\bexport\b|\bshare\b|\bimport\b/, 'Your program **autosaves** in this browser. Use **File → Export program file** for a .json copy, and **Share** for a compressed code beginning `NS1.` that anyone can paste into Import. Nothing is uploaded anywhere.', undefined, { k: 'article', id: 'saving-sharing' }],
  [/\b(setting pins?|setting pin)\b|\bdrive a setting\b/, 'Every setting of a module (numbers, choices, text, switches) also exists as an optional **setting pin**. While a signal arrives there it overrides the value from the inspector; disconnect it and the inspector value returns.', undefined, { k: 'article', id: 'setting-pins' }],
  [/\bcamera|microphone|mic\b.*\b(permission|allow|work|not)\b|\bpermission/, 'Sensors have a **simulated source** that needs no hardware. Switch a Vision or Hearing module’s Source to Camera/Microphone and the browser asks for permission. Allow it in the address bar if it was blocked.', undefined, { k: 'article', id: 'sensors-permissions' }],
  [/\b(compound|apparatus|group)\b.*\b(modules?|nodes?|create|make)\b|\bhow (do i|to) group\b/, 'Select several modules and press **Ctrl/⌘+G** (or use Group) to wrap them into a reusable **Apparatus** with its own inputs, outputs and exposed settings. You can save it to your library from the inspector.', undefined, { k: 'article', id: 'compounds' }],
  [/\b(language|translate|chinese|中文)\b/, 'Nicque speaks English, 简体中文 and 繁體中文. Change it in Settings, or drop a **Set Language** module on the workspace to switch language from a program.', ['Add a Set Language module']],
  [/\b(undo|redo)\b.*\b(how|where|work)\b|\bhow\b.*\b(undo|redo)\b/, 'Press **Ctrl/⌘+Z** to undo and **Ctrl/⌘+Shift+Z** (or Ctrl+Y) to redo. Everything I do for you is a normal edit, so it can be undone the same way.'],
];

function siteIntent(q: string, snap: Snapshot, mentions: ModuleMention[]): Reply | null {
  if (/\b(shortcut|shortcuts|hotkey|hotkeys|key bindings?|keyboard commands)\b/.test(q)) return { text: SHORTCUTS, docs: [{ label: 'Shortcuts reference', route: { k: 'article', id: 'shortcuts' } }] };
  if (/\b(what is|what s|tell me about|explain)\b.*\b(nicque|this (site|app|tool|editor|website|program))\b|^(about|about nicque|what is this)$/.test(q)) {
    return { text: ARTICLE_TEXT('welcome'), docs: [{ label: 'Welcome guide', route: { k: 'article', id: 'welcome' } }], chips: ['How do I build my first program?', 'List the module categories'] };
  }
  if (/\bfirst program\b|\bgetting started\b|\bget started\b|\btutorial\b|\bwhere (do i|should i) start\b|\bhow do i start\b|\bnew here\b|\bbeginner\b/.test(q)) {
    return { text: `A good first program is a light that reacts to sound: **Hearing → Threshold → Vital**. I can place it for you, say “build the loud light recipe”. Or by hand: drag the three modules in, wire Level → Threshold → Vital, then press Space.`, chips: ['Build the loud light recipe', 'Hello world'], docs: [{ label: 'Build your first program', route: { k: 'article', id: 'first-program' } }] };
  }
  // recipes list
  if (/\b(recipes?|cookbook|examples?|templates?)\b/.test(q) && /\b(what|which|list|show|available|are there|have)\b/.test(q) && !/\b(build|add|create|load)\b/.test(q)) {
    return { text: `The Cookbook has ${RECIPES.length} ready-made wirings:\n${RECIPES.map((r) => `- **${r.title}** (${r.level}): ${r.summary}`).join('\n')}\nSay “build <name>” and I'll put one on your workspace.`, chips: RECIPES.slice(0, 3).map((r) => `Build ${r.title}`), docs: [{ label: 'Open the Cookbook', route: { k: 'recipes' } }] };
  }
  // module catalogue
  if (/\b(modules?|nodes?|library|catalog(ue)?|categories|sections|kinds of)\b/.test(q) && /\b(what|which|list|show|available|are there|exist|have|types)\b/.test(q) && !mentions.length && !findCategory(q)) {
    const cats = [...new Set(MODULES.map((m) => m.category))];
    return { text: `Nicque has **${MODULES.length} modules** in ${cats.length} categories:\n${cats.map((c) => `- **${c}** (${modulesIn(c).length}): ${list(modulesIn(c).slice(0, 7).map((m) => m.name))}${modulesIn(c).length > 7 ? '…' : ''}`).join('\n')}`, chips: ['List the sensors', 'List timekeeping modules'], docs: [{ label: 'Node reference', route: { k: 'nodes' } }] };
  }
  const cat = findCategory(q);
  if (cat && /\b(what|which|list|show|available|are there|exist|tell|explain|describe|kinds|types)\b/.test(q) && !/\b(do i have|in my|in the workspace|on the workspace|on my)\b/.test(q)) {
    const mods = modulesIn(cat);
    return { text: `**${cat}** (${mods.length} modules):\n${mods.slice(0, 30).map((m) => `- **${m.name}**: ${m.doc.summary}`).join('\n')}${mods.length > 30 ? `\n…and ${mods.length - 30} more, see the library.` : ''}`, chips: mods.slice(0, 2).map((m) => `Add a ${m.name}`) };
  }
  // how-to
  for (const [re, text, chips, route] of HOWTO) if (re.test(q) && /\b(how|where|what|can i|do i|help|explain|tell)\b/.test(q)) return { text, chips, docs: route ? [{ label: 'Read more in the docs', route }] : undefined };

  // module knowledge
  const m = mentions[0];
  if (m) {
    const have = idsOfType(snap, m.def.type);
    const extra = have.length ? `\nYou have ${have.length} in your workspace: ${nodesLine(snap, have)}.` : '';
    const docs = [{ label: `Docs: ${m.def.name}`, route: { k: 'node', type: m.def.type } as Route }];
    if (/\b(pins?|ports?|inputs?|outputs?)\b/.test(q)) return { text: describePins(m.def) + extra, docs };
    if (/\b(settings?|options?|parameters?|configure|config|properties|knobs?|customi[sz]e|can i (change|set|tweak))\b/.test(q)) {
      const full = /\ball\b/.test(q);
      const ps = settingsOf(m.def).filter((p) => p.kind !== 'action');
      const one = ps.find((p) => q.includes(norm(p.label)) && norm(p.label).length > 3);
      if (one && !full) return { text: `**${m.def.name} › ${one.label}**: ${describeParam(one)}. ${one.doc}`, docs };
      return { text: ps.length ? `**${m.def.name}** settings:\n${ps.map((p) => `- **${p.label}** (${describeParam(p)}): ${p.doc}`).join('\n')}${extra}` : `${m.def.name} has no settings.`, docs, chips: [`Add a ${m.def.name}`] };
    }
    if (/\b(what|how|why|explain|describe|tell|about|does|do)\b/.test(q) || q.split(' ').length <= 3) {
      return { text: describeModule(m.def, { full: /\b(everything|full|detail|detailed|in depth|examples?|ideas)\b/.test(q) }) + extra, docs, chips: [`Add a ${m.def.name}`, `Pins of ${m.def.name}`, `All settings of ${m.def.name}`] };
    }
  }
  return null;
}

function goalIntent(q: string): Reply | null {
  const m = q.match(/\b(?:which|what) (?:node|module|nodes|modules)s?\b.*?\b(?:use|for|to|that)\b\s*(.*)$/) ?? q.match(/\bi (?:want|need|would like|d like) to (.+)$/) ?? q.match(/\bhow (?:do|can|could) i (?:make|get|build|do|create) (?:a |an |the )?(.+)$/);
  if (!m) return null;
  const want = (m[1] ?? '').replace(/^((a|an|the|use|for|to|i)\s+)+/, '').trim();
  if (want.length < 3) return null;
  const hits = docSearch(want, 8);
  const nodes = hits.filter((h) => h.entry.kind === 'Node').slice(0, 3);
  const goal = hits.find((h) => h.entry.kind === 'Goal');
  const recipe = hits.find((h) => h.entry.kind === 'Recipe');
  if (!nodes.length && !goal && !recipe) return null;
  const lines = [`For “${want}” I'd look at:`];
  if (goal) lines.push(`- ${goal.entry.title.replace(/^I want to: /, 'Goal: ')}: ${goal.entry.body.slice(0, 200)}`);
  for (const n of nodes) lines.push(`- **${n.entry.title}**: ${n.entry.body.split('. ')[0]}.`);
  if (recipe) lines.push(`- Cookbook: **${recipe.entry.title}**`);
  return {
    text: lines.join('\n'),
    chips: [...nodes.slice(0, 2).map((n) => `Add a ${n.entry.title}`), ...(recipe ? [`Build ${recipe.entry.title}`] : [])],
    docs: [...nodes.slice(0, 2).map((n) => ({ label: n.entry.title, route: n.entry.route })), ...(recipe ? [{ label: recipe.entry.title, route: recipe.entry.route }] : [])],
  };
}

function ARTICLE_TEXT(id: string): string {
  const a = ARTICLE_BY_ID.get(id);
  if (!a) return '';
  const first = a.blocks.find((b) => b.t === 'p') as { x: string } | undefined;
  return `${plain(first?.x ?? a.summary)}\n${a.summary}`;
}

// ---- general: maths, time, FAQ, search -------------------------------------------------------------------------

function mathIntent(raw: string): Reply | null {
  let s = raw.toLowerCase().replace(/^(hey |hi |ok |please |gosling[, ]*)+/, '').replace(/^(what is|what s|what's|whats|calculate|calc|compute|solve|evaluate|how much is|work out|tell me)\s+/, '').replace(/[?=]+\s*$/, '').trim();
  const pct = s.match(/^(\d+(?:\.\d+)?)\s*%\s*of\s*(\d+(?:\.\d+)?)$/);
  if (pct) return { text: `${pct[1]}% of ${pct[2]} = **${Number((Number(pct[1]) * Number(pct[2]) / 100).toPrecision(12))}**` };
  s = s.replace(/\bplus\b/g, '+').replace(/\bminus\b/g, '-').replace(/\b(times|multiplied by)\b/g, '*').replace(/\b(divided by|over)\b/g, '/').replace(/\bto the power of\b/g, '^').replace(/\bsquared\b/g, '^2').replace(/\bcubed\b/g, '^3').replace(/\bsquare root of\s*(\([^)]+\)|-?\d+(?:\.\d+)?)/g, 'sqrt($1)').replace(/\bsquare root of\b/g, 'sqrt').replace(/×/g, '*').replace(/÷/g, '/').replace(/(\d)\s*x\s*(?=\d)/g, '$1*').replace(/,(?=\d{3}\b)/g, '').replace(/\bmod(ulo)?\b/g, '%');
  if (!/\d/.test(s) || !/^[\d\s+\-*/^().%,a-z]+$/.test(s)) return null;
  if (!/[+\-*/^%]|sqrt|sin|cos|tan|log|ln|exp|abs|pow/.test(s)) return null;
  if (/[a-z]{3,}/.test(s.replace(/sqrt|sin|cos|tan|asin|acos|atan|log10|log2|log|ln|exp|abs|pow|floor|ceil|round|min|max|pi|tau|phi/g, ''))) return null;
  const c = compileExpr(s);
  if (!c.ok) return null;
  const v = c.fn({ x: 0, t: 0 });
  if (!Number.isFinite(v)) return { text: 'That doesn’t come out as a finite number (division by zero, perhaps).' };
  return { text: `${s.replace(/\*/g, '×').replace(/\//g, '÷')} = **${Number(v.toPrecision(12))}**` };
}

function clockIntent(q: string): Reply | null {
  if (/\bwhat (time|day|date|year|month) is it\b|\bwhat s (the )?(time|date|day)\b|\bwhat is (the )?(time|date|today)\b|^(time|date|today)$|\bwhat day is (it|today)\b|\bcurrent (time|date)\b/.test(q) && !/\b(timer|alarm|stopwatch|zone)\b/.test(q)) {
    const d = new Date();
    return { text: `It's **${d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}** on ${d.toLocaleDateString([], { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })} (${Intl.DateTimeFormat().resolvedOptions().timeZone}). For other cities, add a **World Clock** module.`, chips: ['Add a World Clock'] };
  }
  return null;
}

function smallTalk(q: string): Reply | null {
  if (/^(hi|hello|hey|yo|howdy|hiya|good (morning|afternoon|evening)|sup|greetings|hey gosling|hi gosling|hello gosling)\b/.test(q) && q.split(' ').length <= 4 && !/hello world/.test(q)) {
    const s = takeSnapshot();
    return { text: `${pick(['Hello!', 'Hey there!', 'Hi!'])} I'm Gosling. ${s.nodeCount ? `I can see ${countText(s.nodeCount, 'module')} on **${s.program.name}** right now, and the program is ${s.run}.` : 'The workspace is empty. Tell me what to build and I will place it.'} What shall we do?`, chips: s.nodeCount ? ['Overview', 'What timers are running?', 'Any problems?'] : ['Add a timer and a projector, connected', 'What can you do?'] };
  }
  if (/^(thanks|thank you|thx|ty|cheers|great|awesome|nice|perfect|cool|good job|well done|brilliant)\b/.test(q)) return { text: pick(['Any time!', 'Happy to help. 🙂', 'You got it.', 'Glad that worked.']), chips: ['Overview', 'Run'] };
  if (/^(bye|goodbye|see you|cya|good night|later)\b/.test(q)) return { text: 'See you! I’ll be right here in the corner.' };
  if (/^(yes|yep|yeah|sure|ok|okay|no|nope|nah)$/.test(q)) return { text: 'Okay. Tell me what you’d like next, or ask “what can you do?”.' };
  if (/\bjoke\b|\bmake me laugh\b|\bfunny\b/.test(q)) return { text: pick(JOKES) };
  if (/\bhow are you\b|\bhow s it going\b/.test(q)) return { text: 'Running smoothly, no exceptions thrown. How’s your workspace?', chips: ['Overview'] };
  if (IDENTITY.test(q)) {
    return { text: `I'm **Gosling**, the copilot built into Nicque, named after James Gosling, the creator of Java. I can see your workspace live (what's running, timers, how many of each module, errors, values), explain any module or setting, and **build for you**: add modules, wire them, change settings, start and stop the program.\nOut of the box I run entirely in your browser using rules and the site's own docs. For open-ended questions beyond Nicque, connect a language model in my settings (the gear above).`, chips: ['What can you do?', 'Overview'] };
  }
  if (HELP.test(q)) return { text: HELP_TEXT, chips: ['Overview', 'Add a timer and a projector, connected', 'Keyboard shortcuts'] };
  return null;
}

function faqIntent(q: string): Reply | null {
  for (const f of FAQ) if (f.re.test(q)) return { text: f.a, chips: f.chips };
  return null;
}

function searchFallback(q: string, raw: string): Reply {
  const hits = docSearch(q, 4).filter((h) => h.score >= 20);
  if (hits.length) {
    const top = hits[0].entry;
    const body = top.body.length > 360 ? top.body.slice(0, 360).replace(/\s+\S*$/, '') + '…' : top.body;
    return {
      text: `Here's the closest thing I know about “${raw.trim().slice(0, 60)}”:\n**${top.title}** (${top.kind}${top.sub ? ' · ' + top.sub : ''})\n${body}${hits.length > 1 ? `\nAlso related: ${hits.slice(1).map((h) => `${h.entry.title}`).join('; ')}.` : ''}`,
      docs: hits.slice(0, 3).map((h) => ({ label: h.entry.title, route: h.entry.route })),
    };
  }
  return {
    text: `I couldn't match “${raw.trim().slice(0, 80)}” to anything in Nicque or my built-in knowledge, and I'm running offline, so I can't look it up.\nI **can** answer anything about your workspace and Nicque's modules, and build things for you. For open-ended questions, connect a language model in my settings (gear icon above).`,
    chips: ['What can you do?', 'Overview'],
  };
}

// ---- entry point -----------------------------------------------------------------------------------------------

export function respond(input: string, pending?: Pending | null): Reply {
  const raw = input.trim();
  const q0 = norm(raw.replace(/["“”][^"“”]*["“”]/g, ' '));
  if (pending) {
    if (/^(yes|yep|yeah|sure|do it|confirm|ok|okay|go ahead|y|yes clear it|yes please)\b/.test(q0)) return pending.run();
    if (/^(no|nope|cancel|stop|don t|never ?mind|no keep it|n)\b/.test(q0)) return { text: 'Okay, leaving everything as it is.' };
  }
  if (!q0) return { text: 'Ask me anything about your workspace, or tell me what to build.' };
  const q = clean(q0.replace(/\bset up\b/g, 'create')).replace(/^add\b/, 'create');
  const snap = takeSnapshot();
  const mentions = findModules(q);

  const tries: (() => Reply | null)[] = [
    () => smallTalk(q),
    () => runControl(q),
    () => undoIntent(q),
    () => connectThem(q, snap),
    () => removeIntent(q, snap, mentions),
    () => enableIntent(q, snap, mentions),
    () => connectIntent(raw, q, snap, mentions),
    () => settingIntent(raw, q, snap, mentions),
    () => (/^(how|what is the best way|where) (do|can|should|would|to)\b/.test(q) && !/\b(do i have|are there)\b/.test(q) ? siteIntent(q, snap, mentions) : null),
    () => planIntent(raw, q, mentions),
    () => createIntent(raw, q, mentions),
    () => checkIntent(q, snap),
    () => countIntent(q, snap, mentions),
    () => clockIntent(q),
    () => faqIntent(q),
    () => mathIntent(raw),
    () => liveIntent(q, snap, mentions),
    () => goalIntent(q),
    () => siteIntent(q, snap, mentions),
  ];
  for (const t of tries) {
    const r = t();
    if (r) return r;
  }
  return searchFallback(q, raw);
}

export const _internal = { durationSeconds, parseSettings, singular, fmtValue, getDef, typeName };
