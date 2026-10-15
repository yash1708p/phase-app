import { useEffect, useState } from 'react';
import { BedDouble, Dumbbell, GlassWater, Pill, Sparkles, Thermometer, Wind } from 'lucide-react';
import type { DailyLog, Discharge, ISODate, Severity, StressLevel, TempUnit, WorkoutIntensity } from '../types';
import { formatDay } from '../lib/dates';
import { blankLog, saveLog } from '../lib/store';
import { Button, Chip, SectionLabel, Sheet, Stepper } from './ui';

const DISCHARGE: { id: Discharge; label: string }[] = [
  { id: 'none', label: 'None / dry' },
  { id: 'sticky', label: 'Sticky' },
  { id: 'creamy', label: 'Creamy' },
  { id: 'watery', label: 'Watery' },
  { id: 'egg_white', label: 'Egg white' },
];
const SEVERITY: Severity[] = ['none', 'mild', 'moderate', 'severe'];
const STRESS: StressLevel[] = ['low', 'medium', 'high'];
const WORKOUT: WorkoutIntensity[] = ['rest', 'light', 'moderate', 'intense'];
const CONTRACEPTIVES = ['None', 'Pill', 'IUD (hormonal)', 'IUD (copper)', 'Implant', 'Injection', 'Ring', 'Patch', 'Condoms', 'Other'];

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const cToUnit = (c: number, u: TempUnit) => (u === 'C' ? c : c * 1.8 + 32);
const unitToC = (v: number, u: TempUnit) => (u === 'C' ? v : (v - 32) / 1.8);

interface Props {
  open: boolean;
  date: ISODate;
  log: DailyLog | undefined;
  tempUnit: TempUnit;
  onClose: () => void;
}

