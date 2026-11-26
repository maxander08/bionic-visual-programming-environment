// The pin buttons of the Calculus Engine. Hover or select the module and two small steppers appear over its graph:
//   ƒ  − n +   adds or removes an expression (and with it a setting pin ƒₙ)
//   p  − n +   adds or removes a parameter (and with it a name pin and a value pin)
// The same two numbers are settings in the inspector (Expressions, Parameters), so they can be typed there too.
import type { NodeInst } from '../core/types';
import { CALC_MAX_ITEMS, calcExprCount, calcParamCount } from '../core/modules/engines';
import { useStore } from '../state/store';
import { tr } from '../i18n';

function Stepper({ glyph, n, min, max, label, less, more, onChange }: { glyph: string; n: number; min: number; max: number; label: string; less: string; more: string; onChange: (n: number) => void }) {
  const stop = (e: React.SyntheticEvent) => e.stopPropagation();
  return (
    <span className="eng-step" role="group" aria-label={label} onKeyDown={stop}>
      <i className="eng-g" aria-hidden="true">{glyph}</i>
      <button type="button" className="eng-b" disabled={n <= min} aria-label={less} title={less} onClick={() => onChange(n - 1)}>−</button>
      <output className="eng-n" aria-live="polite">{n}</output>
      <button type="button" className="eng-b" disabled={n >= max} aria-label={more} title={more} onClick={() => onChange(n + 1)}>+</button>
    </span>
  );
}

export function EngineSteps({ node }: { node: NodeInst }) {
  const nf = calcExprCount(node.params), np = calcParamCount(node.params);
  const set = (patch: Record<string, unknown>, key: string) => useStore.getState().setNodeParams(node.id, patch, key);
  return (
    <div className="eng-steps" data-interactive>
      <Stepper glyph="ƒ" n={nf} min={1} max={CALC_MAX_ITEMS} label={tr('Expressions')} less={tr('Remove the last expression and its pin')} more={tr('Add an expression with a pin of its own')} onChange={(n) => set({ fn: n }, 'fn')} />
      <Stepper glyph="p" n={np} min={0} max={CALC_MAX_ITEMS} label={tr('Parameters')} less={tr('Remove the last parameter and its pins')} more={tr('Add a parameter with a name pin and a value pin')} onChange={(n) => set({ pn: n }, 'pn')} />
    </div>
  );
}
