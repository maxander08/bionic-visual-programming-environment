import type { ModuleDef, ParamDef, Params } from '../types';
import { clamp, hsvToRgb, isImage, makeImage, toBool, toNum, toText } from '../util';
import { isDec, jsonText, setScale, toPlain } from '../decimal';
import * as D from '../decmath';
import { toDec } from '../decmath';
import { isEquation, samplePlot } from '../equation';
import { bol, details, inp, num, out, sel, txt } from './kit';
import { requestPlace, type Place } from '../geo';
import { cityLabels } from '../worldclock';
import { getLang } from '../../i18n';
import { getFileInfo, isFileDescriptor } from '../files';
import { cmykToRgb, parseHex, rgbToCmyk, rgbToHex, type RGB } from '../colorspaces';
import { nearestPantone, pantoneToRgb } from '../pantone';

/** Longest value the Projector keeps for display. Longer values are cut (the view says so). */
export const PROJECT_MAX_CHARS = 2_000_000;

/**
 * What the Projector shows for a value. The node face, the full-size pop-up and the “view” button of the inspector all draw from this,
 * so every kind of value looks the same everywhere: numbers large, pictures drawn, a file shown by its content (text read out, a picture
 * drawn, a PDF/sound/video played in the pop-up) rather than as the little record that travels on the wire, anything else as readable text.
 */
export function projectView(v: unknown, format = 'auto'): Record<string, unknown> {
  const cut = (t: string) => (t.length > PROJECT_MAX_CHARS ? { text: t.slice(0, PROJECT_MAX_CHARS), cut: true } : { text: t, cut: false });
  if (v === undefined || v === null) return { kind: 'empty' };
  if (isImage(v)) return { kind: 'image', image: v };
  if (typeof v === 'number' || isDec(v)) {
    // Every digit is shown (Automatic); the other formats round on the exact digits, and only because you chose them.
    const d = typeof v === 'number' && !Number.isFinite(v) ? null : toDec(v);
    const t = !d ? String(v)
      : format === 'int' ? toPlain(D.round(d))
      : format === 'fixed2' ? toPlain(setScale(d, 2))
      : format === 'percent' ? `${toPlain(setScale(D.mul(d, D.fromInt(100)), 0))}%`
      : toPlain(d);
    return { kind: 'number', text: t, value: toNum(v) };
  }
  if (isFileDescriptor(v)) {
    const info = getFileInfo(v.id);
    return { kind: 'file', file: v, present: !!info, image: info?.image, ...(info?.text !== undefined ? cut(info.text) : {}), textCut: info?.textCut, info };
  }
  if (isEquation(v)) {
    const r = samplePlot(v);
    if (r.ok) return { kind: 'plot', plot: r.plot };
    return { kind: 'text', text: toText(v), error: r.error };
  }
  if (typeof v === 'string') return { kind: 'text', ...cut(v) };
  if (typeof v === 'boolean') return { kind: 'text', text: v ? 'true' : 'false', cut: false };
  let json: string;
  try { json = jsonText(v, 2); } catch { json = String(v); }
  return { kind: 'data', ...cut(json) };
}

const base = { category: 'Behavior' as const, family: 'behavior' as const };
const COLORS: [string, string][] = [['white', 'White'], ['red', 'Red'], ['green', 'Green'], ['cyan', 'Cyan'], ['yellow', 'Yellow']];

const COLOR_MODELS: [string, string][] = [['hsv', 'HSV'], ['cmyk', 'CMYK'], ['pantone', 'Pantone'], ['hex', 'Hex']];
export const colorModel = (p: Params): string => (COLOR_MODELS.some(([v]) => v === p.model) ? String(p.model) : 'hsv');
/**
 * The settings of the Color module. Every color model keeps its settings (so a value typed for one model is still there after a visit to another),
 * but only the settings of the chosen model are shown and have a setting pin: the others are hidden. `all` lists every model, for the documentation.
 */
