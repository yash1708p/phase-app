import { useMemo, useState } from 'react';
import { CircleAlert, CircleCheck, Info, Lightbulb, Stethoscope, TrendingUp } from 'lucide-react';
import type { AppData, CycleFinding, FindingLevel, ISODate } from '../types';
import type { CycleModel } from '../hooks/useCycle';
import { PHASES, cycleSummary, dailySeries, dataInsights, moodCounts, normalCycleRange, phaseAverages, symptomsByPhase } from '../lib/analytics';
import { PHASE_COPY } from '../lib/insightEngine';
import { addDays, formatDay, parseISO } from '../lib/dates';
import { sleepTarget } from '../lib/suggestions';
import { BarChart, ChartFrame, HeatGrid, LineChart, PHASE_COLORS, StatTile } from './charts';
import { Card, cx } from './ui';

type View = 'cycle' | 'trends';

const LEVEL: Record<FindingLevel, { label: string; icon: typeof Info; chip: string; ring: string }> = {
  talk: { label: 'Worth discussing with a doctor', icon: Stethoscope, chip: 'bg-rose-600 text-white', ring: 'ring-rose-300' },
  watch: { label: 'Keep an eye on', icon: CircleAlert, chip: 'bg-peach-200 text-ink', ring: 'ring-peach-300' },
  info: { label: 'Good to know', icon: Info, chip: 'bg-lilac-100 text-ink', ring: 'ring-blush-200' },
  good: { label: 'Looks typical', icon: CircleCheck, chip: 'bg-sage-100 text-sage-600', ring: 'ring-sage-200' },
};

const PHASE_SHORT = { menstrual: 'Period', follicular: 'Follicular', ovulatory: 'Ovulation', luteal: 'Luteal' } as const;
const shortDate = (d: ISODate) => parseISO(d).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });

export default function InsightsScreen({ data, today, model }: { data: AppData; today: ISODate; model: CycleModel }) {
  const [view, setView] = useState<View>('cycle');
  return (
    <main className="app-shell space-y-4">
      <header className="pt-1">
        <h1 className="font-display text-2xl text-ink">Insights</h1>
        <p className="text-sm text-ink-soft">Built from your logs, calculated on this device.</p>
      </header>
      <div className="grid grid-cols-2 rounded-2xl bg-blush-100 p-1" role="tablist">
        {(
          [
            ['cycle', 'Understand your cycle'],
            ['trends', 'Trends & charts'],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            role="tab"
            aria-selected={view === id}
            onClick={() => setView(id)}
            className={cx('min-h-[40px] rounded-xl text-sm font-semibold transition', view === id ? 'bg-white text-ink shadow-soft' : 'text-ink-soft')}
          >
            {label}
          </button>
        ))}
      </div>
      {view === 'cycle' ? <UnderstandCycle data={data} today={today} model={model} /> : <Trends data={data} today={today} model={model} />}
      <p className="px-2 pb-2 text-center text-xs text-ink-faint">Phase shares general health information, not a diagnosis. If something feels wrong, talk to a clinician.</p>
    </main>
  );
}

/* ------------------------------------------------------------------ */
/* Understand your cycle                                                */
/* ------------------------------------------------------------------ */

