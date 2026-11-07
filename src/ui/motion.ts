// Central motion system. CSS mirrors these tokens as custom properties (see index.css).
export const motion = {
  instant: 80, // press feedback, selection
  micro: 140, // toggles, hover, menu open
  panel: 240, // inspector / library open & close
  settle: 140, // module settling onto the grid
  camera: 360, // focus / fit
  signal: 560, // wire flash decay
  major: 420, // dialogs
  ease: {
    out: 'cubic-bezier(0.2, 0.8, 0.2, 1)',
    inOut: 'cubic-bezier(0.4, 0, 0.2, 1)',
    in: 'cubic-bezier(0.4, 0, 1, 1)',
  },
} as const;

export const easeOutCubic = (t: number) => 1 - Math.pow(1 - t, 3);
export const easeInOutCubic = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

let reduced = false;
export function setReducedMotion(v: boolean) {
  reduced = v;
  document.documentElement.classList.toggle('rm', v);
}
export const isReducedMotion = () => reduced;

/** Resolve the effective setting from the user preference and the OS media query. */
export function applyMotionPreference(pref: 'system' | 'reduced' | 'full') {
  const mq = typeof matchMedia === 'function' ? matchMedia('(prefers-reduced-motion: reduce)') : null;
  setReducedMotion(pref === 'reduced' || (pref === 'system' && !!mq?.matches));
}

/** Frame-synchronised tween. Returns a cancel function. Duration 0 under reduced motion. */
export function tween(duration: number, onFrame: (t: number) => void, ease: (t: number) => number = easeOutCubic, onDone?: () => void): () => void {
  if (reduced || duration <= 0) {
    onFrame(1);
    onDone?.();
    return () => {};
  }
  let raf = 0;
  const t0 = performance.now();
  const loop = (now: number) => {
    const t = Math.min(1, (now - t0) / duration);
    onFrame(ease(t));
    if (t < 1) raf = requestAnimationFrame(loop);
    else onDone?.();
  };
  raf = requestAnimationFrame(loop);
  return () => cancelAnimationFrame(raf);
}
