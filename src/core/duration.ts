// Durations written the way people say them: “2 hrs 40 min”, “1h30m”, “90 s”, “1:30:00”, “2.5 hours”, “1d 4h 20min 5s 250ms”.
// Pure functions, no browser objects. Used by every time setting in the inspector, by setting pins that carry text,
// by the Time quantity and by Gosling.
import { getLang } from '../i18n';

/** The storage unit of a time setting: the unit its number is held in. */
export type TimeBase = 's' | 'ms';

type Key = 'y' | 'w' | 'd' | 'h' | 'min' | 's' | 'ms' | 'us';

/** Seconds in each spelling of a unit. Lower-case; a trailing full stop is ignored. */
const UNITS: Record<string, { s: number; key: Key }> = {};
const SECONDS: Record<Key, number> = { y: 31557600, w: 604800, d: 86400, h: 3600, min: 60, s: 1, ms: 0.001, us: 1e-6 };
const add = (key: Key, names: string[]) => { for (const n of names) UNITS[n] = { s: SECONDS[key], key }; };
add('y', ['y', 'yr', 'yrs', 'year', 'years', 'a']);
add('w', ['w', 'wk', 'wks', 'week', 'weeks']);
add('d', ['d', 'day', 'days']);
add('h', ['h', 'hr', 'hrs', 'hour', 'hours']);
add('min', ['m', 'min', 'mins', 'minute', 'minutes']);
add('s', ['s', 'sec', 'secs', 'second', 'seconds']);
add('ms', ['ms', 'msec', 'msecs', 'millisecond', 'milliseconds']);
add('us', ['us', 'µs', 'μs', 'usec', 'microsecond', 'microseconds']);
// Chinese, so that what the inspector writes back in Chinese can be read again.
add('y', ['年']); add('w', ['周', '週', '星期']); add('d', ['天', '日']); add('h', ['小时', '小時', '时', '時']);
add('min', ['分钟', '分鐘', '分']); add('s', ['秒', '秒钟', '秒鐘']); add('ms', ['毫秒']); add('us', ['微秒']);

/** After “2h” a lone “40” means 40 minutes: the unit one step down. */
const NEXT: Record<Key, Key> = { y: 'd', w: 'd', d: 'h', h: 'min', min: 's', s: 'ms', ms: 'us', us: 'us' };

export type DurationResult = { ok: true; seconds: number } | { ok: false; error: string };

/** Round to 6 decimal places (microsecond precision) without overflowing or corrupting large values. */
export const round6 = (x: number) => (!Number.isFinite(x) || Math.abs(x) >= 1e9 ? x : Math.round(x * 1e6) / 1e6);
export const toBaseUnit = (seconds: number, base: TimeBase): number => (base === 'ms' ? round6(seconds * 1000) : round6(seconds));
export const fromBaseUnit = (v: number, base: TimeBase): number => (base === 'ms' ? v / 1000 : v);

/**
 * Read a duration. `bare` is what a number with no unit means (the unit of the setting): “90” is 90 seconds in a
 * seconds setting and 90 milliseconds in a milliseconds one. A lone number after a unit takes the next smaller unit,
 * so “2h 40” is 2 hours 40 minutes. Clock style works too: “1:30” is 1 min 30 s, “1:30:00” is 1 h 30 min.
 */
export function parseDuration(text: string, bare: TimeBase = 's'): DurationResult {
  const src = text.trim().toLowerCase().replace(/：/g, ':').replace(/^[−－]/, '-');
  if (!src) return { ok: false, error: 'Type a time, for example 2 h 40 min.' };
  if (src.startsWith('-')) return { ok: false, error: 'A time can’t be negative.' };
  const bareSeconds = bare === 'ms' ? 0.001 : 1;

  // 1:30, 01:30:00, 1:02:03:04 (days), 01:05.250
  const clock = /^(\d+(?::\d+){1,3})(\.\d+)?$/.exec(src);
  if (clock) {
    const parts = clock[1].split(':').map(Number).reverse();
    const scale = [1, 60, 3600, 86400];
    let total = 0;
    parts.forEach((n, i) => { total += n * scale[i]; });
    if (clock[2]) total += Number(clock[2]);
    if (!Number.isFinite(total)) return { ok: false, error: 'That number is too large.' };
    return { ok: true, seconds: round6(total) };
  }

  // Keep '+' inside scientific exponents (1e+5), treat standalone '+', '&', 'and' and commas as separators.
  const body = src.replace(/\band\b|&|(?<![0-9.]e)\+|,|，|、/g, ' ');
  const re = /\s*(\d+\.?\d*(?:e[+-]?\d+)?|\.\d+)\s*([a-zµμ\u3400-\u9fff]*)\.?/y;
  let total = 0, prev: Key | null = null, count = 0, at = 0;
  while (at < body.length && body.slice(at).trim() !== '') {
    re.lastIndex = at;
    const m = re.exec(body);
    if (!m) return { ok: false, error: 'That isn’t a time. Try 2 h 40 min, 90 s or 1:30:00.' };
    at = re.lastIndex;
    const value = Number(m[1]);
    if (!Number.isFinite(value)) return { ok: false, error: 'That number is too large.' };
    let factor: number;
    if (m[2]) {
      const u = UNITS[m[2]];
      if (!u) return { ok: false, error: 'That isn’t a unit of time. Use h, min, s, ms, d or w.' };
      factor = u.s; prev = u.key;
    } else if (prev === null) {
      factor = bareSeconds;
      // A number with no unit at the start only makes sense alone: “5 2h” is ambiguous.
      if (body.slice(at).trim() !== '') return { ok: false, error: 'Add a unit after the first number, for example 2 h 40 min.' };
    } else {
      prev = NEXT[prev]; factor = SECONDS[prev];
    }
    total += value * factor;
    if (!Number.isFinite(total)) return { ok: false, error: 'That number is too large.' };
    count++;
  }
  if (!count) return { ok: false, error: 'Type a time, for example 2 h 40 min.' };
  return { ok: true, seconds: round6(total) };
}

