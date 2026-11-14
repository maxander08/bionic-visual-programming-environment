// Reads what a font file says about itself: family and style names, version, number of glyphs and the kind of outlines.
// Pure bytes-in, facts-out — no DOM — so it is testable in Node.
//
//  • .TTF and .OTF are sfnt files: a table directory followed by tables. We read `name`, `head` and `maxp`.
//  • .WOFF2 wraps the same tables in one Brotli stream. When the caller can supply a Brotli decoder (browsers expose one as
//    DecompressionStream('brotli') in recent versions) the names are read the same way; without one the file is still recognised
//    and described by its header, and the family falls back to the file name.

export interface FontMeta {
  /** What the file is wrapped as: TTF, OTF or WOFF2. */
  container: 'TTF' | 'OTF' | 'WOFF2';
  /** The outline technology: TrueType (quadratic) or CFF (cubic, “PostScript”). */
  outlines: 'TrueType' | 'CFF' | 'Unknown';
  family?: string;
  style?: string;
  fullName?: string;
  version?: string;
  postscript?: string;
  glyphs?: number;
  unitsPerEm?: number;
  /** Number of tables in the file (cmap, glyf, GSUB…). */
  tables?: number;
  /** Table tags, for the details view. */
  tableTags?: string[];
  /** True when the names above could be read; false when only the header was (WOFF2 without a Brotli decoder). */
  complete: boolean;
}

export type Brotli = (data: Uint8Array) => Promise<Uint8Array | null>;

const tag4 = (b: Uint8Array, o: number) => String.fromCharCode(b[o], b[o + 1], b[o + 2], b[o + 3]);

/** Does this look like a font file at all? Checks the first four bytes against the signatures of the supported containers. */
export function fontSignature(b: Uint8Array): 'ttf' | 'otf' | 'woff2' | 'ttc' | null {
  if (b.length < 12) return null;
  const t = tag4(b, 0);
  if (t === 'wOF2') return 'woff2';
  if (t === 'OTTO') return 'otf';
  if (t === 'ttcf') return 'ttc';
  if (t === '\u0000\u0001\u0000\u0000' || t === 'true' || t === 'typ1') return 'ttf';
  return null;
}

interface Dir { tag: string; offset: number; length: number }

function decodeName(b: Uint8Array, platform: number, enc: number): string {
  if (platform === 3 || platform === 0 || (platform === 2 && enc === 1)) {
    let s = '';
    for (let i = 0; i + 1 < b.length; i += 2) s += String.fromCharCode((b[i] << 8) | b[i + 1]);
    return s;
  }
  // Macintosh Roman: plain ASCII is all that matters for the names we look at.
  let s = '';
  for (const c of b) s += c < 0x80 ? String.fromCharCode(c) : '?';
  return s;
}

function readNames(view: DataView, bytes: Uint8Array, at: number, len: number): Map<number, string> {
  const out = new Map<number, { text: string; rank: number }>();
  if (len < 6 || at + 6 > bytes.length) return new Map();
  const count = view.getUint16(at + 2), strOff = at + view.getUint16(at + 4);
  for (let i = 0; i < count; i++) {
    const r = at + 6 + i * 12;
    if (r + 12 > bytes.length || r + 12 > at + len) break;
    const platform = view.getUint16(r), enc = view.getUint16(r + 2), lang = view.getUint16(r + 4), id = view.getUint16(r + 6), n = view.getUint16(r + 8), o = view.getUint16(r + 10);
    if (strOff + o + n > bytes.length || strOff + o + n > at + len) continue;
    const text = decodeName(bytes.subarray(strOff + o, strOff + o + n), platform, enc).replace(/\u0000/g, '').trim();
    if (!text) continue;
    // Prefer Windows/English, then any Windows, then Mac Roman/English, then Mac Roman, then other encodings.
    const rank = platform === 3 && lang === 0x409 ? 0 : platform === 3 ? 1 : platform === 1 && enc === 0 && lang === 0 ? 2 : platform === 1 && enc === 0 ? 3 : 4;
    const prev = out.get(id);
    if (!prev || rank < prev.rank) out.set(id, { text, rank });
  }
  return new Map([...out].map(([k, v]) => [k, v.text]));
}

