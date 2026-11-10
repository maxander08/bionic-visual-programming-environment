import { useContext, useMemo, useState, type ReactNode } from 'react';
import { MODULES, CATEGORIES, getDef, portSide } from '../../core/registry';
import { PACKAGES, type MlPackage } from '../../core/packages';
import { SIZES, type ModuleDef, type ParamDef } from '../../core/types';
import { fmtNum } from '../../core/util';
import { openTemplate } from '../../state/actions';
import { bridge, useStore } from '../../state/store';
import { FAMILY_VAR, PreviewNode } from '../NodeView';
import { Icon } from '../icons';
import { ARTICLES, ARTICLE_BY_ID, GOALS } from './content';
import { GUIDE } from './nodeGuide';
import { RECIPES, RECIPE_BY_ID, recipeTemplate, type Recipe } from './recipes';
import { CAT_LABEL, routeKind, routeTitle } from './meta';
import { slug } from './markup';
import { paramSummary } from './search';
import { Blocks, Callout, DocLink, Rich, TypeChip } from './Rich';
import { NavCtx, routeKey, type Article, type Route } from './types';

/* ───────────────────────── shared bits ───────────────────────── */

export function Star({ on, size = 15 }: { on: boolean; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill={on ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 3.5l2.6 5.4 5.9.8-4.3 4.1 1 5.9L12 16.9 6.8 19.7l1-5.9L3.5 9.7l5.9-.8z" />
    </svg>
  );
}

function BookmarkButton({ route }: { route: Route }) {
  const nav = useContext(NavCtx);
  const key = routeKey(route);
  const on = nav.isBookmarked(key);
  return (
    <button type="button" className={`dx-btn ${on ? 'on' : ''}`} aria-pressed={on} onClick={() => nav.toggleBookmark(key)} title={on ? 'Remove bookmark' : 'Bookmark this page'}>
      <Star on={on} size={14} />{on ? 'Bookmarked' : 'Bookmark'}
    </button>
  );
}

function PageHead({ eyebrow, title, lead, route, children, swatch }: { eyebrow: string; title: string; lead?: ReactNode; route?: Route; children?: ReactNode; swatch?: string }) {
  return (
    <header className="dx-head">
      <div className="dx-eyebrow">{swatch && <i style={{ background: swatch }} />}{eyebrow}</div>
      <div className="dx-title-row">
        <h1 className="dx-h1">{title}</h1>
        {route && <BookmarkButton route={route} />}
      </div>
      {lead && <p className="dx-lead">{lead}</p>}
      {children}
    </header>
  );
}

function NodeChip({ type }: { type: string }) {
  const m = MODULES.find((x) => x.type === type);
  if (!m) return null;
  return (
    <DocLink route={{ k: 'node', type }} className="dx-nodechip"><i style={{ background: FAMILY_VAR[m.family] }} />{m.name}</DocLink>
  );
}

function RelatedLinks({ routes }: { routes: Route[] }) {
  if (!routes.length) return null;
  return (
    <section className="dx-related" aria-label="Related pages">
      <h2 className="dx-h2" data-toc="Related" id="dx-related">Related</h2>
      <div className="dx-cards sm">
        {routes.map((r) => <PageCard key={routeKey(r)} route={r} />)}
      </div>
    </section>
  );
}

function PageCard({ route, hint }: { route: Route; hint?: string }) {
  const nav = useContext(NavCtx);
  let desc = hint ?? '';
  if (!desc) {
    if (route.k === 'article') desc = ARTICLE_BY_ID.get(route.id)?.summary ?? '';
    else if (route.k === 'recipe') desc = RECIPE_BY_ID.get(route.id)?.summary ?? '';
    else if (route.k === 'node') desc = MODULES.find((m) => m.type === route.type)?.doc.summary ?? '';
  }
  return (
    <button type="button" className="dx-card" onClick={() => nav.go(route)}>
      <span className="dx-card-kind">{routeKind(route)}</span>
      <b>{routeTitle(route)}</b>
      {desc && <span className="dx-card-desc">{desc}</span>}
    </button>
  );
}

function PrevNext({ prev, next }: { prev?: Route; next?: Route }) {
  const nav = useContext(NavCtx);
  if (!prev && !next) return null;
  return (
    <nav className="dx-prevnext" aria-label="Previous and next">
      {prev ? <button type="button" onClick={() => nav.go(prev)}><span>← Previous</span><b>{routeTitle(prev)}</b></button> : <span />}
      {next ? <button type="button" className="next" onClick={() => nav.go(next)}><span>Next →</span><b>{routeTitle(next)}</b></button> : <span />}
    </nav>
  );
}

/* ───────────────────────── articles ───────────────────────── */

export function ArticlePage({ article }: { article: Article }) {
  const list = ARTICLES.filter((a) => a.group === article.group);
  const i = list.indexOf(article);
  const rel = (article.related ?? []).filter((id) => ARTICLE_BY_ID.has(id)).map((id) => ({ k: 'article', id }) as Route);
  return (
    <article>
      <PageHead eyebrow={article.group} title={article.title} lead={article.summary} route={{ k: 'article', id: article.id }} />
      <Blocks blocks={article.blocks} />
      <RelatedLinks routes={rel} />
      <PrevNext prev={i > 0 ? { k: 'article', id: list[i - 1].id } : undefined} next={i < list.length - 1 ? { k: 'article', id: list[i + 1].id } : undefined} />
    </article>
  );
}

/* ───────────────────────── node page ───────────────────────── */

function defaultText(p: ParamDef): string {
  switch (p.kind) {
    case 'number': return `${fmtNum(p.default)}${p.unit ? ' ' + p.unit : ''}`;
    case 'select': return p.options.find((o) => o.value === p.default)?.label ?? String(p.default);
    case 'bool': return p.default ? 'On' : 'Off';
    case 'text': return p.default === '' ? '(empty)' : String(p.default).length > 48 ? String(p.default).slice(0, 48) + '…' : String(p.default);
    default: return '';
  }
}

const KIND_LABEL: Record<string, string> = { number: 'Number', select: 'Choice', text: 'Text', bool: 'Switch', action: 'Button' };

function RangeBar({ p }: { p: Extract<ParamDef, { kind: 'number' }> }) {
  const span = p.max - p.min;
  const pct = span > 0 ? Math.min(100, Math.max(0, ((p.default - p.min) / span) * 100)) : 0;
  return (
    <div className="dx-range" aria-hidden="true">
      <span>{fmtNum(p.min)}</span>
      <div><i style={{ left: `${pct}%` }} /></div>
      <span>{fmtNum(p.max)}</span>
    </div>
  );
}

function SettingCard({ def, p, tip, options }: { def: ModuleDef; p: ParamDef; tip?: string; options?: Record<string, string> }) {
  const pin = def.paramPins?.find((q) => q.param === p.key);
  const hasPin = p.kind !== 'action' && !p.hidden && p.pin !== false;
  return (
    <article id={`dx-set-${p.key}`} className="dx-setting">
      <header>
        <h3>{p.label}</h3>
        <span className="dx-kind">{KIND_LABEL[p.kind]}</span>
        <code className="dx-code" title="Internal name">{p.key}</code>
      </header>
      <dl className="dx-meta">
        {p.kind !== 'action' && <><dt>Default</dt><dd>{defaultText(p)}</dd></>}
        {p.kind === 'number' && <><dt>Range</dt><dd>{fmtNum(p.min)} to {fmtNum(p.max)}{p.unit ? ` ${p.unit}` : ''}, step {fmtNum(p.step)}</dd></>}
      </dl>
      {p.kind === 'number' && <RangeBar p={p} />}
      <p className="dx-p">{p.doc}</p>
      {tip && <p className="dx-advice"><b>In practice</b><Rich x={tip} /></p>}
      {p.kind === 'select' && (
        <ul className="dx-options">
          {p.options.map((o) => (
            <li key={o.value} className={o.value === p.default ? 'def' : ''}>
              <span><b>{o.label}</b>{o.value === p.default && <em>default</em>}</span>
              {options?.[o.value] && <small><Rich x={options[o.value]} /></small>}
            </li>
          ))}
        </ul>
      )}
      <footer className="dx-pinnote">
        {hasPin && pin ? <><Icon name="link" size={12} />Also a <b>setting pin</b> on the {pin.side} edge. It accepts <TypeChip type={pin.type} />. While wired, it overrides this value. <DocLink route={{ k: 'article', id: 'setting-pins' }}>How setting pins work</DocLink></>
          : p.kind === 'action' ? <>A button in the inspector; it has no pin.</>
          : p.pin === false ? <>No setting pin: this choice decides which other settings exist.</>
          : null}
      </footer>
    </article>
  );
}

export function PackageCard({ pkg }: { pkg: MlPackage }) {
  return (
    <article id={`dx-pkg-${pkg.id}`} className="dx-pkg">
      <header>
        <h3>{pkg.name}</h3>
        <span className={`dx-badge ${pkg.status}`}>{pkg.status === 'available' ? 'Available offline' : 'Unavailable in this build'}</span>
      </header>
      <p className="dx-p">{pkg.description}</p>
      <dl className="dx-deflist">
        <dt>Technique</dt><dd>{pkg.technique}</dd>
        <dt>Input</dt><dd>{pkg.inputs}</dd>
        <dt>Output</dt><dd>{pkg.outputs}</dd>
        <dt>Needs</dt><dd>{pkg.requirements}</dd>
        <dt>Limits</dt><dd>{pkg.limitations}</dd>
        {pkg.params.length > 0 && <>
          <dt>Settings</dt>
          <dd><ul className="dx-minilist">{pkg.params.map((q) => <li key={q.key}><b>{q.label}</b> <span className="dx-dim">({paramSummary(q)})</span> {q.doc}</li>)}</ul></dd>
        </>}
      </dl>
    </article>
  );
}

function addToWorkspace(type: string, close: () => void) {
  const st = useStore.getState();
  const def = getDef(type);
  if (!def) return;
  const c = bridge.centerWorld?.() ?? { x: 0, y: 0 };
  const size = def.dim ?? SIZES[def.size];
  const n = Object.keys(st.project.graph.nodes).length % 5;
  const id = st.addNodeAt(type, Math.round(c.x - size.w / 2 + n * 12), Math.round(c.y - size.h / 2 + n * 12));
  if (id) { st.toast(`Added ${def.name} to the workspace.`, 'ok'); close(); }
}

export function NodePage({ type }: { type: string }) {
  const nav = useContext(NavCtx);
  const m = MODULES.find((x) => x.type === type);
  const nodes = useStore((s) => s.project.graph.nodes);
  if (!m) return <p className="dx-p">Unknown module.</p>;
  const d = getDef(type)!;
  const g = GUIDE[type];
  const mine = Object.values(nodes).filter((n) => n.type === type).map((n) => n.id);
  const params = d.params.filter((p) => !p.hidden);
  const host = type === 'knowledge' || type === 'imagination' ? type : null;
  const pkgs = host ? PACKAGES.filter((p) => p.host === host) : [];
  const recipes = RECIPES.filter((r) => r.nodes.some((n) => n.type === type));
  const cat = MODULES.filter((x) => x.category === m.category);
  const ci = cat.indexOf(m);
  const col = FAMILY_VAR[m.family];
  const pinList = [...m.inputs.map((p) => ({ p, dir: 'in' as const })), ...m.outputs.map((p) => ({ p, dir: 'out' as const }))];
  const setPins = d.paramPins ?? [];
  const showSel = () => {
    const st = useStore.getState();
    st.select(mine); st.setUi({ insp: true }); nav.close();
    setTimeout(() => bridge.focus?.(mine), 60);
  };

  return (
    <article>
      <PageHead eyebrow={`${m.category} · ${m.caption}`} title={m.name} swatch={col} lead={m.doc.summary} route={{ k: 'node', type }}>
        <div className="dx-actions">
          <button type="button" className="dx-btn primary" onClick={() => addToWorkspace(type, nav.close)}><Icon name="plus" size={14} />Add to workspace</button>
          {mine.length > 0 && <button type="button" className="dx-btn" onClick={showSel}><Icon name="focus" size={14} />Show in my program ({mine.length})</button>}
        </div>
        <ul className="dx-facts">
          <li><b>{m.inputs.length}</b> input{m.inputs.length === 1 ? '' : 's'}</li>
          <li><b>{m.outputs.length}</b> output{m.outputs.length === 1 ? '' : 's'}</li>
          <li><b>{params.length}</b> setting{params.length === 1 ? '' : 's'}</li>
          {m.delaying && <li className="hl" title="Holds state or time, so a feedback loop through it is allowed.">Holds state · loop-safe</li>}
          {m.source && <li className="hl" title="Evaluates once at start without needing an input.">Runs at start</li>}
        </ul>
      </PageHead>

      {g && (
        <section>
          <h2 className="dx-h2" id="dx-quick" data-toc="Quick start">Quick start</h2>
          <p className="dx-when"><b>Use it when</b> <Rich x={g.when} /></p>
          <ol className="dx-ol">{g.steps.map((s, i) => <li key={i}><Rich x={s} /></li>)}</ol>
          {(g.up?.length || g.down?.length) ? (
            <div className="dx-pairs">
              {g.up?.length ? <div><span className="dx-dim">Often fed by</span><div>{g.up.map((t) => <NodeChip key={t} type={t} />)}</div></div> : null}
              {g.down?.length ? <div><span className="dx-dim">Often feeds</span><div>{g.down.map((t) => <NodeChip key={t} type={t} />)}</div></div> : null}
            </div>
          ) : null}
        </section>
      )}

      <section>
        <h2 className="dx-h2" id="dx-pins" data-toc="Pins">Pins</h2>
        <PinMap def={d} />
        <div className="dx-table-wrap">
          <table className="dx-table">
            <thead><tr><th scope="col">Pin</th><th scope="col">Direction</th><th scope="col">Type</th><th scope="col">Required</th><th scope="col">What it does</th></tr></thead>
            <tbody>
              {pinList.length === 0 && <tr><td colSpan={5} className="dx-dim">This module has no signal pins.</td></tr>}
              {pinList.map(({ p, dir }) => {
                const side = portSide(p, dir);
                return (
                  <tr key={dir + p.id} id={`dx-pin-${p.id}`}>
                    <th scope="row">{p.label}<small className="dx-dim"> {side}</small></th>
                    <td>{dir === 'in' ? 'Input' : 'Output'}</td>
                    <td><TypeChip type={p.type} /></td>
                    <td>{dir === 'out' ? '—' : p.optional ? 'Optional' : <b>Required</b>}</td>
                    <td>{p.doc}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {setPins.length > 0 && <p className="dx-small">Plus <b>{setPins.length}</b> <DocLink route={{ k: 'article', id: 'setting-pins' }}>setting pin{setPins.length === 1 ? '' : 's'}</DocLink> on the left and top edges, one per setting below.</p>}
      </section>

      <section>
        <h2 className="dx-h2" id="dx-settings" data-toc="Settings">Settings</h2>
        {params.length === 0 ? <p className="dx-p dx-dim">This module has no settings. {m.category === 'Sensor' ? 'It is driven by the pad or device.' : ''}</p> : (
          <>
            <p className="dx-small">Edit these in the inspector (right sidebar) after selecting the module. Each is also available as a setting pin.</p>
            <div className="dx-settings">
              {params.map((p) => <SettingCard key={p.key} def={d} p={p} tip={g?.settings?.[p.key]} options={g?.options?.[p.key]} />)}
            </div>
          </>
        )}
        {pkgs.length > 0 && (
          <>
            <h3 className="dx-h3" id="dx-packages">Packages and their settings</h3>
            <p className="dx-small">Choosing a package adds its own settings to the inspector. <DocLink route={{ k: 'packages' }}>See all packages</DocLink>.</p>
            {pkgs.map((p) => <PackageCard key={p.id} pkg={p} />)}
          </>
        )}
      </section>

      <section>
        <h2 className="dx-h2" id="dx-behavior" data-toc="How it behaves">How it behaves</h2>
        <p className="dx-p">{m.doc.runtime}</p>
        {m.delaying && <Callout kind="note" title="Holds state or time">This module remembers something between ticks, so a connection that loops back through it is legal. See <DocLink route={{ k: 'article', id: 'feedback' }}>Feedback loops</DocLink>.</Callout>}
        {m.source && <Callout kind="note" title="Starts on its own">It evaluates once when the program starts, even before any input arrives.</Callout>}
      </section>

      {(g?.tips?.length || g?.pitfalls?.length || m.doc.errors?.length) ? (
        <section>
          <h2 className="dx-h2" id="dx-tips" data-toc="Tips and pitfalls">Tips and pitfalls</h2>
          {g?.tips?.map((t, i) => <Callout key={'t' + i} kind="tip"><Rich x={t} /></Callout>)}
          {[...(g?.pitfalls ?? []), ...(m.doc.errors ?? [])].map((t, i) => <Callout key={'w' + i} kind="warn"><Rich x={t} /></Callout>)}
        </section>
      ) : null}

      {(m.doc.examples?.length || recipes.length) ? (
        <section>
          <h2 className="dx-h2" id="dx-examples" data-toc="Examples">Examples</h2>
          {m.doc.examples && <ul className="dx-ul">{m.doc.examples.map((e) => <li key={e}>{e}</li>)}</ul>}
          {recipes.length > 0 && (
            <>
              <p className="dx-small">Programs in the Cookbook that use {m.name}:</p>
              <div className="dx-cards sm">{recipes.map((r) => <PageCard key={r.id} route={{ k: 'recipe', id: r.id }} />)}</div>
            </>
          )}
        </section>
      ) : null}

      <PrevNext prev={ci > 0 ? { k: 'node', type: cat[ci - 1].type } : undefined} next={ci < cat.length - 1 ? { k: 'node', type: cat[ci + 1].type } : undefined} />
    </article>
  );
}

/** The module drawn with its pins on the sides where they really are. Click a pin to jump to its row. */
function PinMap({ def }: { def: ModuleDef }) {
  const by = useMemo(() => {
    const out: Record<string, { id: string; label: string; type: string; dir: 'in' | 'out'; setting: boolean; key?: string; optional?: boolean }[]> = { top: [], bottom: [], left: [], right: [] };
    for (const p of def.inputs) out[portSide(p, 'in')].push({ id: p.id, label: p.label, type: p.type, dir: 'in', setting: !!p.param, key: p.param, optional: p.optional });
    for (const p of def.outputs) out[portSide(p, 'out')].push({ id: p.id, label: p.label, type: p.type, dir: 'out', setting: false });
    return out;
  }, [def]);
  const jump = (p: { id: string; setting: boolean; key?: string }) => document.getElementById(p.setting ? `dx-set-${p.key}` : `dx-pin-${p.id}`)?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  const Side = ({ side }: { side: string }) => (
    <div className={`dx-pm-side ${side}`}>
      {by[side].map((p) => (
        <button type="button" key={p.dir + p.id} className={`dx-pm-pin ${p.dir} ${p.setting ? 'set' : ''}`} style={{ ['--tc' as string]: TYPE_C[p.type] }} onClick={() => jump(p)} title={`${p.dir === 'in' ? 'Input' : 'Output'} · ${p.type}${p.setting ? ' · setting pin' : p.optional ? ' · optional' : ''}`}>
          <i />{p.label}
        </button>
      ))}
    </div>
  );
  return (
    <figure className="dx-pinmap" aria-label={`Pin map of ${def.name}`}>
      <div className="dx-pm-top"><Side side="top" /></div>
      <div className="dx-pm-left"><Side side="left" /></div>
      <div className="dx-pm-node"><PreviewNode def={def} scale={0.9} /></div>
      <div className="dx-pm-right"><Side side="right" /></div>
      <div className="dx-pm-bottom"><Side side="bottom" /></div>
      <figcaption>
        <span className="dx-pm-key in"><i />input</span><span className="dx-pm-key out"><i />output</span><span className="dx-pm-key set"><i />setting pin</span>
        <span className="dx-dim">Colour = signal type. Click a pin to jump to it.</span>
      </figcaption>
    </figure>
  );
}
const TYPE_C: Record<string, string> = { num: '#6fd3ee', bool: '#3ddc97', text: '#f7c52b', image: '#ff8a50', data: '#c08bff', any: '#a8a8a8' };

/* ───────────────────────── indexes ───────────────────────── */

export function NodesIndex() {
  const [cat, setCat] = useState<string>('All');
  return (
    <article>
      <PageHead eyebrow="Reference" title="Node reference" lead={`All ${MODULES.length} modules. Each page has pins, every setting with its range and default, practical advice, and the recipes that use it.`} />
      <div className="dx-chips" role="tablist" aria-label="Filter by category">
        {['All', ...CATEGORIES].map((c) => <button key={c} type="button" role="tab" aria-selected={cat === c} className={`dx-chip ${cat === c ? 'on' : ''}`} onClick={() => setCat(c)}>{c}{c !== 'All' && <small>{MODULES.filter((m) => m.category === c).length}</small>}</button>)}
      </div>
      {CATEGORIES.filter((c) => cat === 'All' || c === cat).map((c) => (
        <section key={c}>
          <h2 className="dx-h2" id={`dx-${slug(c)}`} data-toc={CAT_LABEL[c]}>{CAT_LABEL[c]}</h2>
          <div className="dx-nodegrid">
            {MODULES.filter((m) => m.category === c).map((m) => <NodeTile key={m.type} m={m} />)}
          </div>
        </section>
      ))}
    </article>
  );
}

function NodeTile({ m }: { m: ModuleDef }) {
  const nav = useContext(NavCtx);
  return (
    <button type="button" className="dx-tile" onClick={() => nav.go({ k: 'node', type: m.type })} style={{ ['--c' as string]: FAMILY_VAR[m.family] }}>
      <i className="dx-tile-bar" />
      <b>{m.name}</b>
      <span className="dx-tile-cap">{m.caption}</span>
      <span className="dx-tile-desc">{m.doc.summary}</span>
    </button>
  );
}

export function SettingsIndex() {
  const nav = useContext(NavCtx);
  const [q, setQ] = useState('');
  const [kind, setKind] = useState('all');
  const rows = useMemo(() => {
    const out: { m: ModuleDef; p: ParamDef; label: string; anchor: string; extra?: string }[] = [];
    for (const m of MODULES) {
      const d = getDef(m.type)!;
      for (const p of d.params) if (!p.hidden) out.push({ m, p, label: p.label, anchor: `set-${p.key}` });
      if (m.type === 'knowledge' || m.type === 'imagination') for (const pk of PACKAGES.filter((x) => x.host === m.type)) for (const p of pk.params) out.push({ m, p, label: p.label, anchor: `pkg-${pk.id}`, extra: pk.short });
    }
    return out;
  }, []);
  const tokens = q.toLowerCase().split(/\s+/).filter(Boolean);
  const shown = rows.filter((r) => (kind === 'all' || r.p.kind === kind) && tokens.every((t) => `${r.m.name} ${r.m.caption} ${r.label} ${r.p.key} ${r.p.doc} ${r.extra ?? ''}`.toLowerCase().includes(t)));
  const groups = MODULES.map((m) => ({ m, items: shown.filter((r) => r.m === m) })).filter((g) => g.items.length);
  return (
    <article>
      <PageHead eyebrow="Reference" title="Settings index" lead={`Every setting of every module (${rows.length} in all), on one page. Filter by name, description or kind, then jump to the full explanation.`} />
      <div className="dx-filterbar">
        <label className="dx-input"><Icon name="search" size={14} /><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Filter settings: e.g. “decay”, “hysteresis”, “seed”" aria-label="Filter settings" spellCheck={false} />{q && <button type="button" aria-label="Clear filter" onClick={() => setQ('')}><Icon name="close" size={12} /></button>}</label>
        <div className="dx-chips" role="group" aria-label="Filter by kind">
          {[['all', 'All'], ['number', 'Numbers'], ['select', 'Choices'], ['bool', 'Switches'], ['text', 'Text'], ['action', 'Buttons']].map(([k, l]) => <button key={k} type="button" className={`dx-chip ${kind === k ? 'on' : ''}`} aria-pressed={kind === k} onClick={() => setKind(k)}>{l}</button>)}
        </div>
      </div>
      <p className="dx-small" aria-live="polite">{shown.length} setting{shown.length === 1 ? '' : 's'} in {groups.length} module{groups.length === 1 ? '' : 's'}.</p>
      {groups.length === 0 && <p className="dx-empty">Nothing matches. Try fewer words.</p>}
      {groups.map(({ m, items }) => (
        <section key={m.type} className="dx-sgroup">
          <h2 className="dx-h2" id={`dx-${m.type}`} data-toc={m.name}><i style={{ background: FAMILY_VAR[m.family] }} /><DocLink route={{ k: 'node', type: m.type }}>{m.name}</DocLink><span className="dx-tag">{m.category}</span></h2>
          <div className="dx-table-wrap">
            <table className="dx-table compact">
              <thead><tr><th scope="col">Setting</th><th scope="col">Kind</th><th scope="col">Default and range</th><th scope="col">What it does</th></tr></thead>
              <tbody>
                {items.map((r, i) => (
                  <tr key={i} className="dx-clickrow" onClick={() => nav.go({ k: 'node', type: m.type }, r.anchor)}>
                    <th scope="row"><button type="button" className="dx-link" onClick={(e) => { e.stopPropagation(); nav.go({ k: 'node', type: m.type }, r.anchor); }}>{r.extra ? `${r.extra} · ` : ''}{r.label}</button></th>
                    <td>{KIND_LABEL[r.p.kind]}</td>
                    <td className="dx-dim">{r.p.kind === 'action' ? '—' : `${defaultText(r.p)}${r.p.kind === 'number' ? ` (${fmtNum(r.p.min)} to ${fmtNum(r.p.max)})` : ''}`}</td>
                    <td>{r.p.doc}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ))}
    </article>
  );
}

export function PackagesPage() {
  return (
    <article>
      <PageHead eyebrow="Reference" title="Inference packages" lead="Packages are the analysis techniques hosted inside a Knowledge or Imagination nucleus. Each one states honestly what it is, what it needs and where it breaks." route={{ k: 'packages' }} />
      <Callout kind="tip" title="How to use one">Add <DocLink route={{ k: 'node', type: 'knowledge' }}>Knowledge</DocLink> or <DocLink route={{ k: 'node', type: 'imagination' }}>Imagination</DocLink>, then choose the package in the inspector. Library → Presets places a node with the package already chosen.</Callout>
      <h2 className="dx-h2" id="dx-knowledge" data-toc="Knowledge packages">Knowledge packages <small className="dx-dim">classify and label</small></h2>
      {PACKAGES.filter((p) => p.host === 'knowledge').map((p) => <PackageCard key={p.id} pkg={p} />)}
      <h2 className="dx-h2" id="dx-imagination" data-toc="Imagination packages">Imagination packages <small className="dx-dim">predict, score, generate</small></h2>
      {PACKAGES.filter((p) => p.host === 'imagination').map((p) => <PackageCard key={p.id} pkg={p} />)}
    </article>
  );
}

/* ───────────────────────── finder ───────────────────────── */

export function GoalGrid({ limit }: { limit?: number }) {
  const nav = useContext(NavCtx);
  return (
    <div className="dx-goals">
      {GOALS.slice(0, limit).map((g) => (
        <section key={g.goal} id={`dx-goal-${slug(g.goal)}`} className="dx-goal">
          <h3>{g.goal}</h3>
          <p>{g.hint}</p>
          <div>{g.nodes.map((t) => <NodeChip key={t} type={t} />)}</div>
          {g.recipe && <button type="button" className="dx-linkrow" onClick={() => nav.go({ k: 'recipe', id: g.recipe! })}>See it built: {RECIPE_BY_ID.get(g.recipe)?.title} →</button>}
        </section>
      ))}
    </div>
  );
}

export function FinderPage() {
  return (
    <article>
      <PageHead eyebrow="Start here" title="Find a node by goal" lead="Start from what you want to happen. Each card lists the modules that do it, and links to a working recipe when there is one." route={{ k: 'finder' }} />
      <GoalGrid />
    </article>
  );
}

/* ───────────────────────── recipes ───────────────────────── */

export function RecipesPage() {
  const [level, setLevel] = useState('All');
  const list = RECIPES.filter((r) => level === 'All' || r.level === level);
  return (
    <article>
      <PageHead eyebrow="Cookbook" title="Cookbook" lead="Complete, working wiring patterns. Load any of them into the workspace with one click, press Run, then change things and watch what happens." />
      <div className="dx-chips" role="group" aria-label="Filter by level">
        {['All', 'Beginner', 'Intermediate'].map((l) => <button key={l} type="button" aria-pressed={level === l} className={`dx-chip ${level === l ? 'on' : ''}`} onClick={() => setLevel(l)}>{l}</button>)}
      </div>
      <div className="dx-cards">
        {list.map((r) => (
          <RecipeCard key={r.id} r={r} />
        ))}
      </div>
    </article>
  );
}

function RecipeCard({ r }: { r: Recipe }) {
  const nav = useContext(NavCtx);
  return (
    <button type="button" className="dx-card" onClick={() => nav.go({ k: 'recipe', id: r.id })}>
      <span className="dx-card-kind">{r.level}</span>
      <b>{r.title}</b>
      <span className="dx-card-desc">{r.summary}</span>
      <RecipeDiagram r={r} mini />
    </button>
  );
}

export function RecipeDiagram({ r, mini }: { r: Recipe; mini?: boolean }) {
  const boxes = useMemo(() => r.nodes.map((n) => {
    const d = getDef(n.type, undefined, n.params)!;
    const s = d.dim ?? SIZES[d.size];
    return { ...n, w: s.w, h: s.h, name: d.name, col: FAMILY_VAR[d.family] };
  }), [r]);
  const x0 = Math.min(...boxes.map((b) => b.x)) - 24, y0 = Math.min(...boxes.map((b) => b.y)) - 24;
  const x1 = Math.max(...boxes.map((b) => b.x + b.w)) + 24, y1 = Math.max(...boxes.map((b) => b.y + b.h)) + 24;
  const by = new Map(boxes.map((b) => [b.id, b]));
  return (
    <svg className={`dx-diagram ${mini ? 'mini' : ''}`} viewBox={`${x0} ${y0} ${x1 - x0} ${y1 - y0}`} role="img" aria-label={`Wiring diagram: ${r.nodes.map((n) => n.type).join(', ')}`} preserveAspectRatio="xMidYMid meet">
      <defs><marker id={`ah-${r.id}${mini ? 'm' : ''}`} viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto"><path d="M0 0L8 4L0 8z" fill="#8d8d8d" /></marker></defs>
      {r.wires.map(([a, , b], i) => {
        const A = by.get(a)!, B = by.get(b)!;
        const down = B.y > A.y + A.h - 4;
        const ax = down ? A.x + A.w / 2 : A.x + A.w, ay = down ? A.y + A.h : A.y + A.h / 2;
        const bx = down ? B.x + B.w / 2 : B.x, by2 = down ? B.y : B.y + B.h / 2;
        const dy = down ? Math.max(24, (by2 - ay) / 2) : 0, dx = down ? 0 : Math.max(24, (bx - ax) / 2);
        return <path key={i} d={`M${ax} ${ay} C${ax + dx} ${ay + dy} ${bx - dx} ${by2 - dy} ${bx} ${by2}`} fill="none" stroke="#6a6a6a" strokeWidth={mini ? 3 : 2} markerEnd={`url(#ah-${r.id}${mini ? 'm' : ''})`} />;
      })}
      {boxes.map((b) => (
        <g key={b.id}>
          <rect x={b.x} y={b.y} width={b.w} height={b.h} rx="10" fill="#050505" stroke={b.col} strokeWidth={mini ? 3 : 1.6} />
          <text x={b.x + b.w / 2} y={b.y + b.h / 2} textAnchor="middle" dominantBaseline="middle" fill={b.col} fontSize={mini ? 22 : 19} fontWeight="500">{b.name}</text>
        </g>
      ))}
    </svg>
  );
}

export function RecipePage({ r }: { r: Recipe }) {
  const idx = RECIPES.indexOf(r);
  const hasWork = useStore((s) => Object.keys(s.project.graph.nodes).length > 0);
  const label = (type: string, port: string) => {
    const d = getDef(type);
    const p = [...(d?.inputs ?? []), ...(d?.outputs ?? [])].find((q) => q.id === port);
    return p?.label ?? port;
  };
  const typeOf = (id: string) => r.nodes.find((n) => n.id === id)!.type;
  const used = [...new Set(r.nodes.map((n) => n.type))];
  return (
    <article>
      <PageHead eyebrow={`Cookbook · ${r.level}`} title={r.title} lead={r.summary} route={{ k: 'recipe', id: r.id }}>
        <div className="dx-actions">
          <button type="button" className="dx-btn primary" onClick={() => openTemplate(recipeTemplate(r))}><Icon name="open" size={14} />Load into workspace</button>
        </div>
        {hasWork && <p className="dx-small">Your current program is kept under File → Open or import → Saved programs.</p>}
      </PageHead>
      <RecipeDiagram r={r} />
      <h2 className="dx-h2" id="dx-what-each-part-does" data-toc="What each part does">What each part does</h2>
      <ol className="dx-ol">{r.steps.map((s, i) => <li key={i}><Rich x={s} /></li>)}</ol>
      <h2 className="dx-h2" id="dx-wiring" data-toc="Wiring">Wiring</h2>
      <ul className="dx-wires">
        {r.wires.map(([a, ap, b, bp], i) => (
          <li key={i}>
            <DocLink route={{ k: 'node', type: typeOf(a) }}>{MODULES.find((m) => m.type === typeOf(a))!.name}</DocLink><b>{label(typeOf(a), ap)}</b>
            <span className="dx-arrow">→</span>
            <DocLink route={{ k: 'node', type: typeOf(b) }}>{MODULES.find((m) => m.type === typeOf(b))!.name}</DocLink><b>{bp.startsWith('p:') ? `${label(typeOf(b), bp)} (setting pin)` : label(typeOf(b), bp)}</b>
          </li>
        ))}
      </ul>
      <h2 className="dx-h2" id="dx-what-you-should-see" data-toc="What you should see">What you should see</h2>
      <Callout kind="note">{r.expect}</Callout>
      <h2 className="dx-h2" id="dx-try-changing" data-toc="Try changing">Try changing</h2>
      <ul className="dx-ul">{r.tweak.map((t, i) => <li key={i}><Rich x={t} /></li>)}</ul>
      <h2 className="dx-h2" id="dx-modules-used" data-toc="Modules used">Modules used</h2>
      <div className="dx-pairs"><div>{used.map((t) => <NodeChip key={t} type={t} />)}</div></div>
      <PrevNext prev={idx > 0 ? { k: 'recipe', id: RECIPES[idx - 1].id } : undefined} next={idx < RECIPES.length - 1 ? { k: 'recipe', id: RECIPES[idx + 1].id } : undefined} />
    </article>
  );
}

/* ───────────────────────── home ───────────────────────── */

export function Home({ recent, bookmarks, onSearch }: { recent: string[]; bookmarks: string[]; onSearch: (q: string) => void }) {
  const nav = useContext(NavCtx);
  const selection = useStore((s) => s.selection);
  const graph = useStore((s) => s.project.graph);
  const selNode = selection.length === 1 ? graph.nodes[selection[0]] : undefined;
  const selDef = selNode && MODULES.find((m) => m.type === selNode.type);
  const keyRoutes = (keys: string[]) => keys.map((k) => { const [kk, id] = k.split(':'); return kk === 'node' ? ({ k: 'node', type: id } as Route) : kk === 'article' ? ({ k: 'article', id } as Route) : kk === 'recipe' ? ({ k: 'recipe', id } as Route) : ({ k: kk } as Route); });
  const SUGGEST = ['threshold hysteresis', 'smooth', 'timer', 'microphone', 'setting pin', 'loop', 'sentiment', 'keyboard', 'range', 'camera permission'];
  return (
    <article>
      <header className="dx-hero">
        <div className="dx-eyebrow">Neural Studio</div>
        <h1 className="dx-h1 big">How can we help?</h1>
        <p className="dx-lead">Search every module, setting, pin, recipe and guide. Or pick a place to start.</p>
        <div className="dx-suggest" aria-label="Try searching for">
          <span className="dx-dim">Try</span>
          {SUGGEST.map((s) => <button key={s} type="button" className="dx-chip" onClick={() => onSearch(s)}>{s}</button>)}
        </div>
      </header>

      {selDef && (
        <button type="button" className="dx-selected" onClick={() => nav.go({ k: 'node', type: selDef.type })}>
          <i style={{ background: FAMILY_VAR[selDef.family] }} />
          <span><small>You have this selected</small><b>{selDef.name}: read its documentation</b></span>
          <Icon name="chevron" size={16} />
        </button>
      )}

      {bookmarks.length > 0 && (
        <section><h2 className="dx-h2 plain">Your bookmarks</h2><div className="dx-cards sm">{keyRoutes(bookmarks).map((r) => <PageCard key={routeKey(r)} route={r} />)}</div></section>
      )}

      <section>
        <h2 className="dx-h2 plain">Start here</h2>
        <div className="dx-cards">
          <PageCard route={{ k: 'article', id: 'welcome' }} />
          <PageCard route={{ k: 'article', id: 'first-program' }} />
          <PageCard route={{ k: 'article', id: 'interface' }} />
          <PageCard route={{ k: 'article', id: 'setting-pins' }} />
        </div>
      </section>

      <section>
        <h2 className="dx-h2 plain">Browse the node reference</h2>
        <div className="dx-cats">
          {CATEGORIES.map((c) => {
            const list = MODULES.filter((m) => m.category === c);
            return (
              <button key={c} type="button" className="dx-cat" onClick={() => nav.go({ k: 'nodes' }, slug(c))} style={{ ['--c' as string]: FAMILY_VAR[list[0].family] }}>
                <b>{CAT_LABEL[c]}</b>
                <small>{list.length} modules</small>
                <span>{list.slice(0, 4).map((m) => m.name).join(', ')}…</span>
              </button>
            );
          })}
        </div>
      </section>

      <section>
        <h2 className="dx-h2 plain">I want to…</h2>
        <GoalGrid limit={6} />
        <button type="button" className="dx-linkrow" onClick={() => nav.go({ k: 'finder' })}>See all {GOALS.length} goals →</button>
      </section>

      <section>
        <h2 className="dx-h2 plain">Cookbook</h2>
        <div className="dx-cards">{RECIPES.slice(0, 3).map((r) => <RecipeCard key={r.id} r={r} />)}</div>
        <button type="button" className="dx-linkrow" onClick={() => nav.go({ k: 'recipes' })}>All {RECIPES.length} recipes →</button>
      </section>

      {recent.length > 0 && (
        <section><h2 className="dx-h2 plain">Recently viewed</h2><div className="dx-cards sm">{keyRoutes(recent.slice(0, 4)).map((r) => <PageCard key={routeKey(r)} route={r} />)}</div></section>
      )}

      <section>
        <h2 className="dx-h2 plain">Reference</h2>
        <div className="dx-cards sm">
          <PageCard route={{ k: 'settings' }} hint="Every setting of every module on one filterable page." />
          <PageCard route={{ k: 'packages' }} hint="Technique, needs and limits for each Knowledge and Imagination package." />
          <PageCard route={{ k: 'article', id: 'troubleshooting' }} />
          <PageCard route={{ k: 'article', id: 'shortcuts' }} />
          <PageCard route={{ k: 'article', id: 'glossary' }} />
          <PageCard route={{ k: 'article', id: 'debugging' }} />
        </div>
      </section>
    </article>
  );
}
