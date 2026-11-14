import { Fragment, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { tr } from '../i18n';
import { bridge, useStore } from '../state/store';
import { Icon } from '../ui/icons';
import { useGosling, type Msg } from './store';
import { loadVoices, speechLang, synthesisSupported, voicesFor } from './voice';
import { speakMessage, useGoslingVoice, voiceErrorText, type VoicePhase } from './useVoice';
import './gosling.css';

/** Gosling's face: a round gosling chick in the site's teal frame. */
export function GoslingMark({ size = 28 }: { size?: number }) {
  return (
    <svg className="g-mark" width={size} height={size} viewBox="0 0 32 32" aria-hidden="true">
      <rect x="1" y="1" width="30" height="30" rx="9" fill="#071413" stroke="#2fd9cf" strokeWidth="1.4" />
      <path d="M16 6c1.2-1.9 3-2 3.6-.8-.9.1-1.6.7-1.8 1.7z" fill="#f4d35e" />
      <circle cx="16" cy="15.5" r="8.4" fill="#f6dd7a" />
      <ellipse cx="16" cy="23.4" rx="6.2" ry="3.6" fill="#f0c94f" />
      <circle cx="12.4" cy="14" r="1.5" fill="#101010" />
      <circle cx="19.6" cy="14" r="1.5" fill="#101010" />
      <circle cx="12.9" cy="13.5" r=".5" fill="#fff" />
      <circle cx="20.1" cy="13.5" r=".5" fill="#fff" />
      <path d="M13.2 17.2c.9-1 4.7-1 5.6 0 .3.4 0 1.3-1 1.9-1 .6-3.6.6-4.6 0-1-.6-1.3-1.5-.99-1.9z" fill="#ff8a3d" />
      <path d="M14.2 17.9h3.6" stroke="#c9601c" strokeWidth=".7" strokeLinecap="round" />
    </svg>
  );
}

/** Toolbar button. */
export function GoslingButton() {
  useStore((s) => s.settings.language);
  const open = useGosling((s) => s.open);
  const toggle = useGosling((s) => s.toggle);
  const tip = tr('Gosling, your copilot (Ctrl/⌘+J)');
  return (
    <button type="button" className={`tb-btn g-tb${open ? ' on' : ''}`} onClick={toggle} aria-pressed={open} aria-label={tip} title={tip}>
      <GoslingMark size={18} />
      <span className="tb-text g-tb-text">Gosling</span>
    </button>
  );
}

// ---- voice icons -----------------------------------------------------------------------------------------------

function VIcon({ name, size = 16 }: { name: 'mic' | 'speaker' | 'speaker-off' | 'voice' | 'keyboard' | 'replay'; size?: number }) {
  const common = { width: size, height: size, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const, 'aria-hidden': true };
  switch (name) {
    case 'mic': return <svg {...common}><rect x="9" y="3" width="6" height="11" rx="3" /><path d="M5 11a7 7 0 0 0 14 0M12 18v3M9 21h6" /></svg>;
    case 'speaker': return <svg {...common}><path d="M4 9.5v5h3.5L12 18.5v-13L7.5 9.5zM15.5 9a4 4 0 0 1 0 6M18 6.5a7.5 7.5 0 0 1 0 11" /></svg>;
    case 'speaker-off': return <svg {...common}><path d="M4 9.5v5h3.5L12 18.5v-13L7.5 9.5zM16 9.5l5 5M21 9.5l-5 5" /></svg>;
    case 'voice': return <svg {...common}><path d="M4 10v4M8 7v10M12 4v16M16 8v8M20 11v2" /></svg>;
    case 'keyboard': return <svg {...common}><rect x="3" y="6" width="18" height="12" rx="2" /><path d="M7 10h.01M11 10h.01M15 10h.01M7 14h10" /></svg>;
    default: return <svg {...common}><path d="M5 10v4h3l4 4V6L8 10zM15.5 9.5a3.5 3.5 0 0 1 0 5" /></svg>;
  }
}

const PHASE_LABEL: Record<VoicePhase, string> = {
  off: '', listening: 'Listening…', thinking: 'Thinking…', speaking: 'Speaking… tap to interrupt', paused: 'Paused. Tap to talk',
};

/** Voice mode: a big orb you can tap, with live words under it. */
function VoiceDock({ phase, interim, muted, onTap, onMute, onEnd }: { phase: VoicePhase; interim: string; muted: boolean; onTap(): void; onMute(): void; onEnd(): void }) {
  const label = tr(PHASE_LABEL[phase] || 'Listening…');
  return (
    <div className="g-voice" data-phase={phase}>
      <div className="g-voice-text" aria-live="polite">{phase === 'listening' && interim ? interim : <span className="dim">{label}</span>}</div>
      <div className="g-voice-row">
        <button type="button" className={`g-ic g-vbtn${muted ? ' on' : ''}`} onClick={onMute} aria-pressed={muted} aria-label={muted ? tr('Turn Gosling’s voice on') : tr('Mute Gosling’s voice')} title={muted ? tr('Gosling’s voice is off') : tr('Mute Gosling’s voice')}>
          <VIcon name={muted ? 'speaker-off' : 'speaker'} size={17} />
        </button>
        <button type="button" className="g-orb" onClick={onTap} aria-label={label}>
          <span className="g-ring" /><span className="g-ring r2" /><span className="g-ring r3" />
          <span className="g-orb-core"><GoslingMark size={46} /></span>
          <span className="g-bars" aria-hidden="true"><i /><i /><i /><i /><i /></span>
        </button>
        <button type="button" className="g-ic g-vbtn" onClick={onEnd} aria-label={tr('Back to typing')} title={tr('Back to typing')}><VIcon name="keyboard" size={17} /></button>
      </div>
      <div className="g-voice-hint">{tr('Just talk. I answer out loud. Tap the orb to stop me or to finish speaking.')}</div>
    </div>
  );
}

// ---- tiny markdown: **bold**, *italic*, `code`, and "- " lists ----------------------------------------------------

function Inline({ text }: { text: string }) {
  const nodes = useStore((s) => s.project.graph.nodes);
  const parts = text.split(/(\*\*[^*]+\*\*|`[^`]+`|\*[^*\s][^*]*\*)/g).filter(Boolean);
  return (
    <>
      {parts.map((p, i) => {
        if (p.startsWith('**') && p.endsWith('**') && p.length > 4) return <strong key={i}>{p.slice(2, -2)}</strong>;
        if (p.startsWith('`') && p.endsWith('`') && p.length > 2) {
          const id = p.slice(1, -1);
          if (nodes[id]) {
            return <button key={i} type="button" className="g-ref" title={tr('Show {id} on the workspace', { id })} onClick={() => { useStore.getState().select([id]); bridge.focus?.([id]); }}>{id}</button>;
          }
          return <code key={i}>{id}</code>;
        }
        if (p.startsWith('*') && p.endsWith('*') && p.length > 2) return <em key={i}>{p.slice(1, -1)}</em>;
        return <Fragment key={i}>{p}</Fragment>;
      })}
    </>
  );
}

function Rich({ text }: { text: string }) {
  const blocks = useMemo(() => {
    const out: ({ t: 'p'; x: string } | { t: 'ul'; items: string[] })[] = [];
    for (const line of text.split('\n')) {
      if (!line.trim()) continue;
      const li = line.match(/^\s*[-•]\s+(.*)$/);
      const last = out[out.length - 1];
      if (li) { if (last?.t === 'ul') last.items.push(li[1]); else out.push({ t: 'ul', items: [li[1]] }); }
      else out.push({ t: 'p', x: line });
    }
    return out;
  }, [text]);
  return (
    <>
      {blocks.map((b, i) => b.t === 'p'
        ? <p key={i}><Inline text={b.x} /></p>
        : <ul key={i}>{b.items.map((x, j) => <li key={j}><Inline text={x} /></li>)}</ul>)}
    </>
  );
}

function Bubble({ m, onSay }: { m: Msg; onSay(text: string): void }) {
  const openDocs = (route: unknown) => useStore.getState().openDialog('docs', route);
  if (m.role === 'user') return <div className="g-row user"><div className="g-bubble user"><p>{m.text}</p></div></div>;
  return (
    <div className="g-row">
      <GoslingMark size={22} />
      <div className={`g-bubble${m.error ? ' warn' : ''}`}>
        <Rich text={m.text} />
        {m.actions?.length ? (
          <ul className="g-acts" aria-label={tr('What I did')}>
            {m.actions.map((a, i) => <li key={i}><Icon name="check" size={12} /><span><Inline text={a} /></span></li>)}
          </ul>
        ) : null}
        {m.docs?.length ? (
          <div className="g-docs">
            {m.docs.map((d, i) => <button key={i} type="button" className="g-link" onClick={() => openDocs(d.route)}><Icon name="docs" size={12} />{d.label}</button>)}
          </div>
        ) : null}
        <div className="g-foot-row">
          {m.via === 'model' && <span className="g-via">{tr('via language model')}</span>}
          {synthesisSupported() && m.text.trim() && <button type="button" className="g-say" onClick={() => onSay(m.text)} aria-label={tr('Read this aloud')} title={tr('Read this aloud')}><VIcon name="replay" size={13} /></button>}
        </div>
      </div>
    </div>
  );
}

function VoiceSettings() {
  const language = useStore((s) => s.settings.language);
  const voice = useGosling((s) => s.voice);
  const setVoice = useGosling((s) => s.setVoice);
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  useEffect(() => {
    let alive = true;
    void loadVoices().then((v) => { if (alive) setVoices(v); });
    return () => { alive = false; };
  }, []);
  const tag = speechLang(language);
  const mine = useMemo(() => voicesFor(voices, tag), [voices, tag]);
  const selectedURI = mine.some((v) => v.voiceURI === voice.voiceURI) ? voice.voiceURI : '';
  return (
    <div className="g-voice-set">
      <h3>{tr('Voice')}</h3>
      <p>{tr('Talk to Gosling with the microphone button, or tap the waveform for hands-free Voice mode: I listen, answer out loud, and listen again.')}</p>
      {synthesisSupported() ? (
        <>
          <label className="g-check"><input type="checkbox" checked={voice.readAloud} onChange={(e) => setVoice({ readAloud: e.target.checked })} /> {tr('Read every reply aloud')}</label>
          <div className="g-fields">
            <label>{tr('Voice')}
              <select value={selectedURI} onChange={(e) => setVoice({ voiceURI: e.target.value })}>
                <option value="">{tr('Best available for this language')}</option>
                {mine.map((v) => <option key={v.voiceURI} value={v.voiceURI}>{v.name} ({v.lang})</option>)}
              </select>
            </label>
            <label>{tr('Speed')} · {voice.rate.toFixed(2)}×
              <input type="range" min={0.7} max={1.5} step={0.05} value={voice.rate} onChange={(e) => setVoice({ rate: Number(e.target.value) })} />
            </label>
          </div>
          <div className="g-set-actions"><button type="button" className="g-btn" onClick={() => speakMessage(tr('Hi, I’m Gosling. This is how I sound.'))}>{tr('Preview voice')}</button></div>
        </>
      ) : <p className="g-fine">{tr('This browser can’t speak, so replies stay on screen.')}</p>}
      <p className="g-fine">{tr('Speech recognition is done by your browser. Chrome and Edge send the audio to their speech service to turn it into text; Nicque itself sends nothing anywhere.')}</p>
    </div>
  );
}

function SettingsPane() {
  useStore((s) => s.settings.language);
  const llm = useGosling((s) => s.llm);
  const setLlm = useGosling((s) => s.setLlm);
  const back = useGosling((s) => s.setSettingsOpen);
  const clear = useGosling((s) => s.clear);
  return (
    <div className="g-settings">
      <h3>{tr('How Gosling thinks')}</h3>
      <p>{tr('Out of the box Gosling runs entirely in this browser: it reads your live workspace and Nicque’s own documentation, and can build for you. Nothing leaves your device.')}</p>
      <p>{tr('For open-ended questions about anything, you can connect a language model of your choice (any OpenAI-compatible endpoint). Gosling then sends each question plus a compact picture of your workspace to that service, and the model can create and edit modules through Gosling’s tools.')}</p>
      <label className="g-check"><input type="checkbox" checked={llm.enabled} onChange={(e) => setLlm({ enabled: e.target.checked })} /> {tr('Use a language model')}</label>
      <div className={`g-fields${llm.enabled ? '' : ' off'}`}>
        <label>{tr('Endpoint')}<input value={llm.baseUrl} onChange={(e) => setLlm({ baseUrl: e.target.value })} spellCheck={false} placeholder="https://api.openai.com/v1" /></label>
        <label>{tr('Model')}<input value={llm.model} onChange={(e) => setLlm({ model: e.target.value })} spellCheck={false} placeholder="gpt-4o-mini" /></label>
        <label>{tr('API key')}<input type="password" value={llm.apiKey} onChange={(e) => setLlm({ apiKey: e.target.value })} spellCheck={false} autoComplete="off" placeholder="sk-…" /></label>
        <p className="g-fine">{tr('The key is stored only in this browser’s local storage and is sent only to the endpoint above. If the model can’t be reached, Gosling falls back to its built-in brain.')}</p>
      </div>
      <VoiceSettings />
      <div className="g-set-actions">
        <button type="button" className="g-btn" onClick={() => back(false)}>{tr('Done')}</button>
        <button type="button" className="g-btn ghost" onClick={() => { clear(); back(false); }}>{tr('Clear conversation')}</button>
      </div>
    </div>
  );
}

export function Gosling() {
  useStore((s) => s.settings.language);
  const open = useGosling((s) => s.open);
  const msgs = useGosling((s) => s.msgs);
  const busy = useGosling((s) => s.busy);
  const settingsOpen = useGosling((s) => s.settingsOpen);
  const llm = useGosling((s) => s.llm);
  const send = useGosling((s) => s.send);
  const cancel = useGosling((s) => s.cancel);
  const setOpen = useGosling((s) => s.setOpen);
  const setSettingsOpen = useGosling((s) => s.setSettingsOpen);
  const run = useStore((s) => s.run);
  const nodeCount = useStore((s) => Object.keys(s.project.graph.nodes).length);
  const edgeCount = useStore((s) => Object.keys(s.project.graph.edges).length);

  const [text, setText] = useState('');
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const textRef = useRef('');
  textRef.current = text;
  const voiceMode = useGosling((s) => s.voiceMode);
  const voice = useGosling((s) => s.voice);
  const setVoice = useGosling((s) => s.setVoice);
  const v = useGoslingVoice({ getText: () => textRef.current, setText });

  useEffect(() => { if (open && !msgs.length) setOpen(true); }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  useLayoutEffect(() => { const el = scroller.current; if (el) el.scrollTop = el.scrollHeight; }, [msgs, busy, open, settingsOpen]);
  useEffect(() => { if (open && !settingsOpen) input.current?.focus(); }, [open, settingsOpen]);
  useEffect(() => {
    if (!input.current) return;
    input.current.style.height = '0px';
    input.current.style.height = Math.min(112, input.current.scrollHeight) + 'px';
  }, [text, open]);
  useEffect(() => {
    if (!pos) return;
    const clamp = () => setPos((p) => p ? { x: Math.max(4, Math.min(window.innerWidth - 80, p.x)), y: Math.max(4, Math.min(window.innerHeight - 60, p.y)) } : null);
    window.addEventListener('resize', clamp);
    return () => window.removeEventListener('resize', clamp);
  }, [pos !== null]);

  const last = msgs[msgs.length - 1];
  const chips = !busy && last?.role === 'gosling' ? last.chips : undefined;

  const submit = (t = text) => { if (!t.trim() || busy) return; v.abortDictation(); setText(''); void send(t); };

  const startDrag = (e: React.PointerEvent) => {
    if ((e.target as HTMLElement).closest('button')) return;
    const el = panel.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const dx = e.clientX - r.left, dy = e.clientY - r.top;
    const move = (ev: PointerEvent) => setPos({
      x: Math.max(4, Math.min(window.innerWidth - 80, ev.clientX - dx)),
      y: Math.max(4, Math.min(window.innerHeight - 60, ev.clientY - dy)),
    });
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
  };

  if (!open) return null;
  const style = pos ? { left: pos.x, top: pos.y, right: 'auto', bottom: 'auto' } : undefined;
  const live = llm.enabled && llm.apiKey.trim();

  return (
    <aside ref={panel} className="g-panel" style={style} role="dialog" aria-label={tr('Gosling, your Nicque copilot')}
      onKeyDown={(e) => { if (e.key === 'Escape') { e.stopPropagation(); setOpen(false); } }}>
      <header className="g-head" onPointerDown={startDrag}>
        <GoslingMark size={32} />
        <div className="g-title">
          <b>Gosling</b>
          <span><i className={`g-dot ${run}`} />{tr('{n} modules · {e} wires · {state}', { n: nodeCount, e: edgeCount, state: tr(run) })}</span>
        </div>
        {v.canListen && <button type="button" className={`g-ic${voiceMode ? ' on' : ''}`} aria-pressed={voiceMode} aria-label={voiceMode ? tr('End Voice mode') : tr('Start Voice mode')} title={voiceMode ? tr('End Voice mode') : tr('Voice mode: talk hands-free')} onClick={() => (voiceMode ? v.endVoiceMode() : v.startVoiceMode())}><VIcon name="voice" size={16} /></button>}
        {v.canSpeak && !voiceMode && <button type="button" className={`g-ic${voice.readAloud ? ' on' : ''}`} aria-pressed={voice.readAloud} aria-label={tr('Read replies aloud')} title={voice.readAloud ? tr('Replies are read aloud') : tr('Read replies aloud')} onClick={() => setVoice({ readAloud: !voice.readAloud })}><VIcon name={voice.readAloud ? 'speaker' : 'speaker-off'} size={16} /></button>}
        <button type="button" className={`g-ic${settingsOpen ? ' on' : ''}`} aria-label={tr('Gosling settings')} title={tr('How Gosling thinks')} onClick={() => setSettingsOpen(!settingsOpen)}><Icon name="gear" size={15} /></button>
        <button type="button" className="g-ic" aria-label={tr('Close Gosling')} title={tr('Close (Esc)')} onClick={() => setOpen(false)}><Icon name="close" size={15} /></button>
      </header>

      {settingsOpen ? <div className="g-body" ref={scroller}><SettingsPane /></div> : (
        <>
          <div className="g-body" ref={scroller} aria-live="polite">
            {msgs.map((m) => <Bubble key={m.id} m={m} onSay={v.sayMessage} />)}
            {busy && <div className="g-row"><GoslingMark size={22} /><div className="g-bubble"><span className="g-typing" aria-label={tr('Gosling is thinking')}><i /><i /><i /></span></div></div>}
          </div>
          {v.error && (
            <div className="g-err" role="alert">
              <span>{voiceErrorText(v.error)}</span>
              <button type="button" className="g-ic" aria-label={tr('Dismiss')} onClick={v.clearError}><Icon name="close" size={12} /></button>
            </div>
          )}
          {voiceMode ? (
            <VoiceDock phase={v.phase} interim={v.interim} muted={voice.muteInVoiceMode} onTap={v.tapOrb} onMute={() => setVoice({ muteInVoiceMode: !voice.muteInVoiceMode })} onEnd={v.endVoiceMode} />
          ) : (
            <>
          {chips?.length ? (
            <div className="g-chips" aria-label={tr('Suggestions')}>
              {chips.map((c) => <button key={c} type="button" className="g-chip" onClick={() => submit(c)}>{c}</button>)}
            </div>
          ) : null}
          <form className="g-input" onSubmit={(e) => { e.preventDefault(); submit(); }}>
              {v.canListen && <button type="button" className={`g-mic${v.dictating ? ' live' : ''}`} onClick={v.toggleDictation} aria-pressed={v.dictating} aria-label={v.dictating ? tr('Stop dictating') : tr('Dictate with your voice')} title={v.dictating ? tr('Stop dictating') : tr('Dictate with your voice')}><VIcon name="mic" size={16} /></button>}
            <textarea ref={input} rows={1} value={text} aria-label={tr('Message Gosling')} placeholder={v.dictating ? tr('Listening… speak now') : live ? tr('Ask anything, or tell me what to build…') : tr('Ask about your workspace, or say “add a timer”…')}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => { e.stopPropagation(); if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit(); } if (e.key === 'Escape') setOpen(false); }} />
            {busy
              ? <button type="button" className="g-send" onClick={cancel} aria-label={tr('Stop')} title={tr('Stop')}><Icon name="stop" size={14} /></button>
              : <button type="submit" className="g-send" disabled={!text.trim()} aria-label={tr('Send')}><Icon name="chevron" size={16} /></button>}
          </form>
            </>
          )}
          <div className="g-foot">{live ? tr('Language model: {model}', { model: llm.model }) : tr('Built-in brain · runs in your browser')}</div>
        </>
      )}
    </aside>
  );
}

export type { ReactNode };
