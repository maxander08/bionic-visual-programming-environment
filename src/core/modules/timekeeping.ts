import type { Ctx, ModuleDef } from '../types';
import { toBool } from '../util';
import { cityLabels, findCity } from '../worldclock';
import { fmtDuration, fmtTimeOfDay, localParts, msUntilRing, parseTimeOfDay, ringsOn, splitDuration } from '../timekeeping';
import { worldClock } from './clock';
import { act, bol, inp, num, out, sel, timeParts, txt } from './kit';

// The Timekeeping section. Every module here is a "square" module, the same size as the Text display.
// Timer and Stopwatch measure simulation time (they pause with the program); Alarm and World Clock read the real clock.
// A square holds at most 5 output pins on its bottom edge and 4 on its right edge, which is why the Timer (10 outputs) is one pin row taller.
// Every module here works to the millisecond: its Time text carries milliseconds by default, and Hour, Minute, Seconds and
// Milliseconds are separate output pins (the World Clock's pin set), always exact whatever the Show milliseconds setting.
const base = { category: 'Timekeeping' as const, family: 'timekeeping' as const, size: 'square' as const, delaying: true, source: true };

/** A truthy value that just arrived on an input: the "button press" of a signal. */
const pressed = (c: Ctx, port: string) => c.changed(port) && toBool(c.get(port));
const r3 = (x: number) => Math.round(x * 1000) / 1000;

