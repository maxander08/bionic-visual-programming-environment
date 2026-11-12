import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { checkConnection, connect, disconnect, graphBounds, snap } from '../core/graph';
import { compoundModuleDef, getDef, nodeSize, portList, portPosition, portSide } from '../core/registry';
import type { CompoundDef, Edge, Graph, ModuleDef, NodeInst, Side } from '../core/types';
import { blockedEdges, engine, subscribeEdges, useDiagVersion } from '../runtime/session';
import { bridge, useStore } from '../state/store';
import { FAMILY_VAR, NodeView } from './NodeView';
import { easeInOutCubic, easeOutCubic, motion, tween } from './motion';
import { emitView, mainView } from './viewBus';
import { describe } from '../core/util';
import { tr } from '../i18n';

interface Layout { def: ModuleDef; w: number; h: number }
type Pt = { x: number; y: number };
const DIR: Record<Side, Pt> = { top: { x: 0, y: -1 }, bottom: { x: 0, y: 1 }, left: { x: -1, y: 0 }, right: { x: 1, y: 0 } };

export function bezier(a: Pt, sa: Side, b: Pt, sb: Side | null): string {
  const dist = Math.hypot(b.x - a.x, b.y - a.y);
  const L = Math.max(22, Math.min(190, dist * 0.5));
  const da = DIR[sa];
  const db = sb ? DIR[sb] : { x: -da.x, y: -da.y };
  return `M${a.x.toFixed(1)} ${a.y.toFixed(1)} C${(a.x + da.x * L).toFixed(1)} ${(a.y + da.y * L).toFixed(1)} ${(b.x + db.x * L).toFixed(1)} ${(b.y + db.y * L).toFixed(1)} ${b.x.toFixed(1)} ${b.y.toFixed(1)}`;
}
function bezPoints(a: Pt, sa: Side, b: Pt, sb: Side, n = 18): Pt[] {
  const dist = Math.hypot(b.x - a.x, b.y - a.y);
  const L = Math.max(22, Math.min(190, dist * 0.5));
  const da = DIR[sa], db = DIR[sb];
  const p1 = { x: a.x + da.x * L, y: a.y + da.y * L }, p2 = { x: b.x + db.x * L, y: b.y + db.y * L };
  const out: Pt[] = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n, u = 1 - t;
    out.push({ x: u * u * u * a.x + 3 * u * u * t * p1.x + 3 * u * t * t * p2.x + t * t * t * b.x, y: u * u * u * a.y + 3 * u * u * t * p1.y + 3 * u * t * t * p2.y + t * t * t * b.y });
  }
  return out;
}
const segDist = (p: Pt, a: Pt, b: Pt) => {
  const dx = b.x - a.x, dy = b.y - a.y;
  const l = dx * dx + dy * dy;
  const t = l === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / l));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
};

const compoundCache = new WeakMap<CompoundDef, ModuleDef>();
function defFor(n: NodeInst, compounds: Record<string, CompoundDef>): ModuleDef | undefined {
  if (n.type === 'compound') {
    const cd = compounds[String(n.params.def)];
    if (!cd) return undefined;
    let d = compoundCache.get(cd);
    if (!d) compoundCache.set(cd, (d = compoundModuleDef(cd)));
    return d;
  }
  return getDef(n.type, undefined, n.params);
}

type Drag =
  | { t: 'pan'; sx: number; sy: number; vx: number; vy: number; moved: boolean; hitEdge: string | null }
  | { t: 'node'; ids: string[]; start: Map<string, Pt>; sx: number; sy: number; moved: boolean; els: Map<string, HTMLElement> }
  | { t: 'wire'; anchor: { node: string; port: string; dir: 'in' | 'out' }; replace?: Edge; target: { node: string; port: string } | null; px: number; py: number; cand: Map<string, boolean> }
  | { t: 'marquee'; sx: number; sy: number; base: string[] };

interface Props { graph: Graph; compounds: Record<string, CompoundDef>; prefix?: string; ro?: boolean; main?: boolean }

