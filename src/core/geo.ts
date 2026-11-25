// Where on Earth a Map or a Globe shows. Pure data and maths (no browser objects): turning what a person typed into a place, the slippy-map
// tile arithmetic of the Map, and the orthographic projection of the Globe.
//
// Looking a place up works in layers, so that something always shows:
//   1. a pair of coordinates (“35.68, 139.76”) is used as it is;
//   2. a city or country the app already knows (core/data/places.ts: 6 000 cities and every country, in English, Simplified and
//      Traditional Chinese) is placed at once, with no network;
//   3. a browser runner (runtime/geocode.ts, OpenStreetMap Nominatim) looks up anything on Earth: a street, a district, a province,
//      and brings its outline. It refines the answer of step 2 and is the only answer for places the app does not know.
// run() cannot wait for the network, so it calls requestPlace(): the first call starts the job and answers “pending”; when the job ends
// the result is kept here, subscribers are told and the node runs again.
import { cityName, countryName, findCity, findCountry } from './worldclock';

/** South, west, north, east in degrees. */
export type BBox = [number, number, number, number];
export type Ring = [number, number][]; // [lon, lat]

export interface Place {
  /** What was asked for. */
  query: string;
  /** Short name, in the interface language when the source knows it. */
  name: string;
  /** Name with its country, for the node's face. */
  label: string;
  lat: number;
  lon: number;
  /** The area to show: a city is small, a country is big. Never wider than the main land of the place. */
  bbox: BBox;
  /** What it is: city, country, province, street, … */
  kind: string;
  /** The outline of an area (provinces, countries), simplified. Absent for a point. */
  outline?: Ring[];
  source: 'coordinates' | 'builtin' | 'osm';
}

export type PlaceResult = { status: 'pending' } | { status: 'ready'; place: Place } | { status: 'error'; message: string };

export const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
export const wrapLon = (lon: number) => ((((lon + 180) % 360) + 360) % 360) - 180;

// ---- reading what was typed ------------------------------------------------------------------------------------------------------

const COORD = /^\s*([+-]?\d+(?:\.\d+)?)\s*°?\s*([NSns])?\s*[,;\s]\s*([+-]?\d+(?:\.\d+)?)\s*°?\s*([EWew])?\s*$/;

/** “35.68, 139.76”, “35.68N 139.76E”, “-33.87;151.21” → [lat, lon]; null when the text is not a pair of coordinates. */
export function parseCoords(text: string): [number, number] | null {
  const m = COORD.exec(text.replace(/，/g, ',').replace(/−/g, '-'));
  if (!m) return null;
  let lat = Number(m[1]), lon = Number(m[3]);
  if (m[2] && /s/i.test(m[2])) lat = -Math.abs(lat);
  if (m[4] && /w/i.test(m[4])) lon = -Math.abs(lon);
  return Math.abs(lat) <= 90 && Math.abs(lon) <= 180 ? [lat, lon] : null;
}

const around = (lat: number, lon: number, d: number): BBox => [clamp(lat - d, -90, 90), lon - d, clamp(lat + d, -90, 90), lon + d];
const fmtDeg = (v: number, pos: string, neg: string) => `${Math.abs(v).toFixed(4)}° ${v < 0 ? neg : pos}`;
/** “35.6895° N, 139.6917° E” */
export const fmtCoords = (lat: number, lon: number) => `${fmtDeg(lat, 'N', 'S')}, ${fmtDeg(lon, 'E', 'W')}`;

/** Resolve without the network: coordinates, a known country, a known city. */
export function localPlace(query: string, lang: string): Place | null {
  const q = query.trim();
  if (!q) return null;
  const c = parseCoords(q);
  if (c) return { query: q, name: fmtCoords(c[0], c[1]), label: fmtCoords(c[0], c[1]), lat: c[0], lon: c[1], bbox: around(c[0], c[1], 0.004), kind: 'point', source: 'coordinates' };
  const country = findCountry(q);
  if (country) {
    const nm = lang === 'zh-Hans' ? country.hans || country.name : lang === 'zh-Hant' ? country.hant || country.name : country.name;
    return { query: q, name: nm, label: nm, lat: country.lat, lon: country.lon, bbox: around(country.lat, country.lon, 4), kind: 'country', source: 'builtin' };
  }
  const city = findCity(q);
  if (city && city.lat !== undefined && city.lon !== undefined) {
    const nm = cityName(city, lang);
    return { query: q, name: nm, label: `${nm}, ${countryName(city, lang)}`, lat: city.lat, lon: city.lon, bbox: around(city.lat, city.lon, 0.06), kind: 'city', source: 'builtin' };
  }
  return null;
}

