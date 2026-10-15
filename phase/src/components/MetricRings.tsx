import type { ReactNode } from 'react';
import { BatteryLow, GlassWater, Moon, Wind, Pencil } from 'lucide-react';
import type { DayMetric, MetricKey, MetricTone } from '../lib/dayMetrics';
import { cx } from './ui';

/**
 * Ring gauges for Fatigue, Sleep, Water and Stress.
 * `RingsCard` is the in-app version; `WidgetPreview` is the home-screen widget design.
 * Colour shows status, but every ring also carries its value as text, so colour is never the only cue.
 */

export const METRIC_ICON: Record<MetricKey, typeof Moon> = { fatigue: BatteryLow, sleep: Moon, water: GlassWater, stress: Wind };

export const TONE_LIGHT: Record<MetricTone, string> = { good: '#4E8A75', ok: '#C27419', alert: '#C2455A', none: '#D9CACC' };
export const TONE_DARK: Record<MetricTone, string> = { good: '#7FD1B0', ok: '#F2B35E', alert: '#F2798A', none: 'rgba(255,255,255,0.28)' };

export function Ring({
  fill,
  color,
  track,
  size = 64,
  stroke = 7,
  dashed = false,
  children,
}: {
  fill: number;
  color: string;
  track: string;
  size?: number;
  stroke?: number;
  dashed?: boolean;
  children?: ReactNode;
}) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const shown = fill > 0 ? Math.max(fill, 0.04) : 0;
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90" aria-hidden>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={dashed ? color : track} strokeWidth={dashed ? 2 : stroke} strokeDasharray={dashed ? '3 5' : undefined} />
        {shown > 0 && (
          <circle
            cx={size / 2}
            cy={size / 2}
            r={r}
            fill="none"
            stroke={color}
            strokeWidth={stroke}
            strokeLinecap="round"
            strokeDasharray={c}
            strokeDashoffset={c * (1 - shown)}
            style={{ transition: 'stroke-dashoffset 0.7s cubic-bezier(0.22,1,0.36,1)' }}
          />
        )}
      </svg>
      <div className="absolute inset-0 grid place-items-center">{children}</div>
    </div>
  );
}

/** In-app "Day at a glance" card (light theme). */
export function RingsCard({ metrics, title, onEdit }: { metrics: DayMetric[]; title: string; onEdit?: () => void }) {
  const logged = metrics.filter((m) => m.tone !== 'none').length;
  return (
    <section className="rounded-2xl bg-white/90 p-4 shadow-soft ring-1 ring-blush-200/60">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="font-display text-lg text-ink">{title}</h2>
        {onEdit && (
          <button onClick={onEdit} className="flex min-h-[36px] items-center gap-1.5 rounded-full bg-blush-100 px-3 text-xs font-semibold text-rose-700">
            <Pencil size={13} /> {logged ? 'Edit' : 'Log'}
          </button>
        )}
      </div>
      <ul className="grid grid-cols-4 gap-1">
        {metrics.map((m) => {
          const Icon = METRIC_ICON[m.key];
          const color = TONE_LIGHT[m.tone];
          return (
            <li key={m.key}>
              <button
                onClick={onEdit}
                className="flex w-full flex-col items-center rounded-xl py-1 transition active:scale-95"
                aria-label={`${m.label}: ${m.value === '—' ? 'not logged' : m.value}. ${m.detail}`}
              >
                <Ring fill={m.fill} color={color} track="#F6E9E6" dashed={m.tone === 'none'}>
                  <Icon size={20} style={{ color: m.tone === 'none' ? '#A8979A' : color }} />
                </Ring>
                <span className="mt-1.5 text-[11px] font-semibold uppercase tracking-wide text-ink-faint">{m.label}</span>
                <span className="font-display text-base leading-tight text-ink">{m.value}</span>
                <span className="text-center text-[11px] leading-tight text-ink-soft">{m.detail}</span>
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* Home-screen widget design (dark), small and medium sizes             */
/* ------------------------------------------------------------------ */

const W = { bg: '#241A1C', track: 'rgba(255,255,255,0.12)', text: '#FFF5F0', muted: '#BFAEB0' };

function Brand() {
  return (
    <span className="flex items-center gap-1.5 text-[11px] font-semibold" style={{ color: W.muted }}>
      <svg viewBox="0 0 64 64" className="h-3.5 w-3.5" aria-hidden>
        <circle cx="32" cy="32" r="17" fill="none" stroke="#F2798A" strokeWidth="7" />
        <path d="M32 15a17 17 0 0 1 0 34z" fill="#F2798A" />
      </svg>
      PHASE
    </span>
  );
}

export function WidgetMedium({ metrics, cycle }: { metrics: DayMetric[]; cycle: { day: number; phase: string } | null }) {
  return (
    <div className="w-full max-w-[338px] rounded-[22px] p-3.5 shadow-lift" style={{ background: W.bg, color: W.text }} aria-label="Medium widget preview">
      <div className="mb-2.5 flex items-center justify-between">
        <Brand />
        <span className="text-[11px]" style={{ color: W.muted }}>
          {cycle ? `Day ${cycle.day} · ${cycle.phase.replace(' phase', '')}` : 'Today'}
        </span>
      </div>
      <div className="grid grid-cols-4 gap-1">
        {metrics.map((m) => (
          <div key={m.key} className="flex flex-col items-center">
            <Ring fill={m.fill} color={TONE_DARK[m.tone]} track={W.track} size={58} stroke={6} dashed={m.tone === 'none'}>
              <span className="text-[13px] font-semibold tabular-nums" style={{ color: W.text }}>
                {m.short}
              </span>
            </Ring>
            <span className="mt-1 text-[10px] font-semibold uppercase tracking-wide" style={{ color: W.muted }}>
              {m.label}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

export function WidgetSmall({ metrics, cycle }: { metrics: DayMetric[]; cycle: { day: number; phase: string } | null }) {
  return (
    <div className="flex aspect-square w-[158px] flex-col rounded-[22px] p-2.5 shadow-lift" style={{ background: W.bg, color: W.text }} aria-label="Small widget preview">
      <div className="mb-1 flex items-center justify-between gap-1 whitespace-nowrap">
        <Brand />
        {cycle && (
          <span className="text-[10px]" style={{ color: W.muted }}>
            Day {cycle.day}
          </span>
        )}
      </div>
      <div className="grid flex-1 grid-cols-2 content-center gap-x-1 gap-y-1">
        {metrics.map((m) => {
          const Icon = METRIC_ICON[m.key];
          return (
            <div key={m.key} className="flex flex-col items-center">
              <Ring fill={m.fill} color={TONE_DARK[m.tone]} track={W.track} size={36} stroke={4} dashed={m.tone === 'none'}>
                <Icon size={13} style={{ color: m.tone === 'none' ? W.muted : TONE_DARK[m.tone] }} />
              </Ring>
              <span className={cx('text-[11px] font-semibold leading-tight tabular-nums')} style={{ color: W.text }}>
                {m.short}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
