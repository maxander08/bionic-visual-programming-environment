// Gosling's eyes: a live, read-only picture of the workspace and of the running program.
// It reads the editor store (what is on the canvas) and the engine (what is happening right now).
import { useStore } from '../state/store';
import { engine, getDiagnostics } from '../runtime/session';
import { getDef } from '../core/registry';
import type { Diagnostic, Edge, ModuleDef, NodeInst } from '../core/types';
import { fmtNum, isImage } from '../core/util';
import { isDec, toPlain } from '../core/decimal';
import { isEquation } from '../core/equation';
import { notificationState } from '../runtime/outputs';
import { audio } from '../runtime/outputs';

export const TIMING_TYPES = ['timer', 'stopwatch', 'alarm', 'clock'];

export function fmtValue(v: unknown, max = 80): string {
  if (v === undefined || v === null) return '—';
  if (typeof v === 'number') return fmtNum(v, 6);
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  if (typeof v === 'string') return v.length > max ? `“${v.slice(0, max)}…”` : `“${v}”`;
  if (isDec(v)) return toPlain(v);
  if (isImage(v)) return `an image (${v.w}×${v.h})`;
  if (isEquation(v)) return 'an equation';
  try {
    const t = JSON.stringify(v);
    return t.length > max ? t.slice(0, max) + '…' : t;
  } catch { return 'a value'; }
}

export interface Link { node: string; port: string; label: string }
export interface NodeInfo {
  id: string;
  type: string;
  name: string;
  category: string;
  disabled: boolean;
  x: number;
  y: number;
  settings: { key: string; label: string; value: string }[];
  status: { level: string; message: string } | null;
  outputs: { port: string; label: string; value: string }[];
  inputs: { port: string; label: string; value: string; from: Link | null }[];
  sendsTo: { port: string; label: string; to: Link }[];
  evals: number;
  view: Record<string, unknown>;
  missing: string[];
  def: ModuleDef;
  inst: NodeInst;
}

export interface TimerInfo {
  id: string;
  type: string;
  name: string;
  state: string;
  detail: string;
  active: boolean;
}

export interface Snapshot {
  program: { name: string; description: string; author: string };
  run: 'stopped' | 'running' | 'paused';
  simTime: number;
  tick: number;
  tickMs: number;
  speed: number;
  nodeCount: number;
  edgeCount: number;
  innerCount: number;
  nodes: NodeInfo[];
  byType: { type: string; name: string; category: string; ids: string[] }[];
  byCategory: Record<string, number>;
  timers: TimerInfo[];
  projectors: { id: string; showing: string; source: string | null }[];
  diagnostics: Diagnostic[];
  selection: string[];
  compounds: { id: string; name: string; inner: number }[];
  disabled: string[];
  unconnected: string[];
  pendingTimers: number;
  evalsLastTick: number;
  saveState: string;
  language: string;
  history: { undo: number; redo: number };
}

const nodeLabel = (n: NodeInst, compounds: Record<string, any>) => {
  const d = getDef(n.type, compounds, n.params);
  return d ? `${d.name} (${n.id})` : n.id;
};

export function fmtMs(ms: number): string {
  const s = Math.max(0, ms) / 1000;
  if (s < 60) return `${s.toFixed(s < 10 ? 2 : 1)}s`;
  const m = Math.floor(s / 60);
  const r = Math.floor(s % 60);
  return `${m}m ${r}s`;
}

function timerInfo(n: NodeInfo, run: Snapshot['run']): TimerInfo {
  const v = n.view as any;
  const p = n.inst.params as any;
  const live = run !== 'stopped';
  let state = String(v.state ?? 'idle');
  let detail = '';
  if (n.type === 'timer') {
    if (!live) {
      state = p.autostart ? 'ready' : 'idle';
      detail = `${fmtNum(Number(p.duration))}s countdown${p.autostart ? ', starts automatically when you press Run' : ', waits for a start signal'}${p.repeat ? ', repeating' : ''}`;
    } else {
      detail = `${v.time ?? '—'} left${v.progress !== undefined ? ` (${Math.round(Number(v.progress) * 100)}% elapsed)` : ''}${v.count ? `, finished ${v.count}×` : ''}`;
    }
  } else if (n.type === 'stopwatch') {
    if (!live) { state = p.autostart ? 'ready' : 'stopped'; detail = 'at 00:00 until the program runs'; }
    else detail = `${v.time ?? '—'} elapsed${v.laps ? `, ${v.laps} lap${Number(v.laps) === 1 ? '' : 's'}` : ''}${v.lap ? `, last lap ${v.lap}` : ''}`;
  } else if (n.type === 'alarm') {
    detail = `set for ${v.time ?? p.time ?? '—'}${v.place ? ` (${v.place})` : ''}${v.countdown ? `, rings in ${v.countdown}` : ''}${v.repeat ? `, repeat: ${v.repeat}` : ''}`;
    if (!live && !v.state) state = 'armed when running';
  } else if (n.type === 'clock') {
    detail = `${v.time ?? v.local ?? ''}${v.place ? ` in ${v.place}` : p.city ? ` in ${p.city}` : ' (this device)'}`.trim();
    state = live ? 'ticking' : 'stopped';
  }
  const active = live && run === 'running' && ['running', 'armed', 'snoozed', 'ringing', 'ticking'].includes(state);
  return { id: n.id, type: n.type, name: n.name, state, detail: detail || '—', active };
}

