// Interface of the Files section: the face drawn inside a Files node, the drag-and-drop behaviour shared by the node and the
// inspector, and the inspector's file panel. The reading and storing itself is in runtime/files.ts.
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import type { ImageSig, NodeInst } from '../core/types';
import { acceptAttr, extList, fileState, filesVersion, fmtBytes, fmtDuration, getFileInfo, subscribeFiles, type FileKind } from '../core/files';
import { clearFile, connectToProjector, loadFile, openFilePreview } from '../runtime/files';
import { useStore } from '../state/store';
import { Icon } from './icons';
import { tr } from '../i18n';

/** Re-render when any file finishes loading, is found, or turns out to be missing. */
const useFiles = () => useSyncExternalStore(subscribeFiles, filesVersion);

const hasFiles = (e: React.DragEvent) => Array.from(e.dataTransfer?.types ?? []).includes('Files');

/** Handlers that make an element accept a dropped file for a Files node. `over` is true while a file hovers above it. */
export function useFileDrop(nodeId: string, disabled = false) {
  const [over, setOver] = useState(false);
  const depth = useRef(0);
  const reset = () => { depth.current = 0; setOver(false); };
  const handlers = disabled ? {} : {
    onDragEnter: (e: React.DragEvent) => { if (!hasFiles(e)) return; e.preventDefault(); depth.current++; setOver(true); },
    onDragOver: (e: React.DragEvent) => { if (!hasFiles(e)) return; e.preventDefault(); e.stopPropagation(); e.dataTransfer.dropEffect = 'copy'; },
    onDragLeave: (e: React.DragEvent) => { if (!hasFiles(e)) return; depth.current = Math.max(0, depth.current - 1); if (!depth.current) setOver(false); },
    onDrop: (e: React.DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      e.stopPropagation();
      reset();
      const list = Array.from(e.dataTransfer.files);
      if (!list.length) return;
      useStore.getState().select([nodeId]);
      if (list.length > 1) useStore.getState().toast(tr('A Files node holds one file. Only “{name}” was used.', { name: list[0].name }), 'info');
      void loadFile(nodeId, list[0]);
    },
  };
  return { over, handlers };
}

export function Thumb({ img }: { img: ImageSig }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current;
    const ctx = c?.getContext('2d');
    if (!c || !ctx) return;
    c.width = img.w; c.height = img.h;
    ctx.putImageData(new ImageData(new Uint8ClampedArray(img.data), img.w, img.h), 0, 0);
  }, [img]);
  return <canvas ref={ref} className="imgcv" />;
}

/** One file picker per click. Resets the input so choosing the same file again still fires. */
function usePicker(nodeId: string, kind: FileKind) {
  const input = useRef<HTMLInputElement>(null);
  const el = (
    <input ref={input} type="file" className="file-input" tabIndex={-1} aria-hidden="true" accept={acceptAttr(kind)}
      onChange={(e) => {
        const f = e.target.files?.[0];
        e.target.value = '';
        if (f) void loadFile(nodeId, f);
      }} />
  );
  return { el, open: () => input.current?.click() };
}

const extText = (kind: FileKind) => (kind.exts.length ? extList(kind).join(' ') : tr('any other file'));

/** What the node shows: a drop target when empty, the file's name, type and size (or a picture of it) when full. */
export function FileFace({ node, kind, ro }: { node: NodeInst; kind: FileKind; ro: boolean }) {
  useFiles();
  const picker = usePicker(node.id, kind);
  const id = String(node.params.fileId ?? '');
  const name = String(node.params.fileName ?? '');
  const ext = String(node.params.fileExt ?? '').toUpperCase();
  const size = Number(node.params.fileSize) || 0;
  const info = id ? getFileInfo(id) : undefined;
  const st = id ? fileState(id) : undefined;
  const missing = !!id && !info && st === 'missing';
  const loading = !!id && !info && !missing;
  const label = !id ? tr('Drop a file here, or click to choose one') : missing ? tr('Not in this browser. Drop it again.') : tr('Replace: drop or click');

  let inner;
  if (!id) {
    inner = (
      <>
        <svg className="ff-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 3h8l4 4v14H6z M14 3v4h4 M12 17v-6 M9.5 13.5 12 11l2.5 2.5" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" /></svg>
        <span className="ff-hint clamp2">{tr('Drop a file or click')}</span>
        <span className="ff-exts clamp2">{extText(kind)}</span>
      </>
    );
  } else if (loading) {
    inner = <><span className="ff-badge">{ext ? '.' + ext : '…'}</span><span className="ff-name clamp1">{name}</span><span className="ff-meta">{tr('Reading…')}</span></>;
  } else if (missing) {
    inner = <><span className="ff-badge bad">{ext ? '.' + ext : '?'}</span><span className="ff-name clamp1">{name}</span><span className="ff-meta">{tr('Not in this browser')}</span></>;
  } else {
    inner = (
      <>
        {info?.image ? <span className="ff-thumb"><Thumb img={info.image} /></span> : <span className="ff-badge">{ext ? '.' + ext : '—'}</span>}
        <span className="ff-name clamp1" title={name}>{name}</span>
        <span className="ff-meta">{[ext, fmtBytes(size)].filter(Boolean).join(' · ')}</span>
      </>
    );
  }
  return (
    <>
      <button type="button" className={`file-face ${id ? 'full' : ''} ${missing ? 'missing' : ''}`} data-interactive disabled={ro} aria-label={label} title={label}
        onClick={() => { useStore.getState().select([node.id]); picker.open(); }}
        onKeyDown={(e) => { if (e.key === 'Escape') e.currentTarget.blur(); e.stopPropagation(); }}>
        {inner}
      </button>
      {picker.el}
    </>
  );
}

