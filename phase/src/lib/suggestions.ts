/**
 * Personal daily suggestions.
 *
 * Turns today's phase and recent logs into concrete, doable actions:
 * how much water to drink, how many hours to rest, what kind of movement
 * fits, food ideas for the phase, and relief for logged symptoms.
 * Everything is general wellbeing guidance, never medication dosing.
 */
import type { CycleFinding, CycleStatus, DailyLog, Demographics, ISODate, Suggestion } from '../types';
import { addDays } from './dates';

export const GLASS_ML = 250;

/** Daily water goal in glasses (~250 ml), adjusted for phase and activity. */
export function waterTarget(status: CycleStatus, log: DailyLog | undefined): number {
  let target = 8;
  if (status.phase === 'menstrual') target += 1;
  if (log?.lifestyle.workout === 'moderate' || log?.lifestyle.workout === 'intense') target += 1;
  if (log?.symptoms.headache && log.symptoms.headache !== 'none') target += 1;
  return Math.min(target, 12);
}

/** Recommended hours of sleep tonight. */
export function sleepTarget(profile: Demographics, status: CycleStatus, recent: DailyLog[]): number {
  let target = profile.age < 18 ? 9 : 8;
  const tired = recent.some((l) => l.symptoms.fatigue === 'moderate' || l.symptoms.fatigue === 'severe');
  const lateLuteal = status.phase === 'luteal' && (status.daysUntilNextPeriod ?? 99) <= 5;
  if (tired && (status.phase === 'menstrual' || lateLuteal)) target += 0.5;
  // Pay back some sleep debt from the last few nights (max +1h).
  const nights = recent.map((l) => l.lifestyle.sleepHours).filter((h): h is number => h !== undefined);
  if (nights.length) {
    const debt = nights.reduce((a, h) => a + Math.max(0, target - h), 0);
    target += Math.min(1, Math.round((debt / 3) * 2) / 2);
  }
  return Math.min(target, profile.age < 18 ? 10.5 : 10);
}

const fmtHours = (h: number) => (Number.isInteger(h) ? `${h}` : `${Math.floor(h)}½`);

