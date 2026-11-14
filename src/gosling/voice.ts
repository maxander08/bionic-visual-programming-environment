// Gosling's voice: speech recognition for talking to it, speech synthesis for hearing it back.
//
// Both are built into the browser (Web Speech API), so nothing is installed. Recognition is supported by Chrome, Edge,
// Safari and other Chromium browsers; Firefox has none, and the UI says so instead of showing a dead button. Note that
// Chrome's recognizer streams audio to the browser vendor's speech service; that is the browser's doing, not Nicque's.
import { tr, type Lang } from '../i18n';

// ---- minimal typings (not part of TypeScript's DOM lib) --------------------------------------------------------

interface SRAlternative { transcript: string; confidence: number }
interface SRResult { isFinal: boolean; length: number; [i: number]: SRAlternative }
interface SREvent { resultIndex: number; results: { length: number; [i: number]: SRResult } }
interface SRErrorEvent { error: string; message?: string }
interface SpeechRec {
  lang: string; continuous: boolean; interimResults: boolean; maxAlternatives: number;
  onstart: (() => void) | null; onresult: ((e: SREvent) => void) | null; onerror: ((e: SRErrorEvent) => void) | null; onend: (() => void) | null;
  start(): void; stop(): void; abort(): void;
}
type SRCtor = new () => SpeechRec;

const ctor = (): SRCtor | null => {
  if (typeof window === 'undefined') return null;
  const w = window as unknown as { SpeechRecognition?: SRCtor; webkitSpeechRecognition?: SRCtor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
};

export const recognitionSupported = (): boolean => ctor() !== null;
export const synthesisSupported = (): boolean => typeof window !== 'undefined' && 'speechSynthesis' in window && typeof SpeechSynthesisUtterance !== 'undefined';

/** BCP 47 tag for the recognizer and the voice, from the interface language. English follows the browser's own English. */
export function speechLang(lang: Lang): string {
  if (lang === 'zh-Hans') return 'zh-CN';
  if (lang === 'zh-Hant') return 'zh-TW';
  const nav = typeof navigator !== 'undefined' ? [...(navigator.languages ?? []), navigator.language] : [];
  return nav.find((l) => /^en(-|$)/i.test(l ?? '')) ?? 'en-US';
}

// ---- listening -------------------------------------------------------------------------------------------------

export type ListenError = 'not-allowed' | 'no-speech' | 'network' | 'audio-capture' | 'unsupported' | 'other';

export interface ListenOptions {
  lang: string;
  /** Live words as they are recognised (replaces the previous interim text). */
  onInterim?(text: string): void;
  /** Called once with the final transcript (empty when nothing was understood). */
  onDone(result: { text: string; error?: ListenError }): void;
}
export interface Listener { stop(): void; abort(): void }

/** Listen for one utterance. `stop()` finishes and delivers what was heard; `abort()` discards it. */
export function listen(opts: ListenOptions): Listener | null {
  const SR = ctor();
  if (!SR) return null;
  const rec = new SR();
  rec.lang = opts.lang;
  rec.continuous = false;
  rec.interimResults = true;
  rec.maxAlternatives = 1;
  let finalText = '';
  let interim = '';
  let error: ListenError | undefined;
  let aborted = false;
  let finished = false;

  rec.onresult = (e) => {
    let fin = '', tmp = '';
    for (let i = 0; i < e.results.length; i++) {
      const r = e.results[i];
      (r.isFinal ? (fin += r[0].transcript) : (tmp += r[0].transcript));
    }
    finalText = fin;
    interim = tmp;
    opts.onInterim?.((fin + tmp).trim());
  };
  rec.onerror = (e) => {
    switch (e.error) {
      case 'not-allowed': case 'service-not-allowed': error = 'not-allowed'; break;
      case 'no-speech': error = 'no-speech'; break;
      case 'network': error = 'network'; break;
      case 'audio-capture': error = 'audio-capture'; break;
      case 'aborted': break;
      default: error = 'other';
    }
  };
  rec.onend = () => {
    if (finished) return;
    finished = true;
    if (aborted) return;
    const text = (finalText || interim).trim();
    opts.onDone({ text, error: text ? undefined : error });
  };
  try { rec.start(); } catch { finished = true; queueMicrotask(() => opts.onDone({ text: '', error: 'other' })); }
  return {
    stop: () => { try { rec.stop(); } catch { /* already stopped */ } },
    abort: () => { aborted = true; try { rec.abort(); } catch { /* already stopped */ } },
  };
}

// ---- speaking --------------------------------------------------------------------------------------------------

let voicesReady: Promise<SpeechSynthesisVoice[]> | null = null;
/** The installed voices. Browsers load them lazily, so this waits for the first list. */
export function loadVoices(): Promise<SpeechSynthesisVoice[]> {
  if (!synthesisSupported()) return Promise.resolve([]);
  const now = speechSynthesis.getVoices();
  if (now.length) return Promise.resolve(now);
  if (voicesReady) return voicesReady;
  voicesReady = new Promise((resolve) => {
    let settled = false;
    const done = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      speechSynthesis.removeEventListener('voiceschanged', done);
      const list = speechSynthesis.getVoices();
      if (!list.length) voicesReady = null; // retry later if the browser hadn't finished loading voices
      resolve(list);
    };
    speechSynthesis.addEventListener('voiceschanged', done);
    const timer = setTimeout(done, 1500); // some browsers never fire the event
  });
  return voicesReady;
}

