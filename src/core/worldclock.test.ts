import { describe, expect, it } from 'vitest';
import { Engine } from './engine';
import { addNode, emptyGraph, flatten } from './graph';
import { MODULES, PIN_SPACING, getDef, nodeSize, portPosition } from './registry';
import { CITY_DATA } from './data/cities';
import { allCities, cityLabels, findCity, fmtOffset, readClock } from './worldclock';

describe('city data', () => {
  it('keeps at most 30 cities per country, each with a valid IANA zone', () => {
    expect(CITY_DATA.c.length).toBeGreaterThan(200);
    for (const [, , rows] of CITY_DATA.c) expect(rows.length).toBeLessThanOrEqual(30);
    const big = CITY_DATA.c.filter(([, , rows]) => rows.length === 30).length;
    expect(big).toBeGreaterThan(100);
    for (const tz of CITY_DATA.tz) expect(() => new Intl.DateTimeFormat('en', { timeZone: tz })).not.toThrow();
  });
  it('sorts each country by population, descending', () => {
    for (const [, , rows] of CITY_DATA.c) for (let i = 1; i < rows.length; i++) expect(rows[i - 1][2]).toBeGreaterThanOrEqual(rows[i][2]);
  });
  it('lists unique labels', () => {
    expect(new Set(cityLabels()).size).toBe(allCities().length);
  });
});

describe('findCity', () => {
  it('finds well-known cities regardless of case and accents', () => {
    expect(findCity('tokyo')?.tz).toBe('Asia/Tokyo');
    expect(findCity('  SAO PAULO ')?.country).toBe('Brazil');
    expect(findCity('Zürich')?.country).toBe('Switzerland');
  });
  it('resolves ambiguous names to the most populous, or by country', () => {
    expect(findCity('Hyderabad')?.country).toBe('India');
    expect(findCity('Hyderabad, Pakistan')?.tz).toBe('Asia/Karachi');
    expect(findCity('Portland, USA')?.cc).toBe('US');
    expect(findCity('Birmingham, USA')).toBeNull(); // not among the 30 most populous US cities
    expect(findCity('London, UK')?.cc).toBe('GB');
    expect(findCity('Paris, FR')?.tz).toBe('Europe/Paris');
  });
  it('knows a few alternative names and rejects nonsense', () => {
    expect(findCity('Bombay')?.name).toBe('Mumbai');
    expect(findCity('New York')?.tz).toBe('America/New_York');
    expect(findCity('Atlantis')).toBeNull();
    expect(findCity('Paris, Narnia')).toBeNull();
    expect(findCity('')).toBeNull();
  });
});

describe('readClock', () => {
  const t = Date.UTC(2026, 0, 15, 12, 30, 45); // winter
  it('converts to the zone and reports the UTC offset', () => {
    const tokyo = readClock('Asia/Tokyo', t, false, true);
    expect(tokyo.time).toBe('21:30:45');
    expect(tokyo.offset).toBe(9);
    expect(tokyo.date).toBe('Thu 15 Jan 2026');
    expect(readClock('Asia/Kolkata', t, false, false).time).toBe('18:00');
    expect(readClock('Asia/Kolkata', t, false, false).offset).toBe(5.5);
    expect(readClock('America/New_York', t, false, true).offset).toBe(-5);
  });
  it('applies daylight saving and the date line', () => {
    const summer = Date.UTC(2026, 6, 15, 12, 0, 0);
    expect(readClock('America/New_York', summer, false, true).offset).toBe(-4);
    expect(readClock('Pacific/Auckland', t, false, true).date).toBe('Fri 16 Jan 2026');
  });
  it('formats 12-hour time', () => {
    expect(readClock('UTC', Date.UTC(2026, 0, 1, 0, 5, 0), true, false).time).toBe('12:05 AM');
    expect(readClock('UTC', Date.UTC(2026, 0, 1, 15, 5, 9), true, true).time).toBe('3:05:09 PM');
  });
  it('appends milliseconds after the seconds', () => {
    expect(readClock('Asia/Tokyo', t + 7, false, true, true).time).toBe('21:30:45.007');
    expect(readClock('UTC', Date.UTC(2026, 0, 1, 15, 5, 9, 250), true, true, true).time).toBe('3:05:09.250 PM');
    expect(readClock('Asia/Tokyo', t + 7, false, false, true).time).toBe('21:30');
    expect(readClock('Asia/Tokyo', t + 7, false, true).time).toBe('21:30:45');
  });
  it('reports the second within the minute, whether or not seconds are shown', () => {
    expect(readClock('Asia/Tokyo', t, false, true).second).toBe(45);
    expect(readClock('Asia/Tokyo', t, false, false).second).toBe(45);
    expect(readClock('UTC', Date.UTC(2026, 0, 1, 15, 5, 9, 250), true, true, true).second).toBe(9);
  });
  it('reports the millisecond within the second', () => {
    expect(readClock('Asia/Tokyo', t + 7, false, true, true).millisecond).toBe(7);
    expect(readClock('UTC', Date.UTC(2026, 0, 1, 15, 5, 9, 250), true, true, true).millisecond).toBe(250);
    expect(readClock('Asia/Tokyo', t, false, true).millisecond).toBe(0);
  });
  it('formats offsets', () => {
    expect(fmtOffset(5.5)).toBe('UTC+5:30');
    expect(fmtOffset(-4)).toBe('UTC−4');
    expect(fmtOffset(0)).toBe('UTC+0');
  });
});