function fromTables(container: FontMeta['container'], flavor: string, get: (tag: string) => { view: DataView; bytes: Uint8Array; at: number; len: number } | undefined, tags: string[]): FontMeta {
  const meta: FontMeta = {
    container, complete: true, tables: tags.length, tableTags: tags,
    outlines: flavor === 'OTTO' ? 'CFF' : flavor === '\u0000\u0001\u0000\u0000' || flavor === 'true' || flavor === 'typ1' ? 'TrueType' : tags.includes('CFF ') || tags.includes('CFF2') ? 'CFF' : tags.includes('glyf') ? 'TrueType' : 'Unknown',
  };
  const nm = get('name');
  if (nm) {
    const n = readNames(nm.view, nm.bytes, nm.at, nm.len);
    meta.family = n.get(16) ?? n.get(1);
    meta.style = n.get(17) ?? n.get(2);
    meta.fullName = n.get(4);
    meta.version = n.get(5);
    meta.postscript = n.get(6);
  }
  const mp = get('maxp');
  if (mp && mp.len >= 6) meta.glyphs = mp.view.getUint16(mp.at + 4);
  const hd = get('head');
  if (hd && hd.len >= 20) meta.unitsPerEm = hd.view.getUint16(hd.at + 18);
  return meta;
}

function parseSfnt(bytes: Uint8Array, container: 'TTF' | 'OTF'): FontMeta | null {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let base = 0;
  if (tag4(bytes, 0) === 'ttcf') {
    if (bytes.length < 16 || view.getUint32(8) === 0) return null;
    base = view.getUint32(12); // first font of a collection
  }
  if (base + 12 > bytes.length) return null;
  const flavor = tag4(bytes, base);
  const n = view.getUint16(base + 4);
  if (n === 0 || n > 200 || base + 12 + n * 16 > bytes.length) return null;
  const dir: Dir[] = [];
  for (let i = 0; i < n; i++) {
    const r = base + 12 + i * 16;
    dir.push({ tag: tag4(bytes, r), offset: view.getUint32(r + 8), length: view.getUint32(r + 12) });
  }
  const find = (t: string) => {
    const d = dir.find((x) => x.tag === t);
    return d && d.offset + d.length <= bytes.length ? { view, bytes, at: d.offset, len: d.length } : undefined;
  };
  return fromTables(container, flavor, find, dir.map((d) => d.tag));
}

const KNOWN_TAGS = ['cmap', 'head', 'hhea', 'hmtx', 'maxp', 'name', 'OS/2', 'post', 'cvt ', 'fpgm', 'glyf', 'loca', 'prep', 'CFF ', 'VORG', 'EBDT', 'EBLC', 'gasp', 'hdmx', 'kern', 'LTSH', 'PCLT', 'VDMX', 'vhea', 'vmtx', 'BASE', 'GDEF', 'GPOS', 'GSUB', 'EBSC', 'JSTF', 'MATH', 'CBDT', 'CBLC', 'COLR', 'CPAL', 'SVG ', 'sbix', 'acnt', 'avar', 'bdat', 'bloc', 'bsln', 'cvar', 'fdsc', 'feat', 'fmtx', 'fvar', 'gvar', 'hsty', 'just', 'lcar', 'mort', 'morx', 'opbd', 'prop', 'trak', 'Zapf', 'Silf', 'Glat', 'Gloc', 'Feat', 'Sill'];

