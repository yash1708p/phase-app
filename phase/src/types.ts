/**
 * Phase — domain models.
 *
 * Dates are stored as local calendar dates in ISO form (YYYY-MM-DD) to avoid
 * timezone drift: a period day is a calendar day, not an instant.
 */

export type ISODate = string;

/* ------------------------------------------------------------------ */
/* 1. Demographics                                                      */
/* ------------------------------------------------------------------ */

export type PrimaryGoal =
  | 'track_period'
  | 'understand_symptoms'
  | 'trying_to_conceive'
  | 'general_wellbeing';

export interface Demographics {
  /** Years. Used to set the variance prior of the prediction model. */
  age: number;
  primaryGoal: PrimaryGoal;
  /** Baseline cycle length in days (default 28). */
  typicalCycleLength: number;
  /** Baseline period duration in days (default 5). */
  typicalPeriodLength: number;
}

/* ------------------------------------------------------------------ */
/* 2. Cycle basics                                                      */
/* ------------------------------------------------------------------ */

export type FlowIntensity = 'spotting' | 'light' | 'medium' | 'heavy';

export interface CycleBasics {
  /** True if this day is a menstrual bleeding day. */
  isPeriodDay: boolean;
  flow?: FlowIntensity;
  /** Light bleeding outside of the period. */
  intermenstrualSpotting?: boolean;
}

/** A contiguous run of period days, derived from logged period days. */
export interface PeriodRecord {
  startDate: ISODate;
  endDate: ISODate;
  /** True if the period may still be going (last day is today/yesterday). */
  ongoing: boolean;
}

/* ------------------------------------------------------------------ */
/* 3. Symptoms & bio-markers                                            */
/* ------------------------------------------------------------------ */

export type CrampSeverity = 'none' | 'mild' | 'moderate' | 'severe';
export type HeadacheStatus = 'none' | 'dull' | 'migraine';
export type Mood = 'calm' | 'irritable' | 'sad' | 'anxious' | 'energetic';
export type Discharge = 'none' | 'sticky' | 'creamy' | 'watery' | 'egg_white';
export type Severity = 'none' | 'mild' | 'moderate' | 'severe';

export interface Symptoms {
  cramps?: CrampSeverity;
  headache?: HeadacheStatus;
  moods: Mood[];
  discharge?: Discharge;
  acne?: Severity;
  fatigue?: Severity;
  /** Basal body temperature in °C (always stored in Celsius). */
  bbt?: number;
  bloating?: boolean;
  tenderBreasts?: boolean;
  cravings?: boolean;
  /** User explicitly said everything feels fine today. */
  feelingFine?: boolean;
}

/* ------------------------------------------------------------------ */
/* 4. Lifestyle & activity                                              */
/* ------------------------------------------------------------------ */

export type StressLevel = 'low' | 'medium' | 'high';
export type WorkoutIntensity = 'rest' | 'light' | 'moderate' | 'intense';

export interface Lifestyle {
  sleepHours?: number;
  /** Glasses of water (~250 ml). */
  waterGlasses?: number;
  stress?: StressLevel;
  workout?: WorkoutIntensity;
  medications: string[];
  contraceptive?: string;
}

/* ------------------------------------------------------------------ */
/* Daily log — one per calendar day                                     */
/* ------------------------------------------------------------------ */

export interface DailyLog {
  date: ISODate;
  cycle: CycleBasics;
  symptoms: Symptoms;
  lifestyle: Lifestyle;
  /** Free text the user typed or dictated. */
  note?: string;
  updatedAt: number;
}

/* ------------------------------------------------------------------ */
/* Predictions                                                          */
/* ------------------------------------------------------------------ */

export type Confidence = 'low' | 'medium' | 'high';
export type CyclePhase = 'menstrual' | 'follicular' | 'ovulatory' | 'luteal';

export interface PredictedCycle {
  periodStart: ISODate;
  periodEnd: ISODate;
  /** Estimated ovulation preceding this period (≈ 14 days before it). */
  ovulation: ISODate;
  fertileStart: ISODate;
  fertileEnd: ISODate;
  /** ± days of uncertainty around periodStart. */
  uncertaintyDays: number;
}

