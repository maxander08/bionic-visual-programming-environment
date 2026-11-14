import type { CompoundDef, ModuleDef, ParamDef, Params, PortDef, PortType, NodeInst, Side } from './types';
import { GRID, SIZES } from './types';
import { sensors } from './modules/sensors';
import { nuclei } from './modules/nuclei';
import { nodes } from './modules/nodes';
import { baseData } from './modules/basedata';
import { behaviors } from './modules/behavior';
import { timekeeping } from './modules/timekeeping';
import { quantities } from './modules/quantities';
import { files } from './modules/files';
import { actors } from './modules/actors';
import { workspace } from './modules/workspace';
import { getLang, tr } from '../i18n';
import { localizeDef } from './localize';
import { txt } from './modules/kit';
import { clamp, fmtNum } from './util';

const info: ModuleDef[] = [
  {
    type: 'comment', name: 'Comment', caption: 'Comment', category: 'Info', family: 'info', glyph: '//', size: 'small', keywords: 'note annotation text label',
    title: () => '//', inputs: [], outputs: [], params: [txt('text', 'Note', 'Note to self', 'Free text shown on the workspace. It has no effect on execution.', { multiline: true, maxLength: 500 })],
    run() {},
    doc: { summary: 'An annotation. It never takes part in execution.', runtime: 'None. Long notes wrap and are clipped inside the node; the full text is in the inspector.' },
  },
  {
    type: 'by', name: 'By', caption: 'Biomark', category: 'Info', family: 'info', glyph: 'BY', size: 'chip', keywords: 'author signature credit owner',
    chip: (p) => String(p.author || '—'), inputs: [], outputs: [], params: [txt('author', 'Author', 'anonymous', 'Credit shown on the program. It is a label, not a verified identity.', { maxLength: 60 })],
    run() {},
    doc: { summary: 'Credits an author on the workspace.', runtime: 'None. This is plain text: it is not a signature and does not prove who made the program.' },
  },
];

const compoundShell: ModuleDef = {
  type: 'compound', name: 'Apparatus', caption: 'Compound', category: 'Nucleus', family: 'apparatus', glyph: 'grid', size: 'square',
  inputs: [], outputs: [], params: [], run() {},
  doc: { summary: 'A reusable subsystem: a group of modules wrapped with defined inputs, outputs and exposed settings.', runtime: 'At run time the compound is expanded into its inner modules. Open it to inspect the inner graph.' },
};

export const MODULES: ModuleDef[] = [...sensors, ...nuclei, ...behaviors, ...nodes, ...baseData, ...timekeeping, ...quantities, ...files, ...actors, ...info, ...workspace];
const BY_TYPE = new Map(MODULES.map((m) => [m.type, m]));
/** Library view: the modules with their text in the current language. */
export const localizedModules = (): ModuleDef[] => MODULES.map(localizeDef);
export const CATEGORIES = ['Sensor', 'Nucleus', 'Behavior', 'Node', 'Base Data', 'Timekeeping', 'Quantities', 'Files', 'Actors', 'Info', 'Workspace Settings'] as const;

// ---- setting pins -------------------------------------------------------------------------------------------
// Every setting of a module (number, choice, text, switch) also exists as an optional input pin. While a signal
// arrives on that pin it replaces the value chosen in the inspector; disconnect it and the inspector value is back.
// Pins are derived from the parameter schema, so a new parameter gets its pin for free.

export const SETTING_PREFIX = 'p:';
export const isSettingPort = (id: string) => id.startsWith(SETTING_PREFIX);
/** Minimum distance between neighbouring pins on one edge, in world pixels (a pin is 12 px long, hit radius is 10). */
export const PIN_SPACING = 24;
/** A node edge holding n pins needs (n + 1) × PIN_SPACING of length; a lone pin sits in the middle of any edge. */
const edgeNeed = (n: number) => (n <= 1 ? 0 : Math.ceil(((n + 1) * PIN_SPACING) / GRID) * GRID);

const PIN_TYPE: Record<'number' | 'select' | 'text' | 'bool', PortType> = { number: 'num', select: 'text', text: 'text', bool: 'bool' };

const joinText = (...parts: string[]) => parts.filter(Boolean).join(getLang() === 'en' ? ' ' : '');

