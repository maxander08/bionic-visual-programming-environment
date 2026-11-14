// Deterministic, event-driven graph runtime.
//
// Semantics (see also the in-app documentation):
//  * Time is a simulation clock advanced explicitly by step(dt). Nothing depends on animation frames.
//  * A module is evaluated only when a signal arrived, a wake-up it scheduled came due, a sensor injected data,
//    a command was sent, or (once) when it starts.
//  * Within one tick modules run in topological order, so each module runs at most once per tick.
//  * Feedback: connections that close a cycle are "back edges". If the cycle passes through a module marked as
//    delaying (state / delay / timing), the back edge delivers on the next tick. Otherwise the cycle is unbounded:
//    the back edge is blocked and an error is reported.
//  * Required inputs without a signal keep a module idle. Optional inputs never block.
import type { Ctx, Diagnostic, FlatEdge, FlatGraph, ModuleDef, Params, PortDef, Signal } from './types';
import { getDef, isSettingPort, resolveParams } from './registry';
import { coerceTo, compatibility, hashStr, mulberry32 } from './util';
import { fromNumber, isDec, parseDec, sameValue, type Dec } from './decimal';

export interface NodeStatus {
  level: 'ok' | 'warn' | 'error';
  message: string;
}
type Reason = Ctx['reason'];

export interface NodeRT {
  id: string;
  type: string;
  def: ModuleDef;
  /** The settings chosen in the inspector. */
  params: Params;
  /** The settings in effect: `params`, with every setting pin that carries a signal applied on top. */
  live: Params;
  /** True while at least one setting pin overrides a setting. */
  driven: boolean;
  seedKey: unknown;
  state: Record<string, any>;
  inputs: Record<string, Signal | undefined>;
  outputs: Record<string, Signal | undefined>;
  changed: Set<string>;
  dirty: boolean;
  reason: Reason;
  rank: number;
  lastEval: number;
  lastFire: number;
  lastRecv: number;
  evals: number;
  started: boolean;
  disabled: boolean;
  status: NodeStatus;
  viewData: Record<string, unknown>;
  ver: number;
  rng: () => number;
  injected?: Record<string, unknown>;
  command?: string;
  wakeTok: number;
  ctx: NodeCtx;
}

type Timer =
  | { at: number; seq: number; kind: 'wake'; node: string; tok: number }
  | { at: number; seq: number; kind: 'deliver'; edge: FlatEdge; sig: Signal; event: boolean }
  | { at: number; seq: number; kind: 'emit'; node: string; port: string; sig: Signal };

export interface EngineStats {
  tick: number;
  evalsLastTick: number;
  deliveriesLastTick: number;
  tickMicros: number;
  pendingTimers: number;
  nodes: number;
  edges: number;
}

class NodeCtx implements Ctx {
  constructor(private e: Engine, private n: NodeRT) {}
  get time() { return this.e.time; }
  dt = 0;
  get tickMs() { return this.e.tickMs; }
  get reason() { return this.n.reason; }
  get params() { return this.n.live; }
  get state() { return this.n.state; }
  get injected() { return this.n.injected; }
  get command() { return this.n.command; }
  get strength() {
    let s = 0, any = false;
    for (const k in this.n.inputs) {
      const g = this.n.inputs[k];
      if (g && !isSettingPort(k)) { any = true; if (g.s > s) s = g.s; }
    }
    return any ? s : 1;
  }
  get(port: string) { return this.n.inputs[port]?.v; }
  sig(port: string) { return this.n.inputs[port]; }
  has(port: string) { return this.n.inputs[port] !== undefined; }
  changed(port: string) { return this.n.changed.has(port); }
  num(key: string) { return Number(this.n.live[key]); }
  dec(key: string): Dec {
    const v = this.n.live[key];
    if (isDec(v)) return v;
    const r = typeof v === 'number' && Number.isFinite(v) ? { ok: true as const, dec: fromNumber(v) } : parseDec(String(v ?? ''));
    return r.ok ? r.dec : fromNumber(0);
  }
  str(key: string) { return String(this.n.live[key] ?? ''); }
  bool(key: string) { return !!this.n.live[key]; }
  emit(port: string, value: unknown, strength?: number, event = false) { this.e.emitFrom(this.n, port, value, strength ?? this.strength, event); }
  emitLater(port: string, value: unknown, ms: number, strength?: number) {
    this.e.schedule({ at: this.e.time + ms, seq: 0, kind: 'emit', node: this.n.id, port, sig: { v: value, s: strength ?? this.strength, t: this.e.time + ms } });
  }
  wake(ms: number) {
    const tok = ++this.n.wakeTok;
    this.e.schedule({ at: this.e.time + Math.max(ms, 0.001), seq: 0, kind: 'wake', node: this.n.id, tok });
  }
  rand() { return this.n.rng(); }
  view(v: Record<string, unknown>) { this.n.viewData = v; this.n.ver++; }
  warn(msg: string) { if (this.n.status.level !== 'error') this.n.status = { level: 'warn', message: msg }; }
  fail(msg: string) {
    this.n.status = { level: 'error', message: msg };
    this.e.clearOutputs(this.n);
  }
}

