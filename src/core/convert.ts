// What the File Converter actor can do, and the small cache that lets a synchronous engine ask for an asynchronous job.
//
// A module's run() cannot wait for a browser to decode a picture or a sound. So run() calls requestConversion(): the first call
// starts the job (through the runner that runtime/convert.ts registers) and answers “pending”; when the job ends the result is
// kept here, subscribers are told, and the node is run again, now getting “ready”. A result is a new file known to the same store
// as every Files node's file (core/files.ts), so a Projector, a Files-style consumer or another converter can use it at once.
import { FILE_KINDS, FILE_KIND_BY_ID, descriptorOf, forgetFile, setFileInfo, type FileDescriptor, type FileInfo, type FileKindId } from './files';
import { hashStr } from './util';

const R = (...f: string[]) => f;

/** Which categories turn into which, and the formats (extensions) each result can have. Only conversions that really work in a browser are listed. */
export const ROUTES: Record<FileKindId, Partial<Record<FileKindId, string[]>>> = {
  document: { text: R('txt', 'md'), web: R('html'), pdf: R('pdf'), compressed: R('zip') },
  text: { text: R('txt', 'md', 'rtf'), document: R('docx'), web: R('html'), pdf: R('pdf'), spreadsheet: R('csv', 'xlsx'), compressed: R('zip') },
  pdf: { compressed: R('zip') },
  audio: { audio: R('wav'), compressed: R('zip') },
  video: { audio: R('wav'), image: R('png', 'jpg', 'webp'), compressed: R('zip') },
  image: { image: R('png', 'jpg', 'webp', 'bmp', 'svg'), pdf: R('pdf'), web: R('html'), compressed: R('zip') },
  spreadsheet: { spreadsheet: R('csv', 'xlsx'), text: R('txt', 'md'), web: R('html'), pdf: R('pdf'), compressed: R('zip') },
  presentation: { text: R('txt', 'md'), web: R('html'), pdf: R('pdf'), compressed: R('zip') },
  executable: { compressed: R('zip') },
  web: { text: R('txt', 'md'), document: R('docx'), pdf: R('pdf'), compressed: R('zip') },
  compressed: { text: R('txt') },
  misc: { compressed: R('zip') },
};

export const SOURCE_KINDS: FileKindId[] = FILE_KINDS.map((k) => k.id);
export const targetsOf = (from: FileKindId): FileKindId[] => Object.keys(ROUTES[from] ?? {}) as FileKindId[];
export const formatsOf = (from: FileKindId, to: FileKindId): string[] => ROUTES[from]?.[to] ?? [];
export const isKindId = (v: unknown): v is FileKindId => typeof v === 'string' && FILE_KIND_BY_ID.has(v as FileKindId);

/** What each format is, for the Format choice: “.PNG · picture, lossless”. */
export const FORMAT_INFO: Record<string, string> = {
  png: 'picture, lossless', jpg: 'photo, small', webp: 'picture, small', bmp: 'picture, uncompressed', svg: 'vector picture wrapper',
  pdf: 'portable document', docx: 'Word document', xlsx: 'Excel workbook', csv: 'table as text', html: 'web page',
  txt: 'plain text', md: 'Markdown text', rtf: 'rich text', wav: 'uncompressed sound', zip: 'archive',
};
export const formatLabel = (f: string) => `.${f.toUpperCase()} · ${FORMAT_INFO[f] ?? f}`;

/** Short route label for a node face: “IMG → PDF”. */
export const routeLabel = (from: FileKindId, to: FileKindId, format: string) =>
  `${FILE_KIND_BY_ID.get(from)?.glyph ?? '?'} → ${format ? format.toUpperCase() : FILE_KIND_BY_ID.get(to)?.glyph ?? '?'}`;

export interface ConvertRequest {
  src: FileDescriptor;
  to: FileKindId;
  /** Extension of the result, without the dot. */
  format: string;
  /** Name for the result without extension; empty keeps the source's name. */
  name: string;
  /** 0.05–1: picture quality for JPEG and WebP, and for pictures drawn into a PDF. */
  quality: number;
}

export type ConvertResult =
  | { status: 'pending' }
  | { status: 'ready'; info: FileInfo; desc: FileDescriptor }
  | { status: 'error'; message: string };

export type Runner = (req: ConvertRequest, id: string) => Promise<FileInfo>;

const results = new Map<string, ConvertResult>();
const subs = new Set<() => void>();
let runner: Runner | undefined;
/** Results kept at once. Older finished ones are thrown away (and their bytes with them) so dragging a quality slider cannot fill the memory. */
const KEEP = 24;

export const setRunner = (r: Runner | undefined) => { runner = r; };
export const subscribeConversions = (cb: () => void) => (subs.add(cb), () => void subs.delete(cb));
const notify = () => subs.forEach((f) => f());

export const requestKey = (r: ConvertRequest) => JSON.stringify([r.src.id, r.src.type, r.to, r.format, r.name, Math.round(r.quality * 100)]);
const resultId = (key: string) => `cv${hashStr(key).toString(36)}${hashStr([...key].reverse().join('')).toString(36)}`;

function trim() {
  if (results.size <= KEEP) return;
  for (const [k, v] of results) {
    if (results.size <= KEEP) break;
    if (v.status === 'pending') continue;
    results.delete(k);
    if (v.status === 'ready') forgetFile(v.info.id);
  }
}

/** The state of a conversion, starting it when nobody has asked for it yet. Never throws. */
export function requestConversion(req: ConvertRequest): ConvertResult {
  const key = requestKey(req);
  const hit = results.get(key);
  if (hit) { results.delete(key); results.set(key, hit); return hit; } // most recently used goes last
  if (!runner) return { status: 'error', message: 'File conversion needs a browser. It is not available here.' };
  const pending: ConvertResult = { status: 'pending' };
  results.set(key, pending);
  const id = resultId(key);
  let job: Promise<FileInfo>;
  try { job = runner(req, id); } catch (e) { job = Promise.reject(e); }
  job.then(
    (info) => {
      setFileInfo(info);
      results.set(key, { status: 'ready', info, desc: descriptorOf(FILE_KIND_BY_ID.get(req.to)!, info) });
      trim();
      notify();
    },
    (e) => { results.set(key, { status: 'error', message: e instanceof Error ? e.message : String(e) }); notify(); },
  );
  return pending;
}

/** Forget every result (used by tests). */
export function clearConversions() { for (const v of results.values()) if (v.status === 'ready') forgetFile(v.info.id); results.clear(); }
