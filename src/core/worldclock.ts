// World Clock support: city lookup and time-zone formatting. Pure functions, no browser objects except Intl.
import { CITY_DATA } from './data/cities';
import { COUNTRY_GEO, PLACE_GEO, PLACE_HANS, PLACE_HANT } from './data/places';
import { getLang } from '../i18n';

export interface City {
  name: string;
  country: string;
  cc: string;
  tz: string;
  pop: number;
  /** "Name, Country": the canonical label, also used as the suggestion text. */
  label: string;
  /** Position of the city (GeoNames), when known. */
  lat?: number;
  lon?: number;
  /** The name in Simplified / Traditional Chinese, when the city has one. */
  hans?: string;
  hant?: string;
}

export interface Country { cc: string; name: string; hans: string; hant: string; lat: number; lon: number }

const fold = (s: string) =>
  s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9\u3400-\u9fff]+/g, ' ').trim();

/** Common alternative spellings that GeoNames lists under a different primary name. */
const ALIASES: Record<string, string> = {
  'new york': 'New York City', nyc: 'New York City', kiev: 'Kyiv', bombay: 'Mumbai', calcutta: 'Kolkata', madras: 'Chennai',
  bangalore: 'Bengaluru', peking: 'Beijing', saigon: 'Ho Chi Minh City', rangoon: 'Yangon', mexico: 'Mexico City',
  washington: 'Washington, D.C.', 'washington dc': 'Washington, D.C.', rio: 'Rio de Janeiro', la: 'Los Angeles', sf: 'San Francisco',
  'st petersburg': 'Saint Petersburg', 'ho chi minh': 'Ho Chi Minh City',
};

const COUNTRY_ALIASES: Record<string, string[]> = { US: ['usa', 'america', 'united states of america'], GB: ['uk', 'britain', 'great britain', 'england'], AE: ['uae'] };

let all: City[] | null = null;
let byName: Map<string, City[]> | null = null;
let byCountry: Map<string, City[]> | null = null;
let countryByKey: Map<string, Country> | null = null;

function index() {
  if (all) return;
  all = [];
  byName = new Map();
  byCountry = new Map();
  countryByKey = new Map();
  for (const [cc, country, rows] of CITY_DATA.c) {
    const list: City[] = [];
    const geo = (PLACE_GEO[cc] ?? '').split(';'), hans = (PLACE_HANS[cc] ?? '').split('|'), hant = (PLACE_HANT[cc] ?? '').split('|');
    rows.forEach(([name, tz, pop], i) => {
      const city: City = { name, country, cc, tz: CITY_DATA.tz[tz], pop, label: `${name}, ${country}` };
      const [la, lo] = (geo[i] ?? '').split(',').map(Number);
      if (geo[i]) { city.lat = la; city.lon = lo; }
      if (hans[i]) city.hans = hans[i];
      if (hant[i]) city.hant = hant[i];
      list.push(city);
      all!.push(city);
      for (const n of [name, city.hans, city.hant]) {
        if (!n) continue;
        const k = fold(n);
        const arr = byName!.get(k);
        if (arr) { if (!arr.includes(city)) arr.push(city); } else byName!.set(k, [city]);
      }
    });
    const g = COUNTRY_GEO[cc];
    const info: Country = { cc, name: country, hans: g?.[0] ?? '', hant: g?.[1] ?? '', lat: g?.[2] ?? 0, lon: g?.[3] ?? 0 };
    for (const n of [country, cc, info.hans, info.hant, ...(COUNTRY_ALIASES[cc] ?? [])]) {
      if (!n) continue;
      byCountry.set(fold(n), list);
      countryByKey.set(fold(n), info);
    }
  }
  for (const arr of byName.values()) arr.sort((a, b) => b.pop - a.pop);
}

/** Every selectable city (the 30 most populous of each country), alphabetical by label. */
export function allCities(): City[] {
  index();
  return all!;
}

export const COUNTRY_COUNT = CITY_DATA.c.length;

/** A city's name in a language: Chinese when the city has a Chinese name, English otherwise. */
export const cityName = (c: City, lang: string): string => (lang === 'zh-Hans' ? c.hans : lang === 'zh-Hant' ? c.hant : '') || c.name;
/** The name of a city's country in a language. */
export function countryName(c: City, lang: string): string {
  index();
  const k = countryByKey!.get(fold(c.cc));
  return (lang === 'zh-Hans' ? k?.hans : lang === 'zh-Hant' ? k?.hant : '') || c.country;
}
/** “Tokyo, Japan”, or “东京, 日本” in Simplified Chinese and “東京, 日本” in Traditional Chinese. */
export const cityLabel = (c: City, lang: string): string => (lang === 'en' ? c.label : `${cityName(c, lang)}, ${countryName(c, lang)}`);

