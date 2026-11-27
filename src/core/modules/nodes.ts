import type { Ctx, ModuleDef } from '../types';
import { clamp, fmtNum, toBool, toNum, toText } from '../util';
import { exactText, leadExp, packDec, sameValue, toPlain, type Dec } from '../decimal';
import * as D from '../decmath';
import { DEFAULT_PRECISION, MAX_PRECISION, DecError, needDec, toDec } from '../decmath';
import { FUNCTION_NAMES, compileExpr, splitEquations, type EquationData } from '../equation';
import { readNumber } from '../basedata';
import { bol, dnum, inp, num, out, sel, txt } from './kit';
import { formatBase } from '../duration';

// Numbers are exact decimals here: nothing is rounded to a fixed number of places (that is the Number Formatter's job).
// Results leave as a plain number when a double holds them exactly, and as an exact decimal when it takes more digits (see packDec).
const out$ = (c: Ctx, port: string, d: Dec) => c.emit(port, packDec(d));
const sig$ = (c: Ctx, key: string): Dec => needDec(c.get(key), `Input “${key.toUpperCase()}”`);
/** Run a calculation: a result that has no answer (÷ 0, √ of a negative…) fails the module with a message that says why. */
const calc = (c: Ctx, f: () => void) => {
  try { f(); } catch (e) {
    if (e instanceof DecError) return c.fail(e.message);
    // The numbers have no size limit but the memory of the machine: a result too big for it fails this module, not the program.
    if (e instanceof RangeError) return c.fail('The result needs more memory than your browser can spare.');
    throw e;
  }
};
/** A setting written out with all its digits, for node faces. */
const face = (v: unknown): string => { const d = toDec(v); return d ? toPlain(d) : String(v); };
const PREC = num('precision', 'Precision', DEFAULT_PRECISION, 1, MAX_PRECISION, 1, 'How many significant digits to work out for results that never end and never repeat (√2, sin, e^x). Ask for as many as you like. Results that end (1 ÷ 8 = 0.125) or repeat (1 ÷ 3 = 0.333...) are always exact, and are never cut or padded.', 'digits');
const k = (dt: number, tau: number) => (tau <= 0 ? 1 : 1 - Math.exp(-dt / tau));
const n = (v: unknown) => toNum(v);
/** Is the magnitude of a larger than that of b? Compared on every digit; values that are not numbers count as 0. */
const magnitudeAbove = (a: unknown, b: unknown): boolean => D.cmp(D.abs(toDec(a) ?? D.ZERO), D.abs(toDec(b) ?? D.ZERO)) > 0;

function parseList(s: string): unknown[] {
  return s.split(',').map((t) => t.trim()).filter((t) => t !== '').map((t) => {
    if (t === 'true') return true;
    if (t === 'false') return false;
    const v = readNumber(t);
    return v !== undefined ? v : t;
  });
}

const OUT_ANY = out('out', 'Output', 'any', 'Result.');
const IN_ANY = (doc = 'Incoming signal.') => inp('in', 'Input', 'any', doc);

const chipBase = { category: 'Node' as const, family: 'node' as const, size: 'chip' as const };

