import { useMemo } from 'react';
import { CalendarDays, Droplet, Info, NotebookPen, Plus, Settings, Sparkles, Target, TrendingUp } from 'lucide-react';
import type { AppData, CycleStatus, DailyLog, ISODate, Prediction, Suggestion } from '../types';
import type { Insight } from '../lib/insightEngine';
import { PHASE_COPY } from '../lib/insightEngine';
import { addDays, addMonths, formatDay, formatRange, monthLabel, relativeDays } from '../lib/dates';
import { getCycleStatus, predict } from '../lib/predictionEngine';
import { dayMetrics } from '../lib/dayMetrics';
import { useDaySwipe } from '../hooks/useDaySwipe';
import CycleCalendar from './CycleCalendar';
import NaturalLogBar from './NaturalLogBar';
import SuggestionsCard from './SuggestionsCard';
import DateNav, { dayLabel } from './DateNav';
import { RingsCard } from './MetricRings';
import WaterCard, { type WaterReminderState } from './WaterCard';
import { waterTarget } from '../lib/suggestions';
import { Button, Card, cx } from './ui';

interface Props {
  data: AppData;
  today: ISODate;
  /** Day being viewed (today or a past day). */
  viewDate: ISODate;
  onChangeDate: (d: ISODate) => void;
  prediction: Prediction | null;
  status: CycleStatus;
  insight: Insight;
  suggestions: Suggestion[];
  onOpenLogger: (date: ISODate, defaultPeriod: boolean) => void;
  onOpenDetails: (date: ISODate) => void;
  onOpenSettings: () => void;
  onOpenInsights: () => void;
  /** Hourly water reminder status, and when the next one is due. */
  waterReminders?: WaterReminderState;
  nextWaterReminder?: number | null;
}

const greeting = () => {
  const h = new Date().getHours();
  return h < 5 ? 'Good night' : h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
};

