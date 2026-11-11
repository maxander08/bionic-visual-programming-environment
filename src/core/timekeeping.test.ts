import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Engine } from './engine';
import { addNode, connect, emptyGraph, flatten } from './graph';
import { CATEGORIES, MODULES, getDef, nodeSize } from './registry';
import { SIZES } from './types';
import type { Graph, Params } from './types';
import { fmtDuration, fmtTimeOfDay, localParts, msUntilRing, parseTimeOfDay, ringsOn, splitDuration } from './timekeeping';

const TYPES = ['timer', 'alarm', 'stopwatch', 'clock'];

/** A graph with the module under test (id "n"), optional helper modules, and wires into the module's pins. */
function graphOf(type: string, params: Params = {}, srcs: [string, string, Params?][] = [], wires: [string, string, string][] = []): Graph {
  let g: Graph = addNode(emptyGraph(), type, 0, 0, params, undefined, 'n').graph;
  for (const [id, t, p] of srcs) g = addNode(g, t, 0, 0, p ?? {}, undefined, id).graph;
  for (const [from, fromPort, toPort] of wires) {
    const r = connect(g, from, fromPort, 'n', toPort);
    if (r.error) throw new Error(r.error);
    g = r.graph;
  }
  return g;
}
function build(type: string, params: Params = {}, srcs: [string, string, Params?][] = [], wires: [string, string, string][] = []) {
  const e = new Engine(50);
  e.load(flatten(graphOf(type, params, srcs, wires)));
  return e;
}
const setParams = (g: Graph, patch: Params): Graph => ({ ...g, nodes: { ...g.nodes, n: { ...g.nodes.n, params: { ...g.nodes.n.params, ...patch } } } });
const out = (e: Engine, port: string, id = 'n') => e.nodes.get(id)!.outputs[port]?.v;
const view = (e: Engine) => e.nodes.get('n')!.viewData as Record<string, any>;

