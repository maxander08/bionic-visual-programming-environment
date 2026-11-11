// Quantities: an amount of something, written <amount><unit> (for example 2.5km, 101.325kPa, 300K).
// Pure data and maths, no browser objects. The Quantities modules in ./modules/quantities.ts are built from this table.

/** The 24 SI prefixes, largest first. Every unit below accepts every one of them. */
export interface Prefix { sym: string; name: string; exp: number }
export const PREFIXES: Prefix[] = [
  { sym: 'Q', name: 'quetta', exp: 30 }, { sym: 'R', name: 'ronna', exp: 27 }, { sym: 'Y', name: 'yotta', exp: 24 }, { sym: 'Z', name: 'zetta', exp: 21 },
  { sym: 'E', name: 'exa', exp: 18 }, { sym: 'P', name: 'peta', exp: 15 }, { sym: 'T', name: 'tera', exp: 12 }, { sym: 'G', name: 'giga', exp: 9 },
  { sym: 'M', name: 'mega', exp: 6 }, { sym: 'k', name: 'kilo', exp: 3 }, { sym: 'h', name: 'hecto', exp: 2 }, { sym: 'da', name: 'deca', exp: 1 },
  { sym: 'd', name: 'deci', exp: -1 }, { sym: 'c', name: 'centi', exp: -2 }, { sym: 'm', name: 'milli', exp: -3 }, { sym: 'μ', name: 'micro', exp: -6 },
  { sym: 'n', name: 'nano', exp: -9 }, { sym: 'p', name: 'pico', exp: -12 }, { sym: 'f', name: 'femto', exp: -15 }, { sym: 'a', name: 'atto', exp: -18 },
  { sym: 'z', name: 'zepto', exp: -21 }, { sym: 'y', name: 'yocto', exp: -24 }, { sym: 'r', name: 'ronto', exp: -27 }, { sym: 'q', name: 'quecto', exp: -30 },
];

/** Prefix symbol → power of ten. The empty symbol is "no prefix". */
export const PREFIX_EXP: Record<string, number> = Object.fromEntries([['', 0], ...PREFIXES.map((p) => [p.sym, p.exp])]);

/** The prefixes that step by a factor of 1000 (and no prefix): the ones "auto" chooses from. */
const ENGINEERING: [number, string][] = PREFIXES.filter((p) => p.exp % 3 === 0).map((p) => [p.exp, p.sym] as [number, string]).concat([[0, '']]);
const ENG_SYM = new Map(ENGINEERING);

export interface UnitDef {
  sym: string;
  name: string;
  /** Which family of quantity it measures. Only units of one group convert into each other. */
  group: string;
  /** Size of one unit, expressed in the coherent SI unit of its group (see GROUPS). */
  factor: number;
  /** Added after scaling: how far zero of this unit is above zero of the SI unit. Only the Celsius scale has one. */
  offset?: number;
}

export interface Group { id: string; base: string; baseName: string }

