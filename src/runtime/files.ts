// Browser side of the Files section: reads a chosen or dropped file, works out what can be known about it (text, picture size,
// duration, slide count…), keeps the bytes in IndexedDB so they survive a reload, and puts the result into a node.
//
// A program only ever stores a file's name, size and an id (see core/modules/files.ts). The bytes live here, in this browser. When a
// program is opened, `hydrate` looks every referenced id up again; ids that are not found are reported as missing, which is what
// happens to a program that was shared or imported from another machine.
import { strFromU8, unzipSync } from 'fflate';
import type { ImageSig } from '../core/types';
import {
  FILE_KIND_BY_TYPE, MAX_FILE_BYTES, descriptorOf, MAX_TEXT_CHARS, accepts, classify, extList, extOf, fmtBytes, getFileInfo, setFileInfo, setFileState, fileState, onFileForgotten,
  type FileInfo, type FileKind,
} from '../core/files';
import { useStore } from '../state/store';
import { tr } from '../i18n';
import { engine } from './session';
import { drawSpecimen, readFont, releaseFont } from './fonts';

// ---- persistence -------------------------------------------------------------------------------------------------

const DB = 'nicque-files';
const LEGACY_DB = 'neural-studio-files';
const STORE = 'files';
interface Rec { id: string; blob: Blob; name: string; type: string; modified: number }

let dbp: Promise<IDBDatabase | null> | undefined;
let legacyDbp: Promise<IDBDatabase | null> | undefined;
function openIdb(name: string, create: boolean): Promise<IDBDatabase | null> {
  return new Promise((resolve) => {
    try {
      if (typeof indexedDB === 'undefined') return resolve(null);
      const r = indexedDB.open(name, 1);
      r.onupgradeneeded = () => { if (create && !r.result.objectStoreNames.contains(STORE)) r.result.createObjectStore(STORE, { keyPath: 'id' }); };
      r.onsuccess = () => {
        if (!create && !r.result.objectStoreNames.contains(STORE)) { r.result.close(); return resolve(null); }
        resolve(r.result);
      };
      r.onerror = () => resolve(null);
      r.onblocked = () => resolve(null);
    } catch { resolve(null); }
  });
}
function db(): Promise<IDBDatabase | null> { return (dbp ??= openIdb(DB, true)); }
function legacyDb(): Promise<IDBDatabase | null> {
  return (legacyDbp ??= (async () => {
    try {
      if (typeof indexedDB === 'undefined') return null;
      if (typeof indexedDB.databases === 'function') {
        const list = await indexedDB.databases();
        if (!list.some((x) => x.name === LEGACY_DB)) return null;
      }
      return await openIdb(LEGACY_DB, false);
    } catch { return null; }
  })());
}
async function idbPut(rec: Rec): Promise<boolean> {
  const d = await db();
  if (!d) return false;
  return new Promise((resolve) => {
    try {
      const tx = d.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put(rec);
      tx.oncomplete = () => resolve(true);
      tx.onerror = tx.onabort = () => resolve(false);
    } catch { resolve(false); }
  });
}
async function idbRead(d: IDBDatabase | null, id: string): Promise<Rec | undefined> {
  if (!d) return undefined;
  return new Promise((resolve) => {
    try {
      const q = d.transaction(STORE, 'readonly').objectStore(STORE).get(id);
      q.onsuccess = () => resolve(q.result as Rec | undefined);
      q.onerror = () => resolve(undefined);
    } catch { resolve(undefined); }
  });
}
async function idbGet(id: string): Promise<Rec | undefined> {
  const hit = await idbRead(await db(), id);
  if (hit) return hit;
  const old = await idbRead(await legacyDb(), id);
  if (old) void idbPut(old); // migrate legacy files transparently
  return old;
}

// ---- the bytes in memory -----------------------------------------------------------------------------------------

// Every file the program holds (a Files node's, or one an Actor made) is reachable by id: the converters read their input here, and
// the Projector window plays or downloads from it. Files from a Files node also live in IndexedDB so they survive a reload; what an
// Actor makes is not kept, it is simply made again when the program runs.
const blobs = new Map<string, Blob>();
export const setBlob = (id: string, blob: Blob) => void blobs.set(id, blob);
export async function getBlob(id: string): Promise<Blob | undefined> {
  const hit = blobs.get(id);
  if (hit) return hit;
  const rec = await idbGet(id);
  if (rec) blobs.set(id, rec.blob);
  return rec?.blob;
}
onFileForgotten((id) => { blobs.delete(id); releaseFont(id); });

