import type { ModuleDef, ParamDef, Params } from '../types';
import { toNum } from '../util';
import { FILE_KIND_BY_ID, isFileDescriptor, type FileKindId } from '../files';
import { SOURCE_KINDS, formatLabel, formatsOf, isKindId, requestConversion, routeLabel, targetsOf } from '../convert';
import { PREFIXES, autoPrefix, fmtQuantity } from '../quantities';
import { CONV_BY_SYM, CONV_GROUPS, CONV_GROUP_BY_ID, cFromBase, cToBase, ignoresPrefix, parseConv, tidy } from '../units';
import { inp, num, out, sel, txt } from './kit';

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

export const actors: ModuleDef[] = [fileConverter, unitConverter];
