import { useState } from 'react';
import { Apple, BedDouble, Brain, ChevronDown, Footprints, GlassWater, HandHeart, Stethoscope, Wand2 } from 'lucide-react';
import type { Suggestion, SuggestionCategory } from '../types';
import { Card, cx } from './ui';

const ICONS: Record<SuggestionCategory, { icon: typeof GlassWater; tint: string }> = {
  hydration: { icon: GlassWater, tint: 'bg-sky-50 text-sky-700' },
  rest: { icon: BedDouble, tint: 'bg-lilac-100 text-lilac-500' },
  nutrition: { icon: Apple, tint: 'bg-sage-100 text-sage-600' },
  movement: { icon: Footprints, tint: 'bg-peach-100 text-ink' },
  relief: { icon: HandHeart, tint: 'bg-blush-100 text-rose-600' },
  mind: { icon: Brain, tint: 'bg-lilac-100 text-lilac-500' },
  care: { icon: Stethoscope, tint: 'bg-blush-200 text-rose-700' },
};

/** Personalized actions for today, highest priority first. */
export default function SuggestionsCard({ suggestions, onOpenCare }: { suggestions: Suggestion[]; onOpenCare?: () => void }) {
  const [all, setAll] = useState(false);
  if (!suggestions.length) return null;
  const shown = all ? suggestions : suggestions.slice(0, 4);

  return (
    <Card>
      <div className="mb-3 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-rose-600">
        <Wand2 size={14} /> Suggestions for today
      </div>
      <ul className="space-y-2.5">
        {shown.map((s) => {
          const { icon: Icon, tint } = ICONS[s.category];
          const clickable = s.category === 'care' && s.id === 'care-findings' && onOpenCare;
          const Body = (
            <>
              <span className={cx('grid h-10 w-10 shrink-0 place-items-center rounded-xl', tint)}>
                <Icon size={18} />
              </span>
              <span className="min-w-0 text-left">
                <span className="block font-semibold leading-snug text-ink">{s.title}</span>
                <span className="block text-sm leading-snug text-ink-soft">{s.detail}</span>
              </span>
            </>
          );
          return (
            <li key={s.id} className="animate-fade-up">
              {clickable ? (
                <button onClick={onOpenCare} className="flex w-full gap-3 rounded-xl bg-blush-100/70 p-2 text-left ring-1 ring-blush-200">
                  {Body}
                </button>
              ) : (
                <div className="flex gap-3">{Body}</div>
              )}
            </li>
          );
        })}
      </ul>
      {suggestions.length > 4 && (
        <button onClick={() => setAll((a) => !a)} className="mt-3 flex w-full items-center justify-center gap-1 rounded-xl py-2 text-sm font-semibold text-rose-600 hover:bg-blush-100">
          {all ? 'Show fewer' : `Show all ${suggestions.length}`}
          <ChevronDown size={16} className={cx('transition', all && 'rotate-180')} />
        </button>
      )}
    </Card>
  );
}
