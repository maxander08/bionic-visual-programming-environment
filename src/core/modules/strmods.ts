import type { Ctx, ModuleDef } from '../types';
import { toExactText, toNum, toText } from '../util';
import { isDec, toNumber } from '../decimal';
import * as S from '../strings';
import { MAX_LEN, StrError } from '../strings';
import { bol, inp, num, out, sel, txt } from './kit';

// The String Modifiers section: the usual string operators and methods as nodes. They are built like the utility chips of the
// Node section (one row tall, the input on top, the result on the bottom, every setting also a setting pin), in a colour of
// their own. Every node takes text (a number or a boolean is read as its text), works on code points (an emoji is one character),
// and fails with a plain message when an operation cannot be done.

const chip = { category: 'String Modifiers' as const, family: 'strmod' as const, size: 'chip' as const };

const IN = (doc = 'The string to work on. A number or a true/false is read as its text.') => inp('in', 'String', 'text', doc);
const OUT = (doc = 'The resulting string.', label = 'String') => out('out', label, 'text', doc);

const ESC = ' Write \\n for a new line, \\t for a tab and \\\\ for a backslash.';
/** The text of the String input. */
const str$ = (c: Ctx, port = 'in'): string => toText(c.get(port));
/** A text setting with its \n, \t and \\ escapes turned into characters. */
const esc$ = (c: Ctx, key: string): string => S.unescape(c.str(key));
/** Run a string operation: where an operation cannot be done, the module fails with its message. */
const guard = (c: Ctx, f: () => void) => {
  try { f(); } catch (e) {
    if (e instanceof StrError) return c.fail(e.message);
    if (e instanceof RangeError) return c.fail('The result needs more memory than your browser can spare.');
    throw e;
  }
};
/** Send a string result, unless it is longer than a String Modifier builds. */
const emitStr = (c: Ctx, port: string, s: string) => (s.length > MAX_LEN ? c.fail(`The result would be longer than ${MAX_LEN.toLocaleString('en')} characters.`) : c.emit(port, s));
/** A whole number written in a text setting (a slice bound); blank means “not given”. */
const bound$ = (c: Ctx, key: string, label: string): number | undefined => {
  const t = c.str(key).trim();
  if (t === '') return undefined;
  if (!/^[+-]?\d+$/.test(t)) throw new StrError(`${label} “${t}” isn’t a whole number.`);
  return Number(t);
};
const q = (s: unknown) => `"${String(s)}"`;

const START = txt('start', 'Start', '', 'Where to start looking, counting characters from 0 (a negative number counts from the end). Blank means the beginning.', { maxLength: 8 });
const END = txt('end', 'End', '', 'Where to stop looking. The character at this position isn’t included, and a negative number counts from the end. Blank means the end of the string.', { maxLength: 8 });