// ---- reading -----------------------------------------------------------------------------------------------------

async function readText(file: Blob): Promise<{ text: string; cut: boolean; lines: number }> {
  const raw = await file.slice(0, MAX_TEXT_CHARS * 3).text();
  const cut = raw.length > MAX_TEXT_CHARS || file.size > MAX_TEXT_CHARS * 3;
  const text = raw.length > MAX_TEXT_CHARS ? raw.slice(0, MAX_TEXT_CHARS) : raw;
  const lines = text === '' ? 0 : text.split(/\r\n|\r|\n/).length - (/(\r\n|\r|\n)$/.test(text) ? 1 : 0);
  return { text, cut, lines };
}

const ENT: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
const unent = (s: string) =>
  s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === '#') { const n = e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10); return Number.isFinite(n) && n > 0 && n < 0x110000 ? String.fromCodePoint(n) : m; }
    return ENT[e.toLowerCase()] ?? m;
  });

function docxText(xml: string): string {
  return unent(
    xml.replace(/<w:tab\b[^>]*\/>/g, '\t').replace(/<w:(?:br|cr)\b[^>]*\/>/g, '\n').replace(/<\/w:p>/g, '\n').replace(/<[^>]+>/g, ''),
  ).replace(/\n{3,}/g, '\n\n').trim();
}
function slideText(xml: string): string {
  return unent(xml.replace(/<\/a:p>/g, '\n').replace(/<a:br\b[^>]*\/>/g, '\n').replace(/<[^>]+>/g, '')).replace(/\n{2,}/g, '\n').trim();
}

function scaled(src: CanvasImageSource, w: number, h: number, max: number): ImageSig {
  const k = Math.min(1, max / Math.max(w, h, 1));
  const cv = document.createElement('canvas');
  cv.width = Math.max(1, Math.round(w * k));
  cv.height = Math.max(1, Math.round(h * k));
  const ctx = cv.getContext('2d', { willReadFrequently: true })!;
  ctx.drawImage(src, 0, 0, cv.width, cv.height);
  const d = ctx.getImageData(0, 0, cv.width, cv.height);
  return { w: d.width, h: d.height, data: d.data };
}

function decodeImage(file: Blob): Promise<{ image: ImageSig; width: number; height: number } | null> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const im = new Image();
    const done = (v: { image: ImageSig; width: number; height: number } | null) => { URL.revokeObjectURL(url); resolve(v); };
    im.onload = () => {
      try {
        // An SVG without a size of its own reports 0×0: give it a square canvas.
        const w = im.naturalWidth || 256, h = im.naturalHeight || 256;
        done({ image: scaled(im, w, h, 256), width: w, height: h });
      } catch { done(null); }
    };
    im.onerror = () => done(null);
    im.src = url;
  });
}

interface MediaMeta { duration?: number; width?: number; height?: number; frame?: ImageSig }
function probeMedia(file: Blob, video: boolean): Promise<MediaMeta> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const el = document.createElement(video ? 'video' : 'audio');
    el.preload = 'metadata';
    el.muted = true;
    let part: MediaMeta = {};
    let over = false;
    const finish = () => {
      if (over) return;
      over = true;
      clearTimeout(timer);
      el.removeAttribute('src');
      try { el.load(); } catch { /* nothing to release */ }
      URL.revokeObjectURL(url);
      resolve(part);
    };
    const timer = setTimeout(finish, 8000);
    el.onerror = finish;
    el.onloadedmetadata = () => {
      part.duration = Number.isFinite(el.duration) ? Math.round(el.duration * 1000) / 1000 : undefined;
      if (!video) return finish();
      const v = el as HTMLVideoElement;
      part = { ...part, width: v.videoWidth || undefined, height: v.videoHeight || undefined };
      v.onseeked = () => {
        try { if (v.videoWidth) part.frame = scaled(v, v.videoWidth, v.videoHeight, 256); } catch { /* no still frame */ }
        finish();
      };
      try { v.currentTime = part.duration ? Math.min(1, part.duration / 10) : 0; } catch { finish(); }
    };
    el.src = url;
  });
}

