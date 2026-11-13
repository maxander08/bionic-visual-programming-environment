import { describe, expect, it } from 'vitest';
import { Engine } from './engine';
import { addNode, connect, emptyGraph, flatten } from './graph';
import { CATEGORIES, MODULES, getDef } from './registry';
import { FILE_KINDS, accepts, acceptAttr, classify, extOf, fmtBytes, fmtDuration, setFileInfo, type FileInfo } from './files';
import type { Graph, Params } from './types';

const NAMES = ['Document', 'Text', 'PDF', 'Audio', 'Video', 'Image', 'Spreadsheet', 'Presentation', 'Executable', 'Web', 'Compressed', 'Miscellaneous'];

const SPEC: Record<string, string[]> = {
  Document: ['docx', 'doc'], Text: ['md', 'txt', 'rtf'], PDF: ['pdf'], Audio: ['mp3', 'wav', 'm4a', 'flac', 'aac', 'ogg'],
  Video: ['mp4', 'mov', 'mkv', 'webm', 'avi'], Image: ['jpg', 'jpeg', 'png', 'gif', 'svg', 'webp', 'tiff'],
  Spreadsheet: ['xlsx', 'xls', 'csv', 'sql', 'accdb'], Presentation: ['pptx'], Executable: ['exe', 'msi', 'app', 'bat', 'sh'],
  Web: ['html', 'css', 'js', 'php'], Compressed: ['zip', 'rar', '7z', 'tar', 'gz'],
};

function run(nodes: [string, string, Params?][], wires: [string, string, string, string][] = []) {
  let g: Graph = emptyGraph();
  nodes.forEach(([id, type, p], i) => (g = addNode(g, type, i * 300, 0, p ?? {}, undefined, id).graph));
  for (const [a, ap, b, bp] of wires) g = connect(g, a, ap, b, bp).graph;
  const e = new Engine(50);
  e.load(flatten(g));
  e.runFor(300);
  return e;
}
const out = (e: Engine, id: string, port: string) => e.nodes.get(id)!.outputs[port]?.v;

describe('Files: the twelve nodes', () => {
  it('exist in a Files category, in the requested order, one node each', () => {
    const list = MODULES.filter((m) => m.category === 'Files');
    expect(list.map((m) => m.name)).toEqual(NAMES);
    expect(new Set(list.map((m) => m.type)).size).toBe(12);
    expect(CATEGORIES).toContain('Files');
    for (const m of list) expect(m.family).toBe('file');
  });

  it('take exactly the extensions that were asked for', () => {
    for (const k of FILE_KINDS.filter((x) => x.id !== 'misc')) {
      const want = SPEC[k.name];
      for (const e of want) expect(classify(`file.${e.toUpperCase()}`).id, `${k.name} .${e}`).toBe(k.id);
      // anything extra is an alias on top of the list (TIFF is also written .tif)
      expect(k.exts.filter((e) => !want.includes(e))).toEqual(k.id === 'image' ? ['tif'] : []);
    }
  });

  it('send everything else to Miscellaneous', () => {
    for (const n of ['a.xyz', 'README', 'archive.bak', '.hidden', 'x.pdf.part', 'photo.heic', 'a.']) expect(classify(n).id, n).toBe('misc');
    expect(classify('Report.Final.PDF').id).toBe('pdf');
    expect(classify('C:\\docs\\a.docx').id).toBe('document');
  });

  it('refuse a file that belongs to another node', () => {
    const doc = FILE_KINDS[0], misc = FILE_KINDS[11];
    expect(accepts(doc, 'a.docx')).toBe(true);
    expect(accepts(doc, 'a.pdf')).toBe(false);
    expect(accepts(misc, 'a.pdf')).toBe(false);
    expect(accepts(misc, 'a.xyz')).toBe(true);
    expect(acceptAttr(misc)).toBeUndefined();
    expect(acceptAttr(doc)).toBe('.docx,.doc');
  });

  it('read extensions and sizes sensibly', () => {
    expect(extOf('a.b.TXT')).toBe('txt');
    expect(extOf('noext')).toBe('');
    expect(fmtBytes(0)).toBe('0 B');
    expect(fmtBytes(1536)).toBe('1.50 KB');
    expect(fmtBytes(5 * 1024 * 1024)).toBe('5.00 MB');
    expect(fmtDuration(75)).toBe('1:15');
    expect(fmtDuration(3725)).toBe('1:02:05');
  });

  it('have no setting pins and keep their pins within the node edges', () => {
    for (const m of MODULES.filter((x) => x.category === 'Files')) {
      const d = getDef(m.type)!;
      expect(d.paramPins ?? [], m.type).toHaveLength(0);
      expect(d.inputs, m.type).toHaveLength(0);
      expect(d.dim, m.type).toBeUndefined();
      const per = (s: string) => d.outputs.filter((p) => (p.side ?? 'bottom') === s).length;
      expect(per('bottom') + 1, m.type).toBeLessThanOrEqual(6); // 6 × 24 px fits the 144 px edge
      expect(per('right') + 1, m.type).toBeLessThanOrEqual(5); // 5 × 24 px fits the 132 px edge
    }
  });
});

