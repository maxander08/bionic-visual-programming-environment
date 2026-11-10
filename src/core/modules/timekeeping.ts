import type { Ctx, ModuleDef } from '../types';
import { cityLabels, deviceTimeZone, findCity, readClock } from '../worldclock';
import { clamp } from '../util';
import { act, bol, inp, num, out, sel, txt } from './kit';

// Timekeeping modules. Timer and Stopwatch measure *simulation* time (the clock in the status bar): they pause when
// the program is paused, reset on Stop and follow the Speed setting. Alarm watches the *real* wall clock of a city,
// exactly like World Clock does.

const pad = (n: number, w = 2) => String(n).padStart(w, '0');

/**
 * Format a duration as `MM:SS`, or `H:MM:SS` from one hour up; milliseconds add `.mmm`.
 * Without milliseconds the value is rounded up for countdowns (so 0:00 only appears at zero) and down for counting up.
 */
export function fmtDuration(ms: number, millis = false, round: 'floor' | 'ceil' = 'floor'): string {
  const v = Math.max(0, Math.round(ms));
  const t = millis ? v : (round === 'ceil' ? Math.ceil(v / 1000) : Math.floor(v / 1000)) * 1000;
  const h = Math.floor(t / 3600000), m = Math.floor(t / 60000) % 60, s = Math.floor(t / 1000) % 60;
  return `${h ? `${h}:${pad(m)}` : pad(m)}:${pad(s)}${millis ? '.' + pad(t % 1000, 3) : ''}`;
}

/** The control commands shared by Timer and Stopwatch, collected from the command button, the node button and the input pins. */
function commands(c: Ctx, pins: Record<string, string>): string[] {
  const list: string[] = [];
  if (c.command) list.push(c.command);
  // A pin counts on its rising edge only, so a held-high signal does not keep restarting the module.
  for (const [port, cmd] of Object.entries(pins)) if (c.changed(port) && c.get(port) === true) list.push(cmd);
  return list;
}

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DAY_OPTIONS: [string, string][] = [
  ['daily', 'Every day'], ['weekdays', 'Weekdays (Mon–Fri)'], ['weekends', 'Weekends (Sat–Sun)'],
  ['mon', 'Mondays'], ['tue', 'Tuesdays'], ['wed', 'Wednesdays'], ['thu', 'Thursdays'], ['fri', 'Fridays'], ['sat', 'Saturdays'], ['sun', 'Sundays'],
];
export const DAY_LABEL: Record<string, string> = Object.fromEntries(DAY_OPTIONS);

/** Does the alarm's Days setting include the given day number (days since 1970-01-01, a Thursday)? */
export function dayAllowed(days: string, dayIndex: number): boolean {
  const wd = (((dayIndex + 4) % 7) + 7) % 7; // 0 = Sunday
  switch (days) {
    case 'weekdays': return wd >= 1 && wd <= 5;
    case 'weekends': return wd === 0 || wd === 6;
    case 'daily': return true;
    default: return WEEKDAYS[wd].toLowerCase() === days;
  }
}

const fmtMoment = (localSeconds: number) => {
  const d = new Date(localSeconds * 1000); // "local wall clock as UTC": read it with the UTC getters
  const sec = d.getUTCSeconds();
  return `${WEEKDAYS[d.getUTCDay()]} ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}${sec ? ':' + pad(sec) : ''}`;
};

const EDGE = 'Acts on the rising edge: when the signal turns true, not while it stays true.';