/** Whole days, hours, minutes, seconds and milliseconds of a time in seconds. */
export function splitSeconds(seconds: number): { d: number; h: number; min: number; s: number; ms: number } {
  const t = Math.max(0, Number.isFinite(seconds) ? seconds : 0);
  if (t >= 1e15) return { d: Math.floor(t / 86400), h: 0, min: 0, s: 0, ms: 0 };
  let whole = Math.floor(t);
  let ms = Math.round((t - whole) * 1e6) / 1e3; // sub-millisecond digits survive (0.5 ms)
  if (ms >= 1000) { whole += 1; ms = 0; }
  const d = Math.floor(whole / 86400);
  const h = Math.floor((whole % 86400) / 3600);
  const min = Math.floor((whole % 3600) / 60);
  return { d, h, min, s: whole % 60, ms };
}

const WORDS = {
  'zh-Hans': { d: '天', h: '小时', min: '分钟', s: '秒', ms: '毫秒' },
  'zh-Hant': { d: '天', h: '小時', min: '分鐘', s: '秒', ms: '毫秒' },
} as const;
type UnitKey = 'd' | 'h' | 'min' | 's' | 'ms';
/** The word for a unit in the interface language: h, min, s … in English, 小时, 分钟, 秒 … in Chinese. */
export function unitWord(u: UnitKey, plain = false): string {
  const lang = getLang();
  return plain || lang === 'en' ? u : WORDS[lang][u];
}

/**
 * “2 h 40 min”, “1 min 30 s”, “250 ms”, “0 s”. `compact` drops the space inside a part: “2h 40min” (node faces).
 * The units follow the interface language (2 小时 40 分钟); `plain` keeps h, min, s for text that is data.
 */
export function formatDuration(seconds: number, o: { compact?: boolean; plain?: boolean } = {}): string {
  const t = Math.max(0, Number.isFinite(seconds) ? seconds : 0);
  const sp = o.compact ? '' : ' ';
  const w = (u: UnitKey) => unitWord(u, o.plain);
  // Above 1e15 s (~31 million years) float64 loses 1-second resolution; write seconds directly so it stays exact and readable.
  if (t >= 1e15) return `${t}${sp}${w('s')}`;
  const p = splitSeconds(t);
  const out: string[] = [];
  if (p.d) out.push(`${p.d}${sp}${w('d')}`);
  if (p.h) out.push(`${p.h}${sp}${w('h')}`);
  if (p.min) out.push(`${p.min}${sp}${w('min')}`);
  if (p.s) out.push(`${p.s}${sp}${w('s')}`);
  if (p.ms) out.push(`${Number(p.ms.toFixed(3))}${sp}${w('ms')}`);
  return out.length ? out.join(' ') : `0${sp}${w('s')}`;
}

/** A duration held in a setting's own unit, as text for a label or chip. */
export const formatBase = (v: number, base: TimeBase, o: { compact?: boolean; plain?: boolean } = {}): string => formatDuration(fromBaseUnit(Number(v), base), o);

/** Show text such as “2h 40min” (a Time quantity's face) in the interface language. English text is returned as it is. */
export function localizeDuration(text: string): string {
  if (getLang() === 'en') return text;
  return text.replace(/(\d)(\s?)(ms|min|d|h|s)\b/g, (_m, n, sp, u) => `${n}${sp}${unitWord(u as UnitKey)}`);
}