function CanvasImpl({ graph, compounds, prefix = '', ro = false, main = false }: Props) {
  useStore((s) => s.settings.language); // re-render with translated module definitions when the language changes
  const root = useRef<HTMLDivElement>(null);
  const world = useRef<HTMLDivElement>(null);
  const svg = useRef<SVGSVGElement>(null);
  const prov = useRef<SVGPathElement>(null);
  const marquee = useRef<HTMLDivElement>(null);
  const ghosts = useRef<HTMLDivElement>(null);
  const view = useRef({ x: 40, y: 60, k: 1 });
  const drag = useRef<Drag | null>(null);
  const dragPos = useRef(new Map<string, Pt>());
  const hidden = useRef<string | null>(null);
  const pointers = useRef(new Map<number, Pt>());
  const pinch = useRef<{ d: number; k: number } | null>(null);
  const camCancel = useRef<(() => void) | null>(null);
  const size = useRef({ w: 800, h: 600 });
  const raf = useRef(0);
  const [visible, setVisible] = useState<Set<string> | null>(null);
  // `mode` drives the CSS animation: 'in' fades the tooltip in, 'out' fades it away using
  // the same --dur-micro/--ease tokens. A leaving tooltip is removed once its animation ends.
  const [hover, setHover] = useState<{ x: number; y: number; text: string; mode: 'in' | 'out' } | null>(null);
  const hoverKey = useRef<string | null>(null);   // port the pointer is currently over
  const hoverBack = useRef(false);                // re-show the tooltip after a wire ends
  const [localSel, setLocalSel] = useState<string[]>([]);
  const [localEdge, setLocalEdge] = useState<string | null>(null);

  const storeSel = useStore((s) => s.selection);
  const storeEdge = useStore((s) => s.selEdge);
  const settings = useStore((s) => s.settings);
  const selection = ro ? localSel : storeSel;
  const selEdge = ro ? localEdge : storeEdge;
  useDiagVersion();
  const projectId = useStore((s) => s.project.id);

  const layout = useMemo(() => {
    const m = new Map<string, Layout>();
    for (const n of Object.values(graph.nodes)) {
      const def = defFor(n, compounds);
      if (def) { const s = nodeSize(def); m.set(n.id, { def, w: s.w, h: s.h }); }
    }
    return m;
  }, [graph.nodes, compounds]);

  // latest values for imperative handlers
  const live = useRef({ graph, layout, selection, selEdge, settings, compounds });
  live.current = { graph, layout, selection, selEdge, settings, compounds };

  const connectedKey = useMemo(() => {
    const m = new Map<string, string[]>();
    for (const e of Object.values(graph.edges)) {
      (m.get(e.from) ?? m.set(e.from, []).get(e.from)!).push(`out:${e.fromPort}`);
      (m.get(e.to) ?? m.set(e.to, []).get(e.to)!).push(`in:${e.toPort}`);
    }
    const r = new Map<string, string>();
    m.forEach((v, k) => r.set(k, [...new Set(v)].sort().join(',')));
    return r;
  }, [graph.edges]);

  const pos = (id: string): NodeInst | undefined => {
    const n = live.current.graph.nodes[id];
    const o = dragPos.current.get(id);
    return n && o ? { ...n, x: o.x, y: o.y } : n;
  };
  const portAt = (id: string, port: string, dir: 'in' | 'out') => {
    const n = pos(id), l = live.current.layout.get(id);
    return n && l ? portPosition(n, l.def, port, dir) : null;
  };

  // ---- wires
  const els = useRef<Record<string, SVGPathElement | null>>({});
  const redraw = useCallback(() => {
    const { graph: g, selection: sel, selEdge: se } = live.current;
    const selSet = new Set(sel);
    const blocked = blockedEdges();
    const parts = { st: '', hot: '', sel: '', bad: '', off: '' };
    for (const e of Object.values(g.edges)) {
      if (e.id === hidden.current) continue;
      const a = portAt(e.from, e.fromPort, 'out'), b = portAt(e.to, e.toPort, 'in');
      if (!a || !b) continue;
      const d = bezier(a, a.side, b, b.side) + ' ';
      if (e.id === se) parts.sel += d;
      else if (blocked.has(prefix + e.id)) parts.bad += d;
      else if (!e.enabled) parts.off += d;
      else if (selSet.has(e.from) || selSet.has(e.to)) parts.hot += d;
      else parts.st += d;
    }
    (Object.keys(parts) as (keyof typeof parts)[]).forEach((k) => els.current[k]?.setAttribute('d', parts[k]));
  }, [prefix]);
  const scheduleRedraw = () => {
    if (!raf.current) raf.current = requestAnimationFrame(() => { raf.current = 0; redraw(); });
  };
  useLayoutEffect(() => { redraw(); }, [graph, layout, selection, selEdge, redraw, visible]);
  useEffect(() => { const t = setTimeout(redraw, 0); return () => clearTimeout(t); }, [redraw, projectId]);

  // active signal flashes follow real deliveries from the engine
  useEffect(() => {
    return subscribeEdges((ids) => {
      const layer = svg.current?.querySelector('.w-active');
      if (!layer || document.hidden) return;
      let n = 0;
      ids.forEach((id) => {
        if (n > 60 || !id.startsWith(prefix)) return;
        const local = id.slice(prefix.length);
        const e = live.current.graph.edges[local];
        if (!e) return;
        const a = portAt(e.from, e.fromPort, 'out'), b = portAt(e.to, e.toPort, 'in');
        const src = live.current.layout.get(e.from);
        if (!a || !b || !src) return;
        n++;
        const p = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        p.setAttribute('d', bezier(a, a.side, b, b.side));
        p.setAttribute('class', 'w-flash');
        p.style.stroke = FAMILY_VAR[src.def.family];
        layer.appendChild(p);
        const anim = p.animate([{ opacity: 1 }, { opacity: 0 }], { duration: motion.signal, easing: motion.ease.out });
        anim.onfinish = () => p.remove();
      });
    });
  }, [prefix]);

  // ---- camera
  const cullTimer = useRef(0);
  const computeVisible = useCallback(() => {
    cullTimer.current = 0;
    const { graph: g, layout: l } = live.current;
    const ids = Object.keys(g.nodes);
    if (ids.length < 70) { setVisible((v) => (v === null ? v : null)); return; }
    const { x, y, k } = view.current;
    const { w, h } = size.current;
    const m = 240 / k;
    const x0 = -x / k - m, y0 = -y / k - m, x1 = (w - x) / k + m, y1 = (h - y) / k + m;
    const next = new Set<string>();
    for (const id of ids) {
      const n = g.nodes[id], s = l.get(id);
      if (!s) continue;
      if (n.x + s.w >= x0 && n.x <= x1 && n.y + s.h >= y0 && n.y <= y1) next.add(id);
    }
    setVisible((v) => (v && v.size === next.size && [...next].every((i) => v.has(i)) ? v : next));
  }, []);
  const applyView = useCallback(() => {
    const { x, y, k } = view.current;
    if (world.current) world.current.style.transform = `translate3d(${x}px, ${y}px, 0) scale(${k})`;
    root.current?.style.setProperty('--k', String(k));
    if (main) { mainView.x = x; mainView.y = y; mainView.k = k; emitView(); }
    if (!cullTimer.current) cullTimer.current = window.setTimeout(computeVisible, 60);
  }, [main, computeVisible]);
  const persistView = useRef(0);
  const commitView = useCallback(() => {
    if (!main) return;
    window.clearTimeout(persistView.current);
    persistView.current = window.setTimeout(() => useStore.getState().setView({ ...view.current }), 400);
  }, [main]);
  const cancelCam = () => { camCancel.current?.(); camCancel.current = null; };

  const toWorld = (cx: number, cy: number): Pt => {
    const r = root.current!.getBoundingClientRect();
    return { x: (cx - r.left - view.current.x) / view.current.k, y: (cy - r.top - view.current.y) / view.current.k };
  };

  const animateTo = useCallback((t: { x: number; y: number; k: number }) => {
    cancelCam();
    const f = { ...view.current };
    camCancel.current = tween(motion.camera, (e) => {
      view.current = { x: f.x + (t.x - f.x) * e, y: f.y + (t.y - f.y) * e, k: f.k + (t.k - f.k) * e };
      applyView();
    }, easeInOutCubic, () => { camCancel.current = null; commitView(); });
  }, [applyView, commitView]);

  const frame = useCallback((ids: string[] | null, animate: boolean) => {
    const { graph: g, compounds: c } = live.current;
    const sub: Graph = ids && ids.length ? { nodes: Object.fromEntries(ids.filter((i) => g.nodes[i]).map((i) => [i, g.nodes[i]])), edges: {} } : g;
    const bb = graphBounds(sub, c);
    const { w, h } = size.current;
    if (!bb) { const t = { x: w / 2, y: h / 2, k: 1 }; animate ? animateTo(t) : ((view.current = t), applyView()); return; }
    const pad = 70;
    const single = ids && ids.length === 1;
    const k = Math.max(0.15, Math.min(single ? 1.6 : 1.25, (w - pad * 2) / bb.w, (h - pad * 2) / bb.h));
    const t = { k, x: w / 2 - (bb.x + bb.w / 2) * k, y: h / 2 - (bb.y + bb.h / 2) * k };
    if (animate) animateTo(t);
    else { view.current = t; applyView(); commitView(); }
  }, [animateTo, applyView, commitView]);

  const zoomAt = useCallback((f: number, cx: number, cy: number) => {
    const v = view.current;
    const k = Math.max(0.12, Math.min(2.5, v.k * f));
    view.current = { k, x: cx - ((cx - v.x) * k) / v.k, y: cy - ((cy - v.y) * k) / v.k };
    applyView();
    commitView();
  }, [applyView, commitView]);

  useEffect(() => {
    const el = root.current!;
    let lastLeft = el.getBoundingClientRect().left;
    const ro2 = new ResizeObserver(() => {
      const r = el.getBoundingClientRect();
      // When a side panel opens or closes the canvas origin moves; keep the content where it was on screen.
      if (Math.abs(r.left - lastLeft) > 0.5 && size.current.w > 0) { view.current = { ...view.current, x: view.current.x - (r.left - lastLeft) }; applyView(); }
      lastLeft = r.left;
      size.current = { w: r.width, h: r.height };
      if (main) { mainView.w = r.width; mainView.h = r.height; emitView(); }
      computeVisible();
    });
    ro2.observe(el);
    const r = el.getBoundingClientRect();
    size.current = { w: r.width, h: r.height };
    if (main) { mainView.w = r.width; mainView.h = r.height; }
    return () => ro2.disconnect();
  }, [main, computeVisible, applyView]);

  // initial / project change framing
  useEffect(() => {
    const pv = main ? useStore.getState().project.view : undefined;
    if (pv) { view.current = { ...pv }; applyView(); }
    else frame(null, false);
    computeVisible();
  }, [projectId]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!main) return;
    bridge.screenToWorld = (cx, cy) => {
      const r = root.current?.getBoundingClientRect();
      if (!r || cx < r.left || cx > r.right || cy < r.top || cy > r.bottom) return null;
      return toWorld(cx, cy);
    };
    bridge.centerWorld = () => ({ x: (size.current.w / 2 - view.current.x) / view.current.k, y: (size.current.h / 2 - view.current.y) / view.current.k });
    bridge.focus = (ids) => frame(ids, true);
    bridge.fit = () => frame(null, true);
    bridge.zoomBy = (f) => { cancelCam(); const { w, h } = size.current; const v = view.current; const k = Math.max(0.12, Math.min(2.5, v.k * f)); animateTo({ k, x: w / 2 - ((w / 2 - v.x) * k) / v.k, y: h / 2 - ((h / 2 - v.y) * k) / v.k }); };
    bridge.resetView = () => animateTo({ x: size.current.w / 2 - (size.current.w / 2 - view.current.x) / view.current.k, y: size.current.h / 2 - (size.current.h / 2 - view.current.y) / view.current.k, k: 1 });
    return () => { bridge.screenToWorld = bridge.centerWorld = bridge.focus = bridge.fit = bridge.zoomBy = bridge.resetView = undefined; };
  }, [main, frame, animateTo]);

  // minimap navigation
  useEffect(() => {
    if (!main) return;
    const h = (e: Event) => {
      const d = (e as CustomEvent<Pt>).detail;
      cancelCam();
      view.current = { ...view.current, x: size.current.w / 2 - d.x * view.current.k, y: size.current.h / 2 - d.y * view.current.k };
      applyView();
      commitView();
    };
    window.addEventListener('ns:center', h);
    return () => window.removeEventListener('ns:center', h);
  }, [main, applyView, commitView]);

  // wheel / trackpad
  useEffect(() => {
    const el = root.current!;
    const h = (e: WheelEvent) => {
      e.preventDefault();
      cancelCam();
      const r = el.getBoundingClientRect();
      const cx = e.clientX - r.left, cy = e.clientY - r.top;
      const lineMul = e.deltaMode === 1 ? 16 : 1;
      const dx = e.deltaX * lineMul, dy = e.deltaY * lineMul;
      const mouseWheel = e.deltaX === 0 && Number.isInteger(e.deltaY) && Math.abs(e.deltaY) >= 40;
      if (e.ctrlKey || e.metaKey || mouseWheel) zoomAt(Math.exp(-dy * (e.ctrlKey ? 0.012 : 0.0016)), cx, cy);
      else { view.current = { ...view.current, x: view.current.x - dx, y: view.current.y - dy }; applyView(); commitView(); }
    };
    el.addEventListener('wheel', h, { passive: false });
    return () => el.removeEventListener('wheel', h);
  }, [zoomAt, applyView, commitView]);

  // ---- hit testing
  const hitPort = (wp: Pt, radiusPx: number) => {
    const r = radiusPx / view.current.k;
    let best: { node: string; port: string; dir: 'in' | 'out'; d: number } | null = null;
    live.current.layout.forEach((l, id) => {
      const n = pos(id)!;
      if (wp.x < n.x - r - 4 || wp.x > n.x + l.w + r + 4 || wp.y < n.y - r - 4 || wp.y > n.y + l.h + r + 4) return;
      for (const dir of ['in', 'out'] as const)
        for (const p of portList(l.def, dir)) {
          const q = portPosition(n, l.def, p.id, dir)!;
          const d = Math.hypot(q.x - wp.x, q.y - wp.y);
          if (d <= r && (!best || d < best.d)) best = { node: id, port: p.id, dir, d };
        }
    });
    return best as { node: string; port: string; dir: 'in' | 'out'; d: number } | null;
  };
  const edgeAt = (wp: Pt): string | null => {
    const tol = 7 / view.current.k + 1;
    let best: string | null = null, bd = tol;
    for (const e of Object.values(live.current.graph.edges)) {
      const a = portAt(e.from, e.fromPort, 'out'), b = portAt(e.to, e.toPort, 'in');
      if (!a || !b) continue;
      const pts = bezPoints(a, a.side, b, b.side);
      for (let i = 0; i < pts.length - 1; i++) {
        const d = segDist(wp, pts[i], pts[i + 1]);
        if (d < bd) { bd = d; best = e.id; }
      }
    }
    return best;
  };

  const setSel = (ids: string[], edge: string | null = null) => {
    if (ro) { setLocalSel(ids); setLocalEdge(edge); } else useStore.getState().select(ids, edge);
  };

  const clearCandidates = () => world.current?.querySelectorAll('.cand-ok,.cand-bad,.cand-hot').forEach((e) => e.classList.remove('cand-ok', 'cand-bad', 'cand-hot'));
  const portEl = (node: string, dir: string, port: string) => world.current?.querySelector(`[data-node="${CSS.escape(node)}"] [data-pk="${dir}:${port}"]`) as HTMLElement | null;

  // ---- pointer interaction
  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if ((e.target as HTMLElement).closest('[data-interactive]')) return;
    if (e.button === 2) return;
    root.current!.focus({ preventScroll: true });
    cancelCam();
    root.current!.setPointerCapture(e.pointerId);
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.current.size === 2) {
      drag.current = null;
      const [a, b] = [...pointers.current.values()];
      pinch.current = { d: Math.hypot(a.x - b.x, a.y - b.y), k: view.current.k };
      return;
    }
    const wp = toWorld(e.clientX, e.clientY);
    const touch = e.pointerType === 'touch';
    if (e.button === 1) { drag.current = { t: 'pan', sx: e.clientX, sy: e.clientY, vx: view.current.x, vy: view.current.y, moved: false, hitEdge: null }; return; }
    const port = ro ? null : hitPort(wp, touch ? 18 : 11);
    if (port) {
      const { graph: g } = live.current;
      let anchor = { node: port.node, port: port.port, dir: port.dir };
      let replace: Edge | undefined;
      if (port.dir === 'in') {
        const ex = Object.values(g.edges).find((x) => x.to === port.node && x.toPort === port.port);
        if (ex) { anchor = { node: ex.from, port: ex.fromPort, dir: 'out' }; replace = ex; hidden.current = ex.id; redraw(); }
      }
      const cand = new Map<string, boolean>();
      const opp = anchor.dir === 'out' ? 'in' : 'out';
      live.current.layout.forEach((l, id) => {
        if (id === anchor.node) return;
        for (const p of portList(l.def, opp)) {
          const chk = anchor.dir === 'out' ? checkConnection(g, anchor.node, anchor.port, id, p.id, live.current.compounds) : checkConnection(g, id, p.id, anchor.node, anchor.port, live.current.compounds);
          cand.set(`${id}|${p.id}`, chk.ok);
          portEl(id, opp, p.id)?.classList.add(chk.ok ? 'cand-ok' : 'cand-bad');
        }
      });
      root.current!.classList.add('wiring');
      // Put the tooltip away while wiring: it must not sit on top of the wire being drawn.
      hoverBack.current = hoverKey.current !== null;
      hoverKey.current = null;
      setHover((h) => (h && h.mode === 'in' ? { ...h, mode: 'out' } : h));
      drag.current = { t: 'wire', anchor, replace, target: null, px: wp.x, py: wp.y, cand };
      updateProv();
      return;
    }
    const nodeEl = (e.target as HTMLElement).closest('[data-node]') as HTMLElement | null;
    if (nodeEl && !ro) {
      const id = nodeEl.dataset.node!;
      const multi = e.shiftKey || e.metaKey || e.ctrlKey;
      let sel = live.current.selection;
      if (multi) { sel = sel.includes(id) ? sel.filter((x) => x !== id) : [...sel, id]; setSel(sel); if (!sel.includes(id)) return; }
      else if (!sel.includes(id)) { sel = [id]; setSel(sel); }
      else if (live.current.selEdge) setSel(sel);
      const ids = sel.includes(id) ? sel : [id];
      const start = new Map<string, Pt>();
      const elm = new Map<string, HTMLElement>();
      for (const i of ids) { const n = live.current.graph.nodes[i]; if (n) { start.set(i, { x: n.x, y: n.y }); const el = world.current!.querySelector(`[data-node="${CSS.escape(i)}"]`) as HTMLElement | null; if (el) elm.set(i, el); } }
      drag.current = { t: 'node', ids, start, sx: e.clientX, sy: e.clientY, moved: false, els: elm };
      return;
    }
    if (e.shiftKey && !ro) { drag.current = { t: 'marquee', sx: e.clientX, sy: e.clientY, base: live.current.selection }; return; }
    drag.current = { t: 'pan', sx: e.clientX, sy: e.clientY, vx: view.current.x, vy: view.current.y, moved: false, hitEdge: ro ? null : edgeAt(wp) };
    if (nodeEl && ro) { setLocalSel([nodeEl.dataset.node!]); }
  };

  const updateProv = () => {
    const d = drag.current;
    const p = prov.current;
    if (!p) return;
    if (!d || d.t !== 'wire') { p.setAttribute('d', ''); return; }
    const a = portAt(d.anchor.node, d.anchor.port, d.anchor.dir);
    if (!a) return;
    let end: Pt = { x: d.px, y: d.py }, es: Side | null = null;
    if (d.target) {
      const opp = d.anchor.dir === 'out' ? 'in' : 'out';
      const t = portAt(d.target.node, d.target.port, opp);
      if (t) { end = t; es = t.side; }
    }
    p.setAttribute('d', d.anchor.dir === 'out' ? bezier(a, a.side, end, es) : bezier(end, es ?? opposite(a.side), a, a.side));
  };
  const opposite = (s: Side): Side => ({ top: 'bottom', bottom: 'top', left: 'right', right: 'left' } as const)[s];

  const pendingMove = useRef<{ e: PointerEvent | React.PointerEvent } | null>(null);
  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (pointers.current.has(e.pointerId)) pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pinch.current && pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      const r = root.current!.getBoundingClientRect();
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      const target = Math.max(0.12, Math.min(2.5, (pinch.current.k * d) / pinch.current.d));
      zoomAt(target / view.current.k, (a.x + b.x) / 2 - r.left, (a.y + b.y) / 2 - r.top);
      return;
    }
    const d = drag.current;
    if (!d) {
      if (e.pointerType === 'mouse' && !ro) {
        pendingMove.current = { e };
        if (!raf.current) raf.current = requestAnimationFrame(() => { raf.current = 0; redrawOrHover(); });
      }
      return;
    }
    if (d.t === 'pan') {
      const dx = e.clientX - d.sx, dy = e.clientY - d.sy;
      if (!d.moved && Math.hypot(dx, dy) < 3) return;
      d.moved = true;
      view.current = { ...view.current, x: d.vx + dx, y: d.vy + dy };
      applyView();
    } else if (d.t === 'node') {
      const dx = (e.clientX - d.sx) / view.current.k, dy = (e.clientY - d.sy) / view.current.k;
      if (!d.moved) {
        if (Math.hypot(e.clientX - d.sx, e.clientY - d.sy) < 3) return;
        d.moved = true;
        root.current!.classList.add('dragging');
        d.els.forEach((el) => el.classList.add('drag'));
      }
      d.start.forEach((s, id) => {
        const p = { x: s.x + dx, y: s.y + dy };
        dragPos.current.set(id, p);
        const el = d.els.get(id);
        if (el) el.style.transform = `translate(${p.x}px, ${p.y}px)`;
      });
      updateGhosts();
      scheduleRedraw();
    } else if (d.t === 'wire') {
      const wp = toWorld(e.clientX, e.clientY);
      d.px = wp.x; d.py = wp.y;
      const hit = hitPort(wp, e.pointerType === 'touch' ? 24 : 16);
      const opp = d.anchor.dir === 'out' ? 'in' : 'out';
      let target: { node: string; port: string } | null = null;
      if (hit && hit.dir === opp && hit.node !== d.anchor.node && d.cand.get(`${hit.node}|${hit.port}`)) target = { node: hit.node, port: hit.port };
      if (target?.node !== d.target?.node || target?.port !== d.target?.port) {
        if (d.target) portEl(d.target.node, opp, d.target.port)?.classList.remove('cand-hot');
        if (target) portEl(target.node, opp, target.port)?.classList.add('cand-hot');
        d.target = target;
      }
      updateProv();
    } else if (d.t === 'marquee') {
      const m = marquee.current!;
      const r = root.current!.getBoundingClientRect();
      const x0 = Math.min(d.sx, e.clientX) - r.left, y0 = Math.min(d.sy, e.clientY) - r.top;
      m.style.cssText = `display:block;left:${x0}px;top:${y0}px;width:${Math.abs(e.clientX - d.sx)}px;height:${Math.abs(e.clientY - d.sy)}px`;
      const a = toWorld(Math.min(d.sx, e.clientX), Math.min(d.sy, e.clientY)), b = toWorld(Math.max(d.sx, e.clientX), Math.max(d.sy, e.clientY));
      const hit: string[] = [];
      live.current.layout.forEach((l, id) => { const n = live.current.graph.nodes[id]; if (n.x < b.x && n.x + l.w > a.x && n.y < b.y && n.y + l.h > a.y) hit.push(id); });
      setSel([...new Set([...d.base, ...hit])]);
    }
  };

  const redrawOrHover = () => {
    const pm = pendingMove.current;
    pendingMove.current = null;
    if (!pm || drag.current) return;
    const wp = toWorld((pm.e as PointerEvent).clientX, (pm.e as PointerEvent).clientY);
    const hit = hitPort(wp, 10);
    if (!hit) {
      root.current?.classList.remove('overport');
      hoverKey.current = null;
      setHover((h) => (h && h.mode === 'in' ? { ...h, mode: 'out' } : h));
      return;
    }
    root.current?.classList.add('overport');
    const l = live.current.layout.get(hit.node)!;
    const p = portList(l.def, hit.dir).find((q) => q.id === hit.port)!;
    const rt = engine.nodes.get(prefix + hit.node);
    const sig = hit.dir === 'out' ? rt?.outputs[hit.port] : rt?.inputs[hit.port];
    const r = root.current!.getBoundingClientRect();
    const text = `${l.def.name} · ${hit.dir === 'in' ? tr('input') : tr('output')} ${p.label} (${p.type})\n${sig ? `${describe(sig.v)}  ·  ${tr('strength')} ${sig.s.toFixed(2)}` : tr('no signal')}`;
    // Same port and already shown: keep the frame-identical tooltip instead of restarting its animation.
    const k = `${hit.node}|${hit.dir}|${hit.port}`;
    if (hoverKey.current === k) return;
    hoverKey.current = k;
    setHover({ x: (pm.e as PointerEvent).clientX - r.left, y: (pm.e as PointerEvent).clientY - r.top, text, mode: 'in' });
  };

  const updateGhosts = () => {
    const g = ghosts.current;
    const d = drag.current;
    if (!g || !d || d.t !== 'node') return;
    if (!live.current.settings.snap) { g.textContent = ''; return; }
    while (g.children.length < d.ids.length) { const c = document.createElement('div'); c.className = 'ghost'; g.appendChild(c); }
    d.ids.forEach((id, i) => {
      const c = g.children[i] as HTMLElement, p = dragPos.current.get(id), l = live.current.layout.get(id);
      if (!p || !l) return;
      c.style.cssText = `display:block;transform:translate(${snap(p.x)}px,${snap(p.y)}px);width:${l.w}px;height:${l.h}px`;
    });
    for (let i = d.ids.length; i < g.children.length; i++) (g.children[i] as HTMLElement).style.display = 'none';
  };

  const endDrag = (e: React.PointerEvent<HTMLDivElement>, cancelled: boolean) => {
    pointers.current.delete(e.pointerId);
    if (pinch.current) { if (pointers.current.size < 2) pinch.current = null; if (pointers.current.size === 0) drag.current = null; return; }
    const d = drag.current;
    drag.current = null;
    if (!d) return;
    root.current?.classList.remove('dragging', 'wiring');
    if (d.t === 'pan') {
      if (!d.moved && !cancelled) setSel([], d.hitEdge);
      else commitView();
    } else if (d.t === 'node') {
      d.els.forEach((el) => el.classList.remove('drag'));
      if (ghosts.current) ghosts.current.textContent = '';
      if (!d.moved || cancelled) { if (cancelled) { d.start.forEach((s, id) => { const el = d.els.get(id); if (el) el.style.transform = `translate(${s.x}px,${s.y}px)`; }); dragPos.current.clear(); scheduleRedraw(); } return; }
      const useSnap = live.current.settings.snap;
      const finalPos: Record<string, Pt> = {};
      const from = new Map<string, Pt>();
      d.ids.forEach((id) => {
        const p = dragPos.current.get(id)!;
        from.set(id, p);
        finalPos[id] = { x: useSnap ? snap(p.x) : Math.round(p.x), y: useSnap ? snap(p.y) : Math.round(p.y) };
      });
      tween(motion.settle, (t) => {
        d.ids.forEach((id) => {
          const f = from.get(id)!, to = finalPos[id];
          const p = { x: f.x + (to.x - f.x) * t, y: f.y + (to.y - f.y) * t };
          dragPos.current.set(id, p);
          const el = d.els.get(id);
          if (el) el.style.transform = `translate(${p.x}px, ${p.y}px)`;
        });
        redraw();
      }, easeOutCubic, () => {
        useStore.getState().moveNodesTo(finalPos);
        dragPos.current.clear();
        requestAnimationFrame(redraw);
      });
    } else if (d.t === 'wire') {
      const opp = d.anchor.dir === 'out' ? 'in' : 'out';
      clearCandidates();
      hidden.current = null;
      if (prov.current) prov.current.setAttribute('d', '');
      if (!cancelled) {
        const st = useStore.getState();
        if (d.target) {
          const [from, fp, to, tp] = d.anchor.dir === 'out' ? [d.anchor.node, d.anchor.port, d.target.node, d.target.port] : [d.target.node, d.target.port, d.anchor.node, d.anchor.port];
          if (d.replace && d.replace.from === from && d.replace.fromPort === fp && d.replace.to === to && d.replace.toPort === tp) { redraw(); return; }
          if (d.replace) {
            let err: string | undefined;
            st.edit((s) => {
              const r = connect(disconnect(s.graph, d.replace!.id), from, fp, to, tp, s.compounds);
              if (r.error) { err = r.error; return null; }
              return { ...s, graph: r.graph };
            });
            if (err) st.toast(err, 'error');
          } else st.connectPorts(from, fp, to, tp);
        } else {
          const hit = hitPort(toWorld(e.clientX, e.clientY), 16);
          if (hit && hit.node !== d.anchor.node && hit.dir === opp) {
            const [from, fp, to, tp] = d.anchor.dir === 'out' ? [d.anchor.node, d.anchor.port, hit.node, hit.port] : [hit.node, hit.port, d.anchor.node, d.anchor.port];
            const chk = checkConnection(live.current.graph, from, fp, to, tp, live.current.compounds);
            st.toast(chk.reason ?? tr("Those ports cannot be connected."), 'error');
          } else if (hit && hit.node === d.anchor.node && hit.dir === opp) st.toast(tr("A module cannot connect to itself. Route feedback through a Delay or another module."), 'info');
          else if (d.replace) { st.removeEdge(d.replace.id); st.toast(tr("Connection removed."), 'info'); }
        }
      }
      // A wire just ended while the pointer never left its port: bring the tooltip back,
      // re-measuring only now so it fades in under the resting cursor.
      if (hoverBack.current) {
        hoverBack.current = false;
        const wp = toWorld(e.clientX, e.clientY);
        const hit = hitPort(wp, 10);
        if (hit) {
          const l = live.current.layout.get(hit.node)!;
          const p = portList(l.def, hit.dir).find((q) => q.id === hit.port)!;
          const rt = engine.nodes.get(prefix + hit.node);
          const sig = hit.dir === 'out' ? rt?.outputs[hit.port] : rt?.inputs[hit.port];
          const r = root.current!.getBoundingClientRect();
          const text = `${l.def.name} · ${hit.dir === 'in' ? tr('input') : tr('output')} ${p.label} (${p.type})\n${sig ? `${describe(sig.v)}  ·  ${tr('strength')} ${sig.s.toFixed(2)}` : tr('no signal')}`;
          hoverKey.current = `${hit.node}|${hit.dir}|${hit.port}`;
          setHover({ x: e.clientX - r.left, y: e.clientY - r.top, text, mode: 'in' });
          root.current?.classList.add('overport');
        } else hoverKey.current = null;
      }
      redraw();
    } else if (d.t === 'marquee') {
      if (marquee.current) marquee.current.style.display = 'none';
    }
  };

  const onDoubleClick = (e: React.MouseEvent) => {
    const nodeEl = (e.target as HTMLElement).closest('[data-node]') as HTMLElement | null;
    if (nodeEl && !(e.target as HTMLElement).closest('[data-interactive]')) frame([nodeEl.dataset.node!], true);
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (ro) return;
    const st = useStore.getState();
    const sel = live.current.selection;
    const step = (e.shiftKey ? 4 : 1) * 12;
    const mv = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[e.key];
    if (mv && sel.length) {
      e.preventDefault();
      const pos: Record<string, Pt> = {};
      sel.forEach((id) => { const n = live.current.graph.nodes[id]; if (n) pos[id] = { x: n.x + mv[0], y: n.y + mv[1] }; });
      st.edit((s) => ({ ...s, graph: Object.keys(pos).reduce((g, id) => ({ ...g, nodes: { ...g.nodes, [id]: { ...g.nodes[id], ...pos[id] } } }), s.graph) }), `nudge`);
    } else if (e.key === 'Tab') {
      const ids = Object.values(live.current.graph.nodes).sort((a, b) => a.y - b.y || a.x - b.x).map((n) => n.id);
      if (!ids.length) return;
      e.preventDefault();
      const cur = ids.indexOf(sel[0]);
      const next = ids[(cur + (e.shiftKey ? -1 : 1) + ids.length) % ids.length];
      st.select([next]);
      const n = live.current.graph.nodes[next], v = view.current, s = size.current;
      const sx = n.x * v.k + v.x, sy = n.y * v.k + v.y;
      if (sx < 20 || sy < 20 || sx > s.w - 160 * v.k || sy > s.h - 100 * v.k) frame([next], true);
    }
  };

  const nodeIds: string[] = visible ? [...visible] : Object.keys(graph.nodes);
  const selSet = new Set(selection);

  return (
    <div ref={root} className={`canvas-root ${ro ? 'ro' : ''}`} tabIndex={0} role="application" aria-label={ro ? tr("Compound inner graph (read only)") : tr("Program workspace. Tab selects modules, arrow keys move them, Delete removes them.")}
      onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={(e) => endDrag(e, false)} onPointerCancel={(e) => endDrag(e, true)} onPointerLeave={() => { hoverKey.current = null; setHover((h) => (h && h.mode === 'in' ? { ...h, mode: 'out' } : h)); }} onDoubleClick={onDoubleClick} onKeyDown={onKeyDown} onContextMenu={(e) => e.preventDefault()}>
      <div ref={world} className="world" style={{ transform: `translate3d(${view.current.x}px, ${view.current.y}px, 0) scale(${view.current.k})` }}>
        <svg ref={svg} className="wires" width="1" height="1" aria-hidden="true">
          <path ref={(e) => { els.current.off = e; }} className="w w-off" />
          <path ref={(e) => { els.current.st = e; }} className="w w-st" />
          <path ref={(e) => { els.current.hot = e; }} className="w w-hot" />
          <path ref={(e) => { els.current.bad = e; }} className="w w-bad" />
          <path ref={(e) => { els.current.sel = e; }} className="w w-sel" />
          <g className="w-active" />
        </svg>
        {nodeIds.map((id) => {
          const n = graph.nodes[id], l = layout.get(id);
          if (!n || !l) return null;
          return <NodeView key={id} node={n} def={l.def} selected={selSet.has(id)} conn={connectedKey.get(id) ?? ''} prefix={prefix} ro={ro} />;
        })}
        <div ref={ghosts} className="ghosts" />
        <svg className="wires top" width="1" height="1" aria-hidden="true"><path ref={prov} className="w w-prov" /></svg>
      </div>
      <div ref={marquee} className="marquee" />
      {hover && <div className={`port-tip ${hover.mode}`} style={{ left: hover.x + 14, top: hover.y + 14 }} role="status"
        onAnimationEnd={(ev) => { if (hover.mode === 'out' && ev.animationName === 'fade-out') setHover((h) => (h && h.mode === 'out' ? null : h)); }}>{hover.text.split('\n').map((t, i) => <div key={i} className={i ? 'v' : ''}>{t}</div>)}</div>}
      {Object.keys(graph.nodes).length === 0 && !ro && (
        <div className="empty-hint"><p>{tr("Empty workspace")}</p><span>{tr("Drag a module from the library, or open an example from the toolbar.")}</span></div>
      )}
    </div>
  );
}

export const Canvas = memo(CanvasImpl);
export { portSide };
