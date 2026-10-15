/**
 * Day metrics: Fatigue, Sleep, Water and Stress.
 *
 * One scoring model shared by the "Day at a glance" card on the Home tab and
 * the native home-screen widget, so both always agree.
 *
 * Each metric has:
 *   fill  0–1   how far round its ring goes
 *   tone        good | ok | alert | none (not logged) — always paired with a text value
 */
import type { CycleStatus, DailyLog, Demographics, ISODate } from '../types';
import { addDays } from './dates';
import { sleepTarget, waterTarget } from './suggestions';
import { PHASE_COPY } from './insightEngine';

export type MetricKey = 'fatigue' | 'sleep' | 'water' | 'stress';
export type MetricTone = 'good' | 'ok' | 'alert' | 'none';

export interface DayMetric {
  key: MetricKey;
  label: string;
  /** Big value shown inside or under the ring, e.g. "7.5h", "5/9", "Mild". */
  value: string;
  /** Compact value that fits inside a small widget ring, e.g. "Med" for Medium. */
  short: string;
  /** Short context line, e.g. "Goal 8h". */
  detail: string;
  fill: number;
  tone: MetricTone;
}

const LEVEL3 = { none: 0, mild: 1, moderate: 2, severe: 3 } as const;
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const fmtHours = (h: number) => (Number.isInteger(h) ? `${h}h` : `${h.toFixed(1).replace(/\.0$/, '')}h`);

export function dayMetrics(args: {
  date: ISODate;
  log: DailyLog | undefined;
  logs: Record<ISODate, DailyLog>;
  profile: Demographics;
  status: CycleStatus;
}): DayMetric[] {
  const { date, log, logs, profile, status } = args;
  const recent = [1, 2, 3].map((n) => logs[addDays(date, -n)]).filter((l): l is DailyLog => !!l);

  /* Sleep — hours vs personal target */
  const sleepGoal = sleepTarget(profile, status, recent);
  const hours = log?.lifestyle.sleepHours;
  type Draft = Omit<DayMetric, 'short'>;
  const sleep: Draft =
    hours === undefined
      ? { key: 'sleep', label: 'Sleep', value: '—', detail: `Goal ${fmtHours(sleepGoal)}`, fill: 0, tone: 'none' }
      : {
          key: 'sleep',
          label: 'Sleep',
          value: fmtHours(hours),
          detail: `Goal ${fmtHours(sleepGoal)}`,
          fill: Math.min(1, hours / sleepGoal),
          tone: hours >= sleepGoal - 0.5 ? 'good' : hours >= sleepGoal - 1.5 ? 'ok' : 'alert',
        };

  /* Water — glasses vs daily goal */
  const waterGoal = waterTarget(status, log);
  const glasses = log?.lifestyle.waterGlasses;
  const water: Draft =
    glasses === undefined
      ? { key: 'water', label: 'Water', value: '—', detail: `Goal ${waterGoal}`, fill: 0, tone: 'none' }
      : {
          key: 'water',
          label: 'Water',
          value: `${glasses}/${waterGoal}`,
          detail: glasses >= waterGoal ? 'Goal reached' : `${waterGoal - glasses} to go`,
          fill: Math.min(1, glasses / waterGoal),
          tone: glasses >= waterGoal ? 'good' : glasses >= waterGoal * 0.6 ? 'ok' : 'alert',
        };

  /* Fatigue — severity (a fuller ring means more tired) */
  const f = log?.symptoms.fatigue ?? (log?.symptoms.feelingFine ? 'none' : undefined);
  const fatigue: Draft =
    f === undefined
      ? { key: 'fatigue', label: 'Fatigue', value: '—', detail: 'Not logged', fill: 0, tone: 'none' }
      : {
          key: 'fatigue',
          label: 'Fatigue',
          value: f === 'none' ? 'None' : cap(f),
          detail: f === 'none' ? 'Full of energy' : f === 'mild' ? 'A little tired' : f === 'moderate' ? 'Take it easy' : 'Rest today',
          fill: LEVEL3[f] / 3,
          tone: f === 'none' ? 'good' : f === 'mild' ? 'ok' : 'alert',
        };

  /* Stress — low / medium / high */
  const s = log?.lifestyle.stress;
  const stress: Draft =
    s === undefined
      ? { key: 'stress', label: 'Stress', value: '—', detail: 'Not logged', fill: 0, tone: 'none' }
      : {
          key: 'stress',
          label: 'Stress',
          value: cap(s),
          detail: s === 'low' ? 'Nice and calm' : s === 'medium' ? 'Manageable' : 'Time to unwind',
          fill: s === 'low' ? 1 / 3 : s === 'medium' ? 2 / 3 : 1,
          tone: s === 'low' ? 'good' : s === 'medium' ? 'ok' : 'alert',
        };

  const SHORT: Record<string, string> = { Moderate: 'Mod', Medium: 'Med' };
  return [fatigue, sleep, water, stress].map((m) => ({ ...m, short: SHORT[m.value] ?? m.value }));
}

/* ------------------------------------------------------------------ */
/* Widget snapshot — the small JSON the native widget reads              */
/* ------------------------------------------------------------------ */

export interface WidgetSnapshot {
  v: 1;
  /** Day the metrics describe. The widget shows empty rings once this is in the past. */
  date: ISODate;
  updatedAt: number;
  /** Only present if the user opted in to showing cycle info on the home screen. */
  cycle: { day: number; phase: string } | null;
  metrics: Pick<DayMetric, 'key' | 'label' | 'value' | 'short' | 'detail' | 'fill' | 'tone'>[];
}

export function buildWidgetSnapshot(args: {
  today: ISODate;
  logs: Record<ISODate, DailyLog>;
  profile: Demographics;
  status: CycleStatus;
  showCycle: boolean;
}): WidgetSnapshot {
  const { today, logs, profile, status, showCycle } = args;
  return {
    v: 1,
    date: today,
    updatedAt: Date.now(),
    cycle: showCycle && status.cycleDay && status.phase ? { day: status.cycleDay, phase: PHASE_COPY[status.phase].name } : null,
    metrics: dayMetrics({ date: today, log: logs[today], logs, profile, status }).map(({ key, label, value, short, detail, fill, tone }) => ({
      key,
      label,
      value,
      short,
      detail,
      fill: Math.round(fill * 100) / 100,
      tone,
    })),
  };
}
