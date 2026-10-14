import { describe, expect, it } from 'vitest';
import { DEFAULT_NOTIFICATION_SETTINGS, displayName, nextNotificationLog, planNotifications, type PlanInput } from '../lib/notifications';
import { numericId } from '../lib/notifier';
import { getCycleStatus, predict } from '../lib/predictionEngine';
import { cycleFindings, cycleHistory, cycleStats } from '../lib/analytics';
import { addDays } from '../lib/dates';
import { emptyData } from '../lib/storage';
import { blankLog } from '../lib/store';
import type { AppData, DailyLog, NotificationSettings } from '../types';

const today = '2026-10-12';
const span = (s: string, n: number) => Array.from({ length: n }, (_, i) => addDays(s, i));
const t = (date: string, h: number, m = 0) => new Date(`${date}T${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00`).getTime();

function input(data: AppData, now: number, day = today): PlanInput {
  const prediction = predict({ profile: data.profile!, periodDays: data.periodDays, today: day });
  const status = getCycleStatus(prediction, data.periodDays, day);
  const history = cycleHistory(data.periodDays, data.logs, day);
  return {
    data,
    now,
    today: day,
    prediction,
    status,
    stats: cycleStats(history, data.logs, day),
    findings: cycleFindings({ profile: data.profile!, history, logs: data.logs, periodDays: data.periodDays, prediction, today: day }),
  };
}

function make(opts: { periodStart: string; logs?: Record<string, DailyLog>; notif?: Partial<NotificationSettings>; username?: string; periodDays?: string[] }): AppData {
  return {
    ...emptyData(),
    username: opts.username ?? 'maya',
    profile: { age: 29, primaryGoal: 'track_period', typicalCycleLength: 28, typicalPeriodLength: 5 },
    periodDays: opts.periodDays ?? span(opts.periodStart, 5),
    logs: opts.logs ?? {},
    settings: { lockEnabled: false, tempUnit: 'C', notifications: { ...DEFAULT_NOTIFICATION_SETTINGS, enabled: true, ...opts.notif } },
  };
}

const log = (date: string, sym: Partial<DailyLog['symptoms']> = {}, life: Partial<DailyLog['lifestyle']> = {}): DailyLog => ({
  ...blankLog(date),
  symptoms: { moods: [], ...sym },
  lifestyle: { medications: [], ...life },
});

