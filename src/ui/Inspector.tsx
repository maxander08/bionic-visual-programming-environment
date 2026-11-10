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
        <input type="text" inputMode="decimal" value={text} aria-label={`${p.label} value`} onChange={(e) => commit(e.target.value)} onBlur={() => setText(String(value))}
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
  const meta = p.kind === 'number' ? `Range ${fmtNum(p.min)} to ${fmtNum(p.max)} · default ${fmtNum(p.default)}${p.unit ? ' ' + p.unit : ''}` : p.kind === 'select' ? `Default: ${p.options.find((o) => o.value === p.default)?.label}` : p.kind === 'bool' ? `Default: ${p.default ? 'on' : 'off'}` : undefined;
  return (
    <div className={`field ${p.kind === 'bool' ? 'inline' : ''}`}>
      <label htmlFor={id}>{p.kind === 'action' ? 'Action' : p.label}</label>
      {driven ? <fieldset className="driven" disabled>{control}</fieldset> : control}
      {driven && <p className="doc driven-note">Driven by the “{p.label}” pin: the connected signal is in effect. Disconnect the pin to edit this setting.</p>}
      <p className="doc">{p.doc}{meta && <span className="meta"> {meta}</span>}</p>
    </div>
  );
}

function ClockInfo({ city }: { city: string }) {
  const c = findCity(city);
  if (!c) return <p className="callout warn"><Icon name="alert" size={14} />“{city.trim() || '…'}” is not a known city yet. Start typing and pick one of the suggestions.</p>;
  let off = '';
  try { off = fmtOffset(readClock(c.tz, Date.now(), false, false).offset); } catch { /* unknown zone */ }
  return <p className="doc"><b>{c.label}</b> · {c.tz}{off ? ` · ${off} now` : ''} · population {c.pop.toLocaleString('en-US')}</p>;
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
      {def.inputs.length === 0 && def.outputs.length === 0 && <p className="muted">This module has no ports.</p>}
      {def.inputs.map((p) => {
        const edge = Object.values(graph.edges).find((e) => e.to === node.id && e.toPort === p.id);
        const sig = rt?.inputs[p.id];
        const sel = edge ? `${edge.from}|${edge.fromPort}` : '';
        return (
          <div className="port-row" key={`i${p.id}`}>
            <div className="ph"><span className="pdir">IN</span><b>{p.label}</b><span className="ptype">{p.type}{p.optional ? ' · optional' : ''}</span></div>
            <div className="pval">{sig ? <>{describe(sig.v)}<i> strength {sig.s.toFixed(2)}</i></> : <span className="muted">{edge ? 'no signal yet' : p.optional ? 'not connected (optional)' : 'not connected (required)'}</span>}</div>
            <select aria-label={`Source for input ${p.label}`} value={sel} onChange={(e) => {
              if (!e.target.value) { if (edge) st.removeEdge(edge.id); return; }
              const [fn, fp] = e.target.value.split('|');
              st.edit((s) => {
                const chk = checkConnection(s.graph, fn, fp, node.id, p.id, s.compounds);
                if (!chk.ok) { st.toast(chk.reason ?? 'Incompatible', 'error'); return null; }
                return null;
              });
              st.connectPorts(fn, fp, node.id, p.id);
            }}>
              <option value="">— not connected —</option>
              {options.map((o) => {
                const chk = checkConnection(graph, o.node, o.port, node.id, p.id, compounds);
                return <option key={o.id} value={o.id} disabled={!chk.ok}>{o.label}{chk.ok ? '' : ` — incompatible (${o.type} → ${p.type})`}</option>;
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
            <div className="ph"><span className="pdir out">OUT</span><b>{p.label}</b><span className="ptype">{p.type}</span></div>
            <div className="pval">{sig ? <>{describe(sig.v)}<i> strength {sig.s.toFixed(2)}</i></> : <span className="muted">no signal</span>}</div>
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
  if (def.type === 'audio') return <p className={`status-line ${audio.state === 'running' ? 'ok' : 'warn'}`}>Speaker: {audio.state === 'running' ? 'unlocked and ready' : audio.state === 'locked' ? 'locked until you press Run or Step (browser rule)' : 'Web Audio is not available'}.</p>;
  if (def.type === 'haptic') return <p className={`status-line ${vibrationSupported() ? 'ok' : 'warn'}`}>Vibration: {vibrationSupported() ? 'supported on this device' : 'not supported on this device or browser'}.</p>;
  if (def.type === 'notify') {
    const s = notificationState();
    return (
      <div>
        <p className={`status-line ${s === 'granted' ? 'ok' : 'warn'}`}>Notifications: {s === 'granted' ? 'permission granted' : s === 'denied' ? 'blocked in browser settings' : s === 'unsupported' ? 'not supported here' : 'permission not yet requested'}.</p>
        {s === 'default' && <button className="btn" onClick={async () => { await requestNotifications(); force((x) => x + 1); }}>Request permission</button>}
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
  if (def.type === 'touch') { text = 'Manual input: press the pad inside the node.'; kind = 'ok'; }
  else if (sim) { text = 'Simulated source: deterministic, no hardware needed.'; kind = 'ok'; }
  else if (!running) { text = 'Not connected. Press Run to request access to the real device.'; kind = 'warn'; }
  else if (s) { text = s.message || s.state; kind = s.state === 'live' ? 'ok' : s.state === 'requesting' ? 'info' : 'err'; }
  else { text = 'Starting…'; kind = 'info'; }
  return <p className={`status-line ${kind}`}><b>Input:</b> {text}</p>;
}

function VisionFile({ node }: { node: NodeInst }) {
  const st = useStore.getState();
  return (
    <div className="field">
      <label htmlFor="vfile">Image file</label>
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
            st.toast('Image stored in the program (downscaled to 160 px).', 'ok');
          };
          im.onerror = () => st.toast('That file is not a readable image.', 'error');
          im.src = String(r.result);
        };
        r.readAsDataURL(f);
      }} />
      <p className="doc">{node.params.fileData ? 'An image is stored in this program. Choose another to replace it.' : 'Pick an image; it is downscaled and kept inside the program, so it works offline.'}</p>
    </div>
  );
}

function DocBlock({ def, node }: { def: ModuleDef; node?: NodeInst }) {
  const pkg = node && (def.type === 'knowledge' || def.type === 'imagination') ? packageById(String(node.params.package)) : undefined;
  return (
    <div className="docs">
      <p>{def.doc.summary}</p>
      <h4>Runtime behavior</h4>
      <p>{def.doc.runtime}</p>
      {pkg && (
        <>
          <h4>Package: {pkg.name}</h4>
          <dl>
            <dt>Technique</dt><dd>{pkg.technique}</dd>
            <dt>Status</dt><dd>{pkg.status === 'available' ? 'Available offline' : 'Unavailable in this build'}</dd>
            <dt>Requirements</dt><dd>{pkg.requirements}</dd>
            <dt>Limitations</dt><dd>{pkg.limitations}</dd>
            <dt>Inputs</dt><dd>{pkg.inputs}</dd>
            <dt>Outputs</dt><dd>{pkg.outputs}</dd>
          </dl>
        </>
      )}
      {def.doc.errors && <><h4>Error conditions</h4><ul>{def.doc.errors.map((e) => <li key={e}>{e}</li>)}</ul></>}
      {def.doc.examples && <><h4>Examples</h4><ul>{def.doc.examples.map((e) => <li key={e}>{e}</li>)}</ul></>}
    </div>
  );
}

function CompoundPanel({ node, cdef }: { node: NodeInst; cdef: CompoundDef }) {
  const st = useStore.getState();
  const inLib = useStore((s) => !!s.userCompounds[cdef.id]);
  return (
    <Section title="Compound">
      <div className="field"><label htmlFor="cname">Name</label><input id="cname" type="text" value={cdef.name} maxLength={60} onChange={(e) => st.updateCompound(cdef.id, (c) => ({ ...c, name: e.target.value }))} /></div>
      <div className="field"><label htmlFor="cdesc">Description</label><textarea id="cdesc" rows={2} value={cdef.description} maxLength={300} onChange={(e) => st.updateCompound(cdef.id, (c) => ({ ...c, description: e.target.value }))} /></div>
      <div className="btn-row">
        <button className="btn" onClick={() => st.openDialog('compound', { defId: cdef.id, nodeId: node.id })}><Icon name="open" size={14} />Open inner graph</button>
        <button className="btn" onClick={() => st.saveCompoundToLibrary(cdef.id)}><Icon name="save" size={14} />{inLib ? 'Update library' : 'Save to library'}</button>
      </div>
      <h4 className="mini">External ports</h4>
      {[...cdef.inputs.map((p) => ({ ...p, dir: 'in' as const })), ...cdef.outputs.map((p) => ({ ...p, dir: 'out' as const }))].map((p) => (
        <div className="field inline-edit" key={p.dir + p.id}>
          <span className={`pdir ${p.dir === 'out' ? 'out' : ''}`}>{p.dir === 'in' ? 'IN' : 'OUT'}</span>
          <input type="text" aria-label={`Label of ${p.dir === 'in' ? 'input' : 'output'} ${p.id}`} value={p.label} maxLength={40}
            onChange={(e) => st.updateCompound(cdef.id, (c) => ({ ...c, [p.dir === 'in' ? 'inputs' : 'outputs']: (p.dir === 'in' ? c.inputs : c.outputs).map((q) => (q.id === p.id ? { ...q, label: e.target.value } : q)) }))} />
          <span className="ptype">{p.type}</span>
        </div>
      ))}
      <h4 className="mini">Exposed settings</h4>
      <p className="doc">Tick inner settings to make them configurable on every instance of this compound.</p>
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
  if (!def) return <p className="muted pad12">Unknown module type “{node.type}”.</p>;
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
        <div className="imeta"><span className="tag">{def.category}</span><code title="Module id">{node.id}</code></div>
        <div className="btn-row">
          <button className="btn sm" onClick={() => bridge.focus?.([id])}><Icon name="focus" size={13} />Focus</button>
          <button className="btn sm" onClick={() => st.duplicateSelection()}><Icon name="copy" size={13} />Duplicate</button>
          <button className="btn sm" onClick={() => st.toggleDisabled([id])} aria-pressed={!!node.disabled}><Icon name="power" size={13} />{node.disabled ? 'Enable' : 'Disable'}</button>
          <button className="btn sm danger" onClick={() => st.removeSelection()}><Icon name="trash" size={13} />Delete</button>
        </div>
      </header>
      {diag.length > 0 && <div className="callouts">{diag.map((d, i) => <p key={i} className={`callout ${d.level}`}><Icon name="alert" size={14} />{d.message}</p>)}</div>}
      {live && missing.length > 0 && !node.disabled && <p className="callout info"><Icon name="alert" size={14} />Waiting for required input{missing.length > 1 ? 's' : ''}: {missing.join(', ')}. The module stays idle until {missing.length > 1 ? 'they have' : 'it has'} a signal.</p>}
      {node.disabled && <p className="callout info"><Icon name="alert" size={14} />Disabled: this module does not run and emits nothing.</p>}
      <SensorStatus node={node} def={def} />
      <OutputStatus def={def} />
      {rt && rt.evals > 0 && <p className="runline">Evaluated {rt.evals}×{rt.lastFire >= 0 ? ' · last output at ' + fmtNum(rt.lastFire / 1000, 2) + ' s simulated' : ' · no output signal'}</p>}
      {cdef && <CompoundPanel node={node} cdef={cdef} />}
      {defs.length > 0 && (
        <Section title="Settings">
          {def.type === 'vision' && node.params.source === 'file' && <VisionFile node={node} />}
          {def.type === 'clock' && <ClockInfo city={String((rt?.driven ? rt.live.city : undefined) ?? node.params.city ?? '')} />}
          {defs.map((p) => {
            const driven = p.kind !== 'action' && pinDriven(p.key);
            const v = (driven && rt?.driven ? rt.live[p.key] : undefined) ?? node.params[p.key] ?? (p as any).default;
            return <ParamRow key={p.key} p={p} value={v} driven={driven} onChange={(val) => st.setNodeParams(id, { [p.key]: val }, p.key)} onAction={(c) => { engine.command(id, c); st.toast('Done.', 'ok'); }} />;
          })}
        </Section>
      )}
      <Section title="Connections and signals"><PortTable node={node} def={def} /></Section>
      <Section title="Documentation" open={false}><DocBlock def={def} node={node} /></Section>
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
        <div className="ititle"><span className="swatch wire" /><h2>Connection</h2></div>
        <p className="route"><b>{da?.name}</b> {po?.label} <span>→</span> <b>{db?.name}</b> {pi?.label}</p>
        <p className="muted">{po?.type} → {pi?.type}{po && pi && po.type !== pi.type && po.type !== 'any' && pi.type !== 'any' ? ' (values are converted)' : ''}</p>
        <div className="btn-row"><button className="btn sm danger" onClick={() => st.removeEdge(id)}><Icon name="trash" size={13} />Disconnect</button></div>
      </header>
      <Section title="Signal processing">
        <ParamRow p={{ key: 'weight', label: 'Strength weight', kind: 'number', min: 0, max: 4, step: 0.05, default: 1, doc: 'Multiplies the strength of every signal on this connection. 0 silences it; Attention, Hypernerve and Reward read strength.' }} value={edge.weight} onChange={(v) => st.setEdge(id, { weight: Number(v) }, 'w')} />
        <ParamRow p={{ key: 'delay', label: 'Propagation delay', kind: 'number', min: 0, max: 5000, step: 10, default: 0, unit: 'ms', doc: 'Simulation milliseconds each signal waits on this connection. Delayed connections also make feedback loops legal.' }} value={edge.delay} onChange={(v) => st.setEdge(id, { delay: Number(v) }, 'd')} />
        <ParamRow p={{ key: 'enabled', label: 'Enabled', kind: 'bool', default: true, doc: 'Disabled connections carry nothing and are drawn dashed.' }} value={edge.enabled} onChange={(v) => st.setEdge(id, { enabled: !!v })} />
      </Section>
      <Section title="Live signal">
        <p className="pval">{sig ? <>{describe(sig.v)}<i> strength {sig.s.toFixed(2)}</i></> : <span className="muted">No signal at the source output.</span>}</p>
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
        <div className="ititle"><span className="swatch prog" /><h2>Program</h2></div>
        <p className="muted">{Object.keys(project.graph.nodes).length} modules · {Object.keys(project.graph.edges).length} connections · {run}</p>
      </header>
      <Section title="Details">
        <div className="field"><label htmlFor="pn">Name</label><input id="pn" type="text" value={project.name} maxLength={80} onChange={(e) => st.rename(e.target.value)} /></div>
        <div className="field"><label htmlFor="pa">Author</label><input id="pa" type="text" value={project.author} maxLength={60} placeholder="optional" onChange={(e) => st.setMeta({ author: e.target.value })} /><p className="doc">A label only. It does not prove who made the program.</p></div>
        <div className="field"><label htmlFor="pd">Description</label><textarea id="pd" rows={4} value={project.description} maxLength={600} placeholder="What does this program do?" onChange={(e) => st.setMeta({ description: e.target.value })} /></div>
      </Section>
      <Section title={`Diagnostics (${diag.length})`}>
        {diag.length === 0 ? <p className="muted">No errors or warnings.</p> : (
          <ul className="diag-list">{diag.map((d, i) => (
            <li key={i} className={d.level}><button onClick={() => { if (d.nodeId) { const top = d.nodeId.split('/')[0]; if (project.graph.nodes[top]) { st.select([top]); bridge.focus?.([top]); } } }}><Icon name="alert" size={13} /><span>{d.message}</span></button></li>
          ))}</ul>
        )}
      </Section>
      <Section title="Quick start" open={!Object.keys(project.graph.nodes).length}>
        <ol className="tips">
          <li>Drag a module from the library onto the workspace.</li>
          <li>Drag from a small tab on a module’s edge to a tab on another to connect them. Compatible ports light up.</li>
          <li>Select a module to edit it here. Press Run to execute.</li>
          <li>Share a program as a short code from the Share button.</li>
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
        <div className="ititle"><span className="swatch prog" /><h2>{ids.length} modules selected</h2></div>
        <div className="btn-row">
          <button className="btn" onClick={() => st.openDialog('group')}><Icon name="group" size={14} />Group as compound</button>
          <button className="btn" onClick={() => st.duplicateSelection()}><Icon name="copy" size={14} />Duplicate</button>
          <button className="btn" onClick={() => st.toggleDisabled(ids)}><Icon name="power" size={14} />Toggle enabled</button>
          <button className="btn" onClick={() => bridge.focus?.(ids)}><Icon name="focus" size={14} />Focus</button>
          <button className="btn danger" onClick={() => st.removeSelection()}><Icon name="trash" size={14} />Delete</button>
        </div>
      </header>
      <p className="doc pad12">Grouping wraps the selection into one reusable compound. Connections that cross the boundary become its inputs and outputs.</p>
    </>
  );
}

export function Inspector() {
  const selection = useStore((s) => s.selection);
  const selEdge = useStore((s) => s.selEdge);
  const kind = selEdge ? 'edge' : selection.length === 1 ? 'node' : selection.length > 1 ? 'multi' : 'program';
  return (
    <aside className="panel insp" aria-label="Inspector">
      <div className="panel-scroll" key={kind + (kind === 'node' ? selection[0] : kind === 'edge' ? selEdge : '')}>
        {kind === 'edge' ? <EdgePanel id={selEdge!} /> : kind === 'node' ? <NodePanel id={selection[0]} /> : kind === 'multi' ? <MultiPanel ids={selection} /> : <ProgramPanel />}
      </div>
    </aside>
  );
}

export { DocBlock };
