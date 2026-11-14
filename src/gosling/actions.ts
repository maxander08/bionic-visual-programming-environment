// Gosling's hands: every way the assistant changes the workspace goes through here, so each change is an ordinary,
// undoable edit made with the same graph functions as the editor itself.
import { bridge, useStore } from '../state/store';
import { addNode, checkConnection, connect, removeNodes } from '../core/graph';
import { getDef, nodeSize, portList } from '../core/registry';
import type { Graph, Params } from '../core/types';
import { MODULES } from '../core/registry';
import { pause, play, stepOnce, stop } from '../runtime/session';
import { RECIPE_BY_ID } from '../ui/docs/recipes';
import { moduleByType, resolveSettings } from './knowledge';

export interface Result { ok: boolean; message: string; ids?: string[] }

const PAD = 36;

function rects(g: Graph, compounds: Record<string, any>) {
  return Object.values(g.nodes).map((n) => {
    const d = getDef(n.type, compounds, n.params);
    const s = d ? nodeSize(d) : { w: 144, h: 84 };
    return { x: n.x, y: n.y, w: s.w, h: s.h };
  });
}

/** The free spot nearest to the centre of what the user is looking at, for a block of the given size. */
export function findFreeSpot(w: number, h: number, extra: { x: number; y: number; w: number; h: number }[] = []): { x: number; y: number } {
  const { project } = useStore.getState();
  const taken = [...rects(project.graph, project.compounds), ...extra];
  const c = bridge.centerWorld?.() ?? { x: 0, y: 0 };
  const cx = Math.round((c.x - w / 2) / 12) * 12, cy = Math.round((c.y - h / 2) / 12) * 12;
  const free = (x: number, y: number) => taken.every((r) => x + w + PAD <= r.x || r.x + r.w + PAD <= x || y + h + PAD <= r.y || r.y + r.h + PAD <= y);
  if (free(cx, cy)) return { x: cx, y: cy };
  const step = 24;
  let best: { x: number; y: number; d: number } | null = null;
  for (let r = 1; r <= 60 && !best; r++) {
    for (let dx = -r; dx <= r; dx++) {
      for (let dy = -r; dy <= r; dy++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        const x = cx + dx * step, y = cy + dy * step;
        if (!free(x, y)) continue;
        const d = Math.hypot(dx, dy * 1.4); // prefer sideways growth: wires read left to right
        if (!best || d < best.d) best = { x, y, d };
      }
    }
  }
  return best ?? { x: cx + 400, y: cy };
}

function reveal(ids: string[]) {
  const st = useStore.getState();
  st.select(ids);
}

// ---- creating --------------------------------------------------------------------------------------------------

export function addModules(type: string, count = 1, raw: Record<string, unknown> = {}): Result {
  const def = moduleByType(type);
  if (!def) return { ok: false, message: `I don't know a module called “${type}”.` };
  const n = Math.max(1, Math.min(20, Math.floor(Number.isFinite(count) ? count : 1)));
  const { params, notes } = resolveSettings(def, raw);
  const st = useStore.getState();
  const ids: string[] = [];
  const size = nodeSize(getDef(type, st.project.compounds, params)!);
  const placed: { x: number; y: number; w: number; h: number }[] = [];
  st.edit((s) => {
    let g = s.graph;
    for (let i = 0; i < n; i++) {
      const at = findFreeSpot(size.w, size.h, placed);
      try {
        const res = addNode(g, type, at.x, at.y, params, s.compounds);
        g = res.graph;
        ids.push(res.id);
        placed.push({ ...at, w: size.w, h: size.h });
      } catch { break; }
    }
    return ids.length ? { ...s, graph: g } : null;
  });
  if (!ids.length) return { ok: false, message: `I couldn't add ${def.name}.` };
  reveal(ids);
  const set = Object.keys(params).length ? ` (${Object.entries(params).map(([k, v]) => `${k} = ${String(v)}`).join(', ')})` : '';
  return { ok: true, ids, message: `Added ${ids.length > 1 ? `${ids.length}× ` : ''}${def.name}${set}: ${ids.join(', ')}.${notes.length ? ' ' + notes.join(' ') : ''}` };
}