/** Timer: counts down from a duration and signals when it reaches zero. */
export const timer: ModuleDef = {
  type: 'timer', name: 'Timer', caption: 'Timer', category: 'Timekeeping', family: 'info', glyph: '⏲', size: 'tall',
  keywords: 'countdown count down timeout delay interval minutes seconds hours egg kitchen stopwatch remaining finish done expire',
  inputs: [
    inp('start', 'Start', 'bool', `Starts the countdown, or resumes it after a pause or a finish. ${EDGE}`, 'top', true),
    inp('pause', 'Pause', 'bool', `Freezes the countdown where it is. Start continues from there. ${EDGE}`, 'top', true),
    inp('reset', 'Reset', 'bool', `Stops the countdown and puts the full duration back. ${EDGE}`, 'top', true),
  ],
  outputs: [
    out('time', 'Time', 'text', 'Time left, such as “01:30” (or “1:00:00” from one hour). Shows milliseconds when Show milliseconds is on.'),
    out('done', 'Done', 'bool', 'True once the countdown has reached zero; false again after Start or Reset. With Repeat on it is a short pulse at each zero.'),
    out('progress', 'Progress', 'num', 'How much of the duration has elapsed, from 0 (just started) to 1 (finished).'),
    out('remaining', 'Remaining', 'num', 'Seconds left, with milliseconds as decimals (9.95).', 'right'),
    out('running', 'Running', 'bool', 'True while the countdown is counting; false when idle, paused or finished.', 'right'),
  ],
  params: [
    num('hours', 'Hours', 0, 0, 99, 1, 'Hours of the countdown duration. The duration is Hours + Minutes + Seconds.', 'h'),
    num('minutes', 'Minutes', 0, 0, 59, 1, 'Minutes of the countdown duration.', 'min'),
    num('seconds', 'Seconds', 10, 0, 59, 1, 'Seconds of the countdown duration.', 's'),
    bol('autostart', 'Start automatically', true, 'Begin counting as soon as the program runs. Turn it off to wait for the Start pin or the START button.'),
    bol('repeat', 'Repeat', false, 'At zero, signal Done and immediately count down again from the full duration. Off: stop at zero and stay done.'),
    bol('millis', 'Show milliseconds', false, 'Show milliseconds in the Time output (01:29.950) instead of whole seconds. Remaining and Progress update every tick either way.'),
    act('startNow', 'START', 'start', 'Start or resume the countdown now (the program must be running).'),
    act('pauseNow', 'PAUSE', 'pause', 'Freeze the countdown now.'),
    act('resetNow', 'RESET', 'reset', 'Stop and restore the full duration now.'),
  ],
  source: true,
  delaying: true,
  run(c) {
    const s = c.state;
    const total = Math.round((c.num('hours') * 3600 + c.num('minutes') * 60 + c.num('seconds')) * 1000);
    const millis = c.bool('millis');
    const first = s.status === undefined;
    if (first) Object.assign(s, { status: 'idle', total, left: total, runs: 0, pulseUntil: undefined });

    // 1. Time that passed while it was counting.
    if (s.status === 'running') s.left -= c.dt;

    // 2. A changed duration (inspector or setting pin) moves a running timer by the difference, and refills an idle one.
    if (total !== s.total) {
      if (s.status === 'running' || s.status === 'paused') s.left = Math.max(0, s.left + total - s.total);
      else if (s.status === 'idle') s.left = total;
      s.total = total;
    }

    // 3. Commands: the program start (Start automatically), buttons and pins. Reset, then Pause, then Start.
    const cmds = commands(c, { reset: 'reset', pause: 'pause', start: 'start' });
    if (first && c.bool('autostart')) cmds.push('start');
    for (const cmd of cmds) {
      const run = cmd === 'toggle' ? (s.status === 'running' ? 'pause' : 'start') : cmd;
      if (run === 'reset') { s.status = 'idle'; s.left = total; s.pulseUntil = undefined; }
      else if (run === 'pause') { if (s.status === 'running') s.status = 'paused'; }
      else if (run === 'start') {
        if (total <= 0) continue;
        if (s.status === 'done') s.left = total;
        if (s.status === 'idle' && s.left <= 0) s.left = total;
        s.status = 'running';
        s.pulseUntil = undefined;
      }
    }
    if (total <= 0 && s.status !== 'running') c.warn('Set a duration above zero with Hours, Minutes or Seconds.');

    // 4. Reaching zero.
    let finished = false;
    if (s.status === 'running' && s.left <= 0) {
      finished = true;
      s.runs++;
      if (c.bool('repeat') && total > 0) {
        s.left = s.left + total > 0 ? s.left + total : total; // keep the overshoot so repeats do not drift
        s.pulseUntil = c.time + Math.max(c.tickMs * 2, 100);
      } else { s.left = 0; s.status = 'done'; }
    }
    const pulsing = s.pulseUntil !== undefined && c.time < s.pulseUntil;
    if (!pulsing) s.pulseUntil = undefined;

    // 5. Outputs.
    const left = Math.max(0, s.left);
    const progress = total > 0 ? clamp(1 - left / total, 0, 1) : s.status === 'done' ? 1 : 0;
    const time = fmtDuration(left, millis, 'ceil');
    c.emit('time', time);
    c.emit('done', s.status === 'done' || pulsing, undefined, finished);
    c.emit('progress', Math.round(progress * 10000) / 10000);
    c.emit('remaining', Math.round(left) / 1000);
    c.emit('running', s.status === 'running');
    c.view({ time, status: s.status, progress, done: s.status === 'done', runs: s.runs });

    // 6. Next wake-up: next tick while counting (or exactly at zero), or the end of the pulse.
    if (s.status === 'running') {
      let w = Math.min(c.tickMs, left); // every tick: Remaining and Progress are smooth numbers, only the text is coarse
      if (pulsing) w = Math.min(w, s.pulseUntil - c.time);
      c.wake(Math.max(w, 1));
    } else if (pulsing) c.wake(Math.max(s.pulseUntil - c.time, 1));
  },
  doc: {
    summary: 'Counts down from a duration you set and signals when it reaches zero.',
    runtime: 'Measured in simulation time, the clock in the status bar: it pauses when the program is paused, goes back to zero on Stop and follows the Speed setting. The duration is Hours + Minutes + Seconds. With Start automatically on, the countdown begins when the program runs; otherwise Start (pin or button) begins it. Pause freezes it, Reset restores the full duration. At zero Done turns true and stays true (or pulses and restarts when Repeat is on). Changing the duration while it counts moves the remaining time by the same amount.',
    errors: ['A duration of zero warns and the timer stays idle: set Hours, Minutes or Seconds.'],
    examples: ['Timer Done → Counter Increment: count how many countdowns have finished (turn Repeat on).', 'Switch → Timer Start, Timer Done → Notify: a kitchen timer that sends a notification.', 'Timer Progress → Light: a light that fills up while the countdown runs.'],
  },
};

