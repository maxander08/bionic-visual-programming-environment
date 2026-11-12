import { memo, useEffect, useMemo, useState, useSyncExternalStore, type ReactElement } from 'react';
import type { CompoundDef, Edge, ModuleDef, NodeInst, ParamDef } from '../core/types';
import { SETTING_PREFIX, getDef, nodeTitle, paramDefsOf, portList } from '../core/registry';
import { packageById } from '../core/packages';
import { checkConnection } from '../core/graph';
import { describe, fmtNum } from '../core/util';
import { findCity, fmtOffset, readClock } from '../core/worldclock';
import { engine, getDiagnostics, useDiagVersion, useNodeVer } from '../runtime/session';
import { getSensorState, sensorVersion, subscribeSensors } from '../runtime/sensors';
import { audio, notificationState, requestNotifications, vibrationSupported } from '../runtime/outputs';
import { bridge, useStore } from '../state/store';
import { Icon } from './icons';
import { tr } from '../i18n';

function NumberField({ p, value, onChange }: { p: Extract<ParamDef, { kind: 'number' }>; value: number; onChange: (v: number) => void }) {
  const [text, setText] = useState(String(value));
  useEffect(() => setText(String(value)), [value]);
  const range = p.max - p.min;
  const sliderOk = range <= 100000;
  const commit = (t: string) => {
    setText(t);
    const n = Number(t);
    if (t.trim() !== '' && Number.isFinite(n)) onChange(Math.min(p.max, Math.max(p.min, n)));
  };
  return (
    <div className="num-field">
      {sliderOk && <input type="range" min={p.min} max={p.max} step={p.step} value={value} aria-label={p.label} onChange={(e) => onChange(Number(e.target.value))} />}
      <div className="num-box">
        <input type="text" inputMode="decimal" value={text} aria-label={tr('{label} value', { label: p.label })} onChange={(e) => commit(e.target.value)} onBlur={() => setText(String(value))}
          onKeyDown={(e) => { if (e.key === 'ArrowUp' || e.key === 'ArrowDown') { e.preventDefault(); const d = (e.key === 'ArrowUp' ? 1 : -1) * p.step * (e.shiftKey ? 10 : 1); onChange(Math.min(p.max, Math.max(p.min, Math.round((value + d) / p.step) * p.step))); } }} />
        {p.unit && <span className="unit">{p.unit}</span>}
      </div>
    </div>
  );
}

/** One shared <datalist>. Memoized so typing in the field never re-renders its thousands of options. */
const Suggestions = memo(function Suggestions({ id, source }: { id: string; source: () => string[] }) {
  return <datalist id={id}>{source().map((s) => <option key={s} value={s} />)}</datalist>;
});

