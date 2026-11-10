import { MODULES, getDef } from '../../core/registry';
import { PACKAGES } from '../../core/packages';
import { fmtNum } from '../../core/util';
import { ARTICLES, GOALS } from './content';
import { GUIDE } from './nodeGuide';
import { RECIPES } from './recipes';
import { blockText, plain, slug } from './markup';
import type { Route } from './types';

export type Kind = 'Node' | 'Setting' | 'Pin' | 'Guide' | 'Recipe' | 'Package' | 'Term' | 'Fix' | 'Shortcut' | 'Goal';

export interface Entry {
  id: string;
  kind: Kind;
  title: string;
  /** Shown under the title in results. */
  sub: string;
  body: string;
  keys: string;
  route: Route;
  anchor?: string;
  boost: number;
  /** Family colour hint for node-related results. */
  family?: string;
}

const BOOST: Record<Kind, number> = { Node: 1.5, Guide: 1.25, Goal: 1.2, Recipe: 1.1, Package: 1.1, Fix: 1.1, Term: 1, Setting: 1, Shortcut: 1, Pin: 0.8 };

export const KIND_ORDER: Kind[] = ['Node', 'Setting', 'Guide', 'Recipe', 'Goal', 'Package', 'Fix', 'Term', 'Pin', 'Shortcut'];

let cache: Entry[] | null = null;

export function paramSummary(p: any): string {
  if (p.kind === 'number') return `Number ${fmtNum(p.min)} to ${fmtNum(p.max)}${p.unit ? ' ' + p.unit : ''}, default ${fmtNum(p.default)}`;
  if (p.kind === 'select') return `Choice: ${p.options.map((o: any) => o.label).join(', ')}`;
  if (p.kind === 'bool') return `Switch, default ${p.default ? 'on' : 'off'}`;
  if (p.kind === 'text') return 'Text';
  return 'Button';
}

export function buildIndex(): Entry[] {
  if (cache) return cache;
  const out: Entry[] = [];

  for (const m of MODULES) {
    const d = getDef(m.type)!;
    const g = GUIDE[m.type];
    out.push({
      id: `n:${m.type}`, kind: 'Node', title: m.name, sub: `${m.caption} · ${m.category}`,
      body: [m.doc.summary, m.doc.runtime, g?.when, ...(g?.steps ?? []), ...(g?.tips ?? []), ...(m.doc.errors ?? [])].filter(Boolean).map((s) => plain(s!)).join(' '),
      keys: [m.type, m.caption, m.keywords, g?.alias].filter(Boolean).join(' '),
      route: { k: 'node', type: m.type }, boost: BOOST.Node, family: m.family,
    });
    for (const p of d.params) {
      if (p.kind !== 'action' && p.hidden) continue;
      const tip = g?.settings?.[p.key] ?? '';
      const opts = p.kind === 'select' ? p.options.map((o) => `${o.label} ${o.value} ${g?.options?.[p.key]?.[o.value] ?? ''}`).join(' ') : '';
      out.push({
        id: `s:${m.type}:${p.key}`, kind: 'Setting', title: `${m.name} › ${p.label}`, sub: paramSummary(p),
        body: `${p.doc} ${plain(tip)} ${opts}`, keys: `${p.key} setting parameter ${m.type}`,
        route: { k: 'node', type: m.type }, anchor: `set-${p.key}`, boost: BOOST.Setting, family: m.family,
      });
    }
    for (const p of [...m.inputs, ...m.outputs]) {
      out.push({
        id: `p:${m.type}:${p.id}`, kind: 'Pin', title: `${m.name} › ${p.label}`, sub: `${m.inputs.includes(p) ? 'Input' : 'Output'} · ${p.type}${p.optional ? ' · optional' : ''}`,
        body: p.doc, keys: `${p.id} pin port ${p.type}`,
        route: { k: 'node', type: m.type }, anchor: `pin-${p.id}`, boost: BOOST.Pin, family: m.family,
      });
    }
  }

  for (const a of ARTICLES) {
    out.push({
      id: `a:${a.id}`, kind: 'Guide', title: a.title, sub: a.group, body: `${a.summary} ${a.blocks.map(blockText).join(' ')}`,
      keys: a.keywords ?? '', route: { k: 'article', id: a.id }, boost: BOOST.Guide,
    });
    // Row-level entries so people can find a single term, fix or shortcut.
    for (const b of a.blocks) {
      if (a.id === 'glossary' && b.t === 'table') for (const [term, def] of b.rows) out.push({ id: `t:${slug(term)}`, kind: 'Term', title: plain(term), sub: 'Glossary', body: plain(def), keys: '', route: { k: 'article', id: a.id }, anchor: `r-${slug(term)}`, boost: BOOST.Term });
      if (a.id === 'troubleshooting' && b.t === 'table') for (const [sym, cause, fix] of b.rows) out.push({ id: `f:${slug(sym)}`, kind: 'Fix', title: plain(sym), sub: 'Troubleshooting', body: `${plain(cause)} ${plain(fix)}`, keys: 'problem fix', route: { k: 'article', id: a.id }, anchor: `r-${slug(sym)}`, boost: BOOST.Fix });
      if (a.id === 'shortcuts' && b.t === 'keys') for (const [ks, desc] of b.rows) out.push({ id: `k:${slug(ks.join('-') + desc)}`, kind: 'Shortcut', title: desc, sub: ks.join(' + '), body: ks.join(' '), keys: 'keyboard shortcut hotkey', route: { k: 'article', id: a.id }, anchor: `r-${slug(desc)}`, boost: BOOST.Shortcut });
    }
  }

  for (const r of RECIPES) {
    out.push({ id: `r:${r.id}`, kind: 'Recipe', title: r.title, sub: `${r.level} recipe`, body: `${r.summary} ${r.steps.map(plain).join(' ')} ${r.expect}`, keys: r.tags, route: { k: 'recipe', id: r.id }, boost: BOOST.Recipe });
  }

  for (const p of PACKAGES) {
    out.push({
      id: `k:${p.id}`, kind: 'Package', title: p.name, sub: `${p.host === 'knowledge' ? 'Knowledge' : 'Imagination'} package · ${p.status}`,
      body: `${p.description} ${p.technique} ${p.requirements} ${p.limitations} ${p.inputs} ${p.outputs} ${p.params.map((q) => `${q.label} ${q.doc}`).join(' ')}`,
      keys: `${p.id} ${p.short} package inference model`, route: { k: 'packages' }, anchor: `pkg-${p.id}`, boost: BOOST.Package,
    });
  }

  for (const g of GOALS) {
    out.push({ id: `g:${slug(g.goal)}`, kind: 'Goal', title: `I want to: ${g.goal.toLowerCase()}`, sub: 'Find a node by goal', body: `${g.hint} ${g.nodes.map((n) => MODULES.find((m) => m.type === n)?.name).join(' ')}`, keys: '', route: { k: 'finder' }, anchor: `goal-${slug(g.goal)}`, boost: BOOST.Goal });
  }
  cache = out;
  return out;
}

