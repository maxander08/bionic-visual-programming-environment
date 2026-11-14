import { afterEach, describe, expect, it } from 'vitest';
import { strFromU8, unzipSync } from 'fflate';
import { Engine } from './engine';
import { addNode, connect, emptyGraph, flatten } from './graph';
import { CATEGORIES, MODULES, defaultParams, getDef, paramDefsOf, resolveParams } from './registry';
import type { Graph, Params } from './types';
import { FILE_KIND_BY_ID, setFileInfo, type FileInfo } from './files';
import { ROUTES, SOURCE_KINDS, clearConversions, formatsOf, setRunner, subscribeConversions, targetsOf } from './convert';
import { projectView } from './modules/behavior';
import * as F from './formats';
import { CONV_GROUPS, cFromBase, cToBase, parseConv } from './units';

function build(spec: { nodes: [string, string, Params?][]; wires?: [string, string, string, string][] }) {
  let g: Graph = emptyGraph();
  spec.nodes.forEach(([id, type, p], i) => (g = addNode(g, type, i * 300, 0, p ?? {}, undefined, id).graph));
  for (const [a, ap, b, bp] of spec.wires ?? []) {
    const r = connect(g, a, ap, b, bp);
    expect(r.error, `${a}.${ap} → ${b}.${bp}`).toBeUndefined();
    g = r.graph;
  }
  const e = new Engine(50);
  e.load(flatten(g));
  return { e, g };
}

afterEach(() => { setRunner(undefined); clearConversions(); });

describe('Actors in the library', () => {
  it('have their own category, between Files and Info', () => {
    expect(CATEGORIES).toContain('Actors');
    expect(CATEGORIES.indexOf('Actors')).toBe(CATEGORIES.indexOf('Files') + 1);
    expect(MODULES.filter((m) => m.category === 'Actors').map((m) => m.type)).toEqual(['actor-fileconv', 'actor-unitconv']);
  });

  it('give every setting a setting pin, like every other module', () => {
    for (const type of ['actor-fileconv', 'actor-unitconv']) {
      const d = getDef(type)!;
      const keys = paramDefsOf(d, {}).map((p) => p.key);
      expect(d.paramPins!.map((p) => p.param)).toEqual(keys);
      for (const k of keys) expect(d.inputs.some((p) => p.id === `p:${k}` && p.optional)).toBe(true);
    }
    expect(getDef('actor-fileconv')!.paramPins!.map((p) => p.id)).toEqual(['p:from', 'p:to', 'p:format', 'p:name', 'p:quality']);
    expect(getDef('actor-unitconv')!.paramPins!.map((p) => p.id)).toEqual(['p:group', 'p:amount', 'p:from', 'p:fromPrefix', 'p:to', 'p:toPrefix']);
  });
});

describe('File Converter routes', () => {
  it('offer only conversions that are listed, and every category can go somewhere', () => {
    for (const from of SOURCE_KINDS) {
      expect(targetsOf(from).length, from).toBeGreaterThan(0);
      for (const to of targetsOf(from)) expect(formatsOf(from, to).length, `${from}>${to}`).toBeGreaterThan(0);
    }
    expect(targetsOf('image')).toContain('pdf');
    expect(targetsOf('audio')).not.toContain('document');
    expect(Object.keys(ROUTES).sort()).toEqual([...FILE_KIND_BY_ID.keys()].sort());
  });

  it('follows its own settings: the choices for "to" and "format" change with "from" and "to"', () => {
    const d = getDef('actor-fileconv')!;
    const raw = (p: Params) => paramDefsOf(d, p).map((x) => (x.kind === 'select' ? x.options.map((o) => o.value) : null));
    expect(raw({ from: 'image' })[1]).toEqual(['image', 'pdf', 'web', 'compressed']);
    expect(raw({ from: 'audio' })[1]).toEqual(['audio', 'compressed']);
    expect(raw({ from: 'image', to: 'image' })[2]).toEqual(['png', 'jpg', 'webp', 'bmp', 'svg']);
    expect(raw({ from: 'text', to: 'document' })[2]).toEqual(['docx']);
    // a value that no longer fits falls back to the first choice that does
    const fixed = resolveParams(d, { from: 'audio', to: 'document', format: 'docx' });
    expect(fixed.to).toBe('audio');
    expect(fixed.format).toBe('wav');
  });

  it('keeps separate pin hints for each variant of its choices', () => {
    const a = getDef('actor-fileconv', undefined, { from: 'image' })!.inputs.find((p) => p.id === 'p:to')!;
    const b = getDef('actor-fileconv', undefined, { from: 'audio' })!.inputs.find((p) => p.id === 'p:to')!;
    expect(a.doc).toContain('pdf');
    expect(b.doc).not.toContain('pdf');
  });
});

