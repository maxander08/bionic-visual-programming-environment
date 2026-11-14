// Browser-side effects of Behavior modules: sound, vibration, notifications. Everything reports its real availability.
import type { Engine } from '../core/engine';
import { useStore } from '../state/store';

let ctx: AudioContext | null = null;
const voices = new Map<string, { osc: OscillatorNode; gain: GainNode }>();
const seen = new Map<string, number>();
const langSeen = new Map<string, number>();

export type AudioState = 'locked' | 'running' | 'unsupported';
export const audio = {
  get state(): AudioState {
    const AC = (globalThis as any).AudioContext ?? (globalThis as any).webkitAudioContext;
    if (!AC) return 'unsupported';
    return ctx && ctx.state === 'running' ? 'running' : 'locked';
  },
  /** Must be called from a user gesture (Run, Step). */
  unlock() {
    const AC = (globalThis as any).AudioContext ?? (globalThis as any).webkitAudioContext;
    if (!AC) return;
    try {
      ctx ??= new AC();
      if (ctx!.state !== 'running') void ctx!.resume();
    } catch { /* unsupported */ }
  },
};

export const vibrationSupported = () => typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function';
export const notificationState = (): 'unsupported' | NotificationPermission => (typeof Notification === 'undefined' ? 'unsupported' : Notification.permission);
export async function requestNotifications(): Promise<string> {
  if (typeof Notification === 'undefined') return 'unsupported';
  try {
    return await Notification.requestPermission();
  } catch {
    return 'error';
  }
}

export function processOutputs(engine: Engine, running: boolean) {
  const alive = new Set<string>();
  for (const n of engine.nodes.values()) {
    const v = n.viewData as any;
    if (n.type === 'audio') {
      alive.add(n.id);
      const on = running && !v.mute && ctx && ctx.state === 'running' && Number.isFinite(v.freq);
      let voice = voices.get(n.id);
      if (on && !voice && ctx) {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        gain.gain.value = 0;
        osc.connect(gain).connect(ctx.destination);
        osc.start();
        voice = { osc, gain };
        voices.set(n.id, voice);
      }
      if (voice && ctx) {
        const t = ctx.currentTime;
        if (on) {
          voice.osc.type = v.wave ?? 'sine';
          voice.osc.frequency.setTargetAtTime(Math.max(20, Math.min(12000, v.freq)), t, 0.015);
          voice.gain.gain.setTargetAtTime(Math.max(0, Math.min(0.5, (v.amp ?? 1) * (v.volume ?? 0.15))), t, 0.02);
        } else voice.gain.gain.setTargetAtTime(0, t, 0.03);
      }
    } else if (n.type === 'setlanguage') {
      // Workspace Settings: the module counts its applications in `n`; each new count switches the editor language.
      const c = v.n as number | undefined;
      if (c === undefined || c === 0) langSeen.delete(n.id);
      else if (c !== langSeen.get(n.id)) {
        langSeen.set(n.id, c);
        useStore.getState().setLanguage(v.lang, { persist: !!v.remember, notice: !!v.notice });
      }
    } else if (n.type === 'haptic' || n.type === 'notify') {
      const c = v.n as number | undefined;
      if (c !== undefined && c !== seen.get(n.id)) {
        seen.set(n.id, c);
        if (running) {
          if (n.type === 'haptic' && vibrationSupported()) navigator.vibrate(v.ms ?? 40);
          if (n.type === 'notify' && notificationState() === 'granted') {
            try { new Notification(String(v.title ?? 'Nicque'), { body: String(v.body ?? '') }); } catch { /* blocked */ }
          }
        }
      }
    }
  }
  for (const [id, voice] of voices)
    if (!alive.has(id)) {
      try { voice.osc.stop(); voice.osc.disconnect(); voice.gain.disconnect(); } catch { /* already stopped */ }
      voices.delete(id);
    }
}

export function silenceAll() {
  langSeen.clear();
  if (!ctx) return;
  for (const v of voices.values()) v.gain.gain.setTargetAtTime(0, ctx.currentTime, 0.03);
  seen.clear();
}
