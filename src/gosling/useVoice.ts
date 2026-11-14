// The voice state machine behind Gosling's microphone button and Voice mode.
//
//   dictation   mic button: speech → text box (you press send)
//   voice mode  hands-free: listen → send → think → speak the answer → listen again … until you end it
//
// Rules that keep it pleasant: the microphone is closed while Gosling talks (so it never hears itself), three silent
// rounds in a row pause the loop instead of listening forever, tapping the orb interrupts whatever is happening, and
// every failure (blocked microphone, no support, offline speech service) is said in plain words.
import { useEffect, useRef, useState } from 'react';
import { tr } from '../i18n';
import { useStore } from '../state/store';
import { useGosling } from './store';
import { cleanForSpeech, listen, loadVoices, recognitionSupported, speak, speechLang, spokenSummary, stopSpeaking, synthesisSupported, type ListenError, type Listener } from './voice';

export type VoicePhase = 'off' | 'listening' | 'thinking' | 'speaking' | 'paused';

const join = (a: string, b: string) => (a && b ? `${a.replace(/\s+$/, '')} ${b}` : a || b);

export function voiceErrorText(e: ListenError): string {
  switch (e) {
    case 'unsupported': return tr('Voice input isn’t supported in this browser. Try Chrome, Edge or Safari.');
    case 'not-allowed': return tr('Microphone access is blocked. Allow it in your browser’s site settings, then try again.');
    case 'audio-capture': return tr('No microphone was found.');
    case 'network': return tr('The browser’s speech service couldn’t be reached. Check your connection.');
    case 'no-speech': return tr('I didn’t hear anything.');
    default: return tr('Voice input stopped unexpectedly. Try again.');
  }
}

// Replaying a single message from its bubble
let replayStop: (() => void) | null = null;
export function speakMessage(text: string) {
  replayStop?.();
  const { voice } = useGosling.getState();
  replayStop = speak(spokenSummary(text, { max: 900 }), { lang: speechLang(useStore.getState().settings.language), rate: voice.rate, voiceURI: voice.voiceURI });
}
export function stopReplay() { replayStop?.(); replayStop = null; stopSpeaking(); }

