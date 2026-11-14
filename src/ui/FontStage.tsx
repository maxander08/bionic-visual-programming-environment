// The Projector's view of a font file: type your own text in it, see it at every size, and browse the characters it can draw.
// The font is installed into this page under a private name (runtime/fonts.ts) — nothing is uploaded or installed on the computer.
import { useEffect, useMemo, useRef, useState } from 'react';
import { SPECIMEN } from '../core/fontinfo';
import type { FileDescriptor, FileInfo } from '../core/files';
import { registerFont } from '../runtime/fonts';
import { tr } from '../i18n';
import { Icon } from './icons';

interface Block { id: string; label: string; from: number; to: number }
const BLOCKS: Block[] = [
  { id: 'latin', label: 'Basic Latin', from: 0x21, to: 0x7e },
  { id: 'latin1', label: 'Latin-1', from: 0xa1, to: 0xff },
  { id: 'latinx', label: 'Latin Extended', from: 0x100, to: 0x24f },
  { id: 'greek', label: 'Greek', from: 0x370, to: 0x3ff },
  { id: 'cyrillic', label: 'Cyrillic', from: 0x400, to: 0x4ff },
  { id: 'punct', label: 'Punctuation', from: 0x2010, to: 0x206f },
  { id: 'currency', label: 'Currency', from: 0x20a0, to: 0x20bf },
  { id: 'arrows', label: 'Arrows & Math', from: 0x2190, to: 0x22ff },
  { id: 'shapes', label: 'Shapes', from: 0x2500, to: 0x25ff },
];

const PRESETS: { id: string; label: string; text: string }[] = [
  { id: 'pangram', label: 'Pangram', text: SPECIMEN.pangram },
  { id: 'upper', label: 'Uppercase', text: SPECIMEN.upper },
  { id: 'lower', label: 'Lowercase', text: SPECIMEN.lower },
  { id: 'digits', label: 'Digits & symbols', text: SPECIMEN.digits },
  { id: 'accents', label: 'Accents', text: SPECIMEN.accents },
  { id: 'custom', label: 'Your own text', text: '' },
];

const SIZES = [12, 14, 18, 24, 32, 48, 72];

const stack = (css: string) => `"${css}", sans-serif`;

/**
 * Which characters of a range does the font really draw? A missing glyph is drawn by a fallback font, so a character counts as
 * present when drawing it with the font in front differs from the fallback alone — checked against both a sans and a serif
 * fallback, so a font that happens to look like one of them is still recognised.
 */
function supportedChars(css: string, from: number, to: number): string[] {
  const mk = () => { const c = document.createElement('canvas'); c.width = 44; c.height = 44; return c; };
  const cv = [mk(), mk(), mk(), mk()];
  const rawCtx = cv.map((c) => c.getContext('2d', { willReadFrequently: true }));
  if (rawCtx.some((g) => !g)) return [];
  const ctx = rawCtx as CanvasRenderingContext2D[];
  const fonts = [`32px "${css}", sans-serif`, '32px sans-serif', `32px "${css}", serif`, '32px serif'];
  const shot = (i: number, ch: string) => {
    const g = ctx[i];
    g.clearRect(0, 0, 44, 44);
    g.font = fonts[i];
    g.textBaseline = 'middle';
    g.fillStyle = '#000';
    g.fillText(ch, 4, 24);
    return g.getImageData(0, 0, 44, 44).data;
  };
  const same = (a: Uint8ClampedArray, b: Uint8ClampedArray) => { for (let i = 3; i < a.length; i += 4) if (a[i] !== b[i]) return false; return true; };
  const out: string[] = [];
  for (let cp = from; cp <= to; cp++) {
    const ch = String.fromCodePoint(cp);
    if (/\s/.test(ch)) continue;
    const a = shot(0, ch), b = shot(1, ch);
    if (!same(a, b)) { out.push(ch); continue; }
    const c = shot(2, ch), d = shot(3, ch);
    if (!same(c, d)) out.push(ch);
  }
  return out;
}

