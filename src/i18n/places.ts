// Chinese names of the places the app knows: the cities of the World Clock list and the countries (core/data/places.ts).
// `trPlace` asks here after the hand-made `city:` entries of the dictionary, so every city and country with a Chinese name is shown in it.
import { CITY_DATA } from '../core/data/cities';
import { COUNTRY_GEO, PLACE_HANS, PLACE_HANT } from '../core/data/places';

type Names = { hans: Map<string, string>; hant: Map<string, string> };
let names: Names | null = null;

function build(): Names {
  const hans = new Map<string, string>(), hant = new Map<string, string>();
  const best = new Map<string, number>(); // population of the city that owns the entry: a name shared by several cities means the biggest
  for (const [cc, country, rows] of CITY_DATA.c) {
    const s = (PLACE_HANS[cc] ?? '').split('|'), t = (PLACE_HANT[cc] ?? '').split('|');
    rows.forEach(([name, , pop], i) => {
      if (!s[i] || (best.get(name) ?? -1) >= pop) return;
      best.set(name, pop);
      hans.set(name, s[i]);
      hant.set(name, t[i] || s[i]);
    });
    const g = COUNTRY_GEO[cc];
    if (g?.[0] && !hans.has(country)) { hans.set(country, g[0]); hant.set(country, g[1] || g[0]); }
  }
  return { hans, hant };
}

/** The Chinese name of an English city or country name, or undefined. */
export function placeName(lang: string, name: string): string | undefined {
  if (lang !== 'zh-Hans' && lang !== 'zh-Hant') return undefined;
  names ??= build();
  return (lang === 'zh-Hans' ? names.hans : names.hant).get(name);
}
