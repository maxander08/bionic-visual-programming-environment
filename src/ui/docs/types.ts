import { createContext } from 'react';

/** Where the documentation viewer is pointing. */
export type Route =
  | { k: 'home' }
  | { k: 'article'; id: string }
  | { k: 'node'; type: string }
  | { k: 'nodes' }
  | { k: 'recipes' }
  | { k: 'recipe'; id: string }
  | { k: 'settings' }
  | { k: 'packages' }
  | { k: 'finder' };

export const routeKey = (r: Route): string =>
  r.k === 'article' || r.k === 'recipe' ? `${r.k}:${r.id}` : r.k === 'node' ? `node:${r.type}` : r.k;

export interface Nav {
  go(r: Route, anchor?: string): void;
  close(): void;
  isBookmarked(key: string): boolean;
  toggleBookmark(key: string): void;
}

export const NavCtx = createContext<Nav>({ go() {}, close() {}, isBookmarked: () => false, toggleBookmark() {} });

/** Structured article blocks. Inline markup: **bold**, `code`, [[n:type]], [[a:article]], [[r:recipe]], [[x:nodes|settings|packages|finder|recipes]]. */
export type Block =
  | { t: 'p'; x: string }
  | { t: 'h'; x: string }
  | { t: 'ul'; items: string[] }
  | { t: 'ol'; items: string[] }
  | { t: 'note' | 'tip' | 'warn'; x: string; title?: string }
  | { t: 'table'; head: string[]; rows: string[][] }
  | { t: 'keys'; rows: [string[], string][] }
  | { t: 'flow'; items: string[] };

export type ArticleGroup = 'Start here' | 'Core concepts' | 'Guides' | 'Reference';

export interface Article {
  id: string;
  title: string;
  group: ArticleGroup;
  summary: string;
  keywords?: string;
  blocks: Block[];
  related?: string[];
}
