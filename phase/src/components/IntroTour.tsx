import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { ArrowLeft, ArrowRight, BarChart3, Bell, CalendarDays, Droplet, HeartPulse, Lock, Sparkles, Wand2 } from 'lucide-react';
import { cx } from './ui';

/**
 * Intro tour for people who just created an account: swipeable cards that
 * explain the main features. "Skip" (top right) closes it at any time.
 */

interface Slide {
  icon: typeof Droplet;
  tint: string;
  title: string;
  body: string;
  points: string[];
  visual?: ReactNode;
}

const Pill = ({ children, className }: { children: ReactNode; className: string }) => (
  <span className={cx('rounded-full px-2.5 py-1 text-xs font-semibold', className)}>{children}</span>
);

export const SLIDES: Slide[] = [
  {
    icon: Sparkles,
    tint: 'bg-blush-200 text-rose-600',
    title: 'Welcome to Phase',
    body: 'A calm, private companion for your cycle. Here’s a quick look at what you can do.',
    points: ['Takes about a minute', 'Swipe or tap Next to continue'],
  },
  {
    icon: Droplet,
    tint: 'bg-blush-100 text-rose-600',
    title: 'Log in 15 seconds',
    body: 'Tap Log today to record cramps, flow, headaches and mood with a few taps, or just type or say how you feel.',
    points: ['“Bad cramps and feeling tired” logs both', 'Add sleep, water, stress and more in Daily details'],
    visual: (
      <div className="flex flex-wrap justify-center gap-1.5">
        <Pill className="bg-rose-500 text-white">Cramps: Severe</Pill>
        <Pill className="bg-peach-200 text-ink">Mood: Anxious</Pill>
        <Pill className="bg-sky-50 text-sky-700">Water: 6 glasses</Pill>
      </div>
    ),
  },
  {
    icon: CalendarDays,
    tint: 'bg-peach-100 text-ink',
    title: 'Know what’s coming',
    body: 'Phase predicts your next two periods, your fertile window and ovulation, and gets more accurate with every cycle you log.',
    points: ['Swipe back through past days at the top of Today', 'See how confident each prediction is'],
    visual: (
      <div className="grid grid-cols-7 gap-1">
        {Array.from({ length: 14 }, (_, i) => (
          <span
            key={i}
            className={cx(
              'h-7 w-7 rounded-full',
              i < 4 ? 'bg-rose-400' : i >= 9 && i <= 11 ? 'bg-sage-100 ring-1 ring-sage-200' : i === 12 ? 'bg-sage-400' : 'bg-cream-200',
            )}
          />
        ))}
      </div>
    ),
  },
  {
    icon: Wand2,
    tint: 'bg-sage-100 text-sage-600',
    title: 'Your day at a glance',
    body: 'See fatigue, sleep, water and stress as rings, plus a daily insight and simple suggestions for how to feel your best.',
    points: ['“Drink 3 more glasses of water today”', '“Aim for 8½ hours of sleep tonight”'],
  },
  {
    icon: HeartPulse,
    tint: 'bg-lilac-100 text-lilac-500',
    title: 'Understand your body',
    body: 'In Symptoms, pick everything you’re feeling and tap Apply to learn what might be causing it and what helps.',
    points: ['Insights shows trends and charts over time', 'Phase gently flags anything worth discussing with a doctor'],
    visual: (
      <div className="flex items-end justify-center gap-1.5">
        {[30, 55, 40, 70, 48, 62].map((h, i) => (
          <span key={i} className="w-5 rounded-t-md bg-rose-400" style={{ height: h }} />
        ))}
        <BarChart3 className="ml-1 text-ink-faint" size={18} />
      </div>
    ),
  },
  {
    icon: Bell,
    tint: 'bg-peach-100 text-ink',
    title: 'Gentle check-ins',
    body: 'Turn on notifications in Settings for kind reminders, comfort on tough days and small celebrations.',
    points: ['Discreet mode keeps cycle details off your lock screen', 'At most two a day, and quiet at night'],
  },
  {
    icon: Lock,
    tint: 'bg-sage-100 text-sage-600',
    title: 'Private by design',
    body: 'Your data is encrypted on your phone with your password, so no one else can read it.',
    points: ['Sign in on any device with your username and password', 'Add a PIN or Face ID lock in Settings'],
  },
];