class Heap {
  private a: NodeRT[] = [];
  get size() { return this.a.length; }
  push(n: NodeRT) {
    const a = this.a;
    a.push(n);
    let i = a.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (a[p].rank <= a[i].rank) break;
      [a[p], a[i]] = [a[i], a[p]];
      i = p;
    }
  }
  pop(): NodeRT | undefined {
    const a = this.a;
    if (!a.length) return undefined;
    const top = a[0], last = a.pop()!;
    if (a.length) {
      a[0] = last;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1, r = l + 1;
        let m = i;
        if (l < a.length && a[l].rank < a[m].rank) m = l;
        if (r < a.length && a[r].rank < a[m].rank) m = r;
        if (m === i) break;
        [a[m], a[i]] = [a[i], a[m]];
        i = m;
      }
    }
    return top;
  }
}

export interface Activity {
  nodes: Set<string>;
  edges: Set<string>;
}

export class Engine {
  time = 0;
  tick = 0;
  tickMs: number;
  nodes = new Map<string, NodeRT>();
  edges: FlatEdge[] = [];
  outEdges = new Map<string, FlatEdge[]>();
  stats: EngineStats = { tick: 0, evalsLastTick: 0, deliveriesLastTick: 0, tickMicros: 0, pendingTimers: 0, nodes: 0, edges: 0 };
  private timers: Timer[] = [];
  private seq = 0;
  private pending: { edge: FlatEdge; sig: Signal; event: boolean }[] = [];
  private heap = new Heap();
  private structural: Diagnostic[] = [];
  private runtimeFlags: Diagnostic[] = [];
  private evalsThisTick = 0;
  private deliveriesThisTick = 0;
  private halted = false;
  private edgeKeys = new Set<string>();
  activity: Activity = { nodes: new Set(), edges: new Set() };
  maxTimers = 20000;
  maxDeliveries = 200000;
  /** Called (outside the tick's hot path) when a setting pin changes a sensor's `source`, so drivers can follow. */
  onSourceChange?: () => void;

  constructor(tickMs = 50) {
    this.tickMs = tickMs;
  }

  // ---- loading -----------------------------------------------------------------------------------------------

  /** Load (or hot-swap) a flattened graph. State is preserved for modules whose id and type are unchanged. */
  load(flat: FlatGraph) {
    const old = this.nodes;
    const next = new Map<string, NodeRT>();
    for (const n of Object.values(flat.nodes)) {
      const def = getDef(n.type, undefined, n.params);
      if (!def) continue;
      const params = resolveParams(def, n.params);
      const prev = old.get(n.id);
      if (prev && prev.type === n.type) {
        const changed = JSON.stringify(prev.params) !== JSON.stringify(params);
        prev.params = params;
        prev.def = def;
        prev.seedKey = params.seed;
        const dis = !!n.disabled;
        const toggled = dis !== prev.disabled;
        if (toggled) { prev.disabled = dis; if (dis) this.clearOutputs(prev); }
        this.applyLive(prev, false);
        if (changed || toggled) this.markDirty(prev, 'init');
        next.set(n.id, prev);
      } else next.set(n.id, this.makeNode(n.id, n.type, def, params, !!n.disabled));
    }
    this.nodes = next;
    this.edges = flat.edges.map((e) => ({ ...e, deferred: false, blocked: false }));
    this.outEdges = new Map();
    this.structural = [...flat.diagnostics];
    this.analyse();
    // Inputs whose connection disappeared lose their signal.
    const driven = new Set(this.edges.map((e) => `${e.to}:${e.toPort}`));
    for (const n of next.values()) {
      for (const port of Object.keys(n.inputs)) {
        if (!driven.has(`${n.id}:${port}`) && n.inputs[port] !== undefined) {
          n.inputs[port] = undefined;
          // Losing a setting pin is like editing the setting back: it re-runs the module without counting as a data event.
          if (isSettingPort(port)) this.markDirty(n, 'init');
          else { n.changed.add(port); this.markDirty(n, 'input'); }
        }
      }
    }
    // New connections immediately carry the source's current value.
    const keys = new Set<string>();
    for (const e of this.edges) {
      const key = `${e.from}.${e.fromPort}>${e.to}.${e.toPort}`;
      keys.add(key);
      if (!this.edgeKeys.has(key)) {
        const sig = next.get(e.from)?.outputs[e.fromPort];
        if (sig) this.pending.push({ edge: e, sig, event: true });
      }
    }
    this.edgeKeys = keys;
    this.pending = this.pending.filter((p) => next.has(p.edge.to));
    this.heap = new Heap();
    for (const n of next.values()) if (n.dirty) this.heap.push(n);
    this.stats.nodes = next.size;
    this.stats.edges = this.edges.length;
  }

