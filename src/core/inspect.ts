// Ways of looking inside a file whose kind has no better view: a hex dump, a check for “is this really text”, and a list of what is
// inside a .TAR. Pure bytes-in, facts-out, so every file in the Files section can be previewed in the Projector.

export interface HexRow { offset: string; hex: string; ascii: string }

/** Rows of a classic hex dump: eight-digit offset, 16 bytes in hex, and the printable ASCII beside them. */
export function hexRows(bytes: Uint8Array, base = 0, width = 16): HexRow[] {
  const rows: HexRow[] = [];
  for (let i = 0; i < bytes.length; i += width) {
    const part = bytes.subarray(i, Math.min(bytes.length, i + width));
    let hex = '', ascii = '';
    for (let j = 0; j < width; j++) {
      if (j < part.length) {
        const c = part[j];
        hex += c.toString(16).padStart(2, '0') + (j === 7 ? '  ' : ' ');
        ascii += c >= 0x20 && c < 0x7f ? String.fromCharCode(c) : '·';
      } else hex += '   ' + (j === 7 ? ' ' : '');
    }
    rows.push({ offset: (base + i).toString(16).padStart(8, '0'), hex: hex.trimEnd(), ascii });
  }
  return rows;
}

/**
 * The text of a file when it really is text, otherwise null. A file is text when it has no NUL bytes, hardly any control characters
 * and decodes cleanly as UTF-8 (or UTF-16 with a byte-order mark). `truncated` says the bytes are only the start of a longer file,
 * so a character cut in half at the end is not held against it.
 */
export function textIfText(bytes: Uint8Array, truncated = false): string | null {
  if (bytes.length === 0) return '';
  const probe = bytes.subarray(0, 8192);
  try {
    if (probe.length >= 2 && ((probe[0] === 0xff && probe[1] === 0xfe) || (probe[0] === 0xfe && probe[1] === 0xff))) {
      if (!truncated && bytes.length % 2 === 1) return null;
      const slice = truncated ? bytes.subarray(0, bytes.length & ~1) : bytes;
      const text = new TextDecoder(probe[0] === 0xff ? 'utf-16le' : 'utf-16be', { fatal: true }).decode(slice);
      const checkLen = Math.min(text.length, 4096);
      let ctl = 0;
      for (let i = 0; i < checkLen; i++) {
        const c = text.charCodeAt(i);
        if (c === 0) return null;
        if (c < 0x20 && c !== 9 && c !== 10 && c !== 13 && c !== 12 && c !== 27) ctl++;
      }
      return checkLen > 0 && ctl / checkLen > 0.02 ? null : text;
    }
    let ctl = 0;
    for (const c of probe) {
      if (c === 0) return null;
      if (c < 0x20 && c !== 9 && c !== 10 && c !== 13 && c !== 12 && c !== 27) ctl++;
    }
    if (ctl / probe.length > 0.02) return null;
    return new TextDecoder('utf-8', { fatal: true }).decode(truncated ? bytes.subarray(0, safeUtf8End(bytes)) : bytes);
  } catch { return null; }
}

/** Index to cut a UTF-8 byte run at so that it does not end in the middle of a character. */
function safeUtf8End(b: Uint8Array): number {
  const n = b.length;
  for (let k = 1; k <= Math.min(3, n); k++) {
    const c = b[n - k];
    if ((c & 0xc0) === 0x80) continue; // continuation byte: keep looking for its lead byte
    if (c >= 0xc0) { const need = c >= 0xf0 ? 4 : c >= 0xe0 ? 3 : 2; return need > k ? n - k : n; }
    return n; // plain ASCII at the end: nothing is cut
  }
  return n;
}

export interface TarEntry { name: string; size: number; dir: boolean }

const octal = (b: Uint8Array, o: number, n: number): number => {
  let i = o;
  const end = Math.min(b.length, o + n);
  while (i < end && (b[i] === 0x20 || b[i] === 0)) i++;
  let s = '';
  while (i < end && b[i] !== 0 && b[i] !== 0x20) {
    const c = b[i++];
    if (c < 0x30 || c > 0x37) return NaN;
    s += String.fromCharCode(c);
  }
  return s ? parseInt(s, 8) : 0;
};
const cstr = (b: Uint8Array, o: number, n: number) => { let e = o; while (e < o + n && b[e] !== 0) e++; return new TextDecoder().decode(b.subarray(o, e)); };

function validTarHeader(b: Uint8Array, p: number): boolean {
  if (p + 512 > b.length) return false;
  let sum = 0;
  for (let i = 0; i < 512; i++) sum += i >= 148 && i < 156 ? 0x20 : b[p + i];
  const want = octal(b, p + 148, 8);
  return Number.isFinite(want) && want > 0 && sum === want;
}

/** Is this the start of a tar archive? Checks the header checksum of the first block. */
export function isTar(b: Uint8Array): boolean {
  return validTarHeader(b, 0);
}

/** What is inside a tar archive. Stops after `limit` entries. Nothing is unpacked. */
export function listTar(b: Uint8Array, limit = 5000): { entries: TarEntry[]; more: boolean } | null {
  if (!isTar(b)) return null;
  const entries: TarEntry[] = [];
  let p = 0;
  let longName: string | undefined;
  while (p + 512 <= b.length) {
    if (b.subarray(p, p + 512).every((x) => x === 0)) break;
    if (!validTarHeader(b, p)) break;
    const size = octal(b, p + 124, 12);
    if (!Number.isFinite(size) || size < 0) break;
    const type = String.fromCharCode(b[p + 156] || 0x30);
    let name = cstr(b, p, 100);
    const prefix = cstr(b, p + 345, 155);
    if (prefix && b[p + 257] === 0x75) name = `${prefix}/${name}`;
    if (type === 'L') { longName = cstr(b, p + 512, Math.min(size, 4096)); }
    else if (type !== 'x' && type !== 'g') {
      if (entries.length >= limit) return { entries, more: true };
      const n = longName ?? name;
      entries.push({ name: n, size, dir: type === '5' || n.endsWith('/') });
      longName = undefined;
    }
    const next = p + 512 + Math.ceil(size / 512) * 512;
    if (!Number.isFinite(next) || next <= p) break;
    p = next;
  }
  return { entries, more: false };
}

/** Size of the data inside a .GZ, from its last four bytes (modulo 4 GiB). Null when it is not a gzip stream. */
export function gzipOriginalSize(b: Uint8Array): number | null {
  if (b.length < 18 || b[0] !== 0x1f || b[1] !== 0x8b) return null;
  return (b[b.length - 4] | (b[b.length - 3] << 8) | (b[b.length - 2] << 16) | (b[b.length - 1] << 24)) >>> 0;
}
