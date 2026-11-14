// Pure file-format helpers for the File Converter actor: they turn text, tables, pictures and sound into the bytes of another
// format and back. Nothing here touches the DOM, so it all runs (and is tested) in Node. The browser-only steps (decoding a picture,
// decoding audio, drawing to a canvas) are in runtime/convert.ts and hand their results to these builders.
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';

// ---- small text helpers ---------------------------------------------------------------------------------------------

export const escapeXml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
/** XML 1.0 cannot hold most control characters. */
const xmlSafe = (s: string) => escapeXml(s.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]/g, ''));

const ENT: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', copy: '©', reg: '®', hellip: '…', mdash: '—', ndash: '–', lsquo: '‘', rsquo: '’', ldquo: '“', rdquo: '”' };
export const decodeEntities = (s: string) =>
  s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === '#') { const n = e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10); return Number.isFinite(n) && n > 0 && n < 0x110000 ? String.fromCodePoint(n) : m; }
    return ENT[e.toLowerCase()] ?? m;
  });

export const normalizeNewlines = (s: string) => s.replace(/\r\n?/g, '\n');
export const baseName = (name: string) => { const i = name.lastIndexOf('.'); return i > 0 ? name.slice(0, i) : name; };
/** A file name the browser and every operating system will take. */
export function safeName(s: string, fallback = 'converted'): string {
  const t = s.replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').replace(/^\.+/, '').trim().slice(0, 100);
  return t || fallback;
}

export const MIME_BY_EXT: Record<string, string> = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', bmp: 'image/bmp', svg: 'image/svg+xml',
  pdf: 'application/pdf', wav: 'audio/wav', zip: 'application/zip', html: 'text/html', txt: 'text/plain', md: 'text/markdown', rtf: 'application/rtf', csv: 'text/csv',
  ttf: 'font/ttf', otf: 'font/otf', woff2: 'font/woff2',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
};

// ---- HTML, Markdown, RTF ----------------------------------------------------------------------------------------------

const page = (title: string, body: string) =>
  `<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n<title>${escapeXml(title)}</title>\n<style>body{font-family:system-ui,sans-serif;max-width:46rem;margin:2rem auto;padding:0 1rem;line-height:1.55}table{border-collapse:collapse}td,th{border:1px solid #bbb;padding:.3rem .6rem;text-align:left}th{background:#f1f1f1}img{max-width:100%;height:auto}</style>\n</head>\n<body>\n${body}\n</body>\n</html>\n`;

/** Blank lines separate paragraphs; a single line break stays a line break. */
export function textToHtml(text: string, title: string): string {
  const paras = normalizeNewlines(text).split(/\n{2,}/).filter((p) => p.trim() !== '');
  return page(title, `<h1>${escapeXml(title)}</h1>\n` + paras.map((p) => `<p>${escapeXml(p.trim()).replace(/\n/g, '<br>\n')}</p>`).join('\n'));
}
export function tableToHtml(rows: string[][], title: string): string {
  const cell = (tag: string, c: string) => `<${tag}>${escapeXml(c)}</${tag}>`;
  const [head, ...rest] = rows;
  const body = `<table>\n${head ? `<thead><tr>${head.map((c) => cell('th', c)).join('')}</tr></thead>\n` : ''}<tbody>\n${rest.map((r) => `<tr>${r.map((c) => cell('td', c)).join('')}</tr>`).join('\n')}\n</tbody>\n</table>`;
  return page(title, `<h1>${escapeXml(title)}</h1>\n${body}`);
}
export function imageToHtml(dataUrl: string, title: string, w: number, h: number): string {
  return page(title, `<h1>${escapeXml(title)}</h1>\n<img src="${dataUrl}" width="${w}" height="${h}" alt="${escapeXml(title)}">`);
}

