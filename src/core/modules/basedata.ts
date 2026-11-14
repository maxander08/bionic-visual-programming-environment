import type { ModuleDef } from '../types';
import { toText, toExactText } from '../util';
import { decFromValue, packDec, parseDec, toNumber, toPlain, type Dec } from '../decimal';
import * as D from '../decmath';
import { toDec } from '../decmath';
import {
  INT_MAX, INT_MIN, MAX_ITEMS, applyCase, caseChar, chars, clampInt, codePointOf, fmtCodePoint, fmtInt, fmtItem, fmtList, itemAt,
  parseItems, quote, readBool, roundInt, validCodePoint, wordsFor,
} from '../basedata';
import { bol, inp, num, out, sel, txt } from './kit';

// The Base Data section: the six basic data types. Each module holds one value of its type, converts whatever arrives on
// its Input pin into that type, and emits it. They look like the yellow utility chips, in the section's own fuchsia.
// Every setting is also a setting pin along the top edge (the registry derives them), the Input pin sits on the left and
// the outputs along the bottom, so the node keeps the one-row chip size.

const base = { category: 'Base Data' as const, family: 'data' as const, size: 'chip' as const, source: true };

const IN = (what: string) => inp('in', 'Input', 'any', `${what} While connected, it replaces the stored value. Whatever arrives is converted to this type.`, 'left', true);

const TRUNCATE_NOTE = 'Rounding decides how a fractional number becomes whole.';

