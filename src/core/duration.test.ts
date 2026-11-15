import { describe, expect, it } from 'vitest';
import { formatDuration, parseDuration, splitSeconds, toBaseUnit } from './duration';
import { MODULES, defaultParams, resolveParams } from './registry';
import { Engine } from './engine';
import { addNode, connect, emptyGraph, flatten } from './graph';
import type { Graph } from './types';

const sec = (text: string, bare: 's' | 'ms' = 's') => { const r = parseDuration(text, bare); return r.ok ? r.seconds : r.error; };

describe('duration: reading what people say', () => {
  it('reads hours and minutes in any spelling', () => {
    for (const t of ['2 hrs 40 min', '2h40m', '2h 40min', '2 hours 40 minutes', '2 hr, 40 mins', '2 hours and 40 minutes', '2h 40', '2:40:00', '2.6666667h']) {
      expect(Math.abs((sec(t) as number) - 9600), t).toBeLessThan(0.001);
    }
  });
  it('reads days, weeks, seconds, milliseconds and clock text', () => {
    expect(sec('1d 4h 20min 5s 250ms')).toBe(86400 + 4 * 3600 + 20 * 60 + 5.25);
    expect(sec('1 week')).toBe(604800);
    expect(sec('90 s')).toBe(90);
    expect(sec('1.5 min')).toBe(90);
    expect(sec('1:30')).toBe(90);
    expect(sec('01:05.250')).toBe(65.25);
    expect(sec('1:02:03:04')).toBe(86400 + 2 * 3600 + 3 * 60 + 4);
    expect(sec('250 µs')).toBe(0.00025);
  });
  it('a bare number means the unit of the setting', () => {
    expect(sec('90')).toBe(90);
    expect(sec('90', 'ms')).toBe(0.09);
    expect(sec('1e3')).toBe(1000);
    expect(sec('2h 40 30')).toBe(9630);
  });
  it('refuses nonsense with a message', () => {
    for (const t of ['', 'soon', '5 apples', '-5 min', '5 2h', 'h']) expect(typeof sec(t), t).toBe('string');
  });
});

describe('duration: writing it back', () => {
  it('writes the parts that are there', () => {
    expect(formatDuration(9600)).toBe('2 h 40 min');
    expect(formatDuration(9600, { compact: true })).toBe('2h 40min');
    expect(formatDuration(0)).toBe('0 s');
    expect(formatDuration(0.25)).toBe('250 ms');
    expect(formatDuration(90061.5)).toBe('1 d 1 h 1 min 1 s 500 ms');
    expect(formatDuration(0.0005)).toBe('0.5 ms');
  });
  it('round-trips', () => {
    for (const s of [1, 59.999, 60, 3599.5, 9600, 86400, 123456.789]) expect(sec(formatDuration(s)), String(s)).toBeCloseTo(s, 6);
    expect(splitSeconds(26 * 3600 + 61)).toEqual({ d: 1, h: 2, min: 1, s: 1, ms: 0 });
    expect(toBaseUnit(2.5, 'ms')).toBe(2500);
  });
});

describe('duration: time settings across the catalogue', () => {
  it('every setting measured in seconds or milliseconds is a time field, and accepts text', () => {
    const timed = MODULES.flatMap((m) => m.params.filter((p) => p.kind === 'number' && (p.unit === 's' || p.unit === 'ms')).map((p) => [m, p] as const));
    expect(timed.length).toBeGreaterThan(10);
    for (const [m, p] of timed) {
      expect(p.kind === 'number' && p.time, `${m.type}.${p.key}`).toBe(p.kind === 'number' ? p.unit : undefined);
      const got = resolveParams(m, { ...defaultParams(m), [p.key]: '1 min 30 s' })[p.key] as number;
      const want = p.kind === 'number' && p.time === 'ms' ? 90000 : 90;
      expect(got, `${m.type}.${p.key}`).toBe(Math.min(want, p.kind === 'number' ? p.max : want));
    }
  });
  it('a Delay can be hours long and takes 1h 30m on its pin', () => {
    let g: Graph = emptyGraph();
    g = addNode(g, 'constant', 0, 0, { kind: 'text', value: '1h 30m' }, undefined, 'c').graph;
    g = addNode(g, 'delay', 300, 0, {}, undefined, 'd').graph;
    g = connect(g, 'c', 'out', 'd', 'p:ms').graph;
    const e = new Engine(50);
    e.load(flatten(g));
    e.runFor(100);
    expect(e.nodes.get('d')!.live.ms).toBe(5400000);
  });
});

describe('duration: Chinese units', () => {
  it('reads what the Chinese interface writes back', () => {
    expect(sec('2小时40分钟')).toBe(9600);
    expect(sec('2 小时 40 分钟')).toBe(9600);
    expect(sec('1小時30分鐘')).toBe(5400);
    expect(sec('90秒')).toBe(90);
    expect(sec('250毫秒')).toBe(0.25);
    expect(sec('500微秒')).toBe(0.0005);
    expect(sec('1：30：00')).toBe(5400);
    expect(sec('2小时，40分钟')).toBe(9600);
    expect(typeof sec('−5 分钟')).toBe('string');
  });
});

describe('duration: scientific notation, overflow and huge values', () => {
  it('parses scientific notation with + exponents and still allows + as a separator', () => {
    expect(sec('1e+5s')).toBe(100000);
    expect(sec('1.5e+3ms')).toBe(1.5);
    expect(sec('1e+40 s')).toBe(1e40);
    expect(sec('1h + 30m')).toBe(5400);
    expect(sec('+90 s')).toBe(90);
  });
  it('guards against Infinity overflow and preserves large integers', () => {
    expect(sec('1e303s')).toBe(1e303);
    expect(sec('10000000001s')).toBe(10000000001);
    expect(typeof sec('1e308d')).toBe('string');
    expect(typeof sec('9'.repeat(310) + ':00')).toBe('string');
  });
  it('formats huge spans cleanly without float noise and round-trips them', () => {
    expect(formatDuration(1e40)).toBe('1e+40 s');
    expect(formatDuration(1e40, { compact: true })).toBe('1e+40s');
    expect(sec(formatDuration(1e40))).toBe(1e40);
    expect(splitSeconds(1e40)).toEqual({ d: Math.floor(1e40 / 86400), h: 0, min: 0, s: 0, ms: 0 });
  });
  it('accepts SI-prefixed time strings like 3ks on time setting pins and rejects negative strings', () => {
    const timer = MODULES.find((m) => m.type === 'timer')!;
    expect(resolveParams(timer, { duration: '3ks' }).duration).toBe(3000);
    expect(resolveParams(timer, { duration: '-5 min' }).duration).toBe(60);
  });
});
