/**
 * Cycle analytics & "Understand your cycle" findings.
 *
 * Pure functions over the user's own data. Thresholds follow widely used
 * clinical reference ranges for adults (e.g. cycle 21–35 days, bleeding up to
 * 7 days, cycle-to-cycle variation under ~7–9 days), with wider bounds for
 * teens and people approaching menopause. Findings are written as gentle
 * prompts — Phase never diagnoses.
 */
import type { CycleFinding, CyclePhase, DailyLog, Demographics, ISODate, PeriodRecord, Prediction } from '../types';
import { addDays, diffDays } from './dates';
import { derivePeriods } from './predictionEngine';

/* ------------------------------------------------------------------ */
/* Cycle history                                                        */
/* ------------------------------------------------------------------ */

export interface CycleRecord {
  start: ISODate;
  /** Days until the next period started; null for the current cycle. */
  length: number | null;
  periodLength: number;
  heavyDays: number;
  severeCrampDays: number;
  migraineDays: number;
  spottingDays: number;
  /** Average luteal minus follicular BBT in °C, when enough readings exist. */
  bbtShift: number | null;
  bbtReadings: number;
}

export function cycleHistory(periodDays: ISODate[], logs: Record<ISODate, DailyLog>, today: ISODate): CycleRecord[] {
  const periods = derivePeriods(periodDays, today);
  return periods.map((p, i) => {
    const next = periods[i + 1];
    const end = next ? addDays(next.startDate, -1) : today;
    const length = next ? diffDays(next.startDate, p.startDate) : null;
    let heavyDays = 0;
    let severeCrampDays = 0;
    let migraineDays = 0;
    let spottingDays = 0;
    const temps: { day: number; t: number }[] = [];
    const span = Math.max(0, diffDays(end, p.startDate));
    for (let d = 0; d <= span; d++) {
      const date = addDays(p.startDate, d);
      const log = logs[date];
      if (!log) continue;
      const inPeriod = date <= p.endDate;
      if (inPeriod && log.cycle.flow === 'heavy') heavyDays++;
      if (log.symptoms.cramps === 'severe') severeCrampDays++;
      if (log.symptoms.headache === 'migraine') migraineDays++;
      if (!inPeriod && (log.cycle.intermenstrualSpotting || log.cycle.flow === 'spotting')) spottingDays++;
      if (log.symptoms.bbt) temps.push({ day: d + 1, t: log.symptoms.bbt });
    }
    return {
      start: p.startDate,
      length,
      periodLength: diffDays(p.endDate, p.startDate) + 1,
      heavyDays,
      severeCrampDays,
      migraineDays,
      spottingDays,
      bbtShift: length ? bbtShift(temps, length) : null,
      bbtReadings: temps.length,
    };
  });
}

/** Mean temperature of the 2nd half of the cycle minus the 1st half (needs ≥ 4 readings each side). */
function bbtShift(temps: { day: number; t: number }[], length: number): number | null {
  const ov = length - 14;
  const before = temps.filter((x) => x.day < ov - 1).map((x) => x.t);
  const after = temps.filter((x) => x.day > ov + 1).map((x) => x.t);
  if (before.length < 4 || after.length < 4) return null;
  const avg = (a: number[]) => a.reduce((s, x) => s + x, 0) / a.length;
  return Math.round((avg(after) - avg(before)) * 100) / 100;
}

/* ------------------------------------------------------------------ */
/* Phase of any past day                                                */
/* ------------------------------------------------------------------ */

export function phaseOn(date: ISODate, periods: PeriodRecord[], avgCycle: number): CyclePhase | null {
  let idx = -1;
  for (let i = 0; i < periods.length; i++) if (periods[i].startDate <= date) idx = i;
  if (idx < 0) return null;
  const p = periods[idx];
  const next = periods[idx + 1];
  const cycleLen = next ? diffDays(next.startDate, p.startDate) : Math.round(avgCycle);
  const day = diffDays(date, p.startDate) + 1;
  if (!next && day > cycleLen * 1.5) return null;
  if (date <= p.endDate) return 'menstrual';
  const periodLen = diffDays(p.endDate, p.startDate) + 1;
  const ov = Math.max(periodLen + 2, cycleLen - 14);
  if (day >= ov - 2 && day <= ov + 1) return 'ovulatory';
  return day < ov - 2 ? 'follicular' : 'luteal';
}