describe('File Converter', () => {
  const info = (id: string, name: string, extra: Partial<FileInfo> = {}): FileInfo => ({ id, name, ext: name.split('.').pop()!, size: 10, mime: '', modified: 0, ...extra });

  it('starts the job, shows it as running, then sends the converted file and its text', async () => {
    setFileInfo(info('src1', 'notes.txt', { text: 'hello' }));
    const calls: string[] = [];
    setRunner(async (req, id) => { calls.push(`${req.src.name}>${req.to}.${req.format}`); return info(id, 'notes.docx', { text: 'hello', size: 1234 }); });
    const { e } = build({
      nodes: [['f', 'file-text', { fileId: 'src1', fileName: 'notes.txt' }], ['c', 'actor-fileconv', { from: 'text', to: 'document', format: 'docx' }]],
      wires: [['f', 'file', 'c', 'file']],
    });
    subscribeConversions(() => e.inject('c', {}));
    e.runFor(200);
    expect((e.nodes.get('c')!.viewData as any).state).toBe('working');
    expect(e.out('c', 'file')).toBeUndefined();
    await new Promise((r) => setTimeout(r, 10));
    e.runFor(200);
    expect(calls).toEqual(['notes.txt>document.docx']);
    expect((e.nodes.get('c')!.viewData as any).state).toBe('done');
    const out = e.out('c', 'file') as any;
    expect(out.kind).toBe('file');
    expect(out.type).toBe('document');
    expect(out.name).toBe('notes.docx');
    expect(e.out('c', 'content')).toBe('hello');
    expect(e.out('c', 'name')).toBe('notes.docx');
    expect(e.out('c', 'ext')).toBe('docx');
    expect(e.out('c', 'size')).toBe(1234);
    expect(e.out('c', 'done')).toBe(true);
    expect(e.nodes.get('c')!.status.level).toBe('ok');
  });

  it('refuses a file of another category with a message that names both', () => {
    setFileInfo(info('src2', 'pic.png'));
    setRunner(async (_r, id) => info(id, 'x.pdf'));
    const { e } = build({
      nodes: [['f', 'file-image', { fileId: 'src2', fileName: 'pic.png' }], ['c', 'actor-fileconv', { from: 'text', to: 'document', format: 'docx' }]],
      wires: [['f', 'file', 'c', 'file']],
    });
    e.runFor(200);
    const st = e.nodes.get('c')!.status;
    expect(st.level).toBe('error');
    expect(st.message).toMatch(/Image file/);
    expect(st.message).toMatch(/Text files/);
  });

  it('reports a failed conversion as an error', async () => {
    setFileInfo(info('src3', 'a.txt', { text: 'x' }));
    setRunner(async () => { throw new Error('This browser could not decode the picture.'); });
    const { e } = build({
      nodes: [['f', 'file-text', { fileId: 'src3', fileName: 'a.txt' }], ['c', 'actor-fileconv', { from: 'text', to: 'pdf', format: 'pdf' }]],
      wires: [['f', 'file', 'c', 'file']],
    });
    subscribeConversions(() => e.inject('c', {}));
    e.runFor(100);
    await new Promise((r) => setTimeout(r, 10));
    e.runFor(100);
    expect(e.nodes.get('c')!.status).toEqual({ level: 'error', message: 'This browser could not decode the picture.' });
  });

  it('is driven by its setting pins: a signal chooses the format', async () => {
    setFileInfo(info('src4', 'p.png'));
    const asked: string[] = [];
    setRunner(async (req, id) => { asked.push(req.format); return info(id, `p.${req.format}`); });
    const { e } = build({
      nodes: [['f', 'file-image', { fileId: 'src4', fileName: 'p.png' }], ['fmt', 'constant', { kind: 'text', value: 'webp' }], ['c', 'actor-fileconv', { from: 'image', to: 'image', format: 'png' }]],
      wires: [['f', 'file', 'c', 'file'], ['fmt', 'out', 'c', 'p:format']],
    });
    subscribeConversions(() => e.inject('c', {}));
    e.runFor(100);
    await new Promise((r) => setTimeout(r, 10));
    e.runFor(100);
    expect(asked).toEqual(['webp']);
    expect(e.nodes.get('c')!.driven).toBe(true);
    expect((e.out('c', 'file') as any).ext).toBe('webp');
  });

  it('does not repeat a finished conversion', async () => {
    setFileInfo(info('src5', 'a.txt', { text: 'x' }));
    let n = 0;
    setRunner(async (_r, id) => { n++; return info(id, 'a.pdf'); });
    const { e } = build({
      nodes: [['f', 'file-text', { fileId: 'src5', fileName: 'a.txt' }], ['c', 'actor-fileconv', { from: 'text', to: 'pdf', format: 'pdf' }]],
      wires: [['f', 'file', 'c', 'file']],
    });
    subscribeConversions(() => e.inject('c', {}));
    e.runFor(100);
    await new Promise((r) => setTimeout(r, 10));
    e.runFor(100);
    e.inject('c', {});
    e.runFor(100);
    expect(n).toBe(1);
  });
});