function colorParams(p: Params, all: boolean): ParamDef[] {
  const model = colorModel(p);
  const of = (m: string, d: ParamDef): ParamDef => (all || model === m ? { ...d, pinSide: 'top' } : { ...d, hidden: true });
  const cmyk = (key: string, label: string, def: number, ink: string) => of('cmyk', num(key, label, def, 0, 100, 1, `Amount of ${ink} ink, 0–100 %. Used when the model is CMYK.`, '%'));
  return [
    { pinSide: 'left' as const, ...sel('model', 'Color model', 'hsv', COLOR_MODELS, 'How the color is written: HSV, CMYK, Pantone or Hex. Each model has its own settings.') },
    of('hsv', num('h', 'Hue', 0.6, 0, 1, 0.01, 'Used when H is unconnected.')),
    of('hsv', num('s', 'Saturation', 1, 0, 1, 0.01, 'Used when S is unconnected.')),
    of('hsv', num('v', 'Value', 1, 0, 1, 0.01, 'Used when V is unconnected.')),
    cmyk('c', 'Cyan', 100, 'cyan'), cmyk('m', 'Magenta', 60, 'magenta'), cmyk('y', 'Yellow', 0, 'yellow'), cmyk('k', 'Black', 0, 'black'),
    of('pantone', txt('pantone', 'Pantone', '300 C', 'A Pantone code such as 485 C or 19-4052 TCX, or a name such as Classic Blue. Used when the model is Pantone.', { maxLength: 60, placeholder: '485 C' })),
    of('hex', txt('hex', 'Hex', '#0066ff', 'A hex color: #rrggbb or #rgb. Used when the model is Hex.', { maxLength: 9, placeholder: '#rrggbb' })),
  ];
}