export interface Prediction {
  generatedFor: ISODate;
  averageCycleLength: number;
  averagePeriodLength: number;
  /** Estimated standard deviation of cycle length, in days. */
  variability: number;
  /** Number of observed cycles that informed the model. */
  cyclesUsed: number;
  confidence: Confidence;
  confidenceReason: string;
  lastPeriod: PeriodRecord | null;
  isLate: boolean;
  daysLate: number;
  /** Rolling forecast covering at least the current and next calendar month. */
  cycles: PredictedCycle[];
  /** Predicted period that starts in the current calendar month, if any. */
  currentMonth: PredictedCycle | null;
  /** Logged period that started in the current calendar month, if any. */
  currentMonthLogged: PeriodRecord | null;
  /** Predicted period that starts in the next calendar month, if any. */
  nextMonth: PredictedCycle | null;
}

export interface CycleStatus {
  /** 1-based day of the current cycle, or null before any period is known. */
  cycleDay: number | null;
  phase: CyclePhase | null;
  daysUntilNextPeriod: number | null;
  onPeriod: boolean;
  inFertileWindow: boolean;
}

/* ------------------------------------------------------------------ */
/* App data & settings                                                  */
/* ------------------------------------------------------------------ */

export type TempUnit = 'C' | 'F';

export interface Settings {
  lockEnabled: boolean;
  pinHash?: string;
  pinSalt?: string;
  tempUnit: TempUnit;
  notifications?: NotificationSettings;
  /** Home-screen widget: also show cycle day and phase (off by default for privacy). */
  widgetShowCycle?: boolean;
  /** Show the intro tour (set when an account is created; cleared when it's finished or skipped). */
  showIntro?: boolean;
  installBannerDismissedAt?: number;
}

export interface AppData {
  schemaVersion: 1;
  /** Display name for the signed-in local account. */
  username?: string;
  profile: Demographics | null;
  /** Every logged menstrual day. Period records are derived from this set. */
  periodDays: ISODate[];
  logs: Record<ISODate, DailyLog>;
  settings: Settings;
  /** Last time anything in this data changed (used when merging two devices). */
  updatedAt?: number;
  /** Notification id → time it was (or is) scheduled, so each one is only sent once. */
  notificationLog?: Record<string, number>;
}

/** Result of natural-language parsing — a partial update to a daily log. */
export interface ParsedLog {
  isPeriodDay?: boolean;
  flow?: FlowIntensity;
  symptoms: Partial<Omit<Symptoms, 'moods'>> & { moods?: Mood[] };
  lifestyle: Partial<Lifestyle>;
  /** Human-readable chips describing what was understood, e.g. "Cramps: Severe". */
  understood: string[];
}

/* ------------------------------------------------------------------ */
/* Accounts (on-device)                                                 */
/* ------------------------------------------------------------------ */

export interface AccountRecord {
  username: string;
  /** Present for accounts synced with the Phase server. */
  cloud?: {
    /** Server version of the data this device last synced. */
    version: number;
    /** Local changes not yet uploaded. */
    dirty: boolean;
  };
  /** base64url PBKDF2 salt used to derive the vault key from the password. */
  salt: string;
  iterations: number;
  createdAt: number;
}

export interface EncryptedVault {
  iv: string;
  ciphertext: string;
}

/* ------------------------------------------------------------------ */
/* Suggestions, analytics & cycle health                                */
/* ------------------------------------------------------------------ */

export type SuggestionCategory = 'hydration' | 'rest' | 'nutrition' | 'movement' | 'relief' | 'mind' | 'care';

export interface Suggestion {
  id: string;
  category: SuggestionCategory;
  title: string;
  detail: string;
  /** Higher = shown first. */
  priority: number;
}

export type FindingLevel = 'good' | 'info' | 'watch' | 'talk';

export interface CycleFinding {
  id: string;
  level: FindingLevel;
  title: string;
  detail: string;
  /** What's considered typical, for context. */
  typical?: string;
  action?: string;
}

/* ------------------------------------------------------------------ */
/* Notifications                                                        */
/* ------------------------------------------------------------------ */

export type NotificationCategory = 'morning' | 'cycle' | 'comfort' | 'motivation' | 'reminders' | 'water' | 'wins';

export interface NotificationSettings {
  enabled: boolean;
  /** Hide cycle details on the lock screen (on by default). */
  discreet: boolean;
  /** On/off per category. Missing entries (e.g. a category added in a later version) use the default. */
  categories: Partial<Record<NotificationCategory, boolean>>;
  /** Quiet hours, as hours of the day (0–23). Nothing is sent from quietStart until quietEnd. */
  quietStart: number;
  quietEnd: number;
}