/** One entry per kind of quantity. `base` is the coherent SI unit in which every value of the group is held. */
export const GROUPS: Group[] = [
  { id: 'time', base: 's', baseName: 'second' }, { id: 'length', base: 'm', baseName: 'metre' }, { id: 'mass', base: 'kg', baseName: 'kilogram' },
  { id: 'current', base: 'A', baseName: 'ampere' }, { id: 'temperature', base: 'K', baseName: 'kelvin' }, { id: 'substance', base: 'mol', baseName: 'mole' },
  { id: 'luminous', base: 'cd', baseName: 'candela' }, { id: 'angle', base: 'rad', baseName: 'radian' }, { id: 'solid', base: 'sr', baseName: 'steradian' },
  { id: 'frequency', base: 'Hz', baseName: 'hertz' }, { id: 'force', base: 'N', baseName: 'newton' }, { id: 'pressure', base: 'Pa', baseName: 'pascal' },
  { id: 'energy', base: 'J', baseName: 'joule' }, { id: 'power', base: 'W', baseName: 'watt' }, { id: 'charge', base: 'C', baseName: 'coulomb' },
  { id: 'voltage', base: 'V', baseName: 'volt' }, { id: 'capacitance', base: 'F', baseName: 'farad' }, { id: 'resistance', base: 'Ω', baseName: 'ohm' },
  { id: 'conductance', base: 'S', baseName: 'siemens' }, { id: 'flux', base: 'Wb', baseName: 'weber' }, { id: 'density', base: 'T', baseName: 'tesla' },
  { id: 'inductance', base: 'H', baseName: 'henry' }, { id: 'lumflux', base: 'lm', baseName: 'lumen' }, { id: 'illuminance', base: 'lx', baseName: 'lux' },
  { id: 'activity', base: 'Bq', baseName: 'becquerel' }, { id: 'dose', base: 'Gy', baseName: 'gray' }, { id: 'equivalent', base: 'Sv', baseName: 'sievert' },
  { id: 'catalytic', base: 'kat', baseName: 'katal' }, { id: 'volume', base: 'm³', baseName: 'cubic metre' }, { id: 'field', base: 'A/m', baseName: 'ampere per metre' },
  { id: 'kinematic', base: 'm²/s', baseName: 'square metre per second' }, { id: 'dynamic', base: 'Pa·s', baseName: 'pascal second' },
  { id: 'acceleration', base: 'm/s²', baseName: 'metre per second squared' }, { id: 'exposure', base: 'C/kg', baseName: 'coulomb per kilogram' },
  { id: 'speed', base: 'm/s', baseName: 'metre per second' },
];
export const GROUP_BY_ID = new Map(GROUPS.map((g) => [g.id, g]));

const U = (sym: string, name: string, group: string, factor: number, offset?: number): UnitDef => ({ sym, name, group, factor, offset });

/**
 * Every unit the Quantities section knows. Each one takes every SI prefix: the prefix scales the unit, so 1 mmHg is
 * 133.322… Pa and 1 kmmHg is 1000 mmHg. Mass is held in kilograms, so the gram is the unit that takes the prefix
 * (k + g = kg). The Celsius scale keeps its offset: 25 °C is 298.15 K.
 */
export const UNITS: UnitDef[] = [
  // SI base units
  U('s', 'second', 'time', 1), U('m', 'metre', 'length', 1), U('g', 'gram (kg = kilogram)', 'mass', 1e-3), U('A', 'ampere', 'current', 1),
  U('K', 'kelvin', 'temperature', 1), U('mol', 'mole', 'substance', 1), U('cd', 'candela', 'luminous', 1),
  // SI derived units
  U('rad', 'radian', 'angle', 1), U('sr', 'steradian', 'solid', 1), U('Hz', 'hertz', 'frequency', 1), U('N', 'newton', 'force', 1),
  U('Pa', 'pascal', 'pressure', 1), U('J', 'joule', 'energy', 1), U('W', 'watt', 'power', 1), U('C', 'coulomb', 'charge', 1),
  U('V', 'volt', 'voltage', 1), U('F', 'farad', 'capacitance', 1), U('Ω', 'ohm', 'resistance', 1), U('S', 'siemens', 'conductance', 1),
  U('Wb', 'weber', 'flux', 1), U('T', 'tesla', 'density', 1), U('H', 'henry', 'inductance', 1), U('°C', 'degree Celsius', 'temperature', 1, 273.15),
  U('lm', 'lumen', 'lumflux', 1), U('lx', 'lux', 'illuminance', 1), U('Bq', 'becquerel', 'activity', 1), U('Gy', 'gray', 'dose', 1),
  U('Sv', 'sievert', 'equivalent', 1), U('kat', 'katal', 'catalytic', 1),
  // accepted for use with the SI
  U('min', 'minute', 'time', 60), U('h', 'hour', 'time', 3600), U('d', 'day', 'time', 86400), U('a', 'year (Julian, 365.25 d)', 'time', 31557600),
  U('t', 'tonne', 'mass', 1000), U('L', 'litre', 'volume', 1e-3), U('eV', 'electronvolt', 'energy', 1.602176634e-19),
  U('u', 'unified atomic mass unit', 'mass', 1.66053906892e-27), U('Da', 'dalton', 'mass', 1.66053906892e-27),
  U('au', 'astronomical unit', 'length', 149597870700), U('pc', 'parsec', 'length', 3.0856775814913673e16), U('Å', 'ångström', 'length', 1e-10),
  // other units in common use
  U('bar', 'bar', 'pressure', 1e5), U('atm', 'standard atmosphere', 'pressure', 101325), U('cal', 'calorie (thermochemical)', 'energy', 4.184),
  U('dyn', 'dyne', 'force', 1e-5), U('erg', 'erg', 'energy', 1e-7), U('G', 'gauss', 'density', 1e-4), U('Mx', 'maxwell', 'flux', 1e-8),
  U('Oe', 'oersted', 'field', 1000 / (4 * Math.PI)), U('St', 'stokes', 'kinematic', 1e-4), U('P', 'poise', 'dynamic', 0.1),
  U('Gal', 'gal', 'acceleration', 0.01), U('Ci', 'curie', 'activity', 3.7e10), U('R', 'roentgen', 'exposure', 2.58e-4),
  U('rem', 'rem', 'equivalent', 0.01), U('Torr', 'torr', 'pressure', 101325 / 760), U('mmHg', 'millimetre of mercury', 'pressure', 133.322387415),
  U('kn', 'knot', 'speed', 1852 / 3600), U('mph', 'mile per hour', 'speed', 0.44704), U('rpm', 'revolution per minute', 'frequency', 1 / 60),
];
export const UNIT_BY_SYM = new Map(UNITS.map((u) => [u.sym, u]));

