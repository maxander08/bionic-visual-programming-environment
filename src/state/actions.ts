// User-level file and program actions built on the store.
import type { Project } from '../core/types';
import { decodeShare, encodeShare, newProject, parseProjectJSON, serializeProject } from '../core/project';
import { projects } from './storage';
import { useStore } from './store';
import { uid } from '../core/util';
import type { Template } from '../core/library';

const st = () => useStore.getState();

export function backupCurrent() {
  const p = st().project;
  if (Object.keys(p.graph.nodes).length) projects.save(p);
}

export function openWithBackup(p: Project, note: string) {
  backupCurrent();
  st().openProject(p, note);
}

export function openTemplate(t: Template) {
  const hasWork = Object.keys(st().project.graph.nodes).length > 0;
  openWithBackup(t.build(), hasWork ? `Opened “${t.name}”. Your previous program was kept under Open → Saved programs.` : `Opened “${t.name}”.`);
  st().openDialog(null);
}

export function newProgram() {
  const p = st().project;
  const has = Object.keys(p.graph.nodes).length > 0;
  const go = () => { backupCurrent(); st().newBlank(); };
  if (has && st().saveState !== 'saved') st().confirm({ title: 'Start a new program?', body: 'The current program is saved to “Saved programs” first, so nothing is lost.', confirm: 'New program', onConfirm: go });
  else go();
}

export function resetWorkspace() {
  st().confirm({
    title: 'Clear the workspace?', body: 'This removes every module and connection from the current program. You can undo it with Ctrl/⌘+Z.', confirm: 'Clear workspace', danger: true,
    onConfirm: () => st().edit((s) => ({ ...s, graph: { nodes: {}, edges: {} } })),
  });
}

export function duplicateProgram() {
  const p = st().project;
  const copy: Project = { ...p, id: uid('p'), name: `${p.name} copy`.slice(0, 80), created: Date.now(), modified: Date.now() };
  backupCurrent();
  st().openProject(copy, 'Duplicated. You are now editing the copy; the original is under Saved programs.');
}

export function saveToBrowser() {
  const p = st().project;
  const ok = projects.save(p);
  useStore.setState({ saveState: ok ? 'saved' : 'unavailable' });
  st().toast(ok ? `Saved “${p.name}” in this browser.` : 'Browser storage is unavailable or full. Use Export to download the program instead.', ok ? 'ok' : 'error');
}

export function download(name: string, text: string, type = 'application/json') {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export const fileSlug = (n: string) => n.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'program';

export function exportJSON() {
  const p = st().project;
  download(`${fileSlug(p.name)}.neural.json`, serializeProject(p));
  st().toast('Exported program file.', 'ok');
}

function finishImport(res: ReturnType<typeof parseProjectJSON>, source: string) {
  if (res.error || !res.project) { st().toast(res.error ?? 'Import failed.', 'error'); return false; }
  const extra = res.problems.length ? ` ${res.problems.length} problem${res.problems.length > 1 ? 's were' : ' was'} repaired or skipped.` : '';
  openWithBackup({ ...res.project, id: uid('p') }, `Imported “${res.project.name}” from ${source}.${extra}`);
  if (res.problems.length) console.warn('Import problems:', res.problems);
  return true;
}

export async function importFile(file: File): Promise<boolean> {
  if (file.size > 8 * 1024 * 1024) { st().toast('That file is too large (limit 8 MB).', 'error'); return false; }
  const text = await file.text();
  const t = text.trim();
  return finishImport(t.startsWith('NS1.') ? decodeShare(t) : parseProjectJSON(text), `file “${file.name.slice(0, 40)}”`);
}

export function importCode(code: string): boolean {
  const t = code.trim();
  if (!t) { st().toast('Paste a share code first.', 'error'); return false; }
  return finishImport(t.startsWith('{') ? parseProjectJSON(t) : decodeShare(t), 'share code');
}

export function currentShareCode(): string {
  return encodeShare(st().project);
}

export { newProject };