/** Stopwatch: counts up, records laps, and can stop at a limit. */
export const stopwatch: ModuleDef = {
  type: 'stopwatch', name: 'Stopwatch', caption: 'Stopwatch', category: 'Timekeeping', family: 'info', glyph: '⏱', size: 'square',
  keywords: 'count up elapsed lap split chrono chronometer measure duration time seconds start stop reset race',
  inputs: [
    inp('start', 'Start', 'bool', `Starts the stopwatch, or resumes it after a stop. ${EDGE}`, 'top', true),
    inp('stop', 'Stop', 'bool', `Stops counting and keeps the elapsed time. Start resumes from it. ${EDGE}`, 'top', true),
    inp('lap', 'Lap', 'bool', `Records a lap: the time since the previous lap (or since the start). Ignored while stopped. ${EDGE}`, 'top', true),
    inp('reset', 'Reset', 'bool', `Stops the stopwatch, sets the elapsed time to zero and forgets the laps. ${EDGE}`, 'top', true),
  ],
  outputs: [
    out('time', 'Time', 'text', 'Elapsed time, such as “01:30” (or “1:00:00” from one hour). Shows milliseconds when Show milliseconds is on.'),
    out('elapsed', 'Elapsed', 'num', 'Seconds elapsed, with milliseconds as decimals (12.35).'),
    out('running', 'Running', 'bool', 'True while the stopwatch is counting.'),
    out('laps', 'Laps', 'num', 'How many laps have been recorded since the last reset.', 'right'),
    out('lap', 'Last lap', 'num', 'Length in seconds of the most recent lap. It has no signal until the first lap.', 'right'),
  ],
  params: [
    bol('autostart', 'Start automatically', true, 'Begin counting as soon as the program runs. Turn it off to wait for the Start pin or the START button.'),
    bol('millis', 'Show milliseconds', true, 'Show milliseconds in the Time output (01:29.950) instead of whole seconds. Elapsed updates every tick either way.'),
    num('limit', 'Stop at', 0, 0, 359999, 1, 'Stop automatically when this many seconds have elapsed. 0 means never.', 's'),
    act('startNow', 'START', 'start', 'Start or resume the stopwatch now (the program must be running).'),
    act('stopNow', 'STOP', 'stop', 'Stop counting now and keep the elapsed time.'),
    act('lapNow', 'LAP', 'lap', 'Record a lap now.'),
    act('resetNow', 'RESET', 'reset', 'Stop, set zero and forget the laps now.'),
  ],
  source: true,
  delaying: true,
  run(c) {
    const s = c.state;
    const millis = c.bool('millis');
    const limit = c.num('limit') * 1000;
    const first = s.status === undefined;
    if (first) Object.assign(s, { status: 'idle', elapsed: 0, laps: 0, mark: 0, lastLap: undefined, lapList: [] as string[] });

    if (s.status === 'running') s.elapsed += c.dt;

    const cmds = commands(c, { reset: 'reset', stop: 'stop', start: 'start', lap: 'lap' });
    if (first && c.bool('autostart')) cmds.push('start');
    let lapped = false;
    const reached = () => limit > 0 && s.elapsed >= limit;
    for (const cmd of cmds) {
      const run = cmd === 'toggle' ? (s.status === 'running' ? 'stop' : 'start') : cmd;
      if (run === 'reset') Object.assign(s, { status: 'idle', elapsed: 0, laps: 0, mark: 0, lastLap: undefined, lapList: [] });
      else if (run === 'stop') { if (s.status === 'running') s.status = 'stopped'; }
      else if (run === 'start') { if (!reached()) s.status = 'running'; }
      else if (run === 'lap' && s.status === 'running') {
        const span = s.elapsed - s.mark;
        s.mark = s.elapsed;
        s.laps++;
        s.lastLap = span;
        s.lapList = [...s.lapList, fmtDuration(span, true)].slice(-20);
        lapped = true;
      }
    }

    if (s.status === 'running' && reached()) { s.elapsed = limit; s.status = 'stopped'; }

    const time = fmtDuration(s.elapsed, millis, 'floor');
    c.emit('time', time);
    c.emit('elapsed', Math.round(s.elapsed) / 1000);
    c.emit('running', s.status === 'running');
    c.emit('laps', s.laps, undefined, lapped);
    c.emit('lap', s.lastLap === undefined ? undefined : Math.round(s.lastLap) / 1000, undefined, lapped);
    c.view({ time, status: s.status, laps: s.laps, last: s.lapList[s.lapList.length - 1], limit: limit > 0 && reached() });

    if (s.status === 'running') {
      let w: number = c.tickMs;
      if (limit > 0) w = Math.min(w, limit - s.elapsed);
      c.wake(Math.max(w, 1));
    }
  },
  doc: {
    summary: 'Counts elapsed time upwards, records laps, and can stop by itself at a limit.',
    runtime: 'Measured in simulation time, the clock in the status bar: it pauses when the program is paused, goes back to zero on Stop and follows the Speed setting. With Start automatically on it counts from the moment the program runs; otherwise Start (pin or button) begins it. Stop keeps the elapsed time and Start resumes from it. Lap records the time since the previous lap; Last lap and Laps update only when a lap is recorded. Reset sets zero and forgets the laps. With Stop at above 0 it stops by itself at that time.',
    examples: ['Keys → Stopwatch Lap: press a key to record a lap.', 'Switch → Stopwatch Start/Stop with Elapsed → Projector: time how long a switch stays on.', 'Stopwatch Elapsed → Threshold: react once 30 seconds have passed.'],
  },
};