describe('notification planner', () => {
  it('sends a comforting note soon after severe cramps are logged — discreetly by default', () => {
    const data = make({ periodStart: '2026-09-20', logs: { [today]: log(today, { cramps: 'severe' }) } });
    const now = t(today, 11);
    const plan = planNotifications(input(data, now));
    const c = plan.find((p) => p.key === `comfort/cramps:${today}`)!;
    expect(c.at).toBe(now + 60_000);
    expect(c.title).toBe('Sending you some care 💛');
    expect(c.body).not.toMatch(/cramp|period/i);

    const open = planNotifications(input(make({ periodStart: '2026-09-20', logs: data.logs, notif: { discreet: false } }), now));
    expect(open.find((p) => p.key === `comfort/cramps:${today}`)!.title).toBe('Sorry today’s rough 💛');
  });

  it('schedules the period heads-up for 9 am two days before, naming the weekday', () => {
    // Last period Sep 17 → next expected Oct 15 (Thursday).
    const data = make({ periodStart: '2026-09-17', notif: { discreet: false } });
    const plan = planNotifications(input(data, t(today, 7)));
    const soon = plan.find((p) => p.key === 'cycle/period-soon:2026-10-15')!;
    expect(soon.at).toBe(t('2026-10-13', 9));
    expect(soon.body).toBe('Your period is expected around Thursday. Might be worth packing supplies.');
    expect(plan.find((p) => p.key === 'cycle/period-today:2026-10-15')!.at).toBe(t('2026-10-15', 9));
  });

  it('keeps cycle wording off the lock screen in discreet mode', () => {
    const plan = planNotifications(input(make({ periodStart: '2026-09-17' }), t(today, 7)));
    for (const p of plan) expect(`${p.title} ${p.body}`).not.toMatch(/period|cramp|fertile|ovulat/i);
  });

  it('uses the user’s name, and skips odd usernames', () => {
    expect(displayName('maya')).toBe('Maya');
    expect(displayName('maya_92')).toBe('');
    const data = make({ periodStart: '2026-09-20', logs: { [today]: log(today, {}, { stress: 'high' }) } });
    expect(planNotifications(input(data, t(today, 11))).find((p) => p.key.startsWith('comfort/stress'))!.title).toBe('A heavy day, Maya');
  });

  it('limits to two a day plus one reminder, keeping the most important', () => {
    const logs = { [today]: log(today, { cramps: 'severe', moods: ['sad'], headache: 'migraine' }, { stress: 'high', sleepHours: 5 }) };
    const plan = planNotifications(input(make({ periodStart: '2026-09-20', logs }), t(today, 11)));
    const todays = plan.filter((p) => new Date(p.at).toDateString() === new Date(t(today, 12)).toDateString());
    const main = todays.filter((p) => p.category !== 'reminders');
    expect(main).toHaveLength(2);
    expect(main.map((p) => p.key).sort()).toEqual([`comfort/cramps:${today}`, `comfort/migraine:${today}`]);
    expect(todays.filter((p) => p.category === 'reminders').length).toBeLessThanOrEqual(1);
  });

  it('counts notifications already sent today toward the limit and never repeats one', () => {
    const logs = { [today]: log(today, { cramps: 'severe' }, { stress: 'high' }) };
    const data = make({ periodStart: '2026-09-20', logs });
    data.notificationLog = { [`comfort/cramps:${today}`]: t(today, 9), [`morning/sleep-good:${today}`]: t(today, 8, 30) };
    const plan = planNotifications(input(data, t(today, 11)));
    expect(plan.some((p) => p.key === `comfort/cramps:${today}`)).toBe(false);
    expect(plan.some((p) => p.key === `comfort/stress:${today}`)).toBe(false); // daily limit already reached
  });

  it('respects quiet hours: comfort is dropped at night, cycle news waits until morning', () => {
    const late = t(today, 22, 30);
    const logs = { [today]: log(today, {}, { stress: 'high' }) };
    const plan = planNotifications(input(make({ periodStart: '2026-09-20', logs }), late));
    expect(plan.some((p) => p.key.startsWith('comfort/stress'))).toBe(false);
    for (const p of plan) {
      const h = new Date(p.at).getHours();
      expect(h >= 8 && h < 21).toBe(true);
    }
  });

  it('honours switched-off categories', () => {
    const logs = { [today]: log(today, { cramps: 'severe' }) };
    const plan = planNotifications(
      input(make({ periodStart: '2026-09-20', logs, notif: { categories: { ...DEFAULT_NOTIFICATION_SETTINGS.categories, comfort: false } } }), t(today, 11)),
    );
    expect(plan.some((p) => p.category === 'comfort')).toBe(false);
  });

  it('celebrates the water goal and nudges at 3 pm when behind', () => {
    const y = addDays(today, -1);
    const done = make({ periodStart: '2026-09-20', logs: { [y]: log(y, {}, { waterGlasses: 6 }), [today]: log(today, {}, { waterGlasses: 9 }) } });
    expect(planNotifications(input(done, t(today, 14))).find((p) => p.key.startsWith('motivation/water-goal'))!.body).toBe('9 glasses today. Nicely done, Maya!');
    const behind = make({ periodStart: '2026-09-20', logs: { [y]: log(y, {}, { waterGlasses: 6 }), [today]: log(today, {}, { waterGlasses: 2 }) } });
    const nudge = planNotifications(input(behind, t(today, 10))).find((p) => p.key.startsWith('motivation/water-nudge'))!;
    expect(nudge.at).toBe(t(today, 15));
    expect(nudge.body).toBe('You’re at 2 of 8 glasses. A glass now helps keep headaches away.');
  });

  it('reminds to log in the evening only on days with no log', () => {
    const plan = planNotifications(input(make({ periodStart: '2026-09-20', logs: { [today]: log(today, {}, { sleepHours: 8 }) } }), t(today, 10)));
    expect(plan.some((p) => p.key === `reminders/evening-log:${today}`)).toBe(false);
    expect(plan.find((p) => p.key === `reminders/evening-log:${addDays(today, 1)}`)!.at).toBe(t(addDays(today, 1), 20));
  });

  it('sends day-1 comfort once a period is logged today', () => {
    const data = make({ periodStart: today, periodDays: [...span('2026-09-14', 5), today] });
    const plan = planNotifications(input(data, t(today, 9)));
    expect(plan.some((p) => p.key === `cycle/day-one:${today}`)).toBe(true);
  });

  it('keeps a stable log: sent items stay, cancelled plans disappear', () => {
    const now = t(today, 12);
    const log1 = nextNotificationLog({ 'a/x:1': now - 1000, 'b/old:1': now - 90 * 86_400_000, 'c/future:1': now + 5000 }, [], now);
    expect(log1).toEqual({ 'a/x:1': now - 1000 });
  });

  it('numeric ids are stable 31-bit integers', () => {
    expect(numericId('comfort/cramps:2026-10-12')).toBe(numericId('comfort/cramps:2026-10-12'));
    expect(numericId('x')).toBeLessThan(2 ** 31);
    expect(numericId('a')).not.toBe(numericId('b'));
  });
});

describe('web delivery', () => {
  it('shows due notifications as an in-app banner while open, and only then records them as sent', async () => {
    const { vi } = await import('vitest');
    vi.useFakeTimers();
    (globalThis as { document?: unknown }).document = { visibilityState: 'visible' };
    const notifier = await import('../lib/notifier');
    const shown: string[] = [];
    const recorded: string[] = [];
    const off = notifier.onInAppMessage((m) => shown.push(m.title));
    notifier.setOnShown((key) => recorded.push(key));

    const now = Date.now();
    await notifier.syncNotifications([
      { key: 'comfort/a:1', category: 'comfort', at: now + 60_000, priority: 90, title: 'Sorry today’s rough 💛', body: 'x' },
      { key: 'reminders/b:1', category: 'reminders', at: now + 3 * 3_600_000, priority: 40, title: 'How was today?', body: 'y' },
    ]);
    expect(recorded).toEqual([]); // nothing counts as sent until it's shown
    await vi.advanceTimersByTimeAsync(61_000);
    expect(shown).toEqual(['Sorry today’s rough 💛']);
    expect(recorded).toEqual(['comfort/a:1']);

    off();
    notifier.setOnShown(null);
    delete (globalThis as { document?: unknown }).document;
    vi.useRealTimers();
  });

  it('catches up on same-day items when Phase is reopened later', () => {
    const y = addDays(today, -1);
    const data = make({ periodStart: '2026-09-20', logs: { [y]: log(y, {}, { waterGlasses: 6 }), [today]: log(today, {}, { waterGlasses: 1 }) } });
    const opened = t(today, 16, 30); // after the 3 pm nudge time
    const nudge = planNotifications(input(data, opened)).find((p) => p.key.startsWith('motivation/water-nudge'))!;
    expect(nudge.at).toBe(opened + 60_000);
  });
});
