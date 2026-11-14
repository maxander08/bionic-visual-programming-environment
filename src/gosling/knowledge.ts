// Gosling's knowledge of the site: the module catalogue, its settings and pins, and the documentation index.
// Everything here is derived from the same registry the editor uses, so it can never drift out of date.
import { MODULES, paramDefsOf, defaultParams } from '../core/registry';
import type { ModuleDef, ParamDef, Params } from '../core/types';
import { fmtNum } from '../core/util';
import { RECIPES } from '../ui/docs/recipes';
import { search, tokenize } from '../ui/docs/search';
import { GUIDE } from '../ui/docs/nodeGuide';
import { plain } from '../ui/docs/markup';

export const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9.\- ]+/g, ' ').replace(/\s+/g, ' ').trim();

/** Crude singular form, enough to make “projectors”, “switches”, “keys” and “quantities” meet their names. */
export function singular(w: string): string {
  if (w.length > 4 && w.endsWith('ies')) return w.slice(0, -3) + 'y';
  if (w.length > 4 && /(ches|shes|xes|sses)$/.test(w)) return w.slice(0, -2);
  if (w.length > 3 && w.endsWith('s') && !w.endsWith('ss') && !w.endsWith('us')) return w.slice(0, -1);
  return w;
}
const sing = (s: string) => norm(s).split(' ').map(singular).join(' ');

/** Extra names people use for modules. */
const ALIASES: Record<string, string[]> = {
  timer: ['countdown', 'count down', 'egg timer'],
  stopwatch: ['stop watch', 'chronometer'],
  alarm: ['alarm clock'],
  clock: ['world clock', 'time zone clock', 'clock'],
  projector: ['screen', 'big display', 'display screen', 'readout'],
  meter: ['graph', 'plot', 'plotter', 'scope', 'chart', 'meter display'],
  notify: ['notification', 'notifier', 'alert'],
  light: ['lamp', 'led'],
  vital: ['indicator', 'indicator light'],
  hearing: ['microphone', 'mic', 'audio sensor', 'sound sensor', 'auditory sensor'],
  vision: ['camera', 'visual sensor', 'eye'],
  switch: ['toggle', 'button', 'on off switch'],
  keys: ['keyboard', 'key press'],
  add: ['adder'],
  sub: ['subtractor'],
  mul: ['multiplier'],
  div: ['divisor', 'divider'],
  relay: ['gate', 'logic gate'],
  random: ['random number', 'dice', 'rng'],
  constant: ['fixed number', 'constant number'],
  pulse: ['metronome', 'ticker', 'heartbeat', 'oscillator'],
  wave: ['sine wave', 'waveform', 'signal generator'],
  integer: ['int', 'whole number'],
  decimal: ['float', 'decimal number'],
  string: ['text value', 'string value'],
  comment: ['note', 'annotation', 'sticky note'],
  text: ['text display', 'label'],
  setlanguage: ['language switcher', 'set language'],
  decision: ['chooser', 'selector'],
};

interface NameEntry { def: ModuleDef; weight: number }
let nameIndex: Map<string, NameEntry> | null = null;
function names(): Map<string, NameEntry> {
  if (nameIndex) return nameIndex;
  const m = new Map<string, NameEntry>();
  const put = (k: string, def: ModuleDef, weight: number) => {
    const key = sing(k);
    if (!key) return;
    const had = m.get(key);
    if (!had || had.weight < weight) m.set(key, { def, weight });
  };
  for (const d of MODULES) {
    put(d.name, d, 5);
    if (!['add', 'sub', 'mul', 'div'].includes(d.type)) put(d.type, d, 4); // “add” is a verb before it is a module
    put(d.caption, d, 3);
    for (const a of ALIASES[d.type] ?? []) put(a, d, 2);
  }
  return (nameIndex = m);
}

export interface ModuleMention { def: ModuleDef; start: number; end: number; phrase: string }

/** Every module named in a sentence, longest names first, left to right. */
export function findModules(text: string): ModuleMention[] {
  const toks = norm(text).split(' ').filter(Boolean);
  const idx = names();
  const used = new Array(toks.length).fill(false);
  const found: ModuleMention[] = [];
  for (let n = 4; n >= 1; n--) {
    for (let i = 0; i + n <= toks.length; i++) {
      if (used.slice(i, i + n).some(Boolean)) continue;
      const key = toks.slice(i, i + n).map(singular).join(' ');
      const hit = idx.get(key);
      if (hit) {
        for (let j = i; j < i + n; j++) used[j] = true;
        found.push({ def: hit.def, start: i, end: i + n, phrase: toks.slice(i, i + n).join(' ') });
      }
    }
  }
  return found.sort((a, b) => a.start - b.start);
}

