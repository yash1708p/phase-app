import { useMemo } from 'react';
import type { AppData, CycleStatus, ISODate } from '../types';
import { getCycleStatus, predict } from '../lib/predictionEngine';
import { generateInsight } from '../lib/insightEngine';
import { cycleFindings, cycleHistory, cycleStats } from '../lib/analytics';
import { generateSuggestions } from '../lib/suggestions';

const NO_STATUS: CycleStatus = { cycleDay: null, phase: null, daysUntilNextPeriod: null, onPeriod: false, inFertileWindow: false };

/**
 * Derives predictions, today's status, the daily insight, analytics and
 * suggestions from raw data. Recomputes whenever logs, period days or the
 * profile change — this is what keeps everything re-indexed in real time.
 */
export function useCycle(data: AppData, today: ISODate) {
  const prediction = useMemo(
    () => (data.profile ? predict({ profile: data.profile, periodDays: data.periodDays, today }) : null),
    [data.profile, data.periodDays, today],
  );

  const status = useMemo(() => (prediction ? getCycleStatus(prediction, data.periodDays, today) : NO_STATUS), [prediction, data.periodDays, today]);

  const insight = useMemo(
    () => generateInsight({ status, prediction, logs: data.logs, periodDays: data.periodDays, today }),
    [status, prediction, data.logs, data.periodDays, today],
  );

  const history = useMemo(() => cycleHistory(data.periodDays, data.logs, today), [data.periodDays, data.logs, today]);
  const stats = useMemo(() => cycleStats(history, data.logs, today), [history, data.logs, today]);

  const findings = useMemo(
    () => (data.profile ? cycleFindings({ profile: data.profile, history, logs: data.logs, periodDays: data.periodDays, prediction, today }) : []),
    [data.profile, history, data.logs, data.periodDays, prediction, today],
  );

  const suggestions = useMemo(
    () => (data.profile ? generateSuggestions({ profile: data.profile, status, logs: data.logs, today, findings }) : []),
    [data.profile, status, data.logs, today, findings],
  );

  return { prediction, status, insight, history, stats, findings, suggestions };
}

export type CycleModel = ReturnType<typeof useCycle>;
