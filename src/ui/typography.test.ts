import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

// Policy: Chinese text may only use Noto Sans SC (Simplified) or Noto Sans TC (Traditional).
const SRC = join(__dirname, '..');
const walk = (d: string): string[] => readdirSync(d).flatMap((f) => {
  const p = join(d, f);
  return statSync(p).isDirectory() ? (f === 'assets' ? [] : walk(p)) : [p];
});
const styleFiles = walk(SRC).filter((f) => /\.(css|tsx?)$/.test(f) && !/\.test\.ts$/.test(f));

const FORBIDDEN = [
  'PingFang', 'Hiragino', 'Heiti', 'STHeiti', 'Songti', 'STSong', 'Kaiti', 'Microsoft YaHei', 'Microsoft JhengHei', 'MingLiU', 'PMingLiU',
  'SimSun', 'SimHei', 'FangSong', 'DengXian', 'WenQuanYi', 'Droid Sans Fallback', 'Source Han', 'Noto Sans CJK', 'Noto Serif', 'Noto Sans HK',
  'Noto Sans JP', 'Noto Sans KR', 'Yu Gothic', 'Meiryo', 'Malgun', 'Apple SD Gothic', 'Arial Unicode',
];

describe('Chinese typography policy', () => {
  it('names no Chinese typeface other than Noto Sans SC / TC anywhere in the source', () => {
    for (const f of styleFiles) {
      const text = readFileSync(f, 'utf8');
      for (const bad of FORBIDDEN) expect(text.includes(bad), `${f} mentions “${bad}”`).toBe(false);
    }
  });

  const css = readFileSync(join(SRC, 'ui', 'typography.css'), 'utf8');
  it('declares both Noto faces, bundled and without a system fallback flash', () => {
    for (const n of ['SC', 'TC']) {
      expect(css).toMatch(new RegExp(`font-family: "Noto Sans ${n}";\\s*src: url\\("../assets/fonts/NotoSans${n}-subset.woff2"\\)`));
    }
    expect(css.match(/font-display: block/g)?.length).toBe(2);
  });

  it('puts the matching Noto face in every stack (ui, code, node) for each Chinese mode', () => {
    for (const kind of ['ui', 'code', 'font']) {
      expect(css).toMatch(new RegExp(`--${kind}-sc:[^;]*"Noto Sans SC"`));
      expect(css).toMatch(new RegExp(`--${kind}-tc:[^;]*"Noto Sans TC"`));
      expect(css).not.toMatch(new RegExp(`--${kind}-sc:[^;]*"Noto Sans TC"`));
      expect(css).not.toMatch(new RegExp(`--${kind}-tc:[^;]*"Noto Sans SC"`));
    }
  });

  it('switches stacks with the document language and honours elements with their own lang', () => {
    expect(css).toMatch(/:root:lang\(zh-Hant\)\s*{[^}]*--ui: var\(--ui-tc\)[^}]*--font: var\(--font-tc\)/);
    expect(css).toMatch(/\[lang="zh-Hans"\]:not\(:root\)\s*{ font-family: var\(--ui-sc\)/);
    expect(css).toMatch(/\[lang="zh-Hant"\]:not\(:root\)\s*{ font-family: var\(--ui-tc\)/);
  });

  it('defines no other source of --ui / --font / --code', () => {
    for (const f of styleFiles.filter((x) => x.endsWith('.css') && !x.endsWith('typography.css'))) {
      const text = readFileSync(f, 'utf8');
      expect(/--(ui|font|code):\s*["a-zA-Z]/.test(text), `${f} redefines a font stack`).toBe(false);
    }
  });
});
