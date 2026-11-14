// The Projector's full-size window. It shows the content of anything: a long text in full (scrolling, selectable), a number at poster
// size, a picture at full size, an equation's graph, a list as JSON, and any file by its content — text read out, a picture drawn, a PDF
// paged, sound and video played, a web page as source or sandboxed preview, a CSV as a table, a ZIP as a list of names.
//
// It opens from the expand button on a Projector node (the argument is the node's runtime id) or from the “view” button next to any
// signal in the inspector (the argument is { value, title }).
import { useEffect, useMemo, useState } from 'react';
import { FILE_KIND_BY_ID, fmtBytes, fmtDuration, type FileDescriptor, type FileInfo } from '../core/files';
import { MIME_BY_EXT, listZip, parseDelimited } from '../core/formats';
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

function CsvTable({ text }: { text: string }) {
  const rows = useMemo(() => parseDelimited(text), [text]);
  const shown = rows.slice(0, 1000);
  const w = Math.min(60, Math.max(0, ...shown.map((r) => r.length)));
  return (
    <div className="pw-col">
      <div className="pw-bar"><span className="pw-meta">{tr('{r} rows · {c} columns', { r: rows.length.toLocaleString('en-US'), c: w })}</span></div>
      {rows.length > shown.length && <p className="callout info"><Icon name="alert" size={14} />{tr('Only the first 1 000 rows are shown. The Text tab has all of them.')}</p>}
      <div className="pw-scroll">
        <table className="pw-table"><tbody>{shown.map((r, y) => <tr key={y}>{Array.from({ length: w }, (_, x) => (y === 0 ? <th key={x}>{r[x] ?? ''}</th> : <td key={x}>{r[x] ?? ''}</td>))}</tr>)}</tbody></table>
      </div>
    </div>
  );
}

// ---- files ---------------------------------------------------------------------------------------------------------------------

function useZipNames(file: FileDescriptor, enabled: boolean) {
  const [names, setNames] = useState<string[] | null>(null);
  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    void getBlob(file.id).then(async (b) => {
      if (!b || !alive) return;
      try { const l = listZip(new Uint8Array(await b.arrayBuffer())); if (alive) setNames(l ? l.split('\n') : []); } catch { if (alive) setNames([]); }
    });
    return () => { alive = false; };
  }, [file.id, enabled]);
  return names;
}

function facts(file: FileDescriptor, info: FileInfo | undefined): [string, string][] {
  const rows: [string, string][] = [[tr('Name'), file.name], [tr('Category'), tr(FILE_KIND_BY_ID.get(file.type)?.name ?? file.type)], [tr('Extension'), file.ext ? '.' + file.ext.toUpperCase() : '—'], [tr('Size'), fmtBytes(file.size)]];
  if (file.mime) rows.push([tr('Type'), file.mime]);
  if (file.modified > 0) rows.push([tr('Modified'), new Date(file.modified).toLocaleString()]);
  if (info?.width && info.height) rows.push([tr('Dimensions'), `${info.width} × ${info.height} px`]);
  if (info?.duration !== undefined) rows.push([tr('Duration'), fmtDuration(info.duration)]);
  if (info?.lines !== undefined) rows.push([tr('Lines'), String(info.lines)]);
  if (info?.slides !== undefined) rows.push([tr('Slides'), String(info.slides)]);
  if (info?.entries !== undefined) rows.push([tr('Entries'), String(info.entries)]);
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

type Mode = 'view' | 'text' | 'source' | 'preview' | 'table' | 'entries' | 'details';
const MODE_LABEL: Record<Mode, string> = { view: 'View', text: 'Text', source: 'Source code', preview: 'Preview', table: 'Table', entries: 'Contents', details: 'Details' };

function FileStage({ v }: { v: View }) {
  const file = v.file as FileDescriptor;
  const info = v.info as FileInfo | undefined;
  const text = v.text as string | undefined;
  const blob = useBlob(file);
  const isZip = file.type === 'compressed' && file.ext === 'zip';
  const names = useZipNames(file, isZip);

  const modes: Mode[] = [];
  if (!v.present) modes.push('details');
  else {
    if (file.type === 'image' || file.type === 'pdf' || file.type === 'audio' || file.type === 'video') modes.push('view');
    if (text !== undefined) modes.push(file.type === 'web' ? 'source' : 'text');
    if (file.type === 'web' && file.ext === 'html' && text !== undefined) modes.push('preview');
    if (file.type === 'spreadsheet' && file.ext === 'csv' && text !== undefined) modes.push('table');
    if (isZip) modes.push('entries');
    modes.push('details');
  }
  const [picked, setMode] = useState<Mode | null>(null);
  const mode = picked && modes.includes(picked) ? picked : modes[0];
  const meta = [file.ext ? file.ext.toUpperCase() : '', fmtBytes(file.size), info?.width && info.height ? `${info.width} × ${info.height}` : '', info?.duration !== undefined ? fmtDuration(info.duration) : ''].filter(Boolean).join(' · ');

  let body;
  switch (mode) {
    case 'view':
      if (!blob.done) body = <p className="muted pad12">{tr('Reading…')}</p>;
      else if (!blob.url) body = file.type === 'image' && v.image ? <div className="pw-img"><ImageCanvas img={v.image as ImageSig} /></div> : <FileCard file={file} info={info} note="The file’s bytes are not available, so it cannot be played here." />;
      else if (file.type === 'image') body = <div className="pw-img"><img src={blob.url} alt={file.name} /></div>;
      else if (file.type === 'pdf') body = <iframe className="pw-frame" src={blob.url} title={file.name} />;
      else if (file.type === 'audio') body = <div className="pw-media"><span className="pw-badge">{'.' + file.ext.toUpperCase()}</span><audio controls src={blob.url} aria-label={file.name} /></div>;
      else body = <video className="pw-video" controls src={blob.url} aria-label={file.name} />;
      break;
    case 'text': case 'source': body = <TextStage text={text ?? ''} cut={!!v.cut || !!v.textCut} name={file.name} label={mode === 'source' ? tr('Source code') : undefined} />; break;
    case 'preview': body = <iframe className="pw-frame light" sandbox="" srcDoc={text} title={file.name} />; break;
    case 'table': body = <CsvTable text={text ?? ''} />; break;
    case 'entries': body = (
      <div className="pw-col">
        <div className="pw-bar"><span className="pw-meta">{tr('{n} files inside', { n: String(info?.entries ?? names?.length ?? 0) })}</span></div>
        <pre className="pw-pre" tabIndex={0}>{names === null ? tr('Reading…') : names.length ? names.join('\n') : tr('(empty)')}</pre>
      </div>
    ); break;
    default: body = <FileCard file={file} info={info} note={v.present ? undefined : 'This file is not in this browser any more. Programs that were shared or imported do not carry their files: drop it on its Files node again.'} />;
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

function Stage({ v, running }: { v: View | undefined; running: boolean }) {
  if (!v || !v.kind || v.kind === 'empty') {
    return <div className="pw-empty"><p>{running ? tr('Nothing has arrived at this Projector yet.') : tr('Press Run to see what this Projector receives.')}</p></div>;
  }
  switch (v.kind) {
    case 'number': return <div className="pw-number" aria-live="polite">{String(v.text)}</div>;
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
