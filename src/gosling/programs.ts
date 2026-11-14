// Gosling's program builder: turns a description of modules and wires into a real, working program on the canvas.
//
// Everything is validated against the live module registry (exact types, real setting keys and values, compatible pins),
// laid out the way the editor flows (inputs on top, outputs at the bottom), applied as ONE undoable edit, and then
// checked: a dry run of the program in a private engine reports required inputs that nobody feeds, modules that fail,
// and what each display would show.
import { bridge, useStore } from '../state/store';
import { addNode, connect, disconnect, emptyGraph, flatten } from '../core/graph';
import { Engine } from '../core/engine';
import { MODULES, getDef, nodeSize, portList } from '../core/registry';
import { cleanName } from '../core/project';
import type { ModuleDef } from '../core/types';
import { engine, play, syncGraph } from '../runtime/session';
import { findFreeSpot, pickPorts, type Result } from './actions';
import { findModules, moduleByType, resolveSettings } from './knowledge';
import { fmtValue } from './workspace';

export interface ProgramNode { ref: string; type: string; settings?: Record<string, unknown>; x?: number; y?: number }
export interface ProgramWire { from: string; to: string; fromPin?: string; toPin?: string }
export interface ProgramSpec { name?: string; description?: string; nodes: ProgramNode[]; wires?: ProgramWire[] }

export interface Report {
  /** True when nothing is wrong: every required input is fed and nothing failed in the dry run. */
  ok: boolean;
  problems: string[];
  notes: string[];
  /** What the display modules would show after a short dry run. */
  observed: string[];
}
export interface BuildResult extends Result { refs?: Record<string, string>; report?: Report }

/** Accepts exact type ids first, then names, captions and everyday words (“countdown”, “screen”). */
export function resolveType(t: unknown): ModuleDef | undefined {
  const raw = String(t ?? '').trim();
  if (!raw) return undefined;
  const lower = raw.toLowerCase();
  return moduleByType(raw) ?? moduleByType(lower)
    ?? MODULES.find((m) => m.name.toLowerCase() === lower || m.caption.toLowerCase() === lower)
    ?? findModules(raw)[0]?.def;
}

// ---- layout ----------------------------------------------------------------------------------------------------

const COL_GAP = 48;
const ROW_GAP = 72;

interface LNode { ref: string; w: number; h: number; x?: number; y?: number }

/**
 * Layers by data flow, top to bottom like the editor's own pin sides: sources on the first row, displays on the last.
 * Within a row, modules sit under the average position of what feeds them so wires cross as little as possible.
 * Positions are relative to (0, 0).
 */