export interface BuildSpec {
  nodes: { ref: string; type: string; params?: Record<string, unknown>; dx?: number; dy?: number }[];
  wires?: { from: string; fromPort?: string; to: string; toPort?: string }[];
}

/** Place several modules as one block and wire them, as a single undoable edit. */
export function buildBlock(spec: BuildSpec, label = 'that'): Result {
  if (!spec.nodes?.length) return { ok: false, message: 'No modules specified.' };
  const nodeSpecs = spec.nodes.slice(0, 40);
  const bad = nodeSpecs.find((n) => !moduleByType(n.type));
  if (bad) return { ok: false, message: `I don't know a module called “${bad.type}”.` };
  const resolved = nodeSpecs.map((n) => resolveSettings(moduleByType(n.type)!, n.params ?? {}));
  // lay out left to right when positions are not given
  let x = 0;
  const laid = nodeSpecs.map((n, i) => {
    const d = getDef(n.type, undefined, resolved[i].params)!;
    const s = nodeSize(d);
    const pos = { x: n.dx ?? x, y: n.dy ?? 0, w: s.w, h: s.h };
    x = (n.dx ?? x) + s.w + 72;
    return pos;
  });
  const bw = Math.max(...laid.map((p) => p.x + p.w)), bh = Math.max(...laid.map((p) => p.y + p.h));
  const origin = findFreeSpot(bw, bh);
  const ids: Record<string, string> = {};
  const notes: string[] = [];
  const applied: Record<string, string> = {};
  const st = useStore.getState();
  st.edit((s) => {
    let g = s.graph;
    nodeSpecs.forEach((n, i) => {
      const r = resolved[i];
      notes.push(...r.notes);
      applied[n.ref] = Object.entries(r.params).map(([k, v]) => `${k} = ${String(v)}`).join(', ');
      const res = addNode(g, n.type, origin.x + laid[i].x, origin.y + laid[i].y, r.params, s.compounds);
      g = res.graph;
      ids[n.ref] = res.id;
    });
    for (const w of spec.wires ?? []) {
      const pair = pickPorts(g, s.compounds, ids[w.from], ids[w.to], w.fromPort, w.toPort);
      if (!pair) { notes.push(`I couldn't wire ${w.from} to ${w.to}.`); continue; }
      const r = connect(g, ids[w.from], pair.from, ids[w.to], pair.to, s.compounds);
      if (r.error) notes.push(r.error); else g = r.graph;
    }
    return { ...s, graph: g };
  });
  const all = Object.values(ids);
  reveal(all);
  return { ok: true, ids: all, message: `Built ${label}: ${nodeSpecs.map((n) => `${moduleByType(n.type)!.name} (${ids[n.ref]}${applied[n.ref] ? ', ' + applied[n.ref] : ''})`).join(' → ')}.${notes.length ? ' ' + notes.join(' ') : ''}` };
}

/** Put a Cookbook recipe on the workspace next to what is already there (the editor's own “open” would replace it). */
export function addRecipe(id: string): Result {
  const r = RECIPE_BY_ID.get(id);
  if (!r) return { ok: false, message: 'I could not find that recipe.' };
  const minX = Math.min(...r.nodes.map((n) => n.x)), minY = Math.min(...r.nodes.map((n) => n.y));
  const maxX = Math.max(...r.nodes.map((n) => n.x + 144)), maxY = Math.max(...r.nodes.map((n) => n.y + 180));
  const origin = findFreeSpot(maxX - minX, maxY - minY);
  const map: Record<string, string> = {};
  let err = '';
  useStore.getState().edit((s) => {
    let g = s.graph;
    for (const n of r.nodes) { const res = addNode(g, n.type, origin.x + n.x - minX, origin.y + n.y - minY, n.params ?? {}, s.compounds); g = res.graph; map[n.id] = res.id; }
    for (const [a, ap, b, bp] of r.wires) { const c = connect(g, map[a], ap, map[b], bp, s.compounds); if (c.error) err += ` ${c.error}`; else g = c.graph; }
    return { ...s, graph: g };
  });
  reveal(Object.values(map));
  return { ok: true, ids: Object.values(map), message: `Added the “${r.title}” recipe (${r.nodes.length} modules, ${r.wires.length} wires).${err}` };
}