export const strmods: ModuleDef[] = [
  /* ───── + ───── */
  {
    ...chip, type: 'str-add', name: 'String Adder', caption: 'String Adder', glyph: '+', chip: (p) => q(p.add),
    keywords: 'concatenate concat append join plus add strings text +',
    inputs: [inp('in', 'A', 'text', 'The first string.'), inp('b', 'B', 'text', 'A second string, added after the first; nothing when not connected.', 'top', true)],
    outputs: [OUT('A + B + the Add setting, one string.', 'Sum')],
    params: [{ ...txt('add', 'Add', '', `Text to add at the end.${ESC}`), pinSide: 'left' }],
    run(c) { emitStr(c, 'out', str$(c) + (c.has('b') ? str$(c, 'b') : '') + esc$(c, 'add')); },
    doc: {
      summary: 'Adds strings together, end to end, like a + b.',
      runtime: 'The result is a + b + whatever is in the Add setting. If b is missing it counts as an empty string, and if the first string is missing the node just sits idle. Numbers are added as text, so “1” + “2” is “12”.',
    },
  },

  /* ───── * ───── */
  {
    ...chip, type: 'str-mul', name: 'String Multiplier', caption: 'String Multiplier', glyph: '×', chip: (p) => `${p.times}`,
    keywords: 'repeat multiply times duplicate copies *',
    inputs: [inp('in', 'A', 'text', 'The string to repeat.'), inp('b', 'B', 'num', 'Replaces the Times setting when connected.', 'top', true)],
    outputs: [OUT('The string repeated that many times.', 'Product')],
    params: [{ ...num('times', 'Times', 2, -1000000, 1000000, 1, 'How many copies to make. Zero or less gives you an empty string.'), pinSide: 'left' }],
    run(c) { guard(c, () => emitStr(c, 'out', S.repeat(str$(c), c.has('b') ? toNum(c.get('b')) : c.num('times')))); },
    doc: {
      summary: 'Repeats a string, like s * n.',
      runtime: 'Repeats the string n times, where n comes from B, or from Times when B isn’t connected. Zero or a negative number gives an empty string. n has to be a whole number, and the result can be at most 1 000 000 characters long.',
      errors: ['A number with a fraction (like 2.5) gives an error, since a string can’t be multiplied by a fraction.', 'A result longer than 1 000 000 characters gives an error.'],
    },
  },

  /* ───── split ───── */
  {
    ...chip, type: 'str-split', name: 'String Separator', caption: 'String Separator', glyph: 'a|b', chip: (p) => `${p.mode}`,
    keywords: 'split rsplit splitlines separate divide cut tokens words lines list array',
    inputs: [IN('The string to split.')],
    outputs: [out('out', 'List', 'data', 'The pieces, as a list of strings.'), out('count', 'Count', 'num', 'How many pieces there are.')],
    params: [
      sel('mode', 'Method', 'split', [['split', 'split: from the left'], ['rsplit', 'rsplit: from the right'], ['splitlines', 'splitlines: at line breaks']], 'split and rsplit cut at the Separator, and they only differ when Max splits is set. splitlines cuts at line breaks and ignores the Separator.'),
      txt('sep', 'Separator', ',', `What to cut at. Leave it empty and it cuts at runs of whitespace, like split() does with no argument.${ESC}`, { maxLength: 40 }),
      num('max', 'Max splits', -1, -1, 100000, 1, 'The most cuts to make. Whatever is left stays in one piece. −1 means no limit.'),
      bol('keep', 'Keep line ends', false, 'splitlines only: keeps the line break at the end of every line (keepends=True).'),
    ],
    run(c) {
      guard(c, () => {
        const s = str$(c), m = c.str('mode');
        const parts = m === 'splitlines' ? S.splitLines(s, c.bool('keep')) : S.split(s, esc$(c, 'sep'), c.num('max'), m === 'rsplit');
        c.emit('out', parts);
        c.emit('count', parts.length);
      });
    },
    doc: {
      summary: 'Cuts a string into a list of pieces: split, rsplit and splitlines.',
      runtime: 'Sends the pieces as a list, plus how many there are. With an empty Separator it cuts at runs of whitespace and drops the empty pieces. With a real Separator, two in a row leave an empty piece between them (“a,,b” gives a, an empty string and b). Max splits caps the number of cuts: split keeps what’s left on the right in one piece, and rsplit keeps it on the left.',
      examples: ['String Separator (“,”) → Array: turn a line of comma-separated values into a list.', 'String Separator (splitlines) → Array Length: count the lines of a text.'],
    },
  },

  /* ───── join ───── */
  {
    ...chip, type: 'str-join', name: 'String Joiner', caption: 'String Joiner', glyph: 'a·b', chip: (p) => q(p.sep),
    keywords: 'join glue combine concatenate list array merge items',
    inputs: [inp('in', 'List', 'any', 'A list of values to glue together (the List output of a String Separator or an Array). A text is joined character by character, and a single value stays as it is.')],
    outputs: [OUT('The items joined into one string.')],
    params: [txt('sep', 'Separator', ', ', `What goes between every two items. Leave it empty to glue them together with nothing in between.${ESC}`, { maxLength: 40 })],
    run(c) {
      const v = c.get('in');
      const items = Array.isArray(v) ? v : typeof v === 'string' ? S.cps(v) : [v];
      emitStr(c, 'out', items.map(toExactText).join(esc$(c, 'sep')));
    },
    doc: {
      summary: 'Glues a list of values into one string with a separator in between, like sep.join(list).',
      runtime: 'Every item is turned into text (numbers keep all their digits) and the items are glued together with the Separator. An empty list gives an empty string. This node takes numbers and booleans too, not just strings.',
      examples: ['String Separator → String Joiner (Separator “-”): swap the separator of a line of text.'],
    },
  },

  /* ───── case ───── */
  {
    ...chip, type: 'str-case', name: 'String Caser', caption: 'String Caser', glyph: 'A↔a', chip: (p) => `${p.mode}`,
    keywords: 'upper lower title capitalize camel camelcase swapcase casefold uppercase lowercase capital letters case',
    inputs: [IN()],
    outputs: [OUT('The string in the chosen case.')],
    params: [sel('mode', 'Method', 'upper', [
      ['upper', 'upper: ALL CAPITALS'], ['lower', 'lower: all small letters'], ['title', 'title: Every Word Starts Capital'], ['capitalize', 'capitalize: First letter only'],
      ['camel', 'camel: wordsJoinedLikeThis'], ['swapcase', 'swapcase: swap big and small'], ['casefold', 'casefold: aggressive lower case'],
    ], 'upper, lower and swapcase work on every letter. title capitalizes each word, but a word starts after anything that isn’t a letter, so “they’re” becomes “They’Re”. capitalize only capitalizes the first letter and lowers everything else. camel joins the words together, with the first one in lower case and the rest starting with a capital, so “make me camel” becomes “makeMeCamel”. casefold is a stronger lower, good for comparing text: ß becomes ss.')],
    run(c) { guard(c, () => emitStr(c, 'out', S.changeCase(str$(c), c.str('mode')))); },
    doc: {
      summary: 'Changes the case of a string. You get upper, lower, title, capitalize, swapcase and casefold, plus camelCase.',
      runtime: 'Applies the method you picked. Letters from any alphabet that has two cases get changed (ä ↔ Ä), and anything that isn’t a letter is left alone. camel is the exception: it throws away spaces, punctuation and symbols and joins the words up. A new word starts after every space, dash, underscore or dot, wherever a capital follows a small letter (“fooBar” is foo + Bar), and digits count as a word of their own. An apostrophe doesn’t split a word (“don’t” becomes “dont”). The first word comes out all lower case and every later word starts with a capital.',
    },
  },

  /* ───── strip ───── */
  {
    ...chip, type: 'str-strip', name: 'String Stripper', caption: 'String Stripper', glyph: '⟨ ⟩', chip: (p) => `${p.mode}`,
    keywords: 'strip lstrip rstrip trim whitespace clean spaces remove ends',
    inputs: [IN()],
    outputs: [OUT('The string without the stripped characters at its ends.')],
    params: [
      sel('mode', 'Method', 'strip', [['strip', 'strip: both ends'], ['lstrip', 'lstrip: the start only'], ['rstrip', 'rstrip: the end only']], 'Which end (or ends) to strip.'),
      txt('chars', 'Characters', '', `Every character you list here gets stripped, in any order. It isn’t matched as a word. Leave it empty to strip whitespace.${ESC}`, { maxLength: 40 }),
    ],
    run(c) { guard(c, () => emitStr(c, 'out', S.strip(str$(c), esc$(c, 'chars'), c.str('mode') === 'lstrip' ? 'left' : c.str('mode') === 'rstrip' ? 'right' : 'both'))); },
    doc: {
      summary: 'Removes characters from the ends of a string: strip, lstrip and rstrip.',
      runtime: 'Takes characters off the end (or ends) you chose for as long as they’re in the Characters list, or whitespace (spaces, tabs, line breaks) when the list is empty. Anything in the middle is left alone: “xxhixx” stripped of “x” is “hi”.',
    },
  },

  /* ───── removeprefix / removesuffix ───── */
  {
    ...chip, type: 'str-remove', name: 'String Remover', caption: 'String Remover', glyph: '−a', chip: (p) => `remove${p.mode}`,
    keywords: 'removeprefix removesuffix prefix suffix cut off start end',
    inputs: [IN()],
    outputs: [OUT('The string without the prefix or suffix.')],
    params: [
      sel('mode', 'Method', 'prefix', [['prefix', 'removeprefix: from the start'], ['suffix', 'removesuffix: from the end']], 'Whether to remove the text from the start or from the end of the string.'),
      txt('text', 'Text', '', `The prefix or suffix to remove. It only comes off if the string really starts or ends with it.${ESC}`, { maxLength: 100 }),
    ],
    run(c) { emitStr(c, 'out', S.removeAffix(str$(c), esc$(c, 'text'), c.str('mode'))); },
    doc: {
      summary: 'Removes a prefix or a suffix, once: removeprefix and removesuffix.',
      runtime: 'If the string starts (removeprefix) or ends (removesuffix) with the Text, that part is cut off, once. If it doesn’t, the string comes out unchanged. Unlike strip, the Text is matched as a whole, not as a list of characters.',
    },
  },

  /* ───── replace ───── */
  {
    ...chip, type: 'str-replace', name: 'String Replacer', caption: 'String Replacer', glyph: 'a→b', chip: (p) => `${q(p.old)}→${q(p.new)}`,
    keywords: 'replace substitute swap change find and replace sub',
    inputs: [IN()],
    outputs: [OUT('The string with the replacements made.')],
    params: [
      txt('old', 'Replace', ' ', `The text to look for. Empty text matches between every two characters.${ESC}`, { maxLength: 100 }),
      txt('new', 'With', '_', `What to put in its place. Leave it empty to delete whatever was found.${ESC}`, { maxLength: 100 }),
      num('count', 'Count', -1, -1, 1000000, 1, 'The most replacements to make, counting from the left. −1 replaces every match.'),
    ],
    run(c) { guard(c, () => emitStr(c, 'out', S.replace(str$(c), esc$(c, 'old'), esc$(c, 'new'), c.num('count')))); },
    doc: {
      summary: 'Replaces text inside a string: s.replace(old, new, count).',
      runtime: 'Looks for Replace from the left and swaps each match for With, until Count replacements are done (all of them when Count is −1). The search is case-sensitive, and matches can’t overlap.',
    },
  },

  /* ───── find / index ───── */
  {
    ...chip, type: 'str-find', name: 'String Finder', caption: 'String Finder', glyph: 'i?', chip: (p) => `${p.mode}`,
    keywords: 'find rfind index rindex search locate position where substring',
    inputs: [IN('The string to search in.')],
    outputs: [out('index', 'Index', 'num', 'Where the match starts, counting characters from 0. −1 means there is none (find and rfind).'), out('found', 'Found', 'bool', 'True when the text was found.')],
    params: [
      sel('mode', 'Method', 'find', [['find', 'find: first match'], ['rfind', 'rfind: last match'], ['index', 'index: first match, or an error'], ['rindex', 'rindex: last match, or an error']], 'find and rfind give −1 when nothing matches. index and rindex fail instead.'),
      txt('sub', 'Text', '', `The text to look for.${ESC}`, { maxLength: 100 }),
      START, END,
    ],
    run(c) {
      guard(c, () => {
        const m = c.str('mode');
        const at = S.find(str$(c), esc$(c, 'sub'), bound$(c, 'start', 'Start'), bound$(c, 'end', 'End'), m === 'rfind' || m === 'rindex');
        if (at < 0 && (m === 'index' || m === 'rindex')) return c.fail('substring not found');
        c.emit('index', at);
        c.emit('found', at >= 0);
      });
    },
    doc: {
      summary: 'Finds where a piece of text sits in a string: find, rfind, index and rindex.',
      runtime: 'Sends the position of the first (find, index) or last (rfind, rindex) match, counting characters from 0, and whether there was a match at all. Start and End narrow down the part that’s searched, like s.find(sub, start, end). Positions count characters, so an emoji counts as one.',
      errors: ['index and rindex fail with “substring not found” when there is no match.', 'A Start or End that isn’t a whole number gives an error.'],
    },
  },

  /* ───── count ───── */
  {
    ...chip, type: 'str-count', name: 'String Counter', caption: 'String Counter', glyph: '#a', chip: (p) => q(p.sub),
    keywords: 'count occurrences how many times substring frequency',
    inputs: [IN('The string to search in.')],
    outputs: [out('out', 'Count', 'num', 'How many times the text occurs.')],
    params: [txt('sub', 'Text', 'l', `The text to count.${ESC}`, { maxLength: 100 }), START, END],
    run(c) { guard(c, () => c.emit('out', S.count(str$(c), esc$(c, 'sub'), bound$(c, 'start', 'Start'), bound$(c, 'end', 'End')))); },
    doc: {
      summary: 'Counts how many times a piece of text occurs: s.count(sub, start, end).',
      runtime: 'Counts matches that don’t overlap (“aaa” holds “aa” only once). Empty text counts the gaps between characters, which is the length plus one.',
    },
  },

  /* ───── center / ljust / rjust / zfill ───── */
  {
    ...chip, type: 'str-align', name: 'String Aligner', caption: 'String Aligner', glyph: '⇔', chip: (p) => `${p.mode}`,
    keywords: 'center ljust rjust zfill pad padding justify align width fill zeros',
    inputs: [IN()],
    outputs: [OUT('The string padded to the width.')],
    params: [
      sel('mode', 'Method', 'center', [['center', 'center: in the middle'], ['ljust', 'ljust: to the left'], ['rjust', 'rjust: to the right'], ['zfill', 'zfill: zeros in front']], 'Where the string sits inside the padding. zfill puts zeros in front, after any + or − sign.'),
      num('width', 'Width', 10, 0, 100000, 1, 'How long to pad it up to. A string that’s already this long (or longer) is left alone.', 'characters'),
      txt('fill', 'Fill character', ' ', 'The single character to pad with. zfill always uses 0.', { maxLength: 2 }),
    ],
    run(c) { guard(c, () => emitStr(c, 'out', S.align(str$(c), c.str('mode'), c.num('width'), c.str('fill')))); },
    doc: {
      summary: 'Pads a string to a width: center, ljust, rjust and zfill.',
      runtime: 'Adds Fill characters until the string is Width characters long: around it (center), after it (ljust) or before it (rjust). zfill puts zeros in front and keeps a leading + or − where it is, so “-42” becomes “-0042”.',
      errors: ['A Fill character that isn’t exactly one character gives an error (“The fill character must be exactly one character long”).'],
    },
  },

  /* ───── startswith / endswith / in ───── */
  {
    ...chip, type: 'str-match', name: 'String Matcher', caption: 'String Matcher', glyph: '⊂', chip: (p) => (p.mode === 'contains' ? 'x in s' : `${p.mode}`),
    keywords: 'startswith endswith contains in includes begins ends substring check match test',
    inputs: [IN()],
    outputs: [out('out', 'Result', 'bool', 'True when the test holds.')],
    params: [
      sel('mode', 'Test', 'startswith', [['startswith', 'startswith: begins with'], ['endswith', 'endswith: ends with'], ['contains', 'x in s: contains']], 'What to check for.'),
      txt('sub', 'Text', '', `The text to look for. Empty text is found in every string.${ESC}`, { maxLength: 100 }),
    ],
    run(c) {
      const s = str$(c), t = esc$(c, 'sub'), m = c.str('mode');
      c.emit('out', m === 'startswith' ? s.startsWith(t) : m === 'endswith' ? s.endsWith(t) : s.includes(t));
    },
    doc: {
      summary: 'Checks whether a string begins with, ends with or contains some text: startswith, endswith and the in operator.',
      runtime: 'Sends true or false. The check is case-sensitive, so if you want to ignore case, run the string through a String Caser first.',
    },
  },

  /* ───── isalpha … ───── */
  {
    ...chip, type: 'str-check', name: 'String Validator', caption: 'String Validator', glyph: '✓', chip: (p) => `${p.mode}`,
    keywords: 'isalpha isdigit isnumeric isdecimal isalnum isspace isupper islower istitle isidentifier isascii isprintable validate check kind letters digits',
    inputs: [IN()],
    outputs: [out('out', 'Result', 'bool', 'True when the string passes the test.')],
    params: [sel('mode', 'Test', 'isalpha', [
      ['isalpha', 'isalpha: only letters'], ['isdecimal', 'isdecimal: only decimal digits'], ['isdigit', 'isdigit: only digits'], ['isnumeric', 'isnumeric: only numeric characters'],
      ['isalnum', 'isalnum: only letters and numbers'], ['isspace', 'isspace: only whitespace'], ['isupper', 'isupper: all letters are capitals'], ['islower', 'islower: all letters are small'],
      ['istitle', 'istitle: Title Case'], ['isidentifier', 'isidentifier: a valid name'], ['isascii', 'isascii: only ASCII characters'], ['isprintable', 'isprintable: nothing invisible'],
    ], 'Which test to run on the string.')],
    run(c) { c.emit('out', S.TESTS[c.str('mode')](str$(c))); },
    doc: {
      summary: 'Tests what kind of characters a string holds: isalpha, isdigit, isnumeric, isalnum, isspace, isupper, islower, istitle and the rest.',
      runtime: 'Sends true or false. An empty string fails every test except isascii and isprintable. isdecimal is the strictest digit test (0–9 and the digits of other scripts), isdigit also lets in superscripts such as ², and isnumeric adds fractions and numerals such as ½ and 五.',
      examples: ['String Validator (isdigit) → Gate: let only numeric text through.'],
    },
  },

  /* ───── partition / rpartition ───── */
  {
    ...chip, type: 'str-partition', name: 'String Partitioner', caption: 'String Partitioner', glyph: 'a|b|c', chip: (p) => `${p.mode}`,
    keywords: 'partition rpartition split three parts before after separator head tail',
    inputs: [IN()],
    outputs: [out('head', 'Before', 'text', 'The part before the separator (the whole string when it isn’t found, for partition).'), out('sep', 'Separator', 'text', 'The separator itself, or an empty string when it isn’t found.'), out('tail', 'After', 'text', 'The part after the separator (the whole string when it isn’t found, for rpartition).')],
    params: [
      sel('mode', 'Method', 'partition', [['partition', 'partition: at the first match'], ['rpartition', 'rpartition: at the last match']], 'Which match of the Separator to cut at.'),
      txt('sep', 'Separator', '=', `The text to cut at. It can’t be empty.${ESC}`, { maxLength: 40 }),
    ],
    run(c) {
      guard(c, () => {
        const [a, b, d] = S.partition(str$(c), esc$(c, 'sep'), c.str('mode') === 'rpartition');
        c.emit('head', a); c.emit('sep', b); c.emit('tail', d);
      });
    },
    doc: {
      summary: 'Cuts a string in exactly three at a separator: partition and rpartition.',
      runtime: 'Finds the first (partition) or last (rpartition) Separator and sends what comes before it, the separator itself, and what comes after. With no match, partition sends the whole string as Before and nothing else, and rpartition sends the whole string as After.',
      errors: ['An empty Separator gives an error (“empty separator”).'],
      examples: ['String Partitioner (“=”) on “volume=7”: Before is “volume”, After is “7”.'],
    },
  },

  /* ───── s[a:b:c] ───── */
  {
    ...chip, type: 'str-slice', name: 'String Slicer', caption: 'String Slicer', glyph: '[:]', chip: (p) => `[${String(p.start).trim()}:${String(p.stop).trim()}${String(p.step).trim() ? ':' + String(p.step).trim() : ''}]`,
    keywords: 'slice substring substr cut part section range s[a:b] left right middle',
    inputs: [IN()],
    outputs: [OUT('The slice of the string.', 'Slice')],
    params: [
      txt('start', 'Start', '', 'Where the slice starts, counting characters from 0. A negative number counts from the end. Blank means the beginning (or the end, if Step is negative).', { maxLength: 8 }),
      txt('stop', 'Stop', '', 'Where the slice stops. The character at this position isn’t included, and a negative number counts from the end. Blank means the end (or the beginning, if Step is negative).', { maxLength: 8 }),
      txt('step', 'Step', '', 'Take every nth character. A negative step walks backwards, so −1 reverses the string. Blank means 1.', { maxLength: 8 }),
    ],
    run(c) {
      guard(c, () => emitStr(c, 'out', S.slice(str$(c), bound$(c, 'start', 'Start'), bound$(c, 'stop', 'Stop'), bound$(c, 'step', 'Step') ?? 1)));
    },
    doc: {
      summary: 'Takes a part of a string: s[start:stop:step].',
      runtime: 'Follows the usual slicing rules to the letter: a bound past either end is clamped (never an error), negative bounds count from the end, and a blank bound means “as far as it goes”. “hello” with Start 1 and Stop −1 gives “ell”.',
      errors: ['A Step of 0 gives an error (“slice step cannot be zero”).', 'A bound that isn’t a whole number gives an error.'],
    },
  },

  /* ───── s[i] ───── */
  {
    ...chip, type: 'str-index', name: 'String Indexer', caption: 'String Indexer', glyph: '[i]', chip: (p) => `[${p.index}]`,
    keywords: 'index character at nth letter get item s[i] position',
    inputs: [IN()],
    outputs: [OUT('The one character at that position.', 'Character')],
    params: [num('index', 'Index', 0, -100000, 100000, 1, 'Which character to take. 0 is the first, and a negative index counts from the end, so −1 is the last.')],
    run(c) { guard(c, () => c.emit('out', S.charAt(str$(c), c.num('index')))); },
    doc: {
      summary: 'Takes one character from a string: s[i].',
      runtime: 'Sends the character at Index (0 is the first, −1 the last). An Index outside the string makes the module fail.',
      errors: ['An Index outside the string gives an error: “string index out of range”.'],
    },
  },

  /* ───── reversed ───── */
  {
    ...chip, type: 'str-reverse', name: 'String Reverser', caption: 'String Reverser', glyph: '⇋', chip: (p) => (p.unit === 'words' ? 'reversed(words)' : '[::-1]'),
    keywords: 'reverse reversed backwards flip mirror palindrome [::-1]',
    inputs: [IN()],
    outputs: [OUT('The reversed string.')],
    params: [sel('unit', 'Reverse', 'chars', [['chars', 'characters: [::-1]'], ['words', 'words: in reverse order']], 'Characters turns the string back to front (“abc” becomes “cba”). Words leaves each word as it is and only flips their order.')],
    run(c) { emitStr(c, 'out', S.reverse(str$(c), c.str('unit'))); },
    doc: {
      summary: 'Reverses a string: s[::-1], or the words of it in reverse order.',
      runtime: 'Characters reverses whole characters, so an emoji stays an emoji. Words splits at whitespace, flips the order and joins the words back together with single spaces.',
      examples: ['String Reverser → Compare (against the original string): check for a palindrome.'],
    },
  },

  /* ───── len ───── */
  {
    ...chip, type: 'str-len', name: 'String Length', caption: 'String Length', glyph: '|s|', chip: (p) => (p.unit === 'chars' ? 'len' : `len(${p.unit})`),
    keywords: 'length len size count characters bytes words lines how long',
    inputs: [IN()],
    outputs: [out('out', 'Length', 'num', 'The length.')],
    params: [sel('unit', 'Count', 'chars', [['chars', 'characters: len(s)'], ['bytes', 'bytes: len(s.encode())'], ['words', 'words: len(s.split())'], ['lines', 'lines: len(s.splitlines())']], 'What to count. Characters is len(s), and Bytes is the size when written as UTF-8.')],
    run(c) { c.emit('out', S.lengthOf(str$(c), c.str('unit'))); },
    doc: {
      summary: 'Measures a string: len(s), and the bytes, words and lines of it.',
      runtime: 'Characters counts whole characters (an emoji is one). Bytes counts the bytes of the UTF-8 form, where “é” takes two and “五” takes three. Words and lines count the pieces that split() and splitlines() would give you.',
    },
  },

  /* ───── format ───── */
  {
    ...chip, type: 'str-format', name: 'String Formatter', caption: 'String Formatter', glyph: '{ }', chip: (p) => String(p.template),
    keywords: 'format template placeholder fstring f-string interpolate insert variables fill in printf',
    inputs: [inp('a', 'A', 'any', 'The value for {0} (or {a}).', 'top', true), inp('b', 'B', 'any', 'The value for {1} (or {b}).', 'top', true), inp('c', 'C', 'any', 'The value for {2} (or {c}).', 'top', true)],
    outputs: [OUT('The template with the values filled in.')],
    params: [txt('template', 'Template', '{}', 'The text to fill in. {} or {0} is the first value, {1} the second and {2} the third; {a}, {b} and {c} work too. A colon adds a format spec: {:>8} right-aligns in 8 characters, {:.2f} rounds to 2 decimals, {:05d} pads with zeros, {:,} groups thousands and {!r} shows quotes. {{ and }} give you real braces. Write \\n for a new line.', { multiline: true, maxLength: 500 })],
    run(c) {
      if (!['a', 'b', 'c'].some((p) => c.has(p))) return;
      guard(c, () => {
        const args = ['a', 'b', 'c'].map((name) => {
          if (!c.has(name)) return undefined;
          const v = c.get(name);
          return { name, text: toExactText(v), num: typeof v === 'number' ? v : isDec(v) ? toNumber(v) : undefined, bool: typeof v === 'boolean' };
        });
        emitStr(c, 'out', S.format(esc$(c, 'template'), args));
      });
    },
    doc: {
      summary: 'Fills values into a template, like str.format and f-strings.',
      runtime: 'Fills every {} in the Template with a connected value: {} and {0} take A, {1} takes B, {2} takes C, and {a} {b} {c} work as names for them. A colon adds a format spec ({:.2f}, {:>8}, {:05d}, {:,}, {:x}), and !r shows the value with quotes. Only numbers take number specs. A field with no connected value gives an error.',
      errors: ['A {} or {n} field that has no connected value gives an error.', 'A { or } without its partner gives an error. Write {{ and }} for literal braces.'],
      examples: ['Number → String Formatter (“{:.1f} °C”) → Projector: show a reading with one decimal.'],
    },
  },

  /* ───── maketrans / translate ───── */
  {
    ...chip, type: 'str-translate', name: 'String Translator', caption: 'String Translator', glyph: 'a↦b',
    chip: (p) => (!p.from && !p.to && !p.delete ? 'translate' : `${q(p.from)}→${q(p.to)}${p.delete ? ` −${q(p.delete)}` : ''}`),
    keywords: 'translate maketrans map characters substitute swap delete remove letters cipher rot',
    inputs: [IN()],
    outputs: [OUT('The string with every character swapped or deleted.')],
    params: [
      txt('from', 'From', '', `Characters to swap, one for one with the same position in To.${ESC}`, { maxLength: 100 }),
      txt('to', 'To', '', `The characters that take their place. It has to be as long as From.${ESC}`, { maxLength: 100 }),
      txt('delete', 'Delete', '', `Characters to delete.${ESC}`, { maxLength: 100 }),
    ],
    run(c) { guard(c, () => emitStr(c, 'out', S.translate(str$(c), esc$(c, 'from'), esc$(c, 'to'), esc$(c, 'delete')))); },
    doc: {
      summary: 'Swaps or deletes single characters in one pass: str.maketrans and translate.',
      runtime: 'Every character found in From is swapped for the character at the same position in To, and every character in Delete is removed. Unlike the String Replacer, it works on single characters, all at once: From “ab” and To “ba” swaps a and b.',
      errors: ['From and To of different lengths give an error (“the first two maketrans arguments must have equal length”).'],
    },
  },

  /* ───── ord / chr ───── */
  {
    ...chip, type: 'str-ord', name: 'String Ordinal', caption: 'String Ordinal', glyph: 'a↔1', chip: (p) => `${p.mode}`,
    keywords: 'ord chr unicode code point character number ascii convert codepoint',
    inputs: [inp('in', 'Input', 'any', 'A single character (ord), or a code point number (chr).')],
    outputs: [out('out', 'Result', 'any', 'The code point of the character (ord), or the character of the code point (chr).')],
    params: [sel('mode', 'Method', 'ord', [['ord', 'ord: character → number'], ['chr', 'chr: number → character']], 'ord turns one character into its Unicode number (“A” is 65). chr turns a number back into its character (65 is “A”).')],
    run(c) {
      guard(c, () => {
        if (c.str('mode') === 'chr') {
          const n = toNum(c.get('in'));
          if (Number.isNaN(n)) return c.fail(`“${toText(c.get('in'))}” isn’t a number, so chr() can’t turn it into a character.`);
          c.emit('out', S.chr(n));
        } else c.emit('out', S.ord(str$(c)));
      });
    },
    doc: {
      summary: 'Converts between a character and its Unicode number: ord and chr.',
      runtime: 'ord needs a text of exactly one character and sends its code point (0 to 1 114 111). chr needs a whole number in that range and sends the matching character. For example, 😀 is 128512.',
      errors: ['ord of a text that isn’t exactly one character gives an error.', 'chr of a number that isn’t a whole number from 0 to 1 114 111 gives an error.'],
    },
  },

  /* ───── repr / ascii ───── */
  {
    ...chip, type: 'str-repr', name: 'String Representer', caption: 'String Representer', glyph: "'a'", chip: (p) => `${p.mode}`,
    keywords: 'repr ascii escape quote quoted representation printable debug invisible',
    inputs: [IN()],
    outputs: [OUT('The string as it would be printed, with quotes and escapes.', 'Repr')],
    params: [sel('mode', 'Method', 'repr', [['repr', 'repr: keep readable characters'], ['ascii', 'ascii: escape all non-ASCII']], 'repr leaves every printable character as it is. ascii writes every character outside ASCII as an escape, like \\u00e9.')],
    run(c) { emitStr(c, 'out', S.repr(str$(c), c.str('mode') === 'ascii')); },
    doc: {
      summary: 'Shows a string with quotes, and line breaks and tabs written as \\n and \\t: repr and ascii.',
      runtime: 'Wraps the string in single quotes (double quotes if it holds a single quote and no double quote) and writes backslashes, line breaks, tabs and invisible characters as escapes, so hidden characters show. ascii also escapes every character that isn’t ASCII.',
    },
  },

  /* ───── expandtabs ───── */
  {
    ...chip, type: 'str-tabs', name: 'String Tab Expander', caption: 'Tab Expander', glyph: '⇥', chip: (p) => `${p.tabsize}`,
    keywords: 'expandtabs tab tabs spaces columns indent align',
    inputs: [IN()],
    outputs: [OUT('The string with tabs turned into spaces.')],
    params: [num('tabsize', 'Tab size', 8, 0, 1000, 1, 'The distance between tab stops, in characters. 0 deletes the tabs.', 'characters')],
    run(c) { guard(c, () => emitStr(c, 'out', S.expandTabs(str$(c), c.num('tabsize')))); },
    doc: {
      summary: 'Turns tabs into spaces, up to the next tab stop: expandtabs.',
      runtime: 'Every tab becomes just enough spaces to reach the next multiple of Tab size, counting from the start of the line (a line break restarts the count). That’s what keeps columns lined up.',
    },
  },
];
