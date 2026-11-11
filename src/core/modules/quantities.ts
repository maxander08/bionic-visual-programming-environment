import type { ModuleDef } from '../types';
import { toNum } from '../util';
import {
  GROUP_BY_ID, PREFIXES, QUANTITIES, UNIT_BY_SYM, autoPrefix, fmtAmount, fmtQuantity, fromBase, parseQuantity, tidy, toBase,
  type QuantitySpec,
} from '../quantities';
import { inp, num, out, sel } from './kit';

// The Quantities section. A quantity is an amount of something written <amount><unit>, like 2.5km or 101.325kPa.
// One module per kind of quantity (Time, Length, Pressure …). Each holds an amount, an SI prefix and a unit, and every
// unit takes every prefix. Those three settings are also setting pins on the left edge; the registry sizes the node so
// the pins keep PIN_SPACING between them. All modules share one layout: 1 pin on top, 3 on the bottom, 1 on the right.

const SUP: Record<string, string> = { '-': '⁻', '0': '⁰', '1': '¹', '2': '²', '3': '³', '4': '⁴', '5': '⁵', '6': '⁶', '7': '⁷', '8': '⁸', '9': '⁹' };
const pow10 = (e: number) => `10${String(e).split('').map((ch) => SUP[ch]).join('')}`;

const NONE = 'none';
const AUTO = 'auto';
const PREFIX_OPTIONS: [string, string][] = [
  [NONE, 'none (×1)'],
  [AUTO, 'auto (best fit)'],
  ...PREFIXES.map((p) => [p.sym, `${p.sym} · ${p.name} (${pow10(p.exp)})`] as [string, string]),
];
const symbolOf = (prefix: string) => (prefix === NONE || prefix === AUTO ? '' : prefix);

const qname = (group: string) => QUANTITIES.find((q) => q.group === group)?.name ?? group;

