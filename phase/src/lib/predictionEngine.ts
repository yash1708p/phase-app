/**
 * Phase prediction engine.
 *
 * A small Bayesian-flavoured model that runs entirely on-device:
 *
 * 1. Period records are derived from the set of logged period days.
 * 2. Observed cycle lengths (start → next start) are cleaned of implausible
 *    values and outliers, then combined with the user's baseline using
 *    recency-weighted shrinkage: with no history the baseline wins; after a
 *    few cycles the user's own data dominates.
 * 3. Expected variability starts from an age-based prior (cycles are naturally
 *    less regular in the teen years and approaching perimenopause) and is
 *    updated with the observed spread.
 * 4. A rolling forecast is generated from the last period start until the end
 *    of next calendar month, with ovulation and fertile windows and widening
 *    uncertainty for later cycles.
 *
 * Every call is pure: pass the latest data and `today`, get a fresh forecast.
 * The UI simply recomputes on each change, so predictions re-index instantly.
 *
 * These are statistical estimates for awareness only — not contraception or
 * medical advice.
 */
import type {
  CycleStatus,
  Demographics,
  ISODate,
  PeriodRecord,
  PredictedCycle,
  Prediction,
  Confidence,
  CyclePhase,
} from '../types';
import { addDays, addMonths, diffDays, endOfMonth, isBetween, sameMonth, startOfMonth } from './dates';

/* ------------------------------------------------------------------ */
/* Tunables                                                             */
/* ------------------------------------------------------------------ */

export const ENGINE = {
  /** Shortest/longest gap treated as a real cycle (shorter = same period / spotting; longer = missed log). */
  MIN_CYCLE: 15,
  MAX_CYCLE: 60,
  /** Days of non-bleeding that still count as the same period. */
  PERIOD_GAP_TOLERANCE: 2,
  /** How many recent cycles to learn from. */
  HISTORY_WINDOW: 6,
  /** Each older cycle counts this much less than the next newer one. */
  RECENCY_DECAY: 0.75,
  /** Weight of the baseline, in "cycles' worth" of evidence. */
  PRIOR_WEIGHT: 1.5,
  /** Typical luteal phase length used to place ovulation. */
  LUTEAL_LENGTH: 14,
  /** Fertile window: 5 days before ovulation through 1 day after. */
  FERTILE_BEFORE: 5,
  FERTILE_AFTER: 1,
} as const;

/** Expected cycle-length SD (days) by age — the variance prior. */
export function ageVariancePrior(age: number): number {
  if (age < 18) return 5.5;
  if (age < 21) return 4.5;
  if (age < 35) return 2.5;
  if (age < 40) return 3.2;
  if (age < 45) return 4.5;
  return 6;
}

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));
const round1 = (n: number) => Math.round(n * 10) / 10;

/* ------------------------------------------------------------------ */
/* Period records                                                       */
/* ------------------------------------------------------------------ */

