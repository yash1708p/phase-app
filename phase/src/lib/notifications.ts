/**
 * Phase notifications — the planner.
 *
 * Pure functions that decide WHICH gentle, motivational or comforting
 * notifications to send and WHEN, from the user's own data. Delivery is
 * handled separately in notifier.ts (native local notifications in the app
 * builds, the browser Notification API on the web). Nothing is sent to a
 * server: every notification is created on the device.
 *
 * Rules
 *  - Discreet mode (on by default): anything that reveals cycle details uses
 *    neutral lock-screen wording.
 *  - At most 2 notifications a day, plus 1 reminder.
 *  - Hourly water reminders (their own category, outside the daily limit):
 *    every hour outside quiet hours, however much has been logged.
 *  - Today's win (own category, outside the daily limit): one thing done well
 *    today, sent in the evening just before quiet hours.
 *  - Quiet hours (default 21:00–08:00): nothing is sent.
 *  - Each category can be switched off.
 *  - Serious findings are never spelled out in a notification — only
 *    "Something in your cycle is worth a look".
 *  - Each notification has a stable key, so it's sent at most once.
 */
import type { AppData, CycleFinding, CycleStatus, DailyLog, ISODate, NotificationCategory, NotificationSettings, Prediction } from '../types';
import type { CycleStats } from './analytics';
import { addDays, diffDays, parseISO, toISO } from './dates';
import { matchPattern, type Signal } from './insightEngine';
import { sleepTarget, waterTarget } from './suggestions';

export const DEFAULT_NOTIFICATION_SETTINGS: NotificationSettings = {
  enabled: false,
  discreet: true,
  categories: { morning: true, cycle: true, comfort: true, motivation: true, reminders: true, water: true, wins: true },
  quietStart: 21,
  quietEnd: 8,
};

export const CATEGORY_INFO: Record<NotificationCategory, { title: string; description: string }> = {
  morning: { title: 'Morning check-ins', description: 'How last night’s sleep might shape your day.' },
  cycle: { title: 'Cycle moments', description: 'Heads-ups before your period, on day 1, and as phases change.' },
  comfort: { title: 'Comfort on tough days', description: 'A kind word after you log cramps, stress, a low mood or a migraine.' },
  motivation: { title: 'Motivation and celebrations', description: 'Water goals, logging streaks and milestones.' },
  reminders: { title: 'Gentle reminders', description: 'An evening nudge to log, and morning temperature checks if you track BBT.' },
  water: {
    title: 'Hourly water reminders',
    description: 'A nudge to drink water every hour outside quiet hours, with your progress so far.',
  },
  wins: { title: 'Today’s win', description: 'One thing you did well today, sent in the evening before quiet hours.' },
};

/** Whether a category is switched on (categories added in later versions default to on). */
export const categoryOn = (s: NotificationSettings, c: NotificationCategory) => s.categories[c] ?? DEFAULT_NOTIFICATION_SETTINGS.categories[c] ?? true;

/** Categories with their own schedule, outside the daily limit. */
const OWN_SCHEDULE: NotificationCategory[] = ['water', 'wins'];

export const DAILY_LIMIT = 2;
export const DAILY_REMINDER_LIMIT = 1;
const HORIZON_DAYS = 4;
const LOG_RETENTION_DAYS = 60;

export interface PlannedNotification {
  /** Stable key "category/name:date"; also used to remember it was sent. */
  key: string;
  category: NotificationCategory;
  /** Epoch ms. */
  at: number;
  priority: number;
  /** Text actually shown (already switched to the discreet version when needed). */
  title: string;
  body: string;
}

interface Candidate {
  key: string;
  category: NotificationCategory;
  at: number;
  priority: number;
  /** Reveals cycle details, so it uses `discreet` text in discreet mode. */
  sensitive: boolean;
  title: string;
  body: string;
  discreet?: { title: string; body: string };
  /** If its time has already passed today, send it now instead of dropping it. */
  catchUp: boolean;
  /** If it would land in quiet hours, move it to the end of quiet hours instead of dropping it. */
  deferrable: boolean;
}

export interface PlanInput {
  data: AppData;
  now: number;
  today: ISODate;
  prediction: Prediction | null;
  status: CycleStatus;
  stats: CycleStats;
  findings: CycleFinding[];
}