  private makeNode(id: string, type: string, def: ModuleDef, params: Params, disabled: boolean): NodeRT {
    const n: NodeRT = {
      id, type, def, params, live: params, driven: false, seedKey: params.seed, state: {}, inputs: {}, outputs: {}, changed: new Set(), dirty: false, reason: 'init', rank: 0, lastEval: 0, lastFire: -1e9, lastRecv: -1e9,
      evals: 0, started: false, disabled, status: { level: 'ok', message: '' }, viewData: {}, ver: 0, rng: mulberry32(1), wakeTok: 0, ctx: undefined as unknown as NodeCtx,
    };
    n.rng = mulberry32(typeof params.seed === 'number' ? (params.seed as number) >>> 0 : hashStr(id));
    n.ctx = new NodeCtx(this, n);
    return n;
  }

  private analyse() {
    const diag: Diagnostic[] = [];
    const adj = new Map<string, FlatEdge[]>();
    for (const id of this.nodes.keys()) adj.set(id, []);
    for (const e of this.edges) {
      const src = this.nodes.get(e.from), dst = this.nodes.get(e.to);
      if (!src || !dst) { e.blocked = true; continue; }
      const po = src.def.outputs.find((p) => p.id === e.fromPort), pi = dst.def.inputs.find((p) => p.id === e.toPort);
      if (!po || !pi) { e.blocked = true; diag.push({ level: 'error', nodeId: e.to, message: `Connection to ${dst.def.name} references a missing port “${!po ? e.fromPort : e.toPort}”.` }); continue; }
      if (!compatibility(po.type, pi.type).ok) { e.blocked = true; diag.push({ level: 'error', nodeId: e.to, message: `Incompatible connection ${src.def.name}.${po.label} → ${dst.def.name}.${pi.label}.` }); continue; }
      adj.get(e.from)!.push(e);
      let list = this.outEdges.get(e.from);
      if (!list) this.outEdges.set(e.from, (list = []));
      list.push(e);
    }
    // DFS for back edges.
    const color = new Map<string, 0 | 1 | 2>();
    const stack: string[] = [];
    const back: { e: FlatEdge; path: string[] }[] = [];
    const visit = (root: string) => {
      const it: { id: string; i: number }[] = [{ id: root, i: 0 }];
      color.set(root, 1);
      stack.push(root);
      while (it.length) {
        const top = it[it.length - 1];
        const list = adj.get(top.id)!;
        if (top.i >= list.length) { color.set(top.id, 2); stack.pop(); it.pop(); continue; }
        const e = list[top.i++];
        const c = color.get(e.to) ?? 0;
        if (c === 0) { color.set(e.to, 1); stack.push(e.to); it.push({ id: e.to, i: 0 }); }
        else if (c === 1) back.push({ e, path: stack.slice(stack.indexOf(e.to)) });
      }
    };
    for (const id of this.nodes.keys()) if ((color.get(id) ?? 0) === 0) visit(id);
    for (const { e, path } of back) {
      const names = path.map((p) => this.nodes.get(p)!.def.name).join(' → ');
      if (path.some((p) => this.nodes.get(p)!.def.delaying)) {
        e.deferred = true;
        diag.push({ level: 'info', nodeId: e.to, message: `Feedback loop (${names}) is stabilised by a delaying module; the closing connection delivers one tick late.` });
      } else {
        e.blocked = true;
        diag.push({ level: 'error', nodeId: e.to, message: `Unbounded cycle (${names} → …). No Delay, Register, State or timing module breaks the loop, so the closing connection ${this.nodes.get(e.from)!.def.name} → ${this.nodes.get(e.to)!.def.name} is blocked. Insert a Delay to make it a feedback loop.` });
      }
    }
    // Topological ranks over non-back edges.
    const indeg = new Map<string, number>();
    for (const id of this.nodes.keys()) indeg.set(id, 0);
    const fwd = (e: FlatEdge) => !e.blocked && !e.deferred;
    for (const e of this.edges) if (fwd(e)) indeg.set(e.to, (indeg.get(e.to) ?? 0) + 1);
    const q: string[] = [];
    indeg.forEach((d, id) => { if (d === 0) q.push(id); });
    let rank = 0;
    for (let qi = 0; qi < q.length; qi++) {
      const id = q[qi];
      this.nodes.get(id)!.rank = rank++;
      for (const e of this.outEdges.get(id) ?? []) if (fwd(e)) { const d = indeg.get(e.to)! - 1; indeg.set(e.to, d); if (d === 0) q.push(e.to); }
    }
    this.structural.push(...diag);
  }

