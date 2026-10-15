import { useEffect, useMemo, useRef, useState } from 'react';
import { Check, Mic, MicOff, Send, Sparkles, Undo2 } from 'lucide-react';
import type { DailyLog, ISODate } from '../types';
import { parseNaturalLog } from '../lib/nlParser';
import { applyParsed, blankLog, getState, saveLog } from '../lib/store';
import { cx } from './ui';

/* Minimal typing for the Web Speech API (not in lib.dom for all targets). */
interface SpeechRecognitionLike {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null;
  onend: (() => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  start: () => void;
  stop: () => void;
}
type SRCtor = new () => SpeechRecognitionLike;
const getSR = (): SRCtor | undefined =>
  (window as unknown as { SpeechRecognition?: SRCtor; webkitSpeechRecognition?: SRCtor }).SpeechRecognition ??
  (window as unknown as { webkitSpeechRecognition?: SRCtor }).webkitSpeechRecognition;

const EXAMPLES = ['super bad cramps and anxious', 'light flow, slept 6 hours', 'dull headache, feeling tired', 'feeling great, went for a run'];

/**
 * Conversational logging: type or speak how you feel, see what Phase
 * understood in real time, and save it into today's log in one tap.
 */
export default function NaturalLogBar({ date, log, placeholder = 'How are you feeling today?' }: { date: ISODate; log: DailyLog | undefined; placeholder?: string }) {
  const [text, setText] = useState('');
  const [listening, setListening] = useState(false);
  const [confirmation, setConfirmation] = useState<{ chips: string[]; previous: DailyLog } | null>(null);
  const [hint, setHint] = useState<string | null>(null);
  const recRef = useRef<SpeechRecognitionLike | null>(null);
  const SR = useMemo(() => (typeof window !== 'undefined' ? getSR() : undefined), []);

  const parsed = useMemo(() => (text.trim().length > 2 ? parseNaturalLog(text) : null), [text]);

  useEffect(() => {
    if (!confirmation) return;
    const id = setTimeout(() => setConfirmation(null), 6000);
    return () => clearTimeout(id);
  }, [confirmation]);

  useEffect(() => () => recRef.current?.stop(), []);

  // Switching days clears any half-typed text and the last confirmation.
  useEffect(() => {
    setText('');
    setConfirmation(null);
    setHint(null);
  }, [date]);

  const submit = () => {
    if (!parsed) return;
    if (!parsed.understood.length) {
      setHint('I couldn’t spot anything to log there. Try something like “mild cramps and feeling calm.”');
      return;
    }
    const previous = log ? structuredClone(log) : blankLog(date, getState().periodDays.includes(date));
    applyParsed(date, parsed, text.trim());
    setConfirmation({ chips: parsed.understood, previous });
    setText('');
    setHint(null);
    navigator.vibrate?.(10);
  };

  const undo = () => {
    if (!confirmation) return;
    const prev = confirmation.previous;
    saveLog(date, () => prev);
    setConfirmation(null);
  };

  const toggleVoice = () => {
    if (!SR) return;
    if (listening) {
      recRef.current?.stop();
      return;
    }
    const rec = new SR();
    rec.lang = navigator.language || 'en-US';
    rec.interimResults = true;
    rec.continuous = false;
    rec.onresult = (e) => {
      const transcript = Array.from(e.results)
        .map((r) => r[0].transcript)
        .join(' ');
      setText(transcript);
    };
    rec.onerror = (e) => {
      if (e.error === 'not-allowed') setHint('Microphone access is blocked. You can enable it in your browser settings, or just type.');
    };
    rec.onend = () => setListening(false);
    recRef.current = rec;
    setHint(null);
    setListening(true);
    rec.start();
  };

  return (
    <div className="rounded-2xl bg-white/80 p-3 shadow-soft ring-1 ring-blush-200/60">
      <form
        className="flex items-center gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <Sparkles size={18} className="ml-1 shrink-0 text-rose-400" aria-hidden />
        <input
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            setHint(null);
          }}
          placeholder={listening ? 'Listening…' : placeholder}
          aria-label="Describe how you feel"
          enterKeyHint="send"
          className="min-w-0 flex-1 bg-transparent py-2 text-ink placeholder:text-ink-faint focus:outline-none"
        />
        {SR && (
          <button
            type="button"
            onClick={toggleVoice}
            aria-label={listening ? 'Stop voice input' : 'Speak instead'}
            className={cx('grid h-10 w-10 shrink-0 place-items-center rounded-xl transition', listening ? 'animate-breathe bg-rose-500 text-white' : 'text-ink-soft hover:bg-blush-100')}
          >
            {listening ? <MicOff size={18} /> : <Mic size={18} />}
          </button>
        )}
        <button
          type="submit"
          disabled={!parsed}
          aria-label="Log it"
          className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-rose-500 text-white transition active:scale-95 disabled:bg-blush-200"
        >
          <Send size={17} />
        </button>
      </form>

      {/* Live preview of what was understood */}
      {parsed && parsed.understood.length > 0 && (
        <div className="mt-2 flex animate-fade-up flex-wrap gap-1.5 px-1" aria-live="polite">
          {parsed.understood.map((c) => (
            <span key={c} className="rounded-full bg-blush-100 px-2.5 py-1 text-xs font-medium text-rose-700">
              {c}
            </span>
          ))}
        </div>
      )}

      {!text && !confirmation && !hint && (
        <div className="no-scrollbar mt-2 flex gap-1.5 overflow-x-auto px-1">
          {EXAMPLES.map((ex) => (
            <button key={ex} onClick={() => setText(ex)} className="shrink-0 rounded-full bg-cream-200 px-2.5 py-1 text-xs text-ink-soft">
              “{ex}”
            </button>
          ))}
        </div>
      )}

      {hint && <p className="mt-2 px-1 text-sm text-ink-soft">{hint}</p>}

      {confirmation && (
        <div className="mt-2 flex animate-fade-up items-center justify-between gap-2 rounded-xl bg-sage-100 px-3 py-2 text-sm text-sage-600" role="status">
          <span className="flex items-center gap-1.5">
            <Check size={16} /> Logged {confirmation.chips.length} {confirmation.chips.length === 1 ? 'item' : 'items'}
          </span>
          <button onClick={undo} className="flex items-center gap-1 font-semibold">
            <Undo2 size={14} /> Undo
          </button>
        </div>
      )}
    </div>
  );
}
