import { useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import type { DailyLog, ISODate, Prediction } from '../types';
import { addMonths, monthGrid, monthLabel, parseISO, startOfMonth } from '../lib/dates';
import { classifyDay, type DayKind } from '../lib/predictionEngine';
import { Card, cx } from './ui';

const WEEKDAYS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

const KIND_STYLE: Record<Exclude<DayKind, null>, string> = {
  period: 'bg-rose-400 text-white font-semibold',
  predicted: 'bg-blush-100 text-rose-600 border border-dashed border-rose-300',
  fertile: 'bg-sage-100 text-sage-600',
  ovulation: 'bg-sage-400 text-white font-semibold',
};

const KIND_LABEL: Record<Exclude<DayKind, null>, string> = {
  period: 'period',
  predicted: 'predicted period',
  fertile: 'fertile window',
  ovulation: 'estimated ovulation',
};

interface Props {
  today: ISODate;
  prediction: Prediction | null;
  periodDays: ISODate[];
  logs: Record<ISODate, DailyLog>;
  /** Day currently shown on Home, highlighted in the calendar. */
  selected?: ISODate;
  onSelectDay: (day: ISODate) => void;
}

/** Two stacked months (current + next by default) with paging. */
export default function CycleCalendar({ today, prediction, periodDays, logs, selected, onSelectDay }: Props) {
  const [offset, setOffset] = useState(0);
  const periodSet = useMemo(() => new Set(periodDays), [periodDays]);
  const months = [addMonths(today, offset), addMonths(today, offset + 1)];

  return (
    <Card className="px-3">
      <div className="mb-1 flex items-center justify-between px-1">
        <h2 className="font-display text-lg text-ink">Calendar</h2>
        <div className="flex gap-1">
          <button aria-label="Previous month" onClick={() => setOffset((o) => o - 1)} className="grid h-9 w-9 place-items-center rounded-full text-ink-soft hover:bg-blush-100">
            <ChevronLeft size={18} />
          </button>
          {offset !== 0 && (
            <button onClick={() => setOffset(0)} className="rounded-full px-3 text-xs font-semibold text-rose-600 hover:bg-blush-100">
              Today
            </button>
          )}
          <button
            aria-label="Next month"
            onClick={() => setOffset((o) => Math.min(o + 1, 1))}
            disabled={offset >= 1}
            className="grid h-9 w-9 place-items-center rounded-full text-ink-soft hover:bg-blush-100 disabled:opacity-30"
          >
            <ChevronRight size={18} />
          </button>
        </div>
      </div>

      {months.map((m) => (
        <MonthGrid key={m} month={startOfMonth(m)} today={today} prediction={prediction} periodSet={periodSet} logs={logs} selected={selected} onSelectDay={onSelectDay} />
      ))}

      <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1.5 px-1 text-xs text-ink-soft">
        <Legend className="bg-rose-400" label="Period" />
        <Legend className="border border-dashed border-rose-300 bg-blush-100" label="Predicted" />
        <Legend className="bg-sage-100 ring-1 ring-sage-200" label="Fertile" />
        <Legend className="bg-sage-400" label="Ovulation" />
        <span className="flex items-center gap-1.5">
          <span className="h-1.5 w-1.5 rounded-full bg-peach-400" /> Logged
        </span>
      </div>
    </Card>
  );
}

function Legend({ className, label }: { className: string; label: string }) {
  return (
    <span className="flex items-center gap-1.5">
      <span className={cx('h-3 w-3 rounded-full', className)} /> {label}
    </span>
  );
}

function MonthGrid({
  month,
  today,
  prediction,
  periodSet,
  logs,
  selected,
  onSelectDay,
}: {
  month: ISODate;
  today: ISODate;
  prediction: Prediction | null;
  periodSet: Set<ISODate>;
  logs: Record<ISODate, DailyLog>;
  selected?: ISODate;
  onSelectDay: (d: ISODate) => void;
}) {
  const cells = monthGrid(month);
  return (
    <div className="mt-3">
      <p className="mb-1.5 px-1 text-sm font-semibold text-ink">{monthLabel(month)}</p>
      <div className="grid grid-cols-7 text-center text-[11px] font-medium text-ink-faint">
        {WEEKDAYS.map((d, i) => (
          <span key={i} className="pb-1">
            {d}
          </span>
        ))}
      </div>
      <div className="grid grid-cols-7 gap-y-1" role="grid">
        {cells.map((day, i) => {
          if (!day) return <span key={i} />;
          const kind = classifyDay(day, prediction, periodSet, today);
          const isToday = day === today;
          const future = day > today;
          const hasLog = !!logs[day] && (logs[day].symptoms.moods.length > 0 || !!logs[day].symptoms.cramps || !!logs[day].symptoms.headache || !!logs[day].note);
          const label = `${parseISO(day).toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })}${kind ? `, ${KIND_LABEL[kind]}` : ''}${isToday ? ', today' : ''}${selected === day ? ', selected' : ''}`;
          return (
            <button
              key={day}
              role="gridcell"
              aria-label={label}
              disabled={future}
              onClick={() => onSelectDay(day)}
              className="group relative mx-auto grid h-10 w-10 place-items-center disabled:cursor-default"
            >
              <span
                className={cx(
                  'grid h-9 w-9 place-items-center rounded-full text-sm transition group-active:scale-90',
                  kind ? KIND_STYLE[kind] : future ? 'text-ink-faint' : 'text-ink hover:bg-blush-100',
                  isToday && 'outline outline-2 outline-offset-1 outline-ink',
                  selected === day && !isToday && 'outline outline-2 outline-offset-1 outline-rose-500',
                )}
              >
                {parseISO(day).getDate()}
              </span>
              {hasLog && <span className="absolute bottom-0 h-1.5 w-1.5 rounded-full bg-peach-400" />}
            </button>
          );
        })}
      </div>
    </div>
  );
}
