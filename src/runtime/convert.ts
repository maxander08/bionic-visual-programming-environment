// Browser side of the File Converter actor. core/convert.ts decides *what* may be converted and keeps the results; this module does the
// work that needs a browser — decoding pictures and sound, drawing on a canvas, reading the bytes of the input — and hands plain bytes
// to the pure builders in core/formats.ts. It registers itself as the runner when imported (see main.tsx).
import { strToU8 } from 'fflate';
import { FILE_KIND_BY_ID, getFileInfo, type FileInfo, type FileKindId } from '../core/files';
import { setRunner, subscribeConversions, type ConvertRequest } from '../core/convert';
import * as F from '../core/formats';
import { analyse, getBlob, setBlob } from './files';
import { engine } from './session';

const MAX_SIDE = 8192;
/** Largest WAV written (bytes). A WAV is uncompressed, so a long recording gets big quickly. */
const MAX_WAV = 256 * 1024 * 1024;

const fail = (msg: string): never => { throw new Error(msg); };

// ---- pictures ------------------------------------------------------------------------------------------------------------------

function loadImage(blob: Blob): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const im = new Image();
    im.onload = () => { URL.revokeObjectURL(url); resolve(im); };
    im.onerror = () => { URL.revokeObjectURL(url); reject(new Error('This browser could not decode the picture, so it cannot be converted. (TIFF is not supported by most browsers.)')); };
    im.src = url;
  });
}

interface Raster { cv: HTMLCanvasElement; w: number; h: number }

function canvasOf(src: CanvasImageSource, w: number, h: number, white: boolean): Raster {
  const k = Math.min(1, MAX_SIDE / Math.max(w, h, 1));
  const cv = document.createElement('canvas');
  cv.width = Math.max(1, Math.round(w * k));
  cv.height = Math.max(1, Math.round(h * k));
  const ctx = cv.getContext('2d', { willReadFrequently: true });
  if (!ctx) return fail('This browser cannot draw pictures, so it cannot convert them.');
  if (white) { ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, cv.width, cv.height); }
  ctx.drawImage(src, 0, 0, cv.width, cv.height);
  return { cv, w: cv.width, h: cv.height };
}

async function rasterOfImage(blob: Blob, white: boolean): Promise<Raster> {
  const im = await loadImage(blob);
  // An SVG with no size of its own reports 0×0.
  return canvasOf(im, im.naturalWidth || 1024, im.naturalHeight || 1024, white);
}

function frameOfVideo(blob: Blob, white: boolean): Promise<Raster> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const v = document.createElement('video');
    v.preload = 'metadata'; v.muted = true;
    const done = (r: Raster | Error) => { clearTimeout(timer); v.removeAttribute('src'); try { v.load(); } catch { /* nothing to release */ } URL.revokeObjectURL(url); r instanceof Error ? reject(r) : resolve(r); };
    const timer = setTimeout(() => done(new Error('This browser could not read a picture from the video in time.')), 15000);
    v.onerror = () => done(new Error('This browser could not decode the video (its format is not supported here), so no still frame can be taken.'));
    v.onloadedmetadata = () => { try { v.currentTime = Number.isFinite(v.duration) && v.duration > 0 ? Math.min(1, v.duration / 10) : 0; } catch { done(new Error('The video could not be searched.')); } };
    v.onseeked = () => { try { done(v.videoWidth ? canvasOf(v, v.videoWidth, v.videoHeight, white) : new Error('The video has no picture.')); } catch (e) { done(e as Error); } };
    v.src = url;
  });
}

const encode = async (r: Raster, type: string, q: number): Promise<Blob> => {
  const b = await new Promise<Blob | null>((res) => r.cv.toBlob(res, type, q));
  if (!b) return fail('The picture is too large for this browser to convert.');
  if (b.type !== type) return fail(`This browser cannot write ${type.split('/')[1].toUpperCase()} pictures.`);
  return b;
};
const bytesOf = async (b: Blob) => new Uint8Array(await b.arrayBuffer());

async function pictureOutput(from: FileKindId, blob: Blob, fmt: string, q: number): Promise<Uint8Array | Blob> {
  const white = fmt === 'jpg' || fmt === 'bmp';
  const r = from === 'video' ? await frameOfVideo(blob, white) : await rasterOfImage(blob, white);
  switch (fmt) {
    case 'png': return encode(r, 'image/png', 1);
    case 'jpg': return encode(r, 'image/jpeg', q);
    case 'webp': return encode(r, 'image/webp', q);
    case 'bmp': return F.encodeBmp(r.cv.getContext('2d')!.getImageData(0, 0, r.w, r.h).data, r.w, r.h);
    case 'svg': return strToU8(F.svgAroundPng(r.cv.toDataURL('image/png'), r.w, r.h));
  }
  return fail(`Unknown picture format .${fmt}.`);
}

