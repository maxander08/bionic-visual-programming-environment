import type { ModuleDef } from '../types';
import { COUNTRY_COUNT, cityLabels, findCity, fmtOffset, readClock } from '../worldclock';
import { bol, out, sel, txt } from './kit';

/** World Clock: the current local time in any of the 30 most populous cities of every country. */
export const worldClock: ModuleDef = {
  type: 'clock', name: 'World Clock', caption: 'World Clock', category: 'Info', family: 'info', glyph: '◷', size: 'square',
  keywords: 'time zone timezone city country hour date local utc offset watch',
  inputs: [],
  outputs: [
    out('time', 'Time', 'text', 'Local time in the city, formatted by the Format, Show seconds and Show milliseconds settings.'),
    out('date', 'Date', 'text', 'Local date, such as “Wed 12 Mar 2026”.'),
    out('hour', 'Hour', 'num', 'Local hour, 0–23.', 'right'),
    out('minute', 'Minute', 'num', 'Local minute, 0–59.', 'right'),
    out('millisecond', 'Milliseconds', 'num', 'Local millisecond within the current second, 0–999. It refreshes every tick while Show seconds and Show milliseconds are on, otherwise once a second.', 'right'),
    out('offset', 'UTC offset', 'num', 'Hours ahead of (+) or behind (−) UTC right now, daylight saving included. India is 5.5.', 'right'),
  ],
  params: [
    txt('city', 'City', 'Tokyo, Japan', `Name of a city. Type to see suggestions: the 30 most populous cities of each of ${COUNTRY_COUNT} countries are known. Write “Paris, France” (or “Paris, FR”) when a name exists in several countries; a bare name picks the most populous one. Accents and capitals do not matter.`, { maxLength: 80, placeholder: 'e.g. Tokyo or Paris, France', suggest: cityLabels }),
    sel('format', 'Format', '24h', [['24h', '24-hour (14:30)'], ['12h', '12-hour (2:30 PM)']], 'How the Time output is written. Hour is always 0–23.'),
    bol('seconds', 'Show seconds', true, 'Include seconds in the Time output.'),
    bol('millis', 'Show milliseconds', true, 'Add milliseconds after the seconds (14:30:05.123). Only applies while Show seconds is on.'),
  ],
  source: true,
  run(c) {
    const query = c.str('city');
    const city = findCity(query);
    if (!city) {
      c.view({});
      return c.fail(query.trim() ? `Unknown city “${query.trim()}”. Pick one from the suggestions: only the 30 most populous cities of each country are known.` : 'No city given. Type a city name in the inspector or connect text to the City pin.');
    }
    let r;
    try { r = readClock(city.tz, Date.now(), c.str('format') === '12h', c.bool('seconds'), c.bool('seconds') && c.bool('millis')); } catch { return c.fail(`This browser does not know the time zone ${city.tz}.`); }
    c.emit('time', r.time);
    c.emit('date', r.date);
    c.emit('hour', r.hour);
    c.emit('minute', r.minute);
    c.emit('millisecond', r.millisecond);
    c.emit('offset', r.offset);
    c.view({ time: r.time, date: r.date, city: city.name, country: city.country, zone: city.tz, offset: fmtOffset(r.offset), day: r.day });
    // With milliseconds, refresh every tick; otherwise wake just after the next whole second so the display never skips.
    c.wake(c.bool('seconds') && c.bool('millis') ? c.tickMs : 1000 - (Date.now() % 1000) + 5);
  },
  doc: {
    summary: 'Shows and outputs the current local time of a city anywhere in the world.',
    runtime: 'Reads the real clock and converts it with the city’s IANA time zone, so daylight saving is applied automatically. It updates every second while the program runs, or every tick (about 20 times a second by default) when milliseconds are shown. The city comes from the inspector or, while a signal arrives, from the City pin.',
    errors: ['A city name that is not in the list raises an error and clears the outputs.', 'A browser without the needed time-zone data raises an error.'],
    examples: ['Constant (text) → World Clock City pin → Projector shows the time somewhere else.', 'World Clock Hour → Threshold: react when it is 9 a.m. in Sydney.'],
  },
};
