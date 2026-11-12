import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import qrcode from 'qrcode-generator';
import { TEMPLATES } from '../core/library';
import { QR_BYTE_LIMIT, encodeShare, sha256Hex } from '../core/project';
import { crc32, fmtNum } from '../core/util';
import type { Plot } from '../core/equation';
import { engine, useNodeVer } from '../runtime/session';
import { storageAvailable, projects, clearAll } from '../state/storage';
import { useStore } from '../state/store';
import { exportJSON, importCode, importFile, openWithBackup, openTemplate, download, fileSlug } from '../state/actions';
import { Canvas } from './Canvas';
import { Icon } from './icons';
import { Docs } from './docs/Docs';
import { CURVE_COLORS, EquationPlot } from './EquationPlot';
import { LANGS, tr } from '../i18n';

function Modal({ title, onClose, children, wide, label }: { title: string; onClose: () => void; children: ReactNode; wide?: boolean; label?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const prev = useRef<Element | null>(null);
  useEffect(() => {
    prev.current = document.activeElement;
    const el = ref.current!;
    const focusables = () => [...el.querySelectorAll<HTMLElement>('button,[href],input,select,textarea,[tabindex]:not([tabindex="-1"])')].filter((x) => !x.hasAttribute('disabled'));
    (el.querySelector<HTMLElement>('[data-autofocus]') ?? focusables()[0] ?? el).focus();
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.stopPropagation(); onClose(); }
      if (e.key === 'Tab') {
        const f = focusables();
        if (!f.length) return;
        const first = f[0], last = f[f.length - 1];
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      }
    };
    window.addEventListener('keydown', key, true);
    return () => { window.removeEventListener('keydown', key, true); (prev.current as HTMLElement | null)?.focus?.(); };
  }, [onClose]);
  return (
    <div className="overlay" onPointerDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div ref={ref} className={`modal ${wide ? 'wide' : ''}`} role="dialog" aria-modal="true" aria-label={label ?? title} tabIndex={-1}>
        <div className="modal-head"><h2>{title}</h2><button className="icon-btn" aria-label={tr("Close dialog")} onClick={onClose}><Icon name="close" size={16} /></button></div>
        <div className="modal-body">{children}</div>
      </div>
    </div>
  );
}

function Confirm({ onClose }: { onClose: () => void }) {
  const a = useStore((s) => s.ui.arg) as { title: string; body: string; confirm: string; danger?: boolean; onConfirm: () => void };
  return (
    <Modal title={a.title} onClose={onClose}>
      <p className="prose">{a.body}</p>
      <div className="btn-row end"><button className="btn" onClick={onClose}>{tr("Cancel")}</button><button data-autofocus className={`btn ${a.danger ? 'danger solid' : 'primary'}`} onClick={() => { onClose(); a.onConfirm(); }}>{a.confirm}</button></div>
    </Modal>
  );
}

function Group({ onClose }: { onClose: () => void }) {
  const [name, setName] = useState('My compound');
  const ids = useStore((s) => s.selection);
  return (
    <Modal title={tr("Group as compound")} onClose={onClose}>
      <p className="prose">{tr(ids.length === 1 ? "{n} module will be wrapped into one reusable compound. Connections that cross the boundary become its inputs and outputs." : "{n} modules will be wrapped into one reusable compound. Connections that cross the boundary become its inputs and outputs.", { n: ids.length })}</p>
      <div className="field"><label htmlFor="gname">{tr("Name")}</label><input id="gname" data-autofocus type="text" value={name} maxLength={60} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { onClose(); useStore.getState().groupSelection(name); } }} /></div>
      <div className="btn-row end"><button className="btn" onClick={onClose}>{tr("Cancel")}</button><button className="btn primary" onClick={() => { onClose(); useStore.getState().groupSelection(name); }}>{tr("Create compound")}</button></div>
    </Modal>
  );
}

function Templates({ onClose }: { onClose: () => void }) {
  return (
    <Modal title={tr("Example programs")} onClose={onClose} wide>
      <p className="prose">{tr("Each example is built from the real module registry and runs on the same engine as your own programs. Your current program is kept under Saved programs.")}</p>
      <ul className="tpl-grid">
        {TEMPLATES.map((t) => (
          <li key={t.id}>
            <button className="tpl" onClick={() => openTemplate(t)}>
              <b>{tr(t.name)}</b><span>{tr(t.summary)}</span><i><u>{tr("Expected:")}</u> {tr(t.expect)}</i>
            </button>
          </li>
        ))}
      </ul>
    </Modal>
  );
}

