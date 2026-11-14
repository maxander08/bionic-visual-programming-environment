import fs from 'fs';
import path from 'path';
import zlib from 'zlib';
import { describe, expect, it } from 'vitest';
import { classify } from './files';
import { MIME_BY_EXT } from './formats';
import { familyFromFileName, fontSignature, parseFont } from './fontinfo';
import { gzipOriginalSize, hexRows, isTar, listTar, textIfText } from './inspect';

const u16 = (n: number) => [(n >> 8) & 255, n & 255];
const u32 = (n: number) => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
const ascii = (s: string) => [...s].map((c) => c.charCodeAt(0));
const utf16be = (s: string) => [...s].flatMap((c) => u16(c.charCodeAt(0)));

/** A tiny but structurally valid sfnt with name, head and maxp tables. */
function makeSfnt(flavor: string, family: string, style: string, glyphs: number, upm: number): Uint8Array {
  const rec = (id: number, text: string) => ({ id, bytes: utf16be(text) });
  const names = [rec(1, family), rec(2, style), rec(4, `${family} ${style}`), rec(5, 'Version 1.234')];
  let off = 0;
  const strings: number[] = [];
  const records = names.flatMap((n) => { const r = [...u16(3), ...u16(1), ...u16(0x409), ...u16(n.id), ...u16(n.bytes.length), ...u16(off)]; off += n.bytes.length; strings.push(...n.bytes); return r; });
  const nameTable = [...u16(0), ...u16(names.length), ...u16(6 + names.length * 12), ...records, ...strings];
  const head = new Array(54).fill(0); head[18] = upm >> 8; head[19] = upm & 255;
  const maxp = [...u32(0x00005000), ...u16(glyphs)];
  const tables: [string, number[]][] = [['head', head], ['maxp', maxp], ['name', nameTable]];
  const dirLen = 12 + tables.length * 16;
  let at = dirLen;
  const dir: number[] = [];
  const body: number[] = [];
  for (const [tag, data] of tables) {
    dir.push(...ascii(tag), ...u32(0), ...u32(at), ...u32(data.length));
    body.push(...data); while (body.length % 4) body.push(0);
    at = dirLen + body.length;
  }
  const head12 = [...ascii(flavor === 'OTTO' ? 'OTTO' : '\u0000\u0001\u0000\u0000'), ...u16(tables.length), 0, 0, 0, 0, 0, 0];
  return new Uint8Array([...head12, ...dir, ...body]);
}

describe('Font File: kind', () => {
  it('takes .ttf, .otf and .woff2 and nothing else', () => {
    for (const e of ['ttf', 'otf', 'woff2']) {
      expect(classify(`Inter-Bold.${e.toUpperCase()}`).id).toBe('font');
      expect(MIME_BY_EXT[e]).toBe(`font/${e}`);
    }
    for (const e of ['woff', 'eot', 'fon']) expect(classify(`a.${e}`).id).toBe('misc');
  });
});

