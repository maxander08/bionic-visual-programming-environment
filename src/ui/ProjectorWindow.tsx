// The Projector's full-size window. It shows the content of anything: a long text in full (scrolling, selectable), a number at poster
// size, a picture at full size, an equation's graph, a list as JSON, and any file by its content — text read out, a picture drawn, a PDF
// paged, sound and video played, a web page as source or sandboxed preview, a CSV as a table, a ZIP as a list of names.
//
// It opens from the expand button on a Projector node (the argument is the node's runtime id) or from the “view” button next to any
// signal in the inspector (the argument is { value, title }).
import { useEffect, useMemo, useState } from 'react';
import { FILE_KIND_BY_ID, fmtBytes, fmtDuration, type FileDescriptor, type FileInfo } from '../core/files';
import { MIME_BY_EXT, parseDelimited } from '../core/formats';
import { projectView } from '../core/modules/behavior';
import type { Plot } from '../core/equation';
import type { ImageSig } from '../core/types';
import { engine, useNodeVer } from '../runtime/session';
import { getBlob } from '../runtime/files';
import { useStore } from '../state/store';
import { tr } from '../i18n';
import { EquationPlot } from './EquationPlot';
import { ImageCanvas } from './NodeView';
import { Icon } from './icons';
import { Modal } from './Modal';
import { FontStage } from './FontStage';
import { EntriesStage, HexStage, LISTABLE_ARCHIVES, useArchiveListing, useSheetRows, useSniffedText } from './FileViews';
import { saveBlob } from './saveBlob';

type View = Record<string, any>;

export interface ProjectorArg { value: unknown; title?: string }

/** The bytes of a file by id, as an object URL that is released when the window closes or the file changes. */
function useBlob(file: FileDescriptor) {
  const [st, setSt] = useState<{ id: string; blob?: Blob; url?: string; done: boolean }>({ id: '', done: false });
  useEffect(() => {
    let alive = true;
    let url: string | undefined;
    void getBlob(file.id).then((b) => {
      if (!alive) return;
      if (!b) { setSt({ id: file.id, done: true }); return; }
      const type = b.type || file.mime || MIME_BY_EXT[file.ext] || '';
      const typed = b.type === type ? b : new Blob([b], { type });
      url = URL.createObjectURL(typed);
      setSt({ id: file.id, blob: typed, url, done: true });
    });
    return () => { alive = false; if (url) URL.revokeObjectURL(url); };
  }, [file.id, file.mime, file.ext]);
  return st.id === file.id ? st : { id: file.id, blob: undefined, url: undefined, done: false };
}

const toast = (m: string, k: 'ok' | 'info' | 'error' = 'ok') => useStore.getState().toast(m, k);
async function copy(text: string) {
  try { await navigator.clipboard.writeText(text); toast(tr('Copied.')); } catch { toast(tr('Clipboard is blocked here. Select the text and press Ctrl/⌘+C.'), 'info'); }
}

// ---- text ----------------------------------------------------------------------------------------------------------------------

function TextStage({ text, cut, name, label }: { text: string; cut?: boolean; name: string; label?: string }) {
  const [wrap, setWrap] = useState(true);
  const lines = useMemo(() => (text === '' ? 0 : text.split('\n').length), [text]);
  return (
    <div className="pw-col">
      <div className="pw-bar">
        <span className="pw-meta">{label ? label + ' · ' : ''}{tr('{n} characters · {l} lines', { n: text.length.toLocaleString('en-US'), l: lines.toLocaleString('en-US') })}</span>
        <span className="pw-spacer" />
        <button type="button" className="btn sm" aria-pressed={wrap} onClick={() => setWrap(!wrap)}>{tr('Wrap lines')}</button>
        <button type="button" className="btn sm" onClick={() => copy(text)}><Icon name="copy" size={13} />{tr('Copy')}</button>
        <button type="button" className="btn sm" onClick={() => saveBlob(new Blob([text], { type: 'text/plain;charset=utf-8' }), `${name || 'projector'}.txt`)}><Icon name="save" size={13} />{tr('Download')}</button>
      </div>
      {cut && <p className="callout warn"><Icon name="alert" size={14} />{tr('This text is longer than the Projector can hold, so only the first part is shown.')}</p>}
      <pre className={`pw-pre ${wrap ? 'wrap' : ''}`} tabIndex={0} aria-label={tr('Text')}>{text === '' ? tr('(empty)') : text}</pre>
    </div>
  );
}

