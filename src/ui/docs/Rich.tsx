import { Fragment, useContext, type ReactNode } from 'react';
import { NavCtx, type Block, type Route } from './types';
import { parseInline, slug } from './markup';
import { Icon } from '../icons';

export function DocLink({ route, anchor, children, className }: { route: Route; anchor?: string; children: ReactNode; className?: string }) {
  const nav = useContext(NavCtx);
  return <button type="button" className={`dx-link ${className ?? ''}`} onClick={() => nav.go(route, anchor)}>{children}</button>;
}

/** Inline markup: **bold**, `code` and [[links]]. Newlines inside text are kept. */
export function Rich({ x }: { x: string }) {
  return (
    <>
      {parseInline(x).map((p, i) => {
        if (p.t === 'b') return <strong key={i}>{p.x}</strong>;
        if (p.t === 'code') return <code key={i} className="dx-code">{p.x}</code>;
        if (p.t === 'link') return <DocLink key={i} route={p.route}>{p.x}</DocLink>;
        return <Fragment key={i}>{p.x.split('\n').map((l, j) => <Fragment key={j}>{j > 0 && <br />}{l}</Fragment>)}</Fragment>;
      })}
    </>
  );
}

export const TYPE_COLOR: Record<string, string> = { num: '#6fd3ee', bool: '#3ddc97', text: '#f7c52b', image: '#ff8a50', data: '#c08bff', any: '#a8a8a8' };

export function TypeChip({ type }: { type: string }) {
  return <span className="dx-type" style={{ ['--tc' as string]: TYPE_COLOR[type] ?? '#aaa' }}>{type}</span>;
}

const CALLOUT_ICON: Record<string, string> = { note: 'alert', tip: 'check', warn: 'alert' };

export function Callout({ kind, title, children }: { kind: 'note' | 'tip' | 'warn'; title?: string; children: ReactNode }) {
  return (
    <aside className={`dx-callout ${kind}`}>
      <Icon name={CALLOUT_ICON[kind] as any} size={15} />
      <div>{title && <b className="dx-callout-title">{title}</b>}<div>{children}</div></div>
    </aside>
  );
}

export function Flow({ items }: { items: string[] }) {
  return (
    <div className="dx-flow" role="list">
      {items.map((it, i) => (
        <Fragment key={i}>
          {i > 0 && <span className="dx-flow-arrow" aria-hidden="true">→</span>}
          <span className="dx-flow-chip" role="listitem"><Rich x={it} /></span>
        </Fragment>
      ))}
    </div>
  );
}

export function Blocks({ blocks }: { blocks: Block[] }) {
  return (
    <>
      {blocks.map((b, i) => {
        switch (b.t) {
          case 'p': return <p key={i} className="dx-p"><Rich x={b.x} /></p>;
          case 'h': return <h2 key={i} id={`dx-${slug(b.x)}`} data-toc={b.x} className="dx-h2">{b.x}</h2>;
          case 'ul': return <ul key={i} className="dx-ul">{b.items.map((x, j) => <li key={j}><Rich x={x} /></li>)}</ul>;
          case 'ol': return <ol key={i} className="dx-ol">{b.items.map((x, j) => <li key={j}><Rich x={x} /></li>)}</ol>;
          case 'note': case 'tip': case 'warn': return <Callout key={i} kind={b.t} title={b.title}><Rich x={b.x} /></Callout>;
          case 'flow': return <Flow key={i} items={b.items} />;
          case 'table': return (
            <div key={i} className="dx-table-wrap">
              <table className="dx-table">
                <thead><tr>{b.head.map((h) => <th key={h} scope="col">{h}</th>)}</tr></thead>
                <tbody>{b.rows.map((r, j) => <tr key={j} id={`dx-r-${slug(r[0])}`}>{r.map((c, k) => (k === 0 ? <th key={k} scope="row"><Rich x={c} /></th> : <td key={k}><Rich x={c} /></td>))}</tr>)}</tbody>
              </table>
            </div>
          );
          case 'keys': return (
            <dl key={i} className="dx-keys">
              {b.rows.map(([ks, d], j) => (
                <div key={j} id={`dx-r-${slug(d)}`}>
                  <dt>{ks.map((k, n) => <Fragment key={n}>{n > 0 && <span className="dx-plus">+</span>}<kbd>{k}</kbd></Fragment>)}</dt>
                  <dd>{d}</dd>
                </div>
              ))}
            </dl>
          );
        }
      })}
    </>
  );
}
