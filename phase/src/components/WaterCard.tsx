import { BellRing, GlassWater, Minus, Plus } from 'lucide-react';
import type { DailyLog, ISODate } from '../types';
import { saveLog } from '../lib/store';
import { cx } from './ui';

/**
 * Water intake on Today: add a glass with one tap, see progress toward the
 * day's goal, and when the next hourly reminder is due.
 */
export type WaterReminderState = 'on' | 'category-off' | 'notifications-off';

const timeLabel = (ms: number) => {
  const d = new Date(ms);
  const sameDay = d.toDateString() === new Date().toDateString();
  const time = d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  return sameDay ? `at ${time}` : `tomorrow at ${time}`;
};

export default function WaterCard({
  date,
  isToday,
  log,
  goal,
  reminders,
  nextReminder,
  onOpenSettings,
}: {
  date: ISODate;
  isToday: boolean;
  log: DailyLog | undefined;
  goal: number;
  reminders: WaterReminderState;
  nextReminder: number | null;
  onOpenSettings: () => void;
}) {
  const glasses = log?.lifestyle.waterGlasses ?? 0;
  const reached = glasses >= goal;
  const pct = Math.min(100, Math.round((glasses / goal) * 100));

  const change = (delta: number) =>
    saveLog(date, (prev) => {
      const next = Math.max(0, Math.min(30, (prev.lifestyle.waterGlasses ?? 0) + delta));
      return {
        ...prev,
        lifestyle: {
          ...prev.lifestyle,
          waterGlasses: next,
          // Only a new glass today pauses the next reminder.
          ...(delta > 0 && isToday ? { waterLoggedAt: Date.now() } : {}),
        },
      };
    });

  let reminderLine: { text: string; action?: string } | null = null;
  if (isToday) {
    if (reminders === 'notifications-off') reminderLine = { text: 'Want a nudge every hour?', action: 'Turn on reminders' };
    else if (reminders === 'category-off') reminderLine = { text: 'Hourly water reminders are off.', action: 'Settings' };
    else if (reached) reminderLine = { text: 'Goal reached. Reminders pick up again tomorrow.' };
    else if (nextReminder) reminderLine = { text: `Next reminder ${timeLabel(nextReminder)}` };
  }

  return (
    <section className="space-y-3 rounded-2xl bg-white/80 p-4 shadow-soft ring-1 ring-blush-200/60" aria-label="Water intake">
      <div className="flex items-center gap-3">
        <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-sky-50 text-sky-600">
          <GlassWater size={22} />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-xs font-semibold uppercase tracking-wide text-ink-faint">Water</p>
          <p className="font-display text-xl leading-tight text-ink">
            {glasses} <span className="text-base text-ink-soft">of {goal} glasses</span>
          </p>
        </div>
        <button
          onClick={() => change(-1)}
          disabled={glasses === 0}
          aria-label="Remove a glass"
          className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-white text-ink-soft shadow-soft ring-1 ring-blush-200 transition active:scale-90 disabled:opacity-40"
        >
          <Minus size={18} />
        </button>
        <button
          onClick={() => change(1)}
          aria-label="Add a glass of water"
          className="flex h-11 shrink-0 items-center gap-1.5 rounded-full bg-sky-500 px-4 text-sm font-semibold text-white shadow-lift transition active:scale-95"
        >
          <Plus size={18} /> Glass
        </button>
      </div>

      <div
        className="h-2.5 overflow-hidden rounded-full bg-sky-50"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={goal}
        aria-valuenow={Math.min(glasses, goal)}
        aria-label="Water goal progress"
      >
        <div className={cx('h-full rounded-full transition-all duration-500', reached ? 'bg-sage-400' : 'bg-sky-400')} style={{ width: `${pct}%` }} />
      </div>

      {reminderLine && (
        <p className="flex items-center gap-2 text-sm text-ink-soft">
          <BellRing size={15} className="shrink-0 text-sky-500" />
          <span className="flex-1">{reminderLine.text}</span>
          {reminderLine.action && (
            <button onClick={onOpenSettings} className="shrink-0 rounded-lg px-2 py-1 text-sm font-semibold text-rose-600 hover:bg-blush-100">
              {reminderLine.action}
            </button>
          )}
        </p>
      )}
    </section>
  );
}
