// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { getDef } from '../core/registry';
import type { NodeInst } from '../core/types';
import { NodeView } from './NodeView';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

/** The labels in the row above the swatch of a Color node that has not run (or whose run failed), so it has no view data to read the model from. */
async function face(model: string, params: Record<string, unknown> = {}) {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  const node = { id: `never-run-${model}`, type: 'color', x: 0, y: 0, params: { model, ...params } } as unknown as NodeInst;
  await act(async () => { root.render(<NodeView node={node} def={getDef('color', undefined, node.params)!} selected={false} conn="" prefix="" ro />); });
  const labels = [...host.querySelectorAll('.hsv > div > span')].map((s) => s.textContent);
  await act(async () => { root.unmount(); host.remove(); });
  return labels;
}

describe('Color face label', () => {
  it('names the chosen color model instead of always showing H S V', async () => {
    expect(await face('hsv')).toEqual(['H', 'S', 'V']);
    expect(await face('cmyk')).toEqual(['C', 'M', 'Y', 'K']);
    expect(await face('pantone')).toEqual(['Pantone']);
    expect(await face('hex')).toEqual(['Hex']);
  });
});