const STOP = new Set(['the', 'a', 'an', 'to', 'how', 'do', 'i', 'is', 'of', 'in', 'on', 'my', 'and', 'or', 'for', 'with', 'it', 'what', 'can', 'use']);
export const tokenize = (q: string) => [...new Set(q.toLowerCase().split(/[^a-z0-9.+#/_-]+/).map((t) => t.replace(/^[-.]+|[-.]+$/g, '')).filter((t) => t && !STOP.has(t)))];

function within1(a: string, b: string): boolean {
  if (Math.abs(a.length - b.length) > 1) return false;
  let i = 0, j = 0, edits = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) { i++; j++; continue; }
    if (++edits > 1) return false;
    if (a.length > b.length) i++; else if (b.length > a.length) j++; else { i++; j++; }
  }
  return edits + (a.length - i) + (b.length - j) <= 1;
}

/** Very light stemming so “breathing”, “breathes” and “breath” meet. */
export function stem(w: string): string {
  if (w.length > 5 && w.endsWith('ing')) return w.slice(0, -3);
  if (w.length > 4 && w.endsWith('ies')) return w.slice(0, -3) + 'y';
  if (w.length > 4 && w.endsWith('es')) return w.slice(0, -2);
  if (w.length > 4 && w.endsWith('ed')) return w.slice(0, -2);
  if (w.length > 3 && w.endsWith('s') && !w.endsWith('ss')) return w.slice(0, -1);
  return w;
}

interface Prepared { e: Entry; t: string; words: string[]; stems: string[]; k: string; s: string; b: string }
let prepared: Prepared[] | null = null;
const prep = () => prepared ??= buildIndex().map((e) => {
  const t = e.title.toLowerCase();
  const words = t.split(/[^a-z0-9]+/).filter(Boolean);
  return { e, t, words, stems: words.map(stem), k: e.keys.toLowerCase(), s: e.sub.toLowerCase(), b: e.body.toLowerCase() };
});

export interface Hit { entry: Entry; score: number }

export function search(q: string, kind?: Kind | 'All'): Hit[] {
  const tokens = tokenize(q);
  if (!tokens.length) return [];
  const full = q.trim().toLowerCase();
  const hits: Hit[] = [];
  for (const p of prep()) {
    if (kind && kind !== 'All' && p.e.kind !== kind) continue;
    let total = 0, ok = true;
    for (const tk of tokens) {
      let s = 0;
      const st = stem(tk);
      if (p.t === tk) s = 100;
      else if (p.words.includes(tk)) s = 60;
      else if (st.length >= 4 && p.stems.includes(st)) s = 50;
      else if (p.words.some((w) => w.startsWith(tk))) s = 42;
      else if (p.t.includes(tk)) s = 26;
      else if (p.k.split(/\s+/).includes(tk)) s = 30;
      else if (p.k.includes(tk)) s = 20;
      else if (p.s.includes(tk)) s = 10;
      else if (p.b.includes(tk)) s = 4;
      else if (st.length >= 4 && p.b.includes(st)) s = 3;
      else if (tk.length >= 4 && p.words.some((w) => within1(w, tk))) s = 18;
      else if (tk.length >= 4 && p.k.split(/\s+/).some((w) => within1(w, tk))) s = 14;
      if (!s) { ok = false; break; }
      total += s;
    }
    if (!ok) continue;
    if (tokens.length > 1 && p.t.includes(full)) total += 40;
    hits.push({ entry: p.e, score: total * p.e.boost });
  }
  return hits.sort((a, b) => b.score - a.score || a.entry.title.localeCompare(b.entry.title));
}

/** A short excerpt of `body` around the first matching token. */
export function snippet(body: string, tokens: string[], len = 150): string {
  const lc = body.toLowerCase();
  let at = -1;
  for (const t of tokens) { const i = lc.indexOf(t); if (i >= 0 && (at < 0 || i < at)) at = i; }
  if (at < 0) return body.slice(0, len) + (body.length > len ? '…' : '');
  const start = Math.max(0, at - 40);
  return (start > 0 ? '…' : '') + body.slice(start, start + len) + (start + len < body.length ? '…' : '');
}
