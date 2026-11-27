import type { ModuleDef, ParamDef, Params } from '../types';
import { toExactText, toNum, toText } from '../util';
import { decFromValue, formatDec, formatOptionsOf, isDec, packDec, parseDec, ratToDec, toPlain } from '../decimal';
import { DEFAULT_SYMBOLS, MAX_BASE, checkSymbols, countDigits, formatBased, parseBased } from '../baseconv';
import { FILE_KIND_BY_ID, isFileDescriptor, type FileKindId } from '../files';
import { SOURCE_KINDS, formatLabel, formatsOf, isKindId, requestConversion, routeLabel, targetsOf } from '../convert';
import { PREFIXES, autoPrefix, fmtQuantity } from '../quantities';
import { CONV_BY_SYM, CONV_GROUPS, CONV_GROUP_BY_ID, cFromBase, cToBase, ignoresPrefix, parseConv, tidy } from '../units';
import { bol, details, inp, num, out, sel, txt } from './kit';

// The Actors section: modules that carry out one predefined job. Like every module they keep their settings in the inspector and
// show each of them as a setting pin on the node (the registry derives the pins from the parameter list), so a signal can choose
// the formats, units or amounts while the program runs.

const kindName = (id: string) => FILE_KIND_BY_ID.get(id as FileKindId)?.name ?? id;

// ---- File Converter --------------------------------------------------------------------------------------------------------

const FC_OUTS = ['file', 'done', 'content', 'image', 'name', 'ext', 'size'];

/**
 * The settings depend on one another: which categories a file can become depends on its own category, and which formats a result can
 * have depends on the category it becomes. The choices are therefore computed from the settings in hand, and a value that no longer
 * fits falls back to the first choice that does (the registry's resolveParams does this for the inspector and for setting pins alike).
 */
function fileConverterParams(p: Params): ParamDef[] {
  const from: FileKindId = isKindId(p.from) ? p.from : 'image';
  const tos = targetsOf(from);
  const to = (tos as string[]).includes(String(p.to)) ? (p.to as FileKindId) : tos[0];
  const formats = formatsOf(from, to);
  return [
    sel('from', 'Convert from', 'image', SOURCE_KINDS.map((id) => [id, kindName(id)] as [string, string]),
      'The category of the incoming file: Document, Text, PDF, Audio, Video, Image, Spreadsheet, Presentation, Executable, Web, Compressed or Miscellaneous. A file of another category is refused with a message that names it.'),
    sel('to', 'Convert to', tos[0], tos.map((id) => [id, kindName(id)] as [string, string]),
      'The category the file becomes. Only categories this converter can really make from the “from” category are offered, so changing “Convert from” may change this choice too.'),
    sel('format', 'Format', formats[0], formats.map((f) => [f, formatLabel(f)] as [string, string]),
      'The file type of the result, as its extension. The choices depend on “Convert to”.'),
    txt('name', 'Result name', '', 'Name of the new file without its extension. Empty keeps the name of the incoming file.', { maxLength: 80, placeholder: 'same as the source' }),
    num('quality', 'Picture quality', 0.92, 0.05, 1, 0.01, 'How much detail JPEG and WebP pictures keep, and the pictures drawn into a PDF (1 is best, 0.05 is smallest). Ignored by every other format.'),
    details('the name of the file being converted'),
  ];
}