function settingPin(p: ParamDef): PortDef | null {
  if (p.kind === 'action' || p.hidden || p.pin === false) return null;
  const hint =
    p.kind === 'number' ? tr('Number from {min} to {max}{unit}; values outside are clamped.', { min: fmtNum(p.min), max: fmtNum(p.max), unit: p.unit ? ' ' + p.unit : '' })
    : p.kind === 'bool' ? tr('True or false.')
    : p.kind === 'select' ? tr('Text, one of: {list}.', { list: p.options.map((o) => o.value).join(', ') })
    : '';
  return {
    id: SETTING_PREFIX + p.key, label: p.label, type: PIN_TYPE[p.kind], optional: true, param: p.key,
    doc: joinText(tr('Setting “{label}”. While connected, its signal replaces the value set in the inspector.', { label: p.label }), p.doc, hint),
  };
}

/** Append setting pins to a module and size the node so that no edge is crowded. */
function placeSettingPins(def: ModuleDef, params: ParamDef[]): ModuleDef {
  const withPin = params.filter((q) => settingPin(q));
  const pins = withPin.map((q) => settingPin(q)!);
  if (!pins.length) return def;
  const base = SIZES[def.size];
  const chip = def.size === 'chip';
  const cin: Record<Side, number> = { top: 0, bottom: 0, left: 0, right: 0 };
  const cout: Record<Side, number> = { top: 0, bottom: 0, left: 0, right: 0 };
  def.inputs.forEach((q) => cin[portSide(q, 'in')]++);
  def.outputs.forEach((q) => cout[portSide(q, 'out')]++);
  const len = (s: Side) => (s === 'top' || s === 'bottom' ? base.w : base.h);
  const cost = (s: Side) => Math.max(0, edgeNeed(cin[s] + 1) - len(s));
  // Settings go on the left (the "auxiliary input" edge) and spill onto the top edge. Chips are one row tall, so they
  // use the top edge first. A side is only grown when neither side can take the pin within the tolerance.
  const order: Side[] = chip ? ['top', 'left'] : ['left', 'top'];
  const tol = chip ? 0 : GRID;
  const placed = pins.map((pin, i) => {
    const forced = withPin[i].pinSide;
    let side = forced ?? order.find((s) => cost(s) <= tol);
    if (!side) side = order.reduce((a, b) => (cost(b) < cost(a) ? b : a));
    cin[side]++;
    return { ...pin, side };
  });
  const need = (s: Side) => Math.max(edgeNeed(cin[s]), edgeNeed(cout[s]));
  return {
    ...def,
    inputs: [...def.inputs, ...placed],
    paramPins: placed,
    dim: { w: Math.max(base.w, need('top'), need('bottom')), h: Math.max(base.h, need('left'), need('right')) },
  };
}

const settingCache = new WeakMap<ModuleDef, Map<string, ModuleDef>>();
function withSettingPins(def: ModuleDef, params: ParamDef[]): ModuleDef {
  // Modules whose choices depend on other settings (the Actors) list the choices in the key, so each variant keeps its own pin hints.
  const sig = params.map((p) => (def.dynamicParams && p.kind === 'select' ? `${p.key}:${p.options.map((o) => o.value).join(',')}` : p.key)).join('|');
  let m = settingCache.get(def);
  if (!m) settingCache.set(def, (m = new Map()));
  let d = m.get(sig);
  if (!d) m.set(sig, (d = placeSettingPins(def, params)));
  return d;
}

const compoundCache = new WeakMap<CompoundDef, { lang: string; def: ModuleDef }>();

export function compoundModuleDef(cd: CompoundDef): ModuleDef {
  const hit = compoundCache.get(cd);
  if (hit && hit.lang === getLang()) return hit.def;
  const raw = rawCompoundDef(cd);
  const def = placeSettingPins(raw, raw.params);
  compoundCache.set(cd, { lang: getLang(), def });
  return def;
}

