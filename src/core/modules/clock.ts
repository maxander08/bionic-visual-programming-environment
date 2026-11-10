import type { ModuleDef } from '../types';
import { COUNTRY_COUNT, cityLabels, findCity, fmtOffset, readClock } from '../worldclock';
import { bol, out, sel, txt } from './kit';

/** World Clock: the current local time in any of the 30 most populous cities of every country. */
export const worldClock: ModuleDef = {
  type: 'clock', name: 'World Clock', caption: 'World Clock', category: 'Info', family: 'info', glyph: '◷', size: 'square',
  keywords: 'time zone timezone city country hour date local utc offset watch',
  inputs: [],
  outputs: [
    out('time', 'Time', 'text', 'Local time in the city, formatted by the Format and Show seconds settings.'),
    out('date', 'Date', 'text', 'Local date, such as “Wed 12 Mar 2026”.'),
    out('hour', 'Hour', 'num', 'Local hour, 0–23.', 'right'),
    out('minute', 'Minute', 'num', 'Local minute, 0–59.', 'right'),
    out('offset', 'UTC offset', 'num', 'Hours ahead of (+) or behind (−) UTC right now, daylight saving included. India is 5.5.', 'right'),
  ],
  params: [
    txt('city', 'City', 'Tokyo, Japan', `Name of a city. Type to see suggestions: the 30 most populous cities of each of ${COUNTRY_COUNT} countries are known. Write “Paris, France” (or “Paris, FR”) when a name exists in several countries; a bare name picks the most populous one. Accents and capitals do not matter.`, { maxLength: 80, placeholder: 'e.g. Tokyo or Paris, France', suggest: cityLabels }),
    sel('format', 'Format', '24h', [['24h', '24-hour (14:30)'], ['12h', '12-hour (2:30 PM)']], 'How the Time output is written. Hour is always 0–23.'),
    bol('seconds', 'Show seconds', true, 'Include seconds in the Time output.'),
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
    try { r = readClock(city.tz, Date.now(), c.str('format') === '12h', c.bool('seconds')); } catch { return c.fail(`This browser does not know the time zone ${city.tz}.`); }
    c.emit('time', r.time);
    c.emit('date', r.date);
    c.emit('hour', r.hour);
    c.emit('minute', r.minute);
    c.emit('offset', r.offset);
    c.view({ time: r.time, date: r.date, city: city.name, country: city.country, zone: city.tz, offset: fmtOffset(r.offset), day: r.day });
    // Wake just after the next whole second of real time so the display never skips.
    c.wake(1000 - (Date.now() % 1000) + 5);
  },
  doc: {
    summary: 'Shows and outputs the current local time of a city anywhere in the world.',
    runtime: 'Reads the real clock and converts it with the city’s IANA time zone, so daylight saving is applied automatically. It updates every second while the program runs. The city comes from the inspector or, while a signal arrives, from the City pin.',
    errors: ['A city name that is not in the list raises an error and clears the outputs.', 'A browser without the needed time-zone data raises an error.'],
    examples: ['Constant (text) → World Clock City pin → Projector shows the time somewhere else.', 'World Clock Hour → Threshold: react when it is 9 a.m. in Sydney.'],
  },
};