/* ------------------------------------------------------------------ */
/* Helpers                                                              */
/* ------------------------------------------------------------------ */

export const categoryOf = (key: string) => key.split('/')[0] as NotificationCategory;

const at = (date: ISODate, hour: number, minute = 0) => {
  const d = parseISO(date);
  d.setHours(hour, minute, 0, 0);
  return d.getTime();
};

const dayOf = (ms: number) => toISO(new Date(ms));

function inQuietHours(ms: number, s: NotificationSettings) {
  const h = new Date(ms).getHours();
  return s.quietStart > s.quietEnd ? h >= s.quietStart || h < s.quietEnd : h >= s.quietStart && h < s.quietEnd;
}

function endOfQuiet(ms: number, s: NotificationSettings) {
  const d = new Date(ms);
  if (d.getHours() >= s.quietEnd && s.quietStart > s.quietEnd) d.setDate(d.getDate() + 1);
  d.setHours(s.quietEnd, 0, 0, 0);
  return d.getTime();
}

/** "Maya" from "maya"; no name if the username isn't a plain name. */
export function displayName(username?: string) {
  if (!username || !/^[a-z]{2,20}$/i.test(username)) return '';
  return username.charAt(0).toUpperCase() + username.slice(1).toLowerCase();
}

/** 5.5 → "5½ hours", 8 → "8 hours". */
function hoursText(h: number) {
  const whole = Math.floor(h);
  const half = h - whole >= 0.25 && h - whole < 0.75;
  const n = half ? `${whole}½` : String(Math.round(h));
  return `${n} ${n === '1' ? 'hour' : 'hours'}`;
}

const weekday = (date: ISODate) => parseISO(date).toLocaleDateString('en-US', { weekday: 'long' });

const PATTERN_TIP: Record<Signal, string> = {
  cramps: 'Keep a heat pad handy.',
  headache: 'Keep water nearby and plan a lighter evening.',
  migraine: 'Keep water nearby and plan a lighter evening.',
  anxious: 'Plan something kind for yourself.',
  sad: 'Plan something kind for yourself.',
  irritable: 'Build in a little extra breathing room.',
  fatigue: 'An early night tonight could help.',
  acne: 'Be gentle with your skin.',
  energetic: '',
};

/* ------------------------------------------------------------------ */
/* Candidates                                                           */
/* ------------------------------------------------------------------ */