export function layoutLayers(nodes: LNode[], wires: { from: string; to: string }[]): Record<string, { x: number; y: number }> {
  if (!nodes.length) return {};
  if (nodes.every((n) => n.x !== undefined && n.y !== undefined)) {
    const minX = Math.min(...nodes.map((n) => n.x!)), minY = Math.min(...nodes.map((n) => n.y!));
    return Object.fromEntries(nodes.map((n) => [n.ref, { x: n.x! - minX, y: n.y! - minY }]));
  }
  const known = new Set(nodes.map((n) => n.ref));
  const ws = wires.filter((w) => w.from !== w.to && known.has(w.from) && known.has(w.to));
  const depth: Record<string, number> = Object.fromEntries(nodes.map((n) => [n.ref, 0]));
  const N = nodes.length;
  for (let i = 0; i < N; i++) {
    let changed = false;
    for (const w of ws) {
      const d = depth[w.from] + 1;
      if (d > depth[w.to] && d <= N) { depth[w.to] = d; changed = true; }
    }
    if (!changed) break;
  }
  // a source that only feeds something further down sits just above its first consumer, so wires stay short
  const hasIn = new Set(ws.map((w) => w.to));
  for (const n of nodes) {
    if (hasIn.has(n.ref)) continue;
    const outs = ws.filter((w) => w.from === n.ref).map((w) => depth[w.to]);
    if (outs.length) depth[n.ref] = Math.max(0, Math.min(...outs) - 1);
  }
  const rows = new Map<number, LNode[]>();
  for (const n of nodes) (rows.get(depth[n.ref]) ?? rows.set(depth[n.ref], []).get(depth[n.ref])!).push(n);
  const keys = [...rows.keys()].sort((a, b) => a - b);
  const widths = new Map(keys.map((k) => [k, rows.get(k)!.reduce((a, n) => a + n.w, 0) + COL_GAP * (rows.get(k)!.length - 1)]));
  const widest = Math.max(...widths.values());
  const out: Record<string, { x: number; y: number }> = {};
  const centre: Record<string, number> = {};
  let y = 0;
  for (const k of keys) {
    const list = rows.get(k)!;
    const bary = (n: LNode) => {
      const ps = ws.filter((w) => w.to === n.ref && w.from in centre).map((w) => centre[w.from]);
      return ps.length ? ps.reduce((a, b) => a + b, 0) / ps.length : Number.NaN;
    };
    const order = list.map((n, i) => ({ n, i, b: bary(n) }));
    if (order.some((o) => !Number.isNaN(o.b))) order.sort((a, b) => (Number.isNaN(a.b) ? a.i * 1e3 : a.b) - (Number.isNaN(b.b) ? b.i * 1e3 : b.b) || a.i - b.i);
    let x = (widest - widths.get(k)!) / 2;
    for (const { n } of order) { out[n.ref] = { x, y }; centre[n.ref] = x + n.w / 2; x += n.w + COL_GAP; }
    y += Math.max(...list.map((n) => n.h)) + ROW_GAP;
  }
  return out;
}

// ---- creating --------------------------------------------------------------------------------------------------

const pinNames = (def: ModuleDef, dir: 'in' | 'out') => portList(def, dir).filter((p) => !p.param).map((p) => p.id).join(', ');

