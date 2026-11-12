import { describe, expect, it } from 'vitest';
import { Engine } from '../core/engine';
import { addNode, emptyGraph, flatten } from '../core/graph';
import { processOutputs, silenceAll } from '../runtime/outputs';
import { useStore } from '../state/store';
import { getLang, tr } from './index';

function engineWith(params: Record<string, unknown>) {
  const g = addNode(emptyGraph(), 'setlanguage', 0, 0, params, undefined, 'L').graph;
  const e = new Engine(50);
  e.load(flatten(g));
  for (let i = 0; i < 4; i++) e.step();
  return e;
}

describe('Set Language at run time', () => {
  it('switches the whole editor and persists only when asked', () => {
    const st = useStore.getState();
    st.setLanguage('en');
    silenceAll();
    processOutputs(engineWith({ language: 'zh-Hans', remember: true, notice: true }), true);
    expect(useStore.getState().settings.language).toBe('zh-Hans');
    expect(getLang()).toBe('zh-Hans');
    expect(tr('Settings')).toBe('设置');
    expect(useStore.getState().toasts.at(-1)?.msg).toBe('语言已设为 简体中文。');

    // Stop → Run: the app calls silenceAll() on Stop
    silenceAll();
    const e = engineWith({ language: 'zh-Hant', remember: false, notice: false });
    processOutputs(e, true);
    expect(getLang()).toBe('zh-Hant');
    useStore.getState().setLanguage('en');
    processOutputs(e, true);
    expect(getLang()).toBe('en');

    // Stop clears the bookkeeping, so the next run applies again
    silenceAll();
    processOutputs(e, true);
    expect(getLang()).toBe('zh-Hant');
    useStore.getState().setLanguage('en');
  });

  it('the Settings dialog path stores the preference as a normal setting', () => {
    useStore.getState().setSettings({ language: 'zh-Hant' });
    expect(getLang()).toBe('zh-Hant');
    expect(tr('Settings')).toBe('設定');
    useStore.getState().setSettings({ language: 'en' });
    expect(tr('Settings')).toBe('Settings');
  });
});