function GridTable({ rows, note }: { rows: string[][]; note?: string }) {
  const shown = rows.slice(0, 1000);
  const w = Math.min(60, Math.max(0, ...shown.map((r) => r.length)));
  return (
    <div className="pw-col">
      <div className="pw-bar"><span className="pw-meta">{tr('{r} rows · {c} columns', { r: rows.length.toLocaleString('en-US'), c: w })}</span></div>
      {note && <p className="callout info"><Icon name="alert" size={14} />{tr(note)}</p>}
      {rows.length > shown.length && <p className="callout info"><Icon name="alert" size={14} />{tr('Only the first 1 000 rows are shown. The Text tab has all of them.')}</p>}
      <div className="pw-scroll">
        <table className="pw-table"><tbody>{shown.map((r, y) => <tr key={y}>{Array.from({ length: w }, (_, x) => (y === 0 ? <th key={x}>{r[x] ?? ''}</th> : <td key={x}>{r[x] ?? ''}</td>))}</tr>)}</tbody></table>
      </div>
    </div>
  );
}

function CsvTable({ text }: { text: string }) {
  const rows = useMemo(() => parseDelimited(text), [text]);
  return <GridTable rows={rows} />;
}

// ---- files ---------------------------------------------------------------------------------------------------------------------

function facts(file: FileDescriptor, info: FileInfo | undefined): [string, string][] {
  const rows: [string, string][] = [[tr('Name'), file.name], [tr('Category'), tr(FILE_KIND_BY_ID.get(file.type)?.name ?? file.type)], [tr('Extension'), file.ext ? '.' + file.ext.toUpperCase() : '—'], [tr('Size'), fmtBytes(file.size)]];
  if (file.mime) rows.push([tr('Type'), file.mime]);
  if (file.modified > 0) rows.push([tr('Modified'), new Date(file.modified).toLocaleString()]);
  if (info?.width && info.height) rows.push([tr('Dimensions'), `${info.width} × ${info.height} px`]);
  if (info?.duration !== undefined) rows.push([tr('Duration'), fmtDuration(info.duration)]);
  if (info?.lines !== undefined) rows.push([tr('Lines'), String(info.lines)]);
  if (info?.slides !== undefined) rows.push([tr('Slides'), String(info.slides)]);
  if (info?.entries !== undefined) rows.push([tr('Entries'), String(info.entries)]);
  if (info?.family) rows.push([tr('Family'), info.family]);
  if (info?.style) rows.push([tr('Style'), info.style]);
  if (info?.glyphs !== undefined) rows.push([tr('Glyphs'), info.glyphs.toLocaleString('en-US')]);
  if (info?.fontFormat) rows.push([tr('Format'), tr(info.fontFormat)]);
  if (info?.fontVersion) rows.push([tr('Version'), info.fontVersion]);
  return rows;
}

function FileCard({ file, info, note }: { file: FileDescriptor; info?: FileInfo; note?: string }) {
  return (
    <div className="pw-card">
      <span className="pw-badge">{file.ext ? '.' + file.ext.toUpperCase() : '—'}</span>
      <dl className="file-facts">{facts(file, info).map(([k, v]) => <div key={k}><dt>{k}</dt><dd title={v}>{v}</dd></div>)}</dl>
      {info?.warn && <p className="callout warn"><Icon name="alert" size={14} />{tr(info.warn)}</p>}
      {(note || info?.note) && <p className="doc">{tr(note ?? info!.note!)}</p>}
    </div>
  );
}

type Mode = 'view' | 'text' | 'source' | 'preview' | 'table' | 'entries' | 'hex' | 'details';
const MODE_LABEL: Record<Mode, string> = { view: 'View', text: 'Text', source: 'Source code', preview: 'Preview', table: 'Table', entries: 'Contents', hex: 'Hex', details: 'Details' };

/** Kinds the browser shows or plays by itself from the stored bytes. */
const NATIVE_VIEW = new Set(['image', 'pdf', 'audio', 'video']);