export const behaviors: ModuleDef[] = [
  {
    ...base, type: 'text', name: 'Text', caption: 'Text Display', glyph: 'text', size: 'square', keywords: 'display show string',
    inputs: [inp('in', 'Input', 'any', 'Any value; shown as text.')], outputs: [], params: [],
    run(c) { c.view({ text: toText(c.get('in')) }); },
    doc: { summary: 'Shows any incoming value as text.', runtime: 'Long text wraps inside the node and is clipped after a few lines; the inspector always shows the full value.' },
  },
  {
    ...base, type: 'image', name: 'Image', caption: 'Image Display', glyph: 'image', size: 'square', keywords: 'picture camera display',
    inputs: [inp('in', 'Image', 'image', 'An image signal.')], outputs: [], params: [],
    run(c) { const v = c.get('in'); if (!isImage(v)) return c.warn('Input is not an image.'); c.view({ image: v }); },
    doc: { summary: 'Displays an image signal.', runtime: 'Draws the most recent image, scaled to fit.', errors: ['Non-image signals raise a warning.'] },
  },
  {
    ...base, type: 'projector', name: 'Projector', caption: 'Projector', glyph: 'projector', family: 'projector', size: 'square', keywords: 'display output large show number text image',
    inputs: [inp('in', 'Input', 'any', 'Any value: numbers, text and images are drawn appropriately.')], outputs: [],
    params: [
      sel('format', 'Number format', 'auto', [['auto', 'Automatic'], ['int', 'Integer'], ['fixed2', '2 decimals'], ['percent', 'Percent (×100)']], 'How numbers are shown.'),
      num('fontSize', 'Font size', 0, 0, 200, 1, 'Size of numbers and text, in pixels, on the node and in the full-size window. 0 keeps the automatic size, which follows the length of the value.', 'px'),
    ],
    run(c) { c.view({ ...projectView(c.get('in'), c.str('format')), fontSize: c.num('fontSize') }); },
    doc: {
      summary: 'The general-purpose display for anything: numbers, text, images, equations, lists and whole files.',
      runtime: 'Chooses a layout from the value type: large number, text, picture, graph, or a file shown by its content (the words of a text, Word, web or CSV file, a picture, the first lines of a presentation). The node itself shows a short preview; the expand button in its corner opens a full-size window that shows everything: all of a long text, scrolling and selectable, a picture at full size, a PDF page by page, audio and video with player controls, a font as a live specimen you can type into with a grid of its characters, a spreadsheet as a table, an archive as a list of what is inside, and for every file a hex dump of its bytes and a Download button. The inspector has the same expand button next to every signal, so any value can be read in full.',
      errors: ['A file that is no longer in this browser (a shared program does not carry its files) shows its name and a note instead of its content.'],
      examples: ['Text file Content → Projector: read a file on the workspace, and open the window for the whole of it.', 'Files node File → Projector: view the file itself, whatever its kind: a font becomes a specimen, a workbook a table, a program a hex dump.', 'File Converter File → Projector: see what the conversion made.'],
    },
  },
  {
    ...base, type: 'meter', name: 'Meter', caption: 'Meter Display', glyph: 'meter', size: 'square', keywords: 'plot graph scope history equation function curve axes',
    inputs: [inp('in', 'Input', 'any', 'A numeric signal (plotted over time) or an Equation (graphed as y against x).')], outputs: [],
    params: [num('window', 'Window', 80, 10, 400, 1, 'Samples kept in the plot (numeric signals only).'), bol('auto', 'Auto scale', true, 'Fit the plot to the data range; otherwise 0–1. Equations use the range set on the Equation node.'), bol('showNumber', 'Show number', true, 'Show the latest value as a number at the top of the node, level with the name (numeric signals only).')],
    run(c) {
      const v = c.get('in');
      if (isEquation(v)) {
        const r = samplePlot(v);
        if (!r.ok) { c.view({}); return c.fail(r.error); }
        return c.view({ plot: r.plot });
      }
      const x = toNum(v);
      if (Number.isNaN(x)) return c.warn('Input is not numeric.');
      const h: number[] = (c.state.h ??= []);
      h.push(x);
      while (h.length > c.num('window')) h.shift();
      c.view({ hist: h.slice(), last: x, lastText: toText(v) });
    },
    doc: { summary: 'A live plot of a numeric signal, or the graph of an Equation.', runtime: 'Numeric input: records one sample each time the input changes and draws it over time. Equation input: samples every curve across the equation’s x range and draws them over dimmed gray axes through x = 0 and y = 0. Click the expand icon for a labelled full-size graph.', errors: ['An equation that cannot be parsed raises an error naming the problem.'] },
  },
  {
    ...base, type: 'audio', name: 'Audio', caption: 'Audio Speaker', glyph: 'audio', size: 'small', keywords: 'sound speaker tone oscillator play',
    inputs: [inp('freq', 'Frequency', 'num', 'Pitch in Hz.', 'top', true), inp('amp', 'Amplitude', 'num', 'Loudness 0–1 (multiplied by volume).', 'top', true)], outputs: [],
    params: [sel('wave', 'Waveform', 'sine', [['sine', 'Sine'], ['triangle', 'Triangle'], ['square', 'Square'], ['sawtooth', 'Saw']], 'Oscillator shape.'), num('freq', 'Default pitch', 440, 20, 8000, 1, 'Used when Frequency is unconnected.', 'Hz'), num('volume', 'Volume', 0.15, 0, 1, 0.01, 'Master level; kept low by default.'), bol('mute', 'Mute', false, 'Silence the output without stopping the program.')],
    run(c) {
      const f = c.has('freq') ? toNum(c.get('freq')) : c.num('freq');
      const a = c.has('amp') ? clamp(toNum(c.get('amp')), 0, 1) : 1;
      c.view({ freq: f, amp: a, wave: c.str('wave'), volume: c.num('volume'), mute: c.bool('mute') });
    },
    source: true,
    doc: { summary: 'Plays a generated tone through the device speakers.', runtime: 'A Web Audio oscillator follows Frequency and Amplitude. Browsers only allow sound after a user gesture, so press Run (or Step) first. Silent while the program is paused or stopped.', errors: ['If Web Audio is unavailable the node reports it and stays silent.'] },
  },
  {
    ...base, type: 'haptic', name: 'Haptic', caption: 'Haptic Generator', glyph: 'haptic', size: 'small', keywords: 'vibrate vibration touch feedback',
    inputs: [inp('in', 'Trigger', 'any', 'A truthy arrival vibrates the device.')], outputs: [],
    params: [num('ms', 'Duration', 40, 5, 1000, 5, 'Vibration length.', 'ms')],
    run(c) { if (c.changed('in') && toBool(c.get('in'))) { c.state.n = (c.state.n ?? 0) + 1; c.view({ n: c.state.n, ms: c.num('ms') }); } },
    doc: { summary: 'Vibrates the device when triggered.', runtime: 'Uses the Vibration API. Supported on most Android browsers; unavailable on iOS Safari and desktops, where the node reports it.', errors: ['Unsupported device: status shows “not supported”.'] },
  },
  {
    ...base, type: 'vital', name: 'Vital', caption: 'Vital Indicator', glyph: 'vital', size: 'small', keywords: 'indicator light led dot status',
    inputs: [inp('in', 'Input', 'any', 'Boolean or 0–1 level.')], outputs: [],
    params: [sel('color', 'Color', 'white', COLORS, 'Indicator color. State is also shown by fill, not color alone.')],
    run(c) { const v = c.get('in'); c.view({ level: typeof v === 'boolean' ? (v ? 1 : 0) : clamp(toNum(v) || 0, 0, 1), color: c.str('color') }); },
    doc: { summary: 'A dot indicator. Filled and large when the input is true or near 1, hollow when false.', runtime: 'Booleans map to 0/1; numbers are clamped to 0–1 and set the dot size.' },
  },
  {
    ...base, type: 'light', name: 'Light', caption: 'Light Generator', glyph: 'light', size: 'small', keywords: 'brightness beam lamp',
    inputs: [inp('in', 'Level', 'num', 'Brightness, 0–1.')], outputs: [],
    params: [sel('color', 'Color', 'white', COLORS, 'Beam color.')],
    run(c) { c.view({ level: clamp(toNum(c.get('in')) || 0, 0, 1), color: c.str('color') }); },
    doc: { summary: 'A visual output whose beam brightness follows the input.', runtime: 'Level is clamped to 0–1.' },
  },
  {
    ...base, type: 'notify', name: 'Notify', caption: 'Notification', glyph: 'notify', size: 'small', keywords: 'alert browser notification message',
    inputs: [inp('in', 'Trigger', 'any', 'A truthy arrival sends a notification.')], outputs: [],
    params: [txt('title', 'Title', 'Nicque', 'Notification title.', { maxLength: 80 }), txt('body', 'Body', '', 'Notification text. If empty, the triggering value is used.', { maxLength: 200 }), num('gap', 'Minimum gap', 3000, 100, 600000, 100, 'Notifications closer together than this are dropped.', 'ms')],
    run(c) {
      if (!(c.changed('in') && toBool(c.get('in')))) return;
      if (c.state.last !== undefined && c.time - c.state.last < c.num('gap')) return c.warn('Notification dropped (minimum gap).');
      c.state.last = c.time;
      c.state.n = (c.state.n ?? 0) + 1;
      c.view({ n: c.state.n, title: c.str('title'), body: c.str('body') || toText(c.get('in')) });
    },
    doc: { summary: 'Shows a system notification when triggered.', runtime: 'Requires notification permission, requested from the inspector button. Without permission nothing is shown and the node says so.', errors: ['Permission denied, default (not yet granted) or API unavailable: no notification is sent.'] },
  },
  {
    ...base, type: 'color', name: 'Color', caption: 'Color', glyph: 'color', size: 'small', keywords: 'hue saturation value hsv cmyk pantone hex rgb swatch palette',
    inputs: [],
    outputs: [
      out('image', 'Swatch', 'image', 'A solid 8×8 image of the color.'),
      out('c', 'Cyan', 'num', 'The cyan of the color in CMYK, 0–100 %.'),
      out('m', 'Magenta', 'num', 'The magenta of the color in CMYK, 0–100 %.'),
      out('y', 'Yellow', 'num', 'The yellow of the color in CMYK, 0–100 %.'),
      out('k', 'Black', 'num', 'The black (key) of the color in CMYK, 0–100 %.'),
      out('css', 'Hex', 'text', 'The color as #rrggbb.', 'right'),
      out('pantone', 'Pantone', 'text', 'The Pantone color: the one asked for in the Pantone model, otherwise the closest Pantone color, as text such as PANTONE 19-4052 TCX Classic Blue.', 'right'),
    ],
    params: colorParams({}, true),
    dynamicParams: (p) => colorParams(p, false),
    source: true,
    run(c) {
      const model = colorModel({ model: c.str('model') });
      let rgb: RGB;
      let cmyk: [number, number, number, number] | null = null;
      let pantone = '';
      if (model === 'cmyk') {
        cmyk = [c.num('c'), c.num('m'), c.num('y'), c.num('k')];
        rgb = cmykToRgb(...cmyk);
      } else if (model === 'pantone') {
        const q = c.str('pantone').trim();
        const hit = pantoneToRgb(q);
        if (!hit) return c.fail(`“${q}” is not a Pantone color the program knows. Try a code such as 485 C or 19-4052 TCX, or a name such as Classic Blue.`);
        rgb = hit.rgb;
        pantone = hit.name;
      } else if (model === 'hex') {
        const q = c.str('hex').trim();
        const hit = parseHex(q);
        if (!hit) return c.fail(`“${q}” is not a hex color. Write it as #rrggbb or #rgb, for example #0a7aff.`);
        rgb = hit;
      } else {
        rgb = hsvToRgb(c.num('h'), c.num('s'), c.num('v'));
      }
      const [r, gg, b] = rgb;
      const hex = rgbToHex(rgb);
      cmyk = cmyk ?? rgbToCmyk(rgb);
      pantone = pantone || nearestPantone(rgb);
      c.emit('image', makeImage(8, 8, () => [r, gg, b]));
      c.emit('css', hex);
      c.emit('pantone', pantone);
      (['c', 'm', 'y', 'k'] as const).forEach((port, i) => c.emit(port, cmyk![i]));
      c.view({ model, hex, rgb: [r, gg, b], cmyk, pantone });
    },
    doc: {
      summary: 'Generates a color from HSV, CMYK, a Pantone code or a hex code.',
      runtime: 'The Color model setting chooses how the color is written: HSV (hue, saturation, value), CMYK (cyan, magenta, yellow, black, in percent), Pantone (a code such as 485 C or 19-4052 TCX, or a name such as Classic Blue) or Hex (#rrggbb). Each model has its own setting pins, and the pins of the others are hidden. The color leaves as a swatch image, as hex text, as cyan, magenta, yellow and black numbers, and as the Pantone color it is or is closest to. Screens show CMYK and Pantone as approximations of the printed ink.',
      errors: ['A hex code that is not #rgb or #rrggbb raises an error.', 'A Pantone code or name the program does not know raises an error.'],
    },
  },
];