function GlyphBrowser({ css, onPick }: { css: string; onPick: (ch: string) => void }) {
  const [block, setBlock] = useState(BLOCKS[0].id);
  const [sel, setSel] = useState<string | null>(null);
  const cache = useRef(new Map<string, string[]>());
  const [chars, setChars] = useState<string[] | null>(null);
  const b = BLOCKS.find((x) => x.id === block)!;
  useEffect(() => { setSel(null); }, [css]);
  useEffect(() => {
    const key = `${css}|${block}`;
    const hit = cache.current.get(key);
    if (hit) { setChars(hit); return; }
    setChars(null);
    // Let the tab paint before the (brief) measuring work.
    const t = setTimeout(() => { const r = supportedChars(css, b.from, b.to); cache.current.set(key, r); setChars(r); }, 20);
    return () => clearTimeout(t);
  }, [css, block, b.from, b.to]);
  const total = b.to - b.from + 1;
  return (
    <section className="fs-sec" aria-label={tr('Characters')}>
      <h3 className="fs-h">{tr('Characters')}</h3>
      <div className="fs-tabs" role="tablist" aria-label={tr('Character sets')}>
        {BLOCKS.map((x) => <button key={x.id} type="button" role="tab" aria-selected={x.id === block} className={x.id === block ? 'on' : ''} onClick={() => { setBlock(x.id); setSel(null); }}>{tr(x.label)}</button>)}
      </div>
      <p className="pw-meta">{chars === null ? tr('Checking the font…') : tr('{n} of {t} characters in this set', { n: chars.length, t: total })}</p>
      {chars !== null && chars.length === 0 && <p className="muted">{tr('This font has no characters in this set.')}</p>}
      <div className="fs-grid" style={{ fontFamily: stack(css) }}>
        {(chars ?? []).map((ch) => (
          <button key={ch} type="button" className={`fs-cell ${sel === ch ? 'on' : ''}`} aria-label={`U+${ch.codePointAt(0)!.toString(16).toUpperCase().padStart(4, '0')} ${ch}`}
            onClick={() => setSel(ch)} onDoubleClick={() => onPick(ch)}>{ch}</button>
        ))}
      </div>
      {sel && (
        <div className="fs-pick">
          <span className="fs-big" style={{ fontFamily: stack(css) }}>{sel}</span>
          <span className="pw-meta">U+{sel.codePointAt(0)!.toString(16).toUpperCase().padStart(4, '0')}</span>
          <button type="button" className="btn sm" onClick={() => onPick(sel)}>{tr('Add to the text')}</button>
        </div>
      )}
      {chars !== null && chars.length > 0 && <p className="pw-meta">{tr('Click a character to enlarge it; double-click to add it to the text above.')}</p>}
    </section>
  );
}

export function FontStage({ file, info, blob }: { file: FileDescriptor; info?: FileInfo; blob: Blob }) {
  const [css, setCss] = useState<string | null | undefined>(info?.cssFamily);
  const [preset, setPreset] = useState('pangram');
  const [text, setText] = useState(SPECIMEN.pangram);
  const [size, setSize] = useState(56);
  const [invert, setInvert] = useState(false);

  useEffect(() => {
    let alive = true;
    setCss(undefined);
    void registerFont(file.id, blob).then((c) => { if (alive) setCss(c); });
    return () => { alive = false; };
  }, [file.id, blob]);

  const family = info?.family || file.name;
  const meta = useMemo(() => [
    [tr('Family'), family], info?.style ? [tr('Style'), info.style] : null, info?.glyphs !== undefined ? [tr('Glyphs'), info.glyphs.toLocaleString('en-US')] : null,
    info?.fontFormat ? [tr('Format'), tr(info.fontFormat)] : null, info?.fontVersion ? [tr('Version'), info.fontVersion] : null,
  ].filter(Boolean) as [string, string][], [family, info]);

  if (css === undefined) return <p className="muted pad12">{tr('Loading the font…')}</p>;
  if (css === null) {
    return (
      <div className="pw-card">
        <span className="pw-badge">{'.' + file.ext.toUpperCase()}</span>
        <p className="callout warn"><Icon name="alert" size={14} />{tr('This browser could not load the font, so it cannot be previewed. The file may be damaged. The Details and Hex tabs still show what is in it.')}</p>
      </div>
    );
  }
  const ff = stack(css);
  const sample = text.trim() === '' ? SPECIMEN.pangram : text;
  return (
    <div className={`fs ${invert ? 'light' : ''}`}>
      <div className="fs-bar">
        <label className="fs-ctl">{tr('Sample')}
          <select value={preset} onChange={(e) => { setPreset(e.target.value); const p = PRESETS.find((x) => x.id === e.target.value); if (p && p.id !== 'custom') setText(p.text); }}>
            {PRESETS.map((p) => <option key={p.id} value={p.id}>{tr(p.label)}</option>)}
          </select>
        </label>
        <label className="fs-ctl">{tr('Size')}
          <input type="range" min={10} max={200} value={size} onChange={(e) => setSize(Number(e.target.value))} aria-valuetext={`${size} px`} />
          <span className="pw-meta fs-num">{size} px</span>
        </label>
        <button type="button" className="btn sm" aria-pressed={invert} onClick={() => setInvert(!invert)}>{invert ? tr('Dark background') : tr('Light background')}</button>
      </div>
      <dl className="fs-facts">{meta.map(([k, v]) => <div key={k}><dt>{k}</dt><dd title={v}>{v}</dd></div>)}</dl>
      <section className="fs-sec" aria-label={tr('Type here')}>
        <textarea className="fs-type" value={text} spellCheck={false} placeholder={tr('Type here to try the font')} aria-label={tr('Text to show in the font')}
          style={{ fontFamily: ff, fontSize: size }} onChange={(e) => { setText(e.target.value); setPreset('custom'); }} />
      </section>
      <section className="fs-sec" aria-label={tr('Sizes')}>
        <h3 className="fs-h">{tr('Sizes')}</h3>
        <div className="fs-ladder" style={{ fontFamily: ff }}>
          {SIZES.map((s) => (
            <div key={s} className="fs-row"><span className="fs-px">{s}</span><span className="fs-line" style={{ fontSize: s }}>{sample.split('\n')[0]}</span></div>
          ))}
        </div>
      </section>
      <GlyphBrowser css={css} onPick={(ch) => { setText((t) => t + ch); setPreset('custom'); }} />
    </div>
  );
}
