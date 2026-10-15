import { useEffect, useState, type ReactNode } from 'react';
import { Angry, Brain, Check, CloudRain, Droplet, Leaf, SlidersHorizontal, Wind, Zap } from 'lucide-react';
import type { CrampSeverity, DailyLog, FlowIntensity, HeadacheStatus, ISODate, Mood } from '../types';
import { formatDay } from '../lib/dates';
import { blankLog, saveLog } from '../lib/store';
import { Button, Chip, SectionLabel, Sheet, cx } from './ui';

/* ------------------------------------------------------------------ */
/* Options                                                              */
/* ------------------------------------------------------------------ */

const CRAMPS: { id: CrampSeverity; label: string; bars: number }[] = [
  { id: 'none', label: 'None', bars: 0 },
  { id: 'mild', label: 'Mild', bars: 1 },
  { id: 'moderate', label: 'Moderate', bars: 2 },
  { id: 'severe', label: 'Severe', bars: 3 },
];

const FLOWS: { id: FlowIntensity; label: string; drops: number }[] = [
  { id: 'spotting', label: 'Spotting', drops: 0 },
  { id: 'light', label: 'Light', drops: 1 },
  { id: 'medium', label: 'Medium', drops: 2 },
  { id: 'heavy', label: 'Heavy', drops: 3 },
];

const HEADACHES: { id: HeadacheStatus; label: string }[] = [
  { id: 'none', label: 'None' },
  { id: 'dull', label: 'Dull' },
  { id: 'migraine', label: 'Migraine' },
];

export const MOODS: { id: Mood; label: string; icon: ReactNode }[] = [
  { id: 'calm', label: 'Calm', icon: <Leaf size={16} /> },
  { id: 'irritable', label: 'Irritable', icon: <Angry size={16} /> },
  { id: 'sad', label: 'Sad', icon: <CloudRain size={16} /> },
  { id: 'anxious', label: 'Anxious', icon: <Wind size={16} /> },
  { id: 'energetic', label: 'Energetic', icon: <Zap size={16} /> },
];

const haptic = () => navigator.vibrate?.(8);

/* ------------------------------------------------------------------ */
/* Visual scale atoms                                                   */
/* ------------------------------------------------------------------ */

function CrampGlyph({ bars, on }: { bars: number; on: boolean }) {
  return (
    <span className="flex h-5 items-end gap-0.5" aria-hidden>
      {[1, 2, 3].map((b) => (
        <span
          key={b}
          className={cx('w-1.5 rounded-full transition-colors', on ? (b <= bars ? 'bg-white' : 'bg-white/30') : b <= bars ? 'bg-rose-400' : 'bg-blush-200')}
          style={{ height: `${6 + b * 4}px` }}
        />
      ))}
    </span>
  );
}

function FlowGlyph({ drops, on }: { drops: number; on: boolean }) {
  if (drops === 0) return <span className={cx('h-2 w-2 rounded-full', on ? 'bg-white' : 'bg-rose-300')} aria-hidden />;
  return (
    <span className="flex" aria-hidden>
      {Array.from({ length: drops }, (_, i) => (
        <Droplet key={i} size={14} className={cx('-ml-0.5 first:ml-0', on ? 'fill-white text-white' : 'fill-rose-300 text-rose-400')} />
      ))}
    </span>
  );
}

/* ------------------------------------------------------------------ */
/* Logger                                                               */
/* ------------------------------------------------------------------ */

interface Props {
  open: boolean;
  date: ISODate;
  log: DailyLog | undefined;
  /** Pre-select "period day" for a day with no log yet (e.g. "Period started" button, or a known period day). */
  defaultPeriod: boolean;
  onClose: () => void;
  onMoreDetails: () => void;
}

/**
 * The 15-second logger. Four rows, big tap targets, one Save.
 * Opens automatically on period days; also reachable from any calendar day.
 */
