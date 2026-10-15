import { describe, expect, it } from 'vitest';
import { renderToString } from 'react-dom/server';
import Dashboard from '../components/Dashboard';
import OnboardingWizard from '../components/OnboardingWizard';
import SymptomCheck from '../components/SymptomCheck';
import InsightsScreen from '../components/InsightsScreen';
import AuthScreen from '../components/AuthScreen';
import { predict, getCycleStatus } from '../lib/predictionEngine';
import { generateInsight } from '../lib/insightEngine';
import { cycleFindings, cycleHistory, cycleStats } from '../lib/analytics';
import { generateSuggestions } from '../lib/suggestions';
import { buildDemoData } from '../lib/demoData';
import type { AppData, ISODate } from '../types';
import type { CycleModel } from '../hooks/useCycle';

const today = '2026-10-11';

function model(data: AppData, t: ISODate): CycleModel {
  const prediction = predict({ profile: data.profile!, periodDays: data.periodDays, today: t });
  const status = getCycleStatus(prediction, data.periodDays, t);
  const insight = generateInsight({ status, prediction, logs: data.logs, periodDays: data.periodDays, today: t });
  const history = cycleHistory(data.periodDays, data.logs, t);
  const stats = cycleStats(history, data.logs, t);
  const findings = cycleFindings({ profile: data.profile!, history, logs: data.logs, periodDays: data.periodDays, prediction, today: t });
  const suggestions = generateSuggestions({ profile: data.profile!, status, logs: data.logs, today: t, findings });
  return { prediction, status, insight, history, stats, findings, suggestions };
}

/** Smoke tests: every screen renders with realistic data without throwing. */
describe('screens render', () => {
  const data = { ...buildDemoData(today), username: 'maya' };
  const m = model(data, today);

  it('auth', () => {
    expect(renderToString(<AuthScreen />)).toContain('Sign in');
  });

  it('onboarding', () => {
    expect(renderToString(<OnboardingWizard today={today} />)).toContain('welcome to Phase');
  });

  it('dashboard with forecast and suggestions', () => {
    const html = renderToString(
      <Dashboard
        data={data}
        today={today}
        viewDate={today}
        onChangeDate={() => {}}
        onOpenDetails={() => {}}
        prediction={m.prediction}
        status={m.status}
        insight={m.insight}
        suggestions={m.suggestions}
        onOpenLogger={() => {}}
        onOpenSettings={() => {}}
        onOpenInsights={() => {}}
      />,
    );
    expect(html).toContain('Daily insight');
    expect(html).toContain('Suggestions for today');
    expect(html).toContain('Today at a glance');
    expect(html).toContain('Previous day');
    expect(html).toContain('maya');
    expect(html).toContain('November 2026');
  });

  it('dashboard on a past day', () => {
    const html = renderToString(
      <Dashboard
        data={data}
        today={today}
        viewDate="2026-10-09"
        onChangeDate={() => {}}
        onOpenDetails={() => {}}
        prediction={m.prediction}
        status={m.status}
        insight={m.insight}
        suggestions={m.suggestions}
        onOpenLogger={() => {}}
        onOpenSettings={() => {}}
        onOpenInsights={() => {}}
      />,
    );
    expect(html).toContain('What you logged');
    expect(html).toContain('Cycle day');
    expect(html).not.toContain('Suggestions for today');
  });

  it('understand your symptoms', () => {
    const html = renderToString(<SymptomCheck today={today} phase={m.status.phase} log={data.logs[today]} />);
    expect(html).toContain('Understand your symptoms');
    expect(html).toContain('Everything is fine today');
    expect(html).toContain('Egg white');
  });

  it('insights — understand your cycle', () => {
    const html = renderToString(<InsightsScreen data={data} today={today} model={m} />);
    expect(html).toContain('Your cycle at a glance');
    expect(html).toContain('What Phase noticed');
  });
});

describe('intro tour', () => {
  it('renders every card with a Skip button', async () => {
    const { default: IntroTour, SLIDES } = await import('../components/IntroTour');
    const html = renderToString(<IntroTour onDone={() => {}} />);
    expect(html).toContain('Skip');
    expect(html).toContain('Welcome to Phase');
    for (const s of SLIDES) expect(html).toContain(s.title.replace('’', '&#x27;').slice(0, 6));
    expect(SLIDES.length).toBeGreaterThanOrEqual(5);
  });
});
