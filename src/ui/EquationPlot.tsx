import type { Plot } from '../core/equation';
import { tr } from '../i18n';
import { niceTicks } from '../core/equation';
import { fmtNum } from '../core/util';

/** Curve colours: the first is the Meter's white, the rest are the environment's family accents. */
export const CURVE_COLORS = ['#ffffff', '#2fd9cf', '#ffc933', '#ff8a50', '#a259ff', '#3ddc97', '#6fd3ee', '#ff5f8f'];
/** Axis lines are deliberately dim: they orient the eye without competing with the curves. */
const AXIS = '#8a8a8a';
const AXIS_OPACITY = 0.5;

function pathFor(ys: (number | null)[], plot: Plot, X: (x: number) => number, Y: (y: number) => number): string {
  const n = ys.length, span = plot.yMax - plot.yMin;
  const lo = plot.yMin - span, hi = plot.yMax + span;
  const clampY = (y: number) => Math.max(plot.yMin - 8 * span, Math.min(plot.yMax + 8 * span, y));
  let d = '';
  let prev: number | null = null;
  for (let i = 0; i < n; i++) {
    const y = ys[i];
    if (y === null) { prev = null; continue; }
    const x = plot.xMin + ((plot.xMax - plot.xMin) * i) / (n - 1);
    // Lift the pen across asymptotes (e.g. tan, 1/x) instead of drawing a vertical streak.
    const jump = prev !== null && Math.abs(y - prev) > 2 * span && (y < lo || y > hi || prev < lo || prev > hi);
    d += `${prev === null || jump ? 'M' : 'L'}${X(x).toFixed(2)} ${Y(clampY(y)).toFixed(2)}`;
    prev = y;
  }
  return d;
}

/**
 * The graph of one or more equations. `detail` adds ticks, tick labels and a frame for the full-size view;
 * the compact version drawn inside a node shows just the curves on dimmed gray axes.
 */
export function EquationPlot({ plot, detail = false, className }: { plot: Plot; detail?: boolean; className?: string }) {
  const W = detail ? 720 : 120, H = detail ? 440 : 88;
  const pad = detail ? { l: 52, r: 16, t: 14, b: 30 } : { l: 2, r: 2, t: 3, b: 3 };
  const iw = W - pad.l - pad.r, ih = H - pad.t - pad.b;
  const X = (x: number) => pad.l + ((x - plot.xMin) / (plot.xMax - plot.xMin)) * iw;
  const Y = (y: number) => pad.t + (1 - (y - plot.yMin) / (plot.yMax - plot.yMin)) * ih;
  const xAxis = plot.yMin < 0 && plot.yMax > 0;
  const yAxis = plot.xMin < 0 && plot.xMax > 0;
  const xt = detail ? niceTicks(plot.xMin, plot.xMax, 8) : [];
  const yt = detail ? niceTicks(plot.yMin, plot.yMax, 6) : [];
  const fs = 11;
  const title = `${plot.curves.map((c) => c.expr).join(' ; ')}  ·  x ∈ [${fmtNum(plot.xMin)}, ${fmtNum(plot.xMax)}]  ·  y ∈ [${fmtNum(plot.yMin, 2)}, ${fmtNum(plot.yMax, 2)}]`;
  const clipId = `plotclip-${detail ? 'd' : 'n'}`;
  const axisProps = { stroke: AXIS, strokeOpacity: AXIS_OPACITY, strokeWidth: 1, vectorEffect: 'non-scaling-stroke' as const };

  return (
    <svg className={className ?? 'art eqplot'} viewBox={`0 0 ${W} ${H}`} preserveAspectRatio={detail ? 'xMidYMid meet' : 'none'} role="img" aria-label={tr('Graph of {title}', { title })}>
      <title>{title}</title>
      <defs><clipPath id={clipId}><rect x={pad.l} y={pad.t} width={iw} height={ih} /></clipPath></defs>
      {detail && <rect x={pad.l} y={pad.t} width={iw} height={ih} fill="none" stroke={AXIS} strokeOpacity={0.18} />}
      {detail && xt.map((v) => <g key={`x${v}`}><line x1={X(v)} x2={X(v)} y1={pad.t + ih} y2={pad.t + ih + 4} {...axisProps} /><text x={X(v)} y={pad.t + ih + 18} fontSize={fs} fill={AXIS} textAnchor="middle" opacity={0.85}>{fmtNum(v, 2)}</text></g>)}
      {detail && yt.map((v) => <g key={`y${v}`}><line x1={pad.l - 4} x2={pad.l} y1={Y(v)} y2={Y(v)} {...axisProps} /><text x={pad.l - 8} y={Y(v) + 4} fontSize={fs} fill={AXIS} textAnchor="end" opacity={0.85}>{fmtNum(v, 2)}</text></g>)}
      {xAxis && <line className="eq-axis" x1={pad.l} x2={pad.l + iw} y1={Y(0)} y2={Y(0)} {...axisProps} />}
      {yAxis && <line className="eq-axis" x1={X(0)} x2={X(0)} y1={pad.t} y2={pad.t + ih} {...axisProps} />}
      <g clipPath={`url(#${clipId})`}>
        {plot.curves.map((c, i) => (
          <path key={i} d={pathFor(c.ys, plot, X, Y)} fill="none" stroke={CURVE_COLORS[i % CURVE_COLORS.length]} strokeWidth={detail ? 2 : 1.4} vectorEffect="non-scaling-stroke" strokeLinejoin="round" strokeLinecap="round" />
        ))}
      </g>
    </svg>
  );
}
