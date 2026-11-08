import { useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import { getDef, nodeSize } from '../core/registry';
import { engine, getDiagnostics, pause, play, stepOnce, stop, useDiagVersion } from '../runtime/session';
import { bridge, useStore } from '../state/store';
import { duplicateProgram, exportJSON, newProgram, resetWorkspace, saveToBrowser } from '../state/actions';
import { Icon } from './icons';
import { FAMILY_VAR } from './NodeView';
import { mainView, subscribeView, viewZoomPct } from './viewBus';
import type { CompoundDef, Graph } from '../core/types';
import { compoundModuleDef } from '../core/registry';
import { fmtNum } from '../core/util';

function IconBtn({ icon, label, onClick, disabled, on, danger, text, tone }: { icon: string; label: string; onClick: () => void; disabled?: boolean; on?: boolean; danger?: boolean; text?: string; tone?: string }) {
  return (
    <button className={`tb-btn ${on ? 'on' : ''} ${danger ? 'danger' : ''} ${tone ?? ''}`} onClick={onClick} disabled={disabled} aria-label={label} title={label} aria-pressed={on === undefined ? undefined : on}>
      <Icon name={icon} size={16} />{text && <span className="tb-text">{text}</span>}
    </button>
  );
}

function Menu({ label, icon, text, children }: { label: string; icon: string; text?: string; children: (close: () => void) => ReactNode }) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  // Anchor the dropdown to the viewport rather than the toolbar. The toolbar scrolls
  // horizontally on narrow screens, and an `auto` overflow axis makes it a clipping
  // container, which trapped the menu inside the 46px strip. Fixed positioning escapes it.
  const toggle = () => {
    if (open) { setOpen(false); return; }
    const r = btnRef.current?.getBoundingClientRect();
    if (r) setPos({ left: Math.min(r.left, window.innerWidth - 238), top: r.bottom + 6 });
    setOpen(true);
  };
  useEffect(() => {
    if (!open) return;
    const down = (e: PointerEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { setOpen(false); ref.current?.querySelector('button')?.focus(); }
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        const items = [...(ref.current?.querySelectorAll('[role="menuitem"]:not(:disabled)') ?? [])] as HTMLElement[];
        const i = items.indexOf(document.activeElement as HTMLElement);
        items[(i + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length]?.focus();
      }
    };
    const bail = () => setOpen(false);
    window.addEventListener('pointerdown', down);
    window.addEventListener('keydown', key);
    window.addEventListener('scroll', bail, true);
    window.addEventListener('resize', bail);
    setTimeout(() => (ref.current?.querySelector('[role="menuitem"]') as HTMLElement | null)?.focus(), 0);
    return () => {
      window.removeEventListener('pointerdown', down);
      window.removeEventListener('keydown', key);
      window.removeEventListener('scroll', bail, true);
      window.removeEventListener('resize', bail);
    };
  }, [open]);
  return (
    <div className="menu" ref={ref}>
      <button ref={btnRef} className={`tb-btn ${open ? 'on' : ''}`} aria-haspopup="menu" aria-expanded={open} aria-label={label} title={label} onClick={toggle}>
        <Icon name={icon} size={16} />{text && <span className="tb-text">{text}</span>}
      </button>
      {open && <div className="menu-pop" role="menu" style={pos ? { position: 'fixed', left: pos.left, top: pos.top } : undefined}>{children(() => setOpen(false))}</div>}
    </div>
  );
}
const MI = ({ onClick, children, kbd, danger }: { onClick: () => void; children: ReactNode; kbd?: string; danger?: boolean }) => (
  <button role="menuitem" className={danger ? 'danger' : ''} onClick={onClick}><span>{children}</span>{kbd && <kbd>{kbd}</kbd>}</button>
);

function Zoom() {
  const pct = useSyncExternalStore(subscribeView, viewZoomPct);
  return <button className="zoom-pct" onClick={() => bridge.resetView?.()} title="Reset zoom to 100%" aria-label={`Zoom ${pct}%. Click to reset to 100%`}>{pct}%</button>;
}

