// Optional: let Gosling think with a language model of your choice (any OpenAI-compatible chat endpoint).
// Off by default. Nothing is sent anywhere unless you turn it on and give it a key; when it is on, each question is sent
// together with a compact picture of your workspace so the model can answer about it and act on it through tools.
import { addModules, addRecipe, connectNodes, control, removeModules, setSettings } from './actions';
import { createProgram, disconnectNodes, moveModules, verifyProgram, type ProgramSpec } from './programs';
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
  return `You are Gosling, the AI copilot built into Nicque, a browser-based visual programming environment where you wire modules (sensors, nuclei, behaviors, math nodes, timekeeping, base data, quantities, files, actors) into a live simulation. You are named after James Gosling, the creator of Java. You are friendly, concise and precise. Your replies may be read aloud, so write natural sentences and keep them short.

You can answer ANY question (general knowledge, programming, maths, anything), but you are especially an expert on Nicque and on the user's current workspace. You can see the live workspace (below) and you can change it with tools.

RULES
- For anything about the workspace (what is running, timers, how many modules of a kind, values, errors) answer from the WORKSPACE JSON; if it may be stale after a change, call get_workspace. Never invent modules or numbers.
- To create, wire, configure or delete things, or to run/pause/stop, you MUST call tools. Never claim you did something unless a tool returned success.
- BUILDING PROGRAMS: when the user asks for a program, app, circuit, demo or anything that should "work", design it as modules + wires and make ONE create_program call. Then read the returned report. Read "observed" and check it is the result the user wanted (for example 7 for 2+5); a note that a module "isn't wired to anything" usually means a missing wire. If it lists problems or the observed result is wrong, fix them (set_settings, connect, disconnect, remove_modules, or create_program again with replace=true) and call verify_program until problems is empty. Only then tell the user it works, and say in a sentence what it does and how to play with it. Prefer a complete program (sources, processing, AND a visible output such as a projector, meter, light or vital) over loose modules.
- Use exact module "type" ids, pin ids and setting keys from the catalogue. Setting values must respect the ranges/choices shown. Pins are optional in wires: if omitted the app picks compatible pins, but give them whenever a module has several outputs (for example timer: time / done / progress).
- Ask a short clarifying question only when the request is truly ambiguous; otherwise act and say which choices you made.
- Deletions are undoable (Ctrl/Cmd+Z); mention that. Do not delete things the user did not ask to delete. Use replace=true in create_program only when the user wants a new/different program instead of an addition.
- Keep answers short. Use **bold** for names and "- " bullets for lists. Refer to modules by their id in backticks, e.g. \`timer-1\`.

HOW NICQUE PROGRAMS WORK
- Signals flow along wires from an output pin to an input pin: numbers, text, booleans (true/false), images, equations. bool and number convert into each other (true=1). "any" inputs accept anything. Pins marked "?" are optional and never block; a module whose required (non-"?") input has no signal stays idle.
- On the canvas inputs are on top and the main output at the bottom; layout is automatic.
- Show values with a projector (anything: numbers, text, lists), a meter (numbers over time, or an Equation's "eq" output as a graph), a light (brightness 0–1), a vital (dot, true/false) or a text module. Use a notify for system notifications and audio for tones (audio.amp can be wired to a boolean to switch it on).
- Timer: autostart counts down at once; "time" is text like 01:30; "done" turns true at zero; "progress" is 0–1. Stopwatch counts up (autostart). Pulse emits true pulses every "period" ms (use its out → a Counter's inc). Constant: set kind (number|text|bool) and value (as text). Random emits a seeded value "rate" times per second. Wave is an oscillator (shape, freq Hz, amp). Equation holds a formula in x (and t = time): wire eq → meter.
- Any setting can also be driven by a wire: connect to the input pin "p:<key>" (for example to_pin "p:duration").
- Sensors (vision, hearing, motion) default to a simulated source, so programs run without hardware; source can be switched to camera/mic.
- The workspace can be run, paused, stopped or stepped with run_control. create_program runs the program by default.

EXAMPLES of create_program
1) "a 90 second countdown with a light": {"name":"90 second countdown","nodes":[{"ref":"t","type":"timer","settings":{"duration":90,"autostart":true}},{"ref":"p","type":"projector"},{"ref":"l","type":"light","settings":{"color":"green"}}],"wires":[{"from":"t","from_pin":"time","to":"p"},{"from":"t","from_pin":"done","to":"l"}]}
2) "add 3 and 4": {"name":"3 + 4","nodes":[{"ref":"a","type":"constant","settings":{"kind":"number","value":"3"}},{"ref":"b","type":"constant","settings":{"kind":"number","value":"4"}},{"ref":"s","type":"add"},{"ref":"p","type":"projector"}],"wires":[{"from":"a","to":"s","to_pin":"a"},{"from":"b","to":"s","to_pin":"b"},{"from":"s","to":"p"}]}
3) "graph y = sin(x)": {"name":"Sine","nodes":[{"ref":"e","type":"equation","settings":{"expr":"sin(x)","xMin":-6.3,"xMax":6.3}},{"ref":"m","type":"meter"}],"wires":[{"from":"e","from_pin":"eq","to":"m"}]}

Nicque facts: Run = Space, step = ".", stop = Esc, undo = Ctrl/Cmd+Z, group = Ctrl/Cmd+G. Programs autosave in the browser; Share makes an NS1. code. Everything runs locally.

MODULE CATALOGUE (type | name | category | summary | in: pin:type | out: pin:type | settings: key[range]=default):
${catalogueForModel()}

COOKBOOK RECIPES (use add_recipe): ${RECIPES.map((r) => `${r.id} = ${r.title}`).join('; ')}

WORKSPACE JSON (live, taken just now):
${workspaceJson()}`;
}

