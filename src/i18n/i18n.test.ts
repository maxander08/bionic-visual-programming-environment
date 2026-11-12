import { afterEach, describe, expect, it } from 'vitest';
import { Engine } from '../core/engine';
import { addNode, connect, emptyGraph, flatten } from '../core/graph';
import { CATEGORIES, MODULES, getDef, localizedModules } from '../core/registry';
import type { Graph, Params } from '../core/types';
import { LANGS, detectLang, getLang, normalizeLang, setActiveLang, tr, trIn } from './index';
import { zhHans } from './zh-Hans';
import { zhHant } from './zh-Hant';

afterEach(() => setActiveLang('en'));

function run(spec: { nodes: [string, string, Params?][]; wires?: [string, string, string, string][] }, ms = 300) {
  let g: Graph = emptyGraph();
  spec.nodes.forEach(([id, type, p], i) => (g = addNode(g, type, i * 300, 0, p ?? {}, undefined, id).graph));
  for (const [a, ap, b, bp] of spec.wires ?? []) g = connect(g, a, ap, b, bp).graph;
  const e = new Engine(50);
  e.load(flatten(g));
  for (let t = 0; t < ms; t += 50) e.step();
  return e;
}

describe('language catalogue', () => {
  it('offers English, Simplified and Traditional Chinese', () => {
    expect(LANGS.map((l) => l.code)).toEqual(['en', 'zh-Hans', 'zh-Hant']);
  });
  it('normalises codes and common aliases', () => {
    expect(normalizeLang('zh-CN')).toBe('zh-Hans');
    expect(normalizeLang('zh_TW')).toBe('zh-Hant');
    expect(normalizeLang('zh-HK')).toBe('zh-Hant');
    expect(normalizeLang('en-GB')).toBe('en');
    expect(normalizeLang('fr')).toBeNull();
    expect(normalizeLang(5)).toBeNull();
    expect(detectLang()).toMatch(/^(en|zh-Hans|zh-Hant)$/);
  });
});

describe('translation', () => {
  it('falls back to English for unknown text and fills placeholders', () => {
    setActiveLang('zh-Hans');
    expect(tr('this sentence has no translation')).toBe('this sentence has no translation');
    expect(tr('{n} modules selected', { n: 3 })).toBe('已选中 3 个模块');
    expect(getLang()).toBe('zh-Hans');
  });
  it('translates in Simplified and Traditional, and they differ where the scripts differ', () => {
    expect(trIn('zh-Hans', 'Settings')).toBe('设置');
    expect(trIn('zh-Hant', 'Settings')).toBe('設定');
    expect(trIn('zh-Hans', 'Run')).toBe('运行');
    expect(trIn('zh-Hant', 'Run')).toBe('執行');
    expect(trIn('zh-Hant', 'Mass')).toBe('質量');
    expect(trIn('en', 'Settings')).toBe('Settings');
  });
  it('translates dynamic engine messages through their templates', () => {
    expect(trIn('zh-Hans', 'Output “out” is not a finite number.')).toBe('输出“out”不是有限数值。');
    expect(trIn('zh-Hant', 'Camera error: NotFoundError.')).toContain('NotFoundError');
  });
  it('the two Chinese dictionaries have the same keys', () => {
    expect(Object.keys(zhHant).sort()).toEqual(Object.keys(zhHans).sort());
  });
  it('every placeholder survives translation', () => {
    for (const [k, v] of Object.entries(zhHans)) {
      const a = (k.match(/\{\w+\}/g) ?? []).sort().join();
      const b = (v.match(/\{\w+\}/g) ?? []).sort().join();
      expect(b, k).toBe(a);
    }
  });
});

