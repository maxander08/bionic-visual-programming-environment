// Full-size windows for the Meter, Image, Map and Globe, opened from the expand button on the node just like the Projector's. Each opens on
// the node's runtime id (the dialog argument) and follows it while the program runs. Every window has the same “full screen” button as the
// Projector's, which takes the browser itself to full screen.
import { useMemo, type ReactNode } from 'react';
import type { Plot } from '../core/equation';
import { fmtCoords, placeLabel, type Place } from '../core/geo';
import { fmtNum, isImage, unitFraction } from '../core/util';
import { engine, useNodeVer } from '../runtime/session';
import { useStore } from '../state/store';
import { getLang, tr } from '../i18n';
import { CURVE_COLORS, EquationPlot } from './EquationPlot';
import { Icon } from './icons';
import { Modal } from './Modal';
import { ImageCanvas } from './NodeView';
import { GlobeView, MapView } from './PlaceViews';

const toast = (m: string, k: 'ok' | 'info' | 'error' = 'ok') => useStore.getState().toast(m, k);

/** A big window with the Projector's full-screen button. */
export function FullWindow({ title, label, onClose, children, actions }: { title: string; label: string; onClose: () => void; children: ReactNode; actions?: ReactNode }) {
  const fullscreen = () => {
    const el = document.querySelector<HTMLElement>('.modal.full');
    if (document.fullscreenElement) void document.exitFullscreen();
    else void el?.requestFullscreen?.().catch(() => toast(tr('This browser wouldn’t go full screen.'), 'info'));
  };
  return (
    <Modal title={title} onClose={onClose} full label={label}
      actions={<>{actions}<button type="button" className="icon-btn" aria-label={tr('Toggle full screen')} title={tr('Toggle full screen')} onClick={fullscreen}><Icon name="fit" size={16} /></button></>}>
      {children}
    </Modal>
  );
}

const useNode = () => {
  const rid = useStore((s) => s.ui.arg) as string;
  useNodeVer(rid);
  const n = engine.nodes.get(rid);
  return { view: (n?.viewData ?? {}) as Record<string, any>, params: (n?.live ?? {}) as Record<string, any>, running: useStore.getState().run !== 'stopped' };
};

// ---- Image ---------------------------------------------------------------------------------------------------------------------

export function ImageWindow({ onClose }: { onClose: () => void }) {
  const { view } = useNode();
  const img = view.image;
  return (
    <FullWindow title={tr('Image')} label={tr('Image, full size')} onClose={onClose}>
      <div className="pw-col">
        <div className="pw-bar"><span className="pw-meta">{isImage(img) ? `${img.w} × ${img.h} px` : tr('No image yet')}</span></div>
        <div className="pw-stage">
          {isImage(img) ? <div className="pw-img"><ImageCanvas img={img} /></div> : <div className="pw-empty"><p>{tr('Nothing has arrived at this Image Display yet.')}</p></div>}
        </div>
      </div>
    </FullWindow>
  );
}

// ---- Meter ---------------------------------------------------------------------------------------------------------------------

const HISTORY = { W: 800, H: 380, L: 64, B: 28, T: 12, R: 14 };

/** Geometry shared by the full-size history view and its regression tests. Also keeps ranges spanning ±1e308 finite. */
export function historyGeometry(hist: number[], auto: boolean) {
  const { W, H, L, B, T, R } = HISTORY;
  if (!hist.length) return { ticks: [] as { value: number; y: number }[], points: [] as { x: number; y: number }[] };
  let lo = 0, hi = 1;
  if (auto) { lo = Math.min(...hist); hi = Math.max(...hist); }
  const flat = auto && (lo === hi || hi - lo < 1e-9);
  if (flat) { lo -= 0.5; hi += 0.5; }
  const span = hi - lo;
  const scale = Math.max(Math.abs(lo), Math.abs(hi), 1);
  const valueAt = (f: number) => Number.isFinite(span) ? lo + span * f : (lo / scale + (hi / scale - lo / scale) * f) * scale;
  const y = (v: number) => T + (flat ? 0.5 : 1 - unitFraction(v, lo, hi)) * (H - T - B);
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => {
    const value = valueAt(f);
    return { value, y: flat ? T + (1 - f) * (H - T - B) : y(value) };
  });
  const points = hist.map((v, i) => ({ x: L + (hist.length < 2 ? 0 : (i / (hist.length - 1)) * (W - L - R)), y: y(v) }));
  return { ticks, points };
}

