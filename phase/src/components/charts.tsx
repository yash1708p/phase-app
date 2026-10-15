/**
 * Lightweight SVG charts (no chart library — keeps the PWA fast).
 *
 * Conventions: thin marks, recessive grid, one y-axis, text in ink tokens
 * (never series colour), hover/tap tooltips, and a table view for every chart.
 */
import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { Table2, LineChart as LineIcon } from 'lucide-react';
import { cx } from './ui';

export const CHART = {
  series: '#C2455A',
  seriesSoft: '#F3BDBA',
  grid: '#F3E3DF',
  axis: '#A8979A',
  ink: '#3D2C2E',
  band: '#E9F4EF',
  bandText: '#4E8A75',
  ref: '#6E5A5C',
  surface: '#FFFFFF',
};

/** Validated categorical order for cycle phases (passes CVD + normal-vision checks on white). */
export const PHASE_COLORS = { menstrual: '#C2455A', follicular: '#D98A2B', ovulatory: '#1F9A86', luteal: '#7B5FC4' } as const;

function useWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [w, setW] = useState(320);
  useLayoutEffect(() => {
    if (!ref.current) return;
    const el = ref.current;
    setW(el.clientWidth || 320);
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => setW(el.clientWidth || 320));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, w] as const;
}

/* ------------------------------------------------------------------ */
/* Frame with table toggle                                              */
/* ------------------------------------------------------------------ */

