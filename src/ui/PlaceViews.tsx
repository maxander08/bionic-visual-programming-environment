// The pictures of the Map and the Globe modules. Both are used twice: small and still on the node, and big and draggable in the
// full-size window (`interactive`).
//   MapView   — OpenStreetMap data drawn in the interface language (VectorMap.tsx), with a pin on the exact spot and the outline of an area laid over it
//               by hand (core/geo.ts has the tile arithmetic). Where WebGL or the vector tiles are not available, plain OpenStreetMap picture tiles are used.
//   GlobeView — a wire-frame globe on a canvas: coastlines and borders as thin white lines on black, the marker, the outline of an area.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { LAND_LINES } from '../core/data/land';
import { MAX_ZOOM, TILE, clamp, fromPixel, orthographic, placeLabel, toPixel, unproject, wrapLon, zoomFor, type Place } from '../core/geo';
import { getLang, tr } from '../i18n';
import { useStore } from '../state/store';
import { VectorMap } from './VectorMap';
import { Icon } from './icons';

function useSize() {
  const ref = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => setSize((s) => (s.w === el.clientWidth && s.h === el.clientHeight ? s : { w: el.clientWidth, h: el.clientHeight }));
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, size] as const;
}

// ---- Map -----------------------------------------------------------------------------------------------------------------------

interface MapProps { place?: Place; fit?: boolean; zoom?: number; marker?: boolean; style?: string; interactive?: boolean }
interface MapState { lat: number; lon: number; z: number }

