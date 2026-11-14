// The Files section: nodes that hold one file of a given kind. Pure data and helpers — no DOM, no storage.
// The browser side (reading, decoding, persisting) lives in runtime/files.ts; this module only describes the kinds, sorts a
// file name into one, and keeps what has been learned about each loaded file where the node's run() can reach it.
import type { ImageSig } from './types';

export type FileKindId =
  | 'document' | 'text' | 'pdf' | 'audio' | 'video' | 'image' | 'spreadsheet' | 'presentation' | 'executable' | 'web' | 'compressed' | 'font' | 'misc';

export interface FileKind {
  id: FileKindId;
  /** Module type in the registry. */
  type: string;
  name: string;
  caption: string;
  /** Short mark for the library tile. */
  glyph: string;
  /** Extensions without the dot, lower case. Empty for Miscellaneous, which takes everything else. */
  exts: string[];
}

export const FILE_KINDS: FileKind[] = [
  { id: 'document', type: 'file-document', name: 'Document', caption: 'Document File', glyph: 'DOC', exts: ['docx', 'doc'] },
  { id: 'text', type: 'file-text', name: 'Text', caption: 'Text File', glyph: 'TXT', exts: ['md', 'txt', 'rtf'] },
  { id: 'pdf', type: 'file-pdf', name: 'PDF', caption: 'PDF File', glyph: 'PDF', exts: ['pdf'] },
  { id: 'audio', type: 'file-audio', name: 'Audio', caption: 'Audio File', glyph: 'AUD', exts: ['mp3', 'wav', 'm4a', 'flac', 'aac', 'ogg'] },
  { id: 'video', type: 'file-video', name: 'Video', caption: 'Video File', glyph: 'VID', exts: ['mp4', 'mov', 'mkv', 'webm', 'avi'] },
  { id: 'image', type: 'file-image', name: 'Image', caption: 'Image File', glyph: 'IMG', exts: ['jpg', 'jpeg', 'png', 'gif', 'svg', 'webp', 'tiff', 'tif'] },
  { id: 'spreadsheet', type: 'file-spreadsheet', name: 'Spreadsheet', caption: 'Spreadsheet File', glyph: 'XLS', exts: ['xlsx', 'xls', 'csv', 'sql', 'accdb'] },
  { id: 'presentation', type: 'file-presentation', name: 'Presentation', caption: 'Presentation File', glyph: 'PPT', exts: ['pptx'] },
  { id: 'executable', type: 'file-executable', name: 'Executable', caption: 'Executable File', glyph: 'EXE', exts: ['exe', 'msi', 'app', 'bat', 'sh'] },
  { id: 'web', type: 'file-web', name: 'Web', caption: 'Web File', glyph: 'WEB', exts: ['html', 'css', 'js', 'php'] },
  { id: 'compressed', type: 'file-compressed', name: 'Compressed', caption: 'Compressed File', glyph: 'ZIP', exts: ['zip', 'rar', '7z', 'tar', 'gz'] },
  { id: 'font', type: 'file-font', name: 'Font', caption: 'Font File', glyph: 'FNT', exts: ['ttf', 'otf', 'woff2'] },
  { id: 'misc', type: 'file-misc', name: 'Miscellaneous', caption: 'Miscellaneous File', glyph: '···', exts: [] },
];

export const FILE_KIND_BY_ID = new Map(FILE_KINDS.map((k) => [k.id, k]));
export const FILE_KIND_BY_TYPE = new Map(FILE_KINDS.map((k) => [k.type, k]));
export const isFileType = (type: string) => FILE_KIND_BY_TYPE.has(type);

/** Largest file a node accepts. Files are read into memory, so this keeps the tab responsive. */
export const MAX_FILE_BYTES = 256 * 1024 * 1024;
/** Text-like content is read up to this many characters; the rest is cut off (and the node says so). */
export const MAX_TEXT_CHARS = 1_000_000;

/** Lower-case extension without the dot: “Report.Final.PDF” → “pdf”. Empty when there is none. */
export function extOf(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? '';
  const i = base.lastIndexOf('.');
  return i <= 0 || i === base.length - 1 ? '' : base.slice(i + 1).toLowerCase();
}

/** Which kind of node a file belongs to. Anything not listed is Miscellaneous. */
export function classify(name: string): FileKind {
  const e = extOf(name);
  return FILE_KINDS.find((k) => k.exts.includes(e)) ?? FILE_KIND_BY_ID.get('misc')!;
}

/** Does this node kind take a file with this name? */
export const accepts = (kind: FileKind, name: string): boolean => classify(name).id === kind.id;

/** [".DOCX", ".DOC"] for the face and the inspector. Miscellaneous has none: the caller says “any other file” in words. */
export const extList = (kind: FileKind): string[] => kind.exts.map((e) => '.' + e.toUpperCase());