function UnderstandCycle({ data, model }: { data: AppData; today: ISODate; model: CycleModel }) {
  const { stats, prediction, findings, status } = model;
  const age = data.profile?.age ?? 30;
  const [lo, hi] = normalCycleRange(age);
  const cycleLen = Math.round(prediction?.averageCycleLength ?? data.profile?.typicalCycleLength ?? 28);
  const periodLen = Math.round(prediction?.averagePeriodLength ?? data.profile?.typicalPeriodLength ?? 5);
  const ov = Math.max(periodLen + 2, cycleLen - 14);
  const segments = [
    { phase: 'menstrual' as const, from: 1, to: periodLen },
    { phase: 'follicular' as const, from: periodLen + 1, to: ov - 3 },
    { phase: 'ovulatory' as const, from: ov - 2, to: ov + 1 },
    { phase: 'luteal' as const, from: ov + 2, to: cycleLen },
  ].filter((s) => s.to >= s.from);
  const counts = findings.reduce<Record<FindingLevel, number>>((a, f) => ({ ...a, [f.level]: a[f.level] + 1 }), { talk: 0, watch: 0, info: 0, good: 0 });

  return (
    <div className="space-y-4">
      <Card className="bg-gradient-to-br from-white/90 to-blush-100/70">
        <h2 className="font-display text-xl text-ink">Your cycle at a glance</h2>
        <p className="mt-1.5 text-[15px] leading-relaxed text-ink-soft">{cycleSummary(stats, prediction)}</p>
        <div className="mt-3 flex flex-wrap gap-1.5 text-xs font-semibold">
          {(['talk', 'watch', 'good'] as const).map((l) =>
            counts[l] ? (
              <span key={l} className={cx('rounded-full px-2.5 py-1', LEVEL[l].chip)}>
                {counts[l]} {l === 'talk' ? 'to discuss' : l === 'watch' ? 'to watch' : 'typical'}
              </span>
            ) : null,
          )}
        </div>
      </Card>

      <div className="grid grid-cols-2 gap-3">
        <StatTile label="Avg cycle" value={stats.avgCycle} unit="days" note={`Typical ${lo}–${hi}`} />
        <StatTile label="Avg period" value={stats.avgPeriod} unit="days" note="Typical 2–7" />
        <StatTile label="Variation" value={stats.variation} unit="days" note="Shortest vs longest" />
        <StatTile label="Cycles tracked" value={stats.cyclesTracked} note={prediction ? `${prediction.confidence} confidence` : undefined} />
      </div>

      {/* Phase timeline for this user's typical cycle */}
      <Card>
        <h2 className="font-display text-lg text-ink">Your typical {cycleLen}-day cycle</h2>
        <div className="relative mt-7">
          <div className="flex h-9 gap-[2px] overflow-hidden rounded-xl">
            {segments.map((s) => (
              <div key={s.phase} style={{ flex: s.to - s.from + 1, background: PHASE_COLORS[s.phase] }} className="grid place-items-center text-[11px] font-semibold text-white">
                {s.to - s.from >= 3 ? PHASE_SHORT[s.phase] : ''}
              </div>
            ))}
          </div>
          {status.cycleDay && status.cycleDay <= cycleLen && (
            <div className="absolute -top-1.5 bottom-[-6px] w-0.5 rounded bg-ink" style={{ left: `calc(${((status.cycleDay - 0.5) / cycleLen) * 100}% - 1px)` }} aria-label={`Today, day ${status.cycleDay}`}>
              <span className="absolute -top-5 left-1/2 -translate-x-1/2 whitespace-nowrap rounded bg-ink px-1.5 text-[10px] font-semibold text-cream">Today</span>
            </div>
          )}
        </div>
        <ul className="mt-4 space-y-3">
          {segments.map((s) => (
            <li key={s.phase} className="flex gap-3">
              <span className="mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: PHASE_COLORS[s.phase] }} />
              <div>
                <p className="text-sm font-semibold text-ink">
                  {PHASE_COPY[s.phase].name} <span className="font-normal text-ink-faint">· days {s.from}–{s.to}</span>
                </p>
                <p className="text-sm text-ink-soft">
                  {PHASE_COPY[s.phase].hormones} {PHASE_COPY[s.phase].feel}
                </p>
              </div>
            </li>
          ))}
        </ul>
      </Card>

      <h2 className="pt-1 font-display text-xl text-ink">What Phase noticed</h2>
      {findings.map((f) => (
        <FindingCard key={f.id} f={f} />
      ))}
    </div>
  );
}