export default function Dashboard(props: Props) {
  const { data, today, viewDate, onChangeDate, insight, suggestions, onOpenLogger, onOpenDetails, onOpenSettings, onOpenInsights } = props;
  const isToday = viewDate === today;
  const log = data.logs[viewDate];
  const hasLog = !!log && (log.symptoms.moods.length > 0 || !!log.symptoms.cramps || !!log.symptoms.headache || !!log.cycle.flow);

  // Cycle state *as it was* on the viewed day (only periods logged up to that day count).
  const day = useMemo(() => {
    if (isToday || !data.profile) return { status: props.status, prediction: props.prediction };
    const periodDays = data.periodDays.filter((d) => d <= viewDate);
    const prediction = predict({ profile: data.profile, periodDays, today: viewDate });
    return { status: getCycleStatus(prediction, periodDays, viewDate), prediction };
  }, [isToday, data.profile, data.periodDays, viewDate, props.status, props.prediction]);

  const metrics = useMemo(
    () => (data.profile ? dayMetrics({ date: viewDate, log, logs: data.logs, profile: data.profile, status: day.status }) : []),
    [data.profile, viewDate, log, data.logs, day.status],
  );

  const earliest = useMemo(() => {
    const first = [data.periodDays[0], ...Object.keys(data.logs)].filter(Boolean).sort()[0];
    return first ? addDays(first, -30) : addDays(today, -90);
  }, [data.periodDays, data.logs, today]);

  const prev = () => viewDate > earliest && onChangeDate(addDays(viewDate, -1));
  const next = () => !isToday && onChangeDate(addDays(viewDate, 1));
  const swipe = useDaySwipe(prev, next);
  const label = dayLabel(viewDate, today);

  return (
    <main className="app-shell space-y-4" {...swipe}>
      <header className="flex items-center justify-between pt-1">
        <div>
          <p className="text-sm text-ink-soft">
            {greeting()}
            {data.username ? `, ${data.username}` : ''}
          </p>
          <h1 className="font-display text-2xl text-ink">{formatDay(today, { weekday: 'long', month: 'long', day: 'numeric' })}</h1>
        </div>
        <button onClick={onOpenSettings} aria-label="Settings" className="grid h-11 w-11 place-items-center rounded-full bg-white/70 text-ink-soft shadow-soft">
          <Settings size={20} />
        </button>
      </header>

      <DateNav date={viewDate} today={today} earliest={earliest} onChange={onChangeDate} />

      <div key={viewDate} className="animate-fade-up space-y-4">
        <RingsCard metrics={metrics} title={isToday ? 'Today at a glance' : `${label} at a glance`} onEdit={() => onOpenDetails(viewDate)} />

        <CycleHero status={day.status} prediction={day.prediction} past={!isToday} />

        {/* Primary actions */}
        <div className="grid grid-cols-2 gap-3">
          <Button variant={day.status.onPeriod || !isToday ? 'soft' : 'primary'} onClick={() => onOpenLogger(viewDate, true)} className="h-14">
            <Droplet size={18} className={day.status.onPeriod || !isToday ? '' : 'fill-white/40'} />
            {!isToday ? 'Period day' : day.status.onPeriod ? 'Log period day' : 'Period started'}
          </Button>
          <Button variant={day.status.onPeriod || !isToday ? 'primary' : 'soft'} onClick={() => onOpenLogger(viewDate, day.status.onPeriod)} className="h-14">
            <Plus size={18} />
            {isToday ? (hasLog ? 'Edit today' : 'Log today') : hasLog ? 'Edit this day' : 'Log this day'}
          </Button>
        </div>

        <WaterCard
          date={viewDate}
          isToday={isToday}
          log={log}
          goal={waterTarget(day.status, log)}
          reminders={props.waterReminders ?? 'notifications-off'}
          nextReminder={props.nextWaterReminder ?? null}
          onOpenSettings={onOpenSettings}
        />

        <NaturalLogBar date={viewDate} log={log} placeholder={isToday ? 'How are you feeling today?' : `How did you feel ${label === 'Yesterday' ? 'yesterday' : 'that day'}?`} />

        {isToday ? (
          <>
            <InsightCard insight={insight} />
            <SuggestionsCard suggestions={suggestions} onOpenCare={onOpenInsights} />
          </>
        ) : (
          <DaySummary log={log} label={label} onEdit={() => onOpenDetails(viewDate)} onBackToToday={() => onChangeDate(today)} />
        )}
      </div>

      {props.prediction && <PredictionCard prediction={props.prediction} today={today} />}

      <CycleCalendar
        today={today}
        prediction={props.prediction}
        periodDays={data.periodDays}
        logs={data.logs}
        selected={viewDate}
        onSelectDay={(d) => {
          onChangeDate(d);
          window.scrollTo({ top: 0, behavior: 'smooth' });
        }}
      />

      <p className="px-2 pb-4 text-center text-xs text-ink-faint">
        Predictions are estimates, not medical advice or contraception. Your data is encrypted on your device.
      </p>
    </main>
  );
}

/* ------------------------------------------------------------------ */
/* Past-day summary                                                     */
/* ------------------------------------------------------------------ */

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1).replace('_', ' ');

export function logSummary(log: DailyLog | undefined): string[] {
  if (!log) return [];
  const out: string[] = [];
  const y = log.symptoms;
  if (log.cycle.isPeriodDay) out.push(log.cycle.flow ? `Period · ${cap(log.cycle.flow)} flow` : 'Period day');
  else if (log.cycle.intermenstrualSpotting) out.push('Spotting');
  if (y.feelingFine) out.push('Feeling fine');
  if (y.cramps && y.cramps !== 'none') out.push(`${cap(y.cramps)} cramps`);
  if (y.headache && y.headache !== 'none') out.push(y.headache === 'migraine' ? 'Migraine' : 'Dull headache');
  for (const m of y.moods) out.push(cap(m));
  if (y.acne && y.acne !== 'none') out.push(`${cap(y.acne)} acne`);
  if (y.bloating) out.push('Bloating');
  if (y.tenderBreasts) out.push('Tender breasts');
  if (y.cravings) out.push('Cravings');
  if (y.discharge && y.discharge !== 'none') out.push(`${cap(y.discharge)} discharge`);
  if (y.bbt) out.push(`BBT ${y.bbt.toFixed(2)}°C`);
  if (log.lifestyle.workout) out.push(log.lifestyle.workout === 'rest' ? 'Rest day' : `${cap(log.lifestyle.workout)} workout`);
  for (const m of log.lifestyle.medications) out.push(m);
  return out;
}

