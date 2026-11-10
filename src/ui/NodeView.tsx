import { memo, useEffect, useRef, type ReactElement } from 'react';
import type { ModuleDef, NodeInst } from '../core/types';
import { SIZES } from '../core/types';
import { SETTING_PREFIX, nodeSize, nodeTitle, portSide } from '../core/registry';
import { clamp, fmtNum, isImage, toText } from '../core/util';
import { engine, useNodeVer } from '../runtime/session';
import { getSensorState, subscribeSensors, sensorVersion } from '../runtime/sensors';
import { useSyncExternalStore } from 'react';
import { useStore } from '../state/store';
import { Icon } from './icons';
import { EquationPlot } from './EquationPlot';

export const FAMILY_VAR: Record<string, string> = {
  sensor: '#ff2a2a', sense: '#6fd3ee', knowledge: '#a259ff', attention: '#f7c52b', fear: '#3ddc97', memory: '#86f0cc', apparatus: '#2fd6c0',
  emotion: '#ff8a50', behavior: '#f4f4f4', projector: '#2fd9cf', node: '#ffc933', info: '#7b8cff',
};

export function Art({ kind, level = 0.4, extra }: { kind: string; level?: number; extra?: number }) {
  const o = 0.32 + 0.68 * clamp(level, 0, 1);
  const common = { fill: 'none', stroke: 'currentColor', strokeWidth: 1.3, strokeLinejoin: 'round' as const, opacity: o };
  let g: ReactElement | null = null;
  switch (kind) {
    case 'radial':
      g = <g {...common}>{Array.from({ length: 12 }, (_, i) => { const a = (i / 12) * Math.PI * 2; return <line key={i} x1={50 + Math.cos(a) * 20} y1={35 + Math.sin(a) * 20} x2={50 + Math.cos(a) * 28} y2={35 + Math.sin(a) * 28} />; })}</g>;
      break;
    case 'triangle': g = <polygon {...common} points="50,4 93,66 7,66" />; break;
    case 'lens': g = <path {...common} d="M8 35 Q50 -6 92 35 Q50 76 8 35Z" />; break;
    case 'frame': g = <rect {...common} x="14" y="8" width="72" height="54" rx="8" />; break;
    case 'cross': g = <g {...common}><line x1="22" y1="6" x2="78" y2="64" /><line x1="78" y1="6" x2="22" y2="64" /></g>; break;
    case 'dots':
      g = <g fill="currentColor" opacity={0.25 + 0.75 * clamp(level, 0, 1)}>{Array.from({ length: 8 * 11 }, (_, i) => { const x = i % 11, y = Math.floor(i / 11); const lit = (extra ?? 0) > x + y * 11; return <circle key={i} cx={10 + x * 8} cy={6 + y * 8.4} r={lit ? 1.7 : 1} opacity={lit ? 1 : 0.5} />; })}</g>;
      break;
    case 'grid':
      g = <g {...common}><rect x="10" y="8" width="80" height="54" />{[1, 2, 3, 4, 5, 6, 7].map((i) => <line key={i} x1={10 + i * 10} y1="8" x2={10 + i * 10} y2="62" />)}{[1, 2, 3, 4].map((i) => <line key={i} y1={8 + i * 10.8} x1="10" y2={8 + i * 10.8} x2="90" />)}</g>;
      break;
    case 'quad': g = <g {...common}><circle cx="36" cy="22" r="19" /><circle cx="64" cy="22" r="19" /><circle cx="36" cy="48" r="19" /><circle cx="64" cy="48" r="19" /></g>; break;
    case 'circle': g = <circle {...common} cx="50" cy="35" r="32" />; break;
    case 'fork': g = <path {...common} d="M50 66 V40 L18 6 M50 40 L82 6" />; break;
    case 'cycle':
      g = <g {...common}><circle cx="50" cy="35" r="26" strokeDasharray="3 4" />{[0, 1, 2].map((i) => { const a = -Math.PI / 2 + (i / 3) * Math.PI * 2; return <circle key={i} cx={50 + Math.cos(a) * 26} cy={35 + Math.sin(a) * 26} r="5" fill={i === (extra ?? 0) % 3 ? 'currentColor' : '#000'} />; })}</g>;
      break;
    case 'audio':
      g = <g fill="currentColor" opacity={0.25 + 0.6 * clamp(level, 0, 1)}>{Array.from({ length: 49 }, (_, i) => <circle key={i} cx={30 + (i % 7) * 6.7} cy={12 + Math.floor(i / 7) * 6.7} r="0.9" />)}</g>;
      break;
    case 'haptic': g = <g {...common}><circle cx="50" cy="35" r="26" /><circle cx="50" cy="35" r="17" /><circle cx="50" cy="35" r="8" /></g>; break;
    case 'light': g = <path {...common} d="M10 35 L92 6 M10 35 L92 64" opacity={0.2 + 0.8 * clamp(level, 0, 1)} />; break;
    case 'notify': g = <g {...common}><path d="M30 52 H70 L64 42 V28 A14 14 0 0 0 36 28 V42 Z" /><path d="M44 58 H56" /></g>; break;
    default: return null;
  }
  return <svg className="art" viewBox="0 0 100 70" preserveAspectRatio="xMidYMid meet" aria-hidden="true">{g}</svg>;
}