export function generateSuggestions(args: {
  profile: Demographics;
  status: CycleStatus;
  logs: Record<ISODate, DailyLog>;
  today: ISODate;
  findings?: CycleFinding[];
}): Suggestion[] {
  const { profile, status, logs, today, findings = [] } = args;
  const todayLog = logs[today];
  const yesterday = logs[addDays(today, -1)];
  const recent = [todayLog, yesterday, logs[addDays(today, -2)]].filter((l): l is DailyLog => !!l);
  const latest = todayLog ?? yesterday;
  const sym = latest?.symptoms;
  const phase = status.phase;
  const out: Suggestion[] = [];
  const add = (s: Suggestion) => out.push(s);

  /* ---- Hydration */
  const goal = waterTarget(status, todayLog);
  const drank = todayLog?.lifestyle.waterGlasses;
  if (drank === undefined) {
    add({
      id: 'water-goal',
      category: 'hydration',
      title: `Aim for ${goal} glasses of water today`,
      detail: `That’s about ${((goal * GLASS_ML) / 1000).toFixed(1)} L.${phase === 'menstrual' ? ' A little extra helps replace fluids during your period.' : ''}${
        sym?.bloating ? ' It sounds backwards, but drinking more water helps ease bloating.' : ''
      }`,
      priority: sym?.headache && sym.headache !== 'none' ? 75 : 45,
    });
  } else if (drank < goal) {
    const more = goal - drank;
    add({
      id: 'water-more',
      category: 'hydration',
      title: `Drink ${more} more ${more === 1 ? 'glass' : 'glasses'} of water today`,
      detail: `You’ve logged ${drank} of ${goal}. ${drank < 5 ? 'Water intake looks low — staying hydrated can ease bloating and headaches.' : 'Keep a bottle nearby to make it easy.'}`,
      priority: drank < 5 ? 85 : 60,
    });
  } else {
    add({ id: 'water-done', category: 'hydration', title: 'Water goal reached 🎉', detail: `${drank} glasses logged today — nicely done.`, priority: 5 });
  }

  /* ---- Rest & sleep */
  const sleepGoal = sleepTarget(profile, status, recent);
  const lastNight = todayLog?.lifestyle.sleepHours ?? yesterday?.lifestyle.sleepHours;
  if (lastNight !== undefined && lastNight < sleepGoal - 0.5) {
    add({
      id: 'sleep-short',
      category: 'rest',
      title: `Aim for ${fmtHours(sleepGoal)} hours of sleep tonight`,
      detail: `You logged ${lastNight}h. Short sleep can amplify cramps and mood dips${lastNight < 6 ? ' — an earlier night could really help' : ''}. Try winding down ${
        sleepGoal - lastNight >= 1.5 ? 'an hour' : '30 minutes'
      } earlier than usual.`,
      priority: lastNight < 6 ? 88 : 65,
    });
  } else {
    add({
      id: 'sleep-goal',
      category: 'rest',
      title: `Aim for ${fmtHours(sleepGoal)} hours of sleep tonight`,
      detail: phase === 'luteal' ? 'Progesterone can make sleep lighter now — a cool, dark room and a steady bedtime help.' : 'A consistent bedtime keeps energy and mood steadier across your cycle.',
      priority: 30,
    });
  }
  const verySore = sym?.cramps === 'severe' || sym?.fatigue === 'severe';
  if (verySore || ((sym?.fatigue === 'moderate' || sym?.cramps === 'moderate') && phase === 'menstrual')) {
    add({
      id: 'rest-break',
      category: 'rest',
      title: verySore ? 'Schedule 30–60 minutes of proper rest today' : 'Take a 20-minute rest this afternoon',
      detail: 'Lie down with your feet up or a heat pad on your belly. Rest is productive when your body is working hard.',
      priority: verySore ? 90 : 70,
    });
  }

  /* ---- Movement */
  const hardYesterday = yesterday?.lifestyle.workout === 'intense';
  if (hardYesterday && sym?.fatigue && sym.fatigue !== 'none') {
    add({ id: 'move-rest', category: 'movement', title: 'Make today a rest day', detail: 'You trained hard yesterday and logged fatigue. Recovery is where fitness is built.', priority: 55 });
  } else if (phase === 'menstrual') {
    add({
      id: 'move-gentle',
      category: 'movement',
      title: 'Try 20–30 minutes of gentle movement',
      detail: 'A walk, stretching or easy yoga boosts blood flow and can ease cramps. Skip intense training if you don’t feel up to it.',
      priority: sym?.cramps && sym.cramps !== 'none' ? 58 : 35,
    });
  } else if (phase === 'follicular' || phase === 'ovulatory') {
    add({
      id: 'move-strong',
      category: 'movement',
      title: phase === 'ovulatory' ? 'Energy tends to peak now' : 'A good window for a harder workout',
      detail: 'Rising estrogen supports strength and recovery — try strength training, intervals or something new if you feel like it.',
      priority: 25,
    });
  } else if (phase === 'luteal') {
    add({ id: 'move-steady', category: 'movement', title: 'Keep movement steady and moderate', detail: 'Walking, Pilates, swimming or cycling can lift mood and reduce bloating before your period.', priority: 28 });
  }

  /* ---- Nutrition (always includes the phase food tip) */
  const food: Record<string, string> = {
    menstrual: 'Iron-rich foods (lentils, spinach, beans, red meat or tofu) paired with vitamin C help replace the iron you lose. Warmth on your lower belly and gentle movement are your friends today.',
    follicular: 'Fresh, fibre-rich foods and lean protein support your rising energy. Fermented foods and colourful veggies are great now.',
    ovulatory: 'Leafy greens, whole grains and plenty of fibre help your body process the estrogen peak.',
    luteal: 'Complex carbs, magnesium-rich foods and steady sleep can soften pre-period symptoms. Think oats, sweet potatoes, dark chocolate, nuts and seeds.',
  };
  if (phase) {
    add({ id: 'food-phase', category: 'nutrition', title: 'Eat for your phase', detail: food[phase], priority: 40 });
  }
  if (sym?.cravings) {
    add({ id: 'food-cravings', category: 'nutrition', title: 'Pair cravings with protein', detail: 'Cravings are common before a period. Pair sweets with protein or fibre (like yogurt and berries) to keep your blood sugar steadier.', priority: 50 });
  }
  if (sym?.bloating) {
    add({ id: 'food-bloat', category: 'nutrition', title: 'Go easy on salt today', detail: 'Lower-salt meals, potassium-rich foods (bananas, avocado) and water can ease bloating.', priority: 52 });
  }

  /* ---- Relief for logged symptoms */
  if (sym?.cramps && sym.cramps !== 'none') {
    add({
      id: 'relief-cramps',
      category: 'relief',
      title: 'Ease cramps with heat',
      detail: 'A heat pad or warm bath for 15–20 minutes relaxes the uterine muscles. If you use pain relief, follow the label — it tends to work best taken early.',
      priority: sym.cramps === 'severe' ? 92 : sym.cramps === 'moderate' ? 78 : 50,
    });
  }
  if (sym?.headache && sym.headache !== 'none') {
    add({
      id: 'relief-head',
      category: 'relief',
      title: sym.headache === 'migraine' ? 'Rest somewhere dark and quiet' : 'Give your head a break',
      detail: 'Drink a glass of water, dim your screens and rest your eyes for 15 minutes. Regular meals help avoid low-blood-sugar headaches.',
      priority: sym.headache === 'migraine' ? 87 : 62,
    });
  }
  if (sym?.tenderBreasts) {
    add({ id: 'relief-breasts', category: 'relief', title: 'Support tender breasts', detail: 'A soft, supportive bra and cutting back on caffeine can make a difference.', priority: 42 });
  }
  if (sym?.acne && sym.acne !== 'none') {
    add({ id: 'relief-acne', category: 'relief', title: 'Be gentle with your skin', detail: 'Cleanse twice a day, avoid picking, and change pillowcases often — pre-period breakouts usually settle after bleeding starts.', priority: 38 });
  }

  /* ---- Mind */
  const stress = latest?.lifestyle.stress;
  if (stress === 'high' || sym?.moods.includes('anxious')) {
    add({
      id: 'mind-breathe',
      category: 'mind',
      title: 'Take 5 minutes for slow breathing',
      detail: `${stress === 'high' ? 'Stress is high today. ' : ''}Breathe in for a count of four and out for six. Even five slow breaths or a short walk can take the edge off cortisol.`,
      priority: 72,
    });
  }
  if (sym?.moods.includes('sad')) {
    add({ id: 'mind-connect', category: 'mind', title: 'Reach out to someone', detail: 'A message or call with someone you like, plus 15 minutes of daylight, can lift a heavy day.', priority: 68 });
  }
  if (sym?.moods.includes('irritable')) {
    add({ id: 'mind-buffer', category: 'mind', title: 'Build in some buffer time', detail: 'Hormone shifts can give you a shorter fuse. Leave space between commitments and give yourself permission to say no.', priority: 55 });
  }

  /* ---- Care */
  if (findings.some((f) => f.level === 'talk')) {
    add({ id: 'care-findings', category: 'care', title: 'Something in your cycle is worth a look', detail: 'Open Insights → Understand your cycle to see what Phase noticed and what to do about it.', priority: 95 });
  }
  if (phase === 'ovulatory' || status.inFertileWindow) {
    add({
      id: 'care-fertile',
      category: 'care',
      title: 'You’re in your fertile window',
      detail:
        profile.primaryGoal === 'trying_to_conceive'
          ? 'This is your most fertile time — the days before ovulation matter most.'
          : 'If you’re avoiding pregnancy, Phase’s estimates are not a contraceptive method.',
      priority: profile.primaryGoal === 'trying_to_conceive' ? 80 : 33,
    });
  }

  return out.sort((a, b) => b.priority - a.priority);
}
