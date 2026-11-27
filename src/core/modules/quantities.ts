import type { ModuleDef } from '../types';
import { toNum } from '../util';
import {
  GROUP_BY_ID, PREFIXES, QUANTITIES, UNIT_BY_SYM, autoPrefix, fmtAmount, fmtQuantity, fromBase, parseQuantity, tidy, toBase,
  type QuantitySpec,
} from '../quantities';
import { formatDuration, parseDuration } from '../duration';
import { splitDuration } from '../timekeeping';
import { inp, num, out, sel, timeParts } from './kit';

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
      inp('in', 'Quantity', 'any', `${spec.name} to take in: text like 2.5${spec.units[0]}, or a plain number (an amount in the unit chosen here). It’s converted into the Prefix and Unit set on this module and replaces Amount while connected.`, 'top', true),
    ],
    outputs: [
      out('quantity', 'Quantity', 'text', `The ${spec.name.toLowerCase()} as text, <amount><unit>, for example 2.5${symbolOf(prefix0) || ''}${unit0}.`),
      out('amount', 'Amount', 'num', 'The amount alone, in the prefix and unit shown on the module.'),
      out('unit', 'Unit', 'text', `The unit with its prefix, as written in the quantity: ${symbolOf(prefix0)}${unit0}.`),
      out('base', 'SI value', 'num', `The same ${spec.name.toLowerCase()} in ${grp.baseName} (${grp.base}), the coherent SI unit. Handy for comparing or calculating with quantities written in different units.`, 'right'),
    ],
    params: [
      num('amount', 'Amount', 1, -1e15, 1e15, 0.1, `How much of ${spec.about}, in the prefix and unit chosen below.`),
      sel('prefix', 'Prefix', prefix0, PREFIX_OPTIONS, 'SI prefix, a power of ten placed in front of the unit. Every unit takes all 24 prefixes. “auto” picks the step of 1000 that keeps the amount between 1 and 999.'),
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
      runtime: `Holds ${spec.about} of Amount, Prefix and Unit, and sends out it as text (<amount><unit>), as the amount alone, as the unit alone and as an SI value in ${grp.baseName} (${grp.base}). Units: ${unitNames}. Every unit takes every SI prefix, q r y z a f p n μ m c d da h k M G T P E Z Y R Q, and “auto” picks the best fit. When the Quantity pin carries a signal, the quantity it holds is converted into the Prefix and Unit chosen here, so the module also works as a converter${several ? ` between ${spec.units.join(', ')}` : ' between prefixes'}. Text is read as <amount><unit>; a plain number is an amount in the unit chosen here.`,
      errors: [
        `A Quantity input in a unit that doesn’t measure ${spec.name.toLowerCase()} gives an error.`,
        'Text that isn’t <amount><unit> (for example “km5”) gives an error.',
      ],
      examples: [
        `${spec.name} Quantity → another ${spec.name} module: convert between units and prefixes.`,
        `${spec.name} SI value → Compare or Math: calculate with it whatever unit it was written in.`,
        `${spec.name} Quantity → Projector: display it as <amount><unit>.`,
      ],
    },
  };
}

// ---- Time ------------------------------------------------------------------------------------------------------
// Time is the one quantity people say in several units at once: 2 hours 40 minutes, not 2.6667 h. So its amount is a
// duration typed as “2 h 40 min”, it is shown that way, and Hours, Minutes, Seconds and Milliseconds come out as separate pins.

const HMS = 'hms';
const NUMBER_TEXT = /^\s*\+?(\d+\.?\d*|\.\d+)(e[+-]?\d+)?\s*$/i;
const MAX_SPAN = 1e40;

