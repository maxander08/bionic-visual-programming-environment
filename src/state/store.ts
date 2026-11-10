import { create } from 'zustand';
import type { CompoundDef, Graph, Project } from '../core/types';
import { addNode, connect, createCompound, disconnect, duplicateNodes, moveNodes, patchEdge, pruneSettingEdges, removeNodes, setParams, snap } from '../core/graph';
import { TEMPLATES } from '../core/library';
import { cleanName, newProject } from '../core/project';
import { autosave, settingsStore, storageAvailable, userLibrary } from './storage';

export interface Snapshot { graph: Graph; compounds: Record<string, CompoundDef>; name: string }
export interface Settings { snap: boolean; motion: 'system' | 'reduced' | 'full'; minimap: boolean; tickMs: number; speed: number }
export type DialogKind = null | 'templates' | 'projects' | 'share' | 'docs' | 'settings' | 'compound' | 'projector' | 'meter' | 'confirm' | 'group';
export interface Toast { id: number; msg: string; kind: 'info' | 'error' | 'ok' }
export interface ConfirmArg { title: string; body: string; confirm: string; danger?: boolean; onConfirm: () => void }

export const DEFAULT_SETTINGS: Settings = { snap: true, motion: 'system', minimap: true, tickMs: 50, speed: 1 };

interface State {
  project: Project;
  past: Snapshot[];
  future: Snapshot[];
  lastKey: string;
  lastAt: number;
  selection: string[];
  selEdge: string | null;
  run: 'stopped' | 'running' | 'paused';
  settings: Settings;
  userCompounds: Record<string, CompoundDef>;
  ui: { lib: boolean; insp: boolean; libW: number; inspW: number; libTab: 'modules' | 'presets' | 'examples'; dialog: DialogKind; arg?: any; status: boolean };
  toasts: Toast[];
  saveState: 'saved' | 'saving' | 'unsaved' | 'unavailable';
  // actions
  edit(fn: (s: Snapshot) => Snapshot | null, key?: string): void;
  addNodeAt(type: string, x: number, y: number, params?: Record<string, unknown>): string | null;
  addCompoundAt(def: CompoundDef, x: number, y: number): string | null;
  moveNodesTo(pos: Record<string, { x: number; y: number }>): void;
  setNodeParams(id: string, patch: Record<string, unknown>, key?: string): void;
  connectPorts(from: string, fp: string, to: string, tp: string): string | null;
  removeEdge(id: string): void;
  setEdge(id: string, patch: { weight?: number; delay?: number; enabled?: boolean }, key?: string): void;
  removeSelection(): void;
  duplicateSelection(): void;
  toggleDisabled(ids: string[]): void;
  groupSelection(name: string): void;
  updateCompound(id: string, fn: (c: CompoundDef) => CompoundDef): void;
  saveCompoundToLibrary(id: string): void;
  undo(): void;
  redo(): void;
  select(ids: string[], edge?: string | null): void;
  setRun(r: State['run']): void;
  setSettings(p: Partial<Settings>): void;
  setUi(p: Partial<State['ui']>): void;
  openDialog(d: DialogKind, arg?: unknown): void;
  confirm(arg: ConfirmArg): void;
  toast(msg: string, kind?: Toast['kind']): void;
  dismissToast(id: number): void;
  rename(name: string): void;
  setMeta(p: Partial<Pick<Project, 'description' | 'author'>>): void;
  setView(v: { x: number; y: number; k: number }): void;
  openProject(p: Project, note?: string): void;
  newBlank(): void;
}

const initialProject = (): Project => {
  const saved = autosave.read();
  if (saved) return saved;
  const t = TEMPLATES[0].build();
  return t;
};

let toastId = 1;

