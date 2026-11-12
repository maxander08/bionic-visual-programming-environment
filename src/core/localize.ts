// Localised views of module definitions. The definitions themselves stay English (they are the source of truth and the
// dictionary keys); the editor asks `localizeDef` for a translated copy. Only display text is changed: ids, keys, option
// values, ranges and run functions are shared with the original, so saved programs and the engine are unaffected.
import type { Lang } from '../i18n';
import { getLang, tr } from '../i18n';
import type { ModuleDef, ParamDef, PortDef } from './types';

const defCache = new Map<Lang, WeakMap<ModuleDef, ModuleDef>>();
const paramCache = new Map<Lang, WeakMap<ParamDef, ParamDef>>();

const port = (p: PortDef): PortDef => ({ ...p, label: tr(p.label), doc: tr(p.doc) });

export function localizeParam(p: ParamDef): ParamDef {
  const lang = getLang();
  if (lang === 'en') return p;
  let m = paramCache.get(lang);
  if (!m) paramCache.set(lang, (m = new WeakMap()));
  let r = m.get(p);
  if (!r) {
    const base = { ...p, label: tr(p.label), doc: tr(p.doc) } as any;
    if (p.kind === 'number' && p.unit) base.unit = tr(p.unit);
    if (p.kind === 'text' && p.placeholder) base.placeholder = tr(p.placeholder);
    if (p.kind === 'select') base.options = p.options.map((o) => ({ value: o.value, label: tr(o.label) }));
    m.set(p, (r = base as ParamDef));
  }
  return r;
}

export function localizeDef(def: ModuleDef): ModuleDef {
  const lang = getLang();
  if (lang === 'en') return def;
  let m = defCache.get(lang);
  if (!m) defCache.set(lang, (m = new WeakMap()));
  let r = m.get(def);
  if (!r) {
    const title = def.title, chip = def.chip, dyn = def.dynamicParams;
    r = {
      ...def,
      name: tr(def.name),
      caption: tr(def.caption),
      // Keep the English words searchable so “threshold” still finds the module in Chinese mode.
      keywords: `${def.keywords ?? ''} ${def.name} ${def.caption}`.trim(),
      title: title ? (p) => tr(title(p)) : undefined,
      chip: chip ? (p) => tr(chip(p)) : undefined,
      inputs: def.inputs.map(port),
      outputs: def.outputs.map(port),
      params: def.params.map(localizeParam),
      dynamicParams: dyn ? (p) => dyn(p).map(localizeParam) : undefined,
      doc: {
        summary: tr(def.doc.summary),
        runtime: tr(def.doc.runtime),
        errors: def.doc.errors?.map((e) => tr(e)),
        examples: def.doc.examples?.map((e) => tr(e)),
      },
    };
    m.set(def, r);
  }
  return r;
}
