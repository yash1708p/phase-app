/**
 * Daily Insight engine.
 *
 * Writes a short, conversational note that connects where the user is in
 * their cycle with what they've logged recently and with patterns from their
 * own past cycles. Runs on-device; nothing leaves the phone.
 *
 * Copy is deliberately hedged ("might", "often") — these are common
 * physiological associations, not diagnoses.
 */
import type { CyclePhase, CycleStatus, DailyLog, ISODate, Prediction } from '../types';
import { addDays, diffDays } from './dates';
import { derivePeriods } from './predictionEngine';

export interface Insight {
  title: string;
  body: string;
  /** Optional "heads-up" from the user's own history. */
  pattern?: string;
  phase: CyclePhase | null;
}

export const PHASE_COPY: Record<CyclePhase, { name: string; hormones: string; feel: string }> = {
  menstrual: {
    name: 'Menstrual phase',
    hormones: 'Estrogen and progesterone are at their lowest, and prostaglandins are helping your uterus shed its lining.',
    feel: 'Lower energy and cramps are common now — rest counts as progress.',
  },
  follicular: {
    name: 'Follicular phase',
    hormones: 'Estrogen is climbing as a follicle matures.',
    feel: 'Many people notice energy, focus and mood lifting a little each day.',
  },
  ovulatory: {
    name: 'Ovulation window',
    hormones: 'Estrogen is peaking and an LH surge triggers ovulation.',
    feel: 'You might feel social and confident, notice clearer, stretchier discharge, or a brief one-sided twinge.',
  },
  luteal: {
    name: 'Luteal phase',
    hormones: 'Progesterone rises after ovulation, then both hormones fall in the days before your period.',
    feel: 'Bloating, cravings, tender breasts, headaches or a shorter fuse can show up, especially late in this phase.',
  },
};

export type Signal = 'cramps' | 'headache' | 'migraine' | 'anxious' | 'sad' | 'irritable' | 'fatigue' | 'acne' | 'energetic';

/** Extract notable signals from a log. */
function signals(log: DailyLog | undefined): Signal[] {
  if (!log) return [];
  const s = log.symptoms;
  const out: Signal[] = [];
  if (s.cramps === 'moderate' || s.cramps === 'severe') out.push('cramps');
  if (s.headache === 'migraine') out.push('migraine');
  else if (s.headache === 'dull') out.push('headache');
  if (s.fatigue === 'moderate' || s.fatigue === 'severe') out.push('fatigue');
  if (s.acne && s.acne !== 'none') out.push('acne');
  for (const m of s.moods) if (m === 'anxious' || m === 'sad' || m === 'irritable' || m === 'energetic') out.push(m);
  return out;
}

/** Used after "you logged …", e.g. "you logged a headache". */
const SIGNAL_TEXT: Record<Signal, string> = {
  cramps: 'cramps',
  headache: 'a headache',
  migraine: 'a migraine',
  anxious: 'anxiety',
  sad: 'a low mood',
  irritable: 'irritability',
  fatigue: 'low energy',
  acne: 'breakouts',
  energetic: 'high energy',
};

/** Used after "the …", e.g. "the headache you logged yesterday". */
const SIGNAL_NOUN: Record<Signal, string> = {
  cramps: 'cramps',
  headache: 'headache',
  migraine: 'migraine',
  anxious: 'anxiety',
  sad: 'low mood',
  irritable: 'irritability',
  fatigue: 'low energy',
  acne: 'breakouts',
  energetic: 'boost in energy',
};

/** Phase-specific explanation for why a logged signal might be showing up. */
function explain(signal: Signal, phase: CyclePhase, lateLuteal: boolean): string | null {
  switch (signal) {
    case 'cramps':
      if (phase === 'menstrual') return 'Prostaglandins make the uterus contract to shed its lining, which is what you feel as cramps.';
      if (phase === 'ovulatory') return 'Some people feel a short, one-sided cramp around ovulation (mittelschmerz).';
      return lateLuteal ? 'Pre-period cramping can start a day or two before bleeding as prostaglandins rise.' : null;
    case 'headache':
    case 'migraine':
      if (phase === 'menstrual' || lateLuteal) return 'The drop in estrogen around your period is one of the most common headache triggers.';
      if (phase === 'ovulatory') return 'The quick estrogen shift around ovulation can trigger headaches for some people.';
      return null;
    case 'anxious':
    case 'irritable':
    case 'sad':
      if (phase === 'luteal') return lateLuteal
        ? 'Falling progesterone and estrogen before a period can affect serotonin, which often shows up as a shorter fuse or a heavier mood.'
        : 'Shifting progesterone in this phase can make emotions feel louder than usual.';
      if (phase === 'menstrual') return 'Low hormone levels plus pain and poor sleep can all weigh on mood in the first days.';
      return null;
    case 'fatigue':
      if (phase === 'menstrual') return 'Blood loss and low hormone levels can leave you more tired than usual.';
      if (phase === 'luteal') return 'Progesterone has a mildly sedating effect and nudges your body temperature up, which can affect sleep.';
      return null;
    case 'acne':
      if (phase === 'luteal' || phase === 'menstrual') return 'Relative androgen levels rise before your period, which can increase oil and breakouts.';
      return null;
    case 'energetic':
      if (phase === 'follicular' || phase === 'ovulatory') return 'Rising estrogen tends to lift energy and motivation — a good match for what you logged.';
      return null;
  }
}