/** Group logged period days into contiguous period records (tolerating short gaps). */
export function derivePeriods(periodDays: ISODate[], today: ISODate): PeriodRecord[] {
  const days = [...new Set(periodDays)].sort();
  const out: PeriodRecord[] = [];
  for (const day of days) {
    const last = out[out.length - 1];
    if (last && diffDays(day, last.endDate) <= ENGINE.PERIOD_GAP_TOLERANCE + 1) {
      last.endDate = day;
    } else {
      out.push({ startDate: day, endDate: day, ongoing: false });
    }
  }
  const last = out[out.length - 1];
  if (last) {
    const sinceEnd = diffDays(today, last.endDate);
    const length = diffDays(last.endDate, last.startDate) + 1;
    last.ongoing = sinceEnd >= 0 && sinceEnd <= 1 && length < 10;
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Statistics                                                           */
/* ------------------------------------------------------------------ */

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

/** Cycle lengths between consecutive starts, oldest first, cleaned of outliers. */
export function observedCycleLengths(periods: PeriodRecord[]): number[] {
  const raw: number[] = [];
  for (let i = 1; i < periods.length; i++) {
    const len = diffDays(periods[i].startDate, periods[i - 1].startDate);
    if (len >= ENGINE.MIN_CYCLE && len <= ENGINE.MAX_CYCLE) raw.push(len);
  }
  if (raw.length < 4) return raw;
  const med = median(raw);
  const mad = median(raw.map((x) => Math.abs(x - med))) || 1;
  const limit = Math.max(7, 3 * 1.4826 * mad);
  return raw.filter((x) => Math.abs(x - med) <= limit);
}

interface Blend {
  mean: number;
  sd: number;
  n: number;
}

/** Recency-weighted mean/SD of the most recent values, shrunk toward a prior. */
function shrink(values: number[], priorMean: number, priorSd: number): Blend {
  const recent = values.slice(-ENGINE.HISTORY_WINDOW).reverse(); // newest first
  if (recent.length === 0) return { mean: priorMean, sd: priorSd, n: 0 };

  const w = recent.map((_, k) => ENGINE.RECENCY_DECAY ** k);
  const W = w.reduce((a, b) => a + b, 0);
  const obsMean = recent.reduce((a, x, k) => a + x * w[k], 0) / W;
  const P = ENGINE.PRIOR_WEIGHT;
  const mean = (P * priorMean + W * obsMean) / (P + W);

  let sd = priorSd;
  if (recent.length >= 2) {
    const obsVar = recent.reduce((a, x, k) => a + w[k] * (x - obsMean) ** 2, 0) / W;
    // Bessel-style correction for small samples, then pool with the prior.
    const corrected = obsVar * (recent.length / (recent.length - 1));
    sd = Math.sqrt((P * priorSd ** 2 + recent.length * corrected) / (P + recent.length));
  }
  return { mean, sd, n: recent.length };
}

/* ------------------------------------------------------------------ */
/* Confidence                                                           */
/* ------------------------------------------------------------------ */

function describeConfidence(n: number, sd: number, age: number): { confidence: Confidence; reason: string } {
  const spread = Math.max(1, Math.round(sd));
  const ageNote = ageVariancePrior(age) > 3 ? ' Cycles naturally vary more at your age, so the window is a little wider.' : '';

  if (n === 0) {
    return {
      confidence: 'low',
      reason: `Based on your typical cycle settings. Log your next period to start personalizing.${ageNote}`,
    };
  }
  const cycles = `${n} ${n === 1 ? 'cycle' : 'cycles'}`;
  if (n >= 3 && sd <= 2.2) {
    return { confidence: 'high', reason: `High confidence — based on your last ${cycles}, which have been regular (±${spread} days).` };
  }
  if (n >= 2 && sd <= 4) {
    return { confidence: 'medium', reason: `Medium confidence — based on your last ${cycles} (±${spread} days).${ageNote}` };
  }
  if (n === 1) {
    return { confidence: 'low', reason: `Early estimate — based on 1 logged cycle plus your typical settings.${ageNote}` };
  }
  return {
    confidence: 'low',
    reason: `Lower confidence — your last ${cycles} have varied by about ±${spread} days.${ageNote}`,
  };
}

/* ------------------------------------------------------------------ */
/* Forecast                                                             */
/* ------------------------------------------------------------------ */

export interface EngineInput {
  profile: Demographics;
  periodDays: ISODate[];
  today: ISODate;
}

function buildCycle(
  periodStart: ISODate,
  originalStart: ISODate,
  cycleLen: number,
  periodLen: number,
  sd: number,
  index: number,
  previousStart: ISODate,
): PredictedCycle {
  // Ovulation is placed from the *expected* start, not a late-shifted one.
  const earliestOvulation = addDays(previousStart, Math.min(periodLen + 1, cycleLen - 1));
  let ovulation = addDays(originalStart, -ENGINE.LUTEAL_LENGTH);
  if (ovulation < earliestOvulation) ovulation = earliestOvulation;
  return {
    periodStart,
    periodEnd: addDays(periodStart, periodLen - 1),
    ovulation,
    fertileStart: addDays(ovulation, -ENGINE.FERTILE_BEFORE),
    fertileEnd: addDays(ovulation, ENGINE.FERTILE_AFTER),
    uncertaintyDays: clamp(Math.round(sd * Math.sqrt(index + 1)), 1, 10),
  };
}

export function predict({ profile, periodDays, today }: EngineInput): Prediction {
  const periods = derivePeriods(periodDays, today);
  const lastPeriod = periods[periods.length - 1] ?? null;

  // --- cycle length model
  const priorSd = ageVariancePrior(profile.age);
  const cycleModel = shrink(observedCycleLengths(periods), profile.typicalCycleLength, priorSd);
  const cycleLen = clamp(Math.round(cycleModel.mean), 18, 50);

  // --- period length model (exclude a possibly unfinished period)
  const finished = periods.filter((p) => !p.ongoing).map((p) => diffDays(p.endDate, p.startDate) + 1);
  const periodModel = shrink(finished, profile.typicalPeriodLength, 1.2);
  const periodLen = clamp(Math.round(periodModel.mean), 2, 10);

  const { confidence, reason } = describeConfidence(cycleModel.n, cycleModel.sd, profile.age);

  const horizonEnd = endOfMonth(addMonths(today, 1));
  const cycles: PredictedCycle[] = [];
  let isLate = false;
  let daysLate = 0;

  if (lastPeriod) {
    let expected = addDays(lastPeriod.startDate, cycleLen);
    let start = expected;
    let previous = lastPeriod.startDate;

    // Period overdue and nothing new logged → it is expected any day now.
    if (!lastPeriod.ongoing && start < today) {
      isLate = true;
      daysLate = diffDays(today, start);
      start = today;
    }

    for (let i = 0; start <= horizonEnd && i < 8; i++) {
      cycles.push(buildCycle(start, expected, cycleLen, periodLen, cycleModel.sd, i, previous));
      previous = start;
      start = addDays(start, cycleLen);
      expected = start;
    }
  }

  const monthNow = startOfMonth(today);
  const monthNext = addMonths(today, 1);
  return {
    generatedFor: today,
    averageCycleLength: round1(cycleModel.mean),
    averagePeriodLength: round1(periodModel.mean),
    variability: round1(cycleModel.sd),
    cyclesUsed: cycleModel.n,
    confidence,
    confidenceReason: reason,
    lastPeriod,
    isLate,
    daysLate,
    cycles,
    currentMonth: cycles.find((c) => sameMonth(c.periodStart, monthNow)) ?? null,
    currentMonthLogged: [...periods].reverse().find((p) => sameMonth(p.startDate, monthNow)) ?? null,
    nextMonth: cycles.find((c) => sameMonth(c.periodStart, monthNext)) ?? null,
  };
}

/* ------------------------------------------------------------------ */
/* Where am I today?                                                    */
/* ------------------------------------------------------------------ */

export function getCycleStatus(prediction: Prediction, periodDays: ISODate[], today: ISODate): CycleStatus {
  const last = prediction.lastPeriod;
  const next = prediction.cycles[0];
  if (!last || last.startDate > today) {
    return { cycleDay: null, phase: null, daysUntilNextPeriod: null, onPeriod: false, inFertileWindow: false };
  }

  const cycleDay = diffDays(today, last.startDate) + 1;
  const onPeriod = periodDays.includes(today) || (last.ongoing && isBetween(today, last.startDate, addDays(last.startDate, 9)));
  const inFertileWindow = !!next && isBetween(today, next.fertileStart, next.fertileEnd);

  let phase: CyclePhase;
  if (onPeriod || cycleDay <= Math.round(prediction.averagePeriodLength)) phase = 'menstrual';
  else if (next && isBetween(today, addDays(next.ovulation, -2), addDays(next.ovulation, 1))) phase = 'ovulatory';
  else if (next && today < next.ovulation) phase = 'follicular';
  else phase = 'luteal';

  return {
    cycleDay,
    phase,
    daysUntilNextPeriod: next ? diffDays(next.periodStart, today) : null,
    onPeriod,
    inFertileWindow,
  };
}

/* ------------------------------------------------------------------ */
/* Calendar helpers                                                     */
/* ------------------------------------------------------------------ */

export type DayKind = 'period' | 'predicted' | 'ovulation' | 'fertile' | null;

/** Classify any calendar day for display. Logged data always beats predictions. */
export function classifyDay(day: ISODate, prediction: Prediction | null, periodSet: Set<ISODate>, today: ISODate): DayKind {
  if (periodSet.has(day)) return 'period';
  if (!prediction) return null;
  for (const c of prediction.cycles) {
    if (day >= today && isBetween(day, c.periodStart, c.periodEnd)) return 'predicted';
    if (day === c.ovulation) return 'ovulation';
    if (isBetween(day, c.fertileStart, c.fertileEnd)) return 'fertile';
  }
  return null;
}