export const useStore = create<State>((set, get) => ({
  project: initialProject(),
  past: [],
  future: [],
  lastKey: '',
  lastAt: 0,
  selection: [],
  selEdge: null,
  run: 'stopped',
  settings: settingsStore.read(DEFAULT_SETTINGS),
  userCompounds: userLibrary.read(),
  ui: { lib: typeof window === 'undefined' || window.innerWidth > 900, insp: typeof window === 'undefined' || window.innerWidth > 1100, libW: 268, inspW: 316, libTab: 'modules', dialog: null, status: false },
  toasts: [],
  saveState: storageAvailable() ? 'saved' : 'unavailable',

  edit(fn, key) {
    const p = get().project;
    const cur: Snapshot = { graph: p.graph, compounds: p.compounds, name: p.name };
    const next = fn(cur);
    if (!next || (next.graph === cur.graph && next.compounds === cur.compounds && next.name === cur.name)) return;
    const now = Date.now();
    const coalesce = !!key && key === get().lastKey && now - get().lastAt < 800;
    const past = coalesce ? get().past : [...get().past.slice(-99), cur];
    const sel = get().selection.filter((i) => next.graph.nodes[i]);
    const se = get().selEdge && next.graph.edges[get().selEdge!] ? get().selEdge : null;
    set({
      project: { ...p, graph: next.graph, compounds: next.compounds, name: next.name, modified: now },
      past, future: [], lastKey: key ?? '', lastAt: now, selection: sel, selEdge: se, saveState: storageAvailable() ? 'unsaved' : 'unavailable',
    });
  },

  addNodeAt(type, x, y, params) {
    let id: string | null = null;
    get().edit((s) => {
      try {
        const r = addNode(s.graph, type, x, y, params, s.compounds);
        id = r.id;
        return { ...s, graph: r.graph };
      } catch { return null; }
    });
    if (id) set({ selection: [id], selEdge: null });
    return id;
  },

  addCompoundAt(def, x, y) {
    let id: string | null = null;
    get().edit((s) => {
      const compounds = s.compounds[def.id] ? s.compounds : { ...s.compounds, [def.id]: def };
      const r = addNode(s.graph, 'compound', x, y, { def: def.id }, compounds);
      id = r.id;
      return { ...s, graph: r.graph, compounds };
    });
    if (id) set({ selection: [id], selEdge: null });
    return id;
  },

  moveNodesTo(pos) {
    get().edit((s) => ({ ...s, graph: moveNodes(s.graph, pos) }));
  },

  setNodeParams(id, patch, key) {
    get().edit((s) => ({ ...s, graph: setParams(s.graph, id, patch, s.compounds) }), key ? `p:${id}:${key}` : undefined);
  },

  connectPorts(from, fp, to, tp) {
    let err: string | null = null;
    let msg = '';
    get().edit((s) => {
      const r = connect(s.graph, from, fp, to, tp, s.compounds);
      if (r.error) { err = r.error; return null; }
      if (r.replaced) msg = 'Replaced the previous connection: an input has one source.';
      return { ...s, graph: r.graph };
    });
    if (err) get().toast(err, 'error');
    else if (msg) get().toast(msg, 'info');
    return err;
  },

  removeEdge(id) {
    get().edit((s) => ({ ...s, graph: disconnect(s.graph, id) }));
  },
  setEdge(id, patch, key) {
    get().edit((s) => ({ ...s, graph: patchEdge(s.graph, id, patch) }), key ? `e:${id}:${key}` : undefined);
  },

  removeSelection() {
    const { selection, selEdge } = get();
    if (selection.length) get().edit((s) => ({ ...s, graph: removeNodes(s.graph, selection) }));
    else if (selEdge) get().removeEdge(selEdge);
    set({ selection: [], selEdge: null });
  },

  duplicateSelection() {
    const ids = get().selection;
    if (!ids.length) return;
    let map: Record<string, string> = {};
    get().edit((s) => {
      const r = duplicateNodes(s.graph, ids);
      map = r.map;
      return { ...s, graph: r.graph };
    });
    set({ selection: Object.values(map), selEdge: null });
  },

  toggleDisabled(ids) {
    get().edit((s) => {
      const nodes = { ...s.graph.nodes };
      const anyEnabled = ids.some((i) => nodes[i] && !nodes[i].disabled);
      for (const i of ids) if (nodes[i]) nodes[i] = { ...nodes[i], disabled: anyEnabled ? true : undefined };
      return { ...s, graph: { ...s.graph, nodes } };
    });
  },

  groupSelection(name) {
    const ids = get().selection;
    let newId: string | null = null;
    let error = '';
    get().edit((s) => {
      const r = createCompound(s.graph, ids, name, s.compounds);
      if ('error' in r) { error = r.error; return null; }
      newId = r.nodeId;
      return { ...s, graph: r.graph, compounds: { ...s.compounds, [r.def.id]: r.def } };
    });
    if (error) get().toast(error, 'error');
    else if (newId) { set({ selection: [newId] }); get().toast(`Created compound “${name}”. Open it from the inspector.`, 'ok'); }
  },

  updateCompound(id, fn) {
    get().edit((s) => {
      if (!s.compounds[id]) return null;
      const compounds = { ...s.compounds, [id]: fn(s.compounds[id]) };
      // Un-exposing a setting removes its pin: drop connections that ended on it.
      return { ...s, compounds, graph: pruneSettingEdges(s.graph, compounds) };
    }, `c:${id}`);
  },

  saveCompoundToLibrary(id) {
    const def = get().project.compounds[id];
    if (!def) return;
    const lib = { ...get().userCompounds, [id]: def };
    set({ userCompounds: lib });
    const ok = userLibrary.write(lib);
    get().toast(ok ? `Saved “${def.name}” to your library. It is available in other programs.` : 'Could not write to browser storage; export the program to keep this compound.', ok ? 'ok' : 'error');
  },

  undo() {
    const { past, project } = get();
    if (!past.length) return;
    const prev = past[past.length - 1];
    const cur: Snapshot = { graph: project.graph, compounds: project.compounds, name: project.name };
    set({
      project: { ...project, ...prev, modified: Date.now() }, past: past.slice(0, -1), future: [cur, ...get().future].slice(0, 100), lastKey: '',
      selection: get().selection.filter((i) => prev.graph.nodes[i]), selEdge: null,
    });
  },
  redo() {
    const { future, project } = get();
    if (!future.length) return;
    const next = future[0];
    const cur: Snapshot = { graph: project.graph, compounds: project.compounds, name: project.name };
    set({ project: { ...project, ...next, modified: Date.now() }, future: future.slice(1), past: [...get().past, cur], lastKey: '', selection: get().selection.filter((i) => next.graph.nodes[i]), selEdge: null });
  },

  select(ids, edge = null) {
    const a = get().selection;
    if (a.length === ids.length && a.every((x, i) => x === ids[i]) && get().selEdge === edge) return;
    set({ selection: ids, selEdge: edge });
  },
  setRun: (run) => set({ run }),
  setSettings(p) {
    const s = { ...get().settings, ...p };
    set({ settings: s });
    settingsStore.write(s);
  },
  setUi: (p) => {
    const q = { ...p };
    // On narrow screens the panels are overlays: only one at a time.
    if (typeof window !== 'undefined' && window.innerWidth <= 900) { if (q.lib) q.insp = false; else if (q.insp) q.lib = false; }
    set({ ui: { ...get().ui, ...q } });
  },
  openDialog: (dialog, arg) => set({ ui: { ...get().ui, dialog, arg } }),
  confirm(arg) { set({ ui: { ...get().ui, dialog: 'confirm', arg } }); },
  toast(msg, kind = 'info') {
    const id = toastId++;
    set({ toasts: [...get().toasts.slice(-3), { id, msg, kind }] });
    setTimeout(() => get().dismissToast(id), kind === 'error' ? 6000 : 3600);
  },
  dismissToast: (id) => set({ toasts: get().toasts.filter((t) => t.id !== id) }),
  rename(name) {
    get().edit((s) => ({ ...s, name: cleanName(name) }), 'rename');
  },
  setMeta(p) {
    set({ project: { ...get().project, ...p, modified: Date.now() }, saveState: 'unsaved' });
  },
  setView(v) {
    const p = get().project;
    if (p.view && Math.abs(p.view.x - v.x) < 0.5 && Math.abs(p.view.y - v.y) < 0.5 && Math.abs(p.view.k - v.k) < 0.001) return;
    set({ project: { ...p, view: v } });
  },
  openProject(p, note) {
    set({ project: p, past: [], future: [], selection: [], selEdge: null, lastKey: '', saveState: storageAvailable() ? 'unsaved' : 'unavailable', run: 'stopped' });
    if (note) get().toast(note, 'ok');
  },
  newBlank() {
    get().openProject(newProject(), 'New program.');
  },
}));

export const snapOn = () => useStore.getState().settings.snap;
export const snapV = (v: number) => (useStore.getState().settings.snap ? snap(v) : Math.round(v));

/** Imperative hooks into the canvas for other parts of the UI. */
export const bridge: {
  screenToWorld?: (cx: number, cy: number) => { x: number; y: number } | null;
  centerWorld?: () => { x: number; y: number };
  focus?: (ids: string[]) => void;
  fit?: () => void;
  zoomBy?: (f: number) => void;
  resetView?: () => void;
} = {};