export function MapView({ place, fit = true, zoom = 16, marker = true, style = 'dark', interactive = false }: MapProps) {
  const [ref, size] = useSize();
  const lang = useStore((s) => s.settings.language);
  // 'vector': the map drawn in the interface language; 'plain': OpenStreetMap picture tiles, used when the vector map cannot start.
  const [base, setBase] = useState<'vector' | 'plain'>('vector');
  const [drawn, setDrawn] = useState(false);
  const sized = size.w > 0 && size.h > 0;
  // A vector map that has not drawn after this long (the tile server does not answer, the browser cannot start it) gives way to the plain tiles.
  useEffect(() => {
    if (base !== 'vector' || drawn || !sized) return;
    const t = setTimeout(() => setBase('plain'), 20000);
    return () => clearTimeout(t);
  }, [base, drawn, sized]);
  const home = useMemo<MapState | null>(() => {
    if (!place || !sized) return null;
    const b = place.bbox;
    const centre = place.outline ? { lat: (b[0] + b[2]) / 2, lon: (b[1] + b[3]) / 2 } : place;
    return { lat: centre.lat, lon: centre.lon, z: zoomFor(place, fit, zoom, size.w, size.h) };
  }, [place, fit, zoom, sized, size.w, size.h]);
  const [moved, setMoved] = useState<{ home: MapState | null; v: MapState } | null>(null);
  const v = moved && moved.home === home ? moved.v : home; // a new place (or setting) puts the view back on it
  const set = (n: MapState) => setMoved({ home, v: n });
  const drag = useRef<{ x: number; y: number; px: number; py: number } | null>(null);

  const tiles: { key: string; src: string; left: number; top: number }[] = [];
  let pin: { x: number; y: number } | null = null;
  let rings: string[] = [];
  let ox = 0, oy = 0;
  if (v && sized) {
    const c = toPixel(v.lat, v.lon, v.z);
    ox = c.x - size.w / 2; oy = c.y - size.h / 2;
    const n = 2 ** v.z;
    for (let ty = Math.floor(oy / TILE); ty <= Math.floor((oy + size.h) / TILE); ty++) {
      if (ty < 0 || ty >= n) continue;
      for (let tx = Math.floor(ox / TILE); tx <= Math.floor((ox + size.w) / TILE); tx++) {
        const wx = ((tx % n) + n) % n;
        tiles.push({ key: `${v.z}/${tx}/${ty}`, src: `https://tile.openstreetmap.org/${v.z}/${wx}/${ty}.png`, left: tx * TILE - ox, top: ty * TILE - oy });
      }
    }
    if (place) {
      const p = toPixel(place.lat, place.lon, v.z);
      pin = { x: p.x - ox, y: p.y - oy };
      rings = (place.outline ?? []).map((r) => 'M' + r.map(([lo, la]) => { const q = toPixel(la, lo, v.z); return `${(q.x - ox).toFixed(1)} ${(q.y - oy).toFixed(1)}`; }).join('L') + 'Z');
    }
  }

  const zoomBy = (dz: number, cx = size.w / 2, cy = size.h / 2) => {
    if (!v) return;
    const z = clamp(v.z + dz, 1, MAX_ZOOM);
    if (z === v.z) return;
    const under = fromPixel(ox + cx, oy + cy, v.z);
    const u = toPixel(under.lat, under.lon, z);
    const c = fromPixel(u.x - (cx - size.w / 2), u.y - (cy - size.h / 2), z);
    set({ lat: clamp(c.lat, -85, 85), lon: wrapLon(c.lon), z });
  };
  const wheel = useRef(zoomBy);
  wheel.current = zoomBy;
  useEffect(() => {
    const el = ref.current;
    if (!el || !interactive) return;
    let acc = 0;
    const h = (e: WheelEvent) => {
      e.preventDefault();
      acc += e.deltaY;
      if (Math.abs(acc) < 40) return;
      const r = el.getBoundingClientRect();
      wheel.current(acc < 0 ? 1 : -1, e.clientX - r.left, e.clientY - r.top);
      acc = 0;
    };
    el.addEventListener('wheel', h, { passive: false });
    return () => el.removeEventListener('wheel', h);
  }, [interactive, ref]);

  return (
    <div ref={ref} className={`mapv ${style === 'light' ? 'light' : 'dark'} ${interactive ? 'live' : ''}`}
      {...(interactive ? {
        onPointerDown: (e: React.PointerEvent<HTMLDivElement>) => { if ((e.target as HTMLElement).closest('.place-ctl, .mapv-credit')) return; e.currentTarget.setPointerCapture(e.pointerId); if (v) drag.current = { x: e.clientX, y: e.clientY, px: toPixel(v.lat, v.lon, v.z).x, py: toPixel(v.lat, v.lon, v.z).y }; },
        onPointerMove: (e: React.PointerEvent<HTMLDivElement>) => { const d = drag.current; if (!d || !v) return; const c = fromPixel(d.px - (e.clientX - d.x), d.py - (e.clientY - d.y), v.z); set({ lat: clamp(c.lat, -85, 85), lon: wrapLon(c.lon), z: v.z }); },
        onPointerUp: () => { drag.current = null; }, onPointerCancel: () => { drag.current = null; },
        onDoubleClick: (e: React.MouseEvent<HTMLDivElement>) => { const r = e.currentTarget.getBoundingClientRect(); zoomBy(1, e.clientX - r.left, e.clientY - r.top); },
      } : {})}>
      <div className={`mapv-tiles ${base === 'vector' && drawn ? 'drawn' : ''}`}>
        {base === 'vector' && v && sized && <VectorMap view={v} w={size.w} h={size.h} lang={lang} onReady={() => setDrawn(true)} onFail={() => setBase('plain')} />}
        {base === 'plain' && tiles.map((t) => <img key={t.key} src={t.src} alt="" draggable={false} decoding="async" referrerPolicy="origin" style={{ left: t.left, top: t.top }} />)}
      </div>
      {sized && (rings.length > 0 || pin) && (
        <svg className="mapv-over" width={size.w} height={size.h} aria-hidden="true">
          {rings.map((d, i) => <path key={i} d={d} className="mapv-area" />)}
          {pin && marker && (
            <g transform={`translate(${pin.x} ${pin.y})`}>
              <circle r="4" className="mapv-spot" />
              <path d="M0 0C-6 -8 -8.5 -12 -8.5 -16a8.5 8.5 0 1 1 17 0c0 4 -2.5 8 -8.5 16z" className="mapv-pin" />
              <circle cy="-16" r="3" className="mapv-pin-dot" />
            </g>
          )}
        </svg>
      )}
      <span className="mapv-credit">
        {interactive
          ? <><a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">© OpenStreetMap contributors</a>{base === 'vector' && <> · <a href="https://openfreemap.org" target="_blank" rel="noreferrer">OpenFreeMap</a> © <a href="https://www.openmaptiles.org/" target="_blank" rel="noreferrer">OpenMapTiles</a></>}</>
          : base === 'vector' ? '© OpenStreetMap contributors · OpenFreeMap · © OpenMapTiles' : '© OpenStreetMap contributors'}
      </span>
      {interactive && (
        <div className="place-ctls">
          <button type="button" className="place-ctl" aria-label={tr('Zoom in')} title={tr('Zoom in')} disabled={!v || v.z >= MAX_ZOOM} onClick={() => zoomBy(1)}><Icon name="plus" size={15} /></button>
          <button type="button" className="place-ctl" aria-label={tr('Zoom out')} title={tr('Zoom out')} disabled={!v || v.z <= 1} onClick={() => zoomBy(-1)}><Icon name="minus" size={15} /></button>
          <button type="button" className="place-ctl" aria-label={tr('Back to the place')} title={tr('Back to the place')} disabled={!home} onClick={() => setMoved(null)}><Icon name="focus" size={15} /></button>
        </div>
      )}
    </div>
  );
}