export function ImageCanvas({ img }: { img: unknown }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current;
    if (!c || !isImage(img)) return;
    c.width = img.w;
    c.height = img.h;
    const ctx = c.getContext('2d');
    if (!ctx) return;
    ctx.putImageData(new ImageData(new Uint8ClampedArray(img.data), img.w, img.h), 0, 0);
  }, [img]);
  return <canvas ref={ref} className="imgcv" />;
}

function Meter({ hist, auto }: { hist: number[]; auto: boolean }) {
  if (!hist || hist.length < 2) return <svg className="art" viewBox="0 0 100 40" aria-hidden="true"><line x1="0" y1="20" x2="100" y2="20" stroke="currentColor" opacity=".25" strokeWidth="1" /></svg>;
  let lo = 0, hi = 1;
  if (auto) { lo = Math.min(...hist); hi = Math.max(...hist); if (hi - lo < 1e-9) { lo -= 0.5; hi += 0.5; } }
  const pts = hist.map((v, i) => `${(i / (hist.length - 1)) * 100},${36 - ((clamp(v, lo, hi) - lo) / (hi - lo)) * 32}`).join(' ');
  return <svg className="art meter" viewBox="0 0 100 40" preserveAspectRatio="none" aria-hidden="true"><polyline points={pts} fill="none" stroke="currentColor" strokeWidth="1.4" vectorEffect="non-scaling-stroke" strokeLinejoin="round" /></svg>;
}

const sensorKey = (type: string, p: Record<string, unknown>) => (type === 'vision' ? p.source !== 'sim' : type === 'hearing' ? p.source !== 'sim' : false);

interface Props {
  node: NodeInst;
  def: ModuleDef;
  selected: boolean;
  conn: string;
  prefix: string;
  ro: boolean;
}