export function createProgram(spec: ProgramSpec, opts: { replace?: boolean; run?: boolean; label?: string } = {}): BuildResult {
  const specs = (Array.isArray(spec?.nodes) ? spec.nodes : []).slice(0, 60);
  if (!specs.length) return { ok: false, message: 'No modules specified.' };

  const problems: string[] = [];
  const seen = new Set<string>();
  const items: { ref: string; def: ModuleDef; params: Record<string, unknown>; w: number; h: number; x?: number; y?: number }[] = [];
  for (const [i, n] of specs.entries()) {
    const def = resolveType(n?.type);
    if (!def) return { ok: false, message: `I don't know a module type “${String(n?.type)}”. Nothing was changed. Use an exact type id from the catalogue.` };
    let ref = String(n?.ref || `n${i + 1}`);
    while (seen.has(ref)) ref += '_';
    seen.add(ref);
    const r = resolveSettings(def, n?.settings && typeof n.settings === 'object' ? n.settings : {});
    problems.push(...r.notes);
    const size = nodeSize(getDef(def.type, undefined, r.params)!);
    items.push({ ref, def, params: r.params, w: size.w, h: size.h, x: Number.isFinite(n?.x) ? n.x : undefined, y: Number.isFinite(n?.y) ? n.y : undefined });
  }

  const wireSpecs = (Array.isArray(spec.wires) ? spec.wires : []).slice(0, 200);
  const pos = layoutLayers(items, wireSpecs.map((w) => ({ from: String(w?.from), to: String(w?.to) })));
  const bw = Math.max(...items.map((it) => pos[it.ref].x + it.w)), bh = Math.max(...items.map((it) => pos[it.ref].y + it.h));

  const st = useStore.getState();
  const wasEmpty = !Object.keys(st.project.graph.nodes).length;
  const replace = !!opts.replace;
  const c = bridge.centerWorld?.() ?? { x: 0, y: 0 };
  const origin = replace ? { x: Math.round(c.x - bw / 2), y: Math.round(c.y - bh / 2) } : findFreeSpot(bw, bh);

  const ids: Record<string, string> = {};
  let wired = 0;
  st.edit((s) => {
    let g = replace ? emptyGraph() : s.graph;
    for (const it of items) {
      const res = addNode(g, it.def.type, origin.x + pos[it.ref].x, origin.y + pos[it.ref].y, it.params, s.compounds);
      g = res.graph;
      ids[it.ref] = res.id;
    }
    for (const w of wireSpecs) {
      const a = ids[String(w?.from)], b = ids[String(w?.to)];
      if (!a || !b) { problems.push(`A wire refers to a module that doesn't exist (“${String(w?.from)}” → “${String(w?.to)}”).`); continue; }
      const pair = pickPorts(g, s.compounds, a, b, w.fromPin, w.toPin);
      if (!pair) {
        const da = getDef(g.nodes[a].type, s.compounds, g.nodes[a].params)!, db = getDef(g.nodes[b].type, s.compounds, g.nodes[b].params)!;
        problems.push(`I couldn't wire ${a} to ${b}${w.fromPin || w.toPin ? ` (${w.fromPin ?? 'any'} → ${w.toPin ?? 'any'})` : ''}. ${da.name} outputs: ${pinNames(da, 'out') || 'none'}. ${db.name} inputs: ${pinNames(db, 'in') || 'none'}.`);
        continue;
      }
      const r = connect(g, a, pair.from, b, pair.to, s.compounds);
      if (r.error) problems.push(`${a} → ${b}: ${r.error}`); else { g = r.graph; wired++; }
    }
    return { ...s, graph: g, name: (replace || wasEmpty) && spec.name ? cleanName(spec.name) : s.name };
  });
  if ((replace || wasEmpty) && spec.description) useStore.getState().setMeta({ description: String(spec.description).slice(0, 600) });

  const all = Object.values(ids);
  useStore.getState().select(all);
  setTimeout(() => bridge.focus?.(all), 60);

  const report = verifyProgram({ ids: all });
  report.problems.unshift(...problems);
  report.ok = report.problems.length === 0;
  if (replace) engine.reset();
  if (opts.run) { syncGraph(); play(); } else if (replace) { syncGraph(); }

  const label = opts.label ?? (spec.name ? `“${cleanName(spec.name)}”` : 'the program');
  const head = `Built ${label}: ${items.map((it) => `${it.def.name} (${ids[it.ref]})`).join(', ')}; ${wired} wire${wired === 1 ? '' : 's'}${opts.run ? '; running' : ''}.`;
  return { ok: true, ids: all, refs: ids, report, message: `${head}${report.ok ? '' : ' ' + reportText(report)}` };
}

// ---- checking --------------------------------------------------------------------------------------------------

const DISPLAYS = new Set(['projector', 'text', 'meter', 'light', 'vital', 'notify', 'audio', 'haptic', 'image']);