export const baseData: ModuleDef[] = [
  /* ───── Integer ───── */
  {
    ...base, type: 'integer', name: 'Integer', caption: 'Integer', glyph: 'Int',
    keywords: 'int whole number counter hex binary octal 32-bit signed',
    chip: (p) => fmtInt(Number(p.value), String(p.base)),
    inputs: [IN('A number, text such as 42 or 0xFF, or true/false.')],
    outputs: [
      out('out', 'Integer', 'num', 'The whole number.'),
      out('text', 'Text', 'text', 'The integer written as text in the chosen Base: 255 is 255, 0xFF, 0o377 or 0b11111111.'),
    ],
    params: [
      num('value', 'Value', 1, INT_MIN, INT_MAX, 1, 'The whole number to emit, from −2 147 483 648 to 2 147 483 647 (a signed 32-bit integer).'),
      sel('rounding', 'Rounding', 'trunc', [['trunc', 'Toward zero'], ['round', 'Nearest'], ['floor', 'Down'], ['ceil', 'Up']], `${TRUNCATE_NOTE} Applies to the Input pin and to a Value that arrives on its setting pin.`),
      sel('base', 'Base', 'dec', [['dec', 'Decimal (10)'], ['bin', 'Binary (2)'], ['oct', 'Octal (8)'], ['hex', 'Hexadecimal (16)']], 'How the integer is written on the node face and on the Text output. The Integer output is always a plain number.'),
    ],
    run(c) {
      let x: number;
      if (c.has('in')) {
        // Rounded on the exact digits, so 2147483647.99999999999 is cut to 2147483647, not pushed over the limit by a double.
        const d = toDec(c.get('in'));
        if (!d) return c.fail(`“${toText(c.get('in'))}” is not a number, so it cannot become an integer.`);
        const how = c.str('rounding');
        x = toNumber(how === 'round' ? D.round(d) : how === 'floor' ? D.floor(d) : how === 'ceil' ? D.ceil(d) : D.trunc(d)) + 0;
      } else x = roundInt(c.num('value'), c.str('rounding'));
      if (!Number.isFinite(x)) return c.fail('This is not a number, so it cannot become an integer.');
      const r = clampInt(x);
      x = r.value;
      if (r.clamped) c.warn('Outside the 32-bit range −2 147 483 648 … 2 147 483 647: held at the nearest limit.');
      const text = fmtInt(x, c.str('base'));
      c.emit('out', x);
      c.emit('text', text);
      c.view({ chip: text });
    },
    doc: {
      summary: 'A whole number, such as 7, −3 or 0. Converts anything it is given into an integer.',
      runtime: 'Emits the Value (or the converted Input) as a whole number between −2 147 483 648 and 2 147 483 647, and the same number as text in the chosen Base. Fractions are made whole by the Rounding setting; values beyond the range are held at the limit with a warning.',
      errors: ['An Input that is not a number (for example “abc”) raises an error.'],
      examples: ['Integer → Adder: count in whole steps.', 'Decimal → Integer: drop the fraction of a measurement.', 'Integer Text (Hexadecimal) → Projector: show a number as 0xFF.'],
    },
  },

  /* ───── Decimal ───── */
  {
    ...base, type: 'decimal', name: 'Decimal', caption: 'Decimal', glyph: 'Dec',
    keywords: 'float double real fraction floating point number precision arbitrary exact digits pi',
    chip: (p) => { const r = parseDec(String(p.value)); return r.ok ? toPlain(r.dec) : String(p.value); },
    inputs: [IN('A number, text such as 3.14159265358979323846 or 1.5e3, or true/false. Text keeps every digit.')],
    outputs: [
      out('out', 'Decimal', 'num', 'The number with every digit it was given, never rounded. Wire it to an Adder, Multiplier, Math, Projector or another node: they all work on the exact digits (3.14159265358979323846 stays 3.14159265358979323846).'),
      out('text', 'Text', 'text', 'The number written out in full with every digit it was given, never rounded and never in exponent form. Handy when you want the digits as text, for example to join them into a sentence.'),
    ],
    params: [
      txt('value', 'Value', '1.5', 'The number to emit, with as many digits as you like: 3.14159265358979323846264338327950288 is kept whole. Digits after the point, trailing zeros and an exponent (6.022e23) are all allowed.', { maxLength: 5000, placeholder: 'Any number, any number of digits' }),
    ],
    run(c) {
      let dec: Dec;
      if (c.has('in')) {
        const v = c.get('in');
        const r = decFromValue(v);
        if (!r.ok) return c.fail(`“${toText(v)}” is not a number, so it cannot become a decimal.`);
        dec = r.dec;
      } else {
        const r = parseDec(c.str('value'));
        if (!r.ok) return c.fail('This is not a number, so it cannot become a decimal.');
        dec = r.dec;
      }
      const text = toPlain(dec);
      // Every digit travels on the Decimal pin: a number a double holds exactly goes out as a plain number, a longer one as an exact decimal.
      c.emit('out', packDec(dec));
      c.emit('text', text);
      c.view({ chip: text });
    },
    doc: {
      summary: 'A number with a fractional part, such as 3.14 or −0.5, with as many digits as you want. Nothing is ever rounded.',
      runtime: 'Keeps exactly the digits you type (or that arrive) and emits them in full, with no limit on how many: on the Decimal pin as an exact number that the arithmetic nodes (Adder, Subtractor, Multiplier, Divisor, Math, Combine, Counter…) add, multiply and compare digit for digit, and on Text as written. Rounding, decimal places and notation are done only by the Number Formatter actor, when you ask for it.',
      errors: ['An Input that is not a number raises an error.', 'A number whose exponent is beyond ±99999 is refused.'],
      examples: ['Decimal Text → Number Formatter: round 3.14159265358979323846 to 10 places without losing the rest first.', 'Decimal 3 → Adder ← Decimal 0.14159265: 3.14159265, every digit kept.', 'Decimal → Multiplier: scale a signal by a factor.', 'Decimal Text (3.50) → Projector: show 3.50 with its zero.'],
    },
  },

  /* ───── String ───── */
  {
    ...base, type: 'string', name: 'String', caption: 'String', glyph: 'Str',
    keywords: 'text words sentence characters case upper lower trim length',
    chip: (p) => quote(applyCase(p.trim ? String(p.value).trim() : String(p.value), String(p.case))),
    inputs: [IN('Text, or anything that can be written as text: numbers, true/false, lists.')],
    outputs: [
      out('out', 'String', 'text', 'The text, after Case and Trim are applied.'),
      out('length', 'Length', 'num', 'How many characters the text has. An emoji counts as one.'),
    ],
    params: [
      txt('value', 'Value', 'Hello', 'The text to emit.', { placeholder: 'Type some text' }),
      sel('case', 'Case', 'keep', [['keep', 'As typed'], ['upper', 'UPPER CASE'], ['lower', 'lower case'], ['title', 'Capitalize Words']], 'Changes the letters to capitals or small letters.'),
      bol('trim', 'Trim', false, 'Remove spaces and line breaks from the start and the end.'),
    ],
    run(c) {
      let s = c.has('in') ? toExactText(c.get('in')) : c.str('value');
      if (c.bool('trim')) s = s.trim();
      s = applyCase(s, c.str('case'));
      c.emit('out', s);
      c.emit('length', chars(s).length);
      c.view({ chip: quote(s) });
    },
    doc: {
      summary: 'A piece of text, such as “Hello”. Converts anything it is given into a string.',
      runtime: 'Emits the Value (or the Input written as text) after Trim and Case, together with its Length in characters. Lists arrive as their JSON text and true/false as the words true and false.',
      examples: ['String → Projector: show a message.', 'Decimal Text → String: turn a number into text and change its case.', 'String Length → Compare: act when a message is too long.'],
    },
  },

  /* ───── Character ───── */
  {
    ...base, type: 'character', name: 'Character', caption: 'Character', glyph: 'Chr',
    keywords: 'char letter symbol glyph unicode code point ascii emoji',
    chip: (p) => {
      const ch = chars(String(p.value))[0];
      return ch === undefined ? '—' : `'${ch === '\n' ? '\\n' : ch === '\t' ? '\\t' : ch}' · ${fmtCodePoint(codePointOf(ch))}`;
    },
    inputs: [IN('Text (its first character is used) or a number (read by the Number input setting).')],
    outputs: [
      out('out', 'Character', 'text', 'The single character, as text one character long.'),
      out('code', 'Code', 'num', 'The Unicode code point of the character: A is 65, a is 97, 0 is 48.'),
    ],
    params: [
      txt('value', 'Value', 'A', 'The character to emit: exactly one. Only the first is used when more are typed.', { maxLength: 2, placeholder: 'A' }),
      sel('case', 'Case', 'keep', [['keep', 'As typed'], ['upper', 'Capital'], ['lower', 'Small']], 'Changes a letter to its capital or small form. Characters that are not letters are left as they are.'),
      sel('numbers', 'Number input', 'text', [['text', 'As text (5 → “5”)'], ['code', 'As code point (65 → “A”)']], 'How a number arriving on the Input pin becomes a character: as the digits it is written with, or as the Unicode code point it stands for.'),
    ],
    run(c) {
      let ch: string | undefined;
      if (c.has('in')) {
        const v = c.get('in');
        if (typeof v === 'number' && c.str('numbers') === 'code') {
          if (!validCodePoint(v)) return c.fail(`${toText(v)} is not a Unicode code point (a whole number from 0 to 1 114 111, not 55 296–57 343).`);
          ch = String.fromCodePoint(v);
        } else ch = chars(toText(v))[0];
        if (ch === undefined) return c.fail('The Input is empty: a character needs one.');
      } else {
        const all = chars(c.str('value'));
        ch = all[0];
        if (ch === undefined) return c.fail('A character needs one character. Type one in Value.');
        if (all.length > 1) c.warn('More than one character was typed: only the first is used.');
      }
      ch = caseChar(ch, c.str('case'));
      c.emit('out', ch);
      c.emit('code', codePointOf(ch));
      c.view({ chip: `'${ch === '\n' ? '\\n' : ch === '\t' ? '\\t' : ch}' · ${fmtCodePoint(codePointOf(ch))}` });
    },
    doc: {
      summary: 'One single character, such as A, 7 or ?. Also gives its Unicode code point.',
      runtime: 'Emits exactly one character (a letter, digit, symbol or emoji) and its Unicode code point. From the Input pin it takes the first character of text, or reads a number as a code point when Number input says so.',
      errors: ['An empty Value or an empty Input raises an error.', 'A number that is not a valid Unicode code point (negative, fractional or above 1 114 111) raises an error in code point mode.'],
      examples: ['Integer → Character (code point mode): turn 65 into A.', 'Character Code → Compare: test which letter was typed.', 'String → Character: pick the first letter of a word.'],
    },
  },

  /* ───── Boolean ───── */
  {
    ...base, type: 'boolean', name: 'Boolean', caption: 'Boolean', glyph: 'Bool',
    keywords: 'bool true false yes no on off flag switch truth logic',
    chip: (p) => wordsFor(String(p.words), !!p.value),
    inputs: [IN('Anything: true/false, a number (0 is false), or words such as yes, no, on and off.')],
    outputs: [
      out('out', 'Boolean', 'bool', 'True or false.'),
      out('not', 'Not', 'bool', 'The opposite of the Boolean output.'),
      out('text', 'Text', 'text', 'The value written with the chosen Words: true/false, yes/no, on/off or 1/0.'),
    ],
    params: [
      bol('value', 'Value', true, 'The truth value to emit.'),
      sel('words', 'Words', 'tf', [['tf', 'true / false'], ['yn', 'yes / no'], ['oo', 'on / off'], ['bit', '1 / 0']], 'The words used on the node face and on the Text output. The Boolean output is always true or false.'),
    ],
    run(c) {
      const v = c.has('in') ? readBool(c.get('in')) : c.bool('value');
      const text = wordsFor(c.str('words'), v);
      c.emit('out', v);
      c.emit('not', !v);
      c.emit('text', text);
      c.view({ chip: text });
    },
    doc: {
      summary: 'A truth value: true or false. Converts anything it is given into a boolean.',
      runtime: 'Emits true or false, its opposite on Not, and the value as text in the chosen Words. From the Input pin, 0, empty text, an empty list and the words false, no, off, n and f read as false; everything else reads as true.',
      examples: ['Boolean → Relay: open or close a path.', 'Compare → Boolean Not: invert a test.', 'Boolean Text (yes / no) → Projector: show an answer in words.'],
    },
  },

  /* ───── Array / List ───── */
  {
    ...base, type: 'array', name: 'Array', caption: 'Array / List', glyph: '[ ]',
    keywords: 'list array items collection vector values index element length csv json',
    chip: (p) => {
      const r = parseItems(String(p.items), String(p.separator), String(p.as));
      return r.ok ? fmtList(r.items) : String(p.items);
    },
    inputs: [IN('A list, or text to split into one (using the Separator), or any single value (it becomes a list of one).')],
    outputs: [
      out('out', 'List', 'data', 'The whole list.'),
      out('length', 'Length', 'num', 'How many items the list holds.'),
      out('item', 'Item', 'any', 'The item at the chosen Index. Nothing is emitted when the index is outside the list.'),
    ],
    params: [
      txt('items', 'Items', '1, 2, 3', 'The items, written one after another and split at the Separator, or a JSON list such as [1, "a", true].', { multiline: true, maxLength: 4000, placeholder: '1, 2, 3' }),
      txt('separator', 'Separator', ',', 'What splits the Items text into separate items. Leave empty to make every character an item.', { maxLength: 8 }),
      sel('as', 'Items as', 'auto', [['auto', 'Automatic'], ['number', 'Numbers'], ['text', 'Text']], 'Automatic reads 12 as a number, true and false as booleans and anything else as text. Numbers insists that every item is a number. Text keeps everything as written.'),
      num('index', 'Index', 0, -9999, 9999, 1, 'Which item to put on the Item output. 0 is the first; a negative index counts from the end, so −1 is the last.'),
    ],
    run(c) {
      let items: unknown[];
      if (c.has('in')) {
        const v = c.get('in');
        if (Array.isArray(v)) items = v.slice();
        else if (typeof v === 'string') {
          const r = parseItems(v, c.str('separator'), c.str('as'));
          if (!r.ok) return c.fail(r.error);
          items = r.items;
        } else items = [v];
      } else {
        const r = parseItems(c.str('items'), c.str('separator'), c.str('as'));
        if (!r.ok) return c.fail(r.error);
        items = r.items;
      }
      if (items.length > MAX_ITEMS) { items = items.slice(0, MAX_ITEMS); c.warn(`A list holds at most ${MAX_ITEMS.toLocaleString('en')} items: the rest were dropped.`); }
      c.emit('out', items);
      c.emit('length', items.length);
      const at = itemAt(items, c.num('index'));
      if (at.ok) c.emit('item', at.value);
      else if (items.length === 0) c.warn('The list is empty, so there is no item to read.');
      else c.warn(`Index ${c.num('index')} is outside the list, which has ${items.length} item${items.length === 1 ? '' : 's'}.`);
      c.view({ chip: fmtList(items), item: at.ok ? fmtItem(at.value) : '' });
    },
    doc: {
      summary: 'An ordered list of values, such as [1, 2, 3] or ["red", "green"]. Splits text into a list and reads one item from it.',
      runtime: 'Emits the list, its Length and the Item at Index. Items are written separated (1, 2, 3) or as a JSON list. A list or a text arriving on the Input pin replaces the stored items; any other value becomes a list of one. A list holds at most 10 000 items.',
      errors: ['Items as “Numbers” with an item that is not a number raises an error.', 'An Index outside the list raises a warning and leaves the Item output empty.'],
      examples: ['Array Length → Compare: act when a list is long enough.', 'Array Item → Projector: show one value from the list.', 'String → Array (Separator “,”): split a line of text into items.'],
    },
  },
];
