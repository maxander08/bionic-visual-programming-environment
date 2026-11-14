// Optional: let Gosling think with a language model of your choice (any OpenAI-compatible chat endpoint).
// Off by default. Nothing is sent anywhere unless you turn it on and give it a key; when it is on, each question is sent
// together with a compact picture of your workspace so the model can answer about it and act on it through tools.
import { addModules, addRecipe, buildBlock, connectNodes, control, removeModules, setSettings, type BuildSpec } from './actions';
import { catalogueForModel, describeModule, moduleByType } from './knowledge';
import { takeSnapshot, type Snapshot } from './workspace';
import { RECIPES } from '../ui/docs/recipes';

export interface LlmConfig { enabled: boolean; baseUrl: string; apiKey: string; model: string }
export const DEFAULT_LLM: LlmConfig = { enabled: false, baseUrl: 'https://api.openai.com/v1', apiKey: '', model: 'gpt-4o-mini' };

export interface ChatTurn { role: 'user' | 'assistant'; content: string }

export function workspaceJson(s: Snapshot = takeSnapshot()): string {
  const data = {
    program: s.program,
    run: s.run, simulationTimeMs: Math.round(s.simTime), tick: s.tick, tickMs: s.tickMs, speed: s.speed,
    counts: { modules: s.nodeCount, connections: s.edgeCount, byType: Object.fromEntries(s.byType.map((b) => [b.name + ` (${b.type})`, b.ids.length])), byCategory: s.byCategory },
    selected: s.selection,
    timekeeping: s.timers.map((t) => ({ id: t.id, kind: t.type, state: t.state, active: t.active, detail: t.detail })),
    projectors: s.projectors,
    diagnostics: s.diagnostics.map((d) => ({ level: d.level, node: d.nodeId, message: d.message })),
    disabled: s.disabled, notWired: s.unconnected,
    engine: { pendingWakeups: s.pendingTimers, evaluationsLastTick: s.evalsLastTick },
    modules: s.nodes.map((n) => ({
      id: n.id, type: n.type, at: [Math.round(n.x), Math.round(n.y)], disabled: n.disabled || undefined,
      settings: Object.fromEntries(n.settings.map((x) => [x.key, x.value])),
      inputsFrom: n.inputs.filter((i) => i.from).map((i) => `${i.port} <- ${i.from!.node}.${i.from!.port}`),
      outputsNow: s.run === 'stopped' ? undefined : Object.fromEntries(n.outputs.filter((o) => o.value !== '—').slice(0, 8).map((o) => [o.port, o.value])),
      status: n.status ?? undefined, waitingOn: n.missing.length ? n.missing : undefined,
    })),
  };
  const text = JSON.stringify(data);
  return text.length > 24000 ? text.slice(0, 24000) + '…(truncated)' : text;
}

function systemPrompt(): string {
  return `You are Gosling, the AI copilot built into Nicque, a browser-based visual programming environment where you wire modules (sensors, nuclei, behaviors, math nodes, timekeeping, base data, quantities, files, actors) into a live simulation. You are named after James Gosling, the creator of Java. You are friendly, concise and precise.

You can answer ANY question (general knowledge, programming, maths, anything), but you are especially an expert on Nicque and on the user's current workspace. You can see the live workspace (below) and you can change it with tools.

Rules:
- For anything about the workspace (what is running, timers, how many modules of a kind, values, errors) answer from the WORKSPACE JSON; if you may be stale after a change, call get_workspace. Never invent modules or numbers.
- To create modules, wire them, change settings, delete things or run/pause/stop, you MUST call the tools. Never claim you did something unless a tool returned success. Use add_modules for plain additions and build_block for several modules that must be wired together.
- Use exact module "type" ids and pin ids from the catalogue. Setting keys are in the catalogue too. Ask a short clarifying question only when truly ambiguous; otherwise act.
- Wires go from an output pin to an input pin. "any" inputs accept anything. Pin ids are optional in tools: the app picks compatible pins.
- Deletions are undoable (Ctrl/Cmd+Z); mention that. Do not delete things the user did not ask to delete.
- Keep answers short. Use **bold** for names and "- " bullets for lists. Refer to modules by their id in backticks, e.g. \`timer-1\`.
- Nicque facts: Run = Space, step = ".", stop = Esc, undo = Ctrl/Cmd+Z, group = Ctrl/Cmd+G. Programs autosave in the browser; Share makes an NS1. code. Everything runs locally.

MODULE CATALOGUE (type | name | category | summary | inputs | outputs | settings):
${catalogueForModel()}

COOKBOOK RECIPES (use add_recipe): ${RECIPES.map((r) => `${r.id} = ${r.title}`).join('; ')}

WORKSPACE JSON (live, taken just now):
${workspaceJson()}`;
}

