import { afterEach, describe, expect, it } from 'vitest';
import { Engine } from './engine';
import { addNode, connect, emptyGraph, flatten } from './graph';
import { clearPlaces, fitZoom, fromPixel, localPlace, orthographic, parseCoords, readOutline, requestPlace, setPlaceRunner, toPixel, unproject, zoomFor } from './geo';
import { cityLabels, findCity } from './worldclock';
import { getDef } from './registry';
import { setActiveLang, trIn, trPlace } from '../i18n';
import type { Graph, Params } from './types';

afterEach(() => { setActiveLang('en'); setPlaceRunner(undefined); clearPlaces(); });

function run(nodes: [string, string, Params?][], wires: [string, string, string, string][] = []) {
  let g: Graph = emptyGraph();
  nodes.forEach(([id, type, p], i) => (g = addNode(g, type, i * 300, 0, p ?? {}, undefined, id).graph));
  for (const [a, ap, b, bp] of wires) g = connect(g, a, ap, b, bp).graph;
  const e = new Engine(50);
  e.load(flatten(g));
  for (let t = 0; t < 300; t += 50) e.step();
  return e;
}

describe('places', () => {
  it('reads coordinates in several spellings', () => {
    expect(parseCoords('35.68, 139.76')).toEqual([35.68, 139.76]);
    expect(parseCoords('33.87S 151.21E')).toEqual([-33.87, 151.21]);
    expect(parseCoords('120, 10')).toBeNull();
    expect(parseCoords('Tokyo')).toBeNull();
  });
  it('knows cities and countries in English and in both Chinese scripts', () => {
    const t = localPlace('Tokyo', 'en')!;
    expect(t.lat).toBeCloseTo(35.69, 1);
    expect(localPlace('东京', 'zh-Hans')!.label).toBe('东京, 日本');
    expect(localPlace('東京', 'zh-Hant')!.label).toBe('東京, 日本');
    expect(localPlace('日本', 'zh-Hans')!.kind).toBe('country');
    expect(localPlace('France', 'zh-Hant')!.name).toBe('法國');
    expect(findCity('东京, 日本')?.name).toBe('Tokyo');
    expect(localPlace('nowhere-at-all', 'en')).toBeNull();
  });
  it('does the tile and globe arithmetic both ways', () => {
    const p = toPixel(35.68, 139.76, 10);
    const q = fromPixel(p.x, p.y, 10);
    expect(q.lat).toBeCloseTo(35.68, 6);
    expect(q.lon).toBeCloseTo(139.76, 6);
    const o = orthographic(10, 20, 10, 20);
    expect(o.z).toBeCloseTo(1, 9);
    const u = unproject(orthographic(48, 2, 30, 10).x, orthographic(48, 2, 30, 10).y, 30, 10)!;
    expect(u.lat).toBeCloseTo(48, 6); expect(u.lon).toBeCloseTo(2, 6);
    expect(fitZoom([35.6, 139.6, 35.8, 139.9], 400, 300)).toBeGreaterThan(9);
    expect(zoomFor(localPlace('Tokyo', 'en')!, false, 16, 300, 300)).toBe(16);
  });
  it('keeps the main land of a scattered country and simplifies it', () => {
    const big = Array.from({ length: 200 }, (_, i) => [i / 20, Math.sin(i / 7) + (i % 2) * 0.001]);
    const ring = [[0, 0], ...big, [10, -5], [0, 0]];
    const far = [[100, 0], [101, 0], [101, 1], [100, 1], [100, 0]];
    const r = readOutline({ type: 'MultiPolygon', coordinates: [[far], [ring]] })!;
    expect(r.main[1]).toBe(0); expect(r.main[3]).toBeCloseTo(10, 5);
    expect(r.rings[0].length).toBeLessThan(ring.length);
    expect(r.rings.length).toBe(2);
  });
  it('asks the runner for places it does not know and shows known ones at once', async () => {
    const calls: string[] = [];
    setPlaceRunner(async (q) => { calls.push(q); return q === 'Bavaria' ? { query: q, name: 'Bavaria', label: 'Bavaria, Germany', lat: 48.9, lon: 11.4, bbox: [47.2, 8.9, 50.6, 13.9], kind: 'state', source: 'osm' } : null; });
    expect(requestPlace('Tokyo', 'en')).toMatchObject({ status: 'ready' });
    expect(requestPlace('Bavaria', 'en').status).toBe('pending');
    await new Promise((r) => setTimeout(r, 10));
    expect(requestPlace('Bavaria', 'en')).toMatchObject({ status: 'ready', place: { label: 'Bavaria, Germany' } });
    expect(requestPlace('Atlantis', 'en').status).toBe('pending');
    await new Promise((r) => setTimeout(r, 10));
    expect(requestPlace('Atlantis', 'en').status).toBe('error');
    expect(calls).toContain('Tokyo');
  });
});