function ParamRow({ p, value, onChange, onAction, driven }: { p: ParamDef; value: unknown; onChange: (v: unknown) => void; onAction?: (c: string) => void; driven?: boolean }) {
  const id = `f-${p.key}`;
  let control: ReactElement;
  switch (p.kind) {
    case 'number': control = <NumberField p={p} value={Number(value)} onChange={onChange} />; break;
    case 'select': control = (
      <select id={id} value={String(value)} onChange={(e) => onChange(e.target.value)}>{p.options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</select>
    ); break;
    case 'bool': control = (
      <button id={id} role="switch" aria-checked={!!value} className={`toggle ${value ? 'on' : ''}`} onClick={() => onChange(!value)}><i /><span className="sr">{p.label}</span></button>
    ); break;
    case 'text': control = p.multiline ? (
      <textarea id={id} rows={3} value={String(value ?? '')} maxLength={p.maxLength} placeholder={p.placeholder} spellCheck={false} onChange={(e) => onChange(e.target.value)} />
    ) : (
      <>
        <input id={id} type="text" value={String(value ?? '')} maxLength={p.maxLength} placeholder={p.placeholder} spellCheck={false} autoComplete="off" list={p.suggest ? `dl-${p.key}` : undefined} onChange={(e) => onChange(e.target.value)} />
        {p.suggest && <Suggestions id={`dl-${p.key}`} source={p.suggest} />}
      </>
    ); break;
    case 'action': control = <button className="btn" onClick={() => onAction?.(p.command)}>{p.label}</button>; break;
  }
  const meta = p.kind === 'number' ? tr('Range {min} to {max} · default {def}{unit}', { min: fmtNum(p.min), max: fmtNum(p.max), def: fmtNum(p.default), unit: p.unit ? ' ' + p.unit : '' }) : p.kind === 'select' ? tr('Default: {value}', { value: String(p.options.find((o) => o.value === p.default)?.label) }) : p.kind === 'bool' ? tr('Default: {value}', { value: p.default ? tr('on') : tr('off') }) : undefined;
  return (
    <div className={`field ${p.kind === 'bool' ? 'inline' : ''}`}>
      <label htmlFor={id}>{p.kind === 'action' ? tr("Action") : p.label}</label>
      {driven ? <fieldset className="driven" disabled>{control}</fieldset> : control}
      {driven && <p className="doc driven-note">{tr("Driven by the “{label}” pin: the connected signal is in effect. Disconnect the pin to edit this setting.", { label: p.label })}</p>}
      <p className="doc">{p.doc}{meta && <span className="meta"> {meta}</span>}</p>
    </div>
  );
}

function ClockInfo({ city }: { city: string }) {
  const c = findCity(city);
  if (!c) return <p className="callout warn"><Icon name="alert" size={14} />{tr("“{city}” is not a known city yet. Start typing and pick one of the suggestions.", { city: city.trim() || '…' })}</p>;
  let off = '';
  try { off = fmtOffset(readClock(c.tz, Date.now(), false, false).offset); } catch { /* unknown zone */ }
  return <p className="doc"><b>{c.label}</b> · {c.tz}{off ? tr(' · {off} now', { off }) : ''} · {tr("population")} {c.pop.toLocaleString('en-US')}</p>;
}

function Section({ title, children, open = true, right }: { title: string; children: React.ReactNode; open?: boolean; right?: React.ReactNode }) {
  const [o, setO] = useState(open);
  return (
    <section className="isec">
      <div className="isec-head"><button className="sec-toggle" aria-expanded={o} onClick={() => setO(!o)}><Icon name="chevron" size={12} /><span>{title}</span></button>{right}</div>
      {o && <div className="isec-body">{children}</div>}
    </section>
  );
}

function PortTable({ node, def }: { node: NodeInst; def: ModuleDef }) {
  const graph = useStore((s) => s.project.graph);
  const compounds = useStore((s) => s.project.compounds);
  const rt = engine.nodes.get(node.id);
  const options = useMemo(() => {
    const o: { id: string; node: string; port: string; label: string; type: string }[] = [];
    for (const n of Object.values(graph.nodes)) {
      if (n.id === node.id) continue;
      const d = getDef(n.type, compounds, n.params);
      d?.outputs.forEach((p) => o.push({ id: `${n.id}|${p.id}`, node: n.id, port: p.id, type: p.type, label: `${nodeTitle(d, n.params)} (${n.id}) → ${p.label}` }));
    }
    return o;
  }, [graph.nodes, compounds, node.id]);
  const st = useStore.getState();
  return (
    <div className="ports">
      {def.inputs.length === 0 && def.outputs.length === 0 && <p className="muted">{tr("This module has no ports.")}</p>}
      {def.inputs.map((p) => {
        const edge = Object.values(graph.edges).find((e) => e.to === node.id && e.toPort === p.id);
        const sig = rt?.inputs[p.id];
        const sel = edge ? `${edge.from}|${edge.fromPort}` : '';
        return (
          <div className="port-row" key={`i${p.id}`}>
            <div className="ph"><span className="pdir">{tr("IN")}</span><b>{p.label}</b><span className="ptype">{p.type}{p.optional ? ' · optional' : ''}</span></div>
            <div className="pval">{sig ? <>{describe(sig.v)}<i> {tr("strength")} {sig.s.toFixed(2)}</i></> : <span className="muted">{edge ? tr('no signal yet') : p.optional ? tr("not connected (optional)") : tr("not connected (required)")}</span>}</div>
            <select aria-label={tr('Source for input {label}', { label: p.label })} value={sel} onChange={(e) => {
              if (!e.target.value) { if (edge) st.removeEdge(edge.id); return; }
              const [fn, fp] = e.target.value.split('|');
              st.edit((s) => {
                const chk = checkConnection(s.graph, fn, fp, node.id, p.id, s.compounds);
                if (!chk.ok) { st.toast(chk.reason ?? tr("Incompatible"), 'error'); return null; }
                return null;
              });
              st.connectPorts(fn, fp, node.id, p.id);
            }}>
              <option value="">{tr("— not connected —")}</option>
              {options.map((o) => {
                const chk = checkConnection(graph, o.node, o.port, node.id, p.id, compounds);
                return <option key={o.id} value={o.id} disabled={!chk.ok}>{o.label}{chk.ok ? '' : tr(' — incompatible ({from} → {to})', { from: o.type, to: p.type })}</option>;
              })}
            </select>
            <p className="doc">{p.doc}</p>
          </div>
        );
      })}
      {def.outputs.map((p) => {
        const sig = rt?.outputs[p.id];
        return (
          <div className="port-row" key={`o${p.id}`}>
            <div className="ph"><span className="pdir out">{tr("OUT")}</span><b>{p.label}</b><span className="ptype">{p.type}</span></div>
            <div className="pval">{sig ? <>{describe(sig.v)}<i> {tr("strength")} {sig.s.toFixed(2)}</i></> : <span className="muted">{tr("no signal")}</span>}</div>
            <p className="doc">{p.doc}</p>
          </div>
        );
      })}
    </div>
  );
}

function useSensor(id: string) {
  useSyncExternalStore(subscribeSensors, sensorVersion);
  return getSensorState(id);
}

function OutputStatus({ def }: { def: ModuleDef }) {
  const [, force] = useState(0);
  if (def.type === 'audio') return <p className={`status-line ${audio.state === 'running' ? 'ok' : 'warn'}`}>{tr("Speaker:")} {audio.state === 'running' ? tr('unlocked and ready') : audio.state === 'locked' ? tr("locked until you press Run or Step (browser rule)") : tr("Web Audio is not available")}.</p>;
  if (def.type === 'haptic') return <p className={`status-line ${vibrationSupported() ? 'ok' : 'warn'}`}>{tr("Vibration:")} {vibrationSupported() ? tr('supported on this device') : tr('not supported on this device or browser')}.</p>;
  if (def.type === 'notify') {
    const s = notificationState();
    return (
      <div>
        <p className={`status-line ${s === 'granted' ? 'ok' : 'warn'}`}>{tr("Notifications:")} {s === 'granted' ? tr('permission granted') : s === 'denied' ? tr('blocked in browser settings') : s === 'unsupported' ? tr('not supported here') : tr('permission not yet requested')}.</p>
        {s === 'default' && <button className="btn" onClick={async () => { await requestNotifications(); force((x) => x + 1); }}>{tr("Request permission")}</button>}
      </div>
    );
  }
  return null;
}

function SensorStatus({ node, def }: { node: NodeInst; def: ModuleDef }) {
  const s = useSensor(node.id);
  const src = String(node.params.source ?? '');
  if (!['vision', 'hearing', 'motion', 'keys', 'device', 'touch'].includes(def.type)) return null;
  const sim = src === 'sim';
  const running = useStore((x) => x.run) !== 'stopped';
  let text: string, kind: string;
  if (def.type === 'touch') { text = tr("Manual input: press the pad inside the node."); kind = 'ok'; }
  else if (sim) { text = tr("Simulated source: deterministic, no hardware needed."); kind = 'ok'; }
  else if (!running) { text = tr("Not connected. Press Run to request access to the real device."); kind = 'warn'; }
  else if (s) { text = tr(s.message || s.state); kind = s.state === 'live' ? 'ok' : s.state === 'requesting' ? 'info' : 'err'; }
  else { text = tr("Starting…"); kind = 'info'; }
  return <p className={`status-line ${kind}`}><b>{tr("Input:")}</b> {tr(text)}</p>;
}

function VisionFile({ node }: { node: NodeInst }) {
  const st = useStore.getState();
  return (
    <div className="field">
      <label htmlFor="vfile">{tr("Image file")}</label>
      <input id="vfile" type="file" accept="image/*" onChange={(e) => {
        const f = e.target.files?.[0];
        if (!f) return;
        const r = new FileReader();
        r.onload = () => {
          const im = new Image();
          im.onload = () => {
            const k = Math.min(1, 160 / Math.max(im.width, im.height));
            const cv = document.createElement('canvas');
            cv.width = Math.max(1, Math.round(im.width * k)); cv.height = Math.max(1, Math.round(im.height * k));
            cv.getContext('2d')!.drawImage(im, 0, 0, cv.width, cv.height);
            st.setNodeParams(node.id, { source: 'file', fileData: cv.toDataURL('image/jpeg', 0.8) });
            st.toast(tr("Image stored in the program (downscaled to 160 px)."), 'ok');
          };
          im.onerror = () => st.toast(tr("That file is not a readable image."), 'error');
          im.src = String(r.result);
        };
        r.readAsDataURL(f);
      }} />
      <p className="doc">{node.params.fileData ? tr("An image is stored in this program. Choose another to replace it.") : tr("Pick an image; it is downscaled and kept inside the program, so it works offline.")}</p>
    </div>
  );
}

function DocBlock({ def, node }: { def: ModuleDef; node?: NodeInst }) {
  const pkg = node && (def.type === 'knowledge' || def.type === 'imagination') ? packageById(String(node.params.package)) : undefined;
  return (
    <div className="docs">
      <p>{def.doc.summary}</p>
      <h4>{tr("Runtime behavior")}</h4>
      <p>{def.doc.runtime}</p>
      {pkg && (
        <>
          <h4>{tr("Package:")} {pkg.name}</h4>
          <dl>
            <dt>{tr("Technique")}</dt><dd>{pkg.technique}</dd>
            <dt>{tr("Status")}</dt><dd>{pkg.status === 'available' ? tr("Available offline") : tr("Unavailable in this build")}</dd>
            <dt>{tr("Requirements")}</dt><dd>{pkg.requirements}</dd>
            <dt>{tr("Limitations")}</dt><dd>{pkg.limitations}</dd>
            <dt>{tr("Inputs")}</dt><dd>{pkg.inputs}</dd>
            <dt>{tr("Outputs")}</dt><dd>{pkg.outputs}</dd>
          </dl>
        </>
      )}
      {def.doc.errors && <><h4>{tr("Error conditions")}</h4><ul>{def.doc.errors.map((e) => <li key={e}>{e}</li>)}</ul></>}
      {def.doc.examples && <><h4>{tr("Examples")}</h4><ul>{def.doc.examples.map((e) => <li key={e}>{e}</li>)}</ul></>}
    </div>
  );
}

function CompoundPanel({ node, cdef }: { node: NodeInst; cdef: CompoundDef }) {
  const st = useStore.getState();
  const inLib = useStore((s) => !!s.userCompounds[cdef.id]);
  return (
    <Section title={tr("Compound")}>
      <div className="field"><label htmlFor="cname">{tr("Name")}</label><input id="cname" type="text" value={cdef.name} maxLength={60} onChange={(e) => st.updateCompound(cdef.id, (c) => ({ ...c, name: e.target.value }))} /></div>
      <div className="field"><label htmlFor="cdesc">{tr("Description")}</label><textarea id="cdesc" rows={2} value={cdef.description} maxLength={300} onChange={(e) => st.updateCompound(cdef.id, (c) => ({ ...c, description: e.target.value }))} /></div>
      <div className="btn-row">
        <button className="btn" onClick={() => st.openDialog('compound', { defId: cdef.id, nodeId: node.id })}><Icon name="open" size={14} />{tr("Open inner graph")}</button>
        <button className="btn" onClick={() => st.saveCompoundToLibrary(cdef.id)}><Icon name="save" size={14} />{inLib ? tr("Update library") : tr("Save to library")}</button>
      </div>
      <h4 className="mini">{tr("External ports")}</h4>
      {[...cdef.inputs.map((p) => ({ ...p, dir: 'in' as const })), ...cdef.outputs.map((p) => ({ ...p, dir: 'out' as const }))].map((p) => (
        <div className="field inline-edit" key={p.dir + p.id}>
          <span className={`pdir ${p.dir === 'out' ? 'out' : ''}`}>{p.dir === 'in' ? 'IN' : 'OUT'}</span>
          <input type="text" aria-label={tr(p.dir === 'in' ? 'Label of input {id}' : 'Label of output {id}', { id: p.id })} value={p.label} maxLength={40}
            onChange={(e) => st.updateCompound(cdef.id, (c) => ({ ...c, [p.dir === 'in' ? 'inputs' : 'outputs']: (p.dir === 'in' ? c.inputs : c.outputs).map((q) => (q.id === p.id ? { ...q, label: e.target.value } : q)) }))} />
          <span className="ptype">{p.type}</span>
        </div>
      ))}
      <h4 className="mini">{tr("Exposed settings")}</h4>
      <p className="doc">{tr("Tick inner settings to make them configurable on every instance of this compound.")}</p>
      {Object.values(cdef.graph.nodes).map((n) => {
        const d = getDef(n.type, undefined, n.params);
        if (!d) return null;
        const pds = paramDefsOf(d, n.params).filter((p) => p.kind !== 'action' && !p.hidden);
        if (!pds.length) return null;
        return (
          <details key={n.id} className="expose">
            <summary>{d.name} <span className="muted">({n.id})</span></summary>
            {pds.map((p) => {
              const ex = cdef.exposed.find((e) => e.nodeId === n.id && e.param === p.key);
              return (
                <label key={p.key} className="chk"><input type="checkbox" checked={!!ex} onChange={(e) => st.updateCompound(cdef.id, (c) => ({ ...c, exposed: e.target.checked ? [...c.exposed, { key: `${n.id}_${p.key}`, label: `${d.name} ${p.label}`, nodeId: n.id, param: p.key }] : c.exposed.filter((x) => !(x.nodeId === n.id && x.param === p.key)) }))} /> {p.label}</label>
              );
            })}
          </details>
        );
      })}
    </Section>
  );
}

function NodePanel({ id }: { id: string }) {
  const node = useStore((s) => s.project.graph.nodes[id]);
  const compounds = useStore((s) => s.project.compounds);
  const graph = useStore((s) => s.project.graph);
  useNodeVer(id);
  useDiagVersion();
  const st = useStore.getState();
  if (!node) return null;
  const def = getDef(node.type, compounds, node.params);
  if (!def) return <p className="muted pad12">{tr("Unknown module type “{type}”.", { type: node.type })}</p>;
  const rt = engine.nodes.get(id);
  const defs = paramDefsOf(def, node.params).filter((p) => !p.hidden);
  const diag = getDiagnostics().filter((d) => d.nodeId === id);
  const cdef = node.type === 'compound' ? compounds[String(node.params.def)] : undefined;
  const missing = engine.missingInputs(id);
  const live = useStore.getState().run !== 'stopped';
  const pinDriven = (key: string) => Object.values(graph.edges).some((e) => e.to === id && e.toPort === SETTING_PREFIX + key);
  return (
    <>
      <header className="ihead">
        <div className="ititle"><span className={`swatch f-${def.family}`} /><h2 title={def.name}>{nodeTitle(def, node.params)}</h2></div>
        <div className="imeta"><span className="tag">{def.category}</span><code title={tr("Module id")}>{node.id}</code></div>
        <div className="btn-row">
          <button className="btn sm" onClick={() => bridge.focus?.([id])}><Icon name="focus" size={13} />{tr("Focus")}</button>
          <button className="btn sm" onClick={() => st.duplicateSelection()}><Icon name="copy" size={13} />{tr("Duplicate")}</button>
          <button className="btn sm" onClick={() => st.toggleDisabled([id])} aria-pressed={!!node.disabled}><Icon name="power" size={13} />{node.disabled ? tr("Enable") : tr("Disable")}</button>
          <button className="btn sm danger" onClick={() => st.removeSelection()}><Icon name="trash" size={13} />{tr("Delete")}</button>
        </div>
      </header>
      {diag.length > 0 && <div className="callouts">{diag.map((d, i) => <p key={i} className={`callout ${d.level}`}><Icon name="alert" size={14} />{tr(d.message)}</p>)}</div>}
      {live && missing.length > 0 && !node.disabled && <p className="callout info"><Icon name="alert" size={14} />{tr(missing.length > 1 ? "Waiting for required inputs: {list}. The module stays idle until they have a signal." : "Waiting for required input: {list}. The module stays idle until it has a signal.", { list: missing.join(', ') })}</p>}
      {node.disabled && <p className="callout info"><Icon name="alert" size={14} />{tr("Disabled: this module does not run and emits nothing.")}</p>}
      <SensorStatus node={node} def={def} />
      <OutputStatus def={def} />
      {rt && rt.evals > 0 && <p className="runline">{tr("Evaluated")} {rt.evals}×{rt.lastFire >= 0 ? tr(" · last output at ") + fmtNum(rt.lastFire / 1000, 2) + ' s simulated' : tr(" · no output signal")}</p>}
      {cdef && <CompoundPanel node={node} cdef={cdef} />}
      {defs.length > 0 && (
        <Section title={tr("Settings")}>
          {def.type === 'vision' && node.params.source === 'file' && <VisionFile node={node} />}
          {def.type === 'clock' && <ClockInfo city={String((rt?.driven ? rt.live.city : undefined) ?? node.params.city ?? '')} />}
          {defs.map((p) => {
            const driven = p.kind !== 'action' && pinDriven(p.key);
            const v = (driven && rt?.driven ? rt.live[p.key] : undefined) ?? node.params[p.key] ?? (p as any).default;
            return <ParamRow key={p.key} p={p} value={v} driven={driven} onChange={(val) => st.setNodeParams(id, { [p.key]: val }, p.key)} onAction={(c) => { engine.command(id, c); st.toast(tr("Done."), 'ok'); }} />;
          })}
        </Section>
      )}
      <Section title={tr("Connections and signals")}><PortTable node={node} def={def} /></Section>
      <Section title={tr("Documentation")} open={false}><DocBlock def={def} node={node} /></Section>
    </>
  );
}

function EdgePanel({ id }: { id: string }) {
  const edge: Edge | undefined = useStore((s) => s.project.graph.edges[id]);
  const graph = useStore((s) => s.project.graph);
  const compounds = useStore((s) => s.project.compounds);
  useNodeVer(edge?.from ?? '');
  const st = useStore.getState();
  if (!edge) return null;
  const a = graph.nodes[edge.from], b = graph.nodes[edge.to];
  const da = a && getDef(a.type, compounds, a.params), db = b && getDef(b.type, compounds, b.params);
  const po = da && portList(da, 'out').find((p) => p.id === edge.fromPort), pi = db && portList(db, 'in').find((p) => p.id === edge.toPort);
  const sig = engine.nodes.get(edge.from)?.outputs[edge.fromPort];
  return (
    <>
      <header className="ihead">
        <div className="ititle"><span className="swatch wire" /><h2>{tr("Connection")}</h2></div>
        <p className="route"><b>{da?.name}</b> {po?.label} <span>→</span> <b>{db?.name}</b> {pi?.label}</p>
        <p className="muted">{po?.type} → {pi?.type}{po && pi && po.type !== pi.type && po.type !== 'any' && pi.type !== 'any' ? tr(" (values are converted)") : ''}</p>
        <div className="btn-row"><button className="btn sm danger" onClick={() => st.removeEdge(id)}><Icon name="trash" size={13} />{tr("Disconnect")}</button></div>
      </header>
      <Section title={tr("Signal processing")}>
        <ParamRow p={{ key: 'weight', label: tr("Strength weight"), kind: 'number', min: 0, max: 4, step: 0.05, default: 1, doc: tr("Multiplies the strength of every signal on this connection. 0 silences it; Attention, Hypernerve and Reward read strength.") }} value={edge.weight} onChange={(v) => st.setEdge(id, { weight: Number(v) }, 'w')} />
        <ParamRow p={{ key: 'delay', label: tr("Propagation delay"), kind: 'number', min: 0, max: 5000, step: 10, default: 0, unit: 'ms', doc: tr("Simulation milliseconds each signal waits on this connection. Delayed connections also make feedback loops legal.") }} value={edge.delay} onChange={(v) => st.setEdge(id, { delay: Number(v) }, 'd')} />
        <ParamRow p={{ key: 'enabled', label: tr("Enabled"), kind: 'bool', default: true, doc: tr("Disabled connections carry nothing and are drawn dashed.") }} value={edge.enabled} onChange={(v) => st.setEdge(id, { enabled: !!v })} />
      </Section>
      <Section title={tr("Live signal")}>
        <p className="pval">{sig ? <>{describe(sig.v)}<i> {tr("strength")} {sig.s.toFixed(2)}</i></> : <span className="muted">{tr("No signal at the source output.")}</span>}</p>
      </Section>
    </>
  );
}

function ProgramPanel() {
  const project = useStore((s) => s.project);
  const run = useStore((s) => s.run);
  const st = useStore.getState();
  useDiagVersion();
  const diag = getDiagnostics().filter((d) => d.level !== 'info' || true);
  return (
    <>
      <header className="ihead">
        <div className="ititle"><span className="swatch prog" /><h2>{tr("Program")}</h2></div>
        <p className="muted">{tr("{n} modules · {m} connections · {run}", { n: Object.keys(project.graph.nodes).length, m: Object.keys(project.graph.edges).length, run: tr(run) })}</p>
      </header>
      <Section title={tr("Details")}>
        <div className="field"><label htmlFor="pn">{tr("Name")}</label><input id="pn" type="text" value={project.name} maxLength={80} onChange={(e) => st.rename(e.target.value)} /></div>
        <div className="field"><label htmlFor="pa">{tr("Author")}</label><input id="pa" type="text" value={project.author} maxLength={60} placeholder={tr("optional")} onChange={(e) => st.setMeta({ author: e.target.value })} /><p className="doc">{tr("A label only. It does not prove who made the program.")}</p></div>
        <div className="field"><label htmlFor="pd">{tr("Description")}</label><textarea id="pd" rows={4} value={project.description} maxLength={600} placeholder={tr("What does this program do?")} onChange={(e) => st.setMeta({ description: e.target.value })} /></div>
      </Section>
      <Section title={tr('Diagnostics ({n})', { n: diag.length })}>
        {diag.length === 0 ? <p className="muted">{tr("No errors or warnings.")}</p> : (
          <ul className="diag-list">{diag.map((d, i) => (
            <li key={i} className={d.level}><button onClick={() => { if (d.nodeId) { const top = d.nodeId.split('/')[0]; if (project.graph.nodes[top]) { st.select([top]); bridge.focus?.([top]); } } }}><Icon name="alert" size={13} /><span>{tr(d.message)}</span></button></li>
          ))}</ul>
        )}
      </Section>
      <Section title={tr("Quick start")} open={!Object.keys(project.graph.nodes).length}>
        <ol className="tips">
          <li>{tr("Drag a module from the library onto the workspace.")}</li>
          <li>{tr("Drag from a small tab on a module’s edge to a tab on another to connect them. Compatible ports light up.")}</li>
          <li>{tr("Select a module to edit it here. Press Run to execute.")}</li>
          <li>{tr("Share a program as a short code from the Share button.")}</li>
        </ol>
      </Section>
    </>
  );
}

function MultiPanel({ ids }: { ids: string[] }) {
  const st = useStore.getState();
  return (
    <>
      <header className="ihead">
        <div className="ititle"><span className="swatch prog" /><h2>{tr("{n} modules selected", { n: ids.length })}</h2></div>
        <div className="btn-row">
          <button className="btn" onClick={() => st.openDialog('group')}><Icon name="group" size={14} />{tr("Group as compound")}</button>
          <button className="btn" onClick={() => st.duplicateSelection()}><Icon name="copy" size={14} />{tr("Duplicate")}</button>
          <button className="btn" onClick={() => st.toggleDisabled(ids)}><Icon name="power" size={14} />{tr("Toggle enabled")}</button>
          <button className="btn" onClick={() => bridge.focus?.(ids)}><Icon name="focus" size={14} />{tr("Focus")}</button>
          <button className="btn danger" onClick={() => st.removeSelection()}><Icon name="trash" size={14} />{tr("Delete")}</button>
        </div>
      </header>
      <p className="doc pad12">{tr("Grouping wraps the selection into one reusable compound. Connections that cross the boundary become its inputs and outputs.")}</p>
    </>
  );
}

export function Inspector() {
  const selection = useStore((s) => s.selection);
  const selEdge = useStore((s) => s.selEdge);
  const kind = selEdge ? 'edge' : selection.length === 1 ? 'node' : selection.length > 1 ? 'multi' : 'program';
  return (
    <aside className="panel insp" aria-label={tr("Inspector")}>
      <div className="panel-scroll" key={kind + (kind === 'node' ? selection[0] : kind === 'edge' ? selEdge : '')}>
        {kind === 'edge' ? <EdgePanel id={selEdge!} /> : kind === 'node' ? <NodePanel id={selection[0]} /> : kind === 'multi' ? <MultiPanel ids={selection} /> : <ProgramPanel />}
      </div>
    </aside>
  );
}

export { DocBlock };
