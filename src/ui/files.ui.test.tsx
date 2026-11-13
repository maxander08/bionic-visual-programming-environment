// @vitest-environment jsdom
// Drag-and-drop and click behaviour of the Files nodes, driven through the real editor.
import { expect, it } from 'vitest';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import App from '../App';
import { useStore } from '../state/store';
import { play, stop, engine } from '../runtime/session';
import { getFileInfo } from '../core/files';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
(globalThis as any).ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
(globalThis as any).matchMedia = (q: string) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} });
(Element.prototype as any).animate = undefined;
(Element.prototype as any).scrollIntoView = () => {};
const ctx2d = new Proxy({}, { get: (_t, k) => (k === 'canvas' ? {} : () => ({ width: 0 })), set: () => true });
(HTMLCanvasElement.prototype as any).getContext = () => ctx2d;

const st = () => useStore.getState();
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

function drop(target: Element, files: File[]) {
  const e = new Event('drop', { bubbles: true, cancelable: true });
  Object.defineProperty(e, 'dataTransfer', { value: { types: ['Files'], files, dropEffect: 'none' } });
  target.dispatchEvent(e);
  return e;
}
const nodeEl = (id: string) => document.querySelector(`[data-node="${id}"]`)!;

it('files can be dropped on a node, on empty workspace, and clicked', async () => {
  const host = document.createElement('div');
  document.body.appendChild(host);
  await act(async () => { st().setSettings({ language: 'en' }); st().newBlank(); });
  const root = createRoot(host);
  await act(async () => { root.render(<App />); });

  let id = '';
  await act(async () => { id = st().addNodeAt('file-text', 120, 120)!; });
  expect(nodeEl(id).querySelector('.file-face')).toBeTruthy();
  expect(nodeEl(id).textContent).toContain('.MD .TXT .RTF');

  // 1. a text file dropped on the node is read and stored
  await act(async () => { drop(nodeEl(id), [new File(['hello\nworld'], 'notes.txt', { type: 'text/plain' })]); await wait(50); });
  const p = st().project.graph.nodes[id].params;
  expect(p.fileName).toBe('notes.txt');
  expect(p.fileExt).toBe('txt');
  expect(p.fileSize).toBe('11');
  expect(getFileInfo(String(p.fileId))?.text).toBe('hello\nworld');
  expect(nodeEl(id).textContent).toContain('notes.txt');

  // 2. running the program sends the content
  await act(async () => { play(); await wait(200); });
  expect(engine.nodes.get(id)!.outputs.content?.v).toBe('hello\nworld');
  expect(engine.nodes.get(id)!.outputs.lines?.v).toBe(2);
  await act(async () => { stop(); });

  // 3. a file that belongs elsewhere is turned away and the node keeps what it had
  await act(async () => { drop(nodeEl(id), [new File(['%PDF'], 'paper.pdf')]); await wait(30); });
  expect(st().project.graph.nodes[id].params.fileName).toBe('notes.txt');
  expect(st().toasts.some((t) => t.kind === 'error' && t.msg.includes('PDF'))).toBe(true);

  // 4. dropping on empty workspace creates the right node for each file, Miscellaneous for the unknown
  const before = Object.keys(st().project.graph.nodes).length;
  const canvas = document.querySelector('.canvas-root')!;
  await act(async () => { drop(canvas, [new File(['%PDF'], 'paper.pdf'), new File(['x'], 'mystery.xyz'), new File(['a,b\n1,2\n'], 'table.csv')]); await wait(100); });
  const nodes = Object.values(st().project.graph.nodes);
  expect(nodes.length).toBe(before + 3);
  const by = (t: string) => nodes.find((n) => n.type === t)!;
  expect(by('file-pdf').params.fileName).toBe('paper.pdf');
  expect(by('file-misc').params.fileName).toBe('mystery.xyz');
  expect(by('file-spreadsheet').params.fileName).toBe('table.csv');
  expect(getFileInfo(String(by('file-spreadsheet').params.fileId))?.lines).toBe(2);

  // 5. clicking the face opens the file chooser
  const input = nodeEl(id).querySelector('input[type=file]') as HTMLInputElement;
  expect(input.accept).toBe('.md,.txt,.rtf');
  let opened = 0;
  input.click = () => { opened++; };
  await act(async () => { (nodeEl(id).querySelector('.file-face') as HTMLButtonElement).click(); });
  expect(opened).toBe(1);
  expect(st().selection).toEqual([id]);

  // 6. the inspector offers the same, and Remove empties the node (Undo brings the file back)
  await act(async () => { st().setUi({ insp: true }); });
  expect(document.body.textContent).toContain('Remove file');
  await act(async () => { (Array.from(document.querySelectorAll('button')).find((b) => b.textContent === 'Remove file') as HTMLButtonElement).click(); });
  expect(st().project.graph.nodes[id].params.fileId).toBe('');
  await act(async () => { st().undo(); });
  expect(st().project.graph.nodes[id].params.fileName).toBe('notes.txt');
  root.unmount();
}, 60000);
