import type { ModuleDef } from '../types';
import { clamp, hsvToRgb, isImage, makeImage, toBool, toNum, toText } from '../util';
import { isDec, jsonText, setScale, toPlain } from '../decimal';
import * as D from '../decmath';
import { toDec } from '../decmath';
import { isEquation, samplePlot } from '../equation';
import { bol, inp, num, out, sel, txt } from './kit';
import { getFileInfo, isFileDescriptor } from '../files';

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
    params: [sel('format', 'Number format', 'auto', [['auto', 'Automatic'], ['int', 'Integer'], ['fixed2', '2 decimals'], ['percent', 'Percent (×100)']], 'How numbers are shown.')],
    run(c) { c.view(projectView(c.get('in'), c.str('format'))); },
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
    params: [num('window', 'Window', 80, 10, 400, 1, 'Samples kept in the plot (numeric signals only).'), bol('auto', 'Auto scale', true, 'Fit the plot to the data range; otherwise 0–1. Equations use the range set on the Equation node.')],
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
    ...base, type: 'color', name: 'Color', caption: 'Color Generator', glyph: 'color', size: 'square', keywords: 'hue saturation value hsv',
    inputs: [inp('h', 'H', 'num', 'Hue 0–1.', 'top', true), inp('s', 'S', 'num', 'Saturation 0–1.', 'top', true), inp('v', 'V', 'num', 'Value 0–1.', 'top', true)],
    outputs: [out('image', 'Swatch', 'image', 'A solid 8×8 image of the color.'), out('css', 'Hex', 'text', 'The color as #rrggbb.', 'right')],
    params: [num('h', 'Hue', 0.6, 0, 1, 0.01, 'Used when H is unconnected.'), num('s', 'Saturation', 1, 0, 1, 0.01, 'Used when S is unconnected.'), num('v', 'Value', 1, 0, 1, 0.01, 'Used when V is unconnected.')],
    source: true,
    run(c) {
      const g = (p: string) => (c.has(p) ? clamp(toNum(c.get(p)) || 0, 0, 1) : c.num(p));
      const [r, gg, b] = hsvToRgb(g('h'), g('s'), g('v'));
      c.emit('image', makeImage(8, 8, () => [r, gg, b]));
      const hex = '#' + [r, gg, b].map((x) => x.toString(16).padStart(2, '0')).join('');
      c.emit('css', hex);
      c.view({ hex, rgb: [r, gg, b] });
    },
    doc: { summary: 'Generates a color from hue, saturation and value.', runtime: 'HSV → RGB. Outputs a swatch image and its hex text.' },
  },
];