/* ------------------------------------------------------------------ */
/* Symptom analytics                                                    */
/* ------------------------------------------------------------------ */

export const SYMPTOM_KEYS = [
  { key: 'cramps', label: 'Cramps', test: (l: DailyLog) => !!l.symptoms.cramps && l.symptoms.cramps !== 'none' },
  { key: 'headache', label: 'Headache', test: (l: DailyLog) => !!l.symptoms.headache && l.symptoms.headache !== 'none' },
  { key: 'fatigue', label: 'Fatigue', test: (l: DailyLog) => !!l.symptoms.fatigue && l.symptoms.fatigue !== 'none' },
  { key: 'acne', label: 'Acne', test: (l: DailyLog) => !!l.symptoms.acne && l.symptoms.acne !== 'none' },
  { key: 'bloating', label: 'Bloating', test: (l: DailyLog) => !!l.symptoms.bloating },
  { key: 'tenderBreasts', label: 'Tender breasts', test: (l: DailyLog) => !!l.symptoms.tenderBreasts },
  { key: 'cravings', label: 'Cravings', test: (l: DailyLog) => !!l.symptoms.cravings },
  { key: 'lowMood', label: 'Low / anxious / irritable', test: (l: DailyLog) => l.symptoms.moods.some((m) => m === 'sad' || m === 'anxious' || m === 'irritable') },
] as const;

export const PHASES: CyclePhase[] = ['menstrual', 'follicular', 'ovulatory', 'luteal'];

export interface SymptomPhaseRow {
  key: string;
  label: string;
  /** Share of logged days in each phase with this symptom (0–1), or null if no logged days. */
  byPhase: Record<CyclePhase, number | null>;
  totalDays: number;
}

export function symptomsByPhase(logs: Record<ISODate, DailyLog>, periodDays: ISODate[], avgCycle: number, today: ISODate): SymptomPhaseRow[] {
  const periods = derivePeriods(periodDays, today);
  const daysInPhase: Record<CyclePhase, number> = { menstrual: 0, follicular: 0, ovulatory: 0, luteal: 0 };
  const counts = new Map<string, Record<CyclePhase, number>>();
  for (const s of SYMPTOM_KEYS) counts.set(s.key, { menstrual: 0, follicular: 0, ovulatory: 0, luteal: 0 });

  for (const log of Object.values(logs)) {
    if (log.date > today) continue;
    const phase = phaseOn(log.date, periods, avgCycle);
    if (!phase) continue;
    daysInPhase[phase]++;
    for (const s of SYMPTOM_KEYS) if (s.test(log)) counts.get(s.key)![phase]++;
  }

  return SYMPTOM_KEYS.map((s) => {
    const c = counts.get(s.key)!;
    const byPhase = Object.fromEntries(PHASES.map((ph) => [ph, daysInPhase[ph] ? c[ph] / daysInPhase[ph] : null])) as Record<CyclePhase, number | null>;
    return { key: s.key, label: s.label, byPhase, totalDays: PHASES.reduce((a, ph) => a + c[ph], 0) };
  });
}

export function moodCounts(logs: Record<ISODate, DailyLog>, since: ISODate) {
  const counts = { calm: 0, energetic: 0, anxious: 0, irritable: 0, sad: 0 };
  for (const l of Object.values(logs)) if (l.date >= since) for (const m of l.symptoms.moods) counts[m]++;
  return counts;
}