async function parseWoff2(bytes: Uint8Array, brotli?: Brotli): Promise<FontMeta | null> {
  if (bytes.length < 48) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const flavor = tag4(bytes, 4);
  const n = view.getUint16(12);
  const compressedSize = view.getUint32(20);
  if (n === 0 || n > 200) return null;
  let p = 48;
  const base128 = () => {
    let v = 0;
    for (let i = 0; i < 5; i++) {
      if (p >= bytes.length) throw new Error('short');
      const c = bytes[p++];
      v = v * 128 + (c & 0x7f);
      if (!(c & 0x80)) return v;
    }
    throw new Error('bad varint');
  };
  const u255 = () => {
    if (p >= bytes.length) throw new Error('short');
    const code = bytes[p++];
    if (code === 253) { if (p + 2 > bytes.length) throw new Error('short'); const v = view.getUint16(p); p += 2; return v; }
    if (code === 255) { if (p >= bytes.length) throw new Error('short'); return bytes[p++] + 253; }
    if (code === 254) { if (p >= bytes.length) throw new Error('short'); return bytes[p++] + 506; }
    return code;
  };
  const dir: { tag: string; stored: number }[] = [];
  let fontFlavor = flavor;
  try {
    for (let i = 0; i < n; i++) {
      if (p >= bytes.length) return null;
      const flags = bytes[p++];
      const idx = flags & 0x3f, ver = flags >> 6;
      let tag: string;
      if (idx === 63) { if (p + 4 > bytes.length) return null; tag = tag4(bytes, p); p += 4; } else tag = KNOWN_TAGS[idx] ?? '????';
      const orig = base128();
      const transformed = tag === 'glyf' || tag === 'loca' ? ver !== 3 : ver !== 0;
      dir.push({ tag, stored: transformed ? base128() : orig });
    }
    if (flavor === 'ttcf') {
      if (p + 4 > bytes.length) return null;
      p += 4; // CollectionHeader version
      const nf = u255();
      for (let i = 0; i < nf; i++) {
        const nt = u255();
        if (p + 4 > bytes.length) return null;
        if (i === 0) fontFlavor = tag4(bytes, p);
        p += 4;
        for (let k = 0; k < nt; k++) u255();
      }
    }
  } catch { return null; }
  const tags = dir.map((d) => d.tag);
  const header: FontMeta = {
    container: 'WOFF2', complete: false, tables: n, tableTags: tags,
    outlines: fontFlavor === 'OTTO' ? 'CFF' : tags.includes('CFF ') || tags.includes('CFF2') ? 'CFF' : tags.includes('glyf') ? 'TrueType' : 'Unknown',
  };
  if (!brotli) return header;
  try {
    const raw = await brotli(bytes.subarray(p, Math.min(bytes.length, p + compressedSize)));
    if (!raw) return header;
    const offs = new Map<string, { at: number; len: number }>();
    let o = 0;
    for (const d of dir) { offs.set(d.tag, { at: o, len: d.stored }); o += d.stored; }
    const v = new DataView(raw.buffer, raw.byteOffset, raw.byteLength);
    const find = (t: string) => { const e = offs.get(t); return e && e.at + e.len <= raw.length ? { view: v, bytes: raw, at: e.at, len: e.len } : undefined; };
    return fromTables('WOFF2', fontFlavor, find, tags);
  } catch { return header; }
}

/** Facts about a font file, or null when the bytes are not a font this reader knows. */
export async function parseFont(bytes: Uint8Array, brotli?: Brotli): Promise<FontMeta | null> {
  const sig = fontSignature(bytes);
  try {
    if (sig === 'woff2') return await parseWoff2(bytes, brotli);
    if (sig === 'ttf') return parseSfnt(bytes, 'TTF');
    if (sig === 'otf') return parseSfnt(bytes, 'OTF');
    if (sig === 'ttc') return parseSfnt(bytes, 'TTF');
  } catch { /* fall through to “not a font” */ }
  return null;
}

/** A family name made from the file name when the file will not say: “Fira_Sans-Bold.ttf” → “Fira Sans Bold”. */
export function familyFromFileName(name: string): string {
  const base = (name.split(/[\\/]/).pop() ?? name).replace(/\.[^.]+$/, '');
  return base.replace(/[_\-.]+/g, ' ').replace(/([a-z])([A-Z])/g, '$1 $2').replace(/\s+/g, ' ').trim() || 'Font';
}

/** Ready-made sample lines for the font preview. */
export const SPECIMEN = {
  pangram: 'The quick brown fox jumps over the lazy dog',
  upper: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ',
  lower: 'abcdefghijklmnopqrstuvwxyz',
  digits: '0123456789 .,;:!?@#$%&*()[]{}+−×÷=<>/\\|',
  accents: 'ÀÁÂÃÄÅÆÇÈÉÊËÌÍÎÏÑÒÓÔÕÖØÙÚÛÜÝß àáâãäåæçèéêëìíîïñòóôõöøùúûüýÿ',
};