/** The label of a place in a language. A place the program knows is written again in the language asked for, so a switch of the interface language is seen at once. */
export const placeLabel = (p: Place, lang: string): string => (p.source === 'builtin' ? localPlace(p.query, lang)?.label ?? p.label : p.label);

// ---- outlines ----------------------------------------------------------------------------------------------------------------------

const ringBox = (r: Ring): BBox => {
  let s = 90, w = 180, n = -90, e = -180;
  for (const [x, y] of r) { if (y < s) s = y; if (y > n) n = y; if (x < w) w = x; if (x > e) e = x; }
  return [s, w, n, e];
};
const boxArea = (b: BBox) => (b[2] - b[0]) * (b[3] - b[1]) * Math.cos((((b[0] + b[2]) / 2) * Math.PI) / 180);

/** Douglas–Peucker on lon/lat; tolerance in degrees. */
function simplify(pts: Ring, tol: number): Ring {
  if (pts.length < 5) return pts;
  const keep = new Uint8Array(pts.length);
  keep[0] = keep[pts.length - 1] = 1;
  const stack: [number, number][] = [[0, pts.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop()!;
    let dmax = 0, idx = -1;
    const [ax, ay] = pts[a], [bx, by] = pts[b];
    const dx = bx - ax, dy = by - ay, len = dx * dx + dy * dy;
    for (let i = a + 1; i < b; i++) {
      const [px, py] = pts[i];
      const t = len ? clamp(((px - ax) * dx + (py - ay) * dy) / len, 0, 1) : 0;
      const d = Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
      if (d > dmax) { dmax = d; idx = i; }
    }
    if (idx >= 0 && dmax > tol) { keep[idx] = 1; stack.push([a, idx], [idx, b]); }
  }
  return pts.filter((_, i) => keep[i]);
}

/**
 * The rings of a GeoJSON Polygon or MultiPolygon (outer rings only), simplified to a few hundred points, and the box of the biggest
 * one. A country such as France has islands on the other side of the planet: the box of the whole would show nothing useful, so the
 * view fits the main land and the outline still draws every part.
 */
export function readOutline(geo: unknown): { rings: Ring[]; main: BBox } | null {
  const g = geo as { type?: string; coordinates?: unknown } | null;
  if (!g || (g.type !== 'Polygon' && g.type !== 'MultiPolygon')) return null;
  const polys = (g.type === 'Polygon' ? [g.coordinates] : g.coordinates) as number[][][][];
  let rings: Ring[] = polys.map((p) => (p[0] ?? []).map((q) => [q[0], q[1]] as [number, number])).filter((r) => r.length > 3);
  if (!rings.length) return null;
  rings.sort((a, b) => boxArea(ringBox(b)) - boxArea(ringBox(a)));
  const main = ringBox(rings[0]);
  const span = Math.max(main[2] - main[0], main[3] - main[1], 1e-6);
  const tol = span / 400;
  rings = rings.slice(0, 40).filter((r, i) => i === 0 || boxArea(ringBox(r)) > boxArea(main) * 1e-4).map((r) => simplify(r, tol));
  return { rings, main };
}

// ---- Map: slippy tiles -------------------------------------------------------------------------------------------------------------

export const TILE = 256;
export const MAX_ZOOM = 19;
/** World pixel (at zoom z, tiles of 256 px) of a position. */
export function toPixel(lat: number, lon: number, z: number): { x: number; y: number } {
  const n = TILE * 2 ** z;
  const s = Math.sin((clamp(lat, -85.0511, 85.0511) * Math.PI) / 180);
  return { x: ((lon + 180) / 360) * n, y: (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * n };
}
export function fromPixel(x: number, y: number, z: number): { lat: number; lon: number } {
  const n = TILE * 2 ** z;
  const lat = (Math.atan(Math.sinh(Math.PI * (1 - (2 * y) / n))) * 180) / Math.PI;
  return { lat, lon: (x / n) * 360 - 180 };
}
/** The biggest zoom at which the box fits a view of w × h pixels (a little padding), within [min, max]. */
export function fitZoom(b: BBox, w: number, h: number, min = 1, max = 17): number {
  for (let z = max; z >= min; z--) {
    const a = toPixel(b[2], b[1], z), c = toPixel(b[0], b[3], z);
    if (Math.abs(c.x - a.x) <= w * 0.82 && Math.abs(c.y - a.y) <= h * 0.82) return z;
  }
  return min;
}
/** The zoom a Map uses for a place: fitted to the place, or a fixed street-level zoom. */
export function zoomFor(place: Place, fit: boolean, zoom: number, w: number, h: number): number {
  return clamp(fit ? fitZoom(place.bbox, w, h, 2, place.kind === 'point' ? 18 : 16) : Math.round(zoom), 1, MAX_ZOOM);
}

// ---- Globe: orthographic projection ------------------------------------------------------------------------------------------------

const RAD = Math.PI / 180;
/** Position on a globe of radius 1 looking at (lat0, lon0): x right, y up, z towards the viewer (visible when z > 0). */
export function orthographic(lat: number, lon: number, lat0: number, lon0: number): { x: number; y: number; z: number } {
  const φ = lat * RAD, λ = (lon - lon0) * RAD, φ0 = lat0 * RAD;
  const cosφ = Math.cos(φ);
  return {
    x: cosφ * Math.sin(λ),
    y: Math.cos(φ0) * Math.sin(φ) - Math.sin(φ0) * cosφ * Math.cos(λ),
    z: Math.sin(φ0) * Math.sin(φ) + Math.cos(φ0) * cosφ * Math.cos(λ),
  };
}
/** Inverse of `orthographic`: the position under (x, y) on the disc, or null outside it. */
export function unproject(x: number, y: number, lat0: number, lon0: number): { lat: number; lon: number } | null {
  const rho = Math.hypot(x, y);
  if (rho > 1) return null;
  if (rho === 0) return { lat: lat0, lon: lon0 };
  const c = Math.asin(rho), φ0 = lat0 * RAD;
  const lat = Math.asin(Math.cos(c) * Math.sin(φ0) + (y * Math.sin(c) * Math.cos(φ0)) / rho);
  const lon = lon0 * RAD + Math.atan2(x * Math.sin(c), rho * Math.cos(φ0) * Math.cos(c) - y * Math.sin(φ0) * Math.sin(c));
  return { lat: lat / RAD, lon: wrapLon(lon / RAD) };
}

// ---- the cache of lookups ----------------------------------------------------------------------------------------------------------

/** What the browser runner returns: the place, null when OpenStreetMap does not know it. It throws when the network fails. */
export type Runner = (query: string, lang: string) => Promise<Place | null>;

const results = new Map<string, PlaceResult>();
const subs = new Set<() => void>();
let runner: Runner | undefined;
const KEEP = 60;

export const setPlaceRunner = (r: Runner | undefined) => { runner = r; };
export const subscribePlaces = (cb: () => void) => (subs.add(cb), () => void subs.delete(cb));
const notify = () => subs.forEach((f) => f());
const keyOf = (q: string, lang: string) => `${lang}|${q.trim().toLowerCase()}`;

function trim() {
  for (const k of [...results.keys()]) {
    if (results.size <= KEEP) break;
    if (results.get(k)!.status !== 'pending') results.delete(k);
  }
}

/** The state of a lookup, starting it when nobody has asked for it yet. Never throws. */
export function requestPlace(query: string, lang = 'en'): PlaceResult {
  const q = query.trim();
  if (!q) return { status: 'error', message: 'No place given. Type a city, a country or an address in the inspector, or connect text to the Place pin.' };
  const key = keyOf(q, lang);
  const hit = results.get(key);
  if (hit) { results.delete(key); results.set(key, hit); return hit; }
  const local = localPlace(q, lang);
  if (local && (local.source === 'coordinates' || !runner)) { const r: PlaceResult = { status: 'ready', place: local }; results.set(key, r); return r; }
  if (!runner) return { status: 'error', message: `“${q.slice(0, 40)}” is not a place this program knows, and looking up other places needs a browser.` };
  // A known place is shown at once and refined when OpenStreetMap answers; an unknown one waits for the answer.
  const first: PlaceResult = local ? { status: 'ready', place: local } : { status: 'pending' };
  results.set(key, first);
  let job: Promise<Place | null>;
  try { job = runner(q, lang); } catch (e) { job = Promise.reject(e); }
  job.then(
    (p) => {
      if (p) results.set(key, { status: 'ready', place: p });
      else if (!local) results.set(key, { status: 'error', message: `“${q.slice(0, 40)}” was not found. Try the name of a city, a country, a province or an address, or write coordinates like 35.68, 139.76.` });
      trim(); notify();
    },
    (e) => {
      if (e instanceof Error && e.message === 'superseded') { if (!local) results.delete(key); return; }
      if (!local) results.set(key, { status: 'error', message: 'The place could not be looked up: the map service did not answer. Check the connection, or use a city or country the app knows, or coordinates.' });
      notify();
    },
  );
  return first;
}

/** Forget every lookup (used by tests). */
export const clearPlaces = () => results.clear();