/** The modules of the Quantities section: one per kind of quantity. */
export interface QuantitySpec {
  /** Module type is `qty-<id>`. */
  id: string;
  name: string;
  /** Group of units it holds. Two modules may share one (Frequency and Rotational speed both hold Hz and rpm). */
  group: string;
  units: string[];
  /** What the module starts out as. Mass starts as 1 kg: prefix k on the gram. */
  prefix?: string;
  unit?: string;
  /** What a reader would search for. */
  words: string;
  about: string;
}

export const QUANTITIES: QuantitySpec[] = [
  { id: 'time', name: 'Time', group: 'time', units: ['s', 'min', 'h', 'd', 'a'], words: 'duration seconds minutes hours days years interval', about: 'a span of time' },
  { id: 'length', name: 'Length', group: 'length', units: ['m', 'au', 'pc', 'Å'], words: 'distance metre meter width height depth astronomical parsec angstrom', about: 'a length or distance' },
  { id: 'mass', name: 'Mass', group: 'mass', units: ['g', 't', 'u', 'Da'], prefix: 'k', words: 'weight kilogram gram tonne dalton atomic', about: 'a mass' },
  { id: 'current', name: 'Electric current', group: 'current', units: ['A'], words: 'ampere amp amperage', about: 'an electric current' },
  { id: 'temperature', name: 'Temperature', group: 'temperature', units: ['K', '°C'], words: 'kelvin celsius degree heat cold thermometer', about: 'a temperature' },
  { id: 'substance', name: 'Amount of substance', group: 'substance', units: ['mol'], words: 'mole chemistry', about: 'an amount of substance' },
  { id: 'luminous', name: 'Luminous intensity', group: 'luminous', units: ['cd'], words: 'candela brightness light', about: 'a luminous intensity' },
  { id: 'angle', name: 'Angle', group: 'angle', units: ['rad'], words: 'radian plane rotation', about: 'a plane angle' },
  { id: 'solid', name: 'Solid angle', group: 'solid', units: ['sr'], words: 'steradian cone', about: 'a solid angle' },
  { id: 'frequency', name: 'Frequency', group: 'frequency', units: ['Hz', 'rpm'], words: 'hertz cycles per second rate oscillation', about: 'a frequency' },
  { id: 'rotation', name: 'Rotational speed', group: 'frequency', units: ['rpm', 'Hz'], unit: 'rpm', words: 'revolutions per minute spin motor engine turn', about: 'a rotational speed' },
  { id: 'force', name: 'Force', group: 'force', units: ['N', 'dyn'], words: 'newton dyne push thrust', about: 'a force' },
  { id: 'pressure', name: 'Pressure', group: 'pressure', units: ['Pa', 'bar', 'atm', 'Torr', 'mmHg'], words: 'pascal bar atmosphere torr mercury barometer stress', about: 'a pressure' },
  { id: 'energy', name: 'Energy', group: 'energy', units: ['J', 'eV', 'cal', 'erg'], words: 'joule electronvolt calorie erg work heat', about: 'an amount of energy' },
  { id: 'power', name: 'Power', group: 'power', units: ['W'], words: 'watt wattage', about: 'a power' },
  { id: 'charge', name: 'Electric charge', group: 'charge', units: ['C'], words: 'coulomb', about: 'an electric charge' },
  { id: 'voltage', name: 'Voltage', group: 'voltage', units: ['V'], words: 'volt potential electromotive tension', about: 'an electric potential' },
  { id: 'capacitance', name: 'Capacitance', group: 'capacitance', units: ['F'], words: 'farad capacitor', about: 'a capacitance' },
  { id: 'resistance', name: 'Resistance', group: 'resistance', units: ['Ω'], words: 'ohm resistor impedance', about: 'an electric resistance' },
  { id: 'conductance', name: 'Conductance', group: 'conductance', units: ['S'], words: 'siemens mho', about: 'an electric conductance' },
  { id: 'flux', name: 'Magnetic flux', group: 'flux', units: ['Wb', 'Mx'], words: 'weber maxwell', about: 'a magnetic flux' },
  { id: 'density', name: 'Magnetic flux density', group: 'density', units: ['T', 'G'], words: 'tesla gauss magnetic field induction', about: 'a magnetic flux density' },
  { id: 'inductance', name: 'Inductance', group: 'inductance', units: ['H'], words: 'henry coil inductor', about: 'an inductance' },
  { id: 'lumflux', name: 'Luminous flux', group: 'lumflux', units: ['lm'], words: 'lumen light output', about: 'a luminous flux' },
  { id: 'illuminance', name: 'Illuminance', group: 'illuminance', units: ['lx'], words: 'lux light level', about: 'an illuminance' },
  { id: 'activity', name: 'Radioactivity', group: 'activity', units: ['Bq', 'Ci'], words: 'becquerel curie decay radiation activity', about: 'a radioactivity' },
  { id: 'dose', name: 'Absorbed dose', group: 'dose', units: ['Gy'], words: 'gray radiation', about: 'an absorbed radiation dose' },
  { id: 'equivalent', name: 'Dose equivalent', group: 'equivalent', units: ['Sv', 'rem'], words: 'sievert rem radiation health', about: 'an equivalent radiation dose' },
  { id: 'catalytic', name: 'Catalytic activity', group: 'catalytic', units: ['kat'], words: 'katal enzyme', about: 'a catalytic activity' },
  { id: 'volume', name: 'Volume', group: 'volume', units: ['L'], words: 'litre liter capacity', about: 'a volume' },
  { id: 'field', name: 'Magnetic field strength', group: 'field', units: ['Oe'], words: 'oersted magnetizing', about: 'a magnetic field strength' },
  { id: 'kinematic', name: 'Kinematic viscosity', group: 'kinematic', units: ['St'], words: 'stokes fluid flow', about: 'a kinematic viscosity' },
  { id: 'dynamic', name: 'Dynamic viscosity', group: 'dynamic', units: ['P'], words: 'poise fluid thickness', about: 'a dynamic viscosity' },
  { id: 'acceleration', name: 'Acceleration', group: 'acceleration', units: ['Gal'], words: 'gal galileo gravity', about: 'an acceleration' },
  { id: 'exposure', name: 'Exposure', group: 'exposure', units: ['R'], words: 'roentgen x-ray gamma ionizing', about: 'an exposure to ionizing radiation' },
  { id: 'speed', name: 'Speed', group: 'speed', units: ['kn', 'mph'], words: 'velocity knot mile per hour sea vehicle', about: 'a speed' },
];