/** Timer: counts down from a duration and signals when it reaches zero. */
export const timer: ModuleDef = {
  ...base, type: 'timer', name: 'Timer', caption: 'Countdown Timer', glyph: '⏲',
  keywords: 'countdown count down delay timeout interval repeat remaining finish done egg cooking',
  inputs: [
    inp('start', 'Start', 'any', 'A truthy arrival starts the countdown, resumes it when paused, or restarts it once it has finished.', 'top', true),
    inp('pause', 'Pause', 'any', 'While true the countdown is held. Release it and the countdown goes on from where it stopped.', 'top', true),
    inp('reset', 'Reset', 'any', 'A truthy arrival stops the timer and sets it back to the full duration.', 'top', true),
  ],
  outputs: [
    out('time', 'Time', 'text', 'Time left as MM:SS.mmm (HH:MM:SS.mmm from one hour), counting down. The Show milliseconds setting can drop the milliseconds from this text.'),
    out('remaining', 'Remaining', 'num', 'Seconds left, with millisecond precision.'),
    out('done', 'Done', 'bool', 'True when the countdown has finished and stays true until Start or Reset. With Repeat on it is a short pulse (at least one tick) every time a round ends.'),
    out('running', 'Running', 'bool', 'True while the countdown is moving: not stopped, not paused and not finished.'),
    out('progress', 'Progress', 'num', 'How much of the duration has passed, from 0 (just started) to 1 (finished).'),
    ...timeParts('time left'),
    out('count', 'Completions', 'num', 'How many times the countdown has reached zero since the program started.', 'right'),
  ],
  params: [
    num('duration', 'Duration', 60, 0.1, 359999, 0.1, 'How long the countdown lasts. It follows this setting while the timer is waiting; a countdown that is already running keeps its length until it restarts.', 's'),
    bol('autostart', 'Auto start', true, 'Begin counting down as soon as the program runs. Turn it off to wait for the Start pin or the START button.'),
    bol('repeat', 'Repeat', false, 'When the countdown ends, start it again at once instead of stopping.'),
    bol('millis', 'Show milliseconds', true, 'Add milliseconds to the Time output (04:59.250). Without them the text rounds up, so it reads 00:01 until the very end. The Hour, Minute, Seconds and Milliseconds pins are always exact.'),
    act('startNow', 'START', 'start', 'Start, resume or restart the countdown now.'),
    act('pauseNow', 'PAUSE / RESUME', 'pause', 'Hold the countdown, or let it go on.'),
    act('resetNow', 'RESET', 'reset', 'Stop and set the timer back to the full duration.'),
  ],
  run(c) {
    const s = c.state;
    const dur = Math.round(c.num('duration') * 1000);
    if (s.phase === undefined) { s.phase = c.bool('autostart') ? 'running' : 'idle'; s.left = dur; s.dur = dur; s.at = c.time; s.count = 0; s.pulseUntil = -1; }
    const held = c.has('pause') && toBool(c.get('pause'));
    const elapsed = c.time - s.at;
    s.at = c.time;
    if (s.phase === 'running' && !held) s.left -= elapsed;
    const cmd = c.command;
    if (pressed(c, 'reset') || cmd === 'reset') {
      s.phase = 'idle'; s.dur = dur; s.left = dur; s.pulseUntil = -1;
    } else {
      if (s.phase === 'idle' && s.dur !== dur) { s.dur = dur; s.left = dur; }
      if (cmd === 'pause') { if (s.phase === 'running') s.phase = 'paused'; else if (s.phase === 'paused') s.phase = 'running'; }
      if (pressed(c, 'start') || cmd === 'start') {
        if (s.phase === 'idle' || s.phase === 'paused') s.phase = 'running';
        else if (s.phase === 'done') { s.phase = 'running'; s.dur = dur; s.left = dur; }
      }
    }
    if (s.phase === 'running' && s.left <= 0) {
      const over = -s.left;
      s.count++;
      if (c.bool('repeat')) {
        const laps = Math.floor(over / s.dur);
        s.count += laps;
        s.dur = dur;
        s.left = dur - (over % dur);
        s.pulseUntil = c.time + Math.max(c.tickMs, 100);
      } else { s.phase = 'done'; s.left = 0; }
    }
    const running = s.phase === 'running' && !held;
    const pulse = c.time < s.pulseUntil;
    const time = fmtDuration(s.left, { millis: c.bool('millis'), round: 'ceil', hours: s.dur >= 3600000 });
    const progress = s.phase === 'done' ? 1 : s.dur > 0 ? Math.min(1, Math.max(0, 1 - s.left / s.dur)) : 1;
    c.emit('time', time);
    c.emit('remaining', r3(Math.max(0, s.left) / 1000));
    const parts = splitDuration(s.left);
    c.emit('hour', parts.hour);
    c.emit('minute', parts.minute);
    c.emit('second', parts.second);
    c.emit('millisecond', parts.millisecond);
    c.emit('done', s.phase === 'done' || pulse);
    c.emit('running', running);
    c.emit('progress', r3(progress));
    c.emit('count', s.count);
    c.view({ time, state: held && s.phase === 'running' ? 'paused' : s.phase, progress, count: s.count });
    let wake = Infinity;
    if (running) wake = Math.min(c.tickMs, s.left);
    if (pulse) wake = Math.min(wake, s.pulseUntil - c.time);
    if (wake < Infinity) c.wake(Math.max(1, wake));
  },
  doc: {
    summary: 'Counts down from a set duration, shows the time left and signals when it reaches zero.',
    runtime: 'Measures simulation time, so it pauses when the program pauses and starts over on Stop → Run. With Auto start on (the default) it begins counting at once; otherwise it waits for a truthy arrival on Start. Pause holds it while true, Reset sets it back to the full duration and stops it. At zero, Done turns true and stays true until Start or Reset; with Repeat on, Done is instead a short pulse and the countdown begins again, carrying over any time that was left over from the tick. It counts to the millisecond: Time shows milliseconds (unless Show milliseconds is off, which rounds the text up to whole seconds), and Hour, Minute, Seconds and Milliseconds are separate outputs of the time left, refreshed every tick while it runs.',
    errors: ['A Duration driven from a pin that carries no number is ignored and the inspector value is used.'],
    examples: ['Timer Done → Notify: get a message after 5 minutes.', 'Timer Milliseconds → Threshold: react in the last half second of a countdown.', 'Timer Progress → Meter: watch a countdown bar fill.', 'Timer Done → its own Reset pin through a Delay: a timer that restarts after a pause.'],
  },
};

