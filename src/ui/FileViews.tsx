// Views and readers that let the Projector show *any* file: a hex dump for bytes of every kind, a text check for files whose kind says
// nothing about their content (a .JSON in Miscellaneous, a .SH in Executable), spreadsheets read straight from the file, and the
// contents of ZIP, TAR and GZ archives. They read from the stored bytes on demand, so a node does not carry any of it around.
import { useEffect, useMemo, useState } from 'react';
import { gunzipSync } from 'fflate';
import { MAX_TEXT_CHARS, fmtBytes } from '../core/files';
import { listZip, readXlsx } from '../core/formats';
import { gzipOriginalSize, hexRows, isTar, listTar, textIfText } from '../core/inspect';
import { tr } from '../i18n';
import { Icon } from './icons';

/** Archives and workbooks are read whole; past this size they are left alone so the tab stays responsive. */
const READ_WHOLE_MAX = 128 * 1024 * 1024;

// ---- text hidden in a file of any kind ---------------------------------------------------------------------------------------------

export interface Sniffed { text: string; cut: boolean }

/** The text of a file when its bytes really are text. `undefined` while reading, `null` when it is not text. */
export function useSniffedText(blob: Blob | undefined, enabled: boolean): Sniffed | null | undefined {
  const [st, setSt] = useState<{ blob?: Blob; v: Sniffed | null }>({ v: null });
  useEffect(() => {
    if (!enabled || !blob) return;
    let alive = true;
    const head = blob.slice(0, MAX_TEXT_CHARS);
    void head.arrayBuffer().then((buf) => {
      if (!alive) return;
      const cut = blob.size > MAX_TEXT_CHARS;
      const t = textIfText(new Uint8Array(buf), cut);
      setSt({ blob, v: t === null ? null : { text: t, cut } });
    }).catch(() => alive && setSt({ blob, v: null }));
    return () => { alive = false; };
  }, [blob, enabled]);
  if (!enabled || !blob) return null;
  return st.blob === blob ? st.v : undefined;
}

// ---- .XLSX read from the bytes -----------------------------------------------------------------------------------------------------

/** The cells of the first sheet of a workbook. `undefined` while reading, `null` when it cannot be read. */
export function useSheetRows(blob: Blob | undefined, enabled: boolean): string[][] | null | undefined {
  const [st, setSt] = useState<{ blob?: Blob; v: string[][] | null }>({ v: null });
  useEffect(() => {
    if (!enabled || !blob) return;
    let alive = true;
    if (blob.size > READ_WHOLE_MAX) { setSt({ blob, v: null }); return; }
    void blob.arrayBuffer().then((buf) => {
      if (!alive) return;
      let rows: string[][] | null = null;
      try { rows = readXlsx(new Uint8Array(buf)); } catch { rows = null; }
      setSt({ blob, v: rows });
    }).catch(() => alive && setSt({ blob, v: null }));
    return () => { alive = false; };
  }, [blob, enabled]);
  if (!enabled || !blob) return null;
  return st.blob === blob ? st.v : undefined;
}

// ---- what is inside an archive -----------------------------------------------------------------------------------------------------

export interface Listing { lines: string[]; more?: boolean; note?: string }

const stripGz = (n: string) => n.replace(/\.(gz|tgz)$/i, (m) => (m.toLowerCase() === '.tgz' ? '.tar' : ''));

async function listArchive(blob: Blob, ext: string, name: string): Promise<Listing | null> {
  if (blob.size > READ_WHOLE_MAX) return null;
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const tarLines = (b: Uint8Array): Listing | null => {
    const t = listTar(b);
    return t ? { lines: t.entries.map((e) => (e.dir ? e.name : `${e.name}\t${e.size} bytes`)), more: t.more } : null;
  };
  if (ext === 'zip') { const l = listZip(bytes); return { lines: l ? l.split('\n') : [] }; }
  if (ext === 'tar') return tarLines(bytes);
  if (ext === 'gz' || ext === 'tgz') {
    const size = gzipOriginalSize(bytes);
    if (size === null || size > READ_WHOLE_MAX) return null;
    const inner = gunzipSync(bytes);
    if (isTar(inner)) return tarLines(inner);
    return { lines: [`${stripGz(name.split(/[\\/]/).pop() ?? name)}\t${inner.length} bytes`], note: 'A .GZ file holds one compressed file. This is its name and its size once unpacked.' };
  }
  return null;
}