const NICE = /natural|neural|premium|enhanced|online|google|samantha|aria|jenny|guy|daniel|karen|moira|serena|xiaoxiao|hsiao|yating|ting-ting|tingting/i;

/** The voices that speak this language, best-sounding first. */
export function voicesFor(all: SpeechSynthesisVoice[], tag: string): SpeechSynthesisVoice[] {
  const base = tag.toLowerCase().split('-')[0];
  const list = all.filter((v) => v.lang.toLowerCase().replace('_', '-').startsWith(base));
  const score = (v: SpeechSynthesisVoice) => (v.lang.toLowerCase().replace('_', '-') === tag.toLowerCase() ? 4 : 0) + (NICE.test(v.name) ? 2 : 0) + (v.localService ? 0 : 1);
  return [...list].sort((a, b) => score(b) - score(a) || a.name.localeCompare(b.name));
}

/** Make Markdown and Nicque notation sound natural when spoken. */
export function cleanForSpeech(text: string): string {
  return text
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/https?:\/\/\S+/g, ' ')
    .replace(/`([a-z0-9]+(?:-[a-z0-9]+)*)-(\d+)`/gi, '$1 $2')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\*([^*\s][^*]*)\*/g, '$1')
    .replace(/^\s*[-•]\s+/gm, '')
    .replace(/→/g, ' to ').replace(/←/g, ' from ')
    .replace(/×/g, ' times ').replace(/÷/g, ' divided by ').replace(/[−–]/g, ' minus ')
    .replace(/°\s?C\b/g, ' degrees Celsius').replace(/°\s?F\b/g, ' degrees Fahrenheit')
    .replace(/\bHz\b/g, ' hertz').replace(/\bms\b/g, ' milliseconds')
    .replace(/[“”"]/g, '').replace(/[()[\]{}<>|#_~^]/g, ' ')
    .replace(/(\d)\s*\/\s*(\d)/g, '$1 over $2')
    .replace(/Ctrl\/(?:⌘|Cmd)\+Z/gi, 'control Z')
    .replace(/\s*\n+\s*/g, '. ').replace(/\.\s*\./g, '.').replace(/([:;])\s*\./g, '$1 ')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

/** A short version for voice mode: the first sentences, with a pointer to the screen when there is more. */
export function spokenSummary(text: string, opts: { max?: number } = {}): string {
  const max = opts.max ?? 380;
  const clean = cleanForSpeech(text);
  if (clean.length <= max) return clean;
  const sentences = clean.match(/[^.!?。！？]+[.!?。！？]+(\s|$)|[^.!?。！？]+$/g) ?? [clean];
  let out = '';
  for (const s of sentences) {
    if ((out + s).length > max && out) break;
    out += s;
  }
  out = out.trim().slice(0, max + 80);
  return `${out} ${tr('The rest is on screen.')}`;
}

function splitLong(s: string, limit: number): string[] {
  if (s.length <= limit) return [s];
  const out: string[] = [];
  let rest = s.trim();
  while (rest.length > limit) {
    let cut = -1;
    for (const re of [/[,，、;；]\s*/g, /\s+/g]) {
      for (const m of rest.slice(0, limit).matchAll(re)) cut = m.index! + m[0].length;
      if (cut >= limit * 0.4) break;
      cut = -1;
    }
    if (cut <= 0) cut = limit;
    out.push(rest.slice(0, cut).trim());
    rest = rest.slice(cut).trim();
  }
  if (rest) out.push(rest);
  return out;
}

function chunk(text: string): string[] {
  // Chrome silently stops long utterances after ~15 s, so speak sentence by sentence
  const raw = text.match(/[^.!?;:。！？；：]+[.!?;:。！？；：]*\s*/g) ?? [text];
  const parts = raw.flatMap((p) => splitLong(p.trim(), 180));
  const out: string[] = [];
  let cur = '';
  for (const p of parts) {
    if (!p) continue;
    if ((cur + ' ' + p).length > 180 && cur) { out.push(cur.trim()); cur = p; } else cur = cur ? `${cur} ${p}` : p;
  }
  if (cur.trim()) out.push(cur.trim());
  return out.filter((s) => /[\p{L}\p{N}]/u.test(s));
}

// Keep strong references to live utterances so Chromium does not GC them before onend fires.
const activeUtterances = new Set<SpeechSynthesisUtterance>();

export interface SpeakOptions { lang: string; rate?: number; voiceURI?: string; onStart?(): void; onDone?(): void }

/** Speak text. Returns a function that stops it. `onDone` runs on natural end and on cancel. */
export function speak(text: string, opts: SpeakOptions): () => void {
  if (!synthesisSupported() || !text.trim()) { queueMicrotask(() => opts.onDone?.()); return () => {}; }
  const parts = chunk(text);
  if (!parts.length) { queueMicrotask(() => opts.onDone?.()); return () => {}; }
  try { speechSynthesis.cancel(); if (speechSynthesis.paused) speechSynthesis.resume(); } catch { /* ignore */ }
  activeUtterances.clear();
  const mine: SpeechSynthesisUtterance[] = [];
  let cancelled = false;
  let ended = false;
  const release = () => { for (const u of mine) activeUtterances.delete(u); mine.length = 0; };
  const finish = () => { if (ended) return; ended = true; release(); opts.onDone?.(); };
  const rate = Number.isFinite(opts.rate) ? Math.min(2, Math.max(0.5, opts.rate!)) : 1.02;
  void loadVoices().then((all) => {
    if (cancelled) return;
    const pool = voicesFor(all, opts.lang);
    const voice = (opts.voiceURI && pool.find((v) => v.voiceURI === opts.voiceURI)) || pool[0] || null;
    parts.forEach((p, i) => {
      const u = new SpeechSynthesisUtterance(p);
      u.lang = voice?.lang ?? opts.lang;
      if (voice) u.voice = voice;
      u.rate = rate;
      u.pitch = 1;
      if (i === 0) u.onstart = () => opts.onStart?.();
      u.onend = () => { activeUtterances.delete(u); if (i === parts.length - 1) finish(); };
      u.onerror = (e) => { activeUtterances.delete(u); if (e.error === 'canceled' || e.error === 'interrupted') return; finish(); };
      mine.push(u);
      activeUtterances.add(u);
      speechSynthesis.speak(u);
    });
  });
  return () => {
    cancelled = true;
    try { speechSynthesis.cancel(); } catch { /* ignore */ }
    finish();
  };
}

export function stopSpeaking() {
  activeUtterances.clear();
  if (synthesisSupported()) try { speechSynthesis.cancel(); } catch { /* ignore */ }
}
