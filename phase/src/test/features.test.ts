import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { buildDemoData } from '../lib/demoData';
import { cycleFindings, cycleHistory, cycleStats, dataInsights, phaseOn, symptomsByPhase } from '../lib/analytics';
import { generateSuggestions, sleepTarget, waterTarget } from '../lib/suggestions';
import { applySelection, combinedNotes, selectionFromLog, type CheckId } from '../lib/symptomGuide';
import { derivePeriods, getCycleStatus, predict } from '../lib/predictionEngine';
import { addDays } from '../lib/dates';
import { parseNaturalLog } from '../lib/nlParser';
import { blankLog } from '../lib/store';
import type { CycleStatus, DailyLog, Demographics } from '../types';

const today = '2026-10-11';
const profile: Demographics = { age: 29, primaryGoal: 'track_period', typicalCycleLength: 28, typicalPeriodLength: 5 };
const span = (s: string, n: number) => Array.from({ length: n }, (_, i) => addDays(s, i));
const status = (patch: Partial<CycleStatus>): CycleStatus => ({ cycleDay: 3, phase: 'menstrual', daysUntilNextPeriod: 25, onPeriod: true, inFertileWindow: false, ...patch });
const log = (date: string, p: Partial<DailyLog['symptoms']> = {}, l: Partial<DailyLog['lifestyle']> = {}): DailyLog => ({
  ...blankLog(date),
  symptoms: { moods: [], ...p },
  lifestyle: { medications: [], ...l },
});

/* ------------------------------------------------------------------ */
describe('suggestions', () => {
  it('tells you how much more water to drink', () => {
    const s = generateSuggestions({ profile, status: status({}), logs: { [today]: log(today, {}, { waterGlasses: 3 }) }, today });
    const water = s.find((x) => x.id === 'water-more')!;
    expect(water.title).toBe('Drink 6 more glasses of water today'); // 8 + 1 on period − 3
    expect(waterTarget(status({ phase: 'follicular' }), undefined)).toBe(8);
  });

  it('suggests a sleep target and rest after a short night with cramps', () => {
    const logs = { [today]: log(today, { cramps: 'severe', fatigue: 'moderate' }, { sleepHours: 5 }) };
    const s = generateSuggestions({ profile, status: status({}), logs, today });
    expect(s.find((x) => x.id === 'sleep-short')!.title).toMatch(/Aim for (8½|9|9½) hours of sleep tonight/);
    expect(s.find((x) => x.id === 'rest-break')!.title).toMatch(/30–60 minutes/);
    expect(s[0].priority).toBeGreaterThanOrEqual(88); // severe items float to the top
    expect(sleepTarget({ ...profile, age: 16 }, status({ phase: 'follicular' }), [])).toBe(9);
  });

  it('always includes the phase nutrition tip (luteal wording kept)', () => {
    const s = generateSuggestions({ profile, status: status({ phase: 'luteal', onPeriod: false, daysUntilNextPeriod: 4 }), logs: {}, today });
    expect(s.find((x) => x.id === 'food-phase')!.detail).toContain('Complex carbs, magnesium-rich foods and steady sleep can soften pre-period symptoms.');
  });

  it('adds stress and care suggestions', () => {
    const logs = { [today]: log(today, { moods: ['anxious'] }, { stress: 'high' }) };
    const s = generateSuggestions({
      profile,
      status: status({ phase: 'follicular', onPeriod: false }),
      logs,
      today,
      findings: [{ id: 'x', level: 'talk', title: 't', detail: 'd' }],
    });
    expect(s[0].id).toBe('care-findings');
    expect(s.some((x) => x.id === 'mind-breathe' && x.detail.includes('Stress is high today'))).toBe(true);
  });
});

