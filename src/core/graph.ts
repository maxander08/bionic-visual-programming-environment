// Immutable graph operations, connection validation, compound creation and flattening.
import type { CompoundDef, CompoundPort, Diagnostic, Edge, FlatEdge, FlatGraph, Graph, NodeInst, Params } from './types';
import { GRID } from './types';
import { compoundModuleDef, defaultParams, getDef, nodeSize, portList, resolveParams } from './registry';
import { compatibility } from './util';
import type { ModuleDef } from './types';

export const emptyGraph = (): Graph => ({ nodes: {}, edges: {} });
export const snap = (v: number) => Math.round(v / GRID) * GRID;
type Compounds = Record<string, CompoundDef> | undefined;

export function nextId(existing: Record<string, unknown>, prefix: string): string {
  let i = 1;
  while (`${prefix}${i}` in existing) i++;
  return `${prefix}${i}`;
}

export function addNode(g: Graph, type: string, x: number, y: number, params: Params = {}, compounds?: Compounds, id?: string): { graph: Graph; id: string } {
  const def = getDef(type, compounds, params);
  if (!def) throw new Error(`Unknown module type “${type}”`);
  const nid = id ?? nextId(g.nodes, type.replace(/[^a-z0-9]/gi, '') + '-');
  const p = resolveParams(def, { ...defaultParams(def, params), ...params });
  const node: NodeInst = { id: nid, type, x: snap(x), y: snap(y), params: p };
  return { graph: { ...g, nodes: { ...g.nodes, [nid]: node } }, id: nid };
}

export function removeNodes(g: Graph, ids: Iterable<string>): Graph {
  const set = new Set(ids);
  const nodes = { ...g.nodes };
  set.forEach((i) => delete nodes[i]);
  const edges: Record<string, Edge> = {};
  for (const e of Object.values(g.edges)) if (!set.has(e.from) && !set.has(e.to)) edges[e.id] = e;
  return { nodes, edges };
}

export function moveNodes(g: Graph, pos: Record<string, { x: number; y: number }>): Graph {
  const nodes = { ...g.nodes };
  for (const [id, p] of Object.entries(pos)) if (nodes[id]) nodes[id] = { ...nodes[id], x: p.x, y: p.y };
  return { ...g, nodes };
}

export function setParams(g: Graph, id: string, patch: Params, compounds?: Compounds): Graph {
  const n = g.nodes[id];
  if (!n) return g;
  const def = getDef(n.type, compounds, n.params);
  if (!def) return g;
  const merged = { ...n.params, ...patch };
  return { ...g, nodes: { ...g.nodes, [id]: { ...n, params: resolveParams(def, merged) } } };
}

export interface ConnectResult {
  graph: Graph;
  edge?: Edge;
  error?: string;
  replaced?: Edge;
}

export function checkConnection(g: Graph, from: string, fromPort: string, to: string, toPort: string, compounds?: Compounds): { ok: boolean; reason?: string; coerce?: boolean } {
  const a = g.nodes[from], b = g.nodes[to];
  if (!a || !b) return { ok: false, reason: 'Module no longer exists.' };
  const da = getDef(a.type, compounds, a.params), db = getDef(b.type, compounds, b.params);
  if (!da || !db) return { ok: false, reason: 'Unknown module type.' };
  const po = portList(da, 'out').find((p) => p.id === fromPort);
  const pi = portList(db, 'in').find((p) => p.id === toPort);
  if (!po) return { ok: false, reason: `“${da.name}” has no output “${fromPort}”.` };
  if (!pi) return { ok: false, reason: `“${db.name}” has no input “${toPort}”.` };
  const c = compatibility(po.type, pi.type);
  if (!c.ok) return { ok: false, reason: c.reason };
  return { ok: true, coerce: c.coerce };
}