function DaySummary({ log, label, onEdit, onBackToToday }: { log: DailyLog | undefined; label: string; onEdit: () => void; onBackToToday: () => void }) {
  const items = logSummary(log);
  return (
    <Card>
      <h2 className="mb-2 flex items-center gap-2 font-display text-lg text-ink">
        <NotebookPen size={18} className="text-rose-500" /> What you logged
      </h2>
      {items.length ? (
        <div className="flex flex-wrap gap-1.5">
          {items.map((t) => (
            <span key={t} className="rounded-full bg-blush-100 px-2.5 py-1 text-sm text-rose-700">
              {t}
            </span>
          ))}
        </div>
      ) : (
        <p className="text-sm text-ink-soft">Nothing was logged {label === 'Yesterday' ? 'yesterday' : 'on this day'}. You can still add it now.</p>
      )}
      {log?.note && <p className="mt-3 whitespace-pre-line rounded-xl bg-cream-200 p-2.5 text-sm text-ink">{log.note}</p>}
      <div className="mt-3 grid grid-cols-2 gap-2">
        <Button variant="soft" onClick={onEdit}>
          Add details
        </Button>
        <Button variant="ghost" onClick={onBackToToday}>
          Back to today
        </Button>
      </div>
    </Card>
  );
}

/* ------------------------------------------------------------------ */
/* Cycle hero ring                                                      */
/* ------------------------------------------------------------------ */

function CycleHero({ status, prediction, past = false }: { status: CycleStatus; prediction: Prediction | null; past?: boolean }) {
  const length = prediction ? Math.round(prediction.averageCycleLength) : 28;
  const day = status.cycleDay ?? 0;
  const progress = Math.min(1, day / length);
  const R = 52;
  const C = 2 * Math.PI * R;
  const phase = status.phase ? PHASE_COPY[status.phase].name : past ? 'No cycle data' : 'Getting started';

  let headline: string;
  if (past) headline = status.cycleDay === null ? 'Before your first logged period' : status.onPeriod ? `Period day ${day}` : `Cycle day ${day}`;
  else if (!prediction || status.daysUntilNextPeriod === null) headline = 'Log a period to begin';
  else if (prediction.isLate) headline = `${prediction.daysLate} ${prediction.daysLate === 1 ? 'day' : 'days'} late`;
  else if (status.onPeriod) headline = `Period day ${day}`;
  else if (status.daysUntilNextPeriod <= 0) headline = 'Period expected today';
  else headline = `Period ${relativeDays(status.daysUntilNextPeriod)}`;

  const ringColor = status.onPeriod ? '#E07A7F' : status.inFertileWindow ? '#7FB8A4' : '#EFA57D';

  return (
    <Card className="flex items-center gap-5 bg-gradient-to-br from-white/90 to-blush-100/80">
      <div className="relative h-32 w-32 shrink-0">
        <svg viewBox="0 0 120 120" className="h-full w-full -rotate-90" aria-hidden>
          <circle cx="60" cy="60" r={R} fill="none" stroke="#F9D9D7" strokeWidth="10" />
          <circle
            cx="60"
            cy="60"
            r={R}
            fill="none"
            stroke={ringColor}
            strokeWidth="10"
            strokeLinecap="round"
            strokeDasharray={C}
            strokeDashoffset={C * (1 - progress)}
            style={{ transition: 'stroke-dashoffset 0.8s cubic-bezier(0.22,1,0.36,1)' }}
          />
        </svg>
        <div className="absolute inset-0 grid place-items-center text-center">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-wider text-ink-faint">Day</p>
            <p className="font-display text-4xl leading-none text-ink">{status.cycleDay ?? '–'}</p>
            <p className="mt-0.5 text-[11px] text-ink-faint">of ~{length}</p>
          </div>
        </div>
      </div>
      <div className="min-w-0">
        <p className="text-sm font-semibold text-rose-600">{phase}</p>
        <p className="font-display text-2xl leading-tight text-ink">{headline}</p>
        {status.inFertileWindow && (
          <p className="mt-1.5 inline-flex items-center gap-1 rounded-full bg-sage-100 px-2.5 py-1 text-xs font-medium text-sage-600">
            <Sparkles size={12} /> Fertile window
          </p>
        )}
      </div>
    </Card>
  );
}

