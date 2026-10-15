import { describe, expect, it } from 'vitest';
import { addDays, diffDays } from '../lib/dates';
import { classifyDay, derivePeriods, getCycleStatus, observedCycleLengths, predict } from '../lib/predictionEngine';
import type { Demographics } from '../types';

const profile: Demographics = { age: 28, primaryGoal: 'track_period', typicalCycleLength: 28, typicalPeriodLength: 5 };
const span = (start: string, n: number) => Array.from({ length: n }, (_, i) => addDays(start, i));

describe('derivePeriods', () => {
  it('groups consecutive days and bridges a one-day gap', () => {
    const days = ['2026-09-01', '2026-09-02', '2026-09-04', '2026-09-29', '2026-09-30'];
    const p = derivePeriods(days, '2026-10-11');
    expect(p).toHaveLength(2);
    expect(p[0]).toMatchObject({ startDate: '2026-09-01', endDate: '2026-09-04' });
    expect(p[1].ongoing).toBe(false);
  });

  it('flags an ongoing period', () => {
    const p = derivePeriods(span('2026-10-09', 3), '2026-10-11');
    expect(p[0].ongoing).toBe(true);
  });
});

describe('predict — onboarding (single period)', () => {
  const today = '2026-10-11';
  const pred = predict({ profile, periodDays: span('2026-10-03', 5), today });

  it('uses the baseline when there is no history', () => {
    expect(pred.averageCycleLength).toBe(28);
    expect(pred.cyclesUsed).toBe(0);
    expect(pred.confidence).toBe('low');
  });

  it('forecasts the current and next month', () => {
    expect(pred.currentMonth?.periodStart).toBe('2026-10-31');
    expect(pred.nextMonth?.periodStart).toBe('2026-11-28');
    expect(pred.currentMonthLogged?.startDate).toBe('2026-10-03');
  });

  it('places ovulation ~14 days before the period with a 7-day fertile window', () => {
    const c = pred.cycles[0];
    expect(diffDays(c.periodStart, c.ovulation)).toBe(14);
    expect(diffDays(c.fertileEnd, c.fertileStart)).toBe(6);
  });
});

describe('predict — learning from history', () => {
  const today = '2026-10-11';
  // Regular 30-day cycles.
  const starts = ['2026-06-15', '2026-07-15', '2026-08-14', '2026-09-13'];
  const days = starts.flatMap((s) => span(s, 4));

  it('moves toward the observed cycle length and gains confidence', () => {
    const p = predict({ profile, periodDays: days, today });
    expect(p.cyclesUsed).toBe(3);
    expect(p.averageCycleLength).toBeGreaterThan(29);
    expect(p.averageCycleLength).toBeLessThanOrEqual(30);
    expect(p.confidence).toBe('high');
    expect(p.confidenceReason).toMatch(/last 3 cycles/);
    expect(p.averagePeriodLength).toBeLessThan(5);
  });

  it('re-indexes immediately when a new period is logged', () => {
    const before = predict({ profile, periodDays: days, today });
    const after = predict({ profile, periodDays: [...days, ...span('2026-10-10', 2)], today });
    expect(after.lastPeriod?.startDate).toBe('2026-10-10');
    expect(after.cycles[0].periodStart > before.cycles[0].periodStart).toBe(true);
  });

  it('ignores implausible gaps (missed logs)', () => {
    expect(observedCycleLengths(derivePeriods([...span('2026-01-01', 4), ...span('2026-05-01', 4)], today))).toEqual([]);
  });

  it('drops a single outlier among regular cycles', () => {
    const s = ['2026-01-01', '2026-01-29', '2026-02-26', '2026-03-26', '2026-05-15', '2026-06-12'];
    const lens = observedCycleLengths(derivePeriods(s.flatMap((x) => span(x, 3)), today));
    expect(lens).not.toContain(50);
  });
});

describe('predict — irregular cycles and age', () => {
  it('reports lower confidence for irregular cycles', () => {
    const starts = ['2026-05-01', '2026-05-24', '2026-07-02', '2026-07-28', '2026-09-05'];
    const p = predict({ profile, periodDays: starts.flatMap((s) => span(s, 4)), today: '2026-09-20' });
    expect(p.confidence).not.toBe('high');
    expect(p.variability).toBeGreaterThan(4);
  });

  it('widens the window for teens and 40+', () => {
    const days = span('2026-10-03', 5);
    const adult = predict({ profile, periodDays: days, today: '2026-10-11' });
    const teen = predict({ profile: { ...profile, age: 16 }, periodDays: days, today: '2026-10-11' });
    const peri = predict({ profile: { ...profile, age: 46 }, periodDays: days, today: '2026-10-11' });
    expect(teen.cycles[0].uncertaintyDays).toBeGreaterThan(adult.cycles[0].uncertaintyDays);
    expect(peri.cycles[0].uncertaintyDays).toBeGreaterThan(adult.cycles[0].uncertaintyDays);
    expect(teen.confidenceReason).toMatch(/vary more at your age/);
  });
});

describe('late periods', () => {
  it('marks the period late and moves the next expected start to today', () => {
    const p = predict({ profile, periodDays: span('2026-09-01', 5), today: '2026-10-03' });
    expect(p.isLate).toBe(true);
    expect(p.daysLate).toBe(4);
    expect(p.cycles[0].periodStart).toBe('2026-10-03');
  });
});

describe('getCycleStatus & classifyDay', () => {
  const periodDays = span('2026-10-01', 5);
  const pred = predict({ profile, periodDays, today: '2026-10-03' });

  it('knows the cycle day and menstrual phase', () => {
    const s = getCycleStatus(pred, periodDays, '2026-10-03');
    expect(s.cycleDay).toBe(3);
    expect(s.phase).toBe('menstrual');
    expect(s.onPeriod).toBe(true);
  });

  it('moves through follicular → ovulatory → luteal', () => {
    const at = (d: string) => getCycleStatus(predict({ profile, periodDays, today: d }), periodDays, d).phase;
    expect(at('2026-10-08')).toBe('follicular');
    expect(at('2026-10-15')).toBe('ovulatory'); // ovulation ~Oct 15
    expect(at('2026-10-22')).toBe('luteal');
  });

  it('classifies calendar days, with logged data winning', () => {
    const set = new Set(periodDays);
    expect(classifyDay('2026-10-02', pred, set, '2026-10-03')).toBe('period');
    expect(classifyDay('2026-10-15', pred, set, '2026-10-03')).toBe('ovulation');
    expect(classifyDay('2026-10-12', pred, set, '2026-10-03')).toBe('fertile');
    expect(classifyDay('2026-10-30', pred, set, '2026-10-03')).toBe('predicted');
  });
});
