// Project format, import validation and the compact share code.
import { Inflate, deflateSync, strFromU8, strToU8 } from 'fflate';
import type { CompoundDef, CompoundPort, Edge, Graph, NodeInst, Project } from './types';
import { defaultParams, getDef } from './registry';
import { sanitizeGraph } from './graph';
import { crc32, uid } from './util';

export const FORMAT_VERSION = 1;
export const MAX_IMPORT_BYTES = 8 * 1024 * 1024;

export function newProject(name = 'Untitled program'): Project {
  const t = Date.now();
  return { format: 'neural-studio', version: 1, id: uid('p'), name, description: '', author: '', created: t, modified: t, graph: { nodes: {}, edges: {} }, compounds: {} };
}

export function cleanName(s: unknown, fallback = 'Untitled program'): string {
  const t = typeof s === 'string' ? s.replace(/\s+/g, ' ').trim().slice(0, 80) : '';
  return t || fallback;
}

/** Plain, versioned JSON. Only serialisable data lives in a Project, so this is a straight copy. */
export function serializeProject(p: Project): string {
  return JSON.stringify(p, null, 1);
}

export interface ParseResult {
  project?: Project;
  error?: string;
  problems: string[];
}

function sanitizeCompound(raw: any, all: Record<string, CompoundDef>, problems: string[]): CompoundDef | null {
  if (!raw || typeof raw.id !== 'string' || !/^[\w.-]{1,60}$/.test(raw.id) || typeof raw.graph !== 'object') { problems.push('Skipped an invalid compound definition.'); return null; }
  const { graph, problems: pr } = sanitizeGraph(raw.graph, all);
  problems.push(...pr);
  const port = (p: any): CompoundPort | null => {
    if (!p || typeof p.id !== 'string' || typeof p.nodeId !== 'string' || typeof p.port !== 'string') return null;
    const n = graph.nodes[p.nodeId];
    if (!n) return null;
    return { id: p.id, label: String(p.label ?? p.id).slice(0, 60), type: p.type, nodeId: p.nodeId, port: p.port };
  };
  const ins = (Array.isArray(raw.inputs) ? raw.inputs : []).map(port).filter(Boolean) as CompoundPort[];
  const outs = (Array.isArray(raw.outputs) ? raw.outputs : []).map(port).filter(Boolean) as CompoundPort[];
  const exposed = (Array.isArray(raw.exposed) ? raw.exposed : []).filter((e: any) => e && typeof e.key === 'string' && graph.nodes[e.nodeId] && typeof e.param === 'string').map((e: any) => ({ key: e.key, label: String(e.label ?? e.key).slice(0, 60), nodeId: e.nodeId, param: e.param }));
  return { id: raw.id, name: cleanName(raw.name, 'Compound'), description: typeof raw.description === 'string' ? raw.description.slice(0, 400) : '', graph, inputs: ins, outputs: outs, exposed };
}

export function sanitizeCompounds(raw: unknown, problems: string[]): Record<string, CompoundDef> {
  const out: Record<string, CompoundDef> = {};
  const list = (raw && typeof raw === 'object' ? Object.values(raw as Record<string, unknown>) : []) as any[];
  const ids = new Set(list.map((r) => r?.id));
  const refs = (r: any): string[] => Object.values(r?.graph?.nodes ?? {}).filter((n: any) => n?.type === 'compound').map((n: any) => String(n.params?.def));
  const todo = [...list];
  // Resolve in dependency order so compounds may reference each other regardless of ordering.
  for (let guard = 0; todo.length && guard < list.length + 1; guard++) {
    for (let i = 0; i < todo.length; i++) {
      const r = todo[i];
      if (refs(r).every((d) => out[d] || !ids.has(d))) {
        const c = sanitizeCompound(r, out, problems);
        if (c) out[c.id] = c;
        todo.splice(i--, 1);
      }
    }
  }
  if (todo.length) problems.push('Skipped compounds with circular references.');
  return out;
}

