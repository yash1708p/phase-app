import { useEffect, useMemo, useRef, useState } from 'react';
import { Angry, Check, CircleAlert, CloudRain, Leaf, Sparkles, Stethoscope, Wind, Zap, Smile } from 'lucide-react';
import type { CyclePhase, DailyLog, ISODate } from '../types';
import { CHECK_GROUPS, DISCHARGE_WARNING, GUIDE, applySelection, combinedNotes, selectionFromLog, type CheckId } from '../lib/symptomGuide';
import { PHASE_COPY } from '../lib/insightEngine';
import { applySymptomLog } from '../lib/store';
import { formatDay } from '../lib/dates';
import { Button, Card, Chip, cx } from './ui';

const MOOD_ICONS: Partial<Record<CheckId, typeof Leaf>> = { calm: Leaf, irritable: Angry, sad: CloudRain, anxious: Wind, energetic: Zap };

/**
 * "Understand your symptoms": pick everything that applies, press Apply,
 * get an explanation for each one in the context of your current phase.
 * Applying also saves the selection into today's log.
 */
export default function SymptomCheck({ today, phase, log }: { today: ISODate; phase: CyclePhase | null; log: DailyLog | undefined }) {
  const [sel, setSel] = useState<Set<CheckId>>(() => selectionFromLog(log));
  const [applied, setApplied] = useState<Set<CheckId> | null>(null);
  const results = useRef<HTMLDivElement>(null);

  // Re-sync when the day changes.
  useEffect(() => {
    setSel(selectionFromLog(log));
    setApplied(null);
  }, [today]); // eslint-disable-line react-hooks/exhaustive-deps

  const toggle = (id: CheckId) => {
    navigator.vibrate?.(8);
    setApplied(null);
    setSel((prev) => {
      const next = new Set(prev);
      if (id === 'fine') return next.has('fine') ? new Set() : new Set<CheckId>(['fine']);
      next.delete('fine');
      if (next.has(id)) next.delete(id);
      else {
        // Discharge is one-of.
        if (id.startsWith('discharge_')) for (const x of [...next]) if (x.startsWith('discharge_')) next.delete(x);
        next.add(id);
      }
      return next;
    });
  };

  const apply = () => {
    const snapshot = new Set(sel);
    applySymptomLog(today, (prev) => applySelection(prev, snapshot));
    setApplied(snapshot);
    navigator.vibrate?.([10, 40, 10]);
    setTimeout(() => results.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50);
  };

  const notes = useMemo(() => (applied ? combinedNotes(applied, phase) : []), [applied, phase]);
  const phaseName = phase ? PHASE_COPY[phase].name : null;
  const ids = (group: string) => (Object.keys(GUIDE) as CheckId[]).filter((id) => GUIDE[id].group === group);

  return (
    <main className="app-shell space-y-4">
      <header className="pt-1">
        <p className="text-sm text-ink-soft">{formatDay(today, { weekday: 'long', month: 'long', day: 'numeric' })}</p>
        <h1 className="font-display text-2xl text-ink">Understand your symptoms</h1>
        <p className="mt-1 text-sm text-ink-soft">
          Select everything that applies today, then tap <strong>Apply</strong>.
          {phaseName && (
            <>
              {' '}
              You’re in your <span className="font-semibold text-rose-600">{phaseName.toLowerCase()}</span>.
            </>
          )}
        </p>
      </header>

      <button
        onClick={() => toggle('fine')}
        aria-pressed={sel.has('fine')}
        className={cx(
          'flex w-full items-center gap-3 rounded-2xl p-4 text-left ring-1 transition active:scale-[0.99]',
          sel.has('fine') ? 'bg-sage-600 text-white ring-sage-600' : 'bg-white/80 text-ink ring-blush-200',
        )}
      >
        <Smile size={22} className={sel.has('fine') ? '' : 'text-sage-600'} />
        <span className="flex-1 font-semibold">Everything is fine today</span>
        {sel.has('fine') && <Check size={18} />}
      </button>

      {CHECK_GROUPS.map(({ group, title }) => (
        <Card key={group}>
          <h2 className="mb-2.5 text-[13px] font-semibold uppercase tracking-wide text-ink-soft">
            {title}
            {group === 'discharge' && <span className="ml-1 font-normal normal-case tracking-normal text-ink-faint">(pick one)</span>}
          </h2>
          <div className="flex flex-wrap gap-2">
            {ids(group).map((id) => {
              const Icon = MOOD_ICONS[id];
              return (
                <Chip key={id} selected={sel.has(id)} onClick={() => toggle(id)} tone={group === 'mood' ? 'peach' : group === 'discharge' ? 'sage' : 'rose'} className="px-3.5">
                  {Icon && <Icon size={16} />}
                  {GUIDE[id].label}
                </Chip>
              );
            })}
          </div>
        </Card>
      ))}

      <div className="sticky bottom-[calc(76px+env(safe-area-inset-bottom))] z-10">
        <Button block disabled={!sel.size} onClick={apply} className="shadow-lift">
          {applied ? (
            <>
              <Check size={18} /> Applied to today’s log
            </>
          ) : (
            <>
              <Sparkles size={18} /> Apply{sel.size ? ` (${sel.size})` : ''}
            </>
          )}
        </Button>
      </div>

      {applied && (
        <div ref={results} className="scroll-mt-4 space-y-3">
          <h2 className="pt-2 font-display text-xl text-ink">What this might mean</h2>

          {notes.map((n) => (
            <p key={n} className="flex gap-2 rounded-2xl bg-lilac-100 p-3 text-sm text-ink">
              <Sparkles size={16} className="mt-0.5 shrink-0 text-lilac-500" />
              {n}
            </p>
          ))}

          {[...applied].map((id) => {
            const g = GUIDE[id];
            const why = (phase && g.why[phase]) || g.why.default;
            return (
              <Card key={id} className="animate-fade-up">
                <h3 className="font-display text-lg text-ink">{g.label}</h3>
                <p className="mt-1 text-[15px] leading-relaxed text-ink-soft">{why}</p>
                <p className="mt-3 text-xs font-semibold uppercase tracking-wide text-ink-faint">What can help</p>
                <ul className="mt-1 space-y-1">
                  {g.helps.map((h) => (
                    <li key={h} className="flex gap-2 text-sm text-ink">
                      <Check size={15} className="mt-0.5 shrink-0 text-sage-600" />
                      {h}
                    </li>
                  ))}
                </ul>
                {g.seeHelp && (
                  <p className="mt-3 flex gap-2 rounded-xl bg-blush-100 p-2.5 text-sm text-rose-700">
                    <Stethoscope size={16} className="mt-0.5 shrink-0" />
                    {g.seeHelp}
                  </p>
                )}
              </Card>
            );
          })}

          {[...applied].some((id) => id.startsWith('discharge_')) && (
            <p className="flex gap-2 rounded-2xl bg-white/80 p-3 text-sm text-ink-soft ring-1 ring-blush-200">
              <CircleAlert size={16} className="mt-0.5 shrink-0 text-rose-500" />
              {DISCHARGE_WARNING}
            </p>
          )}

          <p className="px-2 text-center text-xs text-ink-faint">General information, not a diagnosis. If something feels wrong, trust that and talk to a clinician.</p>
        </div>
      )}
    </main>
  );
}
