// The unit table of the Unit Converter actor. It starts from every unit the Quantities section knows (core/quantities.ts) and adds
// the everyday units a converter is asked for — inches, miles, pounds, °F, gallons, miles per hour, acres, bytes … — which the
// Quantities modules deliberately leave out. The extra units live only here, so Quantities modules and their tests are untouched.
import { GROUPS, PREFIXES, PREFIX_EXP, QUANTITIES, UNITS, tidy, type Group } from './quantities';

export interface ConvUnit {
  sym: string;
  name: string;
  group: string;
  /** Size of one unit in the coherent SI unit of its group (the group's `base`). */
  factor: number;
  /** How far zero of this unit is above zero of the SI unit (the temperature scales). */
  offset?: number;
  /** Units such as ft or psi are not scaled by SI prefixes (nobody writes kft³); the prefix setting is ignored for them. */
  noPrefix?: boolean;
}

const X = (sym: string, name: string, group: string, factor: number, noPrefix = true, offset?: number): ConvUnit => ({ sym, name, group, factor, offset, noPrefix });

const EXTRA: ConvUnit[] = [
  X('in', 'inch', 'length', 0.0254), X('ft', 'foot', 'length', 0.3048), X('yd', 'yard', 'length', 0.9144), X('mi', 'mile', 'length', 1609.344),
  X('nmi', 'nautical mile', 'length', 1852), X('ly', 'light-year', 'length', 9460730472580800, false),
  X('lb', 'pound', 'mass', 0.45359237), X('oz', 'ounce', 'mass', 0.028349523125), X('st', 'stone', 'mass', 6.35029318),
  X('wk', 'week', 'time', 604800),
  X('°F', 'degree Fahrenheit', 'temperature', 5 / 9, true, (459.67 * 5) / 9),
  X('m³', 'cubic metre', 'volume', 1), X('gal', 'US gallon', 'volume', 0.003785411784), X('qt', 'US quart', 'volume', 9.46352946e-4),
  X('pt', 'US pint', 'volume', 4.73176473e-4), X('cup', 'US cup', 'volume', 2.365882365e-4), X('ft³', 'cubic foot', 'volume', 0.028316846592), X('in³', 'cubic inch', 'volume', 1.6387064e-5),
  X('m/s', 'metre per second', 'speed', 1, false), X('km/h', 'kilometre per hour', 'speed', 1 / 3.6), X('ft/s', 'foot per second', 'speed', 0.3048),
  X('psi', 'pound per square inch', 'pressure', 6894.757293168),
  X('kWh', 'kilowatt-hour', 'energy', 3.6e6), X('BTU', 'British thermal unit', 'energy', 1055.05585262),
  X('hp', 'horsepower (mechanical)', 'power', 745.69987158227022),
  X('lbf', 'pound-force', 'force', 4.4482216152605), X('kgf', 'kilogram-force', 'force', 9.80665),
  X('°', 'degree of arc', 'angle', Math.PI / 180), X('rev', 'revolution', 'angle', 2 * Math.PI),
  X('m²', 'square metre', 'area', 1), X('ha', 'hectare', 'area', 1e4), X('km²', 'square kilometre', 'area', 1e6), X('ac', 'acre', 'area', 4046.8564224),
  X('ft²', 'square foot', 'area', 0.09290304), X('in²', 'square inch', 'area', 6.4516e-4), X('yd²', 'square yard', 'area', 0.83612736), X('mi²', 'square mile', 'area', 2589988.110336),
  X('B', 'byte', 'data', 1, false), X('bit', 'bit', 'data', 0.125, false),
];

const NEW_GROUPS: (Group & { name: string })[] = [
  { id: 'area', base: 'm²', baseName: 'square metre', name: 'Area' },
  { id: 'data', base: 'B', baseName: 'byte', name: 'Digital information' },
];

export const CONV_UNITS: ConvUnit[] = [...UNITS.map((u): ConvUnit => ({ ...u })), ...EXTRA];
export const CONV_BY_SYM = new Map(CONV_UNITS.map((u) => [u.sym, u]));

export interface ConvGroup { id: string; name: string; base: string; baseName: string; units: string[] }