export const nodes: ModuleDef[] = [
  {
    ...chipBase, type: 'constant', name: 'Constant', caption: 'Constant', glyph: 'C', chip: (p) => String(p.value),
    inputs: [], outputs: [OUT_ANY], source: true,
    params: [sel('kind', 'Kind', 'number', [['number', 'Number'], ['text', 'Text'], ['bool', 'Boolean']], 'The type of value to send.'), txt('value', 'Value', '1', 'The value to send. A number keeps every digit you type.', { maxLength: 5000 })],
    run(c) {
      const v = c.str('value'), kd = c.str('kind');
      if (kd === 'number') { const d = v.trim() === '' ? null : toDec(v); if (!d) return c.fail(`“${v}” is not a number.`); out$(c, 'out', d); }
      else if (kd === 'bool') c.emit('out', v === 'true' || v === '1' || v === 'on');
      else c.emit('out', v);
    },
    doc: { summary: 'Emits a fixed value.', runtime: 'Sends out when the program starts and whenever the value is edited.', errors: ['Kind “number” with non-numeric text gives an error.'] },
  },
  {
    ...chipBase, type: 'random', name: 'Random', caption: 'Random', glyph: 'R', chip: (p) => `${face(p.min)}…${face(p.max)}`,
    inputs: [], outputs: [OUT_ANY], source: true, delaying: true,
    params: [dnum('min', 'Minimum', 0, -1e6, 1e6, 0.1, 'The lowest value it can pick.'), dnum('max', 'Maximum', 1, -1e6, 1e6, 0.1, 'The highest value it can pick.'), num('rate', 'Rate', 2, 0.1, 30, 0.1, 'How many values to make per second.', 'Hz'), num('seed', 'Seed', 1, 0, 99999, 1, 'The seed for the repeatable random generator. The same seed always gives the same sequence.'), bol('integer', 'Integers', false, 'Round every value to a whole number.')],
    run(c) {
      calc(c, () => {
        const lo = c.dec('min'), hi = c.dec('max'), ln = D.toNumber(lo), hn = D.toNumber(hi);
        // Bounds a double holds exactly keep the plain double draw (so a seed gives the same sequence as always).
        if (Math.abs(ln) < 2 ** 53 && Math.abs(hn) < 2 ** 53 && packDec(lo) === ln && packDec(hi) === hn) {
          let v = ln + c.rand() * (hn - ln);
          if (c.bool('integer')) v = Math.round(v);
          c.emit('out', v);
        } else {
          // Any other bounds, however many digits or however large: enough random bits are drawn to spread over every digit of the range.
          const span = D.sub(hi, lo);
          const bits = Math.max(64, Math.ceil((leadExp(span) + 1) * 3.33) + 64);
          let R = 0n;
          for (let got = 0; got < bits; got += 32) R = (R << 32n) | BigInt(Math.floor(c.rand() * 4294967296));
          const u = D.div(D.fromBigInt(R), D.fromBigInt(1n << BigInt(Math.ceil(bits / 32) * 32)));
          let v = D.add(lo, D.mul(u, span));
          if (c.bool('integer')) v = D.round(v);
          out$(c, 'out', v);
        }
      });
      c.wake(1000 / c.num('rate'));
    },
    doc: { summary: 'Random numbers from a seed, so you can get the same sequence again.', runtime: 'Picks a random number between min and max every 1/rate seconds of simulation time, with every value equally likely. The limits can be any numbers, with as many digits as you like. The same seed gives you the same sequence every time you Stop and Run again.' },
  },
  {
    ...chipBase, type: 'pulse', name: 'Pulse', caption: 'Pulse', glyph: '⏸', chip: (p) => formatBase(Number(p.period), 'ms', { compact: true }),
    inputs: [], outputs: [out('out', 'Pulse', 'bool', 'True for the pulse width, then false.'), out('count', 'Count', 'num', 'Pulses emitted so far.', 'right')], source: true, delaying: true,
    params: [num('period', 'Period', 1000, 20, 86400000, 10, 'The time between the starts of two pulses.', 'ms'), num('width', 'Width', 100, 1, 86400000, 10, 'How long the pulse stays true. It can’t be longer than the period.', 'ms'), num('offset', 'Offset', 0, 0, 86400000, 10, 'When the first pulse happens.', 'ms'), num('max', 'Max pulses', 0, 0, 100000, 1, 'The most pulses it will send. 0 means no limit.')],
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
    doc: { summary: 'A clock that sends a true pulse at a steady interval.', runtime: 'Pulse k starts at offset + k × period and lasts width ms, but never less than one simulation tick so that downstream modules can see it. Timing is resolved at the tick.' },
  },
  {
    ...chipBase, type: 'add', name: 'Adder', caption: 'Adder', glyph: '+', chip: (p) => face(p.offset),
    inputs: [inp('a', 'A', 'num', 'First addend.'), inp('b', 'B', 'num', 'Second addend; 0 when not connected.', 'top', true)], outputs: [out('out', 'Sum', 'num', 'a + b + offset.')],
    params: [{ ...dnum('offset', 'Offset', 0, -1e6, 1e6, 0.1, 'A constant that gets added to the sum.'), pinSide: 'left' }],
    run(c) { calc(c, () => out$(c, 'out', D.add(D.add(sig$(c, 'a'), c.has('b') ? sig$(c, 'b') : D.ZERO), c.dec('offset')))); },
    doc: { summary: 'Adds numbers.', runtime: 'out = a + b + offset, worked out exactly: every digit of every number is kept (3 + 0.14159265 is 3.14159265, 0.1 + 0.2 is 0.3). A missing b counts as 0, and if a is missing the node sits idle.' },
  },
  {
    ...chipBase, type: 'mul', name: 'Multiplier', caption: 'Multiplier', glyph: '×', chip: (p) => face(p.factor),
    inputs: [inp('a', 'A', 'num', 'Value to scale.'), inp('b', 'B', 'num', 'Replaces the factor when connected.', 'top', true)], outputs: [out('out', 'Product', 'num', 'a × (b or factor).')],
    params: [{ ...dnum('factor', 'Factor', 1, -1e6, 1e6, 0.1, 'Used when b isn’t connected.'), pinSide: 'left' }],
    run(c) { calc(c, () => out$(c, 'out', D.mul(sig$(c, 'a'), c.has('b') ? sig$(c, 'b') : c.dec('factor')))); },
    doc: { summary: 'Multiplies a signal.', runtime: 'out = a × b, or a × factor when b isn’t connected. The product is exact: every digit of both numbers is kept.' },
  },
  {
    ...chipBase, type: 'sub', name: 'Subtractor', caption: 'Subtractor', glyph: '−', chip: (p) => face(p.offset),
    inputs: [inp('a', 'A', 'num', 'Minuend: the value to subtract from.'), inp('b', 'B', 'num', 'Subtrahend; 0 when not connected.', 'top', true)], outputs: [out('out', 'Difference', 'num', 'a − b − offset.')],
    params: [{ ...dnum('offset', 'Offset', 0, -1e6, 1e6, 0.1, 'A constant that gets taken off the difference.'), pinSide: 'left' }],
    run(c) { calc(c, () => out$(c, 'out', D.sub(D.sub(sig$(c, 'a'), c.has('b') ? sig$(c, 'b') : D.ZERO), c.dec('offset')))); },
    doc: { summary: 'Subtracts numbers.', runtime: 'out = a − b − offset, worked out exactly: every digit of every number is kept. A missing b counts as 0, and if a is missing the node sits idle.' },
  },
  {
    ...chipBase, type: 'div', name: 'Divisor', caption: 'Divisor', glyph: '÷', chip: (p) => face(p.divisor),
    inputs: [inp('a', 'A', 'num', 'Dividend: the value to divide.'), inp('b', 'B', 'num', 'Replaces the divisor when connected.', 'top', true)], outputs: [out('out', 'Quotient', 'num', 'a ÷ (b or divisor).')],
    params: [{ ...dnum('divisor', 'Divisor', 1, -1e6, 1e6, 0.1, 'Used when b isn’t connected.'), pinSide: 'left' }],
    run(c) {
      calc(c, () => {
        const a = sig$(c, 'a'), d = c.has('b') ? sig$(c, 'b') : c.dec('divisor');
        if (D.isZero(d)) return c.fail(`Division by zero: ${exactText(packDec(a))} ÷ 0.`);
        out$(c, 'out', D.div(a, d));
      });
    },
    doc: { summary: 'Divides a signal.', runtime: 'out = a ÷ b, or a ÷ divisor if nothing is connected to b. The answer is always exact. If it ends (1 ÷ 8 = 0.125), you get every digit. If it never ends, it repeats, and it’s kept as the repeating number it is: 1 ÷ 3 is 0.33333..., with an ellipsis after the repeating digits, and 1 ÷ 3 × 3 is exactly 1.', errors: ['A divisor of 0 gives an error and sends out nothing.'] },
  },
  {
    ...chipBase, type: 'invert', name: 'Inverter', caption: 'Inverter', glyph: '−', chip: (p) => String(p.mode),
    inputs: [IN_ANY('Number or boolean.')], outputs: [OUT_ANY],
    params: [sel('mode', 'Mode', 'negate', [['negate', 'Negate (−x)'], ['complement', 'Complement (1 − x)']], 'Numbers get negated, while true/false values are always flipped.')],
    run(c) {
      const v = c.get('in');
      if (typeof v === 'boolean') return c.emit('out', !v);
      const x = toDec(v);
      if (!x) return c.warn('Input is not numeric.');
      out$(c, 'out', c.str('mode') === 'negate' ? D.neg(x) : D.sub(D.ONE, x));
    },
    doc: { summary: 'Negates a number, or flips a true/false value.', runtime: 'Boolean → NOT. Number → −x or 1 − x depending on mode.' },
  },
  {
    ...chipBase, type: 'math', name: 'Math', caption: 'Math', glyph: 'M', chip: (p) => String(p.fn),
    inputs: [inp('a', 'A', 'num', 'Operand.'), inp('b', 'B', 'num', 'Second operand for min, max, pow, mod.', 'top', true)], outputs: [out('out', 'Result', 'num', 'Function result.')],
    params: [sel('fn', 'Function', 'abs', ['abs', 'sqrt', 'square', 'sin', 'cos', 'tanh', 'exp', 'log', 'floor', 'round', 'ceil', 'min', 'max', 'pow', 'mod'].map((x) => [x, x] as [string, string]), 'The function applied to a (and b).'), { ...PREC, pinSide: 'left' }],
    run(c) {
      calc(c, () => {
        const a = sig$(c, 'a'), b = c.has('b') ? sig$(c, 'b') : D.ZERO, P = c.num('precision'), fn = c.str('fn');
        let r: Dec;
        switch (fn) {
          case 'abs': r = D.abs(a); break;
          case 'sqrt': r = D.sqrt(a, P); break;
          case 'square': r = D.mul(a, a); break;
          case 'sin': r = D.sin(a, P); break;
          case 'cos': r = D.cos(a, P); break;
          case 'tanh': r = D.tanh(a, P); break;
          case 'exp': r = D.exp(a, P); break;
          case 'log': r = D.ln(a, P); break;
          case 'floor': r = D.floor(a); break;
          case 'round': r = D.round(a); break;
          case 'ceil': r = D.ceil(a); break;
          case 'min': r = D.min(a, b); break;
          case 'max': r = D.max(a, b); break;
          case 'pow': r = D.pow(a, b, P); break;
          case 'mod': r = D.mod(a, b); break;
          default: return c.fail(`Unknown function “${fn}”.`);
        }
        out$(c, 'out', r);
      });
    },
    doc: { summary: 'Applies a mathematical function.', runtime: 'Applies the chosen function to a (and b) using exact decimals. abs, square, floor, round, ceil, min, max, mod, and powers with a whole-number exponent are exact. That includes negative exponents (3 to the power −1 = 0.33333...) and square roots that end or repeat. sqrt, sin, cos, tanh, exp, log, and powers with a fractional exponent go on forever without repeating, so they’re worked out to the Precision setting (50 significant digits by default, or any number you like). sin and cos use radians.', errors: ['Results that aren’t finite (e.g. sqrt of a negative) give an error and send out nothing.'] },
  },
  {
    ...chipBase, type: 'register', name: 'Register', caption: 'Register', glyph: '○', chip: () => 'HOLD', delaying: true,
    inputs: [IN_ANY('Value to latch.'), inp('store', 'Store', 'bool', 'Rising edge latches the input. When not connected, every change is latched.', 'left', true)], outputs: [OUT_ANY],
    params: [],
    run(c) {
      if (c.has('store') ? c.changed('store') && c.get('store') === true : c.changed('in')) { c.state.v = c.get('in'); c.state.has = true; }
      if (c.state.has) c.emit('out', c.state.v, c.strength, true);
    },
    doc: { summary: 'Sample-and-hold: keeps a value until you tell it to grab a new one.', runtime: 'On the rising edge of Store, copies the input to the output. Between triggers the output holds. Counts as state for feedback loops.' },
  },
  {
    ...chipBase, type: 'relay', name: 'Gate', caption: 'Relay', glyph: '╤', chip: (p) => (p.invert ? 'BLOCK' : 'OPEN?'), 
    inputs: [IN_ANY('Signal to pass.'), inp('open', 'Open', 'bool', 'Gate control. When not connected the gate uses its default.', 'left', true)], outputs: [OUT_ANY],
    params: [bol('openDefault', 'Open by default', true, 'Used when Open isn’t connected.'), bol('invert', 'Invert control', false, 'When on, signals only get through while Open is false.')],
    run(c) {
      let open = c.has('open') ? toBool(c.get('open')) : c.bool('openDefault');
      if (c.bool('invert')) open = !open;
      if (open) c.emit('out', c.get('in'), c.strength, true);
    },
    doc: { summary: 'Passes a signal only while the gate is open.', runtime: 'When open, input changes are forwarded. When closed nothing is sent and the output keeps its last value. Opening the gate forwards the current input.' },
  },
  {
    ...chipBase, type: 'inductor', name: 'Smooth', caption: 'Inductor', glyph: 'Ω', chip: (p) => formatBase(Number(p.tau), 'ms', { compact: true }), delaying: true,
    inputs: [inp('in', 'Input', 'num', 'Target value.')], outputs: [out('out', 'Output', 'num', 'Low-pass filtered value.')],
    params: [num('tau', 'Time constant', 500, 1, 86400000, 10, 'How long it takes to get about 63% of the way to the input.', 'ms')],
    run(c) {
      const s = c.state, target = n(c.get('in'));
      s.y ??= 0;
      s.y += (target - s.y) * k(c.dt, c.num('tau'));
      if (Math.abs(target - s.y) < 1e-3) s.y = target;
      c.emit('out', s.y);
      if (s.y !== target) c.wake(c.tickMs);
    },
    doc: { summary: 'Smooths out a signal with a low-pass filter.', runtime: 'y ← y + (x − y)(1 − e^(−Δt/τ)) in simulation time. Starts at 0 and settles on the input.' },
  },
  {
    ...chipBase, type: 'threshold', name: 'Threshold', caption: 'Filter', glyph: '>', chip: (p) => `${p.mode === 'below' ? '<' : '>'} ${face(p.threshold)}`, delaying: false,
    inputs: [inp('in', 'Input', 'num', 'Value to compare.')], outputs: [out('over', 'Over', 'bool', 'True when the condition holds.'), out('delta', 'Delta', 'num', 'Input minus threshold.', 'right')],
    params: [dnum('threshold', 'Threshold', 0.5, -1e6, 1e6, 0.01, 'The level it compares against.'), dnum('hysteresis', 'Hysteresis', 0, 0, 1e6, 0.01, 'Once it’s true, the input has to drop back past the threshold by this much before it turns false.'), sel('mode', 'Condition', 'above', [['above', 'Input ≥ threshold'], ['below', 'Input ≤ threshold']], 'Which way to compare.')],
    run(c) {
      calc(c, () => {
        const x = toDec(c.get('in'));
        if (!x) return c.warn('Input is not numeric.');
        const t = c.dec('threshold'), h = c.dec('hysteresis');
        const d = c.str('mode') === 'below' ? D.sub(t, x) : D.sub(x, t);
        c.state.on = c.state.on ? D.cmp(d, D.neg(h)) >= 0 : D.cmp(d, D.ZERO) >= 0;
        c.emit('over', c.state.on);
        out$(c, 'delta', D.sub(x, t));
      });
    },
    doc: { summary: 'Compares a value with a threshold, with optional hysteresis.', runtime: 'above: true when x ≥ threshold, stays true until x < threshold − hysteresis. below mirrors it. Also reports x − threshold.', examples: ['threshold 0.5, hysteresis 0.1: 0.55 → true, 0.45 → true, 0.39 → false.'] },
  },
  {
    ...chipBase, type: 'compare', name: 'Compare', caption: 'Comparator', glyph: '=', chip: (p) => String(p.op),
    inputs: [inp('a', 'A', 'any', 'Left operand.'), inp('b', 'B', 'any', 'Right operand; uses the fallback when not connected.', 'top', true)], outputs: [out('out', 'Result', 'bool', 'True when the relation holds.')],
    params: [sel('op', 'Relation', '>', ['==', '!=', '>', '<', '>=', '<='].map((x) => [x, x] as [string, string]), 'How a and b are compared.'), txt('fallback', 'Fallback b', '0', 'The right-hand value when b isn’t connected.'), { ...dnum('tolerance', 'Tolerance', 0, 0, 1e6, 0.001, 'How close two numbers can be and still count as equal.'), pinSide: 'left' }],
    run(c) {
      calc(c, () => {
        const a = c.get('a'), b = c.has('b') ? c.get('b') : c.str('fallback');
        const da = toDec(a), db = toDec(b), op = c.str('op');
        let r: boolean;
        if (da && db) {
          const k = D.cmp(da, db), near = D.cmp(D.abs(D.sub(da, db)), c.dec('tolerance')) <= 0;
          r = ({ '==': near, '!=': !near, '>': k > 0, '<': k < 0, '>=': k >= 0, '<=': k <= 0 } as Record<string, boolean>)[op];
        } else { const x = toText(a), y = toText(b); r = ({ '==': x === y, '!=': x !== y, '>': x > y, '<': x < y, '>=': x >= y, '<=': x <= y } as Record<string, boolean>)[op]; }
        c.emit('out', r);
      });
    },
    doc: { summary: 'Compares two values.', runtime: 'Numbers are compared numerically, digit for digit (equality within tolerance), so 0.1 + 0.2 equals 0.3, and two numbers that only differ in the 30th digit are still different. Anything else is compared as text.' },
  },
  {
    ...chipBase, type: 'combine', name: 'Combine', caption: 'Combiner', glyph: '⊕', chip: (p) => String(p.mode),
    inputs: [inp('a', 'A', 'any', 'Input A.', 'top', true), inp('b', 'B', 'any', 'Input B.', 'top', true), inp('c', 'C', 'any', 'Input C.', 'top', true)], outputs: [OUT_ANY],
    params: [sel('mode', 'Mode', 'sum', [['sum', 'Sum'], ['mean', 'Mean'], ['max', 'Max'], ['min', 'Min'], ['product', 'Product'], ['join', 'Join as text'], ['list', 'List']], 'How the inputs that are present get merged.'), txt('sep', 'Separator', ' ', 'What Join puts between the values.')],
    run(c) {
      const vals = ['a', 'b', 'c'].filter((p) => c.has(p)).map((p) => c.get(p));
      if (!vals.length) return;
      const m = c.str('mode');
      if (m === 'join') return c.emit('out', vals.map(toText).join(c.str('sep')));
      if (m === 'list') return c.emit('out', vals);
      calc(c, () => {
        const x = vals.map((v) => toDec(v));
        if (x.some((v) => !v)) return c.warn('A numeric mode received a non-numeric input.');
        const xs = x as Dec[];
        const sum = () => xs.reduce((p, q) => D.add(p, q), D.ZERO);
        const r = m === 'sum' ? sum() : m === 'mean' ? D.div(sum(), D.fromInt(xs.length)) : m === 'max' ? xs.reduce((p, q) => D.max(p, q)) : m === 'min' ? xs.reduce((p, q) => D.min(p, q)) : xs.reduce((p, q) => D.mul(p, q), D.ONE);
        out$(c, 'out', r);
      });
    },
    doc: { summary: 'Merges up to three inputs.', runtime: 'Only inputs that are connected and carrying a signal are counted. The numeric modes are exact (a mean that never ends repeats, and is kept exactly: 0.33333...), and show a warning if they get something that isn’t a number.' },
  },
  {
    ...chipBase, type: 'delay', name: 'Delay', caption: 'Delay', glyph: '⧖', chip: (p) => formatBase(Number(p.ms), 'ms', { compact: true }), delaying: true,
    inputs: [IN_ANY('Signal to delay.')], outputs: [OUT_ANY],
    params: [num('ms', 'Delay', 500, 0, 86400000, 10, 'How long each value is held back, in simulation time.', 'ms'), sel('mode', 'Mode', 'shift', [['shift', 'Shift every value'], ['settle', 'Settle (emit after quiet)']], 'Shift keeps every value, in order. Settle skips the ones in between and only sends something once the input has been quiet for the delay.')],
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
    doc: { summary: 'Delays a signal by a fixed time. Allowed in feedback loops.', runtime: 'Shift: every input value re-appears exactly “delay” ms later, in order. Settle: only the latest value is sent once the input stays unchanged for “delay” ms.', errors: ['A delay of 0 passes values through immediately.'] },
  },
  {
    ...chipBase, type: 'counter', name: 'Counter', caption: 'Counter', glyph: '#', chip: (p) => `+${face(p.step)}`, delaying: true, source: true,
    inputs: [inp('inc', 'Increment', 'any', 'Each arriving true value adds one step.', 'top', true), inp('dec', 'Decrement', 'any', 'Each arriving true value subtracts one step.', 'left', true), inp('reset', 'Reset', 'bool', 'Rising edge returns to the start value.', 'left', true)], outputs: [out('out', 'Count', 'num', 'Current count.')],
    params: [dnum('start', 'Start', 0, -1e9, 1e9, 1, 'The value it starts at, and goes back to on reset.'), dnum('step', 'Step', 1, -1e6, 1e6, 1, 'How much gets added on every event.'), dnum('min', 'Minimum', 0, -1e9, 1e9, 1, 'The lowest it can go.'), dnum('max', 'Maximum', 100, -1e9, 1e9, 1, 'The highest it can go.'), bol('wrap', 'Wrap around', false, 'Wrap around to the other limit instead of stopping at the edge.')],
    run(c) {
      calc(c, () => {
        const s = c.state;
        s.v ??= c.dec('start');
        const ev = (p: string) => c.has(p) && c.changed(p) && toBool(c.get(p));
        if (ev('reset')) s.v = c.dec('start');
        if (ev('inc')) s.v = D.add(s.v, c.dec('step'));
        if (ev('dec')) s.v = D.sub(s.v, c.dec('step'));
        const lo = c.dec('min'), hi = c.dec('max');
        if (D.cmp(s.v, hi) > 0) s.v = c.bool('wrap') ? lo : hi;
        if (D.cmp(s.v, lo) < 0) s.v = c.bool('wrap') ? hi : lo;
        out$(c, 'out', s.v);
      });
    },
    doc: { summary: 'Counts events.', runtime: 'Inc/Dec events are arrivals of a true value, so a pulse train counts once per pulse. The count is exact (0.1 added ten times is 1), and it’s clamped to [min, max] or wraps.' },
  },
  {
    ...chipBase, type: 'sequence', name: 'Sequence', caption: 'Sequencer', glyph: 'SEQ', chip: (p) => `${parseList(String(p.values)).length} steps`, delaying: true, source: true,
    inputs: [inp('next', 'Next', 'any', 'Each arriving true value advances one step.', 'top', true), inp('reset', 'Reset', 'bool', 'Rising edge returns to step 1.', 'left', true)], outputs: [OUT_ANY, out('index', 'Index', 'num', 'Current step number, from 0.', 'right')],
    params: [txt('values', 'Values', '1, 2, 3', 'Values separated by commas. Numbers and true/false are recognised, and anything else is treated as text.'), bol('loop', 'Loop', true, 'Go back to the start after the last step. Off stops on the last step.'), num('auto', 'Auto advance', 0, 0, 600000, 10, 'If it’s above 0, the node moves on to the next step by itself at this interval.', 'ms')],
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
    doc: { summary: 'Steps through a list of values.', runtime: 'Sends out the first value on start; each Next event (or auto-advance interval) moves to the following value.' },
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
    ...chipBase, type: 'plastic', name: 'Plastic Nerve', caption: 'Plastic Nerve', glyph: '⇄', chip: (p) => `${face(p.inMin)}…${face(p.inMax)} → ${face(p.outMin)}…${face(p.outMax)}`,
    inputs: [inp('in', 'Input', 'num', 'Value to remap.')], outputs: [out('out', 'Output', 'num', 'Remapped value.')],
    params: [dnum('inMin', 'Input min', 0, -1e6, 1e6, 0.1, 'The bottom of the input range.'), dnum('inMax', 'Input max', 1, -1e6, 1e6, 0.1, 'The top of the input range.'), dnum('outMin', 'Output min', 0, -1e6, 1e6, 0.1, 'The value you get at input min.'), dnum('outMax', 'Output max', 100, -1e6, 1e6, 0.1, 'The value you get at input max.'), sel('curve', 'Curve', 'linear', [['linear', 'Linear'], ['ease-in', 'Ease in (t²)'], ['ease-out', 'Ease out'], ['smooth', 'Smoothstep']], 'The shape of the mapping.'), bol('clamp', 'Clamp', true, 'Keeps the output inside the output range.')],
    run(c) {
      calc(c, () => {
        const x = sig$(c, 'in'), a = c.dec('inMin'), b = c.dec('inMax');
        if (D.cmp(a, b) === 0) return c.fail('Input min and max must differ.');
        let t = D.div(D.sub(x, a), D.sub(b, a));
        if (c.bool('clamp')) t = D.max(D.ZERO, D.min(D.ONE, t));
        const cv = c.str('curve'), one = D.ONE, inv = D.sub(one, t);
        const u = cv === 'ease-in' ? D.mul(t, t) : cv === 'ease-out' ? D.sub(one, D.mul(inv, inv)) : cv === 'smooth' ? D.mul(D.mul(t, t), D.sub(D.fromInt(3), D.mul(D.fromInt(2), t))) : t;
        const lo = c.dec('outMin'), hi = c.dec('outMax');
        out$(c, 'out', D.add(lo, D.mul(u, D.sub(hi, lo))));
      });
    },
    doc: { summary: 'Remaps values from one range to another, optionally along a curve.', runtime: 't = (x − inMin)/(inMax − inMin), optionally clamped; out = outMin + curve(t) × (outMax − outMin). Ranges may be inverted.', errors: ['Input min equal to input max is an error.'], examples: ['0…1 → 0…100: 0.25 → 25.'] },
  },
  {
    ...chipBase, type: 'hyponerve', name: 'Hyponerve', caption: 'Hyponerve', glyph: 'Δ', chip: (p) => String(p.rule), 
    inputs: [IN_ANY('Signal to watch.')], outputs: [OUT_ANY],
    params: [sel('rule', 'Emit when', 'change', [['change', 'Value changes'], ['delta', 'Changes by ≥ epsilon'], ['rise', 'Number rises'], ['fall', 'Number falls'], ['cross-up', 'Crosses threshold upward'], ['cross-down', 'Crosses threshold downward']], 'The rule that decides whether a new value gets through.'), dnum('epsilon', 'Epsilon', 0.1, 0, 1e6, 0.01, 'The smallest change that counts for the delta rule, measured from the last value that was sent.'), dnum('threshold', 'Threshold', 0.5, -1e6, 1e6, 0.01, 'The level the crossing rules look for.')],
    run(c) {
      calc(c, () => {
        const s = c.state, v = c.get('in'), x = toDec(v), rule = c.str('rule');
        let pass = false;
        // Numbers are compared digit for digit, however many there are.
        const th = c.dec('threshold');
        if (!s.seen) pass = rule === 'change' || rule === 'delta';
        else if (rule === 'change') pass = !sameValue(v, s.last);
        else if (rule === 'delta') pass = !!x && !!s.emitted && D.cmp(D.abs(D.sub(x, s.emitted)), c.dec('epsilon')) >= 0;
        else if (rule === 'rise') pass = !!x && !!s.lastN && D.cmp(x, s.lastN) > 0;
        else if (rule === 'fall') pass = !!x && !!s.lastN && D.cmp(x, s.lastN) < 0;
        else if (rule === 'cross-up') pass = !!x && !!s.lastN && D.cmp(s.lastN, th) < 0 && D.cmp(x, th) >= 0;
        else pass = !!x && !!s.lastN && D.cmp(s.lastN, th) >= 0 && D.cmp(x, th) < 0;
        s.seen = true; s.last = v; s.lastN = x;
        if (pass) { s.emitted = x; c.emit('out', v, c.strength, true); }
      });
    },
    doc: { summary: 'Only sends something when the signal changes according to a rule. A change detector.', runtime: 'Compares each arriving value with the previous one (delta compares with the last sent value). The first value passes for change/delta and is only a reference for the other rules.', examples: ['rule = cross-up, threshold 0.5: sends out once as the signal climbs through 0.5.'] },
  },
  {
    ...chipBase, type: 'hypernerve', name: 'Hypernerve', caption: 'Hypernerve', glyph: '⇶', chip: (p) => String(p.policy), 
    inputs: [inp('a', 'A', 'any', 'Candidate A (highest priority).', 'top', true), inp('b', 'B', 'any', 'Candidate B.', 'top', true), inp('c', 'C', 'any', 'Candidate C (lowest priority; wins under override).', 'top', true)], outputs: [OUT_ANY, out('winner', 'Winner', 'text', 'Which input won: a, b or c.', 'right')],
    params: [sel('policy', 'Policy', 'priority', [['priority', 'Priority: a > b > c'], ['strongest', 'Strongest signal'], ['latest', 'Most recent'], ['override', 'C overrides when present']], 'How to settle things when inputs compete.')],
    run(c) {
      const names = ['a', 'b', 'c'].filter((p) => c.has(p));
      if (!names.length) return;
      const s = (c.state.t ??= {} as Record<string, number>);
      names.forEach((p) => { if (c.changed(p)) s[p] = c.time + (p === 'c' ? 0.002 : p === 'b' ? 0.001 : 0); });
      const pol = c.str('policy');
      let w = names[0];
      if (pol === 'strongest') w = names.reduce((p, q) => ((c.sig(q)!.s > c.sig(p)!.s) || (c.sig(q)!.s === c.sig(p)!.s && magnitudeAbove(c.get(q), c.get(p))) ? q : p));
      else if (pol === 'latest') w = names.reduce((p, q) => ((s[q] ?? -1) > (s[p] ?? -1) ? q : p));
      else if (pol === 'override' && names.includes('c')) w = 'c';
      c.emit('out', c.get(w), c.sig(w)!.s, true);
      c.emit('winner', w);
    },
    doc: { summary: 'Settles which input wins when several compete, using a priority or override rule.', runtime: 'Priority picks the first connected input with a signal. Strongest compares signal strength, then magnitude. Most recent picks the input updated last. Override lets C beat everything while it has a signal.' },
  },
  {
    ...chipBase, type: 'firing', name: 'Firing Rate Control', caption: 'Rate Control', glyph: 'Hz', chip: (p) => `≤ ${fmtNum(Number(p.rate))} Hz`, delaying: true,
    inputs: [IN_ANY('Signal to regulate.')], outputs: [OUT_ANY],
    params: [num('rate', 'Max rate', 2, 0.1, 100, 0.1, 'The highest rate it will send at.', 'Hz'), sel('mode', 'Mode', 'throttle', [['throttle', 'Throttle (send latest later)'], ['drop', 'Drop extras']], 'Throttle sends the newest value when the next slot opens. Drop throws away values that arrive too early.')],
    run(c) {
      const s = c.state, period = 1000 / c.num('rate');
      const fresh = c.reason === 'input' || c.changed('in');
      if (fresh && c.has('in')) s.latest = { v: c.get('in'), s: c.strength };
      if (s.latest && (s.last === undefined || c.time - s.last >= period - 1e-6)) { c.emit('out', s.latest.v, s.latest.s, true); s.last = c.time; s.latest = undefined; }
      else if (s.latest) { if (c.str('mode') === 'drop') s.latest = undefined; else c.wake(period - (c.time - s.last)); }
    },
    doc: { summary: 'Limits how often a signal gets through. A firing-rate limiter.', runtime: 'At most one value per 1/rate seconds of simulation time. Throttle holds the newest value until the slot opens; Drop discards early values.' },
  },
  {
    ...chipBase, type: 'envelope', name: 'Envelope', caption: 'Envelope', glyph: 'ENV', chip: (p) => `A${fmtNum(Number(p.attack))} R${fmtNum(Number(p.release))}`, delaying: true,
    inputs: [inp('gate', 'Gate', 'bool', 'True starts attack/decay and holds sustain; false starts release.')], outputs: [out('out', 'Level', 'num', 'Envelope level, 0–peak.'), out('phase', 'Phase', 'text', 'idle, attack, decay, sustain or release.', 'right')],
    params: [num('attack', 'Attack', 100, 1, 60000, 1, 'How long it takes to rise to the peak.', 'ms'), num('decay', 'Decay', 200, 1, 60000, 1, 'How long it takes to fall from the peak down to the sustain level.', 'ms'), num('sustain', 'Sustain', 0.6, 0, 1, 0.01, 'How much of the peak is held while the gate stays true, as a fraction.'), num('release', 'Release', 400, 1, 60000, 1, 'How long it takes to fall to zero once the gate closes.', 'ms'), num('peak', 'Peak', 1, 0, 1000, 0.1, 'The highest level it reaches.')],
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
      c.emit('out', s.level);
      c.emit('phase', s.phase);
      c.view({ level: s.level, phase: s.phase });
      if (s.phase === 'attack' || s.phase === 'decay' || s.phase === 'release') c.wake(c.tickMs);
    },
    doc: { summary: 'An attack–decay–sustain–release envelope driven by a gate.', runtime: 'Gate true: rise to peak over attack, fall to peak × sustain over decay, hold. Gate false: fall from the current level to 0 over release. Level is computed from simulation time, so it’s independent of frame rate.' },
  },
  {
    ...chipBase, type: 'nap', name: 'Nap', caption: 'Nap', glyph: 'Zz', chip: (p) => (p.mode === 'suspend' ? 'SUSPEND' : `${fmtNum(Number(p.duration))} ms`), delaying: true,
    inputs: [IN_ANY('Signal to pass.'), inp('sleep', 'Sleep', 'bool', 'Suspend mode: holds the signal while true.', 'left', true)], outputs: [OUT_ANY],
    params: [sel('mode', 'Mode', 'refractory', [['refractory', 'Refractory (ignore after firing)'], ['suspend', 'Suspend (hold while asleep)']], 'Refractory: after a value passes, the node goes to sleep for the duration and ignores whatever arrives. Suspend: while Sleep is true, the latest input is held, then let go when the node wakes up.'), num('duration', 'Duration', 500, 0, 600000, 10, 'How long the refractory sleep lasts.', 'ms'), num('maxSleep', 'Max sleep', 5000, 10, 600000, 10, 'Suspend mode: the longest it will hold on before it’s forced awake.', 'ms')],
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
    doc: { summary: 'Pauses processing according to timing rules you set.', runtime: 'Refractory: the first value passes, then inputs are ignored for the duration. Suspend: while Sleep is true the newest input is held; when Sleep turns false (or max sleep elapses) it’s released.' },
  },
  {
    ...chipBase, type: 'wave', name: 'Wave', caption: 'Wave Generator', glyph: '∿', chip: (p) => `${p.shape} ${fmtNum(Number(p.freq))} Hz`, source: true, delaying: true,
    inputs: [inp('amp', 'A', 'num', 'Amplitude; overrides the parameter when connected.', 'top', true), inp('freq', 'F', 'num', 'Frequency in Hz; overrides the parameter when connected.', 'top', true)], outputs: [out('out', 'Output', 'num', 'Waveform sample.')],
    params: [sel('shape', 'Shape', 'sine', [['sine', 'Sine'], ['triangle', 'Triangle'], ['square', 'Square'], ['saw', 'Saw']], 'The shape of the wave.'), num('freq', 'Frequency', 1, 0.01, 2000, 0.01, 'Used when F isn’t connected.', 'Hz'), num('amp', 'Amplitude', 1, 0, 1000, 0.01, 'Used when A isn’t connected.'), num('offset', 'Offset', 0, -1000, 1000, 0.01, 'Added to the wave.')],
    run(c) {
      const f = c.has('freq') ? n(c.get('freq')) : c.num('freq'), a = c.has('amp') ? n(c.get('amp')) : c.num('amp');
      const s = c.state;
      s.ph ??= 0;
      s.ph = (s.ph + (c.dt / 1000) * f) % 1;
      const ph = s.ph, sh = c.str('shape');
      const u = sh === 'sine' ? Math.sin(ph * 2 * Math.PI) : sh === 'square' ? (ph < 0.5 ? 1 : -1) : sh === 'saw' ? 2 * ph - 1 : 1 - 4 * Math.abs(ph - 0.5);
      c.emit('out', c.num('offset') + a * u);
      c.wake(c.tickMs);
    },
    doc: { summary: 'A low-frequency oscillator that produces a numeric waveform.', runtime: 'Phase advances by f × Δt in simulation time, so the waveform is independent of frame rate. Frequencies above half the tick rate alias.' },
  },
  {
    category: 'Node', family: 'node', type: 'equation', name: 'Equation', caption: 'Equation', glyph: 'f(x)', size: 'small', source: true, keywords: 'formula function graph plot curve expression sin cos math store',
    inputs: [inp('x', 'X', 'num', 'Evaluate the first equation at this x for the y(x) output. Optional: the “Evaluate at x” setting is used when it isn’t connected.', 'top', true)],
    outputs: [out('eq', 'Equation', 'data', 'The equation stored as data (expressions, plot range, time). Route it to a Meter to see its graph.'), out('text', 'Equation text', 'text', 'The equation as text: the expressions as typed, one per line.'), out('y', 'y(x)', 'num', 'Value of the first equation at x.', 'right')],
    params: [
      txt('expr', 'Equation', 'sin(x)', `Any expression in x (and t, the simulation time in seconds). Put one equation on each line, or split them with “;”, to graph several curves. A leading “y =” is fine. Functions: ${FUNCTION_NAMES.join(', ')}. Constants: pi, e, tau, phi. Operators: + − * / ^ %, and you can leave out the multiplication sign in things like 2x or 3sin(x).`, { multiline: true, maxLength: 600, placeholder: 'y = sin(x)' }),
      num('xMin', 'x min', -10, -1e6, 1e6, 0.1, 'The left edge of the graph.'),
      num('xMax', 'x max', 10, -1e6, 1e6, 0.1, 'The right edge of the graph. It has to be greater than x min.'),
      bol('yAuto', 'Auto y range', true, 'Fits the vertical range to the curves (ignoring asymptotes). Off uses y min and y max instead.'),
      num('yMin', 'y min', -1, -1e6, 1e6, 0.1, 'The bottom edge of the graph when Auto y range is off.'),
      num('yMax', 'y max', 1, -1e6, 1e6, 0.1, 'The top edge of the graph when Auto y range is off.'),
      num('samples', 'Samples', 200, 20, 2000, 10, 'How many points to work out for each curve. More points make smoother curves.'),
      num('x', 'Evaluate at x', 0, -1e6, 1e6, 0.1, 'The x used for the y(x) output when X isn’t connected.'),
    ],
    run(c) {
      const exprs = splitEquations(c.str('expr'));
      if (!exprs.length) return c.fail('Enter an equation, for example sin(x).');
      const compiled = exprs.map((e) => compileExpr(e));
      for (let i = 0; i < compiled.length; i++) { const r = compiled[i]; if (!r.ok) return c.fail(`“${exprs[i]}”: ${r.error}`); }
      if (!(c.num('xMax') > c.num('xMin'))) return c.fail('x max must be greater than x min.');
      const fns = compiled.map((r) => (r.ok ? r : undefined)!);
      const usesT = fns.some((f) => f.usesT);
      const t = usesT ? c.time / 1000 : 0;
      const data: EquationData = { kind: 'equation', exprs, xMin: c.num('xMin'), xMax: c.num('xMax'), yMin: c.num('yMin'), yMax: c.num('yMax'), yAuto: c.bool('yAuto'), samples: c.num('samples'), t };
      c.emit('eq', data);
      c.emit('text', exprs.join('\n'));
      const x = c.has('x') ? n(c.get('x')) : c.num('x');
      const y = fns[0].fn({ x, t });
      if (Number.isFinite(y)) c.emit('y', y);
      else { c.emit('y', undefined); c.warn(`y(${fmtNum(x)}) isn’t a finite number.`); }
      c.view({ count: exprs.length, y: Number.isFinite(y) ? y : undefined });
      if (usesT) c.wake(c.tickMs);
    },
    doc: {
      summary: 'Stores one or more equations as data. Route its Equation output to a Meter to draw the graph.',
      runtime: 'The equation is edited only in the right sidebar (inspector); the node just displays it. Parses the expressions with a built-in safe evaluator (no scripts are run) and sends out them with the plot range. Meter samples them over x min…x max and draws the curves on dimmed gray axes. The y(x) output evaluates the first equation at the X input. Equations that use t re-evaluate every tick, so graphs animate in simulation time.',
      errors: ['A syntax error, unknown name, wrong number of arguments or empty equation gives an error that names the problem.', 'x max not greater than x min gives an error.', 'y(x) not being a finite number (for example sqrt of a negative) gives a warning and clears the y output; the graph shows a gap there.'],
      examples: ['sin(x)', 'y = x^2 - 3x + 1', 'sin(x); cos(x) (two curves)', 'sin(x - 2t) (a travelling wave)', 'exp(-x^2/4) * cos(3x)'],
    },
  },
  {
    ...chipBase, type: 'event', name: 'Send Event', caption: 'Event Sender', glyph: '⚑', chip: (p) => String(p.name),
    inputs: [inp('trigger', 'Trigger', 'any', 'A true value fires the event.')], outputs: [out('event', 'Event', 'text', 'The event name, sent once per trigger.')],
    params: [txt('name', 'Event name', 'go', 'The text sent when this is triggered. State machines use it to match transitions.', { maxLength: 80 })],
    run(c) { if (c.changed('trigger') && toBool(c.get('trigger'))) c.emit('event', c.str('name'), c.strength, true); },
    doc: { summary: 'Turns a trigger into a named event that other modules (like State) can react to.', runtime: 'Every true value sends out the event name as an event, even if the previous one was identical.' },
  },
];