function History({ hist, auto }: { hist: number[]; auto: boolean }) {
  const { W, H, L, R } = HISTORY;
  const { ticks, points } = historyGeometry(hist, auto);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={tr('History of the signal')} className="meter-hist">
      {ticks.map(({ value, y }, i) => <g key={i}><line x1={L} x2={W - R} y1={y} y2={y} stroke="#fff" strokeOpacity={i === 0 || i === 4 ? 0.28 : 0.12} /><text x={L - 8} y={y + 4} textAnchor="end" fontSize="12" fill="#fff" fillOpacity="0.7">{fmtNum(value, 3)}</text></g>)}
      <text x={L} y={H - 8} fontSize="12" fill="#fff" fillOpacity="0.55">{tr('oldest')}</text>
      <text x={W - R} y={H - 8} fontSize="12" textAnchor="end" fill="#fff" fillOpacity="0.55">{tr('latest')}</text>
      {points.length > 1 && <polyline points={points.map(({ x, y }) => `${x},${y}`).join(' ')} fill="none" stroke="#fff" strokeWidth="1.8" strokeLinejoin="round" />}
      {points.length > 0 && <circle cx={points[points.length - 1].x} cy={points[points.length - 1].y} r="4" fill="#fff" />}
    </svg>
  );
}

export function MeterWindow({ onClose }: { onClose: () => void }) {
  const { view, params, running } = useNode();
  const plot = view.plot as Plot | undefined;
  const hist = view.hist as number[] | undefined;
  const stats = useMemo(() => (hist && hist.length ? { last: hist[hist.length - 1], min: Math.min(...hist), max: Math.max(...hist), n: hist.length } : null), [hist]);
  return (
    <FullWindow title={tr('Graph')} label={tr('Meter, full size')} onClose={onClose}>
      <div className="pw-col">
        <div className="graph-full" aria-live="polite" style={{ flex: '1 1 auto', minHeight: 0 }}>
          {plot ? <EquationPlot plot={plot} detail />
            : stats ? <History hist={hist!} auto={params.auto !== false} />
            : <p className="muted">{running ? tr('Nothing has arrived at this Meter yet.') : tr('Press Run to see what this Meter receives.')}</p>}
        </div>
        {plot && (
          <ul className="graph-legend">
            {plot.curves.map((c, i) => <li key={i}><i style={{ background: CURVE_COLORS[i % CURVE_COLORS.length] }} /><code>{c.expr}</code></li>)}
            <li className="muted">x ∈ [{fmtNum(plot.xMin)}, {fmtNum(plot.xMax)}] · y ∈ [{fmtNum(plot.yMin, 3)}, {fmtNum(plot.yMax, 3)}]{plot.usesT ? ` · t = ${fmtNum(plot.t, 2)} s` : ''}</li>
          </ul>
        )}
        {stats && !plot && (
          <ul className="graph-legend">
            <li>{tr('Latest')} <code>{String(view.lastText ?? fmtNum(stats.last, 6))}</code></li>
            <li>{tr('Lowest')} <code>{fmtNum(stats.min, 6)}</code></li>
            <li>{tr('Highest')} <code>{fmtNum(stats.max, 6)}</code></li>
            <li className="muted">{tr('{n} samples', { n: stats.n })}</li>
          </ul>
        )}
      </div>
    </FullWindow>
  );
}

// ---- Map and Globe -------------------------------------------------------------------------------------------------------------

export function PlaceWindow({ kind, onClose }: { kind: 'map' | 'globe'; onClose: () => void }) {
  const { view, params, running } = useNode();
  const place = view.place as Place | undefined;
  const copy = async () => {
    if (!place) return;
    try { await navigator.clipboard.writeText(`${place.lat.toFixed(6)}, ${place.lon.toFixed(6)}`); toast(tr('Copied.')); } catch { toast(tr('Clipboard is blocked here. Select the text and press Ctrl/⌘+C.'), 'info'); }
  };
  return (
    <FullWindow title={kind === 'map' ? tr('Map') : tr('Globe')} label={kind === 'map' ? tr('Map, full size') : tr('Globe, full size')} onClose={onClose}>
      <div className="pw-col">
        <div className="pw-bar">
          <span className="pw-meta" aria-live="polite">{place ? `${placeLabel(place, getLang())} · ${fmtCoords(place.lat, place.lon)}` : view.state === 'loading' ? tr('Looking up the place…') : running ? tr('No place to show yet.') : tr('Press Run to show a place.')}</span>
          <span className="pw-spacer" />
          {place && <button type="button" className="btn sm" onClick={copy}><Icon name="copy" size={13} />{tr('Copy coordinates')}</button>}
        </div>
        <div className="pw-stage place-stage">
          {kind === 'map'
            ? <MapView interactive place={place} fit={params.fit !== false} zoom={Number(params.zoom) || 16} marker={params.marker !== false} style={String(params.style ?? 'dark')} />
            : <GlobeView interactive place={place} borders={params.borders !== false} grid={params.grid !== false} marker={params.marker !== false} spin={params.spin === true} />}
        </div>
      </div>
    </FullWindow>
  );
}