const obj = (properties: Record<string, unknown>, required: string[] = []) => ({ type: 'object', properties, required });
const TOOLS = [
  { name: 'get_workspace', description: 'Fresh live snapshot of the workspace (modules, settings, wiring, what is running, timers, projectors, diagnostics).', parameters: obj({}) },
  { name: 'get_module_info', description: 'Full documentation of a module type.', parameters: obj({ type: { type: 'string' } }, ['type']) },
  { name: 'add_modules', description: 'Add one or more modules of one type to the workspace, optionally with settings.', parameters: obj({ type: { type: 'string', description: 'module type id, e.g. timer' }, count: { type: 'integer' }, settings: { type: 'object', description: 'setting key -> value, e.g. {"duration": 90}' } }, ['type']) },
  { name: 'build_block', description: 'Add several modules at once and wire them together in one step.', parameters: obj({ nodes: { type: 'array', items: obj({ ref: { type: 'string' }, type: { type: 'string' }, settings: { type: 'object' } }, ['ref', 'type']) }, wires: { type: 'array', items: obj({ from: { type: 'string', description: 'ref' }, to: { type: 'string', description: 'ref' }, from_pin: { type: 'string' }, to_pin: { type: 'string' } }, ['from', 'to']) } }, ['nodes']) },
  { name: 'add_recipe', description: 'Place a Cookbook recipe on the workspace.', parameters: obj({ id: { type: 'string' } }, ['id']) },
  { name: 'connect', description: 'Wire an output of one existing module to an input of another. Pins are optional.', parameters: obj({ from_id: { type: 'string' }, to_id: { type: 'string' }, from_pin: { type: 'string' }, to_pin: { type: 'string' } }, ['from_id', 'to_id']) },
  { name: 'set_settings', description: 'Change settings of an existing module.', parameters: obj({ id: { type: 'string' }, settings: { type: 'object' } }, ['id', 'settings']) },
  { name: 'remove_modules', description: 'Delete modules by id (undoable).', parameters: obj({ ids: { type: 'array', items: { type: 'string' } } }, ['ids']) },
  { name: 'run_control', description: 'Run, pause, stop or step the program.', parameters: obj({ action: { type: 'string', enum: ['run', 'pause', 'stop', 'step'] } }, ['action']) },
].map((f) => ({ type: 'function', function: f }));