/** Stopwatch: counts up, with laps. */
export const stopwatch: ModuleDef = {
  ...base, type: 'stopwatch', name: 'Stopwatch', caption: 'Stopwatch', glyph: '⏱',
  keywords: 'chronometer count up elapsed lap split time measure duration race',
  inputs: [
    inp('start', 'Start', 'any', 'A truthy arrival starts the stopwatch or resumes it.', 'top', true),
    inp('stop', 'Stop', 'any', 'A truthy arrival stops the stopwatch and keeps the time reached.', 'top', true),
    inp('lap', 'Lap', 'any', 'A truthy arrival records a lap while the stopwatch is running: the time since the previous lap (or the start).', 'top', true),
    inp('reset', 'Reset', 'any', 'A truthy arrival stops the stopwatch, sets it to zero and forgets the laps.', 'top', true),
  ],
  outputs: [
    out('time', 'Time', 'text', 'Elapsed time as MM:SS.mmm (HH:MM:SS.mmm from one hour). The Show milliseconds setting can drop the milliseconds from this text.'),
    out('elapsed', 'Elapsed', 'num', 'Seconds counted so far, with millisecond precision.'),
    out('running', 'Running', 'bool', 'True while the stopwatch is counting.'),
    out('lap', 'Lap time', 'num', 'Seconds of the latest lap, with millisecond precision. It has no value until the first lap and is cleared by Reset.'),
    out('laps', 'Laps', 'num', 'How many laps have been recorded.'),
    ...timeParts('elapsed time'),
  ],
  params: [
    bol('autostart', 'Auto start', true, 'Begin counting as soon as the program runs. Turn it off to wait for the Start pin or the START / STOP button.'),
    bol('millis', 'Show milliseconds', true, 'Add milliseconds to the Time output (01:05.250). The Hour, Minute, Seconds and Milliseconds pins are always exact.'),
    num('limit', 'Stop at', 0, 0, 359999, 1, 'The stopwatch stops by itself when it reaches this many seconds. 0 means no limit.', 's'),
    act('toggleNow', 'START / STOP', 'toggle', 'Start the stopwatch, or stop it when it is running.'),
    act('lapNow', 'LAP', 'lap', 'Record a lap now.'),
    act('resetNow', 'RESET', 'reset', 'Stop, set to zero and forget the laps.'),
  ],
  run(c) {
    const s = c.state;
    if (s.phase === undefined) { s.phase = c.bool('autostart') ? 'running' : 'stopped'; s.ms = 0; s.at = c.time; s.laps = 0; s.mark = 0; s.last = undefined; s.hit = false; }
    const elapsed = c.time - s.at;
    s.at = c.time;
    if (s.phase === 'running') s.ms += elapsed;
    const limit = Math.round(c.num('limit') * 1000);
    if (limit > 0 && s.phase === 'running' && s.ms >= limit) { s.ms = limit; s.phase = 'stopped'; s.hit = true; }
    const cmd = c.command;
    if (pressed(c, 'reset') || cmd === 'reset') {
      s.phase = 'stopped'; s.ms = 0; s.laps = 0; s.mark = 0; s.last = undefined; s.hit = false;
    } else {
      if ((pressed(c, 'lap') || cmd === 'lap') && s.phase === 'running') { s.last = s.ms - s.mark; s.mark = s.ms; s.laps++; }
      if (pressed(c, 'stop') || (cmd === 'toggle' && s.phase === 'running')) s.phase = 'stopped';
      else if ((pressed(c, 'start') || cmd === 'toggle') && s.phase === 'stopped') {
        if (s.hit || (limit > 0 && s.ms >= limit)) { s.ms = 0; s.laps = 0; s.mark = 0; s.last = undefined; s.hit = false; }
        s.phase = 'running';
      }
    }
    const millis = c.bool('millis');
    const time = fmtDuration(s.ms, { millis, round: 'floor' });
    c.emit('time', time);
    c.emit('elapsed', r3(s.ms / 1000));
    const parts = splitDuration(s.ms);
    c.emit('hour', parts.hour);
    c.emit('minute', parts.minute);
    c.emit('second', parts.second);
    c.emit('millisecond', parts.millisecond);
    c.emit('running', s.phase === 'running');
    c.emit('lap', s.last === undefined ? undefined : r3(s.last / 1000));
    c.emit('laps', s.laps);
    c.view({ time, state: s.hit && s.phase === 'stopped' ? 'limit' : s.phase, lap: s.last === undefined ? '' : fmtDuration(s.last, { millis, round: 'floor' }), laps: s.laps });
    if (s.phase === 'running') {
      let wake = c.tickMs;
      if (limit > 0) wake = Math.min(wake, limit - s.ms);
      c.wake(Math.max(1, wake));
    }
  },
  doc: {
    summary: 'Counts elapsed time upwards, with start, stop, lap and reset controls.',
    runtime: 'Measures simulation time, so it pauses when the program pauses and starts over on Stop → Run. With Auto start on (the default) it counts from the moment the program runs. A truthy arrival on Start runs it, on Stop holds it, on Lap records a lap and on Reset clears it. A lap is the time since the previous lap, or since zero for the first. It counts to the millisecond: Time shows milliseconds (unless Show milliseconds is off), and Hour, Minute, Seconds and Milliseconds are separate outputs of the elapsed time, refreshed every tick while it runs. With Stop at above 0 it stops by itself at that time; Start then begins a fresh run.',
    examples: ['Switch → Stopwatch Start / Stop (through two Compare modules): time how long a switch stays on.', 'Keys → Stopwatch Lap: record a lap every time a key is pressed.', 'Stopwatch Elapsed → Threshold: react after 30 seconds.', 'Stopwatch Minute and Seconds → Text displays: show your own clock face.'],
  },
};

