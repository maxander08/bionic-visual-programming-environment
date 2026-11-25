// Regenerates src/core/data/places.ts: for the cities of src/core/data/cities.ts (same order) their coordinates and their names in
// Simplified and Traditional Chinese, plus the same for every country. Source: GeoNames (CC BY 4.0, https://www.geonames.org).
//
//   curl -O https://download.geonames.org/export/dump/cities1000.zip && unzip cities1000.zip
//   curl -O https://download.geonames.org/export/dump/countryInfo.txt
//   curl -O https://download.geonames.org/export/dump/alternateNamesV2.zip
//   unzip -p alternateNamesV2.zip alternateNamesV2.txt | awk -F'\t' '$3 ~ /^zh/' > zh.tsv
//   node scripts/build-places.mjs <dir-with-the-files>
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import * as OpenCC from 'opencc-js';
import { CITY_DATA } from './city-data.mjs';

const dir = process.argv[2] ?? '.';
const toHans = OpenCC.Converter({ from: 't', to: 'cn' });
const toHant = OpenCC.Converter({ from: 'cn', to: 'tw' });

// ---- GeoNames rows ----
const byCc = {};
for (const line of readFileSync(join(dir, 'cities1000.txt'), 'utf8').split('\n')) {
  if (!line) continue;
  const f = line.split('\t');
  (byCc[f[8]] ??= []).push({ id: f[0], name: f[1], lat: Number(f[4]), lon: Number(f[5]), pop: Number(f[14]) || 0 });
}
const countries = {};
for (const line of readFileSync(join(dir, 'countryInfo.txt'), 'utf8').split('\n')) {
  if (!line || line.startsWith('#')) continue;
  const f = line.split('\t');
  countries[f[0]] = { id: f[16], name: f[4], capital: f[5] };
}

// ---- Chinese names by geoname id ----
const want = new Set([...Object.values(countries).map((c) => c.id), ...Object.values(byCc).flat().map((c) => c.id)]);
const names = new Map();
const HANS = new Set(['zh-Hans', 'zh-CN', 'zh-SG', 'zh-MY']), HANT = new Set(['zh-Hant', 'zh-TW', 'zh-HK', 'zh-MO']);
const GOOD = /^[\u3400-\u9fff\u00b7·・•．.\-\s（）()]+$/u;
for (const line of readFileSync(join(dir, 'zh.tsv'), 'utf8').split('\n')) {
  if (!line) continue;
  const f = line.split('\t');
  if (!want.has(f[1]) || !GOOD.test(f[3]) || !/[\u3400-\u9fff]/.test(f[3]) || f[7] === '1') continue;
  const kind = HANS.has(f[2]) ? 'hans' : HANT.has(f[2]) ? 'hant' : 'zh';
  const score = (f[4] === '1' ? 4 : 0) + (f[5] === '1' ? 1 : 0) - (f[6] === '1' ? 2 : 0);
  const e = names.get(f[1]) ?? { hans: null, hant: null, zh: null };
  const cur = e[kind];
  if (!cur || score > cur.score || (score === cur.score && f[3].length < cur.t.length)) e[kind] = { t: f[3], score };
  names.set(f[1], e);
}
// Optional second source for places GeoNames has no Chinese name for: Wikidata labels, fetched by scripts/fetch-wikidata-names.mjs.
try {
  const wd = JSON.parse(readFileSync(join(dir, 'wd.json'), 'utf8'));
  for (const [id, l] of Object.entries(wd)) {
    const e = names.get(id) ?? { hans: null, hant: null, zh: null };
    if (!e.hans && l.hans) e.hans = { t: l.hans, score: 0 };
    if (!e.hant && l.hant) e.hant = { t: l.hant, score: 0 };
    if (!e.zh && !e.hans && !e.hant && l.zh) e.zh = { t: l.zh, score: 0 };
    names.set(id, e);
  }
} catch { /* no wd.json: GeoNames only */ }
const missing = [];
// Last resort: the Japanese name when it is written in kanji only (ja.tsv, filtered the same way), read as Chinese characters.
const jp = new Map();
try {
  for (const line of readFileSync(join(dir, 'ja.tsv'), 'utf8').split('\n')) {
    const f = line.split('\t');
    if (!want.has(f[1]) || !GOOD.test(f[3]) || !/[\u3400-\u9fff]/.test(f[3]) || f[7] === '1') continue;
    if (!jp.has(f[1]) || f[4] === '1') jp.set(f[1], f[3]);
  }
} catch { /* no ja.tsv */ }
const fromJp = OpenCC.Converter({ from: 'jp', to: 'cn' }), fromJpT = OpenCC.Converter({ from: 'jp', to: 'tw' });
const chinese = (id) => {
  let e = names.get(id);
  if (!e || (!e.hans && !e.hant && !e.zh)) {
    const j = jp.get(id);
    return j ? { hans: fromJp(j), hant: fromJpT(j) } : null;
  }
  const any = e.zh?.t ?? e.hans?.t ?? e.hant?.t;
  return { hans: e.hans?.t ?? toHans(e.zh?.t ?? e.hant.t), hant: e.hant?.t ?? toHant(e.zh?.t ?? e.hans.t) };
};