function Projects({ onClose }: { onClose: () => void }) {
  const [list, setList] = useState(projects.list());
  const [code, setCode] = useState('');
  const file = useRef<HTMLInputElement>(null);
  const st = useStore.getState();
  return (
    <Modal title={tr("Open or import")} onClose={onClose}>
      <h3 className="sec">{tr("Saved programs")} {storageAvailable() ? '' : tr("(storage unavailable)")}</h3>
      {!storageAvailable() && <p className="callout warn"><Icon name="alert" size={14} />{tr("Browser storage is not available here (private mode or restricted file access). Use Export and Import files instead.")}</p>}
      {list.length === 0 ? <p className="muted">{tr("Nothing saved yet. Use File → Save in browser.")}</p> : (
        <ul className="saved-list">
          {list.map((p) => (
            <li key={p.id}>
              <button className="saved-open" onClick={() => { const pr = projects.load(p.id); if (pr) { openWithBackup(pr, tr('Opened “{name}”.', { name: pr.name })); onClose(); } else st.toast(tr("That saved program is damaged and could not be opened."), 'error'); }}>
                <b>{p.name}</b><span>{tr("{n} modules · {date}", { n: p.nodes, date: new Date(p.modified).toLocaleString() })}</span>
              </button>
              <button className="icon-btn" aria-label={tr('Delete saved program {name}', { name: p.name })} onClick={() => { projects.remove(p.id); setList(projects.list()); }}><Icon name="trash" size={14} /></button>
            </li>
          ))}
        </ul>
      )}
      <h3 className="sec">{tr("Import")}</h3>
      <div className="btn-row"><button className="btn" onClick={() => file.current?.click()}><Icon name="open" size={14} />{tr("Choose program file…")}</button>
        <input ref={file} type="file" accept=".json,.txt,application/json,text/plain" hidden onChange={async (e) => { const f = e.target.files?.[0]; if (f && (await importFile(f))) onClose(); e.target.value = ''; }} /></div>
      <div className="field"><label htmlFor="icode">{tr("Or paste a share code")}</label><textarea id="icode" className="mono" rows={3} value={code} placeholder={tr("NS1.…")} spellCheck={false} onChange={(e) => setCode(e.target.value)} /></div>
      <div className="btn-row end"><button className="btn primary" disabled={!code.trim()} onClick={() => { if (importCode(code)) onClose(); }}>{tr("Import code")}</button></div>
    </Modal>
  );
}

function QR({ text }: { text: string }) {
  const r = useMemo(() => {
    if (text.length > QR_BYTE_LIMIT) return { error: tr('This program’s code is {n} characters, above the {limit}-character limit a QR code can reliably hold. Use the code text or Export file instead.', { n: text.length, limit: QR_BYTE_LIMIT }) };
    try {
      const q = qrcode(0, 'L');
      q.addData(text, 'Byte');
      q.make();
      const n = q.getModuleCount();
      let d = '';
      for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) if (q.isDark(y, x)) d += `M${x} ${y}h1v1h-1z`;
      return { n, d };
    } catch {
      return { error: tr("The code is too large to fit in a QR code. Use the code text or Export file instead.") };
    }
  }, [text]);
  if ('error' in r) return <p className="callout warn"><Icon name="alert" size={14} />{r.error}</p>;
  return (
    <figure className="qr">
      <svg viewBox={`-3 -3 ${r.n! + 6} ${r.n! + 6}`} role="img" aria-label={tr("QR code containing the share code")} shapeRendering="crispEdges"><path d={r.d} fill="#a0fbe8" /></svg>
      <figcaption>{tr("Scan to read the share code as text. Paste it into Import.")}</figcaption>
    </figure>
  );
}