export const moduleByType = (type: string) => MODULES.find((m) => m.type === type);

// ---- categories ------------------------------------------------------------------------------------------------

const CATEGORY_WORDS: Record<string, string> = {
  sensor: 'Sensor', nucleus: 'Nucleus', nuclei: 'Nucleus', behavior: 'Behavior', behaviour: 'Behavior', 'base data': 'Base Data', 'data type': 'Base Data',
  timekeeping: 'Timekeeping', 'time keeping': 'Timekeeping', quantity: 'Quantities', quantities: 'Quantities', file: 'Files', actor: 'Actors',
  'info module': 'Info', 'workspace setting': 'Workspace Settings', 'math node': 'Node', 'plumbing node': 'Node',
};
export function findCategory(text: string): string | null {
  const s = ' ' + sing(text) + ' ';
  for (const [w, c] of Object.entries(CATEGORY_WORDS)) if (s.includes(' ' + sing(w) + ' ')) return c;
  return null;
}
export const modulesIn = (category: string) => MODULES.filter((m) => m.category === category);

// ---- settings --------------------------------------------------------------------------------------------------

export function describeParam(p: ParamDef): string {
  if (p.kind === 'number') return `number ${fmtNum(p.min)}–${fmtNum(p.max)}${p.unit ? ' ' + p.unit : ''}, default ${fmtNum(p.default)}`;
  if (p.kind === 'select') return `choice of ${p.options.map((o) => o.value).join(' / ')}, default ${p.default}`;
  if (p.kind === 'bool') return `on/off, default ${p.default ? 'on' : 'off'}`;
  if (p.kind === 'text') return 'text';
  return 'button';
}

export function settingsOf(def: ModuleDef, params?: Params): ParamDef[] {
  return paramDefsOf(def, params ?? defaultParams(def)).filter((p) => p.kind === 'action' || !p.hidden);
}

const yes = new Set(['on', 'true', 'yes', 'enable', 'enabled', '1', 'y']);
const no = new Set(['off', 'false', 'no', 'disable', 'disabled', '0', 'n']);

const TIME_UNITS: [RegExp, number][] = [[/^(ms|millisecond)s?$/, 0.001], [/^(s|sec|secs|second)s?$/, 1], [/^(m|min|mins|minute)s?$/, 60], [/^(h|hr|hrs|hour)s?$/, 3600]];

/** Turn what a person typed into a value the setting accepts. */
export function coerceParam(p: ParamDef, raw: unknown): { ok: true; value: unknown } | { ok: false; why: string } {
  if (p.kind === 'action') return { ok: false, why: `“${p.label}” is a button, not a setting.` };
  if (p.kind === 'number') {
    if (typeof raw === 'number') return Number.isFinite(raw) ? { ok: true, value: raw } : { ok: false, why: `“${p.label}” needs a number.` };
    const s = String(raw).trim().toLowerCase();
    const m = s.match(/^(-?\d*\.?\d+(?:e[-+]?\d+)?)\s*([a-z%°]*)$/);
    if (!m) return { ok: false, why: `“${p.label}” needs a number (I got “${String(raw)}”).` };
    let v = Number(m[1]);
    if (m[2] && p.unit === 's') for (const [re, f] of TIME_UNITS) if (re.test(m[2])) { v *= f; break; }
    return { ok: true, value: v };
  }
  if (p.kind === 'bool') {
    if (typeof raw === 'boolean') return { ok: true, value: raw };
    const s = String(raw).trim().toLowerCase();
    if (yes.has(s)) return { ok: true, value: true };
    if (no.has(s)) return { ok: true, value: false };
    return { ok: false, why: `“${p.label}” is on or off (I got “${String(raw)}”).` };
  }
  if (p.kind === 'select') {
    const s = norm(String(raw));
    const o = p.options.find((x) => norm(x.value) === s) ?? p.options.find((x) => norm(x.label) === s) ?? p.options.find((x) => norm(x.label).startsWith(s) && s.length >= 2) ?? p.options.find((x) => norm(x.label).includes(s) && s.length >= 3);
    return o ? { ok: true, value: o.value } : { ok: false, why: `“${p.label}” must be one of: ${p.options.map((x) => x.value).join(', ')}.` };
  }
  return { ok: true, value: String(raw) };
}

/** Find a setting of a module by its label or key (“duration”, “Show milliseconds”, “format”). */
export function findParam(def: ModuleDef, name: string, params?: Params): ParamDef | undefined {
  const n = sing(name);
  const list = settingsOf(def, params).filter((p) => p.kind !== 'action');
  return list.find((p) => sing(p.key) === n) ?? list.find((p) => sing(p.label) === n) ?? list.find((p) => sing(p.label).includes(n) && n.length >= 3) ?? list.find((p) => n.includes(sing(p.label)) && sing(p.label).length >= 4);
}

