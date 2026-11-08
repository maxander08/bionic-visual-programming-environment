import type { ModuleDef } from '../types';
import { clamp, fmtNum, toBool, toNum, toText } from '../util';
import { FUNCTION_NAMES, compileExpr, splitEquations, type EquationData } from '../equation';
import { bol, inp, num, out, sel, txt } from './kit';

const r4 = (x: number) => Math.round(x * 10000) / 10000;
const k = (dt: number, tau: number) => (tau <= 0 ? 1 : 1 - Math.exp(-dt / tau));
const n = (v: unknown) => toNum(v);

function parseList(s: string): unknown[] {
  return s.split(',').map((t) => t.trim()).filter((t) => t !== '').map((t) => (t === 'true' ? true : t === 'false' ? false : Number.isFinite(Number(t)) ? Number(t) : t));
}

const OUT_ANY = out('out', 'Output', 'any', 'Result.');
const IN_ANY = (doc = 'Incoming signal.') => inp('in', 'Input', 'any', doc);

const chipBase = { category: 'Node' as const, family: 'node' as const, size: 'chip' as const };

export const nodes: ModuleDef[] = [
  {
    ...chipBase, type: 'constant', name: 'Constant', caption: 'Constant', glyph: 'C', chip: (p) => String(p.value),
    inputs: [], outputs: [OUT_ANY], source: true,
    params: [sel('kind', 'Kind', 'number', [['number', 'Number'], ['text', 'Text'], ['bool', 'Boolean']], 'Type of the emitted value.'), txt('value', 'Value', '1', 'The value to emit.')],
    run(c) {
      const v = c.str('value'), kd = c.str('kind');
      if (kd === 'number') { const x = Number(v); if (!Number.isFinite(x)) return c.fail(`“${v}” is not a number.`); c.emit('out', x); }
      else if (kd === 'bool') c.emit('out', v === 'true' || v === '1' || v === 'on');
      else c.emit('out', v);
    },
    doc: { summary: 'Emits a fixed value.', runtime: 'Emits when the program starts and whenever the value is edited.', errors: ['Kind “number” with non-numeric text raises an error.'] },
  },
  {
    ...chipBase, type: 'random', name: 'Random', caption: 'Random', glyph: 'R', chip: (p) => `${fmtNum(Number(p.min))}…${fmtNum(Number(p.max))}`,
    inputs: [], outputs: [OUT_ANY], source: true, delaying: true,
    params: [num('min', 'Minimum', 0, -1e6, 1e6, 0.1, 'Lower bound.'), num('max', 'Maximum', 1, -1e6, 1e6, 0.1, 'Upper bound.'), num('rate', 'Rate', 2, 0.1, 30, 0.1, 'Values per second.', 'Hz'), num('seed', 'Seed', 1, 0, 99999, 1, 'Seed of the repeatable generator.'), bol('integer', 'Integers', false, 'Round to whole numbers.')],
    run(c) {
      const lo = c.num('min'), hi = c.num('max');
      let v = lo + c.rand() * (hi - lo);
      if (c.bool('integer')) v = Math.round(v);
      c.emit('out', r4(v));
      c.wake(1000 / c.num('rate'));
    },
    doc: { summary: 'A seeded pseudo-random number source.', runtime: 'Draws uniformly between min and max every 1/rate seconds of simulation time. The same seed always yields the same sequence after Stop → Run.' },
  },
  {
    ...chipBase, type: 'pulse', name: 'Pulse', caption: 'Pulse', glyph: '⏸', chip: (p) => `${fmtNum(Number(p.period))} ms`,
    inputs: [], outputs: [out('out', 'Pulse', 'bool', 'True for the pulse width, then false.'), out('count', 'Count', 'num', 'Pulses emitted so far.', 'right')], source: true, delaying: true,
    params: [num('period', 'Period', 1000, 20, 600000, 10, 'Time between pulse starts.', 'ms'), num('width', 'Width', 100, 1, 600000, 10, 'How long the pulse stays true (capped below the period).', 'ms'), num('offset', 'Offset', 0, 0, 600000, 10, 'Time of the first pulse.', 'ms'), num('max', 'Max pulses', 0, 0, 100000, 1, '0 means unlimited.')],
    run(c) {
      const s = c.state, period = c.num('period'), width = Math.min(c.num('width'), period - 1);
      if (s.next === undefined) { s.next = c.num('offset'); s.high = false; s.count = 0; c.emit('out', false); c.emit('count', 0); }
      if (s.high && c.time >= s.fall) { s.high = false; c.emit('out', false); }
      if (!s.high && c.time >= s.next && (c.num('max') === 0 || s.count < c.num('max'))) {
        s.high = true; s.count++; s.fall = Math.max(s.next + width, c.time + c.tickMs); s.next += period;
        c.emit('count', s.count); c.emit('out', true);
      }
      const target = s.high ? s.fall : c.num('max') === 0 || s.count < c.num('max') ? s.next : undefined;
      if (target !== undefined) c.wake(Math.max(1, target - c.time));
    },
    doc: { summary: 'A clock. Emits true pulses at a fixed period.', runtime: 'Pulse k starts at offset + k × period and lasts width ms, but never less than one simulation tick so that downstream modules can see it. Timing is resolved at the tick.' },
  },
  {
    ...chipBase, type: 'add', name: 'Adder', caption: 'Adder', glyph: '+', chip: (p) => fmtNum(Number(p.offset)),
    inputs: [inp('a', 'A', 'num', 'First addend.'), inp('b', 'B', 'num', 'Second addend; 0 when not connected.', 'left', true)], outputs: [out('out', 'Sum', 'num', 'a + b + offset.')],
    params: [num('offset', 'Offset', 0, -1e6, 1e6, 0.1, 'Constant added to the sum.')],
    run(c) { c.emit('out', r4(n(c.get('a')) + (c.has('b') ? n(c.get('b')) : 0) + c.num('offset'))); },
    doc: { summary: 'Adds numbers.', runtime: 'out = a + b + offset. Missing b counts as 0; a missing a keeps the node idle.' },
  },
  {
    ...chipBase, type: 'mul', name: 'Multiplier', caption: 'Multiplier', glyph: '×', chip: (p) => fmtNum(Number(p.factor), 2),
    inputs: [inp('a', 'A', 'num', 'Value to scale.'), inp('b', 'B', 'num', 'Replaces the factor when connected.', 'left', true)], outputs: [out('out', 'Product', 'num', 'a × (b or factor).')],
    params: [num('factor', 'Factor', 1, -1e6, 1e6, 0.1, 'Used when b is not connected.')],
    run(c) { c.emit('out', r4(n(c.get('a')) * (c.has('b') ? n(c.get('b')) : c.num('factor')))); },
    doc: { summary: 'Multiplies a signal.', runtime: 'out = a × b, or a × factor when b is not connected.' },
  },
  {
    ...chipBase, type: 'invert', name: 'Inverter', caption: 'Inverter', glyph: '−', chip: (p) => String(p.mode),
    inputs: [IN_ANY('Number or boolean.')], outputs: [OUT_ANY],
    params: [sel('mode', 'Mode', 'negate', [['negate', 'Negate (−x)'], ['complement', 'Complement (1 − x)']], 'Numeric inversion. Booleans are always logically inverted.')],
    run(c) {
      const v = c.get('in');
      if (typeof v === 'boolean') return c.emit('out', !v);
      const x = n(v);
      if (Number.isNaN(x)) return c.warn('Input is not numeric.');
      c.emit('out', r4(c.str('mode') === 'negate' ? -x : 1 - x));
    },
    doc: { summary: 'Inverts a number or boolean.', runtime: 'Boolean → NOT. Number → −x or 1 − x depending on mode.' },
  },
  {
    ...chipBase, type: 'math', name: 'Math', caption: 'Math', glyph: 'M', chip: (p) => String(p.fn),
    inputs: [inp('a', 'A', 'num', 'Operand.'), inp('b', 'B', 'num', 'Second operand for min, max, pow, mod.', 'left', true)], outputs: [out('out', 'Result', 'num', 'Function result.')],
    params: [sel('fn', 'Function', 'abs', ['abs', 'sqrt', 'square', 'sin', 'cos', 'tanh', 'exp', 'log', 'floor', 'round', 'ceil', 'min', 'max', 'pow', 'mod'].map((x) => [x, x] as [string, string]), 'Function applied to a (and b).')],
    run(c) {
      const a = n(c.get('a')), b = c.has('b') ? n(c.get('b')) : 0;
      const f: Record<string, number> = { abs: Math.abs(a), sqrt: Math.sqrt(a), square: a * a, sin: Math.sin(a), cos: Math.cos(a), tanh: Math.tanh(a), exp: Math.exp(a), log: Math.log(a), floor: Math.floor(a), round: Math.round(a), ceil: Math.ceil(a), min: Math.min(a, b), max: Math.max(a, b), pow: Math.pow(a, b), mod: ((a % b) + b) % b };
      const r = f[c.str('fn')];
      if (!Number.isFinite(r)) return c.fail(`${c.str('fn')}(${fmtNum(a)}) is not a finite number.`);
      c.emit('out', r4(r));
    },
    doc: { summary: 'Applies a mathematical function.', runtime: 'Evaluates the selected function on a (and b).', errors: ['Results that are not finite (e.g. sqrt of a negative) raise an error and emit nothing.'] },
  },
  {
    ...chipBase, type: 'register', name: 'Register', caption: 'Register', glyph: '○', chip: () => 'HOLD', delaying: true,
    inputs: [IN_ANY('Value to latch.'), inp('store', 'Store', 'bool', 'Rising edge latches the input. When not connected, every change is latched.', 'left', true)], outputs: [OUT_ANY],
    params: [],
    run(c) {
      if (c.has('store') ? c.changed('store') && c.get('store') === true : c.changed('in')) { c.state.v = c.get('in'); c.state.has = true; }
      if (c.state.has) c.emit('out', c.state.v, c.strength, true);
    },
    doc: { summary: 'Sample-and-hold. Keeps a value until told to latch a new one.', runtime: 'On the rising edge of Store, copies the input to the output. Between triggers the output holds. Counts as state for feedback loops.' },
  },
  {
    ...chipBase, type: 'relay', name: 'Gate', caption: 'Relay', glyph: '╤', chip: (p) => (p.invert ? 'BLOCK' : 'OPEN?'), 
    inputs: [IN_ANY('Signal to pass.'), inp('open', 'Open', 'bool', 'Gate control. When not connected the gate uses its default.', 'left', true)], outputs: [OUT_ANY],
    params: [bol('openDefault', 'Open by default', true, 'Used when Open is not connected.'), bol('invert', 'Invert control', false, 'When on, the gate passes while Open is false.')],
    run(c) {
      let open = c.has('open') ? toBool(c.get('open')) : c.bool('openDefault');
      if (c.bool('invert')) open = !open;
      if (open) c.emit('out', c.get('in'), c.strength, true);
    },
    doc: { summary: 'Passes a signal only while the gate is open.', runtime: 'When open, input changes are forwarded. When closed nothing is emitted and the output keeps its last value. Opening the gate forwards the current input.' },
  },
  {
    ...chipBase, type: 'inductor', name: 'Smooth', caption: 'Inductor', glyph: 'Ω', chip: (p) => `${fmtNum(Number(p.tau))} ms`, delaying: true,
    inputs: [inp('in', 'Input', 'num', 'Target value.')], outputs: [out('out', 'Output', 'num', 'Low-pass filtered value.')],
    params: [num('tau', 'Time constant', 500, 1, 600000, 10, 'Time to cover about 63% of the distance to the input.', 'ms')],
    run(c) {
      const s = c.state, target = n(c.get('in'));
      s.y ??= 0;
      s.y += (target - s.y) * k(c.dt, c.num('tau'));
      if (Math.abs(target - s.y) < 1e-3) s.y = target;
      c.emit('out', r4(s.y));
      if (s.y !== target) c.wake(c.tickMs);
    },
    doc: { summary: 'Smooths a signal with a first-order low-pass filter.', runtime: 'y ← y + (x − y)(1 − e^(−Δt/τ)) in simulation time. Starts at 0 and settles on the input.' },
  },
  {
    ...chipBase, type: 'threshold', name: 'Threshold', caption: 'Filter', glyph: '>', chip: (p) => `${p.mode === 'below' ? '<' : '>'} ${fmtNum(Number(p.threshold))}`, delaying: false,
    inputs: [inp('in', 'Input', 'num', 'Value to compare.')], outputs: [out('over', 'Over', 'bool', 'True when the condition holds.'), out('delta', 'Delta', 'num', 'Input minus threshold.', 'right')],
    params: [num('threshold', 'Threshold', 0.5, -1e6, 1e6, 0.01, 'Comparison level.'), num('hysteresis', 'Hysteresis', 0, 0, 1e6, 0.01, 'Once true, the input must pass the threshold by this much to turn false.'), sel('mode', 'Condition', 'above', [['above', 'Input ≥ threshold'], ['below', 'Input ≤ threshold']], 'Direction of the comparison.')],
    run(c) {
      const x = n(c.get('in')), t = c.num('threshold'), h = c.num('hysteresis');
      if (Number.isNaN(x)) return c.warn('Input is not numeric.');
      const d = c.str('mode') === 'below' ? t - x : x - t;
      c.state.on = c.state.on ? d >= -h : d >= 0;
      c.emit('over', c.state.on);
      c.emit('delta', r4(x - t));
    },
    doc: { summary: 'Compares a value with a threshold, with optional hysteresis.', runtime: 'above: true when x ≥ threshold, stays true until x < threshold − hysteresis. below mirrors it. Also reports x − threshold.', examples: ['threshold 0.5, hysteresis 0.1: 0.55 → true, 0.45 → true, 0.39 → false.'] },
  },
  {
    ...chipBase, type: 'compare', name: 'Compare', caption: 'Comparator', glyph: '=', chip: (p) => String(p.op),
    inputs: [inp('a', 'A', 'any', 'Left operand.'), inp('b', 'B', 'any', 'Right operand; uses the fallback when not connected.', 'left', true)], outputs: [out('out', 'Result', 'bool', 'True when the relation holds.')],
    params: [sel('op', 'Relation', '>', ['==', '!=', '>', '<', '>=', '<='].map((x) => [x, x] as [string, string]), 'Relation between a and b.'), txt('fallback', 'Fallback b', '0', 'Right operand when b is unconnected.'), num('tolerance', 'Tolerance', 0, 0, 1e6, 0.001, 'Equality slack for numbers.')],
    run(c) {
      const a = c.get('a'), b = c.has('b') ? c.get('b') : c.str('fallback');
      const na = n(a), nb = n(b), op = c.str('op'), tol = c.num('tolerance');
      let r: boolean;
      if (!Number.isNaN(na) && !Number.isNaN(nb)) r = ({ '==': Math.abs(na - nb) <= tol, '!=': Math.abs(na - nb) > tol, '>': na > nb, '<': na < nb, '>=': na >= nb, '<=': na <= nb } as Record<string, boolean>)[op];
      else { const x = toText(a), y = toText(b); r = ({ '==': x === y, '!=': x !== y, '>': x > y, '<': x < y, '>=': x >= y, '<=': x <= y } as Record<string, boolean>)[op]; }
      c.emit('out', r);
    },
    doc: { summary: 'Compares two values.', runtime: 'Numbers compare numerically (equality within tolerance). Otherwise values compare as text.' },
  },
  {
    ...chipBase, type: 'combine', name: 'Combine', caption: 'Combiner', glyph: '⊕', chip: (p) => String(p.mode),
    inputs: [inp('a', 'A', 'any', 'Input A.', 'top', true), inp('b', 'B', 'any', 'Input B.', 'top', true), inp('c', 'C', 'any', 'Input C.', 'top', true)], outputs: [OUT_ANY],
    params: [sel('mode', 'Mode', 'sum', [['sum', 'Sum'], ['mean', 'Mean'], ['max', 'Max'], ['min', 'Min'], ['product', 'Product'], ['join', 'Join as text'], ['list', 'List']], 'How present inputs merge.'), txt('sep', 'Separator', ' ', 'Used by Join.')],
    run(c) {
      const vals = ['a', 'b', 'c'].filter((p) => c.has(p)).map((p) => c.get(p));
      if (!vals.length) return;
      const m = c.str('mode');
      if (m === 'join') return c.emit('out', vals.map(toText).join(c.str('sep')));
      if (m === 'list') return c.emit('out', vals);
      const x = vals.map(n);
      if (x.some(Number.isNaN)) return c.warn('A numeric mode received a non-numeric input.');
      const r = m === 'sum' ? x.reduce((p, q) => p + q, 0) : m === 'mean' ? x.reduce((p, q) => p + q, 0) / x.length : m === 'max' ? Math.max(...x) : m === 'min' ? Math.min(...x) : x.reduce((p, q) => p * q, 1);
      c.emit('out', r4(r));
    },
    doc: { summary: 'Merges up to three inputs.', runtime: 'Only connected inputs that have a signal take part. Numeric modes reject non-numeric values with a warning.' },
  },
  {
    ...chipBase, type: 'delay', name: 'Delay', caption: 'Delay', glyph: '⧖', chip: (p) => `${fmtNum(Number(p.ms))} ms`, delaying: true,
    inputs: [IN_ANY('Signal to delay.')], outputs: [OUT_ANY],
    params: [num('ms', 'Delay', 500, 0, 600000, 10, 'How long each value is delayed, in simulation time.', 'ms'), sel('mode', 'Mode', 'shift', [['shift', 'Shift every value'], ['settle', 'Settle (emit after quiet)']], 'Shift keeps every value in order. Settle forgets intermediate values and emits only after the input has been quiet for the delay.')],
    run(c) {
      const s = c.state;
      if (c.reason === 'input' || c.changed('in')) {
        if (c.str('mode') === 'shift') {
          if (c.num('ms') <= 0) c.emit('out', c.get('in'), c.strength, true);
          else c.emitLater('out', c.get('in'), c.num('ms'), c.strength);
        } else { s.pending = { v: c.get('in'), at: c.time + c.num('ms'), s: c.strength }; c.wake(c.num('ms')); }
      }
      if (s.pending && c.time >= s.pending.at) { c.emit('out', s.pending.v, s.pending.s, true); s.pending = undefined; }
    },
    doc: { summary: 'Delays a signal by a fixed time. Legal in feedback loops.', runtime: 'Shift: every input value re-appears exactly “delay” ms later, in order. Settle: only the latest value is emitted once the input stays unchanged for “delay” ms.', errors: ['A delay of 0 passes values through immediately.'] },
  },
  {
    ...chipBase, type: 'counter', name: 'Counter', caption: 'Counter', glyph: '#', chip: (p) => `+${fmtNum(Number(p.step))}`, delaying: true, source: true,
    inputs: [inp('inc', 'Increment', 'any', 'Each arriving truthy value adds one step.', 'top', true), inp('dec', 'Decrement', 'any', 'Each arriving truthy value subtracts one step.', 'left', true), inp('reset', 'Reset', 'bool', 'Rising edge returns to the start value.', 'left', true)], outputs: [out('out', 'Count', 'num', 'Current count.')],
    params: [num('start', 'Start', 0, -1e9, 1e9, 1, 'Initial and reset value.'), num('step', 'Step', 1, -1e6, 1e6, 1, 'Amount added per event.'), num('min', 'Minimum', 0, -1e9, 1e9, 1, 'Lower limit.'), num('max', 'Maximum', 100, -1e9, 1e9, 1, 'Upper limit.'), bol('wrap', 'Wrap around', false, 'Wrap to the opposite limit instead of saturating.')],
    run(c) {
      const s = c.state;
      s.v ??= c.num('start');
      const ev = (p: string) => c.has(p) && c.changed(p) && toBool(c.get(p));
      if (ev('reset')) s.v = c.num('start');
      if (ev('inc')) s.v += c.num('step');
      if (ev('dec')) s.v -= c.num('step');
      const lo = c.num('min'), hi = c.num('max');
      if (s.v > hi) s.v = c.bool('wrap') ? lo : hi;
      if (s.v < lo) s.v = c.bool('wrap') ? hi : lo;
      c.emit('out', s.v);
    },
    doc: { summary: 'Counts events.', runtime: 'Inc/Dec events are arrivals of a truthy value, so a pulse train counts once per pulse. The count is clamped to [min, max] or wraps.' },
  },
  {
    ...chipBase, type: 'sequence', name: 'Sequence', caption: 'Sequencer', glyph: 'SEQ', chip: (p) => `${parseList(String(p.values)).length} steps`, delaying: true, source: true,
    inputs: [inp('next', 'Next', 'any', 'Each arriving truthy value advances one step.', 'top', true), inp('reset', 'Reset', 'bool', 'Rising edge returns to step 1.', 'left', true)], outputs: [OUT_ANY, out('index', 'Index', 'num', 'Current step number, from 0.', 'right')],
    params: [txt('values', 'Values', '1, 2, 3', 'Comma-separated values. Numbers and true/false are parsed; everything else is text.'), bol('loop', 'Loop', true, 'Return to the start after the last step; otherwise stop on the last.'), num('auto', 'Auto advance', 0, 0, 600000, 10, 'If above 0, advance by itself at this interval.', 'ms')],
    run(c) {
      const s = c.state, vals = parseList(c.str('values'));
      if (!vals.length) return c.fail('Define at least one value.');
      s.i ??= 0;
      const ev = (p: string) => c.has(p) && c.changed(p) && toBool(c.get(p));
      if (ev('reset')) { s.i = 0; s.t = c.time; }
      let adv = ev('next');
      if (c.num('auto') > 0) { s.t ??= c.time; if (c.time - s.t >= c.num('auto') && c.dt > 0) { adv = true; s.t = c.time; } c.wake(c.num('auto') - (c.time - s.t)); }
      if (adv) s.i = s.i + 1 >= vals.length ? (c.bool('loop') ? 0 : vals.length - 1) : s.i + 1;
      s.i = Math.min(s.i, vals.length - 1);
      c.emit('out', vals[s.i], 1, adv);
      c.emit('index', s.i);
    },
    doc: { summary: 'Steps through a list of values.', runtime: 'Emits the first value on start; each Next event (or auto-advance interval) moves to the following value.' },
  },
  {
    ...chipBase, type: 'branch', name: 'Branch', caption: 'Conditional', glyph: '◑', chip: () => 'IF', 
    inputs: [IN_ANY('Value to route.'), inp('cond', 'Condition', 'bool', 'Chooses the route.', 'left')], outputs: [out('then', 'Then', 'any', 'Receives the value while the condition is true.'), out('else', 'Else', 'any', 'Receives the value while the condition is false.', 'right')],
    params: [],
    run(c) {
      const port = toBool(c.get('cond')) ? 'then' : 'else';
      c.emit(port, c.get('in'), c.strength, true);
    },
    doc: { summary: 'Routes a value to one of two outputs.', runtime: 'The input is forwarded to Then when the condition is true, otherwise to Else. The other output keeps its previous value. Both inputs are required.' },
  },
  // ---- neural processing
  {
    ...chipBase, type: 'plastic', name: 'Plastic Nerve', caption: 'Plastic Nerve', glyph: '⇄', chip: (p) => `${fmtNum(Number(p.inMin))}…${fmtNum(Number(p.inMax))} → ${fmtNum(Number(p.outMin))}…${fmtNum(Number(p.outMax))}`,
    inputs: [inp('in', 'Input', 'num', 'Value to remap.')], outputs: [out('out', 'Output', 'num', 'Remapped value.')],
    params: [num('inMin', 'Input min', 0, -1e6, 1e6, 0.1, 'Bottom of the input range.'), num('inMax', 'Input max', 1, -1e6, 1e6, 0.1, 'Top of the input range.'), num('outMin', 'Output min', 0, -1e6, 1e6, 0.1, 'Value produced at input min.'), num('outMax', 'Output max', 100, -1e6, 1e6, 0.1, 'Value produced at input max.'), sel('curve', 'Curve', 'linear', [['linear', 'Linear'], ['ease-in', 'Ease in (t²)'], ['ease-out', 'Ease out'], ['smooth', 'Smoothstep']], 'Shape of the mapping.'), bol('clamp', 'Clamp', true, 'Keep the output inside the output range.')],
    run(c) {
      const x = n(c.get('in')), a = c.num('inMin'), b = c.num('inMax');
      if (a === b) return c.fail('Input min and max must differ.');
      let t = (x - a) / (b - a);
      if (c.bool('clamp')) t = clamp(t, 0, 1);
      const cv = c.str('curve');
      const u = cv === 'ease-in' ? t * t : cv === 'ease-out' ? 1 - (1 - t) * (1 - t) : cv === 'smooth' ? t * t * (3 - 2 * t) : t;
      c.emit('out', r4(c.num('outMin') + u * (c.num('outMax') - c.num('outMin'))));
    },
    doc: { summary: 'Remaps values from one range to another, optionally along a curve.', runtime: 't = (x − inMin)/(inMax − inMin), optionally clamped; out = outMin + curve(t) × (outMax − outMin). Ranges may be inverted.', errors: ['Input min equal to input max is an error.'], examples: ['0…1 → 0…100: 0.25 → 25.'] },
  },
  {
    ...chipBase, type: 'hyponerve', name: 'Hyponerve', caption: 'Hyponerve', glyph: 'Δ', chip: (p) => String(p.rule), 
    inputs: [IN_ANY('Signal to watch.')], outputs: [OUT_ANY],
    params: [sel('rule', 'Emit when', 'change', [['change', 'Value changes'], ['delta', 'Changes by ≥ epsilon'], ['rise', 'Number rises'], ['fall', 'Number falls'], ['cross-up', 'Crosses threshold upward'], ['cross-down', 'Crosses threshold downward']], 'Rule that decides whether a new value passes.'), num('epsilon', 'Epsilon', 0.1, 0, 1e6, 0.01, 'Minimum change for the delta rule (measured from the last emitted value).'), num('threshold', 'Threshold', 0.5, -1e6, 1e6, 0.01, 'Level for the crossing rules.')],
    run(c) {
      const s = c.state, v = c.get('in'), x = n(v), rule = c.str('rule');
      let pass = false;
      if (!s.seen) pass = rule === 'change' || rule === 'delta';
      else if (rule === 'change') pass = v !== s.last;
      else if (rule === 'delta') pass = Math.abs(x - s.emitted) >= c.num('epsilon');
      else if (rule === 'rise') pass = x > s.lastN;
      else if (rule === 'fall') pass = x < s.lastN;
      else if (rule === 'cross-up') pass = s.lastN < c.num('threshold') && x >= c.num('threshold');
      else pass = s.lastN >= c.num('threshold') && x < c.num('threshold');
      s.seen = true; s.last = v; s.lastN = x;
      if (pass) { s.emitted = x; c.emit('out', v, c.strength, true); }
    },
    doc: { summary: 'Emits only when the signal changes according to a rule — a change detector.', runtime: 'Compares each arriving value with the previous one (delta compares with the last emitted value). The first value passes for change/delta and is only a reference for the other rules.', examples: ['rule = cross-up, threshold 0.5: emits once as the signal climbs through 0.5.'] },
  },
  {
    ...chipBase, type: 'hypernerve', name: 'Hypernerve', caption: 'Hypernerve', glyph: '⇶', chip: (p) => String(p.policy), 
    inputs: [inp('a', 'A', 'any', 'Candidate A (highest priority).', 'top', true), inp('b', 'B', 'any', 'Candidate B.', 'top', true), inp('c', 'C', 'any', 'Candidate C (lowest priority; wins under override).', 'top', true)], outputs: [OUT_ANY, out('winner', 'Winner', 'text', 'Which input won: a, b or c.', 'right')],
    params: [sel('policy', 'Policy', 'priority', [['priority', 'Priority: a > b > c'], ['strongest', 'Strongest signal'], ['latest', 'Most recent'], ['override', 'C overrides when present']], 'How competing inputs are resolved.')],
    run(c) {
      const names = ['a', 'b', 'c'].filter((p) => c.has(p));
      if (!names.length) return;
      const s = (c.state.t ??= {} as Record<string, number>);
      names.forEach((p) => { if (c.changed(p)) s[p] = c.time + (p === 'c' ? 0.002 : p === 'b' ? 0.001 : 0); });
      const pol = c.str('policy');
      let w = names[0];
      if (pol === 'strongest') w = names.reduce((p, q) => ((c.sig(q)!.s > c.sig(p)!.s) || (c.sig(q)!.s === c.sig(p)!.s && Math.abs(n(c.get(q))) > Math.abs(n(c.get(p)))) ? q : p));
      else if (pol === 'latest') w = names.reduce((p, q) => ((s[q] ?? -1) > (s[p] ?? -1) ? q : p));
      else if (pol === 'override' && names.includes('c')) w = 'c';
      c.emit('out', c.get(w), c.sig(w)!.s, true);
      c.emit('winner', w);
    },
    doc: { summary: 'Resolves competing inputs with a priority or override policy.', runtime: 'Priority picks the first connected input with a signal. Strongest compares signal strength, then magnitude. Most recent picks the input updated last. Override lets C beat everything while it has a signal.' },
  },
  {
    ...chipBase, type: 'firing', name: 'Firing Rate Control', caption: 'Rate Control', glyph: 'Hz', chip: (p) => `≤ ${fmtNum(Number(p.rate))} Hz`, delaying: true,
    inputs: [IN_ANY('Signal to regulate.')], outputs: [OUT_ANY],
    params: [num('rate', 'Max rate', 2, 0.1, 100, 0.1, 'Highest emission frequency.', 'Hz'), sel('mode', 'Mode', 'throttle', [['throttle', 'Throttle (send latest later)'], ['drop', 'Drop extras']], 'Throttle delivers the newest value when the next slot opens. Drop discards values arriving too early.')],
    run(c) {
      const s = c.state, period = 1000 / c.num('rate');
      const fresh = c.reason === 'input' || c.changed('in');
      if (fresh && c.has('in')) s.latest = { v: c.get('in'), s: c.strength };
      if (s.latest && (s.last === undefined || c.time - s.last >= period - 1e-6)) { c.emit('out', s.latest.v, s.latest.s, true); s.last = c.time; s.latest = undefined; }
      else if (s.latest) { if (c.str('mode') === 'drop') s.latest = undefined; else c.wake(period - (c.time - s.last)); }
    },
    doc: { summary: 'Limits how often a signal passes — a firing-rate limiter.', runtime: 'At most one value per 1/rate seconds of simulation time. Throttle holds the newest value until the slot opens; Drop discards early values.' },
  },
  {
    ...chipBase, type: 'envelope', name: 'Envelope', caption: 'Envelope', glyph: 'ENV', chip: (p) => `A${fmtNum(Number(p.attack))} R${fmtNum(Number(p.release))}`, delaying: true,
    inputs: [inp('gate', 'Gate', 'bool', 'True starts attack/decay and holds sustain; false starts release.')], outputs: [out('out', 'Level', 'num', 'Envelope level, 0–peak.'), out('phase', 'Phase', 'text', 'idle, attack, decay, sustain or release.', 'right')],
    params: [num('attack', 'Attack', 100, 1, 60000, 1, 'Time to rise to the peak.', 'ms'), num('decay', 'Decay', 200, 1, 60000, 1, 'Time to fall from peak to sustain.', 'ms'), num('sustain', 'Sustain', 0.6, 0, 1, 0.01, 'Held fraction of the peak while the gate stays true.'), num('release', 'Release', 400, 1, 60000, 1, 'Time to fall to zero after the gate closes.', 'ms'), num('peak', 'Peak', 1, 0, 1000, 0.1, 'Maximum level.')],
    run(c) {
      const s = c.state;
      s.phase ??= 'idle'; s.level ??= 0;
      if (c.changed('gate')) {
        const g = toBool(c.get('gate'));
        if (g && s.phase !== 'attack' && s.phase !== 'decay' && s.phase !== 'sustain') { s.phase = 'attack'; s.t0 = c.time; s.l0 = s.level; }
        else if (!g && s.phase !== 'idle' && s.phase !== 'release') { s.phase = 'release'; s.t0 = c.time; s.l0 = s.level; }
      }
      const pk = c.num('peak'), el = c.time - (s.t0 ?? c.time);
      if (s.phase === 'attack') {
        const t = clamp(el / c.num('attack'), 0, 1);
        s.level = s.l0 + (pk - s.l0) * t;
        if (t >= 1) { s.phase = 'decay'; s.t0 = c.time; s.l0 = pk; }
      } else if (s.phase === 'decay') {
        const t = clamp(el / c.num('decay'), 0, 1);
        s.level = s.l0 + (pk * c.num('sustain') - s.l0) * t;
        if (t >= 1) s.phase = 'sustain';
      } else if (s.phase === 'sustain') s.level = pk * c.num('sustain');
      else if (s.phase === 'release') {
        const t = clamp(el / c.num('release'), 0, 1);
        s.level = s.l0 * (1 - t);
        if (t >= 1) { s.phase = 'idle'; s.level = 0; }
      }
      c.emit('out', r4(s.level));
      c.emit('phase', s.phase);
      c.view({ level: s.level, phase: s.phase });
      if (s.phase === 'attack' || s.phase === 'decay' || s.phase === 'release') c.wake(c.tickMs);
    },
    doc: { summary: 'An attack–decay–sustain–release envelope driven by a gate.', runtime: 'Gate true: rise to peak over attack, fall to peak × sustain over decay, hold. Gate false: fall from the current level to 0 over release. Level is computed from simulation time, so it is independent of frame rate.' },
  },
  {
    ...chipBase, type: 'nap', name: 'Nap', caption: 'Nap', glyph: 'Zz', chip: (p) => (p.mode === 'suspend' ? 'SUSPEND' : `${fmtNum(Number(p.duration))} ms`), delaying: true,
    inputs: [IN_ANY('Signal to pass.'), inp('sleep', 'Sleep', 'bool', 'Suspend mode: holds the signal while true.', 'left', true)], outputs: [OUT_ANY],
    params: [sel('mode', 'Mode', 'refractory', [['refractory', 'Refractory (ignore after firing)'], ['suspend', 'Suspend (hold while asleep)']], 'Refractory: after passing a value the node sleeps for the duration and drops inputs. Suspend: while Sleep is true the latest input is held and released on waking.'), num('duration', 'Duration', 500, 0, 600000, 10, 'Refractory sleep length.', 'ms'), num('maxSleep', 'Max sleep', 5000, 10, 600000, 10, 'Suspend mode: longest hold before forced wake-up.', 'ms')],
    run(c) {
      const s = c.state;
      if (c.str('mode') === 'refractory') {
        if (c.changed('in') && (s.until === undefined || c.time >= s.until)) { c.emit('out', c.get('in'), c.strength, true); s.until = c.time + c.num('duration'); }
        return;
      }
      const asleep = c.has('sleep') && toBool(c.get('sleep'));
      if (c.changed('in')) s.held = { v: c.get('in'), s: c.strength };
      if (asleep) { s.since ??= c.time; c.wake(c.num('maxSleep') - (c.time - s.since)); }
      const forced = s.since !== undefined && c.time - s.since >= c.num('maxSleep');
      if (!asleep || forced) {
        s.since = undefined;
        if (s.held) { c.emit('out', s.held.v, s.held.s, true); s.held = undefined; }
      }
    },
    doc: { summary: 'Suspends processing according to explicit timing rules.', runtime: 'Refractory: the first value passes, then inputs are ignored for the duration. Suspend: while Sleep is true the newest input is held; when Sleep turns false (or max sleep elapses) it is released.' },
  },
  {
    ...chipBase, type: 'wave', name: 'Wave', caption: 'Wave Generator', glyph: '∿', chip: (p) => `${p.shape} ${fmtNum(Number(p.freq))} Hz`, source: true, delaying: true,
    inputs: [inp('amp', 'A', 'num', 'Amplitude; overrides the parameter when connected.', 'top', true), inp('freq', 'F', 'num', 'Frequency in Hz; overrides the parameter when connected.', 'top', true)], outputs: [out('out', 'Output', 'num', 'Waveform sample.')],
    params: [sel('shape', 'Shape', 'sine', [['sine', 'Sine'], ['triangle', 'Triangle'], ['square', 'Square'], ['saw', 'Saw']], 'Waveform shape.'), num('freq', 'Frequency', 1, 0.01, 2000, 0.01, 'Used when F is unconnected.', 'Hz'), num('amp', 'Amplitude', 1, 0, 1000, 0.01, 'Used when A is unconnected.'), num('offset', 'Offset', 0, -1000, 1000, 0.01, 'Added to the waveform.')],
    run(c) {
      const f = c.has('freq') ? n(c.get('freq')) : c.num('freq'), a = c.has('amp') ? n(c.get('amp')) : c.num('amp');
      const s = c.state;
      s.ph ??= 0;
      s.ph = (s.ph + (c.dt / 1000) * f) % 1;
      const ph = s.ph, sh = c.str('shape');
      const u = sh === 'sine' ? Math.sin(ph * 2 * Math.PI) : sh === 'square' ? (ph < 0.5 ? 1 : -1) : sh === 'saw' ? 2 * ph - 1 : 1 - 4 * Math.abs(ph - 0.5);
      c.emit('out', r4(c.num('offset') + a * u));
      c.wake(c.tickMs);
    },
    doc: { summary: 'A low-frequency oscillator producing a numeric waveform.', runtime: 'Phase advances by f × Δt in simulation time, so the waveform is independent of frame rate. Frequencies above half the tick rate alias.' },
  },
  {
    category: 'Node', family: 'node', type: 'equation', name: 'Equation', caption: 'Equation', glyph: 'f(x)', size: 'small', source: true, keywords: 'formula function graph plot curve expression sin cos math store',
    inputs: [inp('x', 'X', 'num', 'Evaluate the first equation at this x for the y(x) output. Optional: the “Evaluate at x” setting is used when it is not connected.', 'top', true)],
    outputs: [out('eq', 'Equation', 'data', 'The equation stored as data (expressions, plot range, time). Route it to a Meter to see its graph.'), out('y', 'y(x)', 'num', 'Value of the first equation at x.', 'right')],
    params: [
      txt('expr', 'Equation', 'sin(x)', `Any expression in x (and t, the simulation time in seconds). Write one equation per line or separate them with “;” to graph several curves. A leading “y =” is allowed. Functions: ${FUNCTION_NAMES.join(', ')}. Constants: pi, e, tau, phi. Operators: + − * / ^ %, and implicit products such as 2x or 3sin(x).`, { multiline: true, maxLength: 600, placeholder: 'y = sin(x)' }),
      num('xMin', 'x min', -10, -1e6, 1e6, 0.1, 'Left edge of the graph.'),
      num('xMax', 'x max', 10, -1e6, 1e6, 0.1, 'Right edge of the graph. Must be greater than x min.'),
      bol('yAuto', 'Auto y range', true, 'Fit the vertical range to the curves (ignoring asymptotes). Off: use y min and y max.'),
      num('yMin', 'y min', -1, -1e6, 1e6, 0.1, 'Bottom edge of the graph when Auto y range is off.'),
      num('yMax', 'y max', 1, -1e6, 1e6, 0.1, 'Top edge of the graph when Auto y range is off.'),
      num('samples', 'Samples', 200, 20, 2000, 10, 'Points computed per curve. More points draw sharper curves.'),
      num('x', 'Evaluate at x', 0, -1e6, 1e6, 0.1, 'The x used for the y(x) output when X is not connected.'),
    ],
    run(c) {
      const exprs = splitEquations(c.str('expr'));
      if (!exprs.length) return c.fail('Enter an equation, for example sin(x).');
      const compiled = exprs.map((e) => compileExpr(e));
      for (let i = 0; i < compiled.length; i++) { const r = compiled[i]; if (!r.ok) return c.fail(`“${exprs[i]}”: ${r.error}`); }
      if (!(c.num('xMax') > c.num('xMin'))) return c.fail('x max must be greater than x min.');
      const fns = compiled.map((r) => (r.ok ? r : undefined)!);
      const usesT = fns.some((f) => f.usesT);
      const t = usesT ? r4(c.time / 1000) : 0;
      const data: EquationData = { kind: 'equation', exprs, xMin: c.num('xMin'), xMax: c.num('xMax'), yMin: c.num('yMin'), yMax: c.num('yMax'), yAuto: c.bool('yAuto'), samples: c.num('samples'), t };
      c.emit('eq', data);
      const x = c.has('x') ? n(c.get('x')) : c.num('x');
      const y = fns[0].fn({ x, t });
      if (Number.isFinite(y)) c.emit('y', r4(y));
      else { c.emit('y', undefined); c.warn(`y(${fmtNum(x)}) is not a finite number.`); }
      c.view({ count: exprs.length, y: Number.isFinite(y) ? r4(y) : undefined });
      if (usesT) c.wake(c.tickMs);
    },
    doc: {
      summary: 'Stores one or more equations as data. Route its Equation output to a Meter to draw the graph.',
      runtime: 'Parses the expressions with a built-in safe evaluator (no scripts are run) and emits them with the plot range. Meter samples them over x min…x max and draws the curves on dimmed gray axes. The y(x) output evaluates the first equation at the X input. Equations that use t re-evaluate every tick, so graphs animate in simulation time.',
      errors: ['A syntax error, unknown name, wrong number of arguments or empty equation raises an error that names the problem.', 'x max not greater than x min raises an error.', 'y(x) not being a finite number (for example sqrt of a negative) raises a warning and clears the y output; the graph shows a gap there.'],
      examples: ['sin(x)', 'y = x^2 - 3x + 1', 'sin(x); cos(x) (two curves)', 'sin(x - 2t) (a travelling wave)', 'exp(-x^2/4) * cos(3x)'],
    },
  },
  {
    ...chipBase, type: 'event', name: 'Send Event', caption: 'Event Sender', glyph: '⚑', chip: (p) => String(p.name),
    inputs: [inp('trigger', 'Trigger', 'any', 'A truthy arrival fires the event.')], outputs: [out('event', 'Event', 'text', 'The event name, emitted once per trigger.')],
    params: [txt('name', 'Event name', 'go', 'Text emitted when triggered. State machines match transitions on it.', { maxLength: 80 })],
    run(c) { if (c.changed('trigger') && toBool(c.get('trigger'))) c.emit('event', c.str('name'), c.strength, true); },
    doc: { summary: 'Turns a trigger into a named event that other modules (like State) can react to.', runtime: 'Every truthy arrival emits the event name as an event, even if the previous one was identical.' },
  },
];