function Share({ onClose }: { onClose: () => void }) {
  const project = useStore((s) => s.project);
  const code = useMemo(() => encodeShare(project), [project]);
  const [sha, setSha] = useState<string | null | undefined>(undefined);
  const [paste, setPaste] = useState('');
  const [copied, setCopied] = useState(false);
  useEffect(() => { let on = true; sha256Hex(code).then((h) => on && setSha(h)); return () => { on = false; }; }, [code]);
  const st = useStore.getState();
  const copy = async () => {
    try { await navigator.clipboard.writeText(code); setCopied(true); setTimeout(() => setCopied(false), 1600); st.toast(tr("Share code copied."), 'ok'); }
    catch { const ta = document.getElementById('scode') as HTMLTextAreaElement | null; ta?.select(); st.toast(tr("Clipboard is blocked here. The code is selected: press Ctrl/⌘+C."), 'info'); }
  };
  return (
    <Modal title={tr("Share")} onClose={onClose} wide>
      <div className="share-grid">
        <div>
          <h3 className="sec">{tr("Share code")}</h3>
          <p className="prose">{tr("The whole program, compressed into text. Anyone can paste it into Import to get a copy.")}</p>
          <textarea id="scode" className="mono code" readOnly rows={6} value={code} aria-label={tr("Share code")} onFocus={(e) => e.currentTarget.select()} />
          <div className="btn-row">
            <button className="btn primary" data-autofocus onClick={copy}><Icon name={copied ? 'check' : 'copy'} size={14} />{copied ? tr("Copied") : tr("Copy code")}</button>
            <button className="btn" onClick={() => { exportJSON(); }}><Icon name="save" size={14} />{tr("Export file")}</button>
            <button className="btn" onClick={() => download(`${fileSlug(project.name)}.nscode.txt`, code, 'text/plain')}>{tr("Download code")}</button>
          </div>
          <p className="stat-line">{tr("{c} characters · {n} modules", { c: code.length, n: Object.keys(project.graph.nodes).length })}</p>
          <dl className="integrity">
            <dt>{tr("CRC-32 checksum")}</dt><dd className="mono">{crc32(code.split('.')[1] ?? '').toString(16).padStart(8, '0')}</dd>
            <dt>{tr("SHA-256 fingerprint")}</dt><dd className="mono">{sha === undefined ? tr('computing…') : sha ?? tr('unavailable in this context')}</dd>
          </dl>
          <p className="doc">{tr("The checksum is embedded in the code and detects accidental corruption. The fingerprint identifies exact content. Neither is a signature: they do not prove who made the program, and anyone can create a valid code for edited content. Codes are not encrypted, permanent, or tamper-proof.")}</p>
        </div>
        <div>
          <h3 className="sec">{tr("QR code")}</h3>
          <QR text={code} />
        </div>
      </div>
      <h3 className="sec">{tr("Import a code")}</h3>
      <div className="field"><textarea className="mono" rows={2} value={paste} placeholder={tr("Paste a share code (NS1.…)")} aria-label={tr("Paste share code to import")} spellCheck={false} onChange={(e) => setPaste(e.target.value)} /></div>
      <div className="btn-row end"><button className="btn" disabled={!paste.trim()} onClick={() => { if (importCode(paste)) onClose(); }}>{tr("Import as new program")}</button></div>
    </Modal>
  );
}

function Settings({ onClose }: { onClose: () => void }) {
  const s = useStore((x) => x.settings);
  const set = useStore((x) => x.setSettings);
  const st = useStore.getState();
  return (
    <Modal title={tr("Workspace settings")} onClose={onClose}>
      <h3 className="sec first">{tr("Language")}</h3>
      <div className="lang-grid" role="radiogroup" aria-label={tr("Interface language")}>
        {LANGS.map((l) => (
          <button key={l.code} type="button" role="radio" aria-checked={s.language === l.code} lang={l.tag} className={`lang-opt ${s.language === l.code ? 'on' : ''}`} onClick={() => set({ language: l.code })}>
            <b>{l.native}</b><span className="mono">{l.tag}</span>
          </button>
        ))}
      </div>
      <p className="doc">{tr("Changes the language of the whole editor and is remembered in this browser. A Set Language module (library → Workspace Settings) can switch it from inside a program.")}</p>
      <h3 className="sec">{tr("Workspace")}</h3>
      <div className="field inline"><label htmlFor="s-snap">{tr("Snap modules to the grid")}</label><button id="s-snap" role="switch" aria-checked={s.snap} className={`toggle ${s.snap ? 'on' : ''}`} onClick={() => set({ snap: !s.snap })}><i /></button><p className="doc">{tr("While dragging, a dashed outline shows where the module will settle.")}</p></div>
      <div className="field inline"><label htmlFor="s-map">{tr("Overview map")}</label><button id="s-map" role="switch" aria-checked={s.minimap} className={`toggle ${s.minimap ? 'on' : ''}`} onClick={() => set({ minimap: !s.minimap })}><i /></button></div>
      <div className="field"><label htmlFor="s-motion">{tr("Motion")}</label>
        <select id="s-motion" value={s.motion} onChange={(e) => set({ motion: e.target.value as any })}><option value="system">{tr("Follow system setting")}</option><option value="reduced">{tr("Reduce motion")}</option><option value="full">{tr("Full motion")}</option></select>
        <p className="doc">{tr("Reduced motion removes camera transitions and settling movement; state changes stay visible.")}</p></div>
      <div className="field"><label htmlFor="s-tick">{tr("Simulation tick")}</label>
        <select id="s-tick" value={s.tickMs} onChange={(e) => set({ tickMs: Number(e.target.value) })}>{[10, 20, 25, 50, 100, 200].map((t) => <option key={t} value={t}>{tr("{ms} ms ({hz} Hz)", { ms: t, hz: Math.round(1000 / t) })}</option>)}</select>
        <p className="doc">{tr("Time resolution of the engine. Shorter ticks give finer timing but evaluate more often. Output values never depend on screen refresh.")}</p></div>
      <div className="field"><label htmlFor="s-speed">{tr("Simulation speed")}</label>
        <select id="s-speed" value={s.speed} onChange={(e) => set({ speed: Number(e.target.value) })}>{[0.25, 0.5, 1, 2, 4].map((t) => <option key={t} value={t}>×{t}</option>)}</select></div>
      <h3 className="sec">{tr("Storage")}</h3>
      <p className="prose">{storageAvailable() ? tr("Autosave and saved programs use this browser’s local storage.") : tr("Local storage is unavailable. Use File → Export to keep your work.")}</p>
      <div className="btn-row"><button className="btn danger" onClick={() => st.confirm({ title: tr("Erase all saved data?"), body: tr("This deletes autosave, saved programs, your compound library and settings from this browser. The current workspace stays open until you reload."), confirm: tr("Erase data"), danger: true, onConfirm: () => { clearAll(); st.toast(tr("Browser data erased."), 'ok'); } })}>{tr("Erase browser data…")}</button></div>
      <h3 className="sec">{tr("About")}</h3>
      <p className="prose">{tr("Inspired by the workflow of NEURO by THIX; an independent implementation with original code and assets. Typeface: “TT Autonomous” is requested first; the bundled fallback is JetBrains Mono.")}</p>
    </Modal>
  );
}

