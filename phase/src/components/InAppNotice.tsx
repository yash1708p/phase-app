import { useEffect, useState } from 'react';
import { Bell, X } from 'lucide-react';
import { onInAppMessage, type InAppMessage } from '../lib/notifier';

/**
 * Shows Phase notifications as a banner at the top of the screen while the
 * app is open — phones don't reliably show a web app's own notifications
 * while it's on screen, so this makes sure they're never missed.
 */
export default function InAppNotice() {
  const [queue, setQueue] = useState<InAppMessage[]>([]);
  const current = queue[0];

  useEffect(() => onInAppMessage((m) => setQueue((q) => (q.some((x) => x.key === m.key) ? q : [...q, m]))), []);

  useEffect(() => {
    if (!current) return;
    const id = setTimeout(() => setQueue((q) => q.slice(1)), 9_000);
    return () => clearTimeout(id);
  }, [current]);

  if (!current) return null;
  return (
    <div className="pointer-events-none fixed inset-x-0 top-0 z-[60] mx-auto max-w-md px-3 pt-[max(0.5rem,env(safe-area-inset-top))]">
      <div
        key={current.key}
        role="status"
        aria-live="polite"
        className="pointer-events-auto flex animate-fade-up items-start gap-3 rounded-2xl bg-white/95 p-3 shadow-lift ring-1 ring-blush-200 backdrop-blur"
      >
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-blush-100 text-rose-600">
          <Bell size={17} />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-ink">{current.title}</p>
          <p className="text-sm text-ink-soft">{current.body}</p>
        </div>
        <button onClick={() => setQueue((q) => q.slice(1))} aria-label="Dismiss" className="grid h-8 w-8 shrink-0 place-items-center rounded-full text-ink-faint hover:bg-blush-100">
          <X size={16} />
        </button>
      </div>
    </div>
  );
}
