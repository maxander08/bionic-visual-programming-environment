// Browser side of the Font File node: installs a loaded font into this page (FontFace API) under a private name, so previews can draw
// text with it, and draws the “specimen” picture that the node sends on its Specimen pin. Nothing leaves the browser and nothing is
// installed on the computer — the font lives only as long as the page.
import type { ImageSig } from '../core/types';
import { familyFromFileName, parseFont, type Brotli, type FontMeta } from '../core/fontinfo';

/** Brotli through the browser's DecompressionStream, where it is offered (recent Chromium, Safari, Firefox). Otherwise null. */
export const browserBrotli: Brotli = async (data) => {
  try {
    if (typeof DecompressionStream === 'undefined') return null;
    const ds = new DecompressionStream('brotli' as CompressionFormat);
    const stream = new Blob([data as BlobPart]).stream().pipeThrough(ds);
    return new Uint8Array(await new Response(stream).arrayBuffer());
  } catch { return null; }
};

const registered = new Map<string, Promise<string | null>>();

/**
 * Install a font file under a name that belongs to this file alone. Resolves to that CSS family name, or null when the browser
 * refuses the bytes. Asking again for the same id gives the same answer without loading twice.
 */
export function registerFont(id: string, blob: Blob): Promise<string | null> {
  let p = registered.get(id);
  if (!p) {
    const css = `ns-font-${id}`;
    p = (async () => {
      try {
        if (typeof FontFace === 'undefined' || typeof document === 'undefined') return null;
        const face = new FontFace(css, await blob.arrayBuffer(), { display: 'block' });
        await face.load();
        document.fonts.add(face);
        return css;
      } catch { return null; }
    })();
    registered.set(id, p);
  }
  return p;
}

/** Forget an installed font (used when its file is replaced for good). Harmless if it was never installed. */
export function releaseFont(id: string) {
  registered.delete(id);
  try { document.fonts.forEach((f) => { if (f.family.replace(/["']/g, '') === `ns-font-${id}`) document.fonts.delete(f); }); } catch { /* nothing to release */ }
}

export interface FontFacts { meta: FontMeta | null; family: string; css: string | null }

/** Everything the app learns about a font file: the names inside it and a page-private family to draw with. */
export async function readFont(id: string, file: File): Promise<FontFacts> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const [meta, css] = await Promise.all([parseFont(bytes, browserBrotli), registerFont(id, file)]);
  return { meta, css, family: meta?.family || familyFromFileName(file.name) };
}

/** The specimen picture: the family name set in the font, then letters and digits. White on near-black like the rest of the app. */
export function drawSpecimen(css: string, family: string): ImageSig | null {
  try {
    const W = 384, H = 192;
    const cv = document.createElement('canvas');
    cv.width = W; cv.height = H;
    const ctx = cv.getContext('2d', { willReadFrequently: true });
    if (!ctx) return null;
    ctx.fillStyle = '#0b0d10';
    ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = '#f2f2f2';
    ctx.textBaseline = 'alphabetic';
    // Family name, shrunk until it fits.
    let size = 64;
    const q = (px: number) => `${px}px "${css}", sans-serif`;
    ctx.font = q(size);
    while (size > 18 && ctx.measureText(family).width > W - 32) { size -= 2; ctx.font = q(size); }
    ctx.fillText(family, 16, 20 + size * 0.85, W - 32);
    ctx.fillStyle = '#bdbdbd';
    const lines = ['ABCDEFGHIJKLMNOPQRSTUVWXYZ', 'abcdefghijklmnopqrstuvwxyz', '0123456789 !?&@#%'];
    let y = 20 + size + 28;
    for (const l of lines) {
      let s = 22;
      ctx.font = q(s);
      while (s > 10 && ctx.measureText(l).width > W - 32) { s -= 1; ctx.font = q(s); }
      ctx.fillText(l, 16, y, W - 32);
      y += s + 10;
    }
    const d = ctx.getImageData(0, 0, W, H);
    return { w: d.width, h: d.height, data: d.data };
  } catch { return null; }
}
