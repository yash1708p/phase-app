import { Share, SquarePlus, X } from 'lucide-react';
import { useInstallPrompt } from '../lib/pwa';
import { updateSettings } from '../lib/store';
import type { Settings } from '../types';

const SNOOZE_MS = 14 * 24 * 60 * 60 * 1000;

/** "Add to Home Screen" banner: native prompt on Android/Chrome, instructions on iOS Safari. */
export default function InstallBanner({ settings }: { settings: Settings }) {
  const { canPrompt, installed, iosManual, promptInstall } = useInstallPrompt();
  const snoozed = settings.installBannerDismissedAt && Date.now() - settings.installBannerDismissedAt < SNOOZE_MS;
  if (installed || snoozed || (!canPrompt && !iosManual)) return null;

  const dismiss = () => updateSettings({ installBannerDismissedAt: Date.now() });

  return (
    <div className="fixed inset-x-0 bottom-[calc(64px+env(safe-area-inset-bottom))] z-30 mx-auto max-w-md animate-sheet-up px-4">
      <div className="mb-3 flex items-center gap-3 rounded-2xl bg-ink p-3.5 text-cream shadow-lift">
        <img src="/icons/icon-192.png" alt="" className="h-11 w-11 rounded-xl" />
        <div className="min-w-0 flex-1 text-sm">
          <p className="font-semibold">Add Phase to your home screen</p>
          {iosManual ? (
            <p className="text-cream/75">
              Tap <Share size={13} className="inline -mt-0.5" /> Share, then <SquarePlus size={13} className="inline -mt-0.5" /> Add to Home Screen.
            </p>
          ) : (
            <p className="text-cream/75">Opens instantly and works offline.</p>
          )}
        </div>
        {canPrompt && (
          <button onClick={() => void promptInstall()} className="rounded-xl bg-rose-400 px-3.5 py-2 text-sm font-semibold text-white">
            Install
          </button>
        )}
        <button onClick={dismiss} aria-label="Dismiss" className="grid h-9 w-9 place-items-center rounded-full text-cream/70">
          <X size={18} />
        </button>
      </div>
    </div>
  );
}
