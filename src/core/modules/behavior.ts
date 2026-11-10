import type { ModuleDef } from '../types';
import { clamp, hsvToRgb, isImage, makeImage, toBool, toNum, toText } from '../util';
import { isEquation, samplePlot } from '../equation';
import { bol, inp, num, out, sel, txt } from './kit';

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
    run(c) {
      const v = c.get('in'), f = c.str('format');
      if (isImage(v)) return c.view({ kind: 'image', image: v });
      if (typeof v === 'number') {
        const t = f === 'int' ? String(Math.round(v)) : f === 'fixed2' ? v.toFixed(2) : f === 'percent' ? `${(v * 100).toFixed(0)}%` : toText(v);
        return c.view({ kind: 'number', text: t });
      }
      c.view({ kind: 'text', text: toText(v) });
    },
    doc: { summary: 'The general-purpose display for numbers, text and images.', runtime: 'Chooses a layout from the value type: image, large number, or text.' },
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
      c.view({ hist: h.slice(), last: x });
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
    params: [txt('title', 'Title', 'Neural Studio', 'Notification title.', { maxLength: 80 }), txt('body', 'Body', '', 'Notification text. If empty, the triggering value is used.', { maxLength: 200 }), num('gap', 'Minimum gap', 3000, 100, 600000, 100, 'Notifications closer together than this are dropped.', 'ms')],
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
