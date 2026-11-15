// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { Inspector } from './Inspector';
import { NodeView, PreviewNode } from './NodeView';
import { getDef } from '../core/registry';
import { useStore } from '../state/store';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

function mount() {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  return {
    host,
    render: () => act(async () => { root.render(<Inspector />); }),
    unmount: () => act(async () => { root.unmount(); host.remove(); }),
  };
}

describe('Inspector DurationField', () => {
  it('links label htmlFor to the text input and reformats live on language switch', async () => {
    const st = useStore.getState();
    await act(async () => {
      st.setSettings({ language: 'en' });
      st.newBlank();
      const id = st.addNodeAt('timer', 100, 100)!;
      st.select([id]);
    });
    const m = mount();
    await m.render();
    try {
      const label = m.host.querySelector('label[for="f-duration"]');
      const input = m.host.querySelector<HTMLInputElement>('input#f-duration');
      expect(label).not.toBeNull();
      expect(input).not.toBeNull();
      expect(input!.value).toBe('1 min');

      await act(async () => { useStore.getState().setSettings({ language: 'zh-Hans' }); });
      expect(input!.value).toBe('1 分钟');

      await act(async () => { useStore.getState().setSettings({ language: 'zh-Hant' }); });
      expect(input!.value).toBe('1 分鐘');

      await act(async () => { useStore.getState().setSettings({ language: 'en' }); });
      expect(input!.value).toBe('1 min');
    } finally {
      await m.unmount();
    }
  });

  it('filters quick-adjust nudges to parameter max and disables buttons at range bounds', async () => {
    const st = useStore.getState();
    await act(async () => {
      st.setSettings({ language: 'en' });
      st.newBlank();
      const id = st.addNodeAt('haptic', 100, 100)!; // min: 5 ms, max: 1000 ms
      st.select([id]);
    });
    const m = mount();
    await m.render();
    try {
      const chips = [...m.host.querySelectorAll<HTMLButtonElement>('.dur-chips button')];
      const labels = chips.map((b) => b.textContent);
      expect(labels).toEqual(['+10 ms', '+100 ms', '+1 s', 'Clear']);
      expect(labels).not.toContain('+10 s');
      expect(labels).not.toContain('+1 min');

      // Click Clear → reaches min (5 ms), Clear disables.
      await act(async () => { chips[chips.length - 1].click(); });
      expect(m.host.querySelector<HTMLInputElement>('input#f-ms')!.value).toBe('5 ms');
      expect(chips[chips.length - 1].disabled).toBe(true);

      // Click +1 s → clamps to max (1 s), + buttons disable.
      await act(async () => { chips[2].click(); });
      expect(m.host.querySelector<HTMLInputElement>('input#f-ms')!.value).toBe('1 s');
      expect(chips[0].disabled).toBe(true);
      expect(chips[2].disabled).toBe(true);
      expect(chips[chips.length - 1].disabled).toBe(false);
    } finally {
      await m.unmount();
    }
  });

  it('shows clean readable metadata for qty-time without float64 remainder noise', async () => {
    const st = useStore.getState();
    await act(async () => {
      st.setSettings({ language: 'en' });
      st.newBlank();
      const id = st.addNodeAt('qty-time', 100, 100)!;
      st.select([id]);
    });
    const m = mount();
    await m.render();
    try {
      const meta = m.host.querySelector('.field .doc .meta')?.textContent ?? '';
      expect(meta).toContain('Range 0 s to 1e+40 s');
      expect(meta).not.toContain('1.1574');
    } finally {
      await m.unmount();
    }
  });
});

function renderEl(el: React.ReactElement) {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  const mount = () => act(async () => { root.render(el); });
  const unmount = () => act(async () => { root.unmount(); host.remove(); });
  return { host, mount, unmount };
}

function qtySpans(host: HTMLElement): [string, string][] {
  return [...host.querySelectorAll('.qty-val > span')].map((s) => [s.className, s.textContent ?? '']);
}

