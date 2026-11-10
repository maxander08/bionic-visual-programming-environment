// World Clock support: city lookup and time-zone formatting. Pure functions, no browser objects except Intl.
import { CITY_DATA } from './data/cities';

export interface City {
  name: string;
  country: string;
  cc: string;
  tz: string;
  pop: number;
  /** "Name, Country": the canonical label, also used as the suggestion text. */
  label: string;
}

const fold = (s: string) =>
  s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

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

function index() {
  if (all) return;
  all = [];
  byName = new Map();
  byCountry = new Map();
  for (const [cc, country, rows] of CITY_DATA.c) {
    const list: City[] = [];
    for (const [name, tz, pop] of rows) {
      const city: City = { name, country, cc, tz: CITY_DATA.tz[tz], pop, label: `${name}, ${country}` };
      list.push(city);
      all.push(city);
      const k = fold(name);
      const arr = byName.get(k);
      if (arr) arr.push(city); else byName.set(k, [city]);
    }
    byCountry.set(fold(country), list);
    byCountry.set(fold(cc), list);
    for (const alt of COUNTRY_ALIASES[cc] ?? []) byCountry.set(alt, list);
  }
  for (const arr of byName.values()) arr.sort((a, b) => b.pop - a.pop);
}

/** Every selectable city (the 30 most populous of each country), alphabetical by label. */
export function allCities(): City[] {
  index();
  return all!;
}

export const COUNTRY_COUNT = CITY_DATA.c.length;

let labels: string[] | null = null;
/** "City, Country" strings for autocompletion, sorted alphabetically. */
export function cityLabels(): string[] {
  return (labels ??= allCities().map((c) => c.label).sort((a, b) => a.localeCompare(b)));
}

/**
 * Resolve what the user typed. Accepted forms: "Tokyo", "Paris, France", "Paris, FR", "Sao Paulo" (accents and case
 * are ignored). A bare name shared by several countries resolves to the most populous one; add the country to pick another.
 */
export function findCity(query: string): City | null {
  index();
  const raw = query.trim();
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
    return inCountry.find((c) => want.has(fold(c.name))) ?? null;
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
  /** The local wall-clock time as milliseconds since 1970-01-01 00:00 *of that zone* (so UTC getters read the local fields). */
  local: number;
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
    local: asUtc + milli,
  };
}

/** IANA name of this device's time zone, or UTC when the browser does not say. */
export function deviceTimeZone(): string {
  try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'; } catch { return 'UTC'; }
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export const fmtOffset = (h: number) => {
  const sign = h < 0 ? '−' : '+';
  const a = Math.abs(h), hh = Math.floor(a), mm = Math.round((a - hh) * 60);
  return `UTC${sign}${hh}${mm ? ':' + pad(mm) : ''}`;
};