/** `undefined` while reading, `null` when this archive type cannot be listed. */
export function useArchiveListing(blob: Blob | undefined, ext: string, name: string, enabled: boolean): Listing | null | undefined {
  const [st, setSt] = useState<{ blob?: Blob; v: Listing | null }>({ v: null });
  useEffect(() => {
    if (!enabled || !blob) return;
    let alive = true;
    listArchive(blob, ext, name).then((v) => alive && setSt({ blob, v })).catch(() => alive && setSt({ blob, v: { lines: [], note: 'This archive could not be read. It may be damaged.' } }));
    return () => { alive = false; };
  }, [blob, ext, name, enabled]);
  if (!enabled || !blob) return null;
  return st.blob === blob ? st.v : undefined;
}

export const LISTABLE_ARCHIVES = new Set(['zip', 'tar', 'gz', 'tgz']);

export function EntriesStage({ listing, expected }: { listing: Listing | null | undefined; expected?: number }) {
  const lines = listing?.lines ?? [];
  return (
    <div className="pw-col">
      <div className="pw-bar"><span className="pw-meta">{tr('{n} files inside', { n: String(expected ?? lines.filter((l) => !l.endsWith('/')).length) })}</span></div>
      {listing?.note && <p className="callout info"><Icon name="alert" size={14} />{tr(listing.note)}</p>}
      {listing?.more && <p className="callout info"><Icon name="alert" size={14} />{tr('Only the first entries are listed.')}</p>}
      <pre className="pw-pre" tabIndex={0}>{listing === undefined ? tr('Reading…') : lines.length ? lines.join('\n') : tr('(empty)')}</pre>
    </div>
  );
}

// ---- hex dump -----------------------------------------------------------------------------------------------------------------------

const PAGE = 4096;

/** A paged hex dump of the stored bytes: offsets on the left, bytes in the middle, printable characters on the right. */
export function HexStage({ blob }: { blob: Blob }) {
  const [offset, setOffset] = useState(0);
  const [bytes, setBytes] = useState<Uint8Array | null>(null);
  const [jump, setJump] = useState('');
  const pages = Math.max(1, Math.ceil(blob.size / PAGE));
  const page = Math.floor(offset / PAGE);

  useEffect(() => { setOffset(0); setJump(''); }, [blob]);
  useEffect(() => {
    let alive = true;
    setBytes(null);
    void blob.slice(offset, offset + PAGE).arrayBuffer().then((b) => alive && setBytes(new Uint8Array(b))).catch(() => alive && setBytes(new Uint8Array(0)));
    return () => { alive = false; };
  }, [blob, offset]);

  const rows = useMemo(() => (bytes ? hexRows(bytes, offset) : []), [bytes, offset]);
  const go = (p: number) => setOffset(Math.min(Math.max(0, p), pages - 1) * PAGE);
  const goto = () => {
    const n = parseInt(jump.trim().replace(/^0x/i, ''), 16);
    if (Number.isFinite(n) && n >= 0) setOffset(Math.min(Math.floor(n / PAGE), pages - 1) * PAGE);
  };
  return (
    <div className="pw-col">
      <div className="pw-bar">
        <span className="pw-meta">{tr('Bytes {a}–{b} of {t}', { a: blob.size ? offset.toLocaleString('en-US') : '0', b: Math.min(blob.size, offset + PAGE).toLocaleString('en-US'), t: `${blob.size.toLocaleString('en-US')} (${fmtBytes(blob.size)})` })}</span>
        <span className="pw-spacer" />
        <label className="fs-ctl">{tr('Go to offset (hex)')}
          <input className="hex-jump" value={jump} inputMode="text" spellCheck={false} placeholder="0000" onChange={(e) => setJump(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') goto(); }} />
        </label>
        <button type="button" className="btn sm" disabled={page <= 0} onClick={() => go(0)}>{tr('Start')}</button>
        <button type="button" className="btn sm" disabled={page <= 0} onClick={() => go(page - 1)}>{tr('Previous')}</button>
        <span className="pw-meta">{page + 1} / {pages}</span>
        <button type="button" className="btn sm" disabled={page >= pages - 1} onClick={() => go(page + 1)}>{tr('Next')}</button>
      </div>
      <div className="pw-scroll hex" tabIndex={0} aria-label={tr('Hex dump')}>
        {bytes === null ? <p className="muted pad12">{tr('Reading…')}</p>
          : rows.length === 0 ? <p className="muted pad12">{tr('(empty)')}</p>
          : <table className="hex-table"><tbody>{rows.map((r) => <tr key={r.offset}><th scope="row">{r.offset}</th><td className="hx">{r.hex}</td><td className="ha">{r.ascii}</td></tr>)}</tbody></table>}
      </div>
    </div>
  );
}