function candidates({ data, now, today, prediction, status, stats, findings }: PlanInput): Candidate[] {
  const profile = data.profile;
  if (!profile) return [];
  const out: Candidate[] = [];
  const name = displayName(data.username);
  const comma = name ? `, ${name}` : '';
  const soon = now + 60_000;
  const log = data.logs[today];
  const lastLogs = [0, 1, 2].map((n) => data.logs[addDays(today, -n)]);
  const add = (c: Omit<Candidate, 'catchUp' | 'deferrable'> & Partial<Pick<Candidate, 'catchUp' | 'deferrable'>>) =>
    out.push({ catchUp: false, deferrable: false, ...c });
  const hourlyWater = categoryOn(data.settings.notifications ?? DEFAULT_NOTIFICATION_SETTINGS, 'water');

  /* ---------- Morning check-ins (after sleep is logged, before 2 pm) ---------- */
  const hours = log?.lifestyle.sleepHours;
  if (hours !== undefined && new Date(now).getHours() < 14) {
    const recent = lastLogs.slice(1).filter((l): l is DailyLog => !!l);
    const goal = sleepTarget(profile, status, recent);
    const nights = lastLogs.map((l) => l?.lifestyle.sleepHours);
    if (nights.every((h) => h !== undefined && h < goal - 1)) {
      add({
        key: `morning/sleep-debt:${today}`,
        category: 'morning',
        at: soon,
        priority: 72,
        sensitive: false,
        title: 'Catching up on sleep',
        body: 'Your last three nights were short. An earlier bedtime tonight will help you get back on track.',
      });
    } else if (hours < goal - 1) {
      add({
        key: `morning/sleep-short:${today}`,
        category: 'morning',
        at: soon,
        priority: 70,
        sensitive: false,
        title: 'A shorter night 😴',
        body: `You logged ${hoursText(hours)} of sleep${comma}. Go easy today and aim for ${hoursText(goal)} tonight.`,
      });
    } else if (hours >= goal - 0.5) {
      add({
        key: `morning/sleep-good:${today}`,
        category: 'morning',
        at: soon,
        priority: 45,
        sensitive: false,
        title: 'Well rested ✨',
        body: `${hoursText(hours)} of sleep last night, a great start to your day.`,
      });
    }
  }

  /* ---------- Cycle moments ---------- */
  const next = prediction?.cycles[0];
  const last = prediction?.lastPeriod ?? null;
  const cycleDiscreet = { title: 'Phase', body: 'You have a cycle update. Open Phase to see it.' };

  if (next && prediction && !prediction.isLate) {
    const soonDate = addDays(next.periodStart, -2);
    add({
      key: `cycle/period-soon:${next.periodStart}`,
      category: 'cycle',
      at: at(soonDate, 9),
      priority: 76,
      sensitive: true,
      catchUp: soonDate === today,
      deferrable: true,
      title: 'Heads-up for later this week',
      body: `Your period is expected around ${weekday(next.periodStart)}. Might be worth packing supplies.`,
      discreet: { title: 'Phase', body: 'You have a cycle update for this week.' },
    });
    add({
      key: `cycle/period-today:${next.periodStart}`,
      category: 'cycle',
      at: at(next.periodStart, 9),
      priority: 78,
      sensitive: true,
      catchUp: next.periodStart === today,
      deferrable: true,
      title: 'Today’s the day, probably',
      body: 'Your period is due today. Log it when it starts so Phase can keep learning.',
      discreet: { title: 'A quick check-in from Phase', body: 'Open Phase for today’s cycle update.' },
    });
    add({
      key: `cycle/pre-period:${next.periodStart}`,
      category: 'cycle',
      at: at(addDays(next.periodStart, -6), 9, 30),
      priority: 60,
      sensitive: true,
      catchUp: addDays(next.periodStart, -6) === today,
      deferrable: true,
      title: 'Pre-period days ahead',
      body: 'Bloating, cravings or a shorter fuse are common this week. Extra sleep and magnesium-rich foods can help.',
      discreet: { title: 'Look after yourself this week', body: 'Extra sleep and magnesium-rich foods can help you feel your best.' },
    });
    if (profile.primaryGoal === 'trying_to_conceive') {
      add({
        key: `cycle/fertile:${next.fertileStart}`,
        category: 'cycle',
        at: at(next.fertileStart, 9),
        priority: 82,
        sensitive: true,
        catchUp: next.fertileStart === today,
        deferrable: true,
        title: 'Your fertile window starts today',
        body: 'Your most fertile days are here. The days just before ovulation matter most.',
        discreet: cycleDiscreet,
      });
    }
  }

  if (last && last.startDate === today && data.periodDays.includes(today)) {
    add({
      key: `cycle/day-one:${today}`,
      category: 'cycle',
      at: soon,
      priority: 88,
      sensitive: true,
      title: 'Be gentle with yourself today 🌸',
      body: `Day 1 is often the toughest. Heat, rest and water can help${comma}.`,
      discreet: { title: 'Be gentle with yourself today 🌸', body: `Heat, rest and water can help${comma}.` },
    });
  }

  if (last && !last.ongoing) {
    const length = diffDays(last.endDate, last.startDate) + 1;
    const endedOn = addDays(last.endDate, 2);
    if (length >= 2 && endedOn >= addDays(today, -1)) {
      add({
        key: `cycle/period-ended:${last.startDate}`,
        category: 'cycle',
        at: at(endedOn, 9),
        priority: 55,
        sensitive: true,
        catchUp: endedOn <= today,
        deferrable: true,
        title: 'Period done ✨',
        body: `Your period lasted ${length} days. Energy usually starts lifting from here.`,
        discreet: { title: 'A new phase starts ✨', body: 'Open Phase to see what to expect this week.' },
      });
    }
    const energyOn = addDays(last.endDate, 4);
    if (energyOn >= today) {
      add({
        key: `cycle/energy:${last.startDate}`,
        category: 'cycle',
        at: at(energyOn, 9, 30),
        priority: 50,
        sensitive: true,
        catchUp: energyOn === today,
        deferrable: true,
        title: 'Energy on the rise ⚡',
        body: 'Estrogen is climbing. It’s a great window for a harder workout or trying something new.',
        discreet: { title: 'Energy on the rise ⚡', body: 'It’s a great window for a harder workout or trying something new.' },
      });
    }
  }

  if (prediction?.isLate && prediction.daysLate >= 3 && last) {
    add({
      key: `cycle/late:${last.startDate}`,
      category: 'cycle',
      at: Math.max(soon, at(today, 10)),
      priority: 80,
      sensitive: true,
      catchUp: true,
      deferrable: true,
      title: 'Your cycle’s running a little late',
      body: 'Stress, travel and sleep can all shift things. Log it when it starts and Phase will adjust.',
      discreet: cycleDiscreet,
    });
  }

  /* ---------- Comfort after a tough log ---------- */
  const y = log?.symptoms;
  if (y?.cramps === 'severe') {
    add({
      key: `comfort/cramps:${today}`,
      category: 'comfort',
      at: soon,
      priority: 92,
      sensitive: true,
      title: 'Sorry today’s rough 💛',
      body: 'A heat pad and 20 minutes of rest can ease severe cramps.',
      discreet: { title: 'Sending you some care 💛', body: 'Be gentle with yourself today. Rest and warmth can help.' },
    });
  }
  if (log?.lifestyle.stress === 'high') {
    add({
      key: `comfort/stress:${today}`,
      category: 'comfort',
      at: soon,
      priority: 86,
      sensitive: false,
      title: `A heavy day${comma}`,
      body: 'Five slow breaths or a short walk can take the edge off.',
    });
  }
  if (y?.moods.includes('sad')) {
    add({
      key: `comfort/low-mood:${today}`,
      category: 'comfort',
      at: soon,
      priority: 87,
      sensitive: false,
      title: 'Sending you some kindness 💛',
      body: 'Low days happen. A little daylight and a message to someone you like can help.',
    });
  }
  if (y?.headache === 'migraine') {
    add({
      key: `comfort/migraine:${today}`,
      category: 'comfort',
      at: soon,
      priority: 89,
      sensitive: false,
      title: 'Rest somewhere dark and quiet',
      body: 'Water, dimmed screens and a short rest are a good first step.',
    });
  }
  const pattern = matchPattern(data.logs, data.periodDays, today, [1]);
  if (pattern && pattern.signal !== 'energetic') {
    add({
      key: `comfort/pattern:${addDays(today, 1)}`,
      category: 'comfort',
      at: at(today, 19),
      priority: 58,
      sensitive: true,
      catchUp: true,
      title: 'Heads-up for tomorrow',
      body: `In your last ${pattern.total} cycles, ${pattern.text} showed up around cycle day ${pattern.cycleDay}. ${PATTERN_TIP[pattern.signal]}`.trim(),
      discreet: { title: 'Heads-up for tomorrow', body: 'Phase spotted a pattern for tomorrow. Open the app to see it.' },
    });
  }

  /* ---------- Motivation and celebrations ---------- */
  const glasses = log?.lifestyle.waterGlasses;
  const waterGoal = waterTarget(status, log);
  if (glasses !== undefined && glasses >= waterGoal) {
    add({
      key: `motivation/water-goal:${today}`,
      category: 'motivation',
      at: soon,
      priority: 52,
      sensitive: false,
      title: 'Hydration goal reached 💧',
      body: `${glasses} glasses today. Nicely done${comma}!`,
    });
  }
  const tracksWater = [1, 2, 3, 4, 5, 6, 7].some((n) => data.logs[addDays(today, -n)]?.lifestyle.waterGlasses !== undefined);
  // The 3 pm water break is only needed when hourly water reminders are off.
  if (!hourlyWater && tracksWater && (glasses ?? 0) < waterGoal / 2) {
    add({
      key: `motivation/water-nudge:${today}`,
      category: 'motivation',
      at: at(today, 15),
      priority: 40,
      sensitive: false,
      catchUp: true,
      title: 'Time for a water break 💧',
      body: `You’re at ${glasses ?? 0} of ${waterGoal} glasses. A glass now helps keep headaches away.`,
    });
  }
  if (data.periodDays.includes(today) && (log?.lifestyle.workout === 'moderate' || log?.lifestyle.workout === 'intense')) {
    add({
      key: `motivation/period-workout:${today}`,
      category: 'motivation',
      at: soon,
      priority: 56,
      sensitive: true,
      title: 'Impressive effort 💪',
      body: 'You logged a workout on a period day. Remember to rest up tonight.',
      discreet: { title: 'Impressive effort 💪', body: 'Great job moving today. Remember to rest up tonight.' },
    });
  }
  if (stats.streak === 7 || stats.streak === 30) {
    add({
      key: `motivation/streak-${stats.streak}:${today}`,
      category: 'motivation',
      at: soon,
      priority: 54,
      sensitive: false,
      title: `${stats.streak} days in a row 🔥`,
      body: 'Every log makes your insights more personal.',
    });
  }
  if (prediction?.confidence === 'high') {
    add({
      key: 'motivation/confidence-high:once',
      category: 'motivation',
      at: soon,
      priority: 60,
      sensitive: false,
      title: 'Your predictions just got sharper 🎯',
      body: `${prediction.cyclesUsed} regular cycles logged. Phase now has high confidence in your forecast.`,
    });
  }

  /* ---------- Gentle reminders ---------- */
  for (let n = 0; n < HORIZON_DAYS; n++) {
    const date = addDays(today, n);
    if (!data.logs[date]) {
      add({
        key: `reminders/evening-log:${date}`,
        category: 'reminders',
        at: at(date, 20),
        priority: 40,
        sensitive: false,
        catchUp: true,
        title: 'How was today?',
        body: 'Take 15 seconds to log how you feel.',
      });
    }
  }
  const tracksBbt = [0, 1, 2, 3, 4, 5, 6, 7].some((n) => data.logs[addDays(today, -n)]?.symptoms.bbt !== undefined);
  if (tracksBbt) {
    for (let n = 0; n < HORIZON_DAYS; n++) {
      const date = addDays(today, n);
      if (data.logs[date]?.symptoms.bbt !== undefined) continue;
      add({
        key: `reminders/bbt:${date}`,
        category: 'reminders',
        at: at(date, 8),
        priority: 45,
        sensitive: false,
        title: 'Temperature check 🌡️',
        body: 'Take it before you get up for the most accurate reading.',
      });
    }
  }
  for (const f of findings.filter((x) => x.level === 'talk')) {
    add({
      key: `reminders/finding-${f.id}:once`,
      category: 'reminders',
      at: Math.max(soon, at(today, 10)),
      priority: 70,
      sensitive: false,
      catchUp: true,
      deferrable: true,
      title: 'Something in your cycle is worth a look',
      body: 'Open Insights to see what Phase noticed.',
    });
  }

  /* ---------- Hourly water reminders ---------- */
  if (hourlyWater) out.push(...waterReminders({ data, now, today, status, name }));

  /* ---------- Today's win (evening, just before quiet hours) ---------- */
  const win = todaysWin({ data, today, status, stats, name });
  if (win) {
    const settings = data.settings.notifications ?? DEFAULT_NOTIFICATION_SETTINGS;
    add({
      key: `wins/today:${today}`,
      category: 'wins',
      at: winTime(today, settings),
      priority: 30,
      sensitive: false,
      catchUp: true,
      title: win.title,
      body: win.body,
    });
  }

  return out;
}

