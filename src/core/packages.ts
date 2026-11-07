// Extensible registry of "packages": the inference/feature implementations hosted by Knowledge and Imagination nuclei.
import type { Ctx, ParamDef } from './types';
import { clamp, imageStats, isImage, noteName, toNum, toText, mulberry32 } from './util';
import { num, sel, txt } from './modules/kit';

export type PackageStatus = 'available' | 'unavailable';
export interface MlPackage {
  id: string;
  name: string;
  short: string;
  host: 'knowledge' | 'imagination';
  description: string;
  /** What kind of technique this is. Honest labelling: nothing here is presented as a neural network unless it is one. */
  technique: string;
  status: PackageStatus;
  requirements: string;
  limitations: string;
  inputs: string;
  outputs: string;
  params: ParamDef[];
  run: (c: Ctx) => void;
}

const PALETTE: [string, [number, number, number]][] = [
  ['black', [10, 10, 10]], ['white', [245, 245, 245]], ['gray', [128, 128, 128]], ['red', [220, 40, 40]],
  ['orange', [240, 140, 30]], ['yellow', [245, 220, 40]], ['green', [50, 170, 70]], ['cyan', [40, 200, 210]],
  ['blue', [40, 80, 220]], ['purple', [140, 70, 200]], ['pink', [240, 130, 180]], ['brown', [120, 75, 40]],
];

const POS = 'good great love loved lovely happy joy excellent nice wonderful best amazing awesome calm bright win won success positive like fun beautiful perfect safe warm friendly'.split(' ');
const NEG = 'bad terrible hate hated awful sad angry worst horrible ugly fail failed failure negative fear afraid pain dark cold danger broken wrong poor boring dead lose lost threat panic'.split(' ');

function parseCentroids(s: string): { label: string; v: number }[] {
  return s
    .split(/[,\n]/)
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => {
      const [l, v] = p.split(':');
      return { label: (l ?? '').trim(), v: Number(v) };
    })
    .filter((c) => c.label && Number.isFinite(c.v));
}

export function parseRules(s: string) {
  const rules: { op: string; rhs: string; label: string }[] = [];
  const errors: string[] = [];
  s.split('\n').forEach((line, i) => {
    const t = line.trim();
    if (!t || t.startsWith('//')) return;
    const m = /^in\s*(>=|<=|==|!=|>|<|~)\s*(.+?)\s*=>\s*(.+)$/.exec(t);
    if (!m) errors.push(`Line ${i + 1}: expected “in > 0.5 => label”`);
    else rules.push({ op: m[1], rhs: m[2], label: m[3] });
  });
  return { rules, errors };
}

function wait(c: Ctx, what: string) {
  c.warn(`Waiting for ${what}.`);
}