describe('Map and Globe modules', () => {
  it('have setting pins for every setting, and show and emit a known place', () => {
    for (const type of ['map', 'globe']) {
      const d = getDef(type)!;
      const keys = d.params.map((p) => p.key);
      expect(d.paramPins!.map((p) => p.id)).toEqual(keys.map((k) => `p:${k}`));
      expect(d.inputs[0].id).toBe('in');
      const e = run([['P', type, { place: 'Paris, France' }]]);
      const n = e.nodes.get('P')!;
      expect((n.viewData as any).state).toBe('ready');
      expect(Number(n.outputs.lat?.v)).toBeCloseTo(48.85, 0);
      expect(String(n.outputs.name?.v)).toContain('Paris');
    }
  });
  it('take the place from their input pin, and report a place nobody knows', () => {
    const e = run([['K', 'constant', { kind: 'text', value: '35.68, 139.76' }], ['M', 'map']], [['K', 'out', 'M', 'in']]);
    expect(Number(e.nodes.get('M')!.outputs.lon?.v)).toBeCloseTo(139.76, 2);
    const bad = run([['G', 'globe', { place: 'Zzyzx Qwerty' }]]);
    expect(bad.nodes.get('G')!.status.level).toBe('error');
  });
  it('can be driven through the Default place setting pin', () => {
    const e = run([['K', 'constant', { kind: 'text', value: 'Sydney' }], ['M', 'map']], [['K', 'out', 'M', 'p:place']]);
    expect(String(e.nodes.get('M')!.outputs.name?.v)).toContain('Sydney');
  });
  it('gives the Projector a Font size setting with its own pin', () => {
    const d = getDef('projector')!;
    expect(d.params.map((p) => p.key)).toContain('fontSize');
    expect(d.paramPins!.map((p) => p.id)).toContain('p:fontSize');
    const e = run([['C', 'constant', { kind: 'number', value: '42' }], ['P', 'projector', { fontSize: 40 }]], [['C', 'out', 'P', 'in']]);
    expect((e.nodes.get('P')!.viewData as any).fontSize).toBe(40);
  });
});

describe('Chinese place names', () => {
  it('translates cities and countries, not only the few hand-made ones', () => {
    setActiveLang('zh-Hans');
    expect(trPlace('Tokyo')).toBe('东京');
    expect(trPlace('Japan')).toBe('日本');
    setActiveLang('zh-Hant');
    expect(trPlace('Japan')).toBe('日本');
    expect(trPlace('Germany')).toBe('德國');
    expect(trIn('zh-Hant', 'inch')).toBe('英吋');
    expect(trIn('zh-Hans', 'inch')).toBe('英寸');
    expect(trIn('zh-Hans', 'Light map')).toBe('浅色地图');
    expect(trIn('zh-Hant', 'Light map')).toBe('淺色地圖');
    expect(trIn('zh-Hans', 'Light')).toBe('灯光');
  });
  it('lists the suggestions in the interface language', () => {
    setActiveLang('zh-Hans');
    expect(cityLabels()).toContain('东京, 日本');
    expect(new Set(cityLabels()).size).toBe(cityLabels().length);
    setActiveLang('zh-Hant');
    expect(cityLabels()).toContain('東京, 日本');
    expect(new Set(cityLabels()).size).toBe(cityLabels().length);
  });
});