/** 30 minutes before quiet hours start (8:30 pm with the default 9 pm). */
export function winTime(date: ISODate, s: NotificationSettings) {
  const minutes = s.quietStart * 60 - 30;
  return at(date, Math.floor(minutes / 60), minutes % 60);
}

const WORKOUT_WORD = { light: 'some light movement', moderate: 'a good workout', intense: 'a tough workout' } as const;

/**
 * The single best thing from today's log, in order of how much it stands out:
 * water goal, a workout, good sleep, a logging streak, low stress, a good
 * mood, nearly reaching the water goal, or simply checking in.
 */
export function todaysWin({ data, today, status, stats, name }: { data: AppData; today: ISODate; status: CycleStatus; stats: CycleStats; name: string }): { kind: string; title: string; body: string } | null {
  const profile = data.profile;
  const log = data.logs[today];
  if (!profile || !log) return null;
  const title = name ? `Today’s win, ${name} 🌟` : 'Today’s win 🌟';
  const life = log.lifestyle;
  const options: { kind: string; score: number; body: string }[] = [];

  const glasses = life.waterGlasses ?? 0;
  const goal = waterTarget(status, log);
  if (glasses >= goal) options.push({ kind: 'water', score: 90 + Math.min(5, glasses - goal), body: `You drank ${glasses} glasses of water and reached your goal. Your body thanks you 💧` });
  else if (glasses >= Math.ceil(goal * 0.75)) options.push({ kind: 'water-close', score: 50, body: `You drank ${glasses} glasses of water today, so close to your goal of ${goal}. Nicely done 💧` });

  if (life.workout && life.workout !== 'rest') {
    options.push({ kind: 'workout', score: life.workout === 'light' ? 72 : 86, body: `You fit in ${WORKOUT_WORD[life.workout]} today. That’s something to be proud of 💪` });
  }

  if (life.sleepHours !== undefined) {
    const recent = [1, 2, 3].map((n) => data.logs[addDays(today, -n)]).filter((l): l is DailyLog => !!l);
    const target = sleepTarget(profile, status, recent);
    if (life.sleepHours >= target - 0.5) {
      options.push({ kind: 'sleep', score: life.sleepHours >= target ? 82 : 74, body: `You got ${hoursText(life.sleepHours)} of sleep last night. Rest like that makes everything a little easier 😴` });
    }
  }

  if (stats.streak >= 3) options.push({ kind: 'streak', score: stats.streak >= 7 ? 78 : 62, body: `${stats.streak} days of logging in a row. You’re really getting to know your body 🔥` });
  if (life.stress === 'low') options.push({ kind: 'stress', score: 66, body: 'You kept stress low today. Whatever you did, it’s working 🌿' });
  const mood = log.symptoms.moods.find((m) => m === 'calm' || m === 'energetic');
  if (mood) options.push({ kind: 'mood', score: 56, body: `You felt ${mood} today. Hold on to that feeling ✨` });
  if (log.symptoms.feelingFine) options.push({ kind: 'fine', score: 54, body: 'You felt good today. Notice what helped, and do more of it ✨' });

  options.push({ kind: 'checkin', score: 40, body: 'You took a moment to check in with yourself today. Small habits like that add up 💛' });
  const best = options.sort((a, b) => b.score - a.score)[0];
  return { kind: best.kind, title, body: best.body };
}