describe('World Clock module', () => {
  it('is a Timekeeping module with a City setting pin', () => {
    const m = MODULES.find((x) => x.type === 'clock')!;
    expect(m.category).toBe('Timekeeping');
    expect(m.family).toBe('timekeeping');
    const d = getDef('clock')!;
    expect(d.inputs.some((p) => p.id === 'p:city' && p.type === 'text')).toBe(true);
  });
  it('puts the Seconds pin third on the right edge, after Minute', () => {
    const d = getDef('clock')!;
    const right = d.outputs.filter((p) => p.side === 'right').map((p) => p.id);
    expect(right).toEqual(['hour', 'minute', 'second', 'millisecond']);
    expect(d.outputs.find((p) => p.id === 'second')!.type).toBe('num');
    const node = { id: 'n', type: 'clock', x: 0, y: 0, params: {} };
    const ys = right.map((id) => portPosition(node, d, id, 'out')!.y);
    for (let i = 1; i < ys.length; i++) expect(ys[i] - ys[i - 1]).toBeGreaterThanOrEqual(PIN_SPACING);
    expect(ys[ys.length - 1]).toBeLessThan(nodeSize(d).h);
  });
  it('puts the UTC offset pin third on the bottom edge, after Date', () => {
    const d = getDef('clock')!;
    const bottom = d.outputs.filter((p) => (p.side ?? 'bottom') === 'bottom').map((p) => p.id);
    expect(bottom).toEqual(['time', 'date', 'offset']);
    expect(d.outputs.find((p) => p.id === 'offset')!.type).toBe('num');
    const node = { id: 'n', type: 'clock', x: 0, y: 0, params: {} };
    const xs = bottom.map((id) => portPosition(node, d, id, 'out')!.x);
    for (let i = 1; i < xs.length; i++) expect(xs[i] - xs[i - 1]).toBeGreaterThanOrEqual(PIN_SPACING);
    expect(xs[xs.length - 1]).toBeLessThan(nodeSize(d).w);
  });
  it('puts the Milliseconds pin on the right edge, level with the four setting pins on the left', () => {
    const d = getDef('clock')!;
    const ms = d.outputs.find((p) => p.id === 'millisecond')!;
    expect(ms.type).toBe('num');
    expect(ms.side).toBe('right');
    expect(d.outputs.filter((p) => p.side === 'right').length).toBe(d.paramPins!.filter((p) => p.side === 'left').length);
  });
  function run(params: Record<string, unknown>) {
    const g = addNode(emptyGraph(), 'clock', 0, 0, params, undefined, 'c').graph;
    const e = new Engine(50);
    e.load(flatten(g));
    e.step();
    return e;
  }
  it('emits the local time of the chosen city', () => {
    const e = run({ city: 'Sydney, Australia' });
    expect(e.out('c', 'time')).toMatch(/^\d\d:\d\d:\d\d\.\d{3}$/);
    expect([10, 11]).toContain(e.out('c', 'offset'));
    const sec = e.out('c', 'second') as number;
    expect(Number.isInteger(sec) && sec >= 0 && sec <= 59).toBe(true);
    const ms = e.out('c', 'millisecond') as number;
    expect(Number.isInteger(ms) && ms >= 0 && ms <= 999).toBe(true);
    expect(e.nodes.get('c')!.status.level).toBe('ok');
  });
  it('raises an error for an unknown city', () => {
    const e = run({ city: 'Gotham' });
    expect(e.nodes.get('c')!.status.level).toBe('error');
    expect(e.out('c', 'time')).toBeUndefined();
  });
});
