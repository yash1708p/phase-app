import { useMemo, useState } from 'react';
import { ArrowLeft, ArrowRight, CalendarDays, Heart, ShieldCheck, Sparkles, Target, Flower2, Activity } from 'lucide-react';
import type { Demographics, ISODate, PrimaryGoal } from '../types';
import { addDays, diffDays, formatDay, formatRange, isValidISO, monthLabel, addMonths } from '../lib/dates';
import { predict } from '../lib/predictionEngine';
import { completeOnboarding } from '../lib/store';
import { Button, Card, Chip, Stepper, cx } from './ui';

const GOALS: { id: PrimaryGoal; title: string; body: string; icon: typeof Heart }[] = [
  { id: 'track_period', title: 'Track my period', body: 'Know when it’s coming and plan around it.', icon: CalendarDays },
  { id: 'understand_symptoms', title: 'Understand my symptoms', body: 'See how my cycle shapes mood, energy and pain.', icon: Activity },
  { id: 'trying_to_conceive', title: 'Trying to conceive', body: 'Highlight my fertile window and ovulation.', icon: Flower2 },
  { id: 'general_wellbeing', title: 'General wellbeing', body: 'A gentle daily check-in with my body.', icon: Heart },
];

const STEPS = ['welcome', 'age', 'goal', 'cycle', 'period', 'forecast'] as const;
type Step = (typeof STEPS)[number];