/* ------------------------------------------------------------------ */
describe('analytics', () => {
  const data = buildDemoData(today);
  const history = cycleHistory(data.periodDays, data.logs, today);

  it('builds cycle history and stats from demo data', () => {
    const stats = cycleStats(history, data.logs, today);
    expect(stats.cyclesTracked).toBe(6);
    expect(stats.avgCycle).toBeCloseTo(29, 0);
    expect(stats.variation).toBe(4);
    expect(stats.avgPeriod).toBe(5);
    expect(history.slice(0, -1).every((c) => c.bbtShift !== null && c.bbtShift > 0.2)).toBe(true);
  });

  it('assigns phases to past days', () => {
    const periods = derivePeriods(data.periodDays, today);
    const s = periods[1].startDate;
    expect(phaseOn(s, periods, 29)).toBe('menstrual');
    expect(phaseOn(addDays(s, 7), periods, 29)).toBe('follicular');
    expect(phaseOn(addDays(s, 26), periods, 29)).toBe('luteal');
  });

  it('links symptoms to phases', () => {
    const rows = symptomsByPhase(data.logs, data.periodDays, 29, today);
    const cramps = rows.find((r) => r.key === 'cramps')!;
    expect(cramps.byPhase.menstrual!).toBeGreaterThan(0.5);
    expect(cramps.byPhase.follicular ?? 0).toBe(0);
    const insights = dataInsights({ logs: data.logs, periodDays: data.periodDays, history, avgCycle: 29, today });
    expect(insights.some((t) => t.startsWith('Cramps showed up on'))).toBe(true);
    expect(insights.some((t) => /cycle length has been stable|getting (longer|shorter)/.test(t))).toBe(true);
  });

  it('says a regular demo cycle looks typical', () => {
    const prediction = predict({ profile: data.profile!, periodDays: data.periodDays, today });
    const f = cycleFindings({ profile: data.profile!, history, logs: data.logs, periodDays: data.periodDays, prediction, today });
    expect(f.find((x) => x.id === 'length-ok')).toBeTruthy();
    expect(f.find((x) => x.id === 'regular')).toBeTruthy();
    expect(f.find((x) => x.id === 'bbt-ok')).toBeTruthy();
    // The sample data deliberately includes severe day-1 cramps in half the cycles.
    expect(f.filter((x) => x.level === 'talk').map((x) => x.id)).toEqual(['cramps']);
  });
});

describe('abnormal-pattern detection', () => {
  const findingsFor = (starts: string[], periodLen: number, extra: (logs: Record<string, DailyLog>) => void = () => {}, p = profile, t = today) => {
    const periodDays = starts.flatMap((s) => span(s, periodLen));
    const logs: Record<string, DailyLog> = {};
    extra(logs);
    const history = cycleHistory(periodDays, logs, t);
    const prediction = predict({ profile: p, periodDays, today: t });
    return cycleFindings({ profile: p, history, logs, periodDays, prediction, today: t });
  };

  it('flags repeatedly short cycles', () => {
    const f = findingsFor(['2026-07-01', '2026-07-19', '2026-08-06', '2026-08-24', '2026-09-11'], 4, undefined, profile, '2026-09-20');
    expect(f[0]).toMatchObject({ id: 'length-out', level: 'talk' });
  });

  it('flags irregular cycles', () => {
    const f = findingsFor(['2026-03-01', '2026-03-24', '2026-05-02', '2026-05-27', '2026-07-08'], 4, undefined, profile, '2026-07-15');
    expect(f.find((x) => x.id === 'irregular')?.level).toBe('watch'); // 23–42 days: 19-day spread
    expect(f.find((x) => x.id === 'length-out')?.level).toBe('talk'); // two cycles over 35 days
  });

  it('treats teen irregularity more gently', () => {
    const f = findingsFor(['2026-03-01', '2026-03-24', '2026-05-02', '2026-05-27', '2026-07-08'], 4, undefined, { ...profile, age: 15 }, '2026-07-15');
    expect(f.find((x) => x.id === 'irregular')?.level).toBe('watch');
  });

  it('flags long periods, heavy flow, spotting and severe cramps', () => {
    const starts = ['2026-06-01', '2026-06-29', '2026-07-27', '2026-08-24'];
    const f = findingsFor(starts, 9, (logs) => {
      for (const s of starts) {
        for (let d = 0; d < 3; d++) logs[addDays(s, d)] = { ...log(addDays(s, d), { cramps: 'severe' }), cycle: { isPeriodDay: true, flow: 'heavy' } };
        const mid = addDays(s, 14);
        logs[mid] = { ...log(mid), cycle: { isPeriodDay: false, intermenstrualSpotting: true } };
      }
    }, profile, '2026-09-01');
    const ids = f.filter((x) => x.level === 'talk').map((x) => x.id);
    expect(ids).toEqual(expect.arrayContaining(['long-period', 'heavy', 'spotting', 'cramps']));
  });

  it('flags a missed period after 90 days', () => {
    const f = findingsFor(['2026-06-01', '2026-06-29'], 5, undefined, profile, '2026-10-01');
    expect(f.find((x) => x.id === 'missed')?.level).toBe('talk');
  });
});