/** Connect an output to an input. An input has exactly one driver: a new connection replaces the old one. */
export function connect(g: Graph, from: string, fromPort: string, to: string, toPort: string, compounds?: Compounds, id?: string): ConnectResult {
  const chk = checkConnection(g, from, fromPort, to, toPort, compounds);
  if (!chk.ok) return { graph: g, error: chk.reason };
  for (const e of Object.values(g.edges)) if (e.from === from && e.fromPort === fromPort && e.to === to && e.toPort === toPort) return { graph: g, error: 'These ports are already connected.' };
  let replaced: Edge | undefined;
  const edges = { ...g.edges };
  for (const e of Object.values(g.edges)) if (e.to === to && e.toPort === toPort) { replaced = e; delete edges[e.id]; }
  const eid = id ?? nextId(edges, 'w');
  const edge: Edge = { id: eid, from, fromPort, to, toPort, weight: 1, delay: 0, enabled: true };
  edges[eid] = edge;
  return { graph: { ...g, edges }, edge, replaced };
}

export function disconnect(g: Graph, edgeId: string): Graph {
  if (!g.edges[edgeId]) return g;
  const edges = { ...g.edges };
  delete edges[edgeId];
  return { ...g, edges };
}

export function patchEdge(g: Graph, edgeId: string, patch: Partial<Pick<Edge, 'weight' | 'delay' | 'enabled'>>): Graph {
  const e = g.edges[edgeId];
  if (!e) return g;
  const next = { ...e, ...patch };
  next.weight = Math.max(0, Math.min(4, Number.isFinite(next.weight) ? next.weight : 1));
  next.delay = Math.max(0, Math.min(600000, Number.isFinite(next.delay) ? next.delay : 0));
  return { ...g, edges: { ...g.edges, [edgeId]: next } };
}

export function duplicateNodes(g: Graph, ids: string[], dx = GRID * 2, dy = GRID * 2): { graph: Graph; map: Record<string, string> } {
  const map: Record<string, string> = {};
  const nodes = { ...g.nodes };
  for (const id of ids) {
    const n = g.nodes[id];
    if (!n) continue;
    const nid = nextId(nodes, n.type.replace(/[^a-z0-9]/gi, '') + '-');
    map[id] = nid;
    nodes[nid] = { ...n, id: nid, x: n.x + dx, y: n.y + dy, params: { ...n.params } };
  }
  const edges = { ...g.edges };
  for (const e of Object.values(g.edges)) {
    if (map[e.from] && map[e.to]) {
      const eid = nextId(edges, 'w');
      edges[eid] = { ...e, id: eid, from: map[e.from], to: map[e.to] };
    }
  }
  return { graph: { nodes, edges }, map };
}

export function graphBounds(g: Graph, compounds?: Compounds) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const n of Object.values(g.nodes)) {
    const d = getDef(n.type, compounds, n.params);
    const s = d ? nodeSize(d) : { w: 144, h: 84 };
    x0 = Math.min(x0, n.x); y0 = Math.min(y0, n.y); x1 = Math.max(x1, n.x + s.w); y1 = Math.max(y1, n.y + s.h);
  }
  return Number.isFinite(x0) ? { x: x0, y: y0, w: x1 - x0, h: y1 - y0 } : null;
}

// ---- compounds