export interface PatternMatch {
  signal: Signal;
  /** Cycles (of `total`) in which the signal appeared around this cycle day. */
  count: number;
  total: number;
  /** Cycle day the pattern applies to. */
  cycleDay: number;
  /** 0 = today, 1 = tomorrow, … */
  ahead: number;
  /** e.g. "cramps", "a headache" */
  text: string;
}

/** Find a signal that recurred on the same cycle day (±1) in most recent past cycles. */
export function matchPattern(logs: Record<ISODate, DailyLog>, periodDays: ISODate[], today: ISODate, aheadDays: number[]): PatternMatch | null {
  const periods = derivePeriods(periodDays, today);
  const current = periods.filter((p) => p.startDate <= today).at(-1);
  if (!current) return null;
  const past = periods.filter((p) => p.startDate < current.startDate).slice(-3); // up to 3 cycles before the current one
  if (past.length < 2) return null;

  const todayDay = diffDays(today, current.startDate) + 1;
  for (const ahead of aheadDays) {
    const target = todayDay + ahead;
    const counts = new Map<Signal, number>();
    for (const p of past) {
      const seen = new Set<Signal>();
      for (let d = -1; d <= 1; d++) {
        const date = addDays(p.startDate, target - 1 + d);
        for (const s of signals(logs[date])) seen.add(s);
      }
      for (const s of seen) counts.set(s, (counts.get(s) ?? 0) + 1);
    }
    const best = [...counts.entries()].filter(([s]) => s !== 'energetic').sort((a, b) => b[1] - a[1])[0];
    if (best && best[1] >= 2 && best[1] / past.length >= 0.66) {
      return { signal: best[0], count: best[1], total: past.length, cycleDay: target, ahead, text: SIGNAL_TEXT[best[0]] };
    }
  }
  return null;
}

/**
 * Look for a recurring signal on the same cycle day (±1) across past cycles.
 * Returns e.g. "Heads-up: in 3 of your last 3 cycles, you logged cramps around cycle day 1, which is today."
 */
export function findPattern(logs: Record<ISODate, DailyLog>, periodDays: ISODate[], today: ISODate, lookAheadDays = 2): string | null {
  const m = matchPattern(logs, periodDays, today, Array.from({ length: lookAheadDays + 1 }, (_, i) => i));
  if (!m) return null;
  const when = m.ahead === 0 ? 'today' : m.ahead === 1 ? 'tomorrow' : `in ${m.ahead} days`;
  return `Heads-up: in ${m.count} of your last ${m.total} cycles, you logged ${m.text} around cycle day ${m.cycleDay}, which is ${when}.`;
}

export function generateInsight(args: {
  status: CycleStatus;
  prediction: Prediction | null;
  logs: Record<ISODate, DailyLog>;
  periodDays: ISODate[];
  today: ISODate;
}): Insight {
  const { status, prediction, logs, periodDays, today } = args;

  if (!status.phase || !prediction) {
    return {
      title: 'Welcome to Phase',
      body: 'Log your period and how you feel, and your daily insight will get more personal with every cycle.',
      phase: null,
    };
  }

  const phase = status.phase;
  const copy = PHASE_COPY[phase];
  const lateLuteal = phase === 'luteal' && status.daysUntilNextPeriod !== null && status.daysUntilNextPeriod <= 5;

  const todayLog = logs[today];
  const yesterdayLog = logs[addDays(today, -1)];
  const recent = signals(todayLog).length ? { log: todayLog, when: 'today' } : { log: yesterdayLog, when: 'yesterday' };
  const recentSignals = signals(recent.log);

  const dayLabel = status.cycleDay ? `cycle day ${status.cycleDay}` : '';
  let title = `${copy.name}${dayLabel ? ` · ${dayLabel}` : ''}`;
  if (prediction.isLate) title = `Period ${prediction.daysLate === 1 ? '1 day' : `${prediction.daysLate} days`} later than expected`;

  let body: string;
  const explained = recentSignals
    .map((s) => ({ s, why: explain(s, phase, lateLuteal) }))
    .filter((x): x is { s: Signal; why: string } => !!x.why);

  if (explained.length) {
    const names = explained.slice(0, 2).map((x) => SIGNAL_NOUN[x.s]);
    const list = names.length === 2 ? `${names[0]} and ${names[1]}` : names[0];
    body = `You’re in your ${copy.name.toLowerCase()}. ${copy.hormones} That might be behind the ${list} you logged ${recent.when}. ${explained[0].why}`;
  } else if (recentSignals.length) {
    body = `You’re in your ${copy.name.toLowerCase()}. ${copy.hormones} The ${SIGNAL_NOUN[recentSignals[0]]} you logged ${recent.when} isn’t strongly tied to this phase — sleep, stress and food can all play a part too.`;
  } else {
    body = `You’re in your ${copy.name.toLowerCase()}. ${copy.hormones} ${copy.feel}`;
  }

  if (prediction.isLate) {
    body = `Cycles can shift for many reasons — stress, travel, illness or sleep changes. Log the day it starts and Phase will relearn your rhythm. ${
      prediction.daysLate >= 7 ? 'If you could be pregnant or it’s unusual for you, a test or a chat with a clinician can bring peace of mind.' : ''
    }`.trim();
  } else if (lateLuteal && status.daysUntilNextPeriod !== null) {
    body += ` Your period is expected ${status.daysUntilNextPeriod <= 1 ? 'within a day or so' : `in about ${status.daysUntilNextPeriod} days`}.`;
  }

  return {
    title,
    body,
    pattern: findPattern(logs, periodDays, today) ?? undefined,
    phase,
  };
}
