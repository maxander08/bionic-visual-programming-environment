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

describe('GUI layer isolation and stacking invariants', () => {
  const gui = readFileSync(join(SRC, 'ui', 'gui.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  const indexCss = readFileSync(join(SRC, 'index.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  const mainTsx = readFileSync(join(SRC, 'main.tsx'), 'utf8');

  it('imports gui.css after shell.css and before typography.css', () => {
    const iShell = mainTsx.search(/import\s+['"]\.\/ui\/shell\.css['"]/);
    const iGui = mainTsx.search(/import\s+['"]\.\/ui\/gui\.css['"]/);
    const iTypo = mainTsx.search(/import\s+['"]\.\/ui\/typography\.css['"]/);
    expect(iShell).toBeGreaterThan(-1);
    expect(iGui).toBeGreaterThan(iShell);
    expect(iTypo).toBeGreaterThan(iGui);
  });

  it('declares no font-family rules and redefines no legacy canvas/node variables in gui.css', () => {
    expect(/font-family\s*:/i.test(gui)).toBe(false);
    expect(/--(acc|err|warn|dim|text|line|ui|font|code)\s*:/.test(gui)).toBe(false);
  });

  it('targets no canvas, node, wire, port, or minimap selectors in gui.css', () => {
    const forbidden = /\.(node|canvas-root|world|wires|port|port-tip|minimap|empty-hint)(?![a-zA-Z0-9_-])/;
    expect(forbidden.test(gui)).toBe(false);
  });

  it('keeps z-index layering coherent: diag-pop < g-panel < modal (100) < toasts', () => {
    const zOf = (sel: string) => {
      const m = gui.match(new RegExp(`\\.${sel}\\s*\\{[^}]*z-index:\\s*(\\d+)`));
      return m ? Number(m[1]) : NaN;
    };
    const diag = zOf('diag-pop');
    const gosling = zOf('g-panel');
    const toasts = zOf('toasts');
    expect(diag).toBeLessThan(gosling);
    expect(gosling).toBeLessThan(100);
    expect(toasts).toBeGreaterThan(100);
  });

  it('scopes canvas snap-ghost styling under .ghosts so it cannot hide .g-btn.ghost', () => {
    expect(/(^|[\r\n}])\s*\.ghost\s*\{/.test(indexCss)).toBe(false);
    expect(/\.ghosts\s+\.ghost\s*\{/.test(indexCss)).toBe(true);
  });
});