/** Alarm: rings at a time of day in a chosen city (or on this device), on chosen days. */
export const alarm: ModuleDef = {
  type: 'alarm', name: 'Alarm', caption: 'Alarm', category: 'Timekeeping', family: 'info', glyph: '⏰', size: 'tall',
  keywords: 'wake up ring bell alert reminder schedule time of day clock snooze daily weekday notify buzzer',
  inputs: [
    inp('snooze', 'Snooze', 'bool', `Silences a ringing alarm and rings again after the Snooze setting. ${EDGE}`, 'top', true),
    inp('dismiss', 'Dismiss', 'bool', `Silences a ringing alarm. The next scheduled time is unchanged. ${EDGE}`, 'top', true),
  ],
  outputs: [
    out('ringing', 'Ringing', 'bool', 'True while the alarm rings: from the alarm time for Ring duration seconds, until it is dismissed or snoozed.'),
    out('left', 'Time left', 'text', 'Time until the next ring, such as “07:29:45” (hours may pass 24). “Off” when the alarm is not armed.'),
    out('next', 'Next ring', 'text', 'Date and time of the next ring in the alarm’s time zone, such as “Thu 12 Mar 07:30”.'),
    out('seconds', 'Seconds left', 'num', 'Seconds until the next ring. It has no signal while the alarm is off.', 'right'),
    out('rings', 'Rings', 'num', 'How many times the alarm has rung since the program started.', 'right'),
  ],
  params: [
    num('hour', 'Hour', 7, 0, 23, 1, 'Hour of the day at which the alarm rings, 0–23 (24-hour clock).', 'h'),
    num('minute', 'Minute', 30, 0, 59, 1, 'Minute of the hour at which the alarm rings.', 'min'),
    sel('days', 'Days', 'daily', DAY_OPTIONS, 'Which days of the week the alarm may ring on.'),
    txt('city', 'City', '', 'City whose clock decides when the alarm rings. Leave it empty to use this device’s own time zone. Type to see suggestions; write “Paris, France” when a name exists in several countries.', { maxLength: 80, placeholder: 'empty = this device', suggest: cityLabels }),
    bol('armed', 'Armed', true, 'Switch the alarm on or off. An alarm that is off never rings and shows “Off”.'),
    bol('once', 'Only once', false, 'Ring a single time, then switch itself off until Armed is turned off and on again (or the program is stopped and run again).'),
    num('duration', 'Ring duration', 10, 0.5, 3600, 0.5, 'How long Ringing stays true when nobody dismisses or snoozes the alarm.', 's'),
    num('snooze', 'Snooze', 5, 0, 120, 1, 'Minutes until the alarm rings again after Snooze. 0 behaves like Dismiss.', 'min'),
    act('testNow', 'TEST', 'test', 'Ring now, to check what is connected to Ringing (the program must be running).'),
    act('snoozeNow', 'SNOOZE', 'snooze', 'Silence the alarm and ring again after the Snooze time.'),
    act('dismissNow', 'DISMISS', 'dismiss', 'Silence the alarm now.'),
  ],
  source: true,
  delaying: true,
  run(c) {
    const s = c.state;
    const query = c.str('city').trim();
    let tz = deviceTimeZone(), place = 'This device';
    if (query) {
      const city = findCity(query);
      if (!city) {
        c.view({});
        return c.fail(`Unknown city “${query}”. Pick one from the suggestions, or leave City empty to use this device’s time zone.`);
      }
      tz = city.tz; place = city.name;
    }
    let r;
    try { r = readClock(tz, Date.now(), false, true, true); } catch { return c.fail(`This browser does not know the time zone ${tz}.`); }

    const now = r.local / 1000; // seconds on the alarm's own wall clock
    const hour = Math.floor(c.num('hour')), minute = Math.floor(c.num('minute'));
    const target = hour * 3600 + minute * 60;
    const days = c.str('days');
    const armed = c.bool('armed');
    const first = s.last === undefined;
    if (first) Object.assign(s, { last: now, zone: tz, rings: 0, ringing: false, ringUntil: 0, spent: false, snoozeAt: undefined });
    // Another city is another clock: do not ring for the time that "passed" between the two.
    if (s.zone !== tz) { s.zone = tz; s.last = now; s.snoozeAt = undefined; }
    if (!armed) { s.spent = false; s.snoozeAt = undefined; }

    let rang = false;
    const cmds = commands(c, { dismiss: 'dismiss', snooze: 'snooze' });
    for (const cmd of cmds) {
      if (cmd === 'dismiss') s.ringing = false;
      else if (cmd === 'snooze') {
        const wasRinging = s.ringing;
        s.ringing = false;
        if (wasRinging && c.num('snooze') > 0) s.snoozeAt = now + c.num('snooze') * 60;
      } else if (cmd === 'test') rang = true;
    }

    // Did the clock pass the alarm time since the last run? Checked over the last day or two, so a late run never misses it.
    if (armed) {
      if (!s.spent) {
        const d1 = Math.floor(now / 86400), d0 = Math.max(Math.floor(s.last / 86400), d1 - 1);
        for (let d = d0; d <= d1; d++) {
          const t = d * 86400 + target;
          if (dayAllowed(days, d) && s.last < t && t <= now) { rang = true; if (c.bool('once')) s.spent = true; }
        }
      }
      if (s.snoozeAt !== undefined && s.last < s.snoozeAt && s.snoozeAt <= now) { rang = true; s.snoozeAt = undefined; }
    }
    s.last = now;

    if (rang) { s.ringing = true; s.ringUntil = c.time + c.num('duration') * 1000; s.rings++; }
    else if (s.ringing && c.time >= s.ringUntil) s.ringing = false;

    // The next ring: the next allowed day's alarm time, or a pending snooze if that comes first.
    let next: number | undefined;
    if (armed) {
      if (!s.spent) {
        for (let i = 0; i <= 7; i++) {
          const d = Math.floor(now / 86400) + i, t = d * 86400 + target;
          if (t > now && dayAllowed(days, d)) { next = t; break; }
        }
      }
      if (s.snoozeAt !== undefined && (next === undefined || s.snoozeAt < next)) next = s.snoozeAt;
    }
    const left = next === undefined ? 'Off' : fmtDuration((next - now) * 1000, false, 'ceil');
    const nextText = next === undefined ? (armed ? 'Spent' : 'Off') : fmtMoment(next);
    c.emit('ringing', s.ringing, undefined, rang);
    c.emit('left', left);
    c.emit('next', nextText);
    c.emit('seconds', next === undefined ? undefined : Math.ceil(next - now));
    c.emit('rings', s.rings, undefined, rang);
    c.view({
      at: `${pad(hour)}:${pad(minute)}`, place, left, next: nextText, ringing: s.ringing, armed, spent: s.spent, days, snoozing: s.snoozeAt !== undefined,
      zone: tz, now: r.time,
    });

    let w = 1000 - (Date.now() % 1000) + 5;
    if (s.ringing) w = Math.min(w, s.ringUntil - c.time);
    c.wake(Math.max(w, 1));
  },
  doc: {
    summary: 'Rings at a chosen time of day, in a city’s time zone or on this device, on the days you pick.',
    runtime: 'Reads the real clock, converted with the time zone of the City (or of this device when City is empty), so daylight saving is applied. When the clock passes Hour:Minute on an allowed day, Ringing turns true for Ring duration seconds, or until Dismiss or Snooze. Snooze rings again after the Snooze minutes. Time left, Next ring and Seconds left always describe the next ring. The check runs about once a second, so the alarm rings within a second of its time. A paused program does not ring; if it is resumed after the alarm time it rings at once.',
    errors: ['A city name that is not in the list raises an error and clears the outputs.', 'A browser without the needed time-zone data raises an error.'],
    examples: ['Alarm Ringing → Audio Gate: a sound at 07:30 every weekday.', 'Alarm Ringing → Notify Trigger: a notification when the alarm rings.', 'Keys → Alarm Snooze: tap a key to snooze.'],
  },
};
