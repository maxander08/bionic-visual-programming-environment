// Live sensor drivers. They only push data into the engine; simulated sources live inside the modules themselves.
import type { Engine } from '../core/engine';
import type { ImageSig } from '../core/types';
import { imageStats } from '../core/util';

export interface SensorState {
  state: 'idle' | 'requesting' | 'live' | 'denied' | 'unavailable' | 'error';
  message: string;
}
const status = new Map<string, SensorState>();
const subs = new Set<() => void>();
let version = 0;
export const sensorVersion = () => version;
export const subscribeSensors = (cb: () => void) => (subs.add(cb), () => void subs.delete(cb));
export const getSensorState = (id: string) => status.get(id);
function setStatus(ids: Iterable<string>, state: SensorState['state'], message: string) {
  for (const id of ids) status.set(id, { state, message });
  version++;
  subs.forEach((f) => f());
}

let engine: Engine;
interface Driver {
  ids: Set<string>;
  active: boolean;
  token: number;
  start(): void | Promise<void>;
  stop(): void;
}
const mk = (start: (d: Driver) => void | Promise<void>, stop: (d: Driver) => void): Driver => {
  const d: Driver = { ids: new Set(), active: false, token: 0, start: () => start(d), stop: () => stop(d) };
  return d;
};
const injectAll = (d: Driver, v: Record<string, unknown>) => d.ids.forEach((id) => engine.inject(id, v));
const errName = (e: unknown) => (e && typeof e === 'object' && 'name' in e ? String((e as any).name) : 'Error');

function toSig(c: CanvasRenderingContext2D, w: number, h: number): ImageSig {
  const d = c.getImageData(0, 0, w, h);
  return { w, h, data: d.data };
}

// --- camera
let cam: { stream?: MediaStream; timer?: number; video?: HTMLVideoElement } = {};
const camera = mk(
  async (d) => {
    const tok = ++d.token;
    setStatus(d.ids, 'requesting', 'Waiting for camera permission…');
    if (!navigator.mediaDevices?.getUserMedia) return setStatus(d.ids, 'unavailable', 'Camera API unavailable. It needs a camera and a secure context (https or localhost).');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { width: 320, height: 240 } });
      if (tok !== d.token) return stream.getTracks().forEach((t) => t.stop());
      const video = document.createElement('video');
      video.muted = true;
      video.playsInline = true;
      video.srcObject = stream;
      await video.play();
      const cv = document.createElement('canvas');
      cv.width = 64; cv.height = 48;
      const c = cv.getContext('2d', { willReadFrequently: true })!;
      cam = { stream, video, timer: window.setInterval(() => {
        c.drawImage(video, 0, 0, 64, 48);
        const img = toSig(c, 64, 48);
        injectAll(d, { image: img, luma: Math.round(imageStats(img).mean * 1000) / 1000 });
      }, 100) };
      setStatus(d.ids, 'live', 'Camera live. Frames are processed locally and never stored.');
    } catch (e) {
      const n = errName(e);
      if (tok !== d.token) return;
      setStatus(d.ids, n === 'NotAllowedError' || n === 'SecurityError' ? 'denied' : n === 'NotFoundError' || n === 'OverconstrainedError' ? 'unavailable' : 'error',
        n === 'NotAllowedError' || n === 'SecurityError' ? 'Camera permission was denied or blocked. Allow it in the browser’s site settings and press Run again.' : n === 'NotFoundError' ? 'No camera was found on this device.' : `Camera error: ${n}.`);
    }
  },
  (d) => {
    d.token++;
    if (cam.timer) clearInterval(cam.timer);
    cam.stream?.getTracks().forEach((t) => t.stop());
    if (cam.video) cam.video.srcObject = null;
    cam = {};
  },
);