function CompoundViewer({ onClose }: { onClose: () => void }) {
  const arg = useStore((s) => s.ui.arg) as { defId: string; nodeId: string };
  const def = useStore((s) => s.project.compounds[arg.defId]);
  const compounds = useStore((s) => s.project.compounds);
  if (!def) return null;
  return (
    <Modal title={tr('Inside “{name}”', { name: def.name })} onClose={onClose} wide>
      <p className="prose">{tr("Read-only view of the compound’s internal graph. Live values appear while the program runs. Change its exposed settings from the inspector.")}</p>
      <div className="viewer"><Canvas graph={def.graph} compounds={compounds} prefix={`${arg.nodeId}/`} ro /></div>
    </Modal>
  );
}

function MeterGraph({ onClose }: { onClose: () => void }) {
  const id = useStore((s) => s.ui.arg) as string;
  useNodeVer(id);
  const v = (engine.nodes.get(id)?.viewData ?? {}) as any;
  const plot = v.plot as Plot | undefined;
  return (
    <Modal title={tr("Graph")} onClose={onClose} wide>
      <div className="graph-full" aria-live="polite">
        {plot ? <EquationPlot plot={plot} detail /> : <p className="muted">{tr("No equation yet. Route an Equation node to this Meter and press Run.")}</p>}
      </div>
      {plot && (
        <ul className="graph-legend">
          {plot.curves.map((c, i) => <li key={i}><i style={{ background: CURVE_COLORS[i % CURVE_COLORS.length] }} /><code>{c.expr}</code></li>)}
          <li className="muted">x ∈ [{fmtNum(plot.xMin)}, {fmtNum(plot.xMax)}] · y ∈ [{fmtNum(plot.yMin, 3)}, {fmtNum(plot.yMax, 3)}]{plot.usesT ? ` · t = ${fmtNum(plot.t, 2)} s` : ''}</li>
        </ul>
      )}
    </Modal>
  );
}

export function Dialogs() {
  const d = useStore((s) => s.ui.dialog);
  const setUi = useStore((s) => s.setUi);
  const close = () => setUi({ dialog: null });
  switch (d) {
    case 'confirm': return <Confirm onClose={close} />;
    case 'group': return <Group onClose={close} />;
    case 'templates': return <Templates onClose={close} />;
    case 'projects': return <Projects onClose={close} />;
    case 'share': return <Share onClose={close} />;
    case 'docs': return <Docs onClose={close} />;
    case 'settings': return <Settings onClose={close} />;
    case 'compound': return <CompoundViewer onClose={close} />;
    case 'meter': return <MeterGraph onClose={close} />;
    default: return null;
  }
}

export function Toasts() {
  const toasts = useStore((s) => s.toasts);
  const dismiss = useStore((s) => s.dismissToast);
  return (
    <div className="toasts" role="status" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className={`toast ${t.kind}`}><span>{t.msg}</span><button className="icon-btn sm" aria-label={tr("Dismiss notification")} onClick={() => dismiss(t.id)}><Icon name="close" size={12} /></button></div>
      ))}
    </div>
  );
}
