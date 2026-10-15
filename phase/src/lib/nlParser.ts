/**
 * Natural-language log parser.
 *
 * Turns free text such as "I have super bad cramps and feel anxious today"
 * into a structured partial log ({ cramps: 'severe', moods: ['anxious'] }).
 *
 * Runs fully on-device with no network calls: a lexicon of symptom phrases,
 * intensity modifiers scoped to the clause around each match, and negation
 * detection ("no cramps", "not anxious", "headache is gone").
 */
import type {
  CrampSeverity,
  FlowIntensity,
  HeadacheStatus,
  Mood,
  ParsedLog,
  Severity,
  StressLevel,
  WorkoutIntensity,
  Discharge,
} from '../types';

type Intensity = 'mild' | 'moderate' | 'severe';

const INTENSITY: Record<Intensity, RegExp> = {
  severe: /\b(super|very|really|so|extremely|terribl[ey]|awful(ly)?|horrible|horribly|unbearabl[ey]|excruciating|severe(ly)?|intense|insane(ly)?|crazy|worst|killing me|brutal|debilitating|agoni[sz]ing)\b/,
  moderate: /\b(bad|pretty|quite|moderate(ly)?|fairly|decent(ly)?|noticeable|annoying|achy|sore)\b/,
  mild: /\b(mild(ly)?|slight(ly)?|a (little|bit)|little|light(ly)?|minor|faint|kinda|kind of|somewhat|barely)\b/,
};

