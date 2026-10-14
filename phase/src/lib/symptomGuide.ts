/**
 * "Understand your symptoms" knowledge base.
 *
 * For each selectable symptom: why it can show up in each cycle phase, what
 * tends to help, and the signs that mean it's worth talking to a clinician.
 */
import type { CyclePhase, DailyLog, Discharge, Mood } from '../types';

export type CheckId =
  | Mood
  | 'cramps'
  | 'headache'
  | 'fatigue'
  | 'acne'
  | 'bloating'
  | 'tenderBreasts'
  | 'cravings'
  | `discharge_${Exclude<Discharge, 'none'>}`
  | 'fine';

export interface GuideEntry {
  label: string;
  group: 'mood' | 'body' | 'discharge' | 'fine';
  why: Partial<Record<CyclePhase, string>> & { default: string };
  helps: string[];
  seeHelp?: string;
}

export const GUIDE: Record<CheckId, GuideEntry> = {
  /* ---------- mood ---------- */
  calm: {
    label: 'Calm',
    group: 'mood',
    why: { default: 'Feeling settled is great — steady sleep, movement and stable blood sugar all help keep it that way.', follicular: 'Rising estrogen tends to support a steadier, brighter mood in this phase.' },
    helps: ['Notice what’s working today (sleep, food, routine) so you can lean on it later in your cycle.'],
  },
  energetic: {
    label: 'Energetic',
    group: 'mood',
    why: {
      default: 'Energy naturally rises and falls across your cycle.',
      follicular: 'Estrogen is climbing, which boosts energy, motivation and even verbal fluency.',
      ovulatory: 'Estrogen peaks around ovulation — many people feel their most social and energetic now.',
    },
    helps: ['Great day for a harder workout or tackling something you’ve been putting off.'],
  },
  anxious: {
    label: 'Anxious',
    group: 'mood',
    why: {
      default: 'Anxiety can have many causes beyond your cycle — sleep, caffeine and stress all play a part.',
      luteal: 'Falling estrogen and progesterone before a period affect serotonin and GABA (calming brain chemicals), which can make anxiety louder.',
      menstrual: 'Low hormone levels, pain and poor sleep in the first days of your period can all heighten anxiety.',
    },
    helps: ['Breathe slowly for 5 minutes: in for a count of four, out for six.', 'Cut back on caffeine this afternoon.', 'A short walk outside.'],
    seeHelp: 'If anxiety stops you from doing everyday things, or comes with panic attacks, talk to a doctor or therapist.',
  },
  sad: {
    label: 'Sad / low',
    group: 'mood',
    why: {
      default: 'Low days happen for lots of reasons. Tracking helps you see whether they follow your cycle.',
      luteal: 'The pre-period hormone drop can lower serotonin, making things feel heavier for a few days.',
      menstrual: 'Low energy and pain can drag mood down during your period; it usually lifts as estrogen rises.',
    },
    helps: ['Get 15 minutes of daylight.', 'Reach out to someone you like.', 'Be kind to yourself — lower the bar for today.'],
    seeHelp: 'If low mood lasts more than two weeks, or you have thoughts of harming yourself, please contact a doctor, a crisis line or someone you trust right away.',
  },
  irritable: {
    label: 'Irritable',
    group: 'mood',
    why: { default: 'Irritability is one of the most common cycle-linked mood changes.', luteal: 'In the days before your period, shifting progesterone and estrogen can shorten your fuse.' },
    helps: ['Build buffer time between commitments.', 'Regular meals — low blood sugar makes irritability worse.', 'Movement to burn off tension.'],
    seeHelp: 'If mood changes before your period seriously affect relationships or work, ask about PMDD — it’s treatable.',
  },

  /* ---------- body ---------- */
  cramps: {
    label: 'Cramps',
    group: 'body',
    why: {
      default: 'Cramps come from prostaglandins that make the uterus contract.',
      menstrual: 'Prostaglandins peak in the first 1–2 days of bleeding, making the uterus contract to shed its lining.',
      ovulatory: 'A one-sided twinge around ovulation (mittelschmerz) is common and usually lasts a few hours to a day.',
      luteal: 'Cramping a day or two before your period is common as prostaglandins rise.',
    },
    helps: ['Heat pad or warm bath for 15–20 minutes.', 'Gentle movement — a walk or stretching.', 'If you use pain relief, follow the label and take it early.'],
    seeHelp: 'See a doctor if pain is severe, stops you from doing normal activities, isn’t helped by usual pain relief, or happens with fever or unusual discharge.',
  },
  headache: {
    label: 'Headache',
    group: 'body',
    why: {
      default: 'Dehydration, poor sleep, screens and skipped meals are common triggers.',
      menstrual: 'The drop in estrogen just before and during your period is one of the most common headache triggers.',
      luteal: 'Falling estrogen in the late luteal phase can trigger headaches or migraines.',
      ovulatory: 'The quick estrogen shift around ovulation triggers headaches for some people.',
    },
    helps: ['Drink a glass of water.', 'Rest in a dim, quiet room for 15 minutes.', 'Eat something if you’ve skipped a meal.'],
    seeHelp: 'Get urgent help for a sudden, severe “worst ever” headache, or one with weakness, confusion, vision loss or a stiff neck. Mention migraines with aura to your doctor if you use estrogen contraception.',
  },
  fatigue: {
    label: 'Fatigue',
    group: 'body',
    why: {
      default: 'Sleep, stress and diet all affect energy.',
      menstrual: 'Blood loss and low hormone levels can leave you more tired than usual.',
      luteal: 'Progesterone is mildly sedating and raises body temperature, which can make sleep lighter.',
    },
    helps: ['Aim for 8+ hours tonight.', 'Iron-rich food if you’re on your period.', 'A short daylight walk can be more energizing than caffeine.'],
    seeHelp: 'If you’re exhausted most days, especially with heavy periods, ask a doctor to check your iron and thyroid.',
  },
  acne: {
    label: 'Acne',
    group: 'body',
    why: {
      default: 'Skin reacts to hormones, stress and products.',
      luteal: 'Before your period, androgens are relatively higher, increasing oil production and breakouts.',
      menstrual: 'Pre-period breakouts often linger into the first days of bleeding, then settle.',
    },
    helps: ['Cleanse gently twice a day.', 'Don’t pick — it prolongs healing.', 'Change pillowcases often.'],
    seeHelp: 'Persistent acne with irregular periods or extra hair growth can be a sign of PCOS — worth mentioning to a doctor.',
  },
  bloating: {
    label: 'Bloating',
    group: 'body',
    why: { default: 'Gas, salty food and constipation can all cause bloating.', luteal: 'Progesterone slows digestion and hormone shifts cause water retention before your period.', menstrual: 'Bloating often peaks just before and on the first day of your period.' },
    helps: ['Drink more water — it reduces water retention.', 'Lower-salt meals and potassium-rich foods.', 'A gentle walk after eating.'],
    seeHelp: 'See a doctor if bloating is persistent (most days for 3+ weeks), especially with pain, feeling full quickly, or changes in bowel habits.',
  },
  tenderBreasts: {
    label: 'Tender breasts',
    group: 'body',
    why: { default: 'Breast tenderness is usually hormonal.', luteal: 'Progesterone and estrogen cause breast tissue to swell slightly before your period.' },
    helps: ['Wear a soft, supportive bra.', 'Reduce caffeine.', 'A warm or cool compress.'],
    seeHelp: 'See a doctor about a new lump, nipple discharge, skin changes, or pain in one spot that doesn’t follow your cycle.',
  },
  cravings: {
    label: 'Cravings',
    group: 'body',
    why: { default: 'Cravings can follow stress or under-eating.', luteal: 'Your metabolism rises slightly before a period, and lower serotonin can drive carb and sugar cravings.' },
    helps: ['Pair sweets with protein or fibre.', 'Eat regular meals so you’re not running on empty.', 'Dark chocolate is a magnesium-rich option.'],
  },

  /* ---------- discharge ---------- */
  discharge_sticky: {
    label: 'Sticky / dry',
    group: 'discharge',
    why: { default: 'Thick, sticky or little discharge is typical after your period and after ovulation, when estrogen is lower.' },
    helps: ['Nothing to do — this is normal.'],
  },
  discharge_creamy: {
    label: 'Creamy',
    group: 'discharge',
    why: { default: 'Creamy, lotion-like discharge is common as estrogen starts rising, and again in the luteal phase.' },
    helps: ['Nothing to do — this is normal.'],
  },
  discharge_watery: {
    label: 'Watery',
    group: 'discharge',
    why: { default: 'Wetter, watery discharge usually means estrogen is rising and ovulation is getting closer.' },
    helps: ['If you’re trying to conceive, fertile days are approaching.'],
  },
  discharge_egg_white: {
    label: 'Egg white',
    group: 'discharge',
    why: {
      default: 'Clear, stretchy “egg white” discharge is your most fertile sign — it appears around ovulation.',
      luteal: 'Egg-white discharge now suggests you may have ovulated later than Phase estimated. Phase will learn from your logs.',
      menstrual: 'Egg-white discharge is unusual at this point in your cycle, but one-offs happen.',
    },
    helps: ['If you’re trying to conceive, this is the best time.', 'If you’re avoiding pregnancy, remember that Phase is not a contraceptive method.'],
  },

  fine: {
    label: 'Everything is fine',
    group: 'fine',
    why: { default: 'Love that. Logging good days matters too — it helps Phase show you which parts of your cycle feel best.' },
    helps: ['Keep doing what you’re doing.'],
  },
};