export function takeSnapshot(): Snapshot {
  const st = useStore.getState();
  const { project, run, selection, settings } = st;
  const { graph, compounds } = project;
  const edges = Object.values(graph.edges);

  const incoming = new Map<string, Edge>();
  const outgoing = new Map<string, Edge[]>();
  for (const e of edges) {
    incoming.set(`${e.to}\u0000${e.toPort}`, e);
    (outgoing.get(e.from) ?? outgoing.set(e.from, []).get(e.from)!).push(e);
  }
  const portLabel = (id: string, port: string, dir: 'in' | 'out') => {
    const n = graph.nodes[id];
    const d = n && getDef(n.type, compounds, n.params);
    const list = d ? (dir === 'in' ? d.inputs : d.outputs) : [];
    return list.find((p) => p.id === port)?.label ?? port;
  };

  const nodes: NodeInfo[] = Object.values(graph.nodes).flatMap((n) => {
    const def = getDef(n.type, compounds, n.params);
    if (!def) return [];
    const rt = engine.nodes.get(n.id);
    const params = (rt?.params ?? n.params) as Record<string, unknown>;
    const settingsList = (def.dynamicParams ? def.dynamicParams(n.params) : def.params)
      .filter((p) => p.kind !== 'action' && !p.hidden)
      .map((p) => ({ key: p.key, label: p.label, value: fmtValue(params[p.key], 60).replace(/^“|”$/g, '') }));
    const ins = def.inputs.filter((p) => !p.param).map((p) => {
      const e = incoming.get(`${n.id}\u0000${p.id}`);
      return {
        port: p.id, label: p.label, value: fmtValue(rt?.inputs[p.id]?.v),
        from: e && graph.nodes[e.from] ? { node: e.from, port: e.fromPort, label: `${nodeLabel(graph.nodes[e.from], compounds)} → ${portLabel(e.from, e.fromPort, 'out')}` } : null,
      };
    });
    const outs = def.outputs.map((p) => ({ port: p.id, label: p.label, value: fmtValue(rt?.outputs[p.id]?.v) }));
    const sendsTo = (outgoing.get(n.id) ?? []).filter((e) => !!graph.nodes[e.to]).map((e) => ({ port: e.fromPort, label: portLabel(n.id, e.fromPort, 'out'), to: { node: e.to, port: e.toPort, label: `${nodeLabel(graph.nodes[e.to], compounds)} ← ${portLabel(e.to, e.toPort, 'in')}` } }));
    return [{
      id: n.id, type: n.type, name: def.name, category: def.category, disabled: !!n.disabled, x: n.x, y: n.y,
      settings: settingsList, status: rt && rt.status.level !== 'ok' ? rt.status : null, outputs: outs, inputs: ins, sendsTo,
      evals: rt?.evals ?? 0, view: (rt?.viewData ?? {}) as Record<string, unknown>,
      missing: rt && run !== 'stopped' ? engine.missingInputs(n.id) : [], def, inst: n,
    }];
  });

  const byTypeMap = new Map<string, { type: string; name: string; category: string; ids: string[] }>();
  const byCategory: Record<string, number> = {};
  for (const n of nodes) {
    (byTypeMap.get(n.type) ?? byTypeMap.set(n.type, { type: n.type, name: n.name, category: n.category, ids: [] }).get(n.type)!).ids.push(n.id);
    byCategory[n.category] = (byCategory[n.category] ?? 0) + 1;
  }

  const projectors = nodes.filter((n) => n.type === 'projector').map((n) => {
    const v = n.view as any;
    const src = n.inputs[0]?.from?.label ?? null;
    let showing = 'nothing yet';
    if (v.kind === 'number' || v.kind === 'text') showing = `“${String(v.text ?? '').slice(0, 60)}”`;
    else if (v.kind === 'image') showing = 'an image';
    else if (v.kind === 'plot') showing = 'a graph';
    else if (v.kind === 'file') showing = 'a file';
    else if (v.kind && v.kind !== 'empty') showing = String(v.kind);
    return { id: n.id, showing, source: src };
  });

  const compoundNodes = nodes.filter((n) => n.type === 'compound');
  const innerCount = [...engine.nodes.keys()].filter((k) => k.includes('/')).length;

  return {
    program: { name: project.name, description: project.description, author: project.author },
    run, simTime: engine.time, tick: engine.tick, tickMs: engine.tickMs, speed: settings.speed,
    nodeCount: nodes.length, edgeCount: edges.length, innerCount, nodes,
    byType: [...byTypeMap.values()].sort((a, b) => b.ids.length - a.ids.length || a.name.localeCompare(b.name)),
    byCategory,
    timers: nodes.filter((n) => TIMING_TYPES.includes(n.type)).map((n) => timerInfo(n, run)),
    projectors,
    diagnostics: getDiagnostics(),
    selection, 
    compounds: compoundNodes.map((n) => ({ id: n.id, name: compounds[String(n.inst.params.def)]?.name ?? n.id, inner: [...engine.nodes.keys()].filter((k) => k.startsWith(n.id + '/')).length })),
    disabled: nodes.filter((n) => n.disabled).map((n) => n.id),
    unconnected: nodes.filter((n) => !['comment', 'by'].includes(n.type) && !n.inputs.some((i) => i.from) && n.sendsTo.length === 0).map((n) => n.id),
    pendingTimers: engine.stats.pendingTimers,
    evalsLastTick: engine.stats.evalsLastTick,
    saveState: st.saveState, language: settings.language,
    history: { undo: st.past.length, redo: st.future.length },
  };
}

