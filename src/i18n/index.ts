// Interface language support: English (source), Simplified Chinese and Traditional Chinese.
//
// English text is the lookup key (gettext style): `tr('Run')` returns the Chinese string when one exists and falls back
// to the English text otherwise, so a missing translation can never break the interface. This module is pure (no store,
// no React): the store keeps the chosen language and tells this module through `setActiveLang`.
import { zhHans } from './zh-Hans';
import { zhHant } from './zh-Hant';

export type Lang = 'en' | 'zh-Hans' | 'zh-Hant';

export interface LangInfo {
  code: Lang;
  /** Name written in the language itself. */
  native: string;
  english: string;
  /** BCP 47 tag for the `lang` attribute. */
  tag: string;
  /** Short mark for compact displays. */
  mark: string;
}

export const LANGS: LangInfo[] = [
  { code: 'en', native: 'English', english: 'English', tag: 'en', mark: 'EN' },
  { code: 'zh-Hans', native: '简体中文', english: 'Simplified Chinese', tag: 'zh-Hans', mark: '简' },
  { code: 'zh-Hant', native: '繁體中文', english: 'Traditional Chinese', tag: 'zh-Hant', mark: '繁' },
];

export const LANG_CODES = LANGS.map((l) => l.code);
export const langInfo = (code: Lang): LangInfo => LANGS.find((l) => l.code === code) ?? LANGS[0];

/** Accepts codes and common aliases (zh-CN, zh_TW, “Traditional Chinese”…). Returns null when unknown. */
export function normalizeLang(raw: unknown): Lang | null {
  if (typeof raw !== 'string') return null;
  const s = raw.trim().toLowerCase().replace(/_/g, '-');
  if (!s) return null;
  if (s === 'en' || s.startsWith('en-') || s === 'english') return 'en';
  if (['zh-hans', 'zh-cn', 'zh-sg', 'zh-my', 'zh', 'simplified', 'simplified chinese', 'chinese', '简体中文', '简体'].includes(s)) return 'zh-Hans';
  if (['zh-hant', 'zh-tw', 'zh-hk', 'zh-mo', 'traditional', 'traditional chinese', '繁體中文', '繁體', '繁体中文', '繁体'].includes(s)) return 'zh-Hant';
  if (s.startsWith('zh-hans')) return 'zh-Hans';
  if (s.startsWith('zh-hant')) return 'zh-Hant';
  return null;
}

/** First visit: follow the browser language, otherwise English. */
export function detectLang(): Lang {
  try {
    const list = typeof navigator !== 'undefined' ? [...(navigator.languages ?? []), navigator.language] : [];
    for (const l of list) {
      const n = normalizeLang(l);
      if (n) return n;
    }
  } catch { /* no navigator */ }
  return 'en';
}

const DICTS: Record<Lang, Record<string, string>> = { en: {}, 'zh-Hans': zhHans, 'zh-Hant': zhHant };

let active: Lang = 'en';
export const getLang = (): Lang => active;

export function setActiveLang(l: Lang) {
  active = l;
  try {
    if (typeof document !== 'undefined') document.documentElement.lang = langInfo(l).tag;
  } catch { /* ignore */ }
}

const fill = (s: string, vars?: Record<string, string | number>) =>
  vars ? s.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k]) : m)) : s;

// Dictionary keys that contain {placeholders} double as patterns, so dynamic messages produced by the engine
// (“Output “x” is not a finite number.”) can be translated after the fact.
type Tpl = { re: RegExp; names: string[]; en: string };
const tplCache = new Map<Lang, Tpl[]>();
function templates(l: Lang): Tpl[] {
  let list = tplCache.get(l);
  if (!list) {
    list = [];
    for (const en of Object.keys(DICTS[l])) {
      if (!/\{\w+\}/.test(en) || en.replace(/\{\w+\}/g, '').length < 10) continue; // short templates would match too eagerly
      const names: string[] = [];
      const src = en.split(/(\{\w+\})/).map((part) => {
        const m = /^\{(\w+)\}$/.exec(part);
        if (m) { names.push(m[1]); return '([\\s\\S]*?)'; }
        return part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      }).join('');
      list.push({ re: new RegExp('^' + src + '$'), names, en });
    }
    tplCache.set(l, list);
  }
  return list;
}

function lookup(l: Lang, en: string, vars?: Record<string, string | number>): string {
  if (l === 'en') return fill(en, vars);
  const hit = DICTS[l][en];
  if (hit !== undefined) return fill(hit, vars);
  if (!vars) {
    for (const t of templates(l)) {
      const m = t.re.exec(en);
      if (m) return fill(DICTS[l][t.en], Object.fromEntries(t.names.map((n, i) => [n, m[i + 1]])));
    }
  }
  return fill(en, vars);
}

/** Translate an English interface string. `{name}` placeholders are filled from `vars`. */
export function tr(en: string, vars?: Record<string, string | number>): string {
  return lookup(active, en, vars);
}

/** Translate in an explicit language (used by tests and previews). */
export function trIn(l: Lang, en: string, vars?: Record<string, string | number>): string {
  return lookup(l, en, vars);
}

/** Whether a translation exists for the current language. */
export const hasTr = (en: string): boolean => active === 'en' || en in DICTS[active];

/** Plural-free count helper: Chinese has no plural forms, English does. */
export const plural = (n: number, one: string, many: string): string => (active === 'en' ? (n === 1 ? one : many) : tr(many));

/**
 * Translate a short “face” string (a chip, a title, a glyph abbreviation): `negate`, `SEQ`, `sine 1 Hz`, `3 steps`.
 * An exact dictionary hit wins; otherwise every word is looked up on its own (dictionary keys `face:<word>`, lower
 * case) and words without an entry (units, numbers, symbols, user text) are left as they are.
 * Use it only on text built from the app's own vocabulary, never on text the user typed.
 */
export function trFace(s: string): string {
  if (active === 'en' || !s) return s;
  const d = DICTS[active];
  const hit = d[s];
  if (hit !== undefined) return hit;
  return s.replace(/[A-Za-z][A-Za-z'’-]*\??/g, (w) => d['face:' + w.toLowerCase()] ?? d[w] ?? w);
}

/** Translate a World Clock / Alarm place: a city from the built-in list (`city:` keys), “This device”, or anything else unchanged. */
export function trPlace(name: string): string {
  if (active === 'en' || !name) return name;
  const d = DICTS[active];
  return d['city:' + name] ?? d[name] ?? name;
}
