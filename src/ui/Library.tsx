import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { CompoundDef, ModuleDef } from '../core/types';
import { CATEGORIES, compoundModuleDef, localizedModules } from '../core/registry';
import { PACKAGES } from '../core/packages';
import { TEMPLATES, builtinCompounds } from '../core/library';
import { bridge, useStore } from '../state/store';
import { openTemplate } from '../state/actions';
import { Icon } from './icons';
import { PreviewNode } from './NodeView';
import { tr } from '../i18n';

type Payload = { kind: 'module'; def: ModuleDef; params?: Record<string, unknown> } | { kind: 'compound'; cdef: CompoundDef; def: ModuleDef };

function useAddDrag() {
  const [ghost, setGhost] = useState<{ x: number; y: number; payload: Payload } | null>(null);
  const start = useRef<{ x: number; y: number; payload: Payload; id: number } | null>(null);
  const dragging = useRef(false);

  const place = (p: Payload, at: { x: number; y: number } | null) => {
    const st = useStore.getState();
    const c = at ?? bridge.centerWorld?.() ?? { x: 0, y: 0 };
    const size = { chip: [144, 36], small: [144, 84], square: [144, 132], tall: [144, 180], wide: [300, 132] }[p.def.size];
    const x = c.x - size[0] / 2 + (at ? 0 : (st.project.graph ? Object.keys(st.project.graph.nodes).length % 5 : 0) * 12), y = c.y - size[1] / 2 + (at ? 0 : (Object.keys(st.project.graph.nodes).length % 5) * 12);
    if (p.kind === 'module') st.addNodeAt(p.def.type, x, y, p.params);
    else st.addCompoundAt(p.cdef, x, y);
    if (st.ui.libW && window.innerWidth <= 900) st.setUi({ lib: false });
  };

  const down = (e: React.PointerEvent, payload: Payload) => {
    if (e.button !== 0) return;
    start.current = { x: e.clientX, y: e.clientY, payload, id: e.pointerId };
    dragging.current = false;
    const move = (ev: PointerEvent) => {
      const s = start.current;
      if (!s) return;
      if (!dragging.current && Math.hypot(ev.clientX - s.x, ev.clientY - s.y) < 6) return;
      dragging.current = true;
      setGhost({ x: ev.clientX, y: ev.clientY, payload: s.payload });
    };
    const up = (ev: PointerEvent) => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
      const s = start.current;
      start.current = null;
      setGhost(null);
      if (s && dragging.current) {
        const w = bridge.screenToWorld?.(ev.clientX, ev.clientY);
        if (w) place(s.payload, w);
      } else if (s && ev.type === 'pointerup') place(s.payload, null);
      dragging.current = false;
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
  };
  const key = (e: React.KeyboardEvent, payload: Payload) => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); place(payload, null); }
  };
  const ghostEl = ghost && createPortal(<div className="drag-ghost" style={{ left: ghost.x, top: ghost.y }}><PreviewNode def={ghost.payload.def} scale={0.9} /></div>, document.body);
  return { down, key, ghostEl };
}

function Item({ def, payload, onPeek, d, label }: { def: ModuleDef; payload: Payload; onPeek: (p: ModuleDef | null) => void; d: ReturnType<typeof useAddDrag>; label?: string }) {
  return (
    <button className="lib-item" aria-label={tr('Add {name} module. Drag onto the workspace or press Enter.', { name: label ?? def.name })} onPointerDown={(e) => d.down(e, payload)} onKeyDown={(e) => d.key(e, payload)}
      onMouseEnter={() => onPeek(def)} onFocus={() => onPeek(def)} onMouseLeave={() => onPeek(null)} onBlur={() => onPeek(null)}>
      <PreviewNode def={def} />
      <span className="cap">{label ?? def.caption}</span>
    </button>
  );
}

