// Pantone colors as the Color module understands them: a code or a name in, an sRGB color out, and the closest Pantone name for any color.
// Pantone's printed swatches are the reference, so every value here is the usual on-screen approximation, not a color-managed match.
import { PANTONE_NAMES } from './pantonenames';

type RGB = [number, number, number];

interface Entry {
  /** What is printed after “PANTONE”: a code, a code with its name, or a name. */
  label: string;
  /** Everything it can be looked up by (normalized, see norm()). */
  keys: string[];
  rgb: RGB;
}

const rgbOf = (hex: string): RGB => [parseInt(hex.slice(0, 2), 16), parseInt(hex.slice(2, 4), 16), parseInt(hex.slice(4, 6), 16)];

/** Lower case letters and digits only, without the words around a Pantone name (“PANTONE®”, “PMS”, “TCX”, “TPX”). */
export const norm = (s: string) =>
  s.toLowerCase().replace(/pantone|®|™|\bpms\b|\btcx\b|\btpx\b|\btpg\b|color of the year/g, ' ').replace(/[^a-z0-9]/g, '');

// Solid Coated: [code as printed, sRGB hex]. A code that is a name (“Warm Red C”) is looked up by that name.
const SOLID: [string, string][] = [
  ['Yellow C', 'FEDD00'], ['Yellow 012 C', 'FFD700'], ['Orange 021 C', 'FE5000'], ['Warm Red C', 'F9423A'], ['Red 032 C', 'EF3340'],
  ['Rubine Red C', 'CE0058'], ['Rhodamine Red C', 'E10098'], ['Purple C', 'BB29BB'], ['Violet C', '440099'], ['Blue 072 C', '10069F'],
  ['Reflex Blue C', '001489'], ['Process Blue C', '0085CA'], ['Green C', '00AB84'], ['Black C', '2D2926'], ['Black 6 C', '101820'], ['Black 7 C', '3D3935'],
  ['Cool Gray 1 C', 'D9D9D6'], ['Cool Gray 3 C', 'C8C9C7'], ['Cool Gray 5 C', 'B1B3B3'], ['Cool Gray 7 C', '97999B'], ['Cool Gray 9 C', '75787B'], ['Cool Gray 11 C', '53565A'],
  ['Warm Gray 1 C', 'D7D2CB'], ['Warm Gray 5 C', 'ACA39A'], ['Warm Gray 11 C', '6E6259'],
  ['116 C', 'FFCD00'], ['123 C', 'FFC72C'], ['130 C', 'F2A900'], ['137 C', 'FFA300'], ['151 C', 'FF8200'], ['165 C', 'FF671F'], ['1665 C', 'DC4405'],
  ['1795 C', 'D22630'], ['186 C', 'C8102E'], ['485 C', 'DA291C'], ['7416 C', 'E04E39'], ['219 C', 'DA1884'], ['226 C', 'D0006F'],
  ['2577 C', 'A05EB5'], ['266 C', '753BBD'], ['2685 C', '2E008B'], ['7421 C', '5E2750'],
  ['281 C', '00205B'], ['286 C', '0033A0'], ['287 C', '003087'], ['2728 C', '0047BB'], ['2767 C', '13294B'], ['2925 C', '009CDE'], ['2995 C', '00A3E0'],
  ['300 C', '005EB8'], ['3005 C', '0077C8'], ['320 C', '009CA6'], ['321 C', '008C95'], ['341 C', '007A53'], ['3425 C', '006747'], ['347 C', '009A44'],
  ['354 C', '00B140'], ['361 C', '43B02A'], ['871 C', '84754E'], ['872 C', '85714D'], ['873 C', '866D4B'], ['874 C', '8B6F4E'], ['877 C', '8A8D8F'],
];