/* ------------------------------------------------------------------ */
/* AI daily insight                                                     */
/* ------------------------------------------------------------------ */

const PHASE_TINT: Record<string, string> = {
  menstrual: 'from-blush-200/70 to-white/90',
  follicular: 'from-peach-100 to-white/90',
  ovulatory: 'from-sage-100 to-white/90',
  luteal: 'from-lilac-100 to-white/90',
};

function InsightCard({ insight }: { insight: Insight }) {
  return (
    <Card className={cx('animate-fade-up bg-gradient-to-br', PHASE_TINT[insight.phase ?? 'menstrual'])}>
      <div className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-rose-600">
        <Sparkles size={14} /> Daily insight
      </div>
      <h2 className="font-display text-xl text-ink">{insight.title}</h2>
      <p className="mt-1.5 text-[15px] leading-relaxed text-ink-soft">{insight.body}</p>
      {insight.pattern && (
        <p className="mt-3 flex gap-2 rounded-xl bg-white/70 p-2.5 text-sm text-ink">
          <TrendingUp size={16} className="mt-0.5 shrink-0 text-rose-500" />
          {insight.pattern}
        </p>
      )}
    </Card>
  );
}

/* ------------------------------------------------------------------ */
/* Rolling 2-month predictions                                          */
/* ------------------------------------------------------------------ */

const CONF_STYLE = {
  high: 'bg-sage-100 text-sage-600',
  medium: 'bg-peach-100 text-ink',
  low: 'bg-blush-100 text-rose-600',
} as const;

function PredictionCard({ prediction, today }: { prediction: Prediction; today: ISODate }) {
  const rows = [
    { month: monthLabel(today), cycle: prediction.currentMonth, logged: prediction.currentMonthLogged },
    { month: monthLabel(addMonths(today, 1)), cycle: prediction.nextMonth, logged: null },
  ];
  return (
    <Card>
      <div className="mb-3 flex items-center justify-between">
        <h2 className="flex items-center gap-2 font-display text-lg text-ink">
          <CalendarDays size={18} className="text-rose-500" /> Predictions
        </h2>
        <span className={cx('rounded-full px-2.5 py-1 text-xs font-semibold first-letter:uppercase', CONF_STYLE[prediction.confidence])}>
          {prediction.confidence} confidence
        </span>
      </div>
      <div className="grid grid-cols-2 gap-2">
        {rows.map(({ month, cycle, logged }) => (
          <div key={month} className="rounded-xl bg-cream-100 p-3 ring-1 ring-blush-200/70">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-ink-faint">{month.split(' ')[0]}</p>
            {cycle ? (
              <>
                <p className="mt-0.5 font-display text-lg leading-snug text-ink">{formatRange(cycle.periodStart, cycle.periodEnd)}</p>
                <p className="text-xs text-ink-soft">±{cycle.uncertaintyDays}d · ovulation ~{formatDay(cycle.ovulation)}</p>
              </>
            ) : logged ? (
              <>
                <p className="mt-0.5 font-display text-lg leading-snug text-ink">{formatRange(logged.startDate, logged.endDate)}</p>
                <p className="text-xs text-ink-soft">{logged.ongoing ? 'In progress' : 'Logged'}</p>
              </>
            ) : (
              <p className="mt-0.5 text-sm text-ink-soft">No period expected</p>
            )}
          </div>
        ))}
      </div>
      <p className="mt-3 flex gap-2 text-sm text-ink-soft">
        <Target size={16} className="mt-0.5 shrink-0 text-sage-600" />
        {prediction.confidenceReason}
      </p>
      <details className="mt-2 text-sm text-ink-soft">
        <summary className="flex cursor-pointer list-none items-center gap-1.5 text-xs font-semibold text-ink-faint">
          <Info size={13} /> How this is calculated
        </summary>
        <p className="mt-1.5 text-xs leading-relaxed">
          Average cycle {prediction.averageCycleLength} days (±{prediction.variability}), period {prediction.averagePeriodLength} days, learned from{' '}
          {prediction.cyclesUsed} logged {prediction.cyclesUsed === 1 ? 'cycle' : 'cycles'} and blended with your typical settings. Recent cycles count more, and the
          window widens for your age range and for cycles further out. Ovulation is estimated at about 14 days before each period.
        </p>
      </details>
    </Card>
  );
}
