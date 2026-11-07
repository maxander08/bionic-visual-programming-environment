// Browser storage with graceful fallback (private mode, file:// restrictions, quota).
import type { CompoundDef, Project } from '../core/types';
import { parseProjectJSON, sanitizeCompounds, serializeProject } from '../core/project';

const mem = new Map<string, string>();
let store: Storage | null | undefined;

function ls(): Storage | null {
  if (store !== undefined) return store;
  try {
    const s = window.localStorage;
    s.setItem('__ns_probe', '1');
    s.removeItem('__ns_probe');
    store = s;
  } catch {
    store = null;
  }
  return store;
}

export const storageAvailable = () => ls() !== null;

function get(k: string): string | null {
  try {
    return ls() ? ls()!.getItem(k) : (mem.get(k) ?? null);
  } catch {
    return mem.get(k) ?? null;
  }
}
function set(k: string, v: string): boolean {
  try {
    if (ls()) ls()!.setItem(k, v);
    else mem.set(k, v);
    return true;
  } catch {
    mem.set(k, v);
    return false;
  }
}
function remove(k: string) {
  try {
    ls()?.removeItem(k);
  } catch { /* ignore */ }
  mem.delete(k);
}

export interface SavedInfo { id: string; name: string; modified: number; nodes: number }

const INDEX = 'ns:index';
const readIndex = (): SavedInfo[] => {
  try {
    const v = JSON.parse(get(INDEX) ?? '[]');
    return Array.isArray(v) ? v : [];
  } catch { return []; }
};

export const projects = {
  list: (): SavedInfo[] => readIndex().sort((a, b) => b.modified - a.modified),
  save(p: Project): boolean {
    const ok = set(`ns:proj:${p.id}`, serializeProject({ ...p, modified: Date.now() }));
    const idx = readIndex().filter((x) => x.id !== p.id);
    idx.push({ id: p.id, name: p.name, modified: Date.now(), nodes: Object.keys(p.graph.nodes).length });
    return set(INDEX, JSON.stringify(idx)) && ok;
  },
  load(id: string): Project | null {
    const t = get(`ns:proj:${id}`);
    return t ? (parseProjectJSON(t).project ?? null) : null;
  },
  remove(id: string) {
    remove(`ns:proj:${id}`);
    set(INDEX, JSON.stringify(readIndex().filter((x) => x.id !== id)));
  },
};

export const autosave = {
  write: (p: Project) => set('ns:autosave', serializeProject(p)),
  read: (): Project | null => {
    const t = get('ns:autosave');
    return t ? (parseProjectJSON(t).project ?? null) : null;
  },
};

export const userLibrary = {
  read(): Record<string, CompoundDef> {
    try {
      return sanitizeCompounds(JSON.parse(get('ns:lib') ?? '{}'), []);
    } catch { return {}; }
  },
  write: (c: Record<string, CompoundDef>) => set('ns:lib', JSON.stringify(c)),
};

export const settingsStore = {
  read<T extends object>(d: T): T {
    try {
      return { ...d, ...JSON.parse(get('ns:settings') ?? '{}') };
    } catch { return d; }
  },
  write: (s: object) => set('ns:settings', JSON.stringify(s)),
};

export function clearAll() {
  try { ls()?.clear(); } catch { /* ignore */ }
  mem.clear();
}