const NEGATION = /\b(no|not|never|without|zero|don'?t|didn'?t|doesn'?t|isn'?t|aren'?t|wasn'?t|haven'?t|hardly any|free of)\b(?:\s+\w+){0,2}\s*$/;
const RESOLVED_AFTER = /^\s*(is|are|has|have)?\s*(gone|better|over|easing|eased|stopped|went away)/;

interface Hit {
  index: number;
  length: number;
}

/** Split into clauses so "bad cramps but calm" scopes "bad" to the cramps only. */
function clauses(text: string): string[] {
  return text
    .split(/[.,;!?\n]|\b(?:but|and|although|though|while|however|also|plus)\b/)
    .map((c) => c.trim())
    .filter(Boolean);
}

function find(clause: string, pattern: RegExp): Hit | null {
  const m = pattern.exec(clause);
  return m ? { index: m.index, length: m[0].length } : null;
}

function isNegated(clause: string, hit: Hit): boolean {
  const before = clause.slice(Math.max(0, hit.index - 30), hit.index);
  const after = clause.slice(hit.index + hit.length, hit.index + hit.length + 25);
  return NEGATION.test(before) || RESOLVED_AFTER.test(after);
}

function intensityIn(clause: string): Intensity | null {
  if (INTENSITY.severe.test(clause)) {
    // "really mild" → mild still wins over "really".
    return INTENSITY.mild.test(clause) ? 'mild' : 'severe';
  }
  if (INTENSITY.mild.test(clause)) return 'mild';
  if (INTENSITY.moderate.test(clause)) return 'moderate';
  return null;
}

const label = (s: string) => s.charAt(0).toUpperCase() + s.slice(1).replace('_', ' ');

/* ------------------------------------------------------------------ */
/* Lexicon                                                              */
/* ------------------------------------------------------------------ */

const CRAMPS = /\b(cramp(s|ing|y)?|period pains?|menstrual pain|(lower )?(belly|stomach|tummy|abdominal|uterus|uterine|pelvic) (pain|ache|aches|hurts?)|(belly|stomach|tummy) (is )?(killing|hurting))\b/;
const MIGRAINE = /\b(migraines?|aura)\b/;
const HEADACHE = /\b(headaches?|head ?aches?|head (hurts|is pounding|pounding|pain)|throbbing head)\b/;
const FATIGUE = /\b(tired|exhausted|fatigued?|drained|sleepy|wiped( out)?|low energy|no energy|lethargic|worn out|knackered)\b/;
const ACNE = /\b(acne|breakouts?|broke out|breaking out|pimples?|spots on my|zits?)\b/;

const MOODS: Record<Mood, RegExp> = {
  anxious: /\b(anxious|anxiety|nervous|worried|panick?(y|ing|ed)?|on edge|uneasy|jittery|restless)\b/,
  sad: /\b(sad|(?:feel(?:ing)?|so|really|bit) down|low mood|depressed|blue|teary|tearful|crying|cried|weepy|emotional|lonely|hopeless)\b/,
  irritable: /\b(irritable|irritated|angry|annoyed|cranky|grumpy|snappy|moody|frustrated|short[- ]tempered|rage|mad)\b/,
  calm: /\b(calm|relaxed|chill|peaceful|content|fine|okay|ok|balanced|at ease)\b/,
  energetic: /\b(energetic|energi[sz]ed|great|amazing|motivated|productive|happy|good|upbeat|full of energy|lots of energy)\b/,
};

const FLOW: [FlowIntensity, RegExp][] = [
  ['spotting', /\b(spotting|spotted|spots of blood|brown discharge)\b/],
  ['heavy', /\b(heavy (flow|bleeding|period|day)|bleeding (a lot|heavily|through)|flooding|soaked|clots?)\b/],
  ['light', /\b(light (flow|bleeding|period|day)|bleeding (lightly|a little))\b/],
  ['medium', /\b(medium|moderate|normal|regular) (flow|bleeding|period)\b/],
];

const PERIOD_START = /\b(period (started|came|arrived|began|is here)|got my period|on my period|started bleeding|first day of (my )?period|aunt flo|time of the month|i'?m bleeding|bleeding today)\b/;
const PERIOD_NEGATED = /\b(no period|period (hasn'?t|didn'?t|has not|did not)|not on my period|period ended|period is over|finished my period)\b/;

const DISCHARGE: [Discharge, RegExp][] = [
  ['egg_white', /\b(egg[- ]?white|stretchy|slippery) (discharge|mucus|cm)?/],
  ['watery', /\b(watery|wet) (discharge|mucus)/],
  ['creamy', /\b(creamy|lotion[- ]like|milky) (discharge|mucus)?/],
  ['sticky', /\b(sticky|tacky|pasty|dry) (discharge|mucus)/],
];

const WORKOUTS: [WorkoutIntensity, RegExp][] = [
  ['intense', /\b(hiit|intense (workout|run|session|training)|crossfit|heavy lifting|sprints?|long run|hard workout)\b/],
  ['moderate', /\b(ran|run|running|jog(ged|ging)?|gym|worked out|workout|lifted|cycling|cycled|swam|swimming|spin class|pilates)\b/],
  ['light', /\b(walk(ed)?|stretch(ed|ing)?|yoga|light workout|easy workout)\b/],
  ['rest', /\b(rest day|no workout|didn'?t work ?out|skipped (the )?gym)\b/],
];

const WORD_NUMBERS: Record<string, number> = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12,
};
const NUM = '(\\d+(?:\\.\\d+)?|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)';
const toNum = (s: string) => WORD_NUMBERS[s] ?? Number(s);

/* ------------------------------------------------------------------ */
/* Parser                                                               */
/* ------------------------------------------------------------------ */

export function parseNaturalLog(input: string): ParsedLog {
  const text = input.toLowerCase().replace(/[’']/g, "'");
  const result: ParsedLog = { symptoms: {}, lifestyle: {}, understood: [] };
  const moods = new Set<Mood>();

  for (const clause of clauses(text)) {
    // --- cramps
    const cramp = find(clause, CRAMPS);
    if (cramp) {
      const level: CrampSeverity = isNegated(clause, cramp) ? 'none' : intensityIn(clause) ?? 'moderate';
      result.symptoms.cramps = level;
    }

    // --- headache
    const mig = find(clause, MIGRAINE);
    const head = find(clause, HEADACHE);
    if (mig) {
      result.symptoms.headache = isNegated(clause, mig) ? 'none' : 'migraine';
    } else if (head) {
      const severe = intensityIn(clause) === 'severe';
      const status: HeadacheStatus = isNegated(clause, head) ? 'none' : severe ? 'migraine' : 'dull';
      result.symptoms.headache = status;
    }

    // --- fatigue
    const fat = find(clause, FATIGUE);
    if (fat) {
      const level: Severity = isNegated(clause, fat) ? 'none' : intensityIn(clause) ?? 'moderate';
      result.symptoms.fatigue = level;
    }

    // --- acne
    const acne = find(clause, ACNE);
    if (acne) result.symptoms.acne = isNegated(clause, acne) ? 'none' : intensityIn(clause) ?? 'mild';

    // --- bloating, tender breasts, cravings
    const bloat = find(clause, /\b(bloat(ed|ing)?|puffy|swollen belly)\b/);
    if (bloat) result.symptoms.bloating = !isNegated(clause, bloat);
    const breasts = find(clause, /\b((sore|tender|painful|swollen) (breasts?|boobs?|chest)|(breasts?|boobs?) (are |feel )?(sore|tender|hurt|painful))\b/);
    if (breasts) result.symptoms.tenderBreasts = !isNegated(clause, breasts);
    const crave = find(clause, /\b(crav(ing|ings|e)|want(ing)? (chocolate|sugar|sweets|carbs|salty))\b/);
    if (crave) result.symptoms.cravings = !isNegated(clause, crave);

    // --- moods
    for (const [mood, re] of Object.entries(MOODS) as [Mood, RegExp][]) {
      const hit = find(clause, re);
      if (!hit || isNegated(clause, hit)) continue;
      // "good"/"fine"/"ok" are weak signals — skip them if they describe a symptom ("cramps are fine now").
      if ((mood === 'calm' || mood === 'energetic') && (cramp || head || mig)) continue;
      moods.add(mood);
    }

    // --- stress
    const stress = /\b(stress(ed|ful)?|overwhelmed|under pressure|burn(ed|t) out)\b/.exec(clause);
    if (stress) {
      const neg = isNegated(clause, { index: stress.index, length: stress[0].length });
      const lvl = intensityIn(clause);
      const value: StressLevel = neg ? 'low' : lvl === 'severe' || /overwhelmed|burn/.test(stress[0]) ? 'high' : lvl === 'mild' ? 'low' : 'medium';
      result.lifestyle.stress = value;
    }
  }

  // --- whole-text patterns (not clause-scoped)
  if (PERIOD_NEGATED.test(text)) result.isPeriodDay = false;
  else if (PERIOD_START.test(text)) result.isPeriodDay = true;

  for (const [flow, re] of FLOW) {
    if (re.test(text)) {
      result.flow = flow;
      if (flow !== 'spotting') result.isPeriodDay ??= true;
      break;
    }
  }

  for (const [d, re] of DISCHARGE) {
    if (re.test(text)) {
      result.symptoms.discharge = d;
      break;
    }
  }

  for (const [w, re] of WORKOUTS) {
    if (re.test(text)) {
      result.lifestyle.workout = w;
      break;
    }
  }

  const sleep = new RegExp(`\\b(?:slept|sleep|got)\\s+(?:only\\s+|about\\s+|around\\s+|like\\s+)?${NUM}\\s*(?:hours?|hrs?|h)\\b`).exec(text)
    ?? new RegExp(`\\b${NUM}\\s*(?:hours?|hrs?|h)\\s+(?:of\\s+)?sleep\\b`).exec(text);
  if (sleep) {
    const hours = toNum(sleep[1]);
    if (hours > 0 && hours <= 16) result.lifestyle.sleepHours = hours;
  } else if (/\b(couldn'?t sleep|insomnia|barely slept|slept badly|bad sleep|no sleep)\b/.test(text)) {
    result.lifestyle.sleepHours = 4;
  }

  const water = new RegExp(`\\b${NUM}\\s*(?:glasses|cups|bottles)\\s+(?:of\\s+)?water\\b`).exec(text);
  if (water) {
    const isBottle = /bottles/.test(water[0]);
    const glasses = Math.round(toNum(water[1]) * (isBottle ? 2 : 1));
    if (glasses >= 0 && glasses <= 30) result.lifestyle.waterGlasses = glasses;
  }

  const temp = /\b(?:bbt|temp(?:erature)?|basal)\D{0,12}(\d{2,3}(?:\.\d{1,2})?)\s*°?\s*([cf])?\b/.exec(text);
  if (temp) {
    let value = Number(temp[1]);
    const unit = temp[2] ?? (value > 45 ? 'f' : 'c');
    if (unit === 'f') value = (value - 32) * (5 / 9);
    if (value >= 34 && value <= 40) result.symptoms.bbt = Math.round(value * 100) / 100;
  }

  const meds = /\b(?:took|taking|had)\s+(?:an?\s+|some\s+|my\s+)?(ibuprofen|advil|motrin|naproxen|aleve|paracetamol|tylenol|acetaminophen|midol|aspirin|iron(?: supplements?)?|magnesium)\b/.exec(text);
  if (meds) result.lifestyle.medications = [meds[1]];

  if (moods.size) result.symptoms.moods = [...moods];

  // --- human-readable summary chips
  const u = result.understood;
  if (result.isPeriodDay === true) u.push('Period day');
  if (result.isPeriodDay === false) u.push('Not a period day');
  if (result.flow) u.push(`Flow: ${label(result.flow)}`);
  if (result.symptoms.cramps) u.push(`Cramps: ${label(result.symptoms.cramps)}`);
  if (result.symptoms.headache) u.push(`Headache: ${label(result.symptoms.headache)}`);
  for (const m of result.symptoms.moods ?? []) u.push(`Mood: ${label(m)}`);
  if (result.symptoms.fatigue) u.push(`Fatigue: ${label(result.symptoms.fatigue)}`);
  if (result.symptoms.acne) u.push(`Acne: ${label(result.symptoms.acne)}`);
  if (result.symptoms.bloating !== undefined) u.push(`Bloating: ${result.symptoms.bloating ? 'Yes' : 'No'}`);
  if (result.symptoms.tenderBreasts !== undefined) u.push(`Tender breasts: ${result.symptoms.tenderBreasts ? 'Yes' : 'No'}`);
  if (result.symptoms.cravings !== undefined) u.push(`Cravings: ${result.symptoms.cravings ? 'Yes' : 'No'}`);
  if (result.symptoms.discharge) u.push(`Discharge: ${label(result.symptoms.discharge)}`);
  if (result.symptoms.bbt) u.push(`BBT: ${result.symptoms.bbt.toFixed(2)}°C`);
  if (result.lifestyle.stress) u.push(`Stress: ${label(result.lifestyle.stress)}`);
  if (result.lifestyle.sleepHours !== undefined) u.push(`Sleep: ${result.lifestyle.sleepHours}h`);
  if (result.lifestyle.waterGlasses !== undefined) u.push(`Water: ${result.lifestyle.waterGlasses} glasses`);
  if (result.lifestyle.workout) u.push(`Workout: ${label(result.lifestyle.workout)}`);
  if (result.lifestyle.medications?.length) u.push(`Meds: ${result.lifestyle.medications.join(', ')}`);

  return result;
}