// ---- Globe ---------------------------------------------------------------------------------------------------------------------

interface GlobeProps { place?: Place; borders?: boolean; grid?: boolean; marker?: boolean; spin?: boolean; interactive?: boolean }
interface Facing { lat: number; lon: number; k: number }

const INK = '255,255,255';

function drawGlobe(cv: HTMLCanvasElement, w: number, h: number, f: Facing, o: GlobeProps, t: number) {
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(h * dpr)) { cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr); }
  const g = cv.getContext('2d');
  if (!g) return;
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.clearRect(0, 0, w, h);
  const R = (Math.min(w, h) / 2 - 3) * f.k, cx = w / 2, cy = h / 2;
  const P = (lat: number, lon: number) => { const q = orthographic(lat, lon, f.lat, f.lon); return { x: cx + q.x * R, y: cy - q.y * R, z: q.z }; };
  g.lineJoin = 'round';
  g.lineCap = 'round';
  // the sphere
  g.beginPath(); g.arc(cx, cy, R, 0, Math.PI * 2); g.fillStyle = '#000'; g.fill();
  g.save();
  g.beginPath(); g.arc(cx, cy, R, 0, Math.PI * 2); g.clip();
  const path = (pts: [number, number][], close = false) => {
    g.beginPath();
    let pen = false, first: { x: number; y: number } | null = null;
    for (const [lo, la] of pts) {
      const p = P(la, lo);
      if (p.z > 0) { if (pen) g.lineTo(p.x, p.y); else { g.moveTo(p.x, p.y); pen = true; first = first ?? p; } } else pen = false;
    }
    if (close && pen && first) g.closePath();
  };
  if (o.grid !== false) {
    g.strokeStyle = `rgba(${INK},0.16)`; g.lineWidth = 0.8;
    for (let lat = -60; lat <= 60; lat += 30) { const pts: [number, number][] = []; for (let lo = -180; lo <= 180; lo += 5) pts.push([lo, lat]); path(pts); g.stroke(); }
    for (let lon = -180; lon < 180; lon += 30) { const pts: [number, number][] = []; for (let la = -90; la <= 90; la += 5) pts.push([lon, la]); path(pts); g.stroke(); }
  }
  const lines = (kind: number) => {
    g.beginPath();
    for (const l of LAND_LINES) {
      if (l[0] !== kind) continue;
      let pen = false;
      for (let i = 1; i < l.length; i += 2) {
        const p = P(l[i + 1], l[i]);
        if (p.z > 0) { if (pen) g.lineTo(p.x, p.y); else { g.moveTo(p.x, p.y); pen = true; } } else pen = false;
      }
    }
  };
  if (o.borders !== false) { lines(1); g.strokeStyle = `rgba(${INK},0.32)`; g.lineWidth = 0.7; g.stroke(); }
  lines(0); g.strokeStyle = `rgba(${INK},0.92)`; g.lineWidth = 1.1; g.stroke();
  // the place: the outline of an area, then the marker
  const pl = o.place;
  if (pl && o.marker !== false) {
    if (pl.outline) { g.strokeStyle = '#fff'; g.lineWidth = 1.6; g.fillStyle = `rgba(${INK},0.22)`; for (const r of pl.outline) { path(r, true); g.fill(); g.stroke(); } }
  }
  g.restore();
  g.beginPath(); g.arc(cx, cy, R, 0, Math.PI * 2); g.strokeStyle = `rgba(${INK},0.95)`; g.lineWidth = 1.4; g.stroke();
  if (pl && o.marker !== false) {
    const p = P(pl.lat, pl.lon);
    if (p.z > 0) {
      const pulse = (t % 2400) / 2400;
      g.strokeStyle = `rgba(${INK},${0.8 * (1 - pulse)})`; g.lineWidth = 1.3;
      g.beginPath(); g.arc(p.x, p.y, 4 + pulse * 12, 0, Math.PI * 2); g.stroke();
      g.strokeStyle = '#fff'; g.lineWidth = 1.2;
      g.beginPath(); g.moveTo(p.x - 11, p.y); g.lineTo(p.x - 5, p.y); g.moveTo(p.x + 5, p.y); g.lineTo(p.x + 11, p.y); g.moveTo(p.x, p.y - 11); g.lineTo(p.x, p.y - 5); g.moveTo(p.x, p.y + 5); g.lineTo(p.x, p.y + 11); g.stroke();
      g.beginPath(); g.arc(p.x, p.y, 3, 0, Math.PI * 2); g.fillStyle = '#fff'; g.fill(); g.strokeStyle = '#000'; g.lineWidth = 1; g.stroke();
    }
  }
}