describe('Unit Converter', () => {
  const conv = (params: Params, more: [string, string, Params?][] = [], wires: [string, string, string, string][] = []) =>
    build({ nodes: [...more, ['u', 'actor-unitconv', params]], wires });

  it('converts the amount setting between units of one kind', () => {
    const { e } = conv({ group: 'length', amount: 5280, from: 'ft', to: 'm', toPrefix: 'k' });
    e.runFor(100);
    expect(e.out('u', 'quantity')).toBe('1.609344km');
    expect(e.out('u', 'amount')).toBe(1.609344);
    expect(e.out('u', 'unit')).toBe('km');
    expect(e.out('u', 'base')).toBe(1609.344);
  });

  it('converts temperatures with their offsets', () => {
    const { e } = conv({ group: 'temperature', amount: 100, from: '°C', to: '°F' });
    e.runFor(100);
    expect(e.out('u', 'amount')).toBe(212);
    const k = conv({ group: 'temperature', amount: 0, from: '°F', to: 'K' });
    k.e.runFor(100);
    expect(k.e.out('u', 'amount')).toBeCloseTo(255.372222, 5);
  });

  it('reads a quantity from text and lets its unit replace the From unit', () => {
    const { e } = conv({ group: 'length', from: 'm', to: 'm', toPrefix: 'k' }, [['c', 'constant', { kind: 'text', value: '26.2mi' }]], [['c', 'out', 'u', 'in']]);
    e.runFor(100);
    expect(e.out('u', 'quantity')).toBe('42.1648128km');
  });

  it('takes a plain number as an amount in the From unit', () => {
    const { e } = conv({ group: 'mass', from: 'lb', to: 'g', toPrefix: 'k' }, [['c', 'constant', { value: '10' }]], [['c', 'out', 'u', 'in']]);
    e.runFor(100);
    expect(e.out('u', 'quantity')).toBe('4.5359237kg');
  });

  it('refuses a unit of another kind, naming both kinds', () => {
    const { e } = conv({ group: 'length', from: 'm', to: 'ft' }, [['c', 'constant', { kind: 'text', value: '5kg' }]], [['c', 'out', 'u', 'in']]);
    e.runFor(100);
    const st = e.nodes.get('u')!.status;
    expect(st.level).toBe('error');
    expect(st.message).toMatch(/kg is a unit of mass, not length/);
  });

  it('picks the best prefix with "auto"', () => {
    const { e } = conv({ group: 'length', amount: 0.0032, from: 'm', to: 'm', toPrefix: 'auto' });
    e.runFor(100);
    expect(e.out('u', 'quantity')).toBe('3.2mm');
  });

  it('ignores the prefix for units that take none, and is driven by its setting pins', () => {
    const { e } = conv({ group: 'length', amount: 1609.344, from: 'm', to: 'm', toPrefix: 'k' }, [['t', 'constant', { kind: 'text', value: 'mi' }]], [['t', 'out', 'u', 'p:to']]);
    e.runFor(100);
    expect(e.nodes.get('u')!.driven).toBe(true);
    expect(e.out('u', 'quantity')).toBe('1mi');
  });

  it('offers only the units of the chosen kind, and falls back when the kind changes', () => {
    const d = getDef('actor-unitconv')!;
    const units = (p: Params) => (paramDefsOf(d, p).find((x) => x.key === 'from') as any).options.map((o: any) => o.value);
    expect(units({ group: 'temperature' })).toEqual(['°C', '°F', 'K']);
    expect(units({ group: 'length' })).toContain('ft');
    expect(units({ group: 'length' })).not.toContain('kg');
    const r = resolveParams(d, { ...defaultParams(d), group: 'temperature', from: 'ft', to: 'mi' });
    expect(r.from).toBe('°C');
    expect(r.to).toBe('°F');
  });

  it('has a unit table that agrees with itself', () => {
    expect(CONV_GROUPS.find((g) => g.id === 'length')!.units.slice(0, 3)).toEqual(['m', 'ft', 'in']);
    expect(cFromBase(cToBase(37, '', '°C'), '', '°F')).toBeCloseTo(98.6, 9);
    expect(cFromBase(cToBase(1, 'k', 'g'), '', 'lb')).toBeCloseTo(2.2046226, 6);
    expect(parseConv('5 ft', 'length')).toMatchObject({ ok: true, q: { unit: 'ft', prefix: '', group: 'length' } });
    expect(parseConv('5min', 'time')).toMatchObject({ ok: true, q: { unit: 'min', prefix: '' } });
    expect(parseConv('ft5', 'length').ok).toBe(false);
  });
});