describe('localised module definitions', () => {
  it('translate every visible label but keep ids, option values and pin ids', () => {
    for (const lang of ['zh-Hans', 'zh-Hant'] as const) {
      setActiveLang(lang);
      for (const m of MODULES) {
        const en = getDef(m.type, undefined, undefined);
        setActiveLang('en');
        const base = getDef(m.type)!;
        setActiveLang(lang);
        expect(en!.inputs.map((p) => p.id), m.type).toEqual(base.inputs.map((p) => p.id));
        expect(en!.outputs.map((p) => p.id), m.type).toEqual(base.outputs.map((p) => p.id));
        en!.params.forEach((p, i) => {
          expect(p.key).toBe(base.params[i].key);
          if (p.kind === 'select') expect(p.options.map((o) => o.value)).toEqual((base.params[i] as any).options.map((o: any) => o.value));
        });
      }
    }
  });
  it('shows Chinese names, settings and choices', () => {
    setActiveLang('zh-Hans');
    const d = getDef('fear')!;
    expect(d.name).toBe('恐惧');
    expect(d.caption).toBe('恐惧中心');
    expect(d.params.find((p) => p.key === 'sensitivity')!.label).toBe('敏感度');
    const w = getDef('wave')!;
    const shape = w.params.find((p) => p.key === 'shape') as any;
    expect(shape.options.map((o: any) => o.label)).toContain('正弦波');
    setActiveLang('zh-Hant');
    expect(getDef('memory')!.caption).toBe('記憶單元');
  });
  it('is the identity in English', () => {
    expect(getDef('fear')!.caption).toBe('Fear Center');
    expect(localizedModules()[0]).toBe(MODULES[0]);
  });
  it('translates setting-pin tooltips', () => {
    setActiveLang('zh-Hans');
    const pin = getDef('random')!.inputs.find((p) => p.id === 'p:min')!;
    expect(pin.label).toBe('最小值');
    expect(pin.doc).toContain('设置“最小值”');
  });
  it('gives most modules a translated summary', () => {
    setActiveLang('zh-Hans');
    const ok = MODULES.filter((m) => getDef(m.type)!.doc.summary !== m.doc.summary).length;
    expect(ok / MODULES.length).toBeGreaterThan(0.9);
  });
});

describe('Set Language module', () => {
  it('lives in its own Workspace Settings category, last in the library', () => {
    expect(CATEGORIES[CATEGORIES.length - 1]).toBe('Workspace Settings');
    expect(MODULES.filter((m) => m.category === 'Workspace Settings').map((m) => m.type)).toEqual(['setlanguage']);
  });
  it('has a setting pin for every setting, plus its Apply input and outputs', () => {
    const d = getDef('setlanguage')!;
    expect(d.paramPins!.map((p) => p.id)).toEqual(['p:language', 'p:mode', 'p:remember', 'p:notice']);
    expect(d.inputs.map((p) => p.id)).toEqual(['apply', 'p:language', 'p:mode', 'p:remember', 'p:notice']);
    expect(d.outputs.map((p) => p.id)).toEqual(['language', 'name', 'applied']);
    const lang = d.params.find((p) => p.key === 'language') as any;
    expect(lang.options.map((o: any) => o.value)).toEqual(['en', 'zh-Hans', 'zh-Hant']);
  });
  it('applies on start in auto mode and reports what it applied', () => {
    const e = run({ nodes: [['L', 'setlanguage', { language: 'zh-Hant', mode: 'auto' }]] });
    const n = e.nodes.get('L')!;
    expect((n.viewData as any).lang).toBe('zh-Hant');
    expect((n.viewData as any).n).toBe(1);
    expect(n.outputs.language?.v).toBe('zh-Hant');
    expect(n.outputs.name?.v).toBe('繁體中文');
  });
  it('in signal mode waits for a truthy Apply', () => {
    const idle = run({ nodes: [['L', 'setlanguage', { language: 'zh-Hans', mode: 'signal' }]] });
    expect((idle.nodes.get('L')!.viewData as any).n).toBe(0);
    const fired = run({
      nodes: [['K', 'constant', { kind: 'bool', value: 'true' }], ['L', 'setlanguage', { language: 'zh-Hans', mode: 'signal' }]],
      wires: [['K', 'out', 'L', 'apply']],
    });
    expect((fired.nodes.get('L')!.viewData as any).n).toBe(1);
  });
  it('can be driven through its Language setting pin', () => {
    const e = run({
      nodes: [['K', 'constant', { kind: 'text', value: 'zh-Hant' }], ['L', 'setlanguage', { language: 'en', mode: 'auto' }]],
      wires: [['K', 'out', 'L', 'p:language']],
    });
    expect((e.nodes.get('L')!.viewData as any).lang).toBe('zh-Hant');
  });
  it('an unknown code on the pin falls back to English', () => {
    const e = run({
      nodes: [['K', 'constant', { kind: 'text', value: 'klingon' }], ['L', 'setlanguage', { language: 'zh-Hans' }]],
      wires: [['K', 'out', 'L', 'p:language']],
    });
    expect((e.nodes.get('L')!.viewData as any).lang).toBe('en');
  });
});