export function Library() {
  const tab = useStore((s) => s.ui.libTab);
  const setUi = useStore((s) => s.setUi);
  const [q, setQ] = useState('');
  const [peek, setPeek] = useState<ModuleDef | null>(null);
  const d = useAddDrag();
  const project = useStore((s) => s.project);
  const userC = useStore((s) => s.userCompounds);
  const search = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const h = (e: KeyboardEvent) => { if ((e.key === '/' || ((e.metaKey || e.ctrlKey) && e.key === 'k')) && !(e.target as HTMLElement).closest('input,textarea,select')) { e.preventDefault(); setUi({ lib: true, libTab: 'modules' }); setTimeout(() => search.current?.focus(), 30); } };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [setUi]);

  const lang = useStore((s) => s.settings.language);
  const mods = useMemo(() => localizedModules(), [lang]);
  const filtered = useMemo(() => {
    const t = q.trim().toLowerCase();
    return mods.filter((m) => !t || `${m.name} ${m.caption} ${m.category} ${m.keywords ?? ''} ${m.doc.summary}`.toLowerCase().includes(t));
  }, [q, mods]);

  const compounds = useMemo(() => {
    const map = new Map<string, { c: CompoundDef; src: string }>();
    builtinCompounds().forEach((c) => map.set(c.id, { c, src: tr("Built-in") }));
    Object.values(userC).forEach((c) => map.set(c.id, { c, src: tr('My library') }));
    Object.values(project.compounds).forEach((c) => { if (!map.has(c.id)) map.set(c.id, { c, src: tr("This program") }); });
    return [...map.values()];
  }, [userC, project.compounds, lang]);

  return (
    <aside className="panel lib" aria-label={tr("Module library")}>
      <div className="panel-head">
        <div className="tabs" role="tablist" aria-label={tr("Library sections")}>
          {(['modules', 'presets', 'examples'] as const).map((t) => (
            <button key={t} role="tab" aria-selected={tab === t} className={tab === t ? 'on' : ''} onClick={() => setUi({ libTab: t })}>{t === 'modules' ? tr("Modules") : t === 'presets' ? tr("Presets") : tr("Examples")}</button>
          ))}
        </div>
      </div>
      {tab === 'modules' && (
        <div className="search">
          <Icon name="search" size={14} />
          <input ref={search} value={q} onChange={(e) => setQ(e.target.value)} placeholder={tr("Search modules  ( / )")} aria-label={tr("Search modules")} spellCheck={false} />
          {q && <button className="icon-btn sm" aria-label={tr("Clear search")} onClick={() => setQ('')}><Icon name="close" size={12} /></button>}
        </div>
      )}
      <div className="panel-scroll">
        {tab === 'modules' && (
          <>
            {CATEGORIES.map((cat) => {
              const list = filtered.filter((m) => m.category === cat);
              if (!list.length) return null;
              return (
                <section key={cat}>
                  <h3 className="sec">{tr(cat)}</h3>
                  <div className="lib-grid">{list.map((m) => <Item key={m.type} def={m} payload={{ kind: 'module', def: m }} onPeek={setPeek} d={d} />)}</div>
                </section>
              );
            })}
            {!filtered.length && <p className="muted pad12">{tr("No module matches “{q}”.", { q })}</p>}
          </>
        )}
        {tab === 'presets' && (
          <>
            <h3 className="sec">{tr("Inference packages")}</h3>
            <p className="muted pad12 tight">{tr("Packages run inside a Knowledge or Imagination nucleus. Each states its technique and limits.")}</p>
            <ul className="preset-list">
              {PACKAGES.map((p) => {
                const host = mods.find((m) => m.type === p.host)!;
                return (
                  <li key={p.id}>
                    <Item def={host} label={tr(p.short)} payload={{ kind: 'module', def: host, params: { package: p.id } }} onPeek={() => {}} d={d} />
                    <div className="preset-meta">
                      <b>{tr(p.name)}</b>
                      <span className={`badge ${p.status}`}>{p.status === 'available' ? tr('available') : tr('unavailable')}</span>
                      <p>{tr(p.technique)}</p>
                    </div>
                  </li>
                );
              })}
            </ul>
            <h3 className="sec">{tr("Compound systems")}</h3>
            <ul className="preset-list">
              {compounds.map(({ c, src }) => {
                const md = compoundModuleDef(c);
                return (
                  <li key={c.id}>
                    <Item def={md} label={tr(c.name)} payload={{ kind: 'compound', cdef: c, def: md }} onPeek={() => {}} d={d} />
                    <div className="preset-meta"><b>{tr(c.name)}</b><span className="badge">{src}</span><p>{tr(c.description) || tr('{a} in, {b} out', { a: c.inputs.length, b: c.outputs.length })}</p></div>
                  </li>
                );
              })}
            </ul>
          </>
        )}
        {tab === 'examples' && (
          <ul className="ex-list">
            {TEMPLATES.map((t) => (
              <li key={t.id}>
                <button onClick={() => openTemplate(t)} className="ex">
                  <b>{tr(t.name)}</b>
                  <span>{tr(t.summary)}</span>
                  <i>{tr("Expected:")} {tr(t.expect)}</i>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
      {tab === 'modules' && (
        <div className="peek" aria-live="polite">
          {peek ? (<><b>{peek.name}</b><span className="tag">{tr(peek.category)}</span><p>{peek.doc.summary}</p></>) : <p className="muted">{tr("Hover a module to read what it does. Drag it onto the workspace, or press Enter on it to add it.")}</p>}
        </div>
      )}
      {d.ghostEl}
    </aside>
  );
}