function rawCompoundDef(cd: CompoundDef): ModuleDef {
  const exposed: ParamDef[] = [];
  for (const e of cd.exposed) {
    const inner = cd.graph.nodes[e.nodeId];
    const idef = inner && BY_TYPE.get(inner.type);
    const pd = idef && paramDefsOf(idef, inner.params).find((p) => p.key === e.param);
    if (pd) exposed.push({ ...pd, key: e.key, label: e.label || pd.label, default: inner.params[e.param] ?? (pd as any).default } as ParamDef);
  }
  return {
    ...compoundShell,
    name: cd.name,
    title: () => cd.name,
    inputs: cd.inputs.map((p) => ({ id: p.id, label: p.label, type: p.type, side: 'top' as Side, doc: `Feeds ${p.label} inside the compound.`, optional: true })),
    outputs: cd.outputs.map((p, i) => ({ id: p.id, label: p.label, type: p.type, side: (i === 0 ? 'bottom' : 'right') as Side, doc: `Output ${p.label} of the compound.` })),
    params: exposed,
    doc: { ...compoundShell.doc, summary: cd.description || compoundShell.doc.summary },
  };
}

export function getDef(type: string, compounds?: Record<string, CompoundDef>, params?: Params): ModuleDef | undefined {
  if (type === 'compound') {
    const cd = compounds?.[String(params?.def)];
    return cd ? compoundModuleDef(cd) : undefined;
  }
  const base = BY_TYPE.get(type);
  if (!base) return undefined;
  const def = localizeDef(base);
  return withSettingPins(def, paramDefsOf(def, params ?? {}));
}

export function paramDefsOf(def: ModuleDef, params: Params): ParamDef[] {
  return def.dynamicParams ? def.dynamicParams(params) : def.params;
}

export function defaultParams(def: ModuleDef, params: Params = {}): Params {
  const out: Params = {};
  for (const p of paramDefsOf(def, params)) if (p.kind !== 'action') out[p.key] = (p as any).default;
  return out;
}

/** Validate and fill a parameter set against its schema. Unknown keys are dropped (except `def` on compounds). */
export function resolveParams(def: ModuleDef, raw: Params): Params {
  const out: Params = {};
  const defs = paramDefsOf(def, raw);
  // Dynamic schemas depend on their selector, so resolve the selector first.
  for (const p of defs) {
    const v = raw[p.key];
    switch (p.kind) {
      case 'number': {
        const x = typeof v === 'number' ? v : Number(v);
        out[p.key] = Number.isFinite(x) && v !== '' && v !== null ? clamp(x, p.min, p.max) : p.default;
        break;
      }
      case 'select':
        out[p.key] = p.options.some((o) => o.value === v) ? v : p.default;
        break;
      case 'text':
        out[p.key] = typeof v === 'string' ? v.slice(0, p.maxLength ?? 2000) : p.default;
        break;
      case 'bool':
        out[p.key] = typeof v === 'boolean' ? v : p.default;
        break;
      case 'action':
        break;
    }
  }
  if (raw.def !== undefined) out.def = raw.def;
  return out;
}

export const nodeSize = (def: ModuleDef) => def.dim ?? SIZES[def.size];

export function portList(def: ModuleDef, dir: 'in' | 'out'): PortDef[] {
  return dir === 'in' ? def.inputs : def.outputs;
}
export function portSide(p: PortDef, dir: 'in' | 'out'): Side {
  return p.side ?? (dir === 'in' ? 'top' : 'bottom');
}

/** Absolute world position of a port's centre. Analytic, so wires never depend on DOM measurement. */
export function portPosition(node: NodeInst, def: ModuleDef, portId: string, dir: 'in' | 'out'): { x: number; y: number; side: Side } | null {
  const list = portList(def, dir);
  const port = list.find((p) => p.id === portId);
  if (!port) return null;
  const side = portSide(port, dir);
  const group = list.filter((p) => portSide(p, dir) === side);
  const i = group.indexOf(port);
  const { w, h } = nodeSize(def);
  const f = (i + 1) / (group.length + 1);
  switch (side) {
    case 'top': return { x: node.x + w * f, y: node.y, side };
    case 'bottom': return { x: node.x + w * f, y: node.y + h, side };
    case 'left': return { x: node.x, y: node.y + h * f, side };
    case 'right': return { x: node.x + w, y: node.y + h * f, side };
  }
}

export function nodeTitle(def: ModuleDef, params: Params): string {
  return def.title ? def.title(params) : def.name;
}
