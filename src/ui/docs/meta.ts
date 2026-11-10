import { MODULES } from '../../core/registry';
import { ARTICLE_BY_ID } from './content';
import { RECIPE_BY_ID } from './recipes';
import { X_PAGES, nodeName } from './markup';
import type { Route } from './types';

export function routeFromKey(key: string): Route | null {
  const [k, id] = key.split(':');
  if (k === 'article' && ARTICLE_BY_ID.has(id)) return { k, id };
  if (k === 'recipe' && RECIPE_BY_ID.has(id)) return { k, id };
  if (k === 'node' && MODULES.some((m) => m.type === id)) return { k, type: id };
  if (k in X_PAGES) return X_PAGES[k].route;
  if (k === 'home') return { k: 'home' };
  return null;
}

export function routeTitle(r: Route): string {
  switch (r.k) {
    case 'home': return 'Documentation';
    case 'article': return ARTICLE_BY_ID.get(r.id)?.title ?? r.id;
    case 'node': return nodeName(r.type);
    case 'recipe': return RECIPE_BY_ID.get(r.id)?.title ?? r.id;
    default: return X_PAGES[r.k]?.label ?? r.k;
  }
}

export function routeKind(r: Route): string {
  switch (r.k) {
    case 'node': return MODULES.find((m) => m.type === r.type)?.category ?? 'Node';
    case 'article': return 'Guide';
    case 'recipe': return 'Recipe';
    case 'home': return 'Home';
    default: return 'Reference';
  }
}

export const CAT_LABEL: Record<string, string> = { Sensor: 'Sensors', Nucleus: 'Nuclei', Behavior: 'Behaviors', Node: 'Utility nodes', Timekeeping: 'Timekeeping', Info: 'Info' };