export default function IntroTour({ onDone }: { onDone: () => void }) {
  const [index, setIndex] = useState(0);
  const track = useRef<HTMLDivElement>(null);
  const last = index === SLIDES.length - 1;

  const goTo = useCallback((i: number) => {
    const el = track.current;
    if (!el) return;
    const clamped = Math.max(0, Math.min(SLIDES.length - 1, i));
    el.scrollTo({ left: clamped * el.clientWidth, behavior: 'smooth' });
    setIndex(clamped);
  }, []);

  // Keep the dots in sync while swiping.
  const onScroll = () => {
    const el = track.current;
    if (!el) return;
    const i = Math.round(el.scrollLeft / el.clientWidth);
    if (i !== index) setIndex(i);
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowRight') goTo(index + 1);
      else if (e.key === 'ArrowLeft') goTo(index - 1);
      else if (e.key === 'Escape') onDone();
    };
    window.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
    };
  }, [goTo, index, onDone]);

  return (
    <div className="fixed inset-0 z-[70] flex flex-col bg-cream" role="dialog" aria-modal="true" aria-label="Welcome tour">
      <div className="mx-auto flex w-full max-w-md flex-1 flex-col pb-safe pt-[max(0.75rem,env(safe-area-inset-top))]">
        {/* Top bar: progress dots and Skip */}
        <div className="flex items-center justify-between px-4">
          <div className="flex gap-1.5" aria-label={`Card ${index + 1} of ${SLIDES.length}`}>
            {SLIDES.map((_, i) => (
              <button
                key={i}
                onClick={() => goTo(i)}
                aria-label={`Go to card ${i + 1}`}
                className={cx('h-2 rounded-full transition-all', i === index ? 'w-6 bg-rose-500' : 'w-2 bg-blush-300')}
              />
            ))}
          </div>
          {!last ? (
            <button onClick={onDone} className="min-h-[44px] rounded-full px-4 text-sm font-semibold text-ink-soft hover:bg-blush-100">
              Skip
            </button>
          ) : (
            <span className="min-h-[44px]" />
          )}
        </div>

        {/* Swipeable cards */}
        <div
          ref={track}
          onScroll={onScroll}
          className="no-scrollbar flex flex-1 snap-x snap-mandatory overflow-x-auto overscroll-x-contain"
          aria-live="polite"
        >
          {SLIDES.map((s, i) => {
            const Icon = s.icon;
            return (
              <section
                key={s.title}
                className="flex w-full shrink-0 snap-center flex-col items-center justify-center px-6 text-center"
                aria-hidden={i !== index}
              >
                <div className={cx('mb-6 grid h-24 w-24 place-items-center rounded-[32px] shadow-soft', s.tint)}>
                  <Icon size={42} strokeWidth={1.8} />
                </div>
                <h2 className="font-display text-3xl leading-tight text-ink">{s.title}</h2>
                <p className="mt-3 max-w-sm text-[16px] leading-relaxed text-ink-soft">{s.body}</p>
                {s.visual && <div className="mt-6">{s.visual}</div>}
                <ul className="mt-6 w-full max-w-sm space-y-2 text-left">
                  {s.points.map((p) => (
                    <li key={p} className="flex gap-2.5 rounded-2xl bg-white/80 px-3.5 py-2.5 text-sm text-ink shadow-soft ring-1 ring-blush-200/60">
                      <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-rose-400" />
                      {p}
                    </li>
                  ))}
                </ul>
              </section>
            );
          })}
        </div>

        {/* Back / Next */}
        <div className="flex items-center gap-3 px-4 pb-4 pt-2">
          {index > 0 ? (
            <button
              onClick={() => goTo(index - 1)}
              aria-label="Previous card"
              className="grid h-14 w-14 shrink-0 place-items-center rounded-2xl bg-white/80 text-ink-soft shadow-soft ring-1 ring-blush-200"
            >
              <ArrowLeft size={20} />
            </button>
          ) : null}
          <button
            onClick={() => (last ? onDone() : goTo(index + 1))}
            className="flex h-14 flex-1 items-center justify-center gap-2 rounded-2xl bg-rose-500 text-[15px] font-semibold text-white shadow-lift transition active:scale-[0.98]"
          >
            {last ? 'Get started' : 'Next'}
            {!last && <ArrowRight size={18} />}
          </button>
        </div>
      </div>
    </div>
  );
}
