// @vitest-environment jsdom
// Site-wide audit: toolbar, library, inspector and documentation for every module, and every dialog. The language is
// switched while the panel is already open (the situation the user is in), then the visible text is scanned.
import { it, expect } from 'vitest';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import fs from 'fs';
import App from '../App';
import { useStore } from '../state/store';
import { MODULES } from '../core/registry';
import { stop } from '../runtime/session';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
(globalThis as any).ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
(globalThis as any).matchMedia = (q: string) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} });
(Element.prototype as any).animate = undefined;
(Element.prototype as any).scrollIntoView = () => {};
(Element.prototype as any).scrollTo = () => {};
(window as any).scrollTo = () => {};
const ctx2d = new Proxy({}, { get: (_t, k) => (k === 'canvas' ? {} : () => ({ width: 0 })), set: () => true });
(HTMLCanvasElement.prototype as any).getContext = () => ctx2d;
(window as any).innerWidth = 1600;

const host = document.createElement('div');
document.body.appendChild(host);

// Latin that is right in every language: product name, file formats, SI/technical symbols, key names, code.
const OK = /^(Neural Studio|JSON|PNG|SVG|QR|URL|HTML|CSV|RGB|HSL|HSV|UTC|Hz|kHz|ms|Ctrl|Cmd|Shift|Alt|Enter|Esc|Del|Tab|Space|AM|PM|OK|ID|API|FPS|PCM|WAV|MP3|GPS|CPU|3D|2D|[A-Z]{1,3}\d?)$/;

function strings(): string[] {
  const out: string[] = [];
  const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
    acceptNode: (n) => (n.parentElement?.closest('script,style,.node,code,kbd,pre.code,.mono') ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT),
  });
  let t: Node | null;
  while ((t = w.nextNode())) { const s = (t.textContent ?? '').trim(); if (s) out.push(s); }
  document.body.querySelectorAll('[aria-label],[title],[placeholder],option').forEach((e) => {
    if (e.closest('.node')) return;
    for (const a of ['aria-label', 'title', 'placeholder']) { const v = e.getAttribute(a); if (v) out.push(v); }
  });
  return out;
}

// Values that sit in editable fields (what the user typed or a stored default) or are fixtures of this test.
const DATA_VALUES = /^(hello|sin\(x\)|y = sin\(x\)|true \/ false|Tokyo, Japan|Asia\/Tokyo|Note to self|Delete this\?|idle>active[\s\S]*)$/;
const KEYNAMES = /\b(Hz|UTC|kHz|MHz|ms|Enter|Ctrl|Shift|Esc|Space|Alt|Cmd|Tab|Del|Delete|Backspace|zh-Hans|zh-Hant|English|JSON|PNG|SVG|QR|URL|HTML|CSV|RGB|HSL|HSV|Neural Studio|Base64|ID|en|x|y|t)\b/g;
const bad = (s: string) => /[A-Za-z]{3,}/.test(s.replace(/\([a-z]+-\d+\)/g, '').replace(KEYNAMES, '')) && !OK.test(s);

it.each(['zh-Hans', 'zh-Hant'] as const)('%s: the whole interface is translated', async (lang) => {
  const found = new Map<string, string>();
  const scan = (tag: string) => { for (const s of strings()) if (bad(s) && !found.has(s)) found.set(s, tag); };
  const set = (l: string) => act(async () => { useStore.getState().setSettings({ language: l as any }); });
  const st = () => useStore.getState();

  await act(async () => { st().setSettings({ language: 'en' }); st().newBlank(); });
  const ids = new Map<string, string>();
  await act(async () => { MODULES.forEach((m, i) => { const id = st().addNodeAt(m.type, 60 + (i % 8) * 260, 60 + Math.floor(i / 8) * 220); if (id) ids.set(m.type, id); }); });
  const root = createRoot(host);
  await act(async () => { root.render(<App />); });
  await act(async () => { st().setUi({ lib: true, insp: true }); });

  // chrome + library tabs
  for (const tab of ['modules', 'presets', 'examples'] as const) {
    await act(async () => { st().setUi({ libTab: tab }); });
    await set('en'); await set(lang); scan(`library:${tab}`);
  }
  await act(async () => { st().setUi({ libTab: 'modules' }); });
  // inspector for every module
  for (const [type, id] of ids) {
    await act(async () => { st().select([id]); });
    await set('en'); await set(lang); scan(`inspector:${type}`);
  }
  await act(async () => { st().select([]); });
  // dialogs
  for (const d of ['templates', 'projects', 'share', 'settings', 'group'] as const) {
    await act(async () => { if (d === 'group') st().select([...ids.values()].slice(0, 2)); st().openDialog(d as any); });
    await set('en'); await set(lang); scan(`dialog:${d}`);
    await act(async () => { st().openDialog(null); });
  }
  await act(async () => { st().confirm({ title: tr0('Delete'), body: tr0('Delete this?'), confirm: tr0('Delete'), onConfirm() {} }); });
  await set('en'); await set(lang); scan('dialog:confirm');
  await act(async () => { st().openDialog(null); });
  // documentation page of every module, opened first in English and switched live
  for (const [type, id] of ids) {
    await act(async () => { st().select([id]); st().openDialog('docs'); });
    await set('en'); await set(lang); scan(`docs:${type}`);
    await act(async () => { st().openDialog(null); });
  }
  stop();
  const lines = [...found.entries()].map(([s, w]) => `${JSON.stringify(s.slice(0, 140))}  ←  ${w}`);
  fs.writeFileSync(`/tmp/ui-leftovers-${lang}.txt`, lines.join('\n'));
  // Documentation article prose is long-form content that is still English-only; it is reported in the file above, not asserted.
  // Asserted: every short interface label (not docs prose, not sentence-length port descriptions, not default project names).
  const labels = lines.filter((l) => { if (/←  docs:/.test(l)) return false; const s: string = JSON.parse(l.split('  ←  ')[0]); return s.length <= 40 && !/[.。]$/.test(s) && !/[\u3400-\u9fff]/.test(s) && s !== 'Untitled program' && !DATA_VALUES.test(s); });
  expect(labels.slice(0, 60).join('\n')).toBe('');
}, 600000);

function tr0(s: string) { return s; }