function FileStage({ v }: { v: View }) {
  const file = v.file as FileDescriptor;
  const info = v.info as FileInfo | undefined;
  const present = !!v.present;
  const blob = useBlob(file);
  const bytes = present ? blob.blob : undefined;

  // Anything the node did not read as text may still be text (a .JSON in Miscellaneous, a .SH in Executable, an .SVG).
  const readsAsText = v.text !== undefined;
  const sniffOn = present && blob.done && !readsAsText && file.type !== 'font' && file.type !== 'audio' && file.type !== 'video' && file.type !== 'pdf';
  const sniffed = useSniffedText(bytes, sniffOn);
  const text: string | undefined = readsAsText ? (v.text as string) : sniffed ? sniffed.text : undefined;
  const textCut = readsAsText ? (!!v.cut || !!v.textCut) : !!sniffed?.cut;

  const isXlsx = file.type === 'spreadsheet' && file.ext === 'xlsx';
  const sheet = useSheetRows(bytes, isXlsx);
  const listable = (file.type === 'compressed' || file.type === 'misc') && LISTABLE_ARCHIVES.has(file.ext);
  const listing = useArchiveListing(bytes, file.ext, file.name, listable);
  const [playFailed, setPlayFailed] = useState<string | null>(null);
  useEffect(() => setPlayFailed(null), [file.id]);

  const modes: Mode[] = [];
  if (present) {
    if (NATIVE_VIEW.has(file.type) || file.type === 'font') modes.push('view');
    if (text !== undefined) modes.push(file.type === 'web' || file.type === 'executable' ? 'source' : 'text');
    if (file.type === 'web' && file.ext === 'html' && text !== undefined) modes.push('preview');
    if ((file.type === 'spreadsheet' && file.ext === 'csv' && text !== undefined) || (isXlsx && sheet)) modes.push('table');
    if (listable && listing !== null && (listing === undefined || listing.lines.length || listing.note || file.ext === 'zip' || file.ext === 'tar')) modes.push('entries');
    if (bytes) modes.push('hex');
  }
  modes.push('details');
  const [picked, setMode] = useState<Mode | null>(null);
  useEffect(() => setMode(null), [file.id]);
  const mode = picked && modes.includes(picked) ? picked : modes[0];
  const meta = [file.ext ? file.ext.toUpperCase() : '', fmtBytes(file.size), info?.width && info.height ? `${info.width} × ${info.height}` : '', info?.duration !== undefined ? fmtDuration(info.duration) : ''].filter(Boolean).join(' · ');

  const cantPlay = <FileCard file={file} info={info} note={playFailed ?? 'The file’s bytes are not available, so it cannot be shown here.'} />;
  // While the bytes are still being looked at, the best tab is not known yet; wait rather than flash a different one.
  const pending = present && (!blob.done || (sniffOn && !!bytes && sniffed === undefined) || (isXlsx && !!bytes && sheet === undefined) || (listable && !!bytes && listing === undefined));
  let body;
  switch (pending && !picked ? 'pending' : mode) {
    case 'pending': body = <p className="muted pad12">{tr('Reading…')}</p>; break;
    case 'view':
      if (!blob.done) body = <p className="muted pad12">{tr('Reading…')}</p>;
      else if (!blob.url || !blob.blob) body = file.type === 'image' && v.image ? <div className="pw-img"><ImageCanvas img={v.image as ImageSig} /></div> : cantPlay;
      else if (playFailed) body = cantPlay;
      else if (file.type === 'font') body = <FontStage file={file} info={info} blob={blob.blob} />;
      else if (file.type === 'image') body = <div className="pw-img"><img src={blob.url} alt={file.name} onError={() => v.image ? undefined : setPlayFailed('This browser could not draw this picture. The Hex and Details tabs still show what is in it.')} /></div>;
      else if (file.type === 'pdf') body = <iframe className="pw-frame" src={blob.url} title={file.name} />;
      else if (file.type === 'audio') body = <div className="pw-media"><span className="pw-badge">{'.' + file.ext.toUpperCase()}</span><audio controls src={blob.url} aria-label={file.name} onError={() => setPlayFailed('This browser cannot play this audio format. Download the file to play it elsewhere, or use the Hex tab to look inside.')} /></div>;
      else body = <video className="pw-video" controls src={blob.url} aria-label={file.name} onError={() => setPlayFailed('This browser cannot play this video format. Download the file to play it elsewhere, or use the Hex tab to look inside.')} />;
      break;
    case 'text': case 'source': body = <TextStage text={text ?? ''} cut={textCut} name={file.name} label={mode === 'source' ? tr('Source code') : undefined} />; break;
    case 'preview': body = <iframe className="pw-frame light" sandbox="" srcDoc={text} title={file.name} />; break;
    case 'table': body = isXlsx && sheet ? <GridTable rows={sheet} note="Only the first sheet of the workbook is shown." /> : <CsvTable text={text ?? ''} />; break;
    case 'entries': body = <EntriesStage listing={listing} expected={file.ext === 'zip' ? info?.entries : undefined} />; break;
    case 'hex': body = bytes ? <HexStage blob={bytes} /> : null; break;
    default: body = <FileCard file={file} info={info} note={present ? undefined : 'This file is not in this browser any more. Programs that were shared or imported do not carry their files: drop it on its Files node again.'} />;
  }

  return (
    <div className="pw-file">
      <div className="pw-bar">
        <span className="pw-name" title={file.name}>{file.name}</span>
        <span className="pw-meta">{meta}</span>
        <span className="pw-spacer" />
        {modes.length > 1 && (
          <div className="tabs pw-tabs" role="tablist" aria-label={tr('How to show the file')}>
            {modes.map((m) => <button key={m} type="button" role="tab" aria-selected={m === mode} className={m === mode ? 'on' : ''} onClick={() => setMode(m)}>{tr(MODE_LABEL[m])}</button>)}
          </div>
        )}
        {blob.blob && <button type="button" className="btn sm" onClick={() => saveBlob(blob.blob!, file.name)}><Icon name="save" size={13} />{tr('Download')}</button>}
      </div>
      <div className="pw-stage">{body}</div>
    </div>
  );
}