function FindingCard({ f }: { f: CycleFinding }) {
  const L = LEVEL[f.level];
  const Icon = L.icon;
  return (
    <section className={cx('animate-fade-up rounded-2xl bg-white/90 p-4 shadow-soft ring-1', L.ring)}>
      <span className={cx('inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-semibold', L.chip)}>
        <Icon size={13} /> {L.label}
      </span>
      <h3 className="mt-2 font-display text-lg leading-snug text-ink">{f.title}</h3>
      <p className="mt-1 text-sm leading-relaxed text-ink-soft">{f.detail}</p>
      {f.typical && <p className="mt-2 text-xs text-ink-faint">Typical range: {f.typical}</p>}
      {f.action && <p className="mt-2 rounded-xl bg-blush-100 p-2.5 text-sm text-rose-700">{f.action}</p>}
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* Trends & charts                                                      */
/* ------------------------------------------------------------------ */

function Trends({ data, today, model }: { data: AppData; today: ISODate; model: CycleModel }) {
  const { history, stats, prediction, status } = model;
  const profile = data.profile!;
  const avgCycle = prediction?.averageCycleLength ?? profile.typicalCycleLength;
  const [lo, hi] = normalCycleRange(profile.age);

  const completed = history.filter((c) => c.length !== null).slice(-8);
  const insights = useMemo(
    () => dataInsights({ logs: data.logs, periodDays: data.periodDays, history, avgCycle, today }),
    [data.logs, data.periodDays, history, avgCycle, today],
  );
  const heat = useMemo(() => symptomsByPhase(data.logs, data.periodDays, avgCycle, today), [data.logs, data.periodDays, avgCycle, today]);
  const moods = useMemo(() => moodCounts(data.logs, addDays(today, -90)), [data.logs, today]);
  const sleep = useMemo(() => dailySeries(data.logs, today, 30, (l) => l.lifestyle.sleepHours), [data.logs, today]);
  const water = useMemo(() => dailySeries(data.logs, today, 14, (l) => l.lifestyle.waterGlasses), [data.logs, today]);
  const sleepByPhase = useMemo(() => phaseAverages(data.logs, data.periodDays, avgCycle, today, (l) => l.lifestyle.sleepHours), [data.logs, data.periodDays, avgCycle, today]);
  const sleepGoal = data.profile ? sleepTarget(profile, status, []) : 8;

  // BBT for the current (or most recent) cycle.
  const bbtCycle = history[history.length - 1];
  const bbt = bbtCycle
    ? Array.from({ length: Math.min(45, (bbtCycle.length ?? Math.max(1, Math.round((parseISO(today).getTime() - parseISO(bbtCycle.start).getTime()) / 864e5) + 1))) }, (_, i) => {
        const d = addDays(bbtCycle.start, i);
        return { label: `D${i + 1}`, value: data.logs[d]?.symptoms.bbt ?? null, tip: `Day ${i + 1} · ${shortDate(d)}: ${data.logs[d]?.symptoms.bbt?.toFixed(2) ?? '—'}°C` };
      })
    : [];
  const bbtVals = bbt.map((b) => b.value).filter((v): v is number => v !== null);

  const sleepPresent = sleep.filter((s) => s.value !== null).length;
  const waterPresent = water.filter((s) => s.value !== null).length;
  const moodTotal = Object.values(moods).reduce((a, b) => a + b, 0);

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3">
        <StatTile label="Avg cycle" value={stats.avgCycle} unit="days" />
        <StatTile label="Avg period" value={stats.avgPeriod} unit="days" />
        <StatTile label="Logging streak" value={stats.streak} unit={stats.streak === 1 ? 'day' : 'days'} />
        <StatTile label="Days logged" value={stats.daysLogged} />
      </div>

      {insights.length > 0 && (
        <Card>
          <h3 className="mb-2 flex items-center gap-2 font-display text-base text-ink">
            <Lightbulb size={16} className="text-peach-400" /> What your data says
          </h3>
          <ul className="space-y-2">
            {insights.map((t) => (
              <li key={t} className="flex gap-2 text-sm text-ink">
                <TrendingUp size={15} className="mt-0.5 shrink-0 text-rose-500" />
                {t}
              </li>
            ))}
          </ul>
        </Card>
      )}

      <ChartFrame
        title="Cycle length"
        subtitle={<>Each point is one cycle · the shaded band shows the typical {lo}–{hi} days · the dotted line shows the trend</>}
        empty={completed.length < 2 ? 'Log at least 3 periods to see how your cycle length changes.' : null}
        table={{ head: ['Cycle start', 'Length (days)'], rows: completed.map((c) => [formatDay(c.start), c.length!]) }}
      >
        <LineChart
          data={completed.map((c) => ({ label: shortDate(c.start), value: c.length, tip: `Started ${shortDate(c.start)}: ${c.length} days` }))}
          yMin={Math.min(lo - 3, ...completed.map((c) => c.length! - 2))}
          yMax={Math.max(hi + 3, ...completed.map((c) => c.length! + 2))}
          band={{ from: lo, to: hi, label: 'Typical' }}
          reference={stats.avgCycle ? { value: stats.avgCycle, label: `Avg ${stats.avgCycle}` } : undefined}
          unit=" days"
          trend
        />
      </ChartFrame>

      <ChartFrame
        title="Period length"
        subtitle="Days of bleeding per period"
        empty={completed.length < 1 ? 'Your period lengths will appear here.' : null}
        table={{ head: ['Period start', 'Days', 'Heavy days'], rows: completed.map((c) => [formatDay(c.start), c.periodLength, c.heavyDays]) }}
      >
        <BarChart
          data={completed.map((c) => ({ label: shortDate(c.start), value: c.periodLength, tip: `${shortDate(c.start)}: ${c.periodLength} days${c.heavyDays ? ` · ${c.heavyDays} heavy` : ''}` }))}
          yMax={Math.max(8, ...completed.map((c) => c.periodLength))}
          reference={{ value: 7, label: '7-day typical max' }}
          unit=" days"
        />
      </ChartFrame>

      <ChartFrame
        title="When your symptoms happen"
        subtitle="Share of logged days in each phase with that symptom"
        empty={heat.every((r) => r.totalDays === 0) ? 'Log symptoms for a few weeks to see which phase they belong to.' : null}
        table={{
          head: ['Symptom', ...PHASES.map((p) => PHASE_SHORT[p])],
          rows: heat.map((r) => [r.label, ...PHASES.map((p) => (r.byPhase[p] === null ? '–' : `${Math.round(r.byPhase[p]! * 100)}%`))]),
        }}
      >
        <HeatGrid
          cols={PHASES.map((p) => ({ label: PHASE_SHORT[p], color: PHASE_COLORS[p] }))}
          rows={heat.filter((r) => r.totalDays > 0).map((r) => ({ label: r.label, values: PHASES.map((p) => r.byPhase[p]) }))}
        />
      </ChartFrame>

      <ChartFrame
        title="Mood"
        subtitle="How often you logged each mood · last 90 days"
        empty={moodTotal === 0 ? 'Moods you log will be summarized here.' : null}
        table={{ head: ['Mood', 'Days'], rows: Object.entries(moods).map(([m, n]) => [m[0].toUpperCase() + m.slice(1), n]) }}
      >
        <BarChart data={Object.entries(moods).map(([m, n]) => ({ label: m[0].toUpperCase() + m.slice(1), value: n, tip: `${m}: ${n} days` }))} />
      </ChartFrame>

      <ChartFrame
        title="Sleep"
        subtitle={`Hours per night · last 30 days · the dashed line is your ${sleepGoal}-hour goal`}
        empty={sleepPresent < 3 ? 'Log sleep in Daily details to see your trend.' : null}
        table={{ head: ['Date', 'Hours'], rows: sleep.filter((s) => s.value !== null).map((s) => [formatDay(s.date), s.value!]) }}
      >
        <LineChart
          data={sleep.map((s) => ({ label: shortDate(s.date), value: s.value }))}
          yMin={3}
          yMax={11}
          reference={{ value: sleepGoal, label: `Goal ${sleepGoal}h` }}
          unit="h"
          decimals={1}
          trend
        />
        {sleepByPhase.filter((p) => p.value !== null).length >= 2 && (
          <div className="mt-2 grid grid-cols-4 gap-1 text-center">
            {sleepByPhase.map((p) => (
              <div key={p.phase} className="rounded-lg bg-cream-200 py-1.5">
                <p className="text-[10px] font-semibold text-ink-faint">
                  <span className="mr-1 inline-block h-1.5 w-1.5 rounded-full align-middle" style={{ background: PHASE_COLORS[p.phase] }} />
                  {PHASE_SHORT[p.phase]}
                </p>
                <p className="text-sm font-semibold tabular-nums text-ink">{p.value === null ? '–' : `${p.value.toFixed(1)}h`}</p>
              </div>
            ))}
          </div>
        )}
      </ChartFrame>

      <ChartFrame
        title="Water"
        subtitle="Glasses per day · last 14 days · the dashed line is the 8-glass goal"
        empty={waterPresent < 3 ? 'Log water in Daily details to see your trend.' : null}
        table={{ head: ['Date', 'Glasses'], rows: water.filter((s) => s.value !== null).map((s) => [formatDay(s.date), s.value!]) }}
      >
        <BarChart data={water.map((s) => ({ label: String(parseISO(s.date).getDate()), value: s.value ?? 0, tip: `${shortDate(s.date)}: ${s.value ?? 'not logged'}` }))} reference={{ value: 8, label: 'Goal 8' }} yMax={12} />
      </ChartFrame>

      <ChartFrame
        title="Basal body temperature"
        subtitle="This cycle · a sustained rise of ~0.2°C suggests ovulation has happened"
        empty={bbtVals.length < 3 ? 'Log your temperature each morning (in Daily details) to chart it here.' : null}
        table={{ head: ['Cycle day', '°C'], rows: bbt.filter((b) => b.value !== null).map((b) => [b.label, b.value!.toFixed(2)]) }}
      >
        <LineChart data={bbt} yMin={Math.floor((Math.min(...bbtVals, 36.2) - 0.1) * 10) / 10} yMax={Math.ceil((Math.max(...bbtVals, 36.8) + 0.1) * 10) / 10} unit="°C" decimals={2} />
      </ChartFrame>
    </div>
  );
}