/** General warning signs for unusual discharge, shown whenever discharge is selected. */
export const DISCHARGE_WARNING =
  'See a clinician if discharge is green, grey or yellow, smells strongly, looks like cottage cheese, or comes with itching, burning or pelvic pain.';

export const CHECK_GROUPS: { group: GuideEntry['group']; title: string }[] = [
  { group: 'mood', title: 'Mood' },
  { group: 'body', title: 'Body' },
  { group: 'discharge', title: 'Vaginal discharge' },
];

/** Read the current selection from an existing log so the checker opens pre-filled. */
export function selectionFromLog(log: DailyLog | undefined): Set<CheckId> {
  const s = new Set<CheckId>();
  if (!log) return s;
  const y = log.symptoms;
  if (y.feelingFine) s.add('fine');
  y.moods.forEach((m) => s.add(m));
  if (y.cramps && y.cramps !== 'none') s.add('cramps');
  if (y.headache && y.headache !== 'none') s.add('headache');
  if (y.fatigue && y.fatigue !== 'none') s.add('fatigue');
  if (y.acne && y.acne !== 'none') s.add('acne');
  if (y.bloating) s.add('bloating');
  if (y.tenderBreasts) s.add('tenderBreasts');
  if (y.cravings) s.add('cravings');
  if (y.discharge && y.discharge !== 'none') s.add(`discharge_${y.discharge}` as CheckId);
  return s;
}

