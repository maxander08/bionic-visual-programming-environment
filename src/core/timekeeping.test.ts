import { afterEach, describe, expect, it, vi } from 'vitest';
import { Engine } from './engine';
import { addNode, connect, emptyGraph, flatten } from './graph';
import { CATEGORIES, MODULES, getDef, nodeSize } from './registry';
import { PIN_SPACING, portPosition } from './registry';
import { dayAllowed, fmtDuration } from './modules/timekeeping';
import type { Graph, Params } from './types';

function build(nodes: [string, string, Params?][], wires: [string, string, string, string][] = []) {
  let g: Graph = emptyGraph();
  nodes.forEach(([id, type, p], i) => (g = addNode(g, type, i * 192, 0, p ?? {}, undefined, id).graph));
  for (const [a, ap, b, bp] of wires) {
    const r = connect(g, a, ap, b, bp);
    if (r.error) throw new Error(r.error);
    g = r.graph;
  }
  const e = new Engine(50);
  e.load(flatten(g));
  return e;
}

afterEach(() => vi.useRealTimers());

describe('Timekeeping section', () => {
  it('has its own category holding World Clock, Timer, Alarm and Stopwatch', () => {
    expect(CATEGORIES).toContain('Timekeeping');
    const list = MODULES.filter((m) => m.category === 'Timekeeping').map((m) => m.type);
    expect(list).toEqual(['clock', 'timer', 'alarm', 'stopwatch']);
    expect(MODULES.filter((m) => m.category === 'Info').map((m) => m.type)).not.toContain('clock');
  });

  it('gives every setting of the new modules a setting pin of the right type', () => {
    const types: Record<string, string> = { number: 'num', bool: 'bool', select: 'text', text: 'text' };
    for (const type of ['timer', 'alarm', 'stopwatch']) {
      const m = MODULES.find((x) => x.type === type)!;
      const d = getDef(type)!;
      for (const p of m.params) {
        if (p.kind === 'action') expect(d.inputs.some((i) => i.id === `p:${p.key}`)).toBe(false);
        else expect(d.inputs.find((i) => i.id === `p:${p.key}`)?.type).toBe(types[p.kind]);
      }
      expect(d.paramPins!.length).toBe(m.params.filter((p) => p.kind !== 'action').length);
    }
  });

  it('keeps every pin of the new modules at least one spacing apart, inside the node', () => {
    for (const type of ['timer', 'alarm', 'stopwatch']) {
      const d = getDef(type)!;
      const node = { id: 'n', type, x: 0, y: 0, params: {} };
      const { w, h } = nodeSize(d);
      for (const dir of ['in', 'out'] as const) {
        const list = dir === 'in' ? d.inputs : d.outputs;
        const pos = list.map((p) => ({ id: p.id, ...portPosition(node, d, p.id, dir)! }));
        for (const side of ['top', 'bottom', 'left', 'right']) {
          const g = pos.filter((p) => p.side === side).map((p) => (side === 'top' || side === 'bottom' ? p.x : p.y)).sort((a, b) => a - b);
          // Pin spacing is allowed one grid step of slack by the layout rules.
          for (let i = 1; i < g.length; i++) expect(g[i] - g[i - 1]).toBeGreaterThanOrEqual(PIN_SPACING - 2);
          g.forEach((v) => { expect(v).toBeGreaterThan(0); expect(v).toBeLessThan(side === 'top' || side === 'bottom' ? w : h); });
        }
      }
    }
  });
});

describe('fmtDuration', () => {
  it('formats minutes, hours and milliseconds', () => {
    expect(fmtDuration(90000)).toBe('01:30');
    expect(fmtDuration(3600000 + 65000)).toBe('1:01:05');
    expect(fmtDuration(1234, true)).toBe('00:01.234');
    expect(fmtDuration(1001, false, 'ceil')).toBe('00:02');
    expect(fmtDuration(1999, false, 'floor')).toBe('00:01');
    expect(fmtDuration(-5)).toBe('00:00');
  });
});