// ---- readable text ---------------------------------------------------------------------------------------------

const plural = (n: number, w: string, pl = w + 's') => `${n} ${n === 1 ? w : pl}`;
export const nodeRef = (n: { id: string; name: string }) => `${n.name} \`${n.id}\``;

export function runStateText(s: Snapshot): string {
  if (s.run === 'running') return `The program is **running**: simulation time is ${fmtMs(s.simTime)} (tick ${s.tick}, ${s.tickMs} ms per tick${s.speed !== 1 ? `, speed ×${s.speed}` : ''}).`;
  if (s.run === 'paused') return `The program is **paused** at ${fmtMs(s.simTime)} (tick ${s.tick}). Press Run (or Space) to continue.`;
  return 'The program is **stopped**, so nothing is running and every module is at its starting state. Press Run (or Space) to start it.';
}

export function timersText(s: Snapshot): string {
  if (!s.timers.length) return `There are no Timekeeping modules (Timer, Stopwatch, Alarm, World Clock) in the workspace.${s.nodeCount ? '' : ' It is empty right now.'} Want me to add a Timer?`;
  const running = s.timers.filter((t) => t.active);
  const lines = [s.run === 'running'
    ? `${plural(running.length, 'timekeeping module')} of ${s.timers.length} ${running.length === 1 ? 'is' : 'are'} actively running:`
    : s.run === 'paused' ? `The program is paused, so every timer is frozen. ${plural(s.timers.length, 'timekeeping module')} on the workspace:` : `The program is stopped, so no timer is counting. ${plural(s.timers.length, 'timekeeping module')} on the workspace:`];
  for (const t of s.timers) lines.push(`- ${t.name} \`${t.id}\` is **${t.state}**: ${t.detail}`);
  const pulses = s.byType.find((b) => b.type === 'pulse');
  if (pulses) lines.push(`Also timing-related: ${plural(pulses.ids.length, 'Pulse module')} (${pulses.ids.join(', ')}).`);
  if (s.run === 'running') lines.push(`The engine has ${plural(s.pendingTimers, 'scheduled wake-up')} queued.`);
  return lines.join('\n');
}