export function GlobeView({ place, borders = true, grid = true, marker = true, spin = false, interactive = false }: GlobeProps) {
  const [ref, size] = useSize();
  const cv = useRef<HTMLCanvasElement>(null);
  const facing = useRef<Facing>({ lat: 20, lon: 0, k: 1 });
  const goal = useRef<Facing | null>(null);
  const drag = useRef<{ x: number; y: number; lat: number; lon: number } | null>(null);
  const opts = useRef<GlobeProps>({});
  opts.current = { place, borders, grid, marker, spin };
  const dirty = useRef(true);

  // A new place: turn to face it (an area is looked at from further away than a point).
  useEffect(() => {
    if (!place) return;
    const span = Math.max(place.bbox[2] - place.bbox[0], place.bbox[3] - place.bbox[1]);
    goal.current = { lat: clamp(place.lat, -80, 80), lon: place.lon, k: interactive ? 1 : clamp(1 + Math.log2(Math.max(1, 40 / Math.max(span, 1))) * 0.35, 1, 1.9) };
    dirty.current = true;
  }, [place, interactive]);

  useEffect(() => {
    if (!size.w || !size.h) return;
    let raf = 0, last = performance.now(), pulsed = 0;
    const frame = (now: number) => {
      raf = requestAnimationFrame(frame);
      const dt = Math.min(64, now - last); last = now;
      const f = facing.current, g = goal.current;
      if (g) {
        const dl = ((g.lon - f.lon + 540) % 360) - 180;
        f.lon = wrapLon(f.lon + dl * Math.min(1, dt / 160)); f.lat += (g.lat - f.lat) * Math.min(1, dt / 160); f.k += (g.k - f.k) * Math.min(1, dt / 160);
        if (Math.abs(dl) < 0.05 && Math.abs(g.lat - f.lat) < 0.05 && Math.abs(g.k - f.k) < 0.003) goal.current = null;
        dirty.current = true;
      }
      if (opts.current.spin && !drag.current && !goal.current) { f.lon = wrapLon(f.lon + dt * 0.012); dirty.current = true; }
      // The marker pulses while it faces us, so the picture is redrawn a few times a second even at rest.
      if (opts.current.place && opts.current.marker !== false && now - pulsed > 66) { dirty.current = true; pulsed = now; }
      if (dirty.current && cv.current) { dirty.current = false; drawGlobe(cv.current, size.w, size.h, f, opts.current, now); }
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [size.w, size.h]);

  const radius = () => (Math.min(size.w, size.h) / 2 - 3) * facing.current.k;
  const turn = (e: React.PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d) return;
    const k = (180 / Math.PI) / radius();
    facing.current = { ...facing.current, lon: wrapLon(d.lon - (e.clientX - d.x) * k), lat: clamp(d.lat + (e.clientY - d.y) * k, -85, 85) };
    goal.current = null; dirty.current = true;
  };
  const home = useCallback(() => {
    if (place) goal.current = { lat: clamp(place.lat, -80, 80), lon: place.lon, k: 1 };
  }, [place]);
  const zoom = (d: number) => { goal.current = { ...(goal.current ?? facing.current), k: clamp((goal.current ?? facing.current).k * d, 0.6, 8) }; };
  const zoomRef = useRef(zoom);
  zoomRef.current = zoom;
  useEffect(() => {
    const el = ref.current;
    if (!el || !interactive) return;
    const h = (e: WheelEvent) => { e.preventDefault(); zoomRef.current(e.deltaY < 0 ? 1.18 : 1 / 1.18); };
    el.addEventListener('wheel', h, { passive: false });
    return () => el.removeEventListener('wheel', h);
  }, [interactive, ref]);

  return (
    <div ref={ref} className={`globev ${interactive ? 'live' : ''}`}
      {...(interactive ? {
        onPointerDown: (e: React.PointerEvent<HTMLDivElement>) => { if ((e.target as HTMLElement).closest('.place-ctl')) return; e.currentTarget.setPointerCapture(e.pointerId); drag.current = { x: e.clientX, y: e.clientY, lat: facing.current.lat, lon: facing.current.lon }; },
        onPointerMove: turn, onPointerUp: () => { drag.current = null; }, onPointerCancel: () => { drag.current = null; },
        onDoubleClick: (e: React.MouseEvent<HTMLDivElement>) => {
          const r = e.currentTarget.getBoundingClientRect(), R = radius();
          const q = unproject((e.clientX - r.left - size.w / 2) / R, -(e.clientY - r.top - size.h / 2) / R, facing.current.lat, facing.current.lon);
          if (q) goal.current = { lat: clamp(q.lat, -80, 80), lon: q.lon, k: facing.current.k };
        },
      } : {})}>
      <canvas ref={cv} role="img" aria-label={place ? tr('Globe showing {place}', { place: placeLabel(place, getLang()) }) : tr('Globe')} />
      {interactive && (
        <div className="place-ctls">
          <button type="button" className="place-ctl" aria-label={tr('Zoom in')} title={tr('Zoom in')} onClick={() => zoom(1.3)}><Icon name="plus" size={15} /></button>
          <button type="button" className="place-ctl" aria-label={tr('Zoom out')} title={tr('Zoom out')} onClick={() => zoom(1 / 1.3)}><Icon name="minus" size={15} /></button>
          <button type="button" className="place-ctl" aria-label={tr('Back to the place')} title={tr('Back to the place')} disabled={!place} onClick={home}><Icon name="focus" size={15} /></button>
        </div>
      )}
    </div>
  );
}