describe('Projector view', () => {
  it('shows a file by its content, not as the record that travels on the wire', () => {
    setFileInfo({ id: 'pv1', name: 'readme.md', ext: 'md', size: 42, mime: 'text/markdown', modified: 0, text: '# Title\n\nBody' });
    const rec = { kind: 'file', type: 'text', id: 'pv1', name: 'readme.md', ext: 'md', size: 42, mime: 'text/markdown', modified: 0 };
    const v = projectView(rec) as any;
    expect(v.kind).toBe('file');
    expect(v.present).toBe(true);
    expect(v.text).toBe('# Title\n\nBody');
  });

  it('keeps the whole of a long text for the window, and formats numbers and data', () => {
    const long = 'line\n'.repeat(5000);
    expect((projectView(long) as any).text).toBe(long);
    expect(projectView(3.14159, 'fixed2')).toMatchObject({ kind: 'number', text: '3.14' });
    expect((projectView({ a: [1, 2] }) as any).text).toBe('{\n  "a": [\n    1,\n    2\n  ]\n}');
    expect(projectView(true)).toMatchObject({ kind: 'text', text: 'true' });
    expect(projectView(undefined)).toEqual({ kind: 'empty' });
  });

  it('runs inside a graph: a Text file’s File output reaches the Projector as a file view', () => {
    setFileInfo({ id: 'pv2', name: 'a.txt', ext: 'txt', size: 5, mime: 'text/plain', modified: 0, text: 'hello\nworld' });
    const { e } = build({ nodes: [['f', 'file-text', { fileId: 'pv2', fileName: 'a.txt' }], ['p', 'projector']], wires: [['f', 'file', 'p', 'in'], ] });
    e.runFor(100);
    expect((e.nodes.get('p')!.viewData as any).kind).toBe('file');
    const b = build({ nodes: [['f', 'file-text', { fileId: 'pv2', fileName: 'a.txt' }], ['p', 'projector']], wires: [['f', 'content', 'p', 'in']] });
    b.e.runFor(100);
    expect((b.e.nodes.get('p')!.viewData as any)).toMatchObject({ kind: 'text', text: 'hello\nworld' });
  });
});