export function Toolbar() {
  const name = useStore((s) => s.project.name);
  const rename = useStore((s) => s.rename);
  const past = useStore((s) => s.past.length);
  const future = useStore((s) => s.future.length);
  const run = useStore((s) => s.run);
  const ui = useStore((s) => s.ui);
  const settings = useStore((s) => s.settings);
  const sel = useStore((s) => s.selection);
  const st = useStore.getState();
  const [draft, setDraft] = useState<string | null>(null);
  return (
    <header className="toolbar" role="toolbar" aria-label="Main toolbar">
      <div className="tb-group brand">
        <svg className="logo" width="22" height="22" viewBox="0 0 24 24" aria-hidden="true"><rect x="2.5" y="3.5" width="19" height="17" rx="5" fill="none" stroke="#2fd9cf" strokeWidth="1.5" /><circle cx="8.5" cy="12" r="1.7" fill="#ff2a2a" /><path d="M11 12h4.5M15.5 12v4" stroke="#fff" strokeWidth="1.4" fill="none" /></svg>
        <input className="prog-name" value={draft ?? name} aria-label="Program name" maxLength={80} spellCheck={false} title={name}
          onChange={(e) => setDraft(e.target.value)} onBlur={() => { if (draft !== null) rename(draft); setDraft(null); }} onKeyDown={(e) => { e.stopPropagation(); if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); if (e.key === 'Escape') { setDraft(null); (e.target as HTMLInputElement).blur(); } }} />
      </div>
      <div className="tb-group">
        <Menu label="File" icon="file" text="File">
          {(close) => (
            <>
              <MI onClick={() => { close(); newProgram(); }}>New program</MI>
              <MI onClick={() => { close(); st.openDialog('projects'); }}>Open or import…</MI>
              <MI onClick={() => { close(); saveToBrowser(); }} kbd="⌘S">Save in browser</MI>
              <MI onClick={() => { close(); exportJSON(); }}>Export program file</MI>
              <MI onClick={() => { close(); duplicateProgram(); }}>Duplicate program</MI>
              <div className="sep" role="separator" />
              <MI onClick={() => { close(); st.openDialog('templates'); }}>Example programs…</MI>
              <MI danger onClick={() => { close(); resetWorkspace(); }}>Clear workspace…</MI>
            </>
          )}
        </Menu>
        <IconBtn icon="undo" label="Undo (Ctrl/⌘+Z)" onClick={() => st.undo()} disabled={!past} />
        <IconBtn icon="redo" label="Redo (Ctrl/⌘+Shift+Z)" onClick={() => st.redo()} disabled={!future} />
      </div>
      <div className="tb-group run-group" role="group" aria-label="Execution">
        {run === 'running'
          ? <IconBtn icon="pause" label="Pause (Space)" onClick={pause} on tone="live" text="Pause" />
          : <IconBtn icon="play" label={run === 'paused' ? 'Resume (Space)' : 'Run (Space)'} onClick={play} tone="go" text={run === 'paused' ? 'Resume' : 'Run'} />}
        <IconBtn icon="step" label="Step one tick (.)" onClick={stepOnce} disabled={run === 'running'} />
        <IconBtn icon="stop" label="Stop and reset (Esc)" onClick={stop} disabled={run === 'stopped'} />
      </div>
      <div className="tb-spacer" />
      <div className="tb-group" role="group" aria-label="Workspace view">
        <IconBtn icon="minus" label="Zoom out" onClick={() => bridge.zoomBy?.(1 / 1.25)} />
        <Zoom />
        <IconBtn icon="plus" label="Zoom in" onClick={() => bridge.zoomBy?.(1.25)} />
        <IconBtn icon="fit" label="Fit program in view (F)" onClick={() => bridge.fit?.()} />
        <IconBtn icon="focus" label="Focus selected module (Shift+F)" onClick={() => sel.length && bridge.focus?.(sel)} disabled={!sel.length} />
        <IconBtn icon="map" label="Toggle overview map" on={settings.minimap} onClick={() => st.setSettings({ minimap: !settings.minimap })} />
      </div>
      <div className="tb-group">
        <IconBtn icon="docs" label="Documentation for the current selection" onClick={() => st.openDialog('docs')} text="Docs" />
        <IconBtn icon="share" label="Share or export" onClick={() => st.openDialog('share')} text="Share" />
        <IconBtn icon="gear" label="Settings" onClick={() => st.openDialog('settings')} />
        <IconBtn icon="panelL" label="Toggle module library" on={ui.lib} onClick={() => st.setUi({ lib: !ui.lib })} />
        <IconBtn icon="panelR" label="Toggle inspector" on={ui.insp} onClick={() => st.setUi({ insp: !ui.insp })} />
      </div>
    </header>
  );
}