// ---- conversion ------------------------------------------------------------------------------------------------

const POW = (exp: number) => Number(`1e${exp}`);
/** Round away floating-point dust: 12 significant digits are kept. */
export const tidy = (x: number) => (Number.isFinite(x) && x !== 0 ? Number(x.toPrecision(12)) : x === 0 ? 0 : x);

/** The value, in the coherent SI unit of the unit's group, of `amount` written with `prefix` and `unit`. */
export function toBase(amount: number, prefix: string, unit: string): number {
  const u = UNIT_BY_SYM.get(unit);
  if (!u) return NaN;
  return amount * POW(PREFIX_EXP[prefix] ?? 0) * u.factor + (u.offset ?? 0);
}
/** The amount that, written with `prefix` and `unit`, equals `base` in the coherent SI unit. */
export function fromBase(base: number, prefix: string, unit: string): number {
  const u = UNIT_BY_SYM.get(unit);
  if (!u) return NaN;
  return (base - (u.offset ?? 0)) / (POW(PREFIX_EXP[prefix] ?? 0) * u.factor);
}

/** The prefix that puts a value into 1 … 999, using only the steps of 1000 (q r y z a f p n μ m · k M G T P E Z Y R Q). */
export function autoPrefix(valueInUnit: number): string {
  const v = Math.abs(tidy(valueInUnit));
  if (!Number.isFinite(v) || v === 0) return '';
  let e = Math.max(-30, Math.min(30, Math.floor(Math.log10(v) / 3) * 3));
  while (e > -30 && v / POW(e) < 1) e -= 3;
  while (e < 30 && v / POW(e) >= 1000) e += 3;
  return ENG_SYM.get(e) ?? '';
}