describe('Timekeeping section', () => {
  it('is a new library section holding Timer, Alarm, Stopwatch and World Clock', () => {
    expect(CATEGORIES).toContain('Timekeeping');
    expect(CATEGORIES.indexOf('Timekeeping')).toBeGreaterThan(CATEGORIES.indexOf('Node'));
    expect(MODULES.filter((m) => m.category === 'Timekeeping').map((m) => m.type)).toEqual(['timer', 'alarm', 'stopwatch', 'clock']);
    expect(MODULES.filter((m) => m.category === 'Info').map((m) => m.type)).toEqual(['comment', 'by']);
  });
  it('has its own family, with a colour of its own', async () => {
    vi.stubGlobal('requestAnimationFrame', () => 0); // the UI module starts the runtime session on import
    const { FAMILY_VAR } = await import('../ui/NodeView');
    vi.unstubAllGlobals();
    const col = FAMILY_VAR.timekeeping;
    expect(col).toMatch(/^#[0-9a-f]{6}$/i);
    expect(Object.entries(FAMILY_VAR).filter(([k, v]) => k !== 'timekeeping' && v.toLowerCase() === col.toLowerCase())).toEqual([]);
    for (const t of TYPES) expect(MODULES.find((m) => m.type === t)!.family).toBe('timekeeping');
  });
  it('uses the size of the Text display module, even with setting pins', () => {
    const text = MODULES.find((m) => m.type === 'text')!;
    for (const t of TYPES) {
      expect(MODULES.find((m) => m.type === t)!.size).toBe(text.size);
      // The Timer has ten output pins, one more than a square edge holds: it grows by one pin row (12 px) and no more.
      expect(nodeSize(getDef(t)!)).toEqual(t === 'timer' ? { w: SIZES[text.size].w, h: SIZES[text.size].h + 12 } : SIZES[text.size]);
    }
  });
  it('splits a duration into hour, minute, second and millisecond', () => {
    expect(splitDuration(0)).toEqual({ hour: 0, minute: 0, second: 0, millisecond: 0 });
    expect(splitDuration(3723456)).toEqual({ hour: 1, minute: 2, second: 3, millisecond: 456 });
    expect(splitDuration(90061001)).toEqual({ hour: 25, minute: 1, second: 1, millisecond: 1 });
    expect(splitDuration(-5)).toEqual({ hour: 0, minute: 0, second: 0, millisecond: 0 });
  });
  it('gives Timer, Alarm, Stopwatch and World Clock the same Hour, Minute, Seconds and Milliseconds output pins', () => {
    for (const t of TYPES) {
      const d = getDef(t)!;
      for (const id of ['hour', 'minute', 'second', 'millisecond']) {
        const pin = d.outputs.find((o) => o.id === id);
        expect(pin, `${t}.${id}`).toBeDefined();
        expect(pin!.type).toBe('num');
        expect(pin!.side).toBe('right');
      }
    }
  });
  it('shows milliseconds by default in every module of the section', () => {
    // The Alarm has no toggle: it always works to the millisecond.
    for (const t of TYPES.filter((x) => x !== 'alarm')) expect(MODULES.find((m) => m.type === t)!.params.find((p) => p.key === 'millis'), t).toMatchObject({ default: true });
    expect(MODULES.find((m) => m.type === 'alarm')!.params.some((p) => p.key === 'millis')).toBe(false);
  });
  it('gives every setting a setting pin, and no pin to the buttons', () => {
    for (const t of TYPES) {
      const m = MODULES.find((x) => x.type === t)!;
      const d = getDef(t)!;
      for (const p of m.params) {
        const pin = d.inputs.find((i) => i.id === `p:${p.key}`);
        if (p.kind === 'action') expect(pin).toBeUndefined();
        else { expect(pin, `${t}.${p.key}`).toBeDefined(); expect(pin!.optional).toBe(true); }
      }
    }
  });
});

describe('time helpers', () => {
  it('formats durations', () => {
    expect(fmtDuration(0)).toBe('00:00');
    expect(fmtDuration(59999, { round: 'floor' })).toBe('00:59');
    expect(fmtDuration(59001, { round: 'ceil' })).toBe('01:00');
    expect(fmtDuration(1000, { round: 'ceil' })).toBe('00:01');
    expect(fmtDuration(3723456, { millis: true })).toBe('01:02:03.456');
    expect(fmtDuration(65250, { millis: true })).toBe('01:05.250');
    expect(fmtDuration(300000, { hours: true })).toBe('00:05:00');
    expect(fmtDuration(90061000)).toBe('1d 01:01:01');
    expect(fmtDuration(-5)).toBe('00:00');
  });
  it('reads a time of day', () => {
    const h = (n: number) => n * 3600000;
    expect(parseTimeOfDay('07:30')).toBe(h(7) + 30 * 60000);
    expect(parseTimeOfDay('7:30')).toBe(h(7) + 30 * 60000);
    expect(parseTimeOfDay('19:45:30')).toBe(h(19) + 45 * 60000 + 30000);
    expect(parseTimeOfDay('7:30 pm')).toBe(h(19) + 30 * 60000);
    expect(parseTimeOfDay('7pm')).toBe(h(19));
    expect(parseTimeOfDay('07:30:15.250')).toBe(h(7) + 30 * 60000 + 15250);
    expect(parseTimeOfDay('07:30:15.5')).toBe(h(7) + 30 * 60000 + 15500);
    expect(parseTimeOfDay('7:30:15.025 pm')).toBe(h(19) + 30 * 60000 + 15025);
    expect(parseTimeOfDay('12:05 AM')).toBe(5 * 60000);
    expect(parseTimeOfDay('12pm')).toBe(h(12));
    for (const bad of ['', '7', '25:00', '12:60', '13pm', '0am', 'noon', '7:30:61', '730', '07:30.250', '07:30:15.1234']) expect(parseTimeOfDay(bad), bad).toBeNull();
    expect(fmtTimeOfDay(h(7) + 30 * 60000)).toBe('07:30');
    expect(fmtTimeOfDay(h(19) + 45 * 60000 + 30000)).toBe('19:45:30');
    expect(fmtTimeOfDay(h(7) + 30 * 60000, true)).toBe('07:30:00.000');
    expect(fmtTimeOfDay(h(19) + 45 * 60000 + 30250, true)).toBe('19:45:30.250');
  });
  it('knows which days an alarm rings', () => {
    const days = [0, 1, 2, 3, 4, 5, 6];
    expect(days.filter((d) => ringsOn('weekdays', d))).toEqual([1, 2, 3, 4, 5]);
    expect(days.filter((d) => ringsOn('weekends', d))).toEqual([0, 6]);
    expect(days.filter((d) => ringsOn('daily', d)).length).toBe(7);
  });
  it('reads a zone and counts to the next ring', () => {
    // 2026-03-13 is a Friday. 22:29:50 UTC on the 12th is 07:29:50 in Tokyo on the 13th.
    const lp = localParts('Asia/Tokyo', Date.UTC(2026, 2, 12, 22, 29, 50, 250));
    expect(lp.weekday).toBe(5);
    expect(lp.dayKey).toBe('2026-03-13');
    expect(lp.label).toBe('Fri 13 Mar');
    expect(lp.sod).toBe(((7 * 60 + 29) * 60 + 50) * 1000 + 250);
    const t730 = parseTimeOfDay('07:30')!;
    expect(msUntilRing(lp, t730, 'daily')).toBe(9750);
    expect(msUntilRing(lp, t730, 'weekdays')).toBe(9750);
    expect(msUntilRing(lp, t730, 'weekends')).toBe(9750 + 86400000); // Friday is a weekday: the next ring is Saturday
    expect(msUntilRing(lp, parseTimeOfDay('07:29')!, 'daily')).toBe(86400000 - 50250);
    expect(() => localParts('Mars/Olympus', 0)).toThrow(RangeError);
  });
});

describe('Timer', () => {
  it('counts down and then reports done', () => {
    const e = build('timer', { duration: 2, millis: true });
    e.runFor(1000);
    expect(out(e, 'running')).toBe(true);
    expect(out(e, 'done')).toBe(false);
    expect(out(e, 'remaining') as number).toBeGreaterThan(0.9);
    expect(out(e, 'remaining') as number).toBeLessThan(1.2);
    expect(out(e, 'time')).toMatch(/^00:01\.\d{3}$/);
    expect(out(e, 'progress') as number).toBeGreaterThan(0.4);
    e.runFor(1500);
    expect(out(e, 'done')).toBe(true);
    expect(out(e, 'running')).toBe(false);
    expect(out(e, 'remaining')).toBe(0);
    expect(out(e, 'progress')).toBe(1);
    expect(out(e, 'count')).toBe(1);
    expect(out(e, 'time')).toBe('00:00.000');
  });
  it('shows milliseconds by default', () => {
    const e = build('timer', { duration: 5 });
    e.runFor(100);
    expect(out(e, 'time')).toBe('00:04.950');
    e.runFor(1200);
    expect(out(e, 'time')).toMatch(/^00:03\.\d{3}$/);
  });
  it('rounds the text up to whole seconds when Show milliseconds is off', () => {
    const e = build('timer', { duration: 5, millis: false });
    e.runFor(100);
    expect(out(e, 'time')).toBe('00:05');
    e.runFor(1200);
    expect(out(e, 'time')).toBe('00:04');
  });
  it('outputs the time left as Hour, Minute, Seconds and Milliseconds', () => {
    const e = build('timer', { duration: 3723.5, autostart: false });
    e.runFor(100);
    expect(out(e, 'hour')).toBe(1);
    expect(out(e, 'minute')).toBe(2);
    expect(out(e, 'second')).toBe(3);
    expect(out(e, 'millisecond')).toBe(500);
    const g = build('timer', { duration: 3723.5 });
    g.runFor(1000);
    expect(out(g, 'hour')).toBe(1);
    expect(out(g, 'minute')).toBe(2);
    expect(out(g, 'second')).toBe(2);
    expect(out(g, 'millisecond')).toBeGreaterThan(400);
    expect(out(g, 'millisecond')).toBeLessThanOrEqual(550);
    g.runFor(3730000);
    expect([out(g, 'hour'), out(g, 'minute'), out(g, 'second'), out(g, 'millisecond')]).toEqual([0, 0, 0, 0]);
  });
  it('keeps the four time pins exact when Show milliseconds is off', () => {
    const e = build('timer', { duration: 10, millis: false });
    e.runFor(1250);
    expect(out(e, 'second')).toBe(8);
    expect(out(e, 'millisecond') as number).toBeGreaterThan(0);
  });
  it('waits for Start when Auto start is off, and Start restarts it after it finished', () => {
    const e = build('timer', { duration: 1, autostart: false, millis: true });
    e.runFor(500);
    expect(out(e, 'running')).toBe(false);
    expect(out(e, 'remaining')).toBe(1);
    e.command('n', 'start');
    e.runFor(1500);
    expect(out(e, 'done')).toBe(true);
    e.command('n', 'start');
    e.runFor(200);
    expect(out(e, 'done')).toBe(false);
    expect(out(e, 'running')).toBe(true);
  });
  it('starts from a signal on the Start pin', () => {
    const e = build('timer', { duration: 10, autostart: false, millis: true }, [['p', 'pulse', { period: 100000, width: 100, offset: 400 }]], [['p', 'out', 'start']]);
    e.runFor(300);
    expect(out(e, 'running')).toBe(false);
    e.runFor(500);
    expect(out(e, 'running')).toBe(true);
  });
  it('pauses on a command and resumes, keeping the time', () => {
    const e = build('timer', { duration: 10, millis: true });
    e.runFor(1000);
    e.command('n', 'pause');
    e.runFor(100);
    const frozen = out(e, 'remaining') as number;
    expect(out(e, 'running')).toBe(false);
    expect(view(e).state).toBe('paused');
    e.runFor(2000);
    expect(out(e, 'remaining')).toBe(frozen);
    e.command('n', 'pause');
    e.runFor(500);
    expect(out(e, 'running')).toBe(true);
    expect(out(e, 'remaining') as number).toBeLessThan(frozen);
  });
  it('holds while the Pause pin is true', () => {
    const e = build('timer', { duration: 10, millis: true }, [['sw', 'switch', { on: true }]], [['sw', 'on', 'pause']]);
    e.runFor(1000);
    expect(out(e, 'running')).toBe(false);
    expect(out(e, 'remaining')).toBe(10);
  });
  it('resets to the full duration', () => {
    const e = build('timer', { duration: 5, millis: true });
    e.runFor(2000);
    e.command('n', 'reset');
    e.runFor(50);
    expect(out(e, 'remaining')).toBe(5);
    expect(out(e, 'running')).toBe(false);
    expect(out(e, 'done')).toBe(false);
  });
  it('repeats, pulsing Done and counting rounds', () => {
    const e = build('timer', { duration: 1, repeat: true, millis: true });
    const seen: boolean[] = [];
    for (let i = 0; i < 80; i++) { e.step(); seen.push(out(e, 'done') as boolean); }
    expect(seen.some(Boolean)).toBe(true);
    expect(seen[seen.length - 1]).toBe(false);
    expect(out(e, 'count') as number).toBeGreaterThanOrEqual(3);
    expect(out(e, 'running')).toBe(true);
  });
  it('follows Duration while waiting', () => {
    const g = graphOf('timer', { duration: 10, autostart: false, millis: true });
    const e = new Engine(50);
    e.load(flatten(g));
    e.runFor(200);
    expect(out(e, 'remaining')).toBe(10);
    e.load(flatten(setParams(g, { duration: 30 })));
    e.runFor(200);
    expect(out(e, 'remaining')).toBe(30);
  });
  it('shows the hours field for long timers', () => {
    const e = build('timer', { duration: 3600, millis: false });
    e.runFor(100);
    expect(out(e, 'time')).toBe('01:00:00');
    const f = build('timer', { duration: 3600 });
    f.runFor(100);
    expect(out(f, 'time')).toBe('00:59:59.950');
  });
  it('lets a setting pin drive Duration', () => {
    const e = build('timer', { duration: 10, autostart: false, millis: true }, [['c', 'constant', { value: '42' }]], [['c', 'out', 'p:duration']]);
    e.runFor(200);
    expect(out(e, 'remaining')).toBe(42);
  });
});

describe('Stopwatch', () => {
  it('counts up and keeps counting', () => {
    const e = build('stopwatch');
    e.runFor(1000);
    expect(out(e, 'running')).toBe(true);
    expect(out(e, 'elapsed') as number).toBeGreaterThan(0.9);
    expect(out(e, 'elapsed') as number).toBeLessThanOrEqual(1);
    expect(out(e, 'time')).toMatch(/^00:0[01]\.\d{3}$/);
    e.runFor(1000);
    expect(out(e, 'elapsed') as number).toBeGreaterThan(1.9);
  });
  it('waits for Start when Auto start is off, stops and resumes', () => {
    const e = build('stopwatch', { autostart: false });
    e.runFor(500);
    expect(out(e, 'elapsed')).toBe(0);
    expect(out(e, 'running')).toBe(false);
    e.command('n', 'toggle');
    e.runFor(1000);
    expect(out(e, 'running')).toBe(true);
    e.command('n', 'toggle');
    e.runFor(100);
    const t = out(e, 'elapsed') as number;
    expect(out(e, 'running')).toBe(false);
    expect(t).toBeGreaterThan(0.8);
    e.runFor(1000);
    expect(out(e, 'elapsed')).toBe(t);
    e.command('n', 'toggle');
    e.runFor(500);
    expect(out(e, 'elapsed') as number).toBeGreaterThan(t);
  });
  it('records laps as time since the previous lap', () => {
    const e = build('stopwatch');
    e.runFor(100);
    expect(out(e, 'lap')).toBeUndefined();
    e.runFor(900);
    e.command('n', 'lap');
    e.runFor(100);
    expect(out(e, 'laps')).toBe(1);
    expect(out(e, 'lap') as number).toBeGreaterThan(0.9);
    e.runFor(2000);
    e.command('n', 'lap');
    e.runFor(100);
    expect(out(e, 'laps')).toBe(2);
    const second = out(e, 'lap') as number;
    expect(second).toBeGreaterThan(1.9);
    expect(second).toBeLessThan(2.3);
    expect(view(e).lap).toMatch(/^00:0[23]\.\d{3}$/);
  });
  it('ignores Lap while stopped, and Reset clears everything', () => {
    const e = build('stopwatch', { autostart: false });
    e.command('n', 'lap');
    e.runFor(100);
    expect(out(e, 'laps')).toBe(0);
    e.command('n', 'toggle');
    e.runFor(500);
    e.command('n', 'lap');
    e.runFor(100);
    expect(out(e, 'laps')).toBe(1);
    e.command('n', 'reset');
    e.runFor(100);
    expect(out(e, 'elapsed')).toBe(0);
    expect(out(e, 'laps')).toBe(0);
    expect(out(e, 'running')).toBe(false);
    expect(out(e, 'lap')).toBeUndefined();
  });
  it('stops by itself at the limit, and Start then begins a fresh run', () => {
    const e = build('stopwatch', { limit: 1, millis: false });
    e.runFor(2000);
    expect(out(e, 'running')).toBe(false);
    expect(out(e, 'elapsed')).toBe(1);
    expect(view(e).state).toBe('limit');
    e.command('n', 'toggle');
    e.runFor(200);
    expect(out(e, 'running')).toBe(true);
    expect(out(e, 'elapsed') as number).toBeLessThan(0.5);
  });
  it('is driven by pins', () => {
    const e = build('stopwatch', { autostart: false }, [['p', 'pulse', { period: 100000, width: 100, offset: 500 }]], [['p', 'out', 'start']]);
    e.runFor(300);
    expect(out(e, 'running')).toBe(false);
    e.runFor(1000);
    expect(out(e, 'running')).toBe(true);
    expect(out(e, 'elapsed') as number).toBeGreaterThan(0.5);
  });
});

describe('Alarm', () => {
  // Tokyo has no daylight saving, so these times hold all year. The start is 07:29:50 on Friday 13 March 2026 in Tokyo.
  const START = Date.UTC(2026, 2, 12, 22, 29, 50, 0);
  let wall = START;
  beforeEach(() => { wall = START; vi.spyOn(Date, 'now').mockImplementation(() => wall); });
  afterEach(() => vi.restoreAllMocks());
  const advance = (e: Engine, ms: number) => { for (let i = 0; i < Math.round(ms / 50); i++) { wall += 50; e.step(); } };
  const tokyo = (p: Params = {}): Params => ({ time: '07:30', city: 'Tokyo', ring: 5, ...p });

  it('counts down to the next ring', () => {
    const e = build('alarm', tokyo());
    advance(e, 100);
    expect(out(e, 'ringing')).toBe(false);
    expect(out(e, 'seconds')).toBeGreaterThanOrEqual(9);
    expect(out(e, 'seconds')).toBeLessThanOrEqual(10);
    expect(out(e, 'countdown')).toMatch(/^00:00:09\.\d{3}$/);
    expect(out(e, 'next')).toBe('Fri 13 Mar, 07:30:00.000');
    expect(out(e, 'hour')).toBe(0);
    expect(out(e, 'minute')).toBe(0);
    expect(out(e, 'second')).toBe(9);
    expect(out(e, 'millisecond') as number).toBeGreaterThan(800);
    expect(view(e).state).toBe('armed');
    expect(view(e).place).toBe('Tokyo');
  });
  it('rings when the time arrives and falls silent after the Ring time', () => {
    const e = build('alarm', tokyo());
    advance(e, 9000);
    expect(out(e, 'ringing')).toBe(false);
    advance(e, 1500);
    expect(out(e, 'ringing')).toBe(true);
    expect(out(e, 'count')).toBe(1);
    expect(view(e).state).toBe('ringing');
    advance(e, 4000);
    expect(out(e, 'ringing')).toBe(true);
    advance(e, 2000);
    expect(out(e, 'ringing')).toBe(false);
    expect(out(e, 'next')).toBe('Sat 14 Mar, 07:30:00.000');
  });
  it('rings once only when set to once', () => {
    const e = build('alarm', tokyo({ repeat: 'once' }));
    advance(e, 12000);
    expect(out(e, 'count')).toBe(1);
    advance(e, 10000);
    expect(out(e, 'ringing')).toBe(false);
    expect(out(e, 'countdown')).toBeUndefined();
    expect(out(e, 'next')).toBeUndefined();
    expect(view(e).state).toBe('done');
    wall += 86400000;
    advance(e, 100);
    expect(out(e, 'count')).toBe(1);
  });
  it('skips days that are not allowed', () => {
    const e = build('alarm', tokyo({ repeat: 'weekends' }));
    advance(e, 12000);
    expect(out(e, 'count')).toBe(0);
    expect(out(e, 'next')).toBe('Sat 14 Mar, 07:30:00.000');
    wall = START;
    const w = build('alarm', tokyo({ repeat: 'weekdays' }));
    advance(w, 12000);
    expect(out(w, 'count')).toBe(1);
    expect(out(w, 'next')).toBe('Mon 16 Mar, 07:30:00.000');
  });
  it('does not ring for a time that has already passed when the program starts', () => {
    const e = build('alarm', tokyo({ time: '07:00' }));
    advance(e, 2000);
    expect(out(e, 'ringing')).toBe(false);
    expect(out(e, 'count')).toBe(0);
    expect(out(e, 'next')).toBe('Sat 14 Mar, 07:00:00.000');
  });
  it('catches a ring that fell inside a pause', () => {
    const e = build('alarm', tokyo());
    advance(e, 500);
    wall += 60000; // the program was paused for a minute; the next look is at the next wake-up
    advance(e, 1500);
    expect(out(e, 'count')).toBe(1);
  });
  it('rings on a test command, and dismiss silences it', () => {
    const e = build('alarm', tokyo({ ring: 60 }));
    advance(e, 100);
    e.command('n', 'test');
    advance(e, 100);
    expect(out(e, 'ringing')).toBe(true);
    e.command('n', 'dismiss');
    advance(e, 100);
    expect(out(e, 'ringing')).toBe(false);
  });
  it('snoozes for five minutes and rings again', () => {
    const e = build('alarm', tokyo({ ring: 60, repeat: 'once' }));
    advance(e, 11000);
    expect(out(e, 'ringing')).toBe(true);
    e.command('n', 'snooze');
    advance(e, 100);
    expect(out(e, 'ringing')).toBe(false);
    expect(view(e).state).toBe('snoozed');
    expect(out(e, 'seconds') as number).toBeGreaterThan(290);
    expect(out(e, 'seconds') as number).toBeLessThanOrEqual(300);
    wall += 301000;
    advance(e, 1500);
    expect(out(e, 'ringing')).toBe(true);
    expect(out(e, 'count')).toBe(2);
  });
  it('re-arms when the time changes', () => {
    const g = graphOf('alarm', tokyo({ repeat: 'once' }));
    const e = new Engine(50);
    e.load(flatten(g));
    advance(e, 20000);
    expect(view(e).state).toBe('done');
    e.load(flatten(setParams(g, { time: '07:31' })));
    advance(e, 100);
    expect(view(e).state).toBe('armed');
  });
  it('reports a bad time or city', () => {
    const bad = build('alarm', { time: '25:00' });
    advance(bad, 100);
    expect(bad.nodes.get('n')!.status.level).toBe('error');
    expect(bad.nodes.get('n')!.status.message).toMatch(/not a time of day/);
    const city = build('alarm', { time: '07:30', city: 'Atlantis' });
    advance(city, 100);
    expect(city.nodes.get('n')!.status.level).toBe('error');
    expect(city.nodes.get('n')!.status.message).toMatch(/Unknown city/);
  });
  it('lets a setting pin set the time from the program', () => {
    const e = build('alarm', tokyo({ time: '12:00' }), [['t', 'info', { text: '07:30:05' }]], [['t', 'text', 'p:time']]);
    advance(e, 100);
    expect(view(e).time).toBe('07:30:05.000');
    advance(e, 16000);
    expect(out(e, 'count')).toBe(1);
  });
});