/** Readable text from HTML: scripts and styles are dropped, blocks become lines, cells become tab-separated. */
export function htmlToText(html: string): string {
  let s = html
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<(script|style|head|template)\b[\s\S]*?<\/\1\s*>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<li\b[^>]*>/gi, '\n- ')
    .replace(/<\/(p|div|h[1-6]|tr|table|ul|ol|section|article|header|footer|blockquote|pre)\s*>/gi, '\n')
    .replace(/<\/(td|th)\s*>/gi, '\t')
    .replace(/<[^>]+>/g, '');
  s = decodeEntities(s);
  return normalizeNewlines(s).split('\n').map((l) => l.replace(/[ \t]+$/g, '').replace(/^[ \t]{2,}/, '')).join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

/** Plain text from Markdown: marks are taken off, the words stay. */
export function markdownToText(md: string): string {
  return normalizeNewlines(md)
    .replace(/^```.*$/gm, '')
    .replace(/^\s{0,3}#{1,6}\s+/gm, '')
    .replace(/^\s{0,3}>\s?/gm, '')
    .replace(/^\s*([-*_])(\s*\1){2,}\s*$/gm, '')
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/(\*\*|__)(.+?)\1/g, '$2')
    .replace(/(^|[^\w*])\*(?!\s)(.+?)\*(?!\w)/g, '$1$2')
    .replace(/(^|[^\w])_(?!\s)(.+?)_(?!\w)/g, '$1$2')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/^\s*[*+]\s+/gm, '- ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** Plain text from RTF: control words and groups such as font tables are dropped; \par becomes a line break. */
export function rtfToText(rtf: string): string {
  let out = '';
  const skip = new Set(['fonttbl', 'colortbl', 'stylesheet', 'info', 'pict', 'header', 'footer', 'footnote', 'themedata', 'datastore', 'latentstyles']);
  const stack: boolean[] = []; // true = this group's text is dropped
  let drop = false;
  let uc = 1; // characters to skip after \uN
  for (let i = 0; i < rtf.length; i++) {
    const ch = rtf[i];
    if (ch === '{') {
      stack.push(drop);
      if (rtf[i + 1] === '\\' && rtf[i + 2] === '*') drop = true;
      else { const m = /^\\([a-z]+)/i.exec(rtf.slice(i + 1, i + 24)); if (m && skip.has(m[1])) drop = true; }
    } else if (ch === '}') drop = stack.pop() ?? false;
    else if (ch === '\\') {
      const n = rtf[i + 1];
      if (n === "'") { const hex = rtf.slice(i + 2, i + 4); if (!drop) out += String.fromCharCode(parseInt(hex, 16) || 63); i += 3; }
      else if (n === '\\' || n === '{' || n === '}') { if (!drop) out += n; i += 1; }
      else if (n === '~') { if (!drop) out += ' '; i += 1; }
      else if (n === '\n' || n === '\r') { if (!drop) out += '\n'; i += 1; }
      else {
        const m = /^([a-z]+)(-?\d+)? ?/i.exec(rtf.slice(i + 1, i + 40));
        if (!m) { i += 1; continue; }
        const w = m[1], arg = m[2];
        if (!drop) {
          if (w === 'par' || w === 'line' || w === 'sect' || w === 'page') out += '\n';
          else if (w === 'tab') out += '\t';
          else if (w === 'emdash') out += '—';
          else if (w === 'endash') out += '–';
          else if (w === 'bullet') out += '•';
          else if (w === 'u' && arg !== undefined) { let c = parseInt(arg, 10); if (c < 0) c += 65536; out += String.fromCharCode(c); i += m[0].length; i += uc; continue; }
        }
        if (w === 'uc' && arg !== undefined) uc = parseInt(arg, 10) || 0;
        i += m[0].length;
      }
    } else if (!drop && ch !== '\n' && ch !== '\r') out += ch;
  }
  return out.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}

export function textToRtf(text: string): string {
  const esc = (l: string) => {
    let o = '';
    for (const ch of l) {
      const c = ch.codePointAt(0)!;
      if (ch === '\\' || ch === '{' || ch === '}') o += '\\' + ch;
      else if (c === 9) o += '\\tab ';
      else if (c < 32) continue;
      else if (c < 128) o += ch;
      else if (c > 0xffff) { const v = c - 0x10000; for (const u of [0xd800 + (v >> 10), 0xdc00 + (v & 0x3ff)]) o += `\\u${u > 32767 ? u - 65536 : u}?`; }
      else o += `\\u${c > 32767 ? c - 65536 : c}?`;
    }
    return o;
  };
  return `{\\rtf1\\ansi\\ansicpg1252\\deff0{\\fonttbl{\\f0\\fswiss Helvetica;}}\\f0\\fs22 ${normalizeNewlines(text).split('\n').map(esc).join('\\par\n')}\n}`;
}

// ---- tables -----------------------------------------------------------------------------------------------------------

/** Read comma-, semicolon- or tab-separated text. Quotes may hold the separator and line breaks; "" is a quote. */
export function parseDelimited(text: string, delim?: string): string[][] {
  const src = normalizeNewlines(text).replace(/^\uFEFF/, '');
  const first = src.split('\n', 1)[0] ?? '';
  const counts = ['\t', ',', ';', '|'].map((c) => [c, first.split(c).length - 1] as const).sort((a, b) => b[1] - a[1]);
  const d = delim ?? (counts[0][1] > 0 ? counts[0][0] : ',');
  const rows: string[][] = [];
  let row: string[] = [], cell = '', q = false;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (q) {
      if (ch === '"') { if (src[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += ch;
    } else if (ch === '"' && cell === '') q = true;
    else if (ch === d) { row.push(cell); cell = ''; }
    else if (ch === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; }
    else cell += ch;
  }
  if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
  while (rows.length && rows[rows.length - 1].every((c) => c === '')) rows.pop();
  return rows;
}

export function toCsv(rows: string[][]): string {
  const q = (c: string) => (/[",\n\r]/.test(c) ? `"${c.replace(/"/g, '""')}"` : c);
  return rows.map((r) => r.map(q).join(',')).join('\r\n') + (rows.length ? '\r\n' : '');
}
export function toMarkdownTable(rows: string[][]): string {
  if (!rows.length) return '';
  const w = Math.max(...rows.map((r) => r.length), 1);
  const line = (r: string[]) => '| ' + Array.from({ length: w }, (_, i) => (r[i] ?? '').replace(/\|/g, '\\|').replace(/\n/g, ' ')).join(' | ') + ' |';
  return [line(rows[0]), '| ' + Array.from({ length: w }, () => '---').join(' | ') + ' |', ...rows.slice(1).map(line)].join('\n') + '\n';
}
/** Rows as aligned plain text (tab-separated is kept as is: it pastes into any spreadsheet). */
export const tableToText = (rows: string[][]) => rows.map((r) => r.join('\t')).join('\n');