/** The miniature used in the library and the drag ghost. */
export function FilePreview({ kind }: { kind: FileKind }) {
  return (
    <div className="file-face preview">
      <span className="ff-badge">{kind.exts.length ? '.' + kind.exts[0].toUpperCase() : '···'}</span>
      <span className="ff-exts clamp2">{extText(kind)}</span>
    </div>
  );
}

const when = (ms: number) => { const d = new Date(ms); return ms > 0 && !Number.isNaN(d.getTime()) ? d.toLocaleString() : '—'; };

/** The inspector's File section: current file and its details, a drop zone, and the buttons. */
export function FileInspector({ node, kind }: { node: NodeInst; kind: FileKind }) {
  useFiles();
  const picker = usePicker(node.id, kind);
  const { over, handlers } = useFileDrop(node.id);
  const id = String(node.params.fileId ?? '');
  const info = id ? getFileInfo(id) : undefined;
  const st = id ? fileState(id) : undefined;
  const missing = !!id && !info && st === 'missing';
  const rows: [string, string][] = [];
  if (id) {
    rows.push([tr('Name'), String(node.params.fileName ?? '')]);
    rows.push([tr('Extension'), '.' + String(node.params.fileExt ?? '').toUpperCase()]);
    rows.push([tr('Size'), `${fmtBytes(Number(node.params.fileSize) || 0)}`]);
    if (info) {
      if (info.mime) rows.push([tr('Type'), info.mime]);
      if (info.modified) rows.push([tr('Modified'), when(info.modified)]);
      if (info.width && info.height) rows.push([tr('Dimensions'), `${info.width} × ${info.height} px`]);
      if (info.duration !== undefined) rows.push([tr('Duration'), fmtDuration(info.duration)]);
      if (info.lines !== undefined) rows.push([tr('Lines'), String(info.lines)]);
      if (info.slides !== undefined) rows.push([tr('Slides'), String(info.slides)]);
      if (info.entries !== undefined) rows.push([tr('Entries'), String(info.entries)]);
      if (info.family) rows.push([tr('Family'), info.family]);
      if (info.style) rows.push([tr('Style'), info.style]);
      if (info.glyphs !== undefined) rows.push([tr('Glyphs'), info.glyphs.toLocaleString('en-US')]);
      if (info.fontFormat) rows.push([tr('Format'), tr(info.fontFormat)]);
      if (info.fontVersion) rows.push([tr('Version'), info.fontVersion]);
    }
  }
  return (
    <div className="field file-insp">
      <div className={`file-drop ${over ? 'over' : ''}`} {...handlers}>
        <Icon name="plus" size={14} />
        <span>{id ? tr('Drop another file here to replace it') : tr('Drop a file here')}</span>
      </div>
      <p className="doc">
        {kind.exts.length
          ? <>{tr('Takes')} {extList(kind).map((x) => <code key={x} className="ext">{x}</code>)}</>
          : tr('Takes any file that no other Files node accepts.')}
      </p>
      <div className="btn-row">
        <button type="button" className="btn sm" onClick={picker.open}>{id ? tr('Replace file…') : tr('Choose file…')}</button>
        {id && <button type="button" className="btn sm danger" onClick={() => clearFile(node.id)}>{tr('Remove file')}</button>}
      </div>
      {picker.el}
      {id && (
        <div className="btn-row">
          <button type="button" className="btn sm primary" disabled={!info} onClick={() => openFilePreview(node.id)}><Icon name="expand" size={13} />{tr('Preview')}</button>
          <button type="button" className="btn sm" onClick={() => connectToProjector(node.id)}>{tr('Connect to a Projector')}</button>
        </div>
      )}
      {id && <p className="doc">{tr('Preview opens the file in the Projector window: whatever its kind, it is shown by its content. Connect to a Projector adds one to the workspace and wires this node’s File output to it.')}</p>}
      {missing && <p className="status-line warn">{tr('This file is not in this browser. Programs that were shared or imported do not carry their files: drop it on the node again.')}</p>}
      {id && !info && !missing && <p className="status-line info">{tr('Reading…')}</p>}
      {info?.warn && <p className="status-line warn">{tr(info.warn)}</p>}
      {info?.note && <p className="doc">{tr(info.note)}</p>}
      {rows.length > 0 && (
        <dl className="file-facts">
          {rows.map(([k, v]) => <div key={k}><dt>{k}</dt><dd title={v}>{v}</dd></div>)}
        </dl>
      )}
      <p className="doc">{tr('Only the name and size are saved in the program. The file itself stays in this browser.')}</p>
    </div>
  );
}