  // ---- control -----------------------------------------------------------------------------------------------

  /** Clear all runtime state and signals and rewind the clock. */
  reset() {
    this.time = 0;
    this.tick = 0;
    this.timers = [];
    this.pending = [];
    this.heap = new Heap();
    this.halted = false;
    this.runtimeFlags = [];
    for (const n of this.nodes.values()) {
      n.state = {}; n.inputs = {}; n.outputs = {}; n.changed.clear(); n.dirty = false; n.started = false; n.evals = 0;
      n.lastEval = 0; n.lastFire = -1e9; n.lastRecv = -1e9; n.status = { level: 'ok', message: '' }; n.viewData = {}; n.ver++; n.wakeTok++;
      n.injected = undefined; n.command = undefined;
      n.rng = mulberry32(typeof n.params.seed === 'number' ? (n.params.seed as number) >>> 0 : hashStr(n.id));
      n.seedKey = n.params.seed; n.live = n.params; n.driven = false;
      this.activity.nodes.add(n.id);
    }
    this.edgeKeys = new Set(this.edges.map((e) => `${e.from}.${e.fromPort}>${e.to}.${e.toPort}`));
  }

  inject(id: string, values: Record<string, unknown>) {
    const n = this.nodes.get(id);
    if (!n) return;
    n.injected = { ...(n.injected ?? {}), ...values };
    this.markDirty(n, 'inject');
  }

  clearInjected(id: string) {
    const n = this.nodes.get(id);
    if (n) { n.injected = undefined; this.markDirty(n, 'inject'); }
  }

  command(id: string, cmd: string) {
    const n = this.nodes.get(id);
    if (!n) return;
    n.command = cmd;
    this.markDirty(n, 'command');
  }

  /** Advance the simulation clock by dt ms and process everything that became due. */
  step(dt = this.tickMs) {
    const t0 = typeof performance !== 'undefined' ? performance.now() : 0;
    this.time += dt;
    this.tick++;
    this.evalsThisTick = 0;
    this.deliveriesThisTick = 0;
    if (this.halted) return;
    const pend = this.pending;
    this.pending = [];
    for (const p of pend) this.deliver(p.edge, p.sig, p.event);
    for (const n of this.nodes.values()) {
      if (!n.started) {
        n.started = true;
        if (n.def.source || !n.def.inputs.some((p) => !p.param)) this.markDirty(n, 'init');
      }
    }
    while (this.timers.length && this.timers[0].at <= this.time) {
      const t = this.timers.shift()!;
      if (t.kind === 'wake') {
        const n = this.nodes.get(t.node);
        if (n && n.wakeTok === t.tok) this.markDirty(n, 'wake');
      } else if (t.kind === 'deliver') {
        if (this.nodes.has(t.edge.to)) this.deliver(t.edge, t.sig, t.event);
      } else {
        const n = this.nodes.get(t.node);
        if (n) this.emitFrom(n, t.port, t.sig.v, t.sig.s, true);
      }
    }
    for (let n = this.heap.pop(); n; n = this.heap.pop()) {
      if (n.dirty && this.nodes.get(n.id) === n) this.evaluate(n);
      if (this.halted) break;
    }
    this.refreshPropagatedErrors();
    this.stats.tick = this.tick;
    this.stats.evalsLastTick = this.evalsThisTick;
    this.stats.deliveriesLastTick = this.deliveriesThisTick;
    this.stats.pendingTimers = this.timers.length;
    this.stats.tickMicros = typeof performance !== 'undefined' ? Math.round((performance.now() - t0) * 1000) : 0;
  }