// ---- DOCX -------------------------------------------------------------------------------------------------------------

export function buildDocx(text: string): Uint8Array {
  const paras = normalizeNewlines(text).split('\n').map((l) => `<w:p><w:r><w:t xml:space="preserve">${xmlSafe(l)}</w:t></w:r></w:p>`).join('');
  const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
  return zipSync({
    '[Content_Types].xml': strToU8('<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>'),
    '_rels/.rels': strToU8('<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>'),
    'word/document.xml': strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="${W}"><w:body>${paras}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="708" w:footer="708" w:gutter="0"/></w:sectPr></w:body></w:document>`),
  });
}

// ---- XLSX -------------------------------------------------------------------------------------------------------------

export function colName(i: number): string {
  let n = i + 1, s = '';
  while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); }
  return s;
}
const colIndex = (letters: string) => letters.toUpperCase().split('').reduce((a, c) => a * 26 + c.charCodeAt(0) - 64, 0) - 1;
const NUMERIC = /^-?(0|[1-9]\d*)(\.\d+)?([eE][+-]?\d+)?$/;

export function buildXlsx(rows: string[][]): Uint8Array {
  const sheet = rows.map((r, y) => `<row r="${y + 1}">${r.map((c, x) => {
    if (c === '') return '';
    const ref = colName(x) + (y + 1);
    return NUMERIC.test(c) && c.length < 16 ? `<c r="${ref}"><v>${c}</v></c>` : `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${xmlSafe(c)}</t></is></c>`;
  }).join('')}</row>`).join('');
  const NS = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
  return zipSync({
    '[Content_Types].xml': strToU8('<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>'),
    '_rels/.rels': strToU8('<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>'),
    'xl/workbook.xml': strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="${NS}" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Sheet1" sheetId="1" r:id="rId1"/></sheets></workbook>`),
    'xl/_rels/workbook.xml.rels': strToU8('<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>'),
    'xl/worksheets/sheet1.xml': strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="${NS}"><sheetData>${sheet}</sheetData></worksheet>`),
  });
}

/** The cells of the first sheet of an .xlsx workbook, as text. Throws when it is not a readable workbook. */
export function readXlsx(bytes: Uint8Array): string[][] {
  const z = unzipSync(bytes, { filter: (f) => /^xl\/(sharedStrings\.xml|worksheets\/sheet\d+\.xml)$/.test(f.name) });
  const sheetName = Object.keys(z).filter((n) => n.startsWith('xl/worksheets/')).sort((a, b) => parseInt(a.replace(/\D/g, ''), 10) - parseInt(b.replace(/\D/g, ''), 10))[0];
  if (!sheetName) throw new Error('no sheet');
  const tx = (xml: string) => decodeEntities([...xml.replace(/<rPh\b[\s\S]*?<\/rPh>/g, '').matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)].map((m) => m[1]).join(''));
  const shared = z['xl/sharedStrings.xml'] ? [...strFromU8(z['xl/sharedStrings.xml']).matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>/g)].map((m) => tx(m[1])) : [];
  const rows: string[][] = [];
  const xml = strFromU8(z[sheetName]);
  for (const m of xml.matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
    const ref = /\br="([A-Z]+)(\d+)"/i.exec(m[1]);
    if (!ref) continue;
    const t = /\bt="(\w+)"/.exec(m[1])?.[1];
    const body = m[2] ?? '';
    const v = /<v>([\s\S]*?)<\/v>/.exec(body)?.[1];
    let val = '';
    if (t === 'inlineStr') val = tx(body);
    else if (t === 's') val = shared[Number(v)] ?? '';
    else if (t === 'b') val = v === '1' ? 'TRUE' : 'FALSE';
    else if (v !== undefined) val = decodeEntities(v);
    const y = Number(ref[2]) - 1, x = colIndex(ref[1]);
    (rows[y] ??= [])[x] = val;
  }
  const w = Math.max(0, ...rows.map((r) => (r ? r.length : 0)));
  return Array.from(rows, (r) => Array.from({ length: w }, (_, i) => r?.[i] ?? ''));
}

// ---- PDF ---------------------------------------------------------------------------------------------------------------

const latin1 = (s: string) => { const b = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) b[i] = s.charCodeAt(i) & 0xff; return b; };

class Pdf {
  private parts: Uint8Array[] = [];
  private len = 0;
  private at: number[] = [];
  constructor() { this.raw(latin1('%PDF-1.4\n%')); this.raw(new Uint8Array([0xe2, 0xe3, 0xcf, 0xd3, 0x0a])); }
  private raw(b: Uint8Array | string) { const u = typeof b === 'string' ? latin1(b) : b; this.parts.push(u); this.len += u.length; }
  obj(n: number, dict: string, stream?: Uint8Array) {
    this.at[n] = this.len;
    this.raw(`${n} 0 obj\n`);
    if (stream) { this.raw(`<< ${dict} /Length ${stream.length} >>\nstream\n`); this.raw(stream); this.raw('\nendstream\n'); } else this.raw(`<< ${dict} >>\n`);
    this.raw('endobj\n');
  }
  finish(count: number): Uint8Array {
    const xref = this.len;
    let t = `xref\n0 ${count + 1}\n0000000000 65535 f \n`;
    for (let i = 1; i <= count; i++) t += `${String(this.at[i] ?? 0).padStart(10, '0')} 00000 n \n`;
    this.raw(t + `trailer\n<< /Size ${count + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
    const out = new Uint8Array(this.len);
    let o = 0;
    for (const p of this.parts) { out.set(p, o); o += p.length; }
    return out;
  }
}

export const PDF_TEXT = { w: 595, h: 842, margin: 54, size: 10, lead: 12.5, cols: 81, rows: 58 };

/** Lay text out on A4 pages in Courier (every character is 6 pt wide, so wrapping is exact). */
export function layoutPdfText(text: string): string[][] {
  const lines: string[] = [];
  for (const raw of normalizeNewlines(text).replace(/\t/g, '    ').split('\n')) {
    let l = raw.replace(/\s+$/, '');
    if (l === '') { lines.push(''); continue; }
    while (l.length > PDF_TEXT.cols) {
      let cut = l.lastIndexOf(' ', PDF_TEXT.cols);
      if (cut < PDF_TEXT.cols / 2) cut = PDF_TEXT.cols;
      lines.push(l.slice(0, cut).replace(/\s+$/, ''));
      l = l.slice(cut).replace(/^\s+/, '');
    }
    lines.push(l);
  }
  const pages: string[][] = [];
  for (let i = 0; i < lines.length; i += PDF_TEXT.rows) pages.push(lines.slice(i, i + PDF_TEXT.rows));
  return pages.length ? pages : [['']];
}

/** Characters that WinAnsi (the PDF's built-in font encoding) cannot show. */
export const unsupportedForPdf = (text: string) => { let n = 0; for (const ch of text) { const c = ch.codePointAt(0)!; if (c > 255 || (c >= 0x80 && c <= 0x9f)) n++; } return n; };

export function buildPdfFromText(text: string): Uint8Array {
  const pages = layoutPdfText(text);
  const pdf = new Pdf();
  const esc = (l: string) => l.replace(/[\u0000-\u001f]/g, ' ').replace(/[\\()]/g, '\\$&').replace(/[^\u0020-\u007e\u00a0-\u00ff]/g, '?');
  const kids = pages.map((_, i) => `${4 + 2 * i} 0 R`).join(' ');
  pdf.obj(1, '/Type /Catalog /Pages 2 0 R');
  pdf.obj(2, `/Type /Pages /Kids [${kids}] /Count ${pages.length}`);
  pdf.obj(3, '/Type /Font /Subtype /Type1 /BaseFont /Courier /Encoding /WinAnsiEncoding');
  pages.forEach((lines, i) => {
    const body = `BT /F1 ${PDF_TEXT.size} Tf ${PDF_TEXT.lead} TL ${PDF_TEXT.margin} ${PDF_TEXT.h - PDF_TEXT.margin} Td\n${lines.map((l) => `(${esc(l)}) Tj T*`).join('\n')}\nET`;
    pdf.obj(4 + 2 * i, `/Type /Page /Parent 2 0 R /MediaBox [0 0 ${PDF_TEXT.w} ${PDF_TEXT.h}] /Resources << /Font << /F1 3 0 R >> >> /Contents ${5 + 2 * i} 0 R`);
    pdf.obj(5 + 2 * i, '', latin1(body));
  });
  return pdf.finish(3 + 2 * pages.length);
}

export interface PdfPage { jpeg: Uint8Array; w: number; h: number; /** Page size in points. */ wPt: number; hPt: number }
export function buildPdfFromJpegs(pages: PdfPage[]): Uint8Array {
  const pdf = new Pdf();
  pdf.obj(1, '/Type /Catalog /Pages 2 0 R');
  pdf.obj(2, `/Type /Pages /Kids [${pages.map((_, i) => `${3 + 3 * i} 0 R`).join(' ')}] /Count ${pages.length}`);
  pages.forEach((p, i) => {
    const w = +p.wPt.toFixed(2), h = +p.hPt.toFixed(2);
    pdf.obj(3 + 3 * i, `/Type /Page /Parent 2 0 R /MediaBox [0 0 ${w} ${h}] /Resources << /XObject << /Im0 ${5 + 3 * i} 0 R >> >> /Contents ${4 + 3 * i} 0 R`);
    pdf.obj(4 + 3 * i, '', latin1(`q ${w} 0 0 ${h} 0 0 cm /Im0 Do Q`));
    pdf.obj(5 + 3 * i, `/Type /XObject /Subtype /Image /Width ${p.w} /Height ${p.h} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode`, p.jpeg);
  });
  return pdf.finish(2 + 3 * pages.length);
}

// ---- audio and picture encoders ----------------------------------------------------------------------------------------

/** 16-bit PCM WAV from decoded channels. */
export function encodeWav(channels: Float32Array[], sampleRate: number): Uint8Array {
  const nch = Math.max(1, channels.length), n = channels[0]?.length ?? 0;
  const out = new Uint8Array(44 + n * nch * 2);
  const v = new DataView(out.buffer);
  const tag = (o: number, s: string) => { for (let i = 0; i < s.length; i++) out[o + i] = s.charCodeAt(i); };
  tag(0, 'RIFF'); v.setUint32(4, 36 + n * nch * 2, true); tag(8, 'WAVE'); tag(12, 'fmt ');
  v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, nch, true); v.setUint32(24, sampleRate, true);
  v.setUint32(28, sampleRate * nch * 2, true); v.setUint16(32, nch * 2, true); v.setUint16(34, 16, true); tag(36, 'data'); v.setUint32(40, n * nch * 2, true);
  let o = 44;
  for (let i = 0; i < n; i++) for (let c = 0; c < nch; c++) {
    const s = Math.max(-1, Math.min(1, channels[c]?.[i] ?? 0));
    v.setInt16(o, s < 0 ? s * 0x8000 : s * 0x7fff, true); o += 2;
  }
  return out;
}

