// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { Inspector } from './Inspector';
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