/** The shared run() of the Map and the Globe: look the place up (the input pin, else the Default place setting) and show it. */
function runPlace(c: Parameters<ModuleDef['run']>[0], extra: Record<string, unknown>) {
  const given = c.has('in') ? toText(c.get('in')).trim() : '';
  const query = c.has('in') ? given : c.str('place').trim();
  const r = requestPlace(query, getLang());
  const clear = () => ['lat', 'lon', 'name'].forEach((p) => c.emit(p, undefined));
  if (r.status === 'pending') { clear(); c.view({ state: 'loading', query, ...extra }); return; }
  if (r.status === 'error') { c.view({ state: 'error', query, ...extra }); return c.fail(r.message); }
  const p: Place = r.place;
  c.emit('lat', p.lat);
  c.emit('lon', p.lon);
  c.emit('name', p.label);
  c.view({ state: 'ready', query, place: p, ...extra });
}
const PLACE_SUGGEST = txt('place', 'Default place', 'Tokyo, Japan', 'The place to show when the Place pin has no signal: a city, a country, a province, a district, an address or a landmark anywhere on Earth, in English, 简体中文 or 繁體中文 (for example “Paris, France”, “Bavaria”, “Eiffel Tower” or “东京”), or coordinates such as 35.68, 139.76.', { maxLength: 200, placeholder: 'e.g. Kyoto, Texas, 1 Infinite Loop, 35.68 139.76', suggest: cityLabels });
const placePins = [
  out('lat', 'Latitude', 'num', 'Latitude of the place in degrees, north positive.', 'right'),
  out('lon', 'Longitude', 'num', 'Longitude of the place in degrees, east positive.', 'right'),
  out('name', 'Name', 'text', 'The name of the place as it was found, with its country.', 'right'),
];

