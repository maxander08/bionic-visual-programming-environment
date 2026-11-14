import type { ParamDef, PortDef, PortType, Side } from '../types';

export const num = (key: string, label: string, def: number, min: number, max: number, step: number, doc: string, unit?: string): ParamDef => ({
  key, label, kind: 'number', default: def, min, max, step, doc, unit,
});
/** A number setting that keeps every digit typed into it (see ParamDef.exact). The range still limits it. */
export const dnum = (key: string, label: string, def: number, min: number, max: number, step: number, doc: string, unit?: string): ParamDef => ({
  key, label, kind: 'number', default: def, min, max, step, doc, unit, exact: true,
});
export const sel = (key: string, label: string, def: string, options: [string, string][], doc: string): ParamDef => ({
  key, label, kind: 'select', default: def, options: options.map(([value, l]) => ({ value, label: l })), doc,
});
export const txt = (key: string, label: string, def: string, doc: string, o: { multiline?: boolean; hidden?: boolean; maxLength?: number; placeholder?: string; suggest?: () => string[] } = {}): ParamDef => ({
  key, label, kind: 'text', default: def, doc, multiline: o.multiline, hidden: o.hidden, maxLength: o.maxLength ?? 2000, placeholder: o.placeholder, suggest: o.suggest,
});
export const bol = (key: string, label: string, def: boolean, doc: string): ParamDef => ({ key, label, kind: 'bool', default: def, doc });
export const act = (key: string, label: string, command: string, doc: string): ParamDef => ({ key, label, kind: 'action', command, doc });

export const inp = (id: string, label: string, type: PortType, doc: string, side: Side = 'top', optional = false): PortDef => ({ id, label, type, doc, side, optional });
export const out = (id: string, label: string, type: PortType, doc: string, side: Side = 'bottom'): PortDef => ({ id, label, type, doc, side });

export const RATE = (def = 5) => num('rate', 'Sample rate', def, 0.5, 30, 0.5, 'How many samples per second the source produces, in simulation time.', 'Hz');

/**
 * The four output pins that split a time into its elements, laid out like the World Clock's: Hour, Minute, Seconds and
 * Milliseconds on the right edge. `what` names the time they describe, as in “time left”.
 */
export const timeParts = (what: string, side: Side = 'right'): PortDef[] => [
  out('hour', 'Hour', 'num', `Whole hours of the ${what}. Hours are not wrapped at 24: a day and two hours is 26.`, side),
  out('minute', 'Minute', 'num', `Minutes of the ${what}, 0–59.`, side),
  out('second', 'Seconds', 'num', `Seconds of the ${what}, 0–59.`, side),
  out('millisecond', 'Milliseconds', 'num', `Milliseconds of the ${what}, 0–999. They refresh every tick while the module is running.`, side),
];