describe('Files: running', () => {
  const info = (over: Partial<FileInfo>): FileInfo => ({ id: 'tf1', name: 'notes.txt', ext: 'txt', size: 42, mime: 'text/plain', modified: 1, ...over });
  const withFile = { fileId: 'tf1', fileName: 'notes.txt', fileExt: 'txt', fileSize: '42', fileMime: 'text/plain', fileModified: '1' };

  it('an empty node emits nothing and raises no warning', () => {
    const e = run([['f', 'file-text']]);
    expect(out(e, 'f', 'file')).toBeUndefined();
    expect(e.nodes.get('f')!.status.level).toBe('ok');
    expect(e.nodes.get('f')!.viewData.state).toBe('empty');
  });

  it('a file that is not in this browser warns instead of failing', () => {
    const e = run([['f', 'file-pdf', { ...withFile, fileId: 'nowhere', fileName: 'x.pdf', fileExt: 'pdf' }]]);
    expect(e.nodes.get('f')!.status.level).toBe('warn');
    expect(out(e, 'f', 'file')).toBeUndefined();
  });

  it('a text file sends its content, lines and descriptor', () => {
    setFileInfo(info({ text: 'hello\nworld', lines: 2 }));
    const e = run([['f', 'file-text', withFile], ['s', 'string']], [['f', 'content', 's', 'in']]);
    expect(out(e, 'f', 'content')).toBe('hello\nworld');
    expect(out(e, 'f', 'lines')).toBe(2);
    expect(out(e, 'f', 'name')).toBe('notes.txt');
    expect(out(e, 'f', 'ext')).toBe('txt');
    expect(out(e, 'f', 'size')).toBe(42);
    expect(out(e, 'f', 'loaded')).toBe(true);
    expect(out(e, 'f', 'file')).toMatchObject({ kind: 'file', type: 'text', name: 'notes.txt', size: 42 });
    expect(out(e, 's', 'out')).toBe('hello\nworld');
  });

  it('an image node sends the picture and its true size; a media node sends its length', () => {
    const img = { w: 1, h: 1, data: new Uint8ClampedArray(4) };
    setFileInfo(info({ id: 'ti', name: 'a.png', ext: 'png', image: img, width: 800, height: 600 }));
    setFileInfo(info({ id: 'tv', name: 'a.mp4', ext: 'mp4', duration: 12.5, width: 1920, height: 1080 }));
    const e = run([['i', 'file-image', { fileId: 'ti', fileName: 'a.png', fileExt: 'png', fileSize: '9' }], ['v', 'file-video', { fileId: 'tv', fileName: 'a.mp4', fileExt: 'mp4', fileSize: '9' }]]);
    expect(out(e, 'i', 'image')).toBe(img);
    expect(out(e, 'i', 'width')).toBe(800);
    expect(out(e, 'v', 'duration')).toBe(12.5);
    expect(out(e, 'v', 'height')).toBe(1080);
  });

  it('a runtime problem with the file is reported as a warning but the outputs still flow', () => {
    setFileInfo(info({ id: 'tw', text: 'abc', lines: 1, warn: 'The file is longer than 1 000 000 characters: Content holds only the first part.' }));
    const e = run([['f', 'file-text', { ...withFile, fileId: 'tw' }]]);
    expect(e.nodes.get('f')!.status.level).toBe('warn');
    expect(out(e, 'f', 'content')).toBe('abc');
  });
});