export const places: ModuleDef[] = [
  {
    ...base, type: 'map', name: 'Map', caption: 'Map Display', glyph: 'map', size: 'tall', source: true, keywords: 'place location city country province street address openstreetmap osm navigate where position gps coordinates',
    inputs: [inp('in', 'Place', 'text', 'Any place on Earth: a city, a country, a province, a district, a street address or a landmark, or coordinates such as 35.68, 139.76.', 'top', true)],
    outputs: placePins,
    params: [
      PLACE_SUGGEST,
      bol('fit', 'Fit to place', true, 'Zoom so that the whole place is in view: a country shows all of it, a city its streets. Off uses the Zoom setting.'),
      num('zoom', 'Zoom', 16, 1, 19, 1, 'Used when Fit to place is off. 3 is a continent, 10 a city, 16 shows the streets and buildings, 19 is as close as the map goes.'),
      bol('marker', 'Show pin', true, 'Draw a pin on the exact spot.'),
      sel('style', 'Appearance', 'dark', [['dark', 'Dark'], ['light', 'Light map']], 'Dark matches the rest of the program; Light is the usual OpenStreetMap colouring.'),
      details('the name and the coordinates of the place'),
    ],
    run(c) { runPlace(c, {}); },
    doc: {
      summary: 'A street-level map that shows exactly where a place is.',
      runtime: 'Reads a place from the Place pin (or the Default place setting) and shows it on an OpenStreetMap map with a pin on the spot. A city, a country, a province, a district, an address or a landmark anywhere on Earth is understood, in English, Simplified or Traditional Chinese; coordinates such as 35.68, 139.76 work too. Cities and countries the program knows appear at once; everything else is looked up with OpenStreetMap Nominatim, which also brings the outline of an area, drawn on the map. The node shows the map; the expand button opens a window where it can be dragged and zoomed down to single buildings. The latitude, longitude and name leave on the right. Map tiles and lookups need an internet connection and are the only network use of this module.',
      errors: ['A place that is not found raises an error naming it.', 'Without a connection only the cities, countries and coordinates the program knows can be shown; the map itself stays blank.'],
      examples: ['Text “Eiffel Tower” → Map: see the tower on the street map.', 'Constant “Bavaria” → Map and Globe: the same place on a map and on the planet.', 'Map Latitude and Longitude → Projector: read the coordinates of a place.'],
    },
  },
  {
    ...base, type: 'globe', name: 'Globe', caption: 'Globe Display', glyph: 'globe', size: 'tall', source: true, keywords: 'earth planet world place location city country province continent sphere where position coordinates',
    inputs: [inp('in', 'Place', 'text', 'Any place on Earth: a city, a country, a province, a district, a street address or a landmark, or coordinates such as 35.68, 139.76.', 'top', true)],
    outputs: placePins,
    params: [
      PLACE_SUGGEST,
      bol('borders', 'Show borders', true, 'Draw the borders between countries, dimmer than the coastlines.'),
      bol('grid', 'Show grid', true, 'Draw the lines of latitude and longitude every 30 degrees.'),
      bol('marker', 'Show pin', true, 'Draw a marker on the exact spot, and the outline of the area when the place is one.'),
      bol('spin', 'Auto-rotate', false, 'Turn the globe slowly. Off keeps the place facing you.'),
      details('the name and the coordinates of the place'),
    ],
    run(c) { runPlace(c, {}); },
    doc: {
      summary: 'A wire-frame globe that turns to face a place and marks where it is.',
      runtime: 'Reads a place from the Place pin (or the Default place setting), turns the globe to face it and marks the spot; an area such as a country or a province is outlined. Coastlines and borders are drawn as thin white lines on black, like the rest of the Behavior modules. Cities and countries the program knows appear at once; everything else is looked up with OpenStreetMap Nominatim, which needs an internet connection. The expand button opens a window where the globe can be turned by dragging and zoomed with the wheel. The latitude, longitude and name leave on the right.',
      errors: ['A place that is not found raises an error naming it.'],
      examples: ['Text “Antarctica” → Globe: see where it is on the planet.', 'Clock City → Globe: follow the city of a clock.'],
    },
  },
];
