// Timekeeping support for the Timer, Alarm and Stopwatch modules. Pure functions, no browser objects except Intl.

const pad = (n: number, w = 2) => String(n).padStart(w, '0');

export interface DurationFormat {
  /** Append milliseconds (`.123`). */
  millis?: boolean;
  /** How to drop the sub-second part when milliseconds are off: a countdown rounds up, a stopwatch rounds down. */
  round?: 'floor' | 'ceil';
  /** Always show the hours field. */
  hours?: boolean;
}

/** `MM:SS`, `HH:MM:SS` (when there are hours or `hours` is set) or `Nd HH:MM:SS` for 24 hours and more. */
export function fmtDuration(ms: number, o: DurationFormat = {}): string {
  let t = Math.max(0, Number.isFinite(ms) ? ms : 0);
  t = o.millis ? Math.floor(t) : o.round === 'ceil' ? Math.ceil(t / 1000 - 1e-9) * 1000 : Math.floor(t / 1000) * 1000;
  const milli = t % 1000;
  let sec = Math.floor(t / 1000);
  const d = Math.floor(sec / 86400);
  sec -= d * 86400;
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
  const base = d > 0 ? `${d}d ${pad(h)}:${pad(m)}:${pad(s)}` : h > 0 || o.hours ? `${pad(h)}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
  return o.millis ? `${base}.${pad(milli, 3)}` : base;
}

/**
 * Read a time of day typed by a person: `7:30`, `07:30`, `07:30:15`, `07:30:15.250`, `7:30 pm`, `7pm`, `12:05am`.
 * Milliseconds are allowed after the seconds (`.5` is 500 ms, `.25` is 250 ms, `.250` is 250 ms).
 * Returns milliseconds since midnight, or null when the text is not a valid time.
 */
export function parseTimeOfDay(text: string): number | null {
  const m = /^\s*(\d{1,2})(?:[:.](\d{1,2})(?:[:.](\d{1,2})(?:[.,](\d{1,3}))?)?)?\s*([ap])?\.?m?\.?\s*$/i.exec(text);
  if (!m) return null;
  let h = Number(m[1]);
  const min = m[2] === undefined ? 0 : Number(m[2]);
  const sec = m[3] === undefined ? 0 : Number(m[3]);
  const milli = m[4] === undefined ? 0 : Math.round(Number('0.' + m[4]) * 1000);
  const ap = m[5]?.toLowerCase();
  if (m[2] === undefined && !ap) return null; // a bare number such as "7" is ambiguous
  if (ap) {
    if (h < 1 || h > 12) return null;
    h = (h % 12) + (ap === 'p' ? 12 : 0);
  }
  if (h > 23 || min > 59 || sec > 59) return null;
  return ((h * 60 + min) * 60 + sec) * 1000 + milli;
}

/** `07:30` or `07:30:15` for a time of day in milliseconds; with `millis`, always `07:30:15.250`. */
export function fmtTimeOfDay(ms: number, millis = false): string {
  if (millis) {
    const t = ((Math.round(ms) % 86400000) + 86400000) % 86400000;
    const h = Math.floor(t / 3600000), m = Math.floor((t % 3600000) / 60000), sec = Math.floor((t % 60000) / 1000);
    return `${pad(h)}:${pad(m)}:${pad(sec)}.${pad(t % 1000, 3)}`;
  }
  const s = Math.round(ms / 1000);
  const h = Math.floor(s / 3600) % 24, m = Math.floor((s % 3600) / 60), sec = s % 60;
  return sec ? `${pad(h)}:${pad(m)}:${pad(sec)}` : `${pad(h)}:${pad(m)}`;
}

export interface DurationParts {
  /** Whole hours, not wrapped at 24: 26 for “1d 02:00:00”. */
  hour: number;
  minute: number;
  second: number;
  millisecond: number;
}

/** Split a duration in milliseconds into hour, minute, second and millisecond (fractions of a millisecond are dropped). */
export function splitDuration(ms: number): DurationParts {
  const t = Math.floor(Math.max(0, Number.isFinite(ms) ? ms : 0) + 1e-6);
  return { hour: Math.floor(t / 3600000), minute: Math.floor((t % 3600000) / 60000), second: Math.floor((t % 60000) / 1000), millisecond: t % 1000 };
}

/** Does an alarm with this repeat rule ring on this weekday (0 = Sunday … 6 = Saturday)? */
export function ringsOn(repeat: string, weekday: number): boolean {
  if (repeat === 'weekdays') return weekday >= 1 && weekday <= 5;
  if (repeat === 'weekends') return weekday === 0 || weekday === 6;
  return true;
}

export interface LocalParts {
  /** Weekday, 0 = Sunday … 6 = Saturday. */
  weekday: number;
  /** Milliseconds since local midnight. */
  sod: number;
  /** `2026-03-12`: changes at local midnight. */
  dayKey: string;
  /** `Thu 12 Mar`. */
  label: string;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const WD: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

const fmtCache = new Map<string, Intl.DateTimeFormat>();
function zoneFormatter(tz: string): Intl.DateTimeFormat {
  let f = fmtCache.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat('en-GB', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', weekday: 'short', hour: '2-digit', minute: '2-digit', second: '2-digit' });
    fmtCache.set(tz, f);
  }
  return f;
}

/** The wall clock of a time zone (an IANA name, or null for the device's own zone) at an instant. Throws RangeError for an unknown zone. */
export function localParts(tz: string | null, nowMs: number): LocalParts {
  const milli = ((Math.floor(nowMs) % 1000) + 1000) % 1000;
  if (tz === null) {
    const d = new Date(nowMs);
    return {
      weekday: d.getDay(), sod: ((d.getHours() * 60 + d.getMinutes()) * 60 + d.getSeconds()) * 1000 + d.getMilliseconds(),
      dayKey: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`, label: `${DAYS[d.getDay()]} ${d.getDate()} ${MONTHS[d.getMonth()]}`,
    };
  }
  const parts: Record<string, string> = {};
  for (const p of zoneFormatter(tz).formatToParts(Math.floor(nowMs / 1000) * 1000)) parts[p.type] = p.value;
  const h = Number(parts.hour) % 24, m = Number(parts.minute), s = Number(parts.second);
  return {
    weekday: WD[parts.weekday] ?? 0, sod: ((h * 60 + m) * 60 + s) * 1000 + milli,
    dayKey: `${parts.year}-${parts.month}-${parts.day}`, label: `${parts.weekday} ${Number(parts.day)} ${MONTHS[Number(parts.month) - 1]}`,
  };
}

/**
 * Milliseconds from now until the alarm's next ring (always above zero), by the wall clock of its zone.
 * Daylight-saving changes between now and then can shift the result by an hour.
 */
export function msUntilRing(now: LocalParts, targetSod: number, repeat: string): number {
  for (let k = 0; k <= 7; k++) {
    if (!ringsOn(repeat, (now.weekday + k) % 7)) continue;
    const delta = k * 86400000 + targetSod - now.sod;
    if (delta > 0) return delta;
  }
  return 7 * 86400000;
}