// Fashion, Home + Interiors (TCX): [code, name, sRGB hex] — the Pantone Colors of the Year and a few classics.
const TCX: [string, string, string][] = [
  ['11-0601', 'Bright White', 'F4F5F0'], ['11-0602', 'Snow White', 'F2F0EB'], ['11-4201', 'Cloud Dancer', 'F0EEE9'],
  ['15-4020', 'Cerulean', '9BB7D4'], ['17-2031', 'Fuchsia Rose', 'C74375'], ['19-1664', 'True Red', 'BF1932'], ['14-4811', 'Aqua Sky', '7BC4C4'],
  ['17-1456', 'Tigerlily', 'E2583E'], ['15-5217', 'Blue Turquoise', '53B0AE'], ['13-1106', 'Sand Dollar', 'DECDBE'], ['19-1557', 'Chili Pepper', '9B1B30'],
  ['18-3943', 'Blue Iris', '5A5B9F'], ['14-0848', 'Mimosa', 'EFC050'], ['15-5519', 'Turquoise', '45B5AA'], ['18-2120', 'Honeysuckle', 'D94F70'],
  ['17-1463', 'Tangerine Tango', 'DD4124'], ['17-5641', 'Emerald', '009473'], ['18-3224', 'Radiant Orchid', 'B163A3'], ['18-1438', 'Marsala', '955251'],
  ['13-1520', 'Rose Quartz', 'F7CAC9'], ['15-3919', 'Serenity', '92A8D1'], ['15-0343', 'Greenery', '88B04B'], ['18-3838', 'Ultra Violet', '5F4B8B'],
  ['16-1546', 'Living Coral', 'FF6F61'], ['19-4052', 'Classic Blue', '0F4C81'], ['17-5104', 'Ultimate Gray', '939597'], ['13-0647', 'Illuminating', 'F5DF4D'],
  ['17-3938', 'Very Peri', '6667AB'], ['18-1750', 'Viva Magenta', 'BB2649'], ['13-1023', 'Peach Fuzz', 'FFBE98'], ['17-1230', 'Mocha Mousse', 'A47864'],
];

let table: Entry[] | null = null;
let lookup: Map<string, Entry> | null = null;
let labs: [number, number, number][] | null = null;

function build() {
  if (table) return;
  const list: Entry[] = [];
  const taken = new Set<string>();
  for (const [code, hex] of SOLID) list.push({ label: code, keys: [norm(code)], rgb: rgbOf(hex) });
  for (const [code, name, hex] of TCX) {
    list.push({ label: `${code} TCX ${name}`, keys: [norm(code), norm(name)], rgb: rgbOf(hex) });
    taken.add(norm(name));
  }
  for (const pair of PANTONE_NAMES.split(';')) {
    const i = pair.lastIndexOf(':');
    const name = pair.slice(0, i), k = norm(name);
    if (!k || taken.has(k)) continue;
    taken.add(k);
    list.push({ label: name, keys: [k], rgb: rgbOf(pair.slice(i + 1)) });
  }
  const map = new Map<string, Entry>();
  // The curated entries come first, so they win a name that two lists share.
  for (const e of list) for (const k of e.keys) if (!map.has(k)) map.set(k, e);
  table = list;
  lookup = map;
}

const text = (e: Entry) => `PANTONE ${e.label}`;

/** A Pantone code (485 C, PMS 485, 19-4052 TCX) or name (Classic Blue) as a color, with the name it was found under. Null when it is not known. */
export function pantoneToRgb(query: string): { rgb: RGB; name: string } | null {
  build();
  const k = norm(query);
  if (!k) return null;
  let e = lookup!.get(k);
  // “485” and “485 U” stand for the coated 485 C when only that one is known.
  if (!e && /[cu]$/.test(k)) e = lookup!.get(k.slice(0, -1)) ?? lookup!.get(k.slice(0, -1) + 'c');
  if (!e && /^\d+$/.test(k)) e = lookup!.get(k + 'c');
  return e ? { rgb: [...e.rgb] as RGB, name: text(e) } : null;
}

const lin = (c: number) => { const x = c / 255; return x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4; };
function lab([r, g, b]: RGB): [number, number, number] {
  const R = lin(r), G = lin(g), B = lin(b);
  const f = (t: number) => (t > 216 / 24389 ? Math.cbrt(t) : (24389 / 27 * t + 16) / 116);
  const x = f((0.4124564 * R + 0.3575761 * G + 0.1804375 * B) / 0.95047), y = f(0.2126729 * R + 0.7151522 * G + 0.072175 * B), z = f((0.0193339 * R + 0.119192 * G + 0.9503041 * B) / 1.08883);
  return [116 * y - 16, 500 * (x - y), 200 * (y - z)];
}

/** The Pantone color that looks most like this one (smallest distance in CIELAB), as “PANTONE …” text. */
export function nearestPantone(rgb: RGB): string {
  build();
  if (!labs) labs = table!.map((e) => lab(e.rgb));
  const t = lab(rgb);
  let best = 0, bd = Infinity;
  for (let i = 0; i < labs.length; i++) {
    const d = (labs[i][0] - t[0]) ** 2 + (labs[i][1] - t[1]) ** 2 + (labs[i][2] - t[2]) ** 2;
    if (d < bd) { bd = d; best = i; }
  }
  return text(table![best]);
}