describe('format builders', () => {
  it('writes a Word document whose text reads back', () => {
    const z = unzipSync(F.buildDocx('One & two\n\nThree <3'));
    const xml = strFromU8(z['word/document.xml']);
    expect(Object.keys(z)).toContain('[Content_Types].xml');
    expect(xml).toContain('One &amp; two');
    expect(xml).toContain('Three &lt;3');
    expect(xml.match(/<w:p>/g)!.length).toBe(3);
  });

  it('writes and reads an Excel workbook', () => {
    const rows = [['name', 'qty'], ['apple, red', '3'], ['say "hi"', '007'], ['', '4.5']];
    expect(F.readXlsx(F.buildXlsx(rows))).toEqual(rows);
    expect(F.colName(0)).toBe('A');
    expect(F.colName(26)).toBe('AA');
  });

  it('parses and writes CSV with quotes, and detects the separator', () => {
    expect(F.parseDelimited('a,b\n"x,1","he said ""hi"""\n')).toEqual([['a', 'b'], ['x,1', 'he said "hi"']]);
    expect(F.parseDelimited('a;b\n1;2')).toEqual([['a', 'b'], ['1', '2']]);
    expect(F.parseDelimited('a\tb\n1\t2')).toEqual([['a', 'b'], ['1', '2']]);
    expect(F.toCsv([['a', 'b,c'], ['"q"', '1']])).toBe('a,"b,c"\r\n"""q""",1\r\n');
    expect(F.toMarkdownTable([['a', 'b'], ['1', '2']])).toBe('| a | b |\n| --- | --- |\n| 1 | 2 |\n');
  });

  it('writes a well-formed PDF from text and from pictures', () => {
    const t = strFromU8(F.buildPdfFromText('Hello (world)\n' + 'x'.repeat(200)), 'latin1' as never);
    expect(t.startsWith('%PDF-1.4')).toBe(true);
    expect(t).toContain('/BaseFont /Courier');
    expect(t).toContain('(Hello \\(world\\)) Tj');
    expect(t.trimEnd().endsWith('%%EOF')).toBe(true);
    const bytes = F.buildPdfFromText('page\n'.repeat(130)); // 3 pages
    expect(strFromU8(bytes, true as never)).toBeTruthy();
    expect((new TextDecoder('latin1').decode(bytes).match(/\/Type \/Page /g) ?? []).length).toBe(3);
    // xref offsets point at the objects
    const s = new TextDecoder('latin1').decode(bytes);
    const start = Number(/startxref\n(\d+)/.exec(s)![1]);
    expect(s.slice(start, start + 4)).toBe('xref');
    const first = Number(/xref\n0 \d+\n0000000000 65535 f \n(\d{10})/.exec(s)![1]);
    expect(s.slice(first, first + 7)).toBe('1 0 obj');
    const pic = new TextDecoder('latin1').decode(F.buildPdfFromJpegs([{ jpeg: new Uint8Array([0xff, 0xd8, 0xff, 0xd9]), w: 2, h: 2, wPt: 100, hPt: 50 }]));
    expect(pic).toContain('/Filter /DCTDecode');
    expect(pic).toContain('/MediaBox [0 0 100 50]');
    expect(F.unsupportedForPdf('abc é 漢')).toBe(1);
  });

  it('encodes WAV and BMP headers', () => {
    const wav = F.encodeWav([new Float32Array([0, 1, -1, 0.5])], 8000);
    expect(String.fromCharCode(...wav.slice(0, 4))).toBe('RIFF');
    expect(new DataView(wav.buffer).getUint32(24, true)).toBe(8000);
    expect(wav.length).toBe(44 + 8);
    expect(new DataView(wav.buffer).getInt16(46, true)).toBe(32767);
    expect(new DataView(wav.buffer).getInt16(48, true)).toBe(-32768);
    const bmp = F.encodeBmp(new Uint8ClampedArray([255, 0, 0, 255, 0, 0, 0, 0]), 2, 1);
    expect(String.fromCharCode(bmp[0], bmp[1])).toBe('BM');
    expect(Array.from(bmp.slice(54, 57))).toEqual([0, 0, 255]); // red as BGR
    expect(Array.from(bmp.slice(57, 60))).toEqual([255, 255, 255]); // transparent → white
  });

  it('turns HTML, Markdown and RTF into plain text', () => {
    expect(F.htmlToText('<html><head><style>p{}</style></head><body><h1>Hi &amp; bye</h1><p>One<br>two</p><ul><li>a</li><li>b</li></ul><script>x()</script></body></html>')).toBe('Hi & bye\nOne\ntwo\n\n- a\n- b');
    expect(F.markdownToText('# Title\n\nSome **bold** and *italic* with [a link](http://x.y) and `code`.\n\n- item')).toBe('Title\n\nSome bold and italic with a link and code.\n\n- item');
    const rtf = F.textToRtf('Line {one}\nTab\there é');
    expect(F.rtfToText(rtf)).toBe('Line {one}\nTab\there é');
    expect(F.rtfToText('{\\rtf1\\ansi{\\fonttbl{\\f0 Arial;}}\\f0 Hello\\par World \\u8364? ok}')).toBe('Hello\nWorld € ok');
  });

  it('builds web pages and zip files', () => {
    expect(F.textToHtml('a\nb\n\nc <d>', 'T')).toContain('<p>a<br>\nb</p>');
    expect(F.textToHtml('c <d>', 'T')).toContain('c &lt;d&gt;');
    expect(F.tableToHtml([['h'], ['v']], 'T')).toContain('<th>h</th>');
    expect(F.listZip(F.zipOne('a.txt', new Uint8Array([1, 2, 3])))).toBe('a.txt\t3 bytes');
    expect(F.safeName('a/b:c?.txt')).toBe('a_b_c_.txt');
    expect(F.baseName('x.tar.gz')).toBe('x.tar');
  });
});