const TEXT_KINDS = new Set(['text', 'web']);

/** Work out everything the node can offer about a file. Never throws: problems become `warn` or `note` on the result. */
export async function analyse(id: string, file: File): Promise<FileInfo> {
  const kind = classify(file.name);
  const ext = extOf(file.name);
  const info: FileInfo = { id, name: file.name, ext, size: file.size, mime: file.type || '', modified: file.lastModified || 0 };
  const readable = TEXT_KINDS.has(kind.id) || (kind.id === 'spreadsheet' && (ext === 'csv' || ext === 'sql'));
  try {
    if (readable) {
      const r = await readText(file);
      info.text = r.text; info.lines = r.lines; info.textCut = r.cut;
      if (r.cut) info.warn = 'The file is longer than 1 000 000 characters: Content holds only the first part.';
    } else if (kind.id === 'document') {
      if (ext === 'docx') {
        try {
          const z = unzipSync(new Uint8Array(await file.arrayBuffer()), { filter: (f) => f.name === 'word/document.xml' });
          const xml = z['word/document.xml'];
          if (!xml) throw new Error('no body');
          info.text = docxText(strFromU8(xml));
        } catch { info.warn = 'The text of this document could not be read. It may be damaged or password-protected.'; }
      } else info.note = 'The old binary .DOC format is stored, but its text cannot be read in the browser. Save it as .DOCX to get the text.';
    } else if (kind.id === 'presentation') {
      try {
        const z = unzipSync(new Uint8Array(await file.arrayBuffer()), { filter: (f) => /^ppt\/slides\/slide\d+\.xml$/.test(f.name) });
        const names = Object.keys(z).sort((a, b) => parseInt(a.replace(/\D/g, ''), 10) - parseInt(b.replace(/\D/g, ''), 10));
        info.slides = names.length;
        info.text = names.map((n, i) => `Slide ${i + 1}\n${slideText(strFromU8(z[n]))}`).join('\n\n');
      } catch { info.warn = 'The slides of this presentation could not be read. It may be damaged.'; }
    } else if (kind.id === 'compressed') {
      if (ext === 'zip') {
        try {
          const names: string[] = [];
          unzipSync(new Uint8Array(await file.arrayBuffer()), { filter: (f) => { names.push(f.name); return false; } });
          info.entries = names.filter((n) => !n.endsWith('/')).length;
        } catch { info.warn = 'This ZIP archive could not be read. It may be damaged.'; }
      } else info.note = 'Only .ZIP archives are looked into. This type is stored but not opened.';
    } else if (kind.id === 'image') {
      const r = await decodeImage(file);
      if (r) { info.image = r.image; info.width = r.width; info.height = r.height; }
      else info.warn = 'This browser could not decode the picture (TIFF is not supported by most browsers), so there is no Image output.';
    } else if (kind.id === 'audio' || kind.id === 'video') {
      const m = await probeMedia(file, kind.id === 'video');
      info.duration = m.duration; info.width = m.width; info.height = m.height; info.image = m.frame;
      if (m.duration === undefined) info.note = 'This browser could not read the file’s header (its format is not supported here). The file is stored, but there is no length or size.';
    } else if (kind.id === 'font') {
      const r = await readFont(id, file);
      const m = r.meta;
      info.family = r.family.slice(0, 80);
      if (m) {
        info.style = m.style?.slice(0, 60); info.glyphs = m.glyphs; info.fontVersion = m.version?.replace(/^version\s*/i, '').slice(0, 80);
        info.fontFormat = `${m.container} · ${m.outlines === 'CFF' ? 'CFF (PostScript) outlines' : m.outlines === 'TrueType' ? 'TrueType outlines' : 'unknown outlines'}`;
      }
      if (r.css) { info.cssFamily = r.css; info.image = drawSpecimen(r.css, info.family) ?? undefined; }
      if (!m && !r.css) info.warn = 'This file is not a font this browser can read. It may be damaged or have the wrong extension, so there is no Specimen.';
      else if (!r.css) info.warn = 'This browser refused to load the font (it may be damaged or use an unsupported variant), so there is no Specimen or live preview.';
      else if (m && !m.complete) info.note = 'WOFF2 fonts are compressed. This browser cannot unpack the names inside, so the family comes from the file name and the glyph count is unknown. The font itself works.';
      else if (!m) info.note = 'The font works, but its names could not be read, so the family comes from the file name.';
    } else if (kind.id === 'spreadsheet') info.note = 'Workbooks and databases are stored but their cells are not read. Use .CSV for readable content.';
    else if (kind.id === 'executable') info.note = 'Executables are only described. They are never run.';
    else if (kind.id === 'pdf') info.note = 'The text inside a PDF is not extracted.';
  } catch {
    info.warn = 'The file could not be read.';
  }
  return info;
}