const fileConverter: ModuleDef = {
  type: 'actor-fileconv', name: 'File Converter', caption: 'File Converter', category: 'Actors', family: 'actor', glyph: 'FCV', size: 'square', delaying: false,
  keywords: 'convert converter file format transform change save as export pdf docx png jpg jpeg webp bmp svg wav zip csv xlsx html txt md rtf image picture document audio spreadsheet',
  inputs: [inp('file', 'File', 'data', 'The file to convert: the File output of a Files node (or of another File Converter). Its category must match “Convert from”.', 'top')],
  outputs: [
    out('file', 'File', 'data', 'The converted file as a File record. Connect it to a Projector to look at it, to another File Converter to convert it again, or use the inspector to download it.', 'bottom'),
    out('done', 'Done', 'bool', 'True, as an event, each time a new converted file is ready. Cleared while a conversion is running.', 'bottom'),
    out('content', 'Content', 'text', 'The text of the converted file, when it is a text-like file (text, document, web page, CSV). Empty for pictures, sound, PDF and archives.', 'bottom'),
    out('image', 'Image', 'image', 'The converted picture scaled to at most 256 px, when the result is a picture. Connect it to Image Display.', 'bottom'),
    out('name', 'Name', 'text', 'The name of the converted file, for example report.pdf.', 'right'),
    out('ext', 'Extension', 'text', 'The extension of the converted file in lower case, without the dot.', 'right'),
    out('size', 'Size', 'num', 'The size of the converted file in bytes.', 'right'),
  ],
  params: fileConverterParams({}),
  dynamicParams: fileConverterParams,
  run(c) {
    const v = c.get('file');
    const from = c.str('from') as FileKindId, to = c.str('to') as FileKindId, format = c.str('format');
    const route = routeLabel(from, to, format);
    if (!isFileDescriptor(v)) { c.view({ state: 'error', route }); return c.fail('The File pin needs a file: connect the File output of a Files node or of another File Converter.'); }
    if (v.type !== from) {
      c.view({ state: 'error', route, name: v.name });
      return c.fail(`“${v.name}” is a ${kindName(v.type)} file, but this converter takes ${kindName(from)} files. Set “Convert from” to ${kindName(v.type)}, or connect a ${kindName(from)} file.`);
    }
    const r = requestConversion({ src: v, to, format, name: c.str('name'), quality: c.num('quality') });
    if (r.status === 'pending') { FC_OUTS.forEach((id) => c.emit(id, undefined)); c.view({ state: 'working', route, name: v.name }); return; }
    if (r.status === 'error') { c.view({ state: 'error', route, name: v.name }); return c.fail(r.message); }
    const { info, desc } = r;
    c.emit('file', desc);
    c.emit('content', info.text);
    c.emit('image', info.image);
    c.emit('name', info.name);
    c.emit('ext', info.ext);
    c.emit('size', info.size);
    if (c.state.last !== desc.id) { c.state.last = desc.id; c.emit('done', true, c.strength, true); }
    if (info.warn) c.warn(info.warn);
    c.view({ state: 'done', route, name: info.name, size: info.size, id: info.id, src: v.name });
  },
  doc: {
    summary: 'Converts a file of one category into a file of another: a picture into a PDF, a document into plain text, a CSV into an Excel workbook, a video into a still frame, anything into a ZIP.',
    runtime: 'Pick the category the file comes from (Convert from), the category it becomes (Convert to) and the Format. Only conversions that can really be done in a browser are offered, and the list of categories and formats follows your choices. The File pin takes the File output of a Files node. While the conversion runs the node says “Converting…”; when it ends the new file leaves on File (to a Projector, to another converter, or to the Download button in the inspector), its text on Content, its picture on Image, and Done fires. Everything happens inside this browser: nothing is uploaded. Every setting is also a pin on the left, so signals can choose the format while the program runs.',
    errors: [
      'A file whose category differs from “Convert from” is refused with a message that names both.',
      'A file whose content cannot be read (an old .DOC, a damaged archive, a picture or sound this browser cannot decode) raises an error that says why.',
      'Text that holds characters a PDF’s built-in font cannot show is drawn as pictures of the pages instead, so nothing is lost; the text is then not selectable.',
    ],
    examples: [
      'Image file → File Converter (Image → PDF) → Projector: turn a picture into a PDF and view it.',
      'Text file → File Converter (Text → Document, .DOCX) → inspector Download: make a Word document from notes.',
      'Spreadsheet file (.CSV) → File Converter (Spreadsheet → Spreadsheet, .XLSX): make an Excel workbook.',
      'Video file → File Converter (Video → Image, .PNG) → Image Display: grab a still frame.',
    ],
  },
};

// ---- Unit Converter --------------------------------------------------------------------------------------------------------

const SUP: Record<string, string> = { '-': '⁻', '0': '⁰', '1': '¹', '2': '²', '3': '³', '4': '⁴', '5': '⁵', '6': '⁶', '7': '⁷', '8': '⁸', '9': '⁹' };
const pow10 = (e: number) => `10${String(e).split('').map((ch) => SUP[ch]).join('')}`;
const NONE = 'none';
const AUTO = 'auto';
const prefixSym = (choice: string) => (choice === NONE || choice === AUTO ? '' : choice);
const PREFIX_CHOICES: [string, string][] = PREFIXES.map((p) => [p.sym, `${p.sym} · ${p.name} (${pow10(p.exp)})`] as [string, string]);
const FROM_PREFIXES: [string, string][] = [[NONE, 'none (×1)'], ...PREFIX_CHOICES];
const TO_PREFIXES: [string, string][] = [[NONE, 'none (×1)'], [AUTO, 'auto (best fit)'], ...PREFIX_CHOICES];

