// Gosling's conversation state: messages, the open/closed panel, pending confirmations and the optional model settings.
import { create } from 'zustand';
import { respond, type Pending, type Reply } from './brain';
import { askModel, DEFAULT_LLM, type ChatTurn, type LlmConfig } from './llm';
import { takeSnapshot } from './workspace';
import type { Route } from '../ui/docs/types';

export interface Msg {
  id: number;
  role: 'user' | 'gosling';
  text: string;
  actions?: string[];
  chips?: string[];
  docs?: { label: string; route: Route }[];
  via?: 'local' | 'model';
  error?: boolean;
}

const KEY = 'nicque-gosling-v1';
interface Saved { msgs: Msg[]; llm: LlmConfig; open: boolean }

function load(): Saved {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? '{}');
    return {
      msgs: Array.isArray(v.msgs) ? v.msgs.slice(-60) : [],
      llm: { ...DEFAULT_LLM, ...(v.llm ?? {}) },
      open: !!v.open,
    };
  } catch { return { msgs: [], llm: DEFAULT_LLM, open: false }; }
}
function save(s: Saved) {
  try { localStorage.setItem(KEY, JSON.stringify({ msgs: s.msgs.slice(-60), llm: s.llm, open: s.open })); } catch { /* storage unavailable */ }
}

let nextId = 1;
const saved = load();
nextId = saved.msgs.reduce((m, x) => Math.max(m, x.id), 0) + 1;

interface State extends Saved {
  busy: boolean;
  pending: Pending | null;
  settingsOpen: boolean;
  setOpen(o: boolean): void;
  toggle(): void;
  setSettingsOpen(o: boolean): void;
  setLlm(p: Partial<LlmConfig>): void;
  send(text: string): Promise<void>;
  cancel(): void;
  clear(): void;
}

let abort: AbortController | null = null;

export const useGosling = create<State>((set, get) => {
  const persist = () => { const s = get(); save({ msgs: s.msgs, llm: s.llm, open: s.open }); };
  const push = (m: Omit<Msg, 'id'>) => { set({ msgs: [...get().msgs, { ...m, id: nextId++ }].slice(-80) }); persist(); };
  const fromReply = (r: Reply, via: Msg['via'] = 'local'): Omit<Msg, 'id'> => ({ role: 'gosling', text: r.text, actions: r.actions, chips: r.chips, docs: r.docs, via });

  return {
    ...saved,
    busy: false,
    pending: null,
    settingsOpen: false,
    setOpen(o) {
      set({ open: o });
      if (o && !get().msgs.length) {
        const s = takeSnapshot();
        push({ role: 'gosling', via: 'local', text: `Hi, I'm **Gosling**, your copilot in Nicque. I can see your workspace live${s.nodeCount ? `: right now there ${s.nodeCount === 1 ? 'is 1 module' : `are ${s.nodeCount} modules`} on “${s.program.name}” and the program is ${s.run}` : ' and it is empty at the moment'}. Ask me anything, or tell me what to build.`, chips: s.nodeCount ? ['Overview', 'What timers are running?', 'Any problems?', 'What can you do?'] : ['Add a timer and a projector, connected', 'What can you do?', 'Build the loud light recipe'] });
      }
      persist();
    },
    toggle() { get().setOpen(!get().open); },
    setSettingsOpen(o) { set({ settingsOpen: o }); },
    setLlm(p) { set({ llm: { ...get().llm, ...p } }); persist(); },
    cancel() { abort?.abort(); abort = null; set({ busy: false }); },
    clear() { abort?.abort(); abort = null; set({ msgs: [], pending: null, busy: false }); persist(); get().setOpen(true); },

    async send(text) {
      const t = text.trim();
      if (!t || get().busy) return;
      push({ role: 'user', text: t });
      const { llm, pending } = get();
      const useModel = llm.enabled && llm.apiKey.trim().length > 0 && !pending;
      set({ busy: true, pending: null });
      if (useModel) {
        abort = new AbortController();
        try {
          const turns: ChatTurn[] = get().msgs.filter((m) => !m.error).slice(-14).map((m) => ({ role: m.role === 'user' ? 'user' : 'assistant', content: m.text }));
          const r = await askModel(llm, turns, abort.signal);
          push({ role: 'gosling', text: r.text, actions: r.actions.length ? r.actions : undefined, via: 'model', chips: ['Overview', 'What timers are running?'] });
          set({ busy: false });
          return;
        } catch (e) {
          if ((e as Error).name === 'AbortError') { set({ busy: false }); return; }
          const why = e instanceof Error ? e.message : String(e);
          // fall back to the built-in brain so Gosling is never dead in the water
          const r = respond(t, null);
          push({ ...fromReply({ ...r, text: `*(The language model didn't answer: ${why}. Using my built-in brain instead.)*\n${r.text}` }), error: true });
          set({ busy: false, pending: r.pending ?? null });
          return;
        }
      }
      await new Promise((res) => setTimeout(res, 220)); // a beat, so the reply feels considered
      let r: Reply;
      try { r = respond(t, pending); } catch (e) { r = { text: `Something went wrong while I was working on that (${e instanceof Error ? e.message : 'unknown error'}). Nothing was lost; you can undo with Ctrl/⌘+Z.` }; }
      push(fromReply(r));
      set({ busy: false, pending: r.pending ?? null });
    },
  };
});