const obj = (properties: Record<string, unknown>, required: string[] = []) => ({ type: 'object', properties, required });
const settingsObj = { type: 'object', description: 'setting key -> value, e.g. {"duration": 90}. Keys and allowed values are in the catalogue.' };
const PROGRAM_NODE = obj({ ref: { type: 'string', description: 'your own short name for this module, used by wires' }, type: { type: 'string', description: 'exact module type id from the catalogue' }, settings: settingsObj, x: { type: 'number' }, y: { type: 'number' } }, ['ref', 'type']);
const PROGRAM_WIRE = obj({ from: { type: 'string', description: 'ref of the source module' }, to: { type: 'string', description: 'ref of the target module' }, from_pin: { type: 'string', description: 'output pin id (optional)' }, to_pin: { type: 'string', description: 'input pin id, or p:<setting key> to drive a setting (optional)' } }, ['from', 'to']);
const TOOLS = [
  { name: 'get_workspace', description: 'Fresh live snapshot of the workspace (modules, settings, wiring, what is running, timers, projectors, diagnostics).', parameters: obj({}) },
  { name: 'get_module_info', description: 'Full documentation of a module type.', parameters: obj({ type: { type: 'string' } }, ['type']) },
  { name: 'create_program', description: 'Build a complete program: add modules with settings and wire them, laid out automatically, as one undoable step. Validates everything, then dry-runs the program and returns a report {problems, notes, observed}. Runs it by default.', parameters: obj({ name: { type: 'string', description: 'program name' }, description: { type: 'string' }, nodes: { type: 'array', items: PROGRAM_NODE }, wires: { type: 'array', items: PROGRAM_WIRE }, replace: { type: 'boolean', description: 'true = replace the whole workspace with this program; default false adds it next to what is there' }, run: { type: 'boolean', description: 'start the program afterwards (default true)' } }, ['nodes']) },
  { name: 'verify_program', description: 'Check the whole workspace: required inputs that nothing feeds, modules not wired, failures found in a 3 second dry run, and what the displays would show.', parameters: obj({}) },
  { name: 'add_modules', description: 'Add one or more modules of one type to the workspace, optionally with settings.', parameters: obj({ type: { type: 'string', description: 'module type id, e.g. timer' }, count: { type: 'integer' }, settings: settingsObj }, ['type']) },
  { name: 'add_recipe', description: 'Place a Cookbook recipe on the workspace.', parameters: obj({ id: { type: 'string' } }, ['id']) },
  { name: 'connect', description: 'Wire an output of one existing module to an input of another. Pins are optional.', parameters: obj({ from_id: { type: 'string' }, to_id: { type: 'string' }, from_pin: { type: 'string' }, to_pin: { type: 'string' } }, ['from_id', 'to_id']) },
  { name: 'disconnect', description: 'Remove the wire(s) between two existing modules (optionally only into one input pin).', parameters: obj({ from_id: { type: 'string' }, to_id: { type: 'string' }, to_pin: { type: 'string' } }, ['from_id', 'to_id']) },
  { name: 'set_settings', description: 'Change settings of an existing module.', parameters: obj({ id: { type: 'string' }, settings: settingsObj }, ['id', 'settings']) },
  { name: 'move_modules', description: 'Move existing modules to canvas positions.', parameters: obj({ moves: { type: 'array', items: obj({ id: { type: 'string' }, x: { type: 'number' }, y: { type: 'number' } }, ['id', 'x', 'y']) } }, ['moves']) },
  { name: 'remove_modules', description: 'Delete modules by id (undoable).', parameters: obj({ ids: { type: 'array', items: { type: 'string' } } }, ['ids']) },
  { name: 'run_control', description: 'Run, pause, stop or step the program.', parameters: obj({ action: { type: 'string', enum: ['run', 'pause', 'stop', 'step'] } }, ['action']) },
].map((f) => ({ type: 'function', function: f }));