// --- microphone
let mic: { stream?: MediaStream; timer?: number; actx?: AudioContext } = {};
function detectPitch(buf: Float32Array, sr: number): number {
  const minLag = Math.floor(sr / 1000), maxLag = Math.floor(sr / 80);
  let best = 0, bestLag = 0;
  const n = buf.length - maxLag;
  for (let lag = minLag; lag <= maxLag; lag++) {
    let s = 0;
    for (let i = 0; i < n; i += 2) s += buf[i] * buf[i + lag];
    if (s > best) { best = s; bestLag = lag; }
  }
  let e0 = 0;
  for (let i = 0; i < n; i += 2) e0 += buf[i] * buf[i];
  return bestLag && best > 0.3 * e0 ? sr / bestLag : 0;
}
const microphone = mk(
  async (d) => {
    const tok = ++d.token;
    setStatus(d.ids, 'requesting', 'Waiting for microphone permission…');
    if (!navigator.mediaDevices?.getUserMedia) return setStatus(d.ids, 'unavailable', 'Microphone API unavailable. It needs a microphone and a secure context (https or localhost).');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false } });
      if (tok !== d.token) return stream.getTracks().forEach((t) => t.stop());
      const AC = window.AudioContext ?? (window as any).webkitAudioContext;
      const actx: AudioContext = new AC();
      await actx.resume();
      const an = actx.createAnalyser();
      an.fftSize = 2048;
      actx.createMediaStreamSource(stream).connect(an);
      const buf = new Float32Array(an.fftSize);
      mic = { stream, actx, timer: window.setInterval(() => {
        an.getFloatTimeDomainData(buf);
        let s = 0;
        for (let i = 0; i < buf.length; i++) s += buf[i] * buf[i];
        const rms = Math.sqrt(s / buf.length);
        injectAll(d, { level: Math.min(1, rms * 4), pitch: rms > 0.01 ? Math.round(detectPitch(buf, actx.sampleRate)) : 0 });
      }, 80) };
      setStatus(d.ids, 'live', 'Microphone live. Only level and pitch are used; no audio is recorded.');
    } catch (e) {
      if (tok !== d.token) return;
      const n = errName(e);
      setStatus(d.ids, n === 'NotAllowedError' || n === 'SecurityError' ? 'denied' : n === 'NotFoundError' ? 'unavailable' : 'error',
        n === 'NotAllowedError' || n === 'SecurityError' ? 'Microphone permission was denied or blocked. Allow it in the browser’s site settings and press Run again.' : n === 'NotFoundError' ? 'No microphone was found on this device.' : `Microphone error: ${n}.`);
    }
  },
  (d) => {
    d.token++;
    if (mic.timer) clearInterval(mic.timer);
    mic.stream?.getTracks().forEach((t) => t.stop());
    void mic.actx?.close().catch(() => {});
    mic = {};
  },
);

// --- device orientation
let orient: ((e: DeviceOrientationEvent) => void) | null = null;
const motionDevice = mk(
  async (d) => {
    const D: any = (window as any).DeviceOrientationEvent;
    if (!D) return setStatus(d.ids, 'unavailable', 'This browser has no device orientation API.');
    setStatus(d.ids, 'requesting', 'Waiting for motion permission…');
    try {
      if (typeof D.requestPermission === 'function') {
        const r = await D.requestPermission();
        if (r !== 'granted') return setStatus(d.ids, 'denied', 'Motion permission was denied.');
      }
    } catch (e) {
      return setStatus(d.ids, 'denied', `Motion permission could not be requested (${errName(e)}). It must be triggered by tapping Run.`);
    }
    let got = false;
    orient = (e) => {
      if (e.gamma == null || e.beta == null) return;
      if (!got) { got = true; setStatus(d.ids, 'live', 'Orientation sensor live.'); }
      injectAll(d, { x: Math.max(-1, Math.min(1, e.gamma / 90)), y: Math.max(-1, Math.min(1, e.beta / 90)) });
    };
    window.addEventListener('deviceorientation', orient);
    window.setTimeout(() => { if (!got && d.active) setStatus(d.ids, 'unavailable', 'No orientation events arrived. Desktop browsers usually have no motion sensor.'); }, 1800);
  },
  () => { if (orient) window.removeEventListener('deviceorientation', orient); orient = null; },
);

// --- pointer as motion
let pm: ((e: PointerEvent) => void) | null = null;
const motionPointer = mk(
  (d) => {
    pm = (e) => injectAll(d, { x: (e.clientX / innerWidth) * 2 - 1, y: (e.clientY / innerHeight) * 2 - 1 });
    window.addEventListener('pointermove', pm, { passive: true });
    setStatus(d.ids, 'live', 'Following the pointer.');
  },
  () => { if (pm) window.removeEventListener('pointermove', pm); pm = null; },
);

// --- keyboard
let kd: ((e: KeyboardEvent) => void) | null = null, ku: ((e: KeyboardEvent) => void) | null = null;
const keys = mk(
  (d) => {
    const typing = (e: KeyboardEvent) => ['INPUT', 'TEXTAREA', 'SELECT'].includes((e.target as HTMLElement)?.tagName);
    kd = (e) => { if (!typing(e)) injectAll(d, { key: e.key, down: true }); };
    ku = (e) => { if (!typing(e)) injectAll(d, { key: e.key, down: false }); };
    window.addEventListener('keydown', kd);
    window.addEventListener('keyup', ku);
    setStatus(d.ids, 'live', 'Listening for key presses (not while typing in a field).');
  },
  () => { if (kd) window.removeEventListener('keydown', kd); if (ku) window.removeEventListener('keyup', ku); kd = ku = null; },
);