/** 24-bit BMP from RGBA pixels (transparent areas become white). */
export function encodeBmp(rgba: Uint8ClampedArray | Uint8Array, w: number, h: number): Uint8Array {
  const row = Math.ceil((w * 3) / 4) * 4;
  const out = new Uint8Array(54 + row * h);
  const v = new DataView(out.buffer);
  out[0] = 0x42; out[1] = 0x4d; v.setUint32(2, out.length, true); v.setUint32(10, 54, true); v.setUint32(14, 40, true);
  v.setInt32(18, w, true); v.setInt32(22, h, true); v.setUint16(26, 1, true); v.setUint16(28, 24, true); v.setUint32(34, row * h, true); v.setInt32(38, 2835, true); v.setInt32(42, 2835, true);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const s = ((h - 1 - y) * w + x) * 4, a = rgba[s + 3] / 255, o = 54 + y * row + x * 3;
    out[o] = Math.round(rgba[s + 2] * a + 255 * (1 - a)); out[o + 1] = Math.round(rgba[s + 1] * a + 255 * (1 - a)); out[o + 2] = Math.round(rgba[s] * a + 255 * (1 - a));
  }
  return out;
}

export const svgAroundPng = (dataUrl: string, w: number, h: number) =>
  `<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">\n<image width="${w}" height="${h}" xlink:href="${dataUrl}"/>\n</svg>\n`;

// ---- archives ------------------------------------------------------------------------------------------------------------

export const zipOne = (name: string, bytes: Uint8Array): Uint8Array => zipSync({ [name]: bytes });

/** Names and sizes of everything inside a zip, one per line. Nothing is unpacked. */
export function listZip(bytes: Uint8Array): string {
  const rows: string[] = [];
  unzipSync(bytes, { filter: (f) => { rows.push(f.name.endsWith('/') ? f.name : `${f.name}\t${f.originalSize} bytes`); return false; } });
  return rows.join('\n');
}