const asObj = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const asStr = (v: unknown): string | undefined => (typeof v === 'string' && v.trim() ? v.trim() : undefined);

/** Turn the model's create_program arguments into a ProgramSpec (also accepts the older build_block shape). */
export function specFromArgs(a: any): ProgramSpec {
  return {
    name: typeof a.name === 'string' ? a.name : undefined,
    description: typeof a.description === 'string' ? a.description : undefined,
    nodes: (Array.isArray(a.nodes) ? a.nodes : []).map((n: any) => ({ ref: String(n?.ref ?? ''), type: String(n?.type ?? ''), settings: asObj(n?.settings ?? n?.params), x: typeof n?.x === 'number' ? n.x : undefined, y: typeof n?.y === 'number' ? n.y : undefined })),
    wires: (Array.isArray(a.wires) ? a.wires : []).map((w: any) => ({ from: String(w?.from ?? ''), to: String(w?.to ?? ''), fromPin: asStr(w?.from_pin ?? w?.fromPin), toPin: asStr(w?.to_pin ?? w?.toPin) })),
  };
}

export function runTool(name: string, a: any, log: string[]): string {
  const done = (r: { ok: boolean; message: string }, extra?: Record<string, unknown>) => { if (r.ok) log.push(r.message); return JSON.stringify({ ...r, ...extra }); };
  try {
    if (!a || typeof a !== 'object') return JSON.stringify({ ok: false, message: 'Tool arguments must be a JSON object.' });
    switch (name) {
      case 'get_workspace': return workspaceJson();
      case 'get_module_info': { const d = moduleByType(String(a.type)); return d ? describeModule(d, { full: true }) : `Unknown module type ${a.type}`; }
      case 'add_modules': return done(addModules(String(a.type), Number(a.count) || 1, asObj(a.settings)));
      case 'create_program':
      case 'build_block': {
        if (!Array.isArray(a.nodes)) return JSON.stringify({ ok: false, message: `${name} requires a nodes array.` });
        const r = createProgram(specFromArgs(a), { replace: a.replace === true, run: a.run !== false });
        return done(r, r.report ? { refs: r.refs, report: { ok: r.report.ok, problems: r.report.problems, notes: r.report.notes, observed: r.report.observed } } : undefined);
      }
      case 'verify_program': { const rep = verifyProgram(); return JSON.stringify(rep); }
      case 'add_recipe': return done(addRecipe(String(a.id)));
      case 'connect': return done(connectNodes(String(a.from_id), String(a.to_id), asStr(a.from_pin), asStr(a.to_pin)));
      case 'disconnect': return done(disconnectNodes(String(a.from_id), String(a.to_id), asStr(a.to_pin)));
      case 'set_settings': return done(setSettings(String(a.id), asObj(a.settings)));
      case 'move_modules': return done(moveModules((Array.isArray(a.moves) ? a.moves : []).map((m: any) => ({ id: String(m?.id), x: Number(m?.x), y: Number(m?.y) }))));
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
  for (let round = 0; round < 10; round++) {
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
        body: JSON.stringify({ model, messages, tools: TOOLS, tool_choice: 'auto', temperature: 0.2 }),
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