const WATER_LINES: { title: string; body: (p: string) => string }[] = [
  { title: 'Water break 💧', body: (p) => `${p} A glass now keeps you on track.` },
  { title: 'Time for some water 💧', body: (p) => `${p} Small sips add up.` },
  { title: 'Quick sip? 💧', body: (p) => `${p} Staying hydrated can help with energy and headaches.` },
  { title: 'Hydration check 💧', body: (p) => `${p} Grab a glass when you get a moment.` },
];

/** Every hour outside quiet hours, today and tomorrow. */
function waterReminders({ data, now, today, status, name }: { data: AppData; now: number; today: ISODate; status: CycleStatus; name: string }): Candidate[] {
  const settings = data.settings.notifications ?? DEFAULT_NOTIFICATION_SETTINGS;
  const out: Candidate[] = [];
  for (const date of [today, addDays(today, 1)]) {
    const log = data.logs[date];
    const glasses = log?.lifestyle.waterGlasses ?? 0;
    const goal = waterTarget(status, log);
    let first = true;
    for (let hour = 0; hour < 24; hour++) {
      const when = at(date, hour);
      if (when <= now + 60_000 || inQuietHours(when, settings)) continue;
      const line = WATER_LINES[hour % WATER_LINES.length];
      const progress =
        date === today
          ? glasses >= goal
            ? `You’ve had ${glasses} glasses today and reached your goal of ${goal}. Keep sipping!`
            : `You’re at ${glasses} of ${goal} glasses today.`
          : first
            ? `Good morning${name ? `, ${name}` : ''}! Your goal today is about ${goal} glasses.`
            : `Aim for about ${goal} glasses today.`;
      out.push({
        key: `water/hourly:${date}T${String(hour).padStart(2, '0')}`,
        category: 'water',
        at: when,
        priority: 10,
        sensitive: false,
        catchUp: false,
        deferrable: false,
        title: date !== today && first ? 'Start the day with water 💧' : date === today && glasses >= goal ? 'Water break 💧' : line.title,
        body: date === today && glasses >= goal ? progress : line.body(progress),
      });
      first = false;
    }
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Plan                                                                 */
/* ------------------------------------------------------------------ */

/**
 * The full set of upcoming notifications, after timing, quiet hours,
 * categories, discreet mode and daily limits. Already-sent ones are skipped.
 */
export function planNotifications(input: PlanInput): PlannedNotification[] {
  const settings = input.data.settings.notifications ?? DEFAULT_NOTIFICATION_SETTINGS;
  const log = input.data.notificationLog ?? {};
  const { now } = input;
  const horizon = now + HORIZON_DAYS * 86_400_000;
  const soon = now + 60_000;

  const timed: (Candidate & { at: number })[] = [];
  for (const c of candidates(input)) {
    if (!categoryOn(settings, c.category)) continue;
    const logged = log[c.key];
    if (logged !== undefined && logged <= now) continue; // already sent
    let when = logged ?? c.at; // keep the time we already chose, so it doesn't drift
    if (when < now) {
      if (!c.catchUp || dayOf(when) !== dayOf(now)) continue;
      when = soon;
    }
    if (inQuietHours(when, settings)) {
      if (!c.deferrable) continue;
      when = endOfQuiet(when, settings);
    }
    if (when > horizon) continue;
    timed.push({ ...c, at: when });
  }

  // Daily limits, counting what was already sent that day.
  const sentPerDay = new Map<string, { main: number; reminders: number }>();
  for (const [key, ms] of Object.entries(log)) {
    if (ms > now || OWN_SCHEDULE.includes(categoryOf(key))) continue;
    const day = dayOf(ms);
    const counts = sentPerDay.get(day) ?? { main: 0, reminders: 0 };
    if (categoryOf(key) === 'reminders') counts.reminders++;
    else counts.main++;
    sentPerDay.set(day, counts);
  }

  const chosen: PlannedNotification[] = [];
  for (const c of [...timed].sort((a, b) => b.priority - a.priority || a.at - b.at)) {
    const day = dayOf(c.at);
    if (OWN_SCHEDULE.includes(c.category)) {
      chosen.push({ key: c.key, category: c.category, at: c.at, priority: c.priority, title: c.title, body: c.body });
      continue; // water reminders and today's win have their own schedule, outside the daily limit
    }
    const counts = sentPerDay.get(day) ?? { main: 0, reminders: 0 };
    const isReminder = c.category === 'reminders';
    if (isReminder ? counts.reminders >= DAILY_REMINDER_LIMIT : counts.main >= DAILY_LIMIT) continue;
    if (isReminder) counts.reminders++;
    else counts.main++;
    sentPerDay.set(day, counts);
    const useDiscreet = settings.discreet && c.sensitive && c.discreet;
    chosen.push({
      key: c.key,
      category: c.category,
      at: c.at,
      priority: c.priority,
      title: useDiscreet ? c.discreet!.title : c.title,
      body: useDiscreet ? c.discreet!.body : c.body,
    });
  }
  return chosen.sort((a, b) => a.at - b.at);
}

/** New notification log: everything already sent (kept 60 days) plus everything now planned. */
export function nextNotificationLog(log: Record<string, number> | undefined, plan: PlannedNotification[], now: number) {
  const cutoff = now - LOG_RETENTION_DAYS * 86_400_000;
  const out: Record<string, number> = {};
  const waterCutoff = now - 2 * 86_400_000; // hourly water reminders only matter for a day or two
  for (const [key, ms] of Object.entries(log ?? {})) if (ms <= now && ms >= (categoryOf(key) === 'water' ? waterCutoff : cutoff)) out[key] = ms;
  for (const p of plan) out[p.key] = p.at;
  return out;
}

export const sameLog = (a: Record<string, number> | undefined, b: Record<string, number>) => {
  const ka = Object.keys(a ?? {});
  return ka.length === Object.keys(b).length && ka.every((k) => a![k] === b[k]);
};