export function ChartFrame({
  title,
  subtitle,
  table,
  children,
  empty,
}: {
  title: string;
  subtitle?: ReactNode;
  table: { head: string[]; rows: (string | number)[][] };
  children: ReactNode;
  empty?: string | null;
}) {
  const [asTable, setAsTable] = useState(false);
  return (
    <section className="rounded-2xl bg-white/90 p-4 shadow-soft ring-1 ring-blush-200/60">
      <div className="mb-2 flex items-start justify-between gap-2">
        <div>
          <h3 className="font-display text-base text-ink">{title}</h3>
          {subtitle && <p className="text-xs text-ink-soft">{subtitle}</p>}
        </div>
        {!empty && (
          <button
            onClick={() => setAsTable((t) => !t)}
            aria-label={asTable ? 'Show chart' : 'Show as table'}
            className="grid h-9 w-9 shrink-0 place-items-center rounded-full text-ink-faint hover:bg-blush-100"
          >
            {asTable ? <LineIcon size={16} /> : <Table2 size={16} />}
          </button>
        )}
      </div>
      {empty ? (
        <p className="rounded-xl bg-cream-200 p-4 text-center text-sm text-ink-soft">{empty}</p>
      ) : asTable ? (
        <div className="max-h-64 overflow-auto">
          <table className="w-full text-left text-sm">
            <thead className="sticky top-0 bg-white text-xs text-ink-faint">
              <tr>
                {table.head.map((h) => (
                  <th key={h} className="py-1.5 pr-2 font-semibold">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="text-ink">
              {table.rows.map((r, i) => (
                <tr key={i} className="border-t border-blush-100">
                  {r.map((c, j) => (
                    <td key={j} className="py-1.5 pr-2 tabular-nums">
                      {c}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        children
      )}
    </section>
  );
}

function Tooltip({ x, width, children }: { x: number; width: number; children: ReactNode }) {
  const left = Math.min(Math.max(x, 70), width - 70);
  return (
    <div
      className="pointer-events-none absolute top-0 z-10 -translate-x-1/2 whitespace-nowrap rounded-lg bg-ink px-2.5 py-1.5 text-xs text-cream shadow-lift"
      style={{ left }}
      role="status"
    >
      {children}
    </div>
  );
}

const niceTicks = (min: number, max: number, count = 4) => {
  const raw = Math.max((max - min) / count, 1e-6);
  const pow = 10 ** Math.floor(Math.log10(raw));
  const n = raw / pow;
  const step = (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * pow;
  const out: number[] = [];
  for (let v = Math.ceil(min / step) * step; v <= max + 1e-9; v += step) out.push(Number(v.toFixed(6)));
  return out;
};

const tickLabel = (t: number) => (Number.isInteger(t) ? String(t) : t.toFixed(1));

/* ------------------------------------------------------------------ */
/* Line chart                                                           */
/* ------------------------------------------------------------------ */

export interface LinePoint {
  label: string;
  value: number | null;
  /** Tooltip text; defaults to label + value. */
  tip?: string;
}

export function LineChart({
  data,
  yMin,
  yMax,
  band,
  reference,
  unit = '',
  height = 170,
  decimals = 0,
  showDots = true,
  trend = false,
}: {
  data: LinePoint[];
  yMin: number;
  yMax: number;
  band?: { from: number; to: number; label: string };
  reference?: { value: number; label: string };
  unit?: string;
  height?: number;
  decimals?: number;
  showDots?: boolean;
  /** Draw a least-squares trend line. */
  trend?: boolean;
}) {
  const [wrap, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const pad = { l: 34, r: 10, t: 28, b: 22 };
  const w = width - pad.l - pad.r;
  const h = height - pad.t - pad.b;
  const n = data.length;
  const x = (i: number) => pad.l + (n <= 1 ? w / 2 : (i / (n - 1)) * w);
  const y = (v: number) => pad.t + h - ((Math.min(Math.max(v, yMin), yMax) - yMin) / (yMax - yMin)) * h;

  // Path with gaps for missing values.
  let path = '';
  let pen = false;
  data.forEach((d, i) => {
    if (d.value === null) {
      pen = false;
      return;
    }
    path += `${pen ? 'L' : 'M'}${x(i).toFixed(1)},${y(d.value).toFixed(1)}`;
    pen = true;
  });

  // Trend line (simple linear regression over present points).
  let trendLine: [number, number, number, number] | null = null;
  const pts = data.map((d, i) => [i, d.value] as const).filter((p): p is readonly [number, number] => p[1] !== null);
  if (trend && pts.length >= 3) {
    const mx = pts.reduce((a, p) => a + p[0], 0) / pts.length;
    const my = pts.reduce((a, p) => a + p[1], 0) / pts.length;
    const sxy = pts.reduce((a, p) => a + (p[0] - mx) * (p[1] - my), 0);
    const sxx = pts.reduce((a, p) => a + (p[0] - mx) ** 2, 0) || 1;
    const slope = sxy / sxx;
    const i0 = pts[0][0];
    const i1 = pts[pts.length - 1][0];
    trendLine = [x(i0), y(my + slope * (i0 - mx)), x(i1), y(my + slope * (i1 - mx))];
  }

  const onMove = (clientX: number, rect: DOMRect) => {
    const rel = clientX - rect.left - pad.l;
    const i = Math.round((rel / w) * (n - 1));
    setHover(Math.max(0, Math.min(n - 1, i)));
  };

  const hv = hover !== null ? data[hover] : null;
  const ticks = niceTicks(yMin, yMax);
  const labelEvery = Math.ceil(n / 6);

  return (
    <div ref={wrap} className="relative select-none" style={{ height }}>
      {hv && hover !== null && (
        <Tooltip x={x(hover)} width={width}>
          {hv.tip ?? `${hv.label}: ${hv.value === null ? 'not logged' : `${hv.value.toFixed(decimals)}${unit}`}`}
        </Tooltip>
      )}
      <svg
        width={width}
        height={height}
        className="touch-pan-y"
        onPointerMove={(e) => onMove(e.clientX, e.currentTarget.getBoundingClientRect())}
        onPointerDown={(e) => onMove(e.clientX, e.currentTarget.getBoundingClientRect())}
        onPointerLeave={() => setHover(null)}
        role="img"
        aria-label={`Line chart with ${n} points`}
      >
        {band && (
          <>
            <rect x={pad.l} width={w} y={y(band.to)} height={Math.max(0, y(band.from) - y(band.to))} fill={CHART.band} />
            <text x={pad.l + w - 4} y={y(band.to) + 12} textAnchor="end" fontSize="10" fill={CHART.bandText}>
              {band.label}
            </text>
          </>
        )}
        {ticks.map((t) => (
          <g key={t}>
            <line x1={pad.l} x2={pad.l + w} y1={y(t)} y2={y(t)} stroke={CHART.grid} strokeWidth="1" />
            <text x={pad.l - 6} y={y(t) + 3.5} textAnchor="end" fontSize="10" fill={CHART.axis}>
              {tickLabel(t)}
            </text>
          </g>
        ))}
        {reference && (
          <>
            <line x1={pad.l} x2={pad.l + w} y1={y(reference.value)} y2={y(reference.value)} stroke={CHART.ref} strokeDasharray="4 4" strokeWidth="1" />
            <text x={pad.l + 4} y={y(reference.value) - 5} fontSize="10" fill={CHART.ref}>
              {reference.label}
            </text>
          </>
        )}
        {trendLine && (
          <line x1={trendLine[0]} y1={trendLine[1]} x2={trendLine[2]} y2={trendLine[3]} stroke={CHART.series} strokeOpacity="0.45" strokeWidth="2" strokeDasharray="2 4" strokeLinecap="round" />
        )}
        <path d={path} fill="none" stroke={CHART.series} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
        {showDots &&
          data.map((d, i) =>
            d.value === null ? null : <circle key={i} cx={x(i)} cy={y(d.value)} r={hover === i ? 5 : 4} fill={CHART.series} stroke={CHART.surface} strokeWidth="2" />,
          )}
        {hover !== null && <line x1={x(hover)} x2={x(hover)} y1={pad.t} y2={pad.t + h} stroke={CHART.axis} strokeWidth="1" />}
        {data.map((d, i) =>
          i % labelEvery === 0 || i === n - 1 ? (
            <text key={i} x={x(i)} y={height - 6} textAnchor="middle" fontSize="10" fill={CHART.axis}>
              {d.label}
            </text>
          ) : null,
        )}
      </svg>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Bar chart                                                            */
/* ------------------------------------------------------------------ */

export function BarChart({
  data,
  yMax,
  unit = '',
  height = 160,
  reference,
  color = CHART.series,
}: {
  data: { label: string; value: number; tip?: string }[];
  yMax?: number;
  unit?: string;
  height?: number;
  reference?: { value: number; label: string };
  color?: string;
}) {
  const [wrap, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const pad = { l: 26, r: 8, t: 28, b: 22 };
  const w = width - pad.l - pad.r;
  const h = height - pad.t - pad.b;
  const max = yMax ?? Math.max(1, ...data.map((d) => d.value), reference?.value ?? 0);
  const slot = w / Math.max(1, data.length);
  const bw = Math.min(28, slot - 6);
  const y = (v: number) => pad.t + h - (v / max) * h;
  const ticks = niceTicks(0, max, 3);

  return (
    <div ref={wrap} className="relative select-none" style={{ height }}>
      {hover !== null && (
        <Tooltip x={pad.l + slot * hover + slot / 2} width={width}>
          {data[hover].tip ?? `${data[hover].label}: ${data[hover].value}${unit}`}
        </Tooltip>
      )}
      <svg width={width} height={height} onPointerLeave={() => setHover(null)} role="img" aria-label={`Bar chart with ${data.length} bars`}>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={pad.l} x2={pad.l + w} y1={y(t)} y2={y(t)} stroke={CHART.grid} />
            <text x={pad.l - 6} y={y(t) + 3.5} textAnchor="end" fontSize="10" fill={CHART.axis}>
              {tickLabel(t)}
            </text>
          </g>
        ))}
        {data.map((d, i) => {
          const cx0 = pad.l + slot * i + slot / 2;
          const top = y(d.value);
          const bh = Math.max(0, pad.t + h - top);
          const r = Math.min(4, bw / 2, bh);
          return (
            <g key={i} onPointerEnter={() => setHover(i)} onPointerDown={() => setHover(i)}>
              {/* generous hit area */}
              <rect x={pad.l + slot * i} y={pad.t} width={slot} height={h} fill="transparent" />
              {bh > 0 && (
                <path
                  d={`M${cx0 - bw / 2},${pad.t + h} V${top + r} Q${cx0 - bw / 2},${top} ${cx0 - bw / 2 + r},${top} H${cx0 + bw / 2 - r} Q${cx0 + bw / 2},${top} ${cx0 + bw / 2},${top + r} V${pad.t + h} Z`}
                  fill={color}
                  opacity={hover === null || hover === i ? 1 : 0.55}
                />
              )}
              <text x={cx0} y={height - 6} textAnchor="middle" fontSize="10" fill={CHART.axis}>
                {d.label}
              </text>
            </g>
          );
        })}
        {reference && (
          <>
            <line x1={pad.l} x2={pad.l + w} y1={y(reference.value)} y2={y(reference.value)} stroke={CHART.ref} strokeDasharray="4 4" />
            <text x={pad.l + w} y={y(reference.value) - 5} textAnchor="end" fontSize="10" fill={CHART.ref}>
              {reference.label}
            </text>
          </>
        )}
      </svg>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Heat grid (sequential, one hue)                                      */
/* ------------------------------------------------------------------ */

const RAMP = ['#FFF4F2', '#FBDAD7', '#F3B3AF', '#E2827F', '#C2455A', '#93293D'];

export function HeatGrid({ rows, cols }: { rows: { label: string; values: (number | null)[] }[]; cols: { label: string; color: string }[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-separate" style={{ borderSpacing: 2 }}>
        <thead>
          <tr>
            <th />
            {cols.map((c) => (
              <th key={c.label} className="pb-1 text-[11px] font-semibold text-ink-soft">
                <span className="mr-1 inline-block h-2 w-2 rounded-full align-middle" style={{ background: c.color }} />
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.label}>
              <th className="whitespace-nowrap pr-2 text-left text-xs font-medium text-ink">{r.label}</th>
              {r.values.map((v, i) => {
                const idx = v === null ? -1 : Math.min(RAMP.length - 1, Math.round(v * (RAMP.length - 1) * 1.4));
                return (
                  <td
                    key={i}
                    className={cx('h-9 rounded-md text-center text-xs tabular-nums', idx >= 4 ? 'text-white' : 'text-ink')}
                    style={{ background: idx < 0 ? '#F7F1EE' : RAMP[idx] }}
                    title={v === null ? 'No logs' : `${Math.round(v * 100)}% of logged days`}
                  >
                    {v === null ? '–' : `${Math.round(v * 100)}%`}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Stat tile                                                            */
/* ------------------------------------------------------------------ */

export function StatTile({ label, value, unit, note }: { label: string; value: string | number | null; unit?: string; note?: string }) {
  return (
    <div className="rounded-2xl bg-white/90 p-3 shadow-soft ring-1 ring-blush-200/60">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-ink-faint">{label}</p>
      <p className="mt-0.5 font-display text-2xl text-ink">
        {value ?? '–'}
        {value !== null && unit && <span className="ml-1 font-sans text-sm text-ink-soft">{unit}</span>}
      </p>
      {note && <p className="text-xs text-ink-soft">{note}</p>}
    </div>
  );
}