// ---- sound ---------------------------------------------------------------------------------------------------------------------

async function wavOf(blob: Blob): Promise<Uint8Array> {
  const Ctx: typeof OfflineAudioContext | undefined = window.OfflineAudioContext ?? (window as unknown as { webkitOfflineAudioContext?: typeof OfflineAudioContext }).webkitOfflineAudioContext;
  if (!Ctx) return fail('This browser cannot decode sound, so it cannot convert it.');
  let buf: AudioBuffer;
  try { buf = await new Ctx(1, 1, 44100).decodeAudioData(await blob.arrayBuffer()); } catch { return fail('This browser could not decode the sound (its format is not supported here).'); }
  if (buf.length * buf.numberOfChannels * 2 > MAX_WAV) return fail('The sound is too long to write as a WAV file here (the limit is 256 MB).');
  return F.encodeWav(Array.from({ length: buf.numberOfChannels }, (_, c) => buf.getChannelData(c)), buf.sampleRate);
}

// ---- text-like sources ---------------------------------------------------------------------------------------------------------

async function readTable(info: FileInfo, blob: Blob): Promise<string[][]> {
  if (info.ext === 'csv') return F.parseDelimited(info.text ?? '');
  if (info.ext === 'xlsx') { try { return F.readXlsx(await bytesOf(blob)); } catch { return fail('The cells of this .XLSX workbook could not be read. It may be damaged or password-protected.'); } }
  return fail(`The cells of a .${info.ext.toUpperCase()} file cannot be read in the browser. Use a .CSV or .XLSX file.`);
}

/** The readable words of any text-bearing file, whatever its format. */
async function bodyText(from: FileKindId, info: FileInfo, blob: Blob): Promise<string> {
  if (from === 'spreadsheet') return F.tableToText(await readTable(info, blob));
  if (info.text === undefined) {
    return fail(info.ext === 'doc' ? 'The text of an old .DOC file cannot be read in the browser. Save it as .DOCX first.' : `The text of “${info.name}” could not be read, so it cannot be converted.`);
  }
  if (from === 'text' && info.ext === 'rtf') return F.rtfToText(info.text);
  if (from === 'web' && info.ext === 'html') return F.htmlToText(info.text);
  return info.text;
}

/** Texts are measured in UTF-16 units but PDFs and Word files are happier with plain `\n`. */
const utf8 = (s: string, bom = false) => strToU8((bom ? '\uFEFF' : '') + s);

async function pagesAsJpegs(text: string, quality: number): Promise<F.PdfPage[]> {
  const P = F.PDF_TEXT, S = 2; // draw at twice the point size so the text stays sharp
  // The app's own monospaced stack (Commit Mono, and Noto Sans SC/TC for Chinese), never a system font.
  const stack = getComputedStyle(document.documentElement).getPropertyValue('--code').trim() || 'monospace';
  try { await document.fonts.load(`${P.size * S}px ${stack}`, text.slice(0, 200)); } catch { /* the stack still draws */ }
  const out: F.PdfPage[] = [];
  for (const lines of F.layoutPdfText(text)) {
    const cv = document.createElement('canvas');
    cv.width = P.w * S; cv.height = P.h * S;
    const ctx = cv.getContext('2d');
    if (!ctx) return fail('This browser cannot draw pictures, so it cannot convert text that needs them.');
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, cv.width, cv.height);
    ctx.fillStyle = '#000'; ctx.textBaseline = 'top';
    ctx.font = `${P.size * S}px ${stack}`;
    lines.forEach((l, i) => ctx.fillText(l, P.margin * S, P.margin * S + i * P.lead * S));
    out.push({ jpeg: await bytesOf(await encode({ cv, w: cv.width, h: cv.height }, 'image/jpeg', Math.max(quality, 0.6))), w: cv.width, h: cv.height, wPt: P.w, hPt: P.h });
  }
  return out;
}