/** The text form of an amount: shortest form that reads back to the same 12-digit value. */
export function fmtAmount(x: number): string {
  if (!Number.isFinite(x)) return String(x);
  const t = tidy(x);
  return String(Object.is(t, -0) ? 0 : t);
}
/** `<amount><unit>` with the prefix joined on: 2.5km. */
export const fmtQuantity = (amount: number, prefix: string, unit: string) => `${fmtAmount(amount)}${prefix}${unit}`;

// ---- parsing ---------------------------------------------------------------------------------------------------

export interface ParsedQuantity { amount: number; prefix: string; unit: string; group: string; base: number }
export type ParseResult = { ok: true; amount: number; q?: ParsedQuantity } | { ok: false; error: string };

const NUMBER = /^([+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?)\s*(.*)$/;
/** Typographic look-alikes: micro sign, ohm sign, angstrom sign, ℃. */
const normalize = (s: string) => s.replace(/\u2212/g, '-').replace(/\u00b5/g, 'μ').replace(/\u2126/g, 'Ω').replace(/\u212b/g, 'Å').replace(/\u2103/g, '°C').replace(/\u00ba(?=C)/g, '°');

/** Every way the text can be read as prefix + unit. Prefixes and units are both case-sensitive. */
export function readUnit(text: string): { prefix: string; unit: UnitDef }[] {
  const out: { prefix: string; unit: UnitDef }[] = [];
  for (const p of ['', ...PREFIXES.map((x) => x.sym)]) {
    if (!text.startsWith(p)) continue;
    const u = UNIT_BY_SYM.get(text.slice(p.length));
    if (u) out.push({ prefix: p, unit: u });
  }
  return out;
}

/**
 * Read `<amount><unit>`. Some spellings fit two readings (cd is the candela or a centiday, au is an astronomical unit or
 * an attodalton): the reading that belongs to `prefer` (the group of the module that is reading) wins, and after that the
 * one without a prefix. Text that is only a number has no unit: it is an amount in whatever unit the reader holds.
 */
export function parseQuantity(input: string, prefer?: string): ParseResult {
  const m = NUMBER.exec(normalize(input).trim());
  if (!m) return { ok: false, error: `“${input.trim().slice(0, 24)}” is not a quantity. Write an amount followed by a unit, like 2.5km.` };
  const amount = Number(m[1]);
  if (!Number.isFinite(amount)) return { ok: false, error: `“${m[1]}” is not a finite number.` };
  const rest = m[2].trim();
  if (rest === '') return { ok: true, amount };
  const cands = readUnit(rest);
  if (!cands.length) return { ok: false, error: `“${rest.slice(0, 16)}” is not a known unit.` };
  cands.sort((a, b) => Number(b.unit.group === prefer) - Number(a.unit.group === prefer) || a.prefix.length - b.prefix.length);
  const { prefix, unit } = cands[0];
  return { ok: true, amount, q: { amount, prefix, unit: unit.sym, group: unit.group, base: toBase(amount, prefix, unit.sym) } };
}
