import { useCallback, useEffect, useState } from 'react';
import { Delete, Fingerprint, Lock } from 'lucide-react';
import type { Settings } from '../types';
import { verifyBiometric, verifyPin } from '../lib/security';
import { cx } from './ui';

const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', 'bio', '0', 'del'] as const;
export const PIN_LENGTH = 4;

/** Numeric keypad; used to unlock and (in setup mode) to choose a PIN. */
export function PinPad({
  title,
  subtitle,
  onComplete,
  onBiometric,
  error,
}: {
  title: string;
  subtitle?: string;
  onComplete: (pin: string) => Promise<boolean> | boolean;
  onBiometric?: () => void;
  error?: string | null;
}) {
  const [pin, setPin] = useState('');
  const [shake, setShake] = useState(false);
  const [busy, setBusy] = useState(false);

  const press = useCallback(
    async (k: string) => {
      if (busy) return;
      if (k === 'del') return setPin((p) => p.slice(0, -1));
      if (k === 'bio') return onBiometric?.();
      const next = (pin + k).slice(0, PIN_LENGTH);
      setPin(next);
      if (next.length === PIN_LENGTH) {
        setBusy(true);
        const ok = await onComplete(next);
        setBusy(false);
        if (!ok) {
          setShake(true);
          navigator.vibrate?.([30, 40, 30]);
          setTimeout(() => {
            setShake(false);
            setPin('');
          }, 350);
        } else {
          setPin('');
        }
      }
    },
    [busy, pin, onBiometric, onComplete],
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (/^\d$/.test(e.key)) void press(e.key);
      else if (e.key === 'Backspace') void press('del');
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [press]);

  return (
    <div className="flex flex-col items-center">
      <h2 className="font-display text-2xl text-ink">{title}</h2>
      {subtitle && <p className="mt-1 text-center text-sm text-ink-soft">{subtitle}</p>}
      <div className={cx('my-7 flex gap-4', shake && 'animate-shake')} aria-label={`${pin.length} of ${PIN_LENGTH} digits entered`}>
        {Array.from({ length: PIN_LENGTH }, (_, i) => (
          <span key={i} className={cx('h-3.5 w-3.5 rounded-full transition', i < pin.length ? 'scale-110 bg-rose-500' : 'bg-blush-200')} />
        ))}
      </div>
      {error && (
        <p role="alert" className="-mt-4 mb-3 text-sm text-rose-600">
          {error}
        </p>
      )}
      <div className="grid grid-cols-3 gap-4">
        {KEYS.map((k) =>
          k === 'bio' && !onBiometric ? (
            <span key={k} />
          ) : (
            <button
              key={k}
              onClick={() => void press(k)}
              aria-label={k === 'del' ? 'Delete' : k === 'bio' ? 'Unlock with biometrics' : k}
              className={cx(
                'grid h-[68px] w-[68px] place-items-center rounded-full text-2xl font-medium text-ink transition active:scale-90',
                k === 'del' || k === 'bio' ? 'text-ink-soft' : 'bg-white/80 shadow-soft',
              )}
            >
              {k === 'del' ? <Delete size={22} /> : k === 'bio' ? <Fingerprint size={26} className="text-rose-500" /> : k}
            </button>
          ),
        )}
      </div>
    </div>
  );
}

export default function LockScreen({ settings, onUnlock, onForgot }: { settings: Settings; onUnlock: () => void; onForgot?: () => void }) {
  const [error, setError] = useState<string | null>(null);
  const [attempts, setAttempts] = useState(0);
  const [cooldownUntil, setCooldownUntil] = useState(0);
  const [, tick] = useState(0);

  const tryBiometric = useCallback(async () => {
    if (!settings.biometricCredentialId) return;
    if (await verifyBiometric(settings.biometricCredentialId)) onUnlock();
  }, [settings.biometricCredentialId, onUnlock]);

  // Offer biometrics straight away when it's set up.
  useEffect(() => {
    void tryBiometric();
  }, [tryBiometric]);

  useEffect(() => {
    if (cooldownUntil <= Date.now()) return;
    const id = setInterval(() => tick((n) => n + 1), 500);
    return () => clearInterval(id);
  }, [cooldownUntil]);

  const remaining = Math.ceil((cooldownUntil - Date.now()) / 1000);

  const check = async (pin: string) => {
    if (remaining > 0 || !settings.pinHash || !settings.pinSalt) return false;
    const ok = await verifyPin(pin, settings.pinHash, settings.pinSalt);
    if (ok) {
      onUnlock();
      return true;
    }
    const n = attempts + 1;
    setAttempts(n);
    if (n % 5 === 0) {
      setCooldownUntil(Date.now() + 30_000);
      setError('Too many tries. Please wait 30 seconds.');
    } else setError('That PIN didn’t match.');
    return false;
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-cream px-6">
      <div className="w-full max-w-xs">
        <div className="mx-auto mb-5 grid h-14 w-14 place-items-center rounded-2xl bg-blush-200 text-rose-600">
          <Lock size={24} />
        </div>
        <PinPad
          title="Welcome back"
          subtitle="Enter your PIN to open Phase"
          error={remaining > 0 ? `Too many tries. Try again in ${remaining}s.` : error}
          onComplete={check}
          onBiometric={settings.biometricCredentialId ? () => void tryBiometric() : undefined}
        />
        {onForgot && (
          <button onClick={onForgot} className="mx-auto mt-6 block rounded-xl px-3 py-2 text-sm font-semibold text-rose-600 hover:bg-blush-100">
            Forgot PIN? Sign in with your password
          </button>
        )}
      </div>
    </div>
  );
}