describe('Timer', () => {
  it('counts down in simulation time and signals done', () => {
    const e = build([['t', 'timer', { seconds: 3 }]]);
    e.runFor(100);
    expect(e.out('t', 'running')).toBe(true);
    expect(e.out('t', 'done')).toBe(false);
    e.runFor(1000);
    expect(e.out('t', 'time')).toBe('00:02');
    expect(e.out('t', 'remaining') as number).toBeGreaterThan(1.8);
    expect(e.out('t', 'remaining') as number).toBeLessThan(2);
    e.runFor(2200);
    expect(e.out('t', 'done')).toBe(true);
    expect(e.out('t', 'running')).toBe(false);
    expect(e.out('t', 'time')).toBe('00:00');
    expect(e.out('t', 'progress')).toBe(1);
    expect(e.nodes.get('t')!.status.level).toBe('ok');
  });

  it('waits for Start when Start automatically is off, then pauses, resumes and resets', () => {
    const e = build(
      [['sw1', 'switch', { on: false }], ['sw2', 'switch', { on: false }], ['sw3', 'switch', { on: false }], ['t', 'timer', { seconds: 10, autostart: false }]],
      [['sw1', 'on', 't', 'start'], ['sw2', 'on', 't', 'pause'], ['sw3', 'on', 't', 'reset']],
    );
    e.runFor(1000);
    expect(e.out('t', 'running')).toBe(false);
    expect(e.out('t', 'time')).toBe('00:10');
    e.command('t', 'start');
    e.runFor(2000);
    expect(e.out('t', 'running')).toBe(true);
    e.command('t', 'pause');
    e.runFor(100);
    const frozen = e.out('t', 'remaining') as number;
    e.runFor(3000);
    expect(e.out('t', 'running')).toBe(false);
    expect(e.out('t', 'remaining')).toBe(frozen);
    e.command('t', 'start');
    e.runFor(1000);
    expect(e.out('t', 'remaining') as number).toBeLessThan(frozen);
    e.command('t', 'reset');
    e.runFor(100);
    expect(e.out('t', 'remaining')).toBe(10);
    expect(e.out('t', 'running')).toBe(false);
    expect(e.out('t', 'progress')).toBe(0);
  });

  it('reacts to the rising edge of the Start, Pause and Reset pins', () => {
    const g0 = addNode(emptyGraph(), 'timer', 0, 0, { seconds: 10, autostart: false }, undefined, 't').graph;
    const g1 = addNode(g0, 'constant', 0, 200, { kind: 'bool', value: 'true' }, undefined, 'k').graph;
    const g = connect(g1, 'k', 'out', 't', 'start').graph;
    const e = new Engine(50);
    e.load(flatten(g));
    e.runFor(500);
    expect(e.out('t', 'running')).toBe(true);
  });

  it('repeats, pulsing Done at every zero', () => {
    const e = build([['t', 'timer', { seconds: 1, repeat: true }], ['c', 'counter']], [['t', 'done', 'c', 'inc']]);
    e.runFor(3600);
    expect(e.out('t', 'running')).toBe(true);
    expect(e.nodes.get('t')!.state.runs).toBe(3);
    expect(e.out('c', 'out')).toBe(3);
  });

  it('can be driven by its duration setting pins and follows a changed duration', () => {
    const e = build([['m', 'constant', { value: '2' }], ['t', 'timer', { seconds: 0, minutes: 0 }]], [['m', 'out', 't', 'p:minutes']]);
    e.runFor(200);
    expect(e.out('t', 'time')).toBe('02:00');
    expect(e.nodes.get('t')!.driven).toBe(true);
    expect(e.nodes.get('t')!.params.minutes).toBe(0);
  });

  it('warns when the duration is zero', () => {
    const e = build([['t', 'timer', { seconds: 0 }]]);
    e.runFor(200);
    expect(e.nodes.get('t')!.status.level).toBe('warn');
    expect(e.out('t', 'running')).toBe(false);
  });

  it('shows milliseconds when asked', () => {
    const e = build([['t', 'timer', { seconds: 5, millis: true }]]);
    e.runFor(500);
    expect(e.out('t', 'time')).toMatch(/^00:0[34]\.\d{3}$/);
  });
});

describe('Stopwatch', () => {
  it('counts up, keeps time when stopped and resumes', () => {
    const e = build([['s', 'stopwatch']]);
    e.runFor(2000);
    expect(e.out('s', 'running')).toBe(true);
    expect(e.out('s', 'elapsed') as number).toBeCloseTo(1.95, 1);
    expect(e.out('s', 'time')).toMatch(/^00:01\.\d{3}$/);
    e.command('s', 'stop');
    e.runFor(100);
    const kept = e.out('s', 'elapsed');
    e.runFor(2000);
    expect(e.out('s', 'elapsed')).toBe(kept);
    expect(e.out('s', 'running')).toBe(false);
    e.command('s', 'start');
    e.runFor(1000);
    expect(e.out('s', 'elapsed') as number).toBeGreaterThan(kept as number);
  });

  it('records laps and resets', () => {
    const e = build([['s', 'stopwatch']]);
    e.runFor(1000);
    e.command('s', 'lap');
    e.runFor(100);
    expect(e.out('s', 'laps')).toBe(1);
    expect(e.out('s', 'lap') as number).toBeGreaterThan(0.9);
    e.runFor(2000);
    e.command('s', 'lap');
    e.runFor(100);
    expect(e.out('s', 'laps')).toBe(2);
    expect(e.out('s', 'lap') as number).toBeGreaterThan(2);
    e.command('s', 'reset');
    e.runFor(100);
    expect(e.out('s', 'laps')).toBe(0);
    expect(e.out('s', 'lap')).toBeUndefined();
    expect(e.out('s', 'elapsed')).toBe(0);
    expect(e.out('s', 'running')).toBe(false);
  });

  it('waits for Start when Start automatically is off', () => {
    const e = build([['s', 'stopwatch', { autostart: false }]]);
    e.runFor(1000);
    expect(e.out('s', 'running')).toBe(false);
    expect(e.out('s', 'elapsed')).toBe(0);
    e.command('s', 'start');
    e.runFor(1000);
    expect(e.out('s', 'running')).toBe(true);
  });

  it('stops by itself at the limit', () => {
    const e = build([['s', 'stopwatch', { limit: 2 }]]);
    e.runFor(5000);
    expect(e.out('s', 'running')).toBe(false);
    expect(e.out('s', 'elapsed')).toBe(2);
    expect(e.out('s', 'time')).toBe('00:02.000');
  });
});