// ---- connecting ------------------------------------------------------------------------------------------------

const matchPort = (p: { id: string; label: string }, hint?: string) => {
  if (!hint) return true;
  const h = hint.toLowerCase().replace(/^p:/, '');
  const pid = p.id.toLowerCase();
  return pid === h || pid.replace(/^p:/, '') === h || p.label.toLowerCase() === h;
};

/** The best pair of pins to join: honours hints, otherwise the first compatible output and a free, matching input. */
export function pickPorts(g: Graph, compounds: Record<string, any>, from: string, to: string, fromHint?: string, toHint?: string): { from: string; to: string } | null {
  const a = g.nodes[from], b = g.nodes[to];
  if (!a || !b) return null;
  const da = getDef(a.type, compounds, a.params), db = getDef(b.type, compounds, b.params);
  if (!da || !db) return null;
  const used = new Set(Object.values(g.edges).filter((e) => e.to === to).map((e) => e.toPort));
  let best: { from: string; to: string; score: number } | null = null;
  portList(da, 'out').forEach((po, oi) => {
    if (!matchPort(po, fromHint)) return;
    portList(db, 'in').forEach((pi, ii) => {
      if (!matchPort(pi, toHint)) return;
      if (!checkConnection(g, from, po.id, to, pi.id, compounds).ok) return;
      let score = 100 - oi * 2 - ii;
      if (pi.id.startsWith('p:')) score -= 50;            // setting pins only when asked for
      if (!pi.optional) score += 10;                      // main inputs first
      if (po.type === pi.type) score += 6; else if (pi.type === 'any') score += 3;
      if (used.has(pi.id)) score -= 30;
      if (!best || score > best.score) best = { from: po.id, to: pi.id, score };
    });
  });
  const b2 = best as { from: string; to: string } | null;
  return b2 ? { from: b2.from, to: b2.to } : null;
}

export function connectNodes(from: string, to: string, fromPort?: string, toPort?: string): Result {
  const st = useStore.getState();
  const { graph, compounds } = st.project;
  if (!graph.nodes[from]) return { ok: false, message: `There is no module \`${from}\`.` };
  if (!graph.nodes[to]) return { ok: false, message: `There is no module \`${to}\`.` };
  if (from === to) return { ok: false, message: 'A module can’t be wired straight into itself.' };
  const pair = pickPorts(graph, compounds, from, to, fromPort, toPort);
  if (!pair) {
    const da = getDef(graph.nodes[from].type, compounds, graph.nodes[from].params)!, db = getDef(graph.nodes[to].type, compounds, graph.nodes[to].params)!;
    return { ok: false, message: `I couldn't find a compatible pair of pins between ${da.name} (${from}) and ${db.name} (${to})${fromPort || toPort ? ' with those pin names' : ''}. ${da.name} outputs: ${da.outputs.map((p) => p.label).join(', ') || 'none'}. ${db.name} inputs: ${db.inputs.filter((p) => !p.param).map((p) => p.label).join(', ') || 'none'}.` };
  }
  const err = st.connectPorts(from, pair.from, to, pair.to);
  if (err) return { ok: false, message: err };
  const lab = (id: string, port: string, dir: 'in' | 'out') => portList(getDef(graph.nodes[id].type, compounds, graph.nodes[id].params)!, dir).find((p) => p.id === port)?.label ?? port;
  return { ok: true, ids: [from, to], message: `Connected ${from} → ${lab(from, pair.from, 'out')} to ${to} ← ${lab(to, pair.to, 'in')}.` };
}