export function dailySeries(logs: Record<ISODate, DailyLog>, today: ISODate, days: number, pick: (l: DailyLog) => number | undefined) {
  return Array.from({ length: days }, (_, i) => {
    const date = addDays(today, i - days + 1);
    const l = logs[date];
    const v = l ? pick(l) : undefined;
    return { date, value: v ?? null };
  });
}

export interface CycleStats {
  cyclesTracked: number;
  avgCycle: number | null;
  shortest: number | null;
  longest: number | null;
  /** Difference between longest and shortest recent cycle. */
  variation: number | null;
  avgPeriod: number | null;
  daysLogged: number;
  streak: number;
}

export function cycleStats(history: CycleRecord[], logs: Record<ISODate, DailyLog>, today: ISODate): CycleStats {
  const lens = history.map((c) => c.length).filter((x): x is number => x !== null && x >= 15 && x <= 90).slice(-6);
  const periodLens = history.filter((c) => c.length !== null).map((c) => c.periodLength).slice(-6);
  const avg = (a: number[]) => (a.length ? Math.round((a.reduce((s, x) => s + x, 0) / a.length) * 10) / 10 : null);
  let streak = 0;
  for (let d = today; logs[d]; d = addDays(d, -1)) streak++;
  return {
    cyclesTracked: lens.length,
    avgCycle: avg(lens),
    shortest: lens.length ? Math.min(...lens) : null,
    longest: lens.length ? Math.max(...lens) : null,
    variation: lens.length >= 2 ? Math.max(...lens) - Math.min(...lens) : null,
    avgPeriod: avg(periodLens),
    daysLogged: Object.keys(logs).length,
    streak,
  };
}

/* ------------------------------------------------------------------ */
/* Understand your cycle — findings                                     */
/* ------------------------------------------------------------------ */

export function normalCycleRange(age: number): [number, number] {
  if (age < 18) return [21, 45]; // cycles take a few years to settle after the first period
  return [21, 35];
}

const LEVEL_ORDER = { talk: 0, watch: 1, info: 2, good: 3 } as const;