/** Static wiring checks plus a short dry run in a private engine. Never touches the live simulation. */
export function verifyProgram(opts: { ids?: string[]; ms?: number } = {}): Report {
  const st = useStore.getState();
  const { graph, compounds } = st.project;
  const scope = (opts.ids ?? Object.keys(graph.nodes)).filter((i) => graph.nodes[i]);
  const problems: string[] = [];
  const notes: string[] = [];
  const observed: string[] = [];
  const edges = Object.values(graph.edges);
  const fed = new Set(edges.map((e) => `${e.to}\u0000${e.toPort}`));
  const touched = new Set(edges.flatMap((e) => [e.from, e.to]));
  const secs = ((opts.ms ?? 3000) / 1000).toFixed(0);

  for (const id of scope) {
    const n = graph.nodes[id];
    const def = getDef(n.type, compounds, n.params);
    if (!def || n.disabled) continue;
    if (!touched.has(id) && (def.inputs.length || def.outputs.length) && n.type !== 'comment') {
      (def.inputs.some((p) => !p.param && !p.optional) ? problems : notes).push(`${def.name} \`${id}\` isn't wired to anything.`);
      continue;
    }
    for (const p of def.inputs) {
      if (p.param || p.optional || fed.has(`${id}\u0000${p.id}`)) continue;
      problems.push(`${def.name} \`${id}\` has nothing wired into its required input “${p.label}”, so it will stay idle.`);
    }
  }

  try {
    const e = new Engine(st.settings.tickMs);
    e.load(flatten(graph, compounds));
    e.run(Math.max(1, Math.min(600, Math.round((opts.ms ?? 3000) / e.tickMs))));
    const inScope = new Set(scope);
    for (const d of e.diagnostics()) {
      if (d.nodeId && !inScope.has(d.nodeId)) continue;
      if (d.level === 'error') problems.push(d.message); else if (d.level === 'warn') notes.push(d.message);
    }
    for (const id of scope) {
      const n = graph.nodes[id];
      if (!DISPLAYS.has(n.type) || n.disabled) continue;
      const rt = e.nodes.get(id);
      const v = rt?.inputs.in?.v ?? rt?.inputs.amp?.v ?? rt?.inputs.freq?.v;
      const from = edges.find((x) => x.to === id);
      const src = from ? graph.nodes[from.from] : undefined;
      const live = src && getDef(src.type, compounds, src.params)?.category === 'Sensor';
      if (v !== undefined) observed.push(`\`${id}\` ${n.type === 'meter' ? 'is plotting' : 'receives'} ${fmtValue(v, 60)} after ${secs}s`);
      else if (from && live) observed.push(`\`${id}\` is fed by a sensor (${from.from}); it shows data once the program runs`);
      else if (from) notes.push(`\`${id}\` hasn't received a value after ${secs}s of simulated time (it may just need longer, or an input like Start).`);
    }
  } catch (err) {
    problems.push(`The dry run failed: ${err instanceof Error ? err.message : String(err)}`);
  }
  return { ok: problems.length === 0, problems, notes, observed };
}

export function reportText(r: Report): string {
  const parts: string[] = [];
  if (r.problems.length) parts.push(`Problems: ${r.problems.join(' ')}`);
  if (r.observed.length) parts.push(`Dry run: ${r.observed.join('; ')}.`);
  if (r.notes.length) parts.push(`Notes: ${r.notes.slice(0, 6).join(' ')}`);
  return parts.join(' ') || 'No problems found.';
}

// ---- small edits for the language model ------------------------------------------------------------------------

/** Remove the wire(s) between two modules (optionally only the one into a given input pin). */
export function disconnectNodes(from: string, to: string, toPin?: string): Result {
  const st = useStore.getState();
  const pin = toPin?.replace(/^p:/, '');
  const hits = Object.values(st.project.graph.edges).filter((e) => e.from === from && e.to === to && (!pin || e.toPort === pin || e.toPort === `p:${pin}`));
  if (!hits.length) return { ok: false, message: `There is no wire from \`${from}\` to \`${to}\`.` };
  st.edit((s) => { let g = s.graph; for (const e of hits) g = disconnect(g, e.id); return { ...s, graph: g }; });
  return { ok: true, ids: [from, to], message: `Removed ${hits.length} wire${hits.length === 1 ? '' : 's'} from ${from} to ${to}.` };
}

/** Move modules to explicit canvas positions. */
export function moveModules(moves: { id: string; x: number; y: number }[]): Result {
  const st = useStore.getState();
  const real = moves.filter((m) => st.project.graph.nodes[m.id] && Number.isFinite(m.x) && Number.isFinite(m.y));
  if (!real.length) return { ok: false, message: 'Nothing to move.' };
  st.moveNodesTo(Object.fromEntries(real.map((m) => [m.id, { x: m.x, y: m.y }])));
  return { ok: true, ids: real.map((m) => m.id), message: `Moved ${real.map((m) => m.id).join(', ')}.` };
}
