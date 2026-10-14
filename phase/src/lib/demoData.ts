/**
 * Realistic sample data (≈6 cycles) for development, demos and tests.
 * Load it in dev builds with /?demo=1 — never shipped into a real account
 * unless explicitly requested from Settings in development.
 */
import type { AppData, DailyLog, Demographics, ISODate, Mood } from '../types';
import { addDays } from './dates';
import { emptyData } from './storage';

function rng(seed: number) {
  return () => {
    seed = (seed * 1664525 + 1013904223) % 4294967296;
    return seed / 4294967296;
  };
}

export function buildDemoData(today: ISODate, profile?: Partial<Demographics>): AppData {
  const rand = rng(42);
  const lengths = [29, 28, 31, 27, 30, 29];
  const total = lengths.reduce((a, b) => a + b, 0);
  let start = addDays(today, -(total + 9));
  const periodDays: ISODate[] = [];
  const logs: Record<ISODate, DailyLog> = {};

  const starts: ISODate[] = [];
  for (const len of [...lengths, 40]) {
    starts.push(start);
    start = addDays(start, len);
  }

  starts.forEach((s, ci) => {
    const len = lengths[ci] ?? 30;
    for (let d = 0; d < len; d++) {
      const date = addDays(s, d);
      if (date > today) return;
      const day = d + 1;
      const onPeriod = day <= 5;
      const ov = len - 14;
      const luteal = day > ov + 1;
      const late = len - day <= 4;
      if (onPeriod) periodDays.push(date);
      if (rand() < 0.15 && !onPeriod) continue; // some days unlogged

      const moods: Mood[] = [];
      if (late && rand() < 0.7) moods.push(rand() < 0.5 ? 'irritable' : 'anxious');
      if (day > 6 && day < ov + 2 && rand() < 0.6) moods.push('energetic');
      if (!moods.length && rand() < 0.5) moods.push('calm');
      if (onPeriod && day <= 2 && rand() < 0.4) moods.push('sad');

      logs[date] = {
        date,
        cycle: { isPeriodDay: onPeriod, flow: onPeriod ? (day === 2 ? 'heavy' : day <= 3 ? 'medium' : 'light') : undefined },
        symptoms: {
          moods,
          cramps: onPeriod ? (day === 1 ? (ci % 2 === 0 ? 'severe' : 'moderate') : day <= 3 ? 'mild' : 'none') : undefined,
          headache: late && rand() < 0.5 ? 'dull' : undefined,
          fatigue: onPeriod && day <= 2 ? 'moderate' : late && rand() < 0.4 ? 'mild' : undefined,
          acne: late && rand() < 0.5 ? 'mild' : undefined,
          bloating: late && rand() < 0.6,
          tenderBreasts: luteal && late && rand() < 0.5,
          cravings: late && rand() < 0.5,
          discharge: day >= ov - 2 && day <= ov ? 'egg_white' : day > 6 && day < ov - 2 ? 'creamy' : luteal ? 'sticky' : undefined,
          bbt: Math.round((36.3 + (luteal ? 0.32 : 0) + (rand() - 0.5) * 0.12) * 100) / 100,
        },
        lifestyle: {
          sleepHours: Math.round((6.3 + rand() * 2.4) * 2) / 2,
          waterGlasses: Math.round(4 + rand() * 5),
          stress: rand() < 0.2 ? 'high' : rand() < 0.5 ? 'medium' : 'low',
          workout: rand() < 0.3 ? 'rest' : rand() < 0.6 ? 'light' : rand() < 0.85 ? 'moderate' : 'intense',
          medications: onPeriod && day === 1 ? ['Ibuprofen'] : [],
        },
        updatedAt: Date.now(),
      };
    }
  });

  return {
    ...emptyData(),
    profile: { age: 29, primaryGoal: 'understand_symptoms', typicalCycleLength: 28, typicalPeriodLength: 5, ...profile },
    periodDays,
    logs,
  };
}