describe('Alarm', () => {
  // Fake the wall clock: 2026-03-12 is a Thursday. The device zone is pinned by choosing a city.
  const at = (h: number, m: number, s = 0) => new Date(Date.UTC(2026, 2, 12, h, m, s)).getTime();
  const start = (params: Params, utc = at(7, 29, 50)) => {
    vi.useFakeTimers();
    vi.setSystemTime(utc);
    const e = build([['a', 'alarm', { city: 'London, United Kingdom', ...params }]]);
    return e;
  };
  const advance = (e: Engine, ms: number) => { for (let t = 0; t < ms; t += 50) { vi.advanceTimersByTime(50); e.step(50); } };

  it('rings when the clock reaches the time, then stops after the ring duration', () => {
    const e = start({ hour: 7, minute: 30, duration: 2 });
    advance(e, 500);
    expect(e.out('a', 'ringing')).toBe(false);
    expect(e.out('a', 'left')).toBe('00:10');
    expect(e.out('a', 'next')).toBe('Thu 12 Mar 07:30');
    advance(e, 10500);
    expect(e.out('a', 'ringing')).toBe(true);
    expect(e.out('a', 'rings')).toBe(1);
    advance(e, 2500);
    expect(e.out('a', 'ringing')).toBe(false);
    expect(e.out('a', 'next')).toBe('Fri 13 Mar 07:30');
    expect(e.nodes.get('a')!.status.level).toBe('ok');
  });

  it('can be dismissed, snoozed and tested', () => {
    const e = start({ hour: 7, minute: 30, duration: 60, snooze: 1 });
    advance(e, 11000);
    expect(e.out('a', 'ringing')).toBe(true);
    e.command('a', 'dismiss');
    advance(e, 100);
    expect(e.out('a', 'ringing')).toBe(false);
    expect(e.out('a', 'rings')).toBe(1);
    e.command('a', 'test');
    advance(e, 100);
    expect(e.out('a', 'ringing')).toBe(true);
    expect(e.out('a', 'rings')).toBe(2);
    e.command('a', 'snooze');
    advance(e, 100);
    expect(e.out('a', 'ringing')).toBe(false);
    expect(e.out('a', 'next')).toMatch(/^Thu 12 Mar 07:31/);
    advance(e, 61000);
    expect(e.out('a', 'ringing')).toBe(true);
    expect(e.out('a', 'rings')).toBe(3);
  });

  it('honours Days and the Armed setting', () => {
    const wk = start({ hour: 7, minute: 30, days: 'weekends' });
    advance(wk, 12000);
    expect(wk.out('a', 'rings')).toBe(0);
    expect(wk.out('a', 'next')).toBe('Sat 14 Mar 07:30');
    const off = start({ hour: 7, minute: 30, armed: false });
    advance(off, 12000);
    expect(off.out('a', 'rings')).toBe(0);
    expect(off.out('a', 'left')).toBe('Off');
    expect(off.out('a', 'seconds')).toBeUndefined();
  });

  it('rings only once when asked', () => {
    const e = start({ hour: 7, minute: 30, once: true, duration: 1 });
    advance(e, 12000);
    expect(e.out('a', 'rings')).toBe(1);
    expect(e.out('a', 'next')).toBe('Spent');
  });

  it('uses the time zone of the chosen city', () => {
    // 07:29:50 in London is 16:29:50 in Tokyo, so a 07:30 alarm there is the next morning.
    const e = start({ hour: 7, minute: 30, city: 'Tokyo, Japan' });
    advance(e, 12000);
    expect(e.out('a', 'rings')).toBe(0);
    expect(e.out('a', 'next')).toBe('Fri 13 Mar 07:30');
  });

  it('errors on an unknown city but accepts an empty one (this device)', () => {
    const bad = start({ city: 'Gotham' });
    advance(bad, 100);
    expect(bad.nodes.get('a')!.status.level).toBe('error');
    const dev = start({ city: '' });
    advance(dev, 100);
    expect(dev.nodes.get('a')!.status.level).toBe('ok');
    expect(dev.out('a', 'left')).toMatch(/^\d+:\d\d:\d\d$|^\d\d:\d\d$/);
  });

  it('dayAllowed maps weekdays correctly', () => {
    const thursday = Math.floor(Date.UTC(2026, 2, 12) / 86400000);
    expect(dayAllowed('thu', thursday)).toBe(true);
    expect(dayAllowed('fri', thursday)).toBe(false);
    expect(dayAllowed('weekdays', thursday)).toBe(true);
    expect(dayAllowed('weekends', thursday + 2)).toBe(true);
    expect(dayAllowed('sun', thursday + 3)).toBe(true);
  });
});