describe('Font File: reading the file', () => {
  it('reads family, style, glyph count and size from a TrueType font', async () => {
    const m = await parseFont(makeSfnt('true', 'Test Sans', 'Bold Italic', 321, 2048));
    expect(m).toMatchObject({ container: 'TTF', outlines: 'TrueType', family: 'Test Sans', style: 'Bold Italic', glyphs: 321, unitsPerEm: 2048, complete: true });
    expect(m!.version).toBe('Version 1.234');
    expect(m!.tableTags).toEqual(['head', 'maxp', 'name']);
  });
  it('recognises CFF (OpenType) outlines', async () => {
    expect(await parseFont(makeSfnt('OTTO', 'Serifa', 'Regular', 10, 1000))).toMatchObject({ container: 'OTF', outlines: 'CFF', family: 'Serifa' });
  });
  it('rejects things that are not fonts', async () => {
    expect(await parseFont(new TextEncoder().encode('hello, this is plainly not a font file'))).toBeNull();
    expect(await parseFont(new Uint8Array(4))).toBeNull();
    expect(fontSignature(new Uint8Array(20))).toBeNull();
    // a header that promises tables that are not there must not throw
    expect(await parseFont(new Uint8Array([0, 1, 0, 0, 0, 40, 0, 0, 0, 0, 0, 0, 1, 2, 3, 4]))).toBeNull();
  });
  it('reads a real WOFF2 (names through Brotli), and falls back to the header without a decoder', async () => {
    const dir = path.resolve('node_modules/@fontsource/jetbrains-mono/files');
    if (!fs.existsSync(dir)) return;
    const f = fs.readdirSync(dir).find((n) => /latin-400-normal\.woff2$/.test(n));
    if (!f) return;
    const bytes = new Uint8Array(fs.readFileSync(path.join(dir, f)));
    expect(fontSignature(bytes)).toBe('woff2');
    const full = await parseFont(bytes, async (d) => new Uint8Array(zlib.brotliDecompressSync(d)));
    expect(full?.container).toBe('WOFF2');
    expect(full?.complete).toBe(true);
    expect(full?.family).toMatch(/JetBrains/i);
    expect(full?.glyphs).toBeGreaterThan(50);
    const bare = await parseFont(bytes);
    expect(bare).toMatchObject({ container: 'WOFF2', complete: false });
    expect(bare?.family).toBeUndefined();
    expect(bare?.tableTags).toContain('name');
  });
  it('rejects truncated ttcf and truncated woff2 headers safely, and parses woff2 collections', async () => {
    // Truncated ttcf (< 16 bytes) and zero-font ttcf
    expect(await parseFont(new Uint8Array([...ascii('ttcf'), 0, 1, 0, 0, 0, 0, 0, 1]))).toBeNull();
    expect(await parseFont(new Uint8Array([...ascii('ttcf'), 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 16]))).toBeNull();
    // Truncated woff2: promises 1 table with custom tag (idx 63) but lacks the 4 tag bytes
    const badWoff2 = new Uint8Array(50);
    badWoff2.set(ascii('wOF2'), 0);
    badWoff2.set(ascii('OTTO'), 4);
    badWoff2[13] = 1; // numTables = 1
    badWoff2[48] = 63; // custom tag flag, only 1 byte remains
    expect(await parseFont(badWoff2)).toBeNull();
    // Minimal WOFF2 collection (flavor = 'ttcf') with 1 font (flavor = 'OTTO') and 1 table ('maxp')
    const maxp = new Uint8Array([...u32(0x00005000), ...u16(42)]);
    const compressed = new Uint8Array(zlib.brotliCompressSync(maxp));
    // WOFF2 header (48 bytes) + 1 table dir entry (idx 7 = 'maxp', origLen = 6) + CollectionHeader (ver 4B + nf 1B + nt 1B + flavor 4B + idx 1B) + compressed
    const woff2Col = new Uint8Array(48 + 2 + 11 + compressed.length);
    const dv = new DataView(woff2Col.buffer);
    woff2Col.set(ascii('wOF2'), 0);
    woff2Col.set(ascii('ttcf'), 4);
    dv.setUint32(8, woff2Col.length);
    dv.setUint16(12, 1); // numTables = 1
    dv.setUint32(20, compressed.length); // totalCompressedSize
    woff2Col[48] = 4; // KNOWN_TAGS[4] === 'maxp', ver 0 (not transformed)
    woff2Col[49] = maxp.length;
    // CollectionHeader at offset 50
    dv.setUint32(50, 0x00010000); // version
    woff2Col[54] = 1; // numFonts = 1
    woff2Col[55] = 1; // numTables = 1
    woff2Col.set(ascii('OTTO'), 56); // first font flavor
    woff2Col[60] = 0; // table index 0
    woff2Col.set(compressed, 61);
    const parsed = await parseFont(woff2Col, async (d) => new Uint8Array(zlib.brotliDecompressSync(d)));
    expect(parsed).toMatchObject({ container: 'WOFF2', outlines: 'CFF', glyphs: 42, complete: true });
  });
  it('makes a family name from a file name', () => {
    expect(familyFromFileName('Fira_Sans-Bold.ttf')).toBe('Fira Sans Bold');
    expect(familyFromFileName('C:\\fonts\\RobotoMono.otf')).toBe('Roboto Mono');
    expect(familyFromFileName('.ttf')).toBeTruthy();
  });
});

