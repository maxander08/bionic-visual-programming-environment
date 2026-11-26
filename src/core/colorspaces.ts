// Colors written the ways the Color module takes and gives them: CMYK (percent) and hex text. Pure maths.
export type RGB = [number, number, number];

const to255 = (x: number) => Math.min(255, Math.max(0, Math.round(x)));

/** C, M, Y, K in percent (0–100) → sRGB 0–255, the plain conversion screens use (no ink profile). */
export function cmykToRgb(c: number, m: number, y: number, k: number): RGB {
  const K = 1 - Math.min(100, Math.max(0, k)) / 100;
  const ch = (v: number) => to255(255 * (1 - Math.min(100, Math.max(0, v)) / 100) * K);
  return [ch(c), ch(m), ch(y)];
}

/** sRGB 0–255 → C, M, Y, K in percent, one decimal. */
export function rgbToCmyk([r, g, b]: RGB): [number, number, number, number] {
  const R = r / 255, G = g / 255, B = b / 255;
  const k = 1 - Math.max(R, G, B);
  const t = (v: number) => Math.round(v * 1000) / 10;
  if (k >= 1) return [0, 0, 0, 100];
  return [t((1 - R - k) / (1 - k)), t((1 - G - k) / (1 - k)), t((1 - B - k) / (1 - k)), t(k)];
}

export const rgbToHex = ([r, g, b]: RGB) => '#' + [r, g, b].map((x) => to255(x).toString(16).padStart(2, '0')).join('');

/** “#0a7aff”, “0a7aff”, “#0af” or “#0a7affcc” (the opacity is ignored) → sRGB; null when the text is not a hex color. */
export function parseHex(text: string): RGB | null {
  const m = /^\s*(?:#|0x)?([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})\s*$/i.exec(text);
  if (!m) return null;
  let h = m[1];
  if (h.length <= 4) h = h.split('').map((x) => x + x).join('');
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}
