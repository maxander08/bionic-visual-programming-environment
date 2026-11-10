// Connects the editor store to the engine: scheduling, UI notifications, sensors and outputs.
import { useSyncExternalStore } from 'react';
import { Engine } from '../core/engine';
import { flatten } from '../core/graph';
import type { Diagnostic } from '../core/types';
import { useStore } from '../state/store';
import { audio, notificationState, processOutputs, silenceAll, vibrationSupported } from './outputs';
import { stopSensors, syncSensors } from './sensors';

export const engine = new Engine(useStore.getState().settings.tickMs);

const nodeSubs = new Map<string, Set<() => void>>();
const bumps = new Map<string, number>();
const edgeSubs = new Set<(ids: Set<string>) => void>();
const diagSubs = new Set<() => void>();
let diag: Diagnostic[] = [];
let blocked = new Set<string>();
let diagVersion = 0;

export const subscribeNode = (id: string, cb: () => void) => {
  let s = nodeSubs.get(id);
  if (!s) nodeSubs.set(id, (s = new Set()));
  s.add(cb);
  return () => void s!.delete(cb);
};
export const subscribeEdges = (cb: (ids: Set<string>) => void) => (edgeSubs.add(cb), () => void edgeSubs.delete(cb));
export const subscribeDiag = (cb: () => void) => (diagSubs.add(cb), () => void diagSubs.delete(cb));
export const getDiagnostics = () => diag;
export const blockedEdges = () => blocked;

/** Re-render counter for a module (and any compound containing it) — changes whenever it ran. */
export function useNodeVer(id: string): number {
  return useSyncExternalStore(
    (cb) => subscribeNode(id, cb),
    () => (engine.nodes.get(id)?.ver ?? 0) + (bumps.get(id) ?? 0),
  );
}
export function useDiagVersion(): number {
  return useSyncExternalStore(subscribeDiag, () => diagVersion);
}

function bump(id: string) {
  for (let cur = id; ; ) {
    bumps.set(cur, (bumps.get(cur) ?? 0) + 1);
    nodeSubs.get(cur)?.forEach((f) => f());
    const i = cur.lastIndexOf('/');
    if (i < 0) break;
    cur = cur.slice(0, i);
  }
}

let lastDiagAt = 0;
function recomputeDiag(force = false) {
  const now = performance.now();
  if (!force && now - lastDiagAt < 250) return;
  lastDiagAt = now;
  const list = engine.diagnostics();
  for (const n of engine.nodes.values()) {
    if (n.type === 'audio' && audio.state === 'unsupported') list.push({ level: 'warn', nodeId: n.id, message: 'Audio: Web Audio is not available in this browser.' });
    if (n.type === 'audio' && audio.state === 'locked' && useStore.getState().run === 'running') list.push({ level: 'warn', nodeId: n.id, message: 'Audio: sound is locked until you interact with the page. Press Run or Step.' });
    if (n.type === 'haptic' && !vibrationSupported()) list.push({ level: 'warn', nodeId: n.id, message: 'Haptic: this device or browser does not support vibration.' });
    if (n.type === 'notify' && notificationState() !== 'granted') list.push({ level: 'warn', nodeId: n.id, message: `Notify: notification permission is “${notificationState()}”. Use the inspector to request it.` });
  }
  blocked = new Set(engine.edges.filter((e) => e.blocked).map((e) => e.orig));
  const same = list.length === diag.length && list.every((d, i) => d.message === diag[i].message && d.level === diag[i].level);
  if (!same) {
    diag = list;
    diagVersion++;
    diagSubs.forEach((f) => f());
  }
}

let flushQueued = false;
function flush() {
  flushQueued = false;
  const act = engine.takeActivity();
  act.nodes.forEach(bump);
  if (act.edges.size) edgeSubs.forEach((f) => f(act.edges));
  processOutputs(engine, useStore.getState().run === 'running');
  recomputeDiag();
}
const scheduleFlush = () => {
  if (!flushQueued) {
    flushQueued = true;
    requestAnimationFrame(flush);
  }
};

// ---- scheduling (independent of rendering)
let timer: number | undefined;
let last = 0;
let acc = 0;
function pump() {
  const now = performance.now();
  const st = useStore.getState();
  acc += (now - last) * st.settings.speed;
  last = now;
  let n = 0;
  while (acc >= engine.tickMs && n < 8) {
    engine.step(engine.tickMs);
    acc -= engine.tickMs;
    n++;
  }
  if (acc > engine.tickMs * 8) acc = 0; // never spiral after a stall
  if (n) scheduleFlush();
}
function startPump() {
  if (timer !== undefined) return;
  last = performance.now();
  acc = 0;
  timer = window.setInterval(pump, 16);
}
function stopPump() {
  if (timer !== undefined) clearInterval(timer);
  timer = undefined;
}

// A setting pin switched a sensor's source (e.g. simulated → camera): let the drivers follow, just as if it had been
// changed in the inspector. Deferred so it never runs inside the engine's tick.
engine.onSourceChange = () => queueMicrotask(() => syncSensors(engine, useStore.getState().run === 'running'));

export function syncGraph() {
  const { project } = useStore.getState();
  engine.load(flatten(project.graph, project.compounds));
  const run = useStore.getState().run;
  syncSensors(engine, run === 'running');
  recomputeDiag(true);
  scheduleFlush();
}

export function play() {
  const st = useStore.getState();
  if (st.run === 'stopped') engine.reset();
  audio.unlock();
  st.setRun('running');
}
export function pause() {
  useStore.getState().setRun('paused');
}
export function stop() {
  useStore.getState().setRun('stopped');
}
export function togglePlay() {
  useStore.getState().run === 'running' ? pause() : play();
}
/** Manual execution: advance exactly one tick. */
export function stepOnce() {
  const st = useStore.getState();
  if (st.run === 'stopped') { engine.reset(); st.setRun('paused'); }
  audio.unlock();
  engine.step(engine.tickMs);
  scheduleFlush();
}

function onRun(run: 'stopped' | 'running' | 'paused') {
  if (run === 'running') {
    syncSensors(engine, true);
    startPump();
  } else {
    stopPump();
    if (run === 'stopped') {
      engine.reset();
      stopSensors(engine);
      bumps.forEach((_, id) => bump(id));
      silenceAll();
      engine.nodes.forEach((n) => bump(n.id));
    } else syncSensors(engine, false);
  }
  processOutputs(engine, run === 'running');
  recomputeDiag(true);
  scheduleFlush();
}

let prevRun = useStore.getState().run;
let prevGraph = useStore.getState().project.graph;
let prevComp = useStore.getState().project.compounds;
let prevTick = useStore.getState().settings.tickMs;
let queued = false;
useStore.subscribe((s) => {
  if (s.project.graph !== prevGraph || s.project.compounds !== prevComp) {
    prevGraph = s.project.graph;
    prevComp = s.project.compounds;
    if (!queued) {
      queued = true;
      queueMicrotask(() => { queued = false; syncGraph(); });
    }
  }
  if (s.settings.tickMs !== prevTick) {
    prevTick = s.settings.tickMs;
    engine.tickMs = prevTick;
  }
  if (s.run !== prevRun) {
    prevRun = s.run;
    onRun(s.run);
  }
});
syncGraph();

export function useStats() {
  return engine.stats;
}
