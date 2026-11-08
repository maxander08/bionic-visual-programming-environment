import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import qrcode from 'qrcode-generator';
import { CATEGORIES, MODULES, getDef } from '../core/registry';
import { PACKAGES } from '../core/packages';
import { TEMPLATES } from '../core/library';
import { QR_BYTE_LIMIT, encodeShare, sha256Hex } from '../core/project';
import { crc32, describe, fmtNum } from '../core/util';
import type { Plot } from '../core/equation';
import { engine, useNodeVer } from '../runtime/session';
import { storageAvailable, projects, clearAll } from '../state/storage';
import { useStore } from '../state/store';
import { exportJSON, importCode, importFile, openWithBackup, openTemplate, download, fileSlug } from '../state/actions';
import { Canvas } from './Canvas';
import { Icon } from './icons';
import { DocBlock } from './Inspector';
import { ImageCanvas } from './NodeView';
import { CURVE_COLORS, EquationPlot } from './EquationPlot';

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
        <div className="modal-head"><h2>{title}</h2><button className="icon-btn" aria-label="Close dialog" onClick={onClose}><Icon name="close" size={16} /></button></div>
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
      <div className="btn-row end"><button className="btn" onClick={onClose}>Cancel</button><button data-autofocus className={`btn ${a.danger ? 'danger solid' : 'primary'}`} onClick={() => { onClose(); a.onConfirm(); }}>{a.confirm}</button></div>
    </Modal>
  );
}

function Group({ onClose }: { onClose: () => void }) {
  const [name, setName] = useState('My compound');
  const ids = useStore((s) => s.selection);
  return (
    <Modal title="Group as compound" onClose={onClose}>
      <p className="prose">{ids.length} module{ids.length === 1 ? '' : 's'} will be wrapped into one reusable compound. Connections that cross the boundary become its inputs and outputs.</p>
      <div className="field"><label htmlFor="gname">Name</label><input id="gname" data-autofocus type="text" value={name} maxLength={60} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { onClose(); useStore.getState().groupSelection(name); } }} /></div>
      <div className="btn-row end"><button className="btn" onClick={onClose}>Cancel</button><button className="btn primary" onClick={() => { onClose(); useStore.getState().groupSelection(name); }}>Create compound</button></div>
    </Modal>
  );
}