export function overviewText(s: Snapshot): string {
  const lines: string[] = [];
  lines.push(`**${s.program.name}**${s.program.author ? ` by ${s.program.author}` : ''}: ${plural(s.nodeCount, 'module')} and ${plural(s.edgeCount, 'connection')}${s.compounds.length ? `, ${plural(s.compounds.length, 'compound')} (holding ${s.innerCount} inner modules)` : ''}.`);
  lines.push(runStateText(s));
  if (!s.nodeCount) { lines.push('The workspace is empty. Ask me to add something, for example “add a timer and a projector, connected”.'); return lines.join('\n'); }
  const cats = Object.entries(s.byCategory).sort((a, b) => b[1] - a[1]).map(([c, n]) => `${n} ${c}`).join(', ');
  lines.push(`**By category:** ${cats}.`);
  lines.push(`**Modules:** ${s.byType.map((b) => `${b.ids.length}× ${b.name}`).join(', ')}.`);
  if (s.projectors.length) lines.push(`**Projectors:** ${s.projectors.length}${s.run !== 'stopped' ? ` (${s.projectors.map((p) => `\`${p.id}\` shows ${p.showing}`).join('; ')})` : ''}.`);
  if (s.timers.length) {
    const active = s.timers.filter((t) => t.active).length;
    lines.push(`**Timekeeping:** ${s.timers.map((t) => `${t.name} \`${t.id}\` ${t.state}`).join(', ')}${s.run === 'running' ? ` (${active} actively running)` : ''}.`);
  }
  const errs = s.diagnostics.filter((d) => d.level === 'error').length, warns = s.diagnostics.filter((d) => d.level === 'warn').length;
  lines.push(errs || warns ? `**Health:** ${plural(errs, 'error')} and ${plural(warns, 'warning')}. Ask “any problems?” for details.` : '**Health:** no errors or warnings.');
  if (s.unconnected.length) lines.push(`**Not wired to anything:** ${s.unconnected.join(', ')}.`);
  if (s.disabled.length) lines.push(`**Disabled:** ${s.disabled.join(', ')}.`);
  if (s.selection.length) lines.push(`**Selected:** ${s.selection.join(', ')}.`);
  return lines.join('\n');
}

export function diagnosticsText(s: Snapshot): string {
  const lines: string[] = [];
  if (!s.diagnostics.length) lines.push('No errors or warnings right now.' + (s.run === 'stopped' ? ' (The program is stopped, so runtime problems only show up once it runs.)' : ''));
  else {
    lines.push(`${plural(s.diagnostics.length, 'issue')}:`);
    for (const d of s.diagnostics) lines.push(`- ${d.level === 'error' ? '**Error**' : d.level === 'warn' ? 'Warning' : 'Note'}${d.nodeId ? ` in \`${d.nodeId}\`` : ''}: ${d.message}`);
  }
  const waiting = s.nodes.filter((n) => n.missing.length);
  for (const n of waiting) lines.push(`- ${nodeRef(n)} is idle: it is waiting for a signal on ${n.missing.join(', ')}.`);
  if (audio.state === 'locked' && s.nodes.some((n) => n.type === 'audio')) lines.push('- Sound is locked until you interact with the page.');
  if (s.nodes.some((n) => n.type === 'notify') && notificationState() !== 'granted') lines.push(`- Notifications are “${notificationState()}”; a Notify module will not show anything.`);
  return lines.join('\n');
}

export function nodeText(n: NodeInfo, s: Snapshot): string {
  const lines: string[] = [];
  lines.push(`${nodeRef(n)} is a ${n.category} module${n.disabled ? ' (**disabled**)' : ''}, at position (${Math.round(n.x)}, ${Math.round(n.y)}).`);
  if (n.settings.length) lines.push(`**Settings:** ${n.settings.slice(0, 12).map((x) => `${x.label} = ${x.value}`).join(', ')}.`);
  const fed = n.inputs.filter((i) => i.from);
  lines.push(fed.length ? `**Fed by:** ${fed.map((i) => `${i.from!.label} into its ${i.label}`).join('; ')}.` : n.inputs.length ? '**Fed by:** nothing (no input is connected).' : '');
  lines.push(n.sendsTo.length ? `**Sends to:** ${n.sendsTo.map((x) => `${x.label} → ${x.to.label}`).join('; ')}.` : n.outputs.length ? '**Sends to:** nothing (no output is connected).' : '');
  if (s.run !== 'stopped') {
    const vals = n.outputs.filter((o) => o.value !== '—').slice(0, 6);
    if (vals.length) lines.push(`**Right now:** ${vals.map((o) => `${o.label} = ${o.value}`).join(', ')}.`);
    if (n.missing.length) lines.push(`It is idle because it has no signal on ${n.missing.join(', ')}.`);
    if (n.evals) lines.push(`It has run ${plural(n.evals, 'time')} so far.`);
  }
  if (n.status) lines.push(`**Status:** ${n.status.level}: ${n.status.message}`);
  return lines.filter(Boolean).join('\n');
}

export const countText = plural;