/** Full daily check-in: bio-markers + lifestyle. Everything optional. */
export default function DailyDetails({ open, date, log, tempUnit, onClose }: Props) {
  const [d, setD] = useState<DailyLog>(() => log ?? blankLog(date));
  const [bbtText, setBbtText] = useState('');
  const [medText, setMedText] = useState('');

  useEffect(() => {
    if (!open) return;
    const base = log ?? blankLog(date);
    setD(base);
    setBbtText(base.symptoms.bbt ? cToUnit(base.symptoms.bbt, tempUnit).toFixed(2) : '');
    setMedText('');
  }, [open, date]); // eslint-disable-line react-hooks/exhaustive-deps

  const sym = (p: Partial<DailyLog['symptoms']>) => setD((x) => ({ ...x, symptoms: { ...x.symptoms, ...p } }));
  const life = (p: Partial<DailyLog['lifestyle']>) => setD((x) => ({ ...x, lifestyle: { ...x.lifestyle, ...p } }));
  const toggle = <T,>(cur: T | undefined, v: T) => (cur === v ? undefined : v);

  const addMed = () => {
    const m = medText.trim();
    if (!m) return;
    life({ medications: [...new Set([...d.lifestyle.medications, m])] });
    setMedText('');
  };

  const bbtValue = Number(bbtText.replace(',', '.'));
  const bbtC = bbtText && Number.isFinite(bbtValue) ? unitToC(bbtValue, tempUnit) : undefined;
  const bbtInvalid = bbtC !== undefined && (bbtC < 34 || bbtC > 40);

  const save = () => {
    if (bbtInvalid) return;
    const meds = medText.trim() ? [...new Set([...d.lifestyle.medications, medText.trim()])] : d.lifestyle.medications;
    saveLog(date, (prev) => ({
      ...d,
      // Period-day status is owned by the quick logger; keep whatever is stored.
      cycle: { ...prev.cycle, intermenstrualSpotting: d.cycle.intermenstrualSpotting },
      symptoms: { ...d.symptoms, bbt: bbtC !== undefined ? Math.round(bbtC * 100) / 100 : undefined },
      lifestyle: { ...d.lifestyle, medications: meds },
    }));
    onClose();
  };

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={
        <span>
          Daily details <span className="text-base text-ink-soft">· {formatDay(date)}</span>
        </span>
      }
      footer={
        <Button block onClick={save} disabled={bbtInvalid}>
          Done
        </Button>
      }
    >
      <div className="space-y-6 pb-2">
        <p className="rounded-2xl bg-blush-100 px-3 py-2 text-sm text-ink-soft">All optional — log only what’s useful to you.</p>

        {/* --- Cycle basics --- */}
        <div>
          <SectionLabel>Between-period bleeding</SectionLabel>
          <div className="grid grid-cols-2 gap-2">
            <Chip selected={!!d.cycle.intermenstrualSpotting} onClick={() => setD((x) => ({ ...x, cycle: { ...x.cycle, intermenstrualSpotting: !x.cycle.intermenstrualSpotting } }))}>
              Spotting today
            </Chip>
          </div>
        </div>

        {/* --- Bio-markers --- */}
        <h2 className="font-display text-lg text-ink">Body</h2>
        <div>
          <SectionLabel>Discharge</SectionLabel>
          <div className="flex flex-wrap gap-2">
            {DISCHARGE.map((o) => (
              <Chip key={o.id} tone="sage" selected={d.symptoms.discharge === o.id} onClick={() => sym({ discharge: toggle(d.symptoms.discharge, o.id) })}>
                {o.label}
              </Chip>
            ))}
          </div>
        </div>
        {(['fatigue', 'acne'] as const).map((k) => (
          <div key={k}>
            <SectionLabel>{k === 'fatigue' ? 'Fatigue' : 'Acne'}</SectionLabel>
            <div className="grid grid-cols-4 gap-2">
              {SEVERITY.map((v) => (
                <Chip key={v} selected={d.symptoms[k] === v} onClick={() => sym({ [k]: toggle(d.symptoms[k], v) })}>
                  <span className="text-xs">{cap(v)}</span>
                </Chip>
              ))}
            </div>
          </div>
        ))}
        <div>
          <SectionLabel icon={<Thermometer size={14} />} hint="Take it right after waking">
            Basal body temperature
          </SectionLabel>
          <div className="flex items-center gap-2">
            <input
              inputMode="decimal"
              className="field"
              placeholder={tempUnit === 'C' ? 'e.g. 36.55' : 'e.g. 97.80'}
              value={bbtText}
              onChange={(e) => setBbtText(e.target.value)}
              aria-invalid={bbtInvalid}
              aria-label={`Basal body temperature in °${tempUnit}`}
            />
            <span className="w-10 text-center font-semibold text-ink-soft">°{tempUnit}</span>
          </div>
          {bbtInvalid && <p className="mt-1 text-sm text-rose-600">That looks outside the normal range — please check it.</p>}
        </div>

        {/* --- Lifestyle --- */}
        <h2 className="font-display text-lg text-ink">Lifestyle</h2>
        <div>
          <SectionLabel icon={<BedDouble size={14} />}>Sleep</SectionLabel>
          <Stepper label="sleep hours" value={d.lifestyle.sleepHours ?? 7} min={0} max={14} suffix="hours" onChange={(n) => life({ sleepHours: n })} />
        </div>
        <div>
          <SectionLabel icon={<GlassWater size={14} />} hint="1 glass ≈ 250 ml">
            Water
          </SectionLabel>
          <Stepper label="glasses of water" value={d.lifestyle.waterGlasses ?? 0} min={0} max={20} suffix="glasses" onChange={(n) => life({ waterGlasses: n, ...(n > (d.lifestyle.waterGlasses ?? 0) ? { waterLoggedAt: Date.now() } : {}) })} />
        </div>
        <div>
          <SectionLabel icon={<Wind size={14} />}>Stress</SectionLabel>
          <div className="grid grid-cols-3 gap-2">
            {STRESS.map((v) => (
              <Chip key={v} tone="lilac" selected={d.lifestyle.stress === v} onClick={() => life({ stress: toggle(d.lifestyle.stress, v) })}>
                {cap(v)}
              </Chip>
            ))}
          </div>
        </div>
        <div>
          <SectionLabel icon={<Dumbbell size={14} />}>Workout</SectionLabel>
          <div className="grid grid-cols-4 gap-2">
            {WORKOUT.map((v) => (
              <Chip key={v} tone="sage" selected={d.lifestyle.workout === v} onClick={() => life({ workout: toggle(d.lifestyle.workout, v) })}>
                <span className="text-xs">{cap(v)}</span>
              </Chip>
            ))}
          </div>
        </div>
        <div>
          <SectionLabel icon={<Pill size={14} />}>Medications</SectionLabel>
          <div className="mb-2 flex flex-wrap gap-2">
            {d.lifestyle.medications.map((m) => (
              <button
                key={m}
                onClick={() => life({ medications: d.lifestyle.medications.filter((x) => x !== m) })}
                className="rounded-full bg-peach-200 px-3 py-1.5 text-sm text-ink"
                aria-label={`Remove ${m}`}
              >
                {m} ×
              </button>
            ))}
          </div>
          <div className="flex gap-2">
            <input
              className="field"
              placeholder="e.g. Ibuprofen 200 mg"
              value={medText}
              onChange={(e) => setMedText(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && addMed()}
            />
            <Button variant="soft" onClick={addMed} aria-label="Add medication">
              Add
            </Button>
          </div>
        </div>
        <div>
          <SectionLabel>Contraception</SectionLabel>
          <select className="field" value={d.lifestyle.contraceptive ?? ''} onChange={(e) => life({ contraceptive: e.target.value || undefined })}>
            <option value="">Not specified</option>
            {CONTRACEPTIVES.map((c) => (
              <option key={c}>{c}</option>
            ))}
          </select>
          {d.lifestyle.contraceptive && /Pill|hormonal|Implant|Injection|Ring|Patch/.test(d.lifestyle.contraceptive) && (
            <p className="mt-1.5 flex gap-1.5 text-xs text-ink-faint">
              <Sparkles size={14} className="shrink-0" /> Hormonal contraception changes your natural cycle, so ovulation estimates may not apply.
            </p>
          )}
        </div>
        <div>
          <SectionLabel>Notes</SectionLabel>
          <textarea className="field min-h-[80px]" value={d.note ?? ''} onChange={(e) => setD((x) => ({ ...x, note: e.target.value }))} />
        </div>
      </div>
    </Sheet>
  );
}