// --- device info
let online: (() => void) | null = null;
const deviceInfo = mk(
  (d) => {
    const push = () => injectAll(d, { name: `${(navigator as any).userAgentData?.platform || navigator.platform || 'browser'} · ${screen.width}×${screen.height}`, online: navigator.onLine });
    online = push;
    window.addEventListener('online', push);
    window.addEventListener('offline', push);
    push();
    setStatus(d.ids, 'live', 'Reading device information.');
  },
  () => { if (online) { window.removeEventListener('online', online); window.removeEventListener('offline', online); } online = null; },
);

// --- image file
const fileCache = new Map<string, ImageSig>();
async function decodeFile(dataUrl: string): Promise<ImageSig | null> {
  if (fileCache.has(dataUrl)) return fileCache.get(dataUrl)!;
  return new Promise((res) => {
    const im = new Image();
    im.onload = () => {
      const cv = document.createElement('canvas');
      const k = 64 / Math.max(im.width, im.height);
      cv.width = Math.max(1, Math.round(im.width * k)); cv.height = Math.max(1, Math.round(im.height * k));
      const c = cv.getContext('2d', { willReadFrequently: true })!;
      c.drawImage(im, 0, 0, cv.width, cv.height);
      const s = toSig(c, cv.width, cv.height);
      fileCache.set(dataUrl, s);
      res(s);
    };
    im.onerror = () => res(null);
    im.src = dataUrl;
  });
}

const drivers = { camera, microphone, motionDevice, motionPointer, keys, deviceInfo };
const fileDone = new Map<string, string>();

/** Reconcile running drivers with the sensor modules in the current graph. */
export function syncSensors(e: Engine, running: boolean) {
  engine = e;
  const want: Record<keyof typeof drivers, Set<string>> = { camera: new Set(), microphone: new Set(), motionDevice: new Set(), motionPointer: new Set(), keys: new Set(), deviceInfo: new Set() };
  if (running) {
    for (const n of e.nodes.values()) {
      const src = n.live.source; // a setting pin may be driving the source
      if (n.type === 'vision' && src === 'camera') want.camera.add(n.id);
      else if (n.type === 'hearing' && src === 'mic') want.microphone.add(n.id);
      else if (n.type === 'motion' && src === 'device') want.motionDevice.add(n.id);
      else if (n.type === 'motion' && src === 'pointer') want.motionPointer.add(n.id);
      else if (n.type === 'keys') want.keys.add(n.id);
      else if (n.type === 'device') want.deviceInfo.add(n.id);
      else if (n.type === 'vision' && src === 'file') {
        const data = String(n.params.fileData ?? '');
        if (!data) setStatus([n.id], 'idle', 'No image chosen yet.');
        else if (fileDone.get(n.id) !== data) {
          fileDone.set(n.id, data);
          void decodeFile(data).then((img) => {
            if (!img) return setStatus([n.id], 'error', 'The chosen file could not be decoded as an image.');
            e.inject(n.id, { image: img, luma: Math.round(imageStats(img).mean * 1000) / 1000 });
            setStatus([n.id], 'live', `Image loaded (${img.w}×${img.h}).`);
          });
        }
      }
    }
  } else fileDone.clear();
  (Object.keys(drivers) as (keyof typeof drivers)[]).forEach((k) => {
    const d = drivers[k];
    const w = want[k];
    const same = w.size === d.ids.size && [...w].every((i) => d.ids.has(i));
    if (w.size === 0) {
      if (d.active) { d.stop(); d.active = false; setStatus(d.ids, 'idle', ''); }
      d.ids = w;
    } else {
      const removed = [...d.ids].filter((i) => !w.has(i));
      if (removed.length) setStatus(removed, 'idle', '');
      d.ids = w;
      if (!d.active) { d.active = true; void d.start(); }
      else if (!same) { const st = [...w].map((i) => status.get(i)).find(Boolean); if (st) setStatus(w, st.state, st.message); }
    }
  });
}

export function stopSensors(e: Engine) {
  syncSensors(e, false);
  status.clear();
  version++;
  subs.forEach((f) => f());
}