function NodeViewImpl({ node, def, selected, conn, prefix, ro }: Props) {
  const rid = prefix + node.id;
  const ver = useNodeVer(rid);
  const rt = engine.nodes.get(rid);
  const el = useRef<HTMLDivElement>(null);
  const view = (rt?.viewData ?? {}) as Record<string, any>;
  // Settings in effect: what a connected setting pin is driving, otherwise what the inspector says.
  const params = rt?.driven ? rt.live : node.params;
  const pinned = (key: string) => rt?.inputs[SETTING_PREFIX + key] !== undefined;
  const size = nodeSize(def);
  const chip = def.size === 'chip';
  const col = FAMILY_VAR[def.family];
  const fire = rt?.lastFire ?? -1;
  const prevFire = useRef(fire);
  useSyncExternalStore(subscribeSensors, sensorVersion);
  const sensor = getSensorState(rid);

  useEffect(() => {
    if (fire !== prevFire.current && fire >= 0 && el.current && el.current.animate) {
      el.current.animate([{ boxShadow: `0 0 0 2px ${col}` }, { boxShadow: `0 0 0 2px transparent` }], { duration: 520, easing: 'cubic-bezier(0.2,0.8,0.2,1)' });
    }
    prevFire.current = fire;
  }, [fire, col]);
  void ver;

  const status = rt?.status ?? { level: 'ok', message: '' };
  const upstream = engine.propagated.get(rid);
  const level = status.level !== 'ok' ? status.level : upstream ? 'warn' : 'ok';
  const msg = status.level !== 'ok' ? status.message : upstream ? `Waiting: upstream module “${upstream}” failed.` : '';
  const out = (p: string) => rt?.outputs[p]?.v;
  const title = nodeTitle(def, params);
  const connected = new Set(conn ? conn.split(',') : []);

  const live = sensorKey(def.type, params) && sensor?.state === 'live';
  const dot = def.type === 'vision' || def.type === 'hearing' ? <span className={`dot ${live ? 'live' : ''}`} aria-hidden="true" /> : null;

  const setParam = (patch: Record<string, unknown>, key?: string) => useStore.getState().setNodeParams(node.id, patch, key);

  let body: ReactElement | null = null;
  switch (def.type) {
    case 'touch': {
      const press = (e: React.PointerEvent<HTMLDivElement>, down: boolean) => {
        const r = e.currentTarget.getBoundingClientRect();
        engine.inject(rid, { x: clamp((e.clientX - r.left) / r.width, 0, 1), y: clamp((e.clientY - r.top) / r.height, 0, 1), press: down });
      };
      body = (
        <div className="pad" data-interactive role="application" aria-label="Touch pad. Press or drag to send coordinates." style={{ touchAction: 'none' }}
          onPointerDown={(e) => { if (ro) return; e.currentTarget.setPointerCapture(e.pointerId); press(e, true); }}
          onPointerMove={(e) => { if (!ro && e.buttons) press(e, true); }}
          onPointerUp={(e) => { if (!ro) press(e, false); }} onPointerCancel={(e) => { if (!ro) press(e, false); }}>
          {out('press') === true && <i className="padDot" style={{ left: `${(Number(out('x')) || 0) * 100}%`, top: `${(Number(out('y')) || 0) * 100}%` }} />}
        </div>
      );
      break;
    }
    case 'switch':
      body = (
        <button className={`sw ${params.on ? 'on' : ''}`} data-interactive role="switch" aria-checked={!!params.on} aria-label="Switch" disabled={ro || pinned('on')}
          onClick={() => setParam({ on: !node.params.on })} onKeyDown={(e) => e.stopPropagation()} />
      );
      break;
    case 'info':
      body = <div className="text-body pre clamp2">{String(params.text ?? '')}</div>;
      break;
    case 'motion': {
      const x = Number(out('x')), y = Number(out('y'));
      body = (
        <div className="cross" aria-hidden="true">
          <i /><b />
          {Number.isFinite(x) && Number.isFinite(y) && <u style={{ left: `${50 + clamp(x, -1, 1) * 40}%`, top: `${50 + clamp(y, -1, 1) * 40}%` }} />}
        </div>
      );
      break;
    }
    case 'device': body = <div className="dim-text clamp1">{String(out('name') ?? '')}</div>; break;
    case 'keys': body = <div className="dim-text clamp1">{String(out('key') ?? '')}</div>; break;
    case 'text': body = <div className="text-body clamp4">{view.text ?? ''}</div>; break;
    case 'image': body = view.image ? <ImageCanvas img={view.image} /> : <div className="empty" />; break;
    case 'projector': {
      const k = view.kind;
      body = (
        <>
          {k === 'image' ? <ImageCanvas img={view.image} /> : k === 'number' ? <div className={`big n${String(view.text).length > 8 ? 3 : String(view.text).length > 5 ? 2 : 1}`}>{view.text}</div> : k === 'text' ? <div className="proj-text clamp4">{view.text}</div> : <div className="empty" />}
          {!ro && <button className="expand" data-interactive aria-label="Open projector full size" onClick={() => useStore.getState().openDialog('projector', rid)}><Icon name="expand" /></button>}
        </>
      );
      break;
    }
    case 'meter':
      body = view.plot ? (
        <div className="meter-wrap">
          <EquationPlot plot={view.plot} />
          {!ro && <button className="expand" data-interactive aria-label="Open graph full size" onClick={() => useStore.getState().openDialog('meter', rid)}><Icon name="expand" /></button>}
        </div>
      ) : <div className="meter-wrap"><Meter hist={view.hist} auto={params.auto !== false} /><span className="meter-num">{view.last !== undefined ? fmtNum(view.last, 3) : ''}</span></div>;
      break;
    case 'equation':
      body = <div className="text-body eq pre clamp2">{String(params.expr ?? '') || <span className="ph">y = sin(x)</span>}</div>;
      break;
    case 'audio': body = <Art kind="audio" level={view.mute ? 0 : (view.amp ?? 0) * (rt?.evals ? 1 : 0)} />; break;
    case 'haptic': body = <Art kind="haptic" />; break;
    case 'vital': {
      const l = view.level ?? 0;
      body = <svg className="art" viewBox="0 0 100 40" aria-hidden="true"><circle cx="50" cy="20" r={4 + l * 9} fill={l > 0.02 ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="1.4" style={{ color: vitalColor(view.color) }} /></svg>;
      break;
    }
    case 'light': body = <div style={{ color: vitalColor(view.color), height: '100%' }}><Art kind="light" level={view.level ?? 0} /></div>; break;
    case 'notify': body = <Art kind="notify" level={view.n ? 1 : 0.2} />; break;
    case 'color':
      body = (
        <div className="hsv">
          <div><span>H</span><span>S</span><span>V</span></div>
          <i style={{ background: view.hex ?? '#2060ff' }} />
        </div>
      );
      break;
    case 'clock': body = (
      <div className={`clock ${view.day === false ? 'night' : ''}`}>
        <div className="clock-time">{view.time ?? '--:--'}</div>
        <div className="clock-city clamp1">{view.city ?? String(params.city ?? '').split(',')[0]}</div>
        <div className="clock-date clamp1">{view.date ? `${view.date}` : ''}</div>
        <div className="clock-zone clamp1">{view.offset ?? ''}</div>
      </div>
    ); break;
    case 'comment': body = <div className="text-body note clamp3">{String(params.text ?? '')}</div>; break;
    case 'sense': body = <Art kind="radial" level={view.level ?? 0.15} />; break;
    case 'knowledge': body = <Art kind="triangle" level={out('score') !== undefined ? Number(out('score')) : 0.3} />; break;
    case 'imagination': body = <Art kind="lens" level={out('confidence') !== undefined ? Number(out('confidence')) : 0.3} />; break;
    case 'attention': body = <Art kind="frame" level={(view.index ?? -1) >= 0 ? 1 : 0.2} />; break;
    case 'fear': body = <Art kind="cross" level={view.fear ?? 0.15} />; break;
    case 'memory': body = <Art kind="dots" level={0.5} extra={view.count ?? 0} />; break;
    case 'emotion': body = <Art kind="quad" level={view.a ?? 0.15} />; break;
    case 'reward': body = <Art kind="circle" level={clamp(Math.abs(view.r ?? 0), 0, 1) || 0.15} />; break;
    case 'decision': body = <Art kind="fork" level={(view.best ?? -1) >= 0 ? 1 : 0.2} />; break;
    case 'state': body = <><Art kind="cycle" level={0.7} extra={Math.max(0, Number(out('index')) || 0)} /><div className="state-name clamp1">{view.state ?? ''}</div></>; break;
    case 'compound': body = <Art kind="grid" level={0.4} />; break;
    default: body = null;
  }

  const style = { transform: `translate(${node.x}px, ${node.y}px)`, width: size.w, height: size.h, ['--c' as string]: col } as React.CSSProperties;
  const classes = ['node', `f-${def.family}`, chip ? 'chip' : '', `sz-${def.size}`, selected ? 'sel' : '', level === 'error' ? 'err' : level === 'warn' ? 'warn' : '', node.disabled ? 'off' : ''].filter(Boolean).join(' ');

  const portEls = (dir: 'in' | 'out') => {
    const list = dir === 'in' ? def.inputs : def.outputs;
    return list.map((p) => {
      const side = portSide(p, dir);
      const group = list.filter((q) => portSide(q, dir) === side);
      const f = (group.indexOf(p) + 1) / (group.length + 1);
      const pos: React.CSSProperties = side === 'top' || side === 'bottom' ? { left: `${f * 100}%` } : { top: `${f * 100}%` };
      return <i key={dir + p.id} className={`port ${side} ${connected.has(`${dir}:${p.id}`) ? 'on' : ''}`} data-pk={`${dir}:${p.id}`} style={pos} aria-hidden="true" />;
    });
  };

  return (
    <div ref={el} className={classes} data-node={node.id} style={style} aria-label={`${def.name} module${selected ? ', selected' : ''}`} title={level !== 'ok' ? msg : undefined}>
      {chip ? (
        <div className="chip-row">
          <span className="chip-glyph">{def.glyph}</span>
          <span className="chip-val" title={def.chip?.(params)}>{def.chip?.(params) ?? ''}</span>
        </div>
      ) : (
        <>
          <div className="node-title">
            {dot}
            <span className="t" title={title}>{title}</span>
            {level !== 'ok' && <span className={`mark ${level}`} aria-label={level === 'error' ? 'Error' : 'Warning'}>{level === 'error' ? '×' : '!'}</span>}
          </div>
          <div className="node-body">{body}</div>
        </>
      )}
      {chip && level !== 'ok' && <span className={`mark chipmark ${level}`}>{level === 'error' ? '×' : '!'}</span>}
      {portEls('in')}
      {portEls('out')}
    </div>
  );
}

function vitalColor(c: string | undefined) {
  return { red: '#ff3b30', green: '#3ddc97', cyan: '#2fd9cf', yellow: '#ffc933', white: '#f4f4f4' }[c ?? 'white'] ?? '#f4f4f4';
}

export const NodeView = memo(NodeViewImpl);
export { toText };


const PREVIEW_ART: Record<string, string> = { sense: 'radial', knowledge: 'triangle', imagination: 'lens', attention: 'frame', fear: 'cross', memory: 'dots', emotion: 'quad', reward: 'circle', decision: 'fork', state: 'cycle', compound: 'grid', audio: 'audio', haptic: 'haptic', light: 'light', notify: 'notify' };

/** Static miniature of a module for the library and drag ghost. */
export function PreviewNode({ def, scale = 0.78 }: { def: ModuleDef; scale?: number }) {
  const size = SIZES[def.size];
  const col = FAMILY_VAR[def.family];
  const chip = def.size === 'chip';
  const art = PREVIEW_ART[def.type];
  let body: ReactElement | null = art ? <Art kind={art} level={0.5} extra={20} /> : null;
  if (def.type === 'touch') body = <div className="pad" />;
  else if (def.type === 'switch') body = <span className="sw" />;
  else if (def.type === 'info') body = <div className="text-body pre">hello</div>;
  else if (def.type === 'equation') body = <div className="text-body eq pre">y = sin(x)</div>;
  else if (def.type === 'text') body = <div className="text-body">Hello World</div>;
  else if (def.type === 'color') body = <div className="hsv"><div><span>H</span><span>S</span><span>V</span></div><i style={{ background: '#0a7aff' }} /></div>;
  else if (def.type === 'projector') body = <i className="grad" />;
  else if (def.type === 'meter') body = <svg className="art meter" viewBox="0 0 100 40" preserveAspectRatio="none"><polyline points="0,22 20,22 30,8 38,34 46,22 60,18 100,22" fill="none" stroke="currentColor" strokeWidth="1.4" vectorEffect="non-scaling-stroke" /></svg>;
  else if (def.type === 'image') body = <i className="grad dark" />;
  else if (def.type === 'motion') body = <div className="cross"><i /><b /></div>;
  else if (def.type === 'comment') body = <div className="text-body note">Note</div>;
  else if (def.type === 'clock') body = <div className="clock"><div className="clock-time">12:00</div><div className="clock-city">Tokyo</div></div>;
  else if (def.type === 'vital') body = <svg className="art" viewBox="0 0 100 40"><circle cx="50" cy="20" r="8" fill="currentColor" /></svg>;
  return (
    <div className="pv-wrap" style={{ width: size.w * scale, height: size.h * scale }}>
      <div className={`node preview f-${def.family} ${chip ? 'chip' : ''} sz-${def.size}`} style={{ width: size.w, height: size.h, transform: `scale(${scale})`, ['--c' as string]: col } as React.CSSProperties}>
        {chip ? (
          <div className="chip-row"><span className="chip-glyph">{def.glyph}</span></div>
        ) : (
          <>
            <div className="node-title">{(def.type === 'vision' || def.type === 'hearing') && <span className="dot live" />}<span className="t">{def.name}</span></div>
            <div className="node-body">{body}</div>
          </>
        )}
      </div>
    </div>
  );
}