function make(spec: QuantitySpec): ModuleDef {
  const grp = GROUP_BY_ID.get(spec.group)!;
  const unit0 = spec.unit ?? spec.units[0];
  const prefix0 = spec.prefix ?? NONE;
  const unitNames = spec.units.map((s) => `${s} (${UNIT_BY_SYM.get(s)!.name})`).join(', ');
  const several = spec.units.length > 1;

  return {
    type: `qty-${spec.id}`, name: spec.name, caption: spec.name, category: 'Quantities', family: 'quantity', size: 'small',
    glyph: symbolOf(prefix0) + unit0, source: true,
    keywords: `quantity unit si prefix amount measure ${spec.words} ${spec.units.join(' ')}`,
    chip: (p) => fmtQuantity(Number(p.amount), symbolOf(String(p.prefix)), String(p.unit)),
    inputs: [
      inp('in', 'Quantity', 'any', `${spec.name} to take in: text like 2.5${spec.units[0]}, or a plain number (an amount in the unit chosen here). It is converted into the Prefix and Unit set on this module and replaces Amount while connected.`, 'top', true),
    ],
    outputs: [
      out('quantity', 'Quantity', 'text', `The ${spec.name.toLowerCase()} as text, <amount><unit>, for example 2.5${symbolOf(prefix0) || ''}${unit0}.`),
      out('amount', 'Amount', 'num', 'The amount alone, in the prefix and unit shown on the module.'),
      out('unit', 'Unit', 'text', `The unit with its prefix, as written in the quantity: ${symbolOf(prefix0)}${unit0}.`),
      out('base', 'SI value', 'num', `The same ${spec.name.toLowerCase()} in ${grp.baseName} (${grp.base}), the coherent SI unit. Use it to compare or calculate with quantities written in different units.`, 'right'),
    ],
    params: [
      num('amount', 'Amount', 1, -1e15, 1e15, 0.1, `How much of ${spec.about}, in the prefix and unit chosen below.`),
      sel('prefix', 'Prefix', prefix0, PREFIX_OPTIONS, 'SI prefix, a power of ten placed in front of the unit: every unit takes every one of the 24 prefixes. “auto” picks the step of 1000 that keeps the amount between 1 and 999.'),
      sel('unit', 'Unit', unit0, spec.units.map((s) => [s, `${s} · ${UNIT_BY_SYM.get(s)!.name}`] as [string, string]), `The unit of the amount: ${unitNames}.`),
    ],
    run(c) {
      const unit = c.str('unit');
      const choice = c.str('prefix');
      let prefix = symbolOf(choice);
      let base: number;
      // The amount as given, when no conversion is needed: it then never takes a round trip through the SI value, which
      // would lose digits on the Celsius scale (a nano-degree next to 273.15 K).
      let exact: number | undefined;
      if (c.has('in')) {
        const v = c.get('in');
        if (typeof v === 'string') {
          const r = parseQuantity(v, spec.group);
          if (!r.ok) return c.fail(r.error);
          if (r.q) {
            if (r.q.group !== spec.group) return c.fail(`${r.q.prefix}${r.q.unit} is a unit of ${qname(r.q.group).toLowerCase()}, not ${spec.name.toLowerCase()}. This module takes ${spec.units.join(', ')} (with any prefix).`);
            base = r.q.base;
            if (r.q.unit === unit && r.q.prefix === prefix) exact = r.q.amount;
          } else { base = toBase(r.amount, prefix, unit); exact = r.amount; }
        } else {
          const x = toNum(v);
          if (!Number.isFinite(x)) return c.fail('The Quantity pin needs text like 2.5km or a number.');
          base = toBase(x, prefix, unit);
          exact = x;
        }
      } else { exact = c.num('amount'); base = toBase(exact, prefix, unit); }
      if (!Number.isFinite(base)) return c.fail('That quantity is too large to hold.');
      if (choice === AUTO) { prefix = autoPrefix(fromBase(base, '', unit)); exact = undefined; }
      const amount = exact !== undefined ? tidy(exact) : tidy(fromBase(base, prefix, unit));
      const symbol = prefix + unit;
      const text = fmtQuantity(amount, prefix, unit);
      const si = tidy(base);
      c.emit('quantity', text);
      c.emit('amount', amount);
      c.emit('unit', symbol);
      c.emit('base', si);
      c.view({ text, symbol, sub: symbol === grp.base ? UNIT_BY_SYM.get(unit)!.name : `= ${fmtAmount(si)} ${grp.base}`, amount: fmtAmount(amount) });
    },
    doc: {
      summary: `Holds ${spec.about} as an amount with a unit, such as 2.5${spec.units[0]}, and converts it between units and SI prefixes.`,
      runtime: `Holds ${spec.about} of Amount, Prefix and Unit, and emits it as text (<amount><unit>), as the amount alone, as the unit alone and as an SI value in ${grp.baseName} (${grp.base}). Units: ${unitNames}. Every unit takes every SI prefix, q r y z a f p n μ m c d da h k M G T P E Z Y R Q, and “auto” picks the best fit. When the Quantity pin carries a signal, the quantity it holds is converted into the Prefix and Unit chosen here, so the module also works as a converter${several ? ` between ${spec.units.join(', ')}` : ' between prefixes'}. Text is read as <amount><unit>; a plain number is an amount in the unit chosen here.`,
      errors: [
        `A Quantity input in a unit that does not measure ${spec.name.toLowerCase()} raises an error.`,
        'Text that is not <amount><unit> (for example “km5”) raises an error.',
      ],
      examples: [
        `${spec.name} Quantity → another ${spec.name} module: convert between units and prefixes.`,
        `${spec.name} SI value → Compare or Math: calculate with it whatever unit it was written in.`,
        `${spec.name} Quantity → Projector: display it as <amount><unit>.`,
      ],
    },
  };
}

export const quantities: ModuleDef[] = QUANTITIES.map(make);