/** Map {label or key: value} onto a module's settings. Reports what it could not use. */
export function resolveSettings(def: ModuleDef, raw: Record<string, unknown>, params?: Params): { params: Params; notes: string[] } {
  const out: Params = {};
  const notes: string[] = [];
  for (const [k, v] of Object.entries(raw)) {
    const p = findParam(def, k, params);
    if (!p) { notes.push(`${def.name} has no setting called “${k}”.`); continue; }
    const c = coerceParam(p, v);
    if (c.ok) out[p.key] = c.value; else notes.push(c.why);
  }
  return { params: out, notes };
}

// ---- describing a module ---------------------------------------------------------------------------------------

export function describeModule(def: ModuleDef, opts: { full?: boolean } = {}): string {
  const g = GUIDE[def.type];
  const lines: string[] = [];
  lines.push(`**${def.name}** (${def.caption}) is a ${def.category} module. ${def.doc.summary}`);
  if (g?.when) lines.push(`Use it when: ${plain(g.when)}`);
  lines.push(`**How it behaves:** ${plain(def.doc.runtime)}`);
  const ins = def.inputs.map((p) => `${p.label}${p.optional ? ' (optional)' : ''}`);
  const outs = def.outputs.map((p) => p.label);
  lines.push(`**Inputs:** ${ins.length ? ins.join(', ') : 'none'}`);
  lines.push(`**Outputs:** ${outs.length ? outs.join(', ') : 'none'}`);
  const ps = settingsOf(def).filter((p) => p.kind !== 'action');
  if (ps.length) {
    lines.push(`**Settings:**`);
    for (const p of ps.slice(0, opts.full ? 40 : 8)) lines.push(`- ${p.label}: ${describeParam(p)}. ${p.doc}`);
    if (ps.length > 8 && !opts.full) lines.push(`- …and ${ps.length - 8} more. Ask for “all settings of ${def.name}”.`);
  }
  if (opts.full && def.doc.examples?.length) lines.push(`**Ideas:**\n${def.doc.examples.map((e) => `- ${e}`).join('\n')}`);
  if (opts.full && def.doc.errors?.length) lines.push(`**Watch out for:**\n${def.doc.errors.map((e) => `- ${e}`).join('\n')}`);
  return lines.join('\n');
}

export function describePins(def: ModuleDef): string {
  const row = (p: { label: string; type: string; doc: string; optional?: boolean }) => `- **${p.label}** (${p.type}${p.optional ? ', optional' : ''}): ${p.doc}`;
  return `**${def.name}** pins\n**Inputs**\n${def.inputs.length ? def.inputs.map(row).join('\n') : '- none'}\n**Outputs**\n${def.outputs.length ? def.outputs.map(row).join('\n') : '- none'}\nEvery setting also has its own setting pin on the left or top edge.`;
}

// ---- documentation lookup --------------------------------------------------------------------------------------

export function docSearch(q: string, limit = 4) {
  const hits = search(q, 'All');
  const seen = new Set<string>();
  const out: typeof hits = [];
  for (const h of hits) {
    const key = h.entry.kind + h.entry.title;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(h);
    if (out.length >= limit) break;
  }
  return out;
}

export function findRecipe(q: string) {
  const toks = tokenize(q).filter((t) => t.length > 2);
  if (!toks.length) return null;
  let best: { r: (typeof RECIPES)[number]; score: number } | null = null;
  for (const r of RECIPES) {
    const hay = `${r.title} ${r.tags} ${r.summary}`.toLowerCase();
    const title = r.title.toLowerCase();
    let score = 0;
    for (const t of toks) score += title.includes(t) ? 3 : hay.includes(t) ? 1 : 0;
    if (score >= 4 && (!best || score > best.score)) best = { r, score };
  }
  return best?.r ?? null;
}

/** One compact line per module, for the optional language model. */
export function catalogueForModel(): string {
  return MODULES.map((m) => {
    const ins = m.inputs.map((p) => p.id).join(',');
    const outs = m.outputs.map((p) => p.id).join(',');
    const ps = settingsOf(m).filter((p) => p.kind !== 'action').map((p) => `${p.key}${p.kind === 'select' ? `{${p.options.map((o) => o.value).join('|')}}` : p.kind === 'number' ? `[${fmtNum(p.min)}..${fmtNum(p.max)}]` : p.kind === 'bool' ? '(bool)' : '(text)'}`).join(',');
    return `${m.type} | ${m.name} | ${m.category} | ${m.doc.summary} | in: ${ins || '-'} | out: ${outs || '-'} | settings: ${ps || '-'}`;
  }).join('\n');
}
