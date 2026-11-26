// The picture under a Map: OpenStreetMap data drawn as vector tiles (OpenFreeMap, OpenMapTiles schema), so that the names on it can be written in
// the interface language: English, Simplified or Traditional Chinese. Ordinary OpenStreetMap picture tiles carry one fixed set of names.
//
// The view (centre and zoom) belongs to MapView, which also draws the pin and the outline of an area over this layer and handles the drag and
// the zoom: this layer only follows it, so it is never interactive itself. A tile of 256 px at zoom z is a tile of 512 px at zoom z - 1.
import { useEffect, useRef } from 'react';
import 'maplibre-gl/dist/maplibre-gl.css';
import type { Lang } from '../i18n';

const STYLE_URL = 'https://tiles.openfreemap.org/styles/liberty';

type Json = any;
let styleJob: Promise<Json> | null = null;
/** The base style, fetched once. A failed fetch is forgotten so that the next map tries again. */
function baseStyle(): Promise<Json> {
  if (!styleJob) {
    styleJob = fetch(STYLE_URL).then((r) => { if (!r.ok) throw new Error(`style ${r.status}`); return r.json(); });
    styleJob.catch(() => { styleJob = null; });
  }
  return styleJob;
}

/**
 * What a label says, in a language. The first name a feature has wins; the name in the place's own language is the last resort, so a
 * place that nobody translated still has a label.
 */
export function labelExpression(lang: Lang): Json {
  const get = (k: string) => ['get', k];
  if (lang === 'zh-Hans') return ['coalesce', get('name:zh-Hans'), get('name:zh'), get('name')];
  if (lang === 'zh-Hant') return ['coalesce', get('name:zh-Hant'), get('name:zh'), get('name')];
  return ['coalesce', get('name:en'), get('name:latin'), get('name')];
}

/** Every label that shows a name (not a road number or a house number) is drawn from the language's expression. */
const isNameLabel = (layer: Json) => layer.type === 'symbol' && layer.layout && layer.layout['text-field'] !== undefined && JSON.stringify(layer.layout['text-field']).includes('name');

function localized(style: Json, lang: Lang): Json {
  const s = JSON.parse(JSON.stringify(style));
  for (const l of s.layers) if (isNameLabel(l)) l.layout['text-field'] = labelExpression(lang);
  return s;
}

function writeNames(m: any, lang: Lang) {
  try {
    for (const l of m.getStyle()?.layers ?? []) if (isNameLabel(l)) m.setLayoutProperty(l.id, 'text-field', labelExpression(lang));
  } catch { /* the map is being removed */ }
}

interface View { lat: number; lon: number; z: number }

export function VectorMap({ view, w, h, lang, onFail, onReady }: { view: View; w: number; h: number; lang: Lang; onFail: () => void; onReady: () => void }) {
  const host = useRef<HTMLDivElement>(null);
  const map = useRef<any>(null);
  const loaded = useRef(false);
  const latest = useRef({ view, lang, onFail, onReady });
  latest.current = { view, lang, onFail, onReady };

  useEffect(() => {
    let dead = false;
    let m: any = null;
    (async () => {
      try {
        const [lib, style] = await Promise.all([import('maplibre-gl'), baseStyle()]);
        if (dead || !host.current) return;
        const GL: any = (lib as any).Map ?? (lib as any).default?.Map;
        const { view: v, lang: l } = latest.current;
        m = new GL({
          container: host.current,
          style: localized(style, l),
          center: [v.lon, v.lat],
          zoom: v.z - 1,
          interactive: false,
          attributionControl: false,
          fadeDuration: 0,
          // The Noto Sans of the tile server draws every Chinese character, so the browser's own fonts are never used for the map.
          localIdeographFontFamily: false,
        });
        map.current = m;
        m.once('load', () => {
          if (dead) return;
          loaded.current = true;
          writeNames(m, latest.current.lang); // the language may have changed while the style was loading
          latest.current.onReady();
        });
        // A style or WebGL failure that arrives after the start (lost context) hands the picture back to the plain tiles.
        m.on('webglcontextlost', () => { if (!dead) latest.current.onFail(); });
      } catch {
        if (!dead) latest.current.onFail();
      }
    })();
    return () => { dead = true; map.current = null; try { m?.remove(); } catch { /* already gone */ } };
  }, []);

  // Follow the view.
  useEffect(() => {
    const m = map.current;
    if (!m) return;
    m.resize();
    m.jumpTo({ center: [view.lon, view.lat], zoom: view.z - 1 });
  }, [view.lat, view.lon, view.z, w, h]);

  // Follow the language: every name on the map is written again, with no reload.
  useEffect(() => {
    if (map.current && loaded.current) writeNames(map.current, lang);
  }, [lang]);

  return <div ref={host} className="mapv-gl" />;
}