/** Apply a selection to a log, keeping any severities already recorded. */
export function applySelection(log: DailyLog, sel: Set<CheckId>): DailyLog {
  const y = log.symptoms;
  const has = (id: CheckId) => sel.has(id);
  const keep = <T extends string>(cur: T | undefined, none: T, fallback: T): T | undefined => (cur && cur !== none ? cur : fallback);
  const discharge = [...sel].find((id) => id.startsWith('discharge_'))?.replace('discharge_', '') as Discharge | undefined;

  if (has('fine')) {
    return {
      ...log,
      symptoms: { ...y, feelingFine: true, moods: y.moods.filter((m) => m === 'calm' || m === 'energetic'), cramps: 'none', headache: 'none', fatigue: 'none', acne: 'none', bloating: false, tenderBreasts: false, cravings: false },
    };
  }
  return {
    ...log,
    symptoms: {
      ...y,
      feelingFine: false,
      moods: (['calm', 'irritable', 'sad', 'anxious', 'energetic'] as Mood[]).filter((m) => has(m)),
      cramps: has('cramps') ? keep(y.cramps, 'none', 'moderate') : y.cramps === undefined ? undefined : 'none',
      headache: has('headache') ? keep(y.headache, 'none', 'dull') : y.headache === undefined ? undefined : 'none',
      fatigue: has('fatigue') ? keep(y.fatigue, 'none', 'moderate') : y.fatigue === undefined ? undefined : 'none',
      acne: has('acne') ? keep(y.acne, 'none', 'mild') : y.acne === undefined ? undefined : 'none',
      bloating: has('bloating'),
      tenderBreasts: has('tenderBreasts'),
      cravings: has('cravings'),
      discharge: discharge ?? y.discharge,
    },
  };
}

/** Observations that only make sense for a combination of symptoms. */
export function combinedNotes(sel: Set<CheckId>, phase: CyclePhase | null): string[] {
  const notes: string[] = [];
  const pms = ['bloating', 'tenderBreasts', 'cravings', 'irritable', 'acne', 'sad', 'anxious'].filter((x) => sel.has(x as CheckId)).length;
  if (pms >= 3 && (phase === 'luteal' || phase === 'menstrual')) {
    notes.push('This mix of symptoms is a classic premenstrual pattern. It usually eases within a day or two of your period starting.');
  }
  if (sel.has('fatigue') && sel.has('cramps') && phase === 'menstrual') {
    notes.push('Cramps and tiredness together on period days are very common — give yourself permission to slow down.');
  }
  if ((sel.has('discharge_egg_white') || sel.has('discharge_watery')) && sel.has('energetic')) {
    notes.push('Fertile-type discharge and high energy are both signs that ovulation is near.');
  }
  if (sel.has('headache') && sel.has('fatigue')) {
    notes.push('Headache plus fatigue can point to dehydration or short sleep — water and an early night are a good first step.');
  }
  return notes;
}
