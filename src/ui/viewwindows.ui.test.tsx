// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { historyGeometry } from './ViewWindows';

const CENTER = 12 + (380 - 12 - 28) / 2;

describe('full-size Meter history autoscaling', () => {
  it.each([
    ['2^53', 9007199254740992],
    ['1e20', 1e20],
    ['max double', Number.MAX_VALUE],
    ['negative max double', -Number.MAX_VALUE],
  ])('draws a finite centered flat line for %s', (_name, value) => {
    const { points, ticks } = historyGeometry([value, value], true);
    expect(points.map((p) => p.y)).toEqual([CENTER, CENTER]);
    expect(points.every((p) => Number.isFinite(p.x) && Number.isFinite(p.y))).toBe(true);
    expect(ticks.every((t) => Number.isFinite(t.value) && Number.isFinite(t.y))).toBe(true);
  });

  it('scales a history spanning opposite extreme signs without overflow', () => {
    const { points, ticks } = historyGeometry([-1e308, 0, 1e308], true);
    expect(points.map((p) => p.y)).toEqual([352, CENTER, 12]);
    expect(points.every((p) => Number.isFinite(p.x) && Number.isFinite(p.y))).toBe(true);
    expect(ticks.map((t) => t.value)).toEqual([-1e308, -5e307, 0, 5e307, 1e308]);
    expect(ticks.every((t) => Number.isFinite(t.value) && Number.isFinite(t.y))).toBe(true);
  });

  it('keeps the fixed 0–1 scale when automatic scaling is off', () => {
    const { points } = historyGeometry([-2, 0, 0.5, 1, 2], false);
    expect(points.map((p) => p.y)).toEqual([352, 352, 182, 12, 12]);
  });
});