function unitConverterParams(p: Params): ParamDef[] {
  const gid = CONV_GROUP_BY_ID.has(String(p.group)) ? String(p.group) : 'length';
  const g = CONV_GROUP_BY_ID.get(gid)!;
  const choices = g.units.map((s) => [s, `${s} · ${CONV_BY_SYM.get(s)!.name}`] as [string, string]);
  return [
    sel('group', 'Quantity', 'length', CONV_GROUPS.map((q) => [q.id, q.name] as [string, string]),
      'The kind of quantity to convert: Length, Mass, Time, Temperature, Pressure, Energy, Speed, Area, Volume and the rest of the Quantities section. Only units of this kind are offered below, because only they can be converted into each other.'),
    num('amount', 'Amount', 1, -1e15, 1e15, 0.1, 'How much there is to convert, in the “From” unit. Used when the Quantity pin has no signal.'),
    sel('from', 'From unit', g.units[0], choices, 'The unit the amount is written in. The choices are the units of the chosen kind of quantity.'),
    sel('fromPrefix', 'From prefix', NONE, FROM_PREFIXES, 'SI prefix of the “From” unit, a power of ten placed in front of it: k + m is the kilometre. Units such as ft, lb and psi are not scaled by prefixes, so it is ignored for them.'),
    sel('to', 'To unit', g.units[1] ?? g.units[0], choices, 'The unit to convert into. The choices are the units of the chosen kind of quantity.'),
    sel('toPrefix', 'To prefix', NONE, TO_PREFIXES, 'SI prefix of the “To” unit. “auto” picks the step of 1000 that keeps the result between 1 and 999. Ignored for units that take no prefix.'),
    details('the quantity that was converted'),
  ];
}

const unitConverter: ModuleDef = {
  type: 'actor-unitconv', name: 'Unit Converter', caption: 'Unit Converter', category: 'Actors', family: 'actor', glyph: 'UNIT', size: 'square', source: true,
  keywords: 'convert converter unit units measurement quantity metric imperial length mass temperature celsius fahrenheit kelvin feet inches miles kilometres pounds kilograms gallons litres speed mph pressure psi energy area',
  inputs: [inp('in', 'Quantity', 'any', 'A quantity to convert: text with a unit like 5280ft, or a plain number (an amount in the “From” unit). It replaces Amount while connected, and a unit written in the text replaces the “From” unit and prefix.', 'top', true)],
  outputs: [
    out('quantity', 'Quantity', 'text', 'The converted quantity as text, <amount><unit>, for example 1.609km. It can feed any Quantities module.', 'bottom'),
    out('amount', 'Amount', 'num', 'The converted amount alone, in the “To” prefix and unit.', 'bottom'),
    out('unit', 'Unit', 'text', 'The “To” unit with its prefix, for example km.', 'bottom'),
    out('base', 'SI value', 'num', 'The same quantity in the coherent SI unit of its kind (metre, kilogram, second, kelvin …). Use it to compare or calculate with quantities that were written in different units.', 'right'),
  ],
  params: unitConverterParams({}),
  dynamicParams: unitConverterParams,
  run(c) {
    const gid = c.str('group');
    const g = CONV_GROUP_BY_ID.get(gid)!;
    let from = c.str('from');
    let fp = prefixSym(c.str('fromPrefix'));
    const to = c.str('to');
    const choice = c.str('toPrefix');
    let amount: number;
    if (c.has('in')) {
      const v = c.get('in');
      if (typeof v === 'string') {
        const r = parseConv(v, gid);
        if (!r.ok) return c.fail(r.error);
        if (r.q) {
          if (r.q.group !== gid) {
            const other = CONV_GROUP_BY_ID.get(r.q.group)?.name ?? r.q.group;
            return c.fail(`${r.q.prefix}${r.q.unit} is a unit of ${other.toLowerCase()}, not ${g.name.toLowerCase()}. Set “Quantity” to ${other}, or send a ${g.name.toLowerCase()} (${g.units.slice(0, 4).join(', ')}).`);
          }
          from = r.q.unit; fp = r.q.prefix; amount = r.q.amount;
        } else amount = r.amount;
      } else {
        amount = toNum(v);
        if (!Number.isFinite(amount)) return c.fail('The Quantity pin needs text like 5280ft or a number.');
      }
    } else amount = c.num('amount');
    if (ignoresPrefix(from)) fp = '';
    const base = cToBase(amount, fp, from);
    if (!Number.isFinite(base)) return c.fail('That quantity is too large to hold.');
    let tp = prefixSym(choice);
    if (ignoresPrefix(to)) tp = '';
    else if (choice === AUTO) tp = autoPrefix(cFromBase(base, '', to));
    const result = tidy(cFromBase(base, tp, to));
    if (!Number.isFinite(result)) return c.fail('That quantity is too large to hold.');
    const text = fmtQuantity(result, tp, to);
    const si = tidy(base);
    c.emit('quantity', text);
    c.emit('amount', result);
    c.emit('unit', tp + to);
    c.emit('base', si);
    c.view({ text, src: fmtQuantity(tidy(amount), fp, from), from: fp + from, to: tp + to, group: g.name });
  },
  doc: {
    summary: 'Converts a quantity of one kind into another unit of the same kind: kilometres into miles, °C into °F, pounds into kilograms, litres into gallons.',
    runtime: 'Choose the kind of quantity (Length, Mass, Temperature, Speed …), the Amount, the unit it is written in (From, with an optional SI prefix) and the unit to convert into (To, with a prefix or “auto”). Only the units of the chosen kind are offered, so a length can never be turned into a mass. The result leaves as text (<amount><unit>), as an amount, as the unit, and as an SI value. The Quantity pin takes text such as 5280ft or 26.2mi (the unit written there replaces the From unit) or a plain number (an amount in the From unit), and replaces Amount while connected. Every setting is also a pin on the left, so signals can switch units while the program runs. It knows every unit of the Quantities section plus common everyday ones: inches, feet, yards, miles, pounds, ounces, °F, gallons, mph, psi, acres, bytes and more.',
    errors: [
      'A Quantity input in a unit of another kind (5kg sent to a length converter) raises an error that names both kinds.',
      'Text that is not <amount><unit> (for example “ft5”) raises an error.',
    ],
    examples: [
      'Constant (text “26.2mi”) → Unit Converter (Length, To km) → Projector: show a marathon in kilometres.',
      'Length module Quantity → Unit Converter → Projector: convert a Quantities module’s value.',
      'Constant (a number) → Unit Converter Amount pin: convert a live value.',
    ],
  },
};

