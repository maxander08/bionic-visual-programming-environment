import { MODULES } from '../../core/registry';
import { ARTICLE_BY_ID } from './content';
import { RECIPE_BY_ID } from './recipes';
import type { Block, Route } from './types';

const NODE_NAME = new Map(MODULES.map((m) => [m.type, m.name]));
export const nodeName = (type: string) => NODE_NAME.get(type) ?? type;

export const X_PAGES: Record<string, { route: Route; label: string }> = {
  nodes: { route: { k: 'nodes' }, label: 'Node reference' },
  settings: { route: { k: 'settings' }, label: 'Settings index' },
  packages: { route: { k: 'packages' }, label: 'Inference packages' },
  finder: { route: { k: 'finder' }, label: 'Find a node by goal' },
  recipes: { route: { k: 'recipes' }, label: 'Cookbook' },
};

export type Inline = { t: 'text' | 'b' | 'code'; x: string } | { t: 'link'; x: string; route: Route };

const TOKEN = /(\*\*[^*]+\*\*|`[^`]+`|\[\[[^\]]+\]\])/g;

export function parseInline(src: string): Inline[] {
  const out: Inline[] = [];
  for (const part of src.split(TOKEN)) {
    if (!part) continue;
    if (part.startsWith('**') && part.endsWith('**') && part.length > 4) out.push({ t: 'b', x: part.slice(2, -2) });
    else if (part.startsWith('`') && part.endsWith('`') && part.length > 2) out.push({ t: 'code', x: part.slice(1, -1) });
    else if (part.startsWith('[[') && part.endsWith(']]')) {
      const [target, label] = part.slice(2, -2).split('|');
      const [kind, id] = target.split(':');
      let route: Route | null = null, text = label;
      if (kind === 'n') { route = { k: 'node', type: id }; text ??= nodeName(id); }
      else if (kind === 'a') { route = { k: 'article', id }; text ??= ARTICLE_BY_ID.get(id)?.title ?? id; }
      else if (kind === 'r') { route = { k: 'recipe', id }; text ??= RECIPE_BY_ID.get(id)?.title ?? id; }
      else if (kind === 'x' && X_PAGES[id]) { route = X_PAGES[id].route; text ??= X_PAGES[id].label; }
      if (route) out.push({ t: 'link', x: text ?? id, route });
      else out.push({ t: 'text', x: label ?? target });
    } else out.push({ t: 'text', x: part });
  }
  return out;
}

/** Plain text of marked-up copy, for the search index. */
export const plain = (src: string) => parseInline(src).map((i) => i.x).join('');

export function blockText(b: Block): string {
  switch (b.t) {
    case 'p': case 'h': case 'note': case 'tip': case 'warn': return plain(b.x) + (('title' in b && b.title) ? ' ' + b.title : '');
    case 'ul': case 'ol': case 'flow': return b.items.map(plain).join(' ');
    case 'table': return b.rows.map((r) => r.map(plain).join(' ')).join(' ');
    case 'keys': return b.rows.map(([k, d]) => k.join(' ') + ' ' + d).join(' ');
  }
}

export const slug = (s: string) => plain(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 48);