export function validateProject(raw: unknown): ParseResult {
  const problems: string[] = [];
  if (!raw || typeof raw !== 'object') return { error: 'This is not a Neural Studio program (expected a JSON object).', problems };
  const r = raw as any;
  if (r.format !== 'neural-studio') return { error: 'This file is not a Neural Studio program (missing format marker).', problems };
  if (typeof r.version !== 'number' || r.version > FORMAT_VERSION) return { error: `Unsupported program version ${String(r.version)}. This build understands version ${FORMAT_VERSION}.`, problems };
  if (!r.graph || typeof r.graph !== 'object' || typeof r.graph.nodes !== 'object') return { error: 'The program contains no graph.', problems };
  const compounds = sanitizeCompounds(r.compounds ?? {}, problems);
  const { graph, problems: gp } = sanitizeGraph(r.graph, compounds);
  problems.push(...gp);
  for (const n of Object.values(graph.nodes)) if (n.type === 'compound' && !compounds[String(n.params.def)]) { problems.push(`Compound “${String(n.params.def)}” is missing; the module was removed.`); delete graph.nodes[n.id]; }
  const t = Date.now();
  const view = r.view && Number.isFinite(r.view.x) && Number.isFinite(r.view.y) && Number.isFinite(r.view.k) ? { x: r.view.x, y: r.view.y, k: Math.max(0.1, Math.min(3, r.view.k)) } : undefined;
  const project: Project = {
    format: 'neural-studio', version: 1, id: typeof r.id === 'string' && /^[\w.-]{1,60}$/.test(r.id) ? r.id : uid('p'), name: cleanName(r.name), description: typeof r.description === 'string' ? r.description.slice(0, 600) : '',
    author: typeof r.author === 'string' ? r.author.slice(0, 60) : '', created: Number.isFinite(r.created) ? r.created : t, modified: Number.isFinite(r.modified) ? r.modified : t, graph, compounds, view,
  };
  return { project, problems };
}

export function parseProjectJSON(text: string): ParseResult {
  if (text.length > MAX_IMPORT_BYTES) return { error: 'File is too large to import (limit 8 MB).', problems: [] };
  try {
    return validateProject(JSON.parse(text));
  } catch {
    return { error: 'This is not valid JSON. The file may be damaged or is not a program.', problems: [] };
  }
}

// ---- share code -----------------------------------------------------------------------------------------------
// Format:  NS1.<base64url(deflate(compact JSON))>.<crc32 hex>
// The CRC32 detects accidental corruption only. It is not a signature and offers no protection against tampering.

const PREFIX = 'NS1';
export const QR_BYTE_LIMIT = 2900;