export function cycleFindings(args: {
  profile: Demographics;
  history: CycleRecord[];
  logs: Record<ISODate, DailyLog>;
  periodDays: ISODate[];
  prediction: Prediction | null;
  today: ISODate;
}): CycleFinding[] {
  const { profile, history, logs, periodDays, prediction, today } = args;
  const out: CycleFinding[] = [];
  const completed = history.filter((c) => c.length !== null);
  const recent = completed.slice(-6);
  const lens = recent.map((c) => c.length!).filter((l) => l >= 15);
  const [lo, hi] = normalCycleRange(profile.age);
  const older = profile.age >= 45;

  /* --- data sufficiency */
  if (completed.length < 2) {
    out.push({
      id: 'more-data',
      level: 'info',
      title: 'Phase is still learning your cycle',
      detail: `You have ${completed.length} complete ${completed.length === 1 ? 'cycle' : 'cycles'} logged. After about three, Phase can tell you how regular your cycle is and spot anything unusual.`,
      action: 'Log the first day of each period, plus symptoms when you notice them.',
    });
  }

  /* --- cycle length */
  if (lens.length >= 1) {
    const outside = lens.filter((l) => l < lo || l > hi);
    const avg = Math.round(lens.reduce((a, b) => a + b, 0) / lens.length);
    if (outside.length === 0) {
      out.push({
        id: 'length-ok',
        level: 'good',
        title: `Cycle length looks typical (${avg} days on average)`,
        detail: `All of your recent cycles fall within the typical ${lo}–${hi} day range.`,
        typical: `${lo}–${hi} days`,
      });
    } else {
      const short = outside.filter((l) => l < lo).length;
      const long = outside.length - short;
      const repeated = outside.length >= 2;
      out.push({
        id: 'length-out',
        level: repeated && !older ? 'talk' : 'watch',
        title: short >= long ? `${outside.length} of your last ${lens.length} cycles were shorter than ${lo} days` : `${outside.length} of your last ${lens.length} cycles were longer than ${hi} days`,
        detail: older
          ? 'Cycle length often changes in your mid-40s as you approach perimenopause. It’s still worth mentioning at your next check-up.'
          : `An occasional ${short >= long ? 'short' : 'long'} cycle can follow stress, travel, illness or changes in weight or exercise. ${
              repeated ? 'When it happens repeatedly, a clinician can check for things like thyroid changes or PCOS.' : 'Keep logging to see if it repeats.'
            }`,
        typical: `${lo}–${hi} days`,
        action: repeated && !older ? 'Consider booking a visit with your doctor or a gynecologist and bring your Phase history with you.' : undefined,
      });
    }
  }

  /* --- regularity */
  if (lens.length >= 3) {
    const variation = Math.max(...lens) - Math.min(...lens);
    const limit = profile.age < 20 || older ? 14 : 7;
    if (variation <= limit) {
      out.push({
        id: 'regular',
        level: 'good',
        title: 'Your cycle is regular',
        detail: `Your recent cycles vary by ${variation} ${variation === 1 ? 'day' : 'days'}, which is within the typical range. That also makes your predictions more reliable.`,
        typical: `Varies by ≤ ${limit} days`,
      });
    } else {
      out.push({
        id: 'irregular',
        level: variation > 20 && !older && profile.age >= 20 ? 'talk' : 'watch',
        title: 'Your cycle length varies quite a bit',
        detail: `Your recent cycles ranged from ${Math.min(...lens)} to ${Math.max(...lens)} days (${variation} days apart). ${
          profile.age < 20
            ? 'Irregular cycles are very common in the first few years after periods start.'
            : older
              ? 'More variation is common as you approach perimenopause.'
              : 'Stress, sleep, intense exercise or weight changes can all do this. Ongoing irregularity is worth checking, since conditions like PCOS or thyroid issues are treatable.'
        }`,
        typical: `Varies by ≤ ${limit} days`,
      });
    }
  }

  /* --- period length */
  const longPeriods = recent.filter((c) => c.periodLength > 7);
  if (longPeriods.length) {
    out.push({
      id: 'long-period',
      level: longPeriods.length >= 2 ? 'talk' : 'watch',
      title: `Bleeding lasted more than 7 days in ${longPeriods.length} recent ${longPeriods.length === 1 ? 'period' : 'periods'}`,
      detail: 'Periods usually last 2–7 days. Longer bleeding can be caused by things like fibroids, polyps or hormone changes, and is worth getting checked if it repeats.',
      typical: '2–7 days',
      action: longPeriods.length >= 2 ? 'Talk to a doctor — mention how many days you bled and how heavy it was.' : undefined,
    });
  } else if (recent.length >= 2) {
    out.push({ id: 'period-ok', level: 'good', title: 'Period length looks typical', detail: 'Your recent periods lasted between 2 and 7 days.', typical: '2–7 days' });
  }

  /* --- heavy flow */
  const heavy = recent.filter((c) => c.heavyDays >= 3);
  if (heavy.length >= 2) {
    out.push({
      id: 'heavy',
      level: 'talk',
      title: 'Several days of heavy flow in multiple periods',
      detail:
        'Regularly heavy periods can lead to low iron, which shows up as tiredness, breathlessness or dizziness. Signs to mention to a doctor: soaking a pad or tampon every 1–2 hours, passing large clots, or needing to change at night.',
      action: 'A simple blood test can check your iron levels.',
    });
  } else if (heavy.length === 1) {
    out.push({ id: 'heavy-once', level: 'info', title: 'One recent period had several heavy days', detail: 'An occasional heavy period is common. Keep an eye on whether it repeats.' });
  }

  /* --- spotting between periods */
  const spotting = recent.filter((c) => c.spottingDays > 0);
  if (spotting.length >= 2) {
    out.push({
      id: 'spotting',
      level: 'talk',
      title: `Spotting between periods in ${spotting.length} cycles`,
      detail:
        'Light spotting around ovulation or when starting hormonal contraception can be normal. Bleeding between periods that keeps happening — or after sex — should be checked by a clinician.',
    });
  } else if (spotting.length === 1) {
    out.push({ id: 'spotting-once', level: 'info', title: 'Some spotting between periods', detail: 'A one-off is usually nothing to worry about. Mid-cycle spotting can happen around ovulation.' });
  }

  /* --- severe cramps */
  const painful = recent.filter((c) => c.severeCrampDays >= 1);
  if (recent.length >= 2 && painful.length >= Math.max(2, Math.ceil(recent.length / 2))) {
    out.push({
      id: 'cramps',
      level: 'talk',
      title: `Severe cramps in ${painful.length} of your last ${recent.length} cycles`,
      detail:
        'Period pain is common, but pain that’s severe, stops you from doing normal activities, or isn’t helped by usual pain relief deserves attention. It can sometimes be linked to conditions like endometriosis or adenomyosis, which are treatable.',
      action: 'You don’t have to just put up with it — a doctor can help with treatment options.',
    });
  }

  /* --- menstrual migraine */
  const migraines = recent.filter((c) => c.migraineDays >= 1);
  if (migraines.length >= 2) {
    out.push({
      id: 'migraine',
      level: 'watch',
      title: 'Migraines keep appearing in your cycle',
      detail:
        'Migraines linked to the drop in estrogen around a period are common. If you get migraine with aura and use estrogen-containing contraception, tell your doctor — it affects which methods are safest.',
    });
  }

  /* --- premenstrual mood */
  const periods = derivePeriods(periodDays, today);
  const avgCycle = prediction?.averageCycleLength ?? profile.typicalCycleLength;
  let lutealMoodCycles = 0;
  for (const c of recent) {
    let hits = 0;
    for (let d = 0; d < (c.length ?? 0); d++) {
      const date = addDays(c.start, d);
      const l = logs[date];
      if (!l) continue;
      if (phaseOn(date, periods, avgCycle) === 'luteal' && l.symptoms.moods.some((m) => m === 'sad' || m === 'anxious' || m === 'irritable')) hits++;
    }
    if (hits >= 3) lutealMoodCycles++;
  }
  if (lutealMoodCycles >= 2) {
    out.push({
      id: 'pms-mood',
      level: 'watch',
      title: 'Mood dips tend to show up before your period',
      detail:
        'You logged low, anxious or irritable moods on several pre-period days in multiple cycles. This is a common PMS pattern. If it seriously affects work, relationships or how you feel about yourself, it may be PMDD — which is treatable.',
      action: 'If you ever have thoughts of harming yourself, please reach out to a crisis line or someone you trust right away.',
    });
  }

  /* --- ovulation signs from BBT */
  const withBbt = recent.filter((c) => c.bbtShift !== null);
  if (withBbt.length) {
    const last = withBbt[withBbt.length - 1];
    out.push(
      last.bbtShift! >= 0.2
        ? {
            id: 'bbt-ok',
            level: 'good',
            title: 'Your temperature shows a post-ovulation rise',
            detail: `Your BBT was about ${last.bbtShift!.toFixed(2)}°C higher in the second half of your last charted cycle — a sign ovulation likely happened.`,
          }
        : {
            id: 'bbt-flat',
            level: 'info',
            title: 'No clear temperature rise in your last charted cycle',
            detail:
              'This can happen when readings are taken at different times or after poor sleep. Occasional cycles without ovulation are also normal. If you’re trying to conceive and see this for several cycles, mention it to a doctor.',
          },
    );
  }

  /* --- late / missed period */
  if (prediction?.lastPeriod && !prediction.lastPeriod.ongoing) {
    const since = diffDays(today, prediction.lastPeriod.startDate);
    if (since >= 90) {
      out.push({
        id: 'missed',
        level: 'talk',
        title: `It’s been ${since} days since your last period`,
        detail: 'Going 3 months or more without a period (when you’re not pregnant, breastfeeding or on a method that stops periods) is worth checking with a doctor.',
        action: 'If there’s any chance you could be pregnant, take a test first.',
      });
    } else if (prediction.isLate && prediction.daysLate >= 7) {
      out.push({
        id: 'late',
        level: 'watch',
        title: `Your period is ${prediction.daysLate} days later than expected`,
        detail: 'Stress, illness, travel and changes in sleep or exercise can delay a period. If there’s a chance you could be pregnant, a home test can give you an answer.',
      });
    }
  }

  /* --- contraception context */
  const contraceptive = Object.values(logs)
    .sort((a, b) => (a.date < b.date ? 1 : -1))
    .find((l) => l.lifestyle.contraceptive)?.lifestyle.contraceptive;
  if (contraceptive && /Pill|hormonal|Implant|Injection|Ring|Patch/.test(contraceptive)) {
    out.push({
      id: 'hormonal',
      level: 'info',
      title: `You’re using hormonal contraception (${contraceptive})`,
      detail: 'Hormonal contraception changes how your cycle works, so bleeds may be lighter, irregular or absent, and ovulation estimates may not apply.',
    });
  }

  return out.sort((a, b) => LEVEL_ORDER[a.level] - LEVEL_ORDER[b.level]);
}

