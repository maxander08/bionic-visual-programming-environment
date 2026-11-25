import { describe, expect, it } from 'vitest';
import { unitFraction } from './util';

describe('unitFraction', () => {
  it('keeps normalized coordinates finite when finite bounds span the full double range', () => {
    expect(unitFraction(-1e308, -1e308, 1e308)).toBe(0);
    expect(unitFraction(0, -1e308, 1e308)).toBe(0.5);
    expect(unitFraction(1e308, -1e308, 1e308)).toBe(1);
    expect(unitFraction(-Number.MAX_VALUE, -Number.MAX_VALUE, Number.MAX_VALUE)).toBe(0);
    expect(unitFraction(Number.MAX_VALUE, -Number.MAX_VALUE, Number.MAX_VALUE)).toBe(1);
  });

  it('retains ordinary scaling, clamping and the midpoint of a degenerate range', () => {
    expect(unitFraction(5, 0, 10)).toBe(0.5);
    expect(unitFraction(-2, 0, 10)).toBe(0);
    expect(unitFraction(12, 0, 10)).toBe(1);
    expect(unitFraction(7, 7, 7)).toBe(0.5);
  });
});