export function useGoslingVoice(io: { getText(): string; setText(t: string): void }) {
  const language = useStore((s) => s.settings.language);
  const open = useGosling((s) => s.open);
  const settingsOpen = useGosling((s) => s.settingsOpen);
  const voiceMode = useGosling((s) => s.voiceMode);
  const voice = useGosling((s) => s.voice);
  const busy = useGosling((s) => s.busy);
  const msgs = useGosling((s) => s.msgs);

  const [phase, setPhase] = useState<VoicePhase>('off');
  const [interim, setInterim] = useState('');
  const [dictating, setDictating] = useState(false);
  const [error, setError] = useState<ListenError | null>(null);

  const listener = useRef<Listener | null>(null);
  const stopTalk = useRef<(() => void) | null>(null);
  const retryTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const token = useRef(0);
  const silent = useRef(0);
  const dictBase = useRef('');
  const phaseRef = useRef<VoicePhase>('off');
  const modeRef = useRef(voiceMode);
  const prefs = useRef(voice);
  const tag = useRef(speechLang(language));
  const lastSpoken = useRef(msgs[msgs.length - 1]?.id ?? 0);
  const ioRef = useRef(io);
  modeRef.current = voiceMode;
  prefs.current = voice;
  tag.current = speechLang(language);
  ioRef.current = io;

  const phaseTo = (p: VoicePhase) => { phaseRef.current = p; setPhase(p); };

  const cancelSpeech = () => { token.current++; stopTalk.current?.(); stopTalk.current = null; };
  const killAll = () => {
    if (retryTimer.current !== null) { clearTimeout(retryTimer.current); retryTimer.current = null; }
    listener.current?.abort();
    listener.current = null;
    cancelSpeech();
  };

  const say = (text: string, then?: () => void) => {
    cancelSpeech();
    const my = ++token.current;
    stopTalk.current = speak(text, {
      lang: tag.current, rate: prefs.current.rate, voiceURI: prefs.current.voiceURI,
      onDone: () => { if (my !== token.current) return; stopTalk.current = null; then?.(); },
    });
  };

  const fail = (e: ListenError, fatal: boolean) => {
    setError(e);
    setInterim('');
    if (fatal) { modeRef.current = false; useGosling.getState().setVoiceMode(false); phaseTo('off'); } else phaseTo('paused');
  };

  const startListening = () => {
    if (!modeRef.current) return;
    listener.current?.abort();
    setError(null);
    setInterim('');
    const l = listen({
      lang: tag.current,
      onInterim: setInterim,
      onDone: ({ text, error: err }) => {
        listener.current = null;
        if (!modeRef.current) return;
        setInterim('');
        if (text) {
          silent.current = 0;
          phaseTo('thinking');
          void useGosling.getState().send(text);
          return;
        }
        if (err === 'not-allowed') return fail(err, true);
        if (err === 'audio-capture') return fail(err, true);
        if (err === 'network' || err === 'other') return fail(err, false);
        if (++silent.current >= 3) { phaseTo('paused'); return; }
        startListening();
      },
    });
    if (!l) return fail('unsupported', true);
    listener.current = l;
    phaseTo('listening');
  };

  // ---- voice mode -----------------------------------------------------------------------------------------------

  const startVoiceMode = () => {
    if (!recognitionSupported()) { setError('unsupported'); return; }
    killAll();
    stopReplay();
    setDictating(false);
    silent.current = 0;
    modeRef.current = true;
    const g = useGosling.getState();
    g.setSettingsOpen(false);
    g.setVoiceMode(true);
    void loadVoices();
    startListening();
  };
  const endVoiceMode = () => {
    modeRef.current = false;
    killAll();
    setInterim('');
    phaseTo('off');
    useGosling.getState().setVoiceMode(false);
  };
  const tapOrb = () => {
    switch (phaseRef.current) {
      case 'listening': listener.current?.stop(); break;                       // finish now with what was heard
      case 'speaking': cancelSpeech(); startListening(); break;                // interrupt Gosling and talk
      case 'thinking': useGosling.getState().cancel(); startListening(); break; // give up waiting
      case 'paused': silent.current = 0; startListening(); break;
    }
  };
  const sayMessage = (text: string) => {
    if (!synthesisSupported() || !text.trim()) return;
    if (modeRef.current) {
      listener.current?.abort();
      listener.current = null;
      phaseTo('speaking');
      say(spokenSummary(text, { max: 900 }), () => startListening());
      return;
    }
    cancelSpeech();
    speakMessage(text);
  };

  // The panel closed or voice mode was switched off elsewhere
  const wasVoice = useRef(false);
  useEffect(() => {
    if (wasVoice.current && !voiceMode) { killAll(); setInterim(''); phaseTo('off'); }
    wasVoice.current = voiceMode;
  }, [voiceMode]); // eslint-disable-line react-hooks/exhaustive-deps

  // Closing the panel stops all microphone recording and speech playback immediately.
  useEffect(() => {
    if (!open) {
      modeRef.current = false;
      killAll();
      stopReplay();
      setDictating(false);
      setInterim('');
      phaseTo('off');
    }
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  // Opening settings aborts active dictation (voice mode is already turned off by store.setSettingsOpen).
  useEffect(() => {
    if (settingsOpen && listener.current && !modeRef.current) {
      listener.current.abort();
      listener.current = null;
      setDictating(false);
    }
  }, [settingsOpen]); // eslint-disable-line react-hooks/exhaustive-deps

  // ---- dictation ------------------------------------------------------------------------------------------------

  const toggleDictation = () => {
    if (dictating) { listener.current?.stop(); return; }
    if (modeRef.current) return;
    if (!recognitionSupported()) { setError('unsupported'); return; }
    killAll();
    stopReplay();
    setError(null);
    dictBase.current = ioRef.current.getText();
    const l = listen({
      lang: tag.current,
      onInterim: (t) => ioRef.current.setText(join(dictBase.current, t)),
      onDone: ({ text, error: err }) => {
        listener.current = null;
        setDictating(false);
        if (text) ioRef.current.setText(join(dictBase.current, text));
        else { ioRef.current.setText(dictBase.current); if (err) setError(err); }
      },
    });
    if (!l) { setError('unsupported'); return; }
    listener.current = l;
    setDictating(true);
  };

  // ---- speaking replies -----------------------------------------------------------------------------------------

  useEffect(() => {
    const last = msgs[msgs.length - 1];
    if (!last || last.role !== 'gosling' || busy || last.id === lastSpoken.current) return;
    lastSpoken.current = last.id;
    const text = last.text.trim() || (last.actions?.length ? 'Done.' : '');
    if (modeRef.current) {
      if (prefs.current.muteInVoiceMode || !synthesisSupported()) {
        if (retryTimer.current !== null) clearTimeout(retryTimer.current);
        retryTimer.current = setTimeout(() => { retryTimer.current = null; startListening(); }, 250);
        return;
      }
      listener.current?.abort();
      listener.current = null;
      phaseTo('speaking');
      say(spokenSummary(text), () => startListening());
    } else if (prefs.current.readAloud && synthesisSupported()) {
      say(spokenSummary(text, { max: 700 }));
    }
  }, [msgs, busy]); // eslint-disable-line react-hooks/exhaustive-deps

  // A reply that never came (the request was stopped): keep the conversation going
  useEffect(() => {
    if (voiceMode && !busy && phaseRef.current === 'thinking') {
      const t = setTimeout(() => { if (modeRef.current && phaseRef.current === 'thinking' && !useGosling.getState().busy) startListening(); }, 1200);
      return () => clearTimeout(t);
    }
  }, [voiceMode, busy, msgs]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => () => { killAll(); stopReplay(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return {
    canListen: recognitionSupported(),
    canSpeak: synthesisSupported(),
    phase, interim, dictating, error,
    clearError: () => setError(null),
    toggleDictation, startVoiceMode, endVoiceMode, tapOrb, sayMessage,
    /** Drop an in-progress dictation without touching the text box (used when a message is sent). */
    abortDictation: () => { if (!listener.current || modeRef.current) return; listener.current.abort(); listener.current = null; setDictating(false); },
    /** Read this text aloud once (used by the voice picker's preview). */
    preview: (text: string) => say(cleanForSpeech(text)),
  };
}