/* ------------------------------------------------------------------ */
describe('understand your symptoms', () => {
  it('applies a selection and keeps existing severities', () => {
    const base = log(today, { cramps: 'severe', moods: ['calm'] });
    const out = applySelection(base, new Set<CheckId>(['cramps', 'anxious', 'bloating', 'discharge_egg_white']));
    expect(out.symptoms.cramps).toBe('severe');
    expect(out.symptoms.moods).toEqual(['anxious']);
    expect(out.symptoms.bloating).toBe(true);
    expect(out.symptoms.discharge).toBe('egg_white');
    expect(selectionFromLog(out)).toEqual(new Set(['anxious', 'cramps', 'bloating', 'discharge_egg_white']));
  });

  it('"everything is fine" clears symptoms', () => {
    const out = applySelection(log(today, { cramps: 'mild', headache: 'dull', moods: ['sad', 'calm'] }), new Set<CheckId>(['fine']));
    expect(out.symptoms).toMatchObject({ feelingFine: true, cramps: 'none', headache: 'none', moods: ['calm'] });
  });

  it('explains common combinations', () => {
    expect(combinedNotes(new Set<CheckId>(['bloating', 'cravings', 'irritable']), 'luteal')[0]).toMatch(/premenstrual/);
  });

  it('parser understands the new symptoms', () => {
    const r = parseNaturalLog('so bloated, sore boobs and craving chocolate');
    expect(r.symptoms).toMatchObject({ bloating: true, tenderBreasts: true, cravings: true });
  });
});

/* ------------------------------------------------------------------ */
describe('accounts (on-device, encrypted)', () => {
  beforeEach(async () => {
    const store = await import('../lib/store');
    if (store.getState().username) await store.logout();
  });

  it('registers, persists encrypted data, logs out and back in', async () => {
    const store = await import('../lib/store');
    const storage = await import('../lib/storage');
    await store.register('Maya', 'correct horse 1', true);
    expect(store.getState().username).toBe('maya');
    expect(store.getState().settings.showIntro).toBe(true); // new accounts get the intro tour
    store.completeOnboarding(profile, '2026-10-01', '2026-10-05');
    await store.flush();

    const vault = await storage.loadVault('maya');
    expect(vault?.ciphertext).toBeTruthy();
    expect(JSON.stringify(vault)).not.toContain('2026-10-01'); // nothing readable at rest

    await store.logout();
    expect(store.getState().profile).toBeNull();

    await expect(store.login('maya', 'wrong password', false)).rejects.toThrow('Username or password is incorrect.');
    await store.login('MAYA', 'correct horse 1', false);
    expect(store.getState().periodDays).toHaveLength(5);
  });

  it('rejects weak passwords, bad and duplicate usernames', async () => {
    const store = await import('../lib/store');
    await expect(store.register('ab', 'longenough1', false)).rejects.toThrow(/at least 3/);
    await expect(store.register('lena', 'short', false)).rejects.toThrow(/8 characters/);
    await expect(store.register('maya', 'another pass 2', false)).rejects.toThrow(/already used/);
  });

  it('restores a remembered session and changes password', async () => {
    const store = await import('../lib/store');
    await store.register('sam', 'first password', true);
    await store.boot(); // simulates reopening the app
    expect(store.getState().username).toBe('sam');
    await expect(store.changePassword('nope nope', 'second password')).rejects.toThrow(/incorrect/);
    await store.changePassword('first password', 'second password');
    await store.logout();
    await expect(store.login('sam', 'first password', false)).rejects.toThrow();
    await store.login('sam', 'second password', false);
    await store.deleteAccount('second password');
    await expect(store.login('sam', 'second password', false)).rejects.toThrow();
  });

  it('locks out after repeated wrong passwords', async () => {
    const store = await import('../lib/store');
    for (let i = 0; i < 5; i++) await expect(store.login('maya', 'bad bad bad', false)).rejects.toThrow();
    await expect(store.login('maya', 'correct horse 1', false)).rejects.toThrow(/Too many attempts/);
  });
});

describe('status helpers still agree with suggestions', () => {
  it('uses the engine status end-to-end', () => {
    const data = buildDemoData(today);
    const p = predict({ profile: data.profile!, periodDays: data.periodDays, today });
    const st = getCycleStatus(p, data.periodDays, today);
    const s = generateSuggestions({ profile: data.profile!, status: st, logs: data.logs, today });
    expect(s.length).toBeGreaterThan(3);
    expect(s.some((x) => x.category === 'hydration')).toBe(true);
    expect(s.some((x) => x.category === 'rest')).toBe(true);
  });
});