// ---- Number Formatter ------------------------------------------------------------------------------------------------------

const NF_MODES: [string, string][] = [
  ['places', 'Round to n decimal places'], ['digits', 'Round to n significant digits'], ['sci', 'Scientific notation'], ['eng', 'Engineering notation'], ['plain', 'Exact (no rounding)'],
];
const NF_ROUNDING: [string, string][] = [
  ['nearest', 'Nearest (halves away from zero)'], ['even', 'Nearest (halves to even)'], ['up', 'Up (toward +∞)'], ['down', 'Down (toward −∞)'], ['zero', 'Toward zero (cut off)'], ['away', 'Away from zero'],
];

const numberFormatter: ModuleDef = {
  type: 'actor-numfmt', name: 'Number Formatter', caption: 'Number Formatter', category: 'Actors', family: 'actor', glyph: 'FMT', size: 'square', source: true,
  keywords: 'number format formatter round rounding decimal places digits significant figures scientific engineering notation exponent mantissa precision truncate ceiling floor banker',
  inputs: [inp('in', 'Number', 'any', 'The number to format. Text keeps every digit it has (for example the Text output of a Decimal), so the rounding is done once, on the full value. A plain number is read by its shortest exact text. It replaces Value while connected.', 'top', true)],
  outputs: [
    out('text', 'Formatted', 'text', 'The number written as text in the chosen format, for example 3.14, 1.235e+3 or 12.35e+3. Every digit asked for is in it, trailing zeros included.', 'bottom'),
    out('number', 'Number', 'num', 'The rounded value as a number, with every digit of it: the arithmetic nodes carry on from exactly this value.', 'bottom'),
    out('mantissa', 'Mantissa', 'num', 'The digits before the power of ten in scientific form (1.235), or in engineering form (12.35) when that is the chosen notation. Plain modes use the scientific form.', 'right'),
    out('exponent', 'Exponent', 'num', 'The power of ten that goes with Mantissa. In engineering notation it is always a multiple of three.', 'right'),
  ],
  params: [
    txt('value', 'Value', '1234.56789', 'The number to format, with as many digits as you like. Used when the Number pin has no signal.', { maxLength: 5000, placeholder: 'Any number, any number of digits' }),
    sel('mode', 'Format', 'places', NF_MODES, 'What to do with the number. Round to n decimal places and Round to n significant digits shorten it; Scientific and Engineering notation write it with a power of ten; Exact only rewrites it, dropping nothing.'),
    num('n', 'Digits (n)', 2, 0, Infinity, 1, 'How many decimal places (Round to n decimal places) or significant digits (the other formats) to keep. For decimal places 0 gives a whole number. For significant digits and the two notations 0 means keep every digit.'),
    sel('rounding', 'Rounding', 'nearest', NF_ROUNDING, 'How a number that does not fit is rounded. It decides what 2.5 and −2.5 become at 0 places, and whether any leftover digit pushes the last kept digit up.'),
    bol('trim', 'Trim trailing zeros', false, 'Off: 3.1 at 3 places is 3.100. On: it is 3.1. Applies to every format, including the mantissa of scientific and engineering notation.'),
    sel('style', 'Exponent style', 'e', [['e', 'e-notation (1.5e+3)'], ['x10', 'Times ten (1.5 × 10³)']], 'How the power of ten is written in scientific and engineering notation. Ignored by the other formats.'),
    details('how the number is being formatted'),
  ],
  run(c) {
    const viaPin = c.has('in');
    const src = viaPin ? c.get('in') : c.str('value');
    const r = decFromValue(src);
    if (!r.ok) {
      c.view({ state: 'error' });
      return c.fail(`${viaPin ? `“${toText(src).slice(0, 40)}”` : 'This'} is not a number, so it cannot be formatted.`);
    }
    const f = formatDec(r.dec, formatOptionsOf(c.params));
    c.emit('text', f.text);
    c.emit('number', packDec(f.rounded));
    const m = parseDec(f.mantissa);
    c.emit('mantissa', m.ok ? packDec(m.dec) : undefined);
    c.emit('exponent', f.exponent);
    c.view({ text: f.text, mode: c.str('mode'), n: c.num('n') });
  },
  doc: {
    summary: 'Rounds a number to n decimal places or n significant digits, or writes it in scientific or engineering notation. This is the only place numbers are rounded.',
    runtime: 'Takes the number on the Number pin (or the Value setting), keeps every digit it has, and applies the chosen Format once. The result leaves as text on Formatted, as a number on Number, and as Mantissa and Exponent. Decimals never round by themselves: wire a Decimal’s Text output here to round it exactly, however many digits it has. Every setting is also a pin on the left, so signals can change the number of digits while the program runs.',
    errors: [
      'An input that is not a number (for example “1,5” with a comma, or “abc”) raises an error.',
    ],
    examples: [
      'Decimal (3.14159265358979323846) Text → Number Formatter (10 decimal places) → Projector: 3.1415926536.',
      'Constant → Number Formatter (Scientific, 3 digits) → Projector: 123456 reads 1.23e+5.',
      'Decimal Text → Number Formatter (Engineering) → Exponent output: pick the power of three for a unit prefix.',
    ],
  },
};