// ---- putting a file into a node ----------------------------------------------------------------------------------

const newId = () => `f${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
const toast = (msg: string, kind: 'info' | 'error' | 'ok' = 'info') => useStore.getState().toast(msg, kind);

export const FILE_PARAMS_EMPTY = { fileId: '', fileName: '', fileExt: '', fileSize: '', fileMime: '', fileModified: '' };

/** The reason a node of this kind turns a file away, or null when it takes it. Already translated. */
export function refusal(kind: FileKind, file: { name: string; size: number }): string | null {
  if (file.size > MAX_FILE_BYTES) return tr('“{name}” is {size}. A Files node holds up to {max}.', { name: file.name, size: fmtBytes(file.size), max: fmtBytes(MAX_FILE_BYTES) });
  if (accepts(kind, file.name)) return null;
  const target = classify(file.name);
  if (kind.id === 'misc') return tr('The Miscellaneous node takes only files that no other Files node accepts. “{name}” belongs in a {target} node.', { name: file.name, target: tr(target.name) });
  return tr('This {node} node takes {list}. “{name}” belongs in a {target} node.', { node: tr(kind.name), list: extList(kind).join(', '), name: file.name, target: tr(target.name) });
}

/** Load a file into a Files node. Returns true when the node now holds it; otherwise it has told the user why not. */
export async function loadFile(nodeId: string, file: File): Promise<boolean> {
  const node = useStore.getState().project.graph.nodes[nodeId];
  const kind = node && FILE_KIND_BY_TYPE.get(node.type);
  if (!node || !kind) return false;
  const why = refusal(kind, file);
  if (why) { toast(why, 'error'); return false; }
  const id = newId();
  setFileState(id, 'loading');
  let info: FileInfo;
  try { info = await analyse(id, file); } catch { setFileState(id, undefined); toast(tr('Could not read “{name}”.', { name: file.name }), 'error'); return false; }
  setFileInfo(info);
  setBlob(id, file);
  const kept = await idbPut({ id, blob: file, name: file.name, type: file.type, modified: file.lastModified });
  // The node may have been deleted while the file was being read.
  if (!useStore.getState().project.graph.nodes[nodeId]) return false;
  useStore.getState().setNodeParams(nodeId, {
    fileId: id, fileName: file.name, fileExt: info.ext, fileSize: String(file.size), fileMime: file.type, fileModified: String(file.lastModified || 0),
  });
  toast(tr('“{name}” is in the node.', { name: file.name }), 'ok');
  if (!kept) toast(tr('The file could not be saved in this browser, so it will be gone after a reload.'), 'info');
  return true;
}

/** Empty a Files node. The stored bytes stay, so Undo brings the file back. */
export function clearFile(nodeId: string) {
  useStore.getState().setNodeParams(nodeId, FILE_PARAMS_EMPTY);
}

/** Files dropped on empty workspace: each one gets a node of the matching kind, side by side, and is loaded into it. */
export async function dropOnWorkspace(files: File[], at: { x: number; y: number }) {
  let i = 0;
  for (const f of files) {
    const kind = classify(f.name);
    if (f.size > MAX_FILE_BYTES) { toast(refusal(kind, f)!, 'error'); continue; }
    const id = useStore.getState().addNodeAt(kind.type, at.x + i * 168, at.y);
    i++;
    if (id) await loadFile(id, f);
  }
}

// ---- previewing: every Files node can be shown in a Projector ------------------------------------------------------------------------

/** The Projector (if any) already wired to this node's File output. */
function wiredProjector(nodeId: string): string | null {
  const g = useStore.getState().project.graph;
  for (const e of Object.values(g.edges)) if (e.from === nodeId && e.fromPort === 'file' && g.nodes[e.to]?.type === 'projector') return e.to;
  return null;
}

/** Open the Projector's full-size window on the file in a node, without needing a Projector on the workspace. */
export function openFilePreview(nodeId: string): boolean {
  const st = useStore.getState();
  const node = st.project.graph.nodes[nodeId];
  const kind = node && FILE_KIND_BY_TYPE.get(node.type);
  const id = node && String(node.params.fileId ?? '');
  const info = id ? getFileInfo(id) : undefined;
  if (!node || !kind || !info) { st.toast(tr('Put a file in the node first.'), 'info'); return false; }
  st.openDialog('projector', { value: descriptorOf(kind, info), title: `${tr(kind.name)} · ${info.name}` });
  return true;
}

/**
 * Wire the node's File output to a Projector, so the file is previewed on the workspace and in the full-size window whatever its
 * kind: the Projector chooses how to show it (a picture, a player, the text, a table, a font specimen, a hex dump…). An existing
 * Projector already connected to the node is reused; otherwise one is placed on the first free spot below the node.
 */
export function connectToProjector(nodeId: string): string | null {
  const st = useStore.getState();
  const g = st.project.graph;
  const node = g.nodes[nodeId];
  if (!node || !FILE_KIND_BY_TYPE.has(node.type)) return null;
  const have = wiredProjector(nodeId);
  if (have) { st.select([have]); st.toast(tr('This file is already connected to a Projector.'), 'info'); return have; }
  const taken = Object.values(g.nodes);
  const free = (x: number, y: number) => !taken.some((n) => Math.abs(n.x - x) < 150 && Math.abs(n.y - y) < 150);
  let x = node.x, y = node.y + 168;
  for (let i = 0; i < 12 && !free(x, y); i++) { x += 168; if (i === 5) { x = node.x; y += 168; } }
  const pid = st.addNodeAt('projector', x, y);
  if (!pid) return null;
  useStore.getState().connectPorts(nodeId, 'file', pid, 'in');
  useStore.getState().select([pid]);
  return pid;
}

// ---- coming back after a reload -----------------------------------------------------------------------------------

const asking = new Set<string>();

function refresh(id: string) {
  for (const n of engine.nodes.values()) if (n.params.fileId === id) engine.inject(n.id, {});
}

/** Look up every file the open program refers to that this session has not seen yet. */
export function hydrate() {
  const { project } = useStore.getState();
  const ids = new Set<string>();
  const scan = (nodes: Record<string, { type: string; params: Record<string, unknown> }>) => {
    for (const n of Object.values(nodes)) if (FILE_KIND_BY_TYPE.has(n.type) && typeof n.params.fileId === 'string' && n.params.fileId) ids.add(n.params.fileId);
  };
  scan(project.graph.nodes);
  for (const c of Object.values(project.compounds)) scan(c.graph.nodes);
  for (const id of ids) {
    if (getFileInfo(id) || asking.has(id) || fileState(id)) continue;
    asking.add(id);
    setFileState(id, 'loading');
    void idbGet(id).then(async (rec) => {
      if (!rec) { setFileState(id, 'missing'); return; }
      setBlob(id, rec.blob);
      const f = new File([rec.blob], rec.name, { type: rec.type, lastModified: rec.modified });
      setFileInfo(await analyse(id, f));
    }).catch(() => setFileState(id, 'missing')).finally(() => { asking.delete(id); refresh(id); });
  }
}

let prevGraph = useStore.getState().project.graph;
useStore.subscribe((s) => {
  if (s.project.graph !== prevGraph) { prevGraph = s.project.graph; hydrate(); }
});
hydrate();

// A file dropped anywhere else would make the browser leave the editor and open it. Swallow those drops.
if (typeof window !== 'undefined') {
  const isFiles = (e: DragEvent) => Array.from(e.dataTransfer?.types ?? []).includes('Files');
  window.addEventListener('dragover', (e) => { if (isFiles(e)) { e.preventDefault(); if (e.dataTransfer && !e.defaultPrevented) e.dataTransfer.dropEffect = 'none'; } });
  window.addEventListener('drop', (e) => { if (isFiles(e)) e.preventDefault(); });
}
