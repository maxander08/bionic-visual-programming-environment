import type { CompoundDef, ModuleDef, ParamDef, Params, PortDef, NodeInst, Side } from './types';
import { SIZES } from './types';
import { sensors } from './modules/sensors';
import { nuclei } from './modules/nuclei';
import { nodes } from './modules/nodes';
import { behaviors } from './modules/behavior';
import { txt } from './modules/kit';
import { clamp } from './util';

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

export const MODULES: ModuleDef[] = [...sensors, ...nuclei, ...behaviors, ...nodes, ...info];
const BY_TYPE = new Map(MODULES.map((m) => [m.type, m]));
export const CATEGORIES = ['Sensor', 'Nucleus', 'Behavior', 'Node', 'Info'] as const;

export function compoundModuleDef(cd: CompoundDef): ModuleDef {
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
  return BY_TYPE.get(type);
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

export const nodeSize = (def: ModuleDef) => SIZES[def.size];

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
