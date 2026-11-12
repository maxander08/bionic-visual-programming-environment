import { tr } from './i18n';
import { useCallback, useEffect, useRef } from 'react';
import { bridge, useStore } from './state/store';
import { autosave } from './state/storage';
import { saveToBrowser } from './state/actions';
import { pause, play, stepOnce, stop } from './runtime/session';
import { applyMotionPreference } from './ui/motion';
import { Canvas } from './ui/Canvas';
import { Library } from './ui/Library';
import { Inspector } from './ui/Inspector';
import { Minimap, StatusBar, Toolbar } from './ui/Chrome';
import { Dialogs, Toasts } from './ui/Dialogs';

function Resizer({ side }: { side: 'left' | 'right' }) {
  const setUi = useStore((s) => s.setUi);
  const w = useStore((s) => (side === 'left' ? s.ui.libW : s.ui.inspW));
  const key = side === 'left' ? 'libW' : 'inspW';
  const clamp = (v: number) => Math.max(220, Math.min(520, v));
  const down = (e: React.PointerEvent) => {
    e.preventDefault();
    const x0 = e.clientX, w0 = w;
    const move = (ev: PointerEvent) => setUi({ [key]: clamp(w0 + (side === 'left' ? ev.clientX - x0 : x0 - ev.clientX)) } as any);
    const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };
  return (
    <div className={`resizer ${side}`} role="separator" aria-orientation="vertical" aria-label={tr(side === 'left' ? 'Resize library' : 'Resize inspector')} aria-valuenow={w} aria-valuemin={220} aria-valuemax={520} tabIndex={0}
      onPointerDown={down} onKeyDown={(e) => { if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') { e.preventDefault(); const d = (e.key === 'ArrowRight' ? 1 : -1) * (side === 'left' ? 1 : -1) * 16; setUi({ [key]: clamp(w + d) } as any); } }} />
  );
}

export default function App() {
  const project = useStore((s) => s.project);
  const ui = useStore((s) => s.ui);
  const settings = useStore((s) => s.settings);

  // motion preference
  useEffect(() => {
    applyMotionPreference(settings.motion);
    const mq = matchMedia('(prefers-reduced-motion: reduce)');
    const h = () => applyMotionPreference(useStore.getState().settings.motion);
    mq.addEventListener?.('change', h);
    return () => mq.removeEventListener?.('change', h);
  }, [settings.motion]);

  // autosave (debounced)
  const timer = useRef(0);
  useEffect(() => {
    useStore.setState({ saveState: useStore.getState().saveState === 'unavailable' ? 'unavailable' : 'unsaved' });
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => {
      const ok = autosave.write(useStore.getState().project);
      useStore.setState({ saveState: ok ? 'saved' : 'unavailable' });
    }, 600);
    return () => window.clearTimeout(timer.current);
  }, [project.graph, project.compounds, project.name, project.description, project.author]);

  const onKey = useCallback((e: KeyboardEvent) => {
    const t = e.target as HTMLElement;
    const typing = !!t.closest('input,textarea,select,[contenteditable="true"]');
    const st = useStore.getState();
    if (st.ui.dialog) return;
    const mod = e.metaKey || e.ctrlKey;
    if (mod && e.key.toLowerCase() === 'z') { if (typing) return; e.preventDefault(); e.shiftKey ? st.redo() : st.undo(); return; }
    if (mod && e.key.toLowerCase() === 'y') { if (typing) return; e.preventDefault(); st.redo(); return; }
    if (mod && e.key.toLowerCase() === 's') { e.preventDefault(); saveToBrowser(); return; }
    if (typing) return;
    if (mod && e.key.toLowerCase() === 'd') { e.preventDefault(); st.duplicateSelection(); return; }
    if (mod && e.key.toLowerCase() === 'a') { e.preventDefault(); st.select(Object.keys(st.project.graph.nodes)); return; }
    if (mod && e.key.toLowerCase() === 'g') { e.preventDefault(); if (st.selection.length) st.openDialog('group'); return; }
    if (mod) return;
    if (e.key === ' ' && t.tagName !== 'BUTTON') { e.preventDefault(); st.run === 'running' ? pause() : play(); }
    else if (e.key === '.') stepOnce();
    else if (e.key === 'Escape') { if (st.selection.length || st.selEdge) st.select([]); else if (st.run !== 'stopped') stop(); }
    else if (e.key === 'Delete' || e.key === 'Backspace') { if (st.selection.length || st.selEdge) { e.preventDefault(); st.removeSelection(); } }
    else if (e.key === 'F') bridge.focus?.(st.selection);
    else if (e.key === 'f') bridge.fit?.();
  }, []);
  useEffect(() => {
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onKey]);

  // expose for automated browser tests
  useEffect(() => { (window as any).__ns = { useStore }; }, []);

  return (
    <div className="app">
      <Toolbar />
      <div className="main">
        {ui.lib && (
          <div className="side left" style={{ width: ui.libW }}>
            <Library />
            <Resizer side="left" />
          </div>
        )}
        <main className="stage">
          <Canvas main graph={project.graph} compounds={project.compounds} />
          {settings.minimap && <Minimap graph={project.graph} compounds={project.compounds} />}
        </main>
        {ui.insp && (
          <div className="side right" style={{ width: ui.inspW }}>
            <Resizer side="right" />
            <Inspector />
          </div>
        )}
      </div>
      <StatusBar />
      <Dialogs />
      <Toasts />
    </div>
  );
}