const REPEAT: [string, string][] = [['once', 'Once (next time it is reached)'], ['daily', 'Every day'], ['weekdays', 'Weekdays (Mon–Fri)'], ['weekends', 'Weekends (Sat–Sun)']];
const SNOOZE_MS = 5 * 60 * 1000;

/** Alarm: rings at a time of day, in this device's zone or in any city's. */
export const alarm: ModuleDef = {
  ...base, type: 'alarm', name: 'Alarm', caption: 'Alarm Clock', glyph: '⏰',
  keywords: 'wake up ring bell reminder schedule time of day clock snooze ringing notify daily weekday',
  inputs: [
    inp('dismiss', 'Dismiss', 'any', 'A truthy arrival silences a ringing alarm and cancels a pending snooze.', 'top', true),
    inp('snooze', 'Snooze', 'any', 'A truthy arrival silences a ringing alarm; it rings again 5 minutes later.', 'top', true),
  ],
  outputs: [
    out('ringing', 'Ringing', 'bool', 'True while the alarm is ringing: from the alarm time until the Ring time has passed or it is dismissed or snoozed.'),
    out('countdown', 'Time left', 'text', 'Time until the next ring, such as 07:12:30.250 (or 1d 02:00:00.000). Empty when the alarm will not ring again.'),
    out('seconds', 'Seconds left', 'num', 'The whole time left in seconds, with millisecond precision. It has no value when the alarm will not ring again.'),
    out('next', 'Next ring', 'text', 'When the next ring happens, as in “Thu 12 Mar, 07:30:00.000”, in the alarm’s own time zone.'),
    out('count', 'Rings', 'num', 'How many times the alarm has rung since the program started.'),
    ...timeParts('time left until the next ring'),
  ],
  params: [
    txt('time', 'Time', '07:30', 'Time of day to ring, by the clock of the chosen city (or of this device). Write 07:30, 19:45:30, 19:45:30.250 (with milliseconds) or 7:30 pm.', { maxLength: 16, placeholder: 'e.g. 07:30:00.000 or 7:30 pm' }),
    sel('repeat', 'Repeat', 'daily', REPEAT, 'Which days the alarm rings. “Once” rings the next time the time is reached and then stays quiet until a setting changes.'),
    txt('city', 'City', '', 'Optional. A city whose clock sets the alarm, as in the World Clock module. Leave it empty to use this device’s time zone.', { maxLength: 80, placeholder: 'This device (leave empty)', suggest: cityLabels }),
    num('ring', 'Ring time', 10, 1, 3600, 1, 'How long Ringing stays true when nobody dismisses the alarm. It is counted in simulation time.', 's'),
    act('testNow', 'TEST RING', 'test', 'Ring right now to try what the alarm drives.'),
    act('snoozeNow', 'SNOOZE', 'snooze', 'Silence the alarm; it rings again in 5 minutes.'),
    act('dismissNow', 'DISMISS', 'dismiss', 'Silence the alarm.'),
  ],
  run(c) {
    const s = c.state;
    const query = c.str('city').trim();
    let tz: string | null = null, place = 'This device';
    if (query) {
      const city = findCity(query);
      if (!city) { c.view({}); return c.fail(`Unknown city “${query}”. Pick one from the suggestions, or leave City empty to use this device’s time zone.`); }
      tz = city.tz; place = city.name;
    }
    const tod = parseTimeOfDay(c.str('time'));
    if (tod === null) { c.view({}); return c.fail(`“${c.str('time').trim()}” is not a time of day. Write it as 07:30, 19:45:30, 19:45:30.250 or 7:30 pm.`); }
    const repeat = c.str('repeat');
    const now = Date.now();
    let lp;
    try { lp = localParts(tz, now); } catch { c.view({}); return c.fail(`This browser does not know the time zone ${tz}.`); }

    // A change to the time, days or zone re-arms the alarm.
    const key = `${tod}|${tz}|${repeat}`;
    if (s.key !== key) {
      if (s.key === undefined) s.count = 0;
      s.key = key; s.done = false; s.ringing = false; s.snoozeAt = undefined;
      s.prev = lp.sod; s.prevDay = lp.dayKey; s.prevWd = lp.weekday;
    }

    if (s.ringing && c.time >= s.ringUntil) s.ringing = false;
    const startRing = () => { s.ringing = true; s.ringUntil = c.time + c.num('ring') * 1000; s.count++; s.snoozeAt = undefined; };

    // The alarm time was crossed since the last look (also after a pause, or across midnight).
    if (!(repeat === 'once' && s.done)) {
      const crossed = s.prevDay === lp.dayKey
        ? ringsOn(repeat, lp.weekday) && s.prev < tod && tod <= lp.sod
        : (ringsOn(repeat, s.prevWd) && s.prev < tod) || (ringsOn(repeat, lp.weekday) && tod <= lp.sod);
      if (crossed) { startRing(); if (repeat === 'once') s.done = true; }
    }
    if (s.snoozeAt !== undefined && now >= s.snoozeAt) startRing();

    const cmd = c.command;
    if (cmd === 'test') startRing();
    if (pressed(c, 'dismiss') || cmd === 'dismiss') { s.ringing = false; s.snoozeAt = undefined; }
    if ((pressed(c, 'snooze') || cmd === 'snooze') && s.ringing) { s.ringing = false; s.snoozeAt = now + SNOOZE_MS; }

    let until: number | undefined = repeat === 'once' && s.done ? undefined : msUntilRing(lp, tod, repeat);
    if (s.snoozeAt !== undefined) { const left = Math.max(0, s.snoozeAt - now); until = until === undefined ? left : Math.min(until, left); }
    let next: string | undefined;
    if (until !== undefined) { const at = localParts(tz, now + until); next = `${at.label}, ${fmtTimeOfDay(at.sod, true)}`; }
    const countdown = until === undefined ? undefined : fmtDuration(until, { millis: true, hours: true });
    const parts = until === undefined ? undefined : splitDuration(until);

    c.emit('ringing', s.ringing);
    c.emit('countdown', countdown);
    c.emit('seconds', until === undefined ? undefined : r3(until / 1000));
    c.emit('next', next);
    c.emit('hour', parts?.hour);
    c.emit('minute', parts?.minute);
    c.emit('second', parts?.second);
    c.emit('millisecond', parts?.millisecond);
    c.emit('count', s.count);
    c.view({
      time: fmtTimeOfDay(tod, true), place, countdown: countdown ?? '', next: next ?? '', repeat,
      state: s.ringing ? 'ringing' : s.snoozeAt !== undefined ? 'snoozed' : repeat === 'once' && s.done ? 'done' : 'armed',
    });
    s.prev = lp.sod; s.prevDay = lp.dayKey; s.prevWd = lp.weekday;

    // Refresh every tick, so the countdown and its milliseconds are live, and when the ring time ends.
    const wakes: number[] = [];
    if (until !== undefined) wakes.push(Math.max(c.tickMs, 1));
    if (s.ringing) wakes.push(s.ringUntil - c.time);
    if (wakes.length) c.wake(Math.max(1, Math.min(...wakes)));
  },
  doc: {
    summary: 'Rings at a chosen time of day, on this device’s clock or on any city’s.',
    runtime: 'Reads the real clock, like World Clock, and works to the millisecond: the alarm time can carry milliseconds, Time left and Next ring always show them, and Hour, Minute, Seconds and Milliseconds are separate outputs of the time left, refreshed every tick. When the clock passes Time on a day allowed by Repeat, Ringing turns true for Ring time (counted in simulation time) or until Dismiss or Snooze. Snooze silences it and rings again 5 minutes later. The alarm only rings while the program is running, and only when it sees the time pass: starting the program after the alarm time does not make it ring. “Once” rings a single time, then waits until Time, Repeat or City is changed. The outputs count down to the next ring.',
    errors: ['A Time that is not a time of day (such as 25:00) raises an error and clears the outputs.', 'A City that is not in the World Clock list raises an error.', 'A browser without the needed time-zone data raises an error.'],
    examples: ['Alarm Ringing → Light: a lamp that is on while the alarm rings.', 'Alarm Ringing → Notify: a message at 07:30 in Tokyo.', 'Timer Done → Alarm Snooze pin: snooze again after a delay.', 'Alarm Minute and Seconds → Text displays: a live countdown face.'],
  },
};

/** The section, in library order. World Clock lives here too. */
export const timekeeping: ModuleDef[] = [timer, alarm, stopwatch, worldClock];