export default function PeriodLogger({ open, date, log, defaultPeriod, onClose, onMoreDetails }: Props) {
  const [draft, setDraft] = useState<DailyLog>(() => log ?? blankLog(date));
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (open) {
      setDraft(log ?? blankLog(date, defaultPeriod));
      setSaved(false);
    }
    // Reset only when the sheet opens or the date changes.
  }, [open, date]);

  const setCycle = (patch: Partial<DailyLog['cycle']>) => {
    haptic();
    setDraft((d) => ({ ...d, cycle: { ...d.cycle, ...patch } }));
  };
  const setSym = (patch: Partial<DailyLog['symptoms']>) => {
    haptic();
    setDraft((d) => ({ ...d, symptoms: { ...d.symptoms, ...patch } }));
  };
  const toggleMood = (m: Mood) => {
    haptic();
    setDraft((d) => {
      const has = d.symptoms.moods.includes(m);
      return { ...d, symptoms: { ...d.symptoms, moods: has ? d.symptoms.moods.filter((x) => x !== m) : [...d.symptoms.moods, m] } };
    });
  };

  const persist = () => {
    const flow = draft.cycle.flow;
    const isSpottingOnly = flow === 'spotting' && !draft.cycle.isPeriodDay;
    saveLog(date, () => ({
      ...draft,
      cycle: { ...draft.cycle, intermenstrualSpotting: isSpottingOnly || draft.cycle.intermenstrualSpotting },
      symptoms: { ...draft.symptoms },
    }));
  };

  const commit = () => {
    persist();
    setSaved(true);
    navigator.vibrate?.([10, 40, 10]);
    setTimeout(onClose, 450);
  };

  const { cycle, symptoms } = draft;

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={
        <span>
          Quick log <span className="text-base text-ink-soft">· {formatDay(date, { weekday: 'short', month: 'short', day: 'numeric' })}</span>
        </span>
      }
      footer={
        <div className="flex gap-2">
          <Button
            variant="soft"
            aria-label="Save and add more details"
            onClick={() => {
              persist();
              onMoreDetails();
            }}
          >
            <SlidersHorizontal size={18} />
          </Button>
          <Button block onClick={commit} className={cx(saved && 'bg-sage-600 hover:bg-sage-600')}>
            {saved ? (
              <>
                <Check size={18} /> Saved
              </>
            ) : (
              'Save log'
            )}
          </Button>
        </div>
      }
    >
      <div className="space-y-5 pb-2">
        {/* Period day toggle */}
        <button
          type="button"
          onClick={() => setCycle({ isPeriodDay: !cycle.isPeriodDay, flow: cycle.isPeriodDay ? undefined : cycle.flow })}
          aria-pressed={cycle.isPeriodDay}
          className={cx(
            'flex w-full items-center justify-between rounded-2xl px-4 py-3 ring-1 transition',
            cycle.isPeriodDay ? 'bg-rose-500 text-white ring-rose-500' : 'bg-white/80 text-ink ring-blush-200',
          )}
        >
          <span className="flex items-center gap-2 font-semibold">
            <Droplet size={18} className={cycle.isPeriodDay ? 'fill-white' : 'text-rose-500'} />
            {cycle.isPeriodDay ? 'Period day' : 'Not a period day'}
          </span>
          <span className={cx('relative h-7 w-12 rounded-full transition', cycle.isPeriodDay ? 'bg-white/35' : 'bg-blush-200')}>
            <span className={cx('absolute top-1 h-5 w-5 rounded-full bg-white shadow transition-all', cycle.isPeriodDay ? 'left-6' : 'left-1')} />
          </span>
        </button>

        {/* 1. Cramps */}
        <div>
          <SectionLabel>Cramps</SectionLabel>
          <div className="grid grid-cols-4 gap-2">
            {CRAMPS.map((c) => {
              const on = symptoms.cramps === c.id;
              return (
                <Chip key={c.id} selected={on} onClick={() => setSym({ cramps: on ? undefined : c.id })} className="flex-col gap-1 py-2">
                  <CrampGlyph bars={c.bars} on={on} />
                  <span className="text-xs">{c.label}</span>
                </Chip>
              );
            })}
          </div>
        </div>

        {/* 2. Flow */}
        <div>
          <SectionLabel hint={cycle.isPeriodDay ? undefined : 'Spotting counts as between-period bleeding'}>Flow</SectionLabel>
          <div className="grid grid-cols-4 gap-2">
            {FLOWS.map((f) => {
              const on = cycle.flow === f.id;
              return (
                <Chip
                  key={f.id}
                  selected={on}
                  onClick={() =>
                    setCycle({
                      flow: on ? undefined : f.id,
                      // Choosing a real flow level marks the day as a period day.
                      isPeriodDay: !on && f.id !== 'spotting' ? true : cycle.isPeriodDay,
                    })
                  }
                  className="h-16 flex-col gap-1.5"
                >
                  <FlowGlyph drops={f.drops} on={on} />
                  <span className="text-xs">{f.label}</span>
                </Chip>
              );
            })}
          </div>
        </div>

        {/* 3. Headache */}
        <div>
          <SectionLabel icon={<Brain size={14} />}>Headache</SectionLabel>
          <div className="grid grid-cols-3 gap-2">
            {HEADACHES.map((h) => (
              <Chip
                key={h.id}
                tone="lilac"
                selected={symptoms.headache === h.id}
                onClick={() => setSym({ headache: symptoms.headache === h.id ? undefined : h.id })}
              >
                {h.label}
              </Chip>
            ))}
          </div>
        </div>

        {/* 4. Mood */}
        <div>
          <SectionLabel hint="Pick any">Mood</SectionLabel>
          <div className="flex flex-wrap gap-2">
            {MOODS.map((m) => (
              <Chip key={m.id} tone="peach" selected={symptoms.moods.includes(m.id)} onClick={() => toggleMood(m.id)} className="px-4">
                {m.icon}
                {m.label}
              </Chip>
            ))}
          </div>
        </div>
      </div>
    </Sheet>
  );
}
