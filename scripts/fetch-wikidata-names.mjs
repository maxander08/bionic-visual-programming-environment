// Fetches Chinese labels from Wikidata for the GeoNames ids in <dir>/need.json (written by build-places.mjs) into <dir>/wd.json.
//   node scripts/fetch-wikidata-names.mjs <dir>
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const dir = process.argv[2] ?? '.';
const need = JSON.parse(readFileSync(join(dir, 'need.json'), 'utf8'));
const out = {};
const BATCH = 150;
for (let i = 0; i < need.length; i += BATCH) {
  const ids = need.slice(i, i + BATCH);
  const q = `SELECT ?g ?lh ?lt ?lz ?lc ?lw ?lk WHERE { VALUES ?g { ${ids.map((x) => `"${x}"`).join(' ')} } ?e wdt:P1566 ?g .
    OPTIONAL { ?e rdfs:label ?lh FILTER(LANG(?lh) = "zh-hans") } OPTIONAL { ?e rdfs:label ?lt FILTER(LANG(?lt) = "zh-hant") }
    OPTIONAL { ?e rdfs:label ?lz FILTER(LANG(?lz) = "zh") } OPTIONAL { ?e rdfs:label ?lc FILTER(LANG(?lc) = "zh-cn") }
    OPTIONAL { ?e rdfs:label ?lw FILTER(LANG(?lw) = "zh-tw") } OPTIONAL { ?e rdfs:label ?lk FILTER(LANG(?lk) = "zh-hk") } }`;
  for (let attempt = 0; attempt < 4; attempt++) {
    const r = await fetch('https://query.wikidata.org/sparql', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/sparql-results+json', 'user-agent': 'nicque-build/1.0 (places names)' }, body: 'query=' + encodeURIComponent(q) });
    if (!r.ok) { await new Promise((res) => setTimeout(res, 3000 * (attempt + 1))); continue; }
    const j = await r.json();
    for (const b of j.results.bindings) {
      const v = (k) => b[k]?.value;
      out[b.g.value] = { hans: v('lh') ?? v('lc'), hant: v('lt') ?? v('lw') ?? v('lk'), zh: v('lz') };
    }
    break;
  }
  console.log(Math.min(i + BATCH, need.length), '/', need.length, Object.keys(out).length);
}
writeFileSync(join(dir, 'wd.json'), JSON.stringify(out));