  /** Convenience for tests and fast-forward: run n ticks. */
  run(ticks: number) {
    for (let i = 0; i < ticks; i++) this.step(this.tickMs);
  }
  runFor(ms: number) {
    this.run(Math.round(ms / this.tickMs));
  }

  // ---- internals ---------------------------------------------------------------------------------------------

  schedule(t: Timer) {
    if (this.timers.length >= this.maxTimers) {
      if (!this.halted) {
        this.halted = true;
        this.runtimeFlags.push({ level: 'error', message: 'Runaway protection: too many pending timed events. Execution was halted; press Stop and check delays or feedback loops.' });
      }
      return;
    }
    t.seq = ++this.seq;
    let lo = 0, hi = this.timers.length;
    while (lo < hi) {
      const m = (lo + hi) >> 1;
      const a = this.timers[m];
      if (a.at < t.at || (a.at === t.at && a.seq < t.seq)) lo = m + 1;
      else hi = m;
    }
    this.timers.splice(lo, 0, t);
  }

  markDirty(n: NodeRT, reason: Reason) {
    if (n.disabled) return;
    if (!n.dirty) { n.dirty = true; n.reason = reason; this.heap.push(n); }
    else if (reason === 'command' || reason === 'inject' || (reason === 'input' && n.reason !== 'command')) n.reason = reason;
  }

  private canRun(n: NodeRT): boolean {
    for (const p of n.def.inputs) if (!p.optional && n.inputs[p.id] === undefined) return false;
    return true;
  }

  private evaluate(n: NodeRT) {
    n.dirty = false;
    if (n.disabled) return;
    if (++this.evalsThisTick > this.nodes.size * 4 + 1000) {
      this.halted = true;
      this.runtimeFlags.push({ level: 'error', message: 'Runaway protection: too many evaluations in one tick. Execution was halted.' });
      return;
    }
    this.applyLive(n, true);
    const ready = this.canRun(n);
    if (ready) {
      n.ctx.dt = n.evals === 0 ? 0 : this.time - n.lastEval;
      n.status = { level: 'ok', message: '' };
      try {
        n.def.run(n.ctx);
      } catch (err) {
        n.status = { level: 'error', message: err instanceof Error ? err.message : String(err) };
        this.clearOutputs(n);
      }
      n.evals++;
      n.lastEval = this.time;
    }
    n.changed.clear();
    n.command = undefined;
    n.ver++;
    this.activity.nodes.add(n.id);
  }

  /** Work out the settings in effect: inspector values overridden by any setting pin that carries a signal. */
  private applyLive(n: NodeRT, notify: boolean) {
    const before = n.live.source;
    let raw: Params | undefined;
    for (const p of n.def.paramPins ?? []) {
      const sig = n.inputs[p.id];
      if (sig && sig.v !== undefined) (raw ??= { ...n.params })[p.param!] = sig.v;
    }
    n.driven = !!raw;
    n.live = raw ? resolveParams(n.def, raw) : n.params;
    if (n.driven && typeof n.live.seed === 'number' && n.live.seed !== n.seedKey) {
      n.seedKey = n.live.seed;
      n.rng = mulberry32((n.live.seed as number) >>> 0);
    }
    if (notify && n.live.source !== before) this.onSourceChange?.();
  }

  clearOutputs(n: NodeRT) {
    for (const p of n.def.outputs) if (n.outputs[p.id] !== undefined) this.emitFrom(n, p.id, undefined, 1, true);
  }