function makeTime(spec: QuantitySpec): ModuleDef {
  const grp = GROUP_BY_ID.get(spec.group)!;
  const unitNames = spec.units.map((s) => `${s} (${UNIT_BY_SYM.get(s)!.name})`).join(', ');
  const unitOptions: [string, string][] = [[HMS, 'h · min · s (as you say it)'], ...spec.units.map((s) => [s, `${s} · ${UNIT_BY_SYM.get(s)!.name}`] as [string, string])];
  const read = (seconds: number, mode: string, prefix: string) => (mode === HMS ? tidy(seconds) : tidy(fromBase(seconds, prefix, mode)));

  return {
    type: 'qty-time', name: 'Time', caption: 'Time', category: 'Quantities', family: 'quantity', size: 'small',
    glyph: 'h:m', source: true,
    keywords: `quantity unit si prefix amount measure ${spec.words} hours minutes seconds milliseconds hrs min sec hms duration span ${spec.units.join(' ')}`,
    chip: (p) => (String(p.unit) === HMS ? formatDuration(Number(p.span), { compact: true }) : fmtQuantity(tidy(fromBase(Number(p.span), symbolOf(String(p.prefix)), String(p.unit))), symbolOf(String(p.prefix)), String(p.unit))),
    inputs: [
      inp('in', 'Quantity', 'any', 'A time to take in: text like 2 hrs 40 min, 1h30m, 1:30:00 or 250ms, or a plain number (seconds, or the unit chosen here). It replaces Duration while it’s connected.', 'top', true),
    ],
    outputs: [
      out('quantity', 'Quantity', 'text', 'The time as readable text you can feed to any time setting or Time module: 2h 40min (or 9600s when a single unit is chosen).'),
      out('amount', 'Amount', 'num', 'The whole time as one number in the unit chosen under Show as. With “h · min · s” it’s the total in seconds.'),
      out('unit', 'Unit', 'text', 'The unit of Amount, with its prefix: s with “h · min · s”.'),
      out('base', 'SI value', 'num', `The same time in ${grp.baseName} (${grp.base}), the coherent SI unit. Handy for comparing or calculating with quantities written in different units.`, 'right'),
      ...timeParts('time'),
    ],
    params: [
      { key: 'span', label: 'Duration', kind: 'number', default: 1, min: 0, max: MAX_SPAN, step: 1, unit: 's', time: 's',
        doc: 'How long, typed the way you’d say it: 2 h 40 min, 1h30m, 90 s, 1:30:00, 2.5 hours, 1d 4h. A plain number is seconds.' },
      sel('prefix', 'Prefix', NONE, PREFIX_OPTIONS, 'SI prefix for a single unit (m + s = milliseconds). It does nothing with “h · min · s”. “auto” picks the step of 1000 that keeps the amount between 1 and 999.'),
      sel('unit', 'Show as', HMS, unitOptions, `How Quantity and Amount are written: as hours, minutes and seconds together (2h 40min), or in one unit: ${unitNames}. Hours, Minutes, Seconds and Milliseconds always come out as separate pins whatever this says.`),
    ],
    // Older programs held an Amount in a Prefix and Unit: keep that time, written the way it was.
    migrate(raw) {
      if (raw.span !== undefined || raw.amount === undefined) return raw; // `amount` is not a setting any more, so only an older program carries it
      const x = Number(raw.amount);
      const unit = typeof raw.unit === 'string' && UNIT_BY_SYM.get(raw.unit)?.group === 'time' ? raw.unit : 's';
      const prefix = typeof raw.prefix === 'string' && raw.prefix !== AUTO ? symbolOf(raw.prefix) : '';
      const seconds = toBase(x, prefix, unit);
      return { ...raw, span: Number.isFinite(seconds) ? Math.min(MAX_SPAN, Math.max(0, seconds)) : 1, unit };
    },
    run(c) {
      const mode = c.str('unit');
      const choice = c.str('prefix');
      const unit = mode === HMS ? 's' : mode;
      let prefix = mode === HMS ? '' : symbolOf(choice);
      let seconds: number;
      if (c.has('in')) {
        const v = c.get('in');
        if (typeof v === 'string' && !NUMBER_TEXT.test(v)) {
          const r = parseDuration(v, 's');
          if (r.ok) seconds = r.seconds;
          else {
            // Prefixed units the spoken form does not cover (ks, μs, ns): the general quantity reader knows them.
            const q = parseQuantity(v, 'time');
            if (q.ok && q.q && q.q.group === 'time') seconds = q.q.base;
            else if (q.ok && q.q) return c.fail(`${q.q.prefix}${q.q.unit} is a unit of ${qname(q.q.group).toLowerCase()}, not time. This module takes ${spec.units.join(', ')} (with any prefix).`);
            else return c.fail(r.error);
          }
        } else {
          const x = toNum(v);
          if (!Number.isFinite(x)) return c.fail('The Quantity pin needs a time like 2h 40min, or a number.');
          seconds = toBase(x, prefix, unit);
        }
      } else seconds = c.num('span');
      if (!Number.isFinite(seconds)) return c.fail('That time is too large to hold.');
      if (seconds < 0) return c.fail('A time can’t be negative.');
      if (mode !== HMS && choice === AUTO) prefix = autoPrefix(fromBase(seconds, '', unit));
      const amount = read(seconds, mode, prefix);
      const symbol = prefix + unit;
      const text = mode === HMS ? formatDuration(seconds, { compact: true, plain: true }) : fmtQuantity(amount, prefix, unit);
      const si = tidy(seconds);
      const parts = seconds * 1000 <= Number.MAX_SAFE_INTEGER
        ? splitDuration(Math.round(seconds * 1000))
        : {
          hour: Math.floor(seconds / 3600),
          minute: seconds < 1e15 ? Math.floor((seconds % 3600) / 60) : 0,
          second: seconds < 1e15 ? Math.floor(seconds % 60) : 0,
          millisecond: 0,
        };
      c.emit('quantity', text);
      c.emit('amount', amount);
      c.emit('unit', symbol);
      c.emit('base', si);
      c.emit('hour', parts.hour);
      c.emit('minute', parts.minute);
      c.emit('second', parts.second);
      c.emit('millisecond', parts.millisecond);
      c.view({ text, symbol, sub: mode === HMS ? `= ${fmtAmount(si)} s` : symbol === grp.base ? UNIT_BY_SYM.get(unit)!.name : `= ${fmtAmount(si)} ${grp.base}`, amount: fmtAmount(amount) });
    },
    doc: {
      summary: 'Holds a span of time written the way you say it, like 2 hrs 40 min, and gives it out as text, as one number, and as separate hours, minutes and seconds.',
      runtime: 'Type the duration like a sentence (2 h 40 min, 1h30m, 90 s, 1:30:00, 1.5 hours). A plain number is seconds. Show as picks how Quantity and Amount are written: h · min · s (the default, 2h 40min) or a single unit with an optional SI prefix. Hours, Minutes, Seconds and Milliseconds are always separate outputs, split from the whole time (hours don’t wrap at 24), and SI value is the total in seconds. When the Quantity pin has a signal, it replaces Duration: text like 2h 40min or 250ms, or a number in the unit chosen here (seconds with h · min · s). Wire Quantity into any time setting (a Timer’s Duration, a Delay, a Pulse period) to set it from here.',
      errors: [
        'A Quantity input that isn’t a time (text like 5km, or text with a stray word) gives an error that names the problem.',
        'A negative time gives an error, since a span of time is never below zero.',
      ],
      examples: [
        'Time Quantity → Timer Duration pin: a countdown of exactly 2h 40min.',
        'Time Hours, Minutes and Seconds → three Projectors: a readable clock face.',
        'Timer Time → Time Quantity pin: split a running countdown into hours, minutes and seconds.',
      ],
    },
  };
}

export const quantities: ModuleDef[] = QUANTITIES.map((q) => (q.id === 'time' ? makeTime(q) : make(q)));
