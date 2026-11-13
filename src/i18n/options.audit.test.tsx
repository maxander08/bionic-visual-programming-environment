// @vitest-environment jsdom
// Audit: one node per (module × setting × option), engine running. For each batch the language is switched *after* the
// nodes exist and the faces are scanned for Latin leftovers. Set AUDIT_LANG=zh-Hant to audit Traditional.
import { it, expect } from 'vitest';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import App from '../App';
import { useStore } from '../state/store';
import { MODULES, getDef } from '../core/registry';
import { play, stop } from '../runtime/session';
import { FILE_KINDS } from '../core/files';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
(globalThis as any).ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
(globalThis as any).matchMedia = (q: string) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} });
(Element.prototype as any).animate = undefined;
const ctx2d = new Proxy({}, { get: (_t, k) => (k === 'canvas' ? {} : () => ({ width: 0 })), set: () => true });
(HTMLCanvasElement.prototype as any).getContext = () => ctx2d;

const host = document.createElement('div');
document.body.appendChild(host);

// Latin that is correct in every language: unit symbols of the quantity modules, math function names in formulas.
// Faces that show what the *user* typed or what flows through the program (data, not interface): they stay as they are.
const DATA_FACES: Record<string, RegExp> = {
  string: /^"?hello"?$/i, info: /^hello$/, event: /^go$/, boolean: /^(true|false|yes|no|on|off)$/, equation: /^sin\(x\)$/,
  setlanguage: /^English$/, // a language's own name is always written in that language
};
// Files nodes show the file formats they take (.DOCX .DOC): format names are Latin in every language.
for (const k of FILE_KINDS) DATA_FACES[k.type] = /^[.A-Z0-9\s]+$/;
const SYMBOLS = /\b(Hz|UTC)\b/g;
const OK_QTY = /^[=\s\d.eE+\-−]*[A-Za-zμΩ°/·²³]{1,6}$/;

it.each(['zh-Hans', 'zh-Hant'] as const)('%s: every node face on the canvas is translated after a language switch', async (lang) => {
  const specs: { type: string; params?: Record<string, unknown>; why: string }[] = [];
  for (const m of MODULES) {
    specs.push({ type: m.type, why: 'default' });
    for (const p of getDef(m.type)!.params) if (p.kind === 'select') for (const o of p.options) specs.push({ type: m.type, params: { [p.key]: o.value }, why: `${p.key}=${o.value}` });
  }
  const root = createRoot(host);
  await act(async () => { root.render(<App />); });
  const found = new Map<string, Set<string>>();
  let scanned = 0;
  for (let b = 0; b < specs.length; b += 60) {
    await act(async () => { stop(); useStore.getState().setSettings({ language: 'en' }); useStore.getState().newBlank(); });
    const meta = new Map<string, string>();
    await act(async () => {
      specs.slice(b, b + 60).forEach((s, i) => { const id = useStore.getState().addNodeAt(s.type, 60 + (i % 10) * 250, 60 + Math.floor(i / 10) * 200, s.params); if (id) meta.set(id, `${s.type}:${s.why}`); });
    });
    await act(async () => { play(); await new Promise((r) => setTimeout(r, 250)); });
    await act(async () => { useStore.getState().setSettings({ language: lang }); });
    host.querySelectorAll('.node:not(.preview)').forEach((n) => {
      scanned++;
      const id = (n as HTMLElement).dataset.node!;
      const texts: string[] = [];
      const w = document.createTreeWalker(n, NodeFilter.SHOW_TEXT);
      let t: Node | null;
      while ((t = w.nextNode())) { const s = (t.textContent ?? '').trim(); if (s) texts.push(s); }
      n.querySelectorAll('[aria-label],[title]').forEach((e) => texts.push(e.getAttribute('aria-label') ?? '', e.getAttribute('title') ?? ''));
      const mt = meta.get(id) ?? '';
      const qty = mt.startsWith('qty-');
      const data = DATA_FACES[mt.split(':')[0]];
      for (const s of new Set(texts)) if (/[A-Za-z]{2,}/.test(s.replace(SYMBOLS, '')) && !(qty && (OK_QTY.test(s) || !/[A-Za-z]{6,}/.test(s))) && !data?.test(s)) (found.get(s) ?? found.set(s, new Set()).get(s)!).add(meta.get(id) ?? id);
    });
  }
  stop();
  const lines = [...found.entries()].sort().map(([s, w]) => `${JSON.stringify(s)}  ←  ${[...w].slice(0, 3).join(', ')}${w.size > 3 ? ` (+${w.size - 3})` : ''}`);
  expect(scanned).toBe(specs.length);
  expect(lines.join('\n')).toBe('');
}, 170000);