describe('Inspecting any file', () => {
  it('lays out a hex dump', () => {
    const r = hexRows(new Uint8Array([0x48, 0x69, 0x00, 0xff]), 0x10);
    expect(r).toHaveLength(1);
    expect(r[0].offset).toBe('00000010');
    expect(r[0].hex.startsWith('48 69 00 ff')).toBe(true);
    expect(r[0].ascii).toBe('Hi··');
    expect(hexRows(new Uint8Array(40))).toHaveLength(3);
  });
  it('tells text from binary', () => {
    expect(textIfText(new TextEncoder().encode('{"a": 1}\n'))).toBe('{"a": 1}\n');
    expect(textIfText(new TextEncoder().encode('héllo — 你好'))).toBe('héllo — 你好');
    expect(textIfText(new Uint8Array([0x4d, 0x5a, 0x90, 0, 3, 0, 0, 0]))).toBeNull();
    expect(textIfText(new Uint8Array([0xff, 0xfe, 0x68, 0x00, 0x69, 0x00]))).toBe('hi');
    // UTF-16 odd trailing byte is trimmed when truncated, rejected when complete; UTF-32LE / binary with FF FE BOM is rejected
    expect(textIfText(new Uint8Array([0xff, 0xfe, 0x41, 0x00, 0x42]), true)).toBe('A');
    expect(textIfText(new Uint8Array([0xff, 0xfe, 0x41, 0x00, 0x42]), false)).toBeNull();
    expect(textIfText(new Uint8Array([0xff, 0xfe, 0x00, 0x00, 0x41, 0x00, 0x00, 0x00]))).toBeNull();
    expect(textIfText(new Uint8Array(0))).toBe('');
    // a multi-byte character cut in half at the end of a truncated read is not held against the file
    const cut = new TextEncoder().encode('ab你').subarray(0, 4);
    expect(textIfText(cut, true)).toBe('ab');
    expect(textIfText(cut, false)).toBeNull();
  });
  it('lists a tar archive and a gzip size', () => {
    const header = (name: string, size: number, type = '0') => {
      const b = new Uint8Array(512);
      b.set(ascii(name), 0);
      b.set(ascii(size.toString(8).padStart(11, '0') + '\0'), 124);
      b[156] = type.charCodeAt(0);
      b.set(ascii('ustar\0'), 257);
      b.fill(0x20, 148, 156);
      const sum = b.reduce((a, c) => a + c, 0);
      b.set(ascii(sum.toString(8).padStart(6, '0') + '\0 '), 148);
      return b;
    };
    const data = new Uint8Array(512); data.set(ascii('hello'));
    const tar = new Uint8Array([...header('docs/', 0, '5'), ...header('docs/a.txt', 5), ...data, ...new Uint8Array(1024)]);
    expect(isTar(tar)).toBe(true);
    expect(listTar(tar)).toEqual({ more: false, entries: [{ name: 'docs/', size: 0, dir: true }, { name: 'docs/a.txt', size: 5, dir: false }] });
    expect(isTar(new Uint8Array(1024))).toBe(false);
    expect(listTar(new TextEncoder().encode('not a tar'))).toBeNull();
    const gz = new Uint8Array(zlib.gzipSync(Buffer.from('some text to compress')));
    expect(gzipOriginalSize(gz)).toBe(21);
    expect(gzipOriginalSize(new Uint8Array(30))).toBeNull();
  });
  it('handles space-padded POSIX tar headers and rejects malformed negative sizes without looping', () => {
    const mk = (name: string, sizeField: string, spacePaddedSum = false) => {
      const b = new Uint8Array(512);
      b.set(ascii(name), 0);
      b.set(ascii(sizeField), 124);
      b[156] = 0x30;
      b.fill(0x20, 148, 156);
      const sum = b.reduce((a, c) => a + c, 0);
      const sumStr = spacePaddedSum ? sum.toString(8).padStart(6, ' ') + '\0 ' : sum.toString(8).padStart(6, '0') + '\0 ';
      b.set(ascii(sumStr), 148);
      return b;
    };
    // Space-padded size and checksum (standard POSIX/BSD tar)
    const spaceTar = new Uint8Array([...mk('hello.txt', '      00005\0', true), ...new Uint8Array(512), ...new Uint8Array(1024)]);
    expect(isTar(spaceTar)).toBe(true);
    expect(listTar(spaceTar)).toEqual({ more: false, entries: [{ name: 'hello.txt', size: 5, dir: false }] });
    // Malformed negative octal size must terminate cleanly (no infinite loop)
    const evil = new Uint8Array([...mk('evil.txt', '-1000\0'), ...new Uint8Array(1024)]);
    expect(isTar(evil)).toBe(true);
    expect(listTar(evil)).toEqual({ more: false, entries: [] });
  });
});
