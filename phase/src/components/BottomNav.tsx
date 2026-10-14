import { BarChart3, HeartPulse, Home } from 'lucide-react';
import { cx } from './ui';

export type Tab = 'today' | 'symptoms' | 'insights';

const TABS: { id: Tab; label: string; icon: typeof Home }[] = [
  { id: 'today', label: 'Today', icon: Home },
  { id: 'symptoms', label: 'Symptoms', icon: HeartPulse },
  { id: 'insights', label: 'Insights', icon: BarChart3 },
];

export default function BottomNav({ tab, onChange }: { tab: Tab; onChange: (t: Tab) => void }) {
  return (
    <nav className="fixed inset-x-0 bottom-0 z-20 border-t border-blush-200/70 bg-cream/90 backdrop-blur-md" aria-label="Main">
      <div className="mx-auto grid max-w-md grid-cols-3 px-4 pb-safe pt-1.5">
        {TABS.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            onClick={() => onChange(id)}
            aria-current={tab === id ? 'page' : undefined}
            className={cx('flex min-h-[52px] flex-col items-center justify-center gap-0.5 rounded-2xl text-xs font-semibold transition', tab === id ? 'text-rose-600' : 'text-ink-faint')}
          >
            <span className={cx('grid h-8 w-14 place-items-center rounded-full transition', tab === id && 'bg-blush-200')}>
              <Icon size={20} />
            </span>
            {label}
          </button>
        ))}
      </div>
    </nav>
  );
}
