import type { ModuleDef } from '../types';
import { clamp, imageStats, makeImage } from '../util';
import { RATE, bol, inp, num, out, sel, txt } from './kit';

/** Deterministic simulated scene: a bright disc travelling over a gradient. */
export function simScene(t: number) {
  const W = 48, H = 36;
  const cx = (0.5 + 0.38 * Math.sin(t / 1800)) * W;
  const cy = (0.5 + 0.3 * Math.cos(t / 2300)) * H;
  return makeImage(W, H, (x, y) => {
    const d = Math.hypot(x - cx, y - cy);
    const disc = d < 7 ? 1 : Math.max(0, 1 - (d - 7) / 6);
    const base = 30 + (y / H) * 50;
    return [clamp(base + disc * 220, 0, 255), clamp(base + disc * 200, 0, 255), clamp(base * 1.4 + disc * 150, 0, 255)];
  });
}

const SIM_NOTES = [261.63, 293.66, 329.63, 392.0, 440.0, 392.0, 329.63, 293.66];

export const sensors: ModuleDef[] = [
  {
    type: 'vision', name: 'Vision', caption: 'Visual Sensor', category: 'Sensor', family: 'sensor', glyph: '', size: 'small',
    keywords: 'camera image sight eye',
    inputs: [],
    outputs: [out('image', 'Image', 'image', 'Latest frame, downscaled to about 64 pixels wide.'), out('luma', 'Luma', 'num', 'Mean brightness of the frame, 0–1.', 'right')],
    params: [
      sel('source', 'Source', 'sim', [['sim', 'Simulated scene'], ['camera', 'Camera (needs permission)'], ['file', 'Image file']], 'Where frames come from. Camera needs a device and permission; the simulated scene needs nothing.'),
      RATE(5),
      txt('fileData', 'Image data', '', 'Downscaled image kept inside the program when the source is a file.', { hidden: true, maxLength: 400000 }),
    ],
    source: true,
    run(c) {
      const src = c.str('source');
      if (src === 'sim') {
        const img = simScene(c.time);
        c.emit('image', img);
        c.emit('luma', Math.round(imageStats(img).mean * 1000) / 1000);
        c.wake(1000 / c.num('rate'));
        c.view({ image: img });
        return;
      }
      const img = c.injected?.image;
      if (img) {
        c.emit('image', img);
        c.emit('luma', c.injected?.luma);
        c.view({ image: img });
      } else c.warn(src === 'file' ? 'No image loaded. Choose a file in the inspector.' : 'Waiting for camera frames. Grant permission and press Run.');
    },
    doc: {
      summary: 'Produces images. Use the built-in simulated scene to test programs without hardware, switch to the camera, or load an image file.',
      runtime: 'Simulated: emits a new frame every 1/rate seconds of simulation time. Camera: frames arrive from the browser at ≈10 fps while the program runs. File: emits the loaded image once.',
      errors: ['Camera permission denied or no camera present: the node shows a warning and emits nothing.', 'Camera access requires a secure context (https or localhost); it may be blocked for file:// pages in some browsers.'],
      examples: ['Vision → Sense (brightness) → Projector shows live brightness.'],
    },
  },
  {
    type: 'hearing', name: 'Hearing', caption: 'Auditory Sensor', category: 'Sensor', family: 'sensor', glyph: '', size: 'small',
    keywords: 'microphone audio sound loudness pitch',
    inputs: [],
    outputs: [out('level', 'Level', 'num', 'Loudness (RMS), 0–1.'), out('pitch', 'Pitch', 'num', 'Dominant frequency in Hz (0 when silent).', 'right')],
    params: [
      sel('source', 'Source', 'sim', [['sim', 'Simulated melody'], ['mic', 'Microphone (needs permission)']], 'Simulated melody needs no hardware.'),
      RATE(10),
      num('gain', 'Gain', 1, 0.1, 10, 0.1, 'Multiplier applied to level.'),
    ],
    source: true,
    run(c) {
      if (c.str('source') === 'sim') {
        const t = c.time / 1000;
        const note = SIM_NOTES[Math.floor(t) % SIM_NOTES.length];
        const env = 0.5 + 0.45 * Math.sin(t * Math.PI * 2);
        c.emit('level', Math.round(clamp(env * c.num('gain'), 0, 1) * 1000) / 1000);
        c.emit('pitch', note);
        c.wake(1000 / c.num('rate'));
        return;
      }
      const inj = c.injected;
      if (inj && typeof inj.level === 'number') {
        c.emit('level', Math.round(clamp(inj.level * c.num('gain'), 0, 1) * 1000) / 1000);
        c.emit('pitch', inj.pitch ?? 0);
      } else c.warn('Waiting for microphone. Grant permission and press Run.');
    },
    doc: {
      summary: 'Measures sound. Outputs loudness and dominant pitch.',
      runtime: 'Simulated: a repeating eight-note melody with a 1 s loudness swell. Microphone: RMS level and the strongest FFT bin (≈ ±10 Hz accuracy) from the Web Audio analyser.',
      errors: ['Microphone permission denied or unavailable: warning shown, no output.', 'Nothing is recorded or stored; only level and pitch leave the sensor.'],
    },
  },
  {
    type: 'touch', name: 'Touch', caption: 'Touch Sensor', category: 'Sensor', family: 'sensor', glyph: '', size: 'square',
    keywords: 'pointer pad mouse finger',
    inputs: [],
    outputs: [out('x', 'X', 'num', 'Horizontal position on the pad, 0–1.'), out('y', 'Y', 'num', 'Vertical position on the pad, 0–1.'), out('press', 'Press', 'bool', 'True while a pointer is down on the pad.', 'right')],
    params: [],
    source: true,
    run(c) {
      const i = c.injected;
      c.emit('x', typeof i?.x === 'number' ? i.x : 0);
      c.emit('y', typeof i?.y === 'number' ? i.y : 0);
      c.emit('press', !!i?.press);
    },
    doc: {
      summary: 'A pad inside the node. Press or drag on it with mouse, pen or finger.',
      runtime: 'Emits normalized coordinates and press state whenever the pointer moves over the pad. Works on every device with a pointer.',
    },
  },
  {
    type: 'motion', name: 'Motion', caption: 'Vestibular Sensor', category: 'Sensor', family: 'sensor', glyph: '', size: 'small',
    keywords: 'gyro tilt orientation accelerometer',
    inputs: [],
    outputs: [out('x', 'X', 'num', 'Horizontal tilt or position, −1…1.'), out('y', 'Y', 'num', 'Vertical tilt or position, −1…1.', 'right')],
    params: [
      sel('source', 'Source', 'sim', [['sim', 'Simulated sway'], ['pointer', 'Pointer position'], ['device', 'Device orientation']], 'Device orientation needs a phone/tablet sensor and permission on iOS.'),
      RATE(10),
    ],
    source: true,
    run(c) {
      const s = c.str('source');
      if (s === 'sim') {
        const t = c.time / 1000;
        c.emit('x', Math.round(Math.sin(t * 0.9) * 1000) / 1000);
        c.emit('y', Math.round(Math.cos(t * 1.3) * 1000) / 1000);
        c.wake(1000 / c.num('rate'));
        return;
      }
      const i = c.injected;
      if (i && typeof i.x === 'number') {
        c.emit('x', i.x);
        c.emit('y', i.y);
      } else c.warn(s === 'device' ? 'No orientation events received yet (needs a motion sensor and permission).' : 'Move the pointer over the page.');
    },
    doc: {
      summary: 'Two-axis movement signal from a simulated sway, the pointer, or the device orientation sensor.',
      runtime: 'Values are normalized to −1…1. Device orientation maps gamma/beta (±90°).',
      errors: ['Desktop browsers have no orientation sensor: the node reports that no events arrived.'],
    },
  },
  {
    type: 'keys', name: 'Keys', caption: 'Keyboard Sensor', category: 'Sensor', family: 'sensor', glyph: '', size: 'small',
    keywords: 'keyboard typing',
    inputs: [],
    outputs: [out('key', 'Key', 'text', 'Name of the most recent key pressed.'), out('down', 'Down', 'bool', 'True while any key is held.', 'right')],
    params: [],
    source: true,
    run(c) {
      c.emit('key', String(c.injected?.key ?? ''));
      c.emit('down', !!c.injected?.down);
    },
    doc: {
      summary: 'Listens for keyboard input while the program runs.',
      runtime: 'Keys typed into text fields and inspectors are ignored. Output updates on every key event.',
    },
  },
  {
    type: 'info', name: 'Info', caption: 'Info Sensor', category: 'Sensor', family: 'sensor', glyph: '', size: 'small',
    keywords: 'text number manual input',
    inputs: [],
    outputs: [out('text', 'Text', 'text', 'The text typed in the node.'), out('number', 'Number', 'num', 'The text parsed as a number; empty if it is not numeric.', 'right')],
    params: [txt('text', 'Text', 'hello', 'Information to emit. Type directly inside the node or here.', { multiline: true })],
    source: true,
    run(c) {
      const t = c.str('text');
      c.emit('text', t);
      const n = t.trim() === '' ? NaN : Number(t);
      c.emit('number', Number.isFinite(n) ? n : undefined);
    },
    doc: {
      summary: 'Manual text and number source for offline experiments.',
      runtime: 'Emits when the text changes. “number” is only emitted if the whole text is numeric.',
    },
  },
  {
    type: 'switch', name: 'Switch', caption: 'Manual Switch', category: 'Sensor', family: 'sensor', glyph: '', size: 'small',
    keywords: 'toggle boolean button manual',
    inputs: [],
    outputs: [out('on', 'On', 'bool', 'True when the switch is on.')],
    params: [bol('on', 'On', false, 'Switch state. Click the inner pad of the node to toggle.')],
    source: true,
    run(c) {
      c.emit('on', c.bool('on'));
    },
    doc: { summary: 'A manual boolean input.', runtime: 'Emits its state at start and every time it is toggled.' },
  },
  {
    type: 'device', name: 'Device', caption: 'Somatic Sensor', category: 'Sensor', family: 'sensor', glyph: '', size: 'small',
    keywords: 'platform online network',
    inputs: [],
    outputs: [out('name', 'Name', 'text', 'Browser platform and screen size.'), out('online', 'Online', 'bool', 'Whether the browser reports a network connection.', 'right')],
    params: [txt('label', 'Fallback label', 'unknown device', 'Reported when the browser exposes no platform information.')],
    source: true,
    run(c) {
      c.emit('name', String(c.injected?.name ?? c.str('label')));
      c.emit('online', c.injected ? !!c.injected.online : true);
    },
    doc: { summary: 'Reports facts about the device running the program.', runtime: 'Read once at start, and again on online/offline events.' },
  },
];

export { inp };