export default function OnboardingWizard({ today }: { today: ISODate }) {
  const [step, setStep] = useState<Step>('welcome');
  const [age, setAge] = useState(27);
  const [goal, setGoal] = useState<PrimaryGoal>('track_period');
  const [cycleLength, setCycleLength] = useState(28);
  const [periodLength, setPeriodLength] = useState(5);
  const [start, setStart] = useState<ISODate>('');
  const [ongoing, setOngoing] = useState(false);
  const [end, setEnd] = useState<ISODate>('');

  const idx = STEPS.indexOf(step);
  const next = () => setStep(STEPS[Math.min(idx + 1, STEPS.length - 1)]);
  const back = () => setStep(STEPS[Math.max(idx - 1, 0)]);

  const resolvedEnd: ISODate | '' = !isValidISO(start)
    ? ''
    : ongoing
      ? today
      : isValidISO(end)
        ? end
        : addDays(start, periodLength - 1) > today
          ? today
          : addDays(start, periodLength - 1);

  const periodError = (() => {
    if (!start) return null;
    if (!isValidISO(start)) return 'Please pick a valid date.';
    if (start > today) return 'The start date can’t be in the future.';
    if (diffDays(today, start) > 120) return 'Please choose a period from the last 4 months so predictions stay accurate.';
    if (!ongoing && end) {
      if (!isValidISO(end) || end < start) return 'The end date needs to be on or after the start date.';
      if (end > today) return 'The end date can’t be in the future.';
      if (diffDays(end, start) > 14) return 'That’s a long period — please double-check the dates.';
    }
    return null;
  })();

  const profile: Demographics = { age, primaryGoal: goal, typicalCycleLength: cycleLength, typicalPeriodLength: periodLength };

  const preview = useMemo(() => {
    if (!resolvedEnd || periodError) return null;
    const days = Array.from({ length: diffDays(resolvedEnd, start) + 1 }, (_, i) => addDays(start, i));
    return predict({ profile, periodDays: days, today });
  }, [start, resolvedEnd, periodError, age, goal, cycleLength, periodLength, today]);

  const finish = () => {
    if (!resolvedEnd) return;
    completeOnboarding(profile, start, resolvedEnd);
  };

  return (
    <main className="app-shell flex flex-col">
      {/* progress */}
      <div className="mb-6 flex items-center gap-3">
        {idx > 0 ? (
          <button onClick={back} aria-label="Back" className="grid h-10 w-10 place-items-center rounded-full text-ink-soft hover:bg-blush-100">
            <ArrowLeft size={20} />
          </button>
        ) : (
          <div className="h-10 w-10" />
        )}
        <div className="flex flex-1 gap-1.5" aria-label={`Step ${idx + 1} of ${STEPS.length}`}>
          {STEPS.map((s, i) => (
            <div key={s} className={cx('h-1.5 flex-1 rounded-full transition-colors', i <= idx ? 'bg-rose-400' : 'bg-blush-200')} />
          ))}
        </div>
        <div className="h-10 w-10" />
      </div>

      <div key={step} className="flex flex-1 animate-fade-up flex-col">
        {step === 'welcome' && (
          <>
            <div className="mb-6 mt-4 grid h-20 w-20 place-items-center rounded-[28px] bg-blush-200 shadow-soft">
              <svg viewBox="0 0 64 64" className="h-12 w-12" aria-hidden>
                <circle cx="32" cy="32" r="17" fill="#FFF8F2" stroke="#E07A7F" strokeWidth="5" />
                <path d="M32 15a17 17 0 0 1 0 34z" fill="#E07A7F" />
              </svg>
            </div>
            <h1 className="font-display text-4xl leading-tight text-ink">Hi, welcome to Phase.</h1>
            <p className="mt-3 text-lg text-ink-soft">A calm, private companion for your cycle. Setup takes about a minute.</p>
            <Card className="mt-8 flex gap-3">
              <ShieldCheck className="mt-0.5 shrink-0 text-sage-600" size={22} />
              <p className="text-sm text-ink-soft">
                <strong className="text-ink">Your data stays private.</strong> It’s encrypted on your phone before it’s saved or synced, so no one else can read it. No ads, no tracking. Predictions and insights are
                calculated right here on your phone.
              </p>
            </Card>
            <div className="flex-1" />
            <Button block onClick={next}>
              Let’s begin <ArrowRight size={18} />
            </Button>
          </>
        )}

        {step === 'age' && (
          <>
            <h1 className="font-display text-3xl text-ink">How old are you?</h1>
            <p className="mt-2 text-ink-soft">Cycles naturally vary more in the teen years and in your 40s. Your age helps Phase set realistic prediction windows.</p>
            <div className="mt-8">
              <Stepper label="age" value={age} onChange={setAge} min={10} max={60} suffix="years" />
            </div>
            <div className="flex-1" />
            <Button block onClick={next}>
              Continue <ArrowRight size={18} />
            </Button>
          </>
        )}

        {step === 'goal' && (
          <>
            <h1 className="font-display text-3xl text-ink">What brings you here?</h1>
            <p className="mt-2 text-ink-soft">This shapes what Phase highlights for you. You can change it later.</p>
            <div className="mt-6 grid gap-3" role="radiogroup">
              {GOALS.map(({ id, title, body, icon: Icon }) => (
                <button
                  key={id}
                  role="radio"
                  aria-checked={goal === id}
                  onClick={() => setGoal(id)}
                  className={cx(
                    'flex items-center gap-3 rounded-2xl p-4 text-left ring-1 transition active:scale-[0.99]',
                    goal === id ? 'bg-blush-100 ring-2 ring-rose-400' : 'bg-white/80 ring-blush-200',
                  )}
                >
                  <span className={cx('grid h-11 w-11 shrink-0 place-items-center rounded-xl', goal === id ? 'bg-rose-500 text-white' : 'bg-blush-100 text-rose-600')}>
                    <Icon size={20} />
                  </span>
                  <span>
                    <span className="block font-semibold text-ink">{title}</span>
                    <span className="block text-sm text-ink-soft">{body}</span>
                  </span>
                </button>
              ))}
            </div>
            <div className="flex-1" />
            <Button block className="mt-6" onClick={next}>
              Continue <ArrowRight size={18} />
            </Button>
          </>
        )}

        {step === 'cycle' && (
          <>
            <h1 className="font-display text-3xl text-ink">Your usual rhythm</h1>
            <p className="mt-2 text-ink-soft">Not sure? Keep the defaults — Phase learns your real pattern as you log.</p>
            <div className="mt-6 space-y-5">
              <div>
                <p className="mb-2 text-sm font-semibold text-ink">Cycle length</p>
                <Stepper label="cycle length" value={cycleLength} onChange={setCycleLength} min={18} max={50} suffix="days" />
                <p className="mt-1.5 text-xs text-ink-faint">From the first day of one period to the first day of the next.</p>
              </div>
              <div>
                <p className="mb-2 text-sm font-semibold text-ink">Period length</p>
                <Stepper label="period length" value={periodLength} onChange={setPeriodLength} min={2} max={10} suffix="days" />
              </div>
            </div>
            <div className="flex-1" />
            <Button block className="mt-6" onClick={next}>
              Continue <ArrowRight size={18} />
            </Button>
          </>
        )}

        {step === 'period' && (
          <>
            <h1 className="font-display text-3xl text-ink">Your most recent period</h1>
            <p className="mt-2 text-ink-soft">When did your current or most recent period start?</p>
            <label className="mt-6 block">
              <span className="mb-1.5 block text-sm font-semibold text-ink">Start date</span>
              <input type="date" className="field" value={start} max={today} onChange={(e) => setStart(e.target.value)} />
            </label>
            <div className="mt-5">
              <p className="mb-2 text-sm font-semibold text-ink">Is it still going?</p>
              <div className="grid grid-cols-2 gap-2">
                <Chip selected={ongoing} onClick={() => setOngoing(true)}>
                  Yes, it’s ongoing
                </Chip>
                <Chip selected={!ongoing} onClick={() => setOngoing(false)}>
                  No, it ended
                </Chip>
              </div>
            </div>
            {!ongoing && (
              <label className="mt-5 block animate-fade-up">
                <span className="mb-1.5 block text-sm font-semibold text-ink">
                  End date <span className="font-normal text-ink-faint">(optional)</span>
                </span>
                <input type="date" className="field" value={end} min={start || undefined} max={today} onChange={(e) => setEnd(e.target.value)} />
              </label>
            )}
            {periodError && (
              <p role="alert" className="mt-4 rounded-xl bg-blush-100 px-3 py-2 text-sm text-rose-700">
                {periodError}
              </p>
            )}
            <div className="flex-1" />
            <Button block className="mt-6" disabled={!start || !!periodError} onClick={next}>
              See my forecast <Sparkles size={18} />
            </Button>
          </>
        )}

        {step === 'forecast' && preview && (
          <>
            <h1 className="font-display text-3xl text-ink">Your first forecast</h1>
            <p className="mt-2 text-ink-soft">It sharpens automatically every time you log a new period.</p>
            <div className="mt-6 space-y-3">
              {[
                { label: monthLabel(today), cycle: preview.currentMonth, logged: preview.currentMonthLogged },
                { label: monthLabel(addMonths(today, 1)), cycle: preview.nextMonth, logged: null },
              ].map(({ label, cycle, logged }) => (
                <Card key={label} className="flex items-center gap-4">
                  <span className="grid h-12 w-12 shrink-0 place-items-center rounded-xl bg-blush-100 text-rose-600">
                    <CalendarDays size={22} />
                  </span>
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-wide text-ink-faint">{label}</p>
                    {cycle ? (
                      <p className="font-display text-xl text-ink">Period {formatRange(cycle.periodStart, cycle.periodEnd)}</p>
                    ) : logged ? (
                      <p className="font-display text-xl text-ink">Logged {formatRange(logged.startDate, logged.endDate)}</p>
                    ) : (
                      <p className="font-display text-xl text-ink-soft">No period expected</p>
                    )}
                    {cycle && <p className="text-sm text-ink-soft">±{cycle.uncertaintyDays} days · ovulation ~{formatDay(cycle.ovulation)}</p>}
                  </div>
                </Card>
              ))}
              <div className="flex items-start gap-2 rounded-2xl bg-sage-100 p-3 text-sm text-sage-600">
                <Target size={18} className="mt-0.5 shrink-0" />
                <span>{preview.confidenceReason}</span>
              </div>
            </div>
            <p className="mt-4 text-xs text-ink-faint">
              Predictions are estimates for awareness and planning. Phase is not a method of contraception and doesn’t replace medical advice.
            </p>
            <div className="flex-1" />
            <Button block className="mt-6" onClick={finish}>
              Start using Phase <Heart size={18} />
            </Button>
          </>
        )}
      </div>
    </main>
  );
}
