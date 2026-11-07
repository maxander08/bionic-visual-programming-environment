import type { ModuleDef, Params } from '../types';
import { PACKAGES, packageById, packageParamDef, packagesFor } from '../packages';
import { clamp, imageStats, isImage, lerp, toNum, toText } from '../util';
import { act, inp, num, sel, txt } from './kit';

const r3 = (x: number) => Math.round(x * 1000) / 1000;
const lowpass = (dt: number, tau: number) => (tau <= 0 ? 1 : 1 - Math.exp(-dt / tau));

function hostRun(host: 'knowledge' | 'imagination') {
  return (c: Parameters<ModuleDef['run']>[0]) => {
    const pkg = packageById(String(c.params.package)) ?? packagesFor(host)[0];
    if (pkg.host !== host) return c.fail(`Package “${pkg.name}” belongs to a different nucleus.`);
    if (pkg.status === 'unavailable') return c.fail(pkg.requirements);
    pkg.run(c);
  };
}
const hostParams = (host: 'knowledge' | 'imagination') => (p: Params) => {
  const pk = packageById(String(p.package));
  return [packageParamDef(host), ...(pk && pk.host === host ? pk.params : [])];
};

export const nuclei: ModuleDef[] = [
  {
    type: 'sense', name: 'Sense', caption: 'Sense Hub', category: 'Nucleus', family: 'sense', glyph: 'radial', size: 'square',
    keywords: 'feature extraction brightness loudness normalize',
    title: (p) => String(p.feature === 'raw' ? 'SENSE' : String(p.feature).toUpperCase()),
    inputs: [inp('in', 'Input', 'any', 'A number, boolean or image.')],
    outputs: [{ id: 'level', label: 'Level', type: 'num', side: 'bottom', doc: 'Normalized feature, 0–1.' }, { id: 'onset', label: 'Onset', type: 'bool', side: 'right', doc: 'True while level ≥ onset threshold.' }],
    params: [
      sel('feature', 'Feature', 'auto', [['auto', 'Auto-range number'], ['raw', 'Raw 0–1 × gain'], ['brightness', 'Image brightness'], ['contrast', 'Image contrast'], ['change', 'Image change']], 'What to measure. Auto-range tracks the signal’s recent minimum and maximum and rescales into 0–1.'),
      num('gain', 'Gain', 1, 0, 20, 0.1, 'Multiplier applied before clamping to 0–1.'),
      num('decay', 'Range memory', 20, 0.5, 600, 0.5, 'Auto-range time constant: how quickly old extremes are forgotten.', 's'),
      num('onset', 'Onset threshold', 0.6, 0, 1, 0.01, 'Level at which onset becomes true (0.1 hysteresis on release).'),
    ],
    delaying: true,
    run(c) {
      const v = c.get('in');
      const f = c.str('feature');
      let raw: number;
      if (isImage(v)) {
        const st = imageStats(v);
        if (f === 'contrast') raw = st.contrast;
        else if (f === 'change') {
          const l = st.mean;
          raw = c.state.prevMean === undefined ? 0 : Math.abs(l - c.state.prevMean) * 8;
          c.state.prevMean = l;
        } else raw = st.mean;
      } else {
        raw = toNum(v);
        if (Number.isNaN(raw)) return c.warn('Input is not numeric or an image.');
      }
      let level: number;
      if (f === 'auto' && !isImage(v)) {
        const s = c.state;
        const k = lowpass(c.dt, c.num('decay') * 1000);
        if (s.lo === undefined) { s.lo = raw; s.hi = raw; }
        s.lo = Math.min(raw, lerp(s.lo, raw, k));
        s.hi = Math.max(raw, lerp(s.hi, raw, k));
        level = s.hi - s.lo < 1e-9 ? 0 : (raw - s.lo) / (s.hi - s.lo);
      } else level = raw;
      level = r3(clamp(level * c.num('gain'), 0, 1));
      c.emit('level', level);
      const on = c.state.on ? level >= c.num('onset') - 0.1 : level >= c.num('onset');
      c.state.on = on;
      c.emit('onset', on);
      c.view({ level });
    },
    doc: {
      summary: 'Turns raw sensor data into a normalized 0–1 level and an onset flag.',
      runtime: 'Auto-range: level = (x − min)/(max − min) where min and max follow the signal and relax toward it with the range memory. Image features use mean luma, luma standard deviation, or frame-to-frame brightness change.',
      errors: ['Text input: the node warns that the input is not numeric.'],
      examples: ['Hearing.level → Sense (raw) → Threshold.'],
    },
  },
  {
    type: 'knowledge', name: 'Knowledge', caption: 'Knowledge Hub', category: 'Nucleus', family: 'knowledge', glyph: 'triangle', size: 'square',
    keywords: 'machine learning package classifier inference model',
    title: (p) => packageById(String(p.package))?.short ?? 'KNOWLEDGE',
    inputs: [inp('in', 'Input', 'any', 'The data the selected package analyses (image, number or text).')],
    outputs: [{ id: 'label', label: 'Label', type: 'text', side: 'bottom', doc: 'Result of the package.' }, { id: 'score', label: 'Score', type: 'num', side: 'right', doc: 'Confidence or strength, 0–1.' }],
    params: [packageParamDef('knowledge')],
    dynamicParams: hostParams('knowledge'),
    delaying: false,
    run: hostRun('knowledge'),
    doc: {
      summary: 'Hosts a classification or analysis package. Pick the package in the inspector; its technique, requirements and limits are documented there.',
      runtime: 'Runs the package whenever the input changes. Packages are honest about their technique: statistics, rules and lexicons are labelled as such, and packages that need unbundled models report unavailable.',
      errors: ['Unavailable package: the node shows an error and emits nothing.'],
    },
  },
  {
    type: 'imagination', name: 'Imagination', caption: 'Imagination Hub', category: 'Nucleus', family: 'knowledge', glyph: 'lens', size: 'square',
    keywords: 'predict forecast generate score trend noise',
    title: (p) => packageById(String(p.package))?.short ?? 'IMAGINATION',
    inputs: [inp('a', 'A', 'num', 'First numeric input.', 'top', true), inp('b', 'B', 'num', 'Second numeric input.', 'top', true), inp('c', 'C', 'num', 'Third numeric input.', 'top', true)],
    outputs: [{ id: 'out', label: 'Output', type: 'num', side: 'bottom', doc: 'Predicted, scored or generated value.' }, { id: 'confidence', label: 'Confidence', type: 'num', side: 'right', doc: 'Package-specific confidence, 0–1.' }],
    params: [packageParamDef('imagination')],
    dynamicParams: hostParams('imagination'),
    source: true,
    run: hostRun('imagination'),
    doc: {
      summary: 'Hosts prediction, scoring and generative packages that produce a number from numeric inputs (or from nothing, for generators).',
      runtime: 'Runs when any input changes; generators also schedule themselves in simulation time.',
    },
  },
  {
    type: 'attention', name: 'Attention', caption: 'Attention Hub', category: 'Nucleus', family: 'attention', glyph: 'frame', size: 'square',
    keywords: 'focus winner salience select',
    inputs: [inp('a', 'A', 'num', 'Candidate A.', 'top', true), inp('b', 'B', 'num', 'Candidate B.', 'top', true), inp('c', 'C', 'num', 'Candidate C.', 'top', true)],
    outputs: [{ id: 'focus', label: 'Focus', type: 'num', side: 'bottom', doc: 'Raw value of the attended candidate.' }, { id: 'index', label: 'Index', type: 'num', side: 'right', doc: '0, 1, 2 for A, B, C; −1 if nothing is salient.' }],
    params: [
      num('wa', 'Weight A', 1, 0, 10, 0.05, 'Bias toward input A.'), num('wb', 'Weight B', 1, 0, 10, 0.05, 'Bias toward input B.'), num('wc', 'Weight C', 1, 0, 10, 0.05, 'Bias toward input C.'),
      num('min', 'Minimum salience', 0.1, 0, 10, 0.01, 'Below this weighted salience nothing is attended.'),
      num('sticky', 'Stickiness', 0.1, 0, 5, 0.01, 'The current focus is kept unless a rival beats it by this margin.'),
    ],
    run(c) {
      const w = [c.num('wa'), c.num('wb'), c.num('wc')];
      const names = ['a', 'b', 'c'];
      const sal = names.map((n, i) => (c.has(n) ? Math.abs(toNum(c.get(n))) * (c.sig(n)?.s ?? 1) * w[i] : -1));
      let best = -1;
      sal.forEach((s, i) => { if (s >= 0 && (best < 0 || s > sal[best])) best = i; });
      const cur = c.state.cur ?? -1;
      if (cur >= 0 && best !== cur && sal[cur] >= 0 && sal[best] < sal[cur] + c.num('sticky')) best = cur;
      if (best < 0 || sal[best] < c.num('min')) best = -1;
      c.state.cur = best;
      c.emit('index', best);
      c.emit('focus', best < 0 ? 0 : toNum(c.get(names[best])));
      c.view({ index: best });
    },
    doc: {
      summary: 'Winner-take-all selection: attends to the most salient of up to three inputs.',
      runtime: 'salience = |value| × strength × weight. The highest wins; the current winner is kept unless beaten by more than the stickiness margin. Below the minimum salience nothing is attended (index −1, focus 0).',
      errors: ['No connected input: index stays −1.'],
    },
  },
  {
    type: 'fear', name: 'Fear', caption: 'Fear Center', category: 'Nucleus', family: 'fear', glyph: 'cross', size: 'square',
    keywords: 'threat alarm anxiety leaky integrator',
    inputs: [inp('threat', 'Threat', 'num', 'Perceived threat, 0–1.')],
    outputs: [{ id: 'fear', label: 'Fear', type: 'num', side: 'bottom', doc: 'Fear level, 0–1.' }, { id: 'alarm', label: 'Alarm', type: 'bool', side: 'right', doc: 'True when fear exceeds the alarm level.' }],
    params: [
      num('sensitivity', 'Sensitivity', 1, 0, 5, 0.05, 'Gain applied to threat above the floor.'), num('floor', 'Threat floor', 0.2, 0, 0.95, 0.01, 'Threat below this is ignored.'),
      num('rise', 'Rise time', 300, 10, 10000, 10, 'Time constant when fear increases.', 'ms'), num('decay', 'Decay time', 2500, 10, 60000, 10, 'Time constant when fear fades; slow decay models lingering anxiety.', 'ms'),
      num('alarm', 'Alarm level', 0.6, 0.05, 1, 0.01, 'Fear level that raises the alarm (0.1 hysteresis on release).'),
    ],
    delaying: true,
    run(c) {
      const th = clamp(toNum(c.get('threat')), 0, 1);
      const target = clamp((c.num('sensitivity') * Math.max(0, th - c.num('floor'))) / (1 - c.num('floor')), 0, 1);
      const f0 = c.state.f ?? 0;
      const f = f0 + (target - f0) * lowpass(c.dt, target > f0 ? c.num('rise') : c.num('decay'));
      c.state.f = Math.abs(f - target) < 0.002 ? target : f;
      c.emit('fear', r3(c.state.f));
      const al = c.state.al ? c.state.f >= c.num('alarm') - 0.1 : c.state.f >= c.num('alarm');
      c.state.al = al;
      c.emit('alarm', al);
      c.view({ fear: c.state.f });
      if (c.state.f !== target) c.wake(c.tickMs);
    },
    doc: {
      summary: 'A leaky integrator of threat. Fear rises quickly, fades slowly, and raises an alarm above a level.',
      runtime: 'target = clamp(sensitivity × (threat − floor)/(1 − floor)). Fear moves toward the target exponentially with the rise or decay time constant, evaluated in simulation time.',
      examples: ['Threshold → Fear → Decision to build a startle response.'],
    },
  },
  {
    type: 'memory', name: 'Memory', caption: 'Memory Unit', category: 'Nucleus', family: 'memory', glyph: 'dots', size: 'square',
    keywords: 'store recall trace remember forget buffer',
    inputs: [inp('in', 'Input', 'num', 'Value to remember.'), inp('store', 'Store', 'bool', 'Optional gate: when connected, values are stored only on its rising edge.', 'left', true), inp('clear', 'Clear', 'bool', 'Rising edge erases the memory.', 'left', true)],
    outputs: [{ id: 'recall', label: 'Recall', type: 'num', side: 'bottom', doc: 'Exponential trace of stored values.' }, { id: 'previous', label: 'Previous', type: 'any', side: 'right', doc: 'The value stored before the latest one.' }, { id: 'count', label: 'Count', type: 'num', side: 'right', doc: 'Number of values currently held.' }],
    params: [
      num('remember', 'Remember', 0.3, 0, 1, 0.01, 'How strongly each new value shifts the trace (1 = replace). Trace starts at 0.'), num('forget', 'Forget', 0, 0, 5, 0.001, 'Exponential decay of the trace per second.', '/s'),
      num('capacity', 'Capacity', 16, 1, 256, 1, 'Values kept in the recent buffer.'), act('clearNow', 'CLEAR', 'clear', 'Erase the memory now.'),
    ],
    delaying: true,
    run(c) {
      const s = c.state;
      s.trace ??= 0; s.buf ??= [];
      if (c.reason === 'command' || (c.has('clear') && c.changed('clear') && c.get('clear') === true)) {
        s.trace = 0; s.buf = []; s.prev = undefined;
      }
      if (c.reason !== 'command' && c.dt > 0 && c.num('forget') > 0) s.trace *= Math.exp((-c.num('forget') * c.dt) / 1000);
      const gated = c.has('store');
      const storing = gated ? c.changed('store') && c.get('store') === true : c.changed('in');
      const v = toNum(c.get('in'));
      if (storing && !Number.isNaN(v)) {
        s.prev = s.buf.length ? s.buf[s.buf.length - 1] : undefined;
        s.buf.push(v);
        while (s.buf.length > c.num('capacity')) s.buf.shift();
        s.trace += c.num('remember') * (v - s.trace);
      }
      if (Math.abs(s.trace) < 1e-4) s.trace = 0;
      c.emit('recall', r3(s.trace));
      c.emit('previous', s.prev);
      c.emit('count', s.buf.length);
      c.view({ count: s.buf.length, trace: s.trace });
      if (c.num('forget') > 0 && s.trace !== 0) c.wake(250);
    },
    doc: {
      summary: 'Stores values, keeps an exponential trace of them, and slowly forgets.',
      runtime: 'On each stored value: trace += remember × (value − trace). Between stores the trace decays by e^(−forget·t). Without a Store input, every change of the input is stored.',
      errors: ['Non-numeric input is ignored with a warning.'],
      examples: ['remember = 1, forget = 0 → recall equals the latest value.'],
    },
  },
  {
    type: 'emotion', name: 'Emotion', caption: 'Emotion Center', category: 'Nucleus', family: 'emotion', glyph: 'quad', size: 'tall',
    keywords: 'mood valence arousal feeling emoji',
    inputs: [inp('reward', 'Reward', 'num', 'Positive drive.', 'top', true), inp('fear', 'Fear', 'num', 'Negative drive.', 'top', true)],
    outputs: [{ id: 'mood', label: 'Mood', type: 'text', side: 'bottom', doc: 'Word or emoji for the current mood.' }, { id: 'valence', label: 'Valence', type: 'num', side: 'right', doc: '−1 unpleasant … +1 pleasant.' }, { id: 'arousal', label: 'Arousal', type: 'num', side: 'right', doc: '0 calm … 1 aroused.' }],
    params: [num('inertia', 'Inertia', 1500, 10, 60000, 10, 'Time constant of mood changes.', 'ms'), sel('style', 'Mood as', 'word', [['word', 'Word'], ['emoji', 'Emoji']], 'Format of the mood output.')],
    delaying: true,
    run(c) {
      const r = c.has('reward') ? toNum(c.get('reward')) : 0;
      const f = c.has('fear') ? toNum(c.get('fear')) : 0;
      const tv = clamp(r - f, -1, 1), ta = clamp(Math.abs(r) + f, 0, 1);
      const k = lowpass(c.dt, c.num('inertia'));
      const v = (c.state.v = lerp(c.state.v ?? 0, tv, k)), a = (c.state.a = lerp(c.state.a ?? 0, ta, k));
      const hi = a >= 0.5;
      const mood = hi ? (v >= 0.25 ? ['excited', '🤩'] : v <= -0.25 ? ['afraid', '😨'] : ['alert', '😮']) : v >= 0.25 ? ['content', '🙂'] : v <= -0.25 ? ['sad', '🙁'] : ['neutral', '😐'];
      c.emit('mood', c.str('style') === 'emoji' ? mood[1] : mood[0]);
      c.emit('valence', r3(v));
      c.emit('arousal', r3(a));
      c.view({ v, a });
      if (Math.abs(v - tv) > 0.002 || Math.abs(a - ta) > 0.002) c.wake(c.tickMs);
    },
    doc: {
      summary: 'A simple two-axis mood model driven by reward and fear. A computational sketch, not a model of human emotion.',
      runtime: 'valence → clamp(reward − fear), arousal → clamp(|reward| + fear), both smoothed by the inertia time constant. Mood word: arousal ≥ 0.5 → excited / alert / afraid, otherwise content / neutral / sad, split at valence ±0.25.',
    },
  },
  {
    type: 'reward', name: 'Reward', caption: 'Reward Center', category: 'Nucleus', family: 'emotion', glyph: 'circle', size: 'tall',
    keywords: 'prediction error reinforcement dopamine value cost',
    inputs: [inp('goal', 'Goal', 'num', 'Progress or outcome, usually 0–1.'), inp('cost', 'Cost', 'num', 'Effort or penalty.', 'top', true)],
    outputs: [{ id: 'reward', label: 'Reward', type: 'num', side: 'bottom', doc: 'gain·goal − costWeight·cost.' }, { id: 'error', label: 'Error', type: 'num', side: 'right', doc: 'Reward minus the previous expectation.' }, { id: 'expected', label: 'Expected', type: 'num', side: 'right', doc: 'Learned expectation of reward.' }],
    params: [
      num('gain', 'Gain', 1, -10, 10, 0.05, 'Scales the goal.'), num('costWeight', 'Cost weight', 0.5, 0, 10, 0.05, 'How strongly cost subtracts.'), num('learn', 'Learning rate', 0.2, 0, 1, 0.01, 'How fast expectation follows reward.'),
      num('refractory', 'Refractory', 0, 0, 60000, 10, 'After a positive reward, further positive rewards are suppressed for this long.', 'ms'), num('limit', 'Limit', 10, 0.1, 1000, 0.1, 'Reward is clamped to ±limit.'),
    ],
    delaying: true,
    run(c) {
      const s = c.state;
      let r = c.num('gain') * toNum(c.get('goal')) - c.num('costWeight') * (c.has('cost') ? toNum(c.get('cost')) : 0);
      if (Number.isNaN(r)) return c.warn('Goal or cost is not numeric.');
      r = clamp(r, -c.num('limit'), c.num('limit'));
      if (r > 0 && c.num('refractory') > 0 && s.last !== undefined && c.time - s.last < c.num('refractory')) r = 0;
      else if (r > 0) s.last = c.time;
      const exp0 = s.exp ?? 0;
      const err = r - exp0;
      s.exp = exp0 + c.num('learn') * err;
      c.emit('reward', r3(r));
      c.emit('error', r3(err));
      c.emit('expected', r3(s.exp));
      c.view({ r, exp: s.exp });
    },
    doc: {
      summary: 'Computes a reward from a goal and a cost, and learns what reward to expect.',
      runtime: 'reward = clamp(gain × goal − costWeight × cost). error = reward − expected. expected ← expected + learn × error. Positive rewards inside the refractory window are replaced by 0.',
      errors: ['Non-numeric goal: the node warns and holds its outputs.'],
      examples: ['gain 2, goal 0.5, cost 0.2, costWeight 0.5 → reward 0.9.'],
    },
  },
  {
    type: 'decision', name: 'Decision', caption: 'Decision Hub', category: 'Nucleus', family: 'knowledge', glyph: 'fork', size: 'square',
    keywords: 'choose argmax policy select option',
    inputs: [inp('a', 'A', 'num', 'Score of option A.', 'top', true), inp('b', 'B', 'num', 'Score of option B.', 'top', true), inp('c', 'C', 'num', 'Score of option C.', 'top', true)],
    outputs: [{ id: 'choice', label: 'Choice', type: 'num', side: 'bottom', doc: 'Index of the chosen option, −1 if none.' }, { id: 'label', label: 'Label', type: 'text', side: 'right', doc: 'Name of the chosen option.' }, { id: 'margin', label: 'Margin', type: 'num', side: 'right', doc: 'Lead of the winner over the runner-up.' }],
    params: [
      sel('policy', 'Policy', 'argmax', [['argmax', 'Highest score'], ['epsilon', 'Epsilon-greedy (seeded)']], 'Highest score always picks the best; epsilon-greedy explores a random option with the given probability.'),
      txt('labels', 'Labels', 'A, B, C', 'Comma-separated option names.'), num('min', 'Minimum score', 0.05, -100, 100, 0.01, 'The winner must reach this score, otherwise no choice is made.'),
      num('hysteresis', 'Hysteresis', 0.05, 0, 10, 0.01, 'The current choice is kept unless beaten by this margin.'), num('epsilon', 'Epsilon', 0.1, 0, 1, 0.01, 'Exploration probability for the epsilon-greedy policy.'),
    ],
    delaying: true,
    run(c) {
      const names = ['a', 'b', 'c'];
      const sc = names.map((n) => (c.has(n) ? toNum(c.get(n)) : -Infinity));
      let best = -1;
      sc.forEach((s, i) => { if (s > -Infinity && (best < 0 || s > sc[best])) best = i; });
      const cur = c.state.cur ?? -1;
      if (cur >= 0 && best !== cur && sc[cur] > -Infinity && sc[best] < sc[cur] + c.num('hysteresis')) best = cur;
      if (best >= 0 && c.str('policy') === 'epsilon' && c.rand() < c.num('epsilon')) {
        const live = sc.map((s, i) => (s > -Infinity ? i : -1)).filter((i) => i >= 0);
        best = live[Math.floor(c.rand() * live.length)];
      }
      if (best >= 0 && sc[best] < c.num('min')) best = -1;
      c.state.cur = best;
      const sorted = sc.filter((s) => s > -Infinity).sort((x, y) => y - x);
      const labels = c.str('labels').split(',').map((s) => s.trim());
      c.emit('choice', best);
      c.emit('label', best < 0 ? 'none' : labels[best] || names[best].toUpperCase());
      c.emit('margin', r3(sorted.length > 1 ? sorted[0] - sorted[1] : sorted[0] ?? 0));
      c.view({ best });
    },
    doc: {
      summary: 'Chooses among up to three scored options.',
      runtime: 'argmax over the connected inputs, with hysteresis to prevent flicker and a minimum score. Epsilon-greedy replaces the choice with a random connected option with probability ε, using a seeded generator so runs are repeatable.',
    },
  },
  {
    type: 'state', name: 'State', caption: 'State Machine', category: 'Nucleus', family: 'memory', glyph: 'cycle', size: 'square',
    keywords: 'finite state machine fsm transitions mode',
    inputs: [inp('event', 'Event', 'any', 'Events: true (as “on”) or any text/number (its text).'), inp('reset', 'Reset', 'bool', 'Rising edge returns to the first state.', 'left', true)],
    outputs: [{ id: 'state', label: 'State', type: 'text', side: 'bottom', doc: 'Name of the current state.' }, { id: 'index', label: 'Index', type: 'num', side: 'right', doc: 'Position of the state in the list.' }],
    params: [
      txt('states', 'States', 'idle, active, done', 'Comma-separated state names. The first is the initial state.'),
      txt('transitions', 'Transitions', 'idle>active\nactive>done\ndone>idle', 'One per line: “from>to” (any event) or “from:event>to”. “*” matches any state. First match wins.', { multiline: true }),
    ],
    delaying: true,
    source: true,
    run(c) {
      const states = c.str('states').split(',').map((s) => s.trim()).filter(Boolean);
      if (!states.length) return c.fail('Define at least one state.');
      const s = c.state;
      if (s.cur === undefined || !states.includes(s.cur)) s.cur = states[0];
      if (c.has('reset') && c.changed('reset') && c.get('reset') === true) s.cur = states[0];
      else if (c.has('event') && c.changed('event')) {
        const raw = c.get('event');
        if (raw !== false && raw !== undefined && raw !== null) {
          const ev = raw === true ? 'on' : toText(raw);
          for (const line of c.str('transitions').split('\n')) {
            const m = /^\s*([^:>\s]+)\s*(?::\s*([^>]+?))?\s*>\s*(\S+)\s*$/.exec(line);
            if (!m) continue;
            const [, from, need, to] = m;
            if ((from === '*' || from === s.cur) && (!need || need === ev)) {
              if (states.includes(to)) s.cur = to;
              else c.warn(`Transition targets unknown state “${to}”.`);
              break;
            }
          }
        }
      }
      c.emit('state', s.cur);
      c.emit('index', states.indexOf(s.cur));
      c.view({ state: s.cur });
    },
    doc: {
      summary: 'A finite-state machine driven by events.',
      runtime: 'On each incoming event, the first transition whose source matches the current state (and whose event matches, if given) is taken. Reset returns to the first state. A true boolean counts as the event “on”; false is not an event.',
      errors: ['Unknown state names in transitions raise a warning; the machine stays put.'],
      examples: ['Pulse → State with idle>active, active>done advances once per pulse.'],
    },
  },
];

export const nucleiPackageCount = PACKAGES.length;