/** The unit that comes first and second in the choices: what a person reaches for before the exotic ones. */
const ORDER: Record<string, string[]> = {
  length: ['m', 'ft', 'in', 'yd', 'mi', 'nmi', 'au', 'ly', 'pc', 'Å'],
  mass: ['g', 'lb', 'oz', 'st', 't', 'u', 'Da'],
  time: ['s', 'min', 'h', 'd', 'wk', 'a'],
  temperature: ['°C', '°F', 'K'],
  volume: ['L', 'gal', 'qt', 'pt', 'cup', 'm³', 'ft³', 'in³'],
  speed: ['m/s', 'km/h', 'mph', 'kn', 'ft/s'],
  pressure: ['Pa', 'bar', 'atm', 'psi', 'Torr', 'mmHg'],
  energy: ['J', 'cal', 'kWh', 'BTU', 'eV', 'erg'],
  power: ['W', 'hp'],
  force: ['N', 'lbf', 'kgf', 'dyn'],
  angle: ['rad', '°', 'rev'],
  area: ['m²', 'ft²', 'in²', 'yd²', 'ac', 'ha', 'km²', 'mi²'],
  data: ['B', 'bit'],
};

const groupName = (id: string) => NEW_GROUPS.find((g) => g.id === id)?.name ?? QUANTITIES.find((q) => q.group === id)?.name ?? id;

export const CONV_GROUPS: ConvGroup[] = [...GROUPS, ...NEW_GROUPS].map((g) => {
  const all = CONV_UNITS.filter((u) => u.group === g.id).map((u) => u.sym);
  const first = (ORDER[g.id] ?? []).filter((s) => all.includes(s));
  return { id: g.id, name: groupName(g.id), base: g.base, baseName: g.baseName, units: [...first, ...all.filter((s) => !first.includes(s))] };
});
export const CONV_GROUP_BY_ID = new Map(CONV_GROUPS.map((g) => [g.id, g]));

// ---- conversion ------------------------------------------------------------------------------------------------------------

const POW = (e: number) => Number(`1e${e}`);
const scale = (prefix: string, u: ConvUnit) => (u.noPrefix ? 1 : POW(PREFIX_EXP[prefix] ?? 0));

/** The value of `amount` written with `prefix` and `sym`, in the coherent SI unit of the unit's group. */
export function cToBase(amount: number, prefix: string, sym: string): number {
  const u = CONV_BY_SYM.get(sym);
  return u ? amount * scale(prefix, u) * u.factor + (u.offset ?? 0) : NaN;
}
/** The amount that, written with `prefix` and `sym`, equals `base`. */
export function cFromBase(base: number, prefix: string, sym: string): number {
  const u = CONV_BY_SYM.get(sym);
  return u ? (base - (u.offset ?? 0)) / (scale(prefix, u) * u.factor) : NaN;
}
/** Does this unit ignore the prefix setting? */
export const ignoresPrefix = (sym: string) => !!CONV_BY_SYM.get(sym)?.noPrefix;

// ---- reading text ------------------------------------------------------------------------------------------------------------

export interface ConvParsed { amount: number; prefix: string; unit: string; group: string; base: number }
export type ConvParse = { ok: true; amount: number; q?: ConvParsed } | { ok: false; error: string };

const NUMBER = /^([+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?)\s*(.*)$/;
const normalize = (s: string) => s.replace(/\u2212/g, '-').replace(/\u00b5/g, 'μ').replace(/\u2126/g, 'Ω').replace(/\u212b/g, 'Å').replace(/\u2103/g, '°C').replace(/\u2109/g, '°F').replace(/\u00ba(?=[CF])/g, '°');

/** Read `<amount><unit>`. A spelling that fits two units (cd, au, min) is read as the one of `prefer`, the group being converted. */
export function parseConv(input: string, prefer: string): ConvParse {
  const m = NUMBER.exec(normalize(input).trim());
  if (!m) return { ok: false, error: `“${input.trim().slice(0, 24)}” is not a quantity. Write an amount followed by a unit, like 2.5km.` };
  const amount = Number(m[1]);
  if (!Number.isFinite(amount)) return { ok: false, error: `“${m[1]}” is not a finite number.` };
  const rest = m[2].trim();
  if (rest === '') return { ok: true, amount };
  const cands: { prefix: string; unit: ConvUnit }[] = [];
  for (const p of ['', ...PREFIXES.map((x) => x.sym)]) {
    if (!rest.startsWith(p)) continue;
    const u = CONV_BY_SYM.get(rest.slice(p.length));
    if (u && (p === '' || !u.noPrefix)) cands.push({ prefix: p, unit: u });
  }
  if (!cands.length) return { ok: false, error: `“${rest.slice(0, 16)}” is not a known unit.` };
  cands.sort((a, b) => Number(b.unit.group === prefer) - Number(a.unit.group === prefer) || a.prefix.length - b.prefix.length);
  const { prefix, unit } = cands[0];
  return { ok: true, amount, q: { amount, prefix, unit: unit.sym, group: unit.group, base: cToBase(amount, prefix, unit.sym) } };
}

export { tidy };