describe('QuantityFace number/unit coloring', () => {
  it('colors every number as .qa and every unit as .qu in English and Chinese compound times', async () => {
    const st = useStore.getState();
    let id = '';
    await act(async () => {
      st.setSettings({ language: 'en' });
      st.newBlank();
      id = st.addNodeAt('qty-time', 100, 100)!;
      st.setNodeParams(id, { span: 71 }); // 1min 11s
    });
    const node = () => useStore.getState().project.graph.nodes[id];
    const def = getDef('qty-time', undefined, node().params)!;
    const r = renderEl(<NodeView node={node()} def={def} selected={false} conn="" prefix="" ro={false} />);
    await r.mount();
    try {
      expect(qtySpans(r.host)).toEqual([
        ['qa', '1'], ['qu', 'min '], ['qa', '11'], ['qu', 's'],
      ]);

      await act(async () => { useStore.getState().setNodeParams(id, { span: 9600 }); }); // 2h 40min
      const r2 = renderEl(<NodeView node={node()} def={def} selected={false} conn="" prefix="" ro={false} />);
      await r2.mount();
      try {
        expect(qtySpans(r2.host)).toEqual([
          ['qa', '2'], ['qu', 'h '], ['qa', '40'], ['qu', 'min'],
        ]);

        await act(async () => { useStore.getState().setSettings({ language: 'zh-Hans' }); });
        expect(qtySpans(r2.host)).toEqual([
          ['qa', '2'], ['qu', '小时 '], ['qa', '40'], ['qu', '分钟'],
        ]);
        expect(r2.host.querySelector('.qty-val')?.className).toContain('n2');

        await act(async () => { useStore.getState().setSettings({ language: 'zh-Hant' }); });
        expect(qtySpans(r2.host)).toEqual([
          ['qa', '2'], ['qu', '小時 '], ['qa', '40'], ['qu', '分鐘'],
        ]);
      } finally {
        await r2.unmount();
      }
    } finally {
      await act(async () => { useStore.getState().setSettings({ language: 'en' }); });
      await r.unmount();
    }
  });

  it('keeps scientific notation (both e and × 10^n) in .qa and preserves standard units in .qu', async () => {
    const st = useStore.getState();
    let nfId = '', tempId = '', energyId = '', badNfId = '';
    await act(async () => {
      st.setSettings({ language: 'en' });
      st.newBlank();
      nfId = st.addNodeAt('actor-numfmt', 0, 0)!;
      st.setNodeParams(nfId, { value: '-0.0001235', mode: 'sci', n: 4, style: 'x10' });
      badNfId = st.addNodeAt('actor-numfmt', 0, 120)!;
      st.setNodeParams(badNfId, { value: 'abc', mode: 'places', n: 2 });
      tempId = st.addNodeAt('qty-temperature', 160, 0)!;
      st.setNodeParams(tempId, { amount: -273.15, prefix: 'none', unit: '°C' });
      energyId = st.addNodeAt('qty-energy', 320, 0)!;
      st.setNodeParams(energyId, { amount: 1, prefix: 'none', unit: 'eV' });
    });
    const nodes = useStore.getState().project.graph.nodes;
    for (const [id, expected] of [
      [nfId, [['qa', '-1.235 × 10⁻⁴']]],
      [badNfId, [['qa', 'abc']]],
      [tempId, [['qa', '-273.15'], ['qu', '°C']]],
      [energyId, [['qa', '1'], ['qu', 'eV']]],
    ] as [string, [string, string][]][]) {
      const n = nodes[id];
      const def = getDef(n.type, undefined, n.params)!;
      const r = renderEl(<NodeView node={n} def={def} selected={false} conn="" prefix="" ro={false} />);
      await r.mount();
      try {
        expect(qtySpans(r.host)).toEqual(expected);
      } finally {
        await r.unmount();
      }
    }
  });

  it('localizes qty-time PreviewNode in Chinese while coloring number and unit separately', async () => {
    const def = getDef('qty-time')!;
    await act(async () => { useStore.getState().setSettings({ language: 'zh-Hans' }); });
    const r = renderEl(<PreviewNode def={def} />);
    await r.mount();
    try {
      expect(qtySpans(r.host)).toEqual([['qa', '1'], ['qu', '秒']]);
    } finally {
      await act(async () => { useStore.getState().setSettings({ language: 'en' }); });
      await r.unmount();
    }
  });
});
