// Browser side of the Map and the Globe: looks a place up with OpenStreetMap Nominatim (https://nominatim.org) and hands core/geo.ts a
// Place. It registers itself as the runner when imported (see main.tsx), and runs every Map and Globe again when a lookup ends.
//
// Nominatim's usage policy asks for at most one request a second, so lookups are queued one after the other, and a lookup that is
// replaced by a newer one while it waits (a name being typed into the inspector) is dropped before it is sent.
import { readOutline, setPlaceRunner, subscribePlaces, type BBox, type Place } from '../core/geo';
import { engine } from './session';
import { useStore } from '../state/store';

const GAP = 1100;
const SETTLE = 650;
let last = 0;
let seq = 0;
/** Lookups still waiting to be sent. A newer one for text that continues (or shortens) an older one replaces it: that is somebody typing. */
const waiting = new Map<number, { q: string; dead: boolean }>();
let queue: Promise<unknown> = Promise.resolve();
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface Hit { name?: string; display_name?: string; lat: string; lon: string; boundingbox?: string[]; addresstype?: string; type?: string; geojson?: unknown }

function toPlace(q: string, lang: string, h: Hit): Place {
  const lat = Number(h.lat), lon = Number(h.lon);
  // Nominatim writes a box as south, north, west, east.
  let bbox: BBox = h.boundingbox?.length === 4 ? [Number(h.boundingbox[0]), Number(h.boundingbox[2]), Number(h.boundingbox[1]), Number(h.boundingbox[3])] : [lat - 0.01, lon - 0.01, lat + 0.01, lon + 0.01];
  const o = readOutline(h.geojson);
  if (o) bbox = o.main;
  // “东京都/東京都”: places with names in both scripts come as both; take the one for the language.
  const pick = (s: string) => { const parts = s.split('/').map((x) => x.trim()).filter(Boolean); return lang === 'zh-Hant' && parts.length > 1 ? parts[parts.length - 1] : parts[0] ?? s; };
  const parts = (h.display_name ?? '').split(',').map((x) => x.trim()).filter(Boolean);
  const name = pick(h.name || parts[0] || q);
  const country = parts.length > 1 ? pick(parts[parts.length - 1]) : '';
  const label = country && country !== name ? `${name}, ${country}` : name;
  return { query: q, name, label, lat, lon, bbox, kind: h.addresstype || h.type || 'place', outline: o?.rings, source: 'osm' };
}

async function lookup(q: string, lang: string): Promise<Place | null> {
  const mine = ++seq;
  const low = q.toLowerCase();
  for (const w of waiting.values()) if (low.startsWith(w.q) || w.q.startsWith(low)) w.dead = true;
  const me = { q: low, dead: false };
  waiting.set(mine, me);
  await sleep(SETTLE);
  if (me.dead) { waiting.delete(mine); throw new Error('superseded'); }
  const turn = queue.then(async () => {
    waiting.delete(mine);
    if (me.dead) throw new Error('superseded');
    const wait = last + GAP - Date.now();
    if (wait > 0) await sleep(wait);
    last = Date.now();
    const url = `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&polygon_geojson=1&polygon_threshold=0.01&accept-language=${encodeURIComponent(lang === 'zh-Hans' ? 'zh-Hans,zh' : lang === 'zh-Hant' ? 'zh-Hant,zh' : 'en')}&q=${encodeURIComponent(q)}`;
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 12000);
    try {
      const r = await fetch(url, { signal: ctl.signal, headers: { Accept: 'application/json' } });
      if (!r.ok) throw new Error(`Nominatim answered ${r.status}`);
      const j = (await r.json()) as Hit[];
      return j.length ? toPlace(q, lang, j[0]) : null;
    } finally { clearTimeout(timer); }
  });
  queue = turn.catch(() => undefined);
  return turn;
}

setPlaceRunner(lookup);

/** A finished lookup runs every Map and Globe again: the ones that asked now get their answer. */
subscribePlaces(() => {
  for (const n of engine.nodes.values()) if (n.type === 'map' || n.type === 'globe') engine.inject(n.id, {});
});

/** A new interface language asks for the names in that language: run them again. */
useStore.subscribe((s, p) => {
  if (s.settings.language !== p.settings.language) queueMicrotask(() => { for (const n of engine.nodes.values()) if (n.type === 'map' || n.type === 'globe') engine.inject(n.id, {}); });
});