function Templates({ onClose }: { onClose: () => void }) {
  return (
    <Modal title="Example programs" onClose={onClose} wide>
      <p className="prose">Each example is built from the real module registry and runs on the same engine as your own programs. Your current program is kept under Saved programs.</p>
      <ul className="tpl-grid">
        {TEMPLATES.map((t) => (
          <li key={t.id}>
            <button className="tpl" onClick={() => openTemplate(t)}>
              <b>{t.name}</b><span>{t.summary}</span><i><u>Expected:</u> {t.expect}</i>
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
    <Modal title="Open or import" onClose={onClose}>
      <h3 className="sec">Saved programs {storageAvailable() ? '' : '(storage unavailable)'}</h3>
      {!storageAvailable() && <p className="callout warn"><Icon name="alert" size={14} />Browser storage is not available here (private mode or restricted file access). Use Export and Import files instead.</p>}
      {list.length === 0 ? <p className="muted">Nothing saved yet. Use File → Save in browser.</p> : (
        <ul className="saved-list">
          {list.map((p) => (
            <li key={p.id}>
              <button className="saved-open" onClick={() => { const pr = projects.load(p.id); if (pr) { openWithBackup(pr, `Opened “${pr.name}”.`); onClose(); } else st.toast('That saved program is damaged and could not be opened.', 'error'); }}>
                <b>{p.name}</b><span>{p.nodes} modules · {new Date(p.modified).toLocaleString()}</span>
              </button>
              <button className="icon-btn" aria-label={`Delete saved program ${p.name}`} onClick={() => { projects.remove(p.id); setList(projects.list()); }}><Icon name="trash" size={14} /></button>
            </li>
          ))}
        </ul>
      )}
      <h3 className="sec">Import</h3>
      <div className="btn-row"><button className="btn" onClick={() => file.current?.click()}><Icon name="open" size={14} />Choose program file…</button>
        <input ref={file} type="file" accept=".json,.txt,application/json,text/plain" hidden onChange={async (e) => { const f = e.target.files?.[0]; if (f && (await importFile(f))) onClose(); e.target.value = ''; }} /></div>
      <div className="field"><label htmlFor="icode">Or paste a share code</label><textarea id="icode" className="mono" rows={3} value={code} placeholder="NS1.…" spellCheck={false} onChange={(e) => setCode(e.target.value)} /></div>
      <div className="btn-row end"><button className="btn primary" disabled={!code.trim()} onClick={() => { if (importCode(code)) onClose(); }}>Import code</button></div>
    </Modal>
  );
}

function QR({ text }: { text: string }) {
  const r = useMemo(() => {
    if (text.length > QR_BYTE_LIMIT) return { error: `This program’s code is ${text.length} characters, above the ${QR_BYTE_LIMIT}-character limit a QR code can reliably hold. Use the code text or Export file instead.` };
    try {
      const q = qrcode(0, 'L');
      q.addData(text, 'Byte');
      q.make();
      const n = q.getModuleCount();
      let d = '';
      for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) if (q.isDark(y, x)) d += `M${x} ${y}h1v1h-1z`;
      return { n, d };
    } catch {
      return { error: 'The code is too large to fit in a QR code. Use the code text or Export file instead.' };
    }
  }, [text]);
  if ('error' in r) return <p className="callout warn"><Icon name="alert" size={14} />{r.error}</p>;
  return (
    <figure className="qr">
      <svg viewBox={`-3 -3 ${r.n! + 6} ${r.n! + 6}`} role="img" aria-label="QR code containing the share code" shapeRendering="crispEdges"><path d={r.d} fill="#a0fbe8" /></svg>
      <figcaption>Scan to read the share code as text. Paste it into Import.</figcaption>
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
    try { await navigator.clipboard.writeText(code); setCopied(true); setTimeout(() => setCopied(false), 1600); st.toast('Share code copied.', 'ok'); }
    catch { const ta = document.getElementById('scode') as HTMLTextAreaElement | null; ta?.select(); st.toast('Clipboard is blocked here. The code is selected: press Ctrl/⌘+C.', 'info'); }
  };
  return (
    <Modal title="Share" onClose={onClose} wide>
      <div className="share-grid">
        <div>
          <h3 className="sec">Share code</h3>
          <p className="prose">The whole program, compressed into text. Anyone can paste it into Import to get a copy.</p>
          <textarea id="scode" className="mono code" readOnly rows={6} value={code} aria-label="Share code" onFocus={(e) => e.currentTarget.select()} />
          <div className="btn-row">
            <button className="btn primary" data-autofocus onClick={copy}><Icon name={copied ? 'check' : 'copy'} size={14} />{copied ? 'Copied' : 'Copy code'}</button>
            <button className="btn" onClick={() => { exportJSON(); }}><Icon name="save" size={14} />Export file</button>
            <button className="btn" onClick={() => download(`${fileSlug(project.name)}.nscode.txt`, code, 'text/plain')}>Download code</button>
          </div>
          <p className="stat-line">{code.length} characters · {Object.keys(project.graph.nodes).length} modules</p>
          <dl className="integrity">
            <dt>CRC-32 checksum</dt><dd className="mono">{crc32(code.split('.')[1] ?? '').toString(16).padStart(8, '0')}</dd>
            <dt>SHA-256 fingerprint</dt><dd className="mono">{sha === undefined ? 'computing…' : sha ?? 'unavailable in this context'}</dd>
          </dl>
          <p className="doc">The checksum is embedded in the code and detects accidental corruption. The fingerprint identifies exact content. Neither is a signature: they do not prove who made the program, and anyone can create a valid code for edited content. Codes are not encrypted, permanent, or tamper-proof.</p>
        </div>
        <div>
          <h3 className="sec">QR code</h3>
          <QR text={code} />
        </div>
      </div>
      <h3 className="sec">Import a code</h3>
      <div className="field"><textarea className="mono" rows={2} value={paste} placeholder="Paste a share code (NS1.…)" aria-label="Paste share code to import" spellCheck={false} onChange={(e) => setPaste(e.target.value)} /></div>
      <div className="btn-row end"><button className="btn" disabled={!paste.trim()} onClick={() => { if (importCode(paste)) onClose(); }}>Import as new program</button></div>
    </Modal>
  );
}

const GUIDE: [string, ReactNode][] = [
  ['What this is', <p key="a">Neural Studio is an original, NEURO-inspired visual programming environment. It is not an official THIX product and does not claim to reproduce NEURO’s internals. The cognitive modules are small, well-defined signal processors: they do not model consciousness or human cognition.</p>],
  ['Building a program', <ul key="b"><li>Drag modules from the library, or press Enter on one to add it at the center.</li><li>Drag from a module’s edge tab to another module’s tab to connect. Compatible inputs light up; incompatible ones dim and a message explains why.</li><li>Dragging from a connected input unplugs and re-routes it; dropping on empty space removes it.</li><li>Shift+click or Shift+drag selects several. Group them as a compound to reuse them.</li></ul>],
  ['Signals', <><p>Every connection carries a value (number, boolean, text, image or structured data) plus a <b>strength</b> (0–1+). Connection weights scale strength. Compatible types are converted automatically (number ↔ boolean, anything → text); text cannot drive a number input.</p><p>An input has exactly one source. Output fan-out is unlimited. A connection can also add a propagation delay.</p></>],
  ['Execution model', <><p>A deterministic simulation clock advances in fixed ticks (default 50 ms). It does not depend on screen refresh. A module runs only when a signal arrived, a timer it set came due, a sensor delivered data, or when it starts. Within a tick modules run in dependency order, so each runs at most once.</p><p><b>Missing inputs:</b> a module whose required input has no signal stays idle and emits nothing; optional inputs never block. <b>Errors:</b> a failing module clears its outputs, shows ×, and downstream modules show a warning.</p></>],
  ['Feedback loops', <p key="f">A connection that closes a cycle is delivered one tick late if the cycle contains a delaying module (Delay, Smooth, Register, Memory, State, Counter, Nap, Envelope, Fear, Reward, …). Otherwise the cycle is unbounded: the closing connection is blocked, drawn dashed red, and reported. Runaway protection halts execution if timers or propagation explode.</p>],
  ['Sensors and permissions', <ul key="s"><li>Every sensor has a simulated source that works offline with no hardware.</li><li>Camera and microphone need a device, a secure context (https or localhost) and your permission. Their state (requesting, denied, unavailable, live) is shown honestly in the inspector and diagnostics.</li><li>Device orientation needs a motion sensor; iOS asks for permission when you press Run.</li><li>Sound is locked by browsers until you press Run or Step. Notifications need permission; vibration is unsupported on iOS and desktops.</li></ul>],
  ['Inference packages', <ul key="m">{PACKAGES.map((p) => <li key={p.id}><b>{p.name}</b> ({p.status}): {p.technique} Requires: {p.requirements} Limits: {p.limitations}</li>)}</ul>],
  ['Saving and sharing', <ul key="sv"><li>Autosave keeps the latest state in this browser. If storage is blocked, use Export file.</li><li>Share codes (NS1.…) are compressed text with a CRC-32 check. A checksum catches accidents; it is not a signature and does not prove authorship.</li><li>Programs larger than a QR code can hold show a clear message instead of a broken code.</li></ul>],
  ['Offline and typography', <p key="o">This is a single HTML file. Scripts, styles, icons and the fallback typeface are embedded; nothing is fetched. The interface asks for “TT Autonomous” first (used if installed on your device). That typeface is commercially licensed and could not be embedded, so JetBrains Mono (SIL OFL) is bundled as the fallback.</p>],
  ['Keyboard', <ul key="k" className="kbd-list"><li><kbd>Space</kbd> run / pause</li><li><kbd>.</kbd> step one tick</li><li><kbd>Esc</kbd> stop (or close)</li><li><kbd>Ctrl/⌘ Z</kbd> undo, <kbd>⇧</kbd> redo</li><li><kbd>Ctrl/⌘ D</kbd> duplicate</li><li><kbd>Ctrl/⌘ A</kbd> select all</li><li><kbd>Ctrl/⌘ G</kbd> group</li><li><kbd>Delete</kbd> remove</li><li><kbd>F</kbd> fit, <kbd>⇧ F</kbd> focus</li><li><kbd>Tab</kbd> next module, arrows move it</li><li><kbd>/</kbd> search library</li></ul>],
];

function Docs({ onClose }: { onClose: () => void }) {
  const sel = useStore((s) => s.selection);
  const graph = useStore((s) => s.project.graph);
  const compounds = useStore((s) => s.project.compounds);
  const node = sel.length === 1 ? graph.nodes[sel[0]] : undefined;
  const def = node && getDef(node.type, compounds, node.params);
  const [type, setType] = useState<string | null>(null);
  const shown = type ? MODULES.find((m) => m.type === type) : def;
  return (
    <Modal title="Documentation" onClose={onClose} wide>
      <div className="docs-layout">
        <nav className="docs-nav" aria-label="Documentation sections">
          <h3 className="sec">Guide</h3>
          {GUIDE.map(([t]) => <a key={t} href={`#g-${t.replace(/\W+/g, '-')}`} onClick={(e) => { e.preventDefault(); document.getElementById(`g-${t.replace(/\W+/g, '-')}`)?.scrollIntoView({ block: 'start' }); }}>{t}</a>)}
          {CATEGORIES.map((c) => (
            <div key={c}><h3 className="sec">{c}</h3>{MODULES.filter((m) => m.category === c).map((m) => <button key={m.type} className={shown?.type === m.type ? 'on' : ''} onClick={() => { setType(m.type); document.getElementById('g-module')?.scrollIntoView({ block: 'start' }); }}>{m.name}</button>)}</div>
          ))}
        </nav>
        <div className="docs-main">
          <section id="g-module" className="docs-module">
            {shown ? <><h3>{shown.name} <span className="tag">{shown.category}</span>{!type && node && <span className="tag sel">selected</span>}</h3><DocBlock def={shown} node={!type ? node : undefined} />
              <h4>Ports</h4><ul>{[...shown.inputs.map((p) => ['in', p] as const), ...shown.outputs.map((p) => ['out', p] as const)].map(([d, p]) => <li key={d + p.id}><b>{d === 'in' ? 'Input' : 'Output'} {p.label}</b> ({p.type}{p.optional ? ', optional' : ''}): {p.doc}</li>)}</ul>
              <h4>Parameters</h4>{shown.params.length ? <ul>{shown.params.map((p) => <li key={p.key}><b>{p.label}</b>: {p.doc}{p.kind === 'number' ? ` Range ${p.min} to ${p.max}, default ${p.default}.` : ''}</li>)}</ul> : <p className="muted">None.</p>}</>
              : <p className="muted">Select a module in the workspace to see its documentation here, or pick one from the list.</p>}
          </section>
          {GUIDE.map(([t, body]) => <section key={t} id={`g-${t.replace(/\W+/g, '-')}`}><h3>{t}</h3>{body}</section>)}
        </div>
      </div>
    </Modal>
  );
}

function Settings({ onClose }: { onClose: () => void }) {
  const s = useStore((x) => x.settings);
  const set = useStore((x) => x.setSettings);
  const st = useStore.getState();
  return (
    <Modal title="Settings" onClose={onClose}>
      <div className="field inline"><label htmlFor="s-snap">Snap modules to the grid</label><button id="s-snap" role="switch" aria-checked={s.snap} className={`toggle ${s.snap ? 'on' : ''}`} onClick={() => set({ snap: !s.snap })}><i /></button><p className="doc">While dragging, a dashed outline shows where the module will settle.</p></div>
      <div className="field inline"><label htmlFor="s-map">Overview map</label><button id="s-map" role="switch" aria-checked={s.minimap} className={`toggle ${s.minimap ? 'on' : ''}`} onClick={() => set({ minimap: !s.minimap })}><i /></button></div>
      <div className="field"><label htmlFor="s-motion">Motion</label>
        <select id="s-motion" value={s.motion} onChange={(e) => set({ motion: e.target.value as any })}><option value="system">Follow system setting</option><option value="reduced">Reduce motion</option><option value="full">Full motion</option></select>
        <p className="doc">Reduced motion removes camera transitions and settling movement; state changes stay visible.</p></div>
      <div className="field"><label htmlFor="s-tick">Simulation tick</label>
        <select id="s-tick" value={s.tickMs} onChange={(e) => set({ tickMs: Number(e.target.value) })}>{[10, 20, 25, 50, 100, 200].map((t) => <option key={t} value={t}>{t} ms ({Math.round(1000 / t)} Hz)</option>)}</select>
        <p className="doc">Time resolution of the engine. Shorter ticks give finer timing but evaluate more often. Output values never depend on screen refresh.</p></div>
      <div className="field"><label htmlFor="s-speed">Simulation speed</label>
        <select id="s-speed" value={s.speed} onChange={(e) => set({ speed: Number(e.target.value) })}>{[0.25, 0.5, 1, 2, 4].map((t) => <option key={t} value={t}>×{t}</option>)}</select></div>
      <h3 className="sec">Storage</h3>
      <p className="prose">{storageAvailable() ? 'Autosave and saved programs use this browser’s local storage.' : 'Local storage is unavailable. Use File → Export to keep your work.'}</p>
      <div className="btn-row"><button className="btn danger" onClick={() => st.confirm({ title: 'Erase all saved data?', body: 'This deletes autosave, saved programs, your compound library and settings from this browser. The current workspace stays open until you reload.', confirm: 'Erase data', danger: true, onConfirm: () => { clearAll(); st.toast('Browser data erased.', 'ok'); } })}>Erase browser data…</button></div>
      <h3 className="sec">About</h3>
      <p className="prose">Inspired by the workflow of NEURO by THIX; an independent implementation with original code and assets. Typeface: “TT Autonomous” is requested first; the bundled fallback is JetBrains Mono.</p>
    </Modal>
  );
}

function CompoundViewer({ onClose }: { onClose: () => void }) {
  const arg = useStore((s) => s.ui.arg) as { defId: string; nodeId: string };
  const def = useStore((s) => s.project.compounds[arg.defId]);
  const compounds = useStore((s) => s.project.compounds);
  if (!def) return null;
  return (
    <Modal title={`Inside “${def.name}”`} onClose={onClose} wide>
      <p className="prose">Read-only view of the compound’s internal graph. Live values appear while the program runs. Change its exposed settings from the inspector.</p>
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
    <Modal title="Graph" onClose={onClose} wide>
      <div className="graph-full" aria-live="polite">
        {plot ? <EquationPlot plot={plot} detail /> : <p className="muted">No equation yet. Route an Equation node to this Meter and press Run.</p>}
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

function Projector({ onClose }: { onClose: () => void }) {
  const id = useStore((s) => s.ui.arg) as string;
  useNodeVer(id);
  const v = (engine.nodes.get(id)?.viewData ?? {}) as any;
  return (
    <Modal title="Projector" onClose={onClose} wide>
      <div className="proj-full" aria-live="polite">
        {v.kind === 'image' ? <ImageCanvas img={v.image} /> : v.kind ? <div className={v.kind === 'number' ? 'giant' : 'giant txt'}>{v.text}</div> : <p className="muted">No signal. Press Run.</p>}
      </div>
      {v.text && <details className="full-value"><summary>Full value</summary><pre>{describe(v.text)}</pre></details>}
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
    case 'projector': return <Projector onClose={close} />;
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
        <div key={t.id} className={`toast ${t.kind}`}><span>{t.msg}</span><button className="icon-btn sm" aria-label="Dismiss notification" onClick={() => dismiss(t.id)}><Icon name="close" size={12} /></button></div>
      ))}
    </div>
  );
}