async function imagePdf(blob: Blob, quality: number): Promise<Uint8Array> {
  const r = await rasterOfImage(blob, true);
  const jpeg = await bytesOf(await encode(r, 'image/jpeg', quality));
  // A pixel is 0.75 pt; very large pictures are scaled down so the page stays inside what readers accept.
  const k = Math.min(0.75, 1190 / Math.max(r.w, r.h));
  return F.buildPdfFromJpegs([{ jpeg, w: r.w, h: r.h, wPt: r.w * k, hPt: r.h * k }]);
}

// ---- the conversion ------------------------------------------------------------------------------------------------------------

async function produce(req: ConvertRequest, info: FileInfo, blob: Blob, title: string): Promise<{ data: Uint8Array | Blob; warn?: string }> {
  const from = req.src.type, to = req.to, fmt = req.format;
  const warn = info.textCut ? 'The source is longer than 1 000 000 characters, so only its first part was converted.' : undefined;
  const ok = (data: Uint8Array | Blob, w = warn) => ({ data, warn: w });

  if (to === 'compressed') return ok(F.zipOne(info.name, await bytesOf(blob)), undefined);
  if (from === 'compressed') { try { return ok(utf8(F.listZip(await bytesOf(blob)))); } catch { return fail('This archive could not be read. Only .ZIP files can be listed.'); } }

  switch (to) {
    case 'image': return ok(await pictureOutput(from, blob, fmt, req.quality), undefined);
    case 'audio': return ok(await wavOf(blob), undefined);
    case 'document': return ok(F.buildDocx(await bodyText(from, info, blob)));
    case 'text': {
      if (fmt === 'rtf') return ok(utf8(info.ext === 'rtf' ? info.text ?? '' : F.textToRtf(info.text ?? '')));
      if (fmt === 'md') {
        if (from === 'spreadsheet') return ok(utf8(F.toMarkdownTable(await readTable(info, blob))));
        return ok(utf8(from === 'text' && info.ext !== 'rtf' ? info.text ?? '' : await bodyText(from, info, blob)));
      }
      return ok(utf8(from === 'text' && info.ext === 'md' ? F.markdownToText(info.text ?? '') : await bodyText(from, info, blob)));
    }
    case 'web': {
      if (from === 'image') {
        const r = await rasterOfImage(blob, false);
        return ok(utf8(F.imageToHtml(r.cv.toDataURL('image/png'), title, r.w, r.h)), undefined);
      }
      if (from === 'spreadsheet') return ok(utf8(F.tableToHtml(await readTable(info, blob), title)));
      return ok(utf8(F.textToHtml(await bodyText(from, info, blob), title)));
    }
    case 'pdf': {
      if (from === 'image') return ok(await imagePdf(blob, req.quality), undefined);
      const text = await bodyText(from, info, blob);
      if (F.unsupportedForPdf(text) === 0) return ok(F.buildPdfFromText(text));
      return ok(F.buildPdfFromJpegs(await pagesAsJpegs(text, req.quality)), [warn, 'The text has characters a PDF’s built-in font cannot show, so the pages were drawn as pictures: the text in this PDF cannot be selected.'].filter(Boolean).join(' '));
    }
    case 'spreadsheet': {
      const rows = from === 'spreadsheet' ? await readTable(info, blob) : F.parseDelimited(await bodyText(from, info, blob));
      return ok(fmt === 'xlsx' ? F.buildXlsx(rows) : utf8(F.toCsv(rows), true));
    }
  }
  return fail(`This converter cannot turn a ${FILE_KIND_BY_ID.get(from)?.name ?? from} file into a ${FILE_KIND_BY_ID.get(to)?.name ?? to} file.`);
}

async function convert(req: ConvertRequest, id: string): Promise<FileInfo> {
  const info = getFileInfo(req.src.id);
  const blob = await getBlob(req.src.id);
  if (!info || !blob) return fail(`“${req.src.name}” is not in this browser any more. Drop it on its Files node again.`);
  const base = req.name.trim() ? F.safeName(req.name) : F.safeName(F.baseName(req.src.name));
  const name = `${base}.${req.format}`;
  const made = await produce(req, info, blob, base);
  const file = new File([made.data as BlobPart], name, { type: F.MIME_BY_EXT[req.format] ?? 'application/octet-stream', lastModified: Date.now() });
  const out = await analyse(id, file);
  if (made.warn) out.warn = out.warn ? `${made.warn} ${out.warn}` : made.warn;
  setBlob(id, file);
  return out;
}

setRunner(convert);

/** A finished conversion runs every converter again: the one that asked now gets its answer. */
subscribeConversions(() => {
  for (const n of engine.nodes.values()) if (n.type === 'actor-fileconv') engine.inject(n.id, {});
});