/** Value for <input accept>. Miscellaneous cannot be expressed as an accept list, so it accepts everything and is checked afterwards. */
export const acceptAttr = (kind: FileKind): string | undefined => (kind.exts.length ? kind.exts.map((e) => '.' + e).join(',') : undefined);

export function fmtBytes(n: number): string {
  if (!Number.isFinite(n) || n < 0) return '—';
  if (n < 1024) return `${n} B`;
  const u = ['KB', 'MB', 'GB', 'TB'];
  let v = n / 1024, i = 0;
  while (v >= 1000 && i < u.length - 1) { v /= 1024; i++; }
  return `${v >= 100 ? v.toFixed(0) : v >= 10 ? v.toFixed(1) : v.toFixed(2)} ${u[i]}`;
}

export function fmtDuration(sec: number): string {
  if (!Number.isFinite(sec) || sec < 0) return '—';
  const s = Math.round(sec);
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), r = s % 60;
  const p = (x: number) => String(x).padStart(2, '0');
  return h ? `${h}:${p(m)}:${p(r)}` : `${m}:${p(r)}`;
}

/** What the runtime learned about a loaded file. Optional fields exist only for the kinds that can provide them. */
export interface FileInfo {
  id: string;
  name: string;
  /** Lower case, no dot. */
  ext: string;
  size: number;
  mime: string;
  modified: number;
  /** Readable content (text, web, CSV/SQL, DOCX and PPTX text). */
  text?: string;
  textCut?: boolean;
  lines?: number;
  /** Downscaled picture (images; a video frame for videos). */
  image?: ImageSig;
  /** Full pixel size of an image or video. */
  width?: number;
  height?: number;
  /** Seconds. */
  duration?: number;
  /** Files inside an archive. */
  entries?: number;
  slides?: number;
  /** Fonts: the family and style names inside the file, the number of glyphs, the outline flavour and a version string. */
  family?: string;
  style?: string;
  glyphs?: number;
  fontFormat?: string;
  fontVersion?: string;
  /** Fonts: the name the font is registered under in this page (see runtime/fonts.ts), so previews can draw with it. */
  cssFamily?: string;
  /** An explanation shown in the inspector (not a problem): “text cannot be read from the old .DOC format”. */
  note?: string;
  /** A real problem the node reports as a warning. */
  warn?: string;
}

/** The value that travels on a node's File output. Small, serialisable, and free of the file's bytes. */
export interface FileDescriptor {
  kind: 'file';
  type: FileKindId;
  id: string;
  name: string;
  ext: string;
  size: number;
  mime: string;
  modified: number;
}

export const describeFile = (kind: FileKind, i: FileInfo): FileDescriptor => ({
  kind: 'file', type: kind.id, id: i.id, name: i.name, ext: i.ext, size: i.size, mime: i.mime, modified: i.modified,
});

// ---- the in-memory store -----------------------------------------------------------------------------------------

export type FileState = 'loading' | 'missing';

const infos = new Map<string, FileInfo>();
const states = new Map<string, FileState>();
const descs = new Map<string, FileDescriptor>();
const subs = new Set<() => void>();
let version = 0;
const bump = () => { version++; subs.forEach((f) => f()); };

export const getFileInfo = (id: string): FileInfo | undefined => infos.get(id);
/** `undefined` for a file that is ready (or an id nobody asked about). */
export const fileState = (id: string): FileState | undefined => (infos.has(id) ? undefined : states.get(id));
export function setFileInfo(info: FileInfo) { infos.set(info.id, info); descs.delete(info.id); states.delete(info.id); bump(); }
export function setFileState(id: string, s: FileState | undefined) { if (s) states.set(id, s); else states.delete(id); bump(); }
/** One descriptor object per loaded file, so an unchanged File output is not re-sent downstream. */
export function descriptorOf(kind: FileKind, info: FileInfo): FileDescriptor {
  let d = descs.get(info.id);
  if (!d) descs.set(info.id, (d = describeFile(kind, info)));
  return d;
}
/** Is this value the File record a Files node (or an Actor) sends? */
export function isFileDescriptor(v: unknown): v is FileDescriptor {
  const d = v as Partial<FileDescriptor> | null;
  return !!d && typeof d === 'object' && d.kind === 'file' && typeof d.id === 'string' && typeof d.name === 'string' && FILE_KIND_BY_ID.has(d.type as FileKindId);
}

const forgetters = new Set<(id: string) => void>();
/** Be told when a file the runtime made (a conversion result) is thrown away, so its bytes can go too. */
export const onFileForgotten = (cb: (id: string) => void) => (forgetters.add(cb), () => void forgetters.delete(cb));
/** Throw away what is known about a file made by an Actor. Never used for a file in a Files node. */
export function forgetFile(id: string) {
  infos.delete(id); descs.delete(id); states.delete(id);
  forgetters.forEach((f) => f(id));
}
export const subscribeFiles = (cb: () => void) => (subs.add(cb), () => void subs.delete(cb));
export const filesVersion = () => version;