export function StatusBar() {
  const run = useStore((s) => s.run);
  const project = useStore((s) => s.project);
  const saveState = useStore((s) => s.saveState);
  const settings = useStore((s) => s.settings);
  const [, tick] = useState(0);
  const [open, setOpen] = useState(false);
  useDiagVersion();
  useEffect(() => {
    const t = setInterval(() => tick((x) => x + 1), run === 'running' ? 250 : 1000);
    return () => clearInterval(t);
  }, [run]);
  const diag = getDiagnostics();
  const errors = diag.filter((d) => d.level === 'error').length, warns = diag.filter((d) => d.level === 'warn').length;
  const s = engine.stats;
  const st = useStore.getState();
  return (
    <footer className="statusbar" role="contentinfo">
      <span className={`run-state ${run}`} role="status"><i />{run === 'running' ? 'Running' : run === 'paused' ? 'Paused' : 'Stopped'}</span>
      <span className="stat" title="Simulation clock. It advances in fixed ticks and does not depend on screen refresh.">t {fmtNum(engine.time / 1000, 2)} s</span>
      <span className="stat" title="Simulation tick period and speed">{settings.tickMs} ms ×{settings.speed}</span>
      <span className="stat hide-sm">{Object.keys(project.graph.nodes).length} modules · {Object.keys(project.graph.edges).length} links</span>
      <span className="stat hide-sm" title="Modules evaluated in the last tick; only modules whose inputs changed run.">{s.evalsLastTick} evals · {s.tickMicros} µs</span>
      <span className="tb-spacer" />
      <button className={`diag-btn ${errors ? 'err' : warns ? 'warn' : ''}`} aria-expanded={open} onClick={() => setOpen(!open)} aria-label={`${errors} errors, ${warns} warnings. Show diagnostics`}>
        <Icon name="alert" size={13} />{errors} error{errors === 1 ? '' : 's'} · {warns} warning{warns === 1 ? '' : 's'}
      </button>
      <span className={`stat save ${saveState}`} title={saveState === 'unavailable' ? 'Browser storage is unavailable (private mode or restricted file access). Use File → Export to keep your work.' : 'Autosave keeps the latest state in this browser.'}>
        {saveState === 'saved' ? 'Autosaved' : saveState === 'unsaved' ? 'Saving…' : 'Storage unavailable: export to keep work'}
      </span>
      {open && (
        <div className="diag-pop" role="dialog" aria-label="Diagnostics">
          <div className="diag-head"><b>Diagnostics</b><button className="icon-btn sm" aria-label="Close diagnostics" onClick={() => setOpen(false)}><Icon name="close" size={13} /></button></div>
          {diag.length === 0 ? <p className="muted pad12">Nothing to report.</p> : (
            <ul className="diag-list">{diag.map((d, i) => (
              <li key={i} className={d.level}><button onClick={() => { const top = d.nodeId?.split('/')[0]; if (top && project.graph.nodes[top]) { st.select([top]); bridge.focus?.([top]); st.setUi({ insp: true }); } }}><Icon name="alert" size={13} /><span>{d.message}</span></button></li>
            ))}</ul>
          )}
        </div>
      )}
    </footer>
  );
}

export function Minimap({ graph, compounds }: { graph: Graph; compounds: Record<string, CompoundDef> }) {
  const cv = useRef<HTMLCanvasElement>(null);
  const raf = useRef(0);
  const W = 168, H = 108;
  const draw = () => {
    raf.current = 0;
    const c = cv.current;
    if (!c) return;
    const ctx = c.getContext('2d')!;
    const dpr = window.devicePixelRatio || 1;
    if (c.width !== W * dpr) { c.width = W * dpr; c.height = H * dpr; }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    const rects: { x: number; y: number; w: number; h: number; c: string }[] = [];
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const n of Object.values(graph.nodes)) {
      const d = n.type === 'compound' ? (compounds[String(n.params.def)] ? compoundModuleDef(compounds[String(n.params.def)]) : undefined) : getDef(n.type);
      if (!d) continue;
      const s = nodeSize(d);
      rects.push({ x: n.x, y: n.y, w: s.w, h: s.h, c: FAMILY_VAR[d.family] });
      x0 = Math.min(x0, n.x); y0 = Math.min(y0, n.y); x1 = Math.max(x1, n.x + s.w); y1 = Math.max(y1, n.y + s.h);
    }
    const v = mainView;
    const vx0 = -v.x / v.k, vy0 = -v.y / v.k, vx1 = (v.w - v.x) / v.k, vy1 = (v.h - v.y) / v.k;
    x0 = Math.min(x0, vx0); y0 = Math.min(y0, vy0); x1 = Math.max(x1, vx1); y1 = Math.max(y1, vy1);
    if (!Number.isFinite(x0)) return;
    const pad = 80;
    const k = Math.min((W - 8) / (x1 - x0 + pad), (H - 8) / (y1 - y0 + pad));
    const ox = (W - (x1 - x0) * k) / 2 - x0 * k, oy = (H - (y1 - y0) * k) / 2 - y0 * k;
    (c as any)._map = { k, ox, oy };
    for (const r of rects) { ctx.strokeStyle = r.c; ctx.globalAlpha = 0.8; ctx.lineWidth = 1; ctx.strokeRect(r.x * k + ox + 0.5, r.y * k + oy + 0.5, Math.max(2, r.w * k - 1), Math.max(2, r.h * k - 1)); }
    ctx.globalAlpha = 1;
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 1.2;
    ctx.strokeRect(vx0 * k + ox, vy0 * k + oy, (vx1 - vx0) * k, (vy1 - vy0) * k);
  };
  const sched = () => { if (!raf.current) raf.current = requestAnimationFrame(draw); };
  useEffect(() => { sched(); const u = subscribeView(sched); return () => { u(); cancelAnimationFrame(raf.current); raf.current = 0; }; }); // redraw each render and on view change
  const go = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const m = (cv.current as any)?._map;
    if (!m) return;
    const r = cv.current!.getBoundingClientRect();
    window.dispatchEvent(new CustomEvent('ns:center', { detail: { x: ((e.clientX - r.left) - m.ox) / m.k, y: ((e.clientY - r.top) - m.oy) / m.k } }));
  };
  return (
    <canvas ref={cv} className="minimap" style={{ width: W, height: H }} role="img" aria-label="Overview map of the program. Click or drag to move the view."
      onPointerDown={(e) => { e.currentTarget.setPointerCapture(e.pointerId); go(e); }} onPointerMove={(e) => { if (e.buttons) go(e); }} />
  );
}