// ---- Base Converter --------------------------------------------------------------------------------------------------------

/** What arrives on the Number pin, as digits to read in the From base. A number is read by the digits it is written with. */
function digitsOf(v: unknown): string | undefined {
  if (typeof v === 'string') return v;
  if (typeof v === 'number' || isDec(v)) {
    const t = toExactText(v);
    if (/e/i.test(t)) { const r = parseDec(t); return r.ok ? toPlain(r.dec) : t; }
    return t;
  }
  return undefined;
}

const baseConverter: ModuleDef = {
  type: 'actor-baseconv', name: 'Base Converter', caption: 'Base Converter', category: 'Actors', family: 'actor', glyph: 'BASE', size: 'square', source: true,
  keywords: 'base converter radix binary octal decimal hexadecimal hex number system numeral positional unary tally base36 base40 convert digits symbols',
  inputs: [inp('in', 'Number', 'any', 'The number to convert, written in the From base. A number is read by the digits it is written with (101 is the digits 1, 0, 1). Text keeps every digit. It replaces Value while connected.', 'top', true)],
  outputs: [
    out('text', 'Converted', 'text', 'The number written in the To base, with the chosen Symbols, for example FF, 11111111 or -2A.8.', 'bottom'),
    out('number', 'Decimal value', 'num', 'The same number as an ordinary decimal number, exactly: every digit it needs, however many. A fraction that never ends repeats, and is kept as the repeating number it is (0.33333...).', 'bottom'),
    out('digits', 'Digits', 'num', 'How many digits the converted number has. The sign and the point are not counted.', 'right'),
  ],
  params: [
    txt('value', 'Value', '255', 'The number to convert, written in the From base: it may have a sign, a point and any number of digits (FF.8, -101.01). Used when the Number pin has no signal.', { maxLength: 5000, placeholder: 'Digits written in the From base' }),
    num('from', 'From base', 10, 1, MAX_BASE, 1, 'The base the Value is written in, from 1 to 40. Base 1 is tally marks (111 is three); 2 is binary, 8 octal, 10 decimal, 16 hexadecimal.'),
    num('to', 'To base', 16, 1, MAX_BASE, 1, 'The base to write the number in, from 1 to 40. Base 1 is tally marks, written with the second symbol, and zero with the first.'),
    bol('round', 'Round the fraction', false, 'Off: every digit of the number is written, however many, and a fraction that never ends repeats, so its repeating digits are followed by an ellipsis (0.1 in base 2 is 0.00011001100110011...). On: the fraction is rounded to Fraction digits places.'),
    num('precision', 'Fraction digits', 12, 0, Infinity, 1, 'How many digits to keep after the point in the To base when Round the fraction is on. The last one is rounded to the nearest, and zeros at the end are dropped. 0 gives a whole number.'),
    txt('symbols', 'Symbols', DEFAULT_SYMBOLS, 'The characters used as digits, in order: the first one is zero, the next is one, and so on. The default is 0-9, A-Z and then a, b, c, d, which writes every base up to 40. Edit it to use your own symbols; it needs at least as many characters as the larger base, all different. The characters - + . _ and spaces cannot be used.', { maxLength: 64, placeholder: DEFAULT_SYMBOLS }),
    details('the bases being converted'),
  ],
  run(c) {
    const from = Math.round(c.num('from')), to = Math.round(c.num('to'));
    const symbols = c.str('symbols');
    const bad = checkSymbols(symbols, Math.max(from, to, 2));
    if (bad) { c.view({ state: 'error' }); return c.fail(bad); }
    const viaPin = c.has('in');
    const src = viaPin ? digitsOf(c.get('in')) : c.str('value');
    if (src === undefined) { c.view({ state: 'error' }); return c.fail('This is not a number, so it cannot be converted.'); }
    const read = parseBased(src, from, symbols);
    if (!read.ok) { c.view({ state: 'error' }); return c.fail(read.error); }
    const written = formatBased(read.value, to, symbols, c.bool('round') ? c.num('precision') : null);
    if (!written.ok) { c.view({ state: 'error' }); return c.fail(written.error); }
    if (to === 1 && written.value.rounded) c.warn('Base 1 writes whole numbers only: the fraction was rounded.');
    c.emit('text', written.value.text);
    c.emit('number', packDec(ratToDec(read.value.neg ? -read.value.n : read.value.n, read.value.d)));
    c.emit('digits', countDigits(written.value.text));
    c.view({ text: written.value.text, from, to });
  },
  doc: {
    summary: 'Writes a number in a different base, from base 1 (tally marks) to base 40, with symbols you can choose.',
    runtime: 'Reads the number on the Number pin (or the Value setting) as digits in the From base and writes it in the To base. Numbers of any size are converted exactly, with every digit, before and after the point. A fraction that never ends in the To base repeats (0.1 in binary is 0.0001100110011...), and is written with its repeating digits followed by an ellipsis; text written that way can be read back in the From base. Switch on Round the fraction to round the fraction to Fraction digits places instead. The default symbols are 0-9, A-Z and a-d (40 in all): bases up to 16 read as usual (FF), and in bases up to 36 letters are read in either case. Edit Symbols to use other characters. Base 1 is tally marks: a number is that many marks (the second symbol), and zero is the first symbol. Every setting is also a pin on the left, so signals can choose the bases while the program runs.',
    errors: [
      'A digit that does not exist in the From base (for example 2 in binary, or a letter beyond the base) raises an error that lists the digits.',
      'Symbols with too few characters for the larger base, with a repeated symbol, or with - + . _ or a space among the digits raises an error.',
      'A fraction in base 1 is not possible on input and is rounded on output (with a warning).',
    ],
    examples: [
      'Constant 255 → Base Converter (From 10, To 16) → Projector: FF.',
      'Base Converter (From 2, To 10) with Value 101101: 45.',
      'Base Converter (To 40) → Projector: a long number in a few characters.',
      'Switch → Base Converter To base pin: flip between binary and hexadecimal while the program runs.',
    ],
  },
};

export const actors: ModuleDef[] = [fileConverter, unitConverter, numberFormatter, baseConverter];