// ---- align with the city list the app ships ----
const GEO = {}, ZH_S = {}, ZH_T = {}, COUNTRY = {};
let rows = 0, withZh = 0, withGeo = 0;
for (const [cc, country, list] of CITY_DATA.c) {
  const pool = (byCc[cc] ?? []).slice().sort((a, b) => b.pop - a.pop);
  const geo = [], hs = [], ht = [];
  for (const [name, , pop] of list) {
    rows++;
    const hit = pool.find((c) => c.name === name && c.pop === pop) ?? pool.find((c) => c.name === name);
    geo.push(hit ? `${hit.lat.toFixed(3)},${hit.lon.toFixed(3)}` : '');
    const z = hit ? chinese(hit.id) : null;
    hs.push(z?.hans ?? ''); ht.push(z?.hant ?? '');
    if (z) withZh++; else if (hit) missing.push(hit.id);
    if (hit) withGeo++;
  }
  GEO[cc] = geo.join(';'); ZH_S[cc] = hs.join('|'); ZH_T[cc] = ht.join('|');
  const ci = countries[cc];
  const z = ci ? chinese(ci.id) : null;
  const cap = ci ? (byCc[cc] ?? []).find((c) => c.name === ci.capital) ?? pool[0] : pool[0];
  COUNTRY[cc] = [z?.hans ?? '', z?.hant ?? '', cap ? Number(cap.lat.toFixed(3)) : 0, cap ? Number(cap.lon.toFixed(3)) : 0];
}
writeFileSync(join(dir, 'need.json'), JSON.stringify(missing));
console.log(`${rows} cities, ${withGeo} with coordinates, ${withZh} with Chinese names; countries with names: ${Object.values(COUNTRY).filter((c) => c[0]).length}/${Object.keys(COUNTRY).length}`);
const out = `// GENERATED by scripts/build-places.mjs — do not edit by hand.
// For the cities of data/cities.ts (same order inside each country): "lat,lon" rows joined by ";", and Simplified / Traditional Chinese names joined by "|".
// COUNTRY: country code → [Simplified name, Traditional name, latitude, longitude of the capital]. Source: GeoNames (CC BY 4.0).
export const PLACE_GEO: Record<string, string> = ${JSON.stringify(GEO)};
export const PLACE_HANS: Record<string, string> = ${JSON.stringify(ZH_S)};
export const PLACE_HANT: Record<string, string> = ${JSON.stringify(ZH_T)};
export const COUNTRY_GEO: Record<string, [string, string, number, number]> = ${JSON.stringify(COUNTRY)};
`;
writeFileSync('src/core/data/places.ts', out);
console.log((out.length / 1024).toFixed(0) + ' KB');
