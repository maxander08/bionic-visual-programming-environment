import { describe, expect, it } from 'vitest';
import { labelExpression } from './VectorMap';

describe('vector map label languages', () => {
  it('prefers the selected Chinese script, then a generic Chinese name, then the local name', () => {
    expect(labelExpression('zh-Hans')).toEqual([
      'coalesce', ['get', 'name:zh-Hans'], ['get', 'name:zh'], ['get', 'name'],
    ]);
    expect(labelExpression('zh-Hant')).toEqual([
      'coalesce', ['get', 'name:zh-Hant'], ['get', 'name:zh'], ['get', 'name'],
    ]);
  });

  it('uses English names where possible and otherwise keeps the local name', () => {
    expect(labelExpression('en')).toEqual([
      'coalesce', ['get', 'name:en'], ['get', 'name:latin'], ['get', 'name'],
    ]);
  });
});
