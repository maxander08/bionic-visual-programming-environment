// Python's str methods, in plain TypeScript, for the String Modifiers section. Pure data and maths, no browser objects.
// Positions and lengths count code points (like Python), so an emoji is one character, not two.

export class StrError extends Error {}

/** Longest string a String Modifier will build. */
export const MAX_LEN = 1_000_000;

const WS = '\\t\\n\\v\\f\\r\\x1c-\\x20\\x85\\xa0\\u1680\\u2000-\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000';
const WS_RE = new RegExp(`[${WS}]`);
const isWs = (ch: string) => WS_RE.test(ch);

export const cps = (s: string): string[] => Array.from(s);
export const cpLen = (s: string): number => { let n = 0; for (const _ of s) n++; return n; };
const guard = (n: number) => { if (n > MAX_LEN) throw new StrError(`The result would be longer than ${MAX_LEN.toLocaleString('en')} characters.`); };

/** Turns \n, \t, \r, \0, \\ and \xNN typed into a setting into the characters they stand for (like a Python string literal). */
export function unescape(s: string): string {
  if (!s.includes('\\')) return s;
  return s.replace(/\\(x[0-9a-fA-F]{2}|u[0-9a-fA-F]{4}|[ntr0\\'"])/g, (_m, g: string) => {
    if (g[0] === 'x' || g[0] === 'u') return String.fromCharCode(parseInt(g.slice(1), 16));
    return ({ n: '\n', t: '\t', r: '\r', '0': '\0', '\\': '\\', "'": "'", '"': '"' } as Record<string, string>)[g];
  });
}

// ---- + and * -------------------------------------------------------------------------------------------------

export function repeat(s: string, n: number): string {
  if (!Number.isInteger(n)) throw new StrError("can't multiply a string by a non-integer");
  if (n <= 0 || s === '') return '';
  guard(s.length * n);
  return s.repeat(n);
}

// ---- case ----------------------------------------------------------------------------------------------------

const isCased = (ch: string) => ch.toLowerCase() !== ch.toUpperCase() || /\p{Lt}/u.test(ch);

export function changeCase(s: string, mode: string): string {
  switch (mode) {
    case 'upper': return s.toUpperCase();
    case 'lower': return s.toLowerCase();
    case 'casefold': return s.toLowerCase().replace(/ß/g, 'ss').replace(/ς/g, 'σ').replace(/ﬁ/g, 'fi').replace(/ﬂ/g, 'fl').replace(/ŉ/g, 'ʼn');
    case 'swapcase': return cps(s).map((ch) => { const u = ch.toUpperCase(), l = ch.toLowerCase(); return ch === u && ch !== l ? l : ch === l && ch !== u ? u : ch; }).join('');
    case 'capitalize': { const a = cps(s); return a.length ? a[0].toUpperCase() + a.slice(1).join('').toLowerCase() : ''; }
    case 'title': {
      let prev = false, out = '';
      for (const ch of s) { out += prev ? ch.toLowerCase() : ch.toUpperCase(); prev = isCased(ch); }
      return out;
    }
    default: throw new StrError(`Unknown case “${mode}”.`);
  }
}

// ---- strip / remove ------------------------------------------------------------------------------------------

/** str.strip / lstrip / rstrip. Empty `chars` strips whitespace; otherwise every character listed is stripped. */
export function strip(s: string, chars: string, side: string): string {
  const a = cps(s);
  const set = chars === '' ? null : new Set(cps(chars));
  const drop = (ch: string) => (set ? set.has(ch) : isWs(ch));
  let i = 0, j = a.length;
  if (side !== 'right') while (i < j && drop(a[i])) i++;
  if (side !== 'left') while (j > i && drop(a[j - 1])) j--;
  return a.slice(i, j).join('');
}

export function removeAffix(s: string, affix: string, mode: string): string {
  if (affix === '') return s;
  if (mode === 'prefix') return s.startsWith(affix) ? s.slice(affix.length) : s;
  return s.endsWith(affix) ? s.slice(0, s.length - affix.length) : s;
}

// ---- split / join / partition --------------------------------------------------------------------------------

function splitWs(s: string, max: number, fromRight: boolean): string[] {
  const a = cps(s);
  const out: string[] = [];
  if (!fromRight) {
    let i = 0;
    while (i < a.length) {
      while (i < a.length && isWs(a[i])) i++;
      if (i >= a.length) break;
      if (max >= 0 && out.length >= max) { out.push(a.slice(i).join('')); return out; }
      let j = i;
      while (j < a.length && !isWs(a[j])) j++;
      out.push(a.slice(i, j).join(''));
      i = j;
    }
    return out;
  }
  let j = a.length;
  while (j > 0) {
    while (j > 0 && isWs(a[j - 1])) j--;
    if (j <= 0) break;
    if (max >= 0 && out.length >= max) { out.unshift(a.slice(0, j).join('')); return out; }
    let i = j;
    while (i > 0 && !isWs(a[i - 1])) i--;
    out.unshift(a.slice(i, j).join(''));
    j = i;
  }
  return out;
}

/** str.split / str.rsplit. An empty separator splits on runs of whitespace, like split() with no argument. */
export function split(s: string, sep: string, max: number, fromRight = false): string[] {
  if (sep === '') return splitWs(s, max, fromRight);
  if (max < 0) return s.split(sep);
  const out: string[] = [];
  if (!fromRight) {
    let at = 0;
    while (out.length < max) {
      const k = s.indexOf(sep, at);
      if (k < 0) break;
      out.push(s.slice(at, k));
      at = k + sep.length;
    }
    out.push(s.slice(at));
    return out;
  }
  let end = s.length;
  while (out.length < max && end >= sep.length) {
    const k = s.lastIndexOf(sep, end - sep.length);
    if (k < 0) break;
    out.unshift(s.slice(k + sep.length, end));
    end = k;
  }
  out.unshift(s.slice(0, end));
  return out;
}

/** str.splitlines: breaks at \n, \r\n, \r, \v, \f, \x1c–\x1e, \x85, \u2028 and \u2029. */
export function splitLines(s: string, keepEnds: boolean): string[] {
  const out: string[] = [];
  const re = /\r\n|[\n\r\v\f\x1c-\x1e\x85\u2028\u2029]/g;
  let at = 0, m: RegExpExecArray | null;
  while ((m = re.exec(s))) { out.push(s.slice(at, keepEnds ? m.index + m[0].length : m.index)); at = m.index + m[0].length; }
  if (at < s.length) out.push(s.slice(at));
  return out;
}

export function partition(s: string, sep: string, fromRight: boolean): [string, string, string] {
  if (sep === '') throw new StrError('empty separator');
  const k = fromRight ? s.lastIndexOf(sep) : s.indexOf(sep);
  if (k < 0) return fromRight ? ['', '', s] : [s, '', ''];
  return [s.slice(0, k), sep, s.slice(k + sep.length)];
}

// ---- replace / translate -------------------------------------------------------------------------------------

export function replace(s: string, from: string, to: string, count: number): string {
  if (count === 0) return s;
  if (from === '') {
    const a = cps(s);
    const n = count < 0 ? a.length + 1 : Math.min(count, a.length + 1);
    guard(s.length + n * to.length);
    let out = '';
    for (let i = 0; i <= a.length; i++) { if (i < n) out += to; if (i < a.length) out += a[i]; }
    return out;
  }
  if (count < 0) { const parts = s.split(from); guard(s.length + (parts.length - 1) * Math.max(0, to.length - from.length)); return parts.join(to); }
  let out = '', at = 0, done = 0;
  while (done < count) {
    const k = s.indexOf(from, at);
    if (k < 0) break;
    out += s.slice(at, k) + to;
    at = k + from.length;
    done++;
  }
  guard(out.length + s.length - at);
  return out + s.slice(at);
}

/** str.translate(str.maketrans(from, to, delete)). */
export function translate(s: string, from: string, to: string, del: string): string {
  const f = cps(from), t = cps(to);
  if (f.length !== t.length) throw new StrError(`The first two strings of maketrans must be the same length (${f.length} and ${t.length}).`);
  const map = new Map<string, string>();
  f.forEach((ch, i) => map.set(ch, t[i]));
  for (const ch of del) map.set(ch, '');
  return cps(s).map((ch) => (map.has(ch) ? map.get(ch)! : ch)).join('');
}

// ---- find / count --------------------------------------------------------------------------------------------

/** Clamp a Python-style (possibly negative, possibly missing) bound to 0…len. */
export function bound(v: number | undefined, len: number, dflt: number): number {
  if (v === undefined) return dflt;
  const n = v < 0 ? v + len : v;
  return Math.max(0, Math.min(len, n));
}

/** str.find / rfind in code points. Returns −1 when there is no match. */
export function find(s: string, sub: string, start: number | undefined, end: number | undefined, fromRight: boolean): number {
  const a = cps(s);
  const lo = bound(start, a.length, 0), hi = bound(end, a.length, a.length);
  if (lo > hi) return -1;
  const piece = a.slice(lo, hi).join('');
  const k = fromRight ? piece.lastIndexOf(sub) : piece.indexOf(sub);
  return k < 0 ? -1 : lo + cpLen(piece.slice(0, k));
}

/** str.count: non-overlapping matches. An empty substring matches between every character. */
export function count(s: string, sub: string, start: number | undefined, end: number | undefined): number {
  const a = cps(s);
  const lo = bound(start, a.length, 0), hi = bound(end, a.length, a.length);
  if (lo > hi) return 0;
  const piece = a.slice(lo, hi).join('');
  if (sub === '') return cpLen(piece) + 1;
  let n = 0, at = 0;
  for (;;) { const k = piece.indexOf(sub, at); if (k < 0) return n; n++; at = k + sub.length; }
}

// ---- justify -------------------------------------------------------------------------------------------------

export function align(s: string, mode: string, width: number, fill: string): string {
  const len = cpLen(s);
  guard(width);
  if (mode === 'zfill') {
    if (width <= len) return s;
    const a = cps(s);
    const sign = a[0] === '+' || a[0] === '-' ? a[0] : '';
    return sign + '0'.repeat(width - len) + a.slice(sign ? 1 : 0).join('');
  }
  if (cpLen(fill) !== 1) throw new StrError('The fill character must be exactly one character long.');
  if (width <= len) return s;
  const pad = width - len;
  if (mode === 'ljust') return s + fill.repeat(pad);
  if (mode === 'rjust') return fill.repeat(pad) + s;
  const left = Math.floor(pad / 2) + (pad & width & 1);
  return fill.repeat(left) + s + fill.repeat(pad - left);
}

export function expandTabs(s: string, size: number): string {
  let out = '', col = 0;
  for (const ch of s) {
    if (ch === '\t') { if (size > 0) { const n = size - (col % size); out += ' '.repeat(n); col += n; } }
    else { out += ch; col = ch === '\n' || ch === '\r' ? 0 : col + 1; }
    guard(out.length);
  }
  return out;
}

// ---- slicing / indexing --------------------------------------------------------------------------------------

/** s[start:stop:step] with Python's rules for negative and missing bounds. */
export function slice(s: string, start?: number, stop?: number, step = 1): string {
  if (step === 0) throw new StrError('slice step cannot be zero');
  const a = cps(s), n = a.length;
  const out: string[] = [];
  if (step > 0) {
    let i = start === undefined ? 0 : start < 0 ? Math.max(0, start + n) : Math.min(start, n);
    const j = stop === undefined ? n : stop < 0 ? Math.max(0, stop + n) : Math.min(stop, n);
    for (; i < j; i += step) out.push(a[i]);
  } else {
    let i = start === undefined ? n - 1 : start < 0 ? Math.max(-1, start + n) : Math.min(start, n - 1);
    const j = stop === undefined ? -1 : stop < 0 ? Math.max(-1, stop + n) : Math.min(stop, n - 1);
    for (; i > j; i += step) out.push(a[i]);
  }
  return out.join('');
}

export function charAt(s: string, index: number): string {
  const a = cps(s);
  const i = index < 0 ? index + a.length : index;
  if (!Number.isInteger(i) || i < 0 || i >= a.length) throw new StrError('string index out of range');
  return a[i];
}

export function reverse(s: string, unit: string): string {
  return unit === 'words' ? split(s, '', -1).reverse().join(' ') : cps(s).reverse().join('');
}

// ---- length --------------------------------------------------------------------------------------------------

export function lengthOf(s: string, unit: string): number {
  switch (unit) {
    case 'bytes': return new TextEncoder().encode(s).length;
    case 'words': return split(s, '', -1).length;
    case 'lines': return splitLines(s, false).length;
    default: return cpLen(s);
  }
}

// ---- is…() tests ---------------------------------------------------------------------------------------------

const DIGIT = /^[\p{Nd}\u00b2\u00b3\u00b9\u2070\u2074-\u2079\u2080-\u2089\u2460-\u2468\u2474-\u247c\u2488-\u2490\u24ea\u24f5-\u24fd\u2776-\u277e\u2780-\u2788\u278a-\u2792]+$/u;
const NUMERIC = /^[\p{N}\u3007\u4e00\u4e8c\u4e09\u56db\u4e94\u516d\u4e03\u516b\u4e5d\u5341\u767e\u5343\u4e07\u4ebf\u5146\u96f6\u842c\u5104\u5169\u58f9\u8cb3\u53c3\u8086\u4f0d\u9678\u67d2\u634c\u7396\u62fe\u4f70\u4edf]+$/u;

const isUpperCh = (ch: string) => ch === ch.toUpperCase() && ch !== ch.toLowerCase();
const isLowerCh = (ch: string) => ch === ch.toLowerCase() && ch !== ch.toUpperCase();

function isTitle(s: string): boolean {
  let cased = false, prev = false;
  for (const ch of s) {
    if (isUpperCh(ch)) { if (prev) return false; cased = true; prev = true; }
    else if (isLowerCh(ch)) { if (!prev) return false; cased = true; prev = true; }
    else prev = false;
  }
  return cased;
}

export const TESTS: Record<string, (s: string) => boolean> = {
  isalpha: (s) => /^\p{L}+$/u.test(s),
  isdecimal: (s) => /^\p{Nd}+$/u.test(s),
  isdigit: (s) => DIGIT.test(s),
  isnumeric: (s) => NUMERIC.test(s),
  isalnum: (s) => /^[\p{L}\p{N}\u3007]+$/u.test(s),
  isspace: (s) => s !== '' && cps(s).every(isWs),
  isupper: (s) => s !== s.toLowerCase() && s === s.toUpperCase(),
  islower: (s) => s !== s.toUpperCase() && s === s.toLowerCase(),
  istitle: isTitle,
  isidentifier: (s) => /^[\p{ID_Start}_][\p{ID_Continue}]*$/u.test(s),
  isascii: (s) => /^[\x00-\x7f]*$/.test(s),
  isprintable: (s) => cps(s).every((ch) => ch === ' ' || !/[\p{C}\p{Z}]/u.test(ch)),
};

// ---- repr / ascii / ord / chr --------------------------------------------------------------------------------

const hex = (n: number, w: number) => n.toString(16).padStart(w, '0');

export function repr(s: string, asciiOnly: boolean): string {
  const quote = s.includes("'") && !s.includes('"') ? '"' : "'";
  let out = '';
  for (const ch of s) {
    const code = ch.codePointAt(0)!;
    if (ch === '\\') out += '\\\\';
    else if (ch === quote) out += '\\' + quote;
    else if (ch === '\n') out += '\\n';
    else if (ch === '\r') out += '\\r';
    else if (ch === '\t') out += '\\t';
    else if (code < 0x20 || code === 0x7f) out += '\\x' + hex(code, 2);
    else if (code < 0x7f) out += ch;
    else if (asciiOnly || /[\p{C}\p{Z}]/u.test(ch)) out += code <= 0xff ? '\\x' + hex(code, 2) : code <= 0xffff ? '\\u' + hex(code, 4) : '\\U' + hex(code, 8);
    else out += ch;
  }
  return quote + out + quote;
}

export function ord(s: string): number {
  const n = cpLen(s);
  if (n !== 1) throw new StrError(`ord() expected a character, but a string of length ${n} was found.`);
  return s.codePointAt(0)!;
}

export function chr(n: number): string {
  if (!Number.isInteger(n) || n < 0 || n > 0x10ffff) throw new StrError('chr() argument not in range(0x110000).');
  if (n >= 0xd800 && n <= 0xdfff) throw new StrError('A lone surrogate can’t be written as text.');
  return String.fromCodePoint(n);
}

// ---- str.format ----------------------------------------------------------------------------------------------

/** A value handed to format(): its name ('a', 'b', 'c'), its text, and its number when it is one (text never is, as in Python). */
export interface FormatArg { name: string; text: string; num: number | undefined; bool?: boolean }

const group3 = (digits: string, sep: string) => digits.replace(/\B(?=(\d{3})+(?!\d))/g, sep);

/** Fixed-point text like Python's: JavaScript rounds an exact tie (2.25 to one place) up, Python to the even digit (2.2). */
function fixed(abs: number, p: number): string {
  const d = Math.min(100, p);
  const plain = abs.toFixed(d);
  if (d + 30 > 100 || abs >= 1e21) return plain;
  const wide = abs.toFixed(d + 30);
  if (!/^50{29}$/.test(wide.slice(wide.length - 30))) return plain;
  const cut = wide.slice(0, wide.length - 30).replace(/\.$/, '');
  return Number(cut[cut.length - 1]) % 2 === 0 ? cut : plain;
}

function formatNumber(n: number, o: { sign: string; group: string; prec: number | undefined; type: string; alt: boolean }): string {
  const abs = Math.abs(n);
  const neg = n < 0 || Object.is(n, -0);
  const t = o.type === '' ? (Number.isInteger(n) ? 'd' : 'g') : o.type;
  const exp2 = (s: string) => s.replace(/e([+-])(\d)$/, 'e$10$2');
  let body: string;
  if (!Number.isFinite(n)) body = Number.isNaN(n) ? 'nan' : 'inf';
  else switch (t) {
    case 'd': case 'n': body = BigInt(Math.trunc(abs)).toString(); break;
    case 'b': body = (o.alt ? '0b' : '') + BigInt(Math.trunc(abs)).toString(2); break;
    case 'o': body = (o.alt ? '0o' : '') + BigInt(Math.trunc(abs)).toString(8); break;
    case 'x': body = (o.alt ? '0x' : '') + BigInt(Math.trunc(abs)).toString(16); break;
    case 'X': body = (o.alt ? '0X' : '') + BigInt(Math.trunc(abs)).toString(16).toUpperCase(); break;
    case 'f': case 'F': body = fixed(abs, o.prec ?? 6); break;
    case '%': body = fixed(abs * 100, o.prec ?? 6) + '%'; break;
    case 'e': case 'E': body = exp2(abs.toExponential(Math.min(100, o.prec ?? 6))); if (t === 'E') body = body.toUpperCase(); break;
    case 'g': case 'G': {
      const p = Math.min(100, o.prec === undefined ? 6 : Math.max(1, o.prec));
      const e = abs === 0 ? 0 : Math.floor(Math.log10(abs));
      body = e < -4 || e >= p ? exp2(abs.toExponential(p - 1).replace(/\.?0+e/, 'e')) : String(Number(abs.toPrecision(p)));
      if (t === 'G') body = body.toUpperCase();
      break;
    }
    default: throw new StrError(`Unknown format code '${o.type}' for a number.`);
  }
  if (o.group && /^\d/.test(body)) { const m = /^(\d+)(.*)$/.exec(body)!; body = group3(m[1], o.group) + m[2]; }
  return (neg ? '-' : o.sign === '+' ? '+' : o.sign === ' ' ? ' ' : '') + body;
}

/** One replacement field's format spec: [[fill]align][sign][#][0][width][,|_][.precision][type]. */
function applySpec(arg: FormatArg, specText: string): string {
  if (specText === '') return arg.text;
  const m = /^(?:(.)?([<>^=]))?([+\- ])?(#)?(0)?(\d+)?([,_])?(?:\.(\d+))?([a-zA-Z%])?$/su.exec(specText);
  if (!m) throw new StrError(`Invalid format specifier “${specText}”.`);
  const [, fillRaw, alignRaw, sign = '-', alt, zero, widthText, group = '', precText, type = ''] = m;
  const width = widthText ? Number(widthText) : 0;
  const prec = precText === undefined ? undefined : Number(precText);
  guard(width);
  const isNum = arg.num !== undefined && !arg.bool;
  let body: string;
  if (type === 'c') body = chr(Math.trunc(arg.num ?? NaN));
  else if (type !== '' && type !== 's') {
    if (arg.num === undefined) throw new StrError(`Unknown format code '${type}' for the text “${arg.text}”.`);
    body = formatNumber(arg.num, { sign, group, prec, type, alt: !!alt });
  } else if (isNum) body = formatNumber(arg.num!, { sign, group, prec, type: type === 's' ? '' : type, alt: !!alt });
  else {
    body = arg.text;
    if (prec !== undefined) body = cps(body).slice(0, prec).join('');
  }
  const numeric = isNum || (type !== '' && type !== 's' && type !== 'c');
  let al = alignRaw ?? (numeric ? '>' : '<');
  let fill = fillRaw ?? ' ';
  if (zero && !alignRaw) { fill = '0'; al = numeric ? '=' : '<'; }
  const len = cpLen(body);
  if (width <= len) return body;
  const pad = width - len;
  if (al === '<') return body + fill.repeat(pad);
  if (al === '>') return fill.repeat(pad) + body;
  if (al === '^') { const l = Math.floor(pad / 2); return fill.repeat(l) + body + fill.repeat(pad - l); }
  const sg = /^[+\- ]/.test(body) ? body[0] : '';
  const pre = /^[+\- ]?(0[bBoOxX])/.exec(body)?.[1] ?? '';
  return sg + pre + fill.repeat(pad) + body.slice(sg.length + pre.length);
}

/** str.format: {} {0} {name} {0!r} {:>8.2f} and {{ }} for literal braces. `args` are the values, by position and by name. */
export function format(template: string, args: (FormatArg | undefined)[]): string {
  return render(template, args, { auto: 0, manual: false });
}

function render(template: string, args: (FormatArg | undefined)[], st: { auto: number; manual: boolean }): string {
  let out = '', i = 0;
  const need = (n: number): FormatArg => {
    const a = args[n];
    if (!a) throw new StrError(`Replacement index ${n} is out of range: connect a value to the matching input.`);
    return a;
  };
  while (i < template.length) {
    const ch = template[i];
    if (ch === '{') {
      if (template[i + 1] === '{') { out += '{'; i += 2; continue; }
      let depth = 1, j = i + 1;
      while (j < template.length && depth > 0) { if (template[j] === '{') depth++; else if (template[j] === '}') depth--; j++; }
      if (depth > 0) throw new StrError("Single '{' encountered in the format string.");
      let field = template.slice(i + 1, j - 1), spec = '', conv = '';
      const colon = field.indexOf(':');
      if (colon >= 0) { spec = field.slice(colon + 1); field = field.slice(0, colon); }
      const bang = field.indexOf('!');
      if (bang >= 0) { conv = field.slice(bang + 1); field = field.slice(0, bang); }
      let arg: FormatArg;
      if (field === '') {
        if (st.manual) throw new StrError('Cannot switch from manual field numbering to automatic field numbering.');
        arg = need(st.auto++);
      } else if (/^\d+$/.test(field)) {
        if (st.auto > 0) throw new StrError('Cannot switch from automatic field numbering to manual field numbering.');
        st.manual = true;
        arg = need(Number(field));
      } else {
        const found = args.find((a) => a?.name === field);
        if (!found) throw new StrError(`Unknown field name “${field}”: name the values a, b or c, or number them from 0.`);
        arg = found;
      }
      if (spec.includes('{')) spec = render(spec, args, st);
      if (conv === 'r' || conv === 'a') arg = { name: arg.name, text: repr(arg.text, conv === 'a'), num: undefined };
      else if (conv === 's') arg = { name: arg.name, text: arg.text, num: undefined };
      else if (conv !== '') throw new StrError(`Unknown conversion specifier ${conv}.`);
      out += applySpec(arg, spec);
      guard(out.length);
      i = j;
    } else if (ch === '}') {
      if (template[i + 1] === '}') { out += '}'; i += 2; continue; }
      throw new StrError("Single '}' encountered in the format string.");
    } else { out += ch; i++; }
  }
  return out;
}