  emitFrom(n: NodeRT, port: string, value: unknown, strength: number, event: boolean) {
    const prev = n.outputs[port];
    if (value === undefined) {
      if (prev === undefined) return;
      n.outputs[port] = undefined;
    } else {
      if (typeof value === 'number' && !Number.isFinite(value)) { n.status = { level: 'error', message: `Output “${port}” is not a finite number.` }; return; }
      if (prev && sameValue(prev.v, value) && prev.s === strength && !event) return;
      n.outputs[port] = { v: value, s: strength, t: this.time };
    }
    n.lastFire = this.time;
    this.activity.nodes.add(n.id);
    const list = this.outEdges.get(n.id);
    if (!list) return;
    const sig: Signal = n.outputs[port] ?? { v: undefined, s: strength, t: this.time };
    for (const e of list) {
      if (e.fromPort !== port || e.blocked) continue;
      if (e.delay > 0) this.schedule({ at: this.time + e.delay, seq: 0, kind: 'deliver', edge: e, sig, event });
      else if (e.deferred) this.pending.push({ edge: e, sig, event });
      else this.deliver(e, sig, event);
    }
  }

  private deliver(e: FlatEdge, sig: Signal, event: boolean) {
    if (!e.enabled || e.blocked) return;
    const dst = this.nodes.get(e.to);
    if (!dst || dst.disabled) return;
    if (++this.deliveriesThisTick > this.maxDeliveries) {
      this.halted = true;
      this.runtimeFlags.push({ level: 'error', message: 'Runaway protection: excessive signal propagation in one tick. Execution was halted.' });
      return;
    }
    const pi = dst.def.inputs.find((p) => p.id === e.toPort) as PortDef;
    let v = sig.v;
    if (v !== undefined) {
      const c = coerceTo(v, pi.type);
      if (c === undefined) { dst.status = { level: 'warn', message: `Input “${pi.label}” received a value that cannot be converted to ${pi.type}.` }; v = undefined; }
      else v = c;
    }
    const s = sig.s * e.weight;
    const prev = dst.inputs[e.toPort];
    if (v === undefined) {
      if (prev === undefined) return;
      dst.inputs[e.toPort] = undefined;
    } else {
      if (prev && sameValue(prev.v, v) && prev.s === s && !event) return;
      dst.inputs[e.toPort] = { v, s, t: sig.t };
    }
    dst.lastRecv = this.time;
    this.activity.edges.add(e.orig);
    // A setting pin changes a setting, exactly like editing it in the inspector: the module re-runs, but nothing
    // "arrived" on its data inputs, so edge-triggered logic (Delay, Counter, Register…) is not fooled.
    if (pi.param !== undefined) this.markDirty(dst, 'init');
    else { dst.changed.add(e.toPort); this.markDirty(dst, 'input'); }
  }

  /** Nodes whose required inputs are driven by a failed module are flagged so errors are visible downstream. */
  private refreshPropagatedErrors() {
    const bad = new Map<string, string>();
    for (const e of this.edges) {
      const src = this.nodes.get(e.from);
      if (src && src.status.level === 'error' && !e.blocked) bad.set(e.to, src.def.name);
    }
    this.propagated = bad;
  }
  propagated = new Map<string, string>();

  // ---- inspection --------------------------------------------------------------------------------------------

  out(id: string, port: string): unknown {
    return this.nodes.get(id)?.outputs[port]?.v;
  }
  outSig(id: string, port: string): Signal | undefined {
    return this.nodes.get(id)?.outputs[port];
  }
  missingInputs(id: string): string[] {
    const n = this.nodes.get(id);
    return n ? n.def.inputs.filter((p) => !p.optional && n.inputs[p.id] === undefined).map((p) => p.label) : [];
  }

  diagnostics(): Diagnostic[] {
    const list: Diagnostic[] = [...this.structural, ...this.runtimeFlags];
    for (const n of this.nodes.values()) {
      if (n.status.level !== 'ok') list.push({ level: n.status.level, nodeId: n.id, message: `${n.def.name}: ${n.status.message}` });
      else {
        const up = this.propagated.get(n.id);
        if (up) list.push({ level: 'warn', nodeId: n.id, message: `${n.def.name}: waiting because upstream module “${up}” failed.` });
      }
    }
    return list;
  }

  /** Take (and clear) the set of things that changed since the last call, for UI refresh. */
  takeActivity(): Activity {
    const a = this.activity;
    this.activity = { nodes: new Set(), edges: new Set() };
    return a;
  }
}