export const PACKAGES: MlPackage[] = [
  {
    id: 'image-color', name: 'Dominant color (image statistics)', short: 'COLOR', host: 'knowledge', status: 'available',
    description: 'Names the colour closest to the mean colour of an image.',
    technique: 'Classical: nearest neighbour in RGB space against a 12-colour palette. Not a neural network.',
    requirements: 'An image input (Vision, Color).', limitations: 'Uses the whole-frame mean; a small bright object in a dark scene reads as dark.',
    inputs: 'image', outputs: 'label = colour name, score = 1 − distance/441',
    params: [],
    run(c) {
      const img = c.get('in');
      if (!isImage(img)) return wait(c, 'an image');
      const { rgb } = imageStats(img);
      let best = PALETTE[0], bd = Infinity;
      for (const p of PALETTE) {
        const d = Math.hypot(p[1][0] - rgb[0], p[1][1] - rgb[1], p[1][2] - rgb[2]);
        if (d < bd) { bd = d; best = p; }
      }
      c.emit('label', best[0]);
      c.emit('score', Math.round((1 - bd / 441.7) * 1000) / 1000);
    },
  },
  {
    id: 'image-scene', name: 'Scene character (image statistics)', short: 'SCENE', host: 'knowledge', status: 'available',
    description: 'Classifies an image as dark, bright, flat, busy or balanced from brightness, contrast and edge density.',
    technique: 'Rule-based thresholds on image statistics. Not a neural network.',
    requirements: 'An image input.', limitations: 'Only describes global image statistics, not objects.',
    inputs: 'image', outputs: 'label = scene character, score = confidence 0–1',
    params: [num('dark', 'Dark below', 0.18, 0, 1, 0.01, 'Mean brightness under which the scene is “dark”.'), num('bright', 'Bright above', 0.7, 0, 1, 0.01, 'Mean brightness over which the scene is “bright”.')],
    run(c) {
      const img = c.get('in');
      if (!isImage(img)) return wait(c, 'an image');
      const s = imageStats(img);
      let label = 'balanced', score = 0.5;
      if (s.mean < c.num('dark')) { label = 'dark'; score = 1 - s.mean / Math.max(0.01, c.num('dark')); }
      else if (s.mean > c.num('bright')) { label = 'bright'; score = (s.mean - c.num('bright')) / Math.max(0.01, 1 - c.num('bright')); }
      else if (s.edge > 0.25) { label = 'busy'; score = s.edge; }
      else if (s.contrast < 0.1) { label = 'flat'; score = 1 - s.contrast * 5; }
      c.emit('label', label);
      c.emit('score', Math.round(clamp(score, 0, 1) * 1000) / 1000);
    },
  },
  {
    id: 'image-mobilenet', name: 'Object recognition (MobileNet)', short: 'OBJECTS', host: 'knowledge', status: 'unavailable',
    description: 'Would label objects in an image with a pretrained convolutional network.',
    technique: 'Convolutional neural network (not bundled).',
    requirements: 'A TensorFlow.js runtime and a ≈16 MB model file. Neither is included in this offline single-file build.',
    limitations: 'Unavailable here. Selecting it produces an error; no substitute result is faked.',
    inputs: 'image', outputs: 'label, score', params: [],
    run(c) {
      c.fail('Object recognition needs a model file that is not bundled in this offline build.');
    },
  },
  {
    id: 'audio-note', name: 'Musical note from frequency', short: 'NOTES', host: 'knowledge', status: 'available',
    description: 'Converts a frequency in Hz to the nearest equal-tempered note name (A4 = 440 Hz).',
    technique: 'Signal-processing arithmetic: MIDI = 69 + 12·log₂(f/440).',
    requirements: 'A numeric frequency, e.g. Hearing → pitch.', limitations: 'Valid for 20 Hz–20 kHz. Pitch quality depends on the sensor.',
    inputs: 'num (Hz)', outputs: 'label = note name, score = 1 − |cents|/50',
    params: [],
    run(c) {
      const f = toNum(c.get('in'));
      const n = noteName(f);
      if (!n) { c.emit('label', '—'); c.emit('score', 0); return; }
      c.emit('label', n.name);
      c.emit('score', Math.round((1 - Math.abs(n.cents) / 50) * 1000) / 1000);
    },
  },
  {
    id: 'numeric-centroid', name: 'Numeric classifier (nearest centroid)', short: 'LEVELS', host: 'knowledge', status: 'available',
    description: 'Assigns a number to the closest named centroid.',
    technique: 'Nearest-centroid classification in one dimension.',
    requirements: 'A numeric input and at least one “label:value” centroid.', limitations: 'One dimension; centroids are set by hand, not learned.',
    inputs: 'num', outputs: 'label = nearest centroid, score = 1 − distance/radius',
    params: [txt('centroids', 'Centroids', 'low:0.15, mid:0.5, high:0.85', 'Comma-separated label:value pairs.'), num('radius', 'Radius', 0.5, 0.01, 1000, 0.01, 'Distance at which the score reaches 0.')],
    run(c) {
      const x = toNum(c.get('in'));
      const cs = parseCentroids(c.str('centroids'));
      if (!cs.length) return c.fail('No valid centroids. Use “label:value, …”.');
      if (Number.isNaN(x)) return c.warn('Input is not numeric.');
      let best = cs[0], bd = Infinity;
      for (const k of cs) if (Math.abs(k.v - x) < bd) { bd = Math.abs(k.v - x); best = k; }
      c.emit('label', best.label);
      c.emit('score', Math.round(clamp(1 - bd / c.num('radius'), 0, 1) * 1000) / 1000);
    },
  },
  {
    id: 'rules', name: 'Rule-based inference', short: 'RULES', host: 'knowledge', status: 'available',
    description: 'Evaluates ordered if-then rules against the input and emits the label of the first rule that matches.',
    technique: 'Production rules. Not a neural network.',
    requirements: 'One rule per line, e.g. “in > 0.7 => hot”. Operators: > < >= <= == != and ~ (text contains).', limitations: 'Single input variable named in.',
    inputs: 'num or text', outputs: 'label = matching label or default, score = 1 if a rule matched else 0',
    params: [txt('rules', 'Rules', 'in >= 0.7 => hot\nin <= 0.3 => cold', 'Ordered rules, first match wins.', { multiline: true }), txt('fallback', 'Default label', 'normal', 'Label when no rule matches.')],
    run(c) {
      const v = c.get('in');
      const { rules, errors } = parseRules(c.str('rules'));
      if (errors.length) c.warn(errors[0]);
      let hit = '', matched = false;
      for (const r of rules) {
        const n = toNum(v), rn = Number(r.rhs);
        let ok = false;
        if (r.op === '~') ok = toText(v).toLowerCase().includes(r.rhs.toLowerCase());
        else if (!Number.isNaN(n) && !Number.isNaN(rn)) ok = { '>': n > rn, '<': n < rn, '>=': n >= rn, '<=': n <= rn, '==': n === rn, '!=': n !== rn }[r.op] ?? false;
        else if (r.op === '==') ok = toText(v) === r.rhs;
        else if (r.op === '!=') ok = toText(v) !== r.rhs;
        if (ok) { hit = r.label; matched = true; break; }
      }
      c.emit('label', matched ? hit : c.str('fallback'));
      c.emit('score', matched ? 1 : 0);
    },
  },
  {
    id: 'anomaly', name: 'Anomaly detector (running z-score)', short: 'ANOMALY', host: 'knowledge', status: 'available',
    description: 'Learns the running mean and variance of a signal and flags values that deviate strongly.',
    technique: 'Online statistics (Welford’s algorithm) with a z-score threshold.',
    requirements: 'A numeric stream.', limitations: 'Assumes roughly stationary, unimodal data; needs a warm-up period.',
    inputs: 'num', outputs: 'label = learning | normal | anomaly, score = |z| / threshold, capped at 1',
    params: [num('z', 'Z threshold', 3, 0.5, 10, 0.1, 'Deviation (in standard deviations) treated as anomalous.'), num('warmup', 'Warm-up samples', 10, 2, 500, 1, 'Samples observed before judging.')],
    run(c) {
      const x = toNum(c.get('in'));
      if (Number.isNaN(x)) return c.warn('Input is not numeric.');
      const s = (c.state.anomaly ??= { n: 0, mean: 0, m2: 0 });
      const sd = s.n > 1 ? Math.sqrt(s.m2 / (s.n - 1)) : 0;
      const z = sd > 1e-9 ? Math.abs(x - s.mean) / sd : 0;
      const learning = s.n < c.num('warmup');
      const anomalous = !learning && z >= c.num('z');
      if (!anomalous) {
        s.n++;
        const d = x - s.mean;
        s.mean += d / s.n;
        s.m2 += d * (x - s.mean);
      }
      c.emit('label', learning ? 'learning' : anomalous ? 'anomaly' : 'normal');
      c.emit('score', Math.round(clamp(z / c.num('z'), 0, 1) * 1000) / 1000);
    },
  },
  {
    id: 'text-sentiment', name: 'Text sentiment (lexicon)', short: 'SENTIMENT', host: 'knowledge', status: 'available',
    description: 'Scores text as positive, negative or neutral using a small English word list with negation handling.',
    technique: 'Lexicon counting. Not a neural network.',
    requirements: 'A text input.', limitations: 'English only, ≈60 words, no sarcasm or context understanding.',
    inputs: 'text', outputs: 'label = positive | negative | neutral, score = |polarity|',
    params: [],
    run(c) {
      const words = toText(c.get('in')).toLowerCase().match(/[a-z']+/g) ?? [];
      let p = 0, n = 0, neg = false;
      for (const w of words) {
        if (w === 'not' || w === 'no' || w === "don't" || w === 'never') { neg = true; continue; }
        const isP = POS.includes(w), isN = NEG.includes(w);
        if (isP) neg ? n++ : p++;
        if (isN) neg ? p++ : n++;
        if (isP || isN) neg = false;
      }
      const pol = (p - n) / (p + n + 1);
      c.emit('label', pol > 0.15 ? 'positive' : pol < -0.15 ? 'negative' : 'neutral');
      c.emit('score', Math.round(Math.abs(pol) * 1000) / 1000);
    },
  },
  // ---- Imagination host
  {
    id: 'trend', name: 'Trend predictor (least squares)', short: 'TREND', host: 'imagination', status: 'available',
    description: 'Fits a straight line to the most recent samples of input a and extrapolates it forward.',
    technique: 'Ordinary least-squares linear regression over a sliding window.',
    requirements: 'A numeric stream on input a.', limitations: 'Linear extrapolation only; poor for periodic data.',
    inputs: 'a: num', outputs: 'out = predicted value, confidence = R² of the fit',
    params: [num('window', 'Window', 12, 3, 200, 1, 'Samples used for the fit.'), num('ahead', 'Steps ahead', 5, 1, 100, 1, 'How many samples into the future to predict.')],
    run(c) {
      const x = toNum(c.get('a'));
      if (Number.isNaN(x)) return wait(c, 'a numeric input on a');
      const buf: number[] = (c.state.trend ??= []);
      buf.push(x);
      while (buf.length > c.num('window')) buf.shift();
      if (buf.length < 3) return c.warn('Collecting samples (need 3).');
      const n = buf.length;
      const mx = (n - 1) / 2;
      const my = buf.reduce((a, b) => a + b, 0) / n;
      let sxy = 0, sxx = 0, syy = 0;
      buf.forEach((y, i) => { sxy += (i - mx) * (y - my); sxx += (i - mx) ** 2; syy += (y - my) ** 2; });
      const slope = sxy / sxx;
      const r2 = syy < 1e-12 ? 1 : (sxy * sxy) / (sxx * syy);
      c.emit('out', Math.round((my + slope * (n - 1 + c.num('ahead') - mx)) * 10000) / 10000);
      c.emit('confidence', Math.round(r2 * 1000) / 1000);
    },
  },
  {
    id: 'scorer', name: 'Weighted scorer (logistic)', short: 'SCORE', host: 'imagination', status: 'available',
    description: 'Combines inputs a, b, c with weights and squashes the sum to a 0–1 score.',
    technique: 'Logistic regression inference with hand-set weights (not trained here).',
    requirements: 'At least one numeric input.', limitations: 'Weights are configured manually.',
    inputs: 'a, b, c: num', outputs: 'out = sigmoid(Σ wᵢ·xᵢ + bias), confidence = |out − 0.5|·2',
    params: [txt('weights', 'Weights', '1, 1, 1', 'Comma-separated weights for a, b, c.'), num('bias', 'Bias', 0, -20, 20, 0.1, 'Added before the sigmoid.')],
    run(c) {
      const w = c.str('weights').split(',').map((s) => Number(s.trim()));
      let z = c.num('bias');
      ['a', 'b', 'c'].forEach((p, i) => { const v = toNum(c.get(p)); if (!Number.isNaN(v)) z += (Number.isFinite(w[i]) ? w[i] : 0) * v; });
      const o = 1 / (1 + Math.exp(-z));
      c.emit('out', Math.round(o * 10000) / 10000);
      c.emit('confidence', Math.round(Math.abs(o - 0.5) * 2 * 1000) / 1000);
    },
  },
  {
    id: 'dream', name: 'Smooth noise (generative)', short: 'DREAM', host: 'imagination', status: 'available',
    description: 'Generates a smooth, repeatable random signal between 0 and 1 using interpolated value noise.',
    technique: 'Seeded value noise. Generative, deterministic for a given seed.',
    requirements: 'None.', limitations: 'Not learned from data.',
    inputs: '—', outputs: 'out = noise 0–1, confidence = 1',
    params: [num('rate', 'Rate', 5, 0.5, 30, 0.5, 'Output samples per second.', 'Hz'), num('period', 'Lattice period', 2000, 100, 60000, 100, 'Time between random anchor points.', 'ms'), num('seed', 'Seed', 1, 0, 9999, 1, 'Random seed.')],
    run(c) {
      const seed = c.num('seed');
      const k = Math.floor(c.time / c.num('period'));
      const f = (c.time % c.num('period')) / c.num('period');
      const at = (i: number) => mulberry32(seed * 7919 + i * 104729)();
      const s = f * f * (3 - 2 * f);
      c.emit('out', Math.round((at(k) * (1 - s) + at(k + 1) * s) * 1000) / 1000);
      c.emit('confidence', 1);
      c.wake(1000 / c.num('rate'));
    },
  },
];

export const packageById = (id: string) => PACKAGES.find((p) => p.id === id);
export const packagesFor = (host: 'knowledge' | 'imagination') => PACKAGES.filter((p) => p.host === host);

export function packageParamDef(host: 'knowledge' | 'imagination'): ParamDef {
  const list = packagesFor(host);
  return sel('package', 'Package', list.find((p) => p.status === 'available')!.id, list.map((p) => [p.id, p.status === 'unavailable' ? `${p.name} — unavailable` : p.name] as [string, string]), 'Which inference package this nucleus runs. Each package documents its technique and limits.');
}
