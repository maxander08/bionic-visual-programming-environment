import { Fragment, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { CATEGORIES, MODULES } from '../../core/registry';
import { useStore } from '../../state/store';
import { Icon } from '../icons';
import { FAMILY_VAR } from '../NodeView';
import { ARTICLE_BY_ID } from './content';
import { RECIPES } from './recipes';
import { tr } from '../../i18n';
import { CAT_LABEL, routeFromKey, routeTitle } from './meta';
import { KIND_ORDER, search, snippet, tokenize, type Hit, type Kind } from './search';
import { ArticlePage, FinderPage, Home, NodePage, NodesIndex, PackagesPage, RecipePage, RecipesPage, SettingsIndex, Star } from './pages';
import { NavCtx, routeKey, type Nav, type Route } from './types';
import './docs.css';

/* ───────────── persistence (bookmarks and recent pages) ───────────── */

const LS = 'ns-docs-v1';
interface Saved { bookmarks: string[]; recent: string[] }
function load(): Saved {
  try {
    const v = JSON.parse(localStorage.getItem(LS) ?? '{}');
    return { bookmarks: Array.isArray(v.bookmarks) ? v.bookmarks.filter((x: unknown) => typeof x === 'string') : [], recent: Array.isArray(v.recent) ? v.recent.filter((x: unknown) => typeof x === 'string') : [] };
  } catch { return { bookmarks: [], recent: [] }; }
}
function save(s: Saved) { try { localStorage.setItem(LS, JSON.stringify(s)); } catch { /* storage unavailable: bookmarks last for this session only */ } }

/* ───────────── sidebar structure ───────────── */

const A = (id: string): Route => ({ k: 'article', id });
const SIDEBAR: { title: string; items: Route[]; open?: boolean }[] = [
  { title: 'Start here', open: true, items: [A('welcome'), A('first-program'), A('interface'), { k: 'finder' }] },
  { title: 'Core concepts', open: true, items: [A('signals'), A('pins'), A('setting-pins'), A('connections'), A('execution'), A('feedback'), A('compounds')] },
  { title: 'Guides', open: true, items: [A('sensors-permissions'), A('debugging'), A('saving-sharing')] },
  { title: 'Cookbook', items: [{ k: 'recipes' }, ...RECIPES.map((r): Route => ({ k: 'recipe', id: r.id }))] },
  { title: 'Reference', open: true, items: [{ k: 'settings' }, { k: 'packages' }, A('shortcuts'), A('troubleshooting'), A('glossary')] },
];

function breadcrumb(r: Route): string[] {
  switch (r.k) {
    case 'home': return ['Docs'];
    case 'node': return ['Docs', 'Node reference', MODULES.find((m) => m.type === r.type)?.category ? CAT_LABEL[MODULES.find((m) => m.type === r.type)!.category] : '', routeTitle(r)];
    case 'article': return ['Docs', ARTICLE_BY_ID.get(r.id)?.group ?? 'Guide', routeTitle(r)];
    case 'recipe': return ['Docs', 'Cookbook', routeTitle(r)];
    case 'finder': return ['Docs', 'Start here', routeTitle(r)];
    default: return ['Docs', routeTitle(r)];
  }
}

function Hl({ text, tokens }: { text: string; tokens: string[] }) {
  if (!tokens.length) return <>{text}</>;
  const re = new RegExp(`(${tokens.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})`, 'ig');
  return <>{text.split(re).map((p, i) => (i % 2 ? <mark key={i}>{p}</mark> : <Fragment key={i}>{p}</Fragment>))}</>;
}

/* ───────────── search results ───────────── */

function Results({ q, kind, setKind, active, setActive, hits, counts, open }: {
  q: string; kind: Kind | 'All'; setKind: (k: Kind | 'All') => void; active: number; setActive: (i: number) => void;
  hits: Hit[]; counts: Map<string, number>; open: (h: Hit) => void;
}) {
  const nav = useContext(NavCtx);
  const tokens = tokenize(q);
  const total = [...counts.values()].reduce((a, b) => a + b, 0);
  const list = hits.slice(0, 60);
  useEffect(() => { document.querySelector('.dx-result.active')?.scrollIntoView({ block: 'nearest' }); }, [active]);
  return (
    <section aria-label={tr("Search results")}>
      <header className="dx-head">
        <div className="dx-eyebrow">Search</div>
        <h1 className="dx-h1">Results for “{q}”</h1>
        <p className="dx-small" aria-live="polite">{total} match{total === 1 ? '' : 'es'}{kind !== 'All' ? ` in ${kind.toLowerCase()}` : ''}. Use ↑ ↓ and Enter, or click.</p>
      </header>
      <div className="dx-chips" role="group" aria-label={tr("Filter results by type")}>
        <button type="button" className={`dx-chip ${kind === 'All' ? 'on' : ''}`} aria-pressed={kind === 'All'} onClick={() => setKind('All')}>All<small>{total}</small></button>
        {KIND_ORDER.filter((k) => counts.get(k)).map((k) => <button key={k} type="button" className={`dx-chip ${kind === k ? 'on' : ''}`} aria-pressed={kind === k} onClick={() => setKind(k)}>{k === 'Fix' ? 'Fixes' : k + 's'}<small>{counts.get(k)}</small></button>)}
      </div>
      {list.length === 0 ? (
        <div className="dx-empty">
          <b>Nothing found for “{q}”.</b>
          <p>Try fewer or simpler words, or a different spelling. You can search for a module (“fear”), a setting (“hysteresis”), a task (“smooth”) or a symptom (“stuck”).</p>
          <div className="dx-actions">
            <button type="button" className="dx-btn" onClick={() => nav.go({ k: 'finder' })}>Find a node by goal</button>
            <button type="button" className="dx-btn" onClick={() => nav.go({ k: 'nodes' })}>Browse all nodes</button>
            <button type="button" className="dx-btn" onClick={() => nav.go({ k: 'article', id: 'troubleshooting' })}>Troubleshooting</button>
          </div>
        </div>
      ) : (
        <ul className="dx-results" role="listbox" aria-label={tr("Results")}>
          {list.map((h, i) => (
            <li key={h.entry.id} role="option" aria-selected={i === active}>
              <button type="button" className={`dx-result ${i === active ? 'active' : ''}`} onMouseMove={() => i !== active && setActive(i)} onClick={() => open(h)}>
                <span className="dx-rk" style={h.entry.family ? { ['--c' as string]: FAMILY_VAR[h.entry.family] } : undefined}>{h.entry.kind}</span>
                <span className="dx-rt"><b><Hl text={h.entry.title} tokens={tokens} /></b><em><Hl text={h.entry.sub} tokens={tokens} /></em></span>
                <span className="dx-rs"><Hl text={snippet(h.entry.body, tokens)} tokens={tokens} /></span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {hits.length > list.length && <p className="dx-small">Showing the best {list.length} of {hits.length}. Add a word to narrow it down.</p>}
    </section>
  );
}


function NavItem({ r, label, ckey, go }: { r: Route; label?: string; ckey: string; go: (r: Route) => void }) {
  const on = routeKey(r) === ckey;
  return <button type="button" className={`dx-nav-item ${on ? 'on' : ''}`} aria-current={on ? 'page' : undefined} onClick={() => go(r)}>{tr(label ?? routeTitle(r))}</button>;
}

function NavGroup({ title, open, onToggle, count, children }: { title: string; open: boolean; onToggle: () => void; count?: number; children: ReactNode }) {
  return (
    <div className="dx-group">
      <button type="button" className="dx-group-head" aria-expanded={open} onClick={onToggle}>
        <Icon name="chevron" size={11} /><span>{tr(title)}</span>{count != null && <small>{count}</small>}
      </button>
      {open && <div className="dx-group-body">{children}</div>}
    </div>
  );
}

/* ───────────── shell ───────────── */

interface Entry { route: Route; anchor?: string }

export function Docs({ onClose }: { onClose: () => void }) {
  const selection = useStore((s) => s.selection);
  const nodes = useStore((s) => s.project.graph.nodes);
  const shell = useRef<HTMLDivElement>(null);
  const main = useRef<HTMLElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const prevFocus = useRef<Element | null>(null);

  const [saved, setSaved] = useState<Saved>(load);
  const [hist, setHist] = useState<{ stack: Entry[]; pos: number }>(() => {
    const n = selection.length === 1 ? nodes[selection[0]] : undefined;
    const start: Route = n && MODULES.some((m) => m.type === n.type) ? { k: 'node', type: n.type } : { k: 'home' };
    return { stack: [{ route: start }], pos: 0 };
  });
  const [q, setQ] = useState('');
  const [kind, setKind] = useState<Kind | 'All'>('All');
  const [active, setActive] = useState(0);
  const [menu, setMenu] = useState(false);
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>({});
  const [toc, setToc] = useState<{ id: string; text: string }[]>([]);
  const [spy, setSpy] = useState('');

  const cur = hist.stack[hist.pos];
  const ckey = routeKey(cur.route);

  const go = useCallback((route: Route, anchor?: string) => {
    setQ(''); setMenu(false);
    setHist((h) => {
      const here = h.stack[h.pos];
      if (routeKey(here.route) === routeKey(route) && !anchor && !here.anchor) { main.current?.scrollTo({ top: 0, behavior: 'smooth' }); return h; }
      const stack = [...h.stack.slice(0, h.pos + 1), { route, anchor }];
      return { stack, pos: stack.length - 1 };
    });
  }, []);
  const back = useCallback(() => { setQ(''); setHist((h) => (h.pos > 0 ? { ...h, pos: h.pos - 1 } : h)); }, []);
  const fwd = useCallback(() => { setQ(''); setHist((h) => (h.pos < h.stack.length - 1 ? { ...h, pos: h.pos + 1 } : h)); }, []);

  const nav = useMemo<Nav>(() => ({
    go, close: onClose,
    isBookmarked: (k) => saved.bookmarks.includes(k),
    toggleBookmark: (k) => setSaved((s) => { const next = { ...s, bookmarks: s.bookmarks.includes(k) ? s.bookmarks.filter((x) => x !== k) : [k, ...s.bookmarks] }; save(next); return next; }),
  }), [go, onClose, saved.bookmarks]);

  // record recently viewed pages
  useEffect(() => {
    if (cur.route.k === 'home') return;
    setSaved((s) => { const recent = [ckey, ...s.recent.filter((x) => x !== ckey)].slice(0, 8); const next = { ...s, recent }; save(next); return next; });
  }, [ckey, cur.route.k]);

  // scroll to the anchor (or the top) after each navigation, and build the on-this-page list
  useEffect(() => {
    const el = main.current;
    if (!el || q) return;
    const anchorEl = cur.anchor ? el.querySelector<HTMLElement>(`#dx-${CSS.escape(cur.anchor)}`) : null;
    if (anchorEl) {
      anchorEl.scrollIntoView({ block: 'start' });
      anchorEl.classList.remove('dx-flash'); void anchorEl.offsetWidth; anchorEl.classList.add('dx-flash');
    } else el.scrollTo({ top: 0 });
    setToc([...el.querySelectorAll<HTMLElement>('[data-toc]')].map((h) => ({ id: h.id, text: h.dataset.toc ?? '' })));
    setSpy('');
  }, [hist, q]); // eslint-disable-line react-hooks/exhaustive-deps

  // scroll-spy for the "on this page" list
  useEffect(() => {
    const el = main.current;
    if (!el || q) return;
    let raf = 0;
    const onScroll = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        let id = '';
        for (const h of el.querySelectorAll<HTMLElement>('[data-toc]')) if (h.getBoundingClientRect().top - el.getBoundingClientRect().top < 90) id = h.id;
        setSpy(id);
      });
    };
    el.addEventListener('scroll', onScroll, { passive: true });
    return () => { el.removeEventListener('scroll', onScroll); cancelAnimationFrame(raf); };
  }, [hist, q]);

  // expand the sidebar group that holds the current page
  useEffect(() => {
    const r = cur.route;
    if (r.k === 'node') { const c = MODULES.find((m) => m.type === r.type)?.category; if (c) setOpenGroups((g) => ({ ...g, [`cat:${c}`]: true })); }
    if (r.k === 'recipe') setOpenGroups((g) => ({ ...g, Cookbook: true }));
  }, [ckey]); // eslint-disable-line react-hooks/exhaustive-deps

  // search
  const all = useMemo(() => (q.trim() ? search(q, 'All') : []), [q]);
  const counts = useMemo(() => { const m = new Map<string, number>(); for (const h of all) m.set(h.entry.kind, (m.get(h.entry.kind) ?? 0) + 1); return m; }, [all]);
  const hits = useMemo(() => (kind === 'All' ? all : all.filter((h) => h.entry.kind === kind)), [all, kind]);
  useEffect(() => { setActive(0); }, [q, kind]);
  useEffect(() => { setKind('All'); }, [q]);
  const openHit = (h: Hit) => go(h.entry.route, h.entry.anchor);

  // focus: take it on open, give it back on close
  useEffect(() => {
    prevFocus.current = document.activeElement;
    input.current?.focus();
    return () => { (prevFocus.current as HTMLElement | null)?.focus?.(); };
  }, []);

  // Escape, Tab trap and shortcuts
  useEffect(() => {
    const el = shell.current!;
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        if (menu) setMenu(false); else if (input.current?.value) { setQ(''); input.current.focus(); } else onClose();
        return;
      }
      if (e.key === 'Tab') {
        const f = [...el.querySelectorAll<HTMLElement>('button,[href],input,select,textarea,[tabindex]:not([tabindex="-1"])')].filter((x) => !x.hasAttribute('disabled') && x.offsetParent !== null);
        if (!f.length) return;
        const first = f[0], last = f[f.length - 1];
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
        return;
      }
      const t = e.target as HTMLElement;
      const typing = !!t.closest('input,textarea,select');
      if ((e.key === '/' && !typing) || ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k')) { e.preventDefault(); input.current?.focus(); input.current?.select(); }
      else if (e.altKey && e.key === 'ArrowLeft') { e.preventDefault(); back(); }
      else if (e.altKey && e.key === 'ArrowRight') { e.preventDefault(); fwd(); }
    };
    window.addEventListener('keydown', key, true);
    return () => window.removeEventListener('keydown', key, true);
  }, [onClose, back, fwd, menu]);

  const onInputKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (!q.trim()) return;
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive((a) => Math.min(a + 1, Math.min(hits.length, 60) - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => Math.max(a - 1, 0)); }
    else if (e.key === 'Enter' && hits[active]) { e.preventDefault(); openHit(hits[active]); }
  };

  const route = cur.route;
  let page: ReactNode;
  switch (route.k) {
    case 'home': page = <Home recent={saved.recent.filter((k) => k !== ckey)} bookmarks={saved.bookmarks} onSearch={(s) => { setQ(s); input.current?.focus(); }} />; break;
    case 'article': { const a = ARTICLE_BY_ID.get(route.id); page = a ? <ArticlePage article={a} /> : null; break; }
    case 'node': page = <NodePage type={route.type} />; break;
    case 'nodes': page = <NodesIndex />; break;
    case 'recipes': page = <RecipesPage />; break;
    case 'recipe': { const r = RECIPES.find((x) => x.id === route.id); page = r ? <RecipePage r={r} /> : null; break; }
    case 'settings': page = <SettingsIndex />; break;
    case 'packages': page = <PackagesPage />; break;
    case 'finder': page = <FinderPage />; break;
  }

  const crumbs = breadcrumb(route).filter(Boolean);
  const bookmarkRoutes = saved.bookmarks.map(routeFromKey).filter(Boolean) as Route[];

  const item = (r: Route, label?: string) => <NavItem key={routeKey(r) + (label ?? '')} r={r} label={label} ckey={ckey} go={go} />;
  const group = (id: string, title: string, children: ReactNode, defaultOpen?: boolean, count?: number) => (
    <NavGroup key={id} title={title} count={count} open={openGroups[id] ?? !!defaultOpen} onToggle={() => setOpenGroups((g) => ({ ...g, [id]: !(g[id] ?? !!defaultOpen) }))}>{children}</NavGroup>
  );

  return (
    <NavCtx.Provider value={nav}>
      <div className="dx-overlay" onPointerDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
        <div ref={shell} className="dx-shell" role="dialog" aria-modal="true" aria-label={tr("Documentation")} tabIndex={-1}>
          <header className="dx-top">
            <button type="button" className="dx-icon dx-menu-btn" aria-label={tr("Toggle navigation")} aria-expanded={menu} onClick={() => setMenu(!menu)}><Icon name="menu" size={16} /></button>
            <button type="button" className="dx-brand" onClick={() => go({ k: 'home' })} aria-label={tr("Documentation home")}><Icon name="docs" size={16} /><span>{tr('Docs')}</span></button>
            <div className="dx-hist">
              <button type="button" className="dx-icon flip" aria-label={tr("Back (Alt+Left)")} title={tr("Back (Alt+←)")} disabled={hist.pos === 0} onClick={back}><Icon name="chevron" size={15} /></button>
              <button type="button" className="dx-icon" aria-label={tr("Forward (Alt+Right)")} title={tr("Forward (Alt+→)")} disabled={hist.pos >= hist.stack.length - 1} onClick={fwd}><Icon name="chevron" size={15} /></button>
            </div>
            <div className="dx-search" role="search">
              <Icon name="search" size={16} />
              <input ref={input} type="search" value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={onInputKey} placeholder={tr("Search modules, settings, pins, recipes, fixes…")} aria-label={tr("Search the documentation")} autoComplete="off" spellCheck={false} data-autofocus />
              {q ? <button type="button" className="dx-clear" aria-label={tr("Clear search")} onClick={() => { setQ(''); input.current?.focus(); }}><Icon name="close" size={13} /></button> : <kbd title={tr("Press / to search")}>/</kbd>}
            </div>
            <button type="button" className="dx-icon" aria-label={tr("Close documentation")} onClick={onClose}><Icon name="close" size={16} /></button>
          </header>

          <div className="dx-body">
            {menu && <div className="dx-scrim" onClick={() => setMenu(false)} />}
            <nav className={`dx-side ${menu ? 'open' : ''}`} aria-label={tr("Documentation sections")}>
              {item({ k: 'home' }, 'Overview')}
              {bookmarkRoutes.length > 0 && group('Bookmarks', 'Bookmarks', bookmarkRoutes.map((r) => (
                <button key={routeKey(r)} type="button" className={`dx-nav-item ${routeKey(r) === ckey ? 'on' : ''}`} onClick={() => go(r)}><Star on size={11} /> {routeTitle(r)}</button>
              )), true, bookmarkRoutes.length)}
              {SIDEBAR.slice(0, 3).map((g) => group(g.title, g.title, g.items.map((r) => item(r)), g.open))}
              {group('Cookbook', 'Cookbook', [item({ k: 'recipes' }, 'All recipes'), ...RECIPES.map((r) => item({ k: 'recipe', id: r.id }))], false, RECIPES.length)}
              {group('Nodes', 'Node reference', [
                item({ k: 'nodes' }, 'All modules'),
                ...CATEGORIES.map((c) => group(`cat:${c}`, CAT_LABEL[c], MODULES.filter((m) => m.category === c).map((m) => (
                  <button key={m.type} type="button" className={`dx-nav-item dx-nav-node ${ckey === `node:${m.type}` ? 'on' : ''}`} style={{ ['--c' as string]: FAMILY_VAR[m.family] }} aria-current={ckey === `node:${m.type}` ? 'page' : undefined} onClick={() => go({ k: 'node', type: m.type })}><i />{m.name}</button>
                )), false, MODULES.filter((m) => m.category === c).length)),
              ], true, MODULES.length)}
              {SIDEBAR.slice(4).map((g) => group(g.title, g.title, g.items.map((r) => item(r)), g.open))}
              <p className="dx-side-hint"><kbd>/</kbd> search · <kbd>Alt</kbd>+<kbd>←</kbd> back</p>
            </nav>

            <main ref={main} className="dx-main" tabIndex={-1} aria-live="polite">
              <div className="dx-content">
                {!q.trim() && crumbs.length > 1 && (
                  <nav className="dx-crumbs" aria-label={tr("Breadcrumb")}>
                    {crumbs.map((c, i) => <Fragment key={i}>{i > 0 && <span aria-hidden="true">/</span>}{i === 0 ? <button type="button" onClick={() => go({ k: 'home' })}>{tr(c)}</button> : <span aria-current={i === crumbs.length - 1 ? 'page' : undefined}>{tr(c)}</span>}</Fragment>)}
                  </nav>
                )}
                {q.trim() ? <Results q={q} kind={kind} setKind={setKind} active={active} setActive={setActive} hits={hits} counts={counts} open={openHit} /> : page}
              </div>
            </main>

            {!q.trim() && toc.length > 1 && (
              <aside className="dx-toc" aria-label={tr("On this page")}>
                <h2>On this page</h2>
                <ul>
                  {toc.map((t) => <li key={t.id}><button type="button" className={spy === t.id ? 'on' : ''} onClick={() => document.getElementById(t.id)?.scrollIntoView({ behavior: 'smooth', block: 'start' })}>{t.text}</button></li>)}
                </ul>
              </aside>
            )}
          </div>
        </div>
      </div>
    </NavCtx.Provider>
  );
}