function runTool(name: string, a: any, log: string[]): string {
  const done = (r: { ok: boolean; message: string }) => { if (r.ok) log.push(r.message); return JSON.stringify(r); };
  try {
    if (!a || typeof a !== 'object') return JSON.stringify({ ok: false, message: 'Tool arguments must be a JSON object.' });
    switch (name) {
      case 'get_workspace': return workspaceJson();
      case 'get_module_info': { const d = moduleByType(String(a.type)); return d ? describeModule(d, { full: true }) : `Unknown module type ${a.type}`; }
      case 'add_modules': return done(addModules(String(a.type), Number(a.count) || 1, a.settings && typeof a.settings === 'object' ? a.settings : {}));
      case 'build_block': {
        if (!Array.isArray(a.nodes)) return JSON.stringify({ ok: false, message: 'build_block requires a nodes array.' });
        const spec: BuildSpec = {
          nodes: a.nodes.map((n: any) => ({ ref: String(n?.ref ?? ''), type: String(n?.type ?? ''), params: n?.settings && typeof n.settings === 'object' ? n.settings : {} })),
          wires: Array.isArray(a.wires) ? a.wires.map((w: any) => ({ from: String(w?.from ?? ''), to: String(w?.to ?? ''), fromPort: w?.from_pin, toPort: w?.to_pin })) : [],
        };
        return done(buildBlock(spec, 'that'));
      }
      case 'add_recipe': return done(addRecipe(String(a.id)));
      case 'connect': return done(connectNodes(String(a.from_id), String(a.to_id), a.from_pin, a.to_pin));
      case 'set_settings': return done(setSettings(String(a.id), a.settings && typeof a.settings === 'object' ? a.settings : {}));
      case 'remove_modules': return done(removeModules(Array.isArray(a.ids) ? a.ids.map(String) : []));
      case 'run_control': { const r = control(a.action); return done(r); }
      default: return `Unknown tool ${name}`;
    }
  } catch (e) {
    return JSON.stringify({ ok: false, message: e instanceof Error ? e.message : 'tool failed' });
  }
}

export async function askModel(cfg: LlmConfig, history: ChatTurn[], signal?: AbortSignal): Promise<{ text: string; actions: string[] }> {
  const base = cfg.baseUrl.trim().replace(/\/+$/, '');
  if (!/^https?:\/\/[^/\s]+/i.test(base)) throw new Error('Invalid endpoint URL (must start with http:// or https://).');
  const model = cfg.model.trim();
  if (!model) throw new Error('Model name is empty.');
  const url = base + '/chat/completions';
  const messages: any[] = [{ role: 'system', content: systemPrompt() }, ...history.slice(-14)];
  const actions: string[] = [];
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (cfg.apiKey.trim()) headers.Authorization = `Bearer ${cfg.apiKey.trim()}`;
  for (let round = 0; round < 6; round++) {
    const reqCtrl = new AbortController();
    const timer = setTimeout(() => reqCtrl.abort(new Error('Request timed out.')), 60_000);
    const onAbort = () => reqCtrl.abort(signal?.reason);
    if (signal) {
      if (signal.aborted) { clearTimeout(timer); throw Object.assign(new Error('Aborted'), { name: 'AbortError' }); }
      signal.addEventListener('abort', onAbort, { once: true });
    }
    let res: Response;
    try {
      res = await fetch(url, {
        method: 'POST', signal: reqCtrl.signal,
        headers,
        body: JSON.stringify({ model, messages, tools: TOOLS, tool_choice: 'auto', temperature: 0.3 }),
      });
    } catch (e) {
      if (signal?.aborted) throw Object.assign(new Error('Aborted'), { name: 'AbortError' });
      if (reqCtrl.signal.aborted) throw new Error('Request timed out after 60s.');
      throw e;
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
    }
    if (!res.ok) {
      let detail = '';
      try { detail = (await res.json())?.error?.message ?? ''; } catch { /* not json */ }
      throw new Error(`${res.status} ${res.statusText}${detail ? `: ${detail}` : ''}`);
    }
    const data = await res.json();
    const msg = data?.choices?.[0]?.message;
    if (!msg) throw new Error('The model sent an empty reply.');
    messages.push(msg);
    const calls = msg.tool_calls as { id: string; function: { name: string; arguments: string } }[] | undefined;
    if (!calls?.length) return { text: String(msg.content ?? '').trim() || 'Done.', actions };
    for (const c of calls) {
      let args: any;
      try { args = JSON.parse(c.function?.arguments || '{}'); }
      catch {
        messages.push({ role: 'tool', tool_call_id: c.id, content: JSON.stringify({ ok: false, message: 'Invalid JSON arguments.' }) });
        continue;
      }
      messages.push({ role: 'tool', tool_call_id: c.id, content: runTool(c.function?.name ?? '', args, actions) });
    }
  }
  return { text: 'I did what I could, but I ran out of steps. Check the workspace and tell me what is left.', actions };
}
