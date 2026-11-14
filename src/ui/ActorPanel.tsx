// Inspector sections of the Actors and of the Projector: what each actor is doing right now and the buttons that act on its result.
import type { NodeInst } from '../core/types';
import { FILE_KIND_BY_ID, fmtBytes, isFileDescriptor, type FileKindId } from '../core/files';
import { ROUTES, isKindId } from '../core/convert';
import { engine, useNodeVer } from '../runtime/session';
import { getBlob } from '../runtime/files';
import { useStore } from '../state/store';
import { tr } from '../i18n';
import { Icon } from './icons';
import { saveBlob } from './saveBlob';

const toast = (m: string, k: 'ok' | 'info' | 'error' = 'ok') => useStore.getState().toast(m, k);

export function FileConverterPanel({ node }: { node: NodeInst }) {
  useNodeVer(node.id);
  const rt = engine.nodes.get(node.id);
  const view = (rt?.viewData ?? {}) as Record<string, unknown>;
  const out = rt?.outputs.file?.v;
  const file = isFileDescriptor(out) ? out : undefined;
  const p = rt?.driven ? rt.live : node.params;
  const from: FileKindId = isKindId(p.from) ? p.from : 'image';
  const state = String(view.state ?? 'idle');
  const download = async () => {
    if (!file) return;
    const b = await getBlob(file.id);
    if (b) saveBlob(b, file.name); else toast(tr('The converted file is gone. Run the program again to make it.'), 'error');
  };
  const rows = Object.entries(ROUTES[from] ?? {}).map(([to, formats]) => [tr(FILE_KIND_BY_ID.get(to as FileKindId)?.name ?? to), (formats ?? []).map((f) => '.' + f.toUpperCase()).join(' ')] as [string, string]);
  return (
    <div className="field">
      <p className={`status-line ${state === 'done' ? 'ok' : state === 'working' ? 'info' : state === 'error' ? 'err' : 'warn'}`}>
        {state === 'done' ? tr('Made “{name}” · {size}.', { name: String(view.name ?? ''), size: fmtBytes(Number(view.size) || 0) })
          : state === 'working' ? tr('Converting “{name}”…', { name: String(view.name ?? '') })
          : state === 'error' ? tr('The conversion did not work. The reason is shown above.')
          : tr('Connect a file to the File pin and press Run.')}
      </p>
      <div className="btn-row">
        <button type="button" className="btn sm primary" disabled={!file} onClick={download}><Icon name="save" size={13} />{tr('Download result')}</button>
        <button type="button" className="btn sm" disabled={!file} onClick={() => file && useStore.getState().openDialog('projector', { value: file, title: file.name })}><Icon name="expand" size={13} />{tr('View in Projector')}</button>
      </div>
      <p className="doc">{tr('A {from} file can become:', { from: tr(FILE_KIND_BY_ID.get(from)?.name ?? from) })}</p>
      <dl className="file-facts">{rows.map(([k, v]) => <div key={k}><dt>{k}</dt><dd title={v}>{v}</dd></div>)}</dl>
      <p className="doc">{tr('Conversion happens in this browser. Nothing is uploaded, and the result is not saved with the program: it is made again when the program runs.')}</p>
    </div>
  );
}

export function UnitConverterPanel({ node }: { node: NodeInst }) {
  useNodeVer(node.id);
  const rt = engine.nodes.get(node.id);
  const view = (rt?.viewData ?? {}) as Record<string, unknown>;
  const p = node.params;
  const swap = () => useStore.getState().setNodeParams(node.id, { from: p.to, to: p.from, fromPrefix: p.toPrefix === 'auto' ? 'none' : p.toPrefix, toPrefix: p.fromPrefix });
  return (
    <div className="field">
      {view.text !== undefined
        ? <p className="status-line ok">{String(view.src)} = <b>{String(view.text)}</b></p>
        : <p className="status-line warn">{tr('Press Run to see the result.')}</p>}
      <div className="btn-row"><button type="button" className="btn sm" onClick={swap}><Icon name="redo" size={13} />{tr('Swap units')}</button></div>
    </div>
  );
}

export function ProjectorPanel({ id }: { id: string }) {
  return (
    <div className="field">
      <div className="btn-row"><button type="button" className="btn sm primary" onClick={() => useStore.getState().openDialog('projector', id)}><Icon name="expand" size={13} />{tr('Open full size')}</button></div>
      <p className="doc">{tr('Opens a large window that shows everything this Projector receives: a long text in full, a picture at full size, a PDF, sound or video, or any file by its content.')}</p>
    </div>
  );
}

/** A number written out in full, selectable, with a Copy button: nodes show only the start of a long number on their face. */
export function ExactValuePanel({ node, field, hint }: { node: NodeInst; field: 'text' | 'chip'; hint: string }) {
  useNodeVer(node.id);
  const rt = engine.nodes.get(node.id);
  const view = (rt?.viewData ?? {}) as Record<string, unknown>;
  const v = typeof view[field] === 'string' ? (view[field] as string) : undefined;
  const copy = () => {
    if (v === undefined) return;
    navigator.clipboard?.writeText(v).then(() => toast(tr('Copied.'), 'ok'), () => toast(tr('Copying is not allowed here.'), 'error'));
  };
  return (
    <div className="field">
      {v !== undefined
        ? <p className="exact-val" tabIndex={0} aria-label={hint}>{v}</p>
        : <p className="status-line warn">{tr('Press Run to see the result.')}</p>}
      {v !== undefined && <div className="btn-row"><button type="button" className="btn sm" onClick={copy}>{tr('Copy')}</button></div>}
      <p className="doc">{hint}</p>
    </div>
  );
}
