import { describe, expect, it } from 'vitest';
import { buildWidgetSnapshot, dayMetrics } from '../lib/dayMetrics';
import { blankLog } from '../lib/store';
import { syncWidget, widgetsSupported } from '../lib/widgetBridge';
import { logSummary } from '../components/Dashboard';
import type { CycleStatus, DailyLog, Demographics } from '../types';

const today = '2026-10-12';
const profile: Demographics = { age: 29, primaryGoal: 'track_period', typicalCycleLength: 28, typicalPeriodLength: 5 };
const status: CycleStatus = { cycleDay: 10, phase: 'follicular', daysUntilNextPeriod: 19, onPeriod: false, inFertileWindow: false };
const log = (sym: Partial<DailyLog['symptoms']>, life: Partial<DailyLog['lifestyle']>): DailyLog => ({
  ...blankLog(today),
  symptoms: { moods: [], ...sym },
  lifestyle: { medications: [], ...life },
});

describe('day metrics (Fatigue, Sleep, Water, Stress)', () => {
  it('scores a logged day', () => {
    const l = log({ fatigue: 'mild' }, { sleepHours: 7.5, waterGlasses: 5, stress: 'high' });
    const [fatigue, sleep, water, stress] = dayMetrics({ date: today, log: l, logs: { [today]: l }, profile, status });
    expect(fatigue).toMatchObject({ value: 'Mild', tone: 'ok' });
    expect(sleep).toMatchObject({ value: '7.5h', detail: 'Goal 8h', tone: 'good' });
    expect(sleep.fill).toBeCloseTo(0.94, 2);
    expect(water).toMatchObject({ value: '5/8', detail: '3 to go', tone: 'ok' });
    expect(stress).toMatchObject({ value: 'High', fill: 1, tone: 'alert' });
  });

  it('shows empty rings for an unlogged day', () => {
    const m = dayMetrics({ date: today, log: undefined, logs: {}, profile, status });
    expect(m.every((x) => x.tone === 'none' && x.value === '—' && x.fill === 0)).toBe(true);
  });

  it('"everything is fine" counts as no fatigue', () => {
    const l = log({ feelingFine: true }, {});
    expect(dayMetrics({ date: today, log: l, logs: {}, profile, status })[0]).toMatchObject({ value: 'None', tone: 'good' });
  });
});

describe('widget snapshot', () => {
  it('hides cycle info unless the user opts in', () => {
    const logs = { [today]: log({}, { sleepHours: 8 }) };
    expect(buildWidgetSnapshot({ today, logs, profile, status, showCycle: false }).cycle).toBeNull();
    const snap = buildWidgetSnapshot({ today, logs, profile, status, showCycle: true });
    expect(snap.cycle).toEqual({ day: 10, phase: 'Follicular phase' });
    expect(snap.metrics.map((m) => m.key)).toEqual(['fatigue', 'sleep', 'water', 'stress']);
    expect(JSON.parse(JSON.stringify(snap))).toEqual(snap); // plain JSON for the native side
  });

  it('bridge is a no-op in the browser', async () => {
    expect(widgetsSupported()).toBe(false);
    await expect(syncWidget(null)).resolves.toBeUndefined();
  });
});

describe('past-day summary', () => {
  it('lists what was logged in plain words', () => {
    const l: DailyLog = {
      ...log({ cramps: 'severe', moods: ['sad'], discharge: 'egg_white', bloating: true }, { workout: 'rest', medications: ['Ibuprofen'] }),
      cycle: { isPeriodDay: true, flow: 'heavy' },
    };
    expect(logSummary(l)).toEqual(['Period · Heavy flow', 'Severe cramps', 'Sad', 'Bloating', 'Egg white discharge', 'Rest day', 'Ibuprofen']);
  });
});
