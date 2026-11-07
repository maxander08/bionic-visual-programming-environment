// Lightweight shared view-state for the main canvas (read by the minimap and zoom label without re-rendering the canvas).
export const mainView = { x: 0, y: 0, k: 1, w: 800, h: 600 };
const subs = new Set<() => void>();
export const subscribeView = (cb: () => void) => (subs.add(cb), () => void subs.delete(cb));
export const emitView = () => subs.forEach((f) => f());
export const viewZoomPct = () => Math.round(mainView.k * 100);