const labelCache = new Map<string, string[]>();
/** "City, Country" strings for autocompletion, sorted alphabetically; written in the interface language. */
export function cityLabels(): string[] {
  const lang = getLang();
  let l = labelCache.get(lang);
  if (!l) labelCache.set(lang, (l = [...new Set(allCities().map((c) => cityLabel(c, lang)))].sort((a, b) => a.localeCompare(b, lang === 'en' ? undefined : lang))));
  return l;
}

/** A country by name (English, Simplified or Traditional Chinese), two-letter code or common alias. */
export function findCountry(query: string): Country | null {
  index();
  return countryByKey!.get(fold(query)) ?? null;
}

/**
 * Resolve what the user typed. Accepted forms: "Tokyo", "Paris, France", "Paris, FR", "Sao Paulo" (accents and case
 * are ignored). A bare name shared by several countries resolves to the most populous one; add the country to pick another.
 */
export function findCity(query: string): City | null {
  index();
  const raw = query.trim().replace(/，/g, ',');
  if (!raw) return null;
  const comma = raw.lastIndexOf(',');
  const namePart = comma >= 0 ? raw.slice(0, comma) : raw;
  const countryPart = comma >= 0 ? fold(raw.slice(comma + 1)) : '';
  const lookup = (n: string): City[] => {
    const k = fold(n);
    return byName!.get(k) ?? byName!.get(fold(ALIASES[k] ?? '')) ?? [];
  };
  if (countryPart) {
    const inCountry = byCountry!.get(countryPart);
    if (!inCountry) return null;
    const k = fold(namePart);
    const want = new Set([k, fold(ALIASES[k] ?? '')]);
    return inCountry.find((c) => want.has(fold(c.name)) || (!!c.hans && want.has(fold(c.hans))) || (!!c.hant && want.has(fold(c.hant)))) ?? null;
  }
  const exact = lookup(namePart);
  if (exact.length) return exact[0];
  // "Washington, D.C." folds to "washington d c" and a user may omit punctuation: fall back to a prefix match.
  const k = fold(namePart);
  if (k.length >= 3) {
    let best: City | null = null;
    for (const c of all!) if (fold(c.name).startsWith(k) && (!best || c.pop > best.pop)) best = c;
    return best;
  }
  return null;
}

export interface ClockReading {
  time: string;
  date: string;
  hour: number;
  minute: number;
  second: number;
  /** Millisecond within the current second, 0–999. */
  millisecond: number;
  /** Offset from UTC in hours, e.g. 5.5 for India. */
  offset: number;
  /** Local time between 06:00 and 18:00. */
  day: boolean;
}

const fmtCache = new Map<string, Intl.DateTimeFormat>();
function formatter(tz: string): Intl.DateTimeFormat {
  let f = fmtCache.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat('en-GB', {
      timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', weekday: 'short',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
    });
    fmtCache.set(tz, f);
  }
  return f;
}

const pad = (n: number) => String(n).padStart(2, '0');

/** Wall-clock reading of a time zone at an instant (epoch ms). Milliseconds are appended to the seconds when both are enabled. Throws RangeError for an unknown zone. */
export function readClock(tz: string, nowMs: number, hour12: boolean, seconds: boolean, millis = false): ClockReading {
  const whole = Math.floor(nowMs / 1000) * 1000;
  const parts: Record<string, string> = {};
  for (const p of formatter(tz).formatToParts(whole)) parts[p.type] = p.value;
  const hour = Number(parts.hour) % 24, minute = Number(parts.minute), second = Number(parts.second);
  const asUtc = Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), hour, minute, second);
  const offset = Math.round(((asUtc - whole) / 3600000) * 100) / 100;
  const h = hour12 ? hour % 12 || 12 : hour;
  const milli = Math.floor(nowMs) - whole;
  const ms = String(milli).padStart(3, '0');
  const time = `${hour12 ? h : pad(h)}:${pad(minute)}${seconds ? ':' + pad(second) + (millis ? '.' + ms : '') : ''}${hour12 ? (hour < 12 ? ' AM' : ' PM') : ''}`;
  return {
    time, date: `${parts.weekday} ${Number(parts.day)} ${MONTHS[Number(parts.month) - 1]} ${parts.year}`, hour, minute, second, millisecond: milli, offset,
    day: hour >= 6 && hour < 18,
  };
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export const fmtOffset = (h: number) => {
  const sign = h < 0 ? '−' : '+';
  const a = Math.abs(h), hh = Math.floor(a), mm = Math.round((a - hh) * 60);
  return `UTC${sign}${hh}${mm ? ':' + pad(mm) : ''}`;
};