export function createCompound(g: Graph, ids: string[], name: string, compounds: Record<string, CompoundDef>): { graph: Graph; def: CompoundDef; nodeId: string } | { error: string } {
  const sel = new Set(ids.filter((i) => g.nodes[i]));
  if (sel.size < 1) return { error: 'Select at least one module.' };
  const inner: Graph = { nodes: {}, edges: {} };
  sel.forEach((i) => (inner.nodes[i] = g.nodes[i]));
  const inputs: CompoundPort[] = [], outputs: CompoundPort[] = [];
  const inKey = new Map<string, string>(), outKey = new Map<string, string>();
  const outside: Edge[] = [];
  for (const e of Object.values(g.edges)) {
    const a = sel.has(e.from), b = sel.has(e.to);
    if (a && b) inner.edges[e.id] = e;
    else if (b || a) outside.push(e);
  }
  const portInfo = (nodeId: string, port: string, dir: 'in' | 'out') => {
    const n = g.nodes[nodeId];
    const d = getDef(n.type, compounds, n.params)!;
    const p = portList(d, dir).find((q) => q.id === port)!;
    return { type: p.type, label: `${d.name} ${p.label}`.trim() };
  };
  for (const e of outside) {
    if (sel.has(e.to)) {
      const k = `${e.to}:${e.toPort}`;
      if (!inKey.has(k)) {
        const info = portInfo(e.to, e.toPort, 'in');
        const id = `in${inputs.length + 1}`;
        inKey.set(k, id);
        inputs.push({ id, label: info.label, type: info.type, nodeId: e.to, port: e.toPort });
      }
    } else {
      const k = `${e.from}:${e.fromPort}`;
      if (!outKey.has(k)) {
        const info = portInfo(e.from, e.fromPort, 'out');
        const id = `out${outputs.length + 1}`;
        outKey.set(k, id);
        outputs.push({ id, label: info.label, type: info.type, nodeId: e.from, port: e.fromPort });
      }
    }
  }
  let base = name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'compound';
  let n = 1;
  while (`${base}-${n}` in compounds) n++;
  const defId = `${base}-${n}`;
  const def: CompoundDef = { id: defId, name: name.trim() || 'Compound', description: '', graph: inner, inputs, outputs, exposed: [] };
  const nodes = { ...g.nodes };
  sel.forEach((i) => delete nodes[i]);
  const edges: Record<string, Edge> = {};
  for (const e of Object.values(g.edges)) if (!sel.has(e.from) && !sel.has(e.to)) edges[e.id] = e;
  const bb = graphBounds(inner)!;
  const cid = nextId(nodes, 'compound-');
  nodes[cid] = { id: cid, type: 'compound', x: snap(bb.x), y: snap(bb.y), params: { def: defId } };
  for (const e of outside) {
    if (sel.has(e.to)) edges[e.id] = { ...e, to: cid, toPort: inKey.get(`${e.to}:${e.toPort}`)! };
    else edges[e.id] = { ...e, from: cid, fromPort: outKey.get(`${e.from}:${e.fromPort}`)! };
  }
  return { graph: { nodes, edges }, def, nodeId: cid };
}

// ---- flattening

const MAX_DEPTH = 8;
interface Target { id: string; port: string }
interface Expanded {
  nodes: NodeInst[];
  edges: FlatEdge[];
  resolveIn(nodeId: string, port: string): Target[];
  resolveOut(nodeId: string, port: string): Target | null;
}

function expand(g: Graph, compounds: Record<string, CompoundDef>, prefix: string, depth: number, diag: Diagnostic[]): Expanded {
  const nodes: NodeInst[] = [];
  const edges: FlatEdge[] = [];
  const subs = new Map<string, { def: CompoundDef; ex: Expanded }>();
  for (const n of Object.values(g.nodes)) {
    if (n.type === 'compound') {
      const def = compounds[String(n.params.def)];
      if (!def) { diag.push({ level: 'error', nodeId: prefix + n.id, message: `Compound definition “${String(n.params.def)}” is missing.` }); continue; }
      if (depth >= MAX_DEPTH) { diag.push({ level: 'error', nodeId: prefix + n.id, message: 'Compounds are nested too deeply (limit 8).' }); continue; }
      // apply exposed parameter overrides to inner node copies
      const innerNodes: Record<string, NodeInst> = {};
      for (const [id, inn] of Object.entries(def.graph.nodes)) innerNodes[id] = inn;
      for (const e of def.exposed) {
        const inn = innerNodes[e.nodeId];
        if (inn && n.params[e.key] !== undefined) innerNodes[e.nodeId] = { ...inn, params: { ...inn.params, [e.param]: n.params[e.key] } };
      }
      const ex = expand({ nodes: innerNodes, edges: def.graph.edges }, compounds, `${prefix}${n.id}/`, depth + 1, diag);
      nodes.push(...ex.nodes);
      edges.push(...ex.edges);
      subs.set(n.id, { def, ex });
    } else nodes.push({ ...n, id: prefix + n.id });
  }
  const resolveIn = (nodeId: string, port: string): Target[] => {
    const s = subs.get(nodeId);
    if (s) {
      const cp = s.def.inputs.find((p) => p.id === port);
      return cp ? s.ex.resolveIn(cp.nodeId, cp.port) : [];
    }
    return g.nodes[nodeId] && g.nodes[nodeId].type !== 'compound' ? [{ id: prefix + nodeId, port }] : [];
  };
  const resolveOut = (nodeId: string, port: string): Target | null => {
    const s = subs.get(nodeId);
    if (s) {
      const cp = s.def.outputs.find((p) => p.id === port);
      return cp ? s.ex.resolveOut(cp.nodeId, cp.port) : null;
    }
    return g.nodes[nodeId] && g.nodes[nodeId].type !== 'compound' ? { id: prefix + nodeId, port } : null;
  };
  for (const e of Object.values(g.edges)) {
    const src = resolveOut(e.from, e.fromPort);
    const dsts = resolveIn(e.to, e.toPort);
    if (!src || !dsts.length) continue;
    dsts.forEach((d, i) =>
      edges.push({ ...e, id: prefix + e.id + (i ? `#${i}` : ''), orig: prefix + e.id, from: src.id, fromPort: src.port, to: d.id, toPort: d.port }),
    );
  }
  return { nodes, edges, resolveIn, resolveOut };
}