// ---- the window ----------------------------------------------------------------------------------------------------------------

function NumberStage({ text }: { text: string }) {
  if (text.length <= 20) return <div className="pw-number" aria-live="polite">{text}</div>;
  const digits = text.replace(/[^0-9]/g, '').length;
  const cls = text.length > 120 ? 'pw-number huge' : 'pw-number long';
  return (
    <div className="pw-col">
      <div className="pw-bar">
        <span className="pw-meta">{tr('{n} digits', { n: digits.toLocaleString('en-US') })}</span>
        <span className="pw-spacer" />
        <button type="button" className="btn sm" onClick={() => copy(text)}><Icon name="copy" size={13} />{tr('Copy')}</button>
        <button type="button" className="btn sm" onClick={() => saveBlob(new Blob([text], { type: 'text/plain;charset=utf-8' }), 'number.txt')}><Icon name="save" size={13} />{tr('Download')}</button>
      </div>
      <div className={cls} tabIndex={0} aria-live="polite">{text}</div>
    </div>
  );
}

function Stage({ v, running }: { v: View | undefined; running: boolean }) {
  if (!v || !v.kind || v.kind === 'empty') {
    return <div className="pw-empty"><p>{running ? tr('Nothing has arrived at this Projector yet.') : tr('Press Run to see what this Projector receives.')}</p></div>;
  }
  switch (v.kind) {
    case 'number': return <NumberStage text={String(v.text)} />;
    case 'text': return <TextStage text={String(v.text ?? '')} cut={!!v.cut} name="projector" />;
    case 'data': return <TextStage text={String(v.text ?? '')} cut={!!v.cut} name="projector" label="JSON" />;
    case 'image': return <div className="pw-img"><ImageCanvas img={v.image} /></div>;
    case 'plot': return <div className="pw-plot"><EquationPlot plot={v.plot as Plot} detail /></div>;
    case 'file': return <FileStage v={v} />;
  }
  return null;
}

export function ProjectorWindow({ onClose }: { onClose: () => void }) {
  const arg = useStore((s) => s.ui.arg) as string | ProjectorArg | undefined;
  const rid = typeof arg === 'string' ? arg : '';
  useNodeVer(rid);
  const running = useStore((s) => s.run) !== 'stopped';
  const given = useMemo(() => (arg && typeof arg === 'object' ? projectView(arg.value) : undefined), [arg]);
  const v = typeof arg === 'string' ? (engine.nodes.get(arg)?.viewData as View | undefined) : given;
  const title = typeof arg === 'object' && arg?.title ? arg.title : tr('Projector');
  const fullscreen = () => {
    const el = document.querySelector<HTMLElement>('.modal.full');
    if (document.fullscreenElement) void document.exitFullscreen();
    else void el?.requestFullscreen?.().catch(() => toast(tr('This browser would not go full screen.'), 'info'));
  };
  return (
    <Modal title={title} onClose={onClose} full label={tr('Projector, full size')}
      actions={<button type="button" className="icon-btn" aria-label={tr('Toggle full screen')} title={tr('Toggle full screen')} onClick={fullscreen}><Icon name="fit" size={16} /></button>}>
      <Stage v={v} running={running} />
    </Modal>
  );
}