// ---- changing and removing -------------------------------------------------------------------------------------

export function setSettings(id: string, raw: Record<string, unknown>): Result {
  const st = useStore.getState();
  const n = st.project.graph.nodes[id];
  if (!n) return { ok: false, message: `There is no module \`${id}\`.` };
  const def = getDef(n.type, st.project.compounds, n.params);
  if (!def) return { ok: false, message: 'Unknown module.' };
  const r = resolveSettings(def, raw, n.params);
  if (!Object.keys(r.params).length) return { ok: false, message: r.notes.join(' ') || 'Nothing to change.' };
  st.setNodeParams(id, r.params);
  const state = useStore.getState().project.graph.nodes[id].params;
  return { ok: true, ids: [id], message: `${def.name} \`${id}\`: ${Object.keys(r.params).map((k) => `${k} → ${String(state[k])}`).join(', ')}.${r.notes.length ? ' ' + r.notes.join(' ') : ''}` };
}

export function removeModules(ids: string[]): Result {
  const st = useStore.getState();
  const real = ids.filter((i) => st.project.graph.nodes[i]);
  if (!real.length) return { ok: false, message: 'Nothing matching to remove.' };
  st.edit((s) => ({ ...s, graph: removeNodes(s.graph, real) }));
  st.select([]);
  return { ok: true, message: `Removed ${real.length === 1 ? real[0] : `${real.length} modules (${real.slice(0, 6).join(', ')}${real.length > 6 ? '…' : ''})`}. You can undo this with Ctrl/⌘+Z.` };
}

export function setNodeDisabled(ids: string[], disabled: boolean): Result {
  const st = useStore.getState();
  const real = ids.filter((i) => !!st.project.graph.nodes[i]);
  if (!real.length) return { ok: false, message: 'Nothing matching.' };
  const targets = real.filter((i) => !!st.project.graph.nodes[i].disabled !== disabled);
  if (targets.length) st.toggleDisabled(targets);
  return { ok: true, message: `${disabled ? 'Disabled' : 'Enabled'} ${real.join(', ')}.` };
}

export function renameProgram(name: string): Result {
  useStore.getState().rename(name);
  return { ok: true, message: `Renamed the program to “${useStore.getState().project.name}”.` };
}

export function focusNodes(ids: string[]) {
  const st = useStore.getState();
  st.select(ids);
  bridge.focus?.(ids);
}

export function control(action: 'run' | 'pause' | 'stop' | 'step'): Result {
  const st = useStore.getState();
  switch (action) {
    case 'run': if (st.run === 'running') return { ok: true, message: 'It is already running.' }; play(); return { ok: true, message: st.run === 'paused' ? 'Resumed.' : 'Running.' };
    case 'pause': if (st.run !== 'running') return { ok: true, message: 'It is not running, so there is nothing to pause.' }; pause(); return { ok: true, message: 'Paused.' };
    case 'stop': if (st.run === 'stopped') return { ok: true, message: 'It is already stopped.' }; stop(); return { ok: true, message: 'Stopped and reset.' };
    case 'step': if (st.run === 'running') return { ok: false, message: 'Pause first, then I can step one tick at a time.' }; stepOnce(); return { ok: true, message: 'Stepped one tick.' };
    default: return { ok: false, message: `Unknown control action “${String(action)}”.` };
  }
}

export function openDocs(route?: unknown) { useStore.getState().openDialog('docs', route); }

export function sanitizeParams(p: unknown): Params { return p && typeof p === 'object' ? (p as Params) : {}; }
export const allTypes = () => MODULES.map((m) => m.type);