/** One-paragraph plain-English summary for the top of "Understand your cycle". */
export function cycleSummary(stats: CycleStats, prediction: Prediction | null): string {
  if (!stats.avgCycle) {
    return 'Once you’ve logged two periods, this page will show how long your cycle usually is, how regular it is, and what your symptoms tend to look like across each phase.';
  }
  const parts = [
    `Your cycle averages ${stats.avgCycle} days across ${stats.cyclesTracked} tracked ${stats.cyclesTracked === 1 ? 'cycle' : 'cycles'}`,
    stats.variation !== null ? `ranging from ${stats.shortest} to ${stats.longest} days` : null,
  ].filter(Boolean);
  let text = `${parts.join(', ')}.`;
  if (stats.avgPeriod) text += ` Periods usually last about ${Math.round(stats.avgPeriod)} days.`;
  if (prediction?.cycles[0]) text += ` Based on this, Phase currently has ${prediction.confidence} confidence in its predictions.`;
  return text;
}

/* ------------------------------------------------------------------ */
/* Plain-language data insights for the Trends view                     */
/* ------------------------------------------------------------------ */

export function dataInsights(args: {
  logs: Record<ISODate, DailyLog>;
  periodDays: ISODate[];
  history: CycleRecord[];
  avgCycle: number;
  today: ISODate;
}): string[] {
  const { logs, periodDays, history, avgCycle, today } = args;
  const out: string[] = [];
  const periods = derivePeriods(periodDays, today);
  const phaseIn: Record<CyclePhase, string> = {
    menstrual: 'during your period',
    follicular: 'in your follicular phase',
    ovulatory: 'around ovulation',
    luteal: 'in your luteal (pre-period) phase',
  };
  // Sentence-friendly names, e.g. "Low, anxious or irritable moods showed up on …".
  const sentenceLabel: Record<string, string> = { lowMood: 'Low, anxious or irritable moods' };

  // Strongest symptom ↔ phase links.
  const rows = symptomsByPhase(logs, periodDays, avgCycle, today);
  const links = rows
    .flatMap((r) => PHASES.map((ph) => ({ key: r.key, label: r.label, ph, v: r.byPhase[ph] ?? 0, total: r.totalDays })))
    .filter((x) => x.v >= 0.45 && x.total >= 3)
    .sort((a, b) => b.v - a.v)
    .slice(0, 3);
  for (const l of links) out.push(`${sentenceLabel[l.key] ?? l.label} showed up on ${Math.round(l.v * 100)}% of the days you logged ${phaseIn[l.ph]}.`);

  // Sleep by phase.
  const sleep: Record<CyclePhase, number[]> = { menstrual: [], follicular: [], ovulatory: [], luteal: [] };
  const stressHigh: Record<CyclePhase, number> = { menstrual: 0, follicular: 0, ovulatory: 0, luteal: 0 };
  const phaseDays: Record<CyclePhase, number> = { menstrual: 0, follicular: 0, ovulatory: 0, luteal: 0 };
  for (const l of Object.values(logs)) {
    const ph = phaseOn(l.date, periods, avgCycle);
    if (!ph) continue;
    phaseDays[ph]++;
    if (l.lifestyle.sleepHours !== undefined) sleep[ph].push(l.lifestyle.sleepHours);
    if (l.lifestyle.stress === 'high') stressHigh[ph]++;
  }
  const avg = (a: number[]) => a.reduce((s, x) => s + x, 0) / a.length;
  const sleepAvgs = PHASES.filter((ph) => sleep[ph].length >= 3).map((ph) => ({ ph, v: avg(sleep[ph]) }));
  if (sleepAvgs.length >= 2) {
    const lo = sleepAvgs.reduce((a, b) => (b.v < a.v ? b : a));
    const hi = sleepAvgs.reduce((a, b) => (b.v > a.v ? b : a));
    if (hi.v - lo.v >= 0.4) out.push(`You sleep about ${(hi.v - lo.v).toFixed(1)} hours less ${phaseIn[lo.ph]} than ${phaseIn[hi.ph]}.`);
  }
  const stressPeak = PHASES.filter((ph) => phaseDays[ph] >= 5).sort((a, b) => stressHigh[b] / phaseDays[b] - stressHigh[a] / phaseDays[a])[0];
  if (stressPeak && stressHigh[stressPeak] >= 2) {
    out.push(`High-stress days tend to cluster ${phaseIn[stressPeak]} (${Math.round((stressHigh[stressPeak] / phaseDays[stressPeak]) * 100)}% of logged days).`);
  }

  // Water.
  const water = Object.values(logs).filter((l) => l.date > addDays(today, -30) && l.lifestyle.waterGlasses !== undefined).map((l) => l.lifestyle.waterGlasses!);
  if (water.length >= 5) {
    const a = avg(water);
    out.push(a < 7 ? `You average ${a.toFixed(1)} glasses of water a day this month — a little under the goal of 8 glasses.` : `You average ${a.toFixed(1)} glasses of water a day — nicely hydrated.`);
  }

  // Cycle length trend.
  const lens = history.map((c) => c.length).filter((x): x is number => x !== null).slice(-6);
  if (lens.length >= 4) {
    const n = lens.length;
    const mx = (n - 1) / 2;
    const my = avg(lens);
    const slope = lens.reduce((s, y, i) => s + (i - mx) * (y - my), 0) / lens.reduce((s, _, i) => s + (i - mx) ** 2, 0);
    if (Math.abs(slope) >= 0.8) out.push(`Your cycles have been getting ${slope > 0 ? 'longer' : 'shorter'} by about ${Math.abs(slope).toFixed(1)} days per cycle recently.`);
    else out.push('Your cycle length has been stable over your recent cycles.');
  }

  return out;
}

/** Average sleep and other daily metrics per phase, for charts. */
export function phaseAverages(logs: Record<ISODate, DailyLog>, periodDays: ISODate[], avgCycle: number, today: ISODate, pick: (l: DailyLog) => number | undefined) {
  const periods = derivePeriods(periodDays, today);
  const acc: Record<CyclePhase, number[]> = { menstrual: [], follicular: [], ovulatory: [], luteal: [] };
  for (const l of Object.values(logs)) {
    const ph = phaseOn(l.date, periods, avgCycle);
    const v = pick(l);
    if (ph && v !== undefined) acc[ph].push(v);
  }
  return PHASES.map((ph) => ({ phase: ph, value: acc[ph].length ? acc[ph].reduce((a, b) => a + b, 0) / acc[ph].length : null, n: acc[ph].length }));
}