export function flatten(g: Graph, compounds: Record<string, CompoundDef> = {}): FlatGraph {
  const diagnostics: Diagnostic[] = [];
  const ex = expand(g, compounds, '', 0, diagnostics);
  const nodes: Record<string, NodeInst> = {};
  for (const n of ex.nodes) nodes[n.id] = n;
  return { nodes, edges: ex.edges.filter((e) => nodes[e.from] && nodes[e.to]), diagnostics };
}

/** Sanitize an arbitrary graph (from import): drop unknown modules, bad ports, duplicate drivers. */
export function sanitizeGraph(raw: Graph, compounds: Record<string, CompoundDef>): { graph: Graph; problems: string[] } {
  const problems: string[] = [];
  const g: Graph = { nodes: {}, edges: {} };
  for (const n of Object.values(raw.nodes ?? {})) {
    if (!n || typeof n.id !== 'string' || !/^[\w.-]{1,60}$/.test(n.id)) { problems.push('Skipped a module with an invalid id.'); continue; }
    const def = getDef(n.type, compounds, n.params ?? {});
    if (!def) { problems.push(`Skipped unknown module “${String(n.type).slice(0, 40)}”.`); continue; }
    const x = Number.isFinite(n.x) ? n.x : 0, y = Number.isFinite(n.y) ? n.y : 0;
    g.nodes[n.id] = { id: n.id, type: n.type, x: Math.max(-1e6, Math.min(1e6, x)), y: Math.max(-1e6, Math.min(1e6, y)), params: resolveParams(def, n.params ?? {}), ...(n.disabled ? { disabled: true } : {}) };
  }
  const driven = new Set<string>();
  for (const e of Object.values(raw.edges ?? {})) {
    if (!e || typeof e.id !== 'string') continue;
    const key = `${e.to}:${e.toPort}`;
    const chk = checkConnection(g, e.from, e.fromPort, e.to, e.toPort, compounds);
    if (!chk.ok || driven.has(key)) { problems.push(`Dropped connection ${e.from}.${e.fromPort} → ${e.to}.${e.toPort}: ${chk.reason ?? 'input already driven'}.`); continue; }
    driven.add(key);
    g.edges[e.id] = { id: e.id, from: e.from, fromPort: e.fromPort, to: e.to, toPort: e.toPort, weight: Number.isFinite(e.weight) ? Math.max(0, Math.min(4, e.weight)) : 1, delay: Number.isFinite(e.delay) ? Math.max(0, Math.min(600000, e.delay)) : 0, enabled: e.enabled !== false };
  }
  return { graph: g, problems };
}

export function defOfNode(n: NodeInst, compounds?: Compounds): ModuleDef | undefined {
  return getDef(n.type, compounds, n.params);
}
export { compoundModuleDef };
