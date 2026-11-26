// Inspector section of the Calculus Engine: the analysis it has worked out, line by line, in the interface language.
import type { NodeInst } from '../core/types';
import { rowText, type Row } from '../core/calculus';
import { engine, useNodeVer } from '../runtime/session';
import { tr } from '../i18n';

export function CalculusPanel({ node }: { node: NodeInst }) {
  useNodeVer(node.id);
  const rt = engine.nodes.get(node.id);
  const rows = ((rt?.viewData ?? {}) as { rows?: Row[] }).rows ?? [];
  return (
    <div className="field">
      <p className="doc">{tr('Hover or select the module and use its ƒ and p buttons to add or remove expressions and parameters, or change the two counts in Settings. Every expression, parameter name and parameter value has its own setting pin.')}</p>
      {rows.length ? (
        <div className="eng-rows" aria-live="polite">
          {rows.map((r, i) => {
            const t = rowText(r);
            return r.h !== undefined
              ? <div key={i} className="eng-h">{t.value}</div>
              : <div key={i} className="eng-row"><span className="eng-k">{t.label}</span><span className="eng-v">{t.value}</span></div>;
          })}
        </div>
      ) : <p className="muted">{tr('Press Run to see the analysis.')}</p>}
    </div>
  );
}