function b64urlEncode(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function b64urlDecode(s: string): Uint8Array {
  const t = s.replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(t + '='.repeat((4 - (t.length % 4)) % 4));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function diffParams(n: NodeInst, compounds: Record<string, CompoundDef>): Record<string, unknown> {
  const def = getDef(n.type, compounds, n.params);
  if (!def) return n.params;
  const dflt = defaultParams(def, n.params);
  const o: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(n.params)) if (k === 'def' || JSON.stringify(dflt[k]) !== JSON.stringify(v)) o[k] = v;
  return o;
}
const packGraph = (g: Graph, comp: Record<string, CompoundDef>) => ({
  N: Object.values(g.nodes).map((n) => [n.id, n.type, n.x, n.y, diffParams(n, comp), ...(n.disabled ? [1] : [])]),
  E: Object.values(g.edges).map((e) => [e.id, e.from, e.fromPort, e.to, e.toPort, ...(e.weight !== 1 || e.delay || !e.enabled ? [e.weight, e.delay, e.enabled ? 1 : 0] : [])]),
});
const unpackGraph = (p: any): Graph => {
  const g: Graph = { nodes: {}, edges: {} };
  for (const a of Array.isArray(p?.N) ? p.N : []) if (Array.isArray(a)) g.nodes[a[0]] = { id: a[0], type: a[1], x: a[2], y: a[3], params: a[4] ?? {}, ...(a[5] ? { disabled: true } : {}) };
  for (const a of Array.isArray(p?.E) ? p.E : [])
    if (Array.isArray(a)) g.edges[a[0]] = { id: a[0], from: a[1], fromPort: a[2], to: a[3], toPort: a[4], weight: a[5] ?? 1, delay: a[6] ?? 0, enabled: a[7] === undefined ? true : !!a[7] } as Edge;
  return g;
};

export function encodeShare(p: Project): string {
  const compact = {
    n: p.name, ...(p.description ? { d: p.description } : {}), ...(p.author ? { a: p.author } : {}),
    ...packGraph(p.graph, p.compounds),
    ...(Object.keys(p.compounds).length ? { C: Object.values(p.compounds).map((c) => ({ i: c.id, n: c.name, d: c.description, ...packGraph(c.graph, p.compounds), In: c.inputs, Out: c.outputs, X: c.exposed })) } : {}),
  };
  const payload = b64urlEncode(deflateSync(strToU8(JSON.stringify(compact)), { level: 9 }));
  return `${PREFIX}.${payload}.${crc32(payload).toString(16).padStart(8, '0')}`;
}

export function decodeShare(codeRaw: string): ParseResult {
  const code = codeRaw.replace(/\s+/g, '');
  const parts = code.split('.');
  if (parts.length !== 3 || parts[0] !== PREFIX) return { error: parts[0]?.startsWith('NS') ? `Unsupported share code version “${parts[0]}”.` : 'This does not look like a Neural Studio share code (it should start with “NS1.”).', problems: [] };
  if (!/^[A-Za-z0-9_-]*$/.test(parts[1]) || !/^[0-9a-f]{8}$/.test(parts[2])) return { error: 'The share code contains invalid characters. It may have been truncated or altered.', problems: [] };
  if (crc32(parts[1]).toString(16).padStart(8, '0') !== parts[2]) return { error: 'Checksum mismatch: the code is corrupted or was edited. Copy it again in full.', problems: [] };
  let json: string;
  try {
    const chunks: Uint8Array[] = [];
    let total = 0;
    const inf = new Inflate((d) => {
      total += d.length;
      if (total > MAX_IMPORT_BYTES) throw new Error('too large');
      chunks.push(d);
    });
    inf.push(b64urlDecode(parts[1]), true);
    const all = new Uint8Array(total);
    let o = 0;
    for (const c of chunks) { all.set(c, o); o += c.length; }
    json = strFromU8(all);
  } catch (e) {
    return { error: e instanceof Error && e.message === 'too large' ? 'The decoded program is too large (limit 8 MB).' : 'The share code could not be decompressed. It is damaged.', problems: [] };
  }
  let c: any;
  try { c = JSON.parse(json); } catch { return { error: 'The share code decoded to unreadable data.', problems: [] }; }
  const t = Date.now();
  const raw = {
    format: 'neural-studio', version: 1, name: c.n, description: c.d ?? '', author: c.a ?? '', created: t, modified: t,
    graph: unpackGraph(c),
    compounds: Object.fromEntries((Array.isArray(c.C) ? c.C : []).map((x: any) => [x.i, { id: x.i, name: x.n, description: x.d ?? '', graph: unpackGraph(x), inputs: x.In ?? [], outputs: x.Out ?? [], exposed: x.X ?? [] }])),
  };
  return validateProject(raw);
}

export async function sha256Hex(text: string): Promise<string | null> {
  try {
    const subtle = globalThis.crypto?.subtle;
    if (!subtle) return null;
    const buf = await subtle.digest('SHA-256', strToU8(text));
    return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('');
  } catch {
    return null;
  }
}
