import { useRef } from 'react';
import { CalendarDays, ChevronLeft, ChevronRight } from 'lucide-react';
import type { ISODate } from '../types';
import { addDays, diffDays, formatDay } from '../lib/dates';
import { cx } from './ui';

/**
 * Day switcher for the top of Home: ‹ Today › with a tap-to-pick date.
 * Swiping left/right on the page also moves between days (see useDaySwipe).
 */
export function dayLabel(date: ISODate, today: ISODate) {
  const d = diffDays(today, date);
  if (d === 0) return 'Today';
  if (d === 1) return 'Yesterday';
  return formatDay(date, { weekday: 'short', month: 'short', day: 'numeric' });
}

export default function DateNav({ date, today, earliest, onChange }: { date: ISODate; today: ISODate; earliest?: ISODate; onChange: (d: ISODate) => void }) {
  const picker = useRef<HTMLInputElement>(null);
  const atToday = date >= today;
  const atStart = !!earliest && date <= earliest;

  const openPicker = () => {
    const el = picker.current;
    if (!el) return;
    try {
      el.showPicker();
    } catch {
      el.focus();
      el.click();
    }
  };

  return (
    <div className="flex items-center justify-between rounded-2xl bg-white/80 p-1 shadow-soft ring-1 ring-blush-200/60">
      <button
        onClick={() => onChange(addDays(date, -1))}
        disabled={atStart}
        aria-label="Previous day"
        className="grid h-11 w-11 place-items-center rounded-xl text-ink-soft transition hover:bg-blush-100 active:scale-90 disabled:opacity-30"
      >
        <ChevronLeft size={22} />
      </button>

      <button onClick={openPicker} className="relative flex min-h-[44px] flex-1 flex-col items-center justify-center rounded-xl px-2" aria-label={`Showing ${dayLabel(date, today)}. Choose a date`}>
        <span className="flex items-center gap-1.5 text-[15px] font-bold uppercase tracking-wider text-ink">
          <CalendarDays size={15} className="text-rose-500" />
          {dayLabel(date, today)}
        </span>
        {!atToday && <span className="text-[11px] text-ink-faint">{formatDay(date, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}</span>}
        <input
          ref={picker}
          type="date"
          tabIndex={-1}
          aria-hidden
          className="pointer-events-none absolute inset-0 opacity-0"
          value={date}
          max={today}
          min={earliest}
          onChange={(e) => e.target.value && onChange(e.target.value > today ? today : e.target.value)}
        />
      </button>

      {atToday ? (
        <span className="h-11 w-11" />
      ) : (
        <button
          onClick={() => onChange(addDays(date, 1))}
          aria-label="Next day"
          className={cx('grid h-11 w-11 place-items-center rounded-xl text-ink-soft transition hover:bg-blush-100 active:scale-90')}
        >
          <ChevronRight size={22} />
        </button>
      )}
    </div>
  );
}
